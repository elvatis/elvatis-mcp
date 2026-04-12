# elvatis-mcp: Next Actions

> Updated: 2026-04-12

## Completed

### T-018: CLI session resume (v1.2.0)
- `src/session-registry.ts`: persistent session registry at `~/.openclaw/cli-bridge/cli-sessions.json`
- `src/spawn.ts`: added `stdinData` param so prompts pipe via stdin instead of CLI args
- `src/tools/claude.ts`: uses `--session-id` (first) / `--resume` (subsequent), stdin piping, `bypassPermissions`
- `src/tools/gemini.ts`: always passes `--resume` (Gemini creates session on unknown UUID), `--approval-mode yolo`
- `src/tools/codex.ts`: removed `--ephemeral`, uses `codex exec resume <id>` for subsequent requests
- Result: eliminates ~50% silent hang rate and 80-120s response times on large prompts

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

## Backlog: New Tools Roadmap

### T-010: remote_shell — general Linux server SSH tool (HIGH PRIORITY) (issue #20)
A general-purpose SSH exec tool for ANY Linux server, not tied to OpenClaw.
Lets an agent run arbitrary shell commands on a configured remote machine.

**New env vars:** `REMOTE_HOST`, `REMOTE_USER`, `REMOTE_PORT`, `REMOTE_KEY_PATH`
**New tool:** `remote_shell { command: string, timeout_seconds?: number }`
**New file:** `src/tools/remote-shell.ts`

Reuses `src/ssh.ts` (SshConfig already supports any host).
Enables: deployment scripts, log tailing, service restarts, file operations — all via agent.

---

### T-011: remote_docker — Docker container management via SSH (issue #19)
Control Docker on any remote Linux server the agent is connected to.
**Tools:** `remote_docker { action: list|logs|start|stop|restart|exec, container?: string, command?: string }`
SSH-based, no Docker API needed. Uses `docker ps`, `docker logs --tail N`, `docker restart` etc.

### T-012: remote_service — systemd service control via SSH (issue #18)
**Tools:** `remote_service { action: status|start|stop|restart|enable|disable, service: string }`
SSH-based. Useful for managing nginx, postgres, custom daemons on the remote server.

### T-013: http_request — general HTTP/REST API caller (issue #4)
**Tool:** `http_request { method, url, headers?, body?, timeout_seconds? }`
Lets agents call any REST API, webhook, or internal service without needing a custom tool.
No auth secrets stored — headers passed directly in the call.

### T-014: calendar_event — Google Calendar / CalDAV integration (issue #5)
Read and create events. Useful for scheduling, reminders, and time-aware agent decisions.
**Tools:** `calendar_list_events`, `calendar_create_event`
Config: OAuth token via env var or service account JSON path.

### T-015: db_query — read-only database queries via SSH tunnel (issue #6)
Run SQL queries on remote MySQL/PostgreSQL over SSH tunnel (no direct DB port needed).
**Tool:** `db_query { sql: string, db?: string }`
**Env vars:** `DB_TYPE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (SSH tunnel uses existing REMOTE_HOST config)

### T-016: home_camera_snapshot — HA camera proxy as image (issue #7)
**Tool:** `home_camera_snapshot { entity_id: string }`
Fetches JPEG from `/api/camera_proxy/{entity_id}`, returns as base64 image content block.
Enables visual context in agent decisions (e.g. "is anyone at the door?").

### T-017: openclaw_deploy — trigger deployments on OpenClaw server (issue #13)
**Tool:** `openclaw_deploy { service: string, action: deploy|rollback|status }`
SSH-based. Runs deploy scripts already on the server.

---

## Backlog: Existing

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
