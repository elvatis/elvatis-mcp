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
  const escaped = args.query.replace(/'/g, "'\\''");

  // Single SSH call: list recent files, grep all of them at once, and format
  // output with filenames so we can extract date + excerpt per file.
  // This avoids N+1 SSH connections (which was the main reliability issue).
  const output = await sshExec(
    cfg,
    `files=$(ls ${MEMORY_DIR}/*.md 2>/dev/null | sort -r | head -${args.days}) && `
    + `[ -n "$files" ] && grep -i -H -m1 -A2 -B1 '${escaped}' $files 2>/dev/null || true`,
    20_000,
  );

  if (!output.trim()) return { results: [], query: args.query };

  // Parse grep -H output: each block is separated by "--" lines,
  // lines are prefixed with "filepath:content" or "filepath-content" (context lines).
  const results: Array<{ date: string; excerpt: string }> = [];
  const blocks = output.split(/^--$/m);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Extract date from first line's file path (e.g. /path/2026-03-30.md:...)
    const dateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2})\.md[:\-]/);
    if (!dateMatch) continue;
    // Strip file path prefixes from each line for clean excerpt
    const excerpt = trimmed
      .split('\n')
      .map(line => line.replace(/^.*\.md[:\-]/, ''))
      .join('\n')
      .trim();
    if (excerpt) {
      results.push({ date: dateMatch[1]!, excerpt });
    }
  }

  return { results, query: args.query };
}
