/**
 * home_automation — list, trigger, and toggle Home Assistant automations.
 *
 * Uses the HA REST API to manage automations without editing YAML.
 * Creating new automations is complex (requires HA YAML knowledge),
 * so this tool focuses on listing, triggering, and enabling/disabling.
 */

import { z } from 'zod';
import { Config } from '../config.js';

export const homeAutomationSchema = z.object({
  action: z.enum(['list', 'trigger', 'enable', 'disable']).describe(
    'Action: "list" shows all automations, "trigger" fires one immediately, '
    + '"enable"/"disable" toggles an automation on or off.',
  ),
  entity_id: z.string().optional().describe(
    'Automation entity ID (e.g. "automation.lights_off_at_night"). Required for trigger/enable/disable.',
  ),
});

async function haRequest(config: Config, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  if (!config.haToken) throw new Error('HA_TOKEN not configured');
  const res = await fetch(`${config.haUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.haToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HA API ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

interface HaState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    last_triggered?: string;
    current?: number;
    [key: string]: unknown;
  };
}

export async function handleHomeAutomation(
  args: { action: string; entity_id?: string },
  config: Config,
) {
  if (args.action === 'list') {
    const states = await haRequest(config, 'GET', '/api/states') as HaState[];
    const automations = states
      .filter(s => s.entity_id.startsWith('automation.'))
      .map(s => ({
        entity_id: s.entity_id,
        name: s.attributes.friendly_name ?? s.entity_id,
        state: s.state,  // 'on' = enabled, 'off' = disabled
        last_triggered: s.attributes.last_triggered ?? 'never',
      }));

    return {
      success: true,
      count: automations.length,
      automations,
    };
  }

  // All other actions require entity_id
  if (!args.entity_id) {
    return { success: false, error: '"entity_id" is required for trigger/enable/disable.' };
  }

  const id = args.entity_id;

  switch (args.action) {
    case 'trigger':
      await haRequest(config, 'POST', '/api/services/automation/trigger', { entity_id: id });
      return { success: true, action: 'trigger', entity_id: id };

    case 'enable':
      await haRequest(config, 'POST', '/api/services/automation/turn_on', { entity_id: id });
      return { success: true, action: 'enable', entity_id: id };

    case 'disable':
      await haRequest(config, 'POST', '/api/services/automation/turn_off', { entity_id: id });
      return { success: true, action: 'disable', entity_id: id };

    default:
      return { success: false, error: `Unknown action: ${args.action}` };
  }
}
