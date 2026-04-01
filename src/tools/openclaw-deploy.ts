/**
 * openclaw_deploy: trigger deployment scripts on the OpenClaw server via SSH.
 *
 * Scripts live in OPENCLAW_DEPLOY_SCRIPT_DIR (default: ~/deploy) and follow
 * the naming convention: deploy-{service}.sh, rollback-{service}.sh
 * Status reads the last 30 lines of ~/deploy/logs/{service}.log if it exists.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';

// --- Schema ---

export const openclawDeploySchema = z.object({
  service: z.string().describe('Service name to deploy, e.g. "api", "worker", "frontend"'),
  action: z.enum(['deploy', 'rollback', 'status'])
    .describe('deploy: run deploy script, rollback: run rollback script, status: show last deploy log'),
});

// --- Handler ---

export async function handleOpenclawDeploy(
  args: z.infer<typeof openclawDeploySchema>,
  config: Config,
): Promise<{ success: boolean; output?: string; error?: string; service: string; action: string }> {
  const cfg: SshConfig = {
    host: config.sshHost,
    port: config.sshPort,
    username: config.sshUser,
    keyPath: config.sshKeyPath,
  };

  const scriptDir = config.deployScriptDir ?? '~/deploy';
  const { service, action } = args;

  const cmds: Record<string, string> = {
    deploy:   `bash ${scriptDir}/deploy-${service}.sh 2>&1`,
    rollback: `bash ${scriptDir}/rollback-${service}.sh 2>&1`,
    status:   `if [ -f ${scriptDir}/logs/${service}.log ]; then tail -30 ${scriptDir}/logs/${service}.log; else echo "No log found at ${scriptDir}/logs/${service}.log"; fi`,
  };

  try {
    const output = await sshExec(cfg, cmds[action]!, 120_000);
    return { success: true, output: output.trimEnd(), service, action };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      service,
      action,
    };
  }
}
