# UC7-003 Post-Write Save-or-Fail Restoration Plan

**Version**: v1.0.0
**Date**: 2026-06-18
**Author**: @Super-Admin
**Task**: SA-WRITE-UC7003-PLAN
**Status**: draft
**Target**: `.opencode/plugins/uc7ks-after.ts`

> **Note**: Per framework-enforcer ROUTE-MISMATCH rules, `docs/` is routed to @Architect.
> This artifact is stored at `.task_temp/SA-WRITE-UC7003-PLAN/uc7-003-post-write-repair-plan.md`
> as the canonical @Super-Admin output location. Copy to `docs/review/framework-refactor/`
> requires @Architect dispatch or explicit routing rule override.

---

## S1 Executive Summary

### S1.1 Problem

The archived `_plugins_backups/_uc7ks-enforcer.archived/uc7ks-enforcer.ts` (510 lines) contained a UC7-003 `tool.execute.after` hook (L453-484) that verified `docs/official_docs/` file writes -- checking post-write file existence, logging the result, and reporting file size. When the monolithic plugin was split into `uc7ks-before.ts` (48 lines) + `uc7ks-after.ts` (121 lines), the UC7-003 logic was **not ported**. The current `uc7ks-after.ts` only handles UC7-001 cache-read tracking and FW-UC7KS-DOMAIN-001 per-domain metadata, leaving a compliance gap: writes to the knowledge cache are not verified.

### S1.2 Solution

Add ~82 lines of UC7-003 post-write verification logic to the existing `uc7ks-after.ts` `toolExecuteAfter` function. No new file needed. The logic verifies that after a `write`/`edit`/`safe_edit` to `docs/official_docs/`, the file actually exists on disk, records verification results in `knowledge_cache_state` via `atomicWriteSubState`, logs via `writeLog`, and enforces in `strict`/`locked` mode via `getEnforcementMode()`.

### S1.3 Scope

| In Scope | Out of Scope |
|----------|-------------|
| UC7-003 post-write existence verification | UC7-007 atomic index.json update (separate plan) |
| knowledge_cache_state update | index.json manifest modification |
| Enforcement mode-aware blocking | Size limit enforcement (UC7-005, handled by tool-execute.ts) |
| writeLog audit trail | Scope enforcement (UC7-008, handled by scope-before.ts) |

---

## S2 Architecture Alignment -- All 11 Systems

### S2.1 Layout Architecture

| Concern | Decision |
|---------|----------|
| **Target file** | `.opencode/plugins/uc7ks-after.ts` -- add UC7-003 block to existing `toolExecuteAfter` |
| **No new file** | UC7-003 is a post-write concern, naturally belonging in a `tool.execute.after` hook; `uc7ks-after.ts` is the canonical after-hook for the UC7KS pipeline |
| **Code location** | Add the UC7-003 handler block **after** the existing UC7-001 cache-read block (after L119), before the function's closing `}` at L120. The early-return `if (!WRITE_TOOLS.has(input.tool)) return;` ensures UC7-003 only fires for write tools while UC7-001 only fires for reads. |

### S2.2 Permission Matrix

| Concern | Decision |
|---------|----------|
| **KC scope** | @Knowledge-Curator already has `write` permission scoped to `docs/official_docs/**` in `opencode.json` |
| **Double-check** | `scope-before.ts` enforces UC7-008 (KC scope isolation) at write-time, blocking KC from writing outside `docs/official_docs/` |
| **No changes needed** | The permission matrix is already correct; UC7-003 only verifies after a *successful* write |

### S2.3 Concurrent Session / Dispatch

| Concern | Decision |
|---------|----------|
| **Single writer** | Only @Knowledge-Curator writes to `docs/official_docs/` -- no concurrent write race |
| **Read-after-write** | UC7-003 verification occurs in the same `tool.execute.after` invocation, so `fs.existsSync` is guaranteed to observe the write |
| **index.json atomicity** | `indexer.ts` uses atomic rename for index.json updates; UC7-003 does not touch index.json |

### S2.4 Hardened Enforcement

