/**
 * Codex sub-agent tool.
 *
 * Uses the @openai/codex CLI in non-interactive mode:
 *   codex exec "<prompt>" --approval-mode never [--model <model>]
 *
 * Authentication: the CLI uses locally cached OpenAI credentials
 * (from `codex login`). No OPENAI_API_KEY env var required if logged in.
 *
 * Output behavior (codex exec):
 *   - Progress and tool calls stream to stderr (silently collected)
 *   - Final agent message is printed to stdout as plain text
 *
 * Use --approval-mode never for non-interactive operation (no pausing for
 * human approval before executing shell commands). Codex may still read and
 * write files on the machine running the MCP server — use accordingly.
 *
 * Use cases vs openclaw_run / gemini_run:
 *   - Coding tasks: refactoring, debugging, code generation (Codex specializes here)
 *   - OpenAI model stack (o3, gpt-5-codex, etc.)
 *   - Long agentic tasks that require multiple tool calls (file read/write, shell)
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { spawnLocal } from '../spawn.js';

// --- Schemas ---

export const codexRunSchema = z.object({
  prompt: z.string().describe(
    'Task or question to send to the Codex AI agent. ' +
    'Works best for coding tasks, file operations, and technical analysis.',
  ),
  model: z.string().optional().describe(
    'OpenAI model to use, e.g. "o3", "gpt-5-codex". ' +
    'Omit to use the configured default (CODEX_MODEL env var or Codex default).',
  ),
  approval_mode: z.enum(['never', 'on-request']).default('never').describe(
    '"never": runs all commands without pausing (non-interactive, default). ' +
    '"on-request": pauses for approval before shell commands — not suitable for automation.',
  ),
  timeout_seconds: z.number().min(10).max(600).default(120).describe(
    'Max seconds to wait. Codex tasks can take longer than Gemini — 120s default.',
  ),
});

// --- Handler ---

export async function handleCodexRun(
  args: {
    prompt: string;
    model?: string;
    approval_mode: 'never' | 'on-request';
    timeout_seconds: number;
  },
  config: Config,
) {
  const model = args.model ?? config.codexModel;
  const cliArgs = ['exec', args.prompt, '--approval-mode', args.approval_mode];
  if (model) cliArgs.push('--model', model);

  let response: string;
  try {
    response = await spawnLocal('codex', cliArgs, args.timeout_seconds * 1000);
  } catch (err) {
    return {
      success: false,
      error: String(err),
      hint: 'Run `codex login` to authenticate, or check `codex --version` to confirm the CLI is installed.',
    };
  }

  return {
    success: true,
    response: response.trim(),
    model: model ?? 'default',
    approval_mode: args.approval_mode,
  };
}
