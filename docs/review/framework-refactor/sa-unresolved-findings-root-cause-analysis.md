# @Super-Admin Root-Cause Analysis — Unresolved P0/P1 Checklist & Gate Findings

**Document ID**: SA-RCA-P0CHECKLIST-001  
**Author**: @Super-Admin  
**Generated**: 2026-06-22  
**Scope**: `.opencode/`, `opencode.json`, `.opencode/project.config.json`, DB-canonical P0 checklist runtime  
**References**:

- `docs/review/framework-refactor/db-canonical-p0-checklist-implementation-audit-and-fix-plan.md`
- `docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md`
- `docs/review/framework-refactor/read-before-approve-e2e-findings.md`

---

## 1. Executive Summary

The DB-canonical P0 checklist migration has reached a **partial-but-fragile** state. The schema, core API, plugin shell, and several wiring points are in place, but the end-to-end runtime flow still deadlocks in strict/locked mode for multi-dispatch sessions and gate-heavy tasks.

This document consolidates **10 unresolved findings** (F-A through F-J) observed during live E2E testing. For each finding it provides:

1. Symptom / observed failure
2. Precise root cause with file:line references
3. Impact on strict/locked/advisory modes
4. Recommended fix (surgical where possible)
5. Verification approach

**Bottom line**: The framework is not production-ready in strict/locked mode. An immediate pragmatic path is to run in **advisory mode** while the P0-1, P0-3, P0-5, and P1-4 fixes are implemented; otherwise every multi-dispatch task and every compliance-gate close path will deadlock.

---

## 2. Current State Snapshot

### 2.1 Verified Fixes Already in Place

| Fix                                                                            | File                                                           | Status             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------ |
| `compliance-gate.ts:1642` `taskDescription` ReferenceError                     | `.opencode/scripts/mcp-tools/compliance-gate.ts`               | ✅ Fixed           |
| `checklist-before.ts` `resolveChecklistTaskId` bridge for all tools            | `.opencode/plugins/checklist-before.ts:138-168`                | ✅ Fixed           |
| Auto-advance phase when run lags required items                                | `.opencode/plugins/checklist-before.ts:283-307`                | ✅ Fixed           |
| `tool-scope.ts` shell sub-command tokenization (P0-6 vectors B/C/D)            | `.opencode/lib/tool-scope.ts:16-258`                           | ✅ Partially fixed |
| `task-before.ts` DISPATCH_TOKEN trailing-newline bug (P0-7)                    | `.opencode/plugins/task-before.ts:248-250`                     | ✅ Fixed           |
| `dispatch_subagent.ts` session_map agent-identity preservation (P0-5 vector 2) | `.opencode/tools/dispatch_subagent.ts:734-748`                 | ✅ Fixed           |
| `dispatch-subagent.ts` session_map clone-safe write (P0-5 vector 1)            | `.opencode/scripts/command-tools/dispatch-subagent.ts:688-697` | ✅ Fixed           |
| Domain-first search unconditional path (P1-2)                                  | `.opencode/tools/knowledge_cache_search.ts:207-230`            | ✅ Fixed           |

### 2.2 Current Self-Test / Reconciler Status

```text
bun --no-cache .opencode/scripts/framework-self-test.ts
→ 3 of 64 checks FAILED
  - Check 26: --strict state reconciliation (Check 4 failing)
  - Check 27: Reconciler reports inconsistencies
  - Check 35: 5 stale pre-HARDEN knowledge_cache_state entries
```

```text
bun --no-cache .opencode/scripts/state-reconciliation.ts --check
→ 2 inconsistencies
  [HIGH] Armed session cg_ses_1782135410029 references task "E2E-VFY-PHASE-K-001" not in Task.DAG.json
  [WARN] knowledge_state.total_docs_count/size mismatch (63/1491576 vs actual 66/1702108)
```

The HIGH inconsistency is a false positive for this SA analysis session (SA is DAG-exempt), but it shows the reconciler is now active and the armed-session check is enforced.

