# CLAUDE.md — elvatis-mcp

MCP server exposing OpenClaw tools (Home Assistant, memory, cron) to Claude Desktop, Cursor, Windsurf, and any MCP client.

## Quick Commands
- `/build` — typecheck + compile
- `/status` — show project status
- `/ship` — pre-publish checklist

## Stack
- TypeScript 5.x strict, Node.js 18+, CommonJS output
- `@modelcontextprotocol/sdk` 1.x (stay on 1.x, v2 is pre-alpha)
- Zod 3.x for all tool schemas

## 🚨 Active Build Blocker (read first!)

`TS2589: Type instantiation excessively deep` on every `server.tool()` call in `src/index.ts`.

Root cause: MCP SDK `server.tool()` has 6 overloads. Passing Zod schemas as raw shapes (`{ field: z.string() }`) causes exponential type instantiation (~42M).

**Fix to try first:** Change all schema exports in `tools/*.ts` from raw shapes to `z.object()` instances:
```typescript
// WRONG: export const lightSchema = { entity_id: z.string() }
// RIGHT: export const lightSchema = z.object({ entity_id: z.string() })
```

If that doesn't work: `npm install @modelcontextprotocol/sdk@1.8.0` and retry.

See `.ai/handoff/NEXT_ACTIONS.md` for full fix sequence.

## Key Rules
- **No em dashes** anywhere — use commas, colons, or parentheses
- Tool names: `domain_action` format
- Tool descriptions must be precise — Claude uses them for tool selection
- All secrets via env vars only — never hardcode tokens
- Logs to **stderr only** in stdio mode (stdout = MCP protocol stream)
- Build: `npm run build` (do NOT run on the OpenClaw server — OOM risk with tsc)

## Project Layout
```
src/
  index.ts        ← MCP server entry, tool registration, transport setup
  config.ts       ← env var config (HA_URL, HA_TOKEN, OPENCLAW_GATEWAY_URL, etc.)
  tools/
    home.ts       ← Home Assistant: light, climate, scene, vacuum, sensors
    memory.ts     ← Daily memory: write, read, search
    cron.ts       ← OpenClaw cron: list, run, status
```

## Adding a New Tool Domain
1. Create `src/tools/<domain>.ts` — export a `const <domain>Tools = [...]` array
2. Each entry: `{ name, description, schema (Zod), handler }`
3. Import in `src/index.ts` and add a registration loop (copy pattern from existing domains)
4. Add entries to DASHBOARD.md tool table
5. Update README.md tool table

## Testing Locally
```bash
npm run build
node dist/index.js  # starts in stdio mode (hangs waiting for MCP client — that's correct)
```

For Claude Desktop: set env vars in `claude_desktop_config.json` (see README.md).

## Handoff Files
`.ai/handoff/` — AAHP v2 protocol. Read STATUS.md + NEXT_ACTIONS.md at session start.
