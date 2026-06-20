# Fix Plan: Dispatch Session_Map Race Condition

**Date**: 2026-06-19
**Author**: @Super-Admin (INVESTIGATE-SESSION-MAP-RACE → DEEP-AUDIT-DISPATCH-CTX)
**Status**: Updated — gap analysis complete (DEEP-AUDIT-DISPATCH-CTX)
**References**: review-report.md, config_read_state fix in scope-before.ts:220-274
**Audit**: `.task_temp/DEEP-AUDIT-DISPATCH-CTX/review-report.md` (2026-06-19, @Super-Admin)

---

## 1. Problem Summary

The `.dispatch_ctx` file (`.task_temp/_dispatch/.dispatch_ctx`) is a **global singleton** overwritten by every sequential dispatch. When multiple sub-agents of the same type are dispatched before their `chat.message` hooks fire, `resolveTaskId()` returns the wrong `dag_task_id` for all but the last sub-agent.

This causes all sub-agents to be registered in `session_map` with the same (last) `dag_task_id`, making the earlier sub-agents' `dag_task_id`s effectively missing — triggering `DISPATCH-TASKID-TAMPER` rejections in `compliance_gate_check`.

---

## 2. Fix Strategy

**Follow the `config_read_state` fix pattern**: Replace the single shared `.dispatch_ctx` file with **per-dispatch context files** keyed by `dag_task_id`. Each dispatch writes to its own file; no dispatch overwrites another's data.

### Why This Pattern Works

The `config_read_state` fix in `scope-before.ts` solved the same class of bug:

```typescript
// BEFORE (broken): Single shared value that gets overwritten
// session_id: "ses_XXX"  ← Only one session at a time

// AFTER (fixed): Nested map with per-session keys
config_read_state.sessions = {
  ses_AAA: { session_id: "ses_AAA", attested: true },
  ses_BBB: { session_id: "ses_BBB", attested: true },
};
```

The dispatch context fix follows the same pattern: instead of one `.dispatch_ctx` file, use a directory where each dispatch gets its own file:

```
.task_temp/_dispatch/ctx/
  CONCURRENT-SAME-S1A.json  → { dagTaskId: "S1A", agentType: "Coder-BE", ... }
  CONCURRENT-SAME-S1B.json  → { dagTaskId: "S1B", agentType: "Coder-BE", ... }
  CONCURRENT-SAME-S1C.json  → { dagTaskId: "S1C", agentType: "Coder-BE", ... }
```

---

## 3. Detailed Changes

### 3.1 New Function: `writeDispatchCtx()` in agent-resolver.ts

```typescript
/**
 * Write per-dispatch context to a dagTaskId-keyed file.
 * Replaces overwriting the shared .dispatch_ctx file.
 * Each dispatch gets its own file — no cross-dispatch overwrites.
 *
 * Files: .task_temp/_dispatch/ctx/{dagTaskId}.json
 */
export function writeDispatchCtx(
  dagTaskId: string,
  agentType: string,
  domainId?: string,
): void {
  try {
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    fs.mkdirSync(ctxDir, { recursive: true });
    const ctxFile = path.join(ctxDir, dagTaskId + ".json");
    fs.writeFileSync(
      ctxFile,
      JSON.stringify({
        dagTaskId,
        agentType,
        domainId: domainId || null,
        createdAt: Date.now(),
      }),
    );
  } catch {
    // Best-effort; never block dispatch
  }
}
```

### 3.2 Modified: `resolveTaskId()` in agent-resolver.ts

**Change Priority 2**: Instead of reading the single `.dispatch_ctx` file, scan the `ctx/` directory for per-dispatch context files.

