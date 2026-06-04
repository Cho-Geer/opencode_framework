# Rule Registry & Framework Compliance — Implementation Plan

**Version**: 1.0.0
**Date**: 2026-06-04
**Author**: @Super-Admin
**Analysis Report**: [root-cause-analysis.md](./root-cause-analysis.md)
**Parent**: FW-REPAIR-13 — Resolve Check 26/27 failures (25/27 → 27/27)

---

## Executive Summary

Two independent bugs prevent `framework-self-test.js` from reaching 27/27 PASS. Both are caused by a **compilation gap** — the compiled `lib/dist/lib/gate-core.js` is ~680 lines behind the TypeScript source `lib/gate-core.ts`. Fixing both requires (a) a one-line argument fix in `compliance-gate.js` and (b) recompiling `gate-core.ts` to restore missing exports.

**Total estimated effort**: ~30 minutes
**Risk level**: Low — both fixes are surgical, no structural changes

---

## Current State

| Check | Status | Root Cause |
|:------|:------:|-----------|
| 1–25 | ✅ PASS | — |
| 26 (doctor --strict) | ❌ 2 sub-failures | Issue #1 (rule registry EISDIR) + Issue #2 (compliance crash) |
| 27 (cross-validation) | ❌ doctor mismatch | Cascading from Check 26 |

