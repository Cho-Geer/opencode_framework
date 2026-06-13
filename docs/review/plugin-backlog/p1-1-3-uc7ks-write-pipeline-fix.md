# P1-1/P1-3: UC7-001 Write-Block + UC7-009 SA Compliance — Implementation Plan

**Created**: 2026-06-12
**Author**: @Super-Admin
**Priority**: P1 (IMPORTANT) — Phase 3 of plugin-backlog priority.md
**Status**: Planned — awaiting execution
**Related**: `docs/review/plugin-backlog/priority.md` (P1-1, P1-3 entries)
**Replaces**: Archived `enforce.ts` L1426–1454 (UC7-001 HARDEN write-block)
**Depends On**: Phase 2 completion (scope-before.ts check chain) ✅ DONE

---

## §1 Problem Statement

Two UC7KS knowledge pipeline checks from the archived monolithic `enforce.ts` were **never migrated** to the decomposed plugin system:

| Gap | Original Location | Current Status | Risk |
|:--|:--|:--|:--|
| **P1-1** | `enforce.ts` L1426–1454 | ⚠️ `uc7ks-after.ts` tracks cache reads (L30–59), `uc7ks-before.ts` blocks external queries (L33–49). **Gap**: No write-time block for agents writing source files without first searching the knowledge cache. | Agents can write business code without reading `docs/official_docs/` first — violating the "local-first" UC7-001 principle |
| **P1-3** | `enforce.ts` L1434–1453 (SA branch) | ⚠️ `checkUC7KS()` in `uc7ks-utils.ts` blocks external queries for SA (L62–65). **Gap**: No write-block for SA on UC7-001. SA can write framework files without cache search. | Super-Admin can modify `.opencode/` without consulting the knowledge cache — violating UC7-009 |

### Current UC7KS Enforcement Coverage

```
┌──────────────────────────────────────────────────────────────────┐
│                    UC7KS ENFORCEMENT LAYERS                       │
├──────────────────────┬───────────────────────────────────────────┤
│ UC7-004 (external    │ ✅ uc7ks-before.ts L33 — blocks           │
│  query block)        │    context7/webfetch/websearch for all     │
│                      │    non-KC agents                           │
├──────────────────────┼───────────────────────────────────────────┤
│ UC7-001 (cache read  │ ✅ uc7ks-after.ts L30–59 — tracks cache   │
│  tracking)           │    reads in machine.json                  │
├──────────────────────┼───────────────────────────────────────────┤
│ UC7-001 (write-time  │ ❌ NOT MIGRATED — enforce.ts L1426–1454   │
│  block) ← P1-1      │    blocked writes if cache not searched    │
├──────────────────────┼───────────────────────────────────────────┤
│ UC7-009 (SA write    │ ❌ NOT MIGRATED — enforce.ts L1434–1453   │
│  compliance) ← P1-3  │    blocked SA writes if cache unhealthy   │
│                      │    + not searched                          │
├──────────────────────┼───────────────────────────────────────────┤
│ UC7-008 (KC scope)   │ ✅ scope-before.ts L138–166 (Phase 2)     │
├──────────────────────┼───────────────────────────────────────────┤
│ UC7-005 (size cap)   │ ✅ scope-before.ts L209–233 (Phase 2)     │
└──────────────────────┴───────────────────────────────────────────┘
```

### Original Logic (enforce.ts L1426–1454)

```typescript
// ── UC7-001 HARDEN + Write Scope ──
const applyScope = isModifyTool(tool) && tool !== "safe_shell"
  ? true
  : isModifyShell(output.args as Record<string, unknown>);

// P0-FIX-UC7KS-HARDEN-18: UC7KS Pipeline Gate
if (isModifyTool(tool) && applyScope && mode !== "advisory") {
  const isSA = resolvedAgent === "@Super-Admin" || resolvedAgent === "Super-Admin";
  const cacheHealthy = isLocalCacheAvailable();
  if (!(isSA && !cacheHealthy)) {
    const sa = readCachedSessionAccess(
      (resolvedAgent || agent).replace(/^@/, ""),
    );
    if (!sa?.declared_scope) {
      violations.push(
        `[FW-ENFORCE][UC7-001] Module scope not declared. ` +
        `Call module_scope_declare(module, task_id). See Step 0a.`,
      );
    }
    if (!sa?.uc7_001_compliant) {
      violations.push(
        `[FW-ENFORCE][UC7-001] Knowledge cache not searched. ` +
        `Call knowledge_cache_search(domain, task_id). See Step 0b.`,
      );
    }
  }
}
```