```typescript
export function resolveTaskId(sessionId?: string): string {
  // Priority 1: session_map DB (per-session dag_task_id) — unchanged
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.dag_task_id) return entry.dag_task_id;
    } catch {}
  }

  // Priority 2 (NEW): Per-dispatch context files (dagTaskId-keyed)
  // Replaces the shared .dispatch_ctx file which was subject to overwrite races.
  // Each dispatch writes its own {dagTaskId}.json — no overwrites possible.
  try {
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    if (fs.existsSync(ctxDir)) {
      const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
      if (files.length > 0) {
        // Per-dispatch files exist. If only one, use it directly.
        if (files.length === 1) {
          const ctx = JSON.parse(
            fs.readFileSync(path.join(ctxDir, files[0]), "utf8"),
          );
          if (ctx?.dagTaskId) return ctx.dagTaskId;
        }
        // Multiple dispatch contexts: return the newest.
        // This is best-effort for agents that don't know their dagTaskId yet.
        // The compliance_gate_check call (which DOES know the task_id)
        // will register the correct mapping via self-registration.
        let newest: { dagTaskId: string; createdAt: number } | null = null;
        for (const file of files) {
          try {
            const ctx = JSON.parse(
              fs.readFileSync(path.join(ctxDir, file), "utf8"),
            );
            if (
              ctx?.dagTaskId &&
              (!newest || ctx.createdAt > newest.createdAt)
            ) {
              newest = ctx;
            }
          } catch {}
        }
        if (newest?.dagTaskId) return newest.dagTaskId;
      }
    }
  } catch {}

  // Priority 3: .dispatch_ctx (legacy fallback, still subject to race)
  try {
    const ctxPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx?.dagTaskId) return ctx.dagTaskId;
    }
  } catch {}

  // Priority 4: _dispatch_target.json (legacy)
  // ... (unchanged)
}
```

### 3.3 Modified: `dispatch_subagent` tool

**Change**: After writing to session_map with the parent's session ID, also write a per-dispatch context file.

```typescript
// In dispatch_subagent.ts tool (around line 688-704):

// NEW: Write per-dispatch context file (dagTaskId-keyed, no overwrites)
if (dagTaskId) {
  try {
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    fs.mkdirSync(ctxDir, { recursive: true });
    const ctxFile = path.join(ctxDir, dagTaskId + ".json");
    fs.writeFileSync(
      ctxFile,
      JSON.stringify({
        dagTaskId,
        agentType: args.agent_type,
        domainId: inferredDomainId || null,
        createdAt: Date.now(),
      }),
    );
  } catch {
    // Best-effort; never block dispatch
  }
}

// LEGACY: Keep writing .dispatch_ctx for backward compatibility
// (will be removed after all consumers migrate to ctx/ directory)
try {
  const ctxPath = path.join(
    process.env.OPENCODE_ROOT || ".",
    ".task_temp",
    "_dispatch",
    ".dispatch_ctx",
  );
  fs.writeFileSync(
    ctxPath,
    JSON.stringify({
      dagTaskId,
      domainId: inferredDomainId || null,
      createdAt: Date.now(),
    }),
  );
} catch {}
```

### 3.4 Self-Registration in `compliance_gate_check` (Defense-in-Depth)

As a **defense-in-depth** measure, modify `compliance_gate_check` to **self-register** when a sub-agent provides a `task_id` that matches a per-dispatch context file but doesn't yet have a session_map entry for the current session.

```typescript
// In compliance-gate.ts runGateCheck(), around line 832:

// If taskId is provided and validated (matches a dispatch context),
// ensure the current session has a correct session_map entry.
// This handles the case where session.ts's chat.message hook
// couldn't resolve the correct dagTaskId due to timing.
if (hasDispatchContext && taskId && dispatchAssignedTaskIds.includes(taskId)) {
  try {
    const existing = dbReadSessionMap(contextSessionId);
    if (!existing?.dag_task_id || existing.dag_task_id !== taskId) {
      // Self-register: write the correct dag_task_id for this session
      dbWriteSessionMap(contextSessionId, agent, taskId, domainId);
    }
  } catch {
    // Best-effort; gate validation is the primary concern
  }
}
```

This ensures that even if `session.ts`'s chat.message hook wrote the wrong `dag_task_id` (from the legacy `.dispatch_ctx`), `compliance_gate_check` will correct it when the sub-agent provides its correct `task_id`.

### 3.5 Cleanup: Remove `.dispatch_ctx` Overwrite in `dispatch-subagent.ts` CLI

The CLI `dispatch-subagent.ts` also writes to session_map with the parent's `OPENCODE_SESSION_ID` (line 598-601). This write is redundant with the tool's write at lines 690-704. Remove the redundant write and add the per-dispatch context file write instead.

