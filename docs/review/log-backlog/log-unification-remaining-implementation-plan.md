# Log Unification — Remaining Tasks Implementation Plan (v1.0)

**Date**: 2026-06-13
**Author**: @Super-Admin (based on VERIFY-LOG-UNIFY practical dispatch analysis)
**Baseline**: log-unification-implementation-plan.md v5.1 (65% complete)
**Target**: 100% completion
**Estimated Effort**: ~4.5 hours

---

## Executive Summary

The log-manager.ts v3.0.0 infrastructure is deployed and working. Option A (normalizeCategory) eliminates the need for retroactive fixes to 38 existing writeLog callers. The remaining work consists of:

1. **A6**: Migrate reconciliation-validate.ts (MCP tool — DUAL-WRITE pattern)
2. **C3-C8**: Add writeLog to 5 CLI scripts (KEEP console.log + ADD writeLog for failures)
3. **C9**: Add writeLog to 4 knowledge scripts with console sites (janitor, compressor)
4. **F2**: Trigger LogIndex sources activation
5. **B5**: Register `{logs.*}` template vars in TEMPLATE_VARIABLE_STANDARD.md
6. **Phase 5**: Full verification suite

### 9-System Compliance Matrix

| System | Impact | Risk | Mitigation |
|--------|--------|:----:|-----------|
| **Layout Architecture** | Log files follow `.task_temp/_logs/{date}/` convention. B1/B2 already fixed. | None | No structural changes |
| **Permission Matrix** | No permission changes needed. Scripts use existing `safe_shell` allowlist. | None | ✅ Clean |
| **Concurrent Session/Dispatch Write** | B4 O_APPEND already applied. No new concurrent write concerns. | None | ✅ Clean |
| **Hardened Enforcement** | C2 pre-execution-gate already has gateLog. New scripts add writeLog for audit trail only. | Low | Additive logging |
| **Harness System** | No plugin hook changes. All 16 plugins remain untouched. | None | ✅ Clean |
| **Central State Management** | No state machine changes. Log entries are additive. | None | ✅ Clean |
| **Multi-Agent System** | Agent identity capture via `process.env.FRAMEWORK_AGENT` in convenience wrappers. | Low | Standard pattern |
| **Log Central Management** | All new writeLog calls follow v4.0 API (`"runtime"` category). Option A provides backward compatibility. | Low | NormalizeCategory ensures correct file names |
| **Templatization** | `{logs.*}` vars registered in project.config.json. §四.11 catalog needs TEMPLATE_VARIABLE_STANDARD.md update. | Low | B5 task |

---

## Task Inventory

### Task 1: A6 — reconciliation-validate.ts Migration

**File**: `.opencode/scripts/mcp-tools/reconciliation-validate.ts`
**Type**: MCP tool (CJS, runs via `node` invocation)
**Console sites**: 19 (8 `console.log`, 5 `console.error`, 6 formatting/output)
**Classification**: CLI tool invoked by agents — KEEP all console.log (user-facing output) + ADD writeLog for error/audit events

#### Changes

| Line | Current | Action | New Code |
|:----:|---------|--------|----------|
| Top | No import | ADD | `const { writeLog: _wl } = require("../../lib/log-manager");` |
| Top | No wrapper | ADD | Convenience wrapper `srcLog()` |
| 94 | `console.error(\`❌ [Reconciliation] Failed to load...\`)` | DUAL-WRITE | Keep console.error + add `srcLog("ERROR", "load_failed", ...)` |
| 111 | `console.error('❌ [Reconciliation] Task.DAG.json missing...')` | DUAL-WRITE | Keep + add `srcLog("ERROR", "dag_missing", ...)` |
| 116 | `console.error('❌ [Reconciliation] gate-state.json missing...')` | DUAL-WRITE | Keep + add `srcLog("ERROR", "gate_state_missing", ...)` |
| 308 | `console.log(JSON.stringify({...}))` | KEEP | JSON output — must stay on stdout for agent consumption |
| 330 | `console.log(\`⚠️  [Reconciliation] Strict mode...\`)` | DUAL-WRITE | Keep + add `srcLog("WARN", "strict_mode_warnings", ...)` |

#### Convenience Wrapper

