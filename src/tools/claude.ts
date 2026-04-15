/**
 * Claude sub-agent tool.
 *
 * Uses the Claude Code CLI in non-interactive mode:
 *   echo "<prompt>" | claude -p --output-format json --max-turns 1 ...
 *
 * Session resume is enabled for Opus only (Sonnet/Haiku have 45% hang rate
 * with session resume due to corrupted sessions after SIGTERM).
 *
 * CRITICAL: Claude CLI always runs from homedir(), never from a project
 * directory. Running from a project dir triggers Claude Code's agentic mode
 * which ignores prompt instructions. See openclaw-cli-bridge-elvatis v3.8.0.
 *
 * Authentication: uses locally cached Anthropic credentials
 * (from Claude Code login or ANTHROPIC_API_KEY env var).
 *
 * Use cases:
 *   - When the MCP client is NOT Claude (e.g. Cursor, Windsurf, Zed)
 *   - Cross-check / second opinion from Claude on a Gemini or Codex result
 *   - Delegate complex reasoning tasks to Claude from any MCP client
 */

import { z } from 'zod';
import { spawnLocal } from '../spawn.js';
import { getOrCreateSession, recordSuccess, invalidateSession, isNewSession } from '../session-registry.js';

// --- Schema ---

export const claudeRunSchema = z.object({
  prompt: z.string().describe(
    'Prompt or question to send to Claude.',
  ),
  model: z.string().optional().describe(
    'Claude model to use, e.g. "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5". '
    + 'Omit to use the default model.',
  ),
  timeout_seconds: z.number().min(5).max(300).default(60).describe(
    'Max seconds to wait for a response.',
  ),
  working_directory: z.string().optional().describe(
    'Ignored for Claude (always runs from homedir to prevent agentic mode). Kept for API compatibility.',
  ),
});

// --- Handler ---

export async function handleClaudeRun(
  args: { prompt: string; model?: string; timeout_seconds: number; working_directory?: string },
) {
  const model = args.model ?? 'claude-sonnet-4-6';
  const isOpus = model.includes('opus');

  const cliArgs = [
    '-p',
    '--output-format', 'json',
    '--max-turns', '1',
    '--permission-mode', 'bypassPermissions',
    '--dangerously-skip-permissions',
  ];

  if (args.model) cliArgs.push('--model', args.model);

  // Session resume: Opus only. Sonnet/Haiku have 45% hang rate with session resume
  // due to corrupted sessions after SIGTERM kills.
  if (isOpus) {
    const session = getOrCreateSession('claude', model);
    if (isNewSession(session)) {
      cliArgs.push('--session-id', session.sessionId);
    } else {
      cliArgs.push('--resume', session.sessionId);
    }
  }

  let raw: string;
  try {
    // CRITICAL: Claude CLI must run from homedir(), never from a project directory.
    // Running from a project dir triggers Claude Code's agentic mode, which ignores
    // prompt instructions and treats tool injection as "prompt injection attempts".
    // See: openclaw-cli-bridge-elvatis v3.8.0 root cause analysis.
    // Stale timeout: Opus 90s (long-form), Sonnet 60s (tool reasoning needs time), Haiku 30s
    const staleMs = isOpus ? 90_000 : model.includes('sonnet') ? 60_000 : 30_000;
    raw = await spawnLocal('claude', cliArgs, args.timeout_seconds * 1000, undefined, args.prompt, staleMs);
  } catch (err) {
    const errMsg = String(err);
    // Session may have been cleaned up externally: invalidate and let the caller retry
    if (isOpus && (errMsg.includes('session not found') || errMsg.includes('ENOENT') || errMsg.includes('already in use'))) {
      invalidateSession('claude', model);
    }
    return {
      success: false,
      error: errMsg,
      hint: 'Install Claude Code: npm install -g @anthropic-ai/claude-code, then run `claude` once to authenticate.',
    };
  }

  // Parse the JSON output — sanitize raw newlines/tabs that models embed in strings
  try {
    const sanitized = raw.trim().replace(/[\x00-\x1f]/g, (ch) =>
      ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : '',
    );
    const parsed = JSON.parse(sanitized) as {
      result?: string;
      is_error?: boolean;
      duration_ms?: number;
      total_cost_usd?: number;
      modelUsage?: Record<string, unknown>;
      stop_reason?: string;
    };

    if (parsed.is_error) {
      return { success: false, error: parsed.result ?? 'Unknown error from Claude CLI' };
    }

    if (isOpus) recordSuccess('claude', model);

    const modelUsed = parsed.modelUsage
      ? Object.keys(parsed.modelUsage)[0] ?? model
      : model;

    return {
      success: true,
      response: parsed.result ?? '(empty response)',
      model: modelUsed,
      duration_ms: parsed.duration_ms,
      cost_usd: parsed.total_cost_usd,
      stop_reason: parsed.stop_reason,
    };
  } catch {
    // CLI returned plain text instead of JSON
    if (isOpus) recordSuccess('claude', model);
    return {
      success: true,
      response: raw.trim(),
      model,
      note: 'Response was plain text, not JSON.',
    };
  }
}