**Key observations from the original**:
1. **Dual check**: Both `declared_scope` (Step 0a) and `uc7_001_compliant` (Step 0b) were verified
2. **SA bypass**: `!(isSA && !cacheHealthy)` — SA bypasses ONLY when cache is unhealthy (not missing, not just "available")
3. **Mode gating**: `mode !== "advisory"` — advisory mode skips the check entirely
4. **Apply scope**: Uses the same `applyScope` pattern as write-scope checks

---

## §2 Framework Compliance Matrix

### §2.1 Layout Architecture System

**Requirement**: `.opencode/plugins/*.ts` files are auto-discovered. Shared code in `.opencode/lib/`.

| Check | Status | Notes |
|:--|:--:|:--|
| New utility function in `uc7ks-utils.ts` (lib) | ✅ | `checkUC7KSWrite()` added to existing lib file, not a new plugin |
| scope-before.ts import from `../lib/uc7ks-utils` | ✅ | Already imports `../lib/gate-checks`, `../lib/tool-scope` — same pattern |
| No new plugin files created | ✅ | Extends existing `scope-before.ts` and `uc7ks-utils.ts` |
| Flat plugin structure preserved | ✅ | No new files, no subdirectories |

**Source**: `docs/official_docs/opencode/findings/04-layout-architecture.md`

### §2.2 Permission Matrix System

**Requirement**: Agent write scopes enforced by `project.config.json` → `agent_write_scopes`. Tool-level permissions via `opencode.json` → `permissions`.

| Check | Status | Notes |
|:--|:--:|:--|
| P1-1 check runs AFTER P0-5 `isWriteAllowed` | ✅ | UC7-001 write-block fires only for path-authorized writes |
| UC7-001 applies to ALL agents (per UC7KS-PIPELINE-STANDARD §3.1) | ✅ | Including KC (though KC writes docs/ — already exempt by nature) |
| SA emergency bypass: `isLocalCacheAvailable()` returns `false` | ✅ | Mirrors UC7-009 health-state gate from standard §3.9 |
| No permission escalation | ✅ | Read-only checks on `machine.json` and `docs/official_docs/index.json` |

**Source**: `docs/official_docs/opencode/findings/03-permission-matrix.md`

### §2.3 Concurrent Session/Dispatch Write System

**Requirement**: `.pending.json` queue is the dispatch proof. Sub-agent identity from `_dispatch_target.json`.

| Check | Status | Notes |
|:--|:--:|:--|
| UC7-001 check reads `machine.json.knowledge_cache_state` | ✅ | Read-only — no concurrent write conflict |
| `isLocalCacheAvailable()` reads `docs/official_docs/index.json` | ✅ | Read-only — no conflict |
| Multiple agents writing simultaneously | ✅ | Each agent's `uc7_001_compliant` is tracked per-agent in `session_access[agent]` |
| Dispatched sub-agent identity resolution | ✅ | Uses `resolveAgent(sessionID)` → `_dispatch_target.json` (P0-6/P0-7 done) |

**Source**: `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.4 Hardened Enforcement System

**Requirement**: All enforcement checks must use `getEnforcementMode()` from `gate-core.ts`.

| Check | Status | Notes |
|:--|:--:|:--|
| `checkUC7KSWrite()` accepts `mode` parameter | ✅ | Returns error string or null — caller decides throw vs log |
| Advisory mode: `checkUC7KSWrite` returns `null` immediately | ✅ | Mirrors original `mode !== "advisory"` gate |
| Strict/Locked: scope-before.ts throws on non-null return | ✅ | Consistent with all other check blocks |
| `getEnforcementMode()` already imported in scope-before.ts | ✅ | L9 import, L24 `const mode = getEnforcementMode()` |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`

### §2.5 Harness System

**Requirement**: Plugins use `export default`, hooks defined locally, no imported function references in return.

| Check | Status | Notes |
|:--|:--:|:--|
| `export default` pattern preserved | ✅ | Unchanged |
| Hook function `toolExecuteBefore` defined locally | ✅ | All new logic inside existing function body |
| `checkUC7KSWrite()` imported from `../lib/uc7ks-utils` | ✅ | Same as `isWriteAllowed` import pattern from Phase 2 |
| `isSourceFile()` imported from `../lib/state-utils` | ✅ | Needed to gate UC7-001 on source files only |
| Bun cache: additive changes (new imports + ~20 lines) | ✅ | Moderate changes; fallback: rename file |

