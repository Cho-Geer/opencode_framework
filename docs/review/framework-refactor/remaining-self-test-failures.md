# Remaining Framework Self-Test Failures - Root Cause Analysis & Fix Solutions

> Version: 1.2.0
> Created: 2026-06-22
> Last Audited: 2026-06-22 (Asia/Tokyo), against current framework code
> Author: Codex Framework Audit
> Status: Active - 4 self-test failures remain
> Task ID: REMAINING-SELF-TEST-FAILURES

---

## 1. Executive Summary

The previous baseline in this document was stale. A fresh audit against the current
framework code shows:

```text
bun .opencode/scripts/framework-self-test.ts
# Result: 57 / 61 checks passed, 4 checks failed

bun .opencode/scripts/framework-doctor.ts --strict --json
# Result: 13 / 13 checks passed, strict mode healthy
```

The remaining failures are:

| Check | Current Failure | Severity | Scope | Recommended Action |
|---|---|---:|---|---|
| 22 | 13 official-doc files exist on disk but are not registered in `index.json` | Medium | Knowledge index | Register with DB-aware knowledge tooling, preferably `integrity-check.ts --auto-index` |
| 28 | `Super-Admin` and `CI-CD-Agent` are missing `uc7_001_compliant` in `knowledge_cache_state.session_access` | High | UC7KS read-before-write evidence | Re-run valid knowledge read + attestation for both agents |
| 35 | `Super-Admin` and `CI-CD-Agent` still carry deprecated pre-HARDEN cache evidence | High | UC7KS hardened evidence | Same attestation repair as Check 28 |
| 48 | `.task_temp/_dispatch/ctx/ASSIGN-ISSUES-TO-CHO-GEER.json` is stale for more than 24h | Low | Dispatch ctx cleanup | Remove the stale ctx file after archived-gate verification; add janitor follow-up |

Previously listed Check 26, Check 27, and Check 36 failures are no longer
current. `framework-doctor --strict` now reports a healthy critical-infra state,
and backup patch drift is clean.

### 1.1 Audit Evidence

| Evidence Source | Current Finding |
|---|---|
| `framework-self-test.ts` | 4 failures: Check 22, Check 28, Check 35, Check 48 |
| `framework-doctor.ts --strict --json` | `total=13`, `passed=13`, `failed=0`; critical infrastructure healthy |
| `knowledge/integrity-check.ts --json` | `totalOrphans=13`, `onlyInManifest=[]` |
| `knowledge_cache_state.session_access` | `Super-Admin` and `CI-CD-Agent` have deprecated sufficiency records and no `uc7_001_compliant` |
| `.task_temp/_dispatch/ctx/ASSIGN-ISSUES-TO-CHO-GEER.json` | ctx file is older than 24h; corresponding gate session is archived |

### 1.2 Drift From v1.1.0

| v1.1.0 Claim | Current Status | Required Update |
|---|---|---|
| 6 self-test failures remain | 4 failures remain | Updated baseline |
| Check 26/27: strict doctor divergence and duplicate infra logic | Resolved in current code; doctor strict passes | Move to resolved section |
| Check 36: backup patch files cause drift | Resolved; self-test Check 36 passes | Move to resolved section |
| Check 22: 11 orphan docs | Current count is 13 | Replace orphan list |
| Check 28/35: only `Super-Admin` affected | `Super-Admin` and `CI-CD-Agent` are affected | Expand repair scope |
| Check 48 not mentioned | New active failure | Add root cause and fix plan |

---

## 2. Failure 1 - Check 22: Knowledge Index Orphans

### 2.1 Symptom

Current self-test output:

```text
[FAIL] 22. Official docs knowledge integrity: Orphan docs not in index.json:
opencode/framework/permissions.md, opencode/framework/tools.md,
opencode/framework/cli.md (+10 more)
```

The current integrity check reports 13 orphan files:

