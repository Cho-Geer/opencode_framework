# Three-Layer Eight-Agent Multi-Agent System — Global Collaboration Protocol

### 🚨 P0 Mandatory Rule: All Tasks Must Start with `/compliance-gate`
Any development, analysis, design, review, or deployment task must be initiated with the `/compliance-gate "<task_description>"` command. If the compliance gate is not armed, entering analysis, design, coding, or review phases is strictly prohibited. This rule takes precedence over all other rules in this document.

### 🚨 P0 Sub-Agent Dispatch Rule: Must Use `/dispatch` Command
When the primary agent needs to delegate a sub-agent to execute a task, the following process must be followed:
1. Run `node .opencode/scripts/command-tools/dispatch-subagent.js <agent_type> "<task>"` to generate a wrapped prompt
2. Pass the generated wrapped prompt as-is to the `Task()` tool's `prompt` parameter
3. Manually crafting sub-agent prompts to bypass pre-execution checks is prohibited

The wrapped prompt automatically includes:
- All `skills` and `mcp_tools` invocation directives declared in `.opencode/agents/<agent_type>.md`
- Context7 tech stack query directives auto-determined from the task description
- The complete compliance_gate_check → confirm → complete lifecycle
- Execution protocols defined in the sub-agent's configuration file

This rule ensures sub-agents always execute the complete P0 protocol, regardless of the type of task received.

### 🚨 P0 Global Entry Rule: All New Work Items Must Go Through @Meta-Planner First
Any new work item — including but not limited to feature development, bug fixes, style adjustments, performance optimization, and configuration changes — **must first go through @Meta-Planner** to generate or update `Task.DAG.json` before entering analysis, design, or coding phases. No agent is allowed to independently analyze or decompose requirements without @Meta-Planner's involvement.

Global routing decision matrix:

| Work Item Type | @Meta-Planner Required? | Action |
|----------------|-------------------------|--------|
| New feature/module | ✅ Mandatory | Invoke @Meta-Planner to generate complete Task.DAG.json |
| Bug fix | ✅ Mandatory | Invoke @Meta-Planner to generate minimal DAG (analysis→RED→GREEN→review) |
| Style/UI adjustment | ✅ Mandatory | Invoke @Meta-Planner to generate minimal DAG |
| Error investigation (involving code changes) | ✅ Mandatory | Invoke @Meta-Planner for root cause hypothesis analysis and DAG generation |
| Pure information query / document reading | ⚠️ Not required | Answer directly, no DAG needed |
| Simple config/environment variable change | ⚠️ @Orchestrator's judgment | Simple → execute directly; Complex → invoke @Meta-Planner |

**Violation Consequence**: Tasks executed without @Meta-Planner are considered invalid and will be automatically rejected during @Guardian review. @Orchestrator must not dispatch tasks that have not been planned by @Meta-Planner.

### 🚨 P0 @Orchestrator Responsibility Boundary: Dispatch-Only, No Unauthorized Analysis
@Orchestrator's core responsibility is **dispatching according to the DAG**, not requirements analysis or task decomposition. Specific boundaries:

| Scenario | Correct Action | Violation |
|----------|---------------|-----------|
| New work item received, no corresponding DAG | Invoke `dispatch-subagent.js` to dispatch @Meta-Planner | ❌ Independently analyze requirements |
| DAG exists, task status is pending | Dispatch sub-agents per DAG dependency order | ❌ Independently modify DAG task definitions |
| DAG state out of sync with file state | Invoke @Meta-Planner to update DAG state | ❌ Independently modify task.status |
| DAG coverage insufficient (<100%) | Pause execution, notify @Meta-Planner to supplement | ❌ Skip uncovered tasks and continue |
| Running task fails, needs retry | Execute per circuit-breaker strategy (degradation/expert/human) | ❌ Independently modify task scope |

@Orchestrator's exclusive output artifacts are limited to: dispatch status reports, task progress tracking, and final artifact merging. **@Orchestrator is prohibited from producing any analytical documents (Project.graph, root cause analysis, etc.)** — these are the responsibilities of @Meta-Planner or @Architect.

## I. System Overview

This project adopts a **three-layer eight-agent** full-lifecycle autonomous multi-agent architecture, covering the complete chain from requirements planning, development implementation, quality verification, to operations and deployment, strictly following project rules.

### Available Sub-Agent List (Must Be Fully Declared)
- @Meta-Planner
- @Orchestrator
- @Architect
- @Coder-FE
- @Coder-BE
- @Guardian
- @Arbiter
- @CI-CD-Agent

## II. Global Mandatory Rules (Always Apply, Highest Priority)

