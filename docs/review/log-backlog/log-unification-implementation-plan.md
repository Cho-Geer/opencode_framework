# Section 四: Implementation Plan — Log Unification (v5.1 — Dispatch-Verified)

**Date**: 2026-06-13
**Author**: @Orchestrator (VERIFY-LOG-UNIFY practical dispatch)
**Auditor**: @Super-Admin (AUDIT-LOG-UNIFY-PLAN, cg_ses_1781241724894)
**Supersedes**: v5.0 (FW-REVIEW-LOG-UNIFY)
**Target Report**: docs/review/log-backlog/log-fragmentation-report.md v2.1
**Audit Reference**: `.task_temp/AUDIT-LOG-UNIFY-PLAN/HANDOVER.md`

---

### v5.1 Dispatch Verification Evidence (NEW)

| Check | Method | Finding |
|:------|:------:|:--------|
| Log file names on disk | `ls .task_temp/_logs/2026-06-13/` | 51 files total; only 2 have level-based names (legacy pre-fix artifacts) |
| F1 fix runtime behavior | Code inspection | `normalizeCategory()` at `log-manager.ts:116-120` correctly maps level strings to `"runtime"` |
| `plugin-script-pre-execution-gate-runtime.log` | File existence | ✅ EXISTS — proves F1 fix routes writes correctly |
| `plugin-lib-shared-infra-runtime.log` | File existence | ❌ Missing — shared-infra not flushed since fix |
| O_APPEND in flushBuffer | Code inspection | `log-manager.ts:284` uses `fs.openSync(file, O_WRONLY \| O_CREAT \| O_APPEND, 0o644)` |
| _error.log dated path | Code inspection | `log-manager.ts:581` uses `getLogDir()` (dated directory) |
| `logs.level` in config | `grep project.config.json` | Present: `logs.level: INFO`, `logs.file_prefix: plugin`, `logs.source_types: mcp,script,lib,plugin` |
| LogIndex `sources` section | `node -e` inspection | Not yet on disk (v2.0); code at `log-manager.ts:456` ready to auto-migrate |
| framework-self-test | `node framework-self-test.ts` | **37/37 PASS** |
| framework-doctor | `node framework-doctor.ts --strict` | **11/11 PASS** (including Check 8: Path portability) |

---

## 四.0 Remediation Summary (v5.0 Changes — Source-Verified)

This version cross-references v4.0 against actual source code and 9 OpenCode framework spec systems. It corrects 6 document-vs-source discrepancies (G1–G6) and documents 8 framework compliance gaps (B1–B8).

### v5.0 Corrections (Document vs Source Code)

| Gap | Severity | Description | Remediation |
|-----|----------|-------------|-------------|
| **G1**: A1 line numbers drifted | 🟡 MED | Plan referenced lines 198,213,223… but source shifted to 201,214,224… | Updated all line numbers to match current source |
| **G2**: A2 count+line drift | 🟡 MED | Plan said "10 calls" at wrong lines; actual has 11 calls (10 writeLog + import) | Corrected count and line numbers |
| **G3**: C2 gateLog count wrong | 🔴 HIGH | Plan claimed "3 gateLog calls" but actual has **9+ gateLog calls** | Corrected to 9+ calls with full call inventory |
| **G4**: D2 log-rotator contradiction | 🔴 HIGH | §四.2.D said "DONE, CORRECT ✅" but immediately said "needs fix" | Resolved: marked as NEEDS API FIX (F1 pattern) |
| **G5**: C9 knowledge file count | 🟡 MED | Plan said "5 remaining files untouched" but actual has **6 files** | Corrected to 6 files with full inventory |
| **G6**: Missing `logs.level` config | 🟡 MED | log-manager.ts:145 reads `logs.level` from template_resolution but it's **not defined** in project.config.json | ✅ **FIXED** in v3.0.0 — `project.config.json` now has `logs.level`, `logs.file_prefix`, `logs.source_types` |

### v5.0 Framework Compliance Gaps (9-System Analysis)

| Gap | System | Severity | Description | Status (v5.1) |
|-----|--------|----------|-------------|:--------------:|
| **B1**: gate-core non-dated path | Layout Architecture | 🟡 HIGH | `gate-core.ts:339` writes to `.task_temp/_logs/lib-gate-core-runtime.log` (root) — violates dated-directory convention | ✅ **N/A** (gate-core now delegates to log-manager, no direct writes) |
| **B2**: _error.log non-dated path | Layout Architecture | 🟡 MED | `logSelfError` writes `_error.log` to non-dated root | ✅ **FIXED** in v3.0.0 — `log-manager.ts:581` uses `getLogDir()` (dated); comment: `FW-LOG-UNIFY B2` |
| **B3**: Plugin vs client.app.log | Log Central Management | 🟡 MED | Official spec says plugins use `client.app.log()`. Framework plugins use project-specific `writeLog()` — rationale undocumented | 📋 Documented (§四.13.B3 design rationale) |
| **B4**: Concurrent write precision | Concurrent Session/Dispatch | 🟡 MED | `appendFileSync` may do multiple internal writes; POSIX `O_APPEND` atomicity is per `write()` syscall | ✅ **FIXED** in v3.0.0 — `log-manager.ts:284`: `fs.openSync(file, O_WRONLY \| O_CREAT \| O_APPEND, 0o644)` + 64KB chunked writes |
| **B5**: {logs.*} template vars | Templatization | 🟡 LOW | Placeholders not registered in `TEMPLATE_VARIABLE_STANDARD.md` §2 catalog format | ⚠️ Config keys present in project.config.json; §四.11 catalog entries not yet added to standard doc |
| **B6**: LogIndex regex gap | Log Central Management | 🟡 MED | §四.8 regex `^plugin-(mcp|script|lib)-` won't match `lib-gate-core-runtime.log` (no `plugin-` prefix) | ⚠️ `scanSources()` code in place (`log-manager.ts:489`); needs activation cycle |
| **B7**: logSelfError audit gap | Hardened Enforcement | 🟢 LOW | `_error.log` not tracked by `machine.json.write_audit_state` | 📋 Documented as future enhancement |
| **B8**: Compliance records correlation | Central State Management | 🟢 LOW | Log entries don't cross-reference `machine.json.compliance_records` | 📋 Documented as future enhancement |

