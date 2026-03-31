/**
 * OpenClaw cron tools — reads from ~/.openclaw/cron/jobs.json via SSH.
 *
 * OpenClaw uses a WebSocket gateway (not REST), so we access cron state
 * directly from the server's filesystem over SSH.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, sshReadFile, SshConfig } from '../ssh.js';

const CRON_JOBS_FILE = '~/.openclaw/cron/jobs.json';

// --- Schemas ---

export const cronListSchema = z.object({
  include_disabled: z.boolean().default(false).describe('Include disabled jobs'),
});

export const cronRunSchema = z.object({
  job_id: z.string().describe('Cron job ID (UUID)'),
});

export const cronStatusSchema = z.object({});

// --- Helpers ---

function toSshCfg(config: Config): SshConfig {
  return {
    host: config.sshHost,
    port: config.sshPort,
    username: config.sshUser,
    keyPath: config.sshKeyPath,
  };
}

async function readJobs(config: Config): Promise<Array<Record<string, unknown>>> {
  const raw = await sshReadFile(toSshCfg(config), CRON_JOBS_FILE);
  if (!raw.trim()) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse ${CRON_JOBS_FILE}: ${e}`);
  }
}

// --- Handlers ---

export async function handleCronList(args: { include_disabled: boolean }, config: Config) {
  const jobs = await readJobs(config);
  const filtered = args.include_disabled
    ? jobs
    : jobs.filter(j => j['enabled'] !== false);
  return { jobs: filtered, total: filtered.length };
}

export async function handleCronRun(args: { job_id: string }, config: Config) {
  // Try the OpenClaw CLI to trigger the job.
  // Command: openclaw cron run <id>
  // Adjust OPENCLAW_CLI_CMD in env if the CLI syntax differs on your server.
  try {
    const output = await sshExec(
      toSshCfg(config),
      `openclaw cron run ${args.job_id}`,
      30_000,
    );
    return { success: true, job_id: args.job_id, output: output.trim() };
  } catch (err) {
    // Fallback: find the job in jobs.json and report the command that would run
    const jobs = await readJobs(config);
    const job = jobs.find(j => j['id'] === args.job_id);
    if (!job) throw new Error(`Job ${args.job_id} not found`);
    return {
      success: false,
      job_id: args.job_id,
      error: String(err),
      note: 'CLI trigger failed. Set OPENCLAW_CLI_CMD env var to the correct command.',
      job,
    };
  }
}

export async function handleCronStatus(_args: Record<string, never>, config: Config) {
  const jobs = await readJobs(config);
  const total = jobs.length;
  const enabled = jobs.filter(j => j['enabled'] !== false).length;
  const disabled = total - enabled;
  // Summarize recent runs if the jobs have lastRun fields
  const recentRuns = jobs
    .filter(j => j['lastRun'])
    .sort((a, b) => String(b['lastRun']).localeCompare(String(a['lastRun'])))
    .slice(0, 5)
    .map(j => ({ id: j['id'], name: j['name'], lastRun: j['lastRun'] }));
  return { total, enabled, disabled, recentRuns, source: CRON_JOBS_FILE };
}
