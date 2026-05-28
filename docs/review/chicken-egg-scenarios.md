# OpenCode Framework: Chicken-and-Egg Scenario Analysis

**Document Type**: Diagnostic Review  
**Scope**: Complete inventory of circular dependency scenarios  
**Classification**: Framework Behavior Documentation — No Modifications  
**Date**: 2026-05-27  
**Source**: `docs/review/opencode-framework-diagnostics-audit.md` FX-DIAG dimension

---

## Executive Summary

This document catalogs **29 distinct chicken-and-egg scenarios** across 8 categories in the OpenCode multi-agent framework. Each scenario is classified by severity, analyzed for root cause, and mapped to the appropriate resolution mechanism (protocol, waiver, or architectural constraint).

**Key Finding**: True chicken-and-egg problems (Category 1) are **architectural features**, not bugs. The framework's inability to self-modify certain components is deliberate security design. Operational deadlocks (Categories 2–8) are resolvable through documented protocols, Arbiter waivers, or safe-tool hardening.

**Hardening Evaluation Update (2026-05-27)**: The HARDEN-CONSTRAINT-DESIGN re-evaluation changed several assumptions in this document. The safe toolchain is viable only when `safe_edit` imports shared audit logic instead of invoking `code-quality-gate.js` as a CLI, `safe_bash` is allowlist-based and blocks file-write escapes, `safe_edit` includes TDD Check 6, RED-phase test exemptions are explicit, and rollback uses concurrent-safe, symlink-safe path handling. These are tracked as Category 8 scenarios.

---

## Category 1: Self-Referential Hard Constraints (Physical Deadlocks)

> **Design Principle**: These are intentional. Adding "escape hatches" would compromise security.

### 1.1 Framework-Enforcer Self-Modification Deadlock

**Scenario**: Need to modify `framework-enforcer.js` → Hash changes → FW-ENFORCE blocks ALL tools → Cannot commit → Cannot restart to load new hash.

**Root Cause**: Enforcer computes in-memory hash of its own source. Any modification immediately invalidates the hash, triggering total lockdown.

**Severity**: 🔴 **Critical**

**Resolution Protocol** (from AGENTS.md §P0):
```
Write → Commit (external) → Exit → Restart (opencode process)
```

**Why Arbiter Cannot Solve**: 
- Arbiter's WAIVE.md is a governance document, not a cryptographic override
- Granting Arbiter power to bypass enforcer = creating a backdoor
- Would violate: Framework Consistency, Core Features, Hard Constraint System

**Prevention**: 
- Never modify enforcer during active session
- Pre-document all enforcer changes in external commit
- Batch enforcer changes with planned restart

---

### 1.2 Locked Mode Escape

**Scenario**: Locked mode blocks all changes → Need `--force --unlock` → Requires Arbiter-signed token → Arbiter cannot create WAIVE.md in locked mode because locked mode rejects all waivers.

**Root Cause**: Locked mode (`enforcement_mode: "locked"`) has `allow_waivers: false` by design. This is the strictest enforcement tier.

**Severity**: 🔴 **Critical**

**Resolution**: 
- Pre-position Arbiter unlock token before entering locked mode
- Never enter locked mode without pre-staged governance override
- Requires manual `state-machine-reset.sh --force --unlock` with Arbiter token

**Why Arbiter Cannot Solve in Real-Time**: 
- Locked mode is designed to reject Arbiter waivers
- Only pre-staged tokens work

---

### 1.3 State Machine Reset While Locked

**Scenario**: `state-machine-reset.sh` resets state to exit locked mode → But locked mode blocks the reset script's writes → Cannot reset to exit locked mode.

**Root Cause**: Reset script writes to `machine.json`, which is protected by locked-mode hard constraints.

**Severity**: 🔴 **Critical**

**Resolution**: Same as 1.2 — pre-staged unlock mechanism required.

---

## Category 2: Tool Bootstrap Failures

### 2.1 Safe Edit Tool Failure (The "Who Watches the Watchmen" Problem)

**Scenario**: Subagents use `edit: deny` → Only `safe_edit` custom tool can write authorized files → `safe_edit` crashes or is corrupted → The affected subagent cannot fix it because native edit remains denied.

**Root Cause**: Centralized write authority in a single tool.

**Severity**: 🟡 **High**