---

## 四.0.1 Actual Implementation Status (v5.1 — Dispatch-Verified 2026-06-13)

**38 writeLog calls across 10 source files.** log-manager.ts v3.0.0 deployed with F1 Option A fix (normalizeCategory), B2 (_error.log dated), B4 (O_APPEND flush), G6 (logs.level config).

### Infrastructure Fixes (Phase 0)

| Fix | Status | Evidence |
|:----|:------:|:---------|
| **F1 Option A**: LogCategory extended | ✅ **APPLIED** | `log-manager.ts:39`: `type LogCategory = "loaded" \| "hooks" \| "runtime" \| LogLevel;` |
| **F1**: normalizeCategory() | ✅ **APPLIED** | `log-manager.ts:116-120`: maps level strings → `"runtime"` |
| **F1**: flushBuffer uses normalized category | ✅ **APPLIED** | `log-manager.ts:265`: `const normCat = normalizeCategory(category);` |
| **B2**: _error.log dated path | ✅ **FIXED** | `log-manager.ts:581`: `logSelfError()` uses `getLogDir()` (dated) |
| **B4**: O_APPEND atomic flush | ✅ **FIXED** | `log-manager.ts:284`: `fs.openSync(file, O_WRONLY \| O_CREAT \| O_APPEND, 0o644)` + 64KB chunks |
| **G6**: logs.level in config | ✅ **FIXED** | `project.config.json`: `logs.level`, `logs.file_prefix`, `logs.source_types` all present |
| **F2**: LogIndex sources section | ⚠️ **CODE IN PLACE** | `log-manager.ts:456`: `scanSources()` populates sources; disk `index.json` still v2.0 (needs next plugin load cycle) |
| **B1**: gate-core dated path | ✅ **N/A** | gate-core.ts no longer has direct `appendFileSync` logging |

### Phase Status

| Phase | Target Files | Status | Evidence (v5.1 dispatch-verified) |
|-------|-------------|:------:|----------|
| **Phase 0**: Infrastructure | log-manager.ts, project.config.json | ✅ **DONE** | F1 Option A, B2, B4, G6 all applied in v3.0.0 |
| **Phase 1**: Lib Foundation | 3 files, 3 sites | ✅ **DONE** | `FW-LOG-UNIFY-P1-D1` (shared-infra:1 call), `P1-D2` (log-rotator:1 call), `P1-D3` (gate-core:delegates) |
| **Phase 2**: MCP Tools | 6 files, ~60 sites | ⚠️ **MOSTLY DONE** | `P2-A1` (compliance-gate: 14 calls), `P2-A2` (code-quality-gate: 10 calls), `P2-A5` (keystone-validate). F1 Option A makes existing calls work correctly |
| **Phase 3**: Scripts (High Priority) | 9+ files, ~180 sites | ⚠️ **PARTIAL** | `P3-C2` (pre-execution-gate: 9+ gateLog calls). CLI scripts (C3-C8) untouched |
| **Phase 4**: Knowledge Subsystem | 8 files, ~28 sites | ⚠️ **PARTIAL** | `P4` (archiver: 3 calls, size-reporter: 1 call). 6 files untouched |
| **Phase 5**: Verification | All files | ⚠️ **PARTIAL** | Dispatch test done (2/51 level-based files = legacy artifacts). Framework-self-test: 37/37 PASS |

**ℹ️ F1 Status Update**: With Option A applied, the existing 38 writeLog calls that use level strings (e.g. `writeLog("mcp-compliance-gate", "INFO", {...})`) now produce correct file names via `normalizeCategory()`. No retroactive fix needed — the calls work as-is. Legacy level-based files (`plugin-lib-shared-infra-INFO.log`, `plugin-script-pre-execution-gate-INFO.log`) remain as pre-fix artifacts and will not be updated further.

---

## 四.1 Classification Methodology

Each log call is classified into one of four actions:

| Class | Code | Meaning |
|-------|------|---------|
| **KEEP stderr** | `K` | Must remain on stderr (MCP protocol, CLI output, ERROR PROTOCOL) |
| **MIGRATE to writeLog** | `M` | Replace with writeLog() call; stderr removed |
| **DUAL-WRITE** | `D` | Keep stderr AND add writeLog() for persistence |
| **NO CHANGE** | `—` | Already correct; no modification |

---

## 四.2 writeLog() API — Corrected Signature

### 四.2.0 Function Signature (from log-manager.ts:174)

```typescript
export function writeLog(
  plugin: string,        // Source identifier (e.g., "mcp-compliance-gate")
  category: LogCategory, // Semantic category: "loaded" | "hooks" | "runtime"
  fields: LogFields,     // Structured log entry
): void

export type LogCategory = "loaded" | "hooks" | "runtime";

export interface LogFields {
  sessionID?: string;
  callID?: string;
  agent?: string;          // ← FRAMEWORK_AGENT env var value
  agentType?: string;
  level?: LogLevel;        // "DEBUG" | "INFO" | "WARN" | "ERROR"
  event: string;           // ← REQUIRED: machine-readable event name
  detail: string;          // ← REQUIRED: human-readable description
}
```

