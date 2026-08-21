/**
 * openclaw_cron_create / openclaw_cron_edit / openclaw_cron_delete — full cron lifecycle.
 *
 * Extends the existing cron tools (list, run, status) with create, edit, and delete.
 * Uses the OpenClaw CLI `openclaw cron add|edit|rm` commands via SSH.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';
import {
  validateScheduleValue,
  validateCronExpression,
  validateCronId,
  validateChannel,
} from '../validate.js';

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

export interface CronCreateArgs {
  name: string;
  message: string;
  schedule: string;
  model?: string;
  channel?: string;
  target?: string;
  timezone?: string;
  disabled?: boolean;
}

/**
 * The `openclaw cron add` command line, as a pure function so a test can read
 * the argv this tool would hand the remote CLI.
 *
 * All three schedule branches validate now. Two of them were fixed when
 * `--every` and `--at` turned out to accept a leading hyphen; the third was
 * not, and it is the branch every schedule that is neither "every ..." nor
 * "at ..." falls into. Leaving it would have moved the same value onto the
 * same command line under a different flag.
 *
 * Quoting is not what closes this. `--cron '--announce'` and `--cron
 * --announce` produce identical argv once the shell has removed the quotes;
 * the leading-character rule in the validator is the part that does the work,
 * and the quoting continues to answer the separate metacharacter question.
 *
 * Throws on an invalid value; the caller turns that into the tool's error shape.
 */
export function buildCronCreateCommand(args: CronCreateArgs): string {
  const parts = ['openclaw', 'cron', 'add'];
  parts.push('--name', `'${escapeShell(args.name)}'`);
  parts.push('--message', `'${escapeShell(args.message)}'`);

  if (args.schedule.startsWith('every ')) {
    const rawEvery = args.schedule.replace(/^every\s+/, '');
    parts.push('--every', `'${escapeShell(validateScheduleValue(rawEvery))}'`);
  } else if (args.schedule.startsWith('at ') || args.schedule.startsWith('+')) {
    const rawAt = args.schedule.replace(/^at\s+/, '');
    parts.push('--at', `'${escapeShell(validateScheduleValue(rawAt))}'`);
  } else {
    parts.push('--cron', `'${escapeShell(validateCronExpression(args.schedule))}'`);
  }

  if (args.model) parts.push('--model', `'${escapeShell(args.model)}'`);
  if (args.channel) {
    // Validated AND quoted, like every other value on this command line.
    parts.push('--channel', `'${escapeShell(validateChannel(args.channel))}'`);
    parts.push('--announce');
  }
  if (args.target) parts.push('--to', `'${escapeShell(args.target)}'`);
  if (args.timezone) parts.push('--tz', `'${escapeShell(args.timezone)}'`);
  if (args.disabled) parts.push('--disabled');
  parts.push('--json');

  return parts.join(' ');
}

export async function handleCronCreate(args: CronCreateArgs, config: Config) {
  const cfg = toSshCfg(config);

  let cmd: string;
  try {
    cmd = buildCronCreateCommand(args);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const output = await sshExec(cfg, cmd, 15000);
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

  let safeId: string;
  try {
    safeId = validateCronId(args.id);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  const parts = ['openclaw', 'cron', 'edit', safeId];
  if (args.name) parts.push('--name', `'${escapeShell(args.name)}'`);
  if (args.message) parts.push('--message', `'${escapeShell(args.message)}'`);
  if (args.schedule) {
    // Same flag, same hazard, same rule as the fall-through branch of create.
    try {
      parts.push('--cron', `'${escapeShell(validateCronExpression(args.schedule))}'`);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
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
  let safeId: string;
  try {
    safeId = validateCronId(args.id);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const output = await sshExec(cfg, `openclaw cron rm ${safeId} --json 2>&1`, 15000);
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
  let safeId: string;
  try {
    safeId = validateCronId(args.id);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  const cmd = `openclaw cron runs --id ${safeId} --limit ${args.lines} --json 2>&1`;

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
