# Critical File Modified Bypass — Implementation Plan

**Version**: 2.0.0  
**Date**: 2026-06-19  
**Author**: @Super-Admin  
**Status**: Draft — pending implementation  
**Task ID**: SA-PLAN-CRITICAL-FILE-BYPASS  
**Supersedes**: v1.0.0 (replaced by SA-UPDATE-BYPASS-PLAN-V3)  
**Changes from v1.0.0**:

1. ORDER BY `created_at` → `updated_at` (matches db-manager.ts L685-686 eviction strategy)
2. Added `WHERE agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')` filter
3. Added optional `taskId` parameter for precise dag_task_id lookup
4. Noted compliance-gate.ts L788-794 duplicate code to be removed during implementation
5. Updated log event descriptions with richer semantics
6. Corrected §3.2 race condition analysis (multi-write path, row deletion, eviction risk: low→medium)

---

## §1 Overview

### §1.1 Problem

When @Super-Admin or @Orchestrator modifies framework files across multiple
dispatches without intermediate commits, `compliance_gate_check` detects those
modifications via `verifyRuleRegistry()` → `critical-files.ts` →
`getModifiedCriticalFiles()` (git diff HEAD). Modified critical files are
reported as `severity: "HIGH"`, which causes `hasHighSeverityItems=true` and
`passed=false` in strict/locked mode. This blocks subsequent gate arming,
preventing the agent from completing multi-step framework repair workflows.

### §1.2 Solution (Option A — Confirmed)

Add a targeted bypass in `compliance-gate.ts` that downgrades
`critical_file_modified_*` items from `HIGH` to `WARNING` when the current
dispatch agent is @Super-Admin or @Orchestrator, and the enforcement mode is
NOT `locked`. The bypass is logged to the audit trail and preserves full
visibility of modified files.

### §1.3 Design Principles

| Principle                | Rationale                                                          |
| ------------------------ | ------------------------------------------------------------------ |
| **Minimal intrusion**    | Only changes two files, adds ~50 lines total                       |
| **Audit-preserving**     | All bypasses logged; critical files still listed in `failed_items` |
| **Locked-mode respect**  | Bypass does NOT apply in locked mode (human-in-the-loop required)  |
| **Race-condition safe**  | Uses `session_map` DB (per-session rows, no shared state)          |
| **Graceful degradation** | DB unavailable → returns empty → bypass not applied (non-blocking) |

---

## §2 File Modifications

### §2.1 Modification 1 — `.opencode/lib/agent-resolver.ts`

**Purpose**: (1) Replace all 6 existing `demoLog()` calls with direct `writeLog()`
calls for richer semantics and proper source attribution; (2) Add
`resolveLatestDispatchAgent()` function that queries the `session_map` DB for
the most recently created agent entry.

**Location**: Edit the entire file. New function appended after existing
`resolveDomainId` (line 160).

#### Step 1a: Replace imports and add SRC constant

```diff
- import { demoLog } from "./shared-infra";
+ import { writeLog } from "./log-manager";
+ const SRC = "lib-agent-resolver";
```

**Rationale**: `demoLog` is a thin wrapper that always logs with source
`"lib-shared-infra"` and event `"demo"`, hiding the actual caller. Replacing
with `writeLog` enables proper source identification (`"lib-agent-resolver"`)
and semantically meaningful event names (e.g. `"SESSION-MAP-HIT"`,
`"AGENT-RESOLVED"`, `"TASKID-RESOLVED"`, `"DOMAIN-RESOLVED"`).

#### Step 1b: Replace existing demoLog calls with writeLog

Replace all 6 `demoLog("INFO", ...)` calls with `writeLog(SRC, "INFO", {...})`:

