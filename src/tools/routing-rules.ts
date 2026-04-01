/**
 * Shared routing rules and constants used by mcp_help and prompt_split.
 *
 * Extracted so both tools operate from the same knowledge base.
 */

export interface RoutingRule {
  tool: string;
  keywords: string[];
  reason: string;
}

export const ROUTING_RULES: RoutingRule[] = [
  {
    tool: 'claude_run',
    keywords: [
      'claude', 'anthropic', 'complex', 'nuanced',
      'creative', 'essay', 'strategy', 'plan',
      'cross-check', 'second opinion', 'verify',
    ],
    reason: 'Claude excels at complex reasoning, nuanced writing, strategic planning, and code review. Essential when the MCP client is not Claude itself.',
  },
  {
    tool: 'codex_run',
    keywords: [
      'code', 'debug', 'refactor', 'function', 'class', 'bug', 'test', 'script',
      'typescript', 'javascript', 'python', 'error', 'compile', 'build', 'lint',
      'implement', 'write a', 'fix the', 'generate code', 'shell', 'bash',
    ],
    reason: 'Coding and file-editing tasks are Codex\'s specialty.',
  },
  {
    tool: 'gemini_run',
    keywords: [
      'summarize', 'explain', 'analyze', 'what is', 'describe', 'translate',
      'image', 'photo', 'screenshot', 'long', 'document', 'pdf', 'compare',
      'research', 'overview', 'draft', 'write an email', 'proofread',
    ],
    reason: 'Gemini excels at analysis, long-context tasks (1M tokens), and multimodal input.',
  },
  {
    tool: 'openclaw_run',
    keywords: [
      'trade', 'trading', 'portfolio', 'stock', 'position', 'pnl', 'market',
      'plugin', 'automation', 'workflow', 'openclaw',
    ],
    reason: 'OpenClaw has all trading plugins and custom workflows installed.',
  },
  {
    tool: 'local_llm_run',
    keywords: [
      'quick', 'simple', 'local', 'offline', 'private', 'classify', 'label',
      'rewrite', 'format', 'short answer', 'yes or no', 'extract', 'parse',
      'convert', 'json', 'csv', 'rephrase', 'grammar', 'markdown',
      'positive', 'negative', 'neutral', 'sentiment',
      'local model', 'locally',
    ],
    reason: 'Local LLM is free, fast, and private. Best for simple classification, formatting, and extraction tasks.',
  },
  // --- Home automation: split into individual tools for better routing ---
  {
    tool: 'home_sensors',
    keywords: [
      'sensor', 'sensors', 'humidity', 'co2', 'temperature reading',
      'read all sensor', 'sensor data', 'air quality',
    ],
    reason: 'Read sensor values from Home Assistant.',
  },
  {
    tool: 'home_light',
    keywords: [
      'light', 'lamp', 'bright', 'dim', 'turn on', 'turn off',
      'bedroom light', 'living room light', 'kitchen light',
    ],
    reason: 'Control lights via Home Assistant.',
  },
  {
    tool: 'home_climate',
    keywords: [
      'thermostat', 'heating', 'cooling', 'hvac', 'ventilation',
      'set temperature', 'climate', 'degrees',
    ],
    reason: 'Control climate/HVAC via Home Assistant.',
  },
  {
    tool: 'home_scene',
    keywords: ['scene', 'mood', 'ambiance'],
    reason: 'Activate Hue scenes via Home Assistant.',
  },
  {
    tool: 'home_vacuum',
    keywords: ['vacuum', 'robot vacuum', 'roomba', 'clean'],
    reason: 'Control robot vacuum via Home Assistant.',
  },
  // --- Memory: split into read vs write for better routing ---
  {
    tool: 'openclaw_memory_search',
    keywords: [
      'search memory', 'search my memory', 'find in memory',
      'what did i', 'yesterday', 'last week', 'wrote down', 'look up',
    ],
    reason: 'Search across past daily memory logs.',
  },
  {
    tool: 'openclaw_memory_write',
    keywords: [
      'remember', 'note', 'save this', 'save to memory', 'write to memory',
      'remind', 'log this', 'record this',
    ],
    reason: 'Write a note to today\'s memory log.',
  },
  {
    tool: 'openclaw_memory_read_today',
    keywords: ['today memory', 'today log', 'read today', 'today notes'],
    reason: 'Read today\'s memory log.',
  },
  {
    tool: 'openclaw_notify',
    keywords: [
      'whatsapp', 'telegram', 'notify', 'notification', 'send message',
      'send results', 'alert user', 'send via',
    ],
    reason: 'Send notifications via WhatsApp/Telegram through OpenClaw.',
  },
  {
    tool: 'openclaw_cron_list / openclaw_cron_run / openclaw_cron_status',
    keywords: [
      'cron', 'scheduled', 'job', 'trigger', 'run now', 'schedule',
    ],
    reason: 'Cron tools manage and trigger OpenClaw scheduled jobs.',
  },
];

/**
 * Score routing rules against a text using word boundary matching.
 * Returns matches sorted by score (highest first).
 *
 * Uses \\b word boundaries to prevent partial matches like "reviews" matching "review".
 * Multi-word keywords use includes() since they act as phrase matches.
 */
