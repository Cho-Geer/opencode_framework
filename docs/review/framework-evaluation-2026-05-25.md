# OpenCode Framework Evaluation — `work-one` Branch

**Evaluated at**: 2026-05-25 | **Framework version**: v4.0.8 | **Branch**: `work-one`

---

## 1. Strong Harness (Framework Shell Robustness)

### Architecture of Enforcement

The framework shell is built as a **concentric defense system** with four layers:

| Layer | Mechanism | What it protects |
|-------|-----------|-----------------|
| L0: Boot-time | `opencode.json` — agent definitions, file-level permissions, plugin registration | Guarantees agents start with correct scopes and models |
| L1: Pre-execution | `pre-execution-gate.js` — 5 fail-closed checks (DAG coverage, gate lifecycle, role violations, rule registry integrity, config validity) | Blocks execution of unplanned or unauthorized work |
| L2: Runtime | `framework-enforcer.ts` — 14 plugin hooks intercepting `tool.execute`, `shell.env`, `file.edited`, `session.*`, `permission.*`, `command.*`, `tui.command.*` | Real-time governance during agent operation |
| L3: Commit-time | `pre-commit` hook — multi-layer enforcement (gate armed check → rule registry verification → lint-staged → keystone-validate → full audit) | Prevents tainted code from entering the repository |

### Strengths

1. **Fail-closed semantics**: `pre-execution-gate.js` uses exit code 0/1/2 with explicit remediation paths. Every check that fails produces a **REMEDIATION_MAP** entry telling the operator exactly what to fix. This is a well-designed defense-in-depth pattern.

2. **Three-mode enforcement**: `advisory` (log-only), `strict` (block on policy violations), `locked` (block + tamper auto-restore + no waivers + no downgrade). The mode ladder allows gradual adoption — teams can start in advisory, graduate to strict, and lock production branches.

3. **Plugin self-integrity**: The `framework-enforcer.ts` computes its own SHA-256 hash at boot and re-verifies on each hook invocation. Any modification is detected and blocked in strict/locked mode. This closes the obvious attack vector of disabling the enforcer.

4. **Git hook integrity**: The `pre-commit` hook chains multiple verification layers. Resolving enforcement mode from `project.config.json` at hook runtime means the hook always reflects the project's current policy — not a stale snapshot.

5. **Workspace isolation**: `OPENCODE_ROOT` is derived from `__dirname` (not `cwd`), preventing `cd`-based path confusion. The write-audit state validates that all recorded paths belong to the current workspace.

### Weaknesses / Risks

1. **Single plugin dependency**: The entire runtime enforcement capability depends on `framework-enforcer.ts` loading correctly. The `Project.graph` documents a v3.2.0 crash where an incorrect export format (object instead of function) caused silent worker termination. While fixed, this remains a single point of enforcement failure.

2. **Environment variable gating**: Several enforcement checks (`FRAMEWORK_AGENT`, `FRAMEWORK_TASK_ID`, `FRAMEWORK_FILE_PATH`) rely on environment variables being set correctly. If the dispatch mechanism fails to set these, enforcement silently degrades.

3. **No cryptographic signing**: Rule files and agent configs use SHA-256 digests in `rule_registry.json` for integrity, but there is no signature chain — a sufficiently motivated attacker could modify both a rule file and its digest entry simultaneously.

4. **Shell dependency in hooks**: The `pre-commit` hook is bash-based and calls `node -e` for inline JSON parsing. This introduces shell injection risk vectors and cross-platform fragility (WSL/Windows).

---

## 2. Execution Control

### The DAG-Centric Control Model

Execution control is anchored on **Task.DAG.json** as the single source of truth. The framework enforces a strict protocol:

```
User Request → @Orchestrator checks DAG
  ├─ No DAG → dispatches @Meta-Planner to create one
  └─ DAG exists → schedules sub-agents per dependency ordering
```

### Strengths

1. **@Orchestrator tool ACL**: The orchestrator has an explicit `agent_tools_whitelist` (`task`, `todowrite`, `compliance-gate_*`, `dispatch-subagent`) and `agent_tools_blacklist` (`read`, `grep`, `glob`, `webfetch`). This is a **physical constraint** preventing the orchestrator from performing analysis — it literally cannot read files, forcing it to delegate. This is an elegant solution to the "manager who micromanages" anti-pattern.

2. **TDD step-by-step scheduling**: Each coding task is decomposed into 3 serial sub-tasks (RED → GREEN → REFACTOR). The pre-commit hook physically blocks non-test file commits under `Red` status. This is not aspirational — it's mechanically enforced.

