# P0-6/P0-7: Agent Identity Propagation — Implementation Plan

**Created**: 2026-06-12
**Author**: @Super-Admin
**Priority**: P0 (CRITICAL) — Phase 0 prerequisite for all other enforcement
**Status**: Planned — awaiting execution
**Related**: `docs/review/plugin-backlog/priority.md` (P0-6, P0-7 entries)

---

## §1 Problem Statement

When a primary agent calls `Task()` to spawn a sub-agent, the sub-agent process starts with **no identity information**. Three critical readers depend on `.task_temp/_dispatch_target.json` for agent resolution, but **no active code writes this file**:

| Reader | Location | Reads | Effect When Missing |
|:--|:--|:--|:--|
| `agent-resolver.ts` | L32-46 (priority 1) | `d.agent`, `d.run_id` | Returns `""` for sub-agents |
| `compliance-gate.ts` | L996-1016, L1779 | `d.agent`, `d.run_id` | Gate sessions lack agent identity |
| `pre-execution-gate.ts` | L319-339 (`readDispatchTargetAgent()`) | `d.agent`, `d.run_id` | DAG gate falls back to `process.env.AGENT` = `"1"` |

The write logic existed in the archived monolithic `enforce.ts` (L932-983 write, L1670-1686 cleanup) but was **never migrated** during plugin decomposition.

### Expected Schema (from all 3 readers)

```json
{
  "agent": "@Coder-BE",
  "task_id": "T-001",
  "run_id": "<OPENCODE_RUN_ID uuid>",
  "timestamp": "2026-06-12T08:00:00.000Z"
}
```

All three readers validate `d.run_id` against `process.env.OPENCODE_RUN_ID` — if mismatch, the file is deleted and treated as stale.

---

## §2 Framework Compliance Matrix

### §2.1 Layout Architecture System

**Requirement**: `.opencode/plugins/*.ts` files are auto-discovered. Shared code in `.opencode/lib/`.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-6 writes to `.task_temp/` (not `.opencode/plugins/`) | ✅ | No layout violation — runtime data, not plugin code |
| P0-7 cleanup same directory | ✅ | Same |
| No new plugin files created | ✅ | Modifies existing `dispatch-before.ts` and `dispatch-after.ts` |
| Shared code imports from `../lib/` | ✅ | Uses `agent-resolver.ts` (already imported) |

**Source**: `docs/official_docs/opencode/findings/04-layout-architecture.md`

### §2.2 Permission Matrix System

**Requirement**: Agent write scopes enforced by `scope-before.ts` via `isWriteAllowed()`.

| Check | Status | Notes |
|:--|:--:|:--|
| `.task_temp/_dispatch_target.json` in any agent's write scope? | ✅ | `.task_temp/` is a framework runtime directory, not business code |
| Tool scope: `tool.execute.before` on `Task` tool | ✅ | Plugin hook fires for ALL tools; we filter `isTask` early |
| No permission escalation | ✅ | We only write a small JSON file, not modifying configs |

**Source**: `docs/official_docs/opencode/findings/03-permission-matrix.md`

### §2.3 Concurrent Session/Dispatch Write System

**Requirement**: `.pending.json` queue is the dispatch proof. MANDATORY-DISPATCH enforces queue consumption.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-6 write location: AFTER queue consumption (L196) | ✅ | Write happens only when dispatch was legitimate |
| Race condition: parallel dispatch | ⚠️ | See §5.1 analysis below |
| P0-7 cleanup: AFTER sub-agent completes | ✅ | `tool.execute.after` fires after Task() returns |
| Idempotency: callID guard | ✅ | Same guard as MANDATORY-DISPATCH (L94) |

**Race condition analysis** (§5.1): The `tool.execute.before` hook fires **synchronously** per `Task()` call. OpenCode processes Task() calls sequentially within a session. The sub-agent process starts and reads `_dispatch_target.json` before the next dispatch fires. Therefore, parallel dispatch of two sub-agents is safe — the second write overwrites the first, but the first sub-agent has already read the file.

