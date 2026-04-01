/**
 * Codex sub-agent tool.
 *
 * Uses the @openai/codex CLI in non-interactive mode:
 *   codex exec "<prompt>" --full-auto [--model <model>] [--json]
 *
 * Authentication: the CLI uses locally cached OpenAI credentials.
 * Run `codex` once interactively to authenticate.
 *
 * Sandbox modes:
 *   --full-auto:  workspace-write sandbox, no approval prompts (default, safe)
 *   --dangerously-bypass-approvals-and-sandbox: no sandbox, no prompts (dangerous)
 *
 * Output: codex streams JSONL events to stdout with --json flag.
 *   Final assistant message is extracted from event type "message".
 *   Without --json, last line of stdout is the final response.
 *
 * Also supports --oss for local providers (LM Studio, Ollama) via --local-provider.
 *
 * Use cases vs openclaw_run / gemini_run:
 *   - Coding tasks: refactoring, debugging, code generation
 *   - OpenAI model stack (o3, gpt-5-codex, etc.)
 *   - Long agentic tasks with file read/write and shell commands
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
  sandbox: z.enum(['full-auto', 'dangerous']).default('full-auto').describe(
    '"full-auto": workspace-write sandbox, no approval prompts (default, recommended). ' +
    '"dangerous": bypass all approvals and sandbox — only use in isolated environments.',
  ),
  timeout_seconds: z.number().min(10).max(600).default(120).describe(
    'Max seconds to wait. Codex tasks can take longer than Gemini — 120s default.',
  ),
  working_directory: z.string().optional().describe(
    'Working directory for the Codex process. Set this to the project root so Codex can read and write local files. Defaults to the user home directory.',
  ),
});

// --- JSONL event parser ---

interface CodexEvent {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string }> | string;
}

function extractResponseFromJsonl(raw: string): string {
  // Parse JSONL events and extract the assistant message text
  // Codex emits: item.completed (with item.text) and turn.completed (with usage)
  const lines = raw.trim().split('\n').filter(l => l.trim().startsWith('{'));
  const messages: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;

      // item.completed: { type: "item.completed", item: { type: "agent_message", text: "..." } }
      if (event['type'] === 'item.completed') {
        const item = event['item'] as Record<string, unknown> | undefined;
        if (item?.['text'] && typeof item['text'] === 'string') {
          messages.push(item['text']);
        }
      }

      // message event (older codex versions)
      if (event['type'] === 'message' && event['role'] === 'assistant') {
        const content = event['content'];
        if (typeof content === 'string') {
          messages.push(content);
        } else if (Array.isArray(content)) {
          for (const block of content as Array<{ type: string; text?: string }>) {
            if (block.type === 'text' && block.text) messages.push(block.text);
          }
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  if (messages.length > 0) return messages[messages.length - 1]!;

  // Fallback: return last non-empty line (skip JSONL noise)
  const nonJson = raw.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('{'));
  if (nonJson.length > 0) return nonJson[nonJson.length - 1]!;

  return raw.trim();
}

// --- Handler ---

export async function handleCodexRun(
  args: {
    prompt: string;
    model?: string;
    sandbox: 'full-auto' | 'dangerous';
    timeout_seconds: number;
    working_directory?: string;
  },
  config: Config,
) {
  const model = args.model ?? config.codexModel;

  const cliArgs = ['exec', args.prompt, '--json', '--ephemeral'];

  if (args.sandbox === 'dangerous') {
    cliArgs.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    cliArgs.push('--full-auto');
  }

  if (model) cliArgs.push('--model', model);

  let raw: string;
  try {
    raw = await spawnLocal('codex', cliArgs, args.timeout_seconds * 1000, args.working_directory);
  } catch (err) {
    return {
      success: false,
      error: String(err),
      hint: 'Run `codex` once to authenticate, or check `codex --version` to confirm the CLI is installed.',
    };
  }

  const response = extractResponseFromJsonl(raw);

  return {
    success: true,
    response,
    model: model ?? 'default',
    sandbox: args.sandbox,
  };
}
