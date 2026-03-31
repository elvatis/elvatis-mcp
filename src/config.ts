/**
 * Configuration for elvatis-mcp.
 * All values can be overridden via environment variables.
 */
export interface Config {
  /** OpenClaw Gateway base URL, e.g. http://localhost:3000 */
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
}

export function loadConfig(): Config {
  return {
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? 'http://localhost:3000',
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    haUrl: process.env.HA_URL ?? 'http://192.168.178.44:8123',
    haToken: process.env.HA_TOKEN,
    transport: (process.env.MCP_TRANSPORT as 'stdio' | 'http') ?? 'stdio',
    httpPort: parseInt(process.env.MCP_HTTP_PORT ?? '3333', 10),
  };
}
