#!/usr/bin/env node
/**
 * elvatis-mcp — MCP server exposing OpenClaw tools to Claude Desktop, Cursor, Windsurf, and any MCP client.
 *
 * Transports:
 *   stdio (default)  — for Claude Desktop / local clients
 *   http             — for remote clients (set MCP_TRANSPORT=http)
 *
 * Usage:
 *   npx @elvatis_com/elvatis-mcp
 *   MCP_TRANSPORT=http MCP_HTTP_PORT=3333 npx @elvatis_com/elvatis-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';

import {
  getStateSchema, handleGetState,
  lightSchema, handleLight,
  climateSchema, handleClimate,
  sceneSchema, handleScene,
  vacuumSchema, handleVacuum,
  sensorsSchema, handleSensors,
} from './tools/home.js';

import {
  memoryWriteSchema, handleMemoryWrite,
  memoryReadTodaySchema, handleMemoryReadToday,
  memorySearchSchema, handleMemorySearch,
} from './tools/memory.js';

import {
  cronListSchema, handleCronList,
  cronRunSchema, handleCronRun,
  cronStatusSchema, handleCronStatus,
} from './tools/cron.js';

function toText(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

async function main() {
  const config = loadConfig();

  const server = new McpServer({
    name: 'elvatis-mcp',
    version: '0.1.0',
  });

  // --- Home Assistant tools ---

  server.tool(
    'home_get_state',
    'Get the current state of a Home Assistant entity (light, climate, sensor, switch, vacuum, media_player, etc.)',
    getStateSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleGetState(args, config)) }] })
  );

  server.tool(
    'home_light',
    'Control a light: turn on/off/toggle, set brightness (0-100%), color temperature, or RGB color',
    lightSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleLight(args, config)) }] })
  );

  server.tool(
    'home_climate',
    'Control Tado thermostats: set target temperature or HVAC mode (heat/auto/off)',
    climateSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleClimate(args, config)) }] })
  );

  server.tool(
    'home_scene',
    'Activate a Hue scene in a room (wohnzimmer, flur, kuche, schlafzimmer, home)',
    sceneSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleScene(args, config)) }] })
  );

  server.tool(
    'home_vacuum',
    'Control the Roborock vacuum: start full clean, stop, return to dock, or get status',
    vacuumSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleVacuum(args, config)) }] })
  );

  server.tool(
    'home_sensors',
    'Read all environmental sensors: temperature, humidity, CO2 for all rooms plus outside temperature',
    sensorsSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleSensors(args, config)) }] })
  );

  // --- Memory tools ---

  server.tool(
    'memory_write',
    'Write a note to today\'s daily memory log. Use for capturing important context, decisions, or things to remember.',
    memoryWriteSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleMemoryWrite(args)) }] })
  );

  server.tool(
    'memory_read_today',
    'Read today\'s memory log',
    memoryReadTodaySchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleMemoryReadToday(args)) }] })
  );

  server.tool(
    'memory_search',
    'Search across daily memory files for a keyword (default: last 14 days)',
    memorySearchSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleMemorySearch(args)) }] })
  );

  // --- Cron tools ---

  server.tool(
    'cron_list',
    'List all scheduled OpenClaw cron jobs',
    cronListSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronList(args, config)) }] })
  );

  server.tool(
    'cron_run',
    'Trigger an OpenClaw cron job immediately by its ID',
    cronRunSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronRun(args, config)) }] })
  );

  server.tool(
    'cron_status',
    'Get OpenClaw cron scheduler status and overview',
    cronStatusSchema,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronStatus(args, config)) }] })
  );

  // --- Transport ---

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[elvatis-mcp] Running on stdio transport\n');
  } else {
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
      process.stderr.write(`[elvatis-mcp] Running on HTTP at http://localhost:${config.httpPort}/mcp\n`);
    });
  }
}

main().catch((err) => {
  process.stderr.write(`[elvatis-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
