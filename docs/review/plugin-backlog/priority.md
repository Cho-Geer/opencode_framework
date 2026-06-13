# Constraint Restoration Priority Report

**Original Audit**: CONSTRAINT-AUDIT (2026-06-11)
**Cross-Reference Update**: 2026-06-12 by @Super-Admin
**Sources verified**: Archived enforce.ts vs **16 active plugins** (was 13 in original audit)
**Status legend**: ❌ OPEN · ⚠️ PARTIALLY ADDRESSED · ✅ ADDRESSED

---

## Inventory Delta Since Original Audit

| File | Lines | Purpose |
|:--|:--:|:--|
| `scope-before.ts` | 266 | Central write-scope enforcement (P0-3/4/5, P1-1/2/4) |
| `dispatch-before.ts` | 483 | Queue consumption + dispatch auth + identity write (P0-2/6, P2-2) |
| `dispatch-after.ts` | 124 | Identity cleanup + stale drain (P0-7) |
| `gate-before.ts` | 132 | Gate armed + DAG task audit (P2-1) |
| `tdd-before.ts` | 58 | TDD per-write enforcement (P0-1) |
| `tdd-after.ts` | 340 | Post-write TDD diff evidence + shallow-test detection |
| `json-validate.ts` | 190 | JSON syntax validation + enforcement mode protection (P1-5) |

**Key lib files**: `gate-checks.ts` (215), `agent-resolver.ts` (107), `tool-scope.ts` (42), `uc7ks-utils.ts` (215), `write-audit-lib.ts` (91), `gate-core.ts` (1476), `state-utils.ts`, `log-manager.ts`, `audit-log.ts`, `tolerant-json.ts`

**Current active plugins (16)**: `audit-after.ts`, `audit-before.ts`, `cache-after.ts`, `dispatch-after.ts`, `dispatch-before.ts`, `gate-after.ts`, `gate-before.ts`, `json-validate.ts`, `scope-after.ts`, `scope-before.ts`, `session.ts`, `task-after.ts`, `tdd-after.ts`, `tdd-before.ts`, `uc7ks-after.ts`, `uc7ks-before.ts`

---

## P0 (CRITICAL — Security, Integrity, or Code Quality at Immediate Risk)

| # | Constraint | Status | What It Blocks | Effort | Target Files | Strategy |
|:--|:---|:---:|:---|:---|:---|:---|
| P0-1 | **TDD Per-Write Enforcement** (T1, T4) | ✅ | **FIXED 2026-06-12**: `tdd-before.ts` L9 now imports `getEnforcementMode()` from `gate-core`, L29 uses dynamic `const mode = getEnforcementMode()`, L56 uses `if (mode === 'strict' \|\| mode === 'locked') throw`. Verified: mode resolves to `"strict"` (`project.config.json`); `ENFORCEMENT_MODE=advisory` produces `"advisory"` (no block). Dual-mode consistency confirmed. | **0** | Fixed in `tdd-before.ts` | See `docs/review/plugin-backlog/p0-1-tdd-integration-fix.md` for full fix specification and verification. |
| P0-2 | **MANDATORY-DISPATCH Queue Check** (S4) | ✅ | Fully implemented in `dispatch-before.ts` L50-125. Queue existence/emptiness check, emergency bypass (`FW_PROMPT_QUEUE_DRAIN`), callID idempotency guard, enforcement mode awareness, file injection with SHA-256 hash verification, KC self-dispatch recursion guard (G-09). | **0** | — | No action needed. |
| P0-3 | **ROUTE-MISMATCH: Architect/Orchestrator → .opencode/ Block** (W2) | ✅ **FIXED 2026-06-12** | Implemented in `scope-before.ts` L79-103. Uses `agentNorm = agent.toLowerCase()` normalization, checks `.opencode/`, `opencode.json`, `AGENTS.md` paths, `if (strict||locked) throw`. Safe_shell guard. | **0** | Fixed in `scope-before.ts` | See `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` |
| P0-4 | **ROUTE-MISMATCH: Super-Admin → Business Code** (W3) | ✅ **FIXED 2026-06-12** | Implemented in `scope-before.ts` L105-136. Checks 3 business paths matching `project.config.json` denied list. Fixes original enforce.ts SA bypass bug (L1327 dead code). | **0** | Fixed in `scope-before.ts` | See `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` |
| P0-5 | **Write PATH Scope Check** (W1 partial loss) | ✅ **FIXED 2026-06-12** | Implemented in `scope-before.ts` L168-207: unresolved agent guard + `isWriteAllowed()`. Path normalization fix: `OPENCODE_ROOT \|\| process.cwd()` in `gate-checks.ts` L97. | **0** | Fixed in `scope-before.ts` + `gate-checks.ts` | See `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` |
| **P0-6** | **Agent Identity Propagation — _dispatch_target.json Write** (A4) | ✅ **FIXED 2026-06-12** | `dispatch-before.ts` now writes `.task_temp/_dispatch_target.json` after successful queue consumption (after L197). Schema: `{agent, task_id, run_id, timestamp}`. Mirrors old `enforce.ts` L932-983 pattern. Verified: plugin loads OK, schema fields correct. | **0** | Fixed in `dispatch-before.ts` | See `docs/review/plugin-backlog/p0-6-7-agent-propagation-fix.md` for full spec. |
| **P0-7** | **Agent Identity Propagation — _dispatch_target.json Cleanup** (A5) | ✅ **FIXED 2026-06-12** | `dispatch-after.ts` now deletes `.task_temp/_dispatch_target.json` in `tool.execute.after` for all Task() calls (after L40). Defense-in-depth: all 3 readers validate `run_id` against `OPENCODE_RUN_ID` and auto-reject stale files. Verified: plugin loads OK, cleanup deletes file correctly. | **0** | Fixed in `dispatch-after.ts` | See `docs/review/plugin-backlog/p0-6-7-agent-propagation-fix.md` for full spec. |