```typescript
// FW-LOG-UNIFY-A6: Convenience wrapper for reconciliation-validate.ts
const AGENT = process.env.FRAMEWORK_AGENT || "unknown";
function srcLog(level: string, event: string, detail: string, extra: Record<string, any> = {}): void {
  if (_wl) _wl("mcp-reconciliation-validate", "runtime", {
    level, event, detail, agent: AGENT, ...extra,
  });
}
```

#### Estimated Sites to Migrate: 5 DUAL-WRITE (error/audit events)
#### Lines to Add: ~15 (import + wrapper + 5 srcLog calls)
#### Risk: Low — additive only, no behavior change

---

### Task 2: C3 — framework-self-test.ts

**File**: `.opencode/scripts/framework-self-test.ts`
**Type**: CLI script (invoked via `node`)
**Console sites**: 8 (all `console.log` — user-facing test results)
**Classification**: CLI tool — KEEP all console.log (test output is the primary product). ADD writeLog for CHECK_FAILED events only.

#### Changes

| Line | Current | Action | New Code |
|:----:|---------|--------|----------|
| Top | No import | ADD | `const { writeLog: _wl } = require("../lib/log-manager");` |
| Top | No wrapper | ADD | `srcLog()` wrapper |
| CHECK_FAILED | Test failure output | DUAL-WRITE | Add `srcLog("ERROR", "check_failed", ...)` for each failed check |
| Final summary | Pass/fail summary | DUAL-WRITE | Add `srcLog("INFO", "self_test_complete", ...)` |

#### Estimated Sites to Migrate: 2 (check failures + summary)
#### Lines to Add: ~10
#### Risk: Low — additive only

---

### Task 3: C4 — framework-doctor.ts

**File**: `.opencode/scripts/framework-doctor.ts`
**Type**: CLI script (invoked via `node`)
**Console sites**: 26 (mixed `console.log`/`console.error` — user-facing diagnostic output)
**Classification**: CLI tool — KEEP all console output. ADD writeLog for WARN/FAIL results only.

#### Changes

| Line | Current | Action | New Code |
|:----:|---------|--------|----------|
| Top | No import | ADD | `const { writeLog: _wl } = require("../lib/log-manager");` |
| Top | No wrapper | ADD | `srcLog()` wrapper |
| Check failures | `console.log("❌ ...")` or `console.error(...)` | DUAL-WRITE | Add `srcLog("ERROR", "check_failed", ...)` |
| Check warnings | `console.log("⚠️ ...")` | DUAL-WRITE | Add `srcLog("WARN", "check_warning", ...)` |
| Final summary | Pass/fail summary | DUAL-WRITE | Add `srcLog("INFO", "doctor_complete", ...)` |

#### Estimated Sites to Migrate: ~5 (failures + warnings + summary)
#### Lines to Add: ~15
#### Risk: Low — additive only

---

### Task 4: C5 — state-reconciliation.ts

**File**: `.opencode/scripts/state-reconciliation.ts`
**Type**: CLI script (invoked via `node` and by pre-execution-hook.sh)
**Console sites**: 24 (mixed output — user-facing + machine-readable JSON)
**Classification**: CLI tool — KEEP all console output (agents parse JSON output). ADD writeLog for inconsistency findings and errors.

#### Changes

| Line | Current | Action | New Code |
|:----:|---------|--------|----------|
| Top | No import | ADD | `const { writeLog: _wl } = require("../lib/log-manager");` |
| Top | No wrapper | ADD | `srcLog()` wrapper |
| Inconsistency found | Report inconsistency | DUAL-WRITE | Add `srcLog("WARN", "inconsistency_found", ...)` |
| Error loading files | Error message | DUAL-WRITE | Add `srcLog("ERROR", "load_failed", ...)` |
| Final result | valid/invalid output | DUAL-WRITE | Add `srcLog("INFO", "reconciliation_complete", ...)` |

#### Estimated Sites to Migrate: ~4
#### Lines to Add: ~12
#### Risk: Low — additive only

---

### Task 5: C6 — rule-registry-verify.ts

**File**: `.opencode/scripts/rule-registry-verify.ts`
**Type**: CLI script (invoked via `node`)
**Console sites**: 21 (user-facing verification output)
**Classification**: CLI tool — KEEP all console output. ADD writeLog for violations and errors.

#### Changes