3. **Write-time audit (Layer A)**: After every `Write`/`Edit`, agents must call `code_quality_gate.run_write_check()`. @Guardian's Layer A check compares `checks_run` against `files_in_git_diff`. A mismatch is AUTO FAIL. This closes the "agent says they checked but didn't" gap.

4. **Pre-execution gate at runtime**: The `framework-enforcer` plugin's `tool.execute.before` hook checks DAG coverage (is the task in the DAG? is its status `pending`/`in_progress`?) and gate armed state (is there an armed compliance session?). In strict/locked mode, violations throw errors that block execution.

5. **Circuit-breaker with cascading retry**: The 4-level retry strategy (original retry → degraded/@Meta-Planner → expert/@Architect → human standby) with a clear decision matrix prevents infinite retry loops while preserving escalation paths.

### Weaknesses / Risks

1. **Task.DAG.json is a single file**: At 4074+ lines (v4.0.8), the DAG has grown to a monstrous size. There is no partitioning or sharding mechanism for parallel task execution. Concurrent @Orchestrator sessions would race on this file.

2. **State synchronization lag**: Gate sessions must be drained, reconciled, or backfilled. The `state-reconciliation.js` script with `--backfill-audit` is a post-hoc patch, not a real-time sync mechanism. `gate-state.json` shows evidence of massive backfill operations (100+ sessions backfilled in a single run).

3. **ENFORCEMENT_MODE env var override**: The environment variable can override `project.config.json`'s mode but is blocked if config is `locked`. However, the check is string-based and case-sensitive — `"STRICT"` would bypass it.

4. **No task timeout mechanism**: There is no concept of task SLA or timeout in the DAG model. A task stuck `in_progress` forever has no automatic escalation path beyond the stale session drain (>24h armed without completion).

---

## 3. Deliverable Quality Control

### The Two-Layer Guardian Architecture

Quality control is implemented as a **dual-layer gate**:

- **Layer A (Auto Gate)**: Reads `machine.json` and task artifacts — fully automated, non-negotiable. If any of 8 automated checks fail, the gate returns FAIL without any manual review.
- **Layer B (Manual Review)**: Framework-specific code review with conditional checklists resolved from `project.config.json`.

### Strengths

1. **Layer A is genuinely automated**: Every check reads from a machine-readable state file or artifact. There is no "human judgment" escape hatch in Layer A. The 8 checks are:
   - ESLint dirty_modules empty
   - Type check status clean
   - Dependency status clean
   - Format status clean
   - No unresolved role violations
   - Write audit log coverage (checks_run ≥ files_in_git_diff)
   - TASK_LOG.md contains docs consistency report
   - Zero TDD violations

2. **Test execution evidence is mandatory**: `test_report.json` must contain `execution_evidence` (actual test output, not a placeholder). @Guardian checks `exit_code`, `output_summary`, coverage thresholds, and bogus test patterns. Missing evidence = AUTO FAIL. This directly combats the "AI wrote tests that don't actually run" problem.

3. **Bogus test detection**: @Guardian explicitly checks for empty assertions, getter/setter-only tests, and excessive mocking. Combined with ESLint rules (`no-empty-assertions`, `no-any-in-spec`), this provides defense against test fabrication.

4. **Write-time quality enforcement**: Each file write triggers scope check, tsc incremental, dependency-cruiser, ESLint mock-audit, and prettier. Violations are classified by severity (BLOCKER → ERROR). The agent cannot proceed with BLOCKER violations.

5. **contract.yaml keystone hash**: The `x-keystone-state-hash` in contract.yaml + `keystone_hashes` in `machine.json` form a two-layer integrity chain. The pre-commit hook Layer 2 verifies both match — if contract.yaml changes without hash update, the commit is rejected.

6. **Rule registry digest verification**: All rule files, skill files, requirement documents, and agent configs have SHA-256 digests in `rule_registry.json`. `compliance-gate.js` verifies these at preflight. Version-bumped mismatches are WARNING; same-version digest changes are HIGH severity.

### Weaknesses / Risks

1. **Coverage evidence is trust-based**: @Guardian reads `test_report.json` output but does not re-execute tests. If a malicious or hallucinating agent fabricates `execution_evidence`, Layer A will not detect it — it only verifies the field exists and contains plausible text.

2. **ESLint mock-audit is project-specific**: The audit uses a custom ESLint plugin (`eslint-plugin-opencode-mock-audit`) that checks for `jest.mock()` and `jest.fn()` patterns. This is NestJS/Jest-specific and would need replacement for projects using other testing frameworks.

