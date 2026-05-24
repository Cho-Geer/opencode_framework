---
type: always
description: P0 compliance gate protocol — mandatory for all agents on every task
---

## 🔒 P0 PROTOCOL — MANDATORY PREEXECUTION SEQUENCE

You are launched as a sub-agent. Execute the following P0 protocol FIRST, before any analysis, design, implementation, testing, or deployment work. This protocol applies to ALL task types.

### Step 0a: Recall project context from memory (Qoder P0)

Call `search_memory(depth='shallow', query='project tech stack architecture', category='project_tech_stack,project_introduction')` to retrieve project-level knowledge before proceeding.

### Step 0b: Check current task board state (Qoder P0)

Call `TaskList` to see all tasks and their current statuses. Identify your assigned task and verify its dependencies (blockedBy) are resolved.

### Step 0c: Mark task as in-progress (Qoder P0)

Call `TaskUpdate(taskId, status: 'in_progress', activeForm: '<present continuous description>')` to signal you have started work.

### Step 1: Read your own agent configuration

Read `.qoder/agents/{agent_type}.md`. Extract the `skills` and `mcp_tools` lists from its YAML frontmatter. These define your capabilities.

### Step 2: Read the project configuration

Read `.qoder/project.config.json`. It contains:

- `project.name` — your project name
- `tech_stack` — all technologies used (backend, frontend, database, testing, CI/CD)
- `paths` — source code directory locations
- `context7_task_mapping` — which context7 queries to run per task type

### Step 3: Invoke all listed skills (P0 mandatory)

For each skill in your config's `skills` list, invoke it in order. P0 skills like `execution-preflight-check` and `context7-first` MUST be called first.

### Step 4: Call context7 for your project's tech stacks

Use `context7_resolve-library-id` + `context7_query-docs` for the tech stacks relevant to your task. Refer to `project.config.json`'s `tech_stack` and `context7_task_mapping` to determine which stacks apply.

### Step 5: Compliance gate check (P0 blocking)

Call `compliance_gate_check(task_description="<your task>")` and record the returned `session_id`.

### Step 6: Present plan and wait for user confirmation

Show a complete plan:

- Skills from your config to be invoked
- MCP tools from your config to be used
- Execution phases
- Files to be read or modified
- Root cause analysis of the issue
- **Spec/docs/schema/contract consistency check**: List which specification documents, detailed design documents, Prisma schema files, and contract.yaml sections may need updating to stay consistent with the intended code change

Wait for explicit user confirmation. Do NOT proceed without it.

### Step 7: Arm the gate

Call `compliance_gate_confirm(session_id, plan_summary)` to arm the compliance gate.

### Step 8: Proceed with task execution

Only now may you proceed with analysis, design, coding, or any other task work.

### Step 8a: Root Cause & Docs Alignment Analysis (P0 MANDATORY — Before ANY code change)

Before writing or modifying ANY source code (`.ts`, `.js`, `.html`, `.scss`, `.prisma`, `.yaml`, `.yml`):

1. **Root cause analysis**: Identify the root cause of the issue. Do NOT jump to fixing symptoms.
2. **Spec & design docs scan** — check these documents for relevance to the code being modified:
   - `.qoder/context/requirements/*.md` — system, data, interface, security, test, deployment specs
   - `.qoder/context/detailed_design/**/*.md` — detailed UI/page design specs
   - `contract.yaml` — API contracts, data models, security rules
   - `{backend.orm.schema}` — database schema (resolved via template_resolution in project.config.json)
3. **Consistency check**: For each doc that relates to your change:
   - Does the intended code change conflict with documented behavior?
   - Does the intended code change add/modify behavior that should be documented?
   - Does the intended code change introduce fields/interfaces not covered by contracts?
4. **Update or flag**: If inconsistency is found:
   - Update the doc to match the intended implementation BEFORE modifying source code
   - Record the doc change in your TASK_LOG.md
   - If you lack write permission for a doc, flag it in the plan summary at Step 6
5. **Required output**: Append a section titled `## 📄 Docs Consistency Report` to your TASK_LOG.md listing:
   - All docs reviewed
   - Whether each needs updating (YES/NO)
   - Any changes made to docs

**⚠️ NEVER skip Step 8a.** Writing code without verifying docs consistency violates DOC-CAT1.0. @Guardian will check TASK_LOG.md for the Docs Consistency Report.

### Step 8b: Write-Time Audit Protocol (P0 MANDATORY — After EVERY file change)

After EACH successful `create_file` or `search_replace` operation, you MUST immediately:

1. Call `code_quality_gate.run_write_check({ changed_file: "<file>", agent_type: "<your_agent_type>", task_id: "<current_task_id>" })`
2. Check response.overall:
   - `"pass"` → append to `.task_temp/{taskId}/write_audit_log.json` with result `pass` → continue
   - `"fail"` → examine each violation:
     - `scope`: **REVERT the change immediately** — you lack write permission
     - `tsc`: fix type errors
     - `eslint` with tier1_mock: replace with Testcontainers
     - `deps`: fix import paths
     - `format`: auto-fixed if auto_fix enabled
     - `eslint` (other): fix or document for review
     - `tdd`: **Write test file BEFORE implementation file** — CAT5.2 BLOCKER if violated
