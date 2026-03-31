#!/usr/bin/env node
/**
 * elvatis-mcp — MCP server exposing OpenClaw tools to Claude Desktop, Cursor, Windsurf, and any MCP client.
 *
 * Supported transports:
 *   stdio (default)  — for Claude Desktop / local clients
 *   http             — for remote/network clients (set MCP_TRANSPORT=http)
 *
 * Usage:
 *   npx @elvatis_com/elvatis-mcp
 *   MCP_TRANSPORT=http MCP_HTTP_PORT=3333 npx @elvatis_com/elvatis-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { homeTools } from './tools/home.js';
import { memoryTools } from './tools/memory.js';
import { cronTools } from './tools/cron.js';

async function main() {
  const config = loadConfig();

  const server = new McpServer({
    name: 'elvatis-mcp',
    version: '0.1.0',
  });

  // Register Home Assistant tools
  for (const tool of homeTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema.shape ?? tool.schema,
      async (args: Parameters<typeof tool.handler>[0]) => {
        const result = await (tool.handler as (a: typeof args, c: typeof config) => Promise<unknown>)(args, config);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );
  }

  // Register Memory tools
  for (const tool of memoryTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema.shape ?? tool.schema,
      async (args: Parameters<typeof tool.handler>[0]) => {
        const result = await (tool.handler as (a: typeof args) => Promise<unknown>)(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );
  }

  // Register Cron tools
  for (const tool of cronTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema.shape ?? tool.schema,
      async (args: Parameters<typeof tool.handler>[0]) => {
        const result = await (tool.handler as (a: typeof args, c: typeof config) => Promise<unknown>)(args, config);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }
    );
  }

  // Transport
  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stdio server runs silently — log to stderr so it doesn't pollute the MCP stream
    process.stderr.write('[elvatis-mcp] Running on stdio transport\n');
  } else {
    // HTTP transport (Streamable HTTP) for remote clients
    // Dynamically import to keep stdio builds lightweight
    const { createServer } = await import('http');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const httpServer = createServer(async (req, res) => {
      if (req.url === '/mcp') {
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(404);
        res.end('Not found — MCP endpoint is /mcp');
      }
    });

    await server.connect(transport);
    httpServer.listen(config.httpPort, () => {
      process.stderr.write(`[elvatis-mcp] Running on HTTP transport at http://localhost:${config.httpPort}/mcp\n`);
    });
  }
}

main().catch((err) => {
  process.stderr.write(`[elvatis-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});
