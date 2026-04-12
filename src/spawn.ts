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
 * Escape a single argument for cmd.exe.
 * Wraps in double quotes and escapes inner double quotes.
 */
function escapeWinArg(arg: string): string {
  // Already quoted
  if (arg.startsWith('"') && arg.endsWith('"')) return arg;
  const escaped = arg.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Spawn a local command and return stdout as a string.
 * Progress output on stderr is silently collected (not forwarded).
 * Throws if the process exits with a non-zero code or times out.
 *
 * On Windows, builds a single command string for cmd.exe to avoid
 * DEP0190 (passing args to child_process with shell:true).
 */
export function spawnLocal(
  cmd: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
  stdinData?: string,
): Promise<string> {
  const isWin = process.platform === 'win32';

  // On Windows we need shell:true so cmd.exe resolves .cmd/.ps1 wrappers
  // (e.g. gemini.cmd, codex.cmd). To avoid DEP0190 we build a single
  // command string and pass no args array.
  const spawnCmd = isWin
    ? `${cmd} ${args.map(escapeWinArg).join(' ')}`
    : cmd;
  const spawnArgs = isWin ? [] : args;

  // Default cwd to home directory so sub-agents never inherit System32
  // (Electron sets process.cwd() = C:\Windows\System32 for MCP server processes).
  const effectiveCwd = cwd ?? os.homedir();

  return new Promise((resolve, reject) => {
    const proc = spawn(spawnCmd, spawnArgs, {
      shell: isWin,
      windowsHide: true,
      env: spawnEnv(),
      cwd: effectiveCwd,
    });

    // Write prompt via stdin if provided, then close
    if (stdinData !== undefined) {
      proc.stdin?.write(stdinData);
    }
    proc.stdin?.end();

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
