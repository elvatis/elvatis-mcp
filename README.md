# elvatis-mcp

**MCP server for OpenClaw** -- expose your smart home, memory, cron automation, and AI sub-agent orchestration to Claude Desktop, Cursor, Windsurf, and any MCP-compatible AI client.

[![npm](https://img.shields.io/npm/v/@elvatis_com/elvatis-mcp)](https://www.npmjs.com/package/@elvatis_com/elvatis-mcp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-11%2F11%20passed-brightgreen)](#test-results)

## What is this?

elvatis-mcp connects Claude (or any MCP client) to your infrastructure:

- **Smart home** control via Home Assistant (lights, thermostats, vacuum, sensors)
- **Memory** system with daily logs stored on your OpenClaw server
- **Cron** job management and triggering
- **Multi-LLM orchestration** through 4 AI backends: OpenClaw, Google Gemini, OpenAI Codex, and local LLMs
- **Smart prompt splitting** that analyzes complex requests and routes sub-tasks to the right AI

The key idea: Claude is the orchestrator, but it can delegate specialized work to other AI models. Coding tasks go to Codex. Research goes to Gemini. Simple formatting goes to your local LLM (free, private). Trading and automation go to OpenClaw. And `prompt_split` figures out the routing automatically.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io) is an open standard by Anthropic that lets AI clients connect to external tool servers. Once configured, Claude can directly call your tools without copy-pasting.

---

## Multi-LLM Architecture

```
                         You (Claude Desktop / Code / Cursor)
                                      |
                              MCP Protocol (stdio/HTTP)
                                      |
                              elvatis-mcp server
                                      |
              +--------+--------+--------+--------+--------+--------+
              |        |        |        |        |        |        |
          Claude  OpenClaw  Gemini   Codex   Local   llama   Home
          (CLI)   (SSH)     (CLI)    (CLI)   LLM    .cpp    Asst.
              |        |        |        |    (HTTP)  (proc)  (REST)
          Reason  Plugins  1M ctx  Coding    |        |        |
          Write   Trading  Multi-  Files   LM Stu  Turbo-  Lights
          Review  Auto.    modal   Debug   Ollama  Quant   Climate
                  Notify   Rsch    Shell   (free!) cache   Vacuum
```

### Sub-Agent Comparison

| Tool | Backend | Transport | Auth | Best for | Cost |
|---|---|---|---|---|---|
| `claude_run` | Claude (Anthropic) | Local CLI | Claude Code login | Complex reasoning, writing, code review. For non-Claude MCP clients. | API usage |
| `openclaw_run` | OpenClaw (plugins) | SSH | SSH key | Trading, automations, multi-step workflows | Self-hosted |
| `gemini_run` | Google Gemini | Local CLI | Google login | Long context (1M tokens), multimodal, research | API usage |
| `codex_run` | OpenAI Codex | Local CLI | OpenAI login | Coding, debugging, file editing, shell scripts | API usage |
| `local_llm_run` | LM Studio / Ollama / llama.cpp | HTTP | None | Classification, formatting, extraction, rewriting | **Free** |

### Smart Prompt Splitting

The `prompt_split` tool analyzes complex prompts and breaks them into sub-tasks:

```
User: "Search my memory for TurboQuant notes, summarize with Gemini,
       reformat as JSON locally, then save a summary to memory"

prompt_split returns:
  t1: openclaw_memory_search  -- "Search memory for TurboQuant"        (parallel)
  t3: local_llm_run           -- "Reformat raw notes as clean JSON"    (parallel)
  t2: gemini_run              -- "Summarize the key findings"          (after t1)
  t4: openclaw_memory_write   -- "Save summary to today's log"        (after t2, t3)
```

Claude then executes the plan, calling tools in the right order and running parallel tasks concurrently. Three analysis strategies:

| Strategy | Speed | Quality | Uses |
|---|---|---|---|
| `heuristic` | Instant | Good for clear prompts | Keyword matching, no LLM call |
| `local` | 5-30s | Better reasoning | Your local LLM analyzes the prompt |
| `gemini` | 5-15s | Best quality | Gemini-flash analyzes the prompt |
| `auto` (default) | Varies | Best available | Short-circuits simple prompts, then tries gemini -> local -> heuristic |

---

## Available Tools (32 total)

### Home Assistant (7 tools)
| Tool | Description |
|---|---|
| `home_get_state` | Read any Home Assistant entity state |
| `home_light` | Control lights: on/off/toggle, brightness, color temperature, RGB |
| `home_climate` | Control Tado thermostats: temperature, HVAC mode |
| `home_scene` | Activate Hue scenes by room |
| `home_vacuum` | Control Roborock vacuum: start, stop, dock, status |
| `home_sensors` | Read all temperature, humidity, and CO2 sensors |
| `home_automation` | List, trigger, enable, or disable HA automations |

### Memory (3 tools)
| Tool | Description |
|---|---|
| `openclaw_memory_write` | Write a note to today's daily log |
| `openclaw_memory_read_today` | Read today's memory log |
| `openclaw_memory_search` | Search memory files across the last N days |

### Cron Automation (6 tools)
| Tool | Description |
|---|---|
| `openclaw_cron_list` | List all scheduled OpenClaw cron jobs |
| `openclaw_cron_run` | Trigger a cron job immediately by ID |
| `openclaw_cron_status` | Get scheduler status and recent run history |
| `openclaw_cron_create` | Create a new cron job (cron expression, interval, or one-shot) |
| `openclaw_cron_edit` | Edit an existing cron job (name, message, schedule, model) |
| `openclaw_cron_delete` | Delete a cron job by ID |
| `openclaw_cron_history` | Show recent execution history for a cron job |

### OpenClaw Agent (4 tools)
| Tool | Description |
|---|---|
| `openclaw_run` | Send a prompt to the OpenClaw AI agent (all plugins available) |
| `openclaw_status` | Check if the OpenClaw daemon is running |
| `openclaw_plugins` | List all installed plugins |
| `openclaw_notify` | Send a notification via WhatsApp, Telegram, or last-used channel |

### AI Sub-Agents (5 tools)
| Tool | Description |
|---|---|
| `claude_run` | Send a prompt to Claude via the local CLI. For non-Claude MCP clients (Cursor, Windsurf). |
| `gemini_run` | Send a prompt to Google Gemini via the local CLI. 1M token context. |
| `codex_run` | Send a coding task to OpenAI Codex via the local CLI. |
| `local_llm_run` | Send a prompt to a local LLM (LM Studio, Ollama, llama.cpp). Free, private. |
| `llama_server` | Start/stop/configure a llama.cpp server with TurboQuant cache support. |

### System Management (4 tools)
| Tool | Description |
|---|---|
| `system_status` | Health check all services at once with latency (HA, SSH, LLM, CLIs) |
| `local_llm_models` | List, load, or unload models on LM Studio / Ollama |
| `openclaw_logs` | View gateway, agent, or system logs from the OpenClaw server |
| `file_transfer` | Upload, download, or list files on the OpenClaw server via SSH |

### Routing and Orchestration (2 tools)
| Tool | Description |
|---|---|
| `mcp_help` | Show routing guide. Pass a task to get a specific tool recommendation. |
| `prompt_split` | Analyze a complex prompt, split into sub-tasks with agent assignments. |

### Dashboard
| Endpoint | Description |
|---|---|
| `http://localhost:3334/status` | Auto-refreshing HTML dashboard (service health, loaded models) |
| `http://localhost:3334/api/status` | JSON API for programmatic status checks |

---

## Test Results

All tests run against live services (LM Studio with Deepseek R1 Qwen3 8B, OpenClaw server via SSH).

```
  elvatis-mcp integration tests

  Local LLM (local_llm_run)

        Model: deepseek/deepseek-r1-0528-qwen3-8b
        Response: "negative"
        Tokens: 401 (prompt: 39, completion: 362)
  PASS  local_llm_run: simple classification (21000ms)
        Extracted: {"name":"John Smith","age":34}
  PASS  local_llm_run: JSON extraction (24879ms)
        Error: Could not connect to local LLM at http://localhost:19999/v1/chat/completions
  PASS  local_llm_run: connection error handling (4ms)

  Prompt Splitter (prompt_split)

        Strategy: heuristic
        Agent: codex_run
        Summary: Fix the authentication bug in the login handler
  PASS  prompt_split: single-domain coding prompt routes to codex (1ms)
        Strategy: heuristic
        Subtasks: 3
          t1: codex_run -- "Refactor the auth module"
          t2: openclaw_run -- "check my portfolio performance and"
          t3: home_light -- "turn on the living room lights"
        Parallel groups: [["t1","t3"],["t2"]]
        Estimated time: 90s
  PASS  prompt_split: heuristic multi-agent splitting (0ms)
        Subtasks: 4, Agents: openclaw_memory_write, gemini_run, local_llm_run
        Parallel groups: [["t1","t3","t4"],["t2"]]
  PASS  prompt_split: cross-domain with dependencies (1ms)
        Strategy: local->heuristic (fallback)
        Subtasks: 1
  PASS  prompt_split: local LLM strategy (with fallback) (60007ms)

  Routing Guide (mcp_help)

        Guide length: 2418 chars
  PASS  mcp_help: returns guide without task (0ms)
        Recommendation: local_llm_run (formatting task)
  PASS  mcp_help: routes formatting task to local_llm_run (0ms)
        Recommendation: codex_run (coding task)
  PASS  mcp_help: routes coding task to codex_run (0ms)

  Memory Search via SSH (openclaw_memory_search)

        Query: "trading", Results: 5
  PASS  openclaw_memory_search: finds existing notes (208ms)

  -----------------------------------------------------------
  11 passed, 0 failed, 0 skipped
  -----------------------------------------------------------
```

Run the tests yourself:
```bash
npx tsx tests/integration.test.ts
```

Prerequisites: `.env` configured, local LLM server running, OpenClaw server reachable via SSH.

---

## Requirements

- Node.js 18 or later
- OpenSSH client (built-in on Windows 10+, macOS, Linux)
- A running [OpenClaw](https://openclaw.ai) instance accessible via SSH
- A [Home Assistant](https://www.home-assistant.io) instance with a long-lived access token

**Optional (for sub-agents):**
- `claude_run`: `npm install -g @anthropic-ai/claude-code` and run `claude` once to authenticate
- `gemini_run`: `npm install -g @google/gemini-cli` and `gemini auth login`
- `codex_run`: `npm install -g @openai/codex` and `codex login`
- `local_llm_run`: any OpenAI-compatible local server:
  - [LM Studio](https://lmstudio.ai) (recommended, GUI, default port 1234)
  - [Ollama](https://ollama.ai) (`ollama serve`, port 11434)
  - [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`, any port)

---

## Installation

Install globally:
```bash
npm install -g @elvatis_com/elvatis-mcp
```

Or use directly via npx (no install required):
```bash
npx @elvatis_com/elvatis-mcp
```

---

## Where Can I Use It?

elvatis-mcp works in every MCP-compatible client. Each client uses its own config file.

| Client | Transport | Config file |
|--------|-----------|-------------|
| **Claude Desktop / Cowork** (Windows MSIX) | stdio | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| **Claude Desktop / Cowork** (macOS) | stdio | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Code** (global, all projects) | stdio | `~/.claude.json` |
| **Claude Code** (this project only) | stdio | `.mcp.json` in repo root (already included) |
| **Cursor / Windsurf / other** | stdio or HTTP | See app documentation |

> Claude Desktop and Cowork share the same config file. Claude Code is a separate system.

---

## Configuration

### 1. Create your `.env` file

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

# Optional: Local LLM
LOCAL_LLM_ENDPOINT=http://localhost:1234/v1    # LM Studio default
LOCAL_LLM_MODEL=deepseek-r1-0528-qwen3-8b     # or omit to use loaded model

# Optional: Sub-agent models
GEMINI_MODEL=gemini-2.5-flash
CODEX_MODEL=o3
```

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

#### Claude Desktop (Windows MSIX)
Open this file (create it if needed):
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

> On Windows, always use full absolute paths. The MSIX sandbox does not resolve `~` or relative paths.

#### Claude Code (this project)
`.mcp.json` is already included. Copy `.env.example` to `.env` and fill in your values.

#### Claude Code (global)
```bash
claude mcp add --scope user elvatis-mcp -- node /path/to/elvatis-mcp/dist/index.js
```

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

### Optional
| Variable | Default | Description |
|---|---|---|
| `HA_TOKEN` | -- | Home Assistant long-lived access token |
| `SSH_PORT` | `22` | SSH port |
| `SSH_USER` | `chef-linux` | SSH username |
| `SSH_KEY_PATH` | `~/.ssh/openclaw_tunnel` | Path to SSH private key |
| `OPENCLAW_GATEWAY_URL` | `http://localhost:18789` | OpenClaw Gateway URL |
| `OPENCLAW_GATEWAY_TOKEN` | -- | Optional Gateway API token |
| `OPENCLAW_DEFAULT_AGENT` | -- | Named agent for `openclaw_run` |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Default model for `gemini_run` |
| `CODEX_MODEL` | -- | Default model for `codex_run` |
| `LOCAL_LLM_ENDPOINT` | `http://localhost:1234/v1` | Local LLM server URL (LM Studio default) |
| `LOCAL_LLM_MODEL` | -- | Default local model (omit to use server's loaded model) |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MCP_HTTP_PORT` | `3333` | HTTP port |
| `SSH_DEBUG` | -- | Set to `1` for verbose SSH output |

---

## Local LLM Setup

elvatis-mcp works with any OpenAI-compatible local server. Three popular options:

### LM Studio (recommended for desktop)
1. Download from [lmstudio.ai](https://lmstudio.ai)
2. Load a model (e.g. Deepseek R1 Qwen3 8B, Phi 4 Mini)
3. Click "Local Server" in the sidebar and enable it
4. Server runs at `http://localhost:1234/v1` (the default)

### Ollama
```bash
ollama serve                    # starts server on port 11434
ollama run llama3.2             # downloads and loads model
```
Set `LOCAL_LLM_ENDPOINT=http://localhost:11434/v1` in your `.env`.

### llama.cpp
```bash
llama-server -m model.gguf --port 8080
```
Set `LOCAL_LLM_ENDPOINT=http://localhost:8080/v1` in your `.env`.

### Recommended models by task

| Model | Size | Best for |
|---|---|---|
| Phi 4 Mini | 3B | Fast classification, formatting, extraction |
| Deepseek R1 Qwen3 | 8B | Reasoning, analysis, prompt splitting |
| Phi 4 Reasoning Plus | 15B | Complex reasoning with quality |
| GPT-OSS | 20B | General purpose, longer responses |

> Reasoning models (Deepseek R1, Phi 4 Reasoning) wrap their chain-of-thought in `<think>` tags. elvatis-mcp strips these automatically to give you clean responses.

---

## SSH Setup

The cron, memory, and OpenClaw tools communicate with your server via SSH.

```bash
# Verify connectivity
ssh -i ~/.ssh/your_key your-username@your-server "openclaw --version"

# Optional: SSH tunnel for OpenClaw WebSocket gateway
ssh -i ~/.ssh/your_key -L 18789:127.0.0.1:18789 -N your-username@your-server
```

On Windows, elvatis-mcp automatically resolves the SSH binary to `C:\Windows\System32\OpenSSH\ssh.exe` and retries on transient connection failures. Set `SSH_DEBUG=1` for verbose output.

---

## `/mcp-help` Slash Command

In Claude Code, the `/project:mcp-help` slash command is available:

```
/project:mcp-help
/project:mcp-help analyze this trading strategy for risk
```

---

## Development

```bash
git clone https://github.com/elvatis/elvatis-mcp
cd elvatis-mcp
npm install          # builds automatically via prepare script
cp .env.example .env # fill in your values
node dist/index.js   # starts in stdio mode, waits for MCP client
```

Build watch mode:
```bash
npm run dev
```

Run integration tests:
```bash
npx tsx tests/integration.test.ts
```

### Project layout
```
src/
  index.ts              MCP server entry, tool registration, transport, dashboard
  config.ts             Environment variable configuration
  dashboard.ts          Status dashboard HTML renderer
  ssh.ts                SSH exec helper (Windows/macOS/Linux)
  spawn.ts              Local process spawner for CLI sub-agents
  tools/
    home.ts             Home Assistant: light, climate, scene, vacuum, sensors
    home-automation.ts  HA automations: list, trigger, enable, disable
    memory.ts           Daily memory log: write, read, search (SSH)
    cron.ts             OpenClaw cron: list, run, status (SSH)
    cron-manage.ts      OpenClaw cron: create, edit, delete, history (SSH)
    openclaw.ts         OpenClaw agent orchestration (SSH)
    openclaw-logs.ts    OpenClaw server log viewer (SSH)
    notify.ts           WhatsApp/Telegram notifications via OpenClaw
    claude.ts           Claude sub-agent (local CLI, for non-Claude clients)
    gemini.ts           Google Gemini sub-agent (local CLI)
    codex.ts            OpenAI Codex sub-agent (local CLI)
    local-llm.ts        Local LLM sub-agent (OpenAI-compatible HTTP)
    local-llm-models.ts LM Studio model management (list/load/unload)
    llama-server.ts     llama.cpp server manager (start/stop/configure)
    file-transfer.ts    File upload/download via SSH
    system-status.ts    Unified health check across all services
    splitter.ts         Smart prompt splitter (multi-strategy)
    help.ts             Routing guide and task recommender
    routing-rules.ts    Shared routing rules and keyword matching
tests/
  integration.test.ts   Live integration tests
```

---

## License

Apache-2.0 -- Copyright 2026 [Elvatis](https://elvatis.com)
