# P0-3/P0-4/P0-5: ROUTE-MISMATCH + Write Scope — Implementation Plan

**Created**: 2026-06-12
**Author**: @Super-Admin
**Priority**: P0 (CRITICAL) — Phase 2 of plugin-backlog priority.md
**Status**: Planned — awaiting execution
**Related**: `docs/review/plugin-backlog/priority.md` (P0-3, P0-4, P0-5, P1-2, P1-4 entries)
**Replaces**: Archived `enforce.ts` L1370–1478 (ROUTE-MISMATCH + isWriteAllowed)

---

## §1 Problem Statement

Three security-critical write-scope checks from the archived monolithic `enforce.ts` were **never migrated** to the decomposed plugin system. Without them:

| Gap | Original Location | Current Status | Risk |
|:--|:--|:--|:--|
| **P0-3** | `enforce.ts` L1370–1398 | ❌ NOT in `scope-before.ts` | @Architect/@Orchestrator can modify `.opencode/`, `opencode.json`, `AGENTS.md` |
| **P0-4** | `enforce.ts` L1400–1425 | ❌ NOT in `scope-before.ts` | @Super-Admin can modify business source code (`booking-*/src/`) |
| **P0-5** | `enforce.ts` L1457–1478 | ⚠️ `isWriteAllowed()` exists in `gate-checks.ts` L92–109 but is called ONLY from `write-audit-lib.ts` L53 — **not from scope-before.ts** | All agents can write to paths outside their `agent_write_scopes` |

### Current `scope-before.ts` (72 lines) — Only One Check

```
1. [EXISTING] Tool scope check (isToolAllowed via agent_dispatch_allowed_tools)
2. ← NOTHING ELSE ← All path-based scope checks are missing
```

### Target `scope-before.ts` (~200 lines) — Six Checks

```
1. [EXISTING] Tool scope check (isToolAllowed)
2. [P0-3 NEW] ROUTE-MISMATCH: Architect/Orchestrator → .opencode/
3. [P0-4 NEW] ROUTE-MISMATCH: Super-Admin → business code
4. [P1-2 NEW] UC7-008: Knowledge-Curator scope isolation
5. [P0-5 NEW] isWriteAllowed() path scope check
6. [P1-4 NEW] UC7-005: Cache size cap (docs/official_docs/)
```

### Bug Fix vs Original

The original `enforce.ts` L1327–1328 had a **Super-Admin bypass** that returned early, skipping ALL checks below (including P0-4 and P0-5):

```typescript
// enforce.ts L1327-1328 (BUG — P0-4 was dead code)
if (resolvedAgent === "@Super-Admin" || resolvedAgent === "Super-Admin") {
    return; // Skip DAG gate + ROUTE-MISMATCH + write scope for emergency repairs
}
```

This meant the SA → business code check (P0-4) at L1400–1425 **never executed** for Super-Admin. The migration will **fix this bug** by removing the blanket SA bypass and enforcing P0-3/P0-4/P0-5 for ALL agents. Emergency bypass remains available via `ENFORCEMENT_MODE=advisory`.

---

## §2 Framework Compliance Matrix

### §2.1 Layout Architecture System

**Requirement**: `.opencode/plugins/*.ts` files are auto-discovered. Shared code in `.opencode/lib/`. No new plugin files.

| Check | Status | Notes |
|:--|:--:|:--|
| No new plugin files created | ✅ | Extends existing `scope-before.ts` only |
| New import from `../lib/gate-checks.ts` | ✅ | `isWriteAllowed` already exported; `gate-checks.ts` is in `.opencode/lib/` (not plugin scan path) |
| New import from `../lib/state-utils.ts` | ✅ | `isModifyShell` pattern needed for safe_shell guard |
| Flat structure preserved | ✅ | All logic in single `scope-before.ts` |
| No INDEX_FILES violation | ✅ | Not a directory plugin; single file |

**Source**: `docs/official_docs/opencode/findings/04-layout-architecture.md`

### §2.2 Permission Matrix System