| Line | Current | Action | New Code |
|:----:|---------|--------|----------|
| Top | No import | ADD | `const { writeLog: _wl } = require("../lib/log-manager");` |
| Top | No wrapper | ADD | `srcLog()` wrapper |
| Violation found | Report violation | DUAL-WRITE | Add `srcLog("WARN", "violation_found", ...)` |
| Error | Error message | DUAL-WRITE | Add `srcLog("ERROR", "verify_error", ...)` |
| Summary | Pass/fail | DUAL-WRITE | Add `srcLog("INFO", "registry_verify_complete", ...)` |

#### Estimated Sites to Migrate: ~4
#### Lines to Add: ~12
#### Risk: Low — additive only

---

### Task 6: C7 — rotate-logs.ts

**File**: `.opencode/scripts/rotate-logs.ts`
**Type**: CLI script (invoked via `node`)
**Console sites**: 2
**Classification**: CLI tool — KEEP console output. ADD writeLog for rotation errors only.

#### Changes

| Line | Current | Action | New Code |
|:----:|---------|--------|----------|
| Top | No import | ADD | `const { writeLog: _wl } = require("../lib/log-manager");` |
| Rotation error | Error message | DUAL-WRITE | Add `srcLog("ERROR", "rotation_failed", ...)` |

#### Estimated Sites to Migrate: 1
#### Lines to Add: ~8
#### Risk: Low

---

### Task 7: C8 — monitoring-status.ts

**File**: `.opencode/scripts/monitoring-status.ts`
**Type**: CLI script (invoked via `node`)
**Console sites**: 1 (`console.log(JSON.stringify(...))`)
**Classification**: CLI tool — KEEP console.log (JSON output for agent consumption). NO writeLog needed — this is a pure data output tool.

#### Changes: NONE — ✅ No migration needed

---

### Task 8: C9 — Knowledge Scripts Migration

#### 8a: janitor.ts (8 console sites)

**File**: `.opencode/scripts/knowledge/janitor.ts`
**Classification**: Background maintenance script — high audit value. ADD writeLog for purge/archive/eviction/error events.

| Line | Event | Action | Log Event |
|:----:|-------|--------|-----------|
| 39 | Cycle start | DUAL-WRITE | `srcLog("INFO", "cycle_start", ...)` |
| 56 | File purge | DUAL-WRITE | `srcLog("INFO", "file_purged", ...)` |
| 59 | Purge failure | DUAL-WRITE | `srcLog("ERROR", "purge_failed", ...)` |
| 64 | File archive | DUAL-WRITE | `srcLog("INFO", "file_archived", ...)` |
| 70 | Archive failure | DUAL-WRITE | `srcLog("ERROR", "archive_failed", ...)` |
| 88 | Size cap exceeded | DUAL-WRITE | `srcLog("WARN", "size_cap_exceeded", ...)` |
| 100 | LRU eviction | DUAL-WRITE | `srcLog("INFO", "lru_evicted", ...)` |
| 124 | machine.json update failure | DUAL-WRITE | `srcLog("ERROR", "machine_update_failed", ...)` |

**Estimated Sites**: 8
**Lines to Add**: ~20

#### 8b: compressor.ts (2 console sites)

**File**: `.opencode/scripts/knowledge/compressor.ts`

| Line | Event | Action | Log Event |
|:----:|-------|--------|-----------|
| Compress success | Report | DUAL-WRITE | `srcLog("INFO", "file_compressed", ...)` |
| Compress failure | Error | DUAL-WRITE | `srcLog("ERROR", "compress_failed", ...)` |

**Estimated Sites**: 2
**Lines to Add**: ~10

#### 8c–8f: deduplicator.ts, indexer.ts, scout-extractor.ts, scout-trigger.ts

These files have **0 console sites** — no migration needed. ✅

---

### Task 9: F2 — LogIndex Sources Activation

**Current State**: `log-manager.ts:456` has `scanSources()` code. `index.json` on disk is v2.0 (no `sources` section).

**Action**: Trigger `updateIndex()` by running any plugin that calls it on load. The simplest approach:

```bash
# Option A: Run framework-self-test (triggers plugin loads → updateIndex)
node .opencode/scripts/framework-self-test.ts

# Option B: Manually invoke updateIndex via node -e
node -e "const { updateIndex } = require('./.opencode/lib/log-manager'); updateIndex('activation-test', 'PLUGIN-LOADED');"
```

**Verification**:
```bash
node -e "const idx = JSON.parse(require('fs').readFileSync('.task_temp/_logs/index.json','utf8')); console.log('Version:', idx.version, 'Sources:', Object.keys(idx.sources || {}).length)"
```