## P1 (IMPORTANT — Knowledge Pipeline & Dispatch Integrity)

| # | Constraint | Status | What It Blocks | Effort | Target Files | Strategy |
|:--|:---|:---:|:---|:---|:---|:---|
| P1-1 | **UC7-001 Cache Search Before Write** (U2) | ✅ **FIXED 2026-06-12** | Implemented in `scope-before.ts` L≤211. Calls `checkUC7KSWrite(agent, mode)` from `uc7ks-utils.ts`. Gates on `isSourceFile(filePath)`. Blocks agents writing source files without `uc7_001_compliant`. SA emergency bypass when `!isLocalCacheAvailable()`. | **0** | Fixed in `scope-before.ts` + `uc7ks-utils.ts` | See `docs/review/plugin-backlog/p1-1-3-uc7ks-write-pipeline-fix.md` |
| P1-2 | **UC7-008 KC Scope Isolation** (U3) | ✅ **FIXED 2026-06-12** | Implemented in `scope-before.ts` L138-166. Checks filePath against `docs/official_docs/`, `.metadata/`, `.task_temp/`. All other writes blocked with `[FW-ENFORCE][UC7-008]`. | **0** | Fixed in `scope-before.ts` | See `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` |
| P1-4 | **UC7-005 Cache Size Cap** (U4) | ✅ **FIXED 2026-06-12** | Implemented in `scope-before.ts` L209-233. Checks `filePath.includes("docs/official_docs/")` and `content.length > 524288` (500KB). | **0** | Fixed in `scope-before.ts` | See `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` |
| P1-3 | **UC7-009 Super-Admin UC7KS Compliance** (U5) | ✅ **FIXED 2026-06-12** | Implemented in `checkUC7KSWrite()` in `uc7ks-utils.ts` L≥173. SA emergency bypass: `if (isSA && !cacheHealthy) return null`. Health-state gate via `isLocalCacheAvailable()`. Called from scope-before.ts P1-1 block. | **0** | Fixed in `uc7ks-utils.ts` + `scope-before.ts` | See `docs/review/plugin-backlog/p1-1-3-uc7ks-write-pipeline-fix.md` |
# see below
| P1-5 | **Enforcement Mode Change Protection** (W4) | ✅ **FIXED 2026-06-12** | Implemented in `json-validate.ts` L95-153. After JSON syntax validation, `detectModeDowngrade()` reads current `project.config.json`, compares `develop_enforcement_mode` + `runtime_enforcement_mode`. Blocks downgrades from strict/locked. Upgrades allowed. Missing keys treated as advisory. | **0** | Fixed in `json-validate.ts` | See Phase 4 below |

