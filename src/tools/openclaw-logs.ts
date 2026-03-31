/**
 * openclaw_logs — view recent logs from the OpenClaw server via SSH.
 *
 * Reads systemd journal, OpenClaw workspace logs, or arbitrary log files.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';

export const openclawLogsSchema = z.object({
  source: z.enum(['gateway', 'agent', 'system', 'custom']).default('gateway').describe(
    'Log source: "gateway" (OpenClaw gateway), "agent" (last agent run), '
    + '"system" (systemd journal), "custom" (specify path).',
  ),
  lines: z.number().min(1).max(500).default(50).describe(
    'Number of log lines to return (default: 50).',
  ),
  filter: z.string().optional().describe(
    'Filter log lines by keyword (grep -i). Only lines matching this pattern are returned.',
  ),
  path: z.string().optional().describe(
    'Custom log file path on the server (only used when source="custom").',
  ),
});

function toSshCfg(config: Config): SshConfig {
  return { host: config.sshHost, port: config.sshPort, username: config.sshUser, keyPath: config.sshKeyPath };
}

export async function handleOpenclawLogs(
  args: { source: string; lines: number; filter?: string; path?: string },
  config: Config,
) {
  const cfg = toSshCfg(config);
  const grepPipe = args.filter
    ? ` | grep -i '${args.filter.replace(/'/g, "'\\''")}'`
    : '';

  let cmd: string;
  switch (args.source) {
    case 'gateway':
      // OpenClaw gateway logs (try journalctl first, fall back to log file)
      cmd = `journalctl -u openclaw-gateway --no-pager -n ${args.lines} 2>/dev/null${grepPipe}`
        + ` || tail -n ${args.lines} ~/.openclaw/logs/gateway.log 2>/dev/null${grepPipe}`
        + ` || echo "No gateway logs found (checked journalctl and ~/.openclaw/logs/gateway.log)"`;
      break;

    case 'agent':
      // Last agent execution log
      cmd = `tail -n ${args.lines} ~/.openclaw/logs/agent.log 2>/dev/null${grepPipe}`
        + ` || ls -t ~/.openclaw/logs/agent*.log 2>/dev/null | head -1 | xargs tail -n ${args.lines} 2>/dev/null${grepPipe}`
        + ` || echo "No agent logs found"`;
      break;

    case 'system':
      // General system journal (recent entries)
      cmd = `journalctl --no-pager -n ${args.lines} --priority=err..warning 2>/dev/null${grepPipe}`
        + ` || dmesg | tail -n ${args.lines} 2>/dev/null${grepPipe}`
        + ` || echo "No system logs available (journalctl and dmesg both failed)"`;
      break;

    case 'custom':
      if (!args.path) {
        return { success: false, error: '"path" is required when source is "custom"' };
      }
      cmd = `tail -n ${args.lines} '${args.path.replace(/'/g, "'\\''")}'${grepPipe} 2>&1`;
      break;

    default:
      return { success: false, error: `Unknown source: ${args.source}` };
  }

  try {
    const output = await sshExec(cfg, cmd, 15000);
    const lines = output.trim().split('\n').filter(Boolean);
    return {
      success: true,
      source: args.source,
      line_count: lines.length,
      logs: output.trim(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
