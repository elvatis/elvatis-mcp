#!/usr/bin/env npx tsx
/**
 * elvatis-mcp Sub-Agent + Orchestration Benchmark
 *
 * Measures latency and quality of each sub-agent in the elvatis-mcp stack:
 *   - local_llm_run  (LM Studio / Ollama — free, private)
 *   - gemini_run     (Google Gemini CLI)
 *   - codex_run      (OpenAI Codex CLI)
 *   - claude_run     (Anthropic Claude CLI)
 *
 * Also benchmarks end-to-end orchestration:
 *   prompt_split -> execute subtasks -> collect results
 *
 * Usage:
 *   npx tsx benchmarks/test-subagents.ts                   # all agents
 *   npx tsx benchmarks/test-subagents.ts --agents local    # local only
 *   npx tsx benchmarks/test-subagents.ts --agents gemini,claude
 *   npx tsx benchmarks/test-subagents.ts --verbose --save
 *
 * Prerequisites:
 *   - local_llm_run: LM Studio running with a model loaded on port 1234
 *   - gemini_run:    `gemini` CLI installed and authenticated
 *   - codex_run:     `codex` CLI installed and authenticated
 *   - claude_run:    `claude` CLI installed and authenticated
 */

import { handleLocalLlmRun } from '../src/tools/local-llm.js';
import { handleGeminiRun } from '../src/tools/gemini.js';
import { handleCodexRun } from '../src/tools/codex.js';
import { handleClaudeRun } from '../src/tools/claude.js';
import { handlePromptSplit } from '../src/tools/splitter.js';
import type { Config } from '../src/config.js';
import * as fs from 'fs';

// --- CLI args ---
const args = process.argv.slice(2);
const agentsArg = args.find(a => a.startsWith('--agents='))?.split('=')[1]
  ?? args[args.indexOf('--agents') + 1]
  ?? 'local,gemini,codex,claude';
const ENABLED_AGENTS = new Set(agentsArg.split(',').map(a => a.trim()));
const verbose = args.includes('--verbose') || args.includes('-v');
const saveResults = args.includes('--save');

// --- Config ---
const config: Config = {
  localLlmEndpoint: process.env['LOCAL_LLM_ENDPOINT'] ?? 'http://localhost:1234/v1',
  localLlmModel: process.env['LOCAL_LLM_MODEL'] ?? '',
  geminiModel: process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash',
  codexModel: process.env['CODEX_MODEL'],
  sshHost: process.env['SSH_HOST'] ?? '',
  haUrl: process.env['HA_URL'] ?? '',
  haToken: process.env['HA_TOKEN'] ?? '',
};

// --- Test tasks ---
interface Task {
  id: string;
  name: string;
  category: 'classify' | 'extract' | 'reason' | 'code' | 'analysis';
  system?: string;
  prompt: string;
  /** Keywords that should appear in a correct answer */
  expected_keywords: string[];
  /** Agents this task is appropriate for */
  suitable_agents: string[];
}

const TASKS: Task[] = [
  {
    id: 'classify',
    name: 'Sentiment classification',
    category: 'classify',
    system: 'Respond with only one word: positive, negative, or neutral.',
    prompt: 'Classify this sentiment: The new update broke everything and I lost my data.',
    expected_keywords: ['negative'],
    suitable_agents: ['local', 'gemini', 'claude', 'codex'],
  },
  {
    id: 'extract',
    name: 'JSON extraction',
    category: 'extract',
    system: 'Respond with only valid JSON, no explanation.',
    prompt: 'Extract name, age, and city as JSON: John Smith is 34 years old and lives in Berlin.',
    expected_keywords: ['John', '34', 'Berlin'],
    suitable_agents: ['local', 'gemini', 'claude', 'codex'],
  },
  {
    id: 'reason',
    name: 'Arithmetic reasoning',
    category: 'reason',
    prompt: 'A farmer has 17 sheep. All but 9 die. How many sheep are left? Give only the final number.',
    expected_keywords: ['9'],
    suitable_agents: ['local', 'gemini', 'claude', 'codex'],
  },
  {
    id: 'code',
    name: 'Python code generation',
    category: 'code',
    system: 'Respond with only the code, no explanation.',
    prompt: 'Write a Python function called is_valid_ipv4 that checks if a string is a valid IPv4 address. Return True or False.',
    expected_keywords: ['def is_valid_ipv4', 'return'],
    suitable_agents: ['local', 'gemini', 'claude', 'codex'],
  },
  {
    id: 'analysis',
    name: 'Technical explanation',
    category: 'analysis',
    prompt: 'In 2 sentences: what is the Model Context Protocol (MCP) and why does it matter for AI agents?',
    expected_keywords: ['protocol', 'tool'],
    suitable_agents: ['gemini', 'claude', 'codex'],
  },
];