**Requirement**: Agent write scopes enforced by `project.config.json` → `agent_write_scopes`. Tool-level permissions via `opencode.json` → `permissions`.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-3 uses agent name matching (not permission keys) | ✅ | Agent identity from `resolveAgent()`, not from permission system |
| P0-4 uses hardcoded business paths (mirrors `agent_write_scopes.@Super-Admin.denied`) | ✅ | Paths identical to `project.config.json` L830–832 |
| P0-5 delegates to `isWriteAllowed()` which reads `agent_write_scopes` | ✅ | Single source of truth: `project.config.json` |
| P1-2 KC scope mirrors `agent_write_scopes.@Knowledge-Curator` | ✅ | Paths identical to `project.config.json` L836–853 |
| No permission escalation | ✅ | We only throw errors or return; no config modification |

**Source**: `docs/official_docs/opencode/findings/03-permission-matrix.md`

### §2.3 Concurrent Session/Dispatch Write System

**Requirement**: `.pending.json` queue is the dispatch proof. Sub-agent identity from `_dispatch_target.json`.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-3/P0-4/P0-5 fire per tool.execute.before call | ✅ | Each write attempt checked independently |
| Agent identity from `resolveAgent(sessionID)` | ✅ | Reads `_dispatch_target.json` (P0-6/P0-7 done) + session map |
| No state file writes | ✅ | All checks are read-only (no machine.json/gate-state.json modification) |
| `safe_shell` guard via `isModifyShell()` | ✅ | Only cp/mv/rm commands checked for path scope; other shell commands exempt |
| Race condition risk | ✅ None | All checks are synchronous reads of file paths and config |

**Source**: `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.4 Hardened Enforcement System

**Requirement**: All enforcement checks must use `getEnforcementMode()` from `gate-core.ts`. Three modes: advisory (warn), strict (block), locked (block + no bypass).

| Check | Status | Notes |
|:--|:--:|:--|
| `getEnforcementMode()` already imported | ✅ | `scope-before.ts` L9 |
| `mode` variable already available | ✅ | L22: `const mode = getEnforcementMode()` |
| All new checks use `if (mode === "strict" \|\| mode === "locked") throw` | ✅ | Consistent with existing tool-allowed check at L63 |
| Advisory mode: all checks log WARN only, no throw | ✅ | Pattern: `writeLog(ERROR)` + `if (strict\|\|locked) throw; return;` |
| No hardcoded `const mode = "strict"` | ✅ | Dynamic mode from `gate-core.ts` (P0-1 fix pattern) |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`, `.opencode/rules/rule_detail/enforcement-modes-standard.md`

### §2.5 Harness System

**Requirement**: Plugins use `export default`, hooks defined locally, no imported function references in return. Bun cache considerations.

| Check | Status | Notes |
|:--|:--:|:--|
| `export default` pattern preserved | ✅ | Unchanged |
| Hook function `toolExecuteBefore` defined locally | ✅ | All new logic inside existing function body |
| No new hook events registered | ✅ | All checks inside existing `tool.execute.before` handler |
| Imports from `../lib/` only | ✅ | `gate-checks.ts`, `state-utils.ts` — not in plugin scan path |
| Bun cache: additive changes (new imports, new code blocks) | ✅ | Large changes (new functions/logic) usually trigger recompile; if not, rename file |
| No `require()` calls | ✅ | ESM `import` syntax only |

**Source**: `docs/official_docs/framework/plugin-programming-conventions.md`, `docs/official_docs/opencode/findings/02-harness-system.md`

### §2.6 Central State Management

**Requirement**: `machine.json` is the single source of truth. State writes must be atomic. No unauthorized state modifications.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-3/P0-4 writes to `machine.json`? | ❌ No | Read-only checks; no state modification |
| P0-5 modifies `machine.json`? | ❌ No | `isWriteAllowed()` reads `project.config.json` only |
| P1-2 modifies `machine.json`? | ❌ No | Path-based check, no state writes |
| P1-4 modifies `machine.json`? | ❌ No | Content size check, no state writes |
| `project.config.json` reads are safe? | ✅ | Read-only via `readJsonFile()` in `gate-checks.ts` |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`

### §2.7 Multi-Agent System

**Requirement**: Agent identity resolution, dispatch protocol, per-agent scope isolation.

| Check | Status | Notes |
|:--|:--:|:--|
| Agent resolution via `resolveAgent(sessionID)` | ✅ | Priority 1: `_dispatch_target.json`; Priority 2: session map |
| Agent normalization: `toLowerCase().replace(/^@/, "")` | ✅ | Matches pattern in `dispatch-before.ts` L150, L258 |
| Unresolved agent handling | ✅ | If `agent === ""`, `isWriteAllowed("", fp)` returns `true` (no scopes for ""). **Must add explicit block for unresolved agents.** |
| `@Super-Admin` wildcard `["*"]` in `agent_dispatch_allowed_tools` | ✅ | SA passes tool-allowed check (L53–65) for all tools; P0-4 then restricts WHERE |
| `@Knowledge-Curator` scope isolation | ✅ | P1-2 mirrors `agent_write_scopes.@Knowledge-Curator` |

**Source**: `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.8 Log Central Management System