### 四.2.0.1 ❌ WRONG (v3.0 pattern — causes F1):
```typescript
// WRONG: "INFO" is a log level, not a valid LogCategory
writeLog("mcp-compliance-gate", "INFO", { event: "txn_committed", ... });
// Produces file: plugin-mcp-compliance-gate-INFO.log ← WRONG
```

### 四.2.0.2 ✅ CORRECT (v4.0 pattern):
```typescript
// CORRECT: "runtime" is a valid LogCategory; level goes in fields
writeLog("mcp-compliance-gate", "runtime", {
  level: "INFO",
  event: "txn_committed",
  detail: `Transaction ${txn.operationId} committed successfully`,
  agent: process.env.FRAMEWORK_AGENT || "unknown",
});
// Produces file: plugin-mcp-compliance-gate-runtime.log ← CORRECT
```

### 四.2.0.3 Convenience Wrapper Pattern

For files with many log calls, define a local wrapper to reduce boilerplate:

```typescript
// CJS files (MCP tools, scripts):
const { writeLog: _wl } = require("../lib/log-manager");
function srcLog(level, event, detail, extra = {}) {
  if (_wl) _wl("mcp-compliance-gate", "runtime", {
    level, event, detail,
    agent: process.env.FRAMEWORK_AGENT || "unknown",
    ...extra,
  });
}

// ESM files (lib, plugins):
import { writeLog as _wl } from "./log-manager";
function srcLog(level, event, detail, extra = {}) {
  _wl("lib-log-rotator", "runtime", {
    level, event, detail,
    agent: process.env.FRAMEWORK_AGENT || "unknown",
    ...extra,
  });
}
```

---

## 四.2.A MCP Tools

All MCP tools communicate via JSON-RPC over stdin/stdout. `console.log()` is **absolutely prohibited** — it pollutes the protocol. `process.stderr.write()` is the only safe real-time channel. Therefore, stderr calls must be KEPT and writeLog ADDED alongside (DUAL-WRITE pattern).

**Module system**: CJS (`require`). Import log-manager via: `const { writeLog } = require("../../lib/log-manager");`

#### A1. compliance-gate.ts — STATUS: ⚠️ 14 calls migrated (P2-A1), NEEDS API FIX

**File**: `.opencode/scripts/mcp-tools/compliance-gate.ts`
**FW-LOG-UNIFY annotations**: 14 (v5.0 source-verified line numbers)

**Retroactive fix required** — change all 14 calls from v3.0 pattern to v4.0:

| Line | Current (WRONG) | Fix to (CORRECT) |
|:----:|-----------------|-------------------|
| 201 | `writeLog("mcp-compliance-gate", "INFO", {event:"txn_committed", ...})` | `writeLog("mcp-compliance-gate", "runtime", {level:"INFO", event:"txn_committed", detail:"...", agent:...})` |
| 214 | `writeLog("mcp-compliance-gate", "WARN", {event:"txn_fallback", ...})` | `writeLog("mcp-compliance-gate", "runtime", {level:"WARN", event:"txn_fallback", detail:"...", agent:...})` |
| 224 | `writeLog("mcp-compliance-gate", "ERROR", {event:"txn_failure", ...})` | `writeLog("mcp-compliance-gate", "runtime", {level:"ERROR", event:"txn_failure", detail:"...", agent:...})` |
| 248 | Same pattern | Same fix |
| 261 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Add `level:"WARN"`, `agent:...` |
| 512 | `writeLog("mcp-compliance-gate", "DEBUG", {event:"enforcement_mode_diag", ...})` | `writeLog("mcp-compliance-gate", "runtime", {level:"DEBUG", event:"enforcement_mode_diag", detail:"...", agent:...})` |
| 829 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 835 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 849 | `writeLog("mcp-compliance-gate", "INFO", ...)` | Same fix |
| 861 | `writeLog("mcp-compliance-gate", "INFO", ...)` | Same fix |
| 1388 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 1461 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 1520 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 1528 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |

**Recommended**: Replace with convenience wrapper `srcLog()` to avoid repeating 14 similar fixes.

#### A2. code-quality-gate.ts — STATUS: ⚠️ 10 calls migrated (P2-A2), NEEDS API FIX

**File**: `.opencode/scripts/mcp-tools/code-quality-gate.ts`
**FW-LOG-UNIFY annotations**: 10 writeLog calls at lines 227, 239, 249, 259, 272, 282, 325, 333, 466, 573 (+ import L60)

Same fix pattern as A1: change `"WARN"` / `"INFO"` / `"ERROR"` → `"runtime"` + `{level:"WARN", ...}`.

#### A3. code-quality-lib.ts — STATUS: ✅ NO CHANGES NEEDED

Pure functions — no logging needed.

#### A4. eslint-audit.ts — STATUS: ✅ 2 KEEP sites, no migration needed

Bootstrap/fatal stderr only.

#### A5. keystone-validate.ts — STATUS: ✅ Bug fix applied (P2-A5)

Line 154: `console.error` → `process.stderr.write` fix applied.

#### A6. reconciliation-validate.ts — STATUS: ❌ NOT DONE

19 console sites. CLI tool — keep stdout, add writeLog for inconsistency details.

---

## 四.2.B Custom Tools — STATUS: ✅ ALL CLEAN

All 5 custom tools (.opencode/tools/) have zero log calls or delegate to persistent loggers.

---

## 四.2.C Scripts

#### C1. dispatch-subagent.ts (command-tools/) — STATUS: ✅ KEEP ALL (ERROR PROTOCOL)

~23 console.error sites form the ERROR PROTOCOL consumed by dispatch_subagent ESM tool via execFileSync. **DO NOT MIGRATE.**

