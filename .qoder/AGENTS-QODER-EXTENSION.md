# Qoder Platform Integration — AGENTS.md Extension

> This document is a supplement to [AGENTS.md](AGENTS.md). It defines how the three-layer eight-role governance system operates when the Qoder IDE platform is the execution environment.
> Read AGENTS.md first for the full governance specification.

---

## 1. 8-Role → Qoder Subagent Type Map

| Role | Qoder `subagent_type` | Rationale |
|---|---|---|
| @Meta-Planner | `Research` | Read-only analysis + DAG file output |
| @Orchestrator | Leader (Qoder itself) | Native Task board + Agent dispatch |
| @Architect | `Research` → `Coding` | Contract design then writes contract.yaml |
| @Coder-BE | `Coding` | Backend source scope (configured per project) |
| @Coder-FE | `Coding` | Frontend source scope (configured per project) |
| @Guardian | `Verify` + `CodeReview` | Test execution evidence + code review |
| @Arbiter | `Research` | Decision analysis + writes WAIVE.md |
| @CI-CD-Agent | `Coding` | Docker + GitHub Actions scope |

## 2. Qoder Memory Usage Protocol

- Before reading any `.qoder/context/requirements/` doc, call `search_memory` first
- If memory miss: read file, then call `update_memory` to cache the result
- All agents MUST call `search_memory` at task start to recall:
  - `project_introduction` — system overview
  - `project_tech_stack` — technology decisions
  - `development_code_specification` — coding standards
  - `expert_experience` — governance invariants and QPV protocol
- After completing significant work, update memory entries if facts have changed

## 3. Qoder Task Board Integration

- When @Orchestrator dispatches a task, create a Qoder Task with `TaskCreate`
- Map DAG task IDs (T-XXX) to Qoder task IDs for cross-reference
- DAG = planning source (what should happen); Task board = execution tracker (what is happening)

The Qoder Task board is the EXECUTION tracker (not the planning source). Workflow:

1. `Task.DAG.json` (planning source, owned by @Meta-Planner) → read-only for all other agents
2. Run `node .qoder/scripts/command-tools/dispatch-subagent.js <agent_type> "<task>"` to generate dispatch payloads
3. Leader creates tasks on Qoder Task board using TaskCreate tool
4. Agents claim tasks via TaskUpdate (status: in_progress)
5. On completion: TaskUpdate (status: completed)

**Non-overlap rule**: DAG tracks requirements/dependencies; Task board tracks execution state. They are non-competing.

## 4. Qoder-Specific P0 Protocol Override

- The MCP tools `compliance_gate_check/confirm/complete` are served by the registered `qoder-framework-tools` MCP server
- Use Qoder's `TaskUpdate` for status tracking alongside machine.json updates

All sub-agents dispatched via Qoder MUST follow the preamble at `.qoder/subagent-preamble.md`, which adds these Qoder-specific steps to the standard P0 protocol:

- **Step 0a**: `search_memory` — recall project context before any work
- **Step 0b**: `TaskList` — check Qoder Task board state
- **Step 0c**: `TaskUpdate` — mark assigned task as `in_progress`
- **Step 8c**: QPV Signal Check — after GREEN/REFACTOR, determine if Browser QPV is required
- **Step 10**: Qoder completion — `TaskUpdate` (completed) + compliance_gate_complete

## 5. Qoder Page Verification Protocol (QPV) — Mandatory for All Business Code

- After every Coding task that modifies files matching `.qoder/config/qpv-config.json → source_paths`, @Orchestrator MUST dispatch QPV
- **Frontend changes**: Browser subagent verifies affected pages directly
- **Backend changes**: Leader first runs Affected Page Resolution (APR) via `.qoder/config/qpv-config.json → endpoint_page_map` to identify consuming pages, then dispatches Browser subagent
- **Database/ORM changes**: Leader traces model → endpoint → page chain via endpoint_page_map, then dispatches Browser subagent
- The Browser subagent runs applicable verification categories (LDV, IOV, EV, TV) per the scope determination table
- Produces `page_verification_report.json` in `.task_temp/{taskId}/` with `change_origin`, `affected_endpoints`, and `resolution_method` fields
- @Guardian Layer A auto-gate: `page_verification_report.json` must exist and `overall === "PASS"` for all business code tasks
- QPV failure blocks `compliance_gate_complete` — the Coding subagent must fix and re-trigger QPV
- Only tasks modifying files matching `exempt_paths` are exempt from QPV
- All design tokens, thresholds, breakpoints, and error codes are read from `.qoder/config/qpv-config.json` — not hardcoded in the skill or standard

**QPV Categories**:

| ID | Name | Verifies |
|---|---|---|
| LDV | Layout & Design Verification | Design tokens, overflow, breakpoints |
| IOV | Input & Output Verification | Forms, data binding, API shapes |
| EV | Error Verification | Error codes, form validation, 404 handling |
| TV | Threshold Verification | Load times, contrast ratio, responsiveness |

**Full skill**: `.qoder/skills/page-verification/skill.md`
**Pass/fail standard**: `.qoder/rules/rule_detail/page-verification-standard.md`
**Configuration**: `.qoder/config/qpv-config.json`

## 6. Platform Compatibility Rule

> The framework MUST only add constraints via instructions (preambles, skills, memory) and data (config files, MCP tools). It MUST NEVER modify Qoder's internal tool behavior, intercept tool calls, or suppress built-in capabilities. If a conflict arises, Qoder's native capability takes precedence and the framework adapts.

The `.qoder/` framework layer MUST NOT override any built-in Qoder platform capability. It operates exclusively through:
- Instructions in skill/standard markdown files (read by agents as guidance)
- Configuration in `.qoder/config/qpv-config.json` (read by agents for project-specific values)
- MCP tools in `mcp-server.js` (additive tools only — compliance gate, ESLint audit, keystone validate)
- Memory entries (additive context only)

It does NOT modify Qoder's internal tool behavior, task board schema, or subagent routing logic.
