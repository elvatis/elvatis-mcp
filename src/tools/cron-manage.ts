/**
 * openclaw_cron_create / openclaw_cron_edit / openclaw_cron_delete — full cron lifecycle.
 *
 * Extends the existing cron tools (list, run, status) with create, edit, and delete.
 * Uses the OpenClaw CLI `openclaw cron add|edit|rm` commands via SSH.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';

// --- Schemas ---

export const cronCreateSchema = z.object({
  name: z.string().describe('Job name (e.g. "daily-portfolio-check")'),
  message: z.string().describe('The prompt/message the agent will execute on each run.'),
  schedule: z.string().describe(
    'When to run. Accepts:\n'
    + '  cron expression: "0 9 * * *" (daily at 9am)\n'
    + '  interval: "every 30m", "every 6h"\n'
    + '  one-shot: "at 2026-04-01T14:00:00" or "+20m" (in 20 minutes)',
  ),
  model: z.string().optional().describe(
    'Model override (e.g. "openai-codex/gpt-5.2", "google-gemini-cli/gemini-2.5-flash"). '
    + 'Omit to use the server default.',
  ),
  channel: z.string().optional().describe(
    'Delivery channel for results: "whatsapp", "telegram", "last". Omit for no delivery.',
  ),
  target: z.string().optional().describe(
    'Delivery target (phone number or chat ID). Only used with channel.',
  ),
  timezone: z.string().optional().describe(
    'IANA timezone for cron expressions (e.g. "Europe/Berlin"). Omit for server default.',
  ),
  disabled: z.boolean().optional().describe(
    'Create the job in disabled state (default: false, job starts immediately).',
  ),
});

export const cronEditSchema = z.object({
  id: z.string().describe('Job ID (UUID) to edit.'),
  name: z.string().optional().describe('New job name.'),
  message: z.string().optional().describe('New agent message.'),
  schedule: z.string().optional().describe('New schedule (cron expression, interval, or one-shot).'),
  model: z.string().optional().describe('New model override.'),
});

export const cronDeleteSchema = z.object({
  id: z.string().describe('Job ID (UUID) to delete.'),
});

export const cronHistorySchema = z.object({
  id: z.string().describe('Job ID (UUID) to show history for. Use openclaw_cron_list to find IDs.'),
  lines: z.number().min(1).max(100).default(20).describe('Number of recent runs to show.'),
});

// --- Helpers ---

function toSshCfg(config: Config): SshConfig {
  return { host: config.sshHost, port: config.sshPort, username: config.sshUser, keyPath: config.sshKeyPath };
}

function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}

// --- Handlers ---

export async function handleCronCreate(
  args: {
    name: string;
    message: string;
    schedule: string;
    model?: string;
    channel?: string;
    target?: string;
    timezone?: string;
    disabled?: boolean;
  },
  config: Config,
) {
  const cfg = toSshCfg(config);

  const parts = ['openclaw', 'cron', 'add'];
  parts.push('--name', `'${escapeShell(args.name)}'`);
  parts.push('--message', `'${escapeShell(args.message)}'`);

  // Parse schedule type
  if (args.schedule.startsWith('every ') || args.schedule.startsWith('every ')) {
    parts.push('--every', args.schedule.replace(/^every\s+/, ''));
  } else if (args.schedule.startsWith('at ') || args.schedule.startsWith('+')) {
    parts.push('--at', args.schedule.replace(/^at\s+/, ''));
  } else {
    parts.push('--cron', `'${escapeShell(args.schedule)}'`);
  }

  if (args.model) parts.push('--model', `'${escapeShell(args.model)}'`);
  if (args.channel) {
    parts.push('--channel', args.channel);
    parts.push('--announce');
  }
  if (args.target) parts.push('--to', `'${escapeShell(args.target)}'`);
  if (args.timezone) parts.push('--tz', `'${escapeShell(args.timezone)}'`);
  if (args.disabled) parts.push('--disabled');
  parts.push('--json');

  try {
    const output = await sshExec(cfg, parts.join(' '), 15000);
    try {
      const result = JSON.parse(output.trim());
      return { success: true, action: 'created', job: result };
    } catch {
      return { success: true, action: 'created', response: output.trim() };
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleCronEdit(
  args: { id: string; name?: string; message?: string; schedule?: string; model?: string },
  config: Config,
) {
  const cfg = toSshCfg(config);

  const parts = ['openclaw', 'cron', 'edit', args.id];
  if (args.name) parts.push('--name', `'${escapeShell(args.name)}'`);
  if (args.message) parts.push('--message', `'${escapeShell(args.message)}'`);
  if (args.schedule) parts.push('--cron', `'${escapeShell(args.schedule)}'`);
  if (args.model) parts.push('--model', `'${escapeShell(args.model)}'`);
  parts.push('--json');

  try {
    const output = await sshExec(cfg, parts.join(' '), 15000);
    try {
      return { success: true, action: 'edited', job: JSON.parse(output.trim()) };
    } catch {
      return { success: true, action: 'edited', response: output.trim() };
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleCronDelete(
  args: { id: string },
  config: Config,
) {
  const cfg = toSshCfg(config);
  try {
    const output = await sshExec(cfg, `openclaw cron rm ${args.id} --json 2>&1`, 15000);
    return { success: true, action: 'deleted', id: args.id, response: output.trim() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleCronHistory(
  args: { id?: string; lines: number },
  config: Config,
) {
  const cfg = toSshCfg(config);
  if (!args.id) {
    return {
      success: false,
      error: 'Job ID is required for cron history. Use openclaw_cron_list to find job IDs.',
    };
  }
  const cmd = `openclaw cron runs --id ${args.id} --limit ${args.lines} --json 2>&1`;

  try {
    const output = await sshExec(cfg, cmd, 15000);
    try {
      return { success: true, runs: JSON.parse(output.trim()) };
    } catch {
      return { success: true, raw: output.trim() };
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
