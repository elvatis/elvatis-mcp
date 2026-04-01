/**
 * remote_docker: manage Docker containers on a remote Linux server via SSH.
 *
 * No Docker API or open port needed — wraps docker CLI commands over SSH.
 * Requires REMOTE_HOST to be configured (shared with remote_shell).
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec } from '../ssh.js';
import { toRemoteSshCfg } from './remote-shell.js';

// --- Schema ---

export const remoteDockerSchema = z.object({
  action: z.enum(['list', 'logs', 'start', 'stop', 'restart', 'stats', 'exec'])
    .describe('Action to perform'),
  container: z.string().optional()
    .describe('Container name or ID (required for all actions except list)'),
  command: z.string().optional()
    .describe('Shell command to run inside the container (required for exec)'),
  lines: z.number().min(1).max(1000).default(50)
    .describe('Number of log lines to tail (for logs action, default: 50)'),
});

// --- Handler ---

export async function handleRemoteDocker(
  args: z.infer<typeof remoteDockerSchema>,
  config: Config,
): Promise<{ success: boolean; output?: string; error?: string; action: string }> {
  const { action, container, command, lines } = args;

  if (!config.remoteHost) {
    return { success: false, error: 'REMOTE_HOST is not configured. Add it to your .env file.', action };
  }
  if (action !== 'list' && !container) {
    return { success: false, error: `container is required for action "${action}"`, action };
  }
  if (action === 'exec' && !command) {
    return { success: false, error: 'command is required for exec action', action };
  }

  const cfg = toRemoteSshCfg(config);

  const cmds: Record<string, string> = {
    list:    'docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"',
    logs:    `docker logs --tail ${lines} ${container}`,
    start:   `docker start ${container}`,
    stop:    `docker stop ${container}`,
    restart: `docker restart ${container}`,
    stats:   `docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}" ${container}`,
    exec:    `docker exec ${container} sh -c ${JSON.stringify(command ?? '')}`,
  };

  try {
    const output = await sshExec(cfg, cmds[action]!, 30_000);
    return { success: true, output: output.trimEnd(), action };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      action,
    };
  }
}
