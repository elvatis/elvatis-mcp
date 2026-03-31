/**
 * Unit tests for elvatis-mcp pure functions.
 *
 * Run with: npm test
 *
 * Uses Node's built-in test runner (node:test) so no extra dependencies needed.
 * Tests only pure/deterministic logic (no SSH, no HTTP, no CLI spawning).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { matchRules, ROUTING_RULES, KNOWN_AGENTS, ROUTING_GUIDE } from '../src/tools/routing-rules.js';
import { handlePromptSplit } from '../src/tools/splitter.js';
import { handleMcpHelp } from '../src/tools/help.js';
import type { Config } from '../src/config.js';

// Minimal config stub for heuristic-only tests (no SSH/HTTP needed)
const stubConfig: Config = {
  sshHost: '',
  haUrl: '',
  haToken: '',
  localLlmEndpoint: 'http://localhost:1234/v1',
  localLlmModel: '',
  geminiModel: 'gemini-2.5-flash',
};

// ============================================================================
// matchRules() — keyword routing engine
// ============================================================================

describe('matchRules', () => {
  it('routes coding keywords to codex_run', () => {
    const matches = matchRules('Fix the bug in the login function');
    assert.ok(matches.length > 0, 'should have at least one match');
    assert.equal(matches[0]!.tool, 'codex_run');
  });

  it('routes analysis keywords to gemini_run', () => {
    const matches = matchRules('Summarize this research paper');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'gemini_run');
  });

  it('routes classification to local_llm_run', () => {
    const matches = matchRules('Classify these items as positive or negative');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'local_llm_run');
  });

  it('routes trading keywords to openclaw_run', () => {
    const matches = matchRules('Check my portfolio performance');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'openclaw_run');
  });

  it('routes light control to home_light', () => {
    const matches = matchRules('Turn on the living room lights');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'home_light');
  });

  it('routes sensor queries to home_sensors', () => {
    const matches = matchRules('Read all sensor data');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'home_sensors');
  });

  it('routes climate control to home_climate', () => {
    const matches = matchRules('Set the thermostat to 22 degrees');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'home_climate');
  });

  it('routes vacuum commands to home_vacuum', () => {
    const matches = matchRules('Start the robot vacuum');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'home_vacuum');
  });

  it('routes memory search to openclaw_memory_search', () => {
    const matches = matchRules('Search my memory for meeting notes');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'openclaw_memory_search');
  });

  it('routes memory write to openclaw_memory_write', () => {
    const matches = matchRules('Remember this: the API key expires next week');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'openclaw_memory_write');
  });

  it('routes notifications to openclaw_notify', () => {
    const matches = matchRules('Send the results via WhatsApp');
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.tool, 'openclaw_notify');
  });

  it('uses word boundary matching (no partial matches)', () => {
    // "reviews" should NOT match "review" as a keyword for claude_run
    const matches = matchRules('Classify these customer reviews');
    // Should route to local_llm_run (classify keyword), not claude_run
    assert.ok(matches.length > 0);
    assert.notEqual(matches[0]!.tool, 'claude_run');
  });

  it('handles multi-word phrase matching', () => {
    const matches = matchRules('I need a short answer about this topic');
    const localMatch = matches.find(m => m.tool === 'local_llm_run');
    assert.ok(localMatch, 'should match local_llm_run via "short answer" phrase');
  });

  it('returns empty array for unrecognized input', () => {
    const matches = matchRules('xyzzy foobar blergh');
    assert.equal(matches.length, 0);
  });

  it('sorts matches by score descending', () => {
    const matches = matchRules('debug the TypeScript function bug and fix the compile error');
    assert.ok(matches.length > 0);
    for (let i = 1; i < matches.length; i++) {
      assert.ok(matches[i]!.score <= matches[i - 1]!.score, 'should be sorted by score desc');
    }
  });
});

// ============================================================================
// ROUTING_RULES / KNOWN_AGENTS / ROUTING_GUIDE — structural checks
// ============================================================================

describe('routing constants', () => {
  it('ROUTING_RULES has entries for all major tool categories', () => {
    const tools = new Set(ROUTING_RULES.map(r => r.tool));
    assert.ok(tools.has('codex_run'), 'should have codex_run');
    assert.ok(tools.has('gemini_run'), 'should have gemini_run');
    assert.ok(tools.has('claude_run'), 'should have claude_run');
    assert.ok(tools.has('openclaw_run'), 'should have openclaw_run');
    assert.ok(tools.has('local_llm_run'), 'should have local_llm_run');
    assert.ok(tools.has('home_light'), 'should have home_light');
    assert.ok(tools.has('home_sensors'), 'should have home_sensors');
    assert.ok(tools.has('home_climate'), 'should have home_climate');
  });

  it('every rule has non-empty keywords and reason', () => {
    for (const rule of ROUTING_RULES) {
      assert.ok(rule.keywords.length > 0, `${rule.tool} should have keywords`);
      assert.ok(rule.reason.length > 0, `${rule.tool} should have a reason`);
    }
  });

  it('KNOWN_AGENTS includes all routing rule tools', () => {
    for (const rule of ROUTING_RULES) {
      // Skip combined tool entries (tool1 / tool2 / tool3)
      if (rule.tool.includes(' / ')) continue;
      assert.ok(KNOWN_AGENTS.has(rule.tool), `KNOWN_AGENTS should include ${rule.tool}`);
    }
  });

  it('ROUTING_GUIDE mentions all sub-agent tools', () => {
    for (const tool of ['claude_run', 'codex_run', 'gemini_run', 'openclaw_run', 'local_llm_run']) {
      assert.ok(ROUTING_GUIDE.includes(tool), `guide should mention ${tool}`);
    }
  });
});

// ============================================================================
// handlePromptSplit (heuristic strategy) — splitting logic
// ============================================================================

describe('prompt_split heuristic', () => {
  it('single coding prompt returns 1 task with codex_run', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Fix the authentication bug in the login handler',
      strategy: 'heuristic',
    }, stubConfig);

    assert.equal(plan.subtasks.length, 1);
    assert.equal(plan.subtasks[0]!.agent, 'codex_run');
    assert.equal(plan.parallelizable_groups.length, 1);
  });

  it('single analysis prompt returns 1 task with gemini_run', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Summarize this 50-page research paper on quantum computing',
      strategy: 'heuristic',
    }, stubConfig);

    assert.equal(plan.subtasks.length, 1);
    assert.equal(plan.subtasks[0]!.agent, 'gemini_run');
  });

  it('splits "then" connector into sequential tasks', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Refactor the auth module, then ask Gemini to review the changes',
      strategy: 'heuristic',
    }, stubConfig);

    assert.equal(plan.subtasks.length, 2);
    assert.equal(plan.subtasks[0]!.agent, 'codex_run');
    assert.equal(plan.subtasks[1]!.agent, 'gemini_run');
  });

  it('splits "also" connector into parallel tasks', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Check my portfolio performance and also turn on the living room lights',
      strategy: 'heuristic',
    }, stubConfig);

    assert.equal(plan.subtasks.length, 2);
    const agents = plan.subtasks.map(t => t.agent);
    assert.ok(agents.includes('openclaw_run'));
    assert.ok(agents.includes('home_light'));
  });

  it('splits comma-separated clauses targeting different agents', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Check the server status via OpenClaw, debug the failing test with Codex, have Claude review the fix, use the local model to format the report as markdown, and send the results via WhatsApp',
      strategy: 'heuristic',
    }, stubConfig);

    assert.equal(plan.subtasks.length, 5);
    const agents = plan.subtasks.map(t => t.agent);
    assert.ok(agents.includes('openclaw_run'), 'should have openclaw_run');
    assert.ok(agents.includes('codex_run'), 'should have codex_run');
    assert.ok(agents.includes('claude_run'), 'should have claude_run');
    assert.ok(agents.includes('local_llm_run'), 'should have local_llm_run');
    assert.ok(agents.includes('openclaw_notify'), 'should have openclaw_notify');
  });

  it('handles home automation chains with conditional logic', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Read all sensor data, then if CO2 is above 1000ppm turn on the ventilation, dim the bedroom lights to 20%, and set the thermostat to 19 degrees',
      strategy: 'heuristic',
    }, stubConfig);

    assert.equal(plan.subtasks.length, 4);
    const agents = plan.subtasks.map(t => t.agent);
    assert.ok(agents.includes('home_sensors'), 'should have home_sensors');
    assert.ok(agents.includes('home_climate'), 'should have home_climate');
    // home_light should appear for the light dimming task
    assert.ok(agents.filter(a => a === 'home_light').length >= 1, 'should have home_light');
  });

  it('returns valid parallelizable_groups', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Refactor the auth module, then check my portfolio and also turn on the lights',
      strategy: 'heuristic',
    }, stubConfig);

    assert.ok(plan.parallelizable_groups.length >= 1);
    // All task IDs should appear in exactly one group
    const allIds = plan.parallelizable_groups.flat();
    const taskIds = plan.subtasks.map(t => t.id);
    assert.deepEqual(new Set(allIds), new Set(taskIds));
  });

  it('populates model and estimated time', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Fix the bug in the auth module',
      strategy: 'heuristic',
    }, stubConfig);

    assert.ok(plan.estimated_total_seconds > 0, 'should estimate time');
    assert.ok(plan.subtasks[0]!.model, 'should have a model suggestion');
    assert.ok(plan.strategy_used.includes('heuristic'), 'should report heuristic strategy');
  });

  it('includes note with execution instructions', async () => {
    const plan = await handlePromptSplit({
      prompt: 'Do two things: fix the bug and check the portfolio',
      strategy: 'heuristic',
    }, stubConfig);

    assert.ok(plan.note.length > 0, 'should include a note');
  });
});

// ============================================================================
// handleMcpHelp — routing guide and task recommendations
// ============================================================================

describe('mcp_help', () => {
  it('returns routing guide without task', async () => {
    const result = await handleMcpHelp({});
    assert.ok(result.guide.length > 0, 'should return guide');
    assert.ok(result.guide.includes('local_llm_run'), 'guide should mention local_llm_run');
    assert.ok(result.guide.includes('prompt_split'), 'guide should mention prompt_split');
  });

  it('routes coding task to codex_run', async () => {
    const result = await handleMcpHelp({ task: 'debug the TypeScript compile error and fix the bug' });
    assert.ok(result.recommendation, 'should have recommendation');
    assert.ok(result.recommendation!.includes('codex_run'), 'should recommend codex_run');
  });

  it('routes formatting task to local_llm_run', async () => {
    const result = await handleMcpHelp({ task: 'reformat this CSV data as a markdown table' });
    assert.ok(result.recommendation, 'should have recommendation');
    assert.ok(result.recommendation!.includes('local_llm_run'), 'should recommend local_llm_run');
  });

  it('routes home automation task to home tool', async () => {
    const result = await handleMcpHelp({ task: 'turn on the bedroom lights' });
    assert.ok(result.recommendation, 'should have recommendation');
    assert.ok(result.recommendation!.includes('home_light'), 'should recommend home_light');
  });

  it('routes trading task to openclaw_run', async () => {
    const result = await handleMcpHelp({ task: 'check my stock portfolio and current positions' });
    assert.ok(result.recommendation, 'should have recommendation');
    assert.ok(result.recommendation!.includes('openclaw_run'), 'should recommend openclaw_run');
  });
});
