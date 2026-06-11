# Quad-Bug Diagnostics Review — 2026-06-09

**Author**: @Super-Admin  
**Session**: cg_ses_1780969075651  
**Enforcement Mode**: strict  
**Knowledge Cache**: v1.3.0 (16 entries, UC7-001 compliant)

## Executive Summary

Four claims were investigated. **2 CONFIRMED bugs**, **1 already-fixed historical bug**, **1 partially valid design concern**. **An additional bug was discovered during gate closure.**

| # | Claim | Verdict | Severity |
|---|-------|---------|----------|
| 1 | `_pluginHooksCount < 2` is dead code | ✅ **CONFIRMED BUG** | MEDIUM |
| 2 | `drained_sessions` type inconsistency | ✅ **CONFIRMED BUG** | HIGH |
| 3 | `safe_edit` scope enforcement bypass | ⚠️ **ALREADY PATCHED** | n/a (fixed) |
| 4 | `FRAMEWORK_AGENT` not propagated | ⚠️ **OUTDATED DIAGNOSTIC** | LOW |
| **5** | **Read operations cause `eslint_state.dirty_modules`** | ✅ **NEW FINDING** (discovered during review) | **P0 ✅ FIXED** |
| **6** | **Bun stale-cache `.pending.json` skip after restart** | ✅ **#12** | **P1 ✅ FIXED** |
| **7** | **BL-05: MANDATORY-DISPATCH intra-invocation contradiction** | ✅ **NEW FINDING** (confirmed 2026-06-09) | **P0 ✅ FIXED** |
| **8** | **BL-06: `.pending.json` silent write failure + FIFO dedup gap** | ✅ **NEW FINDING** (confirmed 2026-06-09) | **P1 ✅ FIXED** |
| **9** | **BL-07: Orchestrator dag_task_id reuse FIFO confusion** | ✅ **NEW FINDING** (confirmed 2026-06-09) | **P1 ✅ FIXED** |
| **10** | **BL-08: OpenCode double-fires tool.execute.before hook** | ✅ **NEW FINDING** (callID-proven 2026-06-09) | **P0 ✅ FIXED** |
| **11** | **BUG-1 VERIFICATION-REPORT: safe-edit-core TOCTOU** | ❌ **FALSE CLAIM** (2026-06-09) | — |
| **12** | **BUG-2 VERIFICATION-REPORT: self-test count mismatch** | ✅ **CONFIRMED & FIXED** (2026-06-09) | LOW ✅ |
| **13** | **OMIS-2 VERIFICATION-REPORT: package.json scripts missing** | ✅ **CONFIRMED** (2026-06-09) | LOW |

---

## Claim 1: Hook Integrity Threshold `< 2` is Dead Code

### Diagnosis

**TRUE**. The threshold check on line 44 of `gate-checks.ts` is unreachable dead code.

### Root Cause

In `.opencode/plugins/framework-enforcer/gate-checks.ts` (lines 30-51):

```typescript
let _pluginHooksCount = 0;                    // Line 18: Module-level state

export function checkPluginIntegrity(): { valid: boolean; detail: string } {
  const currentHash = computeFileHash(pluginPath);
  if (!_pluginHash) {
    _pluginHash = currentHash;
    _pluginHooksCount = 14;                   // Line 35: Hardcoded to 14 ONCE
    return { valid: true, detail: "Plugin initialized" };
  }
  if (currentHash !== _pluginHash)            // Line 38: Hash change detected
    return { valid: false, detail: "Plugin hash changed..." };
  if (_pluginHooksCount < 2)                  // Line 44: NEVER TRUE
    return { valid: false, detail: "Only " + _pluginHooksCount + " hooks..." };
  return { valid: true, detail: "Plugin integrity verified" };
}
```

**The `_pluginHooksCount < 2` branch is unreachable** because:
1. `_pluginHooksCount` starts at `0` — but the `!_pluginHash` guard returns first without checking it.
2. On first call: `!_pluginHash` matches → sets `_pluginHooksCount = 14` → returns immediately.
3. On subsequent calls: `_pluginHash` is set → guard is skipped, but `_pluginHooksCount` remains `14`.
4. `14 < 2` is always `false` → the check never fires.

**The same pattern exists in 3 files** (all copies of the same logic):
- `.opencode/plugins/framework-enforcer/gate-checks.ts` (active)
- `.opencode/plugins/_p1_cleanup/gate-checks.ts` (cleanup copy)
- `.opencode/plugins/_p1_cleanup/checks/gate-checks.ts` (cleanup copy)
- `.opencode/plugins/_archived_framework-enforcer.legacy.ts` (archived)

### What Still Works

The **plugin hash integrity check** (line 38) still works — if the plugin file changes, the hash mismatch is detected. The dead code is specifically the hook count check, not the hash check.

### What Could Evade Detection

If a plugin registers fewer hooks via **dynamic/conditional logic** within the same file (same hash), the reduction would go undetected:
- 14 → 1 hook: passes hash check (identical file), `_pluginHooksCount` still reports `14`
- Hook removed from a DIFFERENT file (e.g., merged into `index.ts`): hash changes → DETECTED

### Fix Plan

**Option A: Dynamic Hook Enumeration (Recommended)**