#### C2. pre-execution-gate.ts — STATUS: ⚠️ PARTIAL (9+ gateLog calls), CORRECT APPROACH

**File**: `.opencode/scripts/pre-execution-gate.ts`
**FW-LOG-UNIFY annotations**: 9+ gateLog call sites (v5.0 source-verified)

**v5.0 correction**: v4.0 claimed "3 gateLog calls" (G3 discrepancy). Actual inventory:

| Line | Event Category | Level | Purpose |
|:----:|---------------|-------|---------|
| 237 | `gate_check_failed` | ERROR/WARN | Critical — gate check failure audit |
| 365 | `dag_skip` | INFO | Creator-agent DAG skip |
| 531 | `rule_registry_missing` | INFO | Registry not found |
| 638 | `rule_registry_warnings` | WARN | Registry validation warnings |
| 857 | `super_admin_bypass` | INFO | SA emergency bypass audit |
| 862 | `uc7ks_cache_healthy` | INFO | UC7KS cache health check |
| 881 | `uc7ks_pipeline_warn` | WARN | UC7KS pipeline warning |
| 898 | `uc7ks_emergency_bypass` | WARN | UC7KS emergency bypass audit |
| 964 | `gate_result` | INFO/ERROR | Final gate outcome |

**v4.0 approach update** (correcting F7): The original plan said "migrate ALL 48 console.error". The actual implementation correctly chose a **selective approach**:

| Site Type | Count | Action | Rationale |
|-----------|:-----:|--------|-----------|
| Gate audit events (9 gateLog calls above) | 9 | ✅ DUAL-WRITE via gateLog() | Critical audit — must persist |
| Progress indicators (Check 1/6...) | ~15 | KEEP stderr only | Real-time terminal visibility, low audit value |
| Check results (✅/❌ per check) | ~12 | KEEP stderr only | Visible in terminal, gateLog captures summary |
| Bootstrap/fatal | ~5 | KEEP stderr only | Startup diagnostics |
| Advisory warnings | ~8 | KEEP stderr only | Non-blocking, terminal visible |
| Stage headers/separators | ~6 | KEEP stderr only | Formatting only |

**gateLog wrapper** (already implemented at lines 22-25):
```javascript
function gateLog(category, level, data) {
  const wl = getWriteLog();
  if (wl) wl("script-pre-execution-gate", level, { event: category, ...data });
}
```

**⚠️ API FIX NEEDED**: gateLog passes `level` as second parameter (v3.0 bug). Fix to:
```javascript
function gateLog(category, level, data) {
  const wl = getWriteLog();
  if (wl) wl("script-pre-execution-gate", "runtime", {
    level, event: category, detail: JSON.stringify(data),
    agent: process.env.FRAMEWORK_AGENT || "unknown",
  });
}
```

#### C3-C8: CLI Scripts — STATUS: ❌ NOT DONE

framework-self-test, framework-doctor, state-reconciliation, rule-registry-verify, rotate-logs, monitoring-status.
Pattern: KEEP console.log for user-facing CLI output. ADD writeLog for failure events only.

#### C9. Knowledge Subsystem Scripts — STATUS: ⚠️ PARTIAL (2 of 8 done)

- ✅ archiver.ts (3 writeLog calls, P4) — **NEEDS API FIX**
- ✅ size-reporter.ts (1 writeLog call, P4) — **NEEDS API FIX**
- ❌ 6 remaining files untouched (v5.0 correction — was 5):
  - janitor.ts — 10+ console.log/error sites, high audit value (purge/archive/eviction events)
  - compressor.ts — 4 console.log sites
  - deduplicator.ts — 2 console.log sites
  - indexer.ts — 4 console.log sites
  - scout-extractor.ts — 3 console.log sites
  - scout-trigger.ts — 1 console.log site

---

## 四.2.D Lib Files — STATUS: ✅ ALL DONE (NEEDS API FIX for D1)

#### D1. shared-infra.ts — DONE, NEEDS API FIX ⚠️
```typescript
// Current (WRONG — passes level as category, same F1 bug):
writeLog("lib-shared-infra", level, { event: "demo", detail: message });
// Fix to:
writeLog("lib-shared-infra", "runtime", { level, event: "demo", detail: message, agent: process.env.FRAMEWORK_AGENT || "unknown" });
```

#### D2. log-rotator.ts — DONE, NEEDS API FIX ⚠️
```typescript
// Current (WRONG — same F1 pattern):
writeLog("lib-log-rotator", "ERROR", { event: "compress_failed", detail: `${filePath}: ${message}` });
// Fix to:
writeLog("lib-log-rotator", "runtime", { level: "ERROR", event: "compress_failed", detail: `${filePath}: ${message}`, agent: process.env.FRAMEWORK_AGENT || "unknown" });
```
(v5.0 correction: v4.0 said "DONE, CORRECT ✅" but the call uses `"ERROR"` as category — this IS the F1 bug.)

#### D3. gate-core.ts — DONE, CORRECT ✅ (direct appendFileSync)
Avoids circular import by using direct `fs.appendFileSync` to `lib-gate-core-runtime.log`. This is the correct approach per §四.3.2.

---

## 四.3 Module System Constraints

### 四.3.1 CJS→ESM require() Chain (unchanged)

```
MCP Tool (CJS)
  └─ require("../../lib/log-manager")  ← Bun transpiles ESM→CJS on-the-fly
       └─ import { getEnforcementMode } from "./gate-core"  ← ESM import chain
```

**Verified working** (log-fragmentation-report.md §3.1).

### 四.3.2 Circular Dependency Risk (unchanged)

```
log-manager.ts → imports gate-core.ts → imports log-manager.ts ❌ CIRCULAR
```