```typescript
// In dispatch-subagent.ts (line 593-616):

// P2-FIX R2: Write per-dispatch context file BEFORE generating prompt
// to eliminate race condition. Replaces the old pre-write to session_map
// using parent session ID (which the child session couldn't read).
if (taskId) {
  try {
    // NEW: Per-dispatch context file (no overwrites)
    const ctxDir = path.join(DISPATCH_DIR, "ctx");
    fs.mkdirSync(ctxDir, { recursive: true });
    fs.writeFileSync(
      path.join(ctxDir, taskId + ".json"),
      JSON.stringify({
        dagTaskId: taskId,
        agentType,
        domainId,
        createdAt: Date.now(),
      }),
    );
  } catch (e) {
    writeLog("dispatch-subagent", "ERROR", {
      event: "DISPATCH_CTX_WRITE_ERROR",
      detail: `Failed to write per-dispatch ctx: ${e?.message ?? e}`,
    });
  }
}
```

---

### 3.6 Modified: `resolveDomainId()` in agent-resolver.ts (GAP-1)

Same `ctx/` directory scan pattern as `resolveTaskId()` (Section 3.2), applied to `resolveDomainId()` Priority 2 (lines 199-211):

```typescript
export function resolveDomainId(sessionId?: string): string | null {
  // Priority 1: session_map DB — unchanged
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.domain_id) return entry.domain_id;
    } catch {}
  }

  // Priority 2 (NEW): Per-dispatch context files (dagTaskId-keyed)
  // Replaces the shared .dispatch_ctx file read.
  try {
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    if (fs.existsSync(ctxDir)) {
      const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
      if (files.length === 1) {
        const ctx = JSON.parse(
          fs.readFileSync(path.join(ctxDir, files[0]), "utf8"),
        );
        if (ctx?.domainId) return ctx.domainId;
      }
      // Multiple: return newest by createdAt
      let newest: { domainId: string; createdAt: number } | null = null;
      for (const file of files) {
        try {
          const ctx = JSON.parse(
            fs.readFileSync(path.join(ctxDir, file), "utf8"),
          );
          if (ctx?.domainId && (!newest || ctx.createdAt > newest.createdAt)) {
            newest = ctx;
          }
        } catch {}
      }
      if (newest?.domainId) return newest.domainId;
    }
  } catch {}

  // Priority 3: .dispatch_ctx (legacy fallback) — unchanged
  try {
    const ctxPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx?.domainId) return ctx.domainId;
    }
  } catch {}
  return null;
}
```

### 3.7 Modified: `gate-core.ts` `armSession()` Fallback (GAP-2)

Insert `ctx/` directory scan before the existing `.dispatch_ctx` fallback in `armSession()` (around line 713):

```typescript
} else {
  // No taskId — fallback to ctx/ directory (per-dispatch, no race)
  const projectRoot = root || getProjectRoot();
  const ctxDir = path.join(projectRoot, '.task_temp', '_dispatch', 'ctx');
  try {
    if (fs.existsSync(ctxDir)) {
      const files = fs.readdirSync(ctxDir).filter(f => f.endsWith('.json'));
      if (files.length > 0) {
        const latest = files.reduce((a, b) => {
          const sa = fs.statSync(path.join(ctxDir, a));
          const sb = fs.statSync(path.join(ctxDir, b));
          return sa.mtimeMs > sb.mtimeMs ? a : b;
        });
        const ctx = JSON.parse(fs.readFileSync(path.join(ctxDir, latest), 'utf8'));
        if (ctx?.dagTaskId) {
          dispatchAssignedTaskIds = [ctx.dagTaskId];
          hasDispatchContext = true;
        }
      }
    }
  } catch { /* fall through */ }

  // Legacy: .dispatch_ctx (if ctx/ scan missed)
  if (!hasDispatchContext) {
    const dispatchCtxPath = path.join(projectRoot, '.task_temp', '_dispatch', '.dispatch_ctx');
    try {
      if (fs.existsSync(dispatchCtxPath)) {
        const ctx = JSON.parse(fs.readFileSync(dispatchCtxPath, 'utf8'));
        if (ctx?.dagTaskId) {
          dispatchAssignedTaskIds = [ctx.dagTaskId];
          hasDispatchContext = true;
        }
      }
    } catch { /* unreadable — fall through */ }
  }
}
```

### 3.8 Modified: `task-after.ts` Per-Dispatch Cleanup (GAP-3)

After reading `dagTaskId` from `.dispatch_ctx` or `ctx/`, clean up the specific per-dispatch file:

```typescript
// In task-after.ts toolExecuteAfter(), after L157:
if (dagTaskId) {
  // NEW: Clean up per-dispatch context file
  try {
    const perDispatchFile = path.join(
      root,
      ".task_temp",
      "_dispatch",
      "ctx",
      dagTaskId + ".json",
    );
    if (fs.existsSync(perDispatchFile)) fs.unlinkSync(perDispatchFile);
  } catch {}

  // Keep legacy deletion during Phase 1 dual-write
  // (existing fs.unlinkSync(dispatchCtxPath) at L156)
}
```