**Resolution**: 
- Do not rely on a global `edit: deny` for every actor; retain an explicit primary-agent or external-maintainer repair path.
- `safe_edit` must import shared audit logic from `code-quality-lib.js`; it must not shell out to `code-quality-gate.js` as a CLI.
- Emergency: restart OpenCode to reload `safe_edit` from `.opencode/tools/safe-edit.js`, then use Arbiter-authorized temporary repair scope if the tool still fails.

**Arbiter Role**: 
- Can issue WAIVE.md granting temporary `edit: allow` to a specific agent for a specific file
- Records incident in TECH_DEBT_REGISTRY.md
- Does **not** directly fix the tool

---

### 2.2 Rule Registry Repair Deadlock

**Scenario**: `rule-registry-verify.js --repair` updates digests → Repair tool itself needs to write to enforcer-protected files → FW-ENFORCE may block the repair.

**Root Cause**: Repair tool modifies files whose hashes are monitored by the enforcer, but the repair happens within the enforcer's scope.

**Severity**: 🟡 **High**

**Resolution**: 
- Run repair **before** enforcer activation, or
- Run repair in a separate process outside enforcer scope

---

### 2.3 Code Quality Gate Self-Blocking

**Scenario**: `run_write_check` finds issues → Blocks further writes → To fix issues, need to write files → Cannot write because gate blocked.

**Root Cause**: Layer A (Write-Time Audit) is designed to be advisory, but strict mode interpretation can create blocking behavior.

**Severity**: 🟡 **High**

**Resolution**: 
- Layer A is advisory by default (warnings, not blocks)
- Manual override: `--no-verify` for critical fixes
- Arbiter can waive specific gate checks

---

## Category 3: Permission & Configuration Lockouts

### 3.1 Agent Config Permission Lockout

**Scenario**: Need to add new agent / change permissions in `opencode.json` → All agents have `edit: deny` → No one can modify `opencode.json`.

**Root Cause**: Universal `edit: deny` policy prevents even legitimate configuration changes.

**Severity**: 🟡 **High**

**Current Mitigation**: 
- `opencode.json` is **not** enforcer-protected
- `safe_edit` can modify `opencode.json`
- This is a **managed risk**, not a true deadlock

**Arbiter Role**: 
- Can issue WAIVE.md for `opencode.json` modifications
- Especially useful for adding new agents or emergency permission changes

---

### 3.2 Machine.json Hash Update Catch-22

**Scenario**: Modify protected file → Hash stale → Pre-commit blocks commit → Need to update `machine.json` hash → `machine.json` is keystone-protected → Update blocked until commit succeeds.

**Root Cause**: Two-phase validation: file hash + machine.json hash must be in sync at commit time.

**Severity**: 🟡 **High**

**Resolution**: 
- `safe_edit` performs audited write + hash/state update through shared quality logic
- Manual: `bash .opencode/scripts/integrity-chain-bundle.sh` updates all hashes
- Always run integrity-chain-bundle after modifying protected files

---

### 3.3 Guardian Reviews Guardian (Meta-Review Paradox)

**Scenario**: Guardian reviews code for compliance → Guardian's own config changes need review → Who reviews the reviewer?

**Root Cause**: Circular accountability when quality gatekeeper needs changes.

**Severity**: 🟢 **Medium**

**Resolution**: 
- Arbiter adjudicates Guardian self-changes
- Peer Guardian review (if multiple Guardian instances)
- Human-in-the-loop for Guardian config changes

---

### 3.4 Arbiter Config Change Conflict

**Scenario**: Arbiter adjudicates conflicts → Arbiter's own config needs changing → Conflict of interest in self-modification.

**Root Cause**: Governance agent cannot govern its own governance.

**Severity**: 🟢 **Medium**

**Resolution**: 
- Arbiter configs require manual human PR review
- Arbiter cannot issue WAIVE.md for its own files
- Changes to `arbitrator.md` bypass the Arbiter workflow entirely

---

## Category 4: TDD & Commit Hook Friction

### 4.1 Config Change Requires Artificial [Red] Test

**Scenario**: Pre-commit hook requires [Red] before [Green] → Config changes don't have tests → Must create artificial test to satisfy hook → Test itself is a config-like file without real test value.

**Root Cause**: TDD enforcement is designed for code, not configuration.

**Severity**: 🟡 **High**

