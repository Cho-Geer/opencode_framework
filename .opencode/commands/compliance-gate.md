---
description: Arm the compliance gate before starting any task. REQUIRED before any code/analysis/design work.
agent: Orchestrator
subtask: false
---

## COMPLIANCE GATE — MANDATORY ENFORCEMENT

You MUST execute the following sequence IMMEDIATELY. Do NOT perform any analysis, design, or code work until step 4 completes.

### Step 1: Get task description
Parse the task from $ARGUMENTS. If $ARGUMENTS is empty or unclear, ask the user "What task do you want to work on?"

### Step 2: Compliance gate check (BLOCKING — P0)
Call `compliance_gate_check(task_description="<the task>")` and note the returned `session_id`.

### Step 3: Present plan and get user confirmation
Present the full task plan including:
- Skill invocation plan (which skills will be called, in what order)
- MCP tool plan (which MCP tools will be used)
- Execution phases (analysis → design → TDD → review)
- Estimated impact (files to be modified)

Wait for the user's explicit confirmation. Do NOT proceed without it.

### Step 4: Arm the compliance gate
After user confirms, call `compliance_gate_confirm(session_id="<session_id>", plan_summary="<brief summary of confirmed plan>")`

### Step 5: Report gate status
Report: "✅ Compliance gate ARMED. Session: <session_id>. You may now proceed with the task."

### After task completion
Call `compliance_gate_complete(session_id="<session_id>", execution_summary="<what was done>")`
