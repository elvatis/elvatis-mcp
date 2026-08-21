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

/**
 * The command openclaw_logs would run, as a pure function so a test can read it.
 *
 * Two caller values land in an OPERAND position here, where the receiving
 * program parses a leading hyphen as an option regardless of the quoting the
 * shell already removed:
 *
 *   - `filter` is grep's PATTERN. `-e` names it as the pattern explicitly, so
 *     `--file=/etc/shadow` is searched for rather than acted on.
 *   - `path` is tail's FILE. `--` ends tail's options, so a path is a path.
 *     Without it `-f` turns a log read into a follow that returns nothing and
 *     holds the SSH connection open until the timeout kills it.
 *
 * Neither value is narrowed. A search term and a path are legitimately
 * free-form, and an allow-list on either one would reject real input while
 * still leaving the option grammar reachable from whatever it did admit.
 *
 * Throws for an unusable request (custom source with no path, unknown source);
 * the caller turns that into the tool's error shape.
 */
export function buildLogsCommand(
  args: { source: string; lines: number; filter?: string; path?: string },
): string {
  const grepPipe = args.filter
    ? ` | grep -i -e '${args.filter.replace(/'/g, "'\\''")}'`
    : '';

  switch (args.source) {
    case 'gateway':
      // OpenClaw gateway logs (try journalctl first, fall back to log file)
      return `journalctl -u openclaw-gateway --no-pager -n ${args.lines} 2>/dev/null${grepPipe}`
        + ` || tail -n ${args.lines} ~/.openclaw/logs/gateway.log 2>/dev/null${grepPipe}`
        + ` || echo "No gateway logs found (checked journalctl and ~/.openclaw/logs/gateway.log)"`;

    case 'agent':
      // Last agent execution log
      return `tail -n ${args.lines} ~/.openclaw/logs/agent.log 2>/dev/null${grepPipe}`
        + ` || ls -t ~/.openclaw/logs/agent*.log 2>/dev/null | head -1 | xargs tail -n ${args.lines} 2>/dev/null${grepPipe}`
        + ` || echo "No agent logs found"`;

    case 'system':
      // General system journal (recent entries)
      return `journalctl --no-pager -n ${args.lines} --priority=err..warning 2>/dev/null${grepPipe}`
        + ` || dmesg | tail -n ${args.lines} 2>/dev/null${grepPipe}`
        + ` || echo "No system logs available (journalctl and dmesg both failed)"`;

    case 'custom':
      if (!args.path) {
        throw new Error('"path" is required when source is "custom"');
      }
      return `tail -n ${args.lines} -- '${args.path.replace(/'/g, "'\\''")}'${grepPipe} 2>&1`;

    default:
      throw new Error(`Unknown source: ${args.source}`);
  }
}

export async function handleOpenclawLogs(
  args: { source: string; lines: number; filter?: string; path?: string },
  config: Config,
) {
  const cfg = toSshCfg(config);

  let cmd: string;
  try {
    cmd = buildLogsCommand(args);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
