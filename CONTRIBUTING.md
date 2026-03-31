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

## Adding a New Tool

1. Create `src/tools/<domain>.ts` with Zod schemas and handler functions.
2. Import and register in `src/index.ts` using `registerTool()` (never call `server.tool()` directly).
3. Update the tool table in `README.md`.

## Code Style

- Follow existing patterns in the codebase.
- No em dashes in comments or documentation.
- Tool names use `domain_action` format (e.g. `home_light`, `openclaw_memory_search`).
- All secrets via environment variables only.
- Logs to stderr only in stdio mode (stdout is the MCP protocol stream).

For major changes, open an issue first to discuss design and scope.