3. **No deterministic replay**: There is no mechanism to deterministically replay a task's execution to verify the same inputs produce the same outputs. Quality verification is based on output artifacts, not input/output determinism.

---

## 4. Multi-Agent Pattern

### Architecture: Three Layers, Eight Roles

```
┌─────────────────────────────────────────────┐
│          META-COGNITIVE LAYER                │
│  @Meta-Planner (CTO)    @Orchestrator (PM)   │
│  Plans & decomposes     Schedules & tracks   │
├─────────────────────────────────────────────┤
│       ORCHESTRATION & EXECUTION LAYER        │
│  @Architect      @Coder-BE      @Coder-FE    │
│  Contracts       Backend impl    Frontend impl│
├─────────────────────────────────────────────┤
│        VALIDATION & OPERATIONS LAYER          │
│  @Guardian    @Arbiter    @CI-CD-Agent       │
│  Quality gate  Arbitration  Deploy/self-heal │
└─────────────────────────────────────────────┘
```

### Strengths

1. **Role clarity via anti-goals**: Each agent has an explicit list of "Absolutely prohibited" actions. For example, @Orchestrator may not analyze requirements, @Guardian may not fix bugs, @Coder-BE may not write implementation before tests. These aren't suggestions — they're enforced by write scopes and tool ACLs.

2. **Permission isolation at the filesystem level**: `project.config.json` defines `agent_write_scopes` with `allowed` and `denied` glob patterns. @Coder-FE cannot write to backend directories; @Guardian cannot modify any source code. This is enforced by the `framework-enforcer` plugin at runtime and by `code-quality-gate` at write-time.

3. **Clear input/output contracts**: Every agent specifies its input contract (what it receives) and output artifacts (what it produces). This creates a well-defined interface between agents, reducing coupling.

4. **Handover mechanism (HANDOVER.md)**: Execution agents (@Coder-BE, @Coder-FE) must output a handover summary with core changes, key assumptions, potential pitfalls, and testing reminders. Combined with `TASK_LOG.md` (working memory scratchpad), this addresses the context-drift problem in long agent chains.

5. **@Arbiter as circuit-breaker**: The arbiter has read-only access to business code and contracts, and write access only to `WAIVE.md` and `TECH_DEBT_REGISTRY.md`. It cannot fix code — only adjudicate. The 3-failure meltdown trigger forces human-relevant escalation.

6. **Model tiering**: Different models for different roles. @Meta-Planner, @Architect, @Arbiter, @CI-CD-Agent use `deepseek-v4-pro` (higher reasoning). @Orchestrator, @Coder-BE, @Coder-FE, @Guardian use `deepseek-v4-flash` (lower latency/cost). This is a pragmatic optimization.

### Weaknesses / Risks

1. **No agent health monitoring**: There is no mechanism to detect if an agent is stuck, hallucinating, or producing invalid output before it completes its task. The circuit-breaker only triggers after 3 complete failures — not mid-task degradation.

2. **@Orchestrator is a single point of scheduling failure**: If the orchestrator's session crashes or produces incorrect scheduling decisions, there is no backup orchestrator or consensus mechanism.

3. **Agent configs are mixed with project-specific rules**: Agent definitions in `.opencode/agents/*.md` contain both generic role descriptions AND project-specific rules (e.g., `@Coder-BE` references NestJS specifically). This reduces reusability across projects.

4. **No agent capability negotiation**: When @Coder-BE encounters a task it cannot handle, it can only fail. There is no protocol for an agent to declare "I need @Architect to resolve this first" — that has to be detected by @Orchestrator post-hoc.

---

## 5. Central State Management

### The State Architecture

The framework maintains **three authority files** forming the central state:

```
.opencode/state/
├── machine.json          ← Central state authority (10 sub-states, ~2000 lines)
├── gate-state.json       ← Compliance gate lifecycle (~100+ sessions)
├── .transaction-log      ← Write-Ahead Log (NDJSON, append-only)
├── rule_registry.json    ← Digest registry for all rule/skill/agent files
├── machine.schema.json   ← JSON Schema validator (572 lines, 9 sub-state schemas)
└── project.config.schema.json
```

### Strengths

1. **Unified state transaction engine** (`state-transaction.js`): Implements a two-phase commit protocol (PREPARE → COMMIT / ROLLBACK) with UUID v4 operation IDs, monotonic revision counter, atomic file replacement via tmpfile + rename, and write-ahead logging. Crash recovery scans for orphaned `.prepared` markers. This is production-grade transactional integrity for state files.