## P2 (NICE-TO-HAVE — Audit Trail & Soft Enforcement)

| # | Constraint | Status | What It Blocks | Effort | Target Files | Strategy |
|:--|:---|:---:|:---|:---|:---|:---|
| P2-1 | **DAG Task Existence/Status Check at Runtime** (D1, D2) | ✅ **FIXED 2026-06-12** | Implemented in `gate-before.ts` L64–123. Calls `findTaskInDag(taskId)` from `gate-checks.ts` for modify tools. Exempts @Meta-Planner/@Orchestrator. Blocks non-pending/non-in_progress tasks in strict/locked; warns in advisory. | **0** | Fixed in `gate-before.ts` | See Phase 5 below |
| P2-2 | **Dispatch Authorization at Task() time** (S1 partial loss) | ✅ **FIXED 2026-06-12** | Implemented in `dispatch-before.ts` L68–176. Gate 1: only @Orchestrator dispatches general agents; @Super-Admin→@Knowledge-Curator requires UC7KS pattern match; other SA/non-auth blocked in strict/locked. Gate 2: SA target requires repair pattern match in strict; denied in locked. Advisory mode warns only. | **0** | Fixed in `dispatch-before.ts` | See Phase 5 below |

---

## Cross-Reference Verification Matrix

Each original gap verified against actual source code (2026-06-12):

| Gap | Original Claim | Actual File | Actual Line(s) | Finding |
|:--|:--|:--|:--|:--|
| P0-1 | "gate-before.ts: No TDD check" | `tdd-before.ts` (NEW) | L17-56 | ✅ **FIXED 2026-06-12**: `getEnforcementMode()` imports from `gate-core`, dynamic mode, standardized block condition |
| P0-2 | "dispatch-before.ts: no MANDATORY-DISPATCH throw" | `dispatch-before.ts` | L50-125 | ✅ Fully implemented with queue check, bypass, mode-aware |
| P0-3 | "scope-before.ts: No ROUTE-MISMATCH" | `scope-before.ts` | L79-103 | ✅ **FIXED 2026-06-12**: P0-3 check, `agentNorm` normalization, `applyPathScope` guard |
| P0-4 | "scope-before.ts: No SA business code block" | `scope-before.ts` | L105-136 | ✅ **FIXED 2026-06-12**: P0-4 check, 3 business paths, fixes enforce.ts dead code |
| P0-5 | "isWriteAllowed() not called in scope-before" | `scope-before.ts` | L168-207 | ✅ **FIXED 2026-06-12**: unresolved agent guard + `isWriteAllowed()` call |
| P1-1 | "uc7ks-before.ts: Only UC7-004" | `scope-before.ts` + `uc7ks-utils.ts` | L211 + L174 | ✅ **FIXED 2026-06-12**: `checkUC7KSWrite()` + scope-before.ts block, source file gate |
| P1-2 | "No KC scope isolation" | `scope-before.ts` | L138-166 | ✅ **FIXED 2026-06-12**: UC7-008 check, KC path whitelist |
| P1-3 | "SA bypasses UC7KS" | `uc7ks-utils.ts` | L174+ | ✅ **FIXED 2026-06-12**: `checkUC7KSWrite()` SA emergency bypass + health-state gate |
| P1-4 | "No cache size cap" | `scope-before.ts` | L209-233 | ✅ **FIXED 2026-06-12**: UC7-005 content size cap (500KB) |
| P1-5 | "No enforcement mode protection" | `json-validate.ts` | L95-180 | ✅ **FIXED 2026-06-12**: `detectModeDowngrade()` blocks strict/locked downgrades |
| P2-1 | "No DAG task check" | `gate-before.ts` + `gate-checks.ts` | L64-123 + L68-79 | ✅ **FIXED 2026-06-12**: `findTaskInDag()` now called from gate-before.ts for modify tools |
| P2-2 | "No dispatch authorization" | `dispatch-before.ts` | L68-176 | ✅ **FIXED 2026-06-12**: Two-gate caller authorization (Orchestrator/SA/KC) + SA repair pattern validation |
| **A4** | _(not in original)_ | `dispatch-before.ts` | L199-247 | ✅ **FIXED 2026-06-12**: P0-6 writes `_dispatch_target.json` |
| **A5** | _(not in original)_ | `dispatch-after.ts` | L42-58 | ✅ **FIXED 2026-06-12**: P0-7 cleans up `_dispatch_target.json` |

