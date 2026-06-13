# Section 四: Implementation Plan — Log Unification (v4.0 — Remediated)

**Date**: 2026-06-12
**Author**: @Super-Admin (REMEDIATE-LOG-UNIFY-PLAN)
**Auditor**: @Super-Admin (AUDIT-LOG-UNIFY-PLAN, cg_ses_1781241724894)
**Supersedes**: v3.0 (SA-LOG-UNIFY-PLAN)
**Target Report**: docs/review/log-backlog/log-fragmentation-report.md v2.1
**Audit Reference**: `.task_temp/AUDIT-LOG-UNIFY-PLAN/HANDOVER.md`

---

## 四.0 Remediation Summary (v4.0 Changes)

This version remediates 8 findings from the AUDIT-LOG-UNIFY-PLAN audit:

| Finding | Severity | Remediation |
|---------|----------|-------------|
| **F1**: writeLog API mismatch — log levels used as category | 🔴 CRITICAL | Fixed all call patterns to `writeLog(name, "runtime", { level, event, detail })` |
| **F2**: index.json missing non-plugin sources | 🔴 CRITICAL | Added §四.8 — LogIndex extension spec |
| **F3**: File naming `plugin-` prefix hardcoded | 🟡 HIGH | Updated §四.6 — accept `plugin-` prefix for all sources |
| **F4**: Missing agent identity in log entries | 🟡 HIGH | Added §四.9 — FRAMEWORK_AGENT capture spec |
| **F5**: Concurrent write safety unaddressed | 🟡 HIGH | Added §四.10 — cross-process file locking spec |
| **F6**: Plan status inaccurate | 🟠 MEDIUM | Updated all phase status markers with FW-LOG-UNIFY evidence |
| **F7**: pre-execution-gate approach divergence | 🟠 MEDIUM | Updated C2 — DUAL-WRITE for failures only, keep stderr for progress |
| **F8**: Templatization gaps | 🟠 MEDIUM | Added §四.11 — `{logs.*}` template variable registration |

---

## 四.0.1 Actual Implementation Status (as of 2026-06-12)

**30 FW-LOG-UNIFY annotations found across 10 source files.** The original plan claimed "Planning Only" — this was inaccurate.

| Phase | Target Files | Status | Evidence |
|-------|-------------|:------:|----------|
| **Phase 1**: Lib Foundation | 3 files, 3 sites | ✅ **DONE** | `FW-LOG-UNIFY-P1-D1` (shared-infra), `P1-D2` (log-rotator), `P1-D3` (gate-core) |
| **Phase 2**: MCP Tools | 6 files, ~60 sites | ⚠️ **MOSTLY DONE** | `P2-A1` (compliance-gate: 14 calls), `P2-A2` (code-quality-gate: 10 calls), `P2-A5` (keystone-validate: bugfix). **BUT all calls use wrong API (F1)** |
| **Phase 3**: Scripts (High Priority) | 9+ files, ~180 sites | ⚠️ **PARTIAL** | `P3-C2` (pre-execution-gate: 3 gateLog calls). CLI scripts (C3-C8) untouched |
| **Phase 4**: Knowledge Subsystem | 7 files, ~28 sites | ⚠️ **PARTIAL** | `P4` (archiver: 3 calls, size-reporter: 1 call). 5 files untouched |
| **Phase 5**: Verification | All files | ❌ **NOT DONE** | No framework-self-test run, no smoke tests |

**⚠️ CRITICAL**: All 28 writeLog calls in Phases 1-4 use the WRONG API signature (F1). They must be retroactively fixed before Phase 5 verification.

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
**FW-LOG-UNIFY annotations**: 14 (lines 198, 213, 223, 246, 509, 826, 847, 859, 1372, 1445, 1505, 1514, 1800 + import L37)

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
| 1374 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 1447 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 1506 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |
| 1514 | `writeLog("mcp-compliance-gate", "WARN", ...)` | Same fix |

**Recommended**: Replace with convenience wrapper `srcLog()` to avoid repeating 14 similar fixes.

#### A2. code-quality-gate.ts — STATUS: ⚠️ 10 calls migrated (P2-A2), NEEDS API FIX

**File**: `.opencode/scripts/mcp-tools/code-quality-gate.ts`
**FW-LOG-UNIFY annotations**: 10 (lines 57, 226, 238, 323, 332, 465, 571 + DUAL-WRITE comments)

Same fix pattern as A1: change `"WARN"` → `"runtime"` + `{level:"WARN", ...}`.

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

#### C2. pre-execution-gate.ts — STATUS: ⚠️ PARTIAL (3 gateLog calls), CORRECT APPROACH

**File**: `.opencode/scripts/pre-execution-gate.ts`
**FW-LOG-UNIFY annotations**: 3 (lines 5, 233, 961)

**v4.0 approach update** (correcting F7): The original plan said "migrate ALL 48 console.error". The actual implementation correctly chose a **selective approach**:

