# FW-PLAN-JS-TO-TS - Verification Report

**Date**: 2026-06-14
**Author**: @Orchestrator

## 1. Verification Results

| # | Task | Agent | Result | Key Finding |
|---|------|-------|--------|-------------|
| 1 | FW-VERIFY-JS-TS-ARCH | @Architect | 7/7 PASS | Architecture consistent, all checks clean |
| 2 | FW-VERIFY-JS-TS-DISPATCH | @Coder-BE | Blocked | DAG gate findTaskInDag() misses execution_order |
| 3 | FW-VERIFY-JS-TS-AUDIT | @Guardian | 5 PASS, 1 CRIT | Dead dist/gate-core.js path compliance-gate.ts:12 |
| 4 | FW-VERIFY-JS-TS-INTEGRATION | @CI-CD-Agent | All PASS | Pre-execution-hook chain verified |
| FS | framework-self-test | @Super-Admin | 36/37 PASS | Check 36 = uncommitted backups only |

## 2. Remaining Issues

### P1 - Dead dist/gate-core.js Path
- File: .opencode/scripts/mcp-tools/compliance-gate.ts:12
- Issue: Dead dist/gate-core.js require path (fallback to .ts works)
- Fix: Swap to source-first, remove .js branch

### P2 - DAG Gate Ignores execution_order ✅ RESOLVED (2026-06-14)
- **Root cause**: `findTaskInDag()` in `gate-checks.ts` only searched `dag.tasks` array, but after DAG compaction tasks are organized in `dag.execution_order` groups. Non-exempt agents (Coder-BE, Coder-FE, Guardian) were blocked from ad-hoc dispatches.

- **Fix consists of THREE changes**:

  **Change 1 — `.opencode/lib/gate-checks.ts`** (lines 68–104):
  `findTaskInDag()` now implements a two-phase search:
  1. Search `dag.tasks` array first (traditional DAG structure)
  2. Fallback: scan `dag.execution_order` groups — supports both:
     - Flat arrays: `"group_name": ["T001", "T002"]`
     - Nested objects: `"group_name": { "sub1": ["T003"], "sub2": ["T004"] }`

  **Change 2 — `.opencode/scripts/pre-execution-hook.sh`** (lines 134–242):
  The legacy DAG fallback block (Stage 1b) now also checks `dag.execution_order`:
  - **jq path** (lines 148–167): `jq` expression scans both `.tasks[]` and `.execution_order.*` entries
  - **python3 path** (lines 168–199): Python fallback iterates `eo.values()` for flat lists and nested phase IDs
  - **bun path** (lines 200–239): Bun fallback uses `Array.isArray(eo)` check → `Object.values(eo)` for nested groups
  - All three paths correctly handle flat arrays and nested objects

  **Change 3 — `.opencode/scripts/pre-execution-gate.ts`** (lines 384-407):
  `checkDagCoverage()` (FW-REPAIR-021) now falls back to scanning `dag.execution_order` groups
  when a task ID is not found in `dag.tasks[]`. The group-flattening logic:
  - Iterates all keys in `execution_order` using `Object.keys(dag.execution_order)`
  - Collects all task IDs into a `Set` (handles both flat arrays and nested phase objects)
  - Returns `true` if the set contains the requested task ID
  - This was the *actual* gate blocking non-exempt agents — `findTaskInDag()` was never reached
    because the pre-execution-gate rejected the task before it could call the library function

- **Verification**:
  - `framework-doctor.ts --strict`: **11/11 PASS** (was 10/11 before P2 fix; Check 6 rule-registry repaired after Phase 3 markdown edits)
  - `framework-self-test.ts`: **36/37 PASS** (Check 36: uncommitted backups only — pre-existing)
  - `framework-compliance-check.ts --strict`: **4/5 PASS, 0 HIGH violations** (1 WARN: `machine_state` dirty — pre-existing)
  - Smoke test: non-exempt agent dispatch through `pre-execution-gate.ts` with tasks in `execution_order` groups — passed

### P3 - Shell Script Warnings
| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | integrity-chain-bundle.sh | Error msg keystone-validate.js (should be .ts) | WARNING |
| 2 | framework-health-check.sh | Uses npx tsx instead of bun | WARNING |
| 3 | path-canonical-lint.sh | Comment mentions .js | COSMETIC |
| 4 | framework-health-check.sh | Comment mentions .js | COSMETIC |

## 3. Recommended Order

Phase 6 - Before commit:
  P1: Fix compliance-gate.ts:12 dead dist path
  P2: Fix findTaskInDag() to check execution_order

Phase 7 - Next sprint:
  P3: 4 shell script warnings
  Add bun cache clear to .bashrc
  Update .github/workflows/ to use bun

Phase 8 - Deferred:
  Audit .md rules for residual .js references
