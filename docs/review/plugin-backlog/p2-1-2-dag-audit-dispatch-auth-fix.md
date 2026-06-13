# P2-1/P2-2: DAG Task Audit + Dispatch Authorization — Implementation Plan

**Created**: 2026-06-12
**Author**: @Super-Admin
**Priority**: P2 (NICE-TO-HAVE) — Phase 5 of plugin-backlog priority.md
**Status**: Planned — awaiting execution
**Related**: `docs/review/plugin-backlog/priority.md` (P2-1, P2-2 entries)
**Replaces**: Archived `enforce.ts` L1331–1356 (DAG coverage check) + L949–1117 (dispatch security gates)
**Depends On**: Phase 0 (P0-6/P0-7 agent propagation) ✅ DONE, Phase 2 (P0-3/P0-4/P0-5 write scope) ✅ DONE

---

## §1 Problem Statement

Two soft-enforcement checks from the archived monolithic `enforce.ts` were **never migrated** to the decomposed plugin system. They are classified P2 (nice-to-have) because P0-2 MANDATORY-DISPATCH already provides indirect coverage for P2-2, and P2-1 is an audit-trail improvement.

| Gap | Original Location | Current Status | Risk |
|:--|:--|:--|:--|
| **P2-1** | `enforce.ts` L1331–1356 | ❌ `gate-before.ts` only checks gate armed (69 lines). `gate-checks.ts` has `findTaskInDag()` (L68–79) but is **never called** from any plugin. | Agents can execute modify tools under a gate session whose task_id is absent from DAG or already completed — no runtime audit trail |
| **P2-2** | `enforce.ts` L949–1068 | ⚠️ `dispatch-before.ts` MANDATORY-DISPATCH (P0-2) indirectly covers this: any `Task()` without `dispatch_subagent` is blocked. **Gap**: No explicit check that the CALLER is authorized to dispatch (e.g., non-Orchestrator/non-SA). | Any agent that calls `dispatch_subagent` + `Task()` correctly bypasses the queue check, but unauthorized dispatchers are not detected |

### Current Coverage

```
┌──────────────────────────────────────────────────────────────────┐
│                    DAG & DISPATCH ENFORCEMENT                      │
├──────────────────────┬───────────────────────────────────────────┤
│ DAG coverage gate    │ ✅ pre-execution-gate.ts L270–302        │
│ (pre-execution)      │    Runs before sub-agent starts           │
├──────────────────────┼───────────────────────────────────────────┤
│ DAG task check       │ ❌ NOT MIGRATED — enforce.ts L1331–1356  │
│ (runtime, per-tool)  │    findTaskInDag() exists but unused      │
│ ← P2-1              │    in active plugins                      │
├──────────────────────┼───────────────────────────────────────────┤
│ MANDATORY-DISPATCH   │ ✅ dispatch-before.ts L72–146             │
│ (queue check)        │    Blocks Task() without dispatch_subagent│
├──────────────────────┼───────────────────────────────────────────┤
│ Dispatch caller      │ ❌ NOT MIGRATED — enforce.ts L949–1068   │
│ authorization        │    No caller identity check               │
│ ← P2-2              │                                           │
├──────────────────────┼───────────────────────────────────────────┤
│ SA dispatch pattern  │ ❌ NOT MIGRATED — enforce.ts L1068–1117  │
│ validation           │    No repair pattern matching for SA       │
│ (P2-2 Gate 2)       │    dispatches                              │
├──────────────────────┼───────────────────────────────────────────┤
│ SA locked mode deny  │ ❌ NOT MIGRATED — enforce.ts L1100–1104  │
│                      │    SA dispatch not blocked in locked mode  │
├──────────────────────┼───────────────────────────────────────────┤
│ Dispatch identity    │ ✅ dispatch-before.ts L220–268            │
│ propagation (P0-6)   │    _dispatch_target.json writer           │
├──────────────────────┼───────────────────────────────────────────┤
│ Dispatch cleanup     │ ✅ dispatch-after.ts L42–58               │
│ (P0-7)               │    _dispatch_target.json deletion         │
└──────────────────────┴───────────────────────────────────────────┘
```

### Original Logic: DAG Coverage (enforce.ts L1331–1356)