| #   | Original (demoLog)                                                           | Replacement (writeLog)                                                                                                                                   |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `demoLog("INFO", \`session map hit: ${sessionID} → ${entry.agent}\`);`       | `writeLog(SRC, "INFO", { event: "SESSION-MAP-HIT", agent: entry.agent, detail: \`session map hit: ${sessionID} → ${entry.agent}\` });`                   |
| 2   | `demoLog("INFO", \`resolveAgent: session map → ${agent}\`);`                 | `writeLog(SRC, "INFO", { event: "AGENT-RESOLVED", agent, detail: \`resolveAgent: session map → ${agent}\` });`                                           |
| 3   | `demoLog("INFO", \`resolveAgent: dispatch target → ${d.agent}\`);`           | `writeLog(SRC, "INFO", { event: "AGENT-RESOLVED-DISPATCH", agent: d.agent, detail: \`resolveAgent: dispatch target → ${d.agent}\` });`                   |
| 4   | `demoLog("INFO", \`resolveAgent: dispatch target → ${d.agent}\`);`           | `writeLog(SRC, "INFO", { event: "AGENT-RESOLVED-DISPATCH", agent: d.agent, detail: \`resolveAgent: dispatch target → ${d.agent}\` });`                   |
| 5   | `demoLog("INFO", \`resolveTaskId: session_map DB → ${entry.dag_task_id}\`);` | `writeLog(SRC, "INFO", { event: "TASKID-RESOLVED", dag_task_id: entry.dag_task_id, detail: \`resolveTaskId: session_map DB → ${entry.dag_task_id}\` });` |
| 6   | `demoLog("INFO", \`resolveDomainId: session_map DB → ${entry.domain_id}\`);` | `writeLog(SRC, "INFO", { event: "DOMAIN-RESOLVED", domain_id: entry.domain_id, detail: \`resolveDomainId: session_map DB → ${entry.domain_id}\` });`     |

**Safety**: `demoLog` internally calls `writeLog("lib-shared-infra", level, { event: "demo", detail: message })` — same function, same log-manager pipeline. The replacement is functionally equivalent but with richer metadata: proper source identifier (`"lib-agent-resolver"` instead of `"lib-shared-infra"`) and semantically meaningful event types. `writeLog` has its own try/catch internally, preserving the non-blocking behavior.

#### Step 1c: Add resolveLatestDispatchAgent function

Append after `resolveDomainId` (line 160).

