/**
 * openclaw_notify — send notifications via OpenClaw channels (WhatsApp, Telegram, etc.)
 *
 * Uses `openclaw message send` to deliver messages through configured channels.
 * WhatsApp is the primary channel (loaded by default on the server).
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';

export const openclawNotifySchema = z.object({
  message: z.string().describe(
    'The message to send.',
  ),
  channel: z.enum(['whatsapp', 'telegram', 'last']).default('last').describe(
    'Channel to send through: "whatsapp", "telegram", or "last" (most recently used channel).',
  ),
  target: z.string().optional().describe(
    'Delivery target: phone number (E.164 format, e.g. "+491234567890") for WhatsApp, '
    + 'chat ID for Telegram. Omit to send to the default/last conversation.',
  ),
});

function toSshCfg(config: Config): SshConfig {
  return { host: config.sshHost, port: config.sshPort, username: config.sshUser, keyPath: config.sshKeyPath };
}

export async function handleOpenclawNotify(
  args: { message: string; channel: string; target?: string },
  config: Config,
) {
  const cfg = toSshCfg(config);

  // Build the openclaw message send command
  const escapedMsg = args.message.replace(/'/g, "'\\''");
  const parts = [
    'openclaw', 'message', 'send',
    '--channel', args.channel,
    '--message', `'${escapedMsg}'`,
  ];

  if (args.target) {
    parts.push('--target', `'${args.target.replace(/'/g, "'\\''")}'`);
  }

  parts.push('--json');

  const cmd = parts.join(' ');

  try {
    const output = await sshExec(cfg, cmd, 30000);

    // Try to parse JSON response
    try {
      const result = JSON.parse(output.trim());
      return {
        success: true,
        channel: args.channel,
        target: args.target ?? 'default',
        detail: result,
      };
    } catch {
      // Non-JSON output (older OpenClaw versions)
      return {
        success: true,
        channel: args.channel,
        target: args.target ?? 'default',
        response: output.trim(),
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: msg,
      hint: args.channel === 'whatsapp'
        ? 'Ensure WhatsApp is linked: `openclaw channels login` on the server.'
        : 'Check channel status: `openclaw status` on the server.',
    };
  }
}