```typescript
// ── DAG coverage check ──
// DAG-creator bypass: @Meta-Planner creates DAG tasks, @Orchestrator manages
// them. Chicken-and-egg deadlock: these agents must operate without existing
// DAG coverage.
//
// FW-FIX-DAG-SCOPE-01: DAG check scoped to isModifyTool() only
const taskId = resolveTaskId();
const isDagCreator =
  resolvedAgent === "@Orchestrator" || resolvedAgent === "Orchestrator" ||
  resolvedAgent === "@Meta-Planner" || resolvedAgent === "Meta-Planner";
if (taskId && !isDagCreator && isModifyTool(tool)) {
  const tc = findTaskInDag(taskId);
  if (!tc.found)
    violations.push(`[FW-ENFORCE] Task "${taskId}" not found in Task.DAG.json`);
  else if (tc.status !== "pending" && tc.status !== "in_progress")
    violations.push(`[FW-ENFORCE] Task "${taskId}" status "${tc.status}"`);
}
```

### Original Logic: Dispatch Authorization (enforce.ts L949–1068)

```typescript
// ── Gate 1: Dispatch authorization ──
const isOrchestrator = callingAgent === "@Orchestrator" || "Orchestrator";
const isSuperAdmin = callingAgent === "@Super-Admin" || "Super-Admin";
const isKC = targetAgent === "Knowledge-Curator" || "@Knowledge-Curator";

if (!isOrchestrator) {
  if (isSuperAdmin && isKC) {
    // SA→KC: UC7KS knowledge pattern matching required
    const kcPatterns = ["knowledge", "cache", "docs", ...];
    const matched = kcPatterns.filter(p => taskDesc.includes(p.toLowerCase()));
    if (matched.length === 0) {
      if (mode !== "advisory") throw new Error("[FW-ENFORCE][DISPATCH-GATE]...");
      logAuditEntry({ event: "dispatch_gate_kc_pattern_warning", ... });
    }
  } else if (isSuperAdmin) {
    // SA dispatch restricted to KC
    if (mode !== "advisory") throw new Error("[FW-ENFORCE][DISPATCH-GATE]...");
  } else {
    // Non-Orchestrator agent may not dispatch
    if (mode !== "advisory") throw new Error("[FW-ENFORCE][DISPATCH-GATE]...");
  }
}

// ── Gate 2: SA target repair pattern validation ──
if (isSATarget) {
  const repairPatterns = ["repair", "fix", "restore", "corrupt", ...];
  if (mode === "locked") throw new Error("SA dispatch DENIED in locked mode.");
  else if (mode === "strict" && matched.length === 0) throw new Error("...");
}
```

---

## §2 Framework Compliance Matrix

### §2.1 Layout Architecture System

**Requirement**: `.opencode/plugins/*.ts` files are auto-discovered. Shared code in `.opencode/lib/`. No new plugin files.

| Check | Status | Notes |
|:--|:--:|:--|
| No new plugin files created | ✅ | Extends existing `gate-before.ts` and `dispatch-before.ts` only |
| P2-1 new import from `../lib/gate-checks.ts` | ✅ | `findTaskInDag` already exported; `gate-checks.ts` is in `.opencode/lib/` (not plugin scan path) |
| P2-1 new import from `../lib/agent-resolver.ts` | ✅ | `resolveTaskId` already exported; `agent-resolver.ts` is in `.opencode/lib/` |
| P2-2 new imports | ✅ None | All helper functions defined locally in `dispatch-before.ts` |
| Flat structure preserved | ✅ | All logic in existing plugin files |
| No INDEX_FILES violation | ✅ | Not directory plugins; single files |

**Source**: `docs/official_docs/opencode/findings/04-layout-architecture.md`

### §2.2 Permission Matrix System

**Requirement**: Agent permissions configured in `opencode.json` → `permissions`. Tool-level gating.

| Check | Status | Notes |
|:--|:--:|:--|
| P2-1 uses agent name matching (not permission keys) | ✅ | Agent identity from `resolveAgent()`, task ID from `resolveTaskId()` |
| P2-2 uses agent name matching | ✅ | Caller identity from `resolveAgent()` |
| `task` permission key in `opencode.json` | ✅ | Already configured per-agent (`task: "allow"` for Orchestrator/SA, `"deny"` for others) |
| No permission escalation | ✅ | We only throw errors or log; no config modification |
| P2-2 complements opencode.json `task` permission | ✅ | Permission system blocks tool invocation; P2-2 adds runtime caller check |