---

## 3. Unresolved Findings

### F-A — P0: `dispatch_payload` → `read_attest` phase-advance deadlock

**Severity**: P0  
**Symptom**: After a successful dispatch, the sub-agent calls `checklist_status` and sees `phase=dispatch_payload` with blockers `payload_complete`, `dispatch_token_created`, `session_context_bound`. Even when those items are marked passed, the agent cannot proceed to `read_attest` because no code advances the phase.

**Root Cause**: `advanceChecklistPhase()` exists in `.opencode/lib/execution-checklist.ts:648` but is **not exposed as an OpenCode custom tool**. The only caller is the auto-advance block in `checklist-before.ts:283-307`, which runs **after** a tool passes its required items. But an agent cannot intentionally advance the phase; it must call a tool whose required items match the next phase. There is no such tool for the phase boundary itself.

**Code Evidence**:

- `.opencode/lib/execution-checklist.ts:648` — `advanceChecklistPhase` exported but no `.opencode/tools/` wrapper.
- `.opencode/plugins/checklist-before.ts:283-307` — auto-advance only runs when a modify/Task/gate tool is called and all its items pass. If the agent simply queries `checklist_status` and then tries to call `config_read_attest`, the run may still be in `dispatch_payload`.

**Impact**:

- **Strict/locked**: Sub-agents stall after dispatch. They cannot call `module_scope_declare`/`config_read_attest` until the phase is advanced, but there is no sanctioned way to advance it.
- **Advisory**: Flow proceeds because `P0-CHECKLIST-BLOCKED` is logged as a warning.

**Fix**:

1. Create `.opencode/tools/advance_checklist_phase.ts` exporting a `tool()` wrapper for `advanceChecklistPhase()`.
2. Add `advance_checklist_phase` to every sub-agent `opencode.json` permission block.
3. Update `subagent-preamble.md` Step 0 to instruct: _"If checklist_status shows all current-phase items passed but phase has not advanced, call advance_checklist_phase."_
4. Alternatively, make `checklist_status` auto-advance the phase when returning to an agent (non-idempotent but convenient). Prefer explicit tool to keep reads read-only.

**Verification**:

```bash
bun --no-cache -e 'require("./.opencode/lib/execution-checklist").advanceChecklistPhase({run_id:"...",current_phase:"dispatch_payload",next_phase:"preflight"})'
# Confirm .opencode/tools/advance_checklist_phase.ts exists and is in opencode.json permissions.
```

---

### F-B — P0: Gate complete blocked by `deliverables_approved`

**Severity**: P0  
**Symptom**: `compliance_gate_complete` returns `rejected`/`failed` because the checklist requires `deliverables_approved`, but the gate session never reaches `approved` status for exempt agents using combined check+confirm flows.

**Root Cause**: `checklist-before.ts:102-107` requires `deliverables_approved` for **all** `compliance_gate_complete` calls, regardless of whether the gate session is `approval_required=false`. For exempt agents (`@Orchestrator`, `@Super-Admin`, `@Knowledge-Curator`), `approval_required=false` and the session transitions from `armed` directly to `completed` without ever entering `delivered` or `approved`. Therefore `deliverables_approved` is never written, and the before-hook blocks complete.

**Code Evidence**:

- `.opencode/plugins/checklist-before.ts:102-107`
  ```typescript
  if (toolName === "compliance-gate_compliance_gate_complete") {
    return {
      items: ["deliverables_approved"],
      phase: "close",
    };
  }
  ```
- `.opencode/scripts/mcp-tools/compliance-gate.ts:1650` — `session.approval_required = !isExempt`.
- `.opencode/scripts/mcp-tools/compliance-gate.ts:1691-1715` — `runGateComplete` allows exempt sessions to complete from `armed` state; no approval path is taken.

**Impact**:

- **Strict/locked**: Exempt agents can never close their gate sessions. The armed session persists across restarts and blocks new `compliance_gate_check` calls for the same task.
- **Advisory**: Warning-only bypass; session can close.