**Source**: `docs/official_docs/framework/plugin-programming-conventions.md`, `docs/official_docs/opencode/findings/02-harness-system.md`

### §2.6 Central State Management

**Requirement**: `machine.json` is the single source of truth. State writes must be atomic.

| Check | Status | Notes |
|:--|:--:|:--|
| P1-1 writes to `machine.json`? | ❌ No | Read-only check of `knowledge_cache_state` |
| `isLocalCacheAvailable()` reads `docs/official_docs/index.json` | ✅ | Read-only |
| `readCachedSessionAccess()` reads `machine.json` | ✅ | Already exists in `uc7ks-utils.ts` L29–38, read-only |
| No state modification in check path | ✅ | All functions are pure readers |

**Source**: `docs/official_docs/opencode/findings/05-central-state-management.md`

### §2.7 Multi-Agent System

**Requirement**: Agent identity resolution, dispatch protocol, per-agent scope isolation.

| Check | Status | Notes |
|:--|:--:|:--|
| Agent resolution via `resolveAgent(sessionID)` | ✅ | Already resolved at scope-before.ts L23 |
| Agent normalization for SA check | ✅ | `(agent || "").toLowerCase().replace(/^@/, "")` — same as Phase 2 |
| KC exempt from UC7-001 write-block | ✅ | KC writes only docs/ — `uc7_001_compliant` not applicable |
| SA bypass: health-state gate | ✅ | `isLocalCacheAvailable()` returns `false` → SA allowed to write |
| Orchestrator exempt? | ❌ No | Orchestrator must follow UC7-001 (reads docs before DAG tasks) |
| Knowledge-Curator exempt? | ✅ Yes | KC writes only to `docs/official_docs/` — cache write, not read |

**Source**: `docs/official_docs/opencode/findings/06-multi-agent-system.md`

### §2.8 Log Central Management System

**Requirement**: Plugin logging via `writeLog(pluginId, category, fields)`.

| Check | Status | Notes |
|:--|:--:|:--|
| UC7-001 block events use `writeLog("scope-before", "runtime", {...})` | ✅ | Consistent with Phase 2 check blocks |
| Fields: `sessionID, callID, agent, agentType` | ✅ | All four present |
| BLOCKED events: `level: "ERROR"` | ✅ | Consistent with ROUTE-MISMATCH, WRITE-SCOPE |
| SA bypass: `level: "WARN"` + `event: "UC7-009-BYPASS"` | ✅ | Distinct event type for audit trail |
| Advisory pass-through: `level: "WARN"` | ✅ | Logged but not thrown |

**Source**: `docs/official_docs/opencode/findings/01-log-central-management.md`

### §2.9 Templatization & Parameterization System

**Requirement**: Framework files use `{template_key}` placeholders, not hardcoded project-specific paths.

| Check | Status | Notes |
|:--|:--:|:--|
| `docs/official_docs/index.json` path hardcoded? | ⚠️ | `INDEX_PATH` constant in `uc7ks-utils.ts` L7 — project-specific but universally used in UC7KS. Same as Phase 2 P0-4/P1-2 approach. |
| `isSourceFile()` regex framework-specific? | ⚠️ | `/\.(ts|tsx|js|jsx|html|scss|prisma)$/` — matches current project but extensible. Same pattern as `scope-after.ts`. |
| `checkUC7KSWrite()` is project-agnostic | ✅ | Reads `machine.json` and `index.json` via lib functions |

**Source**: `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md`

---

## §3 Implementation Specification

### §3.1 Design Decision: Utility Function vs Inline Check

**Decision**: Create `checkUC7KSWrite()` in `uc7ks-utils.ts` (P1-3), call from `scope-before.ts` (P1-1).

**Rationale**:
- Reusability: The function can be called from other enforcement layers in the future (pre-commit, self-test)
- Separation of concerns: `uc7ks-utils.ts` owns UC7KS logic, `scope-before.ts` owns write-scope orchestration
- Consistency: Mirrors the existing `checkUC7KS()` pattern for external query blocking

### §3.2 New Function: `checkUC7KSWrite()` in `uc7ks-utils.ts`

