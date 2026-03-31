/**
 * Memory tools — reads and writes daily memory logs on the OpenClaw server via SSH.
 *
 * Files live at: ~/.openclaw/workspace/memory/YYYY-MM-DD.md
 * This replaces the previous local-filesystem implementation because the
 * canonical memory store is on the OpenClaw server, not on the Windows client.
 */

import { z } from 'zod';
import { Config } from '../config.js';
import { sshExec, sshReadFile, sshAppendFile, SshConfig } from '../ssh.js';

const MEMORY_DIR = '~/.openclaw/workspace/memory';

// --- Schemas ---

export const memoryWriteSchema = z.object({
  note: z.string().describe('The note to save'),
  category: z.string().optional().describe('Optional category/tag, e.g. "decision", "todo", "context"'),
});

export const memoryReadTodaySchema = z.object({});

export const memorySearchSchema = z.object({
  query: z.string().describe('Search term'),
  days: z.number().min(1).max(90).default(14).describe('How many days back to search (default: 14)'),
});

// --- Helpers ---

function toSshCfg(config: Config): SshConfig {
  return {
    host: config.sshHost,
    port: config.sshPort,
    username: config.sshUser,
    keyPath: config.sshKeyPath,
  };
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]!;
}

// --- Handlers ---

export async function handleMemoryWrite(args: { note: string; category?: string }, config: Config) {
  const today = getTodayDate();
  const file = `${MEMORY_DIR}/${today}.md`;
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const tag = args.category ? ` [${args.category}]` : '';
  const entry = `\n## ${timestamp}${tag}\n${args.note}\n`;
  await sshAppendFile(toSshCfg(config), file, entry);
  return { success: true, file: `${today}.md` };
}

export async function handleMemoryReadToday(_args: Record<string, never>, config: Config) {
  const today = getTodayDate();
  const file = `${MEMORY_DIR}/${today}.md`;
  const content = await sshReadFile(toSshCfg(config), file);
  return {
    content: content.trim() || '(no entries today yet)',
    date: today,
  };
}

export async function handleMemorySearch(args: { query: string; days: number }, config: Config) {
  const cfg = toSshCfg(config);

  // List recent memory files
  const listing = await sshExec(
    cfg,
    `ls ${MEMORY_DIR}/*.md 2>/dev/null | sort -r | head -${args.days}`,
  ).catch(() => '');

  const files = listing.trim().split('\n').filter(Boolean);
  if (files.length === 0) return { results: [], query: args.query };

  const results: Array<{ date: string; excerpt: string }> = [];

  for (const file of files) {
    const date = file.replace(/.*\//, '').replace('.md', '');
    // grep: case-insensitive, first match only, 2 lines context
    // Exit code 1 means no match (not an error), use || true to keep exit 0
    const match = await sshExec(
      cfg,
      `grep -i -m1 -A2 -B1 '${args.query.replace(/'/g, "'\\''")}' ${file} 2>/dev/null || true`,
    ).catch(() => '');

    if (match.trim()) {
      results.push({ date, excerpt: match.trim() });
    }
  }

  return { results, query: args.query };
}