**Source**: `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.4 Hardened Enforcement System

**Requirement**: All enforcement checks must use `getEnforcementMode()` from `gate-core.ts`.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-6 write: enforcement mode aware? | N/A | Write always happens (identity is needed regardless of mode) |
| P0-7 cleanup: enforcement mode aware? | N/A | Cleanup always happens (stale file prevention) |
| `getEnforcementMode()` imported | ✅ | Already imported at `dispatch-before.ts` L11 |
| Mode logged in writeLog | ✅ | `mode` variable available from L28 |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`

### §2.5 Harness System

**Requirement**: Plugins use `export default`, hooks defined locally, no imported function references in return.

| Check | Status | Notes |
|:--|:--:|:--|
| `export default` pattern preserved | ✅ | Both files already use it |
| Hook functions defined locally | ✅ | `toolExecuteBefore` / `toolExecuteAfter` defined in-file |
| No new hooks registered | ✅ | We add logic inside existing hook handlers |
| Bun cache: no cross-plugin import risk | ✅ | Imports from `../lib/` (not plugin scan path) |

**Source**: `docs/official_docs/framework/plugin-programming-conventions.md`, `docs/official_docs/opencode/findings/02-harness-system.md`

### §2.6 Central State Management

**Requirement**: `machine.json` is the single source of truth. State writes must be atomic.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-6 writes to `machine.json`? | ❌ No | Writes to separate file `_dispatch_target.json` |
| P0-7 modifies `machine.json`? | ❌ No | Deletes `_dispatch_target.json` |
| State file conflicts? | ✅ None | Separate file, no contention with machine.json writers |
| Atomicity: `writeFileSync` with JSON.stringify | ✅ | Single atomic write, no partial state |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`

### §2.7 Multi-Agent System

**Requirement**: Sub-agents invoked via `Task()` tool. Agent identity flows through `_dispatch_target.json` (v4.0.0 replacement for `FRAMEWORK_AGENT`).

| Check | Status | Notes |
|:--|:--:|:--|
| Agent name format: `"@" + agentType` | ✅ | Matches all 3 readers' expectations |
| `run_id` from `OPENCODE_RUN_ID` | ✅ | Required for staleness check |
| `task_id` from `resolveTaskId()` | ✅ | Already imported at L10 |
| Sub-agent lifecycle: write before, cleanup after | ✅ | Matches old `enforce.ts` pattern |

**Key insight from cached docs**: `FRAMEWORK_AGENT` env var was **removed** from `dispatch-subagent.ts` (L110 comment: "Identity propagated via TASK-IDENTITY in plugin toolExecuteBefore (v4.2.0)"). But the TASK-IDENTITY write was in old `enforce.ts` which was never migrated. This plan closes that gap.

**Source**: `docs/official_docs/opencode/source-analysis/agent-identity-plugin-hooks.md`, `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.8 Log Central Management System

**Requirement**: Plugins use `writeLog()` from `log-manager.ts` with category `"loaded"`, `"hooks"`, or `"runtime"`.

| Check | Status | Notes |
|:--|:--:|:--|
| `writeLog()` already imported | ✅ | Both files import at L5-9 |
| Category: `"runtime"` for hook logic | ✅ | All existing writeLog calls use `"runtime"` |
| Fields include `sessionID`, `callID`, `agent`, `agentType` | ✅ | Standard pattern used throughout |
| Log detail includes action + context | ✅ | `TASK-IDENTITY: wrote @AgentType` format |

**Source**: `docs/official_docs/opencode/findings/01-log-central-management.md`

### §2.9 Templatization & Parameterization System

**Requirement**: No hardcoded paths; use `process.env.OPENCODE_ROOT` for project root resolution.