**Fix**:

1. In `checklist-before.ts`, for `compliance_gate_complete`, resolve the target gate session (via `input.args.session_id`).
2. If `approval_required=false`, require only `compliance_gate_armed` + `deliverables_declared` (i.e., the gate is armed and deliverables were declared).
3. If `approval_required=true`, require the full close-phase items (`deliverables_submitted`, `declared_handover_path_bound`, `read_before_approve_verified`, `deliverables_approved`).
4. For combined check+confirm flows that auto-complete, ensure `compliance_gate_confirm` marks `deliverables_declared` and the complete path marks `gate_closed` without requiring `deliverables_approved`.

**Verification**:

```bash
# In strict mode, run compliance_gate_check + confirm + complete as Orchestrator
# Expected: complete succeeds, active_sessions no longer contains the session.
```

---

### F-C — P0: HANDOVER SHA-256 chicken-and-egg deadlock

**Severity**: P0  
**Symptom**: Approver cannot call `compliance_gate_approve_deliverables` because it requires `handover_sha256`, but the sub-agent cannot write `HANDOVER.md` because it is blocked by P0-CHECKLIST (missing config/knowledge attest) or scope-before.

**Root Cause**: This is a cascading failure, not a single bug. `HANDOVER.md` is a framework deliverable usually written to `.task_temp/{taskId}/`. In strict/locked mode, writing it requires:

1. `config_read_attested` + `knowledge_attested` (checklist-before)
2. Route/scope permissions (scope-before)
3. For @Super-Admin, framework infra write scope

If any prerequisite is missing, the agent cannot create `HANDOVER.md`, and therefore cannot submit deliverables. The approval step then blocks forever.

**Code Evidence**:

- `.opencode/scripts/mcp-tools/compliance-gate.ts:2456-2469` — rejects approve if `handoverSha256` missing or invalid.
- `.opencode/scripts/mcp-tools/compliance-gate.ts:2106-2116` — submit also validates `HANDOVER.md` + `TASK_LOG.md` in `.task_temp/{taskId}/`.

**Impact**:

- **Strict/locked**: Any task whose agent fails to satisfy P0 prerequisites before writing deliverables deadlocks.
- **Advisory**: Bypass possible; agent can write and then approve.

**Fix**:

1. Short-term: run in **advisory mode** for framework repair work so SA can write `HANDOVER.md` without full P0 attestation.
2. Medium-term: ensure `declared_deliverables[].artifact_path` is honored as the only required path (already partially done in compliance-gate.ts).
3. Long-term: separate "write task log / handover skeleton" from "write final handover"; allow skeleton creation before full attestation, or move handover writing to a dedicated non-checklist-blocked tool that only writes to `.task_temp/`.

**Verification**:

```bash
# As SA in advisory mode, write .task_temp/<taskId>/HANDOVER.md and confirm approve passes.
```

---

### F-D — P1: Dispatch fact marking swallowed and second CLI invocation context loss

**Severity**: P1  
**Symptom**: `dispatch-subagent.ts` intends to mark `payload_complete`, `dispatch_token_created`, `session_context_bound`, but E2E temp-DB tests showed no checklist run/item writes.

**Root Cause**: Two related issues:

1. `.opencode/scripts/command-tools/dispatch-subagent.ts:968-980` calls `checklistWirePassed(...)` inside a `catch` that only logs a warning and continues.
2. `.opencode/tools/dispatch_subagent.ts:484-804` invokes the CLI **twice**. The first invocation (line 528) passes `OPENCODE_SESSION_ID`. The second invocation (line 781) does **not**, so any checklist writes in the second run would be under an empty/wrong session.

**Code Evidence**:

- `.opencode/scripts/command-tools/dispatch-subagent.ts:54` — imports `checklistWirePassed`.
- `.opencode/scripts/command-tools/dispatch-subagent.ts:968-980` — marking wrapped in `try/catch`; failure is non-fatal.
- `.opencode/tools/dispatch_subagent.ts:528-546` — first CLI invocation with env.
- `.opencode/tools/dispatch_subagent.ts:781-795` — second CLI invocation without `OPENCODE_SESSION_ID`.