**Resolution**: 
- Use `chore` or `docs` commit type (no TDD marker required)
- Or create audit tests (like `agent-mcp-audit.spec.js`) which have real value
- Arbiter can waive TDD order for pure config changes

---

### 4.2 Phase 3 Non-Test File Block Under Red

**Scenario**: Phase 3 of pre-commit hook blocks non-test files under Red status → Need to modify test config (a non-test file) → Cannot commit test config under Red.

**Root Cause**: Phase 3 assumes Red commits only contain test files, but test infrastructure (configs, utilities) may also need changes.

**Severity**: 🟡 **High**

**Resolution**: 
- Test infrastructure files exempted via hook whitelist
- Or commit as `chore` without [Red]/[Green] markers

---

### 4.3 ESLint Dirty Blocks Completion Forever

**Scenario**: `eslint_audit` writes dirty_modules → `compliance_gate_complete` fails if dirty → To fix dirty modules, need to write code → Gate not complete, work blocked → Deadlock.

**Root Cause**: Gate completion requires clean state, but fixing requires work that keeps state dirty.

**Severity**: 🟡 **High**

**Resolution**: 
- Advisory mode: dirty_modules are warnings, not blocks
- Strict mode: Must fix all dirty modules before complete
- Arbiter can waive dirty modules with documented tech debt

---

## Category 5: Workflow & DAG Logic

### 5.1 No DAG for Meta-Planner Task

**Scenario**: Orchestrator needs DAG to dispatch tasks → No DAG exists for "generate DAG" → Orchestrator dispatches Meta-Planner directly.

**Root Cause**: Meta-Planner is the DAG generator, but Orchestrator needs a DAG to dispatch Meta-Planner.

**Severity**: 🟢 **Medium**

**Resolution**: 
- **Solved**: Orchestrator has direct dispatch rule for Meta-Planner
- This is a bootstrap exception, not a true deadlock
- Documented in AGENTS.md: Meta-Planner is the universal entry point

---

### 5.2 Task.DAG.json Self-Update Loop

**Scenario**: Task completes → Need to update DAG status → But DAG update is itself a task → Task execution needs DAG → Circular.

**Root Cause**: DAG is both the plan and the execution state.

**Severity**: 🟢 **Medium**

**Resolution**: 
- Orchestrator updates DAG status directly (not via task)
- Status updates are meta-operations, not business tasks

---

### 5.3 Pre-Execution Hook Blocks Task Addition

**Scenario**: `pre-execution-hook.sh` checks task exists in DAG → To add task to DAG, need to modify Task.DAG.json → Hook might block the modification if treated as execution.

**Root Cause**: Hook runs on execution, but DAG modification is a planning activity.

**Severity**: 🟢 **Medium**

**Resolution**: 
- Hook runs on execution, not on file writes
- DAG edits are safe from hook blocking

---

## Category 6: Template Variable & Resolution

### 6.1 Unresolved Placeholder Blocks Dispatch

**Scenario**: `dispatch-subagent.js` resolves placeholders from `project.config.json` → New placeholder needed to fix broken agent config → Agent config dispatch fails before fix can be applied.

**Root Cause**: Template resolution is a prerequisite for agent execution.

**Severity**: 🟢 **Medium**

**Resolution**: 
- `framework-self-test.js` Check 17/18 catches unresolved placeholders
- Unresolved placeholders show as `UNRESOLVED{...}` in agent prompts
- Fix is to add placeholder to `project.config.json.template_resolution`

---

### 6.2 project.config.json Template Self-Reference

**Scenario**: `project.config.json` contains `template_resolution` → Template references a key that doesn't exist → Resolver fails → Can't fix because resolver is broken.

**Root Cause**: Self-referencing configuration.

**Severity**: 🟢 **Medium**

**Resolution**: 
- Validate config with `framework-self-test.js` before deployment
- Never reference non-existent keys in `template_resolution`

---

## Category 7: State & Compliance Gate

### 7.1 Gate Armed Check Blocks Gate Fix

**Scenario**: `compliance_gate_check` fails → Gate not armed → Cannot do work to fix the failure → Because gate is not armed.

**Root Cause**: Gate check is designed as a prerequisite.

**Severity**: 🟢 **Medium**

