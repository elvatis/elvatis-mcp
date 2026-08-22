/**
 * system_status - single health check across all connected services.
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

/**
 * Strip connection parameters out of a message that is about to leave this
 * process as an API response body.
 *
 * WHY THIS SITS HERE AND NOT IN ssh.ts. The messages in `src/ssh.ts` are
 * written for an operator reading a terminal, and they are good messages: a
 * timeout names the host, port, user and key path, and exit 255 adds a hint
 * naming the SSH_HOST, SSH_USER and SSH_KEY_PATH values, which is exactly what
 * someone debugging a broken key needs to see. Nothing is wrong with them until
 * the moment the same string becomes a field in a response served over HTTP.
 *
 * That moment is HERE. `detail` is serialised by the dashboard's `/status`,
 * `/` and `/api/status` routes (src/index.ts), which have no authentication.
 * The disclosure is conditional on the SSH check FAILING, which is precisely
 * the state an unconfigured or unreachable install is in - so the reachable
 * case and the leaking case are the same case.
 *
 * So the operator keeps the detailed message on stderr and in the thrown error,
 * and the value that crosses the boundary is redacted. The redaction is exact
 * substring replacement of values this process already holds, not a guess at
 * what a secret looks like: nothing here has to be right about an unknown
 * pattern, only about its own configuration.
 *
 * Ordering matters. Longer, more specific composites are replaced first, so
 * `user@host:port` does not survive as `[redacted]@host:port` after the host
 * alone was replaced.
 */
export function redactConnectionParams(msg: string, config: Config): string {
  const host = config.sshHost;
  const user = config.sshUser;
  const key = config.sshKeyPath;
  const port = String(config.sshPort ?? '');

  let out = msg;
  const replaceAll = (needle: string, token: string) => {
    if (!needle || needle.length < 2) return;
    out = out.split(needle).join(token);
  };

  // Composites first.
  if (user && host && port) replaceAll(`${user}@${host}:${port}`, '[ssh target redacted]');
  if (user && host) replaceAll(`${user}@${host}`, '[ssh target redacted]');
  if (host && port) replaceAll(`${host}:${port}`, '[ssh target redacted]');

  // Then the individual values.
  replaceAll(key, '[key path redacted]');
  replaceAll(host, '[host redacted]');
  replaceAll(user, '[user redacted]');

  return out;
}

async function checkService(
  name: string,
  fn: () => Promise<string>,
  config: Config,
): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { service: name, status: 'ok', detail, latency_ms: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Keep the full message for the operator, redact what crosses the boundary.
    process.stderr.write(`[system_status] ${name}: ${msg}\n`);
    const safe = redactConnectionParams(msg, config);
    return { service: name, status: 'error', detail: safe.substring(0, 200), latency_ms: Date.now() - start };
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
    }, config),

    // OpenClaw SSH
    checkService('openclaw_ssh', async () => {
      const out = await sshExec(toSshCfg(config), 'echo ok && openclaw --version 2>/dev/null || echo "openclaw CLI not found"', 10000);
      return out.trim();
    }, config),

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
    }, config),

    // Claude CLI
    checkService('claude_cli', async () => {
      const out = await spawnLocal('claude', ['--version'], 5000);
      return out.trim();
    }, config),

    // Gemini CLI (needs longer timeout: ~5s cold start on Windows)
    checkService('gemini_cli', async () => {
      const out = await spawnLocal('gemini', ['--version'], 10000);
      return out.trim();
    }, config),

    // Codex CLI
    checkService('codex_cli', async () => {
      const out = await spawnLocal('codex', ['--version'], 5000);
      return out.trim();
    }, config),
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
