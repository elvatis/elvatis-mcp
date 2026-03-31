# elvatis-mcp: Current State of the Nation

> Last updated: 2026-03-31 by Claude (Cowork session)
> Commit: pending
>
> **Rule:** This file is rewritten (not appended) at the end of every session.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `build` | ✅ Passing (prev session) | 0.85s, 148 MB, 30k instantiations |
| `typecheck` | ⏳ Needs re-run | New files added this session (ssh.ts, openclaw.ts) |
| `lint` | — | Not configured yet |
| `integration test` | ✅ Passing (prev session) | Claude Desktop smoke test passed (2026-03-31) |

---

## Architecture Change (2026-03-31)

**Problem:** cron tools used REST (`/api/cron/jobs`) — OpenClaw has no REST API, only WebSocket. Memory tools read from local Windows filesystem — actual memory files are on the OpenClaw server.

**Solution:** SSH-based transport layer.

- New `src/ssh.ts`: SSH exec helper using `child_process.spawn('ssh', ...)`. No extra npm deps, uses built-in OpenSSH (available on Windows 10+, macOS, Linux).
- `src/tools/cron.ts`: Rewritten to read `~/.openclaw/cron/jobs.json` via SSH.
- `src/tools/memory.ts`: Rewritten to read/write `~/.openclaw/workspace/memory/` via SSH. Uses base64 encoding for safe writes.
- New `src/tools/openclaw.ts`: Sub-agent orchestration — SSH-executes `openclaw agents send --message "<prompt>" --local --timeout <seconds>` and returns the response synchronously. Also: `openclaw_status`, `openclaw_plugins`.
- `src/config.ts`: All IPs/hosts removed from hardcoded defaults. `SSH_HOST` and `HA_URL` are now required env vars. Dotenv loaded at startup.
- New `.env.example`: Template for all required env vars.

**Env vars required (must be set in .env or claude_desktop_config.json):**
- `HA_URL`: Home Assistant URL
- `SSH_HOST`: OpenClaw server IP/hostname
- Optional (have defaults): `SSH_PORT`, `SSH_USER`, `SSH_KEY_PATH`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_CLI_CMD`

---

## TS2589 Fix (resolved 2026-03-31)

**Solution:** `registerTool()` wrapper in `index.ts` casts `server` to `any` before calling `.tool()`. Build: 0.85s, 148 MB, 30k instantiations.

**Rule:** Never call `server.tool()` directly. Always use `registerTool()`.

---

## Components

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Server (stdio) | ✅ Working | Claude Desktop tested 2026-03-31 |
| MCP Server (HTTP) | ✅ Skeleton | StreamableHTTPServerTransport |
| Config loader | ✅ Done | All secrets via env vars, dotenv support |
| SSH helper | ✅ Done | src/ssh.ts, child_process.spawn, no extra deps |
| Home tools (home.ts) | ✅ Working | 6 tools, HA REST API |
| Memory tools (memory.ts) | ✅ SSH-based | Reads/writes OpenClaw server files |
| Cron tools (cron.ts) | ✅ SSH-based | Reads ~/.openclaw/cron/jobs.json |
| OpenClaw tools (openclaw.ts) | ✅ New | openclaw_run, openclaw_status, openclaw_plugins |
| Trading tools | ⏳ Not started | T-005 |
| Camera tools | ⏳ Not started | T-006 |
| GitHub Actions CI | ⏳ Not started | T-004 |

---

## Current Version: 0.1.0 (unreleased)

| Platform | Status |
|---|---|
| GitHub (elvatis/elvatis-mcp) | ✅ Private repo, main branch |
| npm (@elvatis_com/elvatis-mcp) | ⏳ Not published |

---

## openclaw-cli-bridge-elvatis (Server Issue)

Plugin on the OpenClaw server crashes with `Cannot find module 'openclaw/plugin-sdk'`.
This is a server-side npm dependency issue, not an elvatis-mcp issue.

**To fix (SSH to server):**
```bash
# Find the plugin directory
find ~/.openclaw -name "package.json" | xargs grep -l "cli-bridge" 2>/dev/null
# cd into it and run:
npm install
# or check if the import path is wrong in the plugin's source
```

---

## Architecture

```
Claude Desktop / Cursor / Windsurf
  └─ MCP Protocol (stdio or HTTP)
       └─ elvatis-mcp server (Windows/Linux)
            ├─ home tools      ─────────────────────► Home Assistant REST API
            ├─ memory tools    ──► SSH exec ────────► ~/.openclaw/workspace/memory/*.md
            ├─ cron tools      ──► SSH exec ────────► ~/.openclaw/cron/jobs.json
            └─ openclaw tools  ──► SSH exec ────────► openclaw CLI (all plugins)
                                                            ├─ trading plugin
                                                            ├─ home plugin
                                                            ├─ custom workflows
                                                            └─ LLM backends
```

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, MCP server + tool registration |
| `src/config.ts` | Env var config (all secrets external) |
| `src/ssh.ts` | SSH exec helper (child_process.spawn) |
| `src/tools/home.ts` | Home Assistant tools (REST) |
| `src/tools/memory.ts` | Memory read/write/search (SSH) |
| `src/tools/cron.ts` | OpenClaw cron management (SSH) |
| `src/tools/openclaw.ts` | Sub-agent orchestration + status (SSH) |
| `.env.example` | Template — copy to .env and fill values |
