/**
 * Local LLM sub-agent tool.
 *
 * Talks to any OpenAI-compatible local server:
 *   - LM Studio (default: http://localhost:1234/v1)
 *   - Ollama (http://localhost:11434/v1)
 *   - llama.cpp server (http://localhost:8080/v1)
 *   - Any server exposing POST /v1/chat/completions
 *
 * No API key required. No external dependencies (uses Node 18+ built-in fetch).
 *
 * Use cases:
 *   - Simple classification, formatting, extraction, rewriting
 *   - Free and private (no data leaves the machine)
 *   - Fast for small tasks (3B-8B models respond in 1-5 seconds)
 *   - Offload cheap work from paid APIs
 */

import { z } from 'zod';
import { Config } from '../config.js';

// --- Schema ---

export const localLlmRunSchema = z.object({
  prompt: z.string().describe(
    'Prompt or question to send to the local LLM.',
  ),
  system: z.string().optional().describe(
    'Optional system message to set the LLM\'s behavior.',
  ),
  model: z.string().optional().describe(
    'Model identifier as shown in LM Studio / Ollama (e.g. "deepseek-r1-0528-qwen3-8b", "phi-4-mini"). ' +
    'Omit to use the server\'s currently loaded model or LOCAL_LLM_MODEL env var.',
  ),
  endpoint: z.string().optional().describe(
    'Override the local LLM endpoint URL (e.g. "http://localhost:11434/v1" for Ollama). ' +
    'Omit to use LOCAL_LLM_ENDPOINT env var or default (http://localhost:1234/v1 for LM Studio).',
  ),
  temperature: z.number().min(0).max(2).optional().describe(
    'Sampling temperature (0 = deterministic, higher = more creative). Default: server default.',
  ),
  max_tokens: z.number().min(1).max(32768).optional().describe(
    'Maximum tokens to generate. Default: server default.',
  ),
  timeout_seconds: z.number().min(5).max(300).default(60).describe(
    'Max seconds to wait for a response.',
  ),
});

// --- Types ---

interface ChatCompletionResponse {
  id?: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  model?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// --- Handler ---

export async function handleLocalLlmRun(
  args: {
    prompt: string;
    system?: string;
    model?: string;
    endpoint?: string;
    temperature?: number;
    max_tokens?: number;
    timeout_seconds: number;
  },
  config: Config,
) {
  const endpoint = args.endpoint
    ?? config.localLlmEndpoint
    ?? 'http://localhost:1234/v1';
  const model = args.model ?? config.localLlmModel ?? '';
  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  const messages: Array<{ role: string; content: string }> = [];
  if (args.system) {
    messages.push({ role: 'system', content: args.system });
  }
  messages.push({ role: 'user', content: args.prompt });

  const body: Record<string, unknown> = { messages };
  if (model) body['model'] = model;
  if (args.temperature !== undefined) body['temperature'] = args.temperature;
  if (args.max_tokens !== undefined) body['max_tokens'] = args.max_tokens;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(args.timeout_seconds * 1000),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes('abort') || msg.includes('timeout');
    const isRefused = msg.includes('ECONNREFUSED') || msg.includes('fetch failed');

    if (isRefused) {
      return {
        success: false,
        error: `Could not connect to local LLM at ${url}`,
        hint: 'Start your local LLM server first:\n'
          + '  LM Studio: open the app, load a model, enable "Local Server"\n'
          + '  Ollama: run `ollama serve` then `ollama run <model>`\n'
          + '  llama.cpp: run `llama-server -m model.gguf --port 8080`',
      };
    }
    if (isTimeout) {
      return {
        success: false,
        error: `Local LLM timed out after ${args.timeout_seconds}s`,
        hint: 'The model may be too large for your hardware, or still loading. Try a smaller model or increase timeout_seconds.',
      };
    }
    return { success: false, error: msg };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      success: false,
      error: `Local LLM returned HTTP ${response.status}: ${text.substring(0, 500)}`,
    };
  }

  let data: ChatCompletionResponse;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    return {
      success: false,
      error: 'Local LLM returned invalid JSON. Check the server logs.',
    };
  }

  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content) {
    return {
      success: false,
      error: 'Local LLM returned an empty response.',
      raw: data,
    };
  }

  return {
    success: true,
    response: content,
    model: data.model ?? model ?? 'unknown',
    endpoint,
    finish_reason: data.choices[0]?.finish_reason,
    usage: data.usage,
  };
}
