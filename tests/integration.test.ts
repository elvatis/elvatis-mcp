/**
 * Integration tests for elvatis-mcp tools.
 *
 * Run with: npx tsx tests/integration.test.ts
 *
 * Prerequisites:
 *   - .env configured with SSH_HOST, HA_URL (copy .env.example)
 *   - Local LLM server running (LM Studio, Ollama, or llama.cpp)
 *   - OpenClaw server reachable via SSH (for memory/cron tests)
 *
 * These are live integration tests, not unit tests. They call real services
 * to verify end-to-end functionality. Skip individual tests by commenting
 * them out if a service is not available.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
// Try multiple .env locations (worktree, main repo root, cwd)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env') });
dotenv.config();

import { loadConfig } from '../src/config.js';
import { handleLocalLlmRun } from '../src/tools/local-llm.js';
import { handlePromptSplit } from '../src/tools/splitter.js';
import { handleMcpHelp } from '../src/tools/help.js';
import { handleMemorySearch } from '../src/tools/memory.js';

const config = loadConfig();

// --- Helpers ---

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  PASS  ${name} (${ms}ms)`);
    passed++;
  } catch (err: unknown) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('Could not connect') || msg.includes('SSH failed')) {
      console.log(`  SKIP  ${name} (${ms}ms) -- service not available: ${msg.substring(0, 80)}`);
      skipped++;
    } else {
      console.log(`  FAIL  ${name} (${ms}ms)`);
      console.log(`        ${msg}`);
      failed++;
    }
  }
}

// ============================================================================
// Test Suite
// ============================================================================

async function main() {
  console.log('\n  elvatis-mcp integration tests\n');
  console.log('  -----------------------------------------------------------\n');

  // --- local_llm_run ---

  console.log('  Local LLM (local_llm_run)\n');

  await test('local_llm_run: simple classification', async () => {
    const result = await handleLocalLlmRun({
      prompt: 'Classify this sentiment as positive, negative, or neutral: "The new update broke everything and I lost my data"',
      system: 'Respond with only one word: positive, negative, or neutral.',
      temperature: 0,
      timeout_seconds: 30,
    }, config);

    assert(result.success === true, 'expected success');
    assert(typeof result.response === 'string', 'expected response string');
    assert(result.response.toLowerCase().includes('negative'), `expected "negative", got "${result.response}"`);
    assert(typeof result.model === 'string', 'expected model name');
    console.log(`        Model: ${result.model}`);
    console.log(`        Response: "${result.response}"`);
    if (result.usage) {
      console.log(`        Tokens: ${result.usage.total_tokens} (prompt: ${result.usage.prompt_tokens}, completion: ${result.usage.completion_tokens})`);
    }
  });

  await test('local_llm_run: JSON extraction', async () => {
    const result = await handleLocalLlmRun({
      prompt: 'Extract the name and age from this text as JSON: "John Smith is 34 years old and lives in Berlin"',
      system: 'Respond with only valid JSON, no explanation.',
      temperature: 0,
      timeout_seconds: 30,
    }, config);

    assert(result.success === true, 'expected success');
    // The response should contain JSON-parseable content
    const cleaned = result.response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    assert(parsed.name !== undefined || parsed.Name !== undefined, 'expected name field in JSON');
    console.log(`        Extracted: ${JSON.stringify(parsed)}`);
  });

  await test('local_llm_run: connection error handling', async () => {
    const result = await handleLocalLlmRun({
      prompt: 'hello',
      endpoint: 'http://localhost:19999/v1', // port that nothing listens on
      timeout_seconds: 5,
    }, config);

    assert(result.success === false, 'expected failure');
    assert(result.hint !== undefined, 'expected hint with setup instructions');
    console.log(`        Error: ${result.error}`);
  });

  // --- prompt_split ---

  console.log('\n  Prompt Splitter (prompt_split)\n');

  await test('prompt_split: single-domain coding prompt routes to codex', async () => {
    // Use heuristic to test routing logic without LLM timeout
    const result = await handlePromptSplit({
      prompt: 'Fix the authentication bug in the login handler',
      strategy: 'heuristic',
    }, config);

    assert(result.subtasks.length === 1, `expected 1 subtask, got ${result.subtasks.length}`);
    assert(result.subtasks[0]!.agent === 'codex_run', `expected codex_run, got ${result.subtasks[0]!.agent}`);
    console.log(`        Strategy: ${result.strategy_used}`);
    console.log(`        Agent: ${result.subtasks[0]!.agent}`);
    console.log(`        Summary: ${result.subtasks[0]!.summary}`);
  });

  await test('prompt_split: heuristic multi-agent splitting', async () => {
    const result = await handlePromptSplit({
      prompt: 'Refactor the auth module, then check my portfolio performance and also turn on the living room lights',
      strategy: 'heuristic',
    }, config);

    assert(result.subtasks.length >= 2, `expected 2+ subtasks, got ${result.subtasks.length}`);
    const agents = result.subtasks.map(t => t.agent);
    assert(agents.includes('codex_run'), 'expected codex_run for refactoring');
    // Should have home tool for lights
    const hasHome = agents.some(a => a.startsWith('home_'));
    assert(hasHome, 'expected a home_* tool for lights');

    console.log(`        Strategy: ${result.strategy_used}`);
    console.log(`        Subtasks: ${result.subtasks.length}`);
    for (const t of result.subtasks) {
      console.log(`          ${t.id}: ${t.agent} -- "${t.summary}"`);
    }
    console.log(`        Parallel groups: ${JSON.stringify(result.parallelizable_groups)}`);
    console.log(`        Estimated time: ${result.estimated_total_seconds}s`);
  });

  await test('prompt_split: cross-domain with dependencies', async () => {
    const result = await handlePromptSplit({
      prompt: 'Search my memory for TurboQuant notes, then summarize them with Gemini, and also reformat the data as JSON using the local model. After that, save a summary to memory.',
      strategy: 'heuristic',
    }, config);

    assert(result.subtasks.length >= 3, `expected 3+ subtasks, got ${result.subtasks.length}`);

    // Check that dependencies exist (sequential markers in prompt)
    const hasDeps = result.subtasks.some(t => t.depends_on.length > 0);
    assert(hasDeps, 'expected at least one task with dependencies');

    // Check agent diversity
    const agents = new Set(result.subtasks.map(t => t.agent));
    assert(agents.size >= 2, `expected 2+ different agents, got ${agents.size}`);

    console.log(`        Subtasks: ${result.subtasks.length}, Agents: ${[...agents].join(', ')}`);
    console.log(`        Parallel groups: ${JSON.stringify(result.parallelizable_groups)}`);
  });

  await test('prompt_split: local LLM strategy (with fallback)', async () => {
    const result = await handlePromptSplit({
      prompt: 'Check the server status, debug the failing test, and turn off all lights',
      strategy: 'local',
    }, config);

    // Should either use local LLM or fall back to heuristic
    assert(
      result.strategy_used === 'local' || result.strategy_used.includes('heuristic'),
      `expected local or heuristic fallback, got ${result.strategy_used}`,
    );
    assert(result.subtasks.length >= 1, 'expected at least 1 subtask');

    console.log(`        Strategy: ${result.strategy_used}`);
    console.log(`        Subtasks: ${result.subtasks.length}`);
  });

  // --- mcp_help ---

  console.log('\n  Routing Guide (mcp_help)\n');

  await test('mcp_help: returns guide without task', async () => {
    const result = await handleMcpHelp({});
    assert(typeof result.guide === 'string', 'expected guide string');
    assert(result.guide.includes('local_llm_run'), 'guide should mention local_llm_run');
    assert(result.guide.includes('prompt_split'), 'guide should mention prompt_split');
    console.log(`        Guide length: ${result.guide.length} chars`);
  });

  await test('mcp_help: routes formatting task to local_llm_run', async () => {
    const result = await handleMcpHelp({ task: 'reformat this CSV data as a markdown table' });
    assert(result.recommendation!.includes('local_llm_run'), 'expected local_llm_run recommendation');
    console.log(`        Recommendation: ${result.recommendation}`);
  });

  await test('mcp_help: routes coding task to codex_run', async () => {
    const result = await handleMcpHelp({ task: 'debug the TypeScript compile error and fix the bug' });
    assert(result.recommendation!.includes('codex_run'), 'expected codex_run recommendation');
    console.log(`        Recommendation: ${result.recommendation}`);
  });

  // --- openclaw_memory_search (SSH) ---

  console.log('\n  Memory Search via SSH (openclaw_memory_search)\n');

  await test('openclaw_memory_search: finds existing notes', async () => {
    const result = await handleMemorySearch({ query: 'trading', days: 30 }, config);
    assert(Array.isArray(result.results), 'expected results array');
    console.log(`        Query: "${result.query}", Results: ${result.results.length}`);
    for (const r of result.results.slice(0, 3)) {
      console.log(`          ${r.date}: ${r.excerpt.substring(0, 60)}...`);
    }
  });

  // --- Summary ---

  console.log('\n  -----------------------------------------------------------');
  console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('  -----------------------------------------------------------\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
