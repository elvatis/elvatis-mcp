/**
 * Local process spawner — runs a command on the same machine as the MCP server.
 * Used by gemini_run and codex_run tools.
 * No SSH required: these CLIs authenticate via their own local credential stores.
 */

import { spawn } from 'child_process';

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
      // Inherit the current environment so the CLI can find its auth credentials
      env: process.env,
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