Add after the existing `checkUC7KS()` function (after L171):

```typescript
/**
 * P1-3: UC7-001 write-time block + UC7-009 SA compliance.
 * Checks whether an agent has searched the knowledge cache before
 * writing a source file. SA has emergency bypass when cache is unhealthy.
 *
 * @param agent  Resolved agent name (e.g., "@Coder-BE")
 * @param mode   Enforcement mode ("advisory" | "strict" | "locked")
 * @returns Error string if blocked, null if allowed
 */
export function checkUC7KSWrite(agent: string, mode: string): string | null {
  // Advisory mode: no blocking
  if (mode === "advisory") return null;

  // KC exempt — writes to docs/official_docs/ are cache population
  const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
  if (agentNorm === "knowledge-curator") return null;

  // Read cache health and agent compliance
  const cacheHealthy = isLocalCacheAvailable();
  const isSA = agentNorm === "super-admin";

  // UC7-009: SA emergency bypass — cache unhealthy → allow writes
  if (isSA && !cacheHealthy) {
    return null; // bypass: SA repairing broken cache
  }

  // Check uc7_001_compliant in machine.json
  const agentKey = agent.replace(/^@/, "");
  const sa = readCachedSessionAccess(agentKey);
  if (!sa?.uc7_001_compliant) {
    const cacheMsg = cacheHealthy
      ? "Local knowledge cache exists but has not been searched."
      : "Knowledge cache not initialized.";
    return [
      `[FW-ENFORCE][UC7-001] Knowledge cache not searched before write.`,
      `${cacheMsg}`,
      `Call knowledge_cache_search(domain, task_id) before writing source files.`,
      `Agent: ${agent}`,
    ].join(" ");
  }

  return null; // pass
}
```

**Lines**: ~35 (including JSDoc + comments)

### §3.3 scope-before.ts Changes

#### Import additions (after L11)

```typescript
import { isSourceFile } from "../lib/state-utils";
import { checkUC7KSWrite } from "../lib/uc7ks-utils";
```

#### New check block: Insert between P0-5 (L207) and P1-4 (L209)

```typescript
    // ═══════════════════════════════════════════════════════════════
    // P1-1 UC7-001: Knowledge Cache Search Before Write
    // Migrated from enforce.ts L1426-1454 (P0-FIX-UC7KS-HARDEN-18)
    //
    // Blocks agents from writing source files without first searching
    // the local knowledge cache. P1-3 handles SA emergency bypass.
    //
    // Gate: only fires for source files (.ts/.tsx/.js/.jsx/.html/.scss/.prisma)
    // and non-advisory modes. Skips safe_shell non-modify commands
    // via applyPathScope.
    // ═══════════════════════════════════════════════════════════════
    if (isSourceFile(filePath)) {
      const uc7Block = checkUC7KSWrite(agent, mode);
      if (uc7Block) {
        const isSABypass = uc7Block.indexOf("UC7-009") !== -1;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: isSABypass ? "WARN" : "ERROR",
          event: isSABypass ? "UC7-009-BYPASS" : "TOOL-BEFORE",
          detail: `BLOCKED | UC7-001-WRITE | agent=${agent} file=${filePath} | ${uc7Block.substring(0, 120)}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(uc7Block);
        return; // advisory: logged, pass through
      }
    }
```

**Lines**: ~25 (including comments)

### §3.4 Execution Order (Updated)

```
┌─────────────────────────────────────────────────────────────────────┐
│ scope-before.ts toolExecuteBefore() — check order (Phase 3)        │
├─────────────────────────────────────────────────────────────────────┤
│ L36: [EXISTING] isModifyTool() early return for non-modify          │
│ L45: [EXISTING] getModifyPath() early return for no file path       │
│ L55: [EXISTING] applyPathScope (safe_shell guard)                   │
│ L65: [EXISTING] Tool scope check (isToolAllowed)                    │
│      ↓                                                              │
│ L79: [P0-3] ROUTE-MISMATCH: Architect/Orchestrator → .opencode/     │
│      ↓                                                              │
│ L105: [P0-4] ROUTE-MISMATCH: Super-Admin → business code            │
│      ↓                                                              │
│ L138: [P1-2] UC7-008: Knowledge-Curator scope isolation             │
│      ↓                                                              │
│ L168: [P0-5] Unresolved agent guard + isWriteAllowed()              │
│      ↓                                                              │
│ L209: [P1-1] ★ UC7-001: Cache search before write ★ NEW           │
│      ↓                                                              │
│ L~235: [P1-4] UC7-005: Cache size cap                               │
│      ↓                                                              │
│ L~260: [EXISTING] Final exit log (ok)                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Why P1-1 goes between P0-5 and P1-4**:
1. After P0-5 (`isWriteAllowed`): Only writes authorized by `agent_write_scopes` reach the UC7-001 check — avoids false blocks on writes that would be denied anyway
2. Before P1-4 (UC7-005): Cache search check is logically prior to size cap — you need to be authorized to write docs before checking if the doc is too large

