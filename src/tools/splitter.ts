/**
 * prompt_split — analyze a complex prompt and split it into sub-tasks.
 *
 * Returns a structured plan showing which sub-agent handles each part,
 * dependency ordering, and the actual prompts to send. The LLM client
 * (Claude) then decides whether to execute them.
 *
 * Strategies:
 *   - "auto": short-circuit for single-domain, then try gemini -> local -> heuristic
 *   - "gemini": use Gemini CLI for analysis
 *   - "local": use local LLM for analysis
 *   - "heuristic": pure keyword-based splitting (no LLM call)
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { spawnLocal } from '../spawn.js';
import { matchRules, KNOWN_AGENTS, ROUTING_RULES } from './routing-rules.js';

// --- Schema ---

export const promptSplitSchema = z.object({
  prompt: z.string().describe(
    'The complex prompt to analyze and split into sub-tasks.',
  ),
  strategy: z.enum(['auto', 'gemini', 'local', 'heuristic']).default('auto').describe(
    'How to analyze the prompt:\n'
    + '  "auto" (default): tries gemini, then local LLM, then heuristic\n'
    + '  "gemini": use Gemini CLI for smart analysis\n'
    + '  "local": use local LLM (LM Studio/Ollama) for analysis\n'
    + '  "heuristic": pure keyword splitting (no LLM, instant)',
  ),
});

// --- Types ---

export interface Subtask {
  id: string;
  summary: string;
  agent: string;
  prompt: string;
  depends_on: string[];
  reason: string;
}

export interface SplitPlan {
  original_prompt: string;
  subtasks: Subtask[];
  parallelizable_groups: string[][];
  estimated_total_seconds: number;
  strategy_used: string;
  note: string;
}

// --- LLM analysis prompt ---

function buildAnalysisPrompt(userPrompt: string): string {
  const agentList = ROUTING_RULES.map(r => `- ${r.tool}: ${r.reason}`).join('\n');

  return `You are a task planner. Analyze the user's prompt and split it into sub-tasks.

Available agents:
${agentList}

Rules:
- Each sub-task gets exactly one agent
- Use depends_on to express ordering (task IDs like "t1", "t2")
- Tasks with no dependencies can run in parallel
- Keep prompts self-contained (include necessary context in each)
- For simple single-agent prompts, return just one task
- Use local_llm_run for simple formatting, extraction, or classification
- Use codex_run for coding tasks, gemini_run for analysis, openclaw_run for trading/automation

Respond with ONLY valid JSON (no markdown fences, no explanation):
{
  "subtasks": [
    {
      "id": "t1",
      "summary": "short description",
      "agent": "agent_name",
      "prompt": "the actual prompt to send to this agent",
      "depends_on": [],
      "reason": "why this agent"
    }
  ]
}

User's prompt:
${userPrompt}`;
}

// --- Gemini-based analysis ---

async function splitViaGemini(
  prompt: string,
  config: Config,
): Promise<Subtask[] | null> {
  const analysisPrompt = buildAnalysisPrompt(prompt);
  const model = config.geminiModel ?? 'gemini-2.5-flash';
  const cliArgs = ['-p', analysisPrompt, '--output-format', 'json'];
  cliArgs.push('--model', model);

  let raw: string;
  try {
    raw = await spawnLocal('gemini', cliArgs, 30_000);
  } catch {
    return null;
  }

  return parseSubtasksFromJson(raw);
}

// --- Local LLM-based analysis ---

async function splitViaLocalLlm(
  prompt: string,
  config: Config,
): Promise<Subtask[] | null> {
  const endpoint = config.localLlmEndpoint ?? 'http://localhost:1234/v1';
  const model = config.localLlmModel ?? '';
  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    messages: [
      { role: 'system', content: 'You are a task planner. Respond with ONLY valid JSON, no markdown fences.' },
      { role: 'user', content: buildAnalysisPrompt(prompt) },
    ],
    temperature: 0.1,
  };
  if (model) body['model'] = model;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  try {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    return parseSubtasksFromJson(content);
  } catch {
    return null;
  }
}

// --- JSON parsing helper ---

function parseSubtasksFromJson(raw: string): Subtask[] | null {
  // Try to extract JSON from the response (handle markdown fences, Gemini envelope, etc.)
  let text = raw.trim();

  // Gemini CLI --output-format json wraps in { response: "..." }
  try {
    const envelope = JSON.parse(text) as { response?: string };
    if (envelope.response) {
      text = envelope.response;
    }
  } catch {
    // Not a Gemini envelope, use raw text
  }

  // Strip <think>...</think> blocks from reasoning models (Deepseek R1, Phi 4 Reasoning, etc.)
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Strip markdown fences
  text = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  try {
    const parsed = JSON.parse(text) as { subtasks?: unknown[] };
    if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) return null;

    const tasks = parsed.subtasks as Subtask[];

    // Validate and sanitize
    for (const task of tasks) {
      if (!task.id || !task.agent || !task.prompt) return null;
      // Remap unknown agents to gemini_run
      if (!KNOWN_AGENTS.has(task.agent)) {
        task.agent = 'gemini_run';
        task.reason = (task.reason || '') + ' (agent remapped: original not recognized)';
      }
      if (!Array.isArray(task.depends_on)) task.depends_on = [];
    }

    // Validate dependency references
    const ids = new Set(tasks.map(t => t.id));
    for (const task of tasks) {
      task.depends_on = task.depends_on.filter(dep => ids.has(dep));
    }

    return tasks;
  } catch {
    return null;
  }
}

// --- Heuristic-based splitting ---

// Patterns that signal sequential ordering
const SEQUENTIAL_MARKERS = /\b(then|after that|next|finally|once done|when that's done|afterwards|subsequently)\b/i;
// Patterns that signal parallel/independent tasks
const PARALLEL_MARKERS = /\b(also|and also|additionally|plus|meanwhile|at the same time|separately)\b/i;

function splitViaHeuristic(prompt: string): Subtask[] {
  // Split on sentence boundaries that follow logical connectors
  const fragments = prompt
    .split(/(?<=[.!?])\s+|(?:,?\s*(?:then|after that|next|finally|also|additionally|and then|plus)\s+)/i)
    .map(f => f.trim())
    .filter(f => f.length > 5);

  if (fragments.length <= 1) {
    // Single task, pick best agent
    const matches = matchRules(prompt);
    const agent = matches[0]?.tool.split(' / ')[0] ?? 'gemini_run';
    return [{
      id: 't1',
      summary: prompt.substring(0, 80),
      agent,
      prompt,
      depends_on: [],
      reason: matches[0]?.reason ?? 'Default to Gemini for general tasks.',
    }];
  }

  const tasks: Subtask[] = [];
  let prevId: string | null = null;

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]!;
    const id = `t${i + 1}`;
    const matches = matchRules(frag);
    const agent = matches[0]?.tool.split(' / ')[0] ?? 'gemini_run';

    // Check if this fragment follows a sequential marker in the original prompt
    const beforeFrag = prompt.substring(0, prompt.indexOf(frag));
    const isSequential = SEQUENTIAL_MARKERS.test(beforeFrag.slice(-50));
    const isParallel = PARALLEL_MARKERS.test(beforeFrag.slice(-50));

    const depends_on: string[] = [];
    if (prevId && isSequential && !isParallel) {
      depends_on.push(prevId);
    }

    tasks.push({
      id,
      summary: frag.substring(0, 80),
      agent,
      prompt: frag,
      depends_on,
      reason: matches[0]?.reason ?? 'Default to Gemini for general tasks.',
    });

    prevId = id;
  }

  return tasks;
}

// --- Parallelizable groups computation ---

function computeGroups(tasks: Subtask[]): string[][] {
  // Topological sort into execution levels
  const deps = new Map<string, Set<string>>();
  const levels = new Map<string, number>();

  for (const t of tasks) {
    deps.set(t.id, new Set(t.depends_on));
  }

  // Compute level for each task (max dependency level + 1)
  function getLevel(id: string, visited: Set<string>): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visited.has(id)) return 0; // Break circular dependency
    visited.add(id);

    const taskDeps = deps.get(id);
    if (!taskDeps || taskDeps.size === 0) {
      levels.set(id, 0);
      return 0;
    }

    let maxDep = 0;
    for (const dep of taskDeps) {
      maxDep = Math.max(maxDep, getLevel(dep, visited) + 1);
    }
    levels.set(id, maxDep);
    return maxDep;
  }

  for (const t of tasks) {
    getLevel(t.id, new Set());
  }

  // Group by level
  const groupMap = new Map<number, string[]>();
  for (const t of tasks) {
    const level = levels.get(t.id) ?? 0;
    if (!groupMap.has(level)) groupMap.set(level, []);
    groupMap.get(level)!.push(t.id);
  }

  return Array.from(groupMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, ids]) => ids);
}

// --- Time estimates ---

const TIME_ESTIMATES: Record<string, number> = {
  codex_run: 30,
  gemini_run: 15,
  openclaw_run: 60,
  local_llm_run: 10,
};

function estimateTime(tasks: Subtask[], groups: string[][]): number {
  // Sum the max time of each parallel group (sequential execution of groups)
  let total = 0;
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  for (const group of groups) {
    let maxInGroup = 0;
    for (const id of group) {
      const task = taskMap.get(id);
      const agentBase = task?.agent.split('_')[0] ?? '';
      const est = TIME_ESTIMATES[task?.agent ?? ''] ?? (agentBase === 'home' ? 3 : 15);
      maxInGroup = Math.max(maxInGroup, est);
    }
    total += maxInGroup;
  }

  return total;
}

// --- Main handler ---

export async function handlePromptSplit(
  args: { prompt: string; strategy: string },
  config: Config,
): Promise<SplitPlan> {
  const { prompt, strategy } = args;

  // Short-circuit: if keyword check shows single domain, skip LLM analysis
  if (strategy === 'auto') {
    const matches = matchRules(prompt);
    if (matches.length > 0) {
      const topTool = matches[0]!.tool;
      const secondScore = matches[1]?.score ?? 0;
      // If top match has 2x the score of second, it's clearly single-domain
      if (matches[0]!.score >= 2 && matches[0]!.score > secondScore * 2) {
        const agent = topTool.split(' / ')[0]!;
        const tasks: Subtask[] = [{
          id: 't1',
          summary: prompt.substring(0, 80),
          agent,
          prompt,
          depends_on: [],
          reason: matches[0]!.reason,
        }];
        return buildPlan(prompt, tasks, 'short-circuit',
          'Single-domain prompt detected. No splitting needed. Call the suggested agent directly.');
      }
    }
  }

  // Try strategies in order
  let subtasks: Subtask[] | null = null;
  let strategyUsed = strategy;

  if (strategy === 'gemini' || strategy === 'auto') {
    subtasks = await splitViaGemini(prompt, config);
    if (subtasks) {
      strategyUsed = 'gemini';
    }
  }

  if (!subtasks && (strategy === 'local' || strategy === 'auto')) {
    subtasks = await splitViaLocalLlm(prompt, config);
    if (subtasks) {
      strategyUsed = 'local';
    }
  }

  if (!subtasks) {
    subtasks = splitViaHeuristic(prompt);
    strategyUsed = strategy === 'heuristic' ? 'heuristic' : `${strategy}->heuristic (fallback)`;
  }

  const note = subtasks.length === 1
    ? 'This prompt maps to a single agent. No splitting required. Call the suggested agent directly.'
    : 'Execute sub-tasks in dependency order. Tasks in the same parallelizable_group can be called concurrently. '
      + 'Review the plan with the user before executing if the prompt is ambiguous.';

  return buildPlan(prompt, subtasks, strategyUsed, note);
}

function buildPlan(
  prompt: string,
  subtasks: Subtask[],
  strategyUsed: string,
  note: string,
): SplitPlan {
  const groups = computeGroups(subtasks);
  return {
    original_prompt: prompt,
    subtasks,
    parallelizable_groups: groups,
    estimated_total_seconds: estimateTime(subtasks, groups),
    strategy_used: strategyUsed,
    note,
  };
}
