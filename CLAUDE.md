# CLAUDE.md — elvatis-mcp

MCP server exposing OpenClaw tools (Home Assistant, memory, cron, sub-agent orchestration) to Claude Desktop, Cursor, Windsurf, and any MCP client.

## Quick Commands
- `/build` — typecheck + compile
- `/status` — show project status
- `/ship` — pre-publish checklist

## Stack
- TypeScript 5.x strict, Node.js 18+, CommonJS output
- `@modelcontextprotocol/sdk` 1.x (stay on 1.x, v2 is pre-alpha)
- Zod 3.x for all tool schemas
- `dotenv` 16.x for configuration

## TS2589 Fix (resolved 2026-03-31)

MCP SDK `server.tool()` has 6 overloads that caused 47M+ type instantiations and OOM.

**Solution:** `registerTool()` wrapper in `index.ts` casts `server` to `any` before calling `.tool()`, bypassing overload resolution entirely. Schemas are `z.object()` in tool files, `.shape` is passed to the SDK. Build: 0.85s, 148 MB, 30k instantiations.

**Rule:** Never call `server.tool()` directly. Always use `registerTool()`.

## Key Rules
- **No em dashes** anywhere — use commas, colons, or parentheses
- Tool names: `domain_action` format
- Tool descriptions must be precise — Claude uses them for tool selection
- All secrets via env vars only — never hardcode tokens or IPs
- Logs to **stderr only** in stdio mode (stdout = MCP protocol stream)
- Build: `npm run build` (avoid building on machines with limited RAM — tsc is memory-intensive)

## Project Layout
```
src/
  index.ts            <- MCP server entry, tool registration (registerTool wrapper), transport setup
  config.ts           <- env var config (loads from .env, all values required or optional)
  ssh.ts              <- SSH exec helper for remote commands (child_process.spawn, no extra deps)
  spawn.ts            <- Local process spawner for gemini, codex, and claude CLI subprocesses
  tools/
    home.ts           <- Home Assistant: light, climate, scene, vacuum, sensors, get_state
    home-automation.ts <- home_automation: natural language HA commands via OpenClaw
    memory.ts         <- Daily memory log: write, read_today, search (SSH to server)
    cron.ts           <- OpenClaw cron: list, run, status (SSH to server)
    cron-manage.ts    <- OpenClaw cron management: create, edit, delete, history
    openclaw.ts       <- Sub-agent orchestration via SSH: run, status, plugins
    openclaw-logs.ts  <- openclaw_logs: tail OpenClaw server logs via SSH
    notify.ts         <- openclaw_notify: send notifications via WhatsApp/Telegram
    gemini.ts         <- Google Gemini sub-agent via local gemini CLI (headless mode)
    codex.ts          <- OpenAI Codex sub-agent via local codex CLI (full-auto + JSONL)
    claude.ts         <- Claude sub-agent via local claude CLI (JSON output)
    local-llm.ts      <- Local LLM sub-agent via OpenAI-compatible API (Ollama, LM Studio)
    local-llm-models.ts <- local_llm_models: list available models from local LLM server
    llama-server.ts   <- llama_server: start/stop llama.cpp server for local inference
    splitter.ts       <- prompt_split: analyze complex prompts, split into sub-tasks with agent routing
    routing-rules.ts  <- Shared routing rules, keyword matching, agent constants (used by help + splitter)
    split-execute.ts  <- prompt_split_execute: execute a SplitPlan with agent dispatch and rate limiting
    help.ts           <- mcp_help routing guide and task-to-tool recommender
    system-status.ts  <- system_status: check host system health (CPU, RAM, disk, GPU)
    file-transfer.ts  <- file_transfer: upload/download files to/from OpenClaw server via SCP
  rate-limiter.ts     <- Rate limiting + cost tracking for cloud sub-agents (persistent JSON storage)
```

## Client Support

| Client | Config file | Notes |
|--------|-------------|-------|
| Claude Desktop + Cowork | `claude_desktop_config.json` | MSIX path on Windows (see README) |
| Claude Code (project) | `.mcp.json` in repo root | Already included |
| Claude Code (global) | `~/.claude.json` | Use `claude mcp add --scope user` |

## Slash Command

`.claude/commands/mcp-help.md` provides `/project:mcp-help` in Claude Code.
Usage: `/project:mcp-help` or `/project:mcp-help <task description>`

## Configuration
All configuration via environment variables. Copy `.env.example` to `.env` and fill in your values.

For Claude Desktop, you can also set `env` directly in `claude_desktop_config.json`.
On Windows (MSIX install), the config file is at:
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

## SSH Transport
Cron, memory, and openclaw tools all communicate with the OpenClaw server via SSH using the system's `ssh` binary (no extra npm dependencies). Required env vars: `SSH_HOST`, and optionally `SSH_USER`, `SSH_PORT`, `SSH_KEY_PATH`.

Sub-agent orchestration uses:
```
openclaw agent -m "<prompt>" --agent <name> --local --timeout <seconds>
```
The `--local` flag bypasses the OpenClaw WebSocket gateway and runs the agent turn inline.

**SSH Debugging:** Set `SSH_DEBUG=1` in your `.env` to add `-vvv` to all SSH calls. Error messages always include host, port, and key path for quick diagnosis.

**Key rules for Windows:** Use full absolute paths for `SSH_KEY_PATH` (e.g. `C:/Users/root/.ssh/your_key`). Tilde (`~`) is expanded by the server but absolute paths avoid any ambiguity across client contexts (Claude Desktop vs Claude Code).

## After Code Changes
Because `dist/` is gitignored, always rebuild after pulling changes:
```bash
npm install   # runs prepare script which triggers npm run build automatically
# OR
npm run build
```

## Adding a New Tool Domain
1. Create `src/tools/<domain>.ts` — define schemas (Zod) and handler functions
2. Import and register in `src/index.ts` using `registerTool()` (never `server.tool()` directly)
3. Add entries to `.ai/handoff/DASHBOARD.md` tool table
4. Update README.md tool table

## Testing
```bash
npm test                  # unit tests (42 tests, no external services needed)
npm run test:integration  # integration tests (requires .env, SSH, LM Studio)
npm run build && node dist/index.js  # manual: starts in stdio mode (waits for MCP client)
```

## Handoff Files
`.ai/handoff/` — AAHP v2 protocol. Read STATUS.md and NEXT_ACTIONS.md at session start.
