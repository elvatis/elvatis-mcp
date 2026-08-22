# Contributing

Thanks for your interest in contributing to elvatis-mcp!

## Getting Started

1. Fork the repository and create a feature branch from `main`.
2. Install dependencies: `npm ci` (this also runs the build via the `prepare` script).
3. Make your changes in `src/`.
4. Rebuild: `npm run build`
5. Test locally: `node dist/index.js` (starts in stdio mode, expects an MCP client).

## Pull Request Process

1. Open a Pull Request against `main` with a clear description.
2. Link any relevant issues.
3. Ensure the build passes (`npm run build`) and documentation is updated.
4. Keep changes focused and small.

## Adding a Test

Put it under `tests/`, named `*.test.ts`, and add it to the `test` script in
`package.json`. That script names its files explicitly rather than globbing, so
a new file is not picked up on its own.

`npm run test-registration` fails when the two disagree, and CI runs the same
check in a step of its own, so an unregistered file is reported rather than
silently skipped. If a file genuinely should not run under `npm test`, declare
it under `testRegistration.excluded` in `package.json` with the reason; the
guard requires that reason and requires the file to exist.

## Adding a New Tool

1. Create `src/tools/<domain>.ts` with Zod schemas and handler functions.
2. Import and register in `src/index.ts` using `registerTool()` (never call `server.tool()` directly).
3. Update the tool table in `README.md`.

## Releases

Releases are cut from a pushed `v*` tag and published by GitHub Actions.
[SECURITY.md](SECURITY.md#release-integrity) describes that path in full.

One rule matters while you are working on `main`: **the version in
`package.json` is always one that has not been published yet.** As soon as a
version ships, the number is raised past it.

If `npm run version-guard` fails on your pull request, read it as a statement
about `main` rather than about your branch: the default branch is carrying an
already-published version, so nothing merged into it can be installed until the
number moves. Raise `version`, and open the matching section in
[CHANGELOG.md](CHANGELOG.md) in the same change:
[`scripts/check-changelog-heading.mjs`](scripts/check-changelog-heading.mjs)
requires the topmost dated release heading to equal the version in
`package.json`, and runs as its own check on every pull request. Run it yourself
with `node scripts/check-changelog-heading.mjs`; it prints which heading it read
and which version it compared against.

It fails closed rather than guessing. A heading it cannot parse, an
`[Unreleased]` section sitting above the dated one, a date that is not a real
day, or the same version heading twice all exit 2, which is a failure and not a
pass. `[Unreleased]` in particular does not satisfy it: the rule above is that
`main` carries a real unreleased *number*, with its section already open.

## Code Style

- Follow existing patterns in the codebase.
- English, everywhere: code, comments, documentation, commit subjects, pull
  request titles and the handoff notes under `.ai/`. This repository is public,
  so a note written for the person who wrote it is read by everyone.
- No em dashes in comments or documentation.
- Tool names use `domain_action` format (e.g. `home_light`, `openclaw_memory_search`).
- All secrets via environment variables only.
- Logs to stderr only in stdio mode (stdout is the MCP protocol stream).

For major changes, open an issue first to discuss design and scope.