| Concern | Decision |
|---------|----------|
| **Mode-aware behavior** | `advisory` = log warning only; `strict` = throw Error on missing file; `locked` = throw Error on missing file |
| **getEnforcementMode()** | Import from `gate-core.ts` (same as `uc7ks-before.ts` L6) -- single source of truth |
| **Consistent with UC7-001** | UC7-003 enforcement mirrors UC7-001/UC7-004 enforcement in `uc7ks-before.ts`: advisory=warn, strict/locked=throw |

### S2.5 Harness System

| Concern | Decision |
|---------|----------|
| **Plugin lifecycle** | Already uses `withPluginLifecycle("uc7ks-after", { "tool.execute.after": toolExecuteAfter })` (L11) |
| **Hook chaining** | OpenCode auto-chains all `tool.execute.after` hooks -- UC7-003 runs after any other after-hooks, no conflict |
| **No harness changes** | The existing harness wiring is correct; only the handler body changes |

### S2.6 Central State Management

| Concern | Decision |
|---------|----------|
| **State key** | `knowledge_cache_state` -- existing P1-B split sub-state (same key used by UC7-001 in `uc7ks-after.ts` L62) |
| **State field** | Add `post_write_verifications` object to `knowledge_cache_state` tracking each verified write |
| **Atomic write** | `atomicWriteSubState("knowledge_cache_state", ...)` -- uses SQLite transaction (DB-only, CAS with retry) |
| **No JSON file write** | Follows P2-A Step 8 architecture -- `atomicWriteSubState` delegates to `dbAtomicWriteSubState` |

### S2.7 Multi-Agent

| Concern | Decision |
|---------|----------|
| **Agent resolution** | Use `resolveAgent(input.sessionID)` (already imported at L4) -- identifies the writer |
| **KC-only gate** | Add an early-return check: if `resolveAgent()` is not @Knowledge-Curator, skip UC7-003 verification (only KC writes to docs/official_docs/) |
| **Normalize** | Use `normalizeAgentKey()` (already imported at L6) for consistent agent key format |

### S2.8 Log Central Management

| Concern | Decision |
|---------|----------|
| **Log function** | `writeLog("uc7ks-after", "runtime", { ... })` -- same pattern used throughout `uc7ks-after.ts` |
| **Log events** | `UC7-003-VERIFIED` (file exists), `UC7-003-MISSING` (file absent), `UC7-003-STATE-UPDATED` (state write), `UC7-003-STATE-FAIL` (state write failure), `UC7-003-NON-KC-WRITE` (non-KC agent), `UC7-003-FS-ERROR` (filesystem error) |
| **Audit trail** | Every UC7-003 verification produces a log line with file path, size, agent, sessionID, callID |

### S2.9 DB Management

| Concern | Decision |
|---------|----------|
| **Sub-state only** | UC7-003 uses JSON sub-states via `atomicWriteSubState` `dbAtomicWriteSubState` (SQLite) |
| **No direct SQLite** | No raw SQLite queries -- all state operations go through the `atomicWriteSubState` abstraction |
| **No migration needed** | `knowledge_cache_state` already exists with a defined schema; `post_write_verifications` is a new optional field |

### S2.10 Templatization

| Concern | Decision |
|---------|----------|
| **Path constant** | Use `docs/official_docs/` string -- consistent with `cache-after.ts` L8 (`INDEX_PATH = "docs/official_docs/index.json"`) and `uc7ks-after.ts` L48 (`includes("docs/official_docs/")`) |
| **No template variables** | File paths are framework-relative, not project-relative -- no `{knowledge.*}` template variables needed |
| **Consistent with cache-after.ts** | `cache-after.ts` L8 uses the same `docs/official_docs/` prefix |

### S2.11 TypeScript + Bun

| Concern | Decision |
|---------|----------|
| **Imports** | `node:fs`, `node:path` -- already imported in `uc7ks-after.ts` (L8-9) |
| **No new deps** | `getEnforcementMode` is the only new import (from `gate-core.ts`) |
| **Bun compatibility** | All imports are ES module compatible; `withPluginLifecycle` handles Bun's module loader |
| **Same style** | Identical import style to existing `uc7ks-after.ts` and `cache-after.ts` |

