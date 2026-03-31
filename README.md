# elvatis-mcp

**MCP server for OpenClaw** — expose your smart home, memory, cron automation, and AI sub-agent orchestration directly to Claude Desktop, Cursor, Windsurf, and any MCP-compatible AI client.

[![npm](https://img.shields.io/npm/v/@elvatis_com/elvatis-mcp)](https://www.npmjs.com/package/@elvatis_com/elvatis-mcp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io) is an open standard by Anthropic that lets AI clients (Claude Desktop, Cursor, Windsurf, Zed, etc.) connect to external tool servers. Once configured, Claude can directly call your tools without you copy-pasting anything.

## Available Tools

### Home Assistant
| Tool | Description |
|---|---|
| `home_get_state` | Read any Home Assistant entity state |
| `home_light` | Control lights: on/off/toggle, brightness, color temperature, RGB |
| `home_climate` | Control Tado thermostats: temperature, HVAC mode |
| `home_scene` | Activate Hue scenes by room |
| `home_vacuum` | Control Roborock vacuum: start, stop, dock, status |
| `home_sensors` | Read all temperature, humidity, and CO2 sensors |

### Memory (stored on your OpenClaw server)
| Tool | Description |
|---|---|
| `openclaw_memory_write` | Write a note to today's daily log |
| `openclaw_memory_read_today` | Read today's memory log |
| `openclaw_memory_search` | Search memory files across the last N days |

### Cron Automation
| Tool | Description |
|---|---|
| `openclaw_cron_list` | List all scheduled OpenClaw cron jobs |
| `openclaw_cron_run` | Trigger a cron job immediately by ID |
| `openclaw_cron_status` | Get scheduler status and recent run history |

### OpenClaw Sub-Agent Orchestration
| Tool | Description |
|---|---|
| `openclaw_run` | Send a prompt to the OpenClaw AI agent (runs with all installed plugins) |
| `openclaw_status` | Check if the OpenClaw daemon is running and get version info |
| `openclaw_plugins` | List all plugins installed on the OpenClaw server |

### Gemini Sub-Agent
| Tool | Description |
|---|---|
| `gemini_run` | Send a prompt to Google Gemini via the local `gemini` CLI. Uses cached Google auth. |

### Codex Sub-Agent
| Tool | Description |
|---|---|
| `codex_run` | Send a task to OpenAI Codex via the local `codex` CLI. Specializes in coding tasks. Uses cached OpenAI auth. |

### Routing
| Tool | Description |
|---|---|
| `mcp_help` | Show available tools and routing guide. Optionally pass a task description to get a specific tool recommendation. |

## Requirements

- Node.js 18 or later
- A running [OpenClaw](https://openclaw.ai) instance accessible via SSH
- A [Home Assistant](https://www.home-assistant.io) instance with a long-lived access token
- OpenSSH client (built-in on Windows 10+, macOS, and Linux)

## Installation

Install globally:
```bash
npm install -g @elvatis_com/elvatis-mcp
```

Or use directly via npx (no install required):
```bash
npx @elvatis_com/elvatis-mcp
```

## Where Can I Use It?

elvatis-mcp works in every MCP-compatible client. Each client uses its own config file — they do not share configuration.

| Client | Transport | Config file |
|--------|-----------|-------------|
| **Claude Desktop / Cowork** (Windows MSIX) | stdio | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| **Claude Desktop / Cowork** (macOS) | stdio | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Code** (global, all projects) | stdio | `~/.claude.json` |
| **Claude Code** (this project only) | stdio | `.mcp.json` in repo root (already included) |
| **Cursor / Windsurf / other** | stdio or HTTP | See app documentation |

> Claude Desktop and Cowork share the same config file. Claude Code is a separate system with its own config.

---

## Configuration

### 1. Create your `.env` file

Copy `.env.example` to `.env` in the project root and fill in your values:

```bash
cp .env.example .env
```

```env
# Required
HA_URL=http://your-home-assistant:8123
HA_TOKEN=your_long_lived_ha_token

SSH_HOST=your-openclaw-server-ip
SSH_USER=your-ssh-username
SSH_KEY_PATH=~/.ssh/your_key
```

> The `.env` file is gitignored and never committed. See `.env.example` for all available options.

### 2. Configure your MCP client

#### Claude Desktop (macOS)
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "elvatis-mcp": {
      "command": "npx",
      "args": ["-y", "@elvatis_com/elvatis-mcp"],
      "env": {
        "HA_URL": "http://your-home-assistant:8123",
        "HA_TOKEN": "your_token",
        "SSH_HOST": "your-openclaw-server-ip",
        "SSH_USER": "your-username",
        "SSH_KEY_PATH": "/Users/your-username/.ssh/your_key"
      }
    }
  }
}
```

#### Claude Desktop (Windows — MSIX install)
The MSIX package reads config from a sandboxed path. Open this file (create it if it does not exist):
```
%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "elvatis-mcp": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\elvatis-mcp\\dist\\index.js"],
      "env": {
        "HA_URL": "http://your-home-assistant:8123",
        "HA_TOKEN": "your_token",
        "SSH_HOST": "your-openclaw-server-ip",
        "SSH_USER": "your-username",
        "SSH_KEY_PATH": "C:\\Users\\your-username\\.ssh\\your_key"
      }
    }
  }
}
```

> **Note:** On Windows, always use full absolute paths — the MSIX sandbox does not resolve `~` or relative paths.

#### Claude Code (this project)
`.mcp.json` is already included in the repo root. It loads the built server automatically:
```json
{
  "mcpServers": {
    "elvatis-mcp": {
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```
Make sure `.env` exists in the project root (copy `.env.example`). Claude Code will prompt for approval the first time.

#### Claude Code (global, all projects)
To make elvatis-mcp available in every Claude Code session, add it to `~/.claude.json`:
```bash
# Using the Claude Code CLI (easiest):
claude mcp add --scope user elvatis-mcp -- node /path/to/elvatis-mcp/dist/index.js
```
Or add it manually to `~/.claude.json` under the `mcpServers` key.

#### Cursor / Windsurf
Same JSON format. Refer to your app's MCP documentation for the config file location.

#### HTTP Transport (remote clients)
```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3333 npx @elvatis_com/elvatis-mcp
```
Connect your client to `http://your-server:3333/mcp`.

---

## Environment Variables

### Required
| Variable | Description |
|---|---|
| `HA_URL` | Home Assistant base URL, e.g. `http://192.168.x.x:8123` |
| `SSH_HOST` | OpenClaw server hostname or IP |

### Optional (have sensible defaults)
| Variable | Default | Description |
|---|---|---|
| `HA_TOKEN` | — | Home Assistant long-lived access token |
| `SSH_PORT` | `22` | SSH port |
| `SSH_USER` | `chef-linux` | SSH username on the OpenClaw server |
| `SSH_KEY_PATH` | `~/.ssh/openclaw_tunnel` | Path to SSH private key |
| `OPENCLAW_GATEWAY_URL` | `http://localhost:18789` | OpenClaw Gateway URL (WebSocket tunnel) |
| `OPENCLAW_GATEWAY_TOKEN` | — | Optional Gateway API token |
| `OPENCLAW_DEFAULT_AGENT` | — | Named agent for `openclaw_run` (omit for default) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Default model for `gemini_run` |
| `CODEX_MODEL` | — | Default model for `codex_run` (uses Codex default if omitted) |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MCP_HTTP_PORT` | `3333` | HTTP port (only used when `MCP_TRANSPORT=http`) |

---

## SSH Setup

The cron, memory, and OpenClaw tools communicate with your server via SSH. The server must be reachable at `SSH_HOST` with the key at `SSH_KEY_PATH`.

To verify connectivity:
```bash
ssh -i ~/.ssh/your_key your-username@your-openclaw-server "openclaw --version"
```

If you are using an SSH tunnel for the OpenClaw WebSocket gateway, keep it running in the background:
```bash
ssh -i ~/.ssh/your_key -L 18789:127.0.0.1:18789 -N your-username@your-openclaw-server
```

---

## OpenClaw Sub-Agent: How It Works

`openclaw_run` sends a prompt to your OpenClaw AI agent via SSH and returns the response synchronously:

```
Claude Desktop  ->  elvatis-mcp  ->  SSH  ->  openclaw agents send --message "..." --local --timeout 60
                                                  -> runs with all installed plugins
                                                  -> returns response on stdout
```

The `--local` flag bypasses the WebSocket gateway and runs the agent turn inline, so no gateway connection is required. This means all OpenClaw plugins (trading, home automation, custom workflows, etc.) are available to the agent without any additional configuration.

---

## `/mcp-help` Slash Command

When you open this project in Claude Code, the `/project:mcp-help` slash command is available:

```
/project:mcp-help
# or with a task for a specific recommendation:
/project:mcp-help analyze this trading strategy for risk
```

Claude will call the `mcp_help` tool and return a routing recommendation. You can also call the tool directly in any client:

> "Use mcp_help to figure out which tool to use for reviewing a large codebase"

The `mcp_help` tool is also useful for **automatic task splitting**: if Claude receives a complex request (e.g., "debug this code and then summarize the findings"), it can use `mcp_help` to confirm the routing before spawning the right sub-agents in sequence.

---

## Multi-LLM Sub-Agent Architecture

elvatis-mcp exposes three distinct sub-agent patterns, each with different strengths:

| Tool | Backend | Transport | Auth | Best for |
|---|---|---|---|---|
| `openclaw_run` | OpenClaw (claude/gpt/gemini + plugins) | SSH | SSH key | Tasks needing plugins (trading, automations, etc.) |
| `gemini_run` | Google Gemini | Local spawn | Google login | Fast queries, long-context (1M tokens), multimodal |
| `codex_run` | OpenAI Codex | Local spawn | OpenAI login | Coding tasks, file editing, technical analysis |

All three run asynchronously and return the final response as plain text to Claude Desktop. Claude can call them in sequence or use one as a cross-check on another.

**Setup requirements:**
- `openclaw_run`: OpenClaw server reachable via SSH
- `gemini_run`: `npm install -g @google/gemini-cli` and `gemini auth login`
- `codex_run`: `npm install -g @openai/codex` and `codex login`

---

## Development

```bash
git clone https://github.com/elvatis/elvatis-mcp
cd elvatis-mcp
npm install
cp .env.example .env   # fill in your values
npm run build
node dist/index.js     # starts in stdio mode, waits for MCP client
```

Build watch mode:
```bash
npm run dev
```

---

## License

Apache-2.0 — Copyright 2026 [Elvatis](https://elvatis.com)
