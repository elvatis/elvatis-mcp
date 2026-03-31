Call the `mcp_help` tool to show the full elvatis-mcp routing guide.

If the user provided a task in $ARGUMENTS, call `mcp_help` with that task to get a specific recommendation:
- Which sub-agent to use (openclaw_run, gemini_run, codex_run, or local_llm_run)
- Which home or memory tool to use if applicable
- Whether to split the task across multiple tools

For complex multi-step tasks, call `prompt_split` instead of `mcp_help` to get a full execution plan. The workflow:

1. Call `prompt_split` with the user's prompt
2. Present the plan as a table showing each subtask's ID, agent, model, and summary
3. Ask the user if they want to modify anything:
   - Change the model for a specific task (e.g. "use gemini-2.5-pro for t2")
   - Swap the agent (e.g. "use local_llm_run for t3 instead of codex")
   - Skip a subtask
   - Adjust ordering or dependencies
4. Once approved, execute the sub-tasks in dependency order
5. Tasks in the same parallelizable group can be called concurrently

After showing the recommendation, ask if the user wants to proceed with the suggested tool(s).