---

## S3 Complete TypeScript Code Block

The following code block is the **entire new UC7-003 handler** to be inserted into `uc7ks-after.ts` after the existing UC7-001 cache-read block (after L119), before the function's closing `}` at L120.

```typescript
  // =======================================================================
  // UC7-003: Post-Write Save-or-Fail Verification
  // =======================================================================
  // Verifies that files written to docs/official_docs/ actually exist on disk
  // after write/edit operations. Updates knowledge_cache_state with verification
  // results. Enforces strict/locked mode (blocks if file missing after write).
  //
  // Restored from archived uc7ks-enforcer.ts L453-484 (2026-06-18, @Super-Admin).
  // =======================================================================

  // Only intercept write operations
  if (!WRITE_TOOLS.has(input.tool)) return;

  // Scope: only docs/official_docs/ targets
  // Uses getModifyPath() (already imported L5) for consistent path extraction
  const targetPath = getModifyPath(input.args || {});
  if (!targetPath || !targetPath.includes("docs/official_docs/")) return;

  // Resolve agent -- UC7-003 only applies when KC is the writer
  const rawAgent = resolveAgent(input.sessionID);
  const agent = normalizeAgentKey(rawAgent);
  if (agent !== "Knowledge-Curator") {
    // Non-KC agent writing to docs/official_docs/ -- UC7-008 should have blocked.
    // Log a warning but don't crash (scope-before.ts is the primary enforcement).
    writeLog("uc7ks-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      level: "WARN",
      event: "UC7-003-NON-KC-WRITE",
      detail: `Non-KC agent "${agent}" wrote to ${targetPath}. UC7-008 should have blocked this.`,
    });
    return;
  }

  // === Absolute path resolution ===
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const absPath = path.resolve(root, targetPath);

  // === Mode-aware enforcement ===
  const mode = getEnforcementMode();

  try {
    if (fs.existsSync(absPath)) {
      // File exists -- SUCCESS
      const stat = fs.statSync(absPath);
      const sizeKB = (stat.size / 1024).toFixed(1);

      writeLog("uc7ks-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent, agentType: agent,
        event: "UC7-003-VERIFIED",
        detail: `post-write verified | file=${targetPath} | size=${sizeKB}KB`,
      });

      // === Update knowledge_cache_state with verification record ===
      try {
        atomicWriteSubState("knowledge_cache_state", (state) => {
          // Initialize post_write_verifications if absent
          state.post_write_verifications = state.post_write_verifications || [];
          state.post_write_verifications.push({
            file: targetPath,
            size_bytes: stat.size,
            verified_at: new Date().toISOString(),
            agent,
            session_id: input.sessionID,
          });
          // Cap at 100 entries to prevent unbounded growth
          if (state.post_write_verifications.length > 100) {
            state.post_write_verifications = state.post_write_verifications.slice(-100);
          }
        });

        writeLog("uc7ks-after", "runtime", {
          sessionID: input.sessionID, callID: input.callID,
          agent, agentType: agent,
          event: "UC7-003-STATE-UPDATED",
          detail: `post-write state updated | file=${targetPath} | size=${stat.size}B`,
        });
      } catch (stateErr: any) {
        writeLog("uc7ks-after", "runtime", {
          sessionID: input.sessionID, callID: input.callID,
          agent, agentType: agent,
          level: "ERROR",
          event: "UC7-003-STATE-FAIL",
          detail: `state update failed: ${stateErr.message} | file=${targetPath}`,
        });
        // Non-fatal: state update failure does not invalidate the file write
      }
    } else {
      // File missing after write -- SAVE-OR-FAIL triggered
      writeLog("uc7ks-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent, agentType: agent,
        level: "ERROR",
        event: "UC7-003-MISSING",
        detail: `post-write MISSING | file=${targetPath} | mode=${mode}`,
      });

      if (mode === "strict" || mode === "locked") {
        throw new Error(
          `\n` +
          `  UC7-003 POST-WRITE SAVE-OR-FAIL -- ${mode.toUpperCase()} MODE\n` +
          `  File:    ${targetPath}\n` +
          `  Agent:   ${agent}\n` +
          `  Status:  WRITE REPORTED SUCCESS, FILE NOT FOUND ON DISK\n` +
          `  The write operation completed without error but the file\n` +
          `  does not exist at the expected path. This may indicate:\n` +
          `  1. Write tool silently failed (permission/disk issue)\n` +
          `  2. File was written to a different path than reported\n` +
          `  3. Post-write deletion by another process\n` +
          `  REMEDIATION: Retry the write. Verify disk space and\n` +
          `  permissions. Check write tool output for actual path.\n`
        );
      }
      // advisory mode: log only, no throw
    }
  } catch (err: any) {
    // Re-throw UC7-003 errors (strict/locked enforcement)
    if (err.message?.includes("UC7-003")) throw err;

    // Non-UC7-003 errors (e.g., filesystem errors during stat)
    writeLog("uc7ks-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      agent, agentType: agent,
      level: "ERROR",
      event: "UC7-003-FS-ERROR",
      detail: `verification error: ${err.message} | file=${targetPath}`,
    });
  }
```

