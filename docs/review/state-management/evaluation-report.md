# State Management Analysis — Deep Evaluation Report

**Evaluated Document**: `docs/review/state-management/state-management-analysis.md` v1.3.0  
**Evaluation Date**: 2026-06-04  
**Evaluator**: @Super-Admin  
**Upstream Research**: `docs/review/opencode-upstream-capabilities.md`  
**Cross-Reference Audit**: `docs/review/state-management/cross-reference-audit.md`

---

## Executive Summary

The state-management-analysis.md is a **fundamentally sound** document. Its three-tier hierarchical storage architecture (Hot → Warm → Cold) is the correct design for this problem domain. The rejection of SQLite/Redis is well-reasoned. The integration with OpenCode's native `session.compacted` and `experimental.session.compacting` hooks is architecturally valid.

However, the document has **two categories of issues**: (1) implementation assumptions that proved incorrect during migration, and (2) design reasoning that conflates OpenCode's LLM context compaction with framework state file compaction.

**Overall Verdict**: The document should be revised to v1.4.0. No fundamental redesign is needed — the three-tier architecture is correct, the `gate-state.history/` daily JSONL design is optimal, and the permission matrix framework-layer approach is the right one. The revisions are primarily about correcting targets, clarifying trigger mechanisms, and updating the compliance matrix to reflect actual implementation state.

---

## Dimension-by-Dimension Evaluation

### 1. DESIGN ARCHITECTURE — 🟢 Sound

#### What's Correct

| Design Decision | Assessment |
|----------------|------------|
| Three-tier model (Hot/Warm/Cold) | ✅ Correct. Maps directly to access patterns: active sessions need fast reads, historical sessions need occasional lookup, drained sessions need archival compliance. |
| Daily-split JSONL for history | ✅ Optimal. Append-only, line-oriented, merge-friendly in Git. Daily granularity balances file count against lookup speed. |
| Version snapshots for Task.DAG | ✅ Correct. Full version snapshots provide Git-diffable rollback points while keeping hot file small. |
| 7-day recent window for gate-state | ✅ Reasonable. Matches typical task cadence. Could be configurable but 7 days is a good default. |
| 14-day recent window for Task.DAG | ✅ Correct. Longer window needed because @Orchestrator needs dependency chain visibility and @Guardian needs recent audit trails. |
| framework-enforcer.ts modularization | ✅ Correct goal. 1,655-line monolith violates coding standard (<400 lines). Extraction to hooks/checks/utils is the right decomposition. |

#### What Needs Revision

| Issue | Current Text | Recommended Change |
|-------|-------------|-------------------|
| Size projection for `gate-state.index.json` | "20KB" | Update to "~100KB for 500 sessions" — the original 20KB estimate assumed ~40 bytes per entry but actual entries with timestamps and archive_refs are ~200 bytes each. |
| Size projection for `Task.DAG.index.json` | "10KB" | Update to "~85KB for 264 tasks" |
| `gate-state.json` V3 hot file structure | Shows `formatVersion: "3.0"` with object-based `active_sessions` | Keep this as the target specification — it is correct as a design. The migration script didn't apply this format, which is an implementation gap, not a design flaw. |

#### Potential Problem: Hot File Inflation Over Time

The 7-day window for gate-state accumulates sessions proportionally to usage. At 2 sessions/day, this is 14 sessions in hot file — fine. But if usage increases to 10 sessions/day, the hot file hits 70 sessions. The document should add a **safety cap**: `MAX_RECENT_SESSIONS` (already in `state-compactor.ts` as 50) — good.

**Recommendation**: Add explicit discussion of the safety cap in Section 3.3.

---

### 2. HARDENED ENFORCEMENT CONSTRAINTS — 🟡 Mostly Sound, One Design Gap

#### What's Correct

| Design Decision | Assessment |
|----------------|------------|
| Pre-commit hook validates hot files only | ✅ Correct tradeoff. Full history validation would be O(n) for n sessions. Hot file + index integrity checks are sufficient. |
| V3 schema validation (`gate-state.v3.schema.json`) | ✅ Correct. JSON Schema provides machine-validatable contracts. |
| Keystone hash chain covers all managed files | ✅ Correct. All agent configs, rules, requirements are hashed. |
| Enforcement modes (advisory/strict/locked) | ✅ Correct. Three-tier escalation matches dev→CI→production flow. |

