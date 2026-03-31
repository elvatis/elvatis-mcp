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
      'research', 'overview', 'draft', 'write an email', 'second opinion',
    ],
    reason: 'Gemini excels at analysis, long-context tasks (1M tokens), and multimodal input.',
  },
  {
    tool: 'openclaw_run',
    keywords: [
      'trade', 'trading', 'portfolio', 'stock', 'position', 'pnl', 'market',
      'plugin', 'automation', 'workflow', 'whatsapp',
      'telegram', 'notify', 'alert', 'openclaw',
    ],
    reason: 'OpenClaw has all trading plugins and custom workflows installed.',
  },
  {
    tool: 'local_llm_run',
    keywords: [
      'quick', 'simple', 'local', 'offline', 'private', 'classify', 'label',
      'rewrite', 'format', 'short answer', 'yes or no', 'extract', 'parse',
      'convert', 'json', 'csv', 'rephrase', 'proofread', 'grammar',
    ],
    reason: 'Local LLM is free, fast, and private. Best for simple classification, formatting, and extraction tasks.',
  },
  {
    tool: 'home_light / home_scene / home_sensors / home_climate / home_vacuum',
    keywords: [
      'light', 'lamp', 'bright', 'scene', 'temperature', 'thermostat',
      'vacuum', 'sensor', 'humidity', 'co2', 'room', 'living room', 'bedroom',
      'kitchen', 'home assistant', 'smart home',
    ],
    reason: 'Home tools connect directly to Home Assistant.',
  },
  {
    tool: 'openclaw_memory_write / openclaw_memory_read_today / openclaw_memory_search',
    keywords: [
      'remember', 'note', 'memory', 'log', 'record', 'save this', 'remind',
      'what did i', 'yesterday', 'last week', 'wrote down',
    ],
    reason: 'Memory tools read and write the daily log on the OpenClaw server.',
  },
  {
    tool: 'openclaw_cron_list / openclaw_cron_run / openclaw_cron_status',
    keywords: [
      'cron', 'scheduled', 'job', 'task', 'trigger', 'run now', 'schedule',
    ],
    reason: 'Cron tools manage and trigger OpenClaw scheduled jobs.',
  },
];

/** Score routing rules against a text. Returns matches sorted by score (highest first). */
export function matchRules(text: string): Array<{ tool: string; reason: string; score: number }> {
  const lower = text.toLowerCase();
  const matches: Array<{ tool: string; reason: string; score: number }> = [];

  for (const rule of ROUTING_RULES) {
    const score = rule.keywords.filter(kw => lower.includes(kw)).length;
    if (score > 0) {
      matches.push({ tool: rule.tool, reason: rule.reason, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

/** Known single-call tool names (for validation in prompt_split). */
export const KNOWN_AGENTS = new Set([
  'codex_run', 'gemini_run', 'openclaw_run', 'local_llm_run',
  'home_light', 'home_scene', 'home_sensors', 'home_climate',
  'home_vacuum', 'home_get_state',
  'openclaw_memory_write', 'openclaw_memory_read_today', 'openclaw_memory_search',
  'openclaw_cron_list', 'openclaw_cron_run', 'openclaw_cron_status',
]);

export const ROUTING_GUIDE = `
# elvatis-mcp: Sub-Agent Routing Guide

## Sub-Agents (spawn a separate AI to handle a task)

| Tool | Backend | Auth | Strengths |
|------|---------|------|-----------|
| \`openclaw_run\` | OpenClaw (claude/gpt/gemini + plugins) | SSH key | Trading plugins, automations, custom workflows, multi-step tasks |
| \`gemini_run\` | Google Gemini | Google login (cached) | Long context (1M tokens), multimodal, fast analysis, second opinions |
| \`codex_run\` | OpenAI Codex | OpenAI login (cached) | Coding, debugging, refactoring, file editing, shell scripting |
| \`local_llm_run\` | Local LLM (Ollama/LM Studio/llama.cpp) | None | Free, private, fast for simple tasks (classify, format, extract, rewrite) |

## Home Automation Tools (direct Home Assistant calls)

| Tool | What it does |
|------|-------------|
| \`home_light\` | Control any light (on/off/brightness/color) |
| \`home_climate\` | Set thermostat temperature and HVAC mode |
| \`home_scene\` | Activate a Hue scene in a room |
| \`home_vacuum\` | Start, stop, or dock the robot vacuum |
| \`home_sensors\` | Read all temp/humidity/CO2 sensors |
| \`home_get_state\` | Read any Home Assistant entity |

## Memory Tools (OpenClaw server)

| Tool | What it does |
|------|-------------|
| \`openclaw_memory_write\` | Write a note to today's log |
| \`openclaw_memory_read_today\` | Read today's memory log |
| \`openclaw_memory_search\` | Search memory across past N days |

## Cron Tools (OpenClaw server)

| Tool | What it does |
|------|-------------|
| \`openclaw_cron_list\` | List all scheduled cron jobs |
| \`openclaw_cron_run\` | Trigger a job immediately |
| \`openclaw_cron_status\` | Get scheduler status and recent runs |

## Prompt Splitting

| Tool | What it does |
|------|-------------|
| \`prompt_split\` | Analyze a complex prompt and split into sub-tasks with agent assignments |

## Decision Guide

- **Coding task** (write/fix/refactor code, shell scripts) -> \`codex_run\`
- **Trading/portfolio/market task** -> \`openclaw_run\`
- **Long document, image, or analysis** -> \`gemini_run\`
- **Simple formatting, extraction, classification** -> \`local_llm_run\`
- **Smart home control** -> appropriate \`home_*\` tool (no sub-agent needed)
- **Cross-check / second opinion** -> run both \`gemini_run\` and compare
- **Complex multi-step task** -> \`prompt_split\` first, then execute the plan
- **Coding task that also needs context** -> \`codex_run\` first, then \`gemini_run\` to review
`.trim();
