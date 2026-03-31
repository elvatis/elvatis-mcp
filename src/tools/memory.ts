import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getMemoryDir(): string {
  return process.env.MEMORY_DIR ?? path.join(os.homedir(), '.openclaw', 'workspace', 'memory');
}

function getTodayFile(): string {
  const today = new Date().toISOString().split('T')[0]!;
  return path.join(getMemoryDir(), `${today}.md`);
}

// --- Schemas ---

export const memoryWriteSchema = {
  note: z.string().describe('The note to save'),
  category: z.string().optional().describe('Optional category/tag, e.g. "decision", "todo", "context"'),
};

export const memoryReadTodaySchema = {};

export const memorySearchSchema = {
  query: z.string().describe('Search term'),
  days: z.number().min(1).max(90).default(14).describe('How many days back to search (default: 14)'),
};

// --- Handlers ---

export async function handleMemoryWrite(args: { note: string; category?: string }) {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = getTodayFile();
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const tag = args.category ? ` [${args.category}]` : '';
  const entry = `\n## ${timestamp}${tag}\n${args.note}\n`;
  fs.appendFileSync(file, entry, 'utf8');
  return { success: true, file: path.basename(file) };
}

export async function handleMemoryReadToday(_args: Record<string, never>) {
  const file = getTodayFile();
  if (!fs.existsSync(file)) return { content: '(no entries today yet)', date: path.basename(file, '.md') };
  return {
    content: fs.readFileSync(file, 'utf8'),
    date: path.basename(file, '.md'),
  };
}

export async function handleMemorySearch(args: { query: string; days: number }) {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) return { results: [] };

  const files = fs.readdirSync(dir)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse()
    .slice(0, args.days);

  const results: Array<{ date: string; excerpt: string }> = [];
  const queryLower = args.query.toLowerCase();

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(queryLower)) {
        const excerpt = lines.slice(Math.max(0, i - 1), i + 3).join('\n').trim();
        results.push({ date: file.replace('.md', ''), excerpt });
        break;
      }
    }
  }

  return { results, query: args.query };
}
