> Note (2026-07-18, claude-opus-4-8): Adopted CLI-based AAHP conformance v3.8.0. Switched the gate driver from vendored bash scripts to the pinned @elvatis_com/aahp CLI (devDependencies, exact 3.8.0) and removed the package-provided scripts (_aahp-lib.sh, aahp-manifest.sh, lint-handoff.sh, verify-handoff.sh, install-hooks.sh, verify-hooks.sh, scripts/hooks/). Added GROUNDING.md, TRUST.md (with a Provenance column), WORKFLOW.md, LOG-ARCHIVE.md, .aiignore, and aahp.config.json (pinnedDep + forbidden em-dash). aahp-verify.yml now runs the CLI (npm ci + npx aahp verify/doctor), keeping the dependabot exemption. Relocated the non-canonical handoff-session-resume note to .ai/notes/ so the handoff set is clean. Kept repo-specific validate-pii-allowlist.py. doctor: 6 gates, no failures.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical AAHP gate scripts from homeofe/improvements (v3.5.0 fixes: aahp-manifest.sh --phase documentation + cross_repo_ref preservation, lint-handoff.sh SC2034), AAHP_HANDOFF_FILES preserved, and refreshed the local hook tooling (scripts/hooks/, install-hooks.sh, verify-hooks.sh). Fleet re-sync.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical Layer 3 tolerance fix from homeofe/improvements. verify-handoff.sh now downgrades a non-ancestor MANIFEST.last_session.commit from FAIL to WARN so a squash-merge or rebase-merge no longer trips AAHP Verify Layer 3 on main; Layers 1-2 still gate real staleness.

# elvatis-mcp: Current State of the Nation

> Last updated: 2026-06-29 by claude-opus-4-8 (community-health sweep)
> Commit: pending
>
> **Rule:** This file is rewritten (not appended) at the end of every session.
>
> **Note (2026-06-27):** Product-state sections below predate this sweep (last functional update 2026-03-31). This session is an AAHP gate-onboarding pass only (badge + manifest commit-pointer refresh); no source code changed. See the gate-log footer for the dated trail.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `build` | ✅ Passing (prev session) | 0.85s, 148 MB, 30k instantiations |
| `typecheck` | ⏳ Needs re-run | New files added this session (ssh.ts, openclaw.ts) |
| `lint` | — | Not configured yet |
| `integration test` | ✅ Passing (prev session) | Claude Desktop smoke test passed (2026-03-31) |

---

## Architecture Change (2026-03-31)

**Problem:** cron tools used REST (`/api/cron/jobs`) — OpenClaw has no REST API, only WebSocket. Memory tools read from local Windows filesystem — actual memory files are on the OpenClaw server.

**Solution:** SSH-based transport layer.

- New `src/ssh.ts`: SSH exec helper using `child_process.spawn('ssh', ...)`. No extra npm deps, uses built-in OpenSSH (available on Windows 10+, macOS, Linux).
- `src/tools/cron.ts`: Rewritten to read `~/.openclaw/cron/jobs.json` via SSH.
- `src/tools/memory.ts`: Rewritten to read/write `~/.openclaw/workspace/memory/` via SSH. Uses base64 encoding for safe writes.
- New `src/tools/openclaw.ts`: Sub-agent orchestration — SSH-executes `openclaw agents send --message "<prompt>" --local --timeout <seconds>` and returns the response synchronously. Also: `openclaw_status`, `openclaw_plugins`.
- `src/config.ts`: All IPs/hosts removed from hardcoded defaults. `SSH_HOST` and `HA_URL` are now required env vars. Dotenv loaded at startup.
- New `.env.example`: Template for all required env vars.