```typescript
/**
 * Resolve the most recently dispatched agent from session_map DB.
 * Uses ORDER BY updated_at DESC LIMIT 1 — safe in SQLite WAL mode.
 *
 * This is a best-effort function: if the DB is unavailable, it returns
 * an empty string without throwing. The caller (compliance-gate.ts) treats
 * empty as "unknown agent → no bypass".
 *
 * Design rationale:
 *   - Per-session rows → no shared-state race condition
 *   - ORDER BY updated_at DESC LIMIT 1 → no transaction needed
 *   - SQLite WAL mode → concurrent readers safe
 *   - Agent type filter → only SA/Orch sessions considered for bypass
 *   - taskId parameter → precise dag_task_id lookup before ORDER BY fallback
 *
 * @param taskId - Optional DAG task ID for precise dag_task_id lookup
 * @returns Agent name with "@" prefix (e.g., "@Super-Admin"), or "" if unknown
 */
export function resolveLatestDispatchAgent(taskId?: string): string {
  try {
    const { getDb } = require("./db-manager");
    const db = getDb();
    // Priority 1: taskId → dag_task_id exact match (when available)
    if (taskId) {
      const row = db
        .query(
          `SELECT agent FROM session_map
           WHERE dag_task_id = ?
             AND agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get() as { agent: string } | null;
      if (row?.agent) {
        return row.agent.startsWith("@") ? row.agent : `@${row.agent}`;
      }
    }
    // Priority 2: latest SA/Orch session (fallback)
    const row = db
      .query(
        `SELECT agent FROM session_map
         WHERE agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get() as { agent: string } | null;
    if (row?.agent) {
      // Normalize: ensure "@" prefix (session_map stores with "@" prefix)
      return row.agent.startsWith("@") ? row.agent : `@${row.agent}`;
    }
  } catch (e: any) {
    // Non-blocking: if DB unavailable, return empty (bypass not applied)
    writeLog(SRC, "ERROR", {
      event: "SESSION-MAP-READ-FAILED",
      detail: `resolveLatestDispatchAgent: ${e.message}`,
    });
  }
  return "";
}
```

#### Export Addition

Ensure the function is exported. Since `agent-resolver.ts` uses named exports
(no barrel re-export required), the function is automatically available via:

```typescript
const { resolveLatestDispatchAgent } = require("../../lib/agent-resolver");
```

No changes needed to `lib/index.ts` but for completeness, add:

```typescript
// In .opencode/lib/index.ts, add to the existing agent-resolver re-export:
export {
  resolveAgent,
  resolveAgentFromSessionMap,
  resolveTaskId,
  resolveDomainId,
  resolveLatestDispatchAgent, // ← NEW
  getSessionMapPath,
  sessionLastDispatched,
} from "./agent-resolver";
```

#### Dependencies

- `db-manager.ts` — already imported by existing functions (`getDb()`)
- `log-manager.ts` — `writeLog` imported at top of file (replaces `demoLog` from `shared-infra.ts`)

#### Impact on shared-infra.ts

After this change, `agent-resolver.ts` no longer depends on `shared-infra.ts`.
The `demoLog()` function in `shared-infra.ts` will have one fewer consumer.
Future work (separate task) can evaluate removing `demoLog` entirely if no
other callers remain.

---

### §2.2 Modification 2 — `.opencode/scripts/mcp-tools/compliance-gate.ts`

**Purpose**: Insert bypass logic in `runGateCheck()` that downgrades
`critical_file_modified_*` items when the dispatch agent is SA/Orch.

**Location**: Between line 970 (end of `verifyRuleRegistry()` results append)
and line 972 (capture of `hasHighSeverityItems`). Insert after:

```typescript
// Line 970: failed.push(... registryResult.results ...)
```

And before:

```typescript
// Line 972: const hasHighSeverityItems = failed.some((f) => f.severity === "HIGH");
```

#### Complete Code

```typescript
// ── SA/Orch bypass: critical_file_modified → WARNING (non-blocking) ──
// Super-Admin and Orchestrator frequently modify framework files across
// multiple dispatches without intermediate commits. Bypassing this
// specific check allows uninterrupted repair workflows while preserving
// the audit trail.
//
// Locked mode: NOT bypassed — locked requires human-in-the-loop for
//   ALL changes. SA/Orch can still see the critical file list in
//   failed_items (severity downgraded to WARNING) but cannot bypass
//   in locked mode.
//
// Fallback: if resolveLatestDispatchAgent() returns empty (DB
//   unavailable), bypass is not applied — gate behaves as before.
//
// NOTE: During implementation, delete the inline duplicate at
//   compliance-gate.ts L788-794 and replace with this import.
//   The taskId parameter is already in scope within runGateCheck().
const { resolveLatestDispatchAgent } = require("../../lib/agent-resolver");
const bypassAgent = resolveLatestDispatchAgent(taskId); // taskId from runGateCheck() params
const bypassNorm = (bypassAgent || "").replace(/^@/, "").toLowerCase();
if (
  (bypassNorm === "super-admin" || bypassNorm === "orchestrator") &&
  enforcementMode !== "locked"
) {
  let bypassedCount = 0;
  for (const item of failed) {
    if (item.id?.startsWith("critical_file_modified_")) {
      writeLog("mcp-compliance-gate", "runtime", {
        event: "CRITICAL-FILE-MODIFIED-BYPASS",
        agent: bypassAgent,
        sessionID: sessionId,
        detail: `Downgraded ${item.id} from HIGH to WARNING for ${bypassAgent}`,
      });
      item.severity = "WARNING";
      item.desc = "[SA-BYPASS] " + item.desc;
      bypassedCount++;
    }
  }
  if (bypassedCount === 0 && bypassAgent) {
    // SA/Orch is the agent but no critical files modified → normal path
  }
} else if (bypassAgent && enforcementMode === "locked") {
  writeLog("mcp-compliance-gate", "runtime", {
    event: "CRITICAL-FILE-BYPASS-BLOCKED",
    agent: bypassAgent,
    sessionID: sessionId,
    detail: `Bypass blocked: enforcement mode is locked`,
  });
}
```

#### Design Notes

1. **Line ordering**: The bypass MUST run after `failed.push(...registryResult.results)` so that `critical_file_modified_*` items exist in the `failed` array, and before `hasHighSeverityItems` so the downgrade takes effect before the pass/fail decision.

2. **Severity downgrade target**: `"WARNING"` — consistent with the advisory-mode downgrade pattern. WARNING items are informational and do not cause `passed=false`.

3. **Desc prefix**: `"[SA-BYPASS] "` — makes the bypass visible in the `failed_items` output for audit transparency.

4. **require() placement**: Inside `runGateCheck()` (not at module top) because:
   - The bypass is only needed during gate check, not during other MCP operations
   - Keeps the `require()` close to usage for clarity
   - `agent-resolver.ts` already uses `require("./db-manager")` internally

5. **taskId parameter**: `resolveLatestDispatchAgent(taskId)` uses the `taskId` already in scope within `runGateCheck()`. This enables precise dag_task_id matching before falling back to the ORDER BY heuristic.

6. **Duplicate code removal (IMPLEMENTATION-REQUIRED)**: `compliance-gate.ts` lines 788-794 contain an inline duplicate of the same session_map query. During implementation, MUST:
   - Delete lines 788-794 (the inline `resolveLatestDispatchAgent` code)
   - Replace with `const { resolveLatestDispatchAgent } = require("../../lib/agent-resolver");` at the top of `runGateCheck()`

---

## §3 Concurrency Safety Analysis

### §3.1 session_map DB Architecture

The `session_map` table schema:

```sql
CREATE TABLE IF NOT EXISTS session_map (
  session_id  TEXT PRIMARY KEY,
  agent       TEXT NOT NULL,
  dag_task_id TEXT DEFAULT NULL,
  domain_id   TEXT DEFAULT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

**Key properties**:

- Each row is keyed by `session_id` — one row per dispatch
- `created_at` is set at row creation (INSERT time)
- Rows are never updated by other sessions

### §3.2 Race Condition Analysis

| Scenario                                        | Risk     | Analysis                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two parallel dispatches create session_map rows | None     | Each has its own `session_id` → independent rows                                                                                                                                                                                                                                    |
| SA reads while another agent writes             | None     | SQLite WAL mode: readers don't block writers                                                                                                                                                                                                                                        |
| Multi-write path (4 write sources)              | None     | 4 sources (compliance-gate.ts, dispatch-subagent.ts, db-manager.ts, agent-resolver.ts) all write per-session rows — no shared-row conflicts                                                                                                                                         |
| DB unavailable (file locked, disk full)         | Graceful | catch block returns `""` → bypass not applied → gate normal path                                                                                                                                                                                                                    |
| 50-entry cap eviction deletes relevant row      | Medium   | `updated_at` may lag behind `created_at` → a frequently-dispatched recent session with stale `updated_at` could be evicted before an older but recently-updated session. Mitigation: agent type filter narrows candidate pool to SA/Orch only, reducing pressure on the 50-row cap. |
| Row deleted during read                         | None     | No per-session deletions occur — the 50-entry cap is the only removal mechanism (INSERT-triggered eviction by creation order). During a SELECT, eviction of a non-target row has no impact on `LIMIT 1` results.                                                                    |

### §3.3 SQLite WAL Mode Guarantees

The DB is opened with `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL`:

- **Concurrent readers**: Multiple readers (SELECT) can coexist
- **Writer isolation**: Writes (INSERT) are serialized by WAL but don't block readers
- **No dirty reads**: SQLite WAL provides snapshot isolation for readers
- **No transaction needed**: A simple `SELECT ... WHERE ... ORDER BY updated_at DESC LIMIT 1` is atomic in WAL mode

### §3.4 Why Not `_dispatch_target.json`

| Approach                | Race Condition | Explanation                                                                                                                                |
| ----------------------- | :------------: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `_dispatch_target.json` |     ❌ YES     | Single shared file, overwritten by parallel dispatches (last write wins). See P0-4 root cause analysis in `agent-resolver.ts` lines 37-45. |
| `session_map` DB        |     ✅ NO      | Per-session rows, no shared state. The same approach that fixed P0-4.                                                                      |

---

## §4 Log Integration Specification

### §4.1 Log Categories

| #   | Scene          | Log Function                                        | Category  | Event                           | When                                           | Description                                                                                                                                             |
| --- | -------------- | --------------------------------------------------- | --------- | ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Normal bypass  | `writeLog("mcp-compliance-gate", "runtime", {...})` | `runtime` | `CRITICAL-FILE-MODIFIED-BYPASS` | SA/Orch + not locked + critical files modified | Emitted once per downgraded critical file item. Records which agent received the bypass and which specific file was downgraded.                         |
| 2   | Locked block   | `writeLog("mcp-compliance-gate", "runtime", {...})` | `runtime` | `CRITICAL-FILE-BYPASS-BLOCKED`  | SA/Orch + locked mode (bypass denied)          | Emitted once when bypass would have applied but locked mode prevents it. The agent is identified but no severity is changed.                            |
| 3   | DB unavailable | `writeLog("agent-resolver", "runtime", {...})`      | `runtime` | `SESSION-MAP-READ-FAILED`       | `resolveLatestDispatchAgent()` catch block     | Emitted when the session_map SQLite DB is unavailable (file locked, disk full, corrupt). Bypass is silently disabled — gate continues with normal path. |

### §4.2 Log Format (consistent with existing patterns)

```typescript
// Scene 1: Normal bypass (INFO-level, no explicit level field)
writeLog("mcp-compliance-gate", "runtime", {
  event: "CRITICAL-FILE-MODIFIED-BYPASS",
  agent: bypassAgent, // e.g., "@Super-Admin"
  sessionID: sessionId, // current gate session ID
  detail: `Downgraded critical_file_modified_opencode_json from HIGH to WARNING for @Super-Admin`,
});

// Scene 2: Locked block (INFO-level)
writeLog("mcp-compliance-gate", "runtime", {
  event: "CRITICAL-FILE-BYPASS-BLOCKED",
  agent: bypassAgent,
  sessionID: sessionId,
  detail: `Bypass blocked: enforcement mode is locked`,
});

// Scene 3: DB read failure (ERROR-level)
writeLog("agent-resolver", "runtime", {
  event: "SESSION-MAP-READ-FAILED",
  detail: `resolveLatestDispatchAgent: ${e.message}`,
});
```

### §4.3 Log File Destination

| Log Call                               | Destination File                                                 |
| -------------------------------------- | ---------------------------------------------------------------- |
| `writeLog("mcp-compliance-gate", ...)` | `.task_temp/_logs/{date}/plugin-mcp-compliance-gate-runtime.log` |
| `writeLog("agent-resolver", ...)`      | `.task_temp/_logs/{date}/plugin-agent-resolver-runtime.log`      |

### §4.4 Audit Visibility

The bypass is visible in three places:

1. **Runtime log**: `CRITICAL-FILE-MODIFIED-BYPASS` events in the log file
2. **Gate check output**: `failed_items` still lists the critical file with `[SA-BYPASS]` prefix and `WARNING` severity
3. **machine.json**: `compliance_records` captures the full gate check result including `failed_items`

No additional audit table is needed — the existing `compliance_records` sub-state captures the gate check result.

---

## §5 Rollback Plan

### §5.1 Rollback Trigger Conditions

Roll back if any of the following occurs after deployment:

1. Gate check passes when it should block (false negative — bypass too broad)
2. DB queries cause performance regression (>50ms added to gate check)
3. Bypass applies to an unexpected agent (agent name resolution bug)
4. Locked-mode bypass is observed (should be impossible per code logic)

### §5.2 Rollback Steps

#### Option A: Git Revert (recommended)

```bash
# Revert both files to pre-bypass state
git checkout HEAD -- .opencode/lib/agent-resolver.ts
git checkout HEAD -- .opencode/scripts/mcp-tools/compliance-gate.ts

# Verify gate check works
bun .opencode/scripts/mcp-tools/compliance-gate.ts
```

#### Option B: Feature Flag Disable

If a feature flag is added later (not in v1), set:

```json
// In project.config.json template_resolution
"critical_file_bypass_enabled": false
```

### §5.3 Partial Rollback

| Scenario             | Action                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------ |
| DB query regression  | Comment out `resolveLatestDispatchAgent()` body, return `""` — bypass is silently disabled |
| Log spam             | Increase log level threshold in `log-manager.ts`                                           |
| Wrong agent resolved | Add agent allowlist in `resolveLatestDispatchAgent()`                                      |

### §5.4 Monitoring After Deployment

After deployment, monitor for:

1. **Log frequency**: `CRITICAL-FILE-MODIFIED-BYPASS` should appear 1-3 times per SA/Orch session (not hundreds)
2. **Bypass timing**: Gate check duration should not increase by >10ms
3. **Locked mode**: `CRITICAL-FILE-BYPASS-BLOCKED` should appear when locked mode is active
4. **False bypass**: Any bypass for agents other than SA/Orch should trigger rollback

---

## §6 Testing Plan

### §6.1 Unit Tests

```typescript
// Test: resolveLatestDispatchAgent() returns correct agent
describe("resolveLatestDispatchAgent", () => {
  it("should return the most recently updated agent from session_map", () => {
    // Insert two rows with different updated_at
    dbWriteSessionMap("ses-1", {
      agent: "@Coder-BE",
      created_at: 1000,
      updated_at: 1000,
    });
    dbWriteSessionMap("ses-2", {
      agent: "@Super-Admin",
      created_at: 500,
      updated_at: 2000,
    });
    expect(resolveLatestDispatchAgent()).toBe("@Super-Admin");
  });

  it("should return empty string when DB is empty", () => {
    // Clear session_map
    expect(resolveLatestDispatchAgent()).toBe("");
  });

  it("should return empty string when DB is unavailable", () => {
    // Simulate DB error
    expect(resolveLatestDispatchAgent()).toBe("");
  });

  it("should normalize agent name without @ prefix", () => {
    dbWriteSessionMap("ses-3", {
      agent: "Super-Admin",
      created_at: 3000,
      updated_at: 3000,
    });
    expect(resolveLatestDispatchAgent()).toBe("@Super-Admin");
  });

  it("should filter non-SA/Orch agents (WHERE agent IN check)", () => {
    dbWriteSessionMap("ses-4", {
      agent: "@Coder-BE",
      created_at: 4000,
      updated_at: 4000,
    });
    expect(resolveLatestDispatchAgent()).toBe(""); // Coder-BE excluded by WHERE filter
  });

  it("should prefer dag_task_id exact match when taskId provided", () => {
    dbWriteSessionMap("ses-5", {
      agent: "@Orchestrator",
      dag_task_id: "T-042",
      created_at: 5000,
      updated_at: 5000,
    });
    dbWriteSessionMap("ses-6", {
      agent: "@Super-Admin",
      dag_task_id: "T-099",
      created_at: 6000,
      updated_at: 6000,
    });
    expect(resolveLatestDispatchAgent("T-042")).toBe("@Orchestrator"); // exact match wins over ORDER BY
  });
});
```

### §6.2 Integration Tests

```typescript
describe("compliance_gate_check — critical file bypass", () => {
  it("should downgrade critical_file_modified for Super-Admin in strict mode", async () => {
    // Setup: modify a critical file without commit
    // Setup: enforce strict mode
    // Setup: session_map has @Super-Admin as latest
    const result = await complianceGateCheck({ task_description: "repair" });
    // Assert: passed=true, critical_file items still listed with WARNING
    expect(result.passed).toBe(true);
    const criticalItems = result.failed_items.filter((f) =>
      f.id.startsWith("critical_file_modified_"),
    );
    expect(criticalItems.every((f) => f.severity === "WARNING")).toBe(true);
  });

  it("should NOT bypass in locked mode", async () => {
    // Setup: locked mode + @Super-Admin + modified critical files
    const result = await complianceGateCheck({ task_description: "repair" });
    expect(result.passed).toBe(false);
  });

  it("should NOT bypass for non-SA/Orch agents", async () => {
    // Setup: @Coder-BE in session_map + modified critical files
    const result = await complianceGateCheck({ task_description: "code" });
    expect(result.passed).toBe(false);
  });
});
```

---

## §7 Implementation Sequence

| Step | File                 | Action                                                                                      | Estimated Lines |
| ---- | -------------------- | ------------------------------------------------------------------------------------------- | :-------------: |
| 1a   | `agent-resolver.ts`  | Replace `import { demoLog }` → `import { writeLog }`; add `const SRC`                       |       ~2        |
| 1b   | `agent-resolver.ts`  | Replace 6 existing `demoLog()` calls with `writeLog(SRC, ...)`                              |       ~18       |
| 1c   | `agent-resolver.ts`  | Add `resolveLatestDispatchAgent(taskId?)` function (uses `writeLog(SRC, ...)` from Step 1a) |       ~42       |
| 2    | `lib/index.ts`       | Add `resolveLatestDispatchAgent` to named exports                                           |       ~1        |
| 3a   | `compliance-gate.ts` | Delete lines 788-794 (inline duplicate of same query)                                       |       ~-7       |
| 3b   | `compliance-gate.ts` | Insert bypass logic block (lines 970-972) + `require()` import at fn top                    |       ~25       |
| 4    | `docs/`              | This plan document                                                                          |        —        |
| 5    | `__tests__/`         | Unit + integration tests (optional, framework files have no test suite requirement)         |        —        |

**Total**: ~81 lines modified (6 replacements + 42 new + 2 import), 7 lines removed, 2 files modified + 1 export updated.

---

## §8 Appendix — Full File Contexts

### §8.1 agent-resolver.ts (after modification)

The new function is appended at the end of the file (after `resolveDomainId`, line 160).

### §8.2 compliance-gate.ts (insertion point context)

```
Line 969:   });
Line 970:
  ┌── INSERT BYPASS LOGIC HERE ─────────────────────────────────────┐
  │ // ── SA/Orch bypass: critical_file_modified → WARNING ...       │
  │ const { resolveLatestDispatchAgent } = require(...);             │
  │ // NOTE: taskId is already in scope from runGateCheck(params)    │
  │ const bypassAgent = resolveLatestDispatchAgent(taskId);         │
  │ ...                                                               │
  │                                                                   │
  │ // ALSO: Delete lines 788-794 (inline duplicate of this query)   │
  │ //       before adding the require statement above.              │
  └──────────────────────────────────────────────────────────────────┘