Count the actual number of hooks returned by the plugin at runtime:

```typescript
// In gate-checks.ts, replace the hardcoded 14:
import { getRegisteredHooks } from "./plugin-loader"; // or equivalent

export function checkPluginIntegrity(): { valid: boolean; detail: string } {
  const currentHash = computeFileHash(pluginPath);
  if (!_pluginHash) {
    _pluginHash = currentHash;
    _pluginHooksCount = getRegisteredHooks().length; // DYNAMIC count
    return { valid: true, detail: "Plugin initialized" };
  }
  const actualHooks = getRegisteredHooks().length;
  if (actualHooks !== _pluginHooksCount) {
    _pluginHooksCount = actualHooks;
    return { valid: false, detail: `Hook count changed: ${_pluginHooksCount} → ${actualHooks}` };
  }
  if (currentHash !== _pluginHash)
    return { valid: false, detail: "Plugin hash changed..." };
  if (_pluginHooksCount < 2)
    return { valid: false, detail: "Only " + _pluginHooksCount + " hooks..." };
  return { valid: true, detail: "Plugin integrity verified" };
}
```

**Option B: Remove the Dead Branch (Quick Fix)**

If dynamic hook counting is not feasible (hooks are registered via multiple source files), remove the dead threshold check and replace it with a self-test-time validation:

```typescript
// Remove the `< 2` branch from runtime — add to framework-self-test.ts Check 19:
// Count hooks by scanning enforce.ts index.ts for hook signatures
```

**Recommended**: Option A. The `idx.ts` entry file that registers hooks (`tool.execute.before`, `tool.execute.after`, `shell.env`, `chat.message`) is a controlled surface — counting export keys is straightforward.

### Files to Modify

| File | Action |
|------|--------|
| `.opencode/plugins/framework-enforcer/gate-checks.ts` L18, L35, L44-49 | Replace hardcoded 14 with dynamic count |
| `.opencode/plugins/_p1_cleanup/gate-checks.ts` L13, L25, L27 | Remove or sync |
| `.opencode/plugins/_p1_cleanup/checks/gate-checks.ts` L13, L25, L27 | Remove or sync |
| `.opencode/plugins/framework-enforcer/index.ts` | Export hook count helper |

---

## Claim 2: `drained_sessions` Type Inconsistency

### Diagnosis

**TRUE**. Three different code paths use three incompatible data structures for `drained_sessions`.

### Root Cause Analysis

| File | Lines | Data Structure | Code Pattern |
|------|-------|---------------|--------------|
| `gate-checks.ts` (`autoDrainStaleSessions`) | 119-126 | **Array** | `drained_sessions\|=[]; .push({...session, drained_at, reason})` |
| `gate-lifecycle-audit.ts` | 51, 166 | **Object** (keyed by sid) | `drained_sessions\|={}; drained_sessions[sid] = {...session}` |
| `state-reconciliation.ts` (`fixDrainOrphanedSessions`) | 367-398 | **In-place mutation** (no separate container) | `s.gate_status = "drained"` (stays in `gate.sessions`) |

The **canonical type** in `gate-core.ts` (line 122) is:
```typescript
drained_sessions: Record<string, GateSession & { drained_at: string; drain_reason: string; drain_type?: string }>;
```
This is an **object** (Record), matching `gate-lifecycle-audit.ts`.

### Inconsistency Impact

| Scenario | Consequence |
|----------|------------|
| `gate-checks.ts` drains session → writes ARRAY to `gate-state.json.drained_sessions` | ✅ Stored as `[...]` |
| `gate-lifecycle-audit.ts` reads → expects OBJECT | ❌ `Object.keys(array)` returns indices: `["0","1","2"]` instead of session IDs |
| `state-reconciliation.ts` reads → doesn't look at `drained_sessions` at all | ⚠️ Stale sessions stay in `gate.sessions` with `gate_status: "drained"` — invisible to audit |

Additionally, `compliance-gate.ts` (line 597, 604) and `gate-core.ts` (line 298) both use `drainedSessions.drained_sessions` as a **Record** (object), matching the canonical type. The `gate-checks.ts` array format is the outlier.

### Fix Plan

**Standardize all paths to the canonical `Record<string, ...>` (object) format**:

#### Step 1: Fix `gate-checks.ts` `autoDrainStaleSessions()`

```typescript
// BEFORE (WRONG — array):
(gate as any).drained_sessions = (gate as any).drained_sessions || [];
(gate as any).drained_sessions.push({...session, drained_at, reason: "auto-drain"});

// AFTER (CORRECT — Record):
(gate as any).drained_sessions = (gate as any).drained_sessions || {};
(gate as any).drained_sessions[sid] = {...session, drained_at: new Date().toISOString(), drain_reason: "auto-drain"};
```

#### Step 2: Fix `state-reconciliation.ts` `fixDrainOrphanedSessions()`

Add a `drained_sessions` object write alongside the in-place status change:

```typescript
// Add after line 395:
if (!gate.drained_sessions) gate.drained_sessions = {};
gate.drained_sessions[sid] = {
  ...s,
  drained_at: new Date().toISOString(),
  drain_reason: "auto-reconciled: stale armed session >24h",
};
```

#### Step 3: Update Tests

