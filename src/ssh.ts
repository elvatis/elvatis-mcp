/**
 * SSH exec helper — runs shell commands on the OpenClaw server.
 * Uses the system `ssh` binary (OpenSSH, available on Windows 10+, macOS, Linux).
 * No additional npm dependencies required.
 *
 * Set SSH_DEBUG=1 in your environment to enable verbose SSH output (-vvv).
 */

import { spawn } from 'child_process';
import * as os from 'os';

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  /** Path to private key, ~ is expanded to os.homedir() */
  keyPath: string;
}

/**
 * Execute a shell command on the remote host and return stdout as a string.
 * Throws if the command exits with a non-zero code or times out.
 */
export function sshExec(cfg: SshConfig, command: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const keyPath = cfg.keyPath.replace(/^~/, os.homedir());
    const debug = process.env['SSH_DEBUG'] === '1';

    const args = [
      '-i', keyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',           // never prompt for password
      '-o', 'ConnectTimeout=8',
      '-p', String(cfg.port),
    ];

    if (debug) {
      args.push('-vvv');
    }

    args.push(`${cfg.username}@${cfg.host}`, command);

    // On Windows, spawn without shell — PATH must contain the ssh binary.
    // Pass stdio explicitly so both stdout and stderr are always piped.
    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(
        `SSH timed out after ${timeoutMs}ms (host: ${cfg.host}:${cfg.port}, user: ${cfg.username}, key: ${keyPath})`,
      ));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // Build a helpful error that includes connection details and any output.
        // Exit 255 = SSH connection-level failure (wrong key, unreachable host, etc.)
        const detail = stderr.trim() || stdout.trim() || 'no output from ssh';
        const hint = code === 255
          ? ` | Tip: verify SSH_HOST (${cfg.host}), SSH_USER (${cfg.username}), SSH_KEY_PATH (${keyPath}) in your .env. Set SSH_DEBUG=1 for verbose logs.`
          : '';
        reject(new Error(`SSH failed (exit ${code}) connecting to ${cfg.username}@${cfg.host}:${cfg.port}: ${detail}${hint}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          'ssh binary not found in PATH. ' +
          'Windows: Settings > Optional Features > OpenSSH Client. ' +
          'macOS/Linux: should be pre-installed.',
        ));
      } else {
        reject(err);
      }
    });
  });
}

/** Read a file on the remote host. Returns empty string if file does not exist. */
export async function sshReadFile(cfg: SshConfig, remotePath: string): Promise<string> {
  return sshExec(cfg, `cat ${remotePath} 2>/dev/null || true`);
}

/**
 * Append content to a remote file, creating the directory if needed.
 * Content is base64-encoded to survive shell escaping of special characters.
 */
export async function sshAppendFile(cfg: SshConfig, remotePath: string, content: string): Promise<void> {
  const encoded = Buffer.from(content).toString('base64');
  const dir = remotePath.replace(/\/[^/]+$/, '');
  await sshExec(cfg, `mkdir -p ${dir} && echo "${encoded}" | base64 -d >> ${remotePath}`);
}
