import { z } from 'zod';
import { Config } from '../config.js';

async function gatewayRequest(config: Config, method: string, path: string, body?: unknown): Promise<unknown> {
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

// --- Schemas ---

export const cronListSchema = {
  include_disabled: z.boolean().default(false).describe('Include disabled jobs'),
};

export const cronRunSchema = {
  job_id: z.string().describe('Cron job ID (UUID)'),
};

export const cronStatusSchema = {};

// --- Handlers ---

export async function handleCronList(args: { include_disabled: boolean }, config: Config) {
  const qs = args.include_disabled ? '?includeDisabled=true' : '';
  return gatewayRequest(config, 'GET', `/api/cron/jobs${qs}`);
}

export async function handleCronRun(args: { job_id: string }, config: Config) {
  return gatewayRequest(config, 'POST', `/api/cron/jobs/${args.job_id}/run`, {});
}

export async function handleCronStatus(_args: Record<string, never>, config: Config) {
  return gatewayRequest(config, 'GET', '/api/cron/status');
}
