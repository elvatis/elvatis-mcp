/**
 * SSH exec helper — runs shell commands on the OpenClaw server.
 * Uses the system `ssh` binary (OpenSSH, available on Windows 10+, macOS, Linux).
 * No additional npm dependencies required.
 *
 * Set SSH_DEBUG=1 in your environment to enable verbose SSH output (-vvv).
 */

import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  /** Path to private key, ~ is expanded to os.homedir() */
  keyPath: string;
}

/**
 * Resolve the SSH binary path on Windows.
 * Windows OpenSSH (System32) requires console APIs that are unavailable in
 * Electron-spawned Node.js processes (CWD=C:\Windows\System32, no console).
 * Git's ssh.exe works in any stdio context and is preferred when available.
 */
function sshBinary(): string {
  if (process.platform !== 'win32') return 'ssh';
  // Prefer Git's ssh — works in all Windows stdio contexts
  const gitSsh = 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
  if (require('fs').existsSync(gitSsh)) return gitSsh;
  // Fallback to Windows OpenSSH
  const root = process.env['SystemRoot'] || process.env['systemroot'] || 'C:\\Windows';
  return path.join(root, 'System32', 'OpenSSH', 'ssh.exe');
}

/**
 * Build the environment for the SSH child process.
 * Keep it simple: inherit process.env with HOME set.
 * No PATH manipulation — using the absolute ssh binary path instead.
 */
function sshEnv(): NodeJS.ProcessEnv {
  return { ...process.env, HOME: os.homedir() };
}

/** Normalize a file path to forward slashes (SSH on Windows needs this). */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Execute a shell command on the remote host and return stdout as a string.
 * Throws if the command exits with a non-zero code or times out.
 * On transient failures (exit 255), retries once after a short delay.
 */
export async function sshExec(cfg: SshConfig, command: string, timeoutMs = 15_000): Promise<string> {
  try {
    return await sshExecOnce(cfg, command, timeoutMs);
  } catch (err: unknown) {
    // Retry once on exit 255 (connection-level failure, often transient on Windows)
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('exit 255')) {
      await new Promise(r => setTimeout(r, 1000));
      return sshExecOnce(cfg, command, timeoutMs);
    }
    throw err;
  }
}

function sshExecOnce(cfg: SshConfig, command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Expand ~ and normalize to forward slashes for cross-platform SSH compatibility
    const keyPath = normalizePath(
      cfg.keyPath.replace(/^~/, os.homedir()),
    );
    const debug = process.env['SSH_DEBUG'] === '1';

    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const args = [
      '-i', keyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', `UserKnownHostsFile=${nullDevice}`,
      '-o', 'LogLevel=ERROR',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=5',          // detect dead connections faster
      '-o', 'ServerAliveCountMax=2',
      '-p', String(cfg.port),
    ];

    if (debug) {
      args.push('-vvv');
    }

    args.push(`${cfg.username}@${cfg.host}`, command);

    const proc = spawn(sshBinary(), args, {
      // Use 'pipe' for stdin (not 'ignore') so Windows OpenSSH gets a valid
      // stdin handle. 'ignore' in Electron-spawned Node leaves stdin as
      // INVALID_HANDLE_VALUE which causes Windows ssh.exe to exit 255 silently.
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: sshEnv(),
      // Explicitly set cwd to a writable directory. When the MCP server is
      // launched by Claude Code (Electron), process.cwd() is C:\Windows\System32
      // which is write-protected. ssh.exe fails silently at startup if it cannot
      // write temp/lock files in its working directory.
      cwd: os.tmpdir(),
    });
    // Immediately signal EOF on stdin — SSH doesn't need input from us.
    proc.stdin!.end();

    let stdout = '';
    let stderr = '';

    proc.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(
        `SSH timed out after ${timeoutMs}ms (host: ${cfg.host}:${cfg.port}, user: ${cfg.username}, key: ${keyPath})`,
      ));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
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
          `ssh binary not found at ${sshBinary()}. ` +
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