**Sub-failures within Check 26:**
- ❌ Check 6: Rule registry verification — EISDIR on all 27 files (Issue #1)
- ❌ Check 11: Framework compliance — `resolveFrameworkPaths is not a function` (Issue #2)
- ✅ Check 2: DAG validation (fixed in FW-REPAIR-13)
- ✅ Check 3: Compliance gate dry-run (fixed in FW-REPAIR-13)

---

## Fix #1 — Rule Registry EISDIR

### Problem

`compliance-gate.js:209` calls `_gateCore.computeDigest(OPENCODE_ROOT, filePath)` with two arguments. The compiled `gate-core.js` `computeDigest(filePath)` accepts only one. The first argument (root directory path) is read as a file → EISDIR.

### Implementation

**File**: `.opencode/scripts/mcp-tools/compliance-gate.js`, line 209

**Change**:
```diff
- return _gateCore.computeDigest(OPENCODE_ROOT, filePath);
+ return _gateCore.computeDigest(path.resolve(OPENCODE_ROOT, filePath));
```

This resolves the relative `filePath` to an absolute path before passing to `computeDigest()`, matching the behavior of the fallback code path on lines 212-213.

### Verification

```bash
# Before: all 27 files fail with EISDIR
# After: digests compute successfully
node -e "
const { spawnSync } = require('child_process');
const result = spawnSync('node', ['.opencode/scripts/mcp-tools/compliance-gate.js'], {
  cwd: '/home/zhaoge/workspace/opencode/work-one',
  stdio: 'pipe', timeout: 15000
});
const output = result.stdout.toString();
const verified = (output.match(/digests verified/g) || []).length;
const mismatches = (output.match(/mismatches \(HIGH\)/g) || []).length;
console.log('Verified:', verified, 'Mismatches:', mismatches);
"
# Expected: 27 digests verified, 0 mismatches (or low mismatch count from actual content changes)
```

---

## Fix #2 — Framework Compliance Check (`resolveFrameworkPaths`)

### Problem

`framework-compliance-check.js:7` imports `resolveFrameworkPaths` from the compiled `gate-core.js`, but this function is **not in the export list**. The source `gate-core.ts` defines it (line 909), but the compiled JS is missing ~51% of the source including this function.

### Implementation

**Option A (Recommended) — Recompile gate-core.ts:**

```bash
cd .opencode/lib
npx tsc -p tsconfig.json
```

This regenerates `dist/lib/gate-core.js` with all 35+ exports, including `resolveFrameworkPaths`.

**Pre-requisites:**
- `typescript` must be installed (`npx tsc --version`)
- `tsconfig.json` must exist in `.opencode/lib/`

**Option B (Fallback) — Inline paths in the compliance check:**

If `tsc` is unavailable, modify `framework-compliance-check.js` to define paths inline:

```javascript
// framework-compliance-check.js:7 — REPLACE broken import
// BEFORE (broken):
const { readJsonFile, resolveFrameworkPaths } = require('../lib/dist/lib/gate-core.js');
const paths = resolveFrameworkPaths();

// AFTER (self-contained):
const path = require('path');
const { readJsonFile } = require('../lib/dist/lib/gate-core.js');

/**
 * FW-REPAIR-13: resolveFrameworkPaths is missing from compiled gate-core.js.
 * Defined inline until tsc recompilation restores the export.
 */
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const paths = {
  root: PROJECT_ROOT,
  dag: path.join(PROJECT_ROOT, 'Task.DAG.json'),
  gateState: path.join(PROJECT_ROOT, '.opencode/state/gate-state.json'),
  gateIndex: path.join(PROJECT_ROOT, '.opencode/state/gate-state.index.json'),
  gateArchive: path.join(PROJECT_ROOT, '.opencode/state/gate-state.archive.json'),
  machine: path.join(PROJECT_ROOT, '.opencode/state/machine.json'),
  ruleRegistry: path.join(PROJECT_ROOT, '.opencode/state/rule_registry.json'),
  transactionLog: path.join(PROJECT_ROOT, '.opencode/state/.transaction-log'),
};
```

**Additionally**, fix line 30 which also uses V2 `gateState.sessions`:

```javascript
// framework-compliance-check.js:30 — BEFORE (V2-only):
const activeSessions = gateState && gateState.sessions
  ? Object.values(gateState.sessions).filter(s => s.gate_status === 'armed')
  : [];

// AFTER (V2 + V3 compatible):
const activeSessions = [];
if (gateState) {
  // V3 format: active_sessions is an object
  if (gateState.active_sessions && typeof gateState.active_sessions === 'object') {
    for (const s of Object.values(gateState.active_sessions)) {
      if (s && s.gate_status === 'armed') activeSessions.push(s);
    }
  }
  // V2 format: sessions is a flat map
  if (gateState.sessions && typeof gateState.sessions === 'object') {
    for (const s of Object.values(gateState.sessions)) {
      if (s && s.gate_status === 'armed') activeSessions.push(s);
    }
  }
}
```

### Verification

```bash
# Option A: verify recompilation
node -e "
const mod = require('/home/zhaoge/workspace/opencode/work-one/.opencode/lib/dist/lib/gate-core.js');
console.log('resolveFrameworkPaths:', typeof mod.resolveFrameworkPaths);
console.log('readJsonFile:', typeof mod.readJsonFile);
"
# Expected: resolveFrameworkPaths: function, readJsonFile: function

# Option B: verify inline fix
node .opencode/scripts/framework-compliance-check.js; echo "Exit: $?"
# Expected: Exit: 0 (or exit 1 with specific violations, not a crash)
```

---

## Execution Order

```
Step 1 (5 min) — Fix #1: compliance-gate.js line 209
  └── Independent — no dependencies

Step 2 (15-30 min) — Fix #2: gate-core.js recompilation OR inline paths
  └── Independent — no dependencies on Fix #1

Step 3 (2 min) — Verify: framework-self-test.js
  └── Depends on: Fix #1 + Fix #2

Step 4 (2 min) — Verify: compliance_gate_check
  └── Depends on: Fix #1
```

---

## Rollback Plan

| Fix | Rollback |
|-----|----------|
| Fix #1 (compliance-gate.js) | `git checkout -- .opencode/scripts/mcp-tools/compliance-gate.js` |
| Fix #2 Option A (tsc) | `git checkout -- .opencode/lib/dist/` |
| Fix #2 Option B (inline) | `git checkout -- .opencode/scripts/framework-compliance-check.js` |

Both fixes are **files in `.opencode/`** — within @Super-Admin's authorized scope. No business code or database schema affected.

---

## Success Criteria

| # | Criterion | Measurement |
|:--|-----------|------------|
| 1 | `compliance_gate_check` verifies rule digests | 27 digests verified (or actual content mismatch count), 0 EISDIR errors |
| 2 | `framework-compliance-check.js` does not crash | Exit code indicates check result, not `TypeError` |
| 3 | Doctor sub-check "Rule registry verification" PASSes | Check 26 sub-check 6: PASS |
| 4 | Doctor sub-check "Framework compliance" PASSes | Check 26 sub-check 11: PASS |
| 5 | `framework-self-test.js` reports **27/27 PASS** | `grep "CHECKS FAILED"` returns 0 |
| 6 | Pre-commit Layer 1.5 rule registry verification works | Commit passes Layer 1.5 without EISDIR |

---

## Appendix A: Why the Compilation Gap Exists

The `lib/dist/` directory is populated by running `tsc` on the TypeScript source in `lib/`. The compilation was last done **before** the FW-ENHANCE-A2-A5-EXTRAS workstream added `resolveFrameworkPaths()` and extended `computeDigest()` to `gate-core.ts`. Since then, the source has grown by ~680 lines but `tsc` was never re-run.

**Prevention**: The nightly compaction CI workflow already has a `tsc` compile step (added in FW-REPAIR-13 P3-1b). After this fix, `lib/dist/` will stay in sync automatically.

---

## Appendix B: OpenCode Upstream Reference

The OpenCode ecosystem does not provide a rule registry or framework compliance checker — these are custom extensions unique to this project. Relevant upstream docs:

| Document | URL | Relevance |
|----------|-----|-----------|
| Rules | https://opencode.ai/docs/rules/ | OpenCode's native `AGENTS.md` + `instructions` system |
| Plugins | https://opencode.ai/docs/plugins/ | Plugin SDK used by `framework-enforcer.ts` |
| Custom Tools | https://opencode.ai/docs/custom-tools/ | Pattern for MCP tools like `compliance-gate.js` |
| SDK | https://opencode.ai/docs/sdk/ | `@opencode-ai/sdk` used for structured logging |

Our `rule_registry.json` + `compliance-gate.js` + `framework-compliance-check.js` are built **on top of** OpenCode's plugin system, not part of it.

---

*Implementation Plan Version: 1.0.0*
*Generated: 2026-06-04*
*Author: @Super-Admin*
