/**
 * Rate limiter and cost tracker for cloud sub-agents.
 *
 * Tracks usage per agent (claude_run, codex_run, gemini_run) with configurable
 * rate limits per minute/hour/day. Persists usage data to JSON so limits
 * survive server restarts.
 *
 * Local agents (local_llm_run, home_*, openclaw_*) are not rate-limited.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- Types ---

export interface RateLimitConfig {
  /** Max calls per minute (0 = unlimited) */
  perMinute: number;
  /** Max calls per hour (0 = unlimited) */
  perHour: number;
  /** Max calls per day (0 = unlimited) */
  perDay: number;
  /** Estimated cost per call in USD (for tracking, not enforcement) */
  costPerCall: number;
}

export interface UsageRecord {
  agent: string;
  timestamp: number;
  /** Estimated cost of this call in USD */
  cost: number;
}

export interface UsageState {
  /** Usage records (pruned to last 24h on load) */
  records: UsageRecord[];
  /** Running cost totals per agent */
  dailyCosts: Record<string, number>;
  /** Date string (YYYY-MM-DD) for dailyCosts reset */
  costDate: string;
}

export interface QuotaInfo {
  agent: string;
  allowed: boolean;
  /** Reason if not allowed */
  reason?: string;
  usage: {
    lastMinute: number;
    lastHour: number;
    lastDay: number;
  };
  limits: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  estimatedCostToday: number;
}

// --- Default limits ---

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  claude_run:  { perMinute: 5, perHour: 30, perDay: 200, costPerCall: 0.03 },
  codex_run:   { perMinute: 5, perHour: 30, perDay: 200, costPerCall: 0.02 },
  gemini_run:  { perMinute: 10, perHour: 60, perDay: 500, costPerCall: 0.01 },
};

// --- State ---

let state: UsageState = {
  records: [],
  dailyCosts: {},
  costDate: todayString(),
};

let dataDir: string = path.join(os.homedir(), '.elvatis-mcp');
let customLimits: Record<string, Partial<RateLimitConfig>> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// --- Public API ---

/**
 * Initialize the rate limiter. Call once at startup.
 */
export function initRateLimiter(opts?: {
  dataDir?: string;
  limits?: Record<string, Partial<RateLimitConfig>>;
}): void {
  if (opts?.dataDir) dataDir = opts.dataDir;
  if (opts?.limits) customLimits = opts.limits;
  loadUsageState();
}

/**
 * Check if an agent call is allowed under current rate limits.
 * Does NOT record usage (call recordUsage after the call succeeds).
 */
export function checkRateLimit(agent: string): QuotaInfo {
  const limits = getLimits(agent);
  if (!limits) {
    // No limits configured for this agent (local/home tools)
    return {
      agent,
      allowed: true,
      usage: { lastMinute: 0, lastHour: 0, lastDay: 0 },
      limits: { perMinute: 0, perHour: 0, perDay: 0 },
      estimatedCostToday: 0,
    };
  }

  const now = Date.now();
  const oneMinAgo = now - 60_000;
  const oneHourAgo = now - 3_600_000;
  const oneDayAgo = now - 86_400_000;

  const agentRecords = state.records.filter(r => r.agent === agent);
  const lastMinute = agentRecords.filter(r => r.timestamp > oneMinAgo).length;
  const lastHour = agentRecords.filter(r => r.timestamp > oneHourAgo).length;
  const lastDay = agentRecords.filter(r => r.timestamp > oneDayAgo).length;

  const usage = { lastMinute, lastHour, lastDay };
  const limitsInfo = {
    perMinute: limits.perMinute,
    perHour: limits.perHour,
    perDay: limits.perDay,
  };

  let allowed = true;
  let reason: string | undefined;

  if (limits.perMinute > 0 && lastMinute >= limits.perMinute) {
    allowed = false;
    reason = `Rate limit exceeded: ${lastMinute}/${limits.perMinute} calls in the last minute`;
  } else if (limits.perHour > 0 && lastHour >= limits.perHour) {
    allowed = false;
    reason = `Rate limit exceeded: ${lastHour}/${limits.perHour} calls in the last hour`;
  } else if (limits.perDay > 0 && lastDay >= limits.perDay) {
    allowed = false;
    reason = `Rate limit exceeded: ${lastDay}/${limits.perDay} calls in the last day`;
  }

  const estimatedCostToday = state.dailyCosts[agent] ?? 0;

  return { agent, allowed, reason, usage, limits: limitsInfo, estimatedCostToday };
}

/**
 * Record a successful agent call. Updates usage state and schedules a flush.
 */
export function recordUsage(agent: string): void {
  const limits = getLimits(agent);
  const cost = limits?.costPerCall ?? 0;

  // Reset daily costs if date changed
  const today = todayString();
  if (state.costDate !== today) {
    state.dailyCosts = {};
    state.costDate = today;
  }

  state.records.push({
    agent,
    timestamp: Date.now(),
    cost,
  });

  state.dailyCosts[agent] = (state.dailyCosts[agent] ?? 0) + cost;

  // Prune old records (keep last 24h only)
  const cutoff = Date.now() - 86_400_000;
  state.records = state.records.filter(r => r.timestamp > cutoff);

  scheduleFlush();
}

/**
 * Get quota info for all rate-limited agents.
 */
export function getAllQuotas(): QuotaInfo[] {
  const agents = new Set([
    ...Object.keys(DEFAULT_LIMITS),
    ...Object.keys(customLimits),
  ]);
  return Array.from(agents).map(agent => checkRateLimit(agent));
}

/**
 * Get a summary of today's estimated costs.
 */
export function getCostSummary(): { date: string; agents: Record<string, number>; total: number } {
  const today = todayString();
  if (state.costDate !== today) {
    return { date: today, agents: {}, total: 0 };
  }
  const total = Object.values(state.dailyCosts).reduce((sum, c) => sum + c, 0);
  return { date: today, agents: { ...state.dailyCosts }, total };
}

// --- Internal helpers ---

function getLimits(agent: string): RateLimitConfig | null {
  const defaults = DEFAULT_LIMITS[agent];
  if (!defaults) return null;

  const overrides = customLimits[agent];
  if (!overrides) return defaults;

  return {
    perMinute: overrides.perMinute ?? defaults.perMinute,
    perHour: overrides.perHour ?? defaults.perHour,
    perDay: overrides.perDay ?? defaults.perDay,
    costPerCall: overrides.costPerCall ?? defaults.costPerCall,
  };
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function usageFilePath(): string {
  return path.join(dataDir, 'usage.json');
}

function loadUsageState(): void {
  try {
    const raw = fs.readFileSync(usageFilePath(), 'utf-8');
    const loaded = JSON.parse(raw) as UsageState;

    // Prune records older than 24h
    const cutoff = Date.now() - 86_400_000;
    loaded.records = (loaded.records ?? []).filter(r => r.timestamp > cutoff);

    // Reset daily costs if date changed
    const today = todayString();
    if (loaded.costDate !== today) {
      loaded.dailyCosts = {};
      loaded.costDate = today;
    }

    state = loaded;
  } catch {
    // File doesn't exist or is corrupt, start fresh
    state = { records: [], dailyCosts: {}, costDate: todayString() };
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  // Debounce: flush at most once per 5 seconds
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushUsageState();
  }, 5_000);
}

function flushUsageState(): void {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(usageFilePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    process.stderr.write(`[elvatis-mcp] Failed to persist usage data: ${err}\n`);
  }
}

/**
 * Force an immediate flush (call on server shutdown).
 */
export function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushUsageState();
}
