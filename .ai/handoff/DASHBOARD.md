# elvatis-mcp: Dashboard

> Updated: 2026-03-31

## Progress

```
[█████░░░░░] 5/8 tasks done (62%)
```

| ID | Task | Status |
|---|---|---|
| T-001 | Initial skeleton | ✅ Done |
| T-002 | Build on Threadripper | ✅ Done (TS2589 fixed, 0.85s build) |
| T-003 | Claude Desktop smoke test | ✅ Done (2026-03-31, MSIX path fix required) |
| T-003b | SSH transport + sub-agent architecture | ✅ Done (2026-03-31) |
| T-003c | Gemini + Codex local sub-agent tools | ✅ Done (2026-03-31) |
| T-004 | GitHub Actions CI | ⏳ Ready |
| T-005 | Trading tools | ⏳ Ready |
| T-006 | Camera snapshot tool | ⏳ Ready |
| T-007 | HTTP transport test (Cursor/Windsurf) | ⏳ Ready |
| T-008 | Publish v0.1.0 (npm + GitHub Release) | ⏳ Blocked (needs build + test) |

## Tools Implemented

| Tool | Transport | Status | Tested |
|---|---|---|---|
| `home_get_state` | HA REST | ✅ | ✅ |
| `home_light` | HA REST | ✅ | ✅ |
| `home_climate` | HA REST | ✅ | ❌ |
| `home_scene` | HA REST | ✅ | ❌ |
| `home_vacuum` | HA REST | ✅ | ❌ |
| `home_sensors` | HA REST | ✅ | ✅ |
| `memory_write` | SSH | ✅ | ❌ needs retest |
| `memory_read_today` | SSH | ✅ | ❌ needs retest |
| `memory_search` | SSH | ✅ | ❌ needs retest |
| `cron_list` | SSH | ✅ | ❌ needs retest |
| `cron_run` | SSH + CLI | ✅ | ❌ needs retest |
| `cron_status` | SSH | ✅ | ❌ needs retest |
| `openclaw_run` | SSH + CLI | ✅ | ❌ needs test |
| `openclaw_status` | SSH | ✅ | ❌ needs test |
| `openclaw_plugins` | SSH | ✅ | ❌ needs test |
| `gemini_run` | Local spawn | ✅ | ❌ needs test |
| `codex_run` | Local spawn | ✅ | ❌ needs test |

## Blockers / Next Steps

- Run `npm install && npm run build` — picks up dotenv, no new npm deps for gemini/codex (local spawn)
- Test all new tools in Claude Desktop after build
- `openclaw-cli-bridge-elvatis` plugin on server crashes (server-side npm fix needed, see NEXT_ACTIONS.md)
- Verify `gemini_run` output format — `--output-format json` flag may behave differently across CLI versions