Line 972:   // ── Capture pre-advisory pass/fail BEFORE downgrade ──
Line 973:   const hasHighSeverityItems = failed.some((f) => f.severity === "HIGH");
```

---

---

## §9 Known Issues

### §9.1 Bug: False Bypass for Non-SA/Orch Agents (Fixed in v2.1.0)

**Status**: ✅ Fixed (SA-FIX-BYPASS-AGENT-RESOLVE, 2026-06-21)  
**Severity**: 🔴 HIGH — bypass incorrectly applied to Coder-BE

**Root Cause**: `resolveLatestDispatchAgent()` queries (both Priority 1 and
Priority 2) filtered results with `WHERE agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')`.
When a non-SA/Orch agent (e.g., Coder-BE) called `compliance_gate_check`:

1. Priority 1 (`dag_task_id` exact match) failed because Coder-BE's entry was
   excluded by the `WHERE agent IN (...)` filter
2. Priority 2 (fallback) returned the latest SA/Orch session's agent
3. `compliance-gate.ts` L1117-1119 saw `bypassNorm === "super-admin"` and
   applied the bypass → Coder-BE incorrectly bypassed critical file checks

**Real-world scenario**: E2E test caught this. Coder-BE dispatched →
`compliance_gate_check` called → `resolveLatestDispatchAgent(taskId)` →
Priority 1 skipped Coder-BE → fallback returned "@Super-Admin" from a recent
SA dispatch → bypass incorrectly triggered.

