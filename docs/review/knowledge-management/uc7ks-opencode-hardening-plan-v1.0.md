# UC7KS OpenCode Hardening — Implementation Fix Plan v1.0

**Author**: @Super-Admin | **Date**: 2026-06-05  
**Based on**: Architect cross-reference report v1.0 + OpenCode tech-stack deep-dive analysis (F23/F24)  
**Status**: Awaiting Execution

---

## Table of Contents

1. [Scope](#scope)
2. [Tier 1 — P0 (Blocking Defense Gap)](#tier-1--p0-blocking-defense-gap)
   - [Fix 1: Close Context7 Permission Gap in opencode.json](#fix-1-close-context7-permission-gap-in-opencodejson-f23)
3. [Tier 2 — P1 (Data Integrity + Runtime Validation)](#tier-2--p1-data-integrity--runtime-validation)
   - [Fix 2: Recompute index.json SHA-256 Values](#fix-2-recompute-indexjson-sha-256-values-r5d1)
   - [Fix 3: Sync machine.json.knowledge_state](#fix-3-sync-machinejsonknowledge_state-r6d2)
   - [Fix 4: Validate KMS Scripts (Janitor Dry-Run)](#fix-4-validate-kms-scripts-janitor-dry-run-r2)
   - [Fix 5: Add Read Permission for docs/official_docs/](#fix-5-add-read-permission-for-docsofficial_docs-f24)
4. [Tier 3 — P2 (Cleanup + Documentation)](#tier-3--p2-cleanup--documentation)
   - [Fix 6: Remove {.metadata Malformed Directory](#fix-6-remove-metadata-malformed-directory-d6)
   - [Fix 7: Create Missing Metadata Files](#fix-7-create-missing-metadata-files-d3)
5. [Task Summary](#task-summary)
6. [Execution Strategy](#execution-strategy)
7. [Pre-Flight Checklist](#pre-flight-checklist)
8. [Verification Criteria](#verification-criteria)
9. [Appendix: Finding Reference](#appendix-finding-reference)

---

## Scope

7 fixes across 3 priority tiers. All changes are within the allowed Super-Admin scope (`.opencode/`, `opencode.json`, `docs/official_docs/`). No business code modifications.

---

## Tier 1 — P0 (Blocking Defense Gap)

### Fix 1: Close Context7 Permission Gap in opencode.json [F23]

**Problem**: All 9 agents have `"context7": "allow"` in their `opencode.json` permission blocks. UC7-004 ("No Direct Context7") is enforced ONLY by `framework-enforcer.ts` runtime checks. If the enforcer plugin fails, all agents regain native Context7 access.

**Fix**: Change `context7: allow` → `context7: deny` for all non-KC agents (Coder-BE, Coder-FE, Architect, Guardian, Meta-Planner, Arbiter, CI-CD-Agent, Orchestrator, Super-Admin). Keep `context7: allow` only for @Knowledge-Curator.

| Agent | Current | New | Rationale |
|-------|---------|-----|-----------|
| Coder-BE | `allow` | `deny` | UC7-004 — must route via @KC |
| Coder-FE | `allow` | `deny` | UC7-004 — must route via @KC |
| Architect | `allow` | `deny` | UC7-004 — must route via @KC |
| Guardian | `allow` | `deny` | UC7-004 — must route via @KC |
| Meta-Planner | `allow` | `deny` | UC7-004 — must route via @KC |
| Arbiter | `allow` | `deny` | UC7-004 — must route via @KC |
| CI-CD-Agent | `allow` | `deny` | UC7-004 — must route via @KC |
| Orchestrator | `allow` | `deny` | UC7-004 — must route via @KC |
| Super-Admin | `allow` | `deny` | UC7-009 — must use UC7KS pipeline |
| **Knowledge-Curator** | `allow` | **`allow`** | Only agent authorized per UC7KS design |

**Files**: `opencode.json` (12 occurrences to change)  
**Risk**: None — `framework-enforcer.ts` already blocks direct Context7 at runtime. This adds static enforcement.  
**Rollback**: Revert `deny` → `allow` in git.

---

## Tier 2 — P1 (Data Integrity + Runtime Validation)

### Fix 2: Recompute index.json SHA-256 Values [R5/D1]

**Problem**: 2 entries have `sha256: placeholder-will-be-recomputed` and `size_bytes: 0`.

**Fix**: Run `node .opencode/scripts/knowledge/indexer.js --recompute` to populate real SHA-256 hashes and file sizes for all entries in `index.json`.

**Files**: `docs/official_docs/index.json` (read+write 2 entries)  
**Risk**: None — read-only recomputation from existing files.  
**Verification**: Confirm `sha256:` prefix with 64-char hex digest, `size_bytes > 0`.

### Fix 3: Sync machine.json.knowledge_state [R6/D2]

**Problem**: `total_docs_count: 0` in `machine.json` but `index.json` has 2 entries.

**Fix**: Run `node .opencode/scripts/state-reconciliation.js` with the `--fix` flag to sync `machine.json.knowledge_state` fields (total_docs_count, total_size_bytes, index_manifest_sha256) with actual `index.json` content.

**Files**: `.opencode/state/machine.json` (knowledge_state section)  
**Risk**: Low — non-destructive field update.  
**Verification**: `knowledge_state.total_docs_count` should read 2 after reconciliation.

### Fix 4: Validate KMS Scripts (Janitor Dry-Run) [R2]

**Problem**: All 8 KMS scripts are structurally present but never executed. `compressor.js` depends on `pandoc_convert-contents` MCP tool. `scout-extractor.js` depends on Scout output format.

**Fix**: Run `node .opencode/scripts/knowledge/janitor.js --dry-run` to validate:
- TTL enforcement logic (30-day default, 14-day fallback, 7-day OpenCode)
- LRU eviction ordering
- Size cap calculation (50MB)
- Scout-specific 14-day TTL path

**Files**: None modified (read-only validation)  
**Risk**: None — dry-run mode.  
**Verification**: Confirm janitor reports 0 evictions (cache is fresh), 0 TTL violations, total size < 50MB.

### Fix 5: Add Read Permission for docs/official_docs/ [F24]

**Problem**: Agents rely on OpenCode's default `read: allow` for workspace files to access cached knowledge docs. If any agent's read permissions are tightened in future, the UC7KS local-first pipeline silently breaks.

**Fix**: Add explicit `read: "docs/official_docs/**"` entry in each agent's `opencode.json` permission block. This is a hardening measure — it makes the dependency on cached docs explicit and survivable across permission tightening.

**Files**: `opencode.json` (9 agent permission blocks)  
**Risk**: None — additive permission. Overlaps with existing default `read: allow`.  
**Rollback**: Remove the added `read` entries.

---

## Tier 3 — P2 (Cleanup + Documentation)

### Fix 6: Remove {.metadata Malformed Directory [D6]

**Problem**: Brace-expansion artifact `docs/official_docs/{.metadata/` from Phase 2. Not tracked by index.json, no functional impact, but leaves a malformed directory.

**Fix**: `rm -rf "docs/official_docs/{.metadata"`  
**⚠️ Requires human confirmation** (destructive operation per Super-Admin constraints).

**Risk**: None — directory is outside index.json tracking scope.  
**Verification**: `ls docs/official_docs/` should not show `{.metadata`.

### Fix 7: Create Missing Metadata Files [D3]

**Problem**: Design doc §2.2 specifies `.metadata/last_janitor_run` and `.metadata/size_report.json` — neither exists.

**Fix**:
- `touch docs/official_docs/.metadata/last_janitor_run`
- Initialize `size_report.json` with `{ "generated_at": "<ISO 8601>", "total_bytes": 0, "directories": {} }`

**Files**: 2 new files under `docs/official_docs/.metadata/`  
**Risk**: None.  
**Verification**: Both files exist and `size_report.json` is valid JSON.

---

## Task Summary

| ID | Fix | Priority | Agent | Files | Effort | Depends On |
|----|-----|----------|-------|-------|--------|------------|
| **UC7-HARDEN-01** | Context7 deny for non-KC agents | P0 | @Super-Admin | `opencode.json` | 30 min | — |
| **UC7-HARDEN-02** | Recompute index SHA values | P1 | @Super-Admin | `index.json` | 10 min | — |
| **UC7-HARDEN-03** | Sync machine.json knowledge_state | P1 | @Super-Admin | `machine.json` | 10 min | HARDEN-02* |
| **UC7-HARDEN-04** | Janitor dry-run validation | P1 | @Super-Admin | (none modified) | 15 min | HARDEN-03* |
| **UC7-HARDEN-05** | Add read docs/official_docs/** for all agents | P1 | @Super-Admin | `opencode.json` | 20 min | HARDEN-01* |
| **UC7-HARDEN-06** | Remove {.metadata artifact | P2 | @Super-Admin | (delete) | 5 min | — |
| **UC7-HARDEN-07** | Create missing metadata files | P2 | @Super-Admin | `.metadata/*` | 5 min | — |

\* Can be batched with the prior fix in same edit session to minimize file touches.

---

## Execution Strategy

**Batch A** (single `opencode.json` edit): HARDEN-01 + HARDEN-05 combined. One file, one safe_edit call, 12 `deny` changes + 9 `read` additions.

**Batch B** (script runs, read-only validation): HARDEN-02 → HARDEN-03 run sequentially (indexer.js first, then state-reconciliation.js depends on updated index).

**Batch C** (validation only): HARDEN-04 janitor dry-run.

**Batch D** (cleanup, requires human confirm): HARDEN-06 (destructive) + HARDEN-07 (safe file creation).

| Batch | Tasks | Mode | Est. Duration |
|-------|-------|------|---------------|
| A | HARDEN-01, HARDEN-05 | safe_edit on opencode.json | 30 min |
| B | HARDEN-02, HARDEN-03 | Script execution | 10 min |
| C | HARDEN-04 | Script execution (dry-run) | 5 min |
| D | HARDEN-06, HARDEN-07 | Destructive op + file create | 5 min |

**Total**: ~50 minutes | **All within Super-Admin allowed scope** | **No business code modified**

---

## Pre-Flight Checklist

- [ ] State snapshot: record `machine.json` revision + `index.json` content before modifications
- [ ] Rollback plan: each fix is independently revertible via `git checkout`
- [ ] Framework self-test: run `node .opencode/scripts/framework-self-test.js` before and after all fixes
- [ ] Context7 OpenCode analysis: cached docs in `docs/official_docs/opencode/` already reviewed — no external queries needed (UC7-009 compliant)

---

## Verification Criteria

| # | Acceptance Criteria |
|---|---------------------|
| 1 | `opencode.json`: non-KC agent blocks show `"context7": "deny"` instead of `"allow"` |
| 2 | `opencode.json`: @Knowledge-Curator block retains `"context7": "allow"` |
| 3 | `opencode.json`: all 9 agents have `read: "docs/official_docs/**"` entry |
| 4 | `index.json`: both entries have valid `sha256:` hashes (64 hex chars) and `size_bytes > 0` |
| 5 | `machine.json.knowledge_state.total_docs_count` = 2 |
| 6 | `janitor.js --dry-run` completes without errors |
| 7 | `framework-self-test.js` passes all checks (no new failures) |
| 8 | `{.metadata` malformed directory removed |
| 9 | `.metadata/last_janitor_run` and `.metadata/size_report.json` exist |

---

## Appendix: Finding Reference

This plan addresses the following findings from the UC7KS cross-reference analysis:

| Finding | Source | Description | Fix |
|---------|--------|-------------|-----|
| **F23** | Super-Admin analysis | Context7 globally allowed in opencode.json — all 9 agents can call Context7 natively, bypassing UC7-004 | HARDEN-01 |
| **F24** | Super-Admin analysis | No explicit read permission for `docs/official_docs/**` — vulnerable to future permission tightening | HARDEN-05 |
| **R5/D1** | Architect report | index.json entries have placeholder SHA values (`sha256:placeholder-will-be-recomputed`) | HARDEN-02 |
| **R6/D2** | Architect report | machine.json.knowledge_state out of sync with index.json (0 vs 2 entries) | HARDEN-03 |
| **R2** | Architect report | All 8 KMS scripts never runtime tested; pandoc and Scout dependencies unverified | HARDEN-04 |
| **D6** | Architect report | `{.metadata` brace-expansion artifact from Phase 2 | HARDEN-06 |
| **D3** | Architect report | `.metadata/last_janitor_run` and `size_report.json` missing per design | HARDEN-07 |

---

*Document Version: 1.0.0*  
*Saved to: docs/review/knowledge-management/uc7ks-opencode-hardening-plan-v1.0.md*  
*Next Step: Present to human operator for approval, then execute Batches A-D*
