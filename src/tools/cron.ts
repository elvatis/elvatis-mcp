import { z } from 'zod';
import { Config } from '../config.js';

async function gatewayRequest(config: Config, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.gatewayToken) headers['Authorization'] = `Bearer ${config.gatewayToken}`;
  const res = await fetch(`${config.gatewayUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Gateway API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const cronTools = [
  {
    name: 'cron_list',
    description: 'List all scheduled OpenClaw cron jobs',
    schema: z.object({
      include_disabled: z.boolean().default(false).describe('Include disabled jobs'),
    }),
    handler: async (args: { include_disabled: boolean }, config: Config) => {
      const jobs = await gatewayRequest(config, 'GET', `/api/cron/jobs${args.include_disabled ? '?includeDisabled=true' : ''}`);
      return jobs;
    },
  },

  {
    name: 'cron_run',
    description: 'Trigger a cron job immediately by its ID',
    schema: z.object({
      job_id: z.string().describe('Cron job ID (UUID)'),
    }),
    handler: async (args: { job_id: string }, config: Config) => {
      const result = await gatewayRequest(config, 'POST', `/api/cron/jobs/${args.job_id}/run`, {});
      return result;
    },
  },

  {
    name: 'cron_status',
    description: 'Get cron scheduler status and overview',
    schema: z.object({}),
    handler: async (_args: Record<string, never>, config: Config) => {
      const status = await gatewayRequest(config, 'GET', '/api/cron/status');
      return status;
    },
  },
] as const;