### 3.9 Modified: `compliance-gate.ts` `runGateCheck()` No-TaskId Fallback (GAP-4)

Insert `ctx/` directory scan between the existing DB check and `.dispatch_ctx` fallback (around line 808):

```typescript
} else {
  // No taskId provided — check ctx/ directory first (per-dispatch, no race)
  const ctxDir = path2.join(OPENCODE_ROOT, ".task_temp", "_dispatch", "ctx");
  let foundCtx = false;
  try {
    if (fs2.existsSync(ctxDir)) {
      const files = fs2.readdirSync(ctxDir).filter(f => f.endsWith(".json"));
      if (files.length > 0) {
        const latest = files.reduce((a: string, b: string) => {
          const sa = fs2.statSync(path2.join(ctxDir, a));
          const sb = fs2.statSync(path2.join(ctxDir, b));
          return sa.mtimeMs > sb.mtimeMs ? a : b;
        });
        const ctx = JSON.parse(fs2.readFileSync(path2.join(ctxDir, latest), "utf8"));
        if (ctx?.dagTaskId) {
          dispatchAssignedTaskIds = [ctx.dagTaskId];
          hasDispatchContext = true;
          foundCtx = true;
        }
      }
    }
  } catch { /* fall through */ }

  // Legacy: .dispatch_ctx (if ctx/ scan missed)
  if (!foundCtx) {
    const dispatchCtxPath = path2.join(OPENCODE_ROOT, ".task_temp", "_dispatch", ".dispatch_ctx");
    try {
      if (fs2.existsSync(dispatchCtxPath)) {
        const ctx = JSON.parse(fs2.readFileSync(dispatchCtxPath, "utf8"));
        if (ctx?.dagTaskId) {
          dispatchAssignedTaskIds = [ctx.dagTaskId];
          hasDispatchContext = true;
        }
      }
    } catch { /* .dispatch_ctx unreadable — fall through */ }
  }
}
```

### 3.10 Bug Fix: Field Name in CLI

**File**: `dispatch-subagent.ts` CLI (line 121)
**Change**: `ctx.dag_task_id` → `ctx.dagTaskId`

```typescript
// Line 121: Fix snake_case → camelCase to match writer
taskId = ctx.dagTaskId || null; // was: ctx.dag_task_id
```

---

## 4. Migration Path

### Phase 1 (Immediate): Dual-Write

- Write both per-dispatch `ctx/{dagTaskId}.json` AND legacy `.dispatch_ctx`
- New `resolveTaskId()` reads `ctx/` first, falls back to `.dispatch_ctx`
- Backward compatible with existing sessions

### Phase 2 (After N days): Read Migration

- All consumers stabilized on `ctx/` directory
- `.dispatch_ctx` kept as fallback only

### Phase 3 (After N weeks): Legacy Cleanup

- Remove `.dispatch_ctx` write
- Remove `.dispatch_ctx` read fallback
- Remove `_dispatch_target.json` read fallback

---

## 5. Files Changed

| File                          | Change                                                                                                             | Lines                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `agent-resolver.ts`           | Add `writeDispatchCtx()`, modify `resolveTaskId()` P2, modify `resolveDomainId()` P2                               | ~40 new, ~20 modified |
| `dispatch_subagent.ts` (tool) | Add per-dispatch ctx write, keep legacy `.dispatch_ctx` write                                                      | ~15 new               |
| `dispatch-subagent.ts` (CLI)  | Replace session_map pre-write with per-dispatch ctx write; fix `dag_task_id`→`dagTaskId` field name bug (line 121) | ~10 modified          |
| `compliance-gate.ts`          | Add self-registration in `runGateCheck()` + update no-taskId fallback to scan `ctx/`                               | ~20 new               |
| `task-after.ts`               | Add per-dispatch `ctx/{dagTaskId}.json` cleanup after consumption                                                  | ~10 new               |
| `gate-core.ts`                | Update `armSession()` fallback to scan `ctx/` before `.dispatch_ctx`                                               | ~8 modified           |

### 5.1 GAP-1: `resolveDomainId()` — Same Race Condition as `resolveTaskId()`

**File**: `agent-resolver.ts`, function `resolveDomainId()` (lines 183–214)

