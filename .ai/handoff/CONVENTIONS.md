# elvatis-mcp: Conventions

## Language & Stack
- **TypeScript strict** — no `any`, no ts-ignore
- **Node.js 18+** — uses native `fetch`, no axios/node-fetch needed
- **MCP SDK 1.x** — `@modelcontextprotocol/sdk` (v2 pre-alpha, skip until stable)
- **Zod 3.x** — all tool input schemas defined with Zod
- **CommonJS output** — `"module": "commonjs"` in tsconfig (MCP SDK requirement)

## Tool Design Rules
- Each tool has: `name`, `description`, `schema` (Zod object), `handler`
- Tool names: `domain_action` format (e.g. `home_light`, `memory_write`)
- Descriptions must be clear and specific — Claude reads these to decide which tool to call
- Handlers return plain objects (serialized to JSON in the MCP content block)
- Errors throw `Error` with descriptive messages — MCP SDK handles error propagation

## File Structure
```
src/
  index.ts          ← server entrypoint, tool registration
  config.ts         ← env var loading, Config interface
  tools/
    home.ts         ← Home Assistant tools
    memory.ts       ← Memory file tools
    cron.ts         ← OpenClaw cron tools
    trading.ts      ← (future) Trading bot tools
```

## Config
- All sensitive values via environment variables only — never hardcoded
- Defaults are non-functional (HA_TOKEN empty = throws on use)
- Config object passed to handlers that need external services

## Transport
- **stdio**: default, for Claude Desktop. Logs go to stderr only (stdout = MCP stream).
- **http**: opt-in via `MCP_TRANSPORT=http`. Endpoint: `/mcp` on configured port.

## No em dashes — ever. Use commas, colons, or parentheses instead.
