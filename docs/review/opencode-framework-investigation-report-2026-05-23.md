# OpenCode Framework — Strict Investigation Report
## Inconsistencies · Ambiguities · Potential Problems · Omissions
## Perspective: Strong Binding · Central State Management · Multiple Agents System

**Investigator**: WorkBuddy AI (Agent Mode: Craft)  
**Scope**: All files under `C:\Users\USER\Documents\workbuddy_framework\`  
**Date**: 2026-05-23  

---

## Executive Summary

The OpenCode Framework is an architecturally ambitious multi-agent system with genuinely advanced ideas: DAG-driven task planning, TDD-enforced code generation, compliance gates with stateful lifecycle, and a three-layer agent hierarchy. However, the framework suffers from **structural inconsistencies between its stated invariants and its actual runtime behavior**, **ambiguities in agent binding and state ownership**, and **several potential failure modes in its central state management** that could lead to non-deterministic agent behavior under concurrency or failure recovery.

This report is organized by **impact severity** (P0 = framework-correctness critical, P1 = reliability/consistency, P2 = maintainability/universality).

---

## PART I — INCONSISTENCIES (stated invariants that contradict each other or the code)

### P0-I-01: Dual State Plane without Atomic Commit (the "Split-Brain" Problem)

**Files involved**: `AGENTS.md §四.7`, `gate-state.json` schema (implicit), `machine.json` schema (implicit), `docs/review/opencode-framework-central-state-multi-agent-assessment-2026-05-21.md REC-01`

**The inconsistency**:
AGENTS.md mandates that `compliance_gate_confirm()` adds a session to `gate-state.json.active_sessions`, and `compliance_gate_complete()` removes it, while *separately* `code-quality-gate.js` writes to `machine.json` sub-states (`eslint_state`, `write_audit_state`, etc.). These are **two independent file writes with no atomic commit protocol**.

The review assessment (REC-01) explicitly identifies this and proposes a "Unified State Transaction Envelope" (RVW-REVIEW-01 task). **The fact that this is still in "pending" status means the framework, as it currently runs, can produce inconsistent state:**

- `gate-state.json` says `session_abc` is armed
- `machine.json` was never updated because the process crashed between the two writes

**Consequence**: @Orchestrator can schedule tasks whose gate says "armed" but whose `machine.json` has no write-audit evidence. @Guardian will then either false-positive (accept incomplete work) or false-negative (reject valid work).

**Severity**: P0 — compromises the framework's core correctness guarantee.

---

### P0-I-02: `contract.yaml` Keystone Hash — Single File, Not a Bundle

**Files involved**: `contract.yaml` (line 1 `x-keystone-state-hash: sha256-...`), `AGENTS.md §四.3`, `RVW-REVIEW-05` task description, `FW-REPAIR-05` task

**The inconsistency**:
AGENTS.md §四.3 states: *"@Architect输出的`contract.yaml`为只读锁定状态，前后端开发、测试、审查均以此为唯一依据"* — the contract is the **single source of truth**.

But `RVW-REVIEW-05` (P1) explicitly identifies that only `contract.yaml`'s hash is tracked in `machine.json.keystone_hashes`, while **6 requirement docs, all agent configs, and all rule files are NOT hash-tracked**. The assessment says: *"GAP-10 (keystone_hashes never populated except contract.yaml)"*.

If any of those untracked files change without a contract hash change, **the framework's "strong binding" guarantee is vacuously true** — it detects contract tampering but not rule/requirement drift.

**Severity**: P0 — the "strong binding" claim is currently false.

---

### P0-I-03: `compliance_gate_complete` — ESLint Mock-Audit Mandatory but `machine.schema.json` Doesn't Exist

**Files involved**: `AGENTS.md §二.强制规则` (lines 88-91), `FW-REPAIR-03` (pending), `code-quality-gate.js` (referenced but not read)

**The inconsistency**:
AGENTS.md line 91 states: *"compliance_gate_complete 内部执行 ESLint mock-audit 全量扫描（CAT1.1 检查 + CAT1.0 绕过检查）→ machine.json.eslint_state 更新 → 违规 > 0 时返回 failed"*.

But `FW-REPAIR-03` (status: **pending**, priority P0) is literally: *"Create machine.schema.json in .opencode/state/"*. The schema file that validators would use to check `eslint_state` structure **does not exist yet**.

This means the `eslint_state` field in `machine.json` has **no structural validation** — any agent can write arbitrary shape to it, and `compliance_gate_complete` will read potentially malformed data.

**Severity**: P0 — runtime behavior is undefined for a core enforcement path.

---

### P1-I-04: @Orchestrator "No Analysis" Rule vs. Actual `dispatch-subagent.js` Behavior

**Files involved**: `AGENTS.md §三 (Orchestrator row)`, `AGENTS.md §P0 子Agent派遣规则`, `.opencode/scripts/command-tools/dispatch-subagent.js` (not directly read, but referenced)

**The inconsistency**:
AGENTS.md says @Orchestrator *"仅负责：按 DAG 调度子Agent、追踪任务状态、合并最终产物、协调重试。**禁止**：分析需求、拆解任务、修改 DAG 定义"*.

But the P0 dispatch rule says: *"运行 `node .opencode/scripts/command-tools/dispatch-subagent.js <agent_type> "<task>" 生成包装后的Prompt"*.

