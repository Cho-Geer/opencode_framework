# Rule Registry & Framework Compliance — Root Cause Analysis

**Version**: 1.0.0
**Date**: 2026-06-04
**Author**: @Super-Admin (FW-REPAIR-13 diagnostic phase)
**Status**: Investigation Complete — 2 root causes identified
**Parent Task**: FW-REPAIR-13: Resolve remaining framework-self-test Check 26/27 failures

---

## Executive Summary

The framework self-test (`framework-self-test.js`) reports **2 failures** (Check 26, Check 27) caused by **4 doctor sub-checks**. Investigation reveals **2 independent root causes**, both arising from stale/out-of-sync compiled JavaScript in `lib/dist/` relative to the source TypeScript in `lib/`. Neither is a design flaw — both are **compilation/deployment synchronization issues**.

| # | Symptom | Root Cause | Severity | Fix Effort |
|:--|---------|-----------|:--------:|:----------:|
| 1 | Rule registry EISDIR — cannot compute digest on all 27 registered files | `compliance-gate.js` passes wrong args to `gate-core.computeDigest()` | 🔴 HIGH | 5 min |
| 2 | Framework compliance check crashes: `resolveFrameworkPaths is not a function` | `resolveFrameworkPaths` missing from compiled `gate-core.js` | 🔴 HIGH | 30 min |

---

## 1. Issue #1 — Rule Registry EISDIR (All 27 Files)

### 1.1 Symptom

Every `compliance_gate_check` call reports `EISDIR: illegal operation on a directory, read` for all 27 registered rule/skill/agent files:

```
rule_registry_read_error_rules_common_project_md:
  [Gate Preflight v2] .opencode/rules/common-project.md: cannot compute digest (EISDIR: illegal operation on a directory, read)
```

This repeats for all 27 entries in `rule_registry.json`, causing `0 digests verified, 27 mismatches (HIGH)`.

### 1.2 Investigation

**Step 1 — Verify files exist and are not directories:**

```bash
$ stat .opencode/rules/common-project.md
  FILE — 2464 bytes
$ stat .opencode/rules/mcp-compliance-guide.md
  FILE — 1203 bytes
```

All 27 registered paths are legitimate **files**, not directories. The EISDIR cannot come from the actual file path.

**Step 2 — Trace the digest computation call chain:**

The error originates from `compliance-gate.js` → `computeDigest()` function (line 207):

```javascript
// compliance-gate.js:207-219
function computeDigest(filePath) {
  if (_gateCore && typeof _gateCore.computeDigest === "function") {
    return _gateCore.computeDigest(OPENCODE_ROOT, filePath);  // ← BUG
  }
  // Fallback (correct):
  const resolved = path.resolve(OPENCODE_ROOT, filePath);
  const content = fs.readFileSync(resolved);
  // ...
}
```

When `_gateCore` is available (the normal case), line 209 calls:
```javascript
_gateCore.computeDigest(OPENCODE_ROOT, filePath)
//                      ^^^^^^^^^^^^^  ^^^^^^^^
//                      first arg      second arg (IGNORED by JS)
```

**Step 3 — Check the callee signature:**

```javascript
// gate-core.js:631 (compiled)
function computeDigest(filePath) {  // ← ONLY ONE parameter
    const content = fs.readFileSync(filePath);  // ← reads first argument
    // ...
}
```

JavaScript silently ignores extra arguments. So:
- `filePath` (parameter) = `OPENCODE_ROOT` = `/home/zhaoge/workspace/opencode/work-one` (a **directory**)
- The second argument (the actual rule file path) is **dropped**
- `fs.readFileSync('/home/zhaoge/workspace/opencode/work-one')` → **EISDIR**

### 1.3 Root Cause

**Argument mismatch between caller and callee.** `compliance-gate.js:209` was written expecting `computeDigest(rootDir, relativePath)` with two arguments, but the compiled `gate-core.js` `computeDigest(filePath)` accepts only one — an absolute path.

The fallback path (lines 212-213) correctly uses `path.resolve(OPENCODE_ROOT, filePath)`, which is why manual digest computation works but the delegated one fails.

