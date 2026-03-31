/**
 * local_llm_models — list and manage models on the local LLM server.
 *
 * Works with any OpenAI-compatible server that exposes GET /v1/models.
 * LM Studio also supports POST /v1/models/load and POST /v1/models/unload
 * for switching models without opening the GUI.
 */

import { z } from 'zod';
import { Config } from '../config.js';

export const localLlmModelsSchema = z.object({
  action: z.enum(['list', 'load', 'unload']).default('list').describe(
    'Action: "list" shows available models, "load" loads a model, "unload" unloads a model. '
    + 'Load/unload requires LM Studio (not supported by all servers).',
  ),
  model: z.string().optional().describe(
    'Model identifier for load/unload (e.g. "microsoft/phi-4-mini-reasoning"). Required for load/unload.',
  ),
  endpoint: z.string().optional().describe(
    'Override the local LLM endpoint URL. Omit to use LOCAL_LLM_ENDPOINT env var or default.',
  ),
});

interface ModelInfo {
  id: string;
  owned_by?: string;
  [key: string]: unknown;
}

export async function handleLocalLlmModels(
  args: { action: string; model?: string; endpoint?: string },
  config: Config,
) {
  const endpoint = args.endpoint
    ?? config.localLlmEndpoint
    ?? 'http://localhost:1234/v1';
  const baseUrl = endpoint.replace(/\/+$/, '');

  if (args.action === 'list') {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/models`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Could not connect to local LLM at ${baseUrl}/models`,
        hint: 'Start your local LLM server (LM Studio, Ollama, llama.cpp).',
        detail: msg,
      };
    }

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${await res.text().catch(() => '')}` };
    }

    const data = await res.json() as { data?: ModelInfo[] };
    const models = data.data ?? [];

    return {
      success: true,
      endpoint: baseUrl,
      count: models.length,
      models: models.map(m => ({ id: m.id, owned_by: m.owned_by })),
    };
  }

  // Load / Unload (LM Studio specific)
  if (!args.model) {
    return { success: false, error: `"model" parameter is required for ${args.action}` };
  }

  const url = args.action === 'load'
    ? `${baseUrl}/models/load`
    : `${baseUrl}/models/unload`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: args.model }),
      signal: AbortSignal.timeout(60000), // loading a model can take a while
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED')) {
      return { success: false, error: 'Local LLM server not running.', hint: 'Start LM Studio.' };
    }
    return { success: false, error: msg };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 404 means the server doesn't support load/unload (not LM Studio)
    if (res.status === 404) {
      return {
        success: false,
        error: `${args.action} is not supported by this server.`,
        hint: 'Model load/unload requires LM Studio. Ollama uses "ollama run <model>" instead.',
      };
    }
    return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` };
  }

  const data = await res.json().catch(() => ({})) as Record<string, unknown>;

  return {
    success: true,
    action: args.action,
    model: args.model,
    detail: data,
  };
}