| Check | Status | Notes |
|:--|:--:|:--|
| Path resolution uses `OPENCODE_ROOT` | ✅ | `process.env.OPENCODE_ROOT \|\| "."` pattern |
| No hardcoded absolute paths | ✅ | Relative path `.task_temp/_dispatch_target.json` |
| Agent type normalized (`@` prefix) | ✅ | `"@" + reqType.replace(/^@/, "")` |

**Source**: `docs/official_docs/opencode/findings/04-layout-architecture.md`

---

## §3 Implementation Specification

### §3.1 P0-6: Write `_dispatch_target.json` in `dispatch-before.ts`

**Insertion point**: After L197 (`sessionLastDispatched.set(input.callID, ...)`) and before L198 (`writeLog("dispatch-before", ...)`).

**Code** (~25 lines):

```typescript
        // ═══════════════════════════════════════════════════════════════
        // P0-6 TASK-IDENTITY: Write _dispatch_target.json for sub-agent
        // identity propagation. Sub-agent processes start with no agent
        // info (AGENT=1 boolean only). This file bridges the gap:
        //   agent-resolver.ts (priority 1) reads it on startup
        //   compliance-gate.ts reads it for gate session attribution
        //   pre-execution-gate.ts reads it for DAG gate identity
        //
        // Schema: { agent, task_id, run_id, timestamp }
        // Staleness: readers check run_id against OPENCODE_RUN_ID
        // Cleanup: P0-7 in dispatch-after.ts deletes after Task() returns
        // ═══════════════════════════════════════════════════════════════
        try {
          const dtPath = path.join(root, ".task_temp", "_dispatch_target.json");
          const dtDir = path.dirname(dtPath);
          if (!fs.existsSync(dtDir)) fs.mkdirSync(dtDir, { recursive: true });
          fs.writeFileSync(
            dtPath,
            JSON.stringify(
              {
                agent: "@" + reqType.replace(/^@/, ""),
                task_id: consumed.dagTaskId || resolveTaskId() || null,
                run_id: process.env.OPENCODE_RUN_ID || "",
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
            "utf8",
          );
          writeLog("dispatch-before", "runtime", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            event: "TOOL-BEFORE",
            detail: `TASK-IDENTITY: wrote _dispatch_target.json → @${reqType.replace(/^@/, "")} (caller: ${agent})`,
          });
        } catch (e: any) {
          writeLog("dispatch-before", "runtime", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            level: "WARN",
            event: "TOOL-BEFORE",
            detail: `TASK-IDENTITY: write failed: ${e.message}`,
          });
        }
```

**Why this insertion point**: After queue consumption (L193-195) proves the dispatch was legitimate, and after session tracking (L196-197), but before the G-09 recursion guard (L203+). The identity file must exist before the sub-agent process starts.

**Why `root` variable**: Already defined at L47 (`const root = process.env.OPENCODE_ROOT || "."`), so we reuse it for consistent path resolution.

### §3.2 P0-7: Cleanup `_dispatch_target.json` in `dispatch-after.ts`

**Insertion point**: After L40 (`if (!isTask) return;`) and before L42 (`const agent = resolveAgent(input.sessionID);`).

**Code** (~15 lines):

```typescript
  // ═══════════════════════════════════════════════════════════════
  // P0-7 TASK-IDENTITY CLEANUP: Delete _dispatch_target.json after
  // Task() completes. At this point the sub-agent has finished, so
  // deleting does not affect its agent resolution. Prevents stale
  // dispatch targets from persisting between dispatches or leaking
  // across sessions.
  //
  // Safety: readers (agent-resolver.ts, compliance-gate.ts,
  // pre-execution-gate.ts) validate run_id against OPENCODE_RUN_ID,
  // so even if cleanup is delayed, stale files are auto-rejected.
  // ═══════════════════════════════════════════════════════════════
  try {
    const dtPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(dtPath)) fs.unlinkSync(dtPath);
    writeLog("dispatch-after", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: resolveAgent(input.sessionID),
      agentType: resolveAgent(input.sessionID),
      event: "TOOL-AFTER",
      detail: "TASK-IDENTITY: cleaned up _dispatch_target.json",
    });
  } catch {
    /* non-fatal: stale file will be auto-rejected by run_id check */
  }
```

