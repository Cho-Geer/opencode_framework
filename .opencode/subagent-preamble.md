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
Show a complete plan:
- Skills from your config to be invoked
- MCP tools from your config to be used
- Execution phases
- Files to be read or modified

Wait for explicit user confirmation. Do NOT proceed without it.

### Step 7: Arm the gate
Call `compliance_gate_confirm(session_id, plan_summary)` to arm the compliance gate.

### Step 8: Proceed with task execution
Only now may you proceed with analysis, design, coding, or any other task work.

### Step 9: Report invocation summary (MANDATORY — include in your output)

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
