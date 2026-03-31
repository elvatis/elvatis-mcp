/**
 * system_status — single health check across all connected services.
 *
 * Pings Home Assistant, OpenClaw (SSH), local LLM, and reports connectivity
 * for Gemini and Codex CLIs. Returns a unified status overview.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';
import { spawnLocal } from '../spawn.js';

export const systemStatusSchema = z.object({});

interface ServiceStatus {
  service: string;
  status: 'ok' | 'error' | 'unconfigured';
  detail?: string;
  latency_ms?: number;
}

function toSshCfg(config: Config): SshConfig {
  return { host: config.sshHost, port: config.sshPort, username: config.sshUser, keyPath: config.sshKeyPath };
}

async function checkService(name: string, fn: () => Promise<string>): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { service: name, status: 'ok', detail, latency_ms: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { service: name, status: 'error', detail: msg.substring(0, 200), latency_ms: Date.now() - start };
  }
}

export async function handleSystemStatus(_args: Record<string, never>, config: Config) {
  const checks = await Promise.all([
    // Home Assistant
    checkService('home_assistant', async () => {
      if (!config.haToken) return 'unconfigured (no HA_TOKEN)';
      const res = await fetch(`${config.haUrl}/api/`, {
        headers: { Authorization: `Bearer ${config.haToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { message?: string };
      return data.message ?? 'connected';
    }),

    // OpenClaw SSH
    checkService('openclaw_ssh', async () => {
      const out = await sshExec(toSshCfg(config), 'echo ok && openclaw --version 2>/dev/null || echo "openclaw CLI not found"', 10000);
      return out.trim();
    }),

    // Local LLM
    checkService('local_llm', async () => {
      const endpoint = config.localLlmEndpoint ?? 'http://localhost:1234/v1';
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data?: Array<{ id: string }> };
      const models = data.data?.map(m => m.id) ?? [];
      return `${models.length} model(s) loaded: ${models.join(', ')}`;
    }),

    // Gemini CLI
    checkService('gemini_cli', async () => {
      const out = await spawnLocal('gemini', ['--version'], 5000);
      return out.trim();
    }),

    // Codex CLI
    checkService('codex_cli', async () => {
      const out = await spawnLocal('codex', ['--version'], 5000);
      return out.trim();
    }),
  ]);

  // Mark unconfigured services
  for (const c of checks) {
    if (c.detail?.includes('unconfigured')) c.status = 'unconfigured';
  }

  const ok = checks.filter(c => c.status === 'ok').length;
  const total = checks.length;

  return {
    summary: `${ok}/${total} services healthy`,
    services: checks,
  };
}
