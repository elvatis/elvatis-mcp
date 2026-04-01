#!/usr/bin/env node
/**
 * elvatis-mcp — MCP server exposing OpenClaw tools to Claude Desktop, Cursor, Windsurf, and any MCP client.
 *
 * Transports:
 *   stdio (default)  — for Claude Desktop / local clients
 *   http             — for remote clients (set MCP_TRANSPORT=http)
 *
 * Configuration:
 *   Copy .env.example to .env and fill in your values.
 *   Or set env vars directly in claude_desktop_config.json.
 *
 * Usage:
 *   npx @elvatis_com/elvatis-mcp
 *   MCP_TRANSPORT=http MCP_HTTP_PORT=3333 npx @elvatis_com/elvatis-mcp
 */

// Load .env — try multiple locations so it works regardless of cwd or client:
//   1. <project-root>/.env  — resolved via __dirname from dist/index.js (most reliable)
//   2. cwd/.env             — fallback for local dev (`node dist/index.js` from repo root)
// dotenv.config() is a no-op if the file doesn't exist, so ordering is safe.
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config(); // cwd fallback — only loads vars not already set above

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

import {
  openclawRunSchema, handleOpenclawRun,
  openclawStatusSchema, handleOpenclawStatus,
  openclawPluginsSchema, handleOpenclawPlugins,
} from './tools/openclaw.js';

import {
  geminiRunSchema, handleGeminiRun,
} from './tools/gemini.js';

import {
  codexRunSchema, handleCodexRun,
} from './tools/codex.js';

import {
  claudeRunSchema, handleClaudeRun,
} from './tools/claude.js';

import {
  mcpHelpSchema, handleMcpHelp,
} from './tools/help.js';

import {
  systemStatusSchema, handleSystemStatus,
} from './tools/system-status.js';

import {
  localLlmModelsSchema, handleLocalLlmModels,
} from './tools/local-llm-models.js';

import {
  openclawLogsSchema, handleOpenclawLogs,
} from './tools/openclaw-logs.js';

import {
  homeAutomationSchema, handleHomeAutomation,
} from './tools/home-automation.js';

import {
  fileTransferSchema, handleFileTransfer,
} from './tools/file-transfer.js';

import {
  openclawNotifySchema, handleOpenclawNotify,
} from './tools/notify.js';

import {
  cronCreateSchema, handleCronCreate,
  cronEditSchema, handleCronEdit,
  cronDeleteSchema, handleCronDelete,
  cronHistorySchema, handleCronHistory,
} from './tools/cron-manage.js';

import { handleDashboardRequest } from './dashboard.js';

import {
  llamaServerSchema, handleLlamaServer,
} from './tools/llama-server.js';

import {
  localLlmRunSchema, handleLocalLlmRun,
} from './tools/local-llm.js';

import {
  promptSplitSchema, handlePromptSplit,
} from './tools/splitter.js';

import {
  splitExecuteSchema, handleSplitExecute,
} from './tools/split-execute.js';

import {
  initRateLimiter, checkRateLimit, recordUsage, getAllQuotas, getCostSummary, flushNow,
} from './rate-limiter.js';