**Resolution**: 
- In strict/locked mode, a gate check with HIGH severity failures cannot be armed.
- INFO/WARNING-only results are not blockers; if `last_check_passed` is true, confirmation can arm the gate.
- HIGH failures require fixing the gate preflight issue or obtaining the documented governance path before work proceeds.

---

### 7.2 Stale Session Drain vs. Active Work

**Scenario**: `compliance_gate_drain_stale` drains old sessions → But draining requires reading `gate-state.json` → If gate-state is corrupted, drain fails → Corruption persists.

**Root Cause**: Drain depends on the very state it might need to fix.

**Severity**: 🟢 **Medium**

**Resolution**: 
- Drain operation is read-safe
- Corruption handled by manual `state-machine-reset.sh`

---

### 7.3 Compliance Gate Complete Requires Completion

**Scenario**: `compliance_gate_complete` must be called to finish task → But if task has dirty_modules, complete returns failed → Task never marked complete → Next task blocked.

**Root Cause**: Gate completion requires clean state, but dirty state prevents completion.

**Severity**: 🟡 **High**

**Resolution**: 
- Fix dirty modules before calling complete
- Or: Arbiter waives dirty modules with documented risk
- Or: Run `eslint_audit.run_audit({ full_scan: true })` to clear dirty state

---

## Category 8: Hardened Safe Toolchain Evaluation Findings

> **Design Principle**: The safe toolchain closes write and shell bypasses only if its enforcement is embedded in the tool path, not bolted on through post-hoc prompts.

### 8.1 code-quality-gate CLI Invocation Deadlock

**Scenario**: `safe_edit` writes a file → tries `node code-quality-gate.js run_write_check ...` → `code-quality-gate.js` starts an MCP stdio server instead of a CLI → `safe_edit` hangs → write audit cannot complete → rollback path becomes unreliable.

**Root Cause**: The audit server and the reusable audit library were treated as the same interface.

**Severity**: 🔴 **Critical**

**Resolution**:
- Extract reusable write-check logic into `code-quality-lib.js`.
- Make both the MCP server and `safe_edit` import the same library.
- Forbid shelling out to MCP stdio servers from safe tools.

---

### 8.2 safe_bash File-Write Bypass

**Scenario**: Native edit is denied → agent calls `safe_bash` with `echo > file`, `cat > file`, `tee`, `cp`, `mv`, or a shell substitution → file changes occur without `safe_edit` audit.

**Root Cause**: A denylist of dangerous commands does not model shell write semantics.

**Severity**: 🔴 **Critical**

**Resolution**:
- Use an allowlist, not a denylist.
- Block shell redirection, here-docs, pipes to file-writing commands, and file-moving/copying commands unless explicitly approved.
- Route content-writing operations through `safe_edit`.

---

### 8.3 TDD Check 6 vs. RED-Phase Test Authoring

**Scenario**: `safe_edit` enforces source-before-spec ordering → RED phase writes intentionally failing tests → ESLint/mock-audit or TDD Check 6 rejects the test file → Coder cannot produce a legitimate RED failure.

**Root Cause**: TDD order enforcement and RED-phase lint behavior need phase-aware semantics.

**Severity**: 🔴 **Critical**

**Resolution**:
- Include TDD Check 6 in `safe_edit`: source writes require an existing or prior spec.
- Add explicit RED-phase exemptions for test files only; implementation files remain strict.
- Default to strict behavior when task phase cannot be resolved.

---

### 8.4 Concurrent Rollback and Symlink Scope Race

**Scenario**: Two safe edits touch the same file, or a path resolves through a symlink → backup/rollback restores the wrong content or writes outside the intended workspace.

**Root Cause**: Fixed backup names and path checks before canonicalization are unsafe under concurrency and symlink traversal.

**Severity**: 🟡 **High**

**Resolution**:
- Resolve paths with `fs.realpathSync` before scope checks.
- Use unique operation IDs in temp/backup paths.
- Prefer temp-file + atomic rename and per-target locking for write/rollback sequences.

---

### 8.5 Plugin Gate Identity and Hook Propagation Ambiguity

**Scenario**: Plugin `tool.execute.before` enforces state based on agent identity → hook input does not contain `args`, or subagent environment lacks `FRAMEWORK_AGENT` / `FRAMEWORK_TASK_ID` → gate cannot reliably classify the actor.

**Root Cause**: The design assumed incorrect hook argument shape and treated BUG #5894/#1706 as settled without empirical verification.