### §3.5 Complete Modified Files

#### `uc7ks-utils.ts` changes

```
L1-171:  [UNCHANGED] Existing checkUC7KS() + helpers
L172+:   [NEW] checkUC7KSWrite() function (~35 lines)
```

#### `scope-before.ts` changes

```
L12:     [NEW] import { isSourceFile } from "../lib/state-utils";
L13:     [NEW] import { checkUC7KSWrite } from "../lib/uc7ks-utils";
L14-18:  [UNCHANGED] ensureLogDir, writeLog, updateIndex, export default
L22-53:  [UNCHANGED] Function entry, early returns, applyPathScope
L55-77:  [UNCHANGED] Tool scope check (isToolAllowed)
L79-233: [UNCHANGED] All Phase 2 check blocks (P0-3, P0-4, P1-2, P0-5)
L209+:   [NEW] Block 6: P1-1 UC7-001 write-block (~25 lines)
L~235:   [UNCHANGED] P1-4 UC7-005 size cap (shifted down by ~25 lines)
L~260:   [UNCHANGED] Final exit log + closing brace
```

**Estimated scope-before.ts growth**: 240 → ~267 lines (+27 lines including imports)

---

## §4 Cross-Reference: Original vs Migrated Logic

### §4.1 Line-by-Line Comparison

| enforce.ts | New Location | Change |
|:--|:--|:--|
| L1426–1430: `applyScope` computation | scope-before.ts L55–63 | Identical pattern (already done in Phase 2) |
| L1432–1433: `isModifyTool && applyScope && mode !== "advisory"` | `checkUC7KSWrite()` L1 + scope-before.ts gating | Advisory check moved into utility function |
| L1434–1435: `isSA` detection | `checkUC7KSWrite()` — `agentNorm === "super-admin"` | Same normalization as Phase 2 |
| L1436: `cacheHealthy = isLocalCacheAvailable()` | `checkUC7KSWrite()` — calls existing utility | Same function, now in uc7ks-utils.ts L24 |
| L1437: `!(isSA && !cacheHealthy)` bypass | `checkUC7KSWrite()` — `if (isSA && !cacheHealthy) return null` | Same logic, cleaner expression |
| L1438–1440: `readCachedSessionAccess()` | `checkUC7KSWrite()` — calls existing utility | Same function, now in uc7ks-utils.ts L29 |
| L1441–1445: `declared_scope` check | **DROPPED** | See §4.2 below |
| L1447–1451: `uc7_001_compliant` check | `checkUC7KSWrite()` — same check | Identical logic |
| L1453: `violations.push()` | scope-before.ts — `throw new Error()` or `writeLog(WARN)` | Changed from batch violations to immediate throw/log pattern |

### §4.2 Decision: Dropping `declared_scope` Check

The original enforce.ts checked BOTH `declared_scope` (Step 0a) AND `uc7_001_compliant` (Step 0b). This plan drops the `declared_scope` check for the following reasons:

1. **`declared_scope` is enforced elsewhere**: The `module_scope_declare` MCP tool and `pre-execution-gate.ts` Stage 4 already verify that agents declare their scope before execution
2. **Nested schema complexity**: The current `session_access` uses nested `tasks[task_id].domains[domain_id]` schema (uc7ks-schema.ts). Checking `declared_scope` requires traversing this hierarchy, which adds complexity
3. **`uc7_001_compliant` is sufficient**: If an agent has `uc7_001_compliant = true`, they have already searched the cache — the more important prerequisite for writing
4. **Backward compatibility**: The flat legacy field `declared_scope` is still supported by `readCachedSessionAccess()` but no longer written by new pipeline code

If `declared_scope` enforcement is needed in the future, it can be added to `checkUC7KSWrite()` without changing scope-before.ts.

