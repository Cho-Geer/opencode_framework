# Legacy Issues Investigation Report

**Date**: 2026-06-11
**Author**: @Super-Admin
**See also**: `legacy-issues-fix-plan.md` (implementation plan)

## Issue 1: project.config.json JSON Parse Error

**Symptom**: Self-test checks 1, 18, 30 report `JSON parse error: Unexpected token ']'`

**Root Cause**: `agent_write_scopes` in project.config.json contains 2 trailing commas
(position ~19967 and ~21435). Standard `JSON.parse()` rejects trailing commas
(valid in JavaScript but NOT in JSON).

**Impact**:
- `framework-self-test.ts` checks 1/18/30/25 fail
- `pre-execution-gate.ts` falls back to "strict" mode
- Other tools gracefully degrade to defaults
- Severity: WARNING (cosmetic for self-test, functional fallback is safe)

## Issue 2: knowledge_state Count Drift (30 ≠ 34)

**Symptom**: `state-reconciliation.ts` check6 reports:
- `total_docs_count: 30` vs actual index.json entries: 34
- `total_size_bytes: 176468` vs actual: 426547

**Root Cause**: `knowledge_state` is only updated by `janitor.ts` (every 24h) and
`pre-execution-hook.sh` (gate-time). Neither `knowledge_cache_search.ts` nor
`Knowledge-Curator` dispatches update it when cache entries change.

**Writers that DON'T sync knowledge_state**:
- `knowledge_cache_search.ts` — updates session_access but not knowledge_state
- `@Knowledge-Curator` — writes new docs but doesn't touch knowledge_state
- `uc7ks-after.ts` — tracks cache reads but not counts

**Impact**:
- Reconciler check6 consistently fails (WARNING)
- No functional impact (enforcement doesn't depend on knowledge_state)
- Severity: WARNING

## Issue 3: .pending.json Stale Entries (Self-Healed)

**Symptom**: 3 stale entries (30-60min old) after previous session

**Root Cause**: `dispatch-subagent.js` writes entries to `.task_temp/_dispatch/.pending.json`
that are consumed by `dispatch-before.ts` but stale entries from completed dispatches
may persist until auto-drained.

**Resolution**: Self-healed on OpenCode restart. `.pending.json` queue reset to empty.
Current Check 33: PASS.