The fix plan's Section 3.2 only modifies `resolveTaskId()`'s Priority 2. The sister function `resolveDomainId()` has an identical `.dispatch_ctx` read at Priority 2 (lines 199–211) and must be updated with the same `ctx/` directory scan pattern.

**Impact**: After migration, `resolveTaskId()` will correctly return the latest task ID from `ctx/` directory, but `resolveDomainId()` will still read the shared `.dispatch_ctx` singleton — returning potentially wrong `domain_id` for UC7KS per-domain write enforcement (`checkUC7KSFileLevelDomain()` / M11 check).

**Fix**: Apply the same `ctx/` directory scan pattern to `resolveDomainId()` Priority 2 (reads `ctx.domainId` field).

### 5.2 GAP-2: `gate-core.ts` `armSession()` Fallback

**File**: `gate-core.ts`, function `armSession()` (lines 711–723)

When no explicit `taskId` is provided, `armSession()` falls back to reading `.dispatch_ctx`. Add `ctx/` directory scan as an intermediate priority between the existing DB check and the `.dispatch_ctx` fallback.

### 5.3 GAP-3: `task-after.ts` Per-Dispatch File Cleanup

**File**: `plugins/task-after.ts` (lines 148–156)

`task-after.ts` currently reads then deletes `.dispatch_ctx`. With per-dispatch `ctx/{dagTaskId}.json` files, the cleanup must:

- Delete the specific `ctx/{dagTaskId}.json` for the completed dispatch
- Keep legacy `fs.unlinkSync(dispatchCtxPath)` during Phase 1 dual-write
- Add janitor cleanup for stale `ctx/` files (>24h) in a background process

### 5.4 GAP-4: `compliance-gate.ts` `runGateCheck()` No-TaskId Fallback

**File**: `compliance-gate.ts`, function `runGateCheck()` (lines 808–826)

The self-registration fix (Section 3.4) handles the WRITE side, but the no-taskId fallback READ at lines 808–826 still reads the singleton `.dispatch_ctx`. Add `ctx/` directory scan as intermediate priority.

### 5.5 Bug Fix: Field Name Mismatch in CLI

**File**: `dispatch-subagent.ts` CLI (line 121)

The CLI reads `ctx.dag_task_id` (snake_case) but the writer writes `dagTaskId` (camelCase). Change to `ctx.dagTaskId` to match.

---

## 6. Verification

1. **Unit test**: Dispatch 3 identical sub-agents sequentially; verify each gets correct `dag_task_id` in `session_map`
2. **Integration test**: Full sequential dispatch pipeline; verify `compliance_gate_check` passes for all 3 sub-agents
3. **Backward compatibility**: Verify existing dispatches still work (dual-write ensures `.dispatch_ctx` still updated)
4. **Per-dispatch file cleanup**: Add cleanup to `task-after.ts` or a janitor process

---

## 7. Test Acceptance Criteria

> **Added**: 2026-06-19 by @Super-Admin as Phase 1 of IMPLEMENT-DISPATCH-CTX-FIX

### 7.1 Per-Dispatch Context Isolation

**Test**: Dispatch 3 Coder-BE sub-agents sequentially with different `dag_task_id` values (e.g., `TEST-A`, `TEST-B`, `TEST-C`).

**Expected Behavior**:

- Each dispatch writes its context to its own per-dispatch file: `ctx/TEST-A.json`, `ctx/TEST-B.json`, `ctx/TEST-C.json`
- No file is overwritten by a later dispatch
- Each file contains the correct `dagTaskId`, `agentType`, `domainId`, and `createdAt` fields

**Verification**:

```bash
ls .task_temp/_dispatch/ctx/
# Expected: TEST-A.json  TEST-B.json  TEST-C.json  (3 distinct files)
cat .task_temp/_dispatch/ctx/TEST-A.json
# Expected: {"dagTaskId":"TEST-A","agentType":"Coder-BE","domainId":"backend_api","createdAt":...}
```

**Gate**: `compliance_gate_check` called by each sub-agent accepts its respective `task_id` independently — no `DISPATCH-TASKID-TAMPER` rejections.

---

### 7.2 Concurrent Same-Agent No Cross-Contamination

**Test**: Dispatch 3 Coder-BE sub-agents concurrently (before any fires `chat.message`), each performing `config_read_attest` + a `safe_edit` write operation.

**Expected Behavior**:

