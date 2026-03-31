/**
 * Configuration for elvatis-mcp.
 * All values are loaded from environment variables.
 * Copy .env.example to .env and fill in your values.
 */

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key} (copy .env.example to .env)`);
  return val;
}

function optional(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

export interface Config {
  /** OpenClaw Gateway URL (tunneled locally, e.g. http://localhost:18789) */
  gatewayUrl: string;
  /** Optional API key / Bearer token for the Gateway */
  gatewayToken?: string;
  /** Home Assistant base URL */
  haUrl: string;
  /** Home Assistant long-lived access token */
  haToken?: string;
  /** Transport: "stdio" (default, for Claude Desktop) or "http" */
  transport: 'stdio' | 'http';
  /** HTTP port when transport=http */
  httpPort: number;
  // --- SSH config (cron, memory, openclaw tools) ---
  /** OpenClaw server host for SSH */
  sshHost: string;
  /** SSH port */
  sshPort: number;
  /** SSH username on the OpenClaw server */
  sshUser: string;
  /** Path to SSH private key (~/ is expanded) */
  sshKeyPath: string;
  /** Optional: override the default OpenClaw agent name for openclaw_run */
  openclawDefaultAgent?: string;
  // --- Gemini CLI (local, uses `gemini` binary + cached Google auth) ---
  /** Default Gemini model, e.g. "gemini-2.5-flash" or "gemini-2.5-pro" */
  geminiModel?: string;
  // --- Codex CLI (local, uses `codex` binary + cached OpenAI auth) ---
  /** Default Codex model, e.g. "o3" or "gpt-5-codex" */
  codexModel?: string;
}

export function loadConfig(): Config {
  return {
    // Home Assistant (required)
    haUrl: required('HA_URL'),
    haToken: optional('HA_TOKEN'),
    // OpenClaw gateway (optional, only needed for WebSocket features)
    gatewayUrl: optional('OPENCLAW_GATEWAY_URL', 'http://localhost:18789')!,
    gatewayToken: optional('OPENCLAW_GATEWAY_TOKEN'),
    // Transport
    transport: (process.env['MCP_TRANSPORT'] as 'stdio' | 'http') ?? 'stdio',
    httpPort: parseInt(process.env['MCP_HTTP_PORT'] ?? '3333', 10),
    // SSH (required for cron, memory, openclaw tools)
    sshHost: required('SSH_HOST'),
    sshPort: parseInt(process.env['SSH_PORT'] ?? '22', 10),
    sshUser: optional('SSH_USER', 'chef-linux')!,
    sshKeyPath: optional('SSH_KEY_PATH', '~/.ssh/openclaw_tunnel')!,
    // Optional: specify a named agent for openclaw_run (default: uses OpenClaw's default agent)
    openclawDefaultAgent: optional('OPENCLAW_DEFAULT_AGENT'),
    // Gemini CLI
    geminiModel: optional('GEMINI_MODEL'),
    // Codex CLI
    codexModel: optional('CODEX_MODEL'),
  };
}
