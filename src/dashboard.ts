/**
 * Lightweight status dashboard — single HTML page served at /status.
 *
 * Fetches service health, loaded models, cron jobs, and memory stats
 * via internal function calls (same as the MCP tools). Auto-refreshes
 * every 30 seconds. Zero dependencies, no React, no build step.
 *
 * Available when MCP_TRANSPORT=http at http://localhost:{port}/status
 * In stdio mode, starts a separate lightweight HTTP server on port 3334.
 */

import { Config } from './config.js';
import { handleSystemStatus } from './tools/system-status.js';
import { handleLocalLlmModels } from './tools/local-llm-models.js';

interface DashboardData {
  timestamp: string;
  services: unknown;
  models: unknown;
}

async function gatherData(config: Config): Promise<DashboardData> {
  const [status, models] = await Promise.all([
    handleSystemStatus({} as any, config).catch(() => ({ summary: 'error', services: [] })),
    handleLocalLlmModels({ action: 'list' }, config).catch(() => ({ success: false, models: [] })),
  ]);

  return {
    timestamp: new Date().toISOString(),
    services: status,
    models,
  };
}

function renderHtml(data: DashboardData): string {
  const services = (data.services as any)?.services ?? [];
  const models = (data.models as any)?.models ?? [];
  const summary = (data.services as any)?.summary ?? 'unknown';

  const serviceRows = services.map((s: any) => {
    const icon = s.status === 'ok' ? '&#9679;' : s.status === 'unconfigured' ? '&#9675;' : '&#9679;';
    const color = s.status === 'ok' ? '#22c55e' : s.status === 'unconfigured' ? '#a3a3a3' : '#ef4444';
    const latency = s.latency_ms ? `${s.latency_ms}ms` : '';
    const detail = (s.detail || '').replace(/</g, '&lt;').substring(0, 120);
    return `<tr>
      <td><span style="color:${color}">${icon}</span> ${s.service}</td>
      <td>${s.status}</td>
      <td>${latency}</td>
      <td class="detail">${detail}</td>
    </tr>`;
  }).join('\n');

  const modelRows = models.map((m: any) => {
    return `<tr><td>${m.id}</td><td>${m.owned_by || ''}</td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>elvatis-mcp dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a; color: #e5e5e5; padding: 24px; max-width: 900px; margin: 0 auto;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: #737373; font-size: 0.85rem; margin-bottom: 24px; }
    .summary {
      font-size: 1.1rem; margin-bottom: 20px; padding: 12px 16px;
      background: #171717; border-radius: 8px; border-left: 3px solid #22c55e;
    }
    .summary.degraded { border-left-color: #f59e0b; }
    .summary.down { border-left-color: #ef4444; }
    h2 { font-size: 1rem; font-weight: 600; margin: 24px 0 8px; color: #a3a3a3; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem; }
    table { width: 100%; border-collapse: collapse; background: #171717; border-radius: 8px; overflow: hidden; }
    th { text-align: left; padding: 8px 12px; background: #262626; font-weight: 500; font-size: 0.8rem; color: #a3a3a3; }
    td { padding: 8px 12px; border-top: 1px solid #262626; font-size: 0.85rem; }
    .detail { color: #737373; font-size: 0.75rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .footer { margin-top: 32px; color: #525252; font-size: 0.75rem; text-align: center; }
    a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <h1>elvatis-mcp</h1>
  <div class="subtitle">Status dashboard &middot; auto-refreshes every 30s &middot; ${data.timestamp.replace('T', ' ').substring(0, 19)}</div>

  <div class="summary ${summary.startsWith('5/5') ? '' : summary.includes('0/') ? 'down' : 'degraded'}">${summary}</div>

  <h2>Services</h2>
  <table>
    <thead><tr><th>Service</th><th>Status</th><th>Latency</th><th>Detail</th></tr></thead>
    <tbody>${serviceRows}</tbody>
  </table>

  <h2>Local LLM Models</h2>
  <table>
    <thead><tr><th>Model</th><th>Owner</th></tr></thead>
    <tbody>${modelRows || '<tr><td colspan="2">No models loaded</td></tr>'}</tbody>
  </table>

  <div class="footer">
    elvatis-mcp v${require('../package.json').version} &middot;
    <a href="https://github.com/elvatis/elvatis-mcp">GitHub</a> &middot;
    <a href="https://www.npmjs.com/package/@elvatis_com/elvatis-mcp">npm</a>
  </div>
</body>
</html>`;
}

export async function handleDashboardRequest(config: Config): Promise<string> {
  const data = await gatherData(config);
  return renderHtml(data);
}
