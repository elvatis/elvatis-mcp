/**
 * remote_service: manage systemd services on a remote Linux server via SSH.
 *
 * Wraps systemctl commands over SSH. Requires REMOTE_HOST to be configured.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec } from '../ssh.js';
import { toRemoteSshCfg } from './remote-shell.js';

// --- Schema ---

export const remoteServiceSchema = z.object({
  action: z.enum(['status', 'start', 'stop', 'restart', 'enable', 'disable', 'list'])
    .describe('systemctl action to perform'),
  service: z.string().optional()
    .describe('Service name, e.g. "nginx" or "postgresql" (required for all actions except list)'),
});

// --- Handler ---

export async function handleRemoteService(
  args: z.infer<typeof remoteServiceSchema>,
  config: Config,
): Promise<{ success: boolean; output?: string; error?: string; action: string; service?: string }> {
  const { action, service } = args;

  if (!config.remoteHost) {
    return { success: false, error: 'REMOTE_HOST is not configured. Add it to your .env file.', action };
  }
  if (action !== 'list' && !service) {
    return { success: false, error: `service is required for action "${action}"`, action };
  }

  const cfg = toRemoteSshCfg(config);

  // list: show all active services in a compact format
  // others: run systemctl with sudo (non-interactive, assumes NOPASSWD sudoers or root user)
  const cmd = action === 'list'
    ? 'systemctl list-units --type=service --state=active --no-pager --plain --no-legend | awk \'{print $1, $3, $4}\' | head -50'
    : `systemctl ${action} ${service} && systemctl status ${service} --no-pager --lines=5`;

  try {
    const output = await sshExec(cfg, cmd, 15_000);
    return { success: true, output: output.trimEnd(), action, service };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      action,
      service,
    };
  }
}