**Why `dispatch-after.ts` instead of `task-after.ts`**: `dispatch-after.ts` fires on `tool.execute.after` for ALL Task() calls (L39: `input.tool === "Task"`), which is the exact mirror of the `tool.execute.before` write in `dispatch-before.ts`. `task-after.ts` is focused on failure recording — keeping cleanup in dispatch-after.ts maintains the before/after symmetry.

### §3.3 Estimated Growth

| File | Current Lines | New Lines | Final Lines |
|:--|:--:|:--:|:--:|
| `dispatch-before.ts` | 291 | +27 | 318 |
| `dispatch-after.ts` | 95 | +17 | 112 |
| **Total** | **386** | **+44** | **430** |

---

## §4 Compatibility Verification

### §4.1 Reader Schema Alignment

All 3 readers expect the same minimal schema:

```typescript
interface DispatchTarget {
  agent: string;    // "@Coder-BE" — required, with @ prefix
  run_id: string;   // OPENCODE_RUN_ID uuid — required for staleness check
  task_id?: string; // "T-001" — optional, used by resolveTaskId()
  timestamp?: string; // ISO 8601 — informational only
}
```

| Reader | Reads `d.agent` | Checks `d.run_id` | Uses `d.task_id` | Compatible? |
|:--|:--:|:--:|:--:|:--:|
| `agent-resolver.ts` L41-43 | ✅ `d.agent` | ✅ L38 `d.run_id !== currentRunId` | ✅ via `resolveTaskId()` L68-71 | ✅ |
| `compliance-gate.ts` L1004-1012 | ✅ `d.agent` | ✅ L1006 `d.run_id !== currentRunId` | N/A | ✅ |
| `pre-execution-gate.ts` L327-335 | ✅ `d.agent` | ✅ L329 `d.run_id !== currentRunId` | N/A | ✅ |

### §4.2 Staleness Protection

Readers auto-delete stale files when `d.run_id !== OPENCODE_RUN_ID`. This provides defense-in-depth:

```
P0-7 cleanup fails (crash, timeout)
  → stale file persists
  → next reader checks run_id
  → run_id mismatch → reader deletes file → returns ""
  → no identity leak
```

---

## §5 Risk Assessment

### §5.1 Parallel Dispatch Race Condition

**Scenario**: Primary agent dispatches @Coder-BE and @Coder-FE in parallel.

**Analysis**: OpenCode's `tool.execute.before` fires **synchronously** within the session's event loop. The hook completes (including the `_dispatch_target.json` write) before the Task() tool executes and spawns the sub-agent process. The sub-agent reads the file on startup. By the time the second Task() fires, the first sub-agent has already read the file.

**Verdict**: ✅ Safe. Same pattern as old `enforce.ts` which worked correctly for months.

### §5.2 Cleanup Failure

**Scenario**: `dispatch-after.ts` fails to delete the file (permission error, file locked).

**Mitigation**: All 3 readers validate `run_id` against `OPENCODE_RUN_ID`. If the next dispatch happens in a new session (new `OPENCODE_RUN_ID`), readers auto-delete the stale file.

**Verdict**: ✅ Safe. Defense-in-depth via reader staleness check.

### §5.3 File System Permission

**Scenario**: `.task_temp/` directory doesn't exist.

**Mitigation**: `mkdirSync(dtDir, { recursive: true })` creates it on demand.

**Verdict**: ✅ Handled.

### §5.4 Agent Name Normalization

**Scenario**: `reqType` may or may not have `@` prefix (from `subagent_type` arg).

**Mitigation**: `"@" + reqType.replace(/^@/, "")` always produces `@AgentType` format.