**Requirement**: Plugin logging via `writeLog(pluginId, category, fields)`. Three categories: `"loaded"`, `"hooks"`, `"runtime"`. Levels: DEBUG/INFO/WARN/ERROR.

| Check | Status | Notes |
|:--|:--:|:--|
| All new blocks use `writeLog("scope-before", "runtime", {...})` | ✅ | Consistent with existing L24, L35, L45, L57, L67 |
| Fields include `sessionID, callID, agent, agentType` | ✅ | All four fields present in every writeLog call |
| BLOCKED events use `level: "ERROR"` | ✅ | Consistent with existing tool-allowed block at L59 |
| Advisory warnings use `level: "WARN"` | ✅ | For advisory-mode pass-through |
| Event tag: `"TOOL-BEFORE"` | ✅ | Consistent with existing events |
| Detail format: `"BLOCKED \| <check-name> \| <context>"` | ✅ | Parseable for audit log aggregation |

**Source**: `docs/official_docs/opencode/findings/01-log-central-management.md`

### §2.9 Templatization & Parameterization System

**Requirement**: Framework files use `{template_key}` placeholders, not hardcoded project-specific paths.

| Check | Status | Notes |
|:--|:--:|:--|
| P0-4 business paths hardcoded? | ⚠️ | `"booking_system_refactor/booking-backend/src/"` is project-specific. **Mitigation**: These are the EXACT same paths in `project.config.json` L830–832 and `Super-Admin.md` L40–42. Templating these would require a new `{backend.src}` + `{frontend.src}` resolution in the plugin — out of scope for P0 fix. Documented as tech debt. |
| P1-2 KC paths hardcoded? | ⚠️ | `"docs/official_docs/"` is project-specific. **Mitigation**: Same paths in `project.config.json` L838–840. Universally applicable for any project using UC7KS. |
| `.opencode/` and `opencode.json` in P0-3? | ✅ | These are framework constants, not project-specific |
| `isWriteAllowed()` reads paths from `project.config.json` | ✅ | Fully parameterized via `agent_write_scopes` |

**Source**: `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md`, `.opencode/rules/rule_detail/COMPATIBILITY_PROFILE.md`

---

## §3 Implementation Specification

### §3.1 New Imports

Add to `scope-before.ts` after existing imports (L8):

```typescript
import { isWriteAllowed } from "../lib/gate-checks";
import { isModifyShell } from "../lib/tool-scope";
```

**Rationale**:
- `isWriteAllowed(agentType, filePath)` — P0-5 core function; reads `project.config.json` → `agent_write_scopes`
- `isModifyShell(args)` — Guards `safe_shell` commands; returns `true` only for `cp`/`mv`/`rm` commands

### §3.2 Execution Order

After the existing tool-allowed check (L53–65) and before the final exit log (L67–71), insert 5 new check blocks in this exact order:

```
┌─────────────────────────────────────────────────────────────────┐
│ scope-before.ts toolExecuteBefore() — check order              │
├─────────────────────────────────────────────────────────────────┤
│ L34: [EXISTING] isModifyTool() early return for non-modify     │
│ L43: [EXISTING] getModifyPath() early return for no file path  │
│ L53: [EXISTING] Tool scope check (isToolAllowed)               │
│      ↓                                                         │
│ [P0-3] ROUTE-MISMATCH: Architect/Orchestrator → .opencode/     │
│      ↓                                                         │
│ [P0-4] ROUTE-MISMATCH: Super-Admin → business code             │
│      ↓                                                         │
│ [P1-2] UC7-008: Knowledge-Curator scope isolation              │
│      ↓                                                         │
│ [P0-5] Unresolved agent guard + isWriteAllowed()               │
│      ↓                                                         │
│ [P1-4] UC7-005: Cache size cap                                 │
│      ↓                                                         │
│ L67: [EXISTING] Final exit log (ok)                            │
└─────────────────────────────────────────────────────────────────┘
```

