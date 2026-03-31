# /ship

Pre-publish checklist for v0.1.0:

1. [ ] `npm run build` passes clean
2. [ ] Claude Desktop smoke test passed (at least `home_light` tested live)
3. [ ] Version consistent in package.json + README.md
4. [ ] DASHBOARD.md updated (tested tools marked ✅)
5. [ ] LOG.md updated with session summary

Then:
```bash
git add -A && git commit -m "release: v0.1.0"
git tag v0.1.0 && git push origin main --tags
gh release create v0.1.0 --title "v0.1.0 — Initial release" --notes "First public release. 12 tools: Home Assistant (6), Memory (3), OpenClaw Cron (3)."
npm publish --access public
```