**Impact**:

- **Strict/locked**: If marking fails silently, subsequent `Task()` calls are blocked by `P0-CHECKLIST-BLOCKED`.
- **Advisory**: Warning only; agent may proceed without checklist facts.

**Fix**:

1. Make checklist marking **fatal** in strict/locked mode inside `dispatch-subagent.ts`.
2. Remove the duplicate CLI invocation, or pass identical env to the second invocation.
3. Add a self-test that spawns `dispatch-subagent.ts` and asserts the three dispatch items are `passed` under the parent OpenCode session.

**Verification**:

```bash
bun --no-cache -e '/* spawn dispatch-subagent.ts with OPENCODE_SESSION_ID, then query execution_checklist_items */'
```

---

### F-E — P1: `checklist_status` not granted in `opencode.json`

**Severity**: P1  
**Symptom**: Agent configs mention `checklist_status`, but runtime permission policy denies it.

**Root Cause**: Agent `.md` files were updated to declare `checklist_status`, but `opencode.json` `permission` blocks for all agents lack the `"checklist_status": "allow"` entry.

**Code Evidence**:

- `grep -r '"checklist_status"' opencode.json` returns no matches.
- `.opencode/agents/*.md` include `checklist_status` in tool lists.

**Impact**:

- Agents instructed to call `checklist_status` will receive a permission error and cannot determine pending blockers.
- The DB-canonical P0 protocol cannot function.

**Fix**:

1. Add `"checklist_status": "allow"` to every agent permission block in `opencode.json`.
2. Add `framework-self-test.ts` check that verifies both `.md` declarations and `opencode.json` runtime permissions.

**Verification**:

```bash
grep -c '"checklist_status": "allow"' opencode.json
# Should equal number of agent permission blocks.
```

---

### F-F — P1: UC7-001 shell parsing — `bash`/`apply_patch` not covered by `isModifyTool`

**Severity**: P1  
**Symptom**: `tool-scope.ts` has improved sub-command parsing, but the OpenCode built-in `bash` tool and `apply_patch` are still not in `isModifyTool`, so `checklist-before.ts` returns early for them.

**Root Cause**: `scope-before.ts:49` defines `SHELL_LIKE_TOOLS = ["safe_shell", "bash", "apply_patch"]` and handles them for scope checks, but `checklist-before.ts:60` only checks `isModifyTool(toolName)`. `isModifyTool` does not include `bash` or `apply_patch`.

**Code Evidence**:

- `.opencode/lib/tool-scope.ts:8-10`
  ```typescript
  export function isModifyTool(tool: string): boolean {
    return (
      tool === "write" ||
      tool === "edit" ||
      tool === "safe_edit" ||
      tool === "safe_mkdir" ||
      tool === "safe_delete" ||
      tool === "safe_shell"
    );
  }
  ```
- `.opencode/plugins/checklist-before.ts:60` — `if (isModifyTool(toolName))`.

**Impact**:

- **Strict/locked**: An agent with `bash` permission (e.g., @Super-Admin) can write to `.opencode/**` without `config_read_attested`/`knowledge_attested`.
- `scope-before.ts` still enforces route/UC7KS, so the primary bypass is for the **checklist** layer, not the scope layer.

**Fix**:

1. Add `bash` and `apply_patch` to `isModifyTool` in `tool-scope.ts`.
2. Ensure `getEffectivePathScopePaths` returns `unparseable_modify_shell` for `bash`/`apply_patch` when targets cannot be parsed.
3. Alternatively, add the same `SHELL_LIKE_TOOLS` check in `checklist-before.ts` so shell-capable tools always require attestation.

**Verification**:

```bash
bun --no-cache -e 'require("./.opencode/lib/tool-scope").isModifyTool("bash")'
# Expected output: true
```

---

### F-G — P1: `advanceChecklistPhase` has no tool wrapper