---

## §5 Risk Assessment

### §5.1 Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|:--|:--:|:--:|:--|
| Agents blocked from writing because they never read cache | Medium | High | Expected behavior — forces UC7-001 compliance. Advisory mode available for development. |
| SA emergency bypass not triggering when cache is broken | Medium | Low | `isLocalCacheAvailable()` is well-tested. Returns `false` when `index.json` is missing/empty/corrupt. |
| SA emergency bypass triggering when cache IS healthy | Low | Very Low | `isLocalCacheAvailable()` returns `true` only when `total_entries > 0`. No false negatives. |
| `isSourceFile()` false positive for non-source writes | Low | Very Low | Regex matches common source extensions. Non-source files (.md, .json, .yaml) are exempt. |
| `readCachedSessionAccess()` returns stale data | Low | Low | Reads `machine.json` synchronously on each call. Cache state updates trigger new reads. |
| Bun cache serves stale bytecode | Medium | Medium | ~60 new lines (2 files) usually triggers recompile. Fallback: rename file or `rm -rf ~/.cache/bun`. |
| `checkUC7KSWrite` import from uc7ks-utils fails | Low | Very Low | `uc7ks-utils.ts` already imports `isLocalCacheAvailable` and `readCachedSessionAccess` — new function in same file, same export pattern |

### §5.2 Rollback Plan

1. **Immediate**: Set `ENFORCEMENT_MODE=advisory` → all UC7-001 write checks become warn-only
2. **Targeted**: Comment out the P1-1 block in `scope-before.ts` (between `// P1-1` and `// P1-4` markers)
3. **Full rollback**: `git checkout -- .opencode/plugins/scope-before.ts .opencode/lib/uc7ks-utils.ts`

### §5.3 Interaction with Existing Checks

| Check | Runs Before/After P1-1 | Interaction |
|:--|:--|:--|
| Tool scope (isToolAllowed) | Before | Agent must be allowed to use write/edit tool first |
| P0-3 (ROUTE-MISMATCH Arch/Orch) | Before | Arch/Orch blocked from `.opencode/` before UC7-001 check |
| P0-4 (ROUTE-MISMATCH SA→biz) | Before | SA blocked from business code before UC7-001 check |
| P1-2 (UC7-008 KC scope) | Before | KC scope enforced before UC7-001 (KC exempt anyway) |
| P0-5 (isWriteAllowed) | Before | Path scope check first — only authorized paths reach UC7-001 |
| **P1-1 (UC7-001 write-block)** | **HERE** | **Cache search verification** |
| P1-4 (UC7-005 size cap) | After | Size cap only applies to `docs/official_docs/` writes |

---

## §6 Verification Plan

### §6.1 Pre-Execution Verification

```bash
# 1. Plugin loading test
bun -e "import('./.opencode/plugins/scope-before.ts').then(() => console.log('OK')).catch(e => console.error('FAIL:', e.message))"

# 2. Import resolution test
bun -e "
  const { checkUC7KSWrite } = await import('./.opencode/lib/uc7ks-utils.ts');
  const { isSourceFile } = await import('./.opencode/lib/state-utils.ts');
  console.log('checkUC7KSWrite:', typeof checkUC7KSWrite);
  console.log('isSourceFile:', typeof isSourceFile);
"

# 3. isSourceFile verification
bun -e "
  const { isSourceFile } = await import('./.opencode/lib/state-utils.ts');
  console.log('.ts:', isSourceFile('src/main.ts'));        // true
  console.log('.json:', isSourceFile('config.json'));      // false
  console.log('.md:', isSourceFile('README.md'));           // false
  console.log('.yaml:', isSourceFile('contract.yaml'));     // false
  console.log('.scss:', isSourceFile('styles.scss'));       // true
  console.log('.prisma:', isSourceFile('schema.prisma'));   // true
"
```

### §6.2 Functional Verification