**Order rationale**:
1. ROUTE-MISMATCH checks (P0-3/P0-4) run FIRST — they provide coarse, explicit error messages before the generic `isWriteAllowed` check
2. UC7-008 (P1-2) runs before `isWriteAllowed` — KC has a specific scope that differs from the general `agent_write_scopes` pattern
3. `isWriteAllowed` (P0-5) runs after ROUTE-MISMATCH — defense-in-depth with finer granularity
4. UC7-005 (P1-4) runs LAST — it checks content size, which is only relevant after the path is authorized

### §3.3 safe_shell Guard Pattern

For `safe_shell` tool, `getModifyPath()` returns `args.command` (the shell command string, not a file path). Applying ROUTE-MISMATCH and `isWriteAllowed` to arbitrary command strings produces false positives (e.g., `"cat .opencode/state/machine.json"` would match `.opencode/`).

**Solution**: Apply an `applyScope` guard (mirrors `enforce.ts` L1426–1430):

```typescript
// Compute applyScope once, before P0-3
const applyPathScope =
  input.tool !== "safe_shell"
    ? true
    : isModifyShell(output.args || {});
```

- For `write`, `edit`, `safe_edit`, `safe_mkdir`, `safe_delete`: `applyPathScope = true` (always check)
- For `safe_shell`: `applyPathScope = true` only if command starts with `cp`/`mv`/`rm`; otherwise `false` (skip path checks)

All 5 new check blocks are wrapped in `if (applyPathScope)`.

### §3.4 Detailed Code Blocks

#### Block 1: P0-3 — ROUTE-MISMATCH: Architect/Orchestrator → .opencode/

```typescript
  // ═══════════════════════════════════════════════════════════════
  // P0-3 ROUTE-MISMATCH: Architect/Orchestrator → framework files
  // Migrated from enforce.ts L1370-1398 (FW-ROUTE-FIX-04)
  //
  // @Architect and @Orchestrator must NOT modify framework infra.
  // Framework files: .opencode/**, opencode.json, AGENTS.md
  // Route to @Super-Admin for framework changes.
  // ═══════════════════════════════════════════════════════════════
  if (applyPathScope) {
    const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
    if (agentNorm === "architect" || agentNorm === "orchestrator") {
      if (filePath.includes(".opencode/") || filePath === "opencode.json" || filePath.includes("AGENTS.md")) {
        const msg =
          `[FW-ENFORCE][ROUTE-MISMATCH] ${agent} has no authority to modify ` +
          `framework files (${filePath}). Framework infrastructure is ` +
          `administered by @Super-Admin. Auto-route this task to @Super-Admin.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | ROUTE-MISMATCH | framework-file | agent=${agent} file=${filePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return; // advisory: logged, pass through
      }
    }
```

#### Block 2: P0-4 — ROUTE-MISMATCH: Super-Admin → business code

```typescript
    // ═══════════════════════════════════════════════════════════════
    // P0-4 ROUTE-MISMATCH: Super-Admin → business code
    // Migrated from enforce.ts L1400-1425 (FW-ROUTE-FIX-04)
    // FIX: Original enforce.ts had SA bypass at L1327 that made this
    // check dead code. Migration removes the bypass — SA is now
    // subject to business code restriction.
    //
    // Business paths mirror project.config.json agent_write_scopes
    // @Super-Admin.denied (L830-832).
    // ═══════════════════════════════════════════════════════════════
    if (agentNorm === "super-admin") {
      const businessPaths = [
        "booking_system_refactor/booking-backend/src/",
        "booking_system_refactor/booking-frontend/src/",
        "booking_system_refactor/booking-backend/prisma/schema.prisma",
      ];
      for (const bp of businessPaths) {
        if (filePath.includes(bp)) {
          const msg =
            `[FW-ENFORCE][ROUTE-MISMATCH] Super-Admin has no authority to ` +
            `modify business code (${filePath}). Business code modifications ` +
            `must be handled by @Coder-BE or @Coder-FE.`;
          writeLog("scope-before", "runtime", {
            sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
            level: "ERROR", event: "TOOL-BEFORE",
            detail: `BLOCKED | ROUTE-MISMATCH | SA→business | file=${filePath}`,
          });
          if (mode === "strict" || mode === "locked") throw new Error(msg);
          return; // advisory: logged, pass through
        }
      }
    }