```text
opencode/framework/permissions.md
opencode/framework/tools.md
opencode/framework/cli.md
opencode/framework/config.md
opencode/framework/skills.md
opencode/framework/mcp-servers.md
opencode/framework/policies.md
opencode/framework/index.md
opencode/framework/plugins.md
opencode/framework/agents.md
opencode/mcp/mcp-servers-docs.md
opencode/plugins/source-analysis/plugin-loading-mechanics.md
opencode/releases/v1.16.0-release-notes.md
```

`integrity-check.ts --json` currently reports:

```json
{
  "totalEntries": 49,
  "totalFilesInManifest": 46,
  "totalFilesOnDisk": 59,
  "totalOrphans": 13,
  "onlyInManifest": []
}
```

### 2.2 Root Cause

The official docs tree has been expanded, but the canonical knowledge index has
not been updated for every new file. This is not a file-existence problem:
all affected files exist on disk. The issue is registration drift between
`docs/official_docs/**` and `docs/official_docs/index.json`.

The current codebase already contains a DB-aware repair path:

```text
.opencode/scripts/knowledge/integrity-check.ts --auto-index
```

This path calls the knowledge store helper instead of requiring ad hoc JSON
editing. That is preferable because the framework is moving toward DB-canonical
knowledge management and because the helper records metadata consistently.

### 2.3 Fix Plan

Recommended fix:

```bash
bun .opencode/scripts/knowledge/integrity-check.ts --auto-index --json
bun .opencode/scripts/knowledge/integrity-check.ts --json
bun .opencode/scripts/framework-self-test.ts
```

Expected result:

- `totalOrphans` becomes `0`
- Check 22 passes
- `index.json` and the DB-backed knowledge store stay consistent through the
  project helper path

Acceptable fallback:

1. Manually register the 13 files in `docs/official_docs/index.json`.
2. Include correct path, title, library, domain, SHA, size, and updated timestamp.
3. Re-run the three validation commands above.

Do not delete these docs as a cleanup shortcut. They are current OpenCode
knowledge assets and should be indexed unless a separate content audit proves
they are obsolete.

---

## 3. Failure 2 - Check 28: Missing UC7KS Compliance Flags

### 3.1 Symptom

Current self-test output:

```text
[FAIL] 28. UC7KS v1.0 Evidence Contract:
Super-Admin: missing uc7_001_compliant; CI-CD-Agent: missing uc7_001_compliant
```

Current `knowledge_cache_state.session_access` entries exist for both agents,
but neither entry has `uc7_001_compliant`.

Affected agents:

| Agent | Domain | Current Evidence Problem |
|---|---|---|
| `Super-Admin` | `opencode_framework` | Has deprecated sufficient-looking evidence, but no UC7KS HARDEN flag |
| `CI-CD-Agent` | `devops_ci` | Has deprecated sufficient-looking evidence, but no UC7KS HARDEN flag |

### 3.2 Root Cause

These records appear to have been created or refreshed by a pre-HARDEN knowledge
path. They contain fields such as `cache_sufficiency.status = "sufficient"`,
but they do not satisfy the hardened UC7KS evidence contract because:

- `uc7_001_compliant` is absent.
- `cache_sufficiency.reason` still contains deprecated auto-generated wording.
- `cache_sufficiency.files_read` is empty.
- `content_summary` is deprecated auto-generated text rather than a real
  read-evidence summary.

This is not just a boolean migration. The framework's read-before-write model
requires evidence that the agent actually read relevant knowledge before making
write decisions.

### 3.3 Fix Plan

Repair both agents through the normal production path:

1. Re-run `knowledge_cache_search` for each affected agent and domain.
2. Read the returned official-doc files that are relevant to the agent scope.
3. Call the UC7KS attestation path with a non-empty `files_read` list.
4. Ensure the resulting state includes:
   - `uc7_001_compliant: true`
   - non-empty `cache_sufficiency.files_read`
   - non-deprecated `cache_sufficiency.reason`
   - non-deprecated `content_summary`
   - a fresh `last_read_at`

Recommended minimum attestation targets:

| Agent | Domain | Representative Knowledge Scope |
|---|---|---|
| `Super-Admin` | `opencode_framework` | framework docs, plugin docs, tool docs, permission docs |
| `CI-CD-Agent` | `devops_ci` | CLI/config docs plus CI/deployment-relevant official docs |

