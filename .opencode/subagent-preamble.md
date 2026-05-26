---
trigger: always_on
alwaysApply: true
---

## 🔒 P0 PROTOCOL — MANDATORY PREEXECUTION SEQUENCE

You are launched as a sub-agent. Execute the following P0 protocol FIRST, before any analysis, design, implementation, testing, or deployment work. This protocol applies to ALL task types.

### Step 1: Read your own agent configuration

Read `.opencode/agents/{agent_type}.md`. Extract the `skills` and `mcp_tools` lists from its YAML frontmatter. These define your capabilities.

### Step 2: Read the project configuration

Read `.opencode/project.config.json`. It contains:

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

**If `FRAMEWORK_DISPATCH_CONTEXT` is `orchestrated` (dispatched by @Orchestrator with --task-id):** Skip confirmation and proceed directly to Step 7. Your plan will be validated by the pre-execution gate.

**Otherwise (human-initiated dispatch):**
Show a complete plan:

- Skills from your config to be invoked
- MCP tools from your config to be used
- Execution phases
- Files to be read or modified
- Root cause analysis of the issue
- **Spec/docs/schema/contract consistency check**: List which specification documents, detailed design documents, Prisma schema files, and contract.yaml sections may need updating to stay consistent with the intended code change

Wait for explicit user confirmation. Do NOT proceed without it.

### Step 7: Arm the gate

Call `compliance_gate_confirm(session_id, plan_summary, task_id, agent)` to arm the compliance gate. The `task_id` is available from your DAG task context; `agent` is your agent type.

### Step 8: Proceed with task execution

Only now may you proceed with analysis, design, coding, or any other task work.

### Step 8a: Root Cause & Docs Alignment Analysis (P0 MANDATORY — Before ANY code change)

Before writing or modifying ANY source code (`.ts`, `.js`, `.html`, `.scss`, `.prisma`, `.yaml`, `.yml`):

1. **Root cause analysis**: Identify the root cause of the issue. Do NOT jump to fixing symptoms.
2. **Spec & design docs scan** — check these documents for relevance to the code being modified:
   - `.opencode/context/requirements/*.md` — system, data, interface, security, test, deployment specs
   - `.opencode/context/detailed_design/**/*.md` — detailed UI/page design specs
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

After EACH successful `Write` or `Edit` operation, you MUST immediately:

1. Call `code_quality_gate.run_write_check({ changed_file: "<file>", agent_type: "<your_agent_type>", task_id: "<current_task_id>" })`
   > ⚠️ **DEPRECATED (CI-UNIFY-004)**: The standalone `run_write_check` MCP tool is deprecated. The underlying audit logic now lives in `code-quality-lib.js` (imported by code-quality-gate.js). For new tooling integrations, use `code-quality-lib.js` functions directly (e.g., `lib.runScopeCheck()`, `lib.runAllChecks()`). The MCP tool continues to work for backward compatibility but will log a deprecation warning.
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

### Step 9: Close compliance gate (P0 MANDATORY)

After completing implementation AND running tests, call `compliance_gate_complete(session_id, execution_summary)`.
This records the task as complete AND runs ESLint mock-audit validation against machine.json.eslint_state.
If `compliance_gate_complete` returns `failed`, you MUST fix violations (or get @Arbiter waiver) and retry.
**未调用 compliance_gate_complete 的任务视为未完成。**

### Step 10: Report invocation summary (MANDATORY — include in your output)

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

**System-level tools**: Also report these if called:

- `compliance_gate_check` / `compliance_gate_confirm` / `compliance_gate_complete`
- `context7_resolve-library-id` / `context7_query-docs`
- `bash`, `read`, `write` (count of calls)

Do NOT skip this section. It is required for audit trail compliance.

**Persist to file**: In addition to including the summary in your output, ALSO save a copy to `.task_temp/_dispatch/INVOCATION_SUMMARY.md` (append, do not overwrite). This creates a persistent audit trail across all sub-agent invocations.