**Severity**: 🟡 **High**

**Resolution**:
- Read tool args from the actual hook output structure.
- Use propagated environment variables for agent/task identity.
- Keep plugin gate supplemental until hook propagation and intermittent failure behavior are verified.

---

### 8.6 Evidence Chain Gap After Safe Writes

**Scenario**: `safe_edit` proves a write is compliant, but Guardian still needs `test_report.json.execution_evidence`, HANDOVER.md, and commit marker evidence → task stalls at review because write compliance is mistaken for task completion.

**Root Cause**: Write safety and delivery evidence are different gates.

**Severity**: 🟢 **Medium**

**Resolution**:
- Add or require `safe_test` to execute tests and write `test_report.json` with `execution_evidence`.
- Keep HANDOVER.md and TASK_LOG.md as explicit task artifacts.
- Guardian remains responsible for final DoD validation after `compliance_gate_complete`.

---

## Severity Distribution

| Severity | Count | Scenarios | Resolution Strategy |
|----------|-------|-----------|---------------------|
| 🔴 **Critical** | 6 | 1.1–1.3, 8.1–8.3 | Protocol-driven restart or design correction before implementation |
| 🟡 **High** | 10 | 2.1–2.3, 3.1–3.2, 4.1–4.3, 7.3, 8.4–8.5 | Protocol + Arbiter waiver + safe-tool hardening |
| 🟢 **Medium** | 13 | 3.3–3.4, 5.1–5.3, 6.1–6.2, 7.1–7.2, 8.6 | Operational best practices |

**Total**: 29 scenarios

---

## Arbiter Solvability Matrix

| Scenario Category | Arbiter Can Solve? | Mechanism | Framework Impact |
|-------------------|:------------------:|-----------|------------------|
| **1.x Self-Referential** | ❌ No | Physical impossibility | Adding escape = backdoor |
| **2.x Tool Bootstrap** | ✅ Yes | WAIVE.md → temp permission | Clean — standard mechanism |
| **3.x Permission Lockouts** | ✅ Yes | WAIVE.md → file-specific edit | Clean — standard mechanism |
| **4.x TDD Hook Friction** | ✅ Yes | WAIVE.md → bypass TDD order | Clean — config exemption |
| **5.x Workflow Logic** | ⚠️ Partial | Can adjudicate design | Cannot fix DAG structure |
| **6.x Template Resolution** | ❌ No | Technical config issue | Not a conflict |
| **7.x State/Gate** | ✅ Yes | WAIVE.md → force-close session | Clean — documented risk |
| **8.x Safe Toolchain** | ⚠️ Partial | Can authorize repair/waiver | Cannot replace missing tool design fixes |

---

## Design Philosophy

### True Deadlocks Are Features

The 3 Category 1 scenarios (enforcer self-mod, locked escape, reset deadlock) are **intentional architectural constraints**. They exist because:

1. **Security**: Self-modifying code is a vulnerability vector
2. **Auditability**: All framework changes must leave a git trail
3. **Simplicity**: Complex escape hatches create more bugs than they solve
4. **Predictability**: Known constraints are better than unknown failure modes

### Operational Deadlocks Are Solvable

The 26 scenarios in Categories 2–8 are **operational friction points** that can be resolved through:
- Documented protocols (AGENTS.md)
- Arbiter waivers (WAIVE.md)
- Human-in-the-loop (for critical changes)
- Pre-staged governance tokens (for locked mode)
- Hardened safe-tool implementation contracts (`safe_edit`, `safe_bash`, `safe_test`)

---

## Recommendations

### Short-Term
1. Document Category 1 protocols clearly in `AGENTS.md` (already done)
2. Create WAIVE.md templates for Categories 2–4
3. Add pre-staged unlock mechanism for locked mode
4. Treat Category 8 critical scenarios as implementation blockers, not reviewer preferences

### Long-Term
1. Consider "break-glass" mode: 2-of-3 Arbiter signatures can force state reset
2. Add "dry-run" mode for enforcer changes (test hash without blocking)
3. Build automated recovery playbooks for each Category 2–8 scenario
4. Keep `safe_edit`, `safe_bash`, and `safe_test` as the canonical enforcement path, with plugin hooks acting as observability and secondary guardrails

---

*This document is diagnostic only. No framework modifications were made.*
