/**
 * Claude sub-agent tool.
 *
 * Uses the Claude Code CLI in non-interactive mode:
 *   claude -p "<prompt>" --output-format json [--model <model>]
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
});

// --- Handler ---

export async function handleClaudeRun(
  args: { prompt: string; model?: string; timeout_seconds: number },
) {
  const cliArgs = [
    '-p', args.prompt,
    '--output-format', 'json',
    '--max-turns', '1', // single turn, no tool use loops
  ];
  if (args.model) cliArgs.push('--model', args.model);

  let raw: string;
  try {
    raw = await spawnLocal('claude', cliArgs, args.timeout_seconds * 1000);
  } catch (err) {
    return {
      success: false,
      error: String(err),
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

    // Extract which model was actually used
    const modelUsed = parsed.modelUsage
      ? Object.keys(parsed.modelUsage)[0] ?? args.model ?? 'default'
      : args.model ?? 'default';

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
    return {
      success: true,
      response: raw.trim(),
      model: args.model ?? 'default',
      note: 'Response was plain text, not JSON.',
    };
  }
}