**Env vars required (must be set in .env or claude_desktop_config.json):**
- `HA_URL`: Home Assistant URL
- `SSH_HOST`: OpenClaw server IP/hostname
- Optional (have defaults): `SSH_PORT`, `SSH_USER`, `SSH_KEY_PATH`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_CLI_CMD`

---

## TS2589 Fix (resolved 2026-03-31)

**Solution:** `registerTool()` wrapper in `index.ts` casts `server` to `any` before calling `.tool()`. Build: 0.85s, 148 MB, 30k instantiations.

**Rule:** Never call `server.tool()` directly. Always use `registerTool()`.

---

## Components

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Server (stdio) | ✅ Working | Claude Desktop tested 2026-03-31 |
| MCP Server (HTTP) | ✅ Skeleton | StreamableHTTPServerTransport |
| Config loader | ✅ Done | All secrets via env vars, dotenv support |
| SSH helper | ✅ Done | src/ssh.ts, child_process.spawn, no extra deps |
| Home tools (home.ts) | ✅ Working | 6 tools, HA REST API |
| Memory tools (memory.ts) | ✅ SSH-based | Reads/writes OpenClaw server files |
| Cron tools (cron.ts) | ✅ SSH-based | Reads ~/.openclaw/cron/jobs.json |
| OpenClaw tools (openclaw.ts) | ✅ New | openclaw_run, openclaw_status, openclaw_plugins |
| Trading tools | ⏳ Not started | T-005 |
| Camera tools | ⏳ Not started | T-006 |
| GitHub Actions CI | ⏳ Not started | T-004 |

---

## Current Version: 0.1.0 (unreleased)

| Platform | Status |
|---|---|
| GitHub (elvatis/elvatis-mcp) | ✅ Private repo, main branch |
| npm (@elvatis_com/elvatis-mcp) | ⏳ Not published |

---

## openclaw-cli-bridge-elvatis (Server Issue)

Plugin on the OpenClaw server crashes with `Cannot find module 'openclaw/plugin-sdk'`.
This is a server-side npm dependency issue, not an elvatis-mcp issue.

**To fix (SSH to server):**
```bash
# Find the plugin directory
find ~/.openclaw -name "package.json" | xargs grep -l "cli-bridge" 2>/dev/null
# cd into it and run:
npm install
# or check if the import path is wrong in the plugin's source
```

---

## Architecture

```
Claude Desktop / Cursor / Windsurf
  └─ MCP Protocol (stdio or HTTP)
       └─ elvatis-mcp server (Windows/Linux)
            ├─ home tools      ─────────────────────► Home Assistant REST API
            ├─ memory tools    ──► SSH exec ────────► ~/.openclaw/workspace/memory/*.md
            ├─ cron tools      ──► SSH exec ────────► ~/.openclaw/cron/jobs.json
            └─ openclaw tools  ──► SSH exec ────────► openclaw CLI (all plugins)
                                                            ├─ trading plugin
                                                            ├─ home plugin
                                                            ├─ custom workflows
                                                            └─ LLM backends
```

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, MCP server + tool registration |
| `src/config.ts` | Env var config (all secrets external) |
| `src/ssh.ts` | SSH exec helper (child_process.spawn) |
| `src/tools/home.ts` | Home Assistant tools (REST) |
| `src/tools/memory.ts` | Memory read/write/search (SSH) |
| `src/tools/cron.ts` | OpenClaw cron management (SSH) |
| `src/tools/openclaw.ts` | Sub-agent orchestration + status (SSH) |
| `.env.example` | Template — copy to .env and fill values |

<!-- aahp-gate -->
_AAHP verify gate: v3.0.2 synced 2026-06-20._

> 2026-06-21 install-hooks.sh: Windows drive-letter path fix propagated from AAHP.

> 2026-06-21 ci: add supply-chain-guard v5.2.35 Action workflow (fail-on critical).

> 2026-06-21 ci(aahp): fix unquoted next_task_id + lint-handoff noreply@ PII exclusion.

> 2026-06-27 ci: migrate npm publish to OIDC trusted publishing (publish + release jobs in ci.yml, semver-tag triggered, no NPM_TOKEN); removed old token-based publish.yml.

> 2026-06-27 ci: re-pin supply-chain-guard Action to v5.2.37 (be1d718b17cc38e4bce7fa48579b7112e557943b) and enable Dependabot github-actions weekly updates.

> 2026-06-27 aahp: onboard full AAHP gate. Added the AAHP Verify badge to README and regenerated MANIFEST so the commit-pointer tracks HEAD. Scripts and the aahp-verify workflow were already present and passing, so they were left intact (kept the repo's locally-hardened self-contained PII lint rather than swapping in AAHP's allowlist-file variant).

> 2026-06-28 security: fix 9 command-injection and secrets findings. New src/validate.ts provides allowlist validators (validateContainerName, validateServiceName, validateAgentName, validateScheduleValue, validateCronId) and shellQuote helper. All user-controlled values reaching SSH shell strings now go through a strict allowlist regex that rejects shell metacharacters, leading hyphens, and path traversal before use. sshReadFile/sshAppendFile in ssh.ts now single-quote paths. Hardcoded HA_TOKEN JWT removed from .env. 49 regression tests added covering all finding categories. Build and 99/99 tests pass.

> 2026-06-28 security (wave 3): fix 2 remaining command-injection sinks. Added validateDeployService() to src/validate.ts; openclaw-deploy.ts now calls it before interpolating service into SSH script paths; cron.ts handleCronRun now calls validateCronId() before interpolating job_id into the openclaw cron run command (mirrors existing pattern in cron-manage.ts). shellQuote applied to deployScriptDir as well. 23 new regression tests added. Build and 122/122 tests pass.

> 2026-06-29 by claude-opus-4-8 (community-health sweep): added
> .github/PULL_REQUEST_TEMPLATE.md and .github/ISSUE_TEMPLATE/{bug_report,feature_request}.md
> copied from canonical homeofe/aahp-swarm. No source code changed.

> 2026-06-30 by claude-opus-4-8 (verify): added reviewed expiring PII allowlist, rolled out from AAHP v3.2.0.

> 2026-06-30 ci: exempt Dependabot from the aahp-verify handoff gate (keep supply-chain-guard/codeql/build).

> Note (2026-07-19): Moved the AAHP conformance pin from 3.8.0 to 3.8.1 (picks up the v3.8.1 Windows/MSYS manifest-regen fix so tasks, next_task_id and cross_repo_ref survive regeneration). No runtime behavior change on Linux or CI. Handoff refreshed and MANIFEST regenerated.