#### Design Gap: Pre-Commit Reads Wrong Key

The pre-commit hook (line 40-46) reads `cfg.template_resolution?.enforcement_mode` but `project.config.json` uses `develop_enforcement_mode` and `runtime_enforcement_mode`. The analysis doc does not discuss how enforcement mode should be resolved in hooks — it assumes a single key.

**Recommendation**: Add a note in Section 3.3 (Git Hook update) about the dual-key resolution: pre-commit should read `runtime_enforcement_mode` (since pre-commit is CI-bound), while in-agent code should read `develop_enforcement_mode`.

#### Potential Problem: V3 Schema Enforceability

The V3 schemas are defined but not referenced by any enforcement mechanism. Without pre-commit or write-time validation, schema drift is invisible.

**Recommendation**: Section 1.4 (Update Git Hook) should explicitly list V3 schema validation as a new Layer 3 check in pre-commit. Also add to the Implementation Plan Phase 1 checklist.

---

### 3. HARNESS SYSTEM — 🟡 Sound Design, Implementation Gap

#### What's Correct

| Design Decision | Assessment |
|----------------|------------|
| Framework-enforcer plugin hooks into OpenCode events | ✅ Correct. Using `tool.execute.before/after`, `file.edited`, `session.compacted`, etc. |
| `@opencode-ai/plugin` SDK for type-safe plugins | ✅ Correct. Matches upstream docs exactly. |
| `StateCompactor` class with explicit trigger methods | ✅ Correct. `onGateComplete()`, `nightlyCompaction()`, `drainStaleSessions()` are the right abstractions. |
| `LogRotator` class with size+time policies | ✅ Correct. Log rotation at 100KB with 3 retained files is standard and sufficient for <10 writes/day. |

#### Critical Design Flaw: Compaction Trigger Conflation

