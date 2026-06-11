# P0-2 MANDATORY-DISPATCH Queue Check — Integration Plan

**Version**: v2.0.0
**Date**: 2026-06-11
**Author**: @Super-Admin
**Status**: Ready for implementation
**Source Audit**: `.task_temp/CONSTRAINT-AUDIT/priority.md` (2026-06-11)
**Predecessor Plans**: `mandatory-dispatch-subagent-plan.md` (v1.0, 2026-06-08), `dispatch-subagent-integration-plan.md` (v1.0, 2026-06-08)
**Architecture**: Flat plugin (16 files), NOT monolithic enforce.ts

---

## 1. Problem Statement

### 1.1 Current Gap

```
Agent calls Task("Coder-BE", "write code")
                    │
                    ▼
          dispatch-before.ts hook
                    │
     ┌──────────────┴──────────────┐
     │ .pending.json exists?       │
     ├─ YES: process queue, inject │
     │        prompt, consume entry│
     ├─ NO:  silently return       │  ← GAP: Task() executes WITHOUT
     │        (line 50-56)         │    P0 protocol, preamble, template
     └─────────────────────────────┘    resolution, UC7KS pipeline
```

When `.pending.json` is missing or empty, the plugin silently returns. The sub-agent is spawned **without**:
- P0 Protocol (compliance_gate_check/confirm/complete)
- Agent Config injection (skills, mcp_tools declarations)
- DISPATCH_TOKEN (pre-execution-gate bypass)
- Template variable resolution (`{backend.src}` → `booking-backend/src/`)
- UC7KS pipeline injection (module_scope_declare, knowledge_cache_search)
- Scope Boundary table (what the agent can/cannot write)

### 1.2 The Two Paths

| Path | Mechanism | P0 Protocol | Agent Config | Dispatch Token | Template Resolution | UC7KS Pipeline |
|------|-----------|:---:|:---:|:---:|:---:|:---:|
| **A: dispatch_subagent → Task()** | `.pending.json` queue → prompt injection | ✅ | ✅ | ✅ | ✅ | ✅ |
| **B: Task() directly** | No queue entry → bare prompt | ❌ | ❌ | ❌ | ❌ | ❌ |

Path B is the exploit. P0-2 closes it.

---

## 2. Alignment with 9 Framework Systems

### 2.1 Layout Architecture System

| Aspect | Analysis |
|--------|----------|
| **Plugin location** | `dispatch-before.ts` — correct. This plugin already handles Task() interception and queue consumption. Adding MANDATORY-DISPATCH here follows the single-responsibility pattern: one plugin per dispatch concern. |
| **Hook event** | `tool.execute.before` — correct. Must intercept BEFORE the tool executes. A `throw` inside the hook physically blocks the tool call. |
| **File organization** | No new files needed. The change is additive (~30 lines) within an existing plugin. |
| **Lib dependency** | No new imports. Reuses existing `resolveAgent`, `sessionLastDispatched`, `getEnforcementMode` from `agent-resolver.ts` and `gate-core.ts`. |

**Verdict**: ✅ Zero architectural change. Additive within existing structure.

### 2.2 Permission Matrix System

| Aspect | Analysis |
|--------|----------|
| **agent_write_scopes** | No change. This is a dispatch-time gate, not a write-scope gate. |
| **opencode.json permissions** | No change. The `task` tool permission remains the same — agents still have access to Task(), but the plugin now enforces a precondition. |
| **DISPATCH-GATE authorization** | Unchanged. The existing dispatch-before.ts (KC recursion guard, sessionLastDispatched idempotency) continues to operate. MANDATORY-DISPATCH is an additional layer, not a replacement. |
| **Agent override** | Super-Admin emergency bypass via `FW_PROMPT_QUEUE_DRAIN=true` preserves operational safety. |

**Verdict**: ✅ No permission changes required.

### 2.3 Concurrent Session / Dispatch Write System

| Aspect | Analysis |
|--------|----------|
| **Queue mutual exclusion** | `.pending.json` is already a shared state file. dispatch_subagent writes to it; dispatch-before.ts reads + consumes from it. Adding a read-check for emptiness does not introduce new concurrency issues. |
| **callID double-hook guard** | `sessionLastDispatched` Map (line 61 of agent-resolver.ts) provides per-session/per-callID idempotency. Existing code at line 212-220 already checks this. MANDATORY-DISPATCH only fires when NO queue entry exists AND no idempotency record — mutually exclusive conditions. |
| **Race condition** | Minimal risk. If dispatch_subagent writes `.pending.json` between the existsSync check and the throw, the next callID invocation will find the queue non-empty. The window is sub-millisecond. |
| **Stale session guard** | Existing stale drain (30 min timeout, line 66-81) prevents queue accumulation. |