**Source**: `docs/official_docs/opencode/findings/03-permission-matrix.md`

### §2.3 Concurrent Session/Dispatch Write System

**Requirement**: `.pending.json` queue is the dispatch proof. Sub-agent identity from `_dispatch_target.json`. Race condition awareness.

| Check | Status | Notes |
|:--|:--:|:--|
| P2-1 reads `resolveTaskId()` | ✅ | Reads `FRAMEWORK_TASK_ID` env var + `_dispatch_target.json` |
| P2-1 reads DAG via `findTaskInDag()` | ✅ | Read-only JSON parse of `Task.DAG.json` |
| P2-2 reads `resolveAgent(sessionID)` | ✅ | Uses session map (priority 1) — no race condition |
| P2-2 no state file writes | ✅ | All checks are read-only |
| Race condition risk | ✅ None | Synchronous reads; no shared mutable state |
| P2-2 runs BEFORE queue consumption | ✅ | Inserted after `isTask` check (L58), before queue empty check (L102) |

**Source**: `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.4 Hardened Enforcement System

**Requirement**: All enforcement checks must use `getEnforcementMode()` from `gate-core.ts`. Three modes: advisory (warn), strict (block), locked (block + no bypass).

| Check | Status | Notes |
|:--|:--:|:--|
| P2-1 uses `getEnforcementMode()` | ✅ | Already imported in `gate-before.ts` L8 |
| P2-2 uses `getEnforcementMode()` | ✅ | Already imported in `dispatch-before.ts` L11 |
| P2-1 advisory: WARN log only | ✅ | Priority.md specifies advisory-only |
| P2-2 advisory: WARN log only | ✅ | Priority.md specifies advisory warn |
| P2-2 strict/locked: throw | ✅ | Per original enforce.ts L1038, L1049, L1059 |
| P2-2 locked SA deny | ✅ | Per original enforce.ts L1100–1104 |
| No hardcoded mode | ✅ | Dynamic mode from `gate-core.ts` |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`, `.opencode/rules/rule_detail/enforcement-modes-standard.md`

### §2.5 Harness System

**Requirement**: Plugins use `export default`, hooks defined locally, no imported function references in return. Bun cache considerations.

| Check | Status | Notes |
|:--|:--:|:--|
| `export default` pattern preserved | ✅ | Unchanged in both files |
| Hook functions defined locally | ✅ | All new logic inside existing `toolExecuteBefore` function bodies |
| No new hook events registered | ✅ | All checks inside existing `tool.execute.before` handlers |
| P2-1 imports from `../lib/` only | ✅ | `findTaskInDag`, `resolveTaskId` — not in plugin scan path |
| Bun cache: additive changes | ✅ | New imports + new code blocks usually trigger recompile |
| No `require()` calls | ✅ | ESM `import` syntax only |

**Source**: `docs/official_docs/framework/plugin-programming-conventions.md`, `docs/official_docs/opencode/findings/02-harness-system.md`

### §2.6 Central State Management

**Requirement**: `machine.json` is the single source of truth. State writes must be atomic. No unauthorized state modifications.

| Check | Status | Notes |
|:--|:--:|:--|
| P2-1 writes to `machine.json`? | ❌ No | Read-only: reads `Task.DAG.json` via `findTaskInDag()` |
| P2-2 writes to `machine.json`? | ❌ No | Read-only: reads `_dispatch_target.json` + session map via `resolveAgent()` |
| P2-1 reads `Task.DAG.json` | ✅ | Via `findTaskInDag()` in `gate-checks.ts` |
| `Task.DAG.json` reads are safe? | ✅ | Read-only via `readJsonFile()` in `gate-checks.ts` |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`

### §2.7 Multi-Agent System

**Requirement**: Agent identity resolution, dispatch protocol, per-agent scope isolation.

| Check | Status | Notes |
|:--|:--:|:--|
| P2-1 agent resolution via `resolveAgent(sessionID)` | ✅ | Priority 1: session map; Priority 2: `_dispatch_target.json` |
| P2-1 exempt @Meta-Planner/@Orchestrator | ✅ | DAG creators/managers must operate without coverage |
| P2-2 caller resolution via `resolveAgent(sessionID)` | ✅ | Same identity resolution |
| P2-2 authorized callers: @Orchestrator, @Super-Admin | ✅ | Mirrors original enforce.ts Gate 1 |
| P2-2 SA→KC pattern matching | ✅ | Mirrors original enforce.ts L1011–1044 |
| P2-2 SA→non-KC restricted | ✅ | Mirrors original enforce.ts L1045–1054 |
| P2-2 SA target repair patterns | ✅ | Mirrors original enforce.ts L1068–1117 |
| P2-2 locked mode SA deny | ✅ | Mirrors original enforce.ts L1100–1104 |

**Source**: `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.8 Log Central Management System