```

#### Block 3: P1-2 — UC7-008: Knowledge-Curator scope isolation

```typescript
    // ═══════════════════════════════════════════════════════════════
    // P1-2 UC7-008: Knowledge-Curator Scope Isolation
    // Migrated from enforce.ts (archived) + UC7KS-PIPELINE-STANDARD §3.8
    //
    // KC may ONLY write to:
    //   docs/official_docs/**, .metadata/**, .task_temp/**
    // KC is DENIED from:
    //   .opencode/**, booking_system_refactor/**, project.config.json,
    //   opencode.json, Task.DAG.json
    // ═══════════════════════════════════════════════════════════════
    if (agentNorm === "knowledge-curator") {
      const kcAllowed =
        filePath.includes("docs/official_docs/") ||
        filePath.includes(".metadata/") ||
        filePath.includes(".task_temp/");
      if (!kcAllowed) {
        const msg =
          `[FW-ENFORCE][UC7-008] Knowledge-Curator scope violation: ` +
          `cannot write to "${filePath}". ` +
          `Allowed: docs/official_docs/**, .metadata/**, .task_temp/**.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-008 | file=${filePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return; // advisory: logged, pass through
      }
    }
```

#### Block 4: P0-5 — Unresolved agent guard + isWriteAllowed()

```typescript
    // ═══════════════════════════════════════════════════════════════
    // P0-5 Write PATH Scope Check (isWriteAllowed)
    // Migrated from enforce.ts L1457-1478
    //
    // isWriteAllowed() reads project.config.json → agent_write_scopes
    // and checks denied patterns first, then allowed patterns.
    //
    // FIX: Also blocks writes when agent identity is unresolved
    // (empty string, "1", or "human") — mirrors enforce.ts L1459-1468.
    // Without this, isWriteAllowed("", fp) returns true (no scopes
    // defined for empty agent) — security hole.
    // ═══════════════════════════════════════════════════════════════
    if (!agent || agent === "1" || agent === "human") {
      const msg =
        `[FW-ENFORCE] Agent identity unresolved — write to "${filePath}" ` +
        `BLOCKED. Agent="" (resolveAgent returned no identity). ` +
        `This indicates a dispatch mechanism failure. ` +
        `Use human dispatch (@Super-Admin) to repair or set ` +
        `FW_PROMPT_QUEUE_DRAIN=true.`;
      writeLog("scope-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-BEFORE",
        detail: `BLOCKED | UNRESOLVED-AGENT | file=${filePath}`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return; // advisory: logged, pass through
    }

    if (!isWriteAllowed(agent, filePath)) {
      const msg =
        `[FW-ENFORCE][WRITE-SCOPE] Agent "${agent}" write to "${filePath}" ` +
        `blocked by agent_write_scopes in project.config.json.`;
      writeLog("scope-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-BEFORE",
        detail: `BLOCKED | WRITE-SCOPE | agent=${agent} file=${filePath}`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return; // advisory: logged, pass through
    }
```

#### Block 5: P1-4 — UC7-005: Cache size cap

```typescript
    // ═══════════════════════════════════════════════════════════════
    // P1-4 UC7-005: Knowledge Cache Size Cap
    // Migrated from UC7KS-PIPELINE-STANDARD §3.5
    //
    // Max single file: 500KB (524288 bytes).
    // Only applies to writes targeting docs/official_docs/.
    // Content extracted from write/edit tool args.
    // ═══════════════════════════════════════════════════════════════
    if (filePath.includes("docs/official_docs/")) {
      const content = ((output.args?.content || output.args?.newString || "") as string);
      if (content && content.length > 524288) {
        const msg =
          `[FW-ENFORCE][UC7-005] Knowledge cache file exceeds 500KB limit: ` +
          `"${filePath}" (${content.length} bytes > 524288). ` +
          `Split into smaller chunks or compress.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-005 | size=${content.length} | file=${filePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return; // advisory: logged, pass through
      }
    }
  } // end if (applyPathScope)