// --- Orchestration tests ---
interface OrchestrationTest {
  id: string;
  name: string;
  prompt: string;
  expected_tasks: number;
  strategy: 'heuristic' | 'gemini' | 'local' | 'auto';
}

const ORCHESTRATION_TESTS: OrchestrationTest[] = [
  {
    id: 'orch-single',
    name: 'Single agent routing',
    prompt: 'Fix the authentication bug in the login handler',
    expected_tasks: 1,
    strategy: 'heuristic',
  },
  {
    id: 'orch-sequential',
    name: 'Sequential 2-agent plan',
    prompt: 'Refactor the auth module, then ask Gemini to review the changes',
    expected_tasks: 2,
    strategy: 'heuristic',
  },
  {
    id: 'orch-parallel',
    name: 'Parallel 2-agent plan',
    prompt: 'Check my portfolio performance and also turn on the living room lights',
    expected_tasks: 2,
    strategy: 'heuristic',
  },
  {
    id: 'orch-pipeline',
    name: '4-agent pipeline (heuristic)',
    prompt: 'Search my memory for TurboQuant notes, then summarize them with Gemini, and reformat the data as JSON locally. After that save a summary to memory.',
    expected_tasks: 4,
    strategy: 'heuristic',
  },
];

// --- Agent runners ---
type AgentResult = {
  agent: string;
  task_id: string;
  latency_ms: number;
  success: boolean;
  response_preview: string;
  quality_score: number; // 0.0 - 1.0 based on expected_keywords
  tokens?: number;
  error?: string;
};

function scoreQuality(response: string, keywords: string[]): number {
  if (!response || keywords.length === 0) return 0;
  const lower = response.toLowerCase();
  const hits = keywords.filter(k => lower.includes(k.toLowerCase())).length;
  return hits / keywords.length;
}