2. **10 sub-states with granular tracking**: `machine.json` tracks ESLint state (per-module), TypeScript type-check state, dependency state, format state, write-audit state (per-session), compliance records (role/gate/TDD violations), TDD enforcement state, contracts list, and keystone hashes. Each sub-state has its own clean/dirty/enabled flags.

3. **Monotonic revision counter**: Every state mutation increments `machine.json.meta.revision`. This provides a linear history check — @Guardian can verify that state transitions happen in order without gaps.

4. **Auto-repair mechanisms**:
   - `state-reconciliation.js` with `--backfill-audit` for missing gate sessions
   - `gate-lifecycle-audit.js` for stale session detection
   - `framework-enforcer` auto-drains sessions >24h armed without completion
   - `state-machine-reset.sh` for clean baseline restoration
   - `state-canonicalize.js` for path normalization

5. **Schema validation**: `machine.schema.json` is a comprehensive JSON Schema (2020-12) with 572 lines covering all 9 required sub-states with field-level type constraints. `code-quality-gate.js` validates `machine.json` against this schema at bootstrap using AJV.

6. **Cross-workspace contamination protection** (`FW-REPAIR-09`): `validateWorkspaceIntegrity()` scans `machine.json` paths against `OPENCODE_ROOT`, `sanitizePathsInMachine()` auto-cleans foreign paths, and `isPathInWorkspace()` blocks out-of-workspace path recording.

7. **Framework doctor diagnostics** (`framework-doctor.js`): 11+ health checks covering DAG health, gate health, state health, registry health, hook health, enforcement health. Supports `--strict` (exit 1 on failure), `--json` (machine-readable), `--fix` (auto-repair), and `--check N` (single check).

8. **Framework self-test** (`framework-self-test.js`): 26 integrity checks from a single command, validating everything from file existence to placeholder resolution, path canonicalization, and enforcement mode consistency.

### Weaknesses / Risks

1. **machine.json is too large**: At ~2000 lines and 158 revisions, it is approaching the point where human inspection is impossible. A corrupted field deep in the JSON structure may go unnoticed by automated checks.

2. **transaction-log is append-only with no rotation**: The WAL (`.transaction-log`) will grow unboundedly. There is no log rotation, compaction, or retention policy implemented.

3. **No distributed state support**: The entire state model assumes a single workspace, single process. Multi-developer scenarios with concurrent state mutations are not addressed.

4. **gate-state.json bloating**: The file contains 100+ session records including completed, drained, and backfilled entries. Session purging exists (`compliance_gate_purge`) but is manual, not automatic.

5. **State recovery is reactive**: `state-reconciliation.js` runs post-hoc. There is no continuous state integrity daemon running alongside agent execution.

---

## 6. Universality (Framework Generality)

### The Parameterization Strategy

The framework uses a **tiered template** approach to achieve cross-project compatibility:

| Tier | Examples | Content |
|------|----------|---------|
| Tier 1 (Universal) | TDD rules, naming conventions, file separation, type safety, commit format | Framework-agnostic, applicable to any project |
| Tier 2 (Parameterized) | `{backend.framework}`, `{backend.orm.transaction}`, `{frontend.css_strategy}` | Resolved via `project.config.json.template_resolution` |
| Resolution Block | Mapping table in each template | Maps placeholders to concrete values for the current project |

### Strengths

1. **28 dispatch-resolvable placeholders across 8 categories**: `{project.*}` (4), `{backend.*}` (5), `{frontend.*}` (7), `{cache.*}` (2), `{queue.*}` (1), `{db.*}` (2), `{auth.*}` (3), `{testing.*}` (4). Plus 12 extended placeholders for coding-standard resolution tables.

2. **Generic resolution engine**: `dispatch-subagent.js`'s `buildTemplateResolutionMap()` generically iterates ALL `template_resolution` entries (4-phase resolution), avoiding hardcoded key lists.

3. **Conditional framework checklists**: `@Guardian` supports conditional review checklists for Angular/React/Vue (frontend) and NestJS/Express/Fastify (backend). An unconfigured framework triggers a WARNING for @Architect review, not a crash.

4. **Coding standards as templates**: Both `backend-coding-standard.md` and `frontend-coding-standard.md` have been restructured into Tier 1 (universal) + Tier 2 (framework-parameterized). The abstracted rules use placeholders that resolve to concrete values for the current tech stack.

5. **Compatibility profile mechanism**: `COMPATIBILITY_PROFILE.md` and `universal-compatibility-profile.md` document how the framework maps to different tech stacks.