The `dispatch-subagent.js` script **reads `.opencode/agents/<agent_type>.md`** to build the prompt. If `.md` files contain analysis instructions (which they do — see `architect.md`, `coder-be.md`), then @Orchestrator is effectively **delegating analysis, not avoided it** — the boundary is blurred because the *prompt wrapper* injects analysis capabilities.

Put differently: the *letter* of the rule is followed (Orchestrator doesn't analyze), but the *spirit* is violated because the dispatched prompt carries analysis instructions.

**Severity**: P1 — architectural boundary is模糊 (blurred), making debuging harder.

---

### P1-I-05: `template_resolution` Missing from `project.config.json` (Referenced but Absent)

**Files involved**: `FW-REPAIR-01` (pending, P0), `AGENTS.md` (placeholder references), `UNIV-P1-C/P1-D` (completed — coding standards now use `{backend.*}` placeholders)

**The inconsistency**:
`UNIV-P1-C` and `UNIV-P1-D` are marked **completed** — meaning `.opencode/rules/backend-coding-standard.md` and `frontend-coding-standard.md` now contain `{backend.*}` and `{frontend.*}` **placeholders**.

But `FW-REPAIR-01` (which adds `template_resolution` to `project.config.json`) is **pending**. Until it's completed, **all those placeholders are unresolvable** — any agent reading the coding standards will see literal `{backend.framework}` instead of `NestJS v11+`.

The framework's own universality enhancement (UNIV phase) **depends on a pending P0 repair task**. This is a **dependency cycle masked by status tracking**: UNIV tasks are "completed" but produce files that cannot function until FW-REPAIR-01 is also completed.

**Severity**: P1 — agents will operate on malformed rule files until the repair is done.

---

### P1-I-06: `pytest` vs. `jest` — Testing Framework Ambiguity in PROJECT_REFERENCE.md

**Files involved**: `PROJECT_REFERENCE.md` (lines 43-47, 64-67), `AGENTS.md §二.TDD强制铁律`, actual project stack

**The inconsistency**:
`PROJECT_REFERENCE.md` documents commands like `npm run test` (Jest), `npm run test:cov` (Jest). The framework's TDD enforcement is Jest-based.

However, `PROJECT_REFERENCE.md` line 138 says: `| Mutation | Stryker | 80% | 变异测试质量门禁 |`. Stryker **supports Jest** — this is not an inconsistency by itself.

*BUT*: the `testing-coding-standard.md` (referenced in AGENTS.md but not read) may define framework-agnostic test patterns. If it was parameterized in UNIV-P1 but the actual project uses Jest, and a new project uses Pytest + pytest-cov, **the TDD enforcement pipeline may silently skip mutation testing** because Stryker's Jest plugin won't work with pytest.

**Severity**: P1 — framework's test enforcement is framework-coupled despite UNIV parameterization.

---

## PART II — AMBIGUITIES (under-specified behaviors that lead to agent non-determinism)

### P0-A-01: What Happens When `compliance_gate_confirm` Is Called Twice for the Same Task?

**Files involved**: `compliance-gate.js` (referenced), `gate-state.json` schema

**The ambiguity**:
AGENTS.md says `compliance_gate_confirm(plan_summary)` "arms" the gate. But there is **no specified idempotency behavior**:

- Can the same `session_id` be confirmed twice?
- Does the second call overwrite the first, or return an error?
- What if `session_id` collides across two concurrent agents?

Without a specified answer, two agents could both "arm" their gates, and @Orchestrator might schedule both — **violating the "one armed gate per task" invariant**.

The `RVW-REVIEW-01` task (transaction envelope) would partially address this with `operation_id` UUIDs, but until it's implemented, **the behavior is undefined**.

---

### P0-A-02: `machine.json` Ownership — Which Agent Is Allowed to Write Which Sub-State?

**Files involved**: `AGENTS.md §四.核心协作协议`, `machine.json` (not directly read, but referenced extensively)

**The ambiguity**:
`machine.json` has ~9 sub-state sections: `eslint_state`, `type_check_state`, `dependency_state`, `format_state`, `write_audit_state`, `compliance_records`, `tdd_enforcement_state`, `contracts/keystone_hashes`.

AGENTS.md says @Coder agents write `test_report.json` (with `execution_evidence`), and @Guardian reads it. But **which agent is allowed to mutate `machine.json` directly?**

- Does @Coder write `tdd_enforcement_state`?
- Does @Guardian write `eslint_state`?
- Does @Orchestrator write `compliance_records`?

The **absence of a write-ownership matrix** means any agent *could* (try to) write any sub-state, leading to **conflicting concurrent writes** — especially problematic because `machine.json` is a single JSON file (no record-level locking).

`FW-REPAIR-09` (P2, pending) mentions *"code-quality-gate.js bootstrap verifies file paths in machine.json belong to current OPENCODE_ROOT"* — but doesn't address write ownership.

---

### P1-A-03: `Task.DAG.json` `execution_order` — What Does "parallel" Actually Mean?

**Files involved**: `Task.DAG.json` (lines 1217-1324, `execution_order` field)

**The ambiguity**:
`execution_order` has entries like:
```json
"phase_2_parallel": {
  "backend": ["B-MSG-GREEN-001"],
  "frontend": ["B-MSG-RED-FE"]
}
```

The term "parallel" is used, but the **framework doesn't specify whether this means**:
1. Actual concurrent execution (two Agent tool calls in the same turn), or
2. Merely "these can be scheduled in any order" (partial order, not true concurrency)

If it's (1), then `machine.json` concurrent write races apply. If it's (2), the word "parallel" is misleading and should be "independent".

The `AGENTS.md` §四.2 says: *"无依赖任务并行执行"* ("execute tasks without dependencies in parallel"). This **explicitly means (1)** — but then the concurrent write problem to `machine.json` is real and unaddressed.

---

### P1-A-04: `{placeholder}` Resolution — What Happens When a Placeholder Is Unresolvable?

**Files involved**: `UNIV-P2-A/P2-B` (completed), `FW-REPAIR-06` (pending), `AGENTS.md`

**The ambiguity**:
After UNIV-P2, agent configs contain `{backend.orm.schema}` etc. `FW-REPAIR-06` (pending) is supposed to implement the resolution engine in `dispatch-subagent.js`.

But **what is the runtime behavior between "now" and "FW-REPAIR-06 completion"?**

- Do agents see literal `{backend.orm.schema}` in their config?
- Does the framework have a **fallback value** for each placeholder?
- Is there a **warning log** when resolution fails?

AGENTS.md and the completed UNIV tasks don't specify the fallback behavior. The `RVW-REVIEW-11` task (P2, pending) is supposed to create `TEMPLATE_VARIABLE_STANDARD.md` documenting all placeholders — but again, **it's pending**.

**Practical consequence**: an agent could be reading `{backend.orm.schema}` as a literal string and passing it to a shell command, causing runtime errors that are very hard to debug.

---

### P2-A-05: `@Arbiter` Trigger Condition — Who Decides When to Escalate?

**Files involved**: `AGENTS.md §四.7` ("死循环熔断"), `TECH_DEBT_REGISTRY.md`

**The ambiguity**:
AGENTS.md says: *"连续3次未通过审查/测试，自动触发@Arbiter介入，终止当前任务流"* ("After 3 consecutive failures, automatically trigger @Arbiter to intervene").

But **who counts the "3 consecutive failures"?** Is it:
- @Guardian (who does the review)?
- @Orchestrator (who tracks task status)?
- The agent itself (who ran the tests)?

There's no `failure_count` field in `Task.DAG.json` task schema. There's no specified escalation API (e.g., `@Orchestrator -> dispatch('arbiter', ...)`).

The **escalation path is underspecified**, meaning in practice, the "circuit breaker" might never fire, or might fire spuriously.

---

## PART III — POTENTIAL PROBLEMS (failure modes that can arise at runtime)

### P0-P-01: `machine.json` Is a Single Point of Failure (SPOF)

**Files involved**: All agents (all write to/through `machine.json`)

**The problem**:
`machine.json` is a **single JSON file**. Every agent's compliance evidence, TDD state, ESLint audit result, and write-audit trail eventually lands in this file.

**Failure modes**:
1. **Concurrent write corruption**: Two agents running in parallel (see P1-A-03) both read `machine.json`, both write it back → **one agent's changes are silently lost**.
2. **Partial write on crash**: Agent crashes mid-write → `machine.json` is invalid JSON → **every subsequent agent fails to read state**.
3. **File size growth**: Every write-audit entry, every ESLint result, every compliance record is appended. Over a long-lived project, `machine.json` could grow to **megabytes**, making every read/write slow.

The `RVW-REVIEW-01` task (transaction envelope with `.prepared` marker and recovery) would mitigate (2), but **not (1) or (3)**.

**Recommendation**: Split `machine.json` into per-domain files (`eslint-state.json`, `tdd-state.json`, `compliance-state.json`) with a top-level `machine-manifest.json`, OR use an embedded database (SQLite) for state storage.

---

### P0-P-02: Compliance Gate Forecable (Race Condition in `gate-state.json`)

**Files involved**: `compliance-gate.js`, `gate-state.json`, `pre-execution-hook.sh`

**The problem**:
The compliance gate has a **TOCTOU (Time-of-Check-Time-of-Use) vulnerability**:

1. Agent A checks `gate-state.json` — sees no active session for task T
2. Agent B checks `gate-state.json` — same
3. Agent A writes its session to `gate-state.json`
4. Agent B writes its session to `gate-state.json` — **overwrites A's session**

`gate-state.json` is also a single JSON file. Without file-level locking (which is unreliable across Node.js processes anyway), **two agents can both believe they have an "armed" gate for the same task**.

**Consequence**: Two agents concurrently modify the same files, **both believe they're compliant**, and @Guardian sees a merge conflict or silently accepts one agent's changes.

---

### P0-P-03: `write_audit_state` Path Pollution Across Workspaces

**Files involved**: `FW-REPAIR-04` (pending, P0), `machine.json.write_audit_state`, `code-quality-gate.js`

**The problem**:
`FW-REPAIR-04`'s acceptance criteria say: *"write_audit_state.current_session reset (cross-workspace data removed)"* and *"No paths referencing '/home/zhaoge/workspace/opencode/work-one/' remain in machine.json"*.

This means **cross-workspace path pollution has already happened at least once**. The fact that it required a manual "reset" rather than automatic detection means:

1. An agent running in Workspace A wrote audit entries for files in Workspace B
2. Those entries persisted until manually discovered and cleaned

**Until `FW-REPAIR-09` (P2, pending) adds cross-workspace protection to `code-quality-gate.js`**, this can happen again — especially if an agent is reused across multiple workspaces without proper state isolation.

---

### P1-P-04: `@Orchestrator` Can Be Bypassed Entirely

**Files involved**: `AGENTS.md` P0 rules, `pre-execution-hook.sh` (only checks `Task.DAG.json` existence)

**The problem**:
The P0 rule says *"所有任务必须从 `/compliance-gate` 开始"*. But **what enforces this?**

`pre-execution-hook.sh` (from `OPC-FW-DAG-GATE`, completed) checks if `Task.DAG.json` exists and has a pending task — but it **doesn't verify that `compliance_gate_check()` was actually called**.

A sufficiently motivated (or buggy) agent can simply **skip calling `compliance_gate_check()`**, proceed to analysis/code, and the `pre-execution-hook.sh` won't block it because the task *exists* in the DAG.

The **enforcement is cooperative** (dependent on agents choosing to call the gate), not **coercive** (enforced by the runtime). This is a fundamental limitation of prompt-based enforcement.

---

### P1-P-05: `TECH_DEBT_REGISTRY.md` Is a Manual Process — No Automatic Scanning

**Files involved**: `TECH_DEBT_REGISTRY.md`, `AGENTS.md §四.10`

**The problem**:
AGENTS.md says: *"@Arbiter 批准 `WAIVE.md` 后，必须在项目根目录 `TECH_DEBT_REGISTRY.md` 中追加记录；@Meta-Planner 规划新版本时必须扫描该注册表"*.

This is **entirely manual**:
- @Arbiter has to remember to append to the registry
- @Meta-Planner has to remember to scan it
- There's no `pre-commit` hook that scans for new `// TODO: TECH-DEBT` comments and auto-registers them

In practice, **tech debt items will be missed** because the human or agent forgets to update it. The registry will be incomplete, defeating its purpose.

---

### P1-P-06: `contract.yaml` Hash Is Computed by `keystone-validate.js` — But When Is It Recomputed?

**Files involved**: `contract.yaml` (line 1 hash), `keystone-validate.js` (referenced), `pre-commit` hook (referenced)

**The problem**:
The `x-keystone-state-hash` in `contract.yaml` is a **manual annotation** — someone (or some agent) has to run `keystone-validate.js --hash contract.yaml` and paste the result into the file.

**When does this happen?**
- On every contract change? Not automatically — there's no `pre-commit` hook that *computes* the hash (only one that *validates* it against `machine.json.keystone_hashes`)
- Only when @Architect remembers to do it?

If @Architect changes the contract but forgets to recompute the hash, **the hash check will fail at the worst possible time** (during a PR review or deployment).

---

### P2-P-07: `Skill` Tool — Agent Can Call Any Skill, Despite "Skill Compliance Guide"

**Files involved**: `skill-compliance-guide.md` (referenced in AGENTS.md), agent `.md` frontmatter `skills:` field

**The problem**:
AGENTS.md says: *"所有智能体仅可调用自身配置中绑定的专属Skill，禁止越权调用未授权Skill"*.

But the Skill tool's **actual enforcement mechanism** is unclear:
- Is it enforced by the `skill-compliance-guide.md` being injected into the system prompt? (cooperative)
- Is it enforced by the Skill tool itself checking the agent's frontmatter? (coercive)
- What happens when an agent **needs** a skill that's not in its frontmatter? Does it have to ask @Orchestrator to reconfigure it?

In practice, **an agent can call any available skill** via the Skill tool — the "compliance guide" is advisory, not technically enforced. This means the **skill isolation guarantee is currently aspirational**.

---

## PART IV — OMISSIONS (things the framework should specify but doesn't)

### P0-O-01: No Specified Recovery Procedure for "Gate Armed but Agent Crashed"

**Files involved**: `compliance-gate.js`, `gate-state.json`

**The omission**:
If an agent calls `compliance_gate_confirm()` (arming the gate), then **crashes** (network failure, OOM, process kill) before calling `compliance_gate_complete()`:

- `gate-state.json` will permanently have an orphaned `active_session`
- `machine.json` may have a partial `write_audit_state.current_session`
- @Orchestrator will see the task as "in_progress" forever

**There is no specified timeout or cleanup mechanism** for orphaned gate sessions. The `RVW-REVIEW-01` task (transaction envelope with recovery marker) would add this, but it's pending.

Until then, **a single crashed agent can permanently stall a task**.

---

### P0-O-02: No Defined Behavior for `Task.DAG.json` Circular Dependencies

**Files involved**: `Task.DAG.json`, `@Meta-Planner` (DAG generator)

**The omission**:
`Task.DAG.json` has a `dependencies` field per task. **What happens if the dependencies form a cycle?**

- Does `@Meta-Planner` detect cycles during generation? (Underspecified)
- Does `@Orchestrator` detect cycles before scheduling? (Not mentioned)
- What's the error message? (Not specified)

In a complex 52-task DAG (like the current one), **an accidental cycle could be introduced** during manual editing or partial DAG updates. Without a cycle detector, @Orchestrator will either hang (walking the cycle forever) or crash with a stack overflow.

---

### P0-O-03: `machine.json` JSON Schema — Not Yet Exists (FW-REPAIR-03 Pending)

**Files involved**: `FW-REPAIR-03` (pending P0), `machine.json`

**The omission**:
`machine.json` is the **central state store** of the entire framework. It has ~9 sub-state sections. **There is no JSON Schema defining its structure.**

This means:
- Any agent can write extra fields to `machine.json`
- Any agent can misspell a field name (e.g., `eslint_stat` instead of `eslint_state`)
- The framework has no way to validate `machine.json` integrity

`FW-REPAIR-03` would create `machine.schema.json`, but until it's done, **`machine.json` is effectively schema-less**, making it fragile and error-prone.

---

### P1-O-04: No Defined Agent Communication Protocol (Message Format / Schema)

**Files involved**: `SendMessage` tool, `AGENTS.md §三` (agent descriptions)

**The omission**:
The framework has 8 agents. They need to communicate (e.g., @Coder sends HANDOVER.md to @Guardian). The `SendMessage` tool exists — but **what's the message schema?**

- Is it free-text?
- Is it structured JSON with `task_id`, `artifact_paths`, `test_results`?
- Does @Guardian know how to *parse* @Coder's message?

Without a **message schema standard**, agent communication is ad-hoc — @Guardian might receive a message like *"Hey I'm done, please review"* without the necessary artifact paths or test evidence, requiring a manual back-and-forth.

---

### P1-O-05: No Logging / Tracing Standard for Multi-Agent Runs

**Files involved**: All agents, `AGENTS.md`

**The omission**:
When 4 agents run in parallel, and something fails, **how do you debug it?**

- Is there a correlation ID (e.g., `session_id` + `task_id`) threaded through all agent logs?
- Do agents write to a shared log file? Separate files?
- What's the log format? (JSON? Plain text?)

The `audit-events.jsonl` file (from `RVW-REVIEW-07`, P2, pending) would add event-sourced logging — but until it's implemented, **debugging multi-agent failures is extremely difficult** because there's no tracing standard.

---

### P1-O-06: `@Orchestrator` Failure — No Specified Failover

**Files involved**: `@Orchestrator` (single agent), `AGENTS.md`

**The omission**:
@Orchestrator is a **single point of coordination**. If @Orchestrator fails (crashes, OOM, network partition):

- Who reschedules the remaining tasks?
- Does a new @Orchestrator instance take over? How does it reconstruct state?
- Is there a "shadow" Orchestrator?

The framework assumes @Orchestrator is always available. **There is no specified failover mechanism.**

---

### P2-O-07: No Performance Benchmark / SLA for Agent Tasks

**Files involved**: `Task.DAG.json` (`estimated_effort` field), `AGENTS.md`

**The omission**:
Each task has `estimated_effort: "S"|"M"|"L"`. But:
- What do these map to in actual time? (S = 15min? M = 1h? L = 4h?)
- What happens if a task exceeds its estimated effort by 2x? 10x?
- Is there a timeout mechanism that kills stale agents?

Without **performance benchmarks and SLAs**, a stuck agent can hold a task (and its dependents) forever. The `@Arbiter` escalation (3 consecutive failures) only covers *review/test failures*, not *agent hangs*.

---

### P2-O-08: `opencode` Directory — Not Version-Controlled?

**Files involved**: `.opencode/` directory, `AGENTS.md`, `Task.DAG.json` (says "must be Git tracked")

**The omission**:
`Task.DAG.json` says: *"存放于项目根目录且必须由 Git 跟踪（pre-commit hook 校验需要）"*.

But `.opencode/agents/*.md`, `.opencode/rules/*.md`, `.opencode/scripts/*.js` — **are these tracked by Git?**

If they're not in `.gitignore`, they should be committed. But if different agents are editing them (e.g., @Architect updates `architect.md`), **merge conflicts on agent config files** are possible.

There's no specified strategy for **resolving agent-config merge conflicts** — which agent "wins"?

---

## PART V — SYNTHESIS: "Strong Binding" Assessment

The framework's central claim is **"strong binding"** — via `contract.yaml` keystone hash, `machine.json` state tracking, and compliance gates.

### What's Actually Strong

| Mechanism | Strength | Caveat |
|-----------|----------|---------|
| `contract.yaml` keystone hash | ✅ Strong — if hash is recomputed after every change | Hash recomputation is manual (P1-P-06) |
| `compliance_gate_check → confirm → complete` lifecycle | ✅ Strong in specification | Race condition in `gate-state.json` (P0-P-02) |
| TDD enforcement (RED → GREEN → REFACTOR) | ✅ Strong — @Guardian verifies `execution_evidence` | Depends on @Guardian actually checking (cooperative) |
| `Task.DAG.json` dependency ordering | ✅ Strong — @Orchestrator follows DAG | Cycle detection unimplemented (P0-O-02) |

### What's Weak (Undermines "Strong Binding" Claim)

| Mechanism | Weakness | Impact |
|-----------|-----------|---------|
| `machine.json` single-file state | Concurrent write races (P0-P-01) | State corruption under parallelism |
| `gate-state.json` no idempotency | Double-arm possible (P0-A-01) | Two agents think they're compliant |
| Cross-workspace path leakage | Has happened (P0-P-03) | Wrong workspace's files get modified |
| `template_resolution` not implemented | Placeholders are unresolvable (P1-I-05) | Agents operate on malformed configs |
| Skill isolation | Not technically enforced (P2-P-07) | Agents can bypass skill restrictions |

---

## PART VI — RECOMMENDATIONS (Prioritized)

### Immediate (Must Fix Before Any Production Use)

1. **Implement `RVW-REVIEW-01` (Unified State Transaction Envelope)** — adds atomic commit across `gate-state.json` + `machine.json`
2. **Implement `FW-REPAIR-03` (machine.schema.json)** — at minimum, `machine.json` structure must be validated
3. **Add file-level locking (or use SQLite) for `machine.json`** — prevents concurrent write corruption
4. **Implement `FW-REPAIR-01` (template_resolution in project.config.json)** — unblocks all UNIV parameterization work

### Near-Term (Should Fix for Reliability)

5. **Add cycle detection in @Meta-Planner and @Orchestrator** for `Task.DAG.json`
6. **Add timeout/cleanup for orphaned gate sessions** (P0-O-01)
7. **Define message schema standard** for inter-agent communication (P1-O-04)
8. **Add cross-workspace path protection** (`FW-REPAIR-09`) — prevent repeat of P0-P-03

### Medium-Term (Maintainability)

9. **Create `TEMPLATE_VARIABLE_STANDARD.md`** (FW-REPAIR-11) — documents all placeholders
10. **Add automated tech-debt scanning** — don't rely on manual registry updates (P1-P-05)
11. **Define @Orchestrator failover mechanism** (P1-O-06)
12. **Add performance benchmarks / agent task timeouts** (P2-O-07)

---

## PART VII — SPECIFIC FILES THAT NEED IMMEDIATE ATTENTION

| File | Problem | Action |
|------|---------|--------|
| `Task.DAG.json` | FW-REPAIR-01,03,04,05,06,08,09,10,11 all pending (P0/P1) | Prioritize P0 repairs first |
| `AGENTS.md` | Doesn't mention `machine.schema.json` non-existence | Add caveat footnote |
| `.opencode/state/machine.json` | No schema validation | Blocked on FW-REPAIR-03 |
| `.opencode/state/gate-state.json` | No idempotency / timeout | Blocked on RVW-REVIEW-01 |
| `contract.yaml` | Hash recomputation manual | Add pre-commit hook to auto-compute |
| `TECH_DEBT_REGISTRY.md` | Manual process | Add automated scanning hook |

---

## Conclusion

The OpenCode Framework is **ambitious and partially well-thought-out**, with genuine strengths in its DAG-driven planning, TDD enforcement, and compliance gate lifecycle. **However, its central state management has structural weaknesses** (single-file JSON, no atomic commits, no write ownership matrix) that **undermine its "strong binding" guarantee** under concurrent or failure conditions.

The fact that **14 out of 52 tasks in `Task.DAG.json` are "pending" framework repairs** (many P0) means the framework is currently **self-aware of its own flaws** — which is good — but **not yet self-healed**, which is risky.

**The most critical path**: Complete `FW-REPAIR-*` (P0) → `RVW-REVIEW-*` (P0) → then declare the framework "production-ready". Until then, the "strong binding" claim should be treated as **aspirational, not guaranteed**.

---

*Report generated by WorkBuddy AI — 2026-05-23*
