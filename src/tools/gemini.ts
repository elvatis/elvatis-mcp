/**
 * Gemini sub-agent tool.
 *
 * Uses the @google/gemini-cli package in headless mode with session resume:
 *   echo "<prompt>" | gemini -p "" --model <model> --resume <uuid> --approval-mode yolo
 *
 * Gemini creates a new session when --resume is passed with an unknown UUID,
 * so we always pass --resume (using our generated UUID) -- no separate
 * "first request" path needed.
 *
 * Authentication: the CLI uses locally cached Google credentials
 * (from `gemini auth login`). No API key env var required.
 *
 * Use cases vs openclaw_run:
 *   - Direct, fast Gemini call with no OpenClaw overhead
 *   - Works even when the OpenClaw server is unreachable
 *   - Gemini-specific capabilities: 1M token context, multimodal, etc.
 *   - Second opinion / cross-validation of an openclaw_run result
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { spawnLocal } from '../spawn.js';
import { getOrCreateSession, recordSuccess, invalidateSession } from '../session-registry.js';

// --- Schemas ---

export const geminiRunSchema = z.object({
  prompt: z.string().describe(
    'Prompt or question to send to the Gemini AI model.',
  ),
  model: z.string().optional().describe(
    'Gemini model to use, e.g. "gemini-2.5-pro" or "gemini-2.5-flash". ' +
    'Omit to use the configured default (GEMINI_MODEL env var).',
  ),
  timeout_seconds: z.number().min(5).max(300).default(60).describe(
    'Max seconds to wait for a response.',
  ),
  working_directory: z.string().optional().describe(
    'Working directory for the Gemini process. Set this to the project root so Gemini can read local files. Defaults to the user home directory.',
  ),
});

// --- Handler ---

export async function handleGeminiRun(
  args: { prompt: string; model?: string; timeout_seconds: number; working_directory?: string },
  config: Config,
) {
  const model = args.model ?? config.geminiModel ?? 'gemini-2.5-flash';
  const session = getOrCreateSession('gemini', model);

  // Gemini creates a new session when --resume is given an unknown UUID,
  // so --resume is always used (no --session-id equivalent needed).
  const cliArgs = [
    '-p', '',
    '--output-format', 'json',
    '--resume', session.sessionId,
    '--approval-mode', 'yolo',
  ];
  if (model) cliArgs.push('--model', model);

  let raw: string;
  try {
    raw = await spawnLocal('gemini', cliArgs, args.timeout_seconds * 1000, args.working_directory, args.prompt);
  } catch (err) {
    const errMsg = String(err);
    if (errMsg.includes('session not found') || errMsg.includes('not found')) {
      invalidateSession('gemini', model);
    }
    return {
      success: false,
      error: errMsg,
      hint: 'Run `gemini auth login` to authenticate, or check `gemini --version` to confirm the CLI is installed.',
    };
  }

  // Parse the JSON envelope and extract the response text
  try {
    const parsed = JSON.parse(raw.trim()) as {
      response: string | null;
      stats?: Record<string, unknown>;
      error?: { message: string } | null;
    };

    if (parsed.error) {
      return { success: false, error: parsed.error.message, raw };
    }

    recordSuccess('gemini', model);
    return {
      success: true,
      response: parsed.response ?? '(empty response)',
      model,
      stats: parsed.stats,
      session_id: session.sessionId,
    };
  } catch {
    // CLI returned plain text instead of JSON (can happen with some versions)
    recordSuccess('gemini', model);
    return {
      success: true,
      response: raw.trim(),
      model,
      note: 'Response was plain text, not JSON — consider upgrading @google/gemini-cli',
      session_id: session.sessionId,
    };
  }
}
