/**
 * file_transfer — upload/download files between local machine and OpenClaw server.
 *
 * Uses SSH (cat + base64) for transfer. No scp/sftp dependency needed.
 * Files are base64-encoded to survive shell escaping.
 *
 * Size limit: ~10MB per transfer (base64 overhead + SSH buffer limits).
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../config.js';
import { sshExec, SshConfig } from '../ssh.js';

export const fileTransferSchema = z.object({
  action: z.enum(['upload', 'download', 'list']).describe(
    '"upload": local -> server, "download": server -> local, "list": list files in a server directory.',
  ),
  remote_path: z.string().describe(
    'Path on the OpenClaw server (e.g. "~/scripts/backup.sh" or "~/.openclaw/workspace/trading/").',
  ),
  local_path: z.string().optional().describe(
    'Path on the local machine. Required for upload (source) and download (destination). '
    + 'For download, if omitted, file content is returned in the response instead of saved to disk.',
  ),
});

function toSshCfg(config: Config): SshConfig {
  return { host: config.sshHost, port: config.sshPort, username: config.sshUser, keyPath: config.sshKeyPath };
}

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function handleFileTransfer(
  args: { action: string; remote_path: string; local_path?: string },
  config: Config,
) {
  const cfg = toSshCfg(config);

  switch (args.action) {
    case 'list': {
      const output = await sshExec(
        cfg,
        `ls -lah '${args.remote_path.replace(/'/g, "'\\''")}' 2>/dev/null || echo "(directory not found: ${args.remote_path})"`,
        10000,
      );
      return { success: true, path: args.remote_path, listing: output.trim() };
    }

    case 'download': {
      // Get file size first
      const sizeOut = await sshExec(
        cfg,
        `stat -c%s '${args.remote_path.replace(/'/g, "'\\''")}' 2>/dev/null || echo -1`,
        5000,
      );
      const size = parseInt(sizeOut.trim(), 10);
      if (size < 0) {
        return { success: false, error: `File not found: ${args.remote_path}` };
      }
      if (size > MAX_SIZE) {
        return { success: false, error: `File too large (${(size / 1024 / 1024).toFixed(1)}MB). Max is 10MB.` };
      }

      // Read file as base64
      const b64 = await sshExec(
        cfg,
        `base64 '${args.remote_path.replace(/'/g, "'\\''")}'`,
        30000,
      );
      const content = Buffer.from(b64.trim(), 'base64');

      if (args.local_path) {
        // Save to local disk
        const dir = path.dirname(args.local_path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(args.local_path, content);
        return {
          success: true,
          action: 'download',
          remote_path: args.remote_path,
          local_path: args.local_path,
          size_bytes: content.length,
        };
      }

      // Return content as text (for small text files)
      const text = content.toString('utf-8');
      return {
        success: true,
        action: 'download',
        remote_path: args.remote_path,
        size_bytes: content.length,
        content: text.length < 50000 ? text : text.substring(0, 50000) + '\n... (truncated)',
      };
    }

    case 'upload': {
      if (!args.local_path) {
        return { success: false, error: '"local_path" is required for upload.' };
      }
      if (!fs.existsSync(args.local_path)) {
        return { success: false, error: `Local file not found: ${args.local_path}` };
      }

      const stat = fs.statSync(args.local_path);
      if (stat.size > MAX_SIZE) {
        return { success: false, error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max is 10MB.` };
      }

      const content = fs.readFileSync(args.local_path);
      const b64 = content.toString('base64');
      const remoteDir = args.remote_path.replace(/\/[^/]+$/, '');

      await sshExec(
        cfg,
        `mkdir -p '${remoteDir.replace(/'/g, "'\\''")}' && echo '${b64}' | base64 -d > '${args.remote_path.replace(/'/g, "'\\''")}'`,
        30000,
      );

      return {
        success: true,
        action: 'upload',
        local_path: args.local_path,
        remote_path: args.remote_path,
        size_bytes: stat.size,
      };
    }

    default:
      return { success: false, error: `Unknown action: ${args.action}` };
  }
}