**Expected**: `Version: 3.0 Sources: N` (where N > 0)

**Effort**: 5 minutes

---

### Task 10: B5 — Template Variable Registration

**File**: `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md`

**Action**: Add new §2.11 `{logs.*}` Placeholders section:

```markdown
### §2.11 `{logs.*}` Placeholders

Resolved from `project.config.json.template_resolution`.

| # | Placeholder | Resolves To | Source Field | Example Value |
|---|-------------|-------------|--------------|---------------|
| 39 | `{logs.dir}` | Log root directory | `template_resolution.logs.dir` | `.task_temp/_logs` |
| 40 | `{logs.retention_days}` | Archive retention (days) | `template_resolution.logs.retention_days` | `7` |
| 41 | `{logs.delimiter}` | Field separator | `template_resolution.logs.delimiter` | ` \| ` |
| 42 | `{logs.buffer_size}` | Buffer flush threshold | `template_resolution.logs.buffer_size` | `20` |
| 43 | `{logs.flush_interval_ms}` | Periodic flush interval (ms) | `template_resolution.logs.flush_interval_ms` | `5000` |
| 44 | `{logs.level}` | Minimum log level override | `template_resolution.logs.level` | `INFO` |
| 45 | `{logs.file_prefix}` | Log file name prefix | `template_resolution.logs.file_prefix` | `plugin` |
| 46 | `{logs.source_types}` | Enabled source types | `template_resolution.logs.source_types` | `mcp,script,lib,plugin` |
```

**Also update**: `dispatch-subagent.js` `buildTemplateResolutionMap()` to include `logs.*` namespace resolution.

**Effort**: 30 minutes

---

### Task 11: Phase 5 — Full Verification Suite

After all code changes are complete, run:

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Framework self-test | `node .opencode/scripts/framework-self-test.ts` | 37/37 PASS |
| Framework doctor | `node .opencode/scripts/framework-doctor.ts --strict` | 11/11 PASS |
| Log file names | `ls .task_temp/_logs/$(date +%F)/ \| grep -E '\-(INFO\|WARN\|ERROR\|DEBUG)\.log'` | 0 new level-based files (2 legacy pre-fix artifacts acceptable) |
| LogIndex sources | `node -e "..."` | Version 3.0, sources populated |
| Template vars | Check 17/18 in self-test | No unresolved `{logs.*}` placeholders |
| Dispatch smoke test | Dispatch any agent, verify log files created | `plugin-*-runtime.log` files present |
| Concurrent dispatch | Dispatch 2 agents simultaneously | No corrupted log lines |

**Effort**: 1 hour

---

## Implementation Order

```
Task 1 (A6) ──→ Task 2 (C3) ──→ Task 3 (C4) ──→ Task 4 (C5) ──→ Task 5 (C6) ──→ Task 6 (C7)
                                                                                         │
                                                                                         ▼
Task 8a (janitor) ──→ Task 8b (compressor) ──→ Task 9 (F2 activation) ──→ Task 10 (B5) ──→ Task 11 (Phase 5)
```

**Rationale**: 
- Tasks 1-6 are independent CLI script migrations — can be done in any order
- Task 8 (knowledge scripts) depends on the convenience wrapper pattern established in Task 1
- Task 9 (F2 activation) requires all writeLog calls to be in place first
- Task 10 (B5 template vars) is independent but should be done before Phase 5 verification
- Task 11 (Phase 5) must be last — verifies everything

---

## Convenience Wrapper Standard

All migrated files use the same CJS wrapper pattern for consistency:

```typescript
// FW-LOG-UNIFY-{TASK_ID}: Convenience wrapper for {filename}
const { writeLog: _wl } = require("{relative_path}/lib/log-manager");
const AGENT = process.env.FRAMEWORK_AGENT || "unknown";

function srcLog(level: string, event: string, detail: string, extra: Record<string, any> = {}): void {
  if (_wl) _wl("{source_name}", "runtime", {
    level, event, detail, agent: AGENT, ...extra,
  });
}
```

### Source Name Convention

| File | Source Name |
|------|------------|
| reconciliation-validate.ts | `mcp-reconciliation-validate` |
| framework-self-test.ts | `script-framework-self-test` |
| framework-doctor.ts | `script-framework-doctor` |
| state-reconciliation.ts | `script-state-reconciliation` |
| rule-registry-verify.ts | `script-rule-registry-verify` |
| rotate-logs.ts | `script-rotate-logs` |
| janitor.ts | `script-knowledge-janitor` |
| compressor.ts | `script-knowledge-compressor` |