**Resolution**: gate-core.ts uses direct `appendFileSync` (already implemented, D3).

### 四.3.3 ESM Tools (unchanged)

Tools under `.opencode/tools/` are ESM. They can import log-manager directly. No log calls needed.

---

## 四.4 9-System Impact Analysis (updated)

| System | Impact | Risk | Notes |
|--------|--------|:----:|-------|
| **Log Central Management** | F1: API mismatch creates wrong file names. F2: index.json blind to non-plugin sources. | 🔴 HIGH | Core system — must fix before Phase 5 |
| **Central State Management** | code-quality-gate.ts writeMachine has writeLog DUAL-WRITE. No behavioral change to state updates. | Low | writeLog is additive, doesn't affect txn logic |
| **Concurrent Session/Dispatch Write** | Multiple MCP tool processes write same log file via appendFileSync. No file locking. | 🟡 MED | §四.10 specifies mitigation |
| **Multi-Agent System** | FRAMEWORK_AGENT env var not captured in log entries. | 🟡 MED | §四.9 specifies capture pattern |
| **Harness System** | No changes to plugins. 16/16 already unified. | None | ✅ Clean |
| **Hardened Enforcement** | pre-execution-gate adds gateLog for audit trail. Enforcement logic unchanged. | Low | ✅ Clean |
| **Permission Matrix** | No permission changes. | None | ✅ Clean |
| **Layout Architecture** | Log files follow `.task_temp/_logs/{date}/` convention. No structural changes. | None | ✅ Clean (accept `plugin-` prefix) |
| **Templatization** | `plugin-` prefix hardcoded in flushBuffer. No `{logs.*}` template vars registered. | 🟠 LOW | §四.11 specifies registration |

---

## 四.5 Implementation Phases (Remediated)

### Phase 0: Fix Infrastructure (P0 — must complete first, 2 hrs)

**F1 fix**: Update log-manager.ts writeLog to accept log levels in `category` parameter, OR fix all callers.

**Option A (Recommended)**: Extend LogCategory type to accept both semantic categories and log levels:
```typescript
// log-manager.ts — extend LogCategory
export type LogCategory = "loaded" | "hooks" | "runtime" | "DEBUG" | "INFO" | "WARN" | "ERROR";
```
Then update flushBuffer to normalize:
```typescript
function normalizeCategory(cat: string): string {
  if (["DEBUG","INFO","WARN","ERROR"].includes(cat)) return "runtime";
  return cat;
}
// In flushBuffer:
const normalizedCat = normalizeCategory(category);
const file = path.join(getLogDir(), `plugin-${plugin}-${normalizedCat}.log`);
```
This makes all existing calls work correctly AND produces correct file names.

**Option B**: Fix all 28 callers individually (more work, cleaner API).

**F2 fix**: Extend LogIndex interface and updateIndex():
```typescript
export interface LogIndex {
  version: string;
  last_updated: string;
  plugins: Record<string, PluginIndexEntry>;
  sources: Record<string, SourceIndexEntry>;  // NEW
  dates: Record<string, DateIndexEntry>;
}

interface SourceIndexEntry {
  source_type: "mcp" | "script" | "lib";
  first_logged: string;
  last_logged: string;
  total_logs: number;
  status: "active" | "inactive";
}
```

### Phase 0.5: Retroactive Fix Migrated Files (P0, 1.5 hrs)

After Phase 0, fix all 38 existing writeLog calls across 10 files (v5.0 source-verified count):
- shared-infra.ts: 1 call
- log-rotator.ts: 1 call (v5.0: was incorrectly marked "CORRECT" in v4.0)
- compliance-gate.ts: 14 calls
- code-quality-gate.ts: 10 calls
- pre-execution-gate.ts: 1 gateLog wrapper + 9 call sites (v5.0: was 3 in v4.0)
- archiver.ts: 3 calls
- size-reporter.ts: 1 call

If Option A chosen: only flushBuffer needs fixing (1 line change). Callers work as-is.
If Option B chosen: all 28 calls need individual fixes.

### Phase 1: Lib Foundation — ✅ DONE (verify after Phase 0 fix)

All 3 files migrated. After Phase 0 fix, verify correct file names appear.

### Phase 2: MCP Tools — ⚠️ MOSTLY DONE (complete remaining + verify)

Remaining work:
- A6: reconciliation-validate.ts — add writeLog for inconsistency details
- Verify all 24 existing calls produce correct files after Phase 0 fix

### Phase 3: Scripts — ⚠️ PARTIAL (complete C3-C8)

Remaining work:
- C3: framework-self-test.ts — add writeLog for CHECK_FAILED events
- C4: framework-doctor.ts — add writeLog for WARN/FAIL results
- C5: state-reconciliation.ts — add writeLog for inconsistency details
- C6: rule-registry-verify.ts — add writeLog for violations
- C7: rotate-logs.ts — add writeLog for rotation errors
- C8: monitoring-status.ts — NO CHANGE needed
- C2: pre-execution-gate.ts — fix gateLog wrapper API (Phase 0.5)

### Phase 4: Knowledge Subsystem — ⚠️ PARTIAL (complete 6 remaining)

Remaining work:
- 6 scripts in `.opencode/scripts/knowledge/` need writeLog migration (v5.0: janitor, compressor, deduplicator, indexer, scout-extractor, scout-trigger)
- Fix existing 4 calls in archiver.ts + size-reporter.ts (Phase 0.5)

### Phase 5: Verification (1 hr)

