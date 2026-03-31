/**
 * OpenClaw sub-agent orchestration tools.
 *
 * Architecture:
 *   Claude Desktop (MCP client)
 *     -> elvatis-mcp (this server)
 *       -> SSH to OpenClaw server
 *         -> openclaw CLI (runs task with all installed plugins)
 *           -> response streamed back
 *
 * This pattern avoids re-implementing OpenClaw's plugins in MCP.
 * Instead, we delegate to OpenClaw, which already has everything installed:
 * trading tools, custom workflows, WhatsApp integration, etc.
 *
 * Required env var on the server: OPENCLAW_CLI_CMD (default: "openclaw chat")
 * Adjust to match your OpenClaw installation's actual CLI syntax.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, sshReadFile, SshConfig } from '../ssh.js';

// --- Schemas ---

export const openclawRunSchema = z.object({
  prompt: z.string().describe('Task or question to send to the OpenClaw AI agent. It has access to all installed plugins (trading, home, memory, etc.).'),
  agent: z.string().optional().describe('Optional: name of a specific OpenClaw agent to use (e.g. "ops", "trading"). Omit to use the default agent.'),
  timeout_seconds: z.number().min(5).max(300).default(60).describe('Max seconds to wait for the agent response'),
});

export const openclawStatusSchema = z.object({});

export const openclawPluginsSchema = z.object({});

// --- Helpers ---

function toSshCfg(config: Config): SshConfig {
  return {
    host: config.sshHost,
    port: config.sshPort,
    username: config.sshUser,
    keyPath: config.sshKeyPath,
  };
}

// --- Handlers ---

/**
 * Run a prompt through the OpenClaw agent via SSH.
 *
 * Uses: openclaw agents send --message "<prompt>" --local --timeout <seconds>
 *   --local  : bypasses the WebSocket Gateway, runs the embedded runtime directly.
 *              Perfect for SSH-based calls — no gateway connection needed.
 *   --timeout: how long the CLI waits for the agent turn to complete.
 *
 * The agent has access to all installed plugins (trading, home, etc.)
 * and all configured LLM backends (claude, gpt, gemini).
 *
 * If this fails:
 *   1. Check `openclaw --version` on the server (agents send requires 0.x+)
 *   2. Check `openclaw doctor` for config issues
 *   3. Confirm the openclaw binary is on PATH: `which openclaw`
 */
export async function handleOpenclawRun(
  args: { prompt: string; agent?: string; timeout_seconds: number },
  config: Config,
) {
  const cfg = toSshCfg(config);
  // Escape double quotes in the prompt to prevent shell injection
  const safePrompt = args.prompt.replace(/"/g, '\\"');
  const agentName = args.agent ?? config.openclawDefaultAgent;
  const agentFlag = agentName ? ` --agent ${agentName}` : '';
  const cmd = `openclaw agents send --message "${safePrompt}"${agentFlag} --local --timeout ${args.timeout_seconds}`;

  try {
    const output = await sshExec(cfg, cmd, (args.timeout_seconds + 10) * 1000);
    return {
      success: true,
      response: output.trim(),
      agent: args.agent ?? 'default',
    };
  } catch (err) {
    return {
      success: false,
      error: String(err),
      hint: 'Check: `openclaw doctor` on the server, or try `openclaw agents send --help` for correct flags.',
    };
  }
}

/**
 * Get OpenClaw daemon status and basic info.
 */
export async function handleOpenclawStatus(_args: Record<string, never>, config: Config) {
  const cfg = toSshCfg(config);

  // Check if the openclaw process is running
  const processCheck = await sshExec(cfg, `pgrep -a openclaw 2>/dev/null || echo "(not found)"`).catch(() => '(ssh error)');
  // Get uptime info
  const uptime = await sshExec(cfg, 'uptime').catch(() => '(unavailable)');
  // Get OpenClaw version if available
  const version = await sshExec(cfg, 'openclaw --version 2>/dev/null || openclaw version 2>/dev/null || echo "(unknown)"').catch(() => '(unavailable)');

  return {
    process: processCheck.trim(),
    server_uptime: uptime.trim(),
    openclaw_version: version.trim(),
    ssh_host: config.sshHost,
    default_agent: config.openclawDefaultAgent ?? '(default)',
  };
}

/**
 * List installed OpenClaw plugins.
 * CLI: openclaw plugins list  (compact inventory)
 * For details on one plugin: openclaw plugins inspect <id>
 */
export async function handleOpenclawPlugins(_args: Record<string, never>, config: Config) {
  const cfg = toSshCfg(config);

  const [listOutput, statusOutput] = await Promise.all([
    sshExec(cfg, 'openclaw plugins list 2>&1').catch(err => `(error: ${err})`),
    sshExec(cfg, 'openclaw plugins status 2>&1').catch(() => ''),
  ]);

  return {
    list: listOutput.trim(),
    status: statusOutput.trim() || undefined,
    note: 'Use `openclaw plugins inspect <id>` for details on a specific plugin',
  };
}
