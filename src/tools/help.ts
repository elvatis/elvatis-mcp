/**
 * mcp_help — routing guide and task-to-tool recommender.
 *
 * Returns a structured guide of all available sub-agents and their strengths.
 * When a task description is provided, analyzes it and recommends the best tool(s).
 *
 * This tool is intended for:
 *   - Users who want to know what sub-agents are available
 *   - Claude itself, to auto-route complex tasks to the right backend
 *   - The /mcp-help slash command in Claude Code and Cowork
 */

import { z } from 'zod';

// --- Schema ---

export const mcpHelpSchema = z.object({
  task: z.string().optional().describe(
    'Optional: describe your task or question. If provided, returns a specific ' +
    'routing recommendation for which tool(s) to use.',
  ),
});

// --- Routing rules ---
// Simple keyword-based routing heuristics. Claude will make the final call.

interface RoutingRule {
  tool: string;
  keywords: string[];
  reason: string;
}

const ROUTING_RULES: RoutingRule[] = [
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
      'plugin', 'schedule', 'automation', 'cron', 'workflow', 'whatsapp',
      'telegram', 'notify', 'alert', 'openclaw',
    ],
    reason: 'OpenClaw has all trading plugins and custom workflows installed.',
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
    tool: 'memory_write / memory_read_today / memory_search',
    keywords: [
      'remember', 'note', 'memory', 'log', 'record', 'save this', 'remind',
      'what did i', 'yesterday', 'last week', 'wrote down',
    ],
    reason: 'Memory tools read and write the daily log on the OpenClaw server.',
  },
  {
    tool: 'cron_list / cron_run / cron_status',
    keywords: [
      'cron', 'scheduled', 'job', 'task', 'trigger', 'run now', 'schedule',
    ],
    reason: 'Cron tools manage and trigger OpenClaw scheduled jobs.',
  },
];

const ROUTING_GUIDE = `
# elvatis-mcp: Sub-Agent Routing Guide

## Sub-Agents (spawn a separate AI to handle a task)

| Tool | Backend | Auth | Strengths |
|------|---------|------|-----------|
| \`openclaw_run\` | OpenClaw (claude/gpt/gemini + plugins) | SSH key | Trading plugins, automations, custom workflows, multi-step tasks |
| \`gemini_run\` | Google Gemini | Google login (cached) | Long context (1M tokens), multimodal, fast analysis, second opinions |
| \`codex_run\` | OpenAI Codex | OpenAI login (cached) | Coding, debugging, refactoring, file editing, shell scripting |

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
| \`memory_write\` | Write a note to today's log |
| \`memory_read_today\` | Read today's memory log |
| \`memory_search\` | Search memory across past N days |

## Cron Tools (OpenClaw server)

| Tool | What it does |
|------|-------------|
| \`cron_list\` | List all scheduled cron jobs |
| \`cron_run\` | Trigger a job immediately |
| \`cron_status\` | Get scheduler status and recent runs |

## Decision Guide

- **Coding task** (write/fix/refactor code, shell scripts) → \`codex_run\`
- **Trading/portfolio/market task** → \`openclaw_run\`
- **Long document, image, or analysis** → \`gemini_run\`
- **Smart home control** → appropriate \`home_*\` tool (no sub-agent needed)
- **Cross-check / second opinion** → run both \`gemini_run\` and compare
- **Complex multi-step task** → \`openclaw_run\` (full plugin stack available)
- **Coding task that also needs context** → \`codex_run\` first, then \`gemini_run\` to review
`.trim();

// --- Handler ---

export async function handleMcpHelp(args: { task?: string }) {
  if (!args.task) {
    return { guide: ROUTING_GUIDE };
  }

  // Analyze the task and recommend tools
  const taskLower = args.task.toLowerCase();
  const matches: Array<{ tool: string; reason: string; score: number }> = [];

  for (const rule of ROUTING_RULES) {
    const score = rule.keywords.filter(kw => taskLower.includes(kw)).length;
    if (score > 0) {
      matches.push({ tool: rule.tool, reason: rule.reason, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  const recommendation = matches.length > 0
    ? matches.slice(0, 2).map(m => `- **${m.tool}**: ${m.reason}`).join('\n')
    : '- No strong signal. Consider `gemini_run` for general questions or `openclaw_run` for complex multi-step tasks.';

  return {
    task: args.task,
    recommendation,
    guide: ROUTING_GUIDE,
  };
}