**Verdict**: ✅ No concurrency concerns. Existing guards cover race conditions.

### 2.4 Hardened Enforcement System

| Constraint | Current State | After P0-2 |
|------------|:---:|:---:|
| **UC7-004** (external query block) | ✅ enforced in uc7ks-before.ts | ➡️ unchanged |
| **UC7-001** (cache search before write) | ⚠️ P1-1 pending | ➡️ unchanged |
| **DISPATCH-GATE** (who can dispatch) | ✅ authorized callers only | ➡️ unchanged |
| **Gate armed** (compliance gate enforcement) | ✅ enforced in gate-before.ts | ➡️ unchanged |
| **Write scope** (agent file access) | ✅ enforced in scope-before.ts | ➡️ unchanged |
| **TDD order** (test before code) | ⚠️ P0-1 pending | ➡️ unchanged |
| **MANDATORY-DISPATCH** (queue precondition) | ❌ MISSING | ✅ **NEW** |

**Verdict**: ✅ Adds 1 constraint, touches 0 existing constraints.

### 2.5 Harness System

| Component | Impact |
|-----------|--------|
| **dispatch-before.ts** | ✅ ~30 lines added (throw block + emergency bypass) |
| **dispatch-subagent.ts** | ➡️ No change — still generates prompt + writes `.pending.json` |
| **pre-execution-gate.ts** | ➡️ No change — DISPATCH_TOKEN still injected by dispatch_subagent |
| **compliance-gate.ts** | ➡️ No change |
| **agent-resolver.ts** | ➡️ No change — `sessionLastDispatched` already exported |
| **gate-core.ts** | ➡️ No change — `getEnforcementMode()` already imported |
| **log-manager.ts** | ➡️ No change — `writeLog()` already imported |

**Verdict**: ✅ 1 file modified, 6 components unchanged.

### 2.6 Central State Management

| State File | Impact |
|------------|--------|
| **`.pending.json`** | Read-check added (exists + non-empty). P0-2 reads without modifying. |
| **`machine.json`** | No change. |
| **`gate-state.json`** | No change. |
| **`.session_map.json`** | No change. |
| **`Task.DAG.json`** | No change. |

**Verdict**: ✅ No state file modifications. Read-only precondition check.

### 2.7 Multi-Agent System

| Scenario | Current | After P0-2 |
|----------|:---:|:---:|
| Agent → `dispatch_subagent("Coder-BE")` → `Task()` | ✅ pass | ✅ pass (queue non-empty) |
| Agent → `Task("Coder-BE")` directly | ⚠️ allowed (gap) | ❌ **BLOCKED** |
| @Orchestrator → `dispatch_subagent → Task()` | ✅ pass | ✅ pass |
| @Super-Admin → emergency `FW_PROMPT_QUEUE_DRAIN=true` → `Task()` | ✅ pass | ✅ pass (emergency bypass) |
| Sub-agent → `Task()` (recursive dispatch) | ❌ DISPATCH-GATE blocks | ❌ DISPATCH-GATE blocks |
| Agent → direct tool call (safe_edit/read/grep) | ✅ not a Task() call | ✅ not a Task() call |

**Verdict**: ✅ Only blocks the bypass path. All legitimate paths preserved.

### 2.8 Log Management System

| Log Category | Integration |
|--------------|-------------|
| **MANDATORY-DISPATCH BLOCK** | `writeLog("dispatch-before", "runtime", { level: "WARN", event: "TOOL-BEFORE", detail: "MANDATORY-DISPATCH blocked..." })` |
| **Emergency bypass** | `writeLog("dispatch-before", "runtime", { level: "WARN", event: "TOOL-BEFORE", detail: "MANDATORY-DISPATCH bypassed by FW_PROMPT_QUEUE_DRAIN" })` |
| **Normal pass** | Existing log entries unchanged |

All log entries go through the existing `log-manager.ts` pipeline (buffered write → date-partitioned file → index.json update → 7-day retention → auto-archive).

**Verdict**: ✅ Integrated with existing log infrastructure. 2 new log events.

### 2.9 Templatization & Parameterization System

| Aspect | Analysis |
|--------|----------|
| **Template variables** | Unaffected. dispatch_subagent continues to resolve `{backend.src}`, `{frontend.dto_path}`, etc. during prompt assembly. P0-2 only ensures dispatch_subagent IS called — the template resolution itself is unchanged. |
| **project.config.json** | No new keys needed. `FW_PROMPT_QUEUE_DRAIN` is an env var, not a config key. |
| **subagent-preamble.md** | Unaffected. Injected by dispatch_subagent. |