- All 3 writes succeed without cross-contamination
- Each sub-agent's `resolveTaskId()` returns its OWN correct `dag_task_id` (not the last-dispatched one)
- `scope-before` log shows `(sessions map)` lookup for each distinct `sessionId`
- `session_map` DB contains 3 distinct entries, each with the correct `dag_task_id`

**Verification**:

```bash
# Check that scope-before logged per-session lookups
grep "sessions map" .task_temp/_logs/*/plugin-scope-before-runtime.log | wc -l
# Expected: >= 3 (one per sub-agent)

# Check session_map has all 3 entries
sqlite3 .opencode/state/session_log/session_map.db \
  "SELECT session_id, dag_task_id FROM session_map WHERE dag_task_id IN ('CONCURRENT-S1A','CONCURRENT-S1B','CONCURRENT-S1C');"
# Expected: 3 rows
```

---

### 7.3 Backward Compatibility — Legacy `.dispatch_ctx` Fallback

**Test**: An agent dispatched BEFORE this fix checks in (legacy `.dispatch_ctx` file only, no `ctx/` directory) attempts to complete its task.

**Expected Behavior**:

- `resolveTaskId()` Priority 3 reads the legacy `.dispatch_ctx` file when:
  1. Priority 1 (`session_map` DB) has no entry for this session
  2. Priority 2 (`ctx/` directory) is empty or non-existent
- `resolveDomainId()` follows the same Priority 3 fallback for `domainId`
- The legacy agent can still `compliance_gate_check` and complete

**Verification**:

```bash
# Simulate legacy environment (no ctx/ directory, only .dispatch_ctx)
rm -rf .task_temp/_dispatch/ctx/
echo '{"dagTaskId":"LEGACY-TASK","domainId":"backend_api","createdAt":1700000000000}' > .task_temp/_dispatch/.dispatch_ctx

# resolveTaskId should still return "LEGACY-TASK" via Priority 3
```

---

### 7.4 Logging Integration

**Test**: All `writeLog()` calls for dispatch context read, write, and fallback operations produce correct log entries.

**Expected Behavior**:

- **Write events**: `DISPATCH_CTX_WRITE` with `INFO` level when a per-dispatch `ctx/{dagTaskId}.json` is created
- **Read events**: `DISPATCH_CTX_READ` with `INFO` level when `resolveTaskId()` or `resolveDomainId()` reads from `ctx/`
- **Fallback events**: `DISPATCH_CTX_FALLBACK` with `WARN` level when legacy `.dispatch_ctx` is used as fallback
- **Error events**: `DISPATCH_CTX_WRITE_ERROR` or `DISPATCH_CTX_READ_ERROR` with `ERROR` level for failures

**Verification**:

```bash
grep "DISPATCH-CTX" .task_temp/_logs/*/plugin-*-runtime.log
# Expected output contains:
#   DISPATCH_CTX_WRITE (INFO) — per-dispatch file created
#   DISPATCH_CTX_READ  (INFO) — context resolved from ctx/
#   DISPATCH_CTX_FALLBACK (WARN) — .dispatch_ctx fallback used
```

---

### 7.5 framework-self-test.ts — Check 48 (NEW)

**Test**: Add Check 48 to `framework-self-test.ts` that validates the per-dispatch `ctx/` directory structure and file naming convention.

**Check 48 Specification**:

1. **Directory existence**: Verify `.task_temp/_dispatch/ctx/` directory exists (skip/`SKIP` if no dispatches have run yet — not an error)
2. **File naming convention**: All files in `ctx/` must match pattern `*.json` — no other extensions
3. **Required fields**: Each `ctx/*.json` must contain `dagTaskId` (string) and `createdAt` (number) fields
4. **No duplicate dagTaskIds**: No two files should have the same `dagTaskId` value
5. **Stale file detection**: Files with `createdAt` older than 24 hours are reported as `WARNING` (may indicate missing cleanup)
6. **Legacy `.dispatch_ctx` coexistence**: If both `ctx/` directory and `.dispatch_ctx` exist, report as `OK` (Phase 1 dual-write is normal)
7. **.dispatch_ctx ONLY scenario**: If `.dispatch_ctx` exists but `ctx/` is empty, report as `WARNING: Legacy .dispatch_ctx without per-dispatch ctx/ files`

**Verification**:

```bash
bun .opencode/scripts/framework-self-test.ts 2>&1 | grep "Check 48"
# Expected: "✅ Check 48: Dispatch Context Files (PASS)"
```