**Verdict**: ✅ Handled.

---

## §6 Implementation Steps

### Step 1: Edit `dispatch-before.ts` (1 insertion)

Insert P0-6 code block after L197 (`sessionLastDispatched.set(input.callID, ...)`).

### Step 2: Edit `dispatch-after.ts` (1 insertion)

Insert P0-7 code block after L40 (`if (!isTask) return;`).

### Step 3: Verify Plugins Load

```bash
bun -e "
  import('./.opencode/plugins/dispatch-before.ts').then(() => console.log('dispatch-before OK')).catch(e => console.log('FAIL:', e.message));
  import('./.opencode/plugins/dispatch-after.ts').then(() => console.log('dispatch-after OK')).catch(e => console.log('FAIL:', e.message));
"
```

### Step 4: Verify File Write (simulation)

```bash
bun -e "
  const fs = require('fs');
  const path = require('path');
  const root = process.env.OPENCODE_ROOT || '.';
  const dtPath = path.join(root, '.task_temp', '_dispatch_target.json');
  const dtDir = path.dirname(dtPath);
  if (!fs.existsSync(dtDir)) fs.mkdirSync(dtDir, { recursive: true });
  fs.writeFileSync(dtPath, JSON.stringify({
    agent: '@TestAgent',
    task_id: 'T-TEST',
    run_id: process.env.OPENCODE_RUN_ID || 'test-run-id',
    timestamp: new Date().toISOString()
  }, null, 2), 'utf8');
  const content = JSON.parse(fs.readFileSync(dtPath, 'utf8'));
  console.log('Write OK:', JSON.stringify(content));
  fs.unlinkSync(dtPath);
  console.log('Cleanup OK: file deleted');
"
```

### Step 5: Run Framework Self-Test

```bash
node .opencode/scripts/framework-self-test.ts
```

### Step 6: Update `priority.md`

- P0-6 status: ❌ → ✅
- P0-7 status: ❌ → ✅
- Execution Order: Phase 0 → ✅ DONE

---

## §7 Verification Checklist

- [ ] Edit 1: Insert P0-6 write block in `dispatch-before.ts` after L197
- [ ] Edit 2: Insert P0-7 cleanup block in `dispatch-after.ts` after L40
- [ ] Verify both plugins load without error
- [ ] Verify `_dispatch_target.json` write produces correct schema
- [ ] Verify cleanup deletes the file
- [ ] Verify `agent-resolver.ts` reads the written file correctly
- [ ] Run `framework-self-test.ts`
- [ ] Update `priority.md` P0-6/P0-7 status to ✅

**Estimated effort**: ~15 minutes (2 insertions + verification)

---

## §8 Related Documents

| Document | Relationship |
|:--|:--|
| `docs/review/plugin-backlog/priority.md` | P0-6/P0-7 entries — this plan resolves them |
| `docs/official_docs/opencode/source-analysis/agent-identity-plugin-hooks.md` | Confirms FRAMEWORK_AGENT removed from dispatch-subagent.ts |
| `docs/official_docs/opencode/findings/06-multi-agent-system.md` | Multi-agent dispatch protocol, FRAMEWORK_AGENT history |
| `docs/official_docs/framework/plugin-programming-conventions.md` | Plugin coding conventions (export default, local hooks) |
| `docs/official_docs/opencode/findings/02-harness-system.md` | Plugin loading, Bun cache, hook chaining |
| `docs/official_docs/opencode/findings/01-log-central-management.md` | Log conventions (writeLog categories) |
| `.opencode/lib/agent-resolver.ts` | Priority 1 reader of `_dispatch_target.json` |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | Reader at L996-1016 |
| `.opencode/scripts/pre-execution-gate.ts` | Reader at L319-339 |
| `.opencode/_plugins_backups/_bk_framework-enforcer/enforce.ts` | Original write logic (L932-983) and cleanup (L1670-1686) |