**Severity**: P1  
**Symptom**: `advanceChecklistPhase` is the only way to cross phase boundaries, yet it is not callable by agents.

**Root Cause**: `.opencode/lib/execution-checklist.ts:648` exports `advanceChecklistPhase` but there is no `.opencode/tools/advance_checklist_phase.ts` custom tool. The checklist API was designed as a library, but the P0 protocol requires it to be exposed to agents.

**Code Evidence**:

- `glob .opencode/tools/advance_checklist_phase.ts` → not found.
- `glob .opencode/tools/checklist_status.ts` → not found.

**Impact**:

- Without this tool, agents cannot move from `dispatch_payload` → `preflight` → `read_attest` → `gate_armed` → `execute` → `deliver` → `close` in a deterministic way.
- Auto-advance in `checklist-before.ts` is a workaround, but it is fragile and only triggers on specific tool calls.

**Fix**:

1. Create `.opencode/tools/advance_checklist_phase.ts`.
2. Register it in `opencode.json` permissions for all agents.
3. Wire `markChecklistPassed`/`markChecklistFailed` events inside the tool.

**Verification**:

```bash
ls .opencode/tools/advance_checklist_phase.ts
bun --no-cache .opencode/scripts/framework-self-test.ts
# Check 64 should verify the tool exists.
```

---

### F-H — P1: `p0_checklist_policy` still not consumed by `checklist-before.ts`

**Severity**: P1  
**Symptom**: `.opencode/project.config.json` contains `p0_checklist_policy.monitored_write_targets` and `excluded_write_targets`, but `checklist-before.ts` does not read this policy. Every modify tool requires `config_read_attested` + `knowledge_attested`, even for excluded paths like `.task_temp/**`.

**Root Cause**: `checklist-before.ts:60-64` hardcodes the required items for all modify tools:

```typescript
if (isModifyTool(toolName)) {
  return {
    items: ["config_read_attested", "knowledge_attested"],
    phase: "read_attest",
  };
}
```

It never consults `p0_checklist_policy` or the effective target path.

**Code Evidence**:

- `.opencode/project.config.json:920` — `p0_checklist_policy` exists.
- `.opencode/plugins/checklist-before.ts:60-64` — hardcoded items.

**Impact**:

- Excluded paths are over-blocked.
- Monitored target semantics are not DB-canonical.
- Writing temporary logs or task artifacts requires full attestation, contributing to F-C.

**Fix**:

1. Snapshot `p0_checklist_policy` into the checklist run at creation time.
2. In `checklist-before.ts`, compute the effective target path(s) using `getEffectivePathScopePaths`.
3. Apply policy:
   - **excluded** path → no checklist blocker.
   - **monitored** path → require `knowledge_search_completed` + `knowledge_attested`.
   - **framework/config-sensitive** path (`.opencode/**`, `opencode.json`, `contract.yaml`, etc.) → also require `config_read_attested`.

**Verification**:

```bash
# Write to .task_temp/<taskId>/test.log in strict mode after config attestation only.
# Expected: allowed (excluded path).
# Write to .opencode/lib/x.ts without knowledge attestation.
# Expected: blocked.
```

---

### F-I — P1: Gate checklist writes use gate session id, not OpenCode session id

**Severity**: P1  
**Symptom**: Gate facts (`compliance_gate_checked`, `compliance_gate_armed`, `deliverables_submitted`, `deliverables_approved`, `gate_closed`) are written to a checklist run keyed by the compliance gate `session_id` (`cg_ses_*`), while `checklist-before.ts` resolves runs by OpenCode `input.sessionID` (`ses_*`). The same task therefore has two separate checklist runs.

**Root Cause**: `compliance-gate.ts` calls `checklistWirePassed(sessionId, ...)` where `sessionId` is the MCP gate session id. `checklist-hooks.ts::createChecklistRun` uses that id as `opencode_session_id`. `checklist-before.ts` resolves the run with `input.sessionID` (OpenCode session id). The `approval_read_context` table bridges gate_session_id → opencode_session_id for **read verification**, but gate checklist writes do not use that bridge.

