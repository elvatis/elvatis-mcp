# elvatis-mcp

**MCP server for OpenClaw** — expose your smart home, memory, and automation tools directly to Claude Desktop, Cursor, Windsurf, and any MCP-compatible AI client.

[![npm](https://img.shields.io/npm/v/@elvatis_com/elvatis-mcp)](https://www.npmjs.com/package/@elvatis_com/elvatis-mcp)

## What is MCP?

Model Context Protocol (MCP) is an open standard by Anthropic that lets AI clients (Claude Desktop, Cursor, Windsurf, Zed, etc.) connect to external tool servers. Once configured, Claude can directly call your tools without you copy-pasting anything.

## Available Tools

| Tool | Description |
|---|---|
| `home_get_state` | Read any Home Assistant entity state |
| `home_light` | Control lights: on/off/toggle, brightness, color temp, RGB |
| `home_climate` | Control Tado thermostats |
| `home_scene` | Activate Hue scenes |
| `home_vacuum` | Control Roborock vacuum |
| `home_sensors` | Read all temp/humidity/CO2 sensors |
| `memory_write` | Write a note to today's daily memory log |
| `memory_read_today` | Read today's memory log |
| `memory_search` | Search memory across the last N days |
| `cron_list` | List all OpenClaw cron jobs |
| `cron_run` | Trigger a cron job immediately |
| `cron_status` | Get cron scheduler status |

## Installation

```bash
npm install -g @elvatis_com/elvatis-mcp
```

Or use directly with npx (no install needed):

```bash
npx @elvatis_com/elvatis-mcp
```

## Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "elvatis": {
      "command": "npx",
      "args": ["-y", "@elvatis_com/elvatis-mcp"],
      "env": {
        "HA_URL": "http://192.168.178.44:8123",
        "HA_TOKEN": "your_home_assistant_token",
        "OPENCLAW_GATEWAY_URL": "http://your-openclaw-server:3000"
      }
    }
  }
}
```

### Cursor / Windsurf

Same config format, path varies by app. See your app's MCP documentation.

### HTTP Transport (remote access)

For remote clients that don't support stdio:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3333 npx @elvatis_com/elvatis-mcp
```

Connect your client to `http://your-server:3333/mcp`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HA_URL` | `http://192.168.178.44:8123` | Home Assistant URL |
| `HA_TOKEN` | — | Home Assistant long-lived access token |
| `OPENCLAW_GATEWAY_URL` | `http://localhost:3000` | OpenClaw Gateway URL |
| `OPENCLAW_GATEWAY_TOKEN` | — | Optional Gateway API token |
| `MCP_TRANSPORT` | `stdio` | Transport: `stdio` or `http` |
| `MCP_HTTP_PORT` | `3333` | HTTP port (only for `http` transport) |
| `MEMORY_DIR` | `~/.openclaw/workspace/memory` | Memory files directory |

## License

Apache-2.0 — Copyright 2026 Elvatis - Emre Kohler
