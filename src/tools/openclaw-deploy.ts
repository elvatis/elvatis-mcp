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
import { validateDeployService, shellQuote } from '../validate.js';

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
  const { action } = args;

  // Validate service name before any shell interpolation. The service value is
  // embedded into script filenames and log paths on the remote shell, so it must
  // consist only of safe characters (alphanumerics, hyphens, underscores).
  let service: string;
  try {
    service = validateDeployService(args.service);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      service: args.service,
      action,
    };
  }

  // Shell-quote the script dir (may contain tilde or user-supplied path).
  const qDir = shellQuote(scriptDir);
  const cmds: Record<string, string> = {
    deploy:   `bash ${qDir}/deploy-${service}.sh 2>&1`,
    rollback: `bash ${qDir}/rollback-${service}.sh 2>&1`,
    status:   `if [ -f ${qDir}/logs/${service}.log ]; then tail -30 ${qDir}/logs/${service}.log; else echo "No log found at ${qDir}/logs/${service}.log"; fi`,
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