```

### §3.5 Complete Modified File

The modified `scope-before.ts` will be ~200 lines, structured as:

```
L1-8:   [UNCHANGED] Imports (add: isWriteAllowed, isModifyShell)
L9:     [UNCHANGED] import { getEnforcementMode } from "../lib/gate-core";
L10:    [NEW] import { isWriteAllowed } from "../lib/gate-checks";
L11:    [NEW] import { isModifyShell } from "../lib/tool-scope";
L12-18: [UNCHANGED] ensureLogDir, writeLog, updateIndex, export default
L20-31: [UNCHANGED] toolExecuteBefore() entry — resolveAgent, mode, initial log
L33-41: [UNCHANGED] isModifyTool() early return
L43-51: [UNCHANGED] getModifyPath() early return
L52:    [NEW] const applyPathScope = input.tool !== "safe_shell" ? true : isModifyShell(output.args || {});
L53-65: [UNCHANGED] Tool scope check (isToolAllowed)
L66+:   [NEW] Block 1: P0-3 ROUTE-MISMATCH Architect/Orchestrator
L66+:   [NEW] Block 2: P0-4 ROUTE-MISMATCH Super-Admin
L66+:   [NEW] Block 3: P1-2 UC7-008 KC scope
L66+:   [NEW] Block 4: P0-5 Unresolved agent + isWriteAllowed
L66+:   [NEW] Block 5: P1-4 UC7-005 cache size cap
L~195:  [UNCHANGED] Final exit log (ok)
```

### §3.6 Known Configuration Issue

**@Guardian `agent_write_scopes` conflict**: `project.config.json` L768–781 has:
- `allowed`: `.opencode/state/machine.json`, `.opencode/state/gate-state.json`
- `denied`: `.opencode/**` (broader pattern)

`isWriteAllowed()` checks denied FIRST → `.opencode/**` matches `.opencode/state/machine.json` → returns `false`. The explicitly allowed state files are blocked by the broader denied pattern.

**Impact**: @Guardian cannot write to `machine.json` or `gate-state.json` when P0-5 is active.

**Fix required** (separate task): Remove `.opencode/**` from @Guardian's denied list, or narrow it to `.opencode/agents/**`, `.opencode/rules/**`, `.opencode/scripts/**`, `.opencode/plugins/**`.

**Workaround for this plan**: P0-5 will faithfully enforce the current config. The @Guardian config fix is tracked as a follow-up.

---

## §4 Cross-Reference: Original vs Migrated Logic

### §4.1 Line-by-Line Comparison

| enforce.ts | scope-before.ts (new) | Change |
|:--|:--|:--|
| L1327–1328: SA bypass `return` | **REMOVED** | Bug fix — SA now subject to all checks |
| L1370–1398: ROUTE-MISMATCH Arch/Orch | Block 1 (P0-3) | Identical logic, added writeLog |
| L1400–1425: ROUTE-MISMATCH SA→business | Block 2 (P0-4) | Identical logic, now reachable (SA bypass removed) |
| L1459–1468: Unresolved agent guard | Block 4 (P0-5 first half) | Identical logic |
| L1469–1477: `isWriteAllowed()` check | Block 4 (P0-5 second half) | Identical logic, moved from `violations.push` to `throw` |
| L1426–1430: `applyScope` (safe_shell guard) | `applyPathScope` variable | Identical logic |
| L1244–1263: UC7-008 KC scope | Block 3 (P1-2) | **NEW** — not in original enforce.ts scope section; sourced from UC7KS standard |
| L1266–1284: UC7-005 size cap | Block 5 (P1-4) | **NEW** — not in original enforce.ts scope section; sourced from UC7KS standard |

### §4.2 Differences from Original

| Aspect | Original enforce.ts | New scope-before.ts | Reason |
|:--|:--|:--|:--|
| SA bypass | `return` at L1327 (skip all) | **No bypass** | Bug fix — P0-4 was dead code |
| Error format | `[FW-ENFORCE] ...` | `[FW-ENFORCE][ROUTE-MISMATCH] ...` | More specific tags for audit parsing |
| Advisory handling | `logAuditEntry()` + `return` | `writeLog(WARN)` + `return` | Uses framework log system v2.0 |
| Violation batching | Collects all violations, throws once | Throws on first violation | Simpler; each check is independent |
| safe_shell guard | `applyScope` variable | `applyPathScope` variable | Renamed for clarity |
| UC7-008/UC7-005 | Not in scope section | Added to scope-before.ts | Consolidation of all write-scope checks |

---

## §5 Risk Assessment

### §5.1 Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|:--|:--:|:--:|:--|
| SA bypass removal breaks emergency repairs | High | Low | Emergency bypass available via `ENFORCEMENT_MODE=advisory` or `FW_PROMPT_QUEUE_DRAIN=true` |
| @Guardian `agent_write_scopes` conflict blocks state writes | Medium | High | Known issue §3.6; requires separate config fix |
| safe_shell false positive (non-cp/mv/rm command blocked) | Low | Very Low | `applyPathScope` guard ensures only cp/mv/rm are checked |
| `isWriteAllowed()` config read failure | Low | Very Low | `readJsonFile()` returns `null` on failure → `isWriteAllowed` returns `true` (permissive fallback) |
| Bun cache serves stale bytecode | Medium | Medium | Additive changes (new imports + ~130 lines) usually trigger recompile. Fallback: rename file |
| P0-4 business paths become stale after project rename | Low | Low | Paths match `project.config.json` L830–832; rename requires config update anyway |

### §5.2 Rollback Plan

If any check causes unexpected blocks:

1. **Immediate**: Set `ENFORCEMENT_MODE=advisory` in environment → all checks become warn-only
2. **Targeted**: Comment out specific block in `scope-before.ts`
3. **Full rollback**: `git checkout -- .opencode/plugins/scope-before.ts`

---

## §6 Verification Plan

### §6.1 Pre-Execution Verification

```bash
# 1. Plugin loading test
bun run -e "import('./.opencode/plugins/scope-before.ts').then(() => console.log('OK')).catch(e => console.error('FAIL:', e.message))"

# 2. Import resolution test
bun run -e "
  const { isWriteAllowed } = await import('./.opencode/lib/gate-checks.ts');
  const { isModifyShell } = await import('./.opencode/lib/tool-scope.ts');
  console.log('isWriteAllowed:', typeof isWriteAllowed);
  console.log('isModifyShell:', typeof isModifyShell);
"

# 3. Enforcement mode test
bun run -e "
  const { getEnforcementMode } = await import('./.opencode/lib/gate-core.ts');
  console.log('Mode:', getEnforcementMode());
"
```

### §6.2 Functional Verification

```bash
# 4. P0-3 test: Architect → .opencode/ should be blocked
bun run -e "
  const { isWriteAllowed } = await import('./.opencode/lib/gate-checks.ts');
  console.log('Architect → .opencode/agents/test.md:', isWriteAllowed('@Architect', '.opencode/agents/test.md'));
  // Expected: false (denied by .opencode/agents/** pattern)
"

# 5. P0-4 test: Super-Admin → business code should be blocked
bun run -e "
  const { isWriteAllowed } = await import('./.opencode/lib/gate-checks.ts');
  console.log('SA → booking-backend/src/main.ts:', isWriteAllowed('@Super-Admin', 'booking_system_refactor/booking-backend/src/main.ts'));
  // Expected: false (denied by booking_system_refactor/booking-backend/src/** pattern)
"

# 6. P0-5 test: Coder-BE → .opencode/ should be blocked
bun run -e "
  const { isWriteAllowed } = await import('./.opencode/lib/gate-checks.ts');
  console.log('Coder-BE → .opencode/rules/test.md:', isWriteAllowed('@Coder-BE', '.opencode/rules/test.md'));
  // Expected: false (denied by .opencode/rules/** pattern)
"

# 7. P1-2 test: KC → .opencode/ should be blocked
bun run -e "
  const { isWriteAllowed } = await import('./.opencode/lib/gate-checks.ts');
  console.log('KC → .opencode/agents/test.md:', isWriteAllowed('@Knowledge-Curator', '.opencode/agents/test.md'));
  // Expected: false (denied by .opencode/agents/** pattern)
"

# 8. safe_shell guard test
bun run -e "
  const { isModifyShell } = await import('./.opencode/lib/tool-scope.ts');
  console.log('rm -rf:', isModifyShell({ command: 'rm -rf /tmp/test' }));    // true
  console.log('cp file:', isModifyShell({ command: 'cp a.ts b.ts' }));        // true
  console.log('npm install:', isModifyShell({ command: 'npm install' }));      // false
  console.log('cat file:', isModifyShell({ command: 'cat .opencode/x' }));     // false
"
```

### §6.3 Integration Verification

```bash
# 9. Framework self-test
node .opencode/scripts/framework-self-test.ts

# 10. All 16 plugins load test
for f in .opencode/plugins/*.ts; do
  [[ "$f" == *.bak ]] && continue
  echo -n "Testing $(basename $f)... "
  bun run -e "import('$f').then(() => console.log('OK')).catch(e => console.error('FAIL:', e.message))" 2>&1 | head -1
done
```

---

## §7 Effort Estimate

| Item | Lines Added | Lines Modified | Risk |
|:--|:--:|:--:|:--:|
| New imports | 2 | 0 | Low |
| `applyPathScope` variable | 3 | 0 | Low |
| Block 1: P0-3 ROUTE-MISMATCH | ~20 | 0 | Low |
| Block 2: P0-4 ROUTE-MISMATCH | ~22 | 0 | Low |
| Block 3: P1-2 UC7-008 | ~20 | 0 | Low |
| Block 4: P0-5 unresolved agent + isWriteAllowed | ~32 | 0 | Medium (§3.6 Guardian config issue) |
| Block 5: P1-4 UC7-005 | ~18 | 0 | Low |
| Final exit log adjustment | 0 | 1 | Low |
| **Total** | **~117** | **1** | — |

**Estimated scope-before.ts growth**: 72 → ~190 lines

---

## §8 Related Documents

| Document | Relationship |
|:--|:--|
| `docs/review/plugin-backlog/priority.md` | Gap definitions (P0-3, P0-4, P0-5, P1-2, P1-4) |
| `.opencode/_plugins_backups/_bk_framework-enforcer/enforce.ts` | Original ROUTE-MISMATCH logic (L1370–1478) |
| `.opencode/lib/gate-checks.ts` | `isWriteAllowed()` function (L92–109) |
| `.opencode/lib/tool-scope.ts` | `isModifyShell()` function (L14–16) |
| `.opencode/lib/state-utils.ts` | `STATE_PATHS`, `isBusinessSourceFile()` |
| `.opencode/project.config.json` | `agent_write_scopes` (L678–854) |
| `.opencode/rules/rule_detail/UC7KS-PIPELINE-STANDARD.md` | UC7-005 (§3.5), UC7-008 (§3.8) definitions |
| `.opencode/rules/rule_detail/enforcement-modes-standard.md` | Mode behavior matrix |
| `docs/official_docs/framework/plugin-programming-conventions.md` | Plugin coding conventions |
| `docs/official_docs/opencode/findings/02-harness-system.md` | Hook chaining, export format |
| `docs/review/plugin-backlog/p0-6-7-agent-propagation-fix.md` | Format reference for this document |

---

## §9 Appendix: Enforcement Mode Behavior

| Check | Advisory | Strict | Locked |
|:--|:--|:--|:--|
| P0-3 ROUTE-MISMATCH (Arch/Orch) | ⚠️ WARN log, allow | ❌ throw `[FW-ENFORCE][ROUTE-MISMATCH]` | ❌ throw (no bypass) |
| P0-4 ROUTE-MISMATCH (SA→business) | ⚠️ WARN log, allow | ❌ throw `[FW-ENFORCE][ROUTE-MISMATCH]` | ❌ throw (no bypass) |
| P1-2 UC7-008 (KC scope) | ⚠️ WARN log, allow | ❌ throw `[FW-ENFORCE][UC7-008]` | ❌ throw (no bypass) |
| P0-5 Unresolved agent | ⚠️ WARN log, allow | ❌ throw `[FW-ENFORCE]` | ❌ throw (no bypass) |
| P0-5 isWriteAllowed | ⚠️ WARN log, allow | ❌ throw `[FW-ENFORCE][WRITE-SCOPE]` | ❌ throw (no bypass) |
| P1-4 UC7-005 (size cap) | ⚠️ WARN log, allow | ❌ throw `[FW-ENFORCE][UC7-005]` | ❌ throw (no bypass) |

---

*This document will be updated after implementation with verification results and any deviations from the plan.*
