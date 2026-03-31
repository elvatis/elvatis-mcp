#!/usr/bin/env npx tsx
/**
 * elvatis-mcp prompt_split benchmark suite
 *
 * Tests the heuristic splitter against all example prompts and reports
 * accuracy, latency, and agent routing quality.
 *
 * Usage:
 *   npx tsx benchmarks/test-prompt-split.ts
 *   npx tsx benchmarks/test-prompt-split.ts --strategy gemini   # requires gemini CLI
 *   npx tsx benchmarks/test-prompt-split.ts --strategy local    # requires LM Studio/Ollama
 *   npx tsx benchmarks/test-prompt-split.ts --verbose
 *
 * No server needed for --strategy heuristic (default).
 * For gemini/local/auto, the elvatis-mcp server must NOT be running (we call the handler directly).
 */

import { handlePromptSplit, type SplitPlan } from '../src/tools/splitter.js';
import type { Config } from '../src/config.js';
import * as fs from 'fs';
import * as path from 'path';

// --- CLI args ---
const args = process.argv.slice(2);
const strategy = (args.find(a => a.startsWith('--strategy='))?.split('=')[1]
  ?? args[args.indexOf('--strategy') + 1]
  ?? 'heuristic') as 'auto' | 'gemini' | 'local' | 'heuristic';
const verbose = args.includes('--verbose') || args.includes('-v');
const saveResults = args.includes('--save');

// --- Config (reads .env if present) ---
const config: Config = {
  localLlmEndpoint: process.env['LOCAL_LLM_ENDPOINT'] ?? 'http://localhost:1234/v1',
  localLlmModel: process.env['LOCAL_LLM_MODEL'] ?? '',
  geminiModel: process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash',
  // Unused fields required by Config type
  sshHost: process.env['SSH_HOST'] ?? '',
  haUrl: process.env['HA_URL'] ?? '',
  haToken: process.env['HA_TOKEN'] ?? '',
};

// --- Test cases ---
interface TestCase {
  id: string;
  prompt: string;
  expected_tasks: number;
  expected_agents: string[];
  category: string;
}

// Resolve path relative to this script, handling Windows drive letters
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'));
const EXAMPLES_FILE = path.join(__dirname, 'prompt-split-examples.json');

interface ExamplesFile {
  examples: TestCase[];
}

const examplesData = JSON.parse(fs.readFileSync(EXAMPLES_FILE, 'utf-8')) as ExamplesFile;
const TEST_CASES: TestCase[] = examplesData.examples;

// --- Scoring ---
interface TestResult {
  id: string;
  category: string;
  prompt: string;
  expected_tasks: number;
  expected_agents: string[];
  actual_tasks: number;
  actual_agents: string[];
  strategy_used: string;
  latency_ms: number;
  task_count_correct: boolean;
  agent_overlap_score: number; // 0.0 - 1.0
  passed: boolean;
  plan?: SplitPlan;
  error?: string;
}

function agentOverlap(expected: string[], actual: string[]): number {
  if (expected.length === 0) return 1.0;
  const expectedSet = new Set(expected);
  const matches = actual.filter(a => expectedSet.has(a)).length;
  return matches / expected.length;
}

