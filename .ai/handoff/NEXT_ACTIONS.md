# elvatis-mcp: Next Actions

> Updated: 2026-03-31

## Completed

### T-002: TS2589 build error
Fixed via `registerTool()` wrapper. See STATUS.md and CLAUDE.md for details.

### T-003: Claude Desktop smoke test
MCP server connected and tools verified in Claude Desktop.

Key finding: Claude Desktop on Windows (MSIX install) reads config from:
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
NOT from `%APPDATA%\Claude\` (that path is ignored by the MSIX sandbox).

### T-003b: SSH transport layer + sub-agent architecture
- `src/ssh.ts`: SSH exec helper (no extra npm deps, uses system OpenSSH)
- `src/tools/cron.ts`: Reads `~/.openclaw/cron/jobs.json` directly via SSH
- `src/tools/memory.ts`: Reads and writes OpenClaw server memory files via SSH
- `src/tools/openclaw.ts`: Sub-agent orchestration via `openclaw agents send --local`
- Config: all IPs/hosts in `.env`, no hardcoded values
- `.env.example`: generic template, `.env` is gitignored

---

## Completed: Gemini + Codex + Routing

- `src/spawn.ts`: local process spawner (no SSH)
- `src/tools/gemini.ts`: `gemini_run` via `gemini -p "..." --output-format json`
- `src/tools/codex.ts`: `codex_run` via `codex exec "..." --approval-mode never`
- `src/tools/help.ts`: `mcp_help` routing guide + keyword-based task recommender
- `.mcp.json`: project-level Claude Code config (included in repo)
- `.claude/commands/mcp-help.md`: `/project:mcp-help` slash command for Claude Code
- README updated: multi-client table, `/mcp-help` section, multi-LLM architecture table

---

## Immediate: Build + Test

```bash
cd /path/to/elvatis-mcp
npm install          # picks up the new dotenv dependency
npm run build        # should complete in ~1s
```

> Note: tsc can cause OOM on machines with limited RAM. Build on a machine with at least 8 GB free.

Then test tools in Claude Desktop in this order:
1. `mcp_help` — confirm routing guide loads
2. `openclaw_status` — verify SSH connection and daemon
3. `memory_read_today` — confirm SSH read from OpenClaw server
4. `cron_list` — confirm SSH read of jobs.json
5. `gemini_run` with a simple prompt — confirm gemini CLI headless mode
6. `codex_run` with a simple prompt — confirm codex exec mode
7. `openclaw_run` — verify `openclaw agents send --local` CLI syntax

For Claude Code: open the project, approve the `.mcp.json` prompt, then try `/project:mcp-help`

---

## Server-Side: openclaw-cli-bridge fix

Plugin crashes with `Cannot find module 'openclaw/plugin-sdk'`. Fix via SSH on the OpenClaw server:

```bash
# Locate the plugin
find ~/.openclaw -name "package.json" | xargs grep -l "cli-bridge" 2>/dev/null

# cd into the plugin directory, then:
npm install
```

---

## Backlog

### T-004: GitHub Actions CI
- `.github/workflows/ci.yml`
- Trigger: push and PR to main
- Steps: install, typecheck, build
- No secrets required in CI

### T-005: Trading tools
- `trading_status`, `trading_positions`, `trading_daily_pnl`
- Read from OpenClaw server output files via SSH

### T-006: Camera snapshot tool
- `home_camera_snapshot` — fetch JPEG via HA `/api/camera_proxy/{entity_id}`
- Return as base64 image content block

### T-007: HTTP transport test (Cursor / Windsurf)
- `MCP_TRANSPORT=http MCP_HTTP_PORT=3333 node dist/index.js`

### T-008: Publish v0.1.0
1. `git tag v0.1.0 && git push origin v0.1.0`
2. `gh release create v0.1.0`
3. `npm publish --access public`

---

## Notes
- MCP SDK v2 is pre-alpha — stay on v1.x until stable
- On Windows: use full absolute paths in `claude_desktop_config.json` (e.g. `C:\\Users\\<username>\\.ssh\\key`). The dotenv `~` expansion works on Linux/macOS but not in the Windows MCP launcher context.
- Sub-agent command: `openclaw agents send --message "<prompt>" --local --timeout <seconds>`