export function matchRules(text: string): Array<{ tool: string; reason: string; score: number }> {
  const lower = text.toLowerCase();
  const matches: Array<{ tool: string; reason: string; score: number }> = [];

  for (const rule of ROUTING_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (kw.includes(' ')) {
        // Multi-word keyword: use phrase matching (includes)
        if (lower.includes(kw)) score++;
      } else {
        // Single-word keyword: use word boundary regex to avoid partial matches
        const re = new RegExp(`\\b${kw}\\b`, 'i');
        if (re.test(lower)) score++;
      }
    }
    if (score > 0) {
      matches.push({ tool: rule.tool, reason: rule.reason, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

/** Known single-call tool names (for validation in prompt_split). */
export const KNOWN_AGENTS = new Set([
  'claude_run', 'codex_run', 'gemini_run', 'openclaw_run', 'local_llm_run',
  'home_light', 'home_scene', 'home_sensors', 'home_climate',
  'home_vacuum', 'home_get_state', 'home_automation',
  'openclaw_memory_write', 'openclaw_memory_read_today', 'openclaw_memory_search',
  'openclaw_cron_list', 'openclaw_cron_run', 'openclaw_cron_status',
  'openclaw_notify', 'openclaw_logs', 'system_status', 'local_llm_models', 'file_transfer',
]);

export const ROUTING_GUIDE = `
# elvatis-mcp: Sub-Agent Routing Guide (34 tools)

## Sub-Agents (spawn a separate AI to handle a task)

| Tool | Backend | Auth | Strengths |
|------|---------|------|-----------|
| \`claude_run\` | Claude (Anthropic) | Claude Code login | Complex reasoning, nuanced writing, code review. Use when MCP client is not Claude. |
| \`openclaw_run\` | OpenClaw (claude/gpt/gemini + plugins) | SSH key | Trading plugins, automations, custom workflows, multi-step tasks |
| \`gemini_run\` | Google Gemini | Google login (cached) | Long context (1M tokens), multimodal, fast analysis, second opinions |
| \`codex_run\` | OpenAI Codex | OpenAI login (cached) | Coding, debugging, refactoring, file editing, shell scripting |
| \`local_llm_run\` | Local LLM (Ollama/LM Studio/llama.cpp) | None | Free, private, fast for simple tasks (classify, format, extract, rewrite) |

## Home Automation (direct Home Assistant calls)

| Tool | What it does |
|------|-------------|
| \`home_light\` | Control any light (on/off/brightness/color) |
| \`home_climate\` | Set thermostat temperature and HVAC mode |
| \`home_scene\` | Activate a Hue scene in a room |
| \`home_vacuum\` | Start, stop, or dock the robot vacuum |
| \`home_sensors\` | Read all temp/humidity/CO2 sensors |
| \`home_get_state\` | Read any Home Assistant entity |
| \`home_automation\` | List, trigger, enable, or disable HA automations |

## Memory (OpenClaw server via SSH)

| Tool | What it does |
|------|-------------|
| \`openclaw_memory_write\` | Write a note to today's log |
| \`openclaw_memory_read_today\` | Read today's memory log |
| \`openclaw_memory_search\` | Search memory across past N days |

## Cron (OpenClaw server via SSH)

| Tool | What it does |
|------|-------------|
| \`openclaw_cron_list\` | List all scheduled cron jobs |
| \`openclaw_cron_run\` | Trigger a job immediately |
| \`openclaw_cron_status\` | Get scheduler status and recent runs |
| \`openclaw_cron_create\` | Create a new cron job (cron expr, interval, or one-shot) |
| \`openclaw_cron_edit\` | Edit an existing cron job |
| \`openclaw_cron_delete\` | Delete a cron job by ID |
| \`openclaw_cron_history\` | View execution history for cron jobs |

## OpenClaw Server

| Tool | What it does |
|------|-------------|
| \`openclaw_status\` | Check if the OpenClaw daemon is running |
| \`openclaw_plugins\` | List installed OpenClaw plugins |
| \`openclaw_notify\` | Send notifications via WhatsApp or Telegram |
| \`openclaw_logs\` | Tail OpenClaw server logs with optional filtering |
| \`file_transfer\` | Upload/download files to/from OpenClaw server via SCP |

## Local LLM Management

| Tool | What it does |
|------|-------------|
| \`local_llm_models\` | List, load, or unload models on the local LLM server |
| \`llama_server\` | Start/stop a llama.cpp inference server |

## Orchestration and Routing

| Tool | What it does |
|------|-------------|
| \`mcp_help\` | This guide. Optionally provide a task for routing recommendations |
| \`prompt_split\` | Analyze a complex prompt, split into sub-tasks with agent assignments |
| \`prompt_split_execute\` | Execute a split plan: dispatches to agents in dependency order with rate limiting |

## System

| Tool | What it does |
|------|-------------|
| \`system_status\` | Check health of all services (HA, SSH, LLM, Gemini, Codex) with latency |

## Decision Guide

- **Coding task** (write/fix/refactor code, shell scripts) -> \`codex_run\`
- **Trading/portfolio/market task** -> \`openclaw_run\`
- **Long document, image, or analysis** -> \`gemini_run\`
- **Simple formatting, extraction, classification** -> \`local_llm_run\`
- **Smart home control** -> appropriate \`home_*\` tool (no sub-agent needed)
- **Cross-check / second opinion** -> run both \`gemini_run\` and compare
- **Complex multi-step task** -> \`prompt_split\` first, review, then \`prompt_split_execute\`
- **Coding task that also needs context** -> \`codex_run\` first, then \`gemini_run\` to review
- **Send results to user** -> \`openclaw_notify\` (WhatsApp/Telegram)
- **Schedule a recurring task** -> \`openclaw_cron_create\`
- **Check system health** -> \`system_status\`
`.trim();