6. **Path lint for absolute path leakage**: `path-lint` configuration in `project.config.json` detects hardcoded absolute paths (`/home/`, `/Users/`, Windows drives). `framework-self-test.js` Check 19 enforces this. This is critical for cross-developer and cross-CI portability.

7. **OPENCODE_ROOT resolution**: Both `pre-execution-gate.js` and `framework-enforcer.ts` resolve `OPENCODE_ROOT` from `__dirname` or the environment variable, making the framework relocatable.

### Weaknesses / Risks

1. **Deep NestJS/Angular imprint**: Despite parameterization efforts, the framework carries significant NestJS/Angular DNA:
   - `contract.yaml` uses NestJS-specific decorators (`@ApiProperty`, `@ApiOperation`)
   - Backend testing standards assume Prisma + Jest + Supertest
   - Frontend testing standards assume Angular-specific patterns (`@Input()`, SignalStore)
   - Several `Coder-BE` constraints reference `prisma.$transaction()` and `@nestjs/swagger`

2. **No project bootstrap wizard**: To use this framework on a new project, a developer must manually configure `project.config.json` with all 28+ template resolutions. There is no interactive wizard or validation of the configuration's completeness.

3. **Template variable documentation has two versions**: Both `template-variable-standard.md` and `TEMPLATE_VARIABLE_STANDARD.md` exist, creating confusion about which is canonical.

4. **Language assumption**: The entire framework assumes TypeScript. Python, Go, Rust, or other language projects would need extensive adaptation — not just parameterization.

5. **Project structure assumption**: The framework assumes a specific `booking_system_refactor/booking-backend/` + `booking_system_refactor/booking-frontend/` layout. While parameterized, the mental model is tightly coupled to a monorepo with separate backend/frontend directories.

6. **The plugin is TypeScript-only**: `framework-enforcer.ts` requires transpilation and the `@opencode-ai/plugin` SDK. For projects that don't use npm/TypeScript, the plugin would need porting.

---

## Summary Scorecard

| Perspective | Score | Key Strengths | Key Weaknesses |
|-------------|:-----:|--------------|----------------|
| **Strong Harness** | **8.5/10** | Fail-closed gates, 3-mode enforcement, plugin self-integrity, defense-in-depth | Single plugin dependency, ENV-based gating, no cryptographic signatures |
| **Execution Control** | **8.0/10** | DAG-centric model, Orchestrator tool ACL, write-time audit, circuit-breaker | DAG file bloat, state sync lag, no task timeouts, env var bypass risk |
| **Quality Control** | **8.5/10** | Dual-layer Guardian, mandatory execution evidence, bogus test detection, keystone hash chain | Trust-based evidence verification, Jest-specific ESLint rules, no deterministic replay |
| **Multi-Agent Pattern** | **9.0/10** | Clear role boundaries enforced by write scopes, model tiering, handover + TASK_LOG mechanisms, @Arbiter circuit-breaker | No agent health monitoring, single Orchestrator, mixed generic+project configs |
| **Central State** | **8.5/10** | Two-phase commit transactions, 10 sub-states, auto-repair, cross-workspace protection, comprehensive diagnostics | machine.json bloat, no WAL rotation, single-workspace assumption, reactive recovery |
| **Universality** | **6.5/10** | Tiered templates, 28 placeholders, conditional checklists, path linting, relocatable root | Deep NestJS/Angular DNA, TypeScript-only, no bootstrap wizard, monorepo assumption |
| **OVERALL** | **8.2/10** | A production-grade multi-agent governance framework with genuine mechanical enforcement — not just prompts | Remains tightly coupled to its originating tech stack; universality is aspirational rather than achieved |

### Top-Level Verdict

The OpenCode framework is a **serious engineering artifact**. It does not merely *suggest* that agents follow rules — it **mechanically prevents** violations through file-level permission matrices, runtime hook interception, pre-commit verification chains, and transactional state integrity. The architecture demonstrates deep understanding of multi-agent failure modes: context drift (mitigated by TASK_LOG + HANDOVER), unauthorized analysis (mitigated by Orchestrator tool ACL), test fabrication (mitigated by execution_evidence + bogus detection), scope creep (mitigated by agent_write_scopes), and state corruption (mitigated by WAL + two-phase commit).

The primary architectural debt is the **tension between universality and specificity**. The framework's governance mechanisms are genuinely generalizable — enforcement modes, write scopes, DAG decomposition, compliance gates, state transactions. But its *content* (coding standards, contract format, testing patterns, agent prompts) is deeply imprinted with NestJS + Angular + Prisma assumptions. Achieving true cross-framework universality would require extracting the governance skeleton from the content corpus — a non-trivial refactor.
