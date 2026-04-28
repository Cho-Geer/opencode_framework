---
description: Dispatch a sub-agent with full P0 protocol enforcement. Usage: /dispatch <agent_type> "<task_description>"
agent: Orchestrator
subtask: false
---

## 🔒 MANDATORY DISPATCH PROTOCOL

When you need to delegate work to a sub-agent, you MUST use the dispatch wrapper script to generate the wrapped prompt. Do NOT delegate without it.

### Step 1: Generate wrapped prompt
Run the dispatch script via bash:

```
!`node .opencode/scripts/command-tools/dispatch-subagent.js $1 "$2"`
```

Capture the output file path (the script prints the file path to stdout).

### Step 2: Read the generated prompt file
Read the wrapped prompt from the file path returned above.

### Step 3: Present the delegation plan to the user
Show the user:
- Which sub-agent will be delegated
- The skills and MCP tools the sub-agent will invoke
- The P0 protocol the sub-agent will follow

Get explicit confirmation before proceeding.

### Step 4: Delegate using the wrapped prompt
Call `Task()` with:
- `description`: Brief description of the task
- `prompt`: The content from the wrapped prompt file
- `subagent_type`: The agent type (e.g., "Architect", "Coder-BE")

### Step 5: Report delegation status
After the sub-agent completes, report its findings back to the user.

NOTE: This protocol ensures ALL sub-agents always execute the full P0 sequence (compliance gate → context7 → skills → MCP tools) regardless of the task type. Never skip or abbreviate.