All agents must strictly follow the project rule files below (auto-loaded):
1. Core Rules
- `.opencode/rules/common-project.md`: General project development standards
- `.opencode/rules/mcp-compliance-guide.md`: MCP tool usage compliance requirements
- `.opencode/rules/skill-compliance-guide.md`: Skill invocation permissions and compliance requirements
2. Project Requirements and Design Documents (Mandatory Compliance)
- `.opencode/context/requirements/System Architecture Design Document (SAD).md`
- `.opencode/context/requirements/Interface Design Specification.md`
- `.opencode/context/requirements/Data Architecture Design Document.md`
- `.opencode/context/requirements/Security Architecture Design Document.md`
- `.opencode/context/requirements/Test Strategy and Plan.md`
- `.opencode/context/requirements/Operations and Deployment Design Document.md`
- `.opencode/context/code_standards/frontend-coding-standard.md` (Mandatory for frontend development)
- `.opencode/context/code_standards/backend-coding-standard.md` (Mandatory for backend development)
- `.opencode/context/code_standards/testing-coding-standard.md` (Mandatory for test writing and review)

### 🚨 Compliance Gate Enforcement (All Agents Unconditionally Comply, Highest Priority)
Before any task begins, the following three steps must be executed in sequence (none can be skipped):
1. Call `compliance_gate_check(task_description)` — Execute compliance gate check
2. Present the complete task plan to the user and await confirmation
3. Call `compliance_gate_confirm(plan_summary)` — Arm the compliance gate

If the compliance gate is not armed, no agent may enter analysis, design, or coding phases. This gate takes precedence over all other rules.

### 🚨 Task Completion Mandatory: compliance_gate_complete (All Agents Unconditionally Comply)
At the end of every task, `compliance_gate_complete(session_id, execution_summary)` must be called — marking the task as complete and consuming the armed state.

**Tasks without a compliance_gate_complete call are considered incomplete.** @Orchestrator will refuse to dispatch the next task for incomplete tasks. compliance_gate_complete internally executes a full ESLint mock-audit scan; when violations > 0, complete returns failed.

### 🚨 TDD Iron Law (All Agents Unconditionally Comply)
1. Tests absolutely first: **No test case, no business code**
2. RED phase: Test cases must fail first before development can proceed
3. GREEN phase: Write only the minimal code to pass tests, over-implementation is prohibited
4. REFACTOR phase: Refactoring must only occur after all tests pass
5. Gate rule: If tests are not 100% passing, entering code review is prohibited

## III. Role List and Responsibilities (8 Specialized Agents)

### Meta-Cognitive Layer

| Role | Core Positioning | Invocation | Exclusive Responsibility Boundary |
|------|-----------------|------------|----------------------------------|
| @Meta-Planner | Project CTO, top-level requirements decomposition and DAG planning | `@Meta-Planner` | Requirements analysis/decomposition, DAG generation/update, tech debt scanning, global planning. Must follow `.opencode/rules/rule_detail/dag-generation-standard.md` |
| @Orchestrator | Project Manager, **dedicated to dispatch and state control** | `@Orchestrator` | **Only responsible for**: Dispatching sub-agents per DAG, tracking task status, merging final artifacts, coordinating retries. **Prohibited from**: Analyzing requirements, decomposing tasks, modifying DAG definitions |

### Orchestration & Execution Layer

| Role | Core Positioning | Invocation |
|------|-----------------|------------|
| @Architect | System Architect, interface contract and technical specification definition | `@Architect` |
| @Coder-FE | Frontend Developer, page/component/interaction implementation | `@Coder-FE` |
| @Coder-BE | Backend/Server Developer, API/business logic implementation | `@Coder-BE` |

### Validation & Operation Layer

| Role | Core Positioning | Invocation |
|------|-----------------|------------|
| @Guardian | Quality Gate, code standards/security/architecture constraint review + test execution evidence verification | `@Guardian` |
| @Arbiter | Technical Committee, conflict resolution and tech debt waiver approval | `@Arbiter` |
| @CI-CD-Agent | DevOps/SRE, CI pipeline operations, automated deployment and self-healing | `@CI-CD-Agent` |

## IV. Core Collaboration Protocols

