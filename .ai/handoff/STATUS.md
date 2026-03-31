# elvatis-mcp: Current State of the Nation

> Last updated: 2026-03-31 09:48 by Akido
> Commit: b6d4c17 (initial skeleton)
>
> **Rule:** This file is rewritten (not appended) at the end of every session.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `build` | ⏳ Untested | tsc OOM on server (i7-6700K, 32GB). Build on Threadripper dev machine. |
| `typecheck` | ⏳ Untested | Same — run on dev machine |
| `lint` | — | Not configured yet |
| `integration test` | ⏳ Untested | Needs Claude Desktop + HA token |

---

## Components

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Server (stdio) | ✅ Skeleton | index.ts wired up, StdioServerTransport |
| MCP Server (HTTP) | ✅ Skeleton | StreamableHTTPServerTransport, MCP_TRANSPORT=http |
| Config loader | ✅ Done | Env vars: HA_URL, HA_TOKEN, OPENCLAW_GATEWAY_URL, etc. |
| Home tools (home.ts) | ✅ Skeleton | 6 tools: get_state, light, climate, scene, vacuum, sensors |
| Memory tools (memory.ts) | ✅ Skeleton | 3 tools: write, read_today, search |
| Cron tools (cron.ts) | ✅ Skeleton | 3 tools: list, run, status |
| Trading tools | ⏳ Not started | T-005 |
| Camera tools | ⏳ Not started | T-006 |
| GitHub Actions CI | ⏳ Not started | T-004 |

---

## Current Version: 0.1.0 (unreleased)

| Platform | Status |
|---|---|
| GitHub (elvatis/elvatis-mcp) | ✅ Private repo, main branch |
| npm (@elvatis_com/elvatis-mcp) | ⏳ Not published |
| ClawHub | ⏳ Not published |

---

## Current Focus

Build and verify on dev machine (Threadripper 3960X + RX 9070 XT).
Then Claude Desktop smoke test.
Then npm publish v0.1.0.

## Architecture

```
Client (Claude Desktop / Cursor / Windsurf)
  └─ MCP Protocol (stdio or HTTP)
       └─ elvatis-mcp server
            ├─ home tools      → Home Assistant REST API
            ├─ memory tools    → ~/.openclaw/workspace/memory/*.md
            └─ cron tools      → OpenClaw Gateway REST API
```

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, MCP server + tool registration |
| `src/config.ts` | Environment variable config |
| `src/tools/home.ts` | Home Assistant tools |
| `src/tools/memory.ts` | Memory read/write/search |
| `src/tools/cron.ts` | OpenClaw cron management |
| `README.md` | User-facing docs + Claude Desktop config snippet |
