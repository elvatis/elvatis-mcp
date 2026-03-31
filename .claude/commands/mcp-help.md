Call the `mcp_help` tool to show the full elvatis-mcp routing guide.

If the user provided a task in $ARGUMENTS, call `mcp_help` with that task to get a specific recommendation:
- Which sub-agent to use (openclaw_run, gemini_run, or codex_run)
- Which home or memory tool to use if applicable
- Whether to split the task across multiple tools

After showing the recommendation, ask if the user wants to proceed with the suggested tool.
