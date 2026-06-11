# safe_diff Application Analysis for Legacy Fixes

**Date**: 2026-06-11
**Author**: @Super-Admin
**Context**: Investigation of how `generateDiff()` from `safe-edit-core.ts` can
enhance the legacy issue fix plan.

## safe_diff Capability Summary

```
generateDiff(original, updated) → { hasChanges, added, removed, diff }
  ├─ Input:  two strings (typically file content)
  ├─ Output: line-by-line unified diff
  └─ Existing use patterns:
      ├─ tdd-after.ts — post-write diff to verify test file changes
      ├─ safe_edit — pre-write backup creation (original for diff)
      └─ safe_diff tool — LLM-callable diff command
```

## Application Value Matrix

| safe_diff Application | Fix Plan ID | Value | Complexity | Recommendation |
|------------------------|:--:|:--:|:--:|:--:|
| Pre-write diff validation of project.config.json | P1-1 | ⭐⭐⭐ | Low | ✅ Recommended |
| Post-write diff audit of project.config.json | P1-1 | ⭐⭐⭐ | Low | ✅ Recommended |
| Error localization in tolerantJSONParse | P0-1 | 🟡 | Low | Optional |
| Reconciler diff evidence | P1-2 | 🟡 | Low | Optional |
| knowledge_state change logging | P0-2 | ⭐ | Low | Unnecessary |
| **TOCTOU concurrent write detection** | P2 | ⭐⭐⭐⭐⭐ | Medium | ✅ High value |

## Key Insight: TOCTOU Detection

The framework's `knowledge_cache_search` has a read-modify-write cycle with a
~60-line gap between read and write. During this gap, another agent could
concurrently modify `machine.json`, causing lost updates.

safe_diff TOCTOU:
1. Save `originalMachine` snapshot at read time
2. Before atomic rename, re-read `machine.json` → `currentCheck`
3. `generateDiff(originalMachine, currentCheck)`
4. If diff shows changes in OTHER sections → skip write (detect-only strategy)
5. If no changes → safe to write

This follows the same TOCTOU protection pattern as `safe_edit` (design symmetry).

The detect-only strategy (skip on conflict, retry on next call) avoids the
complexity of JSON merge logic while still preventing lost updates.