1. Run `node .opencode/scripts/framework-self-test.js` — all checks pass
2. Verify log file names: `ls .task_temp/_logs/$(date +%F)/ | grep -v plugin-` should return empty
3. Verify index.json has `sources` section with MCP/script/lib entries
4. Smoke test: dispatch any agent, verify pre-execution-gate logs in `plugin-script-pre-execution-gate-runtime.log`
5. Verify MCP tools still function (compliance_gate_check still works)
6. Verify FRAMEWORK_AGENT appears in log entries
7. Concurrent test: dispatch 2 agents simultaneously, verify no log corruption

---

## 四.6 Log File Naming Convention (v4.0 — Corrected)

The log-manager.ts `flushBuffer()` produces files with this pattern:
```typescript
const file = path.join(getLogDir(), `plugin-${plugin}-${category}.log`);
```

**All sources use the `plugin-` prefix** regardless of source type. This is a hardcoded behavior in log-manager.ts:227.

| Plugin Name Param | Category | Actual File Name |
|-------------------|----------|------------------|
| `"mcp-compliance-gate"` | `"runtime"` | `plugin-mcp-compliance-gate-runtime.log` |
| `"mcp-code-quality-gate"` | `"runtime"` | `plugin-mcp-code-quality-gate-runtime.log` |
| `"script-pre-execution-gate"` | `"runtime"` | `plugin-script-pre-execution-gate-runtime.log` |
| `"script-framework-self-test"` | `"runtime"` | `plugin-script-framework-self-test-runtime.log` |
| `"lib-log-rotator"` | `"runtime"` | `plugin-lib-log-rotator-runtime.log` |
| `"lib-gate-core"` | N/A (direct) | `lib-gate-core-runtime.log` (separate path) |

**Note**: gate-core.ts writes directly to `lib-gate-core-runtime.log` (no `plugin-` prefix) to avoid circular import. This is intentional.

**v3.0 error**: Previous plan proposed names without `plugin-` prefix (e.g., `mcp-compliance-gate-runtime.log`). This does not match the actual implementation.

---

## 四.7 Verification Checklist (updated)

After Phase 5, verify:

- [ ] `framework-self-test.js` all checks pass
- [ ] No log files with level-based names (e.g., `*-INFO.log`, `*-WARN.log`) exist
- [ ] All log files use `plugin-{source}-{name}-runtime.log` pattern
- [ ] `index.json` has `sources` section with entries for mcp-tools, scripts, lib
- [ ] `compliance_gate_check` still returns valid session_ids
- [ ] `pre-execution-gate.ts` logs appear in `plugin-script-pre-execution-gate-runtime.log`
- [ ] MCP tools start without errors
- [ ] dispatch_subagent still works
- [ ] `FRAMEWORK_AGENT` value appears in log entries (grep for "@")
- [ ] writeLog buffer flushes before process.exit() (verify flushAll() handler)
- [ ] No circular dependency errors on startup
- [ ] Concurrent dispatch produces no corrupted log lines

---

## 四.8 LogIndex Extension Spec (NEW — fixes F2)

### Problem
`updateIndex()` only scans `plugin-(.+)-loaded\.log` patterns. Non-plugin sources (MCP tools, scripts, lib) are invisible.

### Solution
Extend `updateIndex()` to scan all log file patterns and categorize by source type:

```typescript
export function updateIndex(plugin: string, event: string): void {
  // ... existing plugin tracking ...

  // NEW: Scan for non-plugin sources
  const logDir = getLogDir();
  const sources: Record<string, SourceIndexEntry> = {};
  if (fs.existsSync(logDir)) {
    for (const f of fs.readdirSync(logDir)) {
      // Match plugin-{source_type}-{name}-{category}.log
      const m = f.match(/^plugin-(mcp|script|lib)-(.+)-(runtime|loaded|hooks)\.log$/);
      if (m) {
        const key = `${m[1]}-${m[2]}`;
        if (!sources[key]) {
          sources[key] = {
            source_type: m[1] as "mcp" | "script" | "lib",
            first_logged: new Date().toISOString(),
            last_logged: new Date().toISOString(),
            total_logs: 0,
            status: "active",
          };
        }
        sources[key].total_logs++;
        sources[key].last_logged = new Date().toISOString();
      }

      // v5.0 (B6): Also match direct-write files without plugin- prefix
      // e.g., lib-gate-core-runtime.log (gate-core.ts avoids circular import)
      const direct = f.match(/^(lib)-(.+)-(runtime)\.log$/);
      if (direct) {
        const key = `${direct[1]}-${direct[2]}`;
        if (!sources[key]) {
          sources[key] = {
            source_type: "lib" as const,
            first_logged: new Date().toISOString(),
            last_logged: new Date().toISOString(),
            total_logs: 0,
            status: "active",
          };
        }
        sources[key].total_logs++;
        sources[key].last_logged = new Date().toISOString();
      }
    }
  }

  // v5.0 (B1): Also scan root-level logs for non-dated direct writes
  const rootDir = getLogRoot();
  if (fs.existsSync(rootDir)) {
    for (const f of fs.readdirSync(rootDir)) {
      if (f === "_archive" || f === "index.json" || f === "_error.log") continue;
      if (fs.statSync(path.join(rootDir, f)).isDirectory()) continue;
      // Direct-write files at root: lib-gate-core-runtime.log
      const direct = f.match(/^(lib)-(.+)-(runtime)\.log$/);
      if (direct) {
        const key = `${direct[1]}-${direct[2]}`;
        if (!sources[key]) {
          sources[key] = {
            source_type: "lib" as const,
            first_logged: new Date().toISOString(),
            last_logged: new Date().toISOString(),
            total_logs: 0,
            status: "active",
          };
        }
        sources[key].total_logs++;
      }
    }
  }

  idx.sources = sources;
  // ... atomic write ...
}
```

### Index.json Structure (extended)