| Site Type | Count | Action | Rationale |
|-----------|:-----:|--------|-----------|
| Gate failures (blockGate) | 1 | ✅ DUAL-WRITE via gateLog() | Critical audit — must persist |
| Gate results (main) | 1 | ✅ DUAL-WRITE via gateLog() | Final outcome — must persist |
| UC7-009 SA bypass | 1 | ✅ DUAL-WRITE via gateLog() | Emergency audit — must persist |
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

#### C9. Knowledge Subsystem Scripts — STATUS: ⚠️ PARTIAL (2 of 7 done)

- ✅ archiver.ts (3 writeLog calls, P4) — **NEEDS API FIX**
- ✅ size-reporter.ts (1 writeLog call, P4) — **NEEDS API FIX**
- ❌ 5 remaining files untouched

---

## 四.2.D Lib Files — STATUS: ✅ ALL DONE (NEEDS API FIX for D1)

#### D1. shared-infra.ts — DONE, NEEDS API FIX
```typescript
// Current (WRONG):
writeLog("lib-shared-infra", level, { event: "demo", detail: message });
// Fix to:
writeLog("lib-shared-infra", "runtime", { level, event: "demo", detail: message, agent: process.env.FRAMEWORK_AGENT || "unknown" });
```

#### D2. log-rotator.ts — DONE, CORRECT ✅
Uses `"ERROR"` as category → needs fix to `"runtime"` + `{level:"ERROR"}`.

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

### Phase 0.5: Retroactive Fix Migrated Files (P0, 1 hr)

After Phase 0, fix all 28 existing writeLog calls across 10 files:
- shared-infra.ts: 1 call
- log-rotator.ts: 1 call
- compliance-gate.ts: 14 calls
- code-quality-gate.ts: 10 calls
- pre-execution-gate.ts: 1 gateLog wrapper + 3 calls
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

### Phase 4: Knowledge Subsystem — ⚠️ PARTIAL (complete 5 remaining)

Remaining work:
- 5 scripts in `.opencode/scripts/knowledge/` need writeLog migration
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
      const m = f.match(/^plugin-(mcp|script|lib)-(.+)-(runtime)\.log$/);
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

### Solution: Chunk Buffer Flush

In `flushBuffer()`, split large buffers into chunks < 4096 bytes:

```typescript
export function flushBuffer(plugin: string, category: LogCategory): void {
  const key = getBufferKey(plugin, category);
  const lines = buffer.get(key);
  if (!lines || lines.length === 0) return;

  try {
    ensureLogDir();
    const file = path.join(getLogDir(), `plugin-${plugin}-${category}.log`);

    // Chunk to stay under PIPE_BUF (4096 bytes) for atomic append
    const MAX_CHUNK = 4000;
    let chunk = "";
    for (const line of lines) {
      if (chunk.length + line.length > MAX_CHUNK) {
        fs.appendFileSync(file, chunk, "utf8");
        chunk = line;
      } else {
        chunk += line;
      }
    }
    if (chunk) fs.appendFileSync(file, chunk, "utf8");

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
- `logs.dir` → log root directory (default: `.task_temp/_logs`)
- `logs.retention_days` → archive after N days (default: 7)
- `logs.delimiter` → field separator (default: ` | `)
- `logs.buffer_size` → flush threshold (default: 20)
- `logs.flush_interval_ms` → periodic flush interval (default: 5000)
- `logs.level` → minimum log level override

### Missing Parameters (to register in TEMPLATE_VARIABLE_STANDARD.md)

| Placeholder | Resolves To | Source Field | Example Value |
|-------------|-------------|--------------|---------------|
| `{logs.file_prefix}` | Log file name prefix | `template_resolution.logs.file_prefix` | `plugin` |
| `{logs.source_types}` | Enabled source types | `template_resolution.logs.source_types` | `plugin,mcp,script,lib` |

### Registration Steps
1. Add `logs.file_prefix` and `logs.source_types` to `project.config.json.template_resolution`
2. Add to `dispatch-subagent.js` `buildTemplateResolutionMap()`
3. Add to `TEMPLATE_VARIABLE_STANDARD.md` §2 as new `{logs.*}` section
4. Run `framework-self-test.js` Check 17/18 to verify

---

## 四.12 Estimated Effort (Revised)

| Phase | Files | Sites | Difficulty | Est. Time | Status |
|-------|-------|:-----:|:----------:|:---------:|:------:|
| **0**: Fix Infrastructure (F1, F2) | 1 (log-manager.ts) | ~10 | High | 2 hrs | ❌ TODO |
| **0.5**: Retroactive Fix | 10 files | 28 | Medium | 1 hr | ❌ TODO |
| **1**: Lib Foundation | 3 | 3 | Low | 30 min | ✅ DONE |
| **2**: MCP Tools (remaining) | 1 (A6 only) | ~3 | Low | 30 min | ⚠️ PARTIAL |
| **3**: Scripts (C3-C8) | 5 | ~40 | Medium | 2 hrs | ❌ TODO |
| **4**: Knowledge (remaining 5) | 5 | ~20 | Low | 1 hr | ⚠️ PARTIAL |
| **5**: Verification | All | — | Medium | 1 hr | ❌ TODO |
| **Total** | **25+** | **~104** | | **~8.5 hrs** | **~30% done** |