If a direct repair script is used instead of the production tool path, it must
write through the framework DB/substate helpers, not raw JSON mutation, and it
must write complete evidence rather than only setting `uc7_001_compliant`.

### 3.4 Validation

```bash
bun .opencode/scripts/framework-self-test.ts
```

Expected result:

- Check 28 passes
- Check 35 should also pass if the deprecated evidence is replaced in the same
  repair operation

---

## 4. Failure 3 - Check 35: Stale Pre-HARDEN Knowledge Evidence

### 4.1 Symptom

Current self-test output:

```text
[FAIL] 35. Agent knowledge cache refresh after question policy:
2 stale pre-HARDEN entries: flat=[Super-Admin,CI-CD-Agent], nested=[].
Re-run knowledge_cache_search for these agents.
```

### 4.2 Root Cause

This is the same state-quality defect exposed by Check 28. Both affected
`session_access` records still carry deprecated evidence generated before the
HARDEN/read-before-write evidence contract was enforced.

The important point is that Check 35 is not solved by adding a timestamp or
changing the boolean alone. It is solved by replacing the stale evidence with a
real read attestation.

### 4.3 Fix Plan

Use the Check 28 repair flow for both agents:

```text
Super-Admin -> knowledge_cache_search -> read official docs -> knowledge_cache_attest
CI-CD-Agent -> knowledge_cache_search -> read official docs -> knowledge_cache_attest
```

Required postconditions:

- no deprecated `[DEPRECATED] Auto-generated from index.json` reason remains
- no empty `files_read` remains for the attested task scope
- `uc7_001_compliant` is present and true
- `last_read_at` reflects the repair time

### 4.4 Validation

```bash
bun .opencode/scripts/framework-self-test.ts
```

Expected result:

- Check 35 passes
- Check 28 passes together with it

---

## 5. Failure 4 - Check 48: Stale Dispatch Context File

### 5.1 Symptom

Current self-test output:

```text
[FAIL] 48. Dispatch ctx files consistency:
1 issue(s): ASSIGN-ISSUES-TO-CHO-GEER.json: STALE (>24h old, may indicate missing cleanup)
```

The stale file is:

```text
.task_temp/_dispatch/ctx/ASSIGN-ISSUES-TO-CHO-GEER.json
```

Its current content:

```json
{
  "dagTaskId": "ASSIGN-ISSUES-TO-CHO-GEER",
  "agentType": "Super-Admin",
  "domainId": "opencode_framework",
  "createdAt": 1781968473063
}
```

### 5.2 Root Cause

The task appears to have completed, but the per-dispatch ctx marker was left in
`.task_temp/_dispatch/ctx/`.

Corroborating evidence:

- `.task_temp/ASSIGN-ISSUES-TO-CHO-GEER/HANDOVER.md` exists.
- `.task_temp/ASSIGN-ISSUES-TO-CHO-GEER/TASK_LOG.md` exists.
- `gate_sessions` contains task `ASSIGN-ISSUES-TO-CHO-GEER` with
  `status = archived`.
- `session_map` maps the task to `Super-Admin` and `opencode_framework`.

This is a cleanup defect, not an active dispatch inconsistency.

### 5.3 Fix Plan

Immediate cleanup:

1. Confirm the archived gate session still exists in DB.
2. Confirm task artifacts exist under `.task_temp/ASSIGN-ISSUES-TO-CHO-GEER/`.
3. Delete only:

```text
.task_temp/_dispatch/ctx/ASSIGN-ISSUES-TO-CHO-GEER.json
```

4. Re-run:

```bash
bun .opencode/scripts/framework-self-test.ts
```

Longer-term hardening:

- Add a dispatch ctx janitor to the framework completion path.
- The janitor should remove ctx files only when DB evidence proves the task is
  completed or archived.
- Keep completed task artifacts in `.task_temp/<taskId>/`; only the transient
  dispatch ctx marker should be removed.

Recommended integration points:

| Layer | Suggested Responsibility |
|---|---|
| `task-after` or completion hook | cleanup ctx after successful completion |
| dispatch self-test | keep warning on ctx files older than 24h |
| log central management | log cleanup as structured framework maintenance event |
| DB management | use `gate_sessions` / `session_map` as cleanup authority |

---

## 6. Resolved Since v1.1.0

The following items were active in the older document but are no longer current
failures after the framework update.

### 6.1 Check 26 and Check 27 - Doctor / Self-Test Infra Divergence

Current result:

```text
bun .opencode/scripts/framework-doctor.ts --strict --json
# total=13, passed=13, failed=0
```

Current self-test also reports:

```text
[PASS] 26. Doctor strict mode: --strict exits 0 (all checks pass on current project)
[PASS] 27. Doctor/self-test critical infrastructure parity: Both tools agree: healthy...
```

No active fix is required for these checks.

### 6.2 Check 36 - Backup Patch Drift

Current self-test reports Check 36 as passing:

```text
[PASS] 36. Backup patch write-target policy: no working-tree drift detected
```

No active fix is required for this check.

---

## 7. Dependency Analysis

| Fix | Unblocks | Notes |
|---|---|---|
| Register 13 orphan docs | Check 22 | Independent of all other failures |
| Re-attest `Super-Admin` and `CI-CD-Agent` | Check 28 and Check 35 | These two checks should be fixed together |
| Remove stale ctx file after DB verification | Check 48 | Independent cleanup |

Recommended execution order:

1. Fix Check 22 with `integrity-check.ts --auto-index`.
2. Re-attest `Super-Admin` and `CI-CD-Agent` knowledge evidence.
3. Remove the stale dispatch ctx marker.
4. Run full self-test once at the end.

---

## 8. Resolution Checklist

### Check 22

- [ ] Run `bun .opencode/scripts/knowledge/integrity-check.ts --auto-index --json`
- [ ] Confirm `totalOrphans = 0`
- [ ] Confirm no stale `onlyInManifest` entries were introduced

### Check 28 / Check 35

- [ ] Re-run knowledge search and read flow for `Super-Admin`
- [ ] Re-run knowledge search and read flow for `CI-CD-Agent`
- [ ] Attest both agents with non-empty `files_read`
- [ ] Verify both records have `uc7_001_compliant: true`
- [ ] Verify no deprecated reason/content summary remains

### Check 48

- [ ] Verify `ASSIGN-ISSUES-TO-CHO-GEER` gate session remains archived
- [ ] Verify task artifacts exist
- [ ] Remove `.task_temp/_dispatch/ctx/ASSIGN-ISSUES-TO-CHO-GEER.json`
- [ ] Add janitor follow-up if this recurs

### Final Validation

- [ ] Run `bun .opencode/scripts/framework-self-test.ts`
- [ ] Run `bun .opencode/scripts/framework-doctor.ts --strict --json`
- [ ] Confirm all 61 self-test checks pass
- [ ] Confirm doctor strict remains 13/13 passing

---

## 9. Related Files

| File | Role |
|---|---|
| `.opencode/scripts/framework-self-test.ts` | Self-test authority for Checks 22, 28, 35, 48 |
| `.opencode/scripts/framework-doctor.ts` | Strict doctor validation authority |
| `.opencode/scripts/knowledge/integrity-check.ts` | Knowledge index integrity and auto-index repair helper |
| `.opencode/lib/knowledge-store.ts` | Knowledge index write helper |
| `.opencode/lib/substate-manager.ts` | DB/substate access path for knowledge state |
| `.task_temp/_dispatch/ctx/` | Transient dispatch ctx marker directory |
| `docs/official_docs/index.json` | Official docs knowledge manifest |

---

## 10. Version History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-06-22 | Initial root-cause analysis for 6 remaining self-test failures |
| 1.1.0 | 2026-06-22 | Added Check 28/35 UC7KS stale evidence analysis |
| 1.2.0 | 2026-06-22 | Re-audited against current framework code; baseline updated to 4 active failures; moved Checks 26/27/36 to resolved; added Check 48 stale ctx analysis; expanded UC7KS scope to `Super-Admin` and `CI-CD-Agent` |