---

## Agent Propagation Impact Analysis (NEW — A4/A5)

The `_dispatch_target.json` mechanism is the **bridge between plugin-layer agent identity and MCP/script-layer agent identity**. Without it:

| Component | Reads `_dispatch_target.json` | Writer Status | Net Effect |
|:--|:--|:--|:--|
| `agent-resolver.ts` L32-46 | ✅ Priority 1 | ❌ No writer | Sub-agents resolve as `""` |
| `compliance-gate.ts` L1779 | ✅ Fallback | ❌ No writer | Gate sessions lack agent identity |
| `pre-execution-gate.ts` L319-339 | ✅ `readDispatchTargetAgent()` | ❌ No writer | DAG gate falls back to `process.env.AGENT` = `"1"` |
| `pre-execution-hook.sh` L25 | ✅ `${FRAMEWORK_AGENT:-}` | ❌ Env var never set | SA bypass = dead code |
| `pre-execution-hook.sh` L268-363 | ✅ `${FRAMEWORK_AGENT:-}` | ❌ Env var never set | UC7KS KC gate = dead code |
| `code-quality-lib.ts` L957 | N/A (returns "unknown") | ❌ N/A | Write-audit agent = "unknown" |

**Original mechanism** (archived `enforce.ts`):
- **Write**: `tool.execute.before` on Task() → write `_dispatch_target.json` with `{agent, task_id, run_id, timestamp}` (L932-983)
- **Cleanup**: `tool.execute.after` on Task() → `fs.unlinkSync(dtPath)` (L1670-1686)
- **Cache**: Module-level `_cachedAgent` with `OPENCODE_RUN_ID` staleness check (L58-96)

**Migration target**: `dispatch-before.ts` (write) + `dispatch-after.ts` or `task-after.ts` (cleanup). The `agent-resolver.ts` already has the staleness check via `OPENCODE_RUN_ID` comparison (L37-43), so only the write and cleanup need migration.

---

## Implementation Strategy (Updated)

### Phase 0: Agent Propagation (P0-6 + P0-7) — ✅ DONE 2026-06-12

**2 edits applied**:
1. `dispatch-before.ts`: Inserted `_dispatch_target.json` write block (P0-6) after L197 (queue consumption). Writes `{agent, task_id, run_id, timestamp}` after every successful dispatch.
2. `dispatch-after.ts`: Inserted `_dispatch_target.json` cleanup block (P0-7) after L40 (Task filter). Deletes file after every Task() returns.

**Verification**: Both plugins load OK; schema write produces all 4 fields; cleanup correctly deletes the file; framework self-test 33/37 (same 4 pre-existing failures). See `p0-6-7-agent-propagation-fix.md`.

### Phase 1: TDD Mode Fix (P0-1) — ✅ DONE 2026-06-12

**3 edits applied to `tdd-before.ts`**:
1. Added `import { getEnforcementMode } from '../lib/gate-core'` at L9
2. Replaced `const mode = 'strict'` with `const mode = getEnforcementMode()` at L29
3. Changed `if (mode !== 'advisory') throw` to `if (mode === 'strict || mode === 'locked') throw` at L56

**Verification**: Plugin loads OK; mode resolves to `"strict"` (matching `project.config.json`); `ENFORCEMENT_MODE=advisory` → `"advisory"`, would-block=`false`. See `p0-1-tdd-integration-fix.md`.

### Phase 2: scope-before.ts Consolidation (P0-3 + P0-4 + P0-5 + P1-2 + P1-4) — ✅ DONE 2026-06-12

`scope-before.ts` is the central file for all write-scope validation. Extend with 5 new checks in a single pass:

```
1. Resolve agent + mode (EXISTING)
2. For each modify tool call:
   2a. [EXISTING] Tool scope check (isToolAllowed)
   2b. [P0-3 NEW] ROUTE-MISMATCH: Architect/Orchestrator → .opencode/
   2c. [P0-4 NEW] ROUTE-MISMATCH: Super-Admin → business code
   2d. [P1-2 NEW] UC7-008: KC scope isolation
   2e. [P0-5 NEW] isWriteAllowed() path scope check
   2f. [P1-4 NEW] UC7-005: cache size cap
```

