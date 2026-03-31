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
import { matchRules, ROUTING_GUIDE } from './routing-rules.js';

// --- Schema ---

export const mcpHelpSchema = z.object({
  task: z.string().optional().describe(
    'Optional: describe your task or question. If provided, returns a specific ' +
    'routing recommendation for which tool(s) to use.',
  ),
});

// --- Handler ---

export async function handleMcpHelp(args: { task?: string }) {
  if (!args.task) {
    return { guide: ROUTING_GUIDE };
  }

  // Analyze the task and recommend tools
  const matches = matchRules(args.task);

  const recommendation = matches.length > 0
    ? matches.slice(0, 2).map(m => `- **${m.tool}**: ${m.reason}`).join('\n')
    : '- No strong signal. Consider `gemini_run` for general questions or `openclaw_run` for complex multi-step tasks.';

  return {
    task: args.task,
    recommendation,
    guide: ROUTING_GUIDE,
  };
}
