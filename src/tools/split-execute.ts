/**
 * prompt_split_execute — execute a SplitPlan produced by prompt_split.
 *
 * Takes a plan (or runs prompt_split inline), executes subtasks in dependency
 * order using parallelizable_groups, passes results between dependent tasks,
 * and enforces rate limits on cloud agents.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { checkRateLimit, recordUsage } from '../rate-limiter.js';
import type { ToolExtra } from '../index.js';
import type { SplitPlan, Subtask } from './splitter.js';

// Lazy imports to avoid circular dependency at module load time.
// Each handler is imported on first use and cached.
let _handleGeminiRun: typeof import('./gemini.js').handleGeminiRun | null = null;
let _handleCodexRun: typeof import('./codex.js').handleCodexRun | null = null;
let _handleClaudeRun: typeof import('./claude.js').handleClaudeRun | null = null;
let _handleLocalLlmRun: typeof import('./local-llm.js').handleLocalLlmRun | null = null;
let _handleOpenclawRun: typeof import('./openclaw.js').handleOpenclawRun | null = null;
let _handlePromptSplit: typeof import('./splitter.js').handlePromptSplit | null = null;

// --- Schema ---

const subtaskOverrideSchema = z.object({
  id: z.string(),
  agent: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  skip: z.boolean().optional(),
}).describe('Override fields for a specific subtask');

export const splitExecuteSchema = z.object({
  plan: z.any().optional().describe(
    'A SplitPlan object (from prompt_split). If omitted, provide "prompt" to generate one.',
  ),
  prompt: z.string().optional().describe(
    'If no plan is provided, run prompt_split with this prompt first (heuristic strategy).',
  ),
  overrides: z.array(subtaskOverrideSchema).optional().describe(
    'Optional per-task overrides: change agent, model, prompt, or skip a task.',
  ),
  dry_run: z.boolean().default(false).describe(
    'If true, return the plan with rate limit checks but do not execute.',
  ),
});

// --- Types ---

interface TaskResult {
  id: string;
  agent: string;
  status: 'success' | 'error' | 'skipped' | 'rate_limited';
  result?: unknown;
  error?: string;
  duration_ms?: number;
}

interface ExecutionResult {
  plan: SplitPlan;
  results: TaskResult[];
  total_duration_ms: number;
  summary: string;
}

// --- Handler ---

export async function handleSplitExecute(
  args: {
    plan?: unknown;
    prompt?: string;
    overrides?: Array<{ id: string; agent?: string; model?: string; prompt?: string; skip?: boolean }>;
    dry_run: boolean;
  },
  config: Config,
  extra?: ToolExtra,
): Promise<ExecutionResult> {
  // Step 1: Get or generate plan
  let plan: SplitPlan;
  if (args.plan && typeof args.plan === 'object') {
    plan = args.plan as SplitPlan;
  } else if (args.prompt) {
    if (!_handlePromptSplit) _handlePromptSplit = (await import('./splitter.js')).handlePromptSplit;
    plan = await _handlePromptSplit({ prompt: args.prompt, strategy: 'heuristic' }, config);
  } else {
    return {
      plan: { original_prompt: '', subtasks: [], parallelizable_groups: [], estimated_total_seconds: 0, strategy_used: 'none', note: '' },
      results: [],
      total_duration_ms: 0,
      summary: 'Error: provide either "plan" or "prompt".',
    };
  }

  // Step 2: Apply overrides
  if (args.overrides) {
    const overrideMap = new Map(args.overrides.map(o => [o.id, o]));
    for (const task of plan.subtasks) {
      const override = overrideMap.get(task.id);
      if (!override) continue;
      if (override.agent) task.agent = override.agent;
      if (override.model) task.model = override.model;
      if (override.prompt) task.prompt = override.prompt;
    }
    // Mark skipped tasks
    var skippedIds = new Set(args.overrides.filter(o => o.skip).map(o => o.id));
  } else {
    var skippedIds = new Set<string>();
  }

  // Step 3: Rate limit pre-check (dry run or pre-flight)
  const rateLimitIssues: string[] = [];
  for (const task of plan.subtasks) {
    if (skippedIds.has(task.id)) continue;
    const quota = checkRateLimit(task.agent);
    if (!quota.allowed) {
      rateLimitIssues.push(`${task.id} (${task.agent}): ${quota.reason}`);
    }
  }

  if (args.dry_run) {
    return {
      plan,
      results: plan.subtasks.map(t => ({
        id: t.id,
        agent: t.agent,
        status: skippedIds.has(t.id) ? 'skipped' as const : 'success' as const,
      })),
      total_duration_ms: 0,
      summary: rateLimitIssues.length > 0
        ? `Dry run complete. Rate limit issues: ${rateLimitIssues.join('; ')}`
        : `Dry run complete. ${plan.subtasks.length} tasks ready to execute.`,
    };
  }

  // Step 4: Execute groups in order
  const results: TaskResult[] = [];
  const resultMap = new Map<string, unknown>();
  const startTime = Date.now();

  // Send progress if available
  const progressToken = extra?._meta?.progressToken;
  const sendProgress = progressToken && extra?.sendNotification
    ? async (msg: string) => {
        await extra.sendNotification!({
          method: 'notifications/progress',
          params: { progressToken, progress: results.length, total: plan.subtasks.length, message: msg },
        });
      }
    : async (_msg: string) => {};

  for (const group of plan.parallelizable_groups) {
    const groupTasks = group
      .map(id => plan.subtasks.find(t => t.id === id))
      .filter((t): t is Subtask => t != null);

    // Execute tasks in this group concurrently
    const groupPromises = groupTasks.map(async (task) => {
      // Skip?
      if (skippedIds.has(task.id)) {
        return { id: task.id, agent: task.agent, status: 'skipped' as const };
      }

      // Rate limit check (re-check at execution time)
      const quota = checkRateLimit(task.agent);
      if (!quota.allowed) {
        return {
          id: task.id,
          agent: task.agent,
          status: 'rate_limited' as const,
          error: quota.reason,
        };
      }

      // Inject prior results into prompt if task has dependencies
      let prompt = task.prompt;
      if (task.depends_on.length > 0) {
        const priorResults = task.depends_on
          .map(depId => {
            const r = resultMap.get(depId);
            return r ? `[Result from ${depId}]: ${typeof r === 'string' ? r : JSON.stringify(r)}` : null;
          })
          .filter(Boolean);
        if (priorResults.length > 0) {
          prompt = `${prompt}\n\nContext from prior tasks:\n${priorResults.join('\n')}`;
        }
      }

      await sendProgress(`Running ${task.id}: ${task.summary}`);

      const taskStart = Date.now();
      try {
        const result = await dispatchTask(task, prompt, config, extra);
        const duration = Date.now() - taskStart;
        recordUsage(task.agent);
        resultMap.set(task.id, result);
        return { id: task.id, agent: task.agent, status: 'success' as const, result, duration_ms: duration };
      } catch (err) {
        const duration = Date.now() - taskStart;
        return { id: task.id, agent: task.agent, status: 'error' as const, error: String(err), duration_ms: duration };
      }
    });

    const groupResults = await Promise.all(groupPromises);
    results.push(...groupResults);
  }

  const totalDuration = Date.now() - startTime;

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const rateLimited = results.filter(r => r.status === 'rate_limited').length;

  let summary = `Executed ${succeeded}/${plan.subtasks.length} tasks in ${(totalDuration / 1000).toFixed(1)}s.`;
  if (failed > 0) summary += ` ${failed} failed.`;
  if (skipped > 0) summary += ` ${skipped} skipped.`;
  if (rateLimited > 0) summary += ` ${rateLimited} rate-limited.`;

  await sendProgress(summary);

  return { plan, results, total_duration_ms: totalDuration, summary };
}

// --- Dispatch ---

async function dispatchTask(
  task: Subtask,
  prompt: string,
  config: Config,
  extra?: ToolExtra,
): Promise<unknown> {
  switch (task.agent) {
    case 'gemini_run': {
      if (!_handleGeminiRun) _handleGeminiRun = (await import('./gemini.js')).handleGeminiRun;
      return _handleGeminiRun({ prompt, model: task.model !== 'gemini-2.5-flash' ? task.model : undefined, timeout_seconds: 60 }, config);
    }
    case 'codex_run': {
      if (!_handleCodexRun) _handleCodexRun = (await import('./codex.js')).handleCodexRun;
      return _handleCodexRun({ prompt, model: task.model !== 'gpt-5-codex' ? task.model : undefined, sandbox: 'full-auto' as const, timeout_seconds: 120 }, config);
    }
    case 'claude_run': {
      if (!_handleClaudeRun) _handleClaudeRun = (await import('./claude.js')).handleClaudeRun;
      return _handleClaudeRun({ prompt, model: task.model !== 'claude-sonnet-4-6' ? task.model : undefined, timeout_seconds: 60 });
    }
    case 'local_llm_run': {
      if (!_handleLocalLlmRun) _handleLocalLlmRun = (await import('./local-llm.js')).handleLocalLlmRun;
      return _handleLocalLlmRun({ prompt, timeout_seconds: 60, stream: false }, config, extra);
    }
    case 'openclaw_run': {
      if (!_handleOpenclawRun) _handleOpenclawRun = (await import('./openclaw.js')).handleOpenclawRun;
      return _handleOpenclawRun({ message: prompt, timeout_seconds: 120 } as any, config);
    }
    default:
      // For non-dispatchable agents (home_*, memory_*, cron_*), return guidance
      return {
        note: `Agent "${task.agent}" cannot be auto-dispatched. Call the tool directly with the prompt.`,
        prompt,
        agent: task.agent,
      };
  }
}