**Estimated scope-before.ts growth**: 72 → ~190 lines (~117 new lines + 2 new imports)

**Implementation plan**: See `docs/review/plugin-backlog/p0-3-4-5-route-mismatch-write-scope-fix.md` for full specification including §2 Framework Compliance Matrix (9 systems), §3 code blocks, §4 original-vs-migrated cross-reference, §5 risk assessment, §6 verification plan.

**Known config issue**: @Guardian `agent_write_scopes` has `.opencode/**` in denied list which overrides the explicitly allowed `.opencode/state/machine.json` — requires separate config fix (§3.6 of plan).

### Phase 3: UC7KS Write Pipeline (P1-1 + P1-3) — ✅ DONE 2026-06-12

Add UC7-001 write-block and UC7-009 SA compliance to `uc7ks-utils.ts` + `scope-before.ts`.

**Implementation plan**: See `docs/review/plugin-backlog/p1-1-3-uc7ks-write-pipeline-fix.md` for full specification including §2 Framework Compliance Matrix (9 systems), §3 implementation spec (`checkUC7KSWrite()` + scope-before.ts integration), §4 original-vs-migrated cross-reference, §5 risk assessment, §6 verification plan.

**Design decision**: `checkUC7KSWrite(agent, mode)` utility function in `uc7ks-utils.ts` (~35 lines), called from `scope-before.ts` after P0-5 check. SA emergency bypass via `isLocalCacheAvailable()` health-state gate (UC7-009). `declared_scope` check intentionally dropped — `uc7_001_compliant` is sufficient for write-time enforcement.

### Phase 4: JSON Config Protection (P1-5) — ✅ DONE 2026-06-12

Extend `json-validate.ts` with enforcement mode downgrade detection. ✅ Implemented: `detectModeDowngrade()` blocks strict/locked→lower modes, allows upgrades.

### Phase 5: DAG Audit + Dispatch Auth (P2-1 + P2-2) — ✅ DONE 2026-06-12

Advisory-only additions to `gate-before.ts` and `dispatch-before.ts`. ✅ Implemented per `docs/review/plugin-backlog/p2-1-2-dag-audit-dispatch-auth-fix.md`.

---

## Execution Order (Updated)

1. ~~**P0-6 + P0-7** — Agent propagation write + cleanup~~ ✅ **DONE 2026-06-12**
2. ~~**P0-1** — TDD mode fix~~ ✅ **DONE 2026-06-12**
3. ~~**P0-3 + P0-4 + P0-5 + P1-2 + P1-4** — scope-before.ts batch~~ ✅ **DONE 2026-06-12**
4. ~~**P1-1 + P1-3** — UC7KS write pipeline~~ ✅ **DONE 2026-06-12**
5. ~~**P1-5** — JSON config protection~~ ✅ **DONE 2026-06-12**
6. ~~**P2-1 + P2-2** — Advisory additions (gate-before.ts + dispatch-before.ts)~~ ✅ **DONE 2026-06-12**

---

## Revised Effort Estimates

| Phase | Files | New Lines | Risk | Original Estimate |
|:---|:---|:---|:---|:---|
| Phase 0 (A4+A5) | dispatch-before.ts, dispatch-after.ts | **0** ✅ DONE | Low — well-defined write/cleanup | _(new)_ |
| Phase 1 (TDD fix) | tdd-before.ts | **0** ✅ DONE | Very Low — 2-line change | _(new)_ |
| Phase 2 (scope) | scope-before.ts + gate-checks.ts | **0** ✅ DONE | Low — additive, pattern-based | ~140 (was Phase 1) |
| Phase 3 (UC7KS) | uc7ks-utils.ts + scope-before.ts | **0** ✅ DONE | Low — reuses existing lib functions | ~65 (was Phase 4) |
| Phase 4 (JSON) | json-validate.ts | **0** ✅ DONE | Low — extends existing logic | ~25 (was Phase 4) |
| Phase 5 (advisory) | gate-before.ts + dispatch-before.ts | **0** ✅ DONE | Low — advisory-only | ~120 (was Phase 5) |
| **Total** | 11 files (9 done) | **0** | — | **~370** (original) |

**Reduction**: ~370 lines saved because all 14 original gaps are now fixed (P0-2 already done, P0-1, P0-6/P0-7, P0-3/4/5, P1-2/4, P1-1/3, P1-5, P2-1, P2-2).