```json
{
  "version": "3.0",
  "plugins": { ... },
  "sources": {
    "mcp-compliance-gate": {
      "source_type": "mcp",
      "first_logged": "2026-06-12T...",
      "last_logged": "2026-06-12T...",
      "total_logs": 42,
      "status": "active"
    },
    "script-pre-execution-gate": {
      "source_type": "script",
      "first_logged": "2026-06-12T...",
      "total_logs": 15,
      "status": "active"
    }
  },
  "dates": { ... }
}
```

---

## 四.9 Agent Identity Capture Spec (NEW — fixes F4)

### Problem
Log entries don't include which agent triggered the log. The `FRAMEWORK_AGENT` env var is available but not captured.

### Solution
Every writeLog call must include `agent` field:

```typescript
writeLog("mcp-compliance-gate", "runtime", {
  level: "INFO",
  event: "txn_committed",
  detail: "...",
  agent: process.env.FRAMEWORK_AGENT || "unknown",  // ← REQUIRED
});
```

### Convenience Wrapper
Define once per file to avoid repetition:
```typescript
const AGENT = process.env.FRAMEWORK_AGENT || "unknown";
function srcLog(level, event, detail) {
  writeLog("mcp-compliance-gate", "runtime", { level, event, detail, agent: AGENT });
}
```

### Expected Log Entry Format
```
2026-06-12T05:30:00.000Z | cg_ses_xxx | call_xxx | @Coder-BE | Coder-BE | INFO | txn_committed | Transaction abc123 committed
```

---

## 四.10 Concurrent Write Safety Spec (NEW — fixes F5)

### Problem
Multiple Bun processes (from concurrent agent dispatches) write to the same log file via `fs.appendFileSync`. POSIX guarantees atomicity only for writes < PIPE_BUF (4096 bytes on Linux). Log lines are typically < 500 bytes, so individual lines are safe, but buffer flushes (multiple lines joined) may exceed 4096 bytes.

### Solution: Chunk Buffer Flush with O_APPEND

In `flushBuffer()`, split large buffers into chunks < 4096 bytes and use `fs.openSync` with `O_APPEND` flag for true per-write atomicity:

```typescript
export function flushBuffer(plugin: string, category: LogCategory): void {
  const key = getBufferKey(plugin, category);
  const lines = buffer.get(key);
  if (!lines || lines.length === 0) return;

  try {
    ensureLogDir();
    const file = path.join(getLogDir(), `plugin-${plugin}-${category}.log`);

    // v5.0 (B4): Use O_APPEND for POSIX per-write atomicity guarantee.
    // fs.appendFileSync may do multiple internal write() syscalls,
    // which can interleave with concurrent processes.
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, 0o644);

    const MAX_CHUNK = 4000; // Stay under PIPE_BUF (4096 bytes)
    let chunk = "";
    for (const line of lines) {
      if (chunk.length + line.length > MAX_CHUNK) {
        fs.writeSync(fd, chunk);
        chunk = line;
      } else {
        chunk += line;
      }
    }
    if (chunk) fs.writeSync(fd, chunk);
    fs.closeSync(fd);

    buffer.set(key, []);
  } catch (err: any) {
    logSelfError(`flushBuffer failed: ${err.message}`);
  }
}
```

### Risk Assessment
| Scenario | Risk | Mitigation |
|----------|:----:|------------|
| Single agent dispatch | None | Single process, no contention |
| 2-3 concurrent agents | Low | Lines < 500 bytes, atomic under PIPE_BUF |
| 5+ concurrent agents | Medium | Buffer flush may exceed PIPE_BUF → chunked flush |
| Large audit dumps | High | Use tmp+rename pattern (like updateIndex) |

---

## 四.11 Templatization & Parameterization Spec (NEW — fixes F8)

### Current State
log-manager.ts already reads these from `project.config.json.template_resolution`:
- `logs.dir` → log root directory (default: `.task_temp/_logs`) ✅ present in config
- `logs.retention_days` → archive after N days (default: 7) ✅ present in config
- `logs.delimiter` → field separator (default: ` | `) ✅ present in config
- `logs.buffer_size` → flush threshold (default: 20) ✅ present in config
- `logs.flush_interval_ms` → periodic flush interval (default: 5000) ✅ present in config
- `logs.level` → minimum log level override ❌ **MISSING from project.config.json** (G6)

### v5.0 (G6): Add `logs.level` to project.config.json

```json
{
  "template_resolution": {
    "logs.dir": ".task_temp/_logs",
    "logs.retention_days": 7,
    "logs.delimiter": " | ",
    "logs.buffer_size": 20,
    "logs.flush_interval_ms": 5000,
    "logs.level": "INFO"
  }
}
```

### Missing Parameters (to register in TEMPLATE_VARIABLE_STANDARD.md §2)

| # | Placeholder | Resolves To | Source Field | Example Value |
|---|-------------|-------------|--------------|---------------|
| 39 | `{logs.dir}` | Log root directory | `template_resolution.logs.dir` | `.task_temp/_logs` |
| 40 | `{logs.retention_days}` | Archive retention (days) | `template_resolution.logs.retention_days` | `7` |
| 41 | `{logs.delimiter}` | Field separator | `template_resolution.logs.delimiter` | `" \| "` |
| 42 | `{logs.buffer_size}` | Buffer flush threshold | `template_resolution.logs.buffer_size` | `20` |
| 43 | `{logs.flush_interval_ms}` | Periodic flush interval (ms) | `template_resolution.logs.flush_interval_ms` | `5000` |
| 44 | `{logs.level}` | Minimum log level override | `template_resolution.logs.level` | `INFO` |
| 45 | `{logs.file_prefix}` | Log file name prefix | `template_resolution.logs.file_prefix` | `plugin` |
| 46 | `{logs.source_types}` | Enabled source types | `template_resolution.logs.source_types` | `plugin,mcp,script,lib` |

