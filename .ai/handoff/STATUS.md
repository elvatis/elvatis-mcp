# elvatis-mcp: Current State of the Nation

> Last updated: 2026-03-31 09:48 by Akido
> Commit: b6d4c17 (initial skeleton)
>
> **Rule:** This file is rewritten (not appended) at the end of every session.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `build` | ❌ Failing | TS2589: Type instantiation excessively deep — see blocker below |
| `typecheck` | ❌ Failing | Same root cause |
| `lint` | — | Not configured yet |
| `integration test` | ⏳ Untested | Needs Claude Desktop + HA token |

## 🚨 Active Blocker: TS2589 — Type instantiation excessively deep

**Error:** `TS2589: Type instantiation is excessively deep and possibly infinite` on every `server.tool()` call in `src/index.ts`.

**Root cause:** The MCP SDK's `server.tool()` has 6 overloads. TypeScript cannot resolve the correct overload when Zod schemas are passed as raw shape objects (`{ field: z.string() }`) because the union of all schema shapes across all tools creates an exponentially deep type instantiation chain (~42M instantiations observed).

**What was tried:**
1. Generic loop pattern (first attempt) — same error + union of all schema shapes
2. Direct per-tool registration with raw shape schemas — same TS2589

**Likely fix (not yet tried):**
Pass schemas as `z.object({...})` instances instead of raw shapes:
```typescript
// WRONG (raw shape — causes TS2589):
server.tool('home_light', 'desc', { entity_id: z.string(), action: z.enum([...]) }, handler)

// LIKELY CORRECT (z.object instance):
server.tool('home_light', 'desc', z.object({ entity_id: z.string(), action: z.enum([...]) }), handler)
```
The SDK's `ZodRawShapeCompat` type may require `z.object()` wrappers for complex schemas with enums, tuples, and optional fields.

**Alternative fix:** Downgrade to `@modelcontextprotocol/sdk@1.8.x` or earlier where the overload resolution was simpler.

**Environment:**
- Node.js: v22.x, Windows 11
- TypeScript: 5.8.x
- @modelcontextprotocol/sdk: 1.10.2
- Zod: 3.24.2
- Machine: Threadripper 3960X, 128GB RAM (NODE_OPTIONS=--max-old-space-size=16384)

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