**Code Evidence**:

- `.opencode/scripts/mcp-tools/compliance-gate.ts:1637-1643` — `checklistWirePassed(sessionId, resolvedAgent, clTaskId, "compliance_gate_checked", ...)`.
- `.opencode/scripts/mcp-tools/compliance-gate.ts:2152-2158` — `checklistWirePassed(sessionId, ag, tk, "deliverables_submitted", ...)`.
- `.opencode/scripts/mcp-tools/compliance-gate.ts:2695-2723` — `checklistWirePassed(sessionId, ag2, tk2, "deliverables_approved", ...)`.
- `.opencode/plugins/checklist-before.ts:195-196` — `resolveChecklistRun(input.sessionID, agent, taskId)`.

**Impact**:

- **Strict/locked**: The agent's checklist run (OpenCode session) does not see gate facts, and the gate's checklist run (gate session) does not see attestation facts. Both runs report blockers, making task completion impossible.
- **Advisory**: Warning-only bypass masks the split.

**Fix**:

1. Introduce `checklistWirePassedForGateSession(gateSessionId, agent, taskId, itemKey, evidence)` in `checklist-hooks.ts`.
2. Look up the active OpenCode session via `approval_read_context` (for approve/submit/complete) or via `gate-state.json` session metadata (`session.task_id` → `session_map` → `opencode_session_id`).
3. Write gate facts to the **OpenCode session's** checklist run.
4. Store gate session id as `evidence_ref` or a dedicated column for traceability.

**Verification**:

```bash
# After compliance_gate_confirm, query execution_checklist_items for the OpenCode session id.
# Expected: compliance_gate_checked and compliance_gate_armed items exist with status=passed.
```

---

### F-J — P1: `compliance_gate_complete` prerequisite may over-block exempt direct completion

**Severity**: P1  
**Symptom**: Combined `compliance_gate_check` flow (check + confirm in one call) for exempt agents cannot complete because `checklist-before.ts` requires `deliverables_approved`.

**Root Cause**: Same as F-B, but specifically about the **combined / auto-complete** path. The current `checklist-before.ts` gate-complete rule is unconditional.

**Code Evidence**:

- `.opencode/plugins/checklist-before.ts:102-107`.
- `.opencode/scripts/mcp-tools/compliance-gate.ts:1679` — combined flow returns `armed=true` without approval.

**Impact**:

- Exempt agents using combined check+confirm are blocked from closing the gate.
- This is the direct cause of the observed stuck armed sessions (`cg_ses_1782133051311`, `cg_ses_1782103756338`).

**Fix**:

1. Same as F-B: inspect `approval_required` for the target gate session before choosing required items.
2. For `approval_required=false`, require only `compliance_gate_armed` + `deliverables_declared`.
3. For `approval_required=true`, require full close-phase items.

**Verification**:

```bash
# As Orchestrator in strict mode:
# compliance_gate_check(task_id=..., task_description=...) with combined=true and declared_deliverables
# → should return armed and allow immediate complete.
```

---

## 4. Cross-Finding Interaction Map

```text
F-A / F-G  ──► agents cannot advance phase → stall after dispatch
F-B / F-J  ──► exempt agents cannot close gate → armed sessions persist
F-C        ──► cannot write HANDOVER.md → cannot submit/approve
F-D        ──► dispatch facts not written → Task() blocked
F-E        ──► agents cannot query checklist_status → no remediation path
F-F        ──► bash/apply_patch bypass checklist → security gap
F-H        ──► excluded paths over-blocked → contributes to F-C
F-I        ──► gate facts on wrong run → both runs deadlock
```

The most critical cycle is **F-A → F-D → F-B/F-J/F-I → F-C**: dispatch does not reliably advance the phase or write facts; the gate cannot close because deliverables are not approved; deliverables cannot be written because the phase is wrong; the gate writes facts to the wrong run.

---

