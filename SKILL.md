---
name: elvatis-mcp
description: MCP server exposing OpenClaw tools (smart home, memory, cron, sub-agent orchestration) to Claude Desktop, Cursor, Windsurf, and any MCP client. Includes Gemini and Codex CLI sub-agents.
homepage: https://github.com/elvatis/elvatis-mcp
metadata:
  {
    "openclaw":
      {
        "emoji": "🔌",
        "requires": { "bins": ["node"], "env": ["SSH_HOST", "HA_URL"] },
        "commands": ["/mcp-help"]
      }
  }
---

# elvatis-mcp

MCP server that bridges OpenClaw infrastructure into any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Windsurf).

## Tool Domains

### Home Assistant (`home_*`)
Control Philips Hue lights, Tado thermostats, Roborock vacuum, and read environmental sensors (temperature, humidity, CO2) via the Home Assistant REST API.

| Tool | Description |
|---|---|
| `home_get_state` | Get current state of any HA entity |
| `home_light` | Control lights (on/off/toggle, brightness, color) |
| `home_climate` | Control Tado thermostats (temperature, HVAC mode) |
| `home_scene` | Activate Hue scenes by room |
| `home_vacuum` | Control Roborock (start, stop, dock, status) |
| `home_sensors` | Read all environmental sensors |

### OpenClaw Memory (`openclaw_memory_*`)
Daily markdown memory logs on the OpenClaw server, accessed via SSH.

| Tool | Description |
|---|---|
| `openclaw_memory_write` | Append a note to today's log |
| `openclaw_memory_read_today` | Read today's memory log |
| `openclaw_memory_search` | Search across recent daily logs by keyword |

### OpenClaw Cron (`openclaw_cron_*`)
Manage scheduled jobs on the OpenClaw server.

| Tool | Description |
|---|---|
| `openclaw_cron_list` | List all scheduled cron jobs |
| `openclaw_cron_run` | Trigger a cron job immediately by ID |
| `openclaw_cron_status` | Get scheduler status overview |

### OpenClaw Agent (`openclaw_*`)
Delegate tasks to the OpenClaw AI agent via SSH.

| Tool | Description |
|---|---|
| `openclaw_run` | Send a prompt to the OpenClaw agent |
| `openclaw_status` | Check if the OpenClaw daemon is running |
| `openclaw_plugins` | List installed OpenClaw plugins |

### Sub-Agents (`gemini_run`, `codex_run`)
Local CLI sub-agents using cached authentication (no API keys needed).

| Tool | Description |
|---|---|
| `gemini_run` | Send a prompt to Google Gemini via the gemini CLI |
| `codex_run` | Send a task to OpenAI Codex via the codex CLI |

### Routing (`mcp_help`)
| Tool | Description |
|---|---|
| `mcp_help` | List all tools with routing guide and task recommendations |

## Setup

1. Copy `.env.example` to `.env` and fill in your values.
2. `npm install` (builds automatically via prepare script).
3. Configure your MCP client to run `node dist/index.js` in stdio mode.

See `README.md` for full configuration reference and client setup instructions.

**Version:** 0.1.0