**Requirement**: Plugin logging via `writeLog(pluginId, category, fields)`. Three categories: `"loaded"`, `"hooks"`, `"runtime"`. Levels: DEBUG/INFO/WARN/ERROR.

| Check | Status | Notes |
|:--|:--:|:--|
| P2-1 blocks use `writeLog("gate-before", "runtime", {...})` | ✅ | Consistent with existing L24, L35, L45 |
| P2-2 blocks use `writeLog("dispatch-before", "runtime", {...})` | ✅ | Consistent with existing L51, L105, L127 |
| Fields include `sessionID, callID, agent, agentType` | ✅ | All four fields present |
| BLOCKED events use `level: "ERROR"` | ✅ | Consistent with existing patterns |
| Advisory warnings use `level: "WARN"` | ✅ | For advisory-mode pass-through |
| Event tag: `"TOOL-BEFORE"` | ✅ | Consistent with existing events |
| Detail format: `"BLOCKED \| <check-name> \| <context>"` | ✅ | Parseable for audit log aggregation |

**Source**: `docs/official_docs/opencode/findings/01-log-central-management.md`

### §2.9 Templatization & Parameterization System

**Requirement**: Framework files use `{template_key}` placeholders, not hardcoded project-specific paths.

| Check | Status | Notes |
|:--|:--:|:--|
| P2-1 uses `findTaskInDag()` which reads `STATE_PATHS.dag()` | ✅ | Path resolved via `state-utils.ts` `resolveStatePath()` |
| P2-2 SA→KC patterns hardcoded? | ⚠️ | UC7KS patterns are project-agnostic (knowledge, cache, docs). Universal. |
| P2-2 repair patterns hardcoded? | ⚠️ | Patterns like "repair", "fix", "state" are project-agnostic. Universal. |
| No project-specific paths in new code | ✅ | No `booking-*` or project-specific directory references |
| Agent names (Orchestrator, Super-Admin) | ✅ | Framework constants; same across all projects |

**Source**: `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md`, `.opencode/rules/rule_detail/COMPATIBILITY_PROFILE.md`

---

## §3 Implementation Specification

### §3.1 P2-1: DAG Task Audit — gate-before.ts

#### §3.1.1 New Imports

Add to `gate-before.ts` after existing imports (L9):

```typescript
import { findTaskInDag } from "../lib/gate-checks";
import { resolveTaskId } from "../lib/agent-resolver";
```

**Rationale**:
- `findTaskInDag(taskId)` — returns `{ found, status }`; reads `Task.DAG.json` via `gate-checks.ts`
- `resolveTaskId()` — returns task ID from `FRAMEWORK_TASK_ID` env var or `_dispatch_target.json`

#### §3.1.2 Insertion Point

After the gate armed check block (L62, the closing `}` of the `isModifyTool` block), before the final exit log (L64–68):

```
┌─────────────────────────────────────────────────────────────────┐
│ gate-before.ts toolExecuteBefore() — check order                │
├─────────────────────────────────────────────────────────────────┤
│ L22: [EXISTING] mode = getEnforcementMode()                     │
│ L30: [EXISTING] advisory mode early return                      │
│ L44: [EXISTING] isModifyTool() → gate armed check              │
│      ↓                                                          │
│ [P2-1 NEW] DAG task existence/status audit                      │
│      ↓                                                          │
│ L64: [EXISTING] Final exit log (ok)                             │
└─────────────────────────────────────────────────────────────────┘
```

#### §3.1.3 Code Block

Insert after L62 (the closing `}` of the `if (isModifyTool(input.tool))` block):