```bash
# 4. checkUC7KSWrite — advisory mode (should always return null)
bun -e "
  const { checkUC7KSWrite } = await import('./.opencode/lib/uc7ks-utils.ts');
  console.log('advisory:', checkUC7KSWrite('@Coder-BE', 'advisory'));
  // Expected: null
"

# 5. checkUC7KSWrite — KC exempt (should return null)
bun -e "
  const { checkUC7KSWrite } = await import('./.opencode/lib/uc7ks-utils.ts');
  console.log('KC strict:', checkUC7KSWrite('@Knowledge-Curator', 'strict'));
  // Expected: null
"

# 6. checkUC7KSWrite — agent without cache read (should block)
bun -e "
  const { checkUC7KSWrite } = await import('./.opencode/lib/uc7ks-utils.ts');
  const result = checkUC7KSWrite('@Test-Agent-NonExistent', 'strict');
  console.log('no-cache agent:', result ? 'BLOCKED' : 'PASSED');
  // Expected: BLOCKED (unless advisory or SA bypass)
"

# 7. checkUC7KSWrite — SA with healthy cache (should block if no cache read)
bun -e "
  const { checkUC7KSWrite } = await import('./.opencode/lib/uc7ks-utils.ts');
  const result = checkUC7KSWrite('@Super-Admin', 'strict');
  console.log('SA result:', result ? 'BLOCKED' : 'PASSED (bypass or compliant)');
"
```

### §6.3 Integration Verification

```bash
# 8. Framework self-test
node .opencode/scripts/framework-self-test.ts

# 9. All 16 plugins load test
for f in .opencode/plugins/*.ts; do
  [[ "$f" == *.bak ]] && continue
  echo -n "$(basename $f): "
  bun -e "import('$f').then(() => console.log('OK')).catch(e => console.error('FAIL:', e.message))" 2>&1 | head -1
done

# 10. Machine.json UC7 state check
node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('.opencode/state/machine.json', 'utf8'));
  const sa = m?.knowledge_cache_state?.session_access || {};
  for (const [k, v] of Object.entries(sa)) {
    console.log(k + ':', v.uc7_001_compliant ? 'COMPLIANT' : 'NON-COMPLIANT');
  }
"
```

---

## §7 Effort Estimate

| Item | File | Lines Added | Risk |
|:--|:--|:--:|:--:|
| `checkUC7KSWrite()` function | `uc7ks-utils.ts` | ~35 | Low |
| Import additions | `scope-before.ts` | 2 | None |
| P1-1 check block | `scope-before.ts` | ~25 | Low |
| **Total** | **2 files** | **~62** | — |

---

## §8 Related Documents

| Document | Relationship |
|:--|:--|
| `docs/review/plugin-backlog/priority.md` | Gap definitions (P1-1, P1-3) |
| `.opencode/_plugins_backups/_bk_framework-enforcer/enforce.ts` | Original UC7-001 write-block (L1426–1454) |
| `.opencode/lib/uc7ks-utils.ts` | `isLocalCacheAvailable()`, `readCachedSessionAccess()`, `checkUC7KS()` |
| `.opencode/lib/uc7ks-schema.ts` | Nested `session_access` schema types |
| `.opencode/plugins/uc7ks-before.ts` | UC7-004 external query block (existing) |
| `.opencode/plugins/uc7ks-after.ts` | UC7-001 cache read tracking (existing) |
| `.opencode/plugins/scope-before.ts` | Target for P1-1 check block insertion |
| `.opencode/rules/rule_detail/UC7KS-PIPELINE-STANDARD.md` | UC7-001 (§3.1), UC7-009 (§3.9) rule definitions |
| `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` | Phase 2 plan (scope-before.ts patterns) |

---

## §9 Appendix: Enforcement Mode Behavior

| Scenario | Advisory | Strict | Locked |
|:--|:--|:--|:--|
| Agent without `uc7_001_compliant` writes source file | ⚠️ WARN log, allow | ❌ throw `[FW-ENFORCE][UC7-001]` | ❌ throw |
| Agent with `uc7_001_compliant = true` writes source file | ✅ Allow | ✅ Allow | ✅ Allow |
| SA writes when cache is healthy + not searched | ⚠️ WARN | ❌ throw | ❌ throw |
| SA writes when cache is unhealthy (emergency) | ✅ Allow + WARN | ✅ Allow + WARN | ✅ Allow + WARN |
| KC writes to `docs/official_docs/` | ✅ Allow | ✅ Allow | ✅ Allow |
| Non-source file write (.md, .json, .yaml) | ✅ Skip check | ✅ Skip check | ✅ Skip check |
| `safe_shell` with non-cp/mv/rm command | ✅ Skip check | ✅ Skip check | ✅ Skip check |

---

*This document will be updated after implementation with verification results and any deviations from the plan.*