### Registration Steps
1. Add `logs.level`, `logs.file_prefix`, `logs.source_types` to `project.config.json.template_resolution`
2. Add `{logs.*}` namespace resolution to `dispatch-subagent.js` `buildTemplateResolutionMap()`
3. Add to `TEMPLATE_VARIABLE_STANDARD.md` §2 as new `{logs.*}` section (entries #39–#46)
4. Run `framework-self-test.js` Check 17/18 to verify

---

## 四.12 Estimated Effort (Revised)

| Phase | Files | Sites | Difficulty | Est. Time | Status (v5.1) |
|-------|-------|:-----:|:----------:|:---------:|:------:|
| **0**: Fix Infrastructure (F1, F2) | 1 (log-manager.ts) | ~10 | High | 2 hrs | ✅ **DONE** (Option A applied in v3.0.0) |
| **0.5**: Retroactive Fix | 10 files | 38 | Medium | 1 hr | ✅ **OBSOLETE** (Option A eliminates need for retroactive fixes) |
| **1**: Lib Foundation | 3 | 3 | Low | 30 min | ✅ DONE |
| **2**: MCP Tools (remaining) | 1 (A6 only) | ~3 | Low | 30 min | ⚠️ PARTIAL |
| **3**: Scripts (C3-C8) | 5 | ~40 | Medium | 2 hrs | ❌ TODO |
| **4**: Knowledge (remaining **6**) | **6** | ~25 | Low | 1.5 hrs | ⚠️ PARTIAL |
| **5**: Verification | All | — | Medium | 1 hr | ⚠️ **PARTIAL** (dispatch test done; framework-self-test 37/37) |
| **B1-B2**: Fix non-dated paths | 1 (log-manager.ts) | 1 | Low | 30 min | ✅ **DONE** (B2 fixed; B1 N/A) |
| **B4**: O_APPEND flush | 1 (log-manager.ts) | 1 | Low | 30 min | ✅ **DONE** in v3.0.0 |
| **G6**: Config registration | 1 (project.config.json) | 3 keys | Low | 15 min | ✅ **DONE** in v3.0.0 |
| **Total remaining** | **12** | **~68** | | **~4.5 hrs** | **~65% done** |

---

## 四.13 Framework Spec Compliance Gaps (NEW — v5.0)

8 gaps identified cross-referencing against 9 OpenCode framework spec systems.

### B1: gate-core.ts Non-Dated Log Path (Layout Architecture) — ✅ N/A
gate-core.ts no longer has direct `appendFileSync` logging. It delegates to `log-manager.ts` which uses `getLogDir()` (dated directories). The original concern about `lib-gate-core-runtime.log` in root is no longer applicable.

### B2: _error.log Non-Dated Path (Layout Architecture) — ✅ FIXED in v3.0.0
`logSelfError()` in `log-manager.ts:579-594` now writes to `getLogDir()` (dated directory) instead of `getLogRoot()`. Comment at line 577: `FW-LOG-UNIFY B2: Uses dated directory instead of log root.`

### B3: Plugin vs client.app.log (Log Central Management) — 📋 Documented
Official spec: MCP→stderr, Plugins→client.app.log(), Debug→appendFileSync. writeLog() maps to #3 (debug file logging). Framework plugins use it correctly. No code change needed.

### B4: Concurrent Write POSIX (Concurrent Session/Dispatch) — ✅ FIXED in v3.0.0
POSIX O_APPEND atomicity is per write() syscall. Updated §四.10 to use `fs.openSync(O_APPEND)` + `fs.writeSync(fd, chunk)` for true per-write atomicity.


### B5: {logs.*} Template Vars (Templatization) — ⚠️ PARTIALLY FIXED
Config keys (`logs.level`, `logs.file_prefix`, `logs.source_types`) are present in `project.config.json`. §四.11 provides catalog entries #39–#46, but these have not yet been added to `TEMPLATE_VARIABLE_STANDARD.md` §2.

### B6: LogIndex Regex Gap (Log Central Management) — ⚠️ CODE IN PLACE
`scanSources()` in `log-manager.ts:489` matches `^{prefix}-(.+)-(loaded|hooks|runtime).log$`. Code is correct but `index.json` on disk is still v2.0 (no `sources` section). The v3.0 `updateIndex()` will auto-migrate on next plugin load cycle. Verified: 49 of 51 log files match the regex pattern; the 2 non-matching are legacy F1-bug files.

### B7: logSelfError Audit Gap (Hardened Enforcement, 🟢 LOW)
`_error.log` not tracked by `machine.json.write_audit_state`. Documented as future enhancement.

### B8: Compliance Records Correlation (Central State Management, 🟢 LOW)
Log entries do not cross-reference `machine.json.compliance_records`. Documented as future enhancement.

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [log-unification-remaining-implementation-plan.md](./log-unification-remaining-implementation-plan.md) | **v1.0** — Detailed implementation plan for remaining 35% (Tasks 1-11, ~4.5 hrs, 9-system compliance matrix) |
| [log-fragmentation-report.md](./log-fragmentation-report.md) | Original fragmentation audit report |
| [framework-log-system-design.md](./framework-log-system-design.md) | Log system design specification |
| [../../official_docs/opencode/findings/01-log-central-management.md](../../official_docs/opencode/findings/01-log-central-management.md) | Official OpenCode logging conventions |
| [../../official_docs/opencode/findings/02-harness-system.md](../../official_docs/opencode/findings/02-harness-system.md) | Official OpenCode plugin/harness system spec |