All source names follow the `{type}-{name}` convention where `type` is `mcp`, `script`, or `lib`.

---

## Official OpenCode Logging Convention Compliance

| Convention | Source | How We Comply |
|-----------|--------|---------------|
| MCP tools use `process.stderr.write()` for protocol | [01-log-central-management.md §1](../../official_docs/opencode/findings/01-log-central-management.md) | ✅ A6 keeps `console.error` (stderr) for real-time output; writeLog is additive persistence |
| Plugins use `client.app.log()` | [01-log-central-management.md §2](../../official_docs/opencode/findings/01-log-central-management.md) | ✅ N/A — no plugin changes in this plan |
| File-based logging uses `appendFileSync` to `.task_temp/_logs/` | [01-log-central-management.md §3](../../official_docs/opencode/findings/01-log-central-management.md) | ✅ writeLog() internally uses O_APPEND atomic flush to dated log directory |
| CJS preferred for MCP servers | [01-log-central-management.md §1](../../official_docs/opencode/findings/01-log-central-management.md) | ✅ All migrated files use `require()` (CJS) |
| Plugin auto-discovery scans `.opencode/plugins/*.ts` | [02-harness-system.md §2](../../official_docs/opencode/findings/02-harness-system.md) | ✅ N/A — no new plugin files |
| Hook chaining: `tool.execute.before` fires for all registered plugins | [02-harness-system.md §4](../../official_docs/opencode/findings/02-harness-system.md) | ✅ N/A — no hook changes |
| No circular imports: gate-core.ts uses direct `appendFileSync` | [log-unification-implementation-plan.md §四.3.2](./log-unification-implementation-plan.md) | ✅ Scripts import log-manager; log-manager imports gate-core; gate-core does NOT import log-manager |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:----------:|:------:|-----------|
| writeLog import fails in CJS context | Very Low | Medium | log-manager.ts is ESM but Bun transpiles on-the-fly; verified working in archiver.ts |
| Console output interleaving with writeLog buffer flush | Low | Low | writeLog uses O_APPEND atomic writes; console.log goes to stderr/stdout separately |
| Log file size growth from DUAL-WRITE | Low | Low | janitor.ts already handles log rotation; 7-day retention |
| `FRAMEWORK_AGENT` env var unset in CLI context | Medium | Low | Wrapper defaults to `"unknown"` — acceptable for CLI scripts |
| B5 template var registration breaks Check 17 | Very Low | Medium | Only adds new placeholders; no existing `{logs.*}` references in framework files |

---

## Appendix: File-Level Change Summary

| Task | File | Console Sites | Sites to Migrate | Lines to Add | Type |
|:----:|------|:------------:|:----------------:|:------------:|------|
| 1 | reconciliation-validate.ts | 19 | 5 | ~15 | DUAL-WRITE |
| 2 | framework-self-test.ts | 8 | 2 | ~10 | DUAL-WRITE |
| 3 | framework-doctor.ts | 26 | 5 | ~15 | DUAL-WRITE |
| 4 | state-reconciliation.ts | 24 | 4 | ~12 | DUAL-WRITE |
| 5 | rule-registry-verify.ts | 21 | 4 | ~12 | DUAL-WRITE |
| 6 | rotate-logs.ts | 2 | 1 | ~8 | DUAL-WRITE |
| 7 | monitoring-status.ts | 1 | 0 | 0 | NO CHANGE |
| 8a | janitor.ts | 8 | 8 | ~20 | DUAL-WRITE |
| 8b | compressor.ts | 2 | 2 | ~10 | DUAL-WRITE |
| 8c-f | deduplicator, indexer, scout-* | 0 | 0 | 0 | NO CHANGE |
| 9 | index.json (activation) | — | — | — | TRIGGER |
| 10 | TEMPLATE_VARIABLE_STANDARD.md | — | — | ~20 | DOC |
| 11 | Verification suite | — | — | — | TEST |
| **Total** | **10 files + 2 config** | **111** | **31** | **~122** | |

---

*This plan supersedes the remaining tasks from log-unification-implementation-plan.md v5.1 §四.12. Upon completion, the log unification project will reach 100%.*