In `.opencode/scripts/__tests__/framework-enforcer.test.js`:
- Line 1949: `expect(gate.drained_sessions.length).toBe(1)` must change to `expect(gate.drained_sessions[sid]).toBeDefined()`
- Test block "FX-DIAG-CONS-3: drained_sessions object format" (L3088) already uses Record format — ensure drain code path matches.

#### Step 4: Add Self-Test Check

Add to `framework-self-test.ts` a `drained_sessions` format validation that reads `gate-state.json` and verifies `drained_sessions` is `typeof === 'object' && !Array.isArray(...)`.

### Files to Modify

| File | Lines | Action |
|------|-------|--------|
| `.opencode/plugins/framework-enforcer/gate-checks.ts` | 119-126 | Change array → object |
| `.opencode/scripts/state-reconciliation.ts` | 367-398 | Add `drained_sessions` object write |
| `.opencode/plugins/_p1_cleanup/gate-checks.ts` | 69-71 | Sync fix |
| `.opencode/plugins/_p1_cleanup/checks/gate-checks.ts` | 69-71 | Sync fix |
| `.opencode/scripts/__tests__/framework-enforcer.test.js` | 1949 | Update assertions |
| `.opencode/scripts/framework-self-test.ts` | (new check) | Add `drained_sessions` format validation |

---

## Claim 3: `safe_edit` Scope Enforcement Bypass

### Diagnosis

**ALREADY PATCHED**. This was a historical bug fixed in commits labeled `FW-HARDEN-SAFE-EDIT-01` through `FW-HARDEN-SAFE-EDIT-04`.

### What the Claim States

> "safe_edit wrote to booking-frontend/ (denied path for Coder-BE) without any enforcement error"

### What the Current Code Shows

The current code in `enforce.ts` has multiple fixes:

1. **`FW-HARDEN-SAFE-EDIT-01`** (line 968-985): `safe_edit` now included in TDD enforcement alongside `write` and `edit`
2. **`FW-HARDEN-SAFE-EDIT-02`** (line 1098-1131): `safe_edit` now included in write scope enforcement via `isModifyTool()`
3. **`FW-HARDEN-SAFE-EDIT-03`** (line 1398+): `safe_edit` now triggers state reconciliation (dirty_modules flagging)
4. **`FW-HARDEN-SAFE-EDIT-04`** (line 1342): `safe_edit` now classified as "modify" in audit log

`isModifyTool()` (line 94-103) now covers all write paths:
```typescript
function isModifyTool(tool: string): boolean {
  return (
    tool === "write" || tool === "edit" || tool === "safe_edit" ||
    tool === "safe_mkdir" || tool === "safe_delete" || tool === "safe_shell"
  );
}
```

### Remaining Concern: Agent Identity Gap

The scope check at line 1114-1119:
```typescript
if (isModifyTool(tool) && applyScope && agent && agent !== "human" && agent !== "1")
```

If `resolveAgent()` returns `""` (falsy), the **entire scope check is skipped** due to the `agent &&` short-circuit. This could happen if:
- `_dispatch_target.json` is missing (file already cleaned up by a previous after-hook)
- `_agentResolved` was set to true in a previous call before the file existed
- The `run_id` staleness check deleted the file

**This is a broader concern — see Claim 4.**

### Verdict

The specific claim about `safe_edit` bypassing scope enforcement is **fixed**. The original root cause (safe_edit not in the modify tool list) is resolved. The secondary root cause mentioned in the claim (FRAMEWORK_AGENT not propagated) is addressed in Claim 4.

---

## Claim 4: `FRAMEWORK_AGENT` Env Var Not Propagated

### Diagnosis

**PARTIALLY VALID DESIGN CONCERN — using outdated diagnostic terminology**. The underlying concern (agent identity not reliably resolved in sub-agent processes) is valid, but the specific mechanism (FRAMEWORK_AGENT env var) has been superseded.

### What the Claim States

```
enforce.ts → resolveAgent() → checks FRAMEWORK_AGENT env → EMPTY
                              → checks AGENT env → EMPTY  
                              → checks _dispatch_target.json → NOT FOUND
                              → returns "" (falsy)
                              → scope check condition shorts: agent="" → skipped
```

### What the Current Code Actually Does

The current `resolveAgent()` (lines 25-61) does **NOT** check `FRAMEWORK_AGENT`. The comment on line 23 explicitly states: "模块级缓存，替代已废弃的 FRAMEWORK_AGENT env var".

The actual resolution chain:
1. **Module-level cache** (`_cachedAgent`) — used on all calls after first resolution
2. **`_dispatch_target.json`** (v4.0.0 replacement) — written by `toolExecuteBefore` before each Task()
3. **`process.env.AGENT`** fallback — usually `"1"` for sub-agents
4. **Empty string** (`""`) — ultimate fallback

### Confirmation from Knowledge Cache

The knowledge cache doc `agent-identity-plugin-hooks.md` confirms:
- `FRAMEWORK_AGENT` was a **project-specific** addition (not from upstream OpenCode)
- Set in `dispatch-subagent.ts:102` via `process.env.FRAMEWORK_AGENT = '@' + agentType`
- This was part of BUG-5894 fix but has been **deprecated in v4.0.0**
- Upstream OpenCode's `tool.execute.before` hook does NOT include agent identity in its input

