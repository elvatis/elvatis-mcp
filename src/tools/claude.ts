/**
 * Claude sub-agent tool.
 *
 * Uses the Claude Code CLI in non-interactive mode with session resume:
 *   echo "<prompt>" | claude -p --session-id <uuid> --output-format json ...  (first request)
 *   echo "<prompt>" | claude -p --resume <uuid> --output-format json ...       (subsequent)
 *
 * Session resume keeps conversation context on the CLI side so subsequent
 * requests only send the new message (not the full history), eliminating
 * the ~50% silent hang rate and 80-120s response times on large prompts.
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
    'Working directory for the Claude process. Set this to the project root so Claude can read local files. Defaults to the user home directory.',
  ),
});

// --- Handler ---

export async function handleClaudeRun(
  args: { prompt: string; model?: string; timeout_seconds: number; working_directory?: string },
) {
  const model = args.model ?? 'claude-sonnet-4-6';
  const session = getOrCreateSession('claude', model);

  const cliArgs = [
    '-p',
    '--output-format', 'json',
    '--max-turns', '1',
    '--permission-mode', 'bypassPermissions',
    '--dangerously-skip-permissions',
  ];

  if (args.model) cliArgs.push('--model', args.model);

  // Use --session-id on first request, --resume on subsequent
  if (isNewSession(session)) {
    cliArgs.push('--session-id', session.sessionId);
  } else {
    cliArgs.push('--resume', session.sessionId);
  }

  let raw: string;
  try {
    raw = await spawnLocal('claude', cliArgs, args.timeout_seconds * 1000, args.working_directory, args.prompt);
  } catch (err) {
    const errMsg = String(err);
    // Session may have been cleaned up externally: invalidate and let the caller retry
    if (errMsg.includes('session not found') || errMsg.includes('ENOENT')) {
      invalidateSession('claude', model);
    }
    return {
      success: false,
      error: errMsg,
      hint: 'Install Claude Code: npm install -g @anthropic-ai/claude-code, then run `claude` once to authenticate.',
    };
  }

  // Parse the JSON output
  try {
    const parsed = JSON.parse(raw.trim()) as {
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

    recordSuccess('claude', model);

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
      session_id: session.sessionId,
    };
  } catch {
    // CLI returned plain text instead of JSON
    recordSuccess('claude', model);
    return {
      success: true,
      response: raw.trim(),
      model,
      note: 'Response was plain text, not JSON.',
      session_id: session.sessionId,
    };
  }
}
