/**
 * SSH exec helper — runs shell commands on the OpenClaw server.
 * Uses the system `ssh` binary (OpenSSH, available on Windows 10+, macOS, Linux).
 * No additional npm dependencies required.
 *
 * Set SSH_DEBUG=1 in your environment to enable verbose SSH output (-vvv).
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
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
 * Resolve the SSH binary to a full path on Windows.
 * Claude Desktop (MSIX) and Claude Code may have a different PATH than the
 * user's interactive shell. We try known locations explicitly so we don't
 * depend on PATH resolution inside a sandboxed child process.
 */
let _sshBinaryCache: string | undefined;
function sshBinary(): string {
  if (_sshBinaryCache) return _sshBinaryCache;
  if (process.platform === 'win32') {
    // Windows native OpenSSH (standard on Win10+, most reliable)
    const native = path.join(
      process.env['SystemRoot'] || 'C:\\Windows',
      'System32', 'OpenSSH', 'ssh.exe',
    );
    if (existsSync(native)) {
      _sshBinaryCache = native;
      return native;
    }
  }
  _sshBinaryCache = 'ssh';
  return 'ssh';
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

    const args = [
      '-i', keyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',  // prevent known_hosts divergence across SSH clients
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

    const bin = sshBinary();
    const isWin = process.platform === 'win32';
    const proc = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // On Windows, shell: true lets cmd.exe handle binary resolution and inherits
      // the full environment context (ssh-agent named pipe, PATH, etc.).
      // Without it, CreateProcessW sometimes fails to find or authenticate SSH
      // when spawned from sandboxed parent processes (Claude Desktop MSIX, Claude Code).
      shell: isWin,
      // Explicitly pass HOME so SSH finds config/known_hosts in the right place.
      env: { ...process.env, HOME: os.homedir() },
    });
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
          `ssh binary not found at "${bin}". ` +
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
