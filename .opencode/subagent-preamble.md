---
trigger: always_on
alwaysApply: true
---

## 🔒 P0 PROTOCOL — MANDATORY PREEXECUTION SEQUENCE

You are launched as a sub-agent. Execute the following P0 protocol FIRST, before any analysis, design, implementation, testing, or deployment work. This protocol applies to ALL task types.

Your agent configuration, runtime permissions, project context, and Context7 lookup requirements are provided in the sections below this preamble. Review them before proceeding. Your effective runtime permissions are listed in the 🔑 Permissions section below. `opencode.json` is the authoritative source — you cannot exceed these grants. If your agent config file declares tools not in opencode.json, they will be blocked at runtime.

### Step 1: Invoke all listed skills (P0 mandatory)
For each skill in your config's `skills` list (shown in the Agent Configuration section below), invoke it in order. P0 skills like `execution-preflight-check` and `context7-first` MUST be called first.

### Step 2: Compliance gate check (P0 blocking)
Call `compliance_gate_check(task_description="<your task>")` and record the returned `session_id`.

### Step 3: Present plan and wait for user confirmation

**If `FRAMEWORK_DISPATCH_CONTEXT` is `orchestrated` (dispatched by @Orchestrator with --task-id):** Skip confirmation and proceed directly to Step 4. Your plan will be validated by the pre-execution gate.

**Otherwise (human-initiated dispatch):**
Show a complete plan:
- Skills from your config to be invoked
- MCP tools from your config to be used
- Execution phases
- Files to be read or modified
- Root cause analysis of the issue
- **Spec/docs/schema/contract consistency check**: List which specification documents, detailed design documents, Prisma schema files, and contract.yaml sections may need updating to stay consistent with the intended code change

Wait for explicit user confirmation. Do NOT proceed without it.

### Step 4: Arm the gate
Call `compliance_gate_confirm(session_id, plan_summary, task_id, agent)` to arm the compliance gate. The `task_id` is available from your DAG task context; `agent` is your agent type.

### Step 5: Proceed with task execution
Only now may you proceed with analysis, design, coding, or any other task work.

### Step 5a: Docs Consistency (P0 ENFORCED by framework)
The framework enforces that you complete a docs consistency check before writing source code. If TASK_LOG.md lacks a `## 📄 Docs Consistency Report` section, writes will be blocked in strict/locked mode. For advisory mode, a warning is logged.

### Step 5b: Write-Time Quality (P0 MANDATORY — After EVERY source file change)
The framework automatically runs write-time quality checks (type check, lint, dependency, format, scope, TDD order) after each file change. If violations are reported by the framework, fix them before continuing. Scope violations require immediate revert.

### Step 6: Close compliance gate (P0 MANDATORY)
After completing implementation AND running tests, call `compliance_gate_complete(session_id, execution_summary)`.
This records the task as complete AND runs ESLint mock-audit validation against machine.json.eslint_state.
If `compliance_gate_complete` returns `failed`, you MUST fix violations (or get @Arbiter waiver) and retry.
**未调用 compliance_gate_complete 的任务视为未完成。**

### Step 7: Report invocation summary (MANDATORY)
Include `## 📊 Invocation Summary` in your output. Persist to `.task_temp/_dispatch/INVOCATION_SUMMARY.md` (append, do not overwrite).

<!--
  FW-SLIM-01 (2026-06-03, @Super-Admin): Preamble slimmed from 163→66 lines (Phase 1-3):
  Phase 1 (R1-R3): Removed duplicated content (agent config, permissions, project config,
    Context7, invocation summary template). Reduced 163→108 lines.
  Phase 2 (R4-R6): Auto-triggered write-time audit in framework-enforcer.ts.
    Reduced 108→89 lines.
  Phase 3 (R7-R8): Hard-enforced docs consistency in framework-enforcer.ts. Slimmed
    Step 5a from 23→4 lines. Removed agent-type note (handled by dispatch-subagent.js R5).
    Reduced 89→66 lines (60% total reduction from original 163).
  For rollback: cp .opencode/subagent-preamble.md.bak .opencode/subagent-preamble.md
-->