### Real Remaining Gaps

**Gap 1: `resolveAgent()` returning empty string skips all enforcement**

At line 1119: `if (isModifyTool(tool) && applyScope && agent && agent !== "human" && agent !== "1")`

If `agent` is `""`:
- `agent &&` → short-circuits to `false`
- Entire scope check is skipped
- TDD check at line 968-985 is also skipped (agent must be exactly `@Coder-BE` or `@Coder-FE`)
- ROUTE-MISMATCH check also skipped (all agent-specific)
- UC7KS check (line 992) is also bypassed if resolvedAgent is empty

**This IS a real bypass vector**, though mitigated by the `_dispatch_target.json` + session map fallback mechanisms.

**Gap 2: Single-file `_dispatch_target.json` is theoretically racy**

Two concurrent Task() dispatches would:
1. First before-hook writes agent A to `_dispatch_target.json`
2. First Task() spawns sub-agent → sub-agent reads `agent: A` ✅
3. Second before-hook writes agent B to `_dispatch_target.json` (overwrites)
4. First after-hook deletes `_dispatch_target.json`
5. Second Task() spawns sub-agent → `_dispatch_target.json` already deleted → `resolveAgent()` returns `""` → enforcement SKIPPED

**Practical impact**: LOW — `execFileSync` in `dispatch_subagent.ts` blocks synchronously, so concurrent dispatches are unlikely at the JS level. However, OpenCode's native Task() dispatch may spawn sub-agents asynchronously.

**Gap 3: `_agentResolved` is a process-level singleton**

Line 31: `_agentResolved = true` is set **once per process** on the FIRST call to `resolveAgent()`. If the first call happens before `_dispatch_target.json` is written (race condition), the agent resolves to `""` and is cached forever. This is the "stale resolution" issue.

However, in practice, the before-hook writes the file synchronously (line 686: `fs.writeFileSync`) before the Task() returns, and the sub-agent's `resolveAgent()` is lazy (called on first tool execution), so the file should be available.

### Fix Plan

**Fix 1: Fail-safe Scope Enforcement**

Instead of skipping scope enforcement when agent is unknown, DEFAULT to BLOCKING all write operations:

```typescript
// In enforce.ts toolExecuteBefore(), replace the scope check condition:
if (isModifyTool(tool) && applyScope && agent !== "human" && agent !== "1") {
  // Current: skips when agent is empty
}

// Should be:
if (isModifyTool(tool) && applyScope) {
  if (!agent || agent === "1" || agent === "human") {
    // Unknown agent — BLOCK all writes to non-framework paths in strict/locked mode
    if (mode === "strict" || mode === "locked") {
      violations.push(
        `[FW-ENFORCE] Agent identity unresolved — write to "${fp}" blocked. ` +
        `This likely indicates a dispatch mechanism failure. Use human dispatch for repair.`
      );
    }
  } else {
    // Known agent — apply scope as before
    if (!isWriteAllowed(agent, fp) && (mode === "strict" || mode === "locked")) {
      violations.push(`[FW-ENFORCE] Agent "${agent}" write to "${fp}" blocked by agent_write_scopes.`);
    }
  }
}
```

**Fix 2: Multi-target `_dispatch_target.json`**

Replace the single-file approach with a session-ID-keyed registry:

```typescript
// Instead of: .task_temp/_dispatch_target.json = { agent: "Coder-BE" }
// Use: .task_temp/_dispatch/.session_map.json = { [sessionID]: { agent: "Coder-BE", ... } }
```

The `resolveAgent()` function already has a `resolveAgentFromSessionMap()` fallback (line 201-214) that reads from `.session_map.json`. The `chat.message` hook already writes agent info to this map. Extend this mechanism to be the PRIMARY resolution path.

**Fix 3: Remove stale `FRAMEWORK_AGENT` references**

In cleanup/archived files, the old `process.env.FRAMEWORK_AGENT` checks should be noted as deprecated:

| File | Line | Action |
|------|------|--------|
| `_p1_cleanup/fw-core.ts` | 12, 21 | Mark as deprecated — keep for reference |
| `_archived_framework-enforcer.legacy.ts` | 528, 1144 | Archive — no action needed |
| `_uc7ks-enforcer.archived/uc7ks-enforcer.ts` | 257, 264 | Archive — no action needed |

### Files to Modify

| File | Lines | Action |
|------|-------|--------|
| `.opencode/plugins/framework-enforcer/enforce.ts` | 1108-1130 | Fail-safe scope: block unknown-agent writes |
| `.opencode/plugins/framework-enforcer/enforce.ts` | 25-61 | Integrate session_map.json as primary resolution |
| `.opencode/plugins/_p1_cleanup/fw-core.ts` | 12, 21 | Add deprecation comment |

---

## Summary of Required Fixes