3. After fixing, re-run `run_write_check` to confirm
4. Append to write_audit_log.json with result
5. Only proceed to next file when `overall === "pass"`

**⚠️ NEVER skip Step 8b.** The pre-commit hook and @Guardian will detect skipped checks via write_audit_log.json. Consecutive skips trigger @Arbiter circuit breaker.

### Step 8c: QPV Signal Check (P0 MANDATORY — After GREEN/REFACTOR, before completion)

After TDD GREEN or REFACTOR phase is complete and all tests pass, check whether your changes require Quality Page Verification (QPV):

1. Read `.qoder/config/qpv-config.json`
2. Compare modified file paths against `source_paths` patterns in the config
3. If ANY modified file matches a `source_paths` pattern:
   - Set `qpv_required: true` in your completion output
   - Determine `change_origin`: "frontend" | "backend" | "database"
   - List `affected_pages` based on the matched pattern's page mapping
   - Set `change_type` describing the nature of the modification
4. Include in your final output to Leader:
   ```json
   {
     "qpv_required": true,
     "change_origin": "frontend|backend|database",
     "affected_pages": ["page1", "page2"],
     "change_type": "component_update|api_change|schema_migration|style_change"
   }
   ```
5. If NO files match any `source_paths` pattern, set `qpv_required: false`

**Note:** The Coding subagent does NOT call `compliance_gate_complete` itself. Return your output (including QPV signal) to the Leader agent. The Leader orchestrates QPV verification first, then calls `compliance_gate_complete` on your behalf.

### Step 9: Close compliance gate (P0 MANDATORY — Leader responsibility)

**⚠️ IMPORTANT OWNERSHIP NOTE:** If you are a Coding subagent (Coder-BE, Coder-FE), you do NOT call `compliance_gate_complete` directly. Instead:
1. Complete your implementation + tests
2. Include QPV signal (Step 8c) in your output
3. Return to Leader via `SendMessage` with your full output
4. Leader will orchestrate QPV (if required) and then call `compliance_gate_complete`

If you ARE the Leader or a non-Coding agent responsible for gate closure:
After completing implementation AND running tests, call `compliance_gate_complete(session_id, execution_summary)`.
This records the task as complete AND runs ESLint mock-audit validation against machine.json.eslint_state.
If `compliance_gate_complete` returns `failed`, you MUST fix violations (or get @Arbiter waiver) and retry.
**未调用 compliance_gate_complete 的任务视为未完成。**

### Step 10: Qoder completion steps (MANDATORY)

After `compliance_gate_complete` succeeds (or after returning to Leader):

1. **Update task board**: Call `TaskUpdate(taskId, status: 'completed')` to mark your task as done
2. **Store reusable knowledge**: If you learned new reusable patterns, techniques, or gotchas during this task, call `update_memory` to persist them for future tasks:
   - Use category `expert_experience` for domain insights
   - Use category `learned_skill_experience` for repeatable procedures
   - Use category `development_code_specification` for coding patterns discovered
3. **Report completion**: Use `SendMessage` to notify the Leader of completion with a brief summary

### Step 11: Report invocation summary (MANDATORY — include in your output)

After completing the task, append a section titled `## 📊 Invocation Summary` to your final output. It MUST include:

**Skills**: For each skill listed in your agent config, report whether it was invoked and what it produced:
| Skill | Invoked? | Detail |
|-------|:--------:|--------|
| {skill name} | ✅ or ❌ | What it did / why skipped |

**MCP Tools**: For each MCP tool listed in your agent config, report whether it was called and what was obtained:
| MCP Tool | Called? | Result |
|----------|:-------:|--------|
| Context7 | ✅ resolved: /nestjs/nest → queried "validation pipe" | Key finding: enableImplicitConversion deprecated |

**Context7 details**: For each tech stack queried, include what library was resolved and what query returned:

- `nestjs` → resolved `/nestjs/nest` → queried "DTO validation" → found class-validator + autoValidate best practice
- `prisma` → resolved `/prisma/prisma` → queried "transaction" → maxWait default 2000ms

**Compliance gate**: Report the session ID and status:
| Check | Detail |
|-------|--------|
| compliance_gate_check | Session: cg_ses_xxx — PASSED |
| compliance_gate_confirm | Armed at: 2026-04-28T05:00:00Z |
| compliance_gate_complete | Completed at: 2026-04-28T05:30:00Z |

**Qoder platform tools**: Also report these if called:

- `compliance_gate_check` / `compliance_gate_confirm` / `compliance_gate_complete`
- `context7_resolve-library-id` / `context7_query-docs`
- `read_file`, `search_replace`, `create_file`, `run_in_terminal` (count of calls)
- `search_memory` / `update_memory`
- `TaskUpdate` / `TaskList` / `TaskGet`
- `SendMessage`

Do NOT skip this section. It is required for audit trail compliance.

**Persist to file**: In addition to including the summary in your output, ALSO save a copy to `.task_temp/_dispatch/INVOCATION_SUMMARY.md` (append, do not overwrite). This creates a persistent audit trail across all sub-agent invocations.