0. **[P0] Global @Meta-Planner Entry Protocol**: All new work items must first go through @Meta-Planner to generate Task.DAG.json, then be dispatched by @Orchestrator. See P0 Global Entry Rule above.
1. **Permission Isolation Principle**: Each agent only has exclusive Skill permissions; unauthorized operations are prohibited, strictly following `skill-compliance-guide.md`. **@Orchestrator in particular must not overstep into requirements analysis or task decomposition.**
2. **DAG Dispatch Rule**: @Orchestrator parses the Task.DAG.json generated by @Meta-Planner, dispatching sub-tasks strictly in dependency order; tasks without dependencies execute in parallel. @Orchestrator **must not modify task definitions in the DAG.**
3. **Contract-Driven Development**: The `contract.yaml` output by @Architect is in read-only locked state; frontend/backend development, testing, and review all use this as the single source of truth.
4. **Quality Gate Enforcement**: All code must pass @Guardian review (including test execution evidence verification); merging is prohibited without approval.
5. **Closed-Loop Feedback Mechanism**: @CI/CD-Agent feeds deployment/operations results back to @Orchestrator; @Arbiter feeds arbitration results back to @Meta-Planner, forming a full-chain closed loop.
6. **Context Governance**: After each phase completes, context is automatically compressed; only essential results are passed forward; redundant information pollution is prohibited.
7. **Infinite Loop Circuit Breaker**: After 3 consecutive review/test failures, @Arbiter intervention is automatically triggered, terminating the current task flow.
8. **Working Memory Scratchpad**: @Coder-BE and @Coder-FE must update the task-specific `TASK_LOG.md` before writing code, recording the current modification plan, new methods, return types, and other key information to prevent context drift during long serial outputs. This file is not committed to Git (added to `.gitignore`).
9. **Test Execution Evidence Enforcement**: The `test_report.json` output by @Coder-BE/@Coder-FE must include an `execution_evidence` field (key summary of test command output or assertion results); @Guardian will return `FAIL` if this is found missing during review.
10. **Tech Debt Visual Tracking**: After @Arbiter approves a `WAIVE.md`, a record must be appended to `TECH_DEBT_REGISTRY.md` in the project root; @Meta-Planner must scan this registry when planning new versions, converting tech debt approaching repayment deadlines into new tasks.
11. **Handover Summary Mechanism**: Each execution agent (@Coder-BE, @Coder-FE) must output a `HANDOVER.md` in the task-specific temporary directory upon task completion, containing core changes, key assumptions, potential pitfalls, and testing reminders, reducing information loss across serial handoffs.
12. **Self-Healing Circuit Breaker Retry Strategy**: After a task is circuit-broken by @Arbiter, @Orchestrator executes priority-based degradation retry (invoking @Meta-Planner to generate finer-grained tasks), expert switch (@Architect re-reviews contracts), or human standby (with complete failure context attached).

### Runtime Artifact Path Convention

All agent runtime artifacts (TASK_LOG.md, HANDOVER.md, test_report.json, *_report.json) are stored uniformly in the `.task_temp/{taskId}/` directory. Cross-task global files (WAIVE.md, incident_report.md, deployment_status.json) are stored in `.task_temp/_global/`. `Task.DAG.json` is stored in the project root and must be tracked by Git (required by pre-commit hook validation).

## V. Skill Invocation Standards

All agents may only invoke Skills bound in their own configuration; unauthorized invocation of unlicensed Skills is prohibited, strictly following project Skill compliance requirements.

## VI. Standard Execution Flow (Global Entry + RED/GREEN TDD Enforcement + Engineering Reliability)

> ⚠️ **Applicability**: The following flow applies to **all types** of work items — feature development, bug fixes, style adjustments, performance optimization, etc. Not limited to "large features."

0. [Entry Decision] **@Orchestrator or primary agent receives a new work item → immediately check Task.DAG.json**:
   - If no DAG or no current task entry → execute step 1 first (@Meta-Planner planning)
   - If DAG already contains the current task with status pending → skip to step 2
1. Requirements input → @Meta-Planner reads requirements docs + **scans TECH_DEBT_REGISTRY.md** → generates Project.graph + Task.DAG.json (or updates existing DAG)
2. @Orchestrator dispatches tasks per DAG → @Architect outputs contract.yaml (with `x-keystone-state-hash`, interface/data contracts, TDD single source of truth)
3. [TDD-RED Phase] @Coder-BE / @Coder-FE based on contracts + requirements → write failing test cases (Commit Message tagged `[Red] {task_id}`) → execute tests (must fail)
4. [TDD-GREEN Phase] @Coder-FE / @Coder-BE **update TASK_LOG.md working memory** → based on test cases → write minimal business code → make all tests pass (Commit Message tagged `[Green] {task_id}`)
5. [Task Handover] Executing agent outputs **HANDOVER.md handover summary** + **test_report.json (with execution_evidence + eslint_audit)**
6. [TDD-REFACTOR Phase] @Coder refactors code → regression tests (maintain all passing) → update test_report.json
7. [Compliance Gate Close Loop] @Coder calls **compliance_gate_complete** → internally executes ESLint mock-audit full scan (CAT1.1 check + CAT1.0 bypass check) → machine.json.eslint_state updated → returns failed when violations > 0, @Coder must fix and retry
8. @Guardian code review (standards/security/architecture + **machine.json.eslint_state compliance check** + **test execution evidence verification (DoD mandatory check)**) → conflicts resolved by @Arbiter
8. Git Hook validates machine.json contract hash synchronization → code merge
9. @CI-CD-Agent deployment/self-healing → results fed back to @Orchestrator → full process closed loop
10. [Circuit Breaker Retry] If 3 consecutive failures → @Arbiter intervenes → @Orchestrator executes degradation retry / expert switch / human standby

---

> **Project-Specific Reference**: Tech stack, project structure, common commands, architecture quick reference and other specific information can be found in [PROJECT_REFERENCE.md](./PROJECT_REFERENCE.md). Each project should customize the `{placeholder}` placeholders in that file to match its actual project configuration.