**Verdict**: ✅ Zero impact on template system.

---

## 3. Implementation

### 3.1 File: `.opencode/plugins/dispatch-before.ts`

**Change**: Replace the silent-skip block (lines 47-56) with a MANDATORY-DISPATCH throw.

#### Current code (lines 47-56):

```typescript
  const root = process.env.OPENCODE_ROOT || ".";
  const pf = path.join(root, PENDING_FILE);

  if (!fs.existsSync(pf)) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (skip) no pending queue",
    });
    return;
  }
```

#### Replacement code (~30 lines):

```typescript
  const root = process.env.OPENCODE_ROOT || ".";
  const pf = path.join(root, PENDING_FILE);

  /**
   * P0-2 MANDATORY-DISPATCH: All Task() dispatches must go through
   * dispatch_subagent. The .pending.json queue is the proof that
   * dispatch_subagent was called. If the queue doesn't exist or is
   * empty, the agent bypassed dispatch_subagent → BLOCK.
   *
   * Emergency override: FW_PROMPT_QUEUE_DRAIN=true allows bypass
   * for deadlock recovery (e.g., queue corruption preventing any dispatch).
   *
   * Double-hook guard: if sessionLastDispatched already has a record
   * for this sessionID/callID, treat as idempotent retry (pass through).
   */
  let queueExists = false;
  let queueEmpty = true;
  try {
    if (fs.existsSync(pf)) {
      queueExists = true;
      const raw = fs.readFileSync(pf, "utf8");
      const q = JSON.parse(raw);
      queueEmpty = !Array.isArray(q) || q.length === 0;
    }
  } catch {
    // Parse failure → treat as empty (will be blocked below)
  }

  if (!queueExists || queueEmpty) {
    // G-01: Emergency bypass via environment variable
    if (process.env.FW_PROMPT_QUEUE_DRAIN === "true") {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "WARN",
        event: "TOOL-BEFORE",
        detail: "MANDATORY-DISPATCH bypassed: FW_PROMPT_QUEUE_DRAIN=true",
      });
      return;
    }

    // G-02: Idempotent retry guard (same callID already dispatched)
    if (sessionLastDispatched.has(input.callID)) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        event: "TOOL-BEFORE",
        detail: "MANDATORY-DISPATCH bypassed: callID idempotent retry",
      });
      return;
    }

    // G-03: Enforcement — block unless advisory mode
    const msg =
      `[FW-ENFORCE][MANDATORY-DISPATCH] All Task() dispatches must go through ` +
      `dispatch_subagent. No pending dispatch entry found in .pending.json. ` +
      `Call dispatch_subagent(agent_type, task_description) first to generate ` +
      `a valid dispatch entry with P0 protocol, agent config, DISPATCH_TOKEN, ` +
      `template resolution, and UC7KS pipeline injection. ` +
      `Emergency override: set FW_PROMPT_QUEUE_DRAIN=true.`;

    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `MANDATORY-DISPATCH: ${!queueExists ? "no queue file" : "queue empty"} | agent=${agent}`,
    });

    if (mode !== "advisory") {
      throw new Error(msg);
    }
    // Advisory mode: log only, allow through
    return;
  }

  // [existing queue processing continues below...]
```

### 3.2 Enforcement Mode Behavior

| Mode | Behavior |
|------|----------|
| **advisory** | Log warning + allow Task() to proceed (no throw) |
| **strict** | Throw `[FW-ENFORCE][MANDATORY-DISPATCH]` — blocks Task() |
| **locked** | Throw `[FW-ENFORCE][MANDATORY-DISPATCH]` — blocks Task() |

### 3.3 Modified Files

| # | File | Change | Lines |
|---|------|--------|:---:|
| 1 | `.opencode/plugins/dispatch-before.ts` | Replace silent-skip with MANDATORY-DISPATCH throw | ~50 |
| **Total** | 1 file | Additive within existing block | +30, -10 |

### 3.4 Emergency Bypass Protocol

```bash
# Scenario: .pending.json is corrupted, preventing ALL dispatches
# Action: Set bypass env var for this session only
export FW_PROMPT_QUEUE_DRAIN=true

# After recovery: unset to restore enforcement
unset FW_PROMPT_QUEUE_DRAIN
```

**Safety**: The bypass is per-session (env var), not persistent. It resets when the terminal/CI job ends. Audit trail preserved via WARN-level log entry.

---

## 4. Integration with Existing dispatch-before.ts Features

The P0-2 check is placed **before** all existing queue processing logic. It acts as a precondition gate:

```
Task() call intercepted
        │
        ▼
[P0-2] MANDATORY-DISPATCH check    ← NEW
   ├─ FW_PROMPT_QUEUE_DRAIN? → bypass
   ├─ callID idempotent? → bypass
   ├─ Queue missing/empty? → THROW (strict/locked)
   └─ Queue non-empty → continue
        │
        ▼
[EXISTING] Stale drain (>30 min)
        │
        ▼
[EXISTING] Match by agentType/dagTaskId
        │
        ▼
[EXISTING] File hash verification
        │
        ▼
[EXISTING] Prompt injection + queue consume
        │
        ▼
[EXISTING] KC recursion guard (G-09)
        │
        ▼
[EXISTING] callID idempotency check (no-match fallback)
```

**No existing logic is removed or weakened.** The P0-2 check is purely additive — it only fires in the gap case (empty/missing queue), which was previously silently passed through.

---

## 5. Verification Plan

### 5.1 Pre-Implementation

```bash
# Verify current plugin loads without error
bun .opencode/plugins/dispatch-before.ts --dry-run 2>&1 || true

# Verify framework self-test passes
bun .opencode/scripts/framework-self-test.ts 2>&1 | tail -5
```

### 5.2 Post-Implementation Test Cases

| # | Scenario | Expected Result |
|---|----------|----------------|
| 1 | Agent calls `Task("explore")` directly (no dispatch_subagent) | ❌ **BLOCKED**: `[FW-ENFORCE][MANDATORY-DISPATCH]` thrown (strict/locked) |
| 2 | Agent calls `dispatch_subagent("Coder-BE")` → `Task("Coder-BE")` | ✅ Pass: queue non-empty, prompt injected |
| 3 | Same callID retry (idempotent) | ✅ Pass: callID guard bypass |
| 4 | `FW_PROMPT_QUEUE_DRAIN=true` → `Task("explore")` | ✅ Pass: emergency bypass logged |
| 5 | Agent calls `safe_edit` (not Task tool) | ✅ Pass: not a Task() call, hook skipped |
| 6 | advisory mode → `Task()` directly | ✅ Pass: WARN log only, no throw |

### 5.3 Regression Checks

```bash
# Plugin loading test
for f in .opencode/plugins/*.ts; do
  echo "Testing $f..."
  bun run -e "import('$f')" 2>&1 | head -1
done

# Framework self-test
bun .opencode/scripts/framework-self-test.ts

# Audit log for MANDATORY-DISPATCH events
grep -c "MANDATORY-DISPATCH" .task_temp/_logs/*/plugin-dispatch-before-runtime.log | tail -5
```

---

## 6. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|:---:|:---:|-----------|
| Legitimate Task() calls blocked | 🟡 Medium | Low | callID idempotency guard + FW_PROMPT_QUEUE_DRAIN bypass |
| Queue corruption prevents all dispatches | 🟡 Medium | Very Low | FW_PROMPT_QUEUE_DRAIN=true emergency bypass |
| Race condition between queue write and read | 🟢 Low | Very Low | Sub-millisecond window; retry on next callID |
| Breaking existing dispatch flow | 🟢 Low | None | Additive change only; no existing logic removed |
| Bun cache stale after edit | 🟢 Low | Medium | Bun auto-reloads on file change (verified) |

---

## 7. Related Documents

| Document | Relationship |
|----------|-------------|
| `.task_temp/CONSTRAINT-AUDIT/priority.md` | Source audit identifying P0-2 gap |
| `docs/review/remain-issue/mandatory-dispatch-subagent-plan.md` | v1.0 plan (monolithic enforce.ts — superseded) |
| `docs/review/remain-issue/dispatch-subagent-integration-plan.md` | v1.0 plan (security gates → plugin) |
| `.opencode/plugins/dispatch-before.ts` | Target file for implementation |
| `.opencode/lib/agent-resolver.ts` | sessionLastDispatched, resolveAgent utilities |
| `.opencode/lib/gate-core.ts` | getEnforcementMode() utility |
| `.opencode/lib/log-manager.ts` | writeLog() logging infrastructure |
| `docs/official_docs/framework/plugin-programming-conventions.md` | export default, hook chaining, throw semantics |
| `docs/official_docs/framework/mistake_precautions/double-hook-trigger-prevention.md` | Double hook detection patterns |

---

## 8. Change Log

| Version | Date | Changes |
|---------|------|---------|
| v2.0.0 | 2026-06-11 | Complete rewrite for flat plugin architecture. Aligned with 9 framework systems. Replaced monolithic enforce.ts plan with dispatch-before.ts additive approach. Added callID idempotency guard and enforcement mode gating. |
| v1.0.0 | 2026-06-08 | Initial plan for monolithic enforce.ts architecture (superseded). |
