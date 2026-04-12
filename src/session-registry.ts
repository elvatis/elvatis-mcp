/**
 * CLI Session Registry
 *
 * Maintains persistent sessions for Claude, Gemini, and Codex CLI sub-agents.
 * Session resume avoids re-processing full conversation history on every call,
 * eliminating the silent hang (~50%) and slow response (80-120s) issues caused
 * by large prompt re-tokenization.
 *
 * Sessions are persisted to ~/.openclaw/cli-bridge/cli-sessions.json.
 * TTL: 2 hours of inactivity, or 50 requests (whichever comes first).
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CliSessionEntry {
  sessionId: string;
  provider: string;   // "claude" | "gemini" | "codex"
  model: string;
  createdAt: number;  // epoch ms
  lastUsedAt: number; // epoch ms
  requestCount: number;
}

const SESSIONS_FILE = path.join(os.homedir(), '.openclaw', 'cli-bridge', 'cli-sessions.json');

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_REQUESTS = 50;

const sessions = new Map<string, CliSessionEntry>();
let loaded = false;

function sessionKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const arr = JSON.parse(raw) as CliSessionEntry[];
      for (const entry of arr) {
        sessions.set(sessionKey(entry.provider, entry.model), entry);
      }
    }
  } catch {
    // Ignore parse errors: start fresh
  }
}

function save(): void {
  try {
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions.values()], null, 2));
  } catch {
    // Best-effort: session loss is recoverable (next call creates a fresh session)
  }
}

/**
 * Returns an existing valid session or creates a new one.
 * A session is valid if it was used within the TTL and has not exceeded MAX_REQUESTS.
 */
export function getOrCreateSession(provider: string, model: string): CliSessionEntry {
  load();
  const key = sessionKey(provider, model);
  const existing = sessions.get(key);

  if (
    existing &&
    (Date.now() - existing.lastUsedAt) < TTL_MS &&
    existing.requestCount < MAX_REQUESTS
  ) {
    return existing;
  }

  const entry: CliSessionEntry = {
    sessionId: randomUUID(),
    provider,
    model,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    requestCount: 0,
  };
  sessions.set(key, entry);
  save();
  return entry;
}

/** Call after a successful response to update the session metadata. */
export function recordSuccess(provider: string, model: string): void {
  load();
  const entry = sessions.get(sessionKey(provider, model));
  if (entry) {
    entry.requestCount++;
    entry.lastUsedAt = Date.now();
    save();
  }
}

/**
 * Remove a session so the next call creates a fresh one.
 * Use when the CLI reports "session not found" or auth errors.
 */
export function invalidateSession(provider: string, model: string): void {
  load();
  sessions.delete(sessionKey(provider, model));
  save();
}

/** Returns true if this session entry is a first-ever request (requestCount === 0). */
export function isNewSession(entry: CliSessionEntry): boolean {
  return entry.requestCount === 0;
}