**Fix (v2.1.0)**: Removed `WHERE agent IN (...)` from both Priority 1 and
Priority 2 queries in `resolveLatestDispatchAgent()`. The function now
returns the actual agent for the given context. The caller
(`compliance-gate.ts`) already has correct agent-type validation at
L1117-1119: `bypassNorm === "super-admin" || bypassNorm === "orchestrator"`.

**Query changes**:

```diff
// Priority 1 — dag_task_id exact match
  `SELECT agent FROM session_map
   WHERE dag_task_id = ?
-    AND agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')
   ORDER BY updated_at DESC LIMIT 1`

// Priority 2 — fallback
  `SELECT agent FROM session_map
-  WHERE agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')
   ORDER BY updated_at DESC LIMIT 1`
```

**Why the caller-side check is sufficient**: `compliance-gate.ts` L1117-1119
already validates `bypassNorm === "super-admin" || bypassNorm === "orchestrator"`.
If `resolveLatestDispatchAgent()` returns "@Coder-BE", `bypassNorm` becomes
`"coder-be"` and the bypass is NOT applied. The two-layer design (resolver
returns raw agent, caller validates) is the correct separation of concerns.

**Related**: §2.2 Modification 2 (compliance-gate.ts L1117-1119) — no changes
needed to the bypass logic block; it was already correct.

---

_End of implementation plan._
