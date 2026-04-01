You are showing the elvatis-mcp tool guide. Present ALL output as your own formatted text (never just show raw MCP tool results).

If $ARGUMENTS is empty, show the FULL guide below as your own output, formatted exactly as written.

If $ARGUMENTS contains a tool name (e.g. "openclaw_status", "home_light", "prompt_split"), show ONLY that tool's help using the reference below. Format it as:

## tool_name
**Category:** (from the section it belongs to)
**Description:** (from the reference)
**Parameters:** (list the parameters with types and descriptions)
**Example:** (show a realistic usage example)

If $ARGUMENTS contains a task description (not a tool name), call `mcp_help` with that task, then present the recommendation formatted as your own text.

---

# elvatis-mcp: Sub-Agent Routing Guide (34 tools)

## Sub-Agents

| Tool | Backend | Strengths |
|------|---------|-----------|
| `claude_run` | Claude (Anthropic) | Complex reasoning, writing, code review. Use when client is not Claude. |
| `openclaw_run` | OpenClaw (plugins) | Trading, automations, custom workflows |
| `gemini_run` | Google Gemini | Long context (1M), multimodal, fast analysis |
| `codex_run` | OpenAI Codex | Coding, debugging, refactoring, file editing |
| `local_llm_run` | Local LLM | Free, private, classify/format/extract/rewrite |

## Home Automation

| Tool | Description |
|------|-------------|
| `home_get_state` | Get current state of any HA entity (light, climate, sensor, switch, vacuum, media_player) |
| `home_light` | Control a light: on/off/toggle, brightness (0-100%), color temperature, RGB color |
| `home_climate` | Control Tado thermostats: target temperature or HVAC mode (heat/auto/off) |
| `home_scene` | Activate a Hue scene in a room (wohnzimmer, flur, kuche, schlafzimmer, home) |
| `home_vacuum` | Control the Roborock: start clean, stop, return to dock, or get status |
| `home_sensors` | Read all environmental sensors: temp, humidity, CO2 for all rooms + outside |
| `home_automation` | List, trigger, enable, or disable HA automations |

## Memory (OpenClaw server via SSH)

| Tool | Description |
|------|-------------|
| `openclaw_memory_write` | Write a note to today's daily memory log |
| `openclaw_memory_read_today` | Read today's memory log |
| `openclaw_memory_search` | Search across daily memory files for a keyword (default: last 14 days) |

## Cron (OpenClaw server via SSH)

| Tool | Description |
|------|-------------|
| `openclaw_cron_list` | List all scheduled cron jobs |
| `openclaw_cron_run` | Trigger a cron job immediately by ID |
| `openclaw_cron_status` | Get scheduler status and overview |
| `openclaw_cron_create` | Create a new cron job (cron expr, interval "every 30m", or one-shot "+20m") |
| `openclaw_cron_edit` | Edit an existing cron job (name, message, schedule, model) |
| `openclaw_cron_delete` | Delete a cron job by ID |
| `openclaw_cron_history` | Show recent execution history, optionally filtered by job ID |

## OpenClaw Server

| Tool | Description |
|------|-------------|
| `openclaw_run` | Send a task to the OpenClaw AI agent via SSH (trading, automation, workflows) |
| `openclaw_status` | Check if the OpenClaw daemon is running and get version info |
| `openclaw_plugins` | List all installed OpenClaw plugins |
| `openclaw_notify` | Send notifications via WhatsApp, Telegram, or last-used channel |
| `openclaw_logs` | Tail OpenClaw server logs with line count and keyword filtering |
| `file_transfer` | Upload/download/list files on the OpenClaw server via SCP (up to 10MB) |

## Local LLM Management

| Tool | Description |
|------|-------------|
| `local_llm_run` | Send a prompt to a local LLM (LM Studio, Ollama, llama.cpp). stream=true for live tokens |
| `local_llm_models` | List, load, or unload models on the local LLM server (LM Studio: no GUI needed) |
| `llama_server` | Start/stop a llama.cpp server: model, cache type (turbo2/3/4), GPU layers, context size |

## Orchestration and Routing

| Tool | Description |
|------|-------------|
| `mcp_help` | This guide. Provide a task description for routing recommendations |
| `prompt_split` | Analyze a complex prompt, split into sub-tasks with agent assignments |
| `prompt_split_execute` | Execute a split plan: dispatch to agents in dependency order with rate limiting |

## System

| Tool | Description |
|------|-------------|
| `system_status` | Check health of all services (HA, SSH, LLM, Gemini, Codex) with latency |

## Decision Guide

- **Coding** -> `codex_run`
- **Trading/portfolio** -> `openclaw_run`
- **Long docs/analysis** -> `gemini_run`
- **Simple format/classify** -> `local_llm_run`
- **Smart home** -> `home_*` tools directly
- **Multi-step task** -> `prompt_split` then `prompt_split_execute`
- **Send results** -> `openclaw_notify`
- **Schedule task** -> `openclaw_cron_create`
- **Health check** -> `system_status`