The analysis doc (Section 3.3 "Compaction Trigger" and Section 4.1.1) proposes `session.compacted` (OpenCode's LLM context compaction event) as a trigger for **state file archival**. This conflates two unrelated concepts:

| Concept | What It Is | Scope |
|---------|-----------|-------|
| LLM context compaction | Summarizing conversation history to reduce token usage | OpenCode's native behavior |
| Framework state compaction | Moving old gate sessions from hot JSON to archive JSONL | Our framework's custom logic |

`session.compacted` fires when OpenCode summarizes LLM conversation — it does NOT fire when a compliance gate session completes. Using it as the sole or primary trigger would create an unreliable dependency: if LLM context is never compacted (short sessions), state files never get archived.

**The analysis doc partially addresses this** by also proposing `compliance_gate_complete` as a trigger. But it ranks `session.compacted` as the **primary integration point** (Section 4.1.1 says "subscribe to this event to trigger state archival"), which is misleading.

**Recommendation**: Revise Section 3.3 and 4.1.1 to clearly rank triggers:
1. **Primary**: `compliance_gate_complete` tool implementation explicitly calls `StateCompactor.onGateComplete()` — deterministic, reliable.
2. **Secondary**: `session.compacted` can opportunistically trigger `StateCompactor.onSessionCompacted()` — best-effort, non-critical.
3. **Batch**: `nightly-compaction.mjs` cron job — safety net for any sessions missed by primary trigger.

#### Potential Problem: Plugin Load Order

The analysis doc's architecture diagram (Section 4.4) assumes `StateCompactionPlugin` loads before `StateCompactor`. But OpenCode's plugin load order is: Global config → Project config → Global plugins → Project plugins. If the compactor's dependencies aren't available at the time the hook fires, the archival silently fails.

**Recommendation**: Add a note about plugin initialization order. The StateCompactor should be instantiated lazily (on first use) rather than at plugin load time.

---

### 4. PERMISSION MATRIX — 🟡 Two-Layer Confusion

#### What's Correct

| Design Decision | Assessment |
|----------------|------------|
| Three-tier access (Hot/Warm/Cold) for each agent | ✅ Correct concept for framework-layer enforcement. |
| Super-Admin has full access | ✅ Correct. |
| Business code protection for all non-Coder agents | ✅ Correct. |

#### Design Clarification Needed: OpenCode Permissions vs Framework Permissions

The analysis doc's permission matrix (Section 6.1) defines which agents can access Hot/Warm/Cold storage tiers. But these tiers are **not OpenCode concepts** — they are framework-layer abstractions.

OpenCode's native permission system controls tool access (`read`, `edit`, `bash`, `task`, `skill`) via `opencode.json` — it has no concept of "hot storage" vs "warm storage." The analysis doc should explicitly state that:

1. **OpenCode permissions** (in `opencode.json`): Control which tools each agent can invoke (global scope)
2. **Framework permissions** (in `project.config.json.agent_write_scopes`): Control which files each agent can read/write (path-scope)
3. **Tier access** (Hot/Warm/Cold): Is a **subset of framework permissions** — enforced by `framework-enforcer.ts` checking both path-scope AND state tier

**Recommendation**: Revise Section 6.1 to add this two-layer clarification. The permission matrix table is correct as a design target but needs a note explaining that it's enforced at the framework layer, not by OpenCode natively.

#### Specific Permissions Issue

The @Guardian permission row says "Read-only (review)" with access to Warm Storage. But in `project.config.json`, @Guardian is denied `.opencode/**` — preventing it from reading `machine.json`, which Guardian needs for Layer A Auto Gate checks. The analysis doc's permission intent (Guardian reads machine.json for compliance) conflicts with the actual enforcement.

**Recommendation**: Update the @Guardian row in Section 6.1 to explicitly allow `machine.json` read access and note that `.opencode/**` denial should have a carve-out for `machine.json` and `gate-state.json` (read-only).

---

### 5. MULTI-AGENT SYSTEM — 🟢 Sound

#### What's Correct

| Design Decision | Assessment |
|----------------|------------|
| 9-agent role model preserved | ✅ No agent responsibilities change. |
| DAG scheduling unchanged | ✅ @Orchestrator reads hot DAG with 2-week completed tasks for dependency validation. |
| HANDOVER.md exchange mechanism | ✅ Unchanged. |
| TDD enforcement unchanged | ✅ Pre-commit Layer 2.5 still works. |

#### Minor Concern: DAG Hot File Dependency Window

The analysis doc (Section 3.4) correctly identifies that @Orchestrator needs "recently completed tasks" for dependency validation. The 14-day window is generous but should be paired with a **minimum count** safety floor — `dag-version-manager.ts` has `MIN_RECENT_TASKS: 10` which is good.

**Recommendation**: No change needed — the design already accounts for this with `MIN_RECENT_TASKS`.

---

### 6. CENTRAL STATE MANAGEMENT — 🟢 Core Architecture Sound, Implementation Details Need Update

#### What's Correct

| Design Decision | Assessment |
|----------------|------------|
| `machine.json` remains single source of truth | ✅ Correct. Keystone hashes, compliance records, state segments unchanged. |
| Gate-state split into hot/index/archive/history | ✅ Correct. Each file maps to a specific access pattern. |
| Task.DAG split into hot/snapshots/changelog/index | ✅ Correct. |
| Log rotation for safe-bash.log and .transaction-log | ✅ Correct. Both logs are append-only and need identical rotation policy. |
| Rejection of process memory database | ✅ Well-reasoned. File-based with optional in-memory cache is the right call for <10 writes/day. |

#### Design Question: Is 4-Way Split Too Complex?

The gate-state arch splits one file into 4 (hot, index, archive, history). The Task.DAG splits one file into 4 (hot, snapshots, changelog, index). This increases file count from 2 to 8.

**Assessment**: The complexity is justified for gate-state (high churn, verbosity per entry). For Task.DAG, the benefit is weaker — 264 tasks at 1.4KB each produce ~370KB total, which is manageable even without splitting.

**Recommendation**: Consider simplifying Task.DAG to 2-way split (hot + versions) and making `changelog.md` and `index.json` optional. The index is only useful if agents frequently need to look up individual tasks by ID without loading the full DAG.

#### Potential Problem: archive.json vs index.json Redundancy

Both files contain the same 208 sessions with the same `archive_ref` values. This is a **design problem** — the analysis doc specifies the index as the "canonical lookup" but then creates a separate archive file for "cold storage." For the current session count (503), the archive file is redundant.

**Recommendation**: Merge `archive.json` into `index.json` by adding an `archived_at` field to index entries. This eliminates redundancy while preserving the ability to identify which sessions have been archived. Only split out a separate archive file when index exceeds 1MB.

#### Critical Omission: `.transaction-log` Rotation Not Implemented

The analysis doc (Section 3.5) proposes identical rotation for `.transaction-log` and `safe-bash.log`. The `LogRotator` class is generic and could handle both. But the actual implementation only covers `safe-bash.log`. The `.transaction-log` remains at 633KB.

**Recommendation**: Add a specific implementation checklist item in Phase 3 for `.transaction-log` rotation, referencing that the existing `LogRotator` class should be reused with a different file path.

---

### 7. TEMPLATIZATION & PARAMETERIZATION — 🟢 Sound

#### What's Correct

| Design Decision | Assessment |
|----------------|------------|
| 28 dispatch-resolvable placeholders in `project.config.json` | ✅ Correct. Covers project, backend, frontend, cache, queue, db, auth, testing. |
| 12 extended placeholders with in-document mapping | ✅ Correct. Framework-specific concepts mapped in rule files. |
| `dispatch-subagent.js` resolver | ✅ Correct. Two-tier resolution (tech_stack → template_resolution) with override priority. |
| Multi-stack compatibility profile | ✅ Correct. Native/Compatible/Partial/Minimal with adapter contracts. |

#### Minor Note: No State-Path Placeholders

The template resolution system parameterizes framework source paths but does not include state file paths (`gate-state.json`, `machine.json`). This is intentional — state file paths are fixed relative to `.opencode/state/` and should not vary by project.

**Recommendation**: No change needed. State file paths are framework-internal and don't need templatization.

---

## Upstream API Alignment

| Analysis Doc Section | Upstream API Reference | Alignment |
|---------------------|----------------------|:---------:|
| §4.1.1 `session.compacted` event | `/docs/plugins/#events` — Session events | ✅ Exists, correctly described |
| §4.1.2 `experimental.session.compacting` | `/docs/plugins/#compaction-hooks` | ✅ Exists (experimental), correctly described |
| §4.1.3 Built-in compaction agent | `/docs/agents/#use-compaction` | ✅ Exists, hidden system agent |
| §4.2 `@opencode-ai/plugin` SDK | `/docs/plugins/#typescript-support` | ✅ Exists, `import type { Plugin }` |
| §4.2 Custom tools via `tool()` helper | `/docs/custom-tools/` | ✅ Exists, Zod schema support |
| §4.2 Structured logging via `client.app.log()` | `/docs/sdk/#app` | ✅ Exists, levels: debug/info/warn/error |
| §6.1 Three-tier permission model | `/docs/permissions/` | ⚠️ Framework-layer only — no upstream equivalent |
| §A.3 Plugin function signature | `/docs/plugins/#basic-structure` | ✅ Deconstructed params `({ project, client, $, directory, worktree })` |
| §A.5 Built-in agents (Build, Plan, General, Explore) | `/docs/agents/#built-in` | ✅ All 8 documented |
| §9 SDK import for structured logging | `/docs/sdk/#install` | ✅ `createOpencodeClient()` or `client` param |
| §9 Bun Shell API (`$`) | `/docs/plugins/#basic-structure` | ✅ Available in plugin context |

**No upstream-breaking issues found.** All proposed integrations with OpenCode's API are valid and documented.

---

## Potential Problems Summary

### P0 — Design-Level Issues

| ID | Problem | Severity | Section |
|:---|---------|:--------:|:-------:|
| **P0-1** | `session.compacted` conflated with state file compaction trigger | Medium | §3.3, §4.1.1 |
| **P0-2** | `archive.json` and `index.json` are redundant — unnecessary 4-way split | Medium | §3.3 |
| **P0-3** | Compliance matrix claims "✅ Compliant" but implementation is 72-100% | Low | §6 |

### P1 — Implementation Assumptions

| ID | Problem | Severity | Section |
|:---|---------|:--------:|:-------:|
| **P1-1** | Size projections for index files are 5-8x too low | Low | §3.3, §3.4 |
| **P1-2** | Migration script assumed V3 format transformation — didn't happen | Low | §5.1.5 |
| **P1-3** | Compaction triggers assumed to be auto-wired — not connected | Low | §3.3, §5.1.3 |
| **P1-4** | `.transaction-log` rotation not tracked in implementation plan | Low | §3.5, §5.3 |

### P2 — Upstream API Misunderstandings

| ID | Problem | Severity | Section |
|:---|---------|:--------:|:-------:|
| **P2-1** | No `session.completed` or "task completed" event exists in OpenCode | Low | §4.1.1 |
| **P2-2** | OpenCode permissions don't map to "hot/warm/cold" tier access | Low | §6.1 |

---

## Revision Recommendations

### Must-Fix (for v1.4.0)

1. **§3.3 Compaction Trigger**: Rank triggers as Primary (`compliance_gate_complete` → `onGateComplete()`) > Secondary (`session.compacted` → opportunistic) > Batch (`nightly-compaction.mjs`). Remove the implication that `session.compacted` is the primary state archival trigger.

2. **§6 Compliance Matrix**: Replace "✅ Compliant" with actual implementation ratings from the cross-reference audit. Add a gap list per dimension.

3. **§3.3 Size Projections**: Update `gate-state.index.json` target from 20KB to ~100KB (acknowledging 503 sessions at ~200 bytes/entry). Update `Task.DAG.index.json` target from 10KB to ~85KB.

4. **§3.3 archive.json vs index.json**: Recommend merging archive into index for session counts <1000. Add a note that separate archive file is justified only when index exceeds 1MB.

5. **§6.1 Permission Matrix**: Add clarification that Hot/Warm/Cold tier access is framework-layer enforcement, not OpenCode native. Fix @Guardian row to allow `machine.json` read.

### Should-Fix (for v1.4.0)

6. **§1.4 Update Git Hook**: Add explicit V3 schema validation checks (hot format, index integrity, `archive_ref` spot-check).

7. **§3.4 Task.DAG**: Consider 2-way split (hot + versions) for current task count. Make `changelog.md` and `index.json` optional/auto-generated.

8. **§3.5 Log Rotation**: Add explicit `.transaction-log` rotation to Phase 3 implementation checklist.

9. **§5.1.3**: Mark `compliance_gate_complete` → `StateCompactor.onGateComplete()` wiring as a pending implementation task (not auto-completed by migration).

### Optional (documentation quality)

10. Add a note about plugin initialization order and lazy StateCompactor instantiation.

11. Add MIN_RECENT_SESSIONS safety cap discussion to §3.3.

12. Update Appendix D directory structure to reflect actual post-migration state.

---

## Final Verdict

**The analysis document is reasonable and architecturally sound.** The three-tier hierarchical storage model, daily JSONL history, and log rotation policies are correct designs for managing growing state files. The rejection of SQLite/Redis is well-reasoned and aligns with the project's low-write-frequency profile.

The document's primary shortcomings are:

1. **Overstated compliance** in Section 6 (claiming 100% when implementation is 72-100%)
2. **Conflation of LLM context compaction with state file compaction** in how triggers are described
3. **Optimistic size estimates** for index files (20KB vs actual 101KB)
4. **4-way file split overkill** for the current session/task count

None of these require fundamentally redesigning the architecture. The three-tier model, the file-based approach, the integration with OpenCode's plugin system — all remain correct decisions.

**Recommended action**: Revise to v1.4.0 with the 9 changes listed above (5 must-fix, 4 should-fix), then proceed with implementation wiring per the cross-reference audit remediation plan.

---

*Evaluation Report Version: 1.0.0*  
*Generated: 2026-06-04*  
*Evaluator: @Super-Admin*