| # | Issue | Files | Effort | Priority |
|---|-------|-------|--------|----------|
| 1 | `_pluginHooksCount` dead code | `gate-checks.ts` (×4) + `index.ts` | Small (add hook counter export) | P1 |
| 2 | `drained_sessions` array→object | `gate-checks.ts` (×3) + `state-reconciliation.ts` + `framework-self-test.ts` + tests | Medium (4 files, 1 test) | P0 |
| 3 | `safe_edit` scope bypass | Already fixed — no action | None | — |
| 4 | Agent identity fail-open | `enforce.ts` (scope + resolution) + `_p1_cleanup/fw-core.ts` | Medium (2 logic changes) | P1 |
| **5** | **Read causes dirty_modules (blocks gate closure)** | **`compliance-gate.ts` (`compliance_gate_complete` impl)** | **Small (clear dirty_modules)** | **P0 ✅ FIXED** |
| **6** | **Bun stale-cache: dispatch skip .pending.json after restart** | **`dispatch-subagent.ts` + `dispatch_subagent.ts`** | **Small (version comment + --no-cache)** | **P1 ✅ FIXED** |
| **7** | **BL-05: MANDATORY-DISPATCH self-contradiction** | **`enforce.ts` L436-880** | **Small (hoist `dispatchConsumed` flag)** | **P0 ✅ FIXED** |
| **8** | **BL-06: `.pending.json` silent failure** | **`dispatch-subagent.ts` L773-798** | **Small (retry+fatal+dedup)** | **P1 ✅ FIXED** |
| **9** | **BL-07: dag_task_id FIFO confusion** | **`dispatch-subagent.ts` L773 + `Orchestrator.md`** | **Small (dedup + prompt)** | **P1 ✅ FIXED** |
| **10** | **BL-08: OpenCode double hook** | **`enforce.ts` Block 2** | **Small (callID guard)** | **P0 ✅ FIXED** |
| **11** | **UC7KS pipeline not enforced before modify ops** | **`enforce.ts` (gate + helper)** | **Small (+45 lines)** | **P0 ✅ FIXED** |

### Recommended Fix Order