### S3.1 Additional Imports Required

Add the following import to `uc7ks-after.ts` (imports section, L2-9):

```typescript
import { getEnforcementMode } from "../lib/gate-core";
```

Note: `getModifyPath` is already imported at L5 (`import { getModifyPath } from "../lib/tool-scope";`), so no additional import needed for path extraction.

And add the `WRITE_TOOLS` constant near the top of the file (after L9, before `export default`):

```typescript
/** Tools that write files. Used for UC7-003 post-write verification. */
const WRITE_TOOLS = new Set(["write", "edit", "safe_edit"]);
```

### S3.2 Expected Final Line Count

| Component | Lines |
|-----------|-------|
| Existing `uc7ks-after.ts` | 121 |
| New imports (1 line) | +1 |
| WRITE_TOOLS constant (3 lines) | +3 |
| UC7-003 handler block | +82 |
| **Expected total** | **~207 lines** |

---

## S4 Implementation Steps

| Step | Action | File | Lines | Verification |
|------|--------|------|-------|-------------|
| **1** | Add `getEnforcementMode` import | `uc7ks-after.ts` L2-9 | +1 | `import { getEnforcementMode } from "../lib/gate-core";` compiles clean with `tsc --noEmit` |
| **2** | Add `WRITE_TOOLS` constant | `uc7ks-after.ts` after L9 | +3 | Constant is a `Set` of three tool names; no runtime dependencies |
| **3** | Insert UC7-003 handler block | `uc7ks-after.ts` after L119 | +82 | Insert after the closing `}` of the existing UC7-001 `if` block (L119), before the function's closing `}` (L120). Uses `getModifyPath(input.args)` for path extraction (consistent with UC7-001 at L45). Agent comparison uses `"Knowledge-Curator"` (canonical name from `normalizeAgentKey`). |
| **4** | Run `framework-self-test.ts` | CLI | -- | `bun .opencode/scripts/framework-self-test.ts` -- all checks pass; no `UNRESOLVED{...}` in modified file |
| **5** | Integration smoke test | CLI | -- | Simulate a write to `docs/official_docs/test.txt` via a KC-dispatched agent; verify UC7-003-VERIFIED log entry appears and `knowledge_cache_state.post_write_verifications` is populated |

---

## S5 Verification Checklist

### S5.1 Functional Verification