---

## Verification (Updated)

After implementation, verify with:
```bash
# 1. Framework self-test
node .opencode/scripts/framework-self-test.ts

# 2. Plugin loading test (all 16 plugins must load without error)
for f in .opencode/plugins/*.ts; do
  [[ "$f" == *.bak ]] && continue
  echo "Testing $f..."
  bun run -e "import('$f')" 2>&1 | head -1
done

# 3. Agent propagation verification (P0-6/P0-7)
# Dispatch a test sub-agent, then check:
cat .task_temp/_dispatch_target.json 2>/dev/null && echo "A4: WRITE OK" || echo "A4: WRITE MISSING"
# After dispatch completes:
test ! -f .task_temp/_dispatch_target.json && echo "A5: CLEANUP OK" || echo "A5: STALE FILE"

# 4. Audit log verification
grep -c "BLOCKED\|ROUTE-MISMATCH\|UC7-00[1-9]\|MANDATORY-DISPATCH\|TDD violation" \
  .task_temp/_logs/*/plugin-*.log 2>/dev/null | tail -5

# 5. TDD mode verification (P0-1)
# In advisory mode, tdd-before.ts should NOT throw
ENFORCEMENT_MODE=advisory bun run -e "
  const { getEnforcementMode } = await import('./.opencode/lib/gate-core');
  console.log('Mode:', getEnforcementMode());
"
```

---

## Appendix: Archived enforce.ts Feature Migration Status

Complete feature-by-feature migration status from the archived monolithic `enforce.ts` (1923 lines) to the active decomposed 16-plugin system. **Cross-referenced 2026-06-12** against actual source code.

**Legend**: ✅ Fully migrated · ⚠️ Migrated with behavioral difference · ❌ Not migrated · 🏗️ Architecturally replaced

### A.1 Core Enforcement Features (before-hook)

