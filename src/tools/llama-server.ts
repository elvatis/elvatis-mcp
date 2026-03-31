/**
 * llama_server — manage a local llama.cpp server instance.
 *
 * Start, stop, and configure a llama.cpp / llama-server process with
 * specific model paths, cache types (including TurboQuant formats),
 * GPU layers, context size, and port. Runs alongside LM Studio on a
 * different port.
 *
 * The started process is tracked in memory and can be stopped later.
 * This is NOT the same as LM Studio; it directly runs the llama-server
 * binary which supports advanced features like custom KV cache formats.
 */

import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';

// --- Schema ---

export const llamaServerSchema = z.object({
  action: z.enum(['start', 'stop', 'status']).describe(
    '"start" launches a llama-server process, "stop" kills it, "status" shows if running.',
  ),
  model_path: z.string().optional().describe(
    'Path to GGUF model file. Required for "start".',
  ),
  port: z.number().min(1024).max(65535).default(8082).describe(
    'Port to run the server on (default: 8082, avoids conflict with LM Studio on 1234).',
  ),
  gpu_layers: z.number().min(0).default(0).describe(
    'Number of layers to offload to GPU (0 = CPU only). Use -1 for all layers.',
  ),
  context_size: z.number().min(512).default(4096).describe(
    'Context window size in tokens (default: 4096).',
  ),
  cache_type_k: z.string().optional().describe(
    'KV cache type for keys. Options: q8_0, q4_0, f16, turbo2, turbo3, turbo4 (TurboQuant fork). Default: f16.',
  ),
  cache_type_v: z.string().optional().describe(
    'KV cache type for values. Same options as cache_type_k. Asymmetric config (e.g. q8_0 keys + turbo4 values) often gives best results.',
  ),
  flash_attention: z.boolean().default(false).describe(
    'Enable flash attention (-fa). Recommended for long contexts.',
  ),
  extra_args: z.array(z.string()).optional().describe(
    'Additional CLI arguments to pass to llama-server (e.g. ["--threads", "8"]).',
  ),
});

// --- Process tracking ---

let activeProcess: ChildProcess | null = null;
let activeConfig: {
  port: number;
  model_path: string;
  pid: number;
  started_at: string;
} | null = null;

// --- Handler ---

export async function handleLlamaServer(
  args: {
    action: string;
    model_path?: string;
    port: number;
    gpu_layers: number;
    context_size: number;
    cache_type_k?: string;
    cache_type_v?: string;
    flash_attention: boolean;
    extra_args?: string[];
  },
) {
  switch (args.action) {
    case 'status': {
      if (!activeProcess || activeProcess.killed) {
        return { running: false, message: 'No llama-server process is running.' };
      }
      return {
        running: true,
        pid: activeConfig?.pid,
        port: activeConfig?.port,
        model: activeConfig?.model_path,
        started_at: activeConfig?.started_at,
        endpoint: `http://localhost:${activeConfig?.port}/v1`,
      };
    }

    case 'stop': {
      if (!activeProcess || activeProcess.killed) {
        return { success: false, error: 'No llama-server process is running.' };
      }
      const pid = activeProcess.pid;
      activeProcess.kill('SIGTERM');
      activeProcess = null;
      activeConfig = null;
      return { success: true, message: `llama-server (PID ${pid}) stopped.` };
    }

    case 'start': {
      if (activeProcess && !activeProcess.killed) {
        return {
          success: false,
          error: `llama-server is already running on port ${activeConfig?.port} (PID ${activeConfig?.pid}). Stop it first.`,
        };
      }

      if (!args.model_path) {
        return { success: false, error: '"model_path" is required for start.' };
      }

      // Build llama-server arguments
      const cliArgs = [
        '-m', args.model_path,
        '-c', String(args.context_size),
        '-ngl', String(args.gpu_layers),
        '--port', String(args.port),
        '-np', '1', // single parallel slot
      ];

      if (args.cache_type_k) cliArgs.push('--cache-type-k', args.cache_type_k);
      if (args.cache_type_v) cliArgs.push('--cache-type-v', args.cache_type_v);
      if (args.flash_attention) cliArgs.push('-fa', 'on');
      if (args.extra_args) cliArgs.push(...args.extra_args);

      // Try to find the llama-server binary
      const bin = 'llama-server';

      try {
        const proc = spawn(bin, cliArgs, {
          shell: process.platform === 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });

        // Wait briefly to see if it crashes immediately
        const startResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          let stderr = '';
          const earlyExit = (code: number | null) => {
            resolve({
              success: false,
              error: `llama-server exited immediately (code ${code}): ${stderr.substring(0, 500)}`,
            });
          };

          proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
          proc.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
              resolve({
                success: false,
                error: 'llama-server binary not found. Install llama.cpp and ensure llama-server is on PATH.',
              });
            } else {
              resolve({ success: false, error: String(err) });
            }
          });
          proc.on('close', earlyExit);

          // If it's still running after 2 seconds, consider it started
          setTimeout(() => {
            proc.removeListener('close', earlyExit);
            resolve({ success: true });
          }, 2000);
        });

        if (!startResult.success) {
          return startResult;
        }

        activeProcess = proc;
        activeConfig = {
          port: args.port,
          model_path: args.model_path,
          pid: proc.pid!,
          started_at: new Date().toISOString(),
        };

        // Log process output to stderr for debugging
        proc.stdout?.on('data', (d: Buffer) => {
          process.stderr.write(`[llama-server] ${d.toString()}`);
        });
        proc.stderr?.on('data', (d: Buffer) => {
          process.stderr.write(`[llama-server] ${d.toString()}`);
        });
        proc.on('close', (code) => {
          process.stderr.write(`[llama-server] Process exited (code ${code})\n`);
          if (activeProcess === proc) {
            activeProcess = null;
            activeConfig = null;
          }
        });

        return {
          success: true,
          pid: proc.pid,
          port: args.port,
          model: args.model_path,
          endpoint: `http://localhost:${args.port}/v1`,
          cache: {
            keys: args.cache_type_k ?? 'f16 (default)',
            values: args.cache_type_v ?? 'f16 (default)',
          },
          context_size: args.context_size,
          gpu_layers: args.gpu_layers,
          hint: `Use local_llm_run with endpoint "http://localhost:${args.port}/v1" to query this server.`,
        };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    default:
      return { success: false, error: `Unknown action: ${args.action}` };
  }
}
