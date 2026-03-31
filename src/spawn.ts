/**
 * Local process spawner — runs a command on the same machine as the MCP server.
 * Used by gemini_run, codex_run, and system_status tools.
 * No SSH required: these CLIs authenticate via their own local credential stores.
 */

import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

/**
 * Build a PATH that includes common global npm binary locations.
 * Claude Desktop (MSIX) and Claude Code may strip PATH entries,
 * so we add known locations explicitly (same approach as ssh.ts sshEnv).
 */
function spawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: os.homedir() };

  if (process.platform === 'win32') {
    const home = os.homedir();
    const extraDirs = [
      path.join(home, 'AppData', 'Roaming', 'npm'),       // npm global (Windows)
      path.join(home, 'AppData', 'Local', 'pnpm'),         // pnpm global
      path.join(home, '.bun', 'bin'),                       // bun global
    ];
    const currentPath = env['PATH'] || env['Path'] || '';
    env['PATH'] = extraDirs.join(';') + ';' + currentPath;
  } else {
    // macOS / Linux: add common global npm paths
    const extraDirs = [
      '/usr/local/bin',
      path.join(os.homedir(), '.npm-global', 'bin'),
      path.join(os.homedir(), '.bun', 'bin'),
    ];
    const currentPath = env['PATH'] || '';
    env['PATH'] = extraDirs.join(':') + ':' + currentPath;
  }

  return env;
}

/**
 * Spawn a local command and return stdout as a string.
 * Progress output on stderr is silently collected (not forwarded).
 * Throws if the process exits with a non-zero code or times out.
 */
export function spawnLocal(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      shell: false,
      windowsHide: true,
      env: spawnEnv(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    // Codex streams progress to stderr during execution — collect but don't reject on it
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Process "${cmd}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // Include stderr in the error message for easier debugging
        const detail = stderr.trim() || stdout.trim() || '(no output)';
        reject(new Error(`"${cmd}" exited with code ${code}: ${detail.substring(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Command not found: "${cmd}". ` +
          `Make sure it is installed globally (npm install -g @google/gemini-cli OR @openai/codex) ` +
          `and available on PATH.`,
        ));
      } else {
        reject(err);
      }
    });
  });
}