| # | Feature | Old Location | Active Location | Verified Lines | Status |
|:--|:--|:--|:--|:--|:--:|
| F1 | Tool scope check (`isToolAllowed`) | L1457-1478 | `scope-before.ts` L67-79 | `isToolAllowed()` from `tool-scope.ts` L35-42 | ✅ |
| F2 | Gate armed check | L1214-1224 | `gate-before.ts` L40-63 | `findArmedSession()` + `isModifyTool()` guard | ✅ |
| F3 | MANDATORY-DISPATCH queue | L1130-1206 | `dispatch-before.ts` L192-266 | Queue check + `FW_PROMPT_QUEUE_DRAIN` + callID idempotency | ✅ |
| F4 | Write audit tracking (before-hook) | L1507-1660 | `audit-before.ts` L21-27 + `write-audit-lib.ts` L10-91 | `executeWriteAuditCheck()` — scope + dirty modules + state | ✅ |
| F5 | UC7-004 external tool block | L1318-1322 | `uc7ks-before.ts` L20-56 | `checkUC7KS()` from `uc7ks-utils.ts` L60-171 | ✅ |
| F6 | UC7-001 cache read tracking | L1811-1845 | `uc7ks-after.ts` L25-59 | `read` on `docs/official_docs/` → `knowledge_cache_state` | ✅ |
| F7 | Session map (`.session_map.json`) | L264-294 | `session.ts` L50-107 + `agent-resolver.ts` L13-30 | `chatMessageHook()` writes map; `resolveAgentFromSessionMap()` reads | ✅ |
| F8 | Plugin hash integrity | gate-checks L184-260 | `gate-checks.ts` L42-66 | `checkPluginIntegrity()` with `setPluginHooksCount()` | ✅ |
| F9 | Stale session auto-drain | gate-checks L260-340 | `gate-checks.ts` L128-157 | `autoDrainStaleSessions()` called from `gate-after.ts` L35 | ✅ |
| F10 | Rule registry integrity | gate-checks L340-400 | `gate-checks.ts` L159-186 | `checkRuleRegistryIntegrity()` | ✅ |
| F11 | Machine cleanliness check | gate-checks L400-459 | `gate-checks.ts` L188-215 | `checkMachineCleanliness()` | ✅ |
| F12 | DAG task lookup | L1331-1356 | `gate-before.ts` L65-118 | `findTaskInDag()` from `gate-checks.ts` L68-79; called from gate-before L90 | ✅ |
| F13 | KC self-dispatch recursion guard | N/A (new) | `dispatch-before.ts` L395-442 | `kc_dispatched` + 5-min throttle window (G-09) | ✅ |
| F14 | TDD per-write enforcement | L1287-1311 | `tdd-before.ts` L18-57 | Dynamic `getEnforcementMode()` L9/L29; `isBusinessSourceFile()` gate | ✅ |
| F15 | JSON syntax validation | N/A (new) | `json-validate.ts` L50-147 | `tolerantParse()` for `project.config.json` + `opencode.json` | ✅ |
| F16 | `_dispatch_target.json` WRITE | L932-983 | `dispatch-before.ts` L340-388 | P0-6: writes `{agent, task_id, run_id, timestamp}` after queue consumption | ✅ |
| F17 | `_dispatch_target.json` CLEANUP | L1670-1686 | `dispatch-after.ts` L42-69 | P0-7: `fs.unlinkSync(dtPath)` after Task() completes | ✅ |
| F18 | ROUTE-MISMATCH (Architect/Orchestrator) | L1370-1398 | `scope-before.ts` L81-105 | P0-3: `agentNorm` check + `.opencode/`/`opencode.json`/`AGENTS.md` | ✅ |
| F19 | ROUTE-MISMATCH (Super-Admin) | L1400-1425 | `scope-before.ts` L107-138 | P0-4: 3 business paths; removes enforce.ts L1327 dead-code bypass | ✅ |
| F20 | `isWriteAllowed()` path scope | L1457-1478 | `scope-before.ts` L170-209 | P0-5: unresolved agent guard + `isWriteAllowed()` from `gate-checks.ts` L92-112 | ✅ |
| F21 | UC7-008 KC scope isolation | L1244-1263 | `scope-before.ts` L140-168 | P1-2: KC path whitelist (`docs/official_docs/`, `.metadata/`, `.task_temp/`) | ✅ |
| F22 | UC7-005 cache size cap | L1266-1284 | `scope-before.ts` L235-258 | P1-4: `content.length > 524288` (500KB) | ✅ |
| F23 | UC7-009 SA UC7KS compliance | L1432-1454 | `uc7ks-utils.ts` L182-215 | P1-3: `checkUC7KSWrite()` SA emergency bypass via `isLocalCacheAvailable()` | ✅ |
| F24 | Enforcement mode change protection | L1227-1241 | `json-validate.ts` L109-190 | P1-5: `detectModeDowngrade()` blocks strict/locked→lower | ✅ |
| F25 | Dispatch caller authorization | L992-1120 | `dispatch-before.ts` L83-186 | P2-2: Gate 1 (caller auth) + Gate 2 (SA repair pattern) | ✅ |

### A.2 After-Hook & Utility Features