### 1.4 Impact

- **Self-test Check 26**: Doctor sub-check "Rule registry verification" FAILs
- **Self-test Check 27**: Cascading failure (doctor disagrees with reconciler)
- **Every `compliance_gate_check`**: Reports 27 HIGH mismatches (advisory mode downgrades to WARNING)
- **Pre-commit Layer 1.5**: Rule registry verification always fails

### 1.5 Fix

**File**: `.opencode/scripts/mcp-tools/compliance-gate.js`, line 209

```diff
- return _gateCore.computeDigest(OPENCODE_ROOT, filePath);
+ return _gateCore.computeDigest(path.resolve(OPENCODE_ROOT, filePath));
```

This makes the delegated call match the fallback's behavior: resolve the relative path to absolute before passing to `computeDigest()`.

---

## 2. Issue #2 — Framework Compliance Check Crash

### 2.1 Symptom

Running `framework-compliance-check.js` crashes immediately:

```
TypeError: resolveFrameworkPaths is not a function
    at Object.<anonymous> (framework-compliance-check.js:9:15)
```

### 2.2 Investigation

**Step 1 — Check the import statement:**

```javascript
// framework-compliance-check.js:7
const { readJsonFile, resolveFrameworkPaths } = require('../lib/dist/lib/gate-core.js');
```

The import path resolves to: `.opencode/lib/dist/lib/gate-core.js` — this file **exists** (verified).

**Step 2 — Verify the export:**

```javascript
// gate-core.js:60-80 (compiled exports)
exports.getProjectRoot = getProjectRoot;
exports.resolveStateDir = resolveStateDir;
exports.readJsonFile = readJsonFile;          // ✅ Exported
exports.fileExists = fileExists;
exports.computeSHA256 = computeSHA256;
// ... 15 more exports ...
exports.extractSemver = extractSemver;
// ❌ resolveFrameworkPaths NOT in export list
```

`readJsonFile` IS exported — so that destructuring succeeds. But `resolveFrameworkPaths` is NOT in the export list → `undefined` → `TypeError` when called as a function.

**Step 3 — Check the source TypeScript:**

```typescript
// gate-core.ts:909
export function resolveFrameworkPaths(rootDir?: string): FrameworkPaths {
  const root = rootDir || getProjectRoot();
  return {
    root,
    dag: path.join(root, 'Task.DAG.json'),
    gateState: path.join(root, '.opencode/state/gate-state.json'),
    // ... 6 more paths ...
  };
}
```

The function **exists in source** but is **absent from the compiled JS**.

**Step 4 — Quantify the compilation gap:**

| Metric | Source (.ts) | Compiled (.js) | Missing |
|--------|:-----------:|:-------------:|:-------:|
| Total lines | 1,348 | 664 | 684 (51%) |
| Exported functions | ~35 | 21 | ~14 |

Approximately **51% of gate-core.ts was not compiled** into `gate-core.js`. The missing section (lines 832–1348) includes:
- `computeDigest()` (present but with wrong signature expectations)
- `resolveFrameworkPaths()`
- `FrameworkPaths` interface
- Several compliance/validation helpers

### 2.3 Root Cause

**Stale compiled artifact.** The `gate-core.ts` TypeScript source was updated with new functions (`resolveFrameworkPaths`, extended `computeDigest`, etc.) added during FW-ENHANCE-A2-A5-EXTRAS, but the `lib/dist/lib/gate-core.js` was **never recompiled** to include these additions. The compiled JS is an older snapshot missing ~680 lines of source.

### 2.4 Impact

- **Self-test Check 26**: Doctor sub-check "Framework compliance" FAILs
- **Self-test Check 27**: Cascading failure
- **`framework-compliance-check.js`**: Completely non-functional — crashes before any checks run
- **Any tool importing from gate-core**: May get `undefined` for newer functions

### 2.5 Fix

Two options:

**Option A (Recommended) — Recompile gate-core.ts:**
```bash
cd .opencode/lib && npx tsc -p tsconfig.json
```
This regenerates `dist/lib/gate-core.js` with all 35+ exports including `resolveFrameworkPaths`.