async function runLocalLlm(task: Task): Promise<AgentResult> {
  const start = Date.now();
  let success = false;
  let response_preview = '';
  let quality_score = 0;
  let tokens: number | undefined;
  let error: string | undefined;

  try {
    const result = await handleLocalLlmRun({
      prompt: task.prompt,
      system: task.system,
      temperature: 0,
      max_tokens: 512,
      timeout_seconds: 60,
    }, config) as {
      success: boolean;
      response?: string;
      usage?: { total_tokens: number };
      error?: string;
    };

    success = result.success;
    response_preview = (result.response ?? '').substring(0, 120);
    tokens = result.usage?.total_tokens;
    quality_score = scoreQuality(result.response ?? '', task.expected_keywords);
    if (!result.success) error = result.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return { agent: 'local', task_id: task.id, latency_ms: Date.now() - start, success, response_preview, quality_score, tokens, error };
}

async function runGemini(task: Task): Promise<AgentResult> {
  const start = Date.now();
  let success = false;
  let response_preview = '';
  let quality_score = 0;
  let error: string | undefined;

  const prompt = task.system ? `${task.system}\n\n${task.prompt}` : task.prompt;

  try {
    const result = await handleGeminiRun({
      prompt,
      timeout_seconds: 60,
    }, config) as {
      success: boolean;
      response?: string;
      error?: string;
    };

    success = result.success;
    response_preview = (result.response ?? '').substring(0, 120);
    quality_score = scoreQuality(result.response ?? '', task.expected_keywords);
    if (!result.success) error = result.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return { agent: 'gemini', task_id: task.id, latency_ms: Date.now() - start, success, response_preview, quality_score, error };
}

async function runCodex(task: Task): Promise<AgentResult> {
  const start = Date.now();
  let success = false;
  let response_preview = '';
  let quality_score = 0;
  let error: string | undefined;

  const prompt = task.system ? `${task.system}\n\n${task.prompt}` : task.prompt;

  try {
    const result = await handleCodexRun({
      prompt,
      approval_mode: 'never',
      timeout_seconds: 120,
    }, config) as {
      success: boolean;
      response?: string;
      error?: string;
    };

    success = result.success;
    response_preview = (result.response ?? '').substring(0, 120);
    quality_score = scoreQuality(result.response ?? '', task.expected_keywords);
    if (!result.success) error = result.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return { agent: 'codex', task_id: task.id, latency_ms: Date.now() - start, success, response_preview, quality_score, error };
}

async function runClaude(task: Task): Promise<AgentResult> {
  const start = Date.now();
  let success = false;
  let response_preview = '';
  let quality_score = 0;
  let error: string | undefined;

  const prompt = task.system ? `${task.system}\n\n${task.prompt}` : task.prompt;

  try {
    const result = await handleClaudeRun({
      prompt,
      timeout_seconds: 60,
    }) as {
      success: boolean;
      response?: string;
      error?: string;
    };

    success = result.success;
    response_preview = (result.response ?? '').substring(0, 120);
    quality_score = scoreQuality(result.response ?? '', task.expected_keywords);
    if (!result.success) error = result.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return { agent: 'claude', task_id: task.id, latency_ms: Date.now() - start, success, response_preview, quality_score, error };
}

// --- Formatting ---
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function bar(score: number, width = 8): string {
  const filled = Math.round(score * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

// --- Main ---
async function main() {
  console.log(`\n${BOLD}elvatis-mcp Sub-Agent Benchmark${RESET}`);
  console.log(`Agents: ${CYAN}${[...ENABLED_AGENTS].join(', ')}${RESET}  |  Tasks: ${TASKS.length}  |  Orchestration: ${ORCHESTRATION_TESTS.length}\n`);

  const allResults: AgentResult[] = [];

  // --- Per-agent latency + quality ---
  console.log(`${BOLD}Sub-Agent Performance${RESET}`);
  console.log('─'.repeat(80));

  const agentRunners: Record<string, (t: Task) => Promise<AgentResult>> = {
    local: runLocalLlm,
    gemini: runGemini,
    codex: runCodex,
    claude: runClaude,
  };

  const agentSummary: Record<string, { latencies: number[]; qualities: number[]; successes: number }> = {};

  for (const task of TASKS) {
    console.log(`\n  ${BOLD}${task.name}${RESET} ${DIM}(${task.id})${RESET}`);
    console.log(`  Prompt: "${task.prompt.substring(0, 70)}..."`);
    console.log(`  ${'Agent'.padEnd(8)} ${'Latency'.padEnd(10)} ${'Quality'.padEnd(14)} Response`);
    console.log(`  ${'─'.repeat(70)}`);

    for (const [agentName, runner] of Object.entries(agentRunners)) {
      if (!ENABLED_AGENTS.has(agentName)) continue;
      if (!task.suitable_agents.includes(agentName)) {
        console.log(`  ${agentName.padEnd(8)} ${DIM}skipped (not suitable)${RESET}`);
        continue;
      }

      process.stdout.write(`  ${agentName.padEnd(8)} running...`);
      const result = await runner(task);
      allResults.push(result);

      // Update summary
      if (!agentSummary[agentName]) agentSummary[agentName] = { latencies: [], qualities: [], successes: 0 };
      agentSummary[agentName]!.latencies.push(result.latency_ms);
      agentSummary[agentName]!.qualities.push(result.quality_score);
      if (result.success) agentSummary[agentName]!.successes++;

      const statusColor = result.success ? GREEN : RED;
      const qualityColor = result.quality_score >= 0.8 ? GREEN : result.quality_score >= 0.5 ? YELLOW : RED;
      const latencyStr = ms(result.latency_ms).padEnd(10);
      const qualityStr = `${qualityColor}${bar(result.quality_score)}${RESET} ${Math.round(result.quality_score * 100)}%`.padEnd(22);

      process.stdout.write(`\r  ${statusColor}${agentName.padEnd(8)}${RESET} ${latencyStr} ${qualityStr}`);

      if (result.success && result.response_preview) {
        const preview = result.response_preview.replace(/\n/g, ' ').substring(0, 35);
        console.log(`"${preview}"`);
      } else if (result.error) {
        console.log(`${RED}${result.error.substring(0, 50)}${RESET}`);
      } else {
        console.log('');
      }

      if (verbose && result.response_preview.length > 35) {
        console.log(`           ${DIM}${result.response_preview.replace(/\n/g, ' ')}${RESET}`);
      }
    }
  }

  // --- Orchestration benchmark ---
  console.log(`\n\n${BOLD}Orchestration (prompt_split)${RESET}`);
  console.log('─'.repeat(80));

  type OrchResult = {
    id: string;
    name: string;
    strategy: string;
    latency_ms: number;
    expected_tasks: number;
    actual_tasks: number;
    passed: boolean;
    groups: string[][];
  };

  const orchResults: OrchResult[] = [];

  for (const test of ORCHESTRATION_TESTS) {
    process.stdout.write(`  ${test.name.padEnd(35)} `);
    const start = Date.now();
    let passed = false;
    let actual_tasks = 0;
    let groups: string[][] = [];

    try {
      const plan = await handlePromptSplit({ prompt: test.prompt, strategy: test.strategy }, config);
      actual_tasks = plan.subtasks.length;
      groups = plan.parallelizable_groups;
      passed = actual_tasks === test.expected_tasks;

      const latency_ms = Date.now() - start;
      const statusIcon = passed ? `${GREEN}PASS${RESET}` : `${YELLOW}PARTIAL${RESET}`;

      console.log(`${statusIcon}  ${actual_tasks}/${test.expected_tasks} tasks  ${ms(latency_ms)}`);

      if (verbose) {
        for (const task of plan.subtasks) {
          console.log(`         ${CYAN}${task.id}${RESET} -> ${task.agent}  "${task.summary.substring(0, 50)}"`);
        }
        if (groups.length > 1) {
          console.log(`         parallel: ${JSON.stringify(groups)}`);
        }
      }

      orchResults.push({ id: test.id, name: test.name, strategy: test.strategy, latency_ms, expected_tasks: test.expected_tasks, actual_tasks, passed, groups });
    } catch (e) {
      const latency_ms = Date.now() - start;
      console.log(`${RED}ERROR${RESET}  ${e instanceof Error ? e.message : String(e)}`);
      orchResults.push({ id: test.id, name: test.name, strategy: test.strategy, latency_ms, expected_tasks: test.expected_tasks, actual_tasks: 0, passed: false, groups: [] });
    }
  }

  // --- Summary table ---
  console.log(`\n\n${BOLD}Summary by Agent${RESET}`);
  console.log('─'.repeat(80));
  console.log(`  ${'Agent'.padEnd(10)} ${'Tasks'.padEnd(8)} ${'Success'.padEnd(10)} ${'Avg Latency'.padEnd(14)} ${'Avg Quality'}`);
  console.log(`  ${'─'.repeat(68)}`);

  for (const [agentName, summary] of Object.entries(agentSummary)) {
    const total = summary.latencies.length;
    const avgLat = Math.round(summary.latencies.reduce((a, b) => a + b, 0) / total);
    const avgQuality = summary.qualities.reduce((a, b) => a + b, 0) / total;
    const successRate = summary.successes / total;
    const qualityColor = avgQuality >= 0.8 ? GREEN : avgQuality >= 0.5 ? YELLOW : RED;

    console.log(
      `  ${agentName.padEnd(10)} ${`${total}`.padEnd(8)} `
      + `${`${Math.round(successRate * 100)}%`.padEnd(10)} `
      + `${ms(avgLat).padEnd(14)} `
      + `${qualityColor}${bar(avgQuality)}${RESET} ${Math.round(avgQuality * 100)}%`,
    );
  }

  const orchPassed = orchResults.filter(r => r.passed).length;
  console.log(`\n  Orchestration:  ${orchPassed}/${orchResults.length} plans correct`);

  // --- Save ---
  if (saveResults) {
    const timestamp = Date.now();
    const outFile = `benchmarks/results/subagents-${timestamp}.json`;
    fs.writeFileSync(outFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      agents_tested: [...ENABLED_AGENTS],
      config: {
        localLlmEndpoint: config.localLlmEndpoint,
        geminiModel: config.geminiModel,
      },
      task_results: allResults,
      orchestration_results: orchResults,
      summary: Object.fromEntries(
        Object.entries(agentSummary).map(([agent, s]) => [agent, {
          tasks: s.latencies.length,
          success_rate: s.successes / s.latencies.length,
          avg_latency_ms: Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length),
          avg_quality: s.qualities.reduce((a, b) => a + b, 0) / s.qualities.length,
        }]),
      ),
    }, null, 2));
    console.log(`\n  Results saved to ${outFile}`);
  }

  console.log('');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