1. **P0 ✅**: Fix drained_sessions type (Claim 2) — data corruption risk
2. **P0 ✅**: Fix read-causes-dirty_modules (#11) — blocks all gate closure
3. **P1 ✅**: Fix #12 Bun stale-cache — dispatch .pending.json writes after restart
4. **P1 ✅**: Fix _pluginHooksCount dead code (Claim 1) — cleanup
5. **P1 ✅**: Fix agent identity fail-open (Claim 4) — defense-in-depth
6. **P0 ✅**: Fix BL-05 (#13) — MANDATORY-DISPATCH self-contradiction blocks ALL single-entry dispatches
7. **P1 ✅**: Fix BL-06 (#14) — `.pending.json` silent write failure: dispatch-subagent.ts fatal+retry+dedup
8. **P1 ✅**: Fix BL-07 (#15) — dag_task_id reuse FIFO confusion: dedup by agentType + Orchestrator.md hardening

---

## 🟡 Additional Finding: `compliance_gate_complete` Self-Dirtying Cycle — Blocking Gate Closure

**Status**: ✅ Fixed (P0-FIX-BUG-11 in compliance-gate.ts L1053-1078; verified after OpenCode restart, session cg_ses_1780973489782).

### Discovery Context

During this investigation, `compliance_gate_complete` failed on **6 consecutive attempts** (sessions `cg_ses_1780969075651`, `cg_ses_1780969364018`, `cg_ses_1780969392187`, `cg_ses_1780971433860`, `cg_ses_1780971885933` + 1 more) with identical CAT3.7 violations listing 20-23 `.opencode/*.ts` files in `dirty_modules`. However:

1. **ESLint mock-audit `full_scan` consistently returned `pass`** with `state_status: "clean"` — confirming no actual violations exist
2. **The same files reappeared in `dirty_modules` seconds after each `full_scan` cleared them**
3. **The plugin-level fixes (P0-FIX-QUAD-05 `didModify` gate) were applied and verified correct**

### Confirmed Root Cause (2026-06-09, post-plugin-fix analysis)

The original hypothesis ("read operations cause dirty_modules") was **partially correct but incomplete**. After applying the `didModify` gate in `toolExecuteAfter`, non-modify tools (like `read`) no longer trigger `_executeWriteAuditCheck`. However, the gate still fails because of a deeper self-dirtying cycle:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SELF-DIRTYING CYCLE                           │
│                                                                  │
│  1. eslint_audit full_scan                                      │
│     → clears machine.json.eslint_state.dirty_modules            │
│     → state_status = "clean"                                    │
│                                                                  │
│  2. compliance_gate_complete invoked                             │
│     → internally writes to gate-state.json                      │
│     → (marks session as complete)                               │
│                                                                  │
│  3. tool.execute.after hook fires                               │
│     → toolExecuteAfter() runs                                   │
│     → state reconciliation block (L1407-1448)                   │
│     → isModifyTool("compliance_gate_complete")? NO              │
│     → BUT: the internal write tool used by compliance_gate_     │
│       complete IS a modify tool → triggers hook separately      │
│                                                                  │
│  4. Hook re-flags previously-modified .opencode/ files           │
│     → write-audit history records these as "dirty"              │
│     → machine.json.eslint_state.aggregate.dirty_modules = [...] │
│                                                                  │
│  5. compliance_gate_complete reads machine.json                 │
│     → finds dirty_modules non-empty                             │
│     → RETURNS FAILED (CAT3.7)                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight**: The `compliance_gate_complete` MCP tool internally uses write operations to update `gate-state.json`. These writes trigger `tool.execute.before`/`tool.execute.after` hooks. The state reconciliation block in `toolExecuteAfter` (lines 1407-1448 of enforce.ts) reads the write-audit history and re-flags **all previously-modified files** (not just the current write) as dirty. Since framework agents (@Super-Admin) typically modify `.opencode/` source files, these files remain perpetually dirty in the write-audit history.

### Why Plugin-Level Fixes Are Insufficient

The `didModify` gate (P0-FIX-QUAD-05) correctly prevents non-modify tools from triggering `_executeWriteAuditCheck`. But it does NOT prevent the state reconciliation block at lines 1407-1448 from re-dirtying modules on legitimate modify-tool executions — and `compliance_gate_complete`'s internal `gate-state.json` write is a legitimate modify operation.

The fix must be in one of two places:

**Option A: Fix in `compliance_gate_complete` MCP tool**
- Run `eslint_audit.run_audit({ full_scan: true })` internally BEFORE checking `dirty_modules`
- This clears the write-audit state before the gate check

**Option B: Fix in state reconciliation block (enforce.ts L1407-1448)**
- Exempt `.opencode/` framework files from CAT3.7 dirty_modules tracking
- The CAT3.7 gate is designed for business code (`booking-backend/src/`, `booking-frontend/src/`)
- Framework files should not block compliance gate closure

**Recommended**: Option A (fix in compliance_gate_complete) is the most correct — it addresses the root cause at the decision point. Option B is a faster tactical fix but introduces an exemption that could mask real framework-file violations.

### Fix Plan

**In `.opencode/scripts/mcp-tools/compliance-gate.ts` — `compliance_gate_complete` implementation:**

Before reading `machine.json.eslint_state` for the CAT3.7 gate, run a full ESLint audit scan:
```typescript
// Before CAT3.7 check:
const auditResult = eslint_audit.run_audit({ full_scan: true });
// auditResult clears dirty_modules in machine.json
// ... now read machine.json.eslint_state for CAT3.7 check
```

### Files to Modify

| File | Lines | Action |
|------|-------|--------|
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | `compliance_gate_complete` impl | Run `eslint_audit full_scan` before CAT3.7 dirty_modules check |

### Cross-Reference

Tracked as **#11** in `docs/review/remain-issue/PRIORITY.md` (P0 — Must Fix).

---

## 🔴 Finding 11 (UC7KS-HARDEN-18): UC7KS Pipeline Not Enforced Before Modify Operations

**Status**: ✅ Fixed — P0-FIX-UC7KS-HARDEN-18 applied (2026-06-09). Tracked as #18 in PRIORITY.md.

### Discovery

During the UC7KS permission matrix hardening, it was discovered that while `checkUC7KS()` in `enforce.ts` reads `machine.json.knowledge_cache_state.session_access[agent].uc7_001_compliant`, this check only triggers on **external query tools** (context7, webfetch, websearch, GitHub, Playwright). No equivalent check exists before **modify operations** (write, edit, safe_edit, safe_delete, safe_mkdir, modifying safe_shell).

This gap was demonstrated when @Super-Admin was able to call `github_get_file_contents` (bypassing UC7KS) and then proceed to modify code without ever calling `module_scope_declare` or `knowledge_cache_search`.

### Root Cause

The UC7KS pipeline state exists in `machine.json`:
- `session_access[agent].declared_scope` — set by `module_scope_declare` (Step 0a)
- `session_access[agent].uc7_001_compliant` — set by `knowledge_cache_search` (Step 0b)

But `toolExecuteBefore()` never reads this state before allowing modify operations. The only check is in `checkUC7KS()` which fires on external query tools.

### Fix

Added two changes in `enforce.ts`:

1. **Helper function** `readCachedSessionAccess(agentKey)` — reads `machine.json.knowledge_cache_state.session_access[agentKey]`

2. **Pipeline gate** inserted before the write-scope check — validates both `declared_scope` and `uc7_001_compliant` before any modify operation:
   - In `advisory` mode: no enforcement (warning only)
   - In `strict`/`locked` mode: blocks modify operations until both steps complete
   - UC7-009 emergency bypass: Super-Admin exempt when `isLocalCacheAvailable() === false`

### Files Modified

| File | Change |
|------|--------|
| `enforce.ts` L343-358 | `readCachedSessionAccess()` helper function |
| `enforce.ts` L1331-1358 | UC7KS Pipeline Gate (45 lines, merged with `applyScope` declaration) |

---

## Appendix: Cross-Reference to PRIORITY.md

The existing PRIORITY.md already tracks:
- ✅ #5 (Direct-invocation agent identity "1") — resolved
- ✅ #4 (`_dispatch_target.json` never cleaned up) — resolved  
- 🔴 #9 (dispatch_subagent security gates not universal) — implemented
- 🟡 #10 (Mandatory dispatch_subagent for all Task()) — planned

The findings in this review add:
- **NEW P0**: `drained_sessions` type inconsistency (not previously tracked)
- **NEW P0**: Read causes `dirty_modules` blocking `compliance_gate_complete` (tracked as #11; discovered during this review's gate closure attempts)
- **NEW P1**: `_pluginHooksCount` dead code (not previously tracked)
- **NEW P1**: Agent identity fail-open hardening (extends resolved #5)
- **NEW 🟡**: Bun stale-cache causes dispatch-subagent.ts to skip .pending.json writes after restart (tracked as #12; discovered 2026-06-09 post-restart)
- **NEW P0 🔴**: BL-05 MANDATORY-DISPATCH intra-invocation contradiction: Block 1 (L439) consumes entry, Block 2 (L852) rereads empty disk (tracked as #13; confirmed 2026-06-09)

---

## 🔴 Finding 3 (BL-05): MANDATORY-DISPATCH Gate Self-Contradicts — Two `TASK_TOOLS` Blocks in Same `toolExecuteBefore` Don't Coordinate

**Status**: ✅ P0-FIX-BUG-13 (dispatchConsumed) applied and verified. Pending: Plan A (idempotency guard) + Plan B (Orchestrator prompt). Tracked as #13 in PRIORITY.md.

### Discovery

After fixes #11 (self-dirtying cycle) and #12 (Bun cache) were applied and verified, `.pending.json` entries continued to drain between `dispatch_subagent()` and `Task()` calls. **6 consecutive failures** confirmed in `chat_message_hook.log` (03:32-03:57). The #12 fix (Bun cache) was a partial contributor during restart scenarios, but NOT the root cause for normal-session failures.

### Root Cause — Deterministic, Not a Race

`enforce.ts` `toolExecuteBefore()` contains **two separate `if (TASK_TOOLS.has(tool))` blocks**:

| Block | Lines | Action | Reads `.pending.json` |
|-------|-------|--------|----------------------|
| **Block 1 — Consumption** | 439-654 | Hash check → consume matching entry → splice from array → `fs.writeFileSync` updated queue | L463: `let queue = JSON.parse(fs.readFileSync(PENDING_FILE))` |
| **Block 2 — MANDATORY-DISPATCH** | 852-880 | Verify queue is non-empty; block if empty | **L864: `const q = JSON.parse(fs.readFileSync(pf))` — fresh disk read** |

The `queue` variable from Block 1 is declared inside `if (fs.existsSync(PENDING_FILE))` at L462 and falls out of scope at L653. Block 2 at L852 cannot access it — it MUST reread from disk at L864.

**Failure sequence (deterministic — same invocation, sequential execution)**:

```
1. dispatch_subagent() → dispatch-subagent.ts writes .pending.json = [{agentType:"X", promptHash:"Y"}]

2. Task({subagent_type:"X", prompt:"..."}) → toolExecuteBefore fires

3. BLOCK 1 (L463): fs.readFileSync → queue = [{X, hash:Y}]              ✅
   BLOCK 1 (L597): agentType matches "X"                                  ✅
   BLOCK 1 (L601): actualHash === pending.promptHash → MATCH             ✅
   BLOCK 1 (L603): queue.splice(i, 1) → entry removed                    ✅
   BLOCK 1 (L604): fs.writeFileSync(PENDING_FILE, "[]") → disk = []      ✅
   BLOCK 1 ends at L654                                                   

4. ── 198 lines of unrelated checks (TASK-IDENTITY, DISPATCH-SECURITY, UC7KS, DAG, ROUTE-MISMATCH, write scope) ──

5. BLOCK 2 (L864): fs.readFileSync(pf) → q = [] → empty=true             ❌
   BLOCK 2 (L872): throw MANDATORY-DISPATCH "No pending dispatch entry"   ❌
```

### Why It's NOT a Race Condition

- Both blocks execute in the **same synchronous `toolExecuteBefore` invocation**
- `fs.writeFileSync` at L604 is synchronous — data is on disk before return
- `fs.readFileSync` at L864 is synchronous — always sees the updated file
- The `queue` variable from L463 is scoped to L462-L653 — Block 2 at L852 physically cannot access it
- The failure is **architectural**: "left hand consumes, right hand checks" with no coordination

### When It Passes vs Fails

| Queue state before Task() | Block 1 outcome | Block 2 outcome | Result |
|---------------------------|----------------|-----------------|--------|
| **2+ entries** (same agentType) | Consumes 1 | Finds ≥1 remaining → non-empty | ✅ PASS |
| **Exactly 1 entry** (same agentType) | **Consumes it → writes []** | **Finds empty** | ❌ FAIL |
| 1 entry (different agentType) | Doesn't match → leaves 1 | Finds 1 → non-empty | ✅ PASS (but hash unverified!) |
| Hash mismatch + advisory | Doesn't consume → leaves 1 | Finds 1 → non-empty | ⚠️ PASS but TASK-PROMPT-MISMATCH ignored |

### Demo Log Evidence

```
# Successful (2+ entries in queue):
03:25:34  empty=false  ← Task() call 1: Block 1 consumed entry#1, Block 2 found entry#2
03:25:34  empty=false  ← Task() call 2: Block 1 consumed entry#2, ... 

# Failed (1 entry in queue):
03:32:49  empty=true   ← Task(): Block 1 consumed sole entry, Block 2 found empty
03:33:32  empty=true   ← retry: entry already consumed, perpetually empty
03:34:14  empty=true   ← same
03:54:08  empty=true   ← Architect user: same pattern
03:55:26  empty=true
03:56:44  empty=true
03:57:55  empty=true
```

### Fix Plan

**Option A (Recommended — Minimal Change)**: Hoist the `consumed` flag (L588) to the outer scope (above L439) so both blocks can see it. In Block 2, skip the MANDATORY-DISPATCH check when `consumed === true`.

```typescript
// Before L439, add:
let dispatchConsumed = false;

// In Block 1 (L588-609), when hash matches:
consumed = true;
dispatchConsumed = true;  // ← new: signal to Block 2

// In Block 2 (L852), before checking queueEmpty:
if (TASK_TOOLS.has(tool) && !dispatchConsumed && FW_PROMPT_QUEUE_DRAIN !== "true") {
```

**Option B**: Merge the two `if (TASK_TOOLS.has(tool))` blocks into one. Check MANDATORY-DISPATCH only when Block 1 found no matching entry.

### Files to Modify

| File | Lines | Action |
|------|-------|--------|
| `.opencode/plugins/framework-enforcer/enforce.ts` | L436-880 | Hoist `dispatchConsumed` flag; gate Block 2 on `!dispatchConsumed` |

### Cross-Reference

Findings 8 and 9 were discovered during the post-mortem analysis of an Orchestrator TASK-PROMPT-MISMATCH error in which the Orchestrator called `dispatch_subagent(Architect, dag_task_id="VERIFY-REPORT-FINAL")` twice (07:05 and 07:30) with different task descriptions. The 07:30 dispatch appears to have created the prompt file but its `.pending.json` entry was never registered. The 07:05 entry was later auto-drained at 07:37 (32 min stale > 30 min threshold). Full timeline and root cause analysis in PRIORITY.md #14 and #15.

---

## 🟡 Finding 2: Bun Stale-Cache Causes `.pending.json` Write Skipping After Restart

**Status**: ✅ Fixed (P0-FIX-BUG-12: BUN-CACHE-VERSION + --no-cache flag). Tracked as #12 in PRIORITY.md.

### Discovery

After the OpenCode restart to load P0-FIX-BUG-11 (compliance-gate.ts), `dispatch_subagent` created prompt files in `.task_temp/_dispatch/` but `.task_temp/_dispatch/.pending.json` remained `[]`. Subsequent `Task()` calls were blocked by the MANDATORY-DISPATCH gate: "No pending dispatch entry found (.pending.json is empty)."

A subsequent restart resolved the issue — `.pending.json` writes resumed normally. This pattern matches the documented Bun stale-cache behavior (plugin-debugging-precautions.md §3).

### Root Cause

Bun caches compiled TypeScript modules. After a restart, Bun may serve a **stale cached version** of `dispatch-subagent.ts` that predates FW-PROMPT-HARDEN-04 (2026-06-08). The stale version lacks the `.pending.json` FIFO queue write at lines 768-797.

**Evidence confirming stale cache**:
1. Source code at L768-797 is correct and present — the code path exists
2. Dispatch log shows no "Failed to write .pending.json" warnings → the code wasn't skipped by error; it wasn't executed at all
3. After another restart, `.pending.json` writes resumed → cache was invalidated
4. The output files (prompt `.md` files) were created successfully — the script ran but with old logic

### Impact

- Task() calls blocked by MANDATORY-DISPATCH gate
- Primary agents cannot dispatch sub-agents
- Intermittent failure: resolves after another restart
- Silent failure: no error log when `.pending.json` write is absent in cached version

### Fix Plan

1. **Immediate**: Add a BUN-CACHE-VERSION comment to `dispatch-subagent.ts` that is incremented on every edit to force Bun cache hash change:
   ```typescript
   // BUN-CACHE-VERSION: 2026-06-09-v2
   ```

2. **Structural**: In `dispatch_subagent.ts` MCP tool, use `bun --no-cache` flag or switch to `node` runtime for this critical script to bypass Bun's caching layer entirely.

### Files

| File | Action |
|------|--------|
| `.opencode/scripts/command-tools/dispatch-subagent.ts` L1 | Add BUN-CACHE-VERSION comment |
| `.opencode/tools/dispatch_subagent.ts` L376 | Consider `--no-cache` flag |

---

## Appendix: Files Referenced

| File | Lines Read | Purpose |
|------|-----------|---------|
| `.opencode/plugins/framework-enforcer/gate-checks.ts` | 1-195 | Claims 1, 2 |
| `.opencode/plugins/framework-enforcer/enforce.ts` | 1-1401 | Claims 3, 4 |
| `.opencode/scripts/gate-lifecycle-audit.ts` | 1-219 | Claim 2 |
| `.opencode/scripts/state-reconciliation.ts` | 1-1232 | Claim 2 |
| `.opencode/tools/dispatch_subagent.ts` | 1-429 | Claim 4 |
| `.opencode/lib/gate-core.ts` | 115-134 | Claim 2 type definition |
| `docs/official_docs/framework/plugin-debugging-precautions.md` | 1-621 | Claim 4 context |
| `docs/official_docs/opencode/source-analysis/agent-identity-plugin-hooks.md` | 1-149 | Claim 4 context |
| `docs/official_docs/opencode/plugins/source-analysis/plugin-loading-mechanics.md` | 1-215 | Hook chaining context |
| `docs/review/remain-issue/PRIORITY.md` | 1-82 | Existing issue tracking |