- [ ] UC7-003 handler intercepts `write`/`edit`/`safe_edit` tools
- [ ] Handler skips (early return) for non-`docs/official_docs/` targets
- [ ] Handler skips for non-KC agents (with WARN log)
- [ ] Post-write file existence verified with `fs.existsSync`
- [ ] File size logged via `writeLog` (UC7-003-VERIFIED event)
- [ ] `knowledge_cache_state.post_write_verifications` updated atomically
- [ ] Missing file triggers UC7-003-MISSING log event
- [ ] `strict` mode: missing file throws Error
- [ ] `locked` mode: missing file throws Error
- [ ] `advisory` mode: missing file logs warning only (no throw)
- [ ] Same behavior for `write`, `edit`, and `safe_edit` tools
- [ ] Error boundary: non-UC7-003 errors (e.g., fs.stat failure) logged but not thrown

### S5.2 Regression Prevention

- [ ] Existing UC7-001 cache-read tracking still functions (handler inserted *after* UC7-001 block)
- [ ] `framework-self-test.ts` Check 22 (UC7KS Docs Manifest Integrity) -- passes
- [ ] `framework-self-test.ts` Check 17 (Placeholder Resolution) -- passes
- [ ] `framework-self-test.ts` Check 31 (Agent UC7KS Section Presence) -- passes
- [ ] No new `UNRESOLVED{...}` strings introduced
- [ ] No changes to `uc7ks-before.ts` (UC7-001/UC7-004 enforcement unaffected)

### S5.3 Code Quality

- [ ] All public functions have JSDoc comments
- [ ] Import order follows project convention (external, internal, relative)
- [ ] Error messages follow established format
- [ ] writeLog calls include `sessionID`, `callID`, `agent`, `agentType`
- [ ] No `console.log` or `console.error` calls (use `writeLog` instead)

---

## S6 Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|:----------:|:------:|------------|
| `getEnforcementMode()` import fails (circular dep) | Low | High | `gate-core.ts` is already imported by `log-manager.ts` (L24); `uc7ks-after.ts` imports `log-manager` at L2 -- no circular dependency chain |
| UC7-003 handler interferes with UC7-001 handler | Low | Medium | Early-return at top of UC7-003 block prevents any interaction; UC7-001 runs first, UC7-003 runs second; both are in the same `toolExecuteAfter` function but on different code paths (`read` vs `write`) |
| Strict/locked mode blocks legitimate writes | Low | Medium | The handler only blocks when `fs.existsSync` returns `false` -- meaning the file truly wasn't created. False positives are unlikely. |
| `post_write_verifications` array grows unbounded | Low | Low | Capped at 100 entries in the handler itself |
| Race: write + immediate read in same after-hook | None | None | Not applicable -- `tool.execute.after` is synchronous; the write completes before the hook fires |

---

## S7 Rollback Plan

If UC7-003 integration causes issues:

1. **Comment out the UC7-003 block**: Add `//` prefix to the entire inserted block (L120-L201 after insertion)
2. **Restore original line count**: File reverts to 121 lines (UC7-001 + FW-UC7KS-DOMAIN-001 only)
3. **No state corruption**: `post_write_verifications` field in `knowledge_cache_state` is additive only; removing the handler just stops new entries from being added
4. **Git rollback**: `git checkout -- .opencode/plugins/uc7ks-after.ts`

---

## S8 Related Documents

| Document | Relationship |
|----------|-------------|
| `.opencode/plugins/uc7ks-after.ts` | Target file for modification |
| `.opencode/plugins/cache-after.ts` | Reference pattern for post-write state update |
| `.opencode/plugins/uc7ks-before.ts` | Reference pattern for `getEnforcementMode()` import |
| `.opencode/_plugins_backups/_uc7ks-enforcer.archived/uc7ks-enforcer.ts` | Original UC7-003 logic source (L453-484) |
| `.opencode/lib/state-utils.ts` | `atomicWriteSubState` function used for state updates |
| `.opencode/lib/log-manager.ts` | `writeLog` function used for audit trail |
| `.opencode/lib/gate-core.ts` | `getEnforcementMode` function (L318) |
| `.opencode/rules/rule_detail/UC7KS-PIPELINE-STANDARD.md` | UC7-003 rule definition (S3.3) |
| `docs/review/framework-refactor/uc7ks-before-after-split-report.md` | Split architecture rationale |

---

*This plan will be executed by @Super-Admin following human confirmation.*
