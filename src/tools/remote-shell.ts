/**
 * remote_shell: run shell commands on any configured Linux server via SSH.
 *
 * Separate from the OpenClaw SSH tools so any Linux server can be targeted
 * independently. Configure via REMOTE_HOST, REMOTE_USER, REMOTE_PORT,
 * REMOTE_KEY_PATH env vars.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';

// --- Schema ---

export const remoteShellSchema = z.object({
  command: z.string().describe('Shell command to run on the remote server'),
  timeout_seconds: z.number().min(1).max(300).default(30).describe('Timeout in seconds (default: 30, max: 300)'),
});

// --- Helpers ---

export function toRemoteSshCfg(config: Config): SshConfig {
  if (!config.remoteHost) {
    throw new Error('REMOTE_HOST is not configured. Add it to your .env file.');
  }
  return {
    host: config.remoteHost,
    port: config.remotePort,
    username: config.remoteUser,
    keyPath: config.remoteKeyPath,
  };
}

// --- Handler ---

export async function handleRemoteShell(
  args: z.infer<typeof remoteShellSchema>,
  config: Config,
): Promise<{ success: boolean; output?: string; error?: string; host: string }> {
  const cfg = toRemoteSshCfg(config);
  try {
    const output = await sshExec(cfg, args.command, args.timeout_seconds * 1000);
    return { success: true, output: output.trimEnd(), host: cfg.host };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      host: cfg.host,
    };
  }
}