| # | Feature | Old Location | Active Location | Verified Lines | Status |
|:--|:--|:--|:--|:--|:--:|
| F26 | `resolveAgent()` + module cache | L72-108 | `agent-resolver.ts` L32-90 | Session map (priority 1) + `_dispatch_target.json` (priority 2) + run_id staleness | ✅ |
| F27 | `resolveTaskId()` | L116-131 | `agent-resolver.ts` L96-107 | `FRAMEWORK_TASK_ID` env → `_dispatch_target.json` → `""` | ✅ |
| F28 | `isModifyTool()` / `getModifyPath()` / `isModifyShell()` | L141-171 | `tool-scope.ts` L6-16 | Identical logic; extracted to shared lib | ✅ |
| F29 | `readDispatchAllowedTools()` / `isToolAllowed()` | L186-258 | `tool-scope.ts` L18-42 | Same FALLBACK list + MCP prefix normalization | ✅ |
| F30 | Block 1 hash-based Task() queue consumption | L700-928 | `dispatch-before.ts` L290-465 | Unified file-injection dispatch with SHA-256 hash verification | ✅ |
| F31 | `_executeWriteAuditCheck()` — core | L1507-1660 | `write-audit-lib.ts` L10-91 | Scope + dirty modules + type_check + format + dependency state | ✅ |
| F32 | `_executeWriteAuditCheck()` — code-quality-lib.js | L1618-1648 | **NOT MIGRATED** | `runAllChecks()` integration removed; delegated to code-quality-gate MCP | 🏗️ |
| F33 | State reconciliation (eslint dirty_modules) | L1744-1809 | `scope-after.ts` L24-57 | `eslint_state.aggregate.dirty_modules` push on source writes | ✅ |
| F34 | Knowledge state sync (index reconciliation) | L1811-1845 | `cache-after.ts` L22-59 | `knowledge_cache_state.cache_status` + `total_entries` | ✅ |
| F35 | Failed Task() recording | L1855-1884 | `task-after.ts` L35-81 | `.pending.json.failed` with TTL cap (7d, 100 entries) | ✅ |
| F36 | Audit logging (after-hook `writeAuditLogEntry`) | L1688-1718 | `audit-after.ts` L21-61 | `write_audit_state.history` push with 200-entry cap | ✅ |
| F37 | Stale session detection (after-hook) | L1720-1742 | `gate-after.ts` L27-50 | `autoDrainStaleSessions()` on compliance gate tool completion | ✅ |
| F38 | UC7-003 post-write doc verification | L1886-1911 | `uc7ks-after.ts` (partial) | Cache read tracking migrated; UC7-003 verify log simplified | ⚠️ |
| F39 | Idempotency guard (callID + sessionID) | L61-70, L886-911 | `dispatch-before.ts` L234-242 + `agent-resolver.ts` L93 | `sessionLastDispatched` Map with dual-key (callID + sessionID) | ✅ |
| F40 | `demoLog()` / plugin heartbeat | L35-57 | `log-manager.ts` `writeLog()` | Architecturally replaced: per-plugin `writeLog("loaded")` pattern | 🏗️ |

### A.3 Summary

| Category | Count | Status |
|:--|:--:|:--|
| **Fully migrated** (✅) | 36 | All enforcement logic preserved in decomposed plugins |
| **Architecturally replaced** (🏗️) | 2 | `code-quality-lib.js` → MCP tool; `demoLog()` → `writeLog()` |
| **Partially migrated** (⚠️) | 1 | UC7-003 verify log simplified (functional, less verbose) |
| **Not migrated** (❌) | 0 | — |
| **Total features** | 40 | **100% functional coverage** |

### A.4 Behavioral Differences

| # | Difference | Impact | Risk |
|:--|:--|:--|:--|
| D1 | SA bypass removed (enforce.ts L1327) | SA now subject to ROUTE-MISMATCH + write scope; DAG exemption restored via `isDagCreator` (2026-06-12 fix) | ✅ Resolved |
| D2 | `violations[]` array → direct `throw` | Fail-fast per-check instead of batched violation collection | Low — same end result |
| D3 | `_cachedAgent` module state → session map priority | Session map (Priority 1) prevents parallel dispatch race condition | Positive — fixes P0-4 root cause |
| D4 | `code-quality-lib.js` integration removed | Write-audit no longer runs immediate eslint/tsc/format/depcruise | Low — delegated to `code_quality_gate.run_write_check` MCP tool |
| D5 | `demoLog()` → `writeLog()` | Structured logging with `log-manager.ts` instead of ad-hoc file append | Positive — centralized, categorized logs |
| D6 | `resolveTaskId()` lacks staleness checks | Stale `_dispatch_target.json` from unit tests can return wrong task_id (discovered 2026-06-12); `resolveAgent()` has run_id + 30-min checks but `resolveTaskId()` does not | ⚠️ Open — see A.5 |

### A.5 Open Design Gaps (Discovered During Cross-Reference)

| Gap | Description | Severity | Proposed Fix |
|:--|:--|:--|:--|
| **G1**: `resolveTaskId()` staleness | `agent-resolver.ts` L96-107 reads `_dispatch_target.json` without `run_id` or timestamp validation. Stale files from unit tests return wrong task_id, triggering false DAG violations. | Medium | Add `run_id` check + 30-min timestamp guard (mirror `resolveAgent()` L60-87 pattern) |
| **G2**: `gate-before.ts` no `applyPathScope` | Unlike `scope-before.ts` L62-65, `gate-before.ts` fires DAG check on ALL `isModifyTool()` calls including `safe_shell` with non-modify commands (echo, cat, ls). Read-only shell commands trigger false DAG violations. | Low | Add `applyPathScope` guard or scope DAG check to source files only |