**Option B (Fallback) — Inline paths in compliance check:**
If recompilation is blocked (e.g., `tsc` not available), define framework paths directly in `framework-compliance-check.js`:

```javascript
// Replace the broken import with inline path constants:
const path = require('path');
const { readJsonFile } = require('../lib/dist/lib/gate-core.js');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const paths = {
  dag: path.join(PROJECT_ROOT, 'Task.DAG.json'),
  gateState: path.join(PROJECT_ROOT, '.opencode/state/gate-state.json'),
  machine: path.join(PROJECT_ROOT, '.opencode/state/machine.json'),
};
```

---

## 3. Cross-Cutting Observations

### 3.1 The Common Thread: Compilation Gap

Both issues stem from the same underlying problem: the compiled `lib/dist/` artifacts are **out of sync** with the TypeScript source in `lib/`. The `gate-core.ts` source was extended during FW-ENHANCE-A2-A5-EXTRAS but `tsc` was never re-run.

### 3.2 Why This Wasn't Caught Earlier

1. **`compliance-gate.js` has a fallback** (lines 211-218) that works correctly when `_gateCore` is null, masking the bug in environments where the gate-core module fails to load.
2. **`readJsonFile` IS exported**, so the `require()` in `framework-compliance-check.js` doesn't throw at import time — only when the undefined `resolveFrameworkPaths` is called.
3. **No CI step validates** that `lib/dist/` is current against `lib/` source.

### 3.3 OpenCode Upstream Context

The OpenCode/Crush ecosystem does not define a rule registry or compliance checking mechanism — these are **custom framework extensions** unique to this project. OpenCode's native `rules/` system uses `AGENTS.md` and `instructions` in `opencode.json` (see [opencode.ai/docs/rules/](https://opencode.ai/docs/rules/)). Our framework's semantic version + SHA-256 digest registry and framework compliance checker are additions built on top of the plugin SDK (`@opencode-ai/plugin`).

This means the fix is entirely within our control — no upstream dependency.

---

## 4. Self-Test Impact Projection

After applying both fixes:

| Check | Before | After |
|:------|:------:|:-----:|
| Check 21 (pre-commit +x) | ✅ PASS | ✅ PASS |
| Check 24 (doctor executable) | ✅ PASS | ✅ PASS |
| Check 25 (doctor JSON) | ⚠️ 9 PASS, 2 FAIL | ✅ 11 PASS |
| Check 26 (doctor --strict) | ❌ 2 sub-failures | ✅ All sub-checks PASS |
| Check 27 (cross-validation) | ❌ doctor mismatch | ✅ Clean |
| **Total** | **25/27** | **27/27** ✅ |

---

## Appendix A: Files Involved

| File | Role | Issue |
|------|------|:-----:|
| `compliance-gate.js:209` | Rule digest computation | Issue #1 (arg mismatch) |
| `gate-core.ts:832-840` | `computeDigest()` source | Signature correctly takes 1 arg |
| `gate-core.js:631-639` | `computeDigest()` compiled | 1-arg, but called with 2 args |
| `gate-core.ts:909-930` | `resolveFrameworkPaths()` source | Defined, exported |
| `gate-core.js:60-80` | Export list (compiled) | Missing `resolveFrameworkPaths` |
| `framework-compliance-check.js:7` | Compliance checker entry | Import fails for missing export |
| `rule_registry.json` | 27 registered rule digests | All fail verification (symptom only) |

---

## Appendix B: Verification Commands

After fixes, verify with:

```bash
# 1. Verify rule registry digests now compute correctly
node .opencode/scripts/mcp-tools/compliance-gate.js 2>&1 | grep "digests verified"

# 2. Verify framework compliance check no longer crashes
node .opencode/scripts/framework-compliance-check.js 2>&1; echo "Exit: $?"

# 3. Run full self-test
node .opencode/scripts/framework-self-test.js

# Expected: 27/27 CHECKS PASSED
```

---

*Analysis Report Version: 1.0.0*
*Generated: 2026-06-04*
*Author: @Super-Admin*
*Upstream Reference: https://opencode.ai/docs/rules/, https://opencode.ai/docs/plugins/*