## 5. Recommended Fix Sequence

### Phase 1 — Stop the bleeding (advisory mode)

1. Change `develop_enforcement_mode` and `runtime_enforcement_mode` to `"advisory"` in `.opencode/project.config.json`.
2. Drain all stale armed gate sessions.
3. Document that strict/locked mode is disabled until Phase 3.

### Phase 2 — Surgical fixes (no mode change)

1. **F-E**: Add `checklist_status` permissions to `opencode.json`.
2. **F-G / F-A**: Create `.opencode/tools/advance_checklist_phase.ts` and register it.
3. **F-F**: Add `bash`/`apply_patch` to `isModifyTool`.
4. **F-H**: Snapshot `p0_checklist_policy` into checklist run and apply path-based item selection.
5. **F-D**: Make dispatch fact marking fatal; deduplicate CLI invocation.

### Phase 3 — Gate identity binding (re-enable strict)

1. **F-I**: Implement `checklistWirePassedForGateSession` and route all gate facts to the OpenCode session run.
2. **F-B / F-J**: Make `compliance_gate_complete` requirements conditional on `approval_required`.
3. **F-C**: Allow handover skeleton writing before full attestation, or exempt `.task_temp/**` from deliverables blocking.
4. Re-run full E2E in strict mode.

### Phase 4 — Hardening

1. Add self-test for dispatch checklist fact writes.
2. Add self-test for gate-to-OpenCode run identity.
3. Add self-test for `bash`/`apply_patch` checklist coverage.
4. Fix state reconciliation knowledge_state mismatch (low priority).

---

## 6. Immediate @Super-Admin Bypass Options

If the user needs to continue framework repair work immediately, the following bypasses are available to @Super-Admin without violating the anti-goals:

| Bypass                                | Method                                                                                             | Audit Trail                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| P0-CHECKLIST block on modify          | Already present at `checklist-before.ts:337` (`if (agent === "@Super-Admin"                        |                                              | agent === "Super-Admin") return;`) | `P0-CHECKLIST-ADVISORY-BYPASS` log entry |
| scope-before block on framework files | Already present at `scope-before.ts:97` and `route-validator.ts` for @Super-Admin                  | `TOOL-BEFORE` log entry                      |
| Gate complete deadlock                | Set `develop_enforcement_mode`/`runtime_enforcement_mode` to `"advisory"` in `project.config.json` | `compliance_records.enforcement_transitions` |
| Stuck armed sessions                  | Call `compliance_gate_drain_stale` or `compliance_gate_purge`                                      | `gate-state.json` audit trail                |

**Important**: These bypasses are **temporary**. They must be removed once Phase 3 fixes are in place and strict mode is re-enabled.

---

## 7. Verification Commands

```bash
# Run full self-test
bun --no-cache .opencode/scripts/framework-self-test.ts

# Check state consistency
bun --no-cache .opencode/scripts/state-reconciliation.ts --check

# Drain stale gate sessions
bun --no-cache -e 'require("./.opencode/scripts/mcp-tools/compliance-gate").drainStaleSessions?.()'

# Inspect checklist runs
bun --no-cache -e '
const { getDb } = require("./.opencode/lib/db-manager");
const db = getDb();
console.log(db.query("SELECT run_id, opencode_session_id, task_id, agent, phase, status FROM execution_checklist_runs ORDER BY created_at DESC LIMIT 10").all());
console.log(db.query("SELECT run_id, item_key, phase, status FROM execution_checklist_items ORDER BY created_at DESC LIMIT 20").all());
'

# Inspect gate sessions
bun --no-cache -e '
const fs = require("fs");
const s = JSON.parse(fs.readFileSync(".opencode/state/gate-state.json", "utf8"));
console.log(s.active_sessions);
'
```

---

## 8. Change Log

| Date       | Version | Change                                          | Author       |
| ---------- | ------- | ----------------------------------------------- | ------------ |
| 2026-06-22 | 1.0.0   | Initial root-cause analysis for F-A through F-J | @Super-Admin |