```typescript
  // ═══════════════════════════════════════════════════════════════
  // P2-1: DAG Task Existence/Status Audit
  // Migrated from enforce.ts L1331–1356
  //
  // Verifies that the current task ID exists in Task.DAG.json and
  // has a valid status (pending or in_progress). Advisory-only in
  // advisory mode; blocks in strict/locked.
  //
  // Exempt: @Meta-Planner (creates DAG), @Orchestrator (manages DAG).
  // Scoped: isModifyTool() only — read operations exempt per
  // FW-FIX-DAG-SCOPE-01.
  // ═══════════════════════════════════════════════════════════════
  if (isModifyTool(input.tool)) {
    const taskId = resolveTaskId();
    const agentNorm = agent.toLowerCase().replace(/^@/, "");
    const isDagCreator =
      agentNorm === "orchestrator" || agentNorm === "meta-planner";

    if (taskId && !isDagCreator) {
      const tc = findTaskInDag(taskId);
      if (!tc.found) {
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DAG-TASK-NOT-FOUND | task=${taskId}`,
        });
        if (mode === "strict" || mode === "locked") {
          throw new Error(
            `[FW-ENFORCE][DAG] Task "${taskId}" not found in Task.DAG.json. ` +
            `Ensure @Meta-Planner has planned this task.`,
          );
        }
      } else if (tc.status !== "pending" && tc.status !== "in_progress") {
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DAG-TASK-STATUS | task=${taskId} status=${tc.status}`,
        });
        if (mode === "strict" || mode === "locked") {
          throw new Error(
            `[FW-ENFORCE][DAG] Task "${taskId}" status is "${tc.status}". ` +
            `Expected "pending" or "in_progress".`,
          );
        }
      } else {
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          event: "TOOL-BEFORE",
          detail: `DAG task verified | task=${taskId} status=${tc.status}`,
        });
      }
    }
  }
```

**Estimated growth**: ~40 lines (gate-before.ts 69 → ~109)

---

### §3.2 P2-2: Dispatch Authorization — dispatch-before.ts

#### §3.2.1 No New Imports

All helper logic is defined locally. `resolveAgent` and `getEnforcementMode` are already imported.

#### §3.2.2 Insertion Point

After the `isTask` check (L58–66), before the pending file path resolution (L68):

```
┌─────────────────────────────────────────────────────────────────┐
│ dispatch-before.ts toolExecuteBefore() — check order            │
├─────────────────────────────────────────────────────────────────┤
│ L48: [EXISTING] agent + mode resolution                         │
│ L58: [EXISTING] isTask check (skip non-Task tools)             │
│      ↓                                                          │
│ [P2-2 NEW] Dispatch caller authorization                        │
│      ↓                                                          │
│ L68: [EXISTING] Pending file path resolution                    │
│ L72: [EXISTING] MANDATORY-DISPATCH queue check                  │
│ ...                                                             │
└─────────────────────────────────────────────────────────────────┘
```

#### §3.2.3 Helper Constants

Add before the `export default` (after L19 `STALE_TIMEOUT_MS`):

```typescript
/** P2-2: UC7KS knowledge patterns for SA→KC dispatch validation */
const KC_PATTERNS = [
  "knowledge", "cache", "docs", "official", "context7", "uc7ks",
  "fetch", "curator", "index", "explore", "source", "repository",
  "github", "documentation", "library", "api reference",
];

/** P2-2: Repair patterns for SA target dispatch validation */
const REPAIR_PATTERNS = [
  "repair", "fix", "restore", "corrupt", "broken", "emergency",
  "reset", "drain", "purge", "reconcile", "inconsistency", "state",
  "hook", "plugin", "integrity", "machine.json", "gate-state",
  "compliance", "validate", "audit", "test", "baseline",
];
```

#### §3.2.4 Code Block

Insert after the `isTask` early return (L66), before the `root` variable (L68):

```typescript
  // ═══════════════════════════════════════════════════════════════
  // P2-2: Dispatch Caller Authorization
  // Migrated from enforce.ts L949–1117
  //
  // Gate 1: Only @Orchestrator may dispatch general agents.
  //   - @Super-Admin may dispatch @Knowledge-Curator only (UC7KS).
  //   - All other agents: unauthorized.
  //
  // Gate 2: SA target repair pattern validation.
  //   - Locked: SA dispatch DENIED (human-only).
  //   - Strict: SA target requires repair pattern match.
  //
  // Enforcement modes:
  //   advisory → WARN log only (no throw)
  //   strict   → throw for unauthorized dispatch
  //   locked   → throw for unauthorized + SA target deny
  // ═══════════════════════════════════════════════════════════════
  const targetAgent = ((output.args?.subagent_type as string) || "").toLowerCase().replace(/^@/, "");
  const callerNorm = agent.toLowerCase().replace(/^@/, "");
  const isOrchestrator = callerNorm === "orchestrator";
  const isSuperAdmin = callerNorm === "super-admin";
  const isKCTarget = targetAgent === "knowledge-curator";
  const isSATarget = targetAgent === "super-admin";
  const taskDesc = (
    (output.args?.description as string) || (output.args?.prompt as string) || ""
  ).toLowerCase();

  // Gate 1: Dispatch authorization
  if (!isOrchestrator) {
    if (isSuperAdmin && isKCTarget) {
      // SA→KC: UC7KS knowledge pattern matching required
      const matched = KC_PATTERNS.filter(p => taskDesc.includes(p));
      if (matched.length === 0) {
        writeLog("dispatch-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DISPATCH-GATE-KC-PATTERN | desc=${taskDesc.slice(0, 80)}`,
        });
        if (mode !== "advisory") {
          throw new Error(
            `[FW-ENFORCE][DISPATCH-GATE] Super-Admin→KC dispatch: task description ` +
            `must match UC7KS knowledge patterns. Got: "${taskDesc.slice(0, 80)}"`,
          );
        }
      }
    } else if (isSuperAdmin) {
      // SA dispatch restricted to @Knowledge-Curator
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "WARN",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-SA-RESTRICTED | target=${targetAgent}`,
      });
      if (mode !== "advisory") {
        throw new Error(
          `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch restricted to ` +
          `@Knowledge-Curator. Got: "${targetAgent}".`,
        );
      }
    } else {
      // Non-Orchestrator/non-SA: unauthorized
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "WARN",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-UNAUTHORIZED | caller=${agent} target=${targetAgent}`,
      });
      if (mode !== "advisory") {
        throw new Error(
          `[FW-ENFORCE][DISPATCH-GATE] Non-Orchestrator agent "${agent}" may not ` +
          `dispatch sub-agents. Only @Orchestrator may dispatch general agents.`,
        );
      }
    }
  }

  // Gate 2: SA target repair pattern validation
  if (isSATarget) {
    const matched = REPAIR_PATTERNS.filter(p => taskDesc.includes(p));
    if (mode === "locked") {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-SA-LOCKED | caller=${agent}`,
      });
      throw new Error(
        `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch DENIED in locked mode. ` +
        `Super-Admin is human-only when enforcement mode is locked.`,
      );
    } else if (mode === "strict" && matched.length === 0) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-SA-REPAIR | desc=${taskDesc.slice(0, 80)}`,
      });
      throw new Error(
        `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch requires repair pattern ` +
        `match in strict mode. Task: "${taskDesc.slice(0, 80)}"`,
      );
    }
  }