// --- Run a single test ---
async function runTest(tc: TestCase): Promise<TestResult> {
  const start = Date.now();
  let plan: SplitPlan | undefined;
  let error: string | undefined;

  try {
    plan = await handlePromptSplit({ prompt: tc.prompt, strategy }, config);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const latency_ms = Date.now() - start;

  if (!plan || error) {
    return {
      id: tc.id,
      category: tc.category,
      prompt: tc.prompt,
      expected_tasks: tc.expected_tasks,
      expected_agents: tc.expected_agents,
      actual_tasks: 0,
      actual_agents: [],
      strategy_used: strategy,
      latency_ms,
      task_count_correct: false,
      agent_overlap_score: 0,
      passed: false,
      error,
    };
  }

  const actual_agents = plan.subtasks.map(t => t.agent);
  const task_count_correct = plan.subtasks.length === tc.expected_tasks;
  const agent_overlap_score = agentOverlap(tc.expected_agents, actual_agents);
  // Pass = correct task count AND all expected agents are covered
  const passed = task_count_correct && agent_overlap_score >= 0.5;

  return {
    id: tc.id,
    category: tc.category,
    prompt: tc.prompt,
    expected_tasks: tc.expected_tasks,
    expected_agents: tc.expected_agents,
    actual_tasks: plan.subtasks.length,
    actual_agents,
    strategy_used: plan.strategy_used,
    latency_ms,
    task_count_correct,
    agent_overlap_score,
    passed,
    plan,
  };
}

// --- Formatting ---
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function bar(score: number, width = 10): string {
  const filled = Math.round(score * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// --- Main ---
async function main() {
  console.log(`\n${BOLD}elvatis-mcp prompt_split Benchmark${RESET}`);
  console.log(`Strategy: ${CYAN}${strategy}${RESET}  |  Cases: ${TEST_CASES.length}\n`);
  console.log('─'.repeat(72));

  const results: TestResult[] = [];

  for (const tc of TEST_CASES) {
    process.stdout.write(`  ${tc.id.padEnd(30)} `);
    const result = await runTest(tc);
    results.push(result);

    const statusIcon = result.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    const overlapColor = result.agent_overlap_score >= 0.8 ? GREEN
      : result.agent_overlap_score >= 0.5 ? YELLOW : RED;

    console.log(
      `${statusIcon}  tasks: ${result.actual_tasks}/${result.expected_tasks}  `
      + `agents: ${overlapColor}${bar(result.agent_overlap_score)}${RESET}  `
      + `${result.latency_ms}ms`,
    );

    if (verbose && result.plan) {
      for (const task of result.plan.subtasks) {
        console.log(`         ${CYAN}${task.id}${RESET} [${task.agent}] ${task.summary}`);
      }
      if (result.plan.parallelizable_groups.length > 1) {
        console.log(`         parallel groups: ${JSON.stringify(result.plan.parallelizable_groups)}`);
      }
    }

    if (result.error) {
      console.log(`         ${RED}Error: ${result.error}${RESET}`);
    }
  }

  console.log('─'.repeat(72));

  // Summary stats
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latency_ms, 0) / total);
  const avgAgentScore = results.reduce((s, r) => s + r.agent_overlap_score, 0) / total;
  const taskCountCorrect = results.filter(r => r.task_count_correct).length;

  console.log(`\n${BOLD}Results${RESET}`);
  console.log(`  Pass rate:        ${passed}/${total} (${pct(passed / total)})`);
  console.log(`  Task count acc:   ${taskCountCorrect}/${total} (${pct(taskCountCorrect / total)})`);
  console.log(`  Avg agent match:  ${pct(avgAgentScore)}  ${bar(avgAgentScore)}`);
  console.log(`  Avg latency:      ${avgLatency}ms`);

  // Per-category breakdown
  const categories = [...new Set(results.map(r => r.category))];
  if (categories.length > 1) {
    console.log(`\n${BOLD}By Category${RESET}`);
    for (const cat of categories) {
      const catResults = results.filter(r => r.category === cat);
      const catPassed = catResults.filter(r => r.passed).length;
      console.log(`  ${cat.padEnd(28)} ${catPassed}/${catResults.length} passed`);
    }
  }

  // Failed cases detail
  const failed = results.filter(r => !r.passed);
  if (failed.length > 0) {
    console.log(`\n${BOLD}Failed Cases${RESET}`);
    for (const r of failed) {
      console.log(`\n  ${RED}${r.id}${RESET} (${r.category})`);
      console.log(`    Prompt:   "${r.prompt.substring(0, 80)}..."`);
      console.log(`    Expected: ${r.expected_tasks} tasks, agents: [${r.expected_agents.join(', ')}]`);
      console.log(`    Got:      ${r.actual_tasks} tasks, agents: [${r.actual_agents.join(', ')}]`);
      if (r.error) console.log(`    Error:    ${r.error}`);
    }
  }

  // Save results
  if (saveResults) {
    const outFile = `benchmarks/results/prompt-split-${strategy}-${Date.now()}.json`;
    fs.writeFileSync(outFile, JSON.stringify({
      strategy,
      timestamp: new Date().toISOString(),
      summary: { passed, total, avgLatency, avgAgentScore, taskCountCorrect },
      results: results.map(r => {
        const { plan: _, ...rest } = r;
        return rest;
      }),
    }, null, 2));
    console.log(`\n  Results saved to ${outFile}`);
  }

  console.log('');
  process.exit(passed === total ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
