# elvatis-mcp: Next Actions

> Updated: 2026-03-31 by Akido

## Immediate (next session on Threadripper dev machine)

### T-002: Build + typecheck
```bash
git clone https://github.com/elvatis/elvatis-mcp.git
cd elvatis-mcp
npm install
npm run build
# Expected: dist/ with compiled JS + .d.ts files
```

### T-003: Claude Desktop smoke test
1. Install Claude Desktop on dev machine
2. Find config: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
3. Add MCP server entry (copy from README.md)
4. Set HA_URL + HA_TOKEN in the config env block
5. Restart Claude Desktop
6. Ask: "Turn off the Wohnzimmer light" — should work live

## Backlog

### T-004: GitHub Actions CI
- `.github/workflows/ci.yml`
- Trigger: push + PR to main
- Steps: npm install, typecheck, build
- No secrets needed for CI (no HA calls in CI)

### T-005: Trading tools
- Read from trading bot output files in `workspace/trading/`
- Tools: `trading_status`, `trading_positions`, `trading_daily_pnl`
- No external API needed if reading from local files

### T-006: Camera snapshot tool
- `home_camera_snapshot` — fetch JPEG from HA `/api/camera_proxy/{entity_id}`
- Return as base64 image content block (MCP supports image content)
- Entities: `camera.flur_live_ansicht`, `camera.wohnzimmer_live_ansicht`

### T-007: HTTP transport test
- Start server: `MCP_TRANSPORT=http MCP_HTTP_PORT=3333 node dist/index.js`
- Connect Cursor or Windsurf via HTTP MCP config
- Test same tools over network

### T-008: Publish v0.1.0
After T-002 and T-003 pass:
1. Version bump in package.json (stays 0.1.0 for first release)
2. `git tag v0.1.0 && git push origin v0.1.0`
3. `gh release create v0.1.0 --title "v0.1.0 — Initial release" --notes "..."`
4. `npm publish --access public`
5. ClawHub publish (if skill wrapper added)

## Notes
- TypeScript 5.8 causes OOM on server (i7-6700K). Always build on Threadripper.
- MCP SDK v2 is pre-alpha — stay on v1.x until stable
- HA_TOKEN: get from HA Settings > Long-Lived Access Tokens