function toText(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

// Typed wrapper to bypass McpServer.tool() 6-overload resolution that causes
// TS2589 (47M+ type instantiations). We cast to a single-signature function
// so TypeScript resolves the call in constant time.
// Rule: Never call server.tool() directly. Always use registerTool().
export type ToolExtra = {
  signal?: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification?: (notification: { method: string; params: Record<string, unknown> }) => Promise<void>;
};

type ToolHandler = (args: Record<string, unknown>, extra: ToolExtra) =>
  Promise<{ content: Array<{ type: string; text: string }> }>;

function registerTool(
  server: McpServer,
  name: string,
  description: string,
  schema: Record<string, unknown>,
  handler: ToolHandler,
): void {
  (server as any).tool(name, description, schema, handler);
}

async function main() {
  const config = loadConfig();

  // Initialize rate limiter with persistent storage
  initRateLimiter({
    dataDir: config.dataDir,
    limits: config.rateLimits,
  });

  // Flush usage data on shutdown
  process.on('SIGINT', () => { flushNow(); process.exit(0); });
  process.on('SIGTERM', () => { flushNow(); process.exit(0); });

  const server = new McpServer({
    name: 'elvatis-mcp',
    version: '0.1.0',
  });

  // --- Home Assistant tools ---

  registerTool(server, 'home_get_state',
    'Get the current state of a Home Assistant entity (light, climate, sensor, switch, vacuum, media_player, etc.)',
    getStateSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleGetState(args as any, config)) }] })
  );

  registerTool(server, 'home_light',
    'Control a light: turn on/off/toggle, set brightness (0-100%), color temperature, or RGB color',
    lightSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleLight(args as any, config)) }] })
  );

  registerTool(server, 'home_climate',
    'Control Tado thermostats: set target temperature or HVAC mode (heat/auto/off)',
    climateSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleClimate(args as any, config)) }] })
  );

  registerTool(server, 'home_scene',
    'Activate a Hue scene in a room (wohnzimmer, flur, kuche, schlafzimmer, home)',
    sceneSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleScene(args as any, config)) }] })
  );

  registerTool(server, 'home_vacuum',
    'Control the Roborock vacuum: start full clean, stop, return to dock, or get status',
    vacuumSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleVacuum(args as any, config)) }] })
  );

  registerTool(server, 'home_sensors',
    'Read all environmental sensors: temperature, humidity, CO2 for all rooms plus outside temperature',
    sensorsSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleSensors(args as any, config)) }] })
  );

  // --- Memory tools (SSH to OpenClaw server) ---

  registerTool(server, 'openclaw_memory_write',
    'Write a note to today\'s daily memory log on the OpenClaw server. Use for capturing important context, decisions, or things to remember.',
    memoryWriteSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleMemoryWrite(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_memory_read_today',
    'Read today\'s memory log from the OpenClaw server',
    memoryReadTodaySchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleMemoryReadToday(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_memory_search',
    'Search across daily memory files on the OpenClaw server for a keyword (default: last 14 days)',
    memorySearchSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleMemorySearch(args as any, config)) }] })
  );

  // --- Cron tools (SSH to OpenClaw server) ---

  registerTool(server, 'openclaw_cron_list',
    'List all scheduled OpenClaw cron jobs',
    cronListSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronList(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_cron_run',
    'Trigger an OpenClaw cron job immediately by its ID',
    cronRunSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronRun(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_cron_status',
    'Get OpenClaw cron scheduler status and overview',
    cronStatusSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronStatus(args as any, config)) }] })
  );

  // --- OpenClaw sub-agent tools (SSH orchestration) ---

  registerTool(server, 'openclaw_run',
    'Send a task or prompt to the OpenClaw AI agent via SSH. The agent has access to all installed plugins (trading, home automation, etc.) and multiple LLM backends. Use this to delegate complex tasks that OpenClaw already knows how to handle.',
    openclawRunSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleOpenclawRun(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_status',
    'Check if the OpenClaw daemon is running on the server and get version info',
    openclawStatusSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleOpenclawStatus(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_plugins',
    'List all plugins installed on the OpenClaw server',
    openclawPluginsSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleOpenclawPlugins(args as any, config)) }] })
  );

  // --- Gemini sub-agent (local spawn) ---

  registerTool(server, 'gemini_run',
    'Send a prompt to Google Gemini via the local gemini CLI. Fast, direct LLM call with no OpenClaw overhead. Uses cached Google auth — no API key required.',
    geminiRunSchema.shape,
    async (args) => {
      const quota = checkRateLimit('gemini_run');
      if (!quota.allowed) return { content: [{ type: 'text', text: toText({ success: false, error: quota.reason, quota }) }] };
      const result = await handleGeminiRun(args as any, config);
      recordUsage('gemini_run');
      return { content: [{ type: 'text', text: toText(result) }] };
    }
  );

  // --- Codex sub-agent (local spawn) ---

  registerTool(server, 'codex_run',
    'Send a task to OpenAI Codex via the local codex CLI. Specializes in coding tasks, file operations, and technical analysis. Uses cached OpenAI auth — no API key required.',
    codexRunSchema.shape,
    async (args) => {
      const quota = checkRateLimit('codex_run');
      if (!quota.allowed) return { content: [{ type: 'text', text: toText({ success: false, error: quota.reason, quota }) }] };
      const result = await handleCodexRun(args as any, config);
      recordUsage('codex_run');
      return { content: [{ type: 'text', text: toText(result) }] };
    }
  );

  // --- Claude sub-agent (for non-Claude MCP clients like Cursor, Windsurf) ---

  registerTool(server, 'claude_run',
    'Send a prompt to Claude via the local Claude Code CLI. Use this when the MCP client is NOT Claude (e.g. Cursor, Windsurf, Zed) or for cross-checking results from other AI backends. Uses cached Anthropic auth.',
    claudeRunSchema.shape,
    async (args) => {
      const quota = checkRateLimit('claude_run');
      if (!quota.allowed) return { content: [{ type: 'text', text: toText({ success: false, error: quota.reason, quota }) }] };
      const result = await handleClaudeRun(args as any);
      recordUsage('claude_run');
      return { content: [{ type: 'text', text: toText(result) }] };
    }
  );

  // --- Local LLM sub-agent ---

  registerTool(server, 'local_llm_run',
    'Send a prompt to a local LLM (LM Studio, Ollama, llama.cpp, or any OpenAI-compatible server). Free, private, no API key needed. Best for simple tasks: classify, format, extract, rewrite, proofread. Set stream=true for token-by-token progress.',
    localLlmRunSchema.shape,
    async (args, extra) => ({ content: [{ type: 'text', text: toText(await handleLocalLlmRun(args as any, config, extra)) }] })
  );

  // --- Routing and orchestration ---

  registerTool(server, 'mcp_help',
    'List all available elvatis-mcp tools with a routing guide. Optionally provide a task description to get a specific recommendation for which sub-agent (openclaw_run, gemini_run, codex_run, local_llm_run) or tool to use.',
    mcpHelpSchema.shape,
    async (args) => {
      const result = await handleMcpHelp(args as any);
      const text = result.recommendation
        ? `${result.guide}\n\n---\n\n## Recommendation for: "${result.task}"\n\n${result.recommendation}`
        : result.guide;
      return { content: [{ type: 'text', text }] };
    }
  );

  registerTool(server, 'prompt_split',
    'Analyze a complex prompt and split it into sub-tasks with agent assignments. '
    + 'Returns a structured plan showing which sub-agent (gemini, codex, openclaw, local LLM) handles each part, '
    + 'dependency ordering, and the actual prompts to send. '
    + 'Each subtask includes a suggested model that the user can override before execution. '
    + 'IMPORTANT: Always present the plan to the user for review before executing. '
    + 'Strategy: "auto" (default), "gemini", "local", or "heuristic".',
    promptSplitSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handlePromptSplit(args as any, config)) }] })
  );

  registerTool(server, 'prompt_split_execute',
    'Execute a prompt_split plan: runs subtasks in dependency order, dispatches to the correct sub-agent, '
    + 'passes results between dependent tasks, and enforces rate limits on cloud agents. '
    + 'Provide a "plan" from prompt_split, or just a "prompt" to generate and execute in one step. '
    + 'Use "overrides" to change agent/model/prompt per task or skip tasks. Set dry_run=true to preview.',
    splitExecuteSchema.shape,
    async (args, extra) => ({ content: [{ type: 'text', text: toText(await handleSplitExecute(args as any, config, extra)) }] })
  );

  // --- System management ---

  registerTool(server, 'system_status',
    'Check health of all connected services at once: Home Assistant, OpenClaw (SSH), local LLM, Gemini CLI, Codex CLI. Returns a unified status overview with latency for each service.',
    systemStatusSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleSystemStatus(args as any, config)) }] })
  );

  registerTool(server, 'local_llm_models',
    'List, load, or unload models on the local LLM server. "list" shows available models. "load"/"unload" switches models in LM Studio without opening the GUI (LM Studio only).',
    localLlmModelsSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleLocalLlmModels(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_logs',
    'View recent logs from the OpenClaw server: gateway logs, agent execution logs, or system journal. Supports line count and keyword filtering.',
    openclawLogsSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleOpenclawLogs(args as any, config)) }] })
  );

  registerTool(server, 'home_automation',
    'List, trigger, enable, or disable Home Assistant automations. "list" shows all automations with their state and last trigger time.',
    homeAutomationSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleHomeAutomation(args as any, config)) }] })
  );

  registerTool(server, 'file_transfer',
    'Upload, download, or list files on the OpenClaw server via SSH. Supports text and binary files up to 10MB. "download" without local_path returns file content directly.',
    fileTransferSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleFileTransfer(args as any, config)) }] })
  );

  // --- Notifications ---

  registerTool(server, 'openclaw_notify',
    'Send a notification via WhatsApp, Telegram, or the last-used channel. Uses OpenClaw message delivery.',
    openclawNotifySchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleOpenclawNotify(args as any, config)) }] })
  );

  // --- Extended cron management ---

  registerTool(server, 'openclaw_cron_create',
    'Create a new cron job on the OpenClaw server. Supports cron expressions ("0 9 * * *"), intervals ("every 30m"), and one-shot ("at 2026-04-01T14:00" or "+20m"). Optionally deliver results via WhatsApp/Telegram.',
    cronCreateSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronCreate(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_cron_edit',
    'Edit an existing cron job. Change its name, message, schedule, or model.',
    cronEditSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronEdit(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_cron_delete',
    'Delete a cron job by its ID.',
    cronDeleteSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronDelete(args as any, config)) }] })
  );

  registerTool(server, 'openclaw_cron_history',
    'Show recent execution history for cron jobs. Optionally filter by job ID.',
    cronHistorySchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleCronHistory(args as any, config)) }] })
  );

  // --- llama.cpp server management ---

  registerTool(server, 'llama_server',
    'Manage a local llama.cpp server: start with specific model, cache type (turbo2/turbo3/turbo4 for TurboQuant), '
    + 'GPU layers, and context size. Runs alongside LM Studio on a different port. '
    + 'Use "status" to check, "stop" to kill. Once started, use local_llm_run with the endpoint to query it.',
    llamaServerSchema.shape,
    async (args) => ({ content: [{ type: 'text', text: toText(await handleLlamaServer(args as any)) }] })
  );

  // --- Dashboard helper (serves HTML at /status or /) ---

  async function serveDashboard(res: import('http').ServerResponse) {
    try {
      const html = await handleDashboardRequest(config);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end(`Dashboard error: ${err}`);
    }
  }

  // --- Transport ---

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[elvatis-mcp] Running on stdio transport\n');

    // In stdio mode, start a lightweight dashboard server on a separate port
    const dashPort = config.httpPort + 1; // default: 3334
    const { createServer: createDashServer } = await import('http');
    const dashServer = createDashServer(async (req, res) => {
      if (req.url === '/status' || req.url === '/') {
        await serveDashboard(res);
      } else if (req.url === '/api/status') {
        // JSON API for programmatic access
        const data = await handleSystemStatus({} as any, config).catch(() => ({ error: 'failed' }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    dashServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(`[elvatis-mcp] Dashboard port ${dashPort} in use, skipping (MCP tools still work)\n`);
      } else {
        process.stderr.write(`[elvatis-mcp] Dashboard error: ${err.message}\n`);
      }
    });
    dashServer.listen(dashPort, () => {
      process.stderr.write(`[elvatis-mcp] Dashboard at http://localhost:${dashPort}/status\n`);
    });
  } else {
    const { createServer } = await import('http');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const httpServer = createServer(async (req, res) => {
      if (req.url === '/mcp') {
        await transport.handleRequest(req, res);
      } else if (req.url === '/status' || req.url === '/') {
        await serveDashboard(res);
      } else if (req.url === '/api/status') {
        const data = await handleSystemStatus({} as any, config).catch(() => ({ error: 'failed' }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    await server.connect(transport);
    httpServer.listen(config.httpPort, () => {
      process.stderr.write(`[elvatis-mcp] Running on HTTP at http://localhost:${config.httpPort}/mcp\n`);
      process.stderr.write(`[elvatis-mcp] Dashboard at http://localhost:${config.httpPort}/status\n`);
    });
  }
}

main().catch((err) => {
  process.stderr.write(`[elvatis-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