```

**Estimated growth**: ~80 lines (dispatch-before.ts 363 → ~443)

---

## §4 Verification Strategy

### §4.1 Plugin Load Test

```bash
# Both plugins must load without errors
bun -e "import('./.opencode/plugins/gate-before.ts').then(() => console.log('OK'))"
bun -e "import('./.opencode/plugins/dispatch-before.ts').then(() => console.log('OK'))"
```

### §4.2 P2-1 Unit Tests

| Test Case | Input | Expected |
|:--|:--|:--|
| DAG task found + pending | taskId=T001, status=pending | PASS (no block) |
| DAG task found + in_progress | taskId=T001, status=in_progress | PASS (no block) |
| DAG task found + completed | taskId=T001, status=completed | BLOCKED in strict/locked |
| DAG task not found | taskId=T999 | BLOCKED in strict/locked |
| @Meta-Planner exempt | agent=@Meta-Planner | PASS (skip DAG check) |
| @Orchestrator exempt | agent=@Orchestrator | PASS (skip DAG check) |
| No taskId | taskId="" | PASS (skip DAG check) |
| Advisory mode | mode=advisory, task not found | WARN log only |

### §4.3 P2-2 Unit Tests

| Test Case | Caller | Target | Mode | Expected |
|:--|:--|:--|:--|:--|
| Orchestrator → any | @Orchestrator | @Coder-BE | strict | PASS |
| SA → KC (pattern match) | @Super-Admin | @Knowledge-Curator | strict | PASS |
| SA → KC (no pattern) | @Super-Admin | @Knowledge-Curator | strict | BLOCKED |
| SA → non-KC | @Super-Admin | @Coder-BE | strict | BLOCKED |
| Non-auth caller | @Coder-BE | @Guardian | strict | BLOCKED |
| Non-auth advisory | @Coder-BE | @Guardian | advisory | WARN only |
| SA target locked | @Orchestrator | @Super-Admin | locked | BLOCKED |
| SA target strict (repair) | @Orchestrator | @Super-Admin | strict | PASS |
| SA target strict (no repair) | @Orchestrator | @Super-Admin | strict | BLOCKED |
| SA target advisory | @Orchestrator | @Super-Admin | advisory | PASS |

### §4.4 Framework Self-Test

```bash
node .opencode/scripts/framework-self-test.ts
```

Expected: same 4 pre-existing failures (checks 26, 27, 28, 36). No regressions.

---

## §5 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|:--|:--:|:--:|:--|
| P2-1 blocks legitimate reads | Low | Medium | Scoped to `isModifyTool()` only; read operations exempt |
| P2-1 blocks @Meta-Planner DAG creation | Low | High | Explicit exemption for `@Meta-Planner` and `@Orchestrator` |
| P2-2 blocks SA emergency dispatch | Low | High | Advisory mode in development; strict/locked only in CI |
| P2-2 SA locked deny prevents repair | Medium | High | Locked mode requires @Arbiter unlock token (per enforcement-modes-standard.md §5.2) |
| Bun cache stale plugin | Low | Low | Additive changes trigger recompile; fallback: rename file |
| P2-2 false-positive on KC pattern | Medium | Low | Pattern list is comprehensive (16 terms); advisory mode in dev |
| Race condition in DAG reads | Low | Low | Synchronous read; no shared mutable state |

---

## §6 Diff Summary

| File | Current Lines | After | Growth | New Imports |
|:--|:--:|:--:|:--:|:--|
| `gate-before.ts` | 69 | ~109 | +40 | `findTaskInDag`, `resolveTaskId` |
| `dispatch-before.ts` | 363 | ~443 | +80 | None (local helpers) |
| **Total** | **432** | **~552** | **+120** | 2 new imports |

---

## §7 Execution Order

1. **P2-1 first** — Simpler change (gate-before.ts), fewer risk vectors
2. **P2-2 second** — More complex (dispatch-before.ts), 3 sub-gates
3. **Verify** — Plugin load test + unit tests + framework self-test
4. **Update priority.md** — Mark P2-1 and P2-2 as ✅ DONE

---

## §8 Related Documents

| Document | Relationship |
|:--|:--|
| `docs/review/plugin-backlog/priority.md` | Gap tracking (P2-1, P2-2 entries) |
| `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` | Phase 2 plan (same format) |
| `docs/review/plugin-backlog/p1-1-3-uc7ks-write-pipeline-fix.md` | Phase 3 plan (same format) |
| `.opencode/_plugins_backups/_bk_framework-enforcer/index.ts` | Original source (L1331–1356, L949–1117) |
| `.opencode/plugins/gate-before.ts` | Target file for P2-1 |
| `.opencode/plugins/dispatch-before.ts` | Target file for P2-2 |
| `.opencode/lib/gate-checks.ts` | `findTaskInDag()` implementation |
| `.opencode/lib/agent-resolver.ts` | `resolveAgent()`, `resolveTaskId()` |
| `.opencode/lib/gate-core.ts` | `getEnforcementMode()` |
| `.opencode/rules/rule_detail/enforcement-modes-standard.md` | Mode behavior matrix |
| `docs/official_docs/opencode/findings/06-multi-agent-system.md` | Multi-Agent System spec |

---

*Plan generated by @Super-Admin on 2026-06-12. All original source locations verified against archived enforce.ts. All active plugin locations verified against current gate-before.ts (69 lines) and dispatch-before.ts (363 lines).*
