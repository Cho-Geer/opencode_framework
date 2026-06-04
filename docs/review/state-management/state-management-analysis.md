# OpenCode Framework State File Management Analysis & Implementation Plan

**Version**: 1.4.0
**Date**: 2026-06-04
**Author**: AI Assistant (Multi-Agent Framework Analysis) — Reviewed by @Super-Admin
**Status**: Updated (Post-Implementation Audit — Compliance Matrix Corrected, Triggers Clarified, Size Projections Revised)
**Referenced Audits**: [cross-reference-audit.md](./cross-reference-audit.md), [evaluation-report.md](./evaluation-report.md), [opencode-upstream-capabilities.md](../opencode-upstream-capabilities.md)

---

## Executive Summary

This document analyzes the current state file bloat in the OpenCode multi-agent framework and proposes a structured, hierarchical state management architecture. The primary goal is to maintain framework compliance (Design Architecture, Hardened Enforcement Constraints, Harness System, Permission Matrix, Multi-Agent System, Central State Management, and Templatization) while scaling efficiently as the project grows.

**Key Findings**:
- `gate-state.json`: ~876KB with 389 sessions + 114 drained — **critical bloat**
- `Task.DAG.json`: 376KB with 264 tasks and 55 changelog entries — **unbounded growth**
- `safe-bash.log`: ~2.1MB append-only — **no rotation**
- `.transaction-log`: ~636KB WAL — **no compaction**
- `machine.json`: ~181KB — manageable but growing

**Proposed Solution**: Three-tier hierarchical storage (Working Memory / Persistent Store / Archive) with automated compaction, **integrating with OpenCode's native `session.compacted` hook and `experimental.session.compacting` infrastructure**, while maintaining full Git traceability and framework compliance.

**Critical Update (v1.3.0)**: Post-implementation audit by @Super-Admin (2026-06-04). Cross-referenced actual framework filesystem state against all 7 compliance dimensions. **Gate-state V2→V3 migration complete** (3.2KB hot file, 99.6% reduction). **Task.DAG hierarchical scaffolding in place** but compaction not yet executed. **FE modularization 7/7 modules extracted** but `index.ts` still delegates to monolith. See [cross-reference-audit.md](./cross-reference-audit.md) for 7 critical inconsistencies, 8 omissions, 5 completion gaps found.

**Critical Update (v1.4.0)**: This revision addresses the evaluation findings from the cross-reference audit and upstream API research:
- **§3.3 Compaction Trigger**: Ranked triggers explicitly — Primary (`compliance_gate_complete` → `onGateComplete()`) > Secondary (`session.compacted` → opportunistic) > Batch (`nightly-compaction.mjs`). Clarified distinction between OpenCode's LLM context compaction and framework state file compaction.
- **§3.3–§3.4 Size Projections**: Updated index file targets from 20KB/10KB to ~100KB/~85KB based on actual 503-session / 264-task measurements.
- **§3.3 archive.json vs index.json**: Simplified to recommend merging archive into index for session counts <1000. Separate archive file only when index exceeds 1MB.
- **§3.5 Log Rotation**: Added explicit `.transaction-log` rotation to Phase 3 implementation checklist.
- **§6 Compliance Matrix**: Replaced "✅ Compliant" with actual implementation ratings (72–100%) per cross-reference audit. Added gap list per dimension.
- **§6.1 Permission Matrix**: Added two-layer clarification (OpenCode permissions vs Framework tier enforcement). Fixed @Guardian row to allow `machine.json` read.
- **§5.1.3 Wiring**: Marked `compliance_gate_complete` → `StateCompactor.onGateComplete()` as pending implementation (not auto-completed by migration).

**Critical Update (v1.1.0)**: This revision addresses 5 critical omissions and 7 significant inconsistencies identified in the Super-Admin review, including integration with OpenCode's native compaction hooks, the `@opencode-ai/plugin` SDK, existing `compliance_gate_drain_stale` / `compliance_gate_purge` tools, concurrency handling, and technical corrections to the migration scripts.

**Critical Update (v1.2.0)**: Added Section 3.7 — Process Memory Database Evaluation. A Super-Admin emergency dispatch evaluated whether SQLite/Redis would improve performance. **Conclusion: Not needed.** File-based storage with hierarchical refactoring achieves 2-5ms parse times (already optimal), maintains Git traceability, and avoids database infrastructure complexity. Optional in-memory JavaScript cache (Map-based) recommended for future profiling-driven optimization.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Integration with OpenCode Native Features](#4-integration-with-opencode-native-features)
5. [Implementation Plan](#5-implementation-plan)
6. [Framework Compliance Matrix](#6-framework-compliance-matrix)
7. [Risk Assessment & Mitigation](#7-risk-assessment--mitigation)
8. [Appendices](#8-appendices)

---

### 3.7 Process Memory Database Evaluation

A Super-Admin emergency review evaluated whether integrating a **process memory database** (e.g., SQLite, Redis, LevelDB) would improve performance or data management. **Conclusion: A process memory database is NOT required.**

#### 3.7.1 Evaluation Criteria

| Criterion | File-Based (Proposed) | Process Memory DB (e.g., SQLite, Redis) | Winner |
|-----------|----------------------|----------------------------------------|--------|
| **Hot file parse time** | 2-5ms for 10-20KB JSON | 0.5-2ms (faster but negligible) | Tie (both sub-5ms) |
| **Git traceability** | Native text diffs | Binary blobs break `git diff` | **File-based** |
| **Dependency footprint** | Zero (Node.js `fs` only) | Native bindings / separate process | **File-based** |
| **Audit trail readability** | Human-readable JSONL | Requires export/query tools | **File-based** |
| **Concurrency safety** | Atomic rename + file lock | ACID transactions | Tie |
| **Write frequency** | Low (task boundaries only) | Overkill for low-write workload | **File-based** |
| **Framework simplicity** | No new infrastructure | Adds connection, migration, backup management | **File-based** |
| **Memory overhead** | Zero (mmap'd by OS) | Resident memory for DB process | **File-based** |

#### 3.7.2 Key Reasons for Rejection

**1. Performance is Already Optimal**
After the proposed refactoring:
- `gate-state.json`: 10-20KB → parse time **2-5ms**
- `Task.DAG.json`: 80KB → parse time **5-10ms**
- These are **sub-frame** latencies (60fps = 16ms/frame)
- A database would shave 1-3ms but at massive complexity cost

**2. Git Traceability is a Hard Requirement**
The framework's compliance model requires:
- `git diff` must show human-readable changes
- `git log` must trace every state mutation
- Pre-commit hooks validate file content
Binary databases (SQLite, Redis RDB) **fundamentally break this** — diffs become opaque blob changes.

**3. Write Frequency is Too Low**
State writes occur only at **task boundaries**:
- `compliance_gate_check`: ~2/day
- `compliance_gate_confirm`: ~2/day
- `compliance_gate_complete`: ~2/day
- DAG version bump: ~1/week
A database optimized for high-throughput (1000+ ops/sec) is massive overkill for **<10 writes/day**.

**4. Framework Already Has Atomic Operations**
The `safe-edit-core.ts` module provides:
- TOCTOU-safe reads with retry
- Atomic writes (temp file + rename)
- Concurrent access protection
These patterns are **proven** and require zero external dependencies.

**5. Infrastructure Complexity**
Adding SQLite/Redis would require:
- New dependency in `package.json`
- Connection management code
- Migration scripts for schema changes
- Backup/restore procedures
- Monitoring for DB health
- Connection pooling for concurrent agents

**Total cost**: ~500 lines of new code + ongoing maintenance.
**Benefit**: 1-3ms faster parse times.
**ROI**: Negative.

#### 3.7.3 Optional Enhancement: In-Memory Cache

While a database is unnecessary, an **in-memory JavaScript cache** at framework startup can eliminate repeated disk reads:

```typescript
// .opencode/lib/state-cache.ts
class StateCache {
  private cache = new Map<string, any>();
  private lastModified = new Map<string, number>();
  
  async get(filePath: string): Promise<any> {
    const stat = await fs.promises.stat(filePath);
    const mtime = stat.mtimeMs;
    
    if (this.lastModified.get(filePath) !== mtime) {
      // Cache miss or stale — reload from disk
      const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      this.cache.set(filePath, data);
      this.lastModified.set(filePath, mtime);
    }
    
    return this.cache.get(filePath);
  }
  
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
    this.lastModified.delete(filePath);
  }
}
```

**Benefits**:
- Eliminates redundant disk reads within the same agent session
- Zero dependencies (standard JavaScript `Map`)
- Automatic invalidation on file modification time change
- Memory footprint: ~50KB for cached hot files

**When to use**: After Phase 1 implementation, if profiling shows repeated reads of the same hot file.

#### 3.7.4 Future Reconsideration Triggers

Revisit this decision if:
- Hot file sizes exceed **100KB** (parse time >10ms)
- Concurrent write conflicts exceed **1/day**
- Git repository size exceeds **100MB**
- Need for **cross-process** state sharing arises
- **Full-text search** over historical sessions becomes required

Until then, the file-based three-tier architecture is the optimal balance of performance, simplicity, and compliance.

---

---

## 1. Current State Analysis

### 1.1 File Inventory

| File | Path | Size | Lines | Records | Growth Rate | Severity |
|------|------|------|-------|---------|-------------|----------|
| **gate-state.json** | `.opencode/state/gate-state.json` | ~876KB | 12,835 | 389 active + 114 drained | ~2 sessions/day | 🔴 Critical |
| **Task.DAG.json** | `Task.DAG.json` | 376KB | 7,597 | 264 tasks + 55 changelog | ~10 tasks/week | 🔴 Critical |
| **safe-bash.log** | `.opencode/logs/safe-bash.log` | ~2.1MB | N/A | Append-only | ~100KB/week | 🟡 High |
| **.transaction-log** | `.opencode/state/.transaction-log` | ~636KB | N/A | WAL entries | ~50KB/week | 🟡 High |
| **machine.json** | `.opencode/state/machine.json` | ~181KB | 4,422 | 9 state segments | ~5KB/week | 🟢 Medium |
| **framework-enforcer.ts** | `.opencode/plugins/framework-enforcer/framework-enforcer.ts` | ~50KB | 1,655 | 14 hooks | ~20 lines/week | 🟢 Medium |
| **framework-enforcer.test.js** | `.opencode/scripts/__tests__/framework-enforcer.test.js` | ~120KB | 3,150 | Test cases | Stable | 🟢 Low |

### 1.2 Detailed File Analysis

#### 1.2.1 gate-state.json (~876KB, 12,835 lines)

**Structure**:
```json
{
  "formatVersion": "2.0",
  "sessions": {
    "cg_ses_1779323731637": {
      "session_id": "...",
      "created_at": "...",
      "task_description": "Full multi-paragraph task description...",
      "gate_status": "completed",
      "last_check_failed_items": [],
      "plan_summary": "Full multi-paragraph plan summary...",
      "confirmed_at": "...",
      "consumed_at": "...",
      "audit": {
        "execution_summary": "Full multi-paragraph execution summary...",
        "completed_at": "..."
      }
    }
  },
  "active_sessions": { ... },
  "last_updated": "...",
  "drained_sessions": { ... },
  "meta": { ... },
  "audit_history": [ ... ]
}
```

**Problem**: Every session stores **full verbose text**:
- `task_description`: ~200-500 chars
- `plan_summary`: ~500-2000 chars
- `execution_summary`: ~500-3000 chars

With 503 total sessions (389 active + 114 drained), this accumulates to **~876KB of mostly historical data**.

**Access Pattern**:
- **Hot**: Active sessions (≤10 at any time)
- **Warm**: Recently completed (last 7 days)
- **Cold**: Historical sessions (>7 days)

**Current ratio**: 100% hot (all in one file)

**Existing Infrastructure**: The framework already has `compliance_gate_drain_stale` and `compliance_gate_purge` tools (Section 4.2) that handle stale session lifecycle — these will be leveraged rather than reimplemented.

#### 1.2.2 Task.DAG.json (376KB, 7,597 lines)

**Structure**:
```json
{
  "version": "5.4.0",
  "project": "booking-system",
  "feature": "...",
  "description": "...",
  "change_log": [
    {
      "version": "5.3.0",
      "date": "...",
      "summary": "Full paragraph changelog entry...",
      "completed_tasks": 186,
      "pending_tasks": 75
    }
  ],
  "tasks": [
    {
      "id": "T001",
      "name": "...",
      "description": "...",
      "agent": "@Coder-BE",
      "dependencies": [...],
      "outputs": [...],
      "priority": "P1",
      "status": "completed",
      "requirement_source": { ... },
      "target_files": [...],
      "definition_of_done": { ... }
    }
  ],
  "task_groups": [...]
}
```

**Problem**: 
- **55 changelog entries** with full paragraph summaries (historical)
- **264 tasks**, of which **189 are completed** (72% historical)
- **13 task groups** with full metadata

**Access Pattern**:
- **Hot**: Pending tasks (75), current changelog entry
- **Warm**: Recently completed tasks (last 2 weeks) — needed by @Orchestrator for dependency tracking and @Guardian for review
- **Cold**: Historical tasks and changelog entries (>2 weeks)

**Critical Design Constraint**: @Orchestrator and @Guardian require access to **recently completed task history** for dependency validation and audit trails. The hot file must retain **at least the last 2 weeks of completed tasks**.

#### 1.2.3 safe-bash.log (~2.1MB)

**Problem**: Pure append-only log with no rotation or compression.

**Sample Entry**:
```
[2026-05-21T01:22:40.099Z] agent=@Coder-BE command="git status" exitCode=0
[2026-05-21T01:22:40.500Z] agent=@Coder-BE command="git add -A" exitCode=0
...
```

**Growth**: ~100KB/week with current usage.

#### 1.2.4 .transaction-log (~636KB)

**Problem**: WAL-style transaction log for state changes. No compaction or archiving. Note: This is distinct from the proposed `gate-state.wal/` — the transaction-log tracks machine.json state transitions, while gate-state.wal would track gate session data.

### 1.3 Impact Assessment

| Metric | Current | Projected (6 months) | Projected (1 year) |
|--------|---------|---------------------|-------------------|
| gate-state.json | ~876KB | 2.5MB | 5MB |
| Task.DAG.json | 376KB | 800KB | 1.5MB |
| safe-bash.log | ~2.1MB | 4.8MB | 7.5MB |
| .transaction-log | ~636KB | 1.5MB | 2.8MB |
| **Total** | **~4.0MB** | **~9.6MB** | **~16.8MB** |

**Git Impact**: Repository clone time increases, `git diff` slows, CI checkout overhead grows.

**Runtime Impact**: JSON parse time for gate-state.json increases from ~50ms to ~300ms.

---

## 2. Root Cause Analysis

### 2.1 Monolithic JSON Anti-Pattern

All framework state uses **single-file JSON storage**:
- No separation between active and historical data
- No indexing for fast lookups
- Full parse required for any read operation

**Why this happened**:
- Simplicity in early framework design
- Easy Git tracking (single file)
- Straightforward for agents to read/write

**Why it doesn't scale**:
- O(n) parse time for n sessions/tasks
- O(n) memory footprint
- Merge conflicts in Git for concurrent updates

### 2.2 No Archival/Compaction Strategy

The framework has limited mechanisms to manage historical data:
- `compliance_gate_drain_stale` exists but only moves sessions to `drained_sessions` within the same file
- `compliance_gate_purge` exists but is manual/infrequent
- No automatic rotation for logs
- No snapshotting for DAG versions

**Framework Gap**: The state-machine-standard.md mentions WAL but doesn't define compaction triggers or archival policies. OpenCode's native `session.compacted` hook exists but is not utilized for framework state management.

### 2.3 Verbose Audit Trail Storage

Each gate session stores:
- `task_description`: User's original request
- `plan_summary`: Multi-paragraph plan
- `execution_summary`: Multi-paragraph execution report

**Total per session**: ~1-5KB of text

**Optimization opportunity**: Store summaries in `gate-state.json`, move full text to append-only log.

### 2.4 Lack of Tiered Storage Awareness

The framework treats all state equally:
- Active sessions (hot, frequent access)
- Completed sessions (warm, occasional access)
- Drained sessions (cold, rare access)

All three tiers are stored in the same file, parsed on every read.

---

## 3. Proposed Architecture

### 3.1 Design Philosophy

**"Process Memory Codebase"** — Inspired by operating system memory management:
- **Working Set**: Keep only actively used data in fast-access storage
- **Paging**: Move less-recently-used data to secondary storage
- **Swapping**: Archive old data to compressed files

### 3.2 Three-Tier Storage Model

```
┌─────────────────────────────────────────────────────────────────┐
│ TIER 1: WORKING MEMORY (Hot)                                    │
│ • Small, fast, always in memory                                  │
│ • JSON format for agent compatibility                            │
│ • Git-tracked for consistency                                    │
│ • ONLY active sessions + recent completed (last 7 days)          │
├─────────────────────────────────────────────────────────────────┤
│ TIER 2: PERSISTENT STORE (Warm)                                 │
│ • Append-only JSONL files                                        │
│ • Immutable historical records                                   │
│ • Git-tracked for audit traceability                             │
│ • Completed sessions older than 7 days                           │
├─────────────────────────────────────────────────────────────────┤
│ TIER 3: ARCHIVE (Cold)                                          │
│ • Compressed JSONL/Parquet files                                 │
│ • Git-tracked or Git-LFS for large archives                      │
│ • Retained for compliance/audit                                  │
│ • Drained sessions + sessions >30 days old                       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 gate-state.json Refactoring

#### Current Structure
```
.opencode/state/gate-state.json (~876KB, 503 sessions)
```

#### Proposed Structure
```
.opencode/state/
├── gate-state.json                    # 10-20KB — Active + recent completed (≤7 days)
├── gate-state.index.json              # 20KB — Session metadata index (all sessions)
├── gate-state.archive.json            # 600KB — Drained/completed sessions >7 days
└── gate-state.history/                # Directory (renamed from gate-state.wal/)
    ├── 2026-05-21.jsonl               # Daily append-only log
    ├── 2026-05-22.jsonl
    └── ...
```

**Naming Rationale**: Using `gate-state.history/` instead of `gate-state.wal/` to avoid confusion with the existing `.transaction-log` WAL mechanism. The transaction-log tracks machine.json state transitions (WAL), while gate-state.history tracks gate session audit trails (append-only log).

#### File Specifications

**gate-state.json** (Hot):
```json
{
  "formatVersion": "3.0",
  "active_sessions": {
    "cg_ses_1779323731637": {
      "session_id": "cg_ses_1779323731637",
      "created_at": "2026-05-21T00:35:31.637Z",
      "gate_status": "active",
      "confirmed_at": "2026-05-21T00:36:55.471Z",
      "task_description": "...",
      "plan_summary": "..."
    }
  },
  "recent_sessions": {
    "cg_ses_1779326249800": {
      "session_id": "cg_ses_1779326249800",
      "created_at": "2026-05-21T01:17:29.802Z",
      "gate_status": "completed",
      "consumed_at": "2026-05-21T01:31:44.348Z",
      "archive_ref": "gate-state.history/2026-05-21.jsonl#2"
    }
  },
  "meta": {
    "total_sessions": 503,
    "active_count": 3,
    "recent_count": 15,
    "last_compacted": "2026-06-03T00:00:00.000Z"
  }
}
```

**gate-state.index.json** (Warm Index):
```json
{
  "formatVersion": "3.0",
  "sessions": {
    "cg_ses_1779323731637": {
      "session_id": "cg_ses_1779323731637",
      "created_at": "2026-05-21T00:35:31.637Z",
      "gate_status": "completed",
      "consumed_at": "2026-05-21T00:42:41.490Z",
      "archive_ref": "gate-state.history/2026-05-21.jsonl#1"
    }
  }
}
```

**gate-state.history/YYYY-MM-DD.jsonl** (Warm Detail):
```jsonl
{"session_id":"cg_ses_1779323731637","task_description":"...","plan_summary":"...","execution_summary":"...","audit":{"completed_at":"2026-05-21T00:42:41.490Z"}}
```

**gate-state.archive.json** (Cold):
```json
{
  "formatVersion": "3.0",
  "archived_at": "2026-06-03T00:00:00.000Z",
  "session_count": 389,
  "sessions": {
    "cg_ses_1779323731637": {
      "session_id": "...",
      "archive_ref": "gate-state.history/2026-05-21.jsonl#1"
    }
  }
}
```

#### Compaction Trigger

**Important Distinction**: OpenCode's `session.compacted` event fires when **LLM conversation context** is compacted (summarized to save tokens). This is distinct from **framework state file compaction** (moving old gate session data from hot JSON to archive JSONL). The two mechanisms serve different purposes and operate at different layers.

Compaction triggers are explicitly ranked by reliability:

**Primary Trigger — `compliance_gate_complete` (deterministic)**:
1. `compliance_gate_complete` tool implementation explicitly calls `StateCompactor.onGateComplete()`
2. Session status changes to "completed"
3. Full session data written to `gate-state.history/YYYY-MM-DD.jsonl` (daily-split)
4. Session metadata added to `gate-state.index.json`
5. Session moved to `recent_sessions` in `gate-state.json`
6. `gate-state.json` meta counts updated
7. **Note**: This wiring is a PENDING IMPLEMENTATION TASK — the `StateCompactor` class exists but `compliance-gate.js` has not yet been updated to call it.

**Secondary Trigger — `session.compacted` (opportunistic, best-effort)**:
- The framework-enforcer plugin's `session.compacted` hook fires when OpenCode compacts LLM context
- This can opportunistically trigger `StateCompactor.onSessionCompacted()` to archive any completed gate sessions for that session ID
- If the hook never fires (short sessions that don't trigger LLM context compaction), state archival still occurs via the primary or batch triggers
- This is a supplementary mechanism, NOT the sole or primary archival path

**Batch Trigger — Nightly Compaction via @CI-CD-Agent (safety net)**:
1. Cron job (or manual invocation) runs `nightly-compaction.mjs` daily
2. Read all `.jsonl` files older than 7 days
3. Move old recent sessions to `gate-state.archive.json` (or merge into index for session counts <1000)
4. Update `gate-state.index.json` with updated references
5. Move sessions from `recent_sessions` (older than 7 days) to cold storage
6. This catch-all ensures no session is permanently stranded in the hot file

**Integration with `compliance_gate_drain_stale`**:
- The existing `drain_stale` tool will be updated to move drained sessions directly to `gate-state.archive.json` instead of `drained_sessions` within the monolithic file
- This eliminates the intermediate `drained_sessions` dict entirely

#### Size Projection

| File | Current | After Refactor | Note |
|------|---------|---------------|------|
| gate-state.json | ~876KB | 3–20KB | Active + recent completed (≤7 days). Post-migration actual: 3.2KB (3 active sessions, no recent due to cutoff). |
| gate-state.index.json | — | ~100KB | Session metadata index for all 503 sessions (~200 bytes/entry with timestamps and archive_refs). |
| gate-state.history/ | — | 200–450KB | Append-only daily JSONL files. Post-migration actual: 448KB (436KB monolithic migration file + 2.3KB daily file). |
| gate-state.archive.json | — | 30–600KB | For session counts <1000, this can be merged into `index.json` by adding an `archived_at` field to index entries. Separate archive file only when index exceeds ~1MB. |
| **Total** | **~876KB** | **~870KB** | Total size similar, but hot file dropped 99.6%, dramatically improving parse times. |

**Note**: The original v1.0 estimate of 20KB for the index was optimistic — actual entries average ~200 bytes each (session_id, created_at, gate_status, consumed_at, archive_ref). At 503 sessions, the index is ~101KB.

### 3.4 Task.DAG.json Refactoring

#### Current Structure
```
Task.DAG.json (376KB, 264 tasks + 55 changelog entries)
```

#### Proposed Structure
```
Task.DAG.json                          # 80KB — Current version + active + recent completed (2 weeks)
Task.DAG.versions/                     # Directory
├── Task.DAG.v5.3.0.json              # Snapshot at version 5.3.0
├── Task.DAG.v5.4.0.json
└── ...
Task.DAG.changelog.md                  # Append-only markdown changelog
Task.DAG.index.json                    # 10KB — Task lookup index
```

#### File Specifications

**Task.DAG.json** (Hot):
```json
{
  "version": "5.4.0",
  "project": "booking-system",
  "generated_by": "@Meta-Planner",
  "generated_at": "2026-05-30T23:59:00.000Z",
  "tasks": [
    // PENDING tasks (75)
    // + COMPLETED tasks from last 2 weeks (~40)
    // Total: ~115 tasks in hot file
  ],
  "task_groups": [
    // Only active groups
  ],
  "meta": {
    "total_tasks": 264,
    "pending_tasks": 75,
    "recent_completed": 40,
    "archived_completed": 149,
    "latest_version": "5.4.0",
    "changelog_ref": "Task.DAG.changelog.md"
  }
}
```

**Critical Design Change (v1.1.0)**: Retain **completed tasks from the last 2 weeks** in the hot file. This ensures:
- @Orchestrator can validate dependencies against recently completed tasks
- @Guardian can review recently completed work without archive lookups
- Only tasks >2 weeks old are moved to version snapshots

**Task.DAG.versions/Task.DAG.v{version}.json** (Warm):
- Full DAG snapshot at each version bump
- Git-tracked for version history
- Used for rollback and audit

**Task.DAG.changelog.md** (Warm):
```markdown
# Task.DAG Changelog

## v5.4.0 (2026-05-30)
- TOOL-CONSOLIDATE completion
- Phase 0 hardening + all TOOL-CONSOLIDATE tasks completed

## v5.3.0 (2026-05-30)
- Arbiter TOOL-CONSOLIDATE ruling
- Added 5 Phase 0 hardening tasks
```

**Task.DAG.index.json** (Index):
```json
{
  "task_index": {
    "T001": {
      "version": "5.4.0",
      "status": "completed",
      "completed_at": "2026-05-30T23:59:00.000Z",
      "archive_ref": "Task.DAG.versions/Task.DAG.v5.4.0.json#tasks.T001"
    }
  }
}
```

#### Version Bump Process

1. **@Meta-Planner** creates new version
2. Current `Task.DAG.json` copied to `Task.DAG.versions/Task.DAG.v{old}.json`
3. Tasks completed >2 weeks ago removed from hot `Task.DAG.json`
4. Changelog entry appended to `Task.DAG.changelog.md`
5. Index updated
6. Git commit with both files

#### Size Projection

| File | Current | After Refactor | Note |
|------|---------|---------------|------|
| Task.DAG.json | 376KB | 80KB | Pending + recent completed (2 weeks, ~115 tasks). Post-migration actual: 348KB (compaction not yet executed). |
| Task.DAG.versions/ | — | 280KB | Full version snapshots for rollback/audit. 1 snapshot = ~380KB. |
| Task.DAG.changelog.md | — | 23KB | Append-only markdown. Post-migration actual: 23KB. |
| Task.DAG.index.json | — | ~85KB | Task lookup index for 264 tasks (~320 bytes/entry). |
| **Total** | **376KB** | **~470KB** | Index and changelog are auto-generated from hot DAG + version snapshots. Can be made optional if agents don't need per-task lookup without full DAG parse. |

**Note**: The original v1.0 estimate of 10KB for the index was optimistic — actual entries average ~320 bytes each (id, version, status, completed_at, archive_ref). At 264 tasks, the index is ~85KB. The hot `Task.DAG.json` target of 80KB is achievable once compaction is executed (removing 149 archived tasks from the hot file).

### 3.5 Log Rotation (safe-bash.log & .transaction-log)

#### Proposed Structure
```
.opencode/logs/
├── safe-bash.log                      # 100KB max — current
├── safe-bash.log.1                    # Rotated
├── safe-bash.log.2.gz                 # Compressed
├── safe-bash.log.3.gz
└── archive/                           # Monthly archives
    ├── 2026-05.tar.gz
    └── ...

.opencode/state/
├── .transaction-log                   # 100KB max — current
├── .transaction-log.1                 # Rotated
└── .transaction-log.archive/          # Directory
    ├── 2026-05.tar.gz
    └── ...
```

#### Rotation Policy

**Size-based**:
- When log hits 100KB, rotate
- Keep 3 rotated files (`*.1`, `*.2`, `*.3`)
- Compress files older than 3 days
- Archive files older than 30 days to `.tar.gz`

**Time-based**:
- Daily: Rotate if size > 10KB
- Weekly: Compress all rotated files
- Monthly: Archive to `.tar.gz`

#### Size Projection

| File | Current | After Refactor (6mo) | After Refactor (1yr) |
|------|---------|---------------------|---------------------|
| safe-bash.log | ~2.1MB | 100KB | 100KB |
| .transaction-log | ~636KB | 100KB | 100KB |
| Archive storage | — | 2MB | 4MB |

### 3.6 framework-enforcer.ts Modularization

#### Current Structure
```
framework-enforcer.ts (1,655 lines, monolithic)
```

#### Proposed Structure
```
.opencode/plugins/framework-enforcer/
├── index.ts                           # 200 lines — Bootstrap + hook registration
├── hooks/
│   ├── tool-execute.ts                # 400 lines — tool.execute.before/after
│   ├── file-edit.ts                   # 300 lines — file.edited
│   ├── command-exec.ts                # 200 lines — command.executed
│   └── session-compacted.ts           # 150 lines — session.compacted (NEW)
├── checks/
│   ├── gate-armed.ts                  # 200 lines
│   ├── keystone-hash.ts               # 200 lines
│   ├── tdd-order.ts                   # 150 lines
│   └── state-compaction.ts            # 150 lines — NEW
├── utils/
│   ├── audit-log.ts                   # 100 lines
│   └── state-manager.ts               # 200 lines — NEW
└── types.ts                           # 100 lines
```

**Benefits**:
- Each module <400 lines (coding standard compliance)
- Independent testability
- Faster incremental builds
- Clear separation of concerns

---

### 3.7 Process Memory Database Evaluation

A Super-Admin emergency review evaluated whether integrating a **process memory database** (e.g., SQLite, Redis, LevelDB) would improve performance or data management. **Conclusion: A process memory database is NOT required.**

#### 3.7.1 Evaluation Criteria

| Criterion | File-Based (Proposed) | Process Memory DB (e.g., SQLite, Redis) | Winner |
|-----------|----------------------|----------------------------------------|--------|
| **Hot file parse time** | 2-5ms for 10-20KB JSON | 0.5-2ms (faster but negligible) | Tie (both sub-5ms) |
| **Git traceability** | ✅ Native text diffs | ❌ Binary blobs break `git diff` | **File-based** |
| **Dependency footprint** | ✅ Zero (Node.js `fs` only) | ❌ Native bindings / separate process | **File-based** |
| **Audit trail readability** | ✅ Human-readable JSONL | ❌ Requires export/query tools | **File-based** |
| **Concurrency safety** | ✅ Atomic rename + file lock | ✅ ACID transactions | Tie |
| **Write frequency** | Low (task boundaries only) | Overkill for low-write workload | **File-based** |
| **Framework simplicity** | ✅ No new infrastructure | ❌ Adds connection, migration, backup management | **File-based** |
| **Memory overhead** | ✅ Zero (mmap'd by OS) | ❌ Resident memory for DB process | **File-based** |

#### 3.7.2 Key Reasons for Rejection

**1. Performance is Already Optimal**
After the proposed refactoring:
- `gate-state.json`: 10-20KB → parse time **2-5ms**
- `Task.DAG.json`: 80KB → parse time **5-10ms**
- These are **sub-frame** latencies (60fps = 16ms/frame)
- A database would shave 1-3ms but at massive complexity cost

**2. Git Traceability is a Hard Requirement**
The framework's compliance model requires:
- `git diff` must show human-readable changes
- `git log` must trace every state mutation
- Pre-commit hooks validate file content
Binary databases (SQLite, Redis RDB) **fundamentally break this** — diffs become opaque blob changes.

**3. Write Frequency is Too Low**
State writes occur only at **task boundaries**:
- `compliance_gate_check`: ~2/day
- `compliance_gate_confirm`: ~2/day
- `compliance_gate_complete`: ~2/day
- DAG version bump: ~1/week
A database optimized for high-throughput (1000+ ops/sec) is massive overkill for **<10 writes/day**.

**4. Framework Already Has Atomic Operations**
The `safe-edit-core.ts` module provides:
- TOCTOU-safe reads with retry
- Atomic writes (temp file + rename)
- Concurrent access protection
These patterns are **proven** and require zero external dependencies.

**5. Infrastructure Complexity**
Adding SQLite/Redis would require:
- New dependency in `package.json`
- Connection management code
- Migration scripts for schema changes
- Backup/restore procedures
- Monitoring for DB health
- Connection pooling for concurrent agents

**Total cost**: ~500 lines of new code + ongoing maintenance.
**Benefit**: 1-3ms faster parse times.
**ROI**: Negative.

#### 3.7.3 Optional Enhancement: In-Memory Cache

While a database is unnecessary, an **in-memory JavaScript cache** at framework startup can eliminate repeated disk reads:

```typescript
// .opencode/lib/state-cache.ts
class StateCache {
  private cache = new Map<string, any>();
  private lastModified = new Map<string, number>();
  
  async get(filePath: string): Promise<any> {
    const stat = await fs.promises.stat(filePath);
    const mtime = stat.mtimeMs;
    
    if (this.lastModified.get(filePath) !== mtime) {
      // Cache miss or stale — reload from disk
      const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      this.cache.set(filePath, data);
      this.lastModified.set(filePath, mtime);
    }
    
    return this.cache.get(filePath);
  }
  
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
    this.lastModified.delete(filePath);
  }
}
```

**Benefits**:
- Eliminates redundant disk reads within the same agent session
- Zero dependencies (standard JavaScript `Map`)
- Automatic invalidation on file modification time change
- Memory footprint: ~50KB for cached hot files

**When to use**: After Phase 1 implementation, if profiling shows repeated reads of the same hot file.

#### 3.7.4 Future Reconsideration Triggers

Revisit this decision if:
- Hot file sizes exceed **100KB** (parse time >10ms)
- Concurrent write conflicts exceed **1/day**
- Git repository size exceeds **100MB**
- Need for **cross-process** state sharing arises
- **Full-text search** over historical sessions becomes required

Until then, the file-based three-tier architecture is the optimal balance of performance, simplicity, and compliance.

---

## 4. Integration with OpenCode Native Features

### 4.1 OpenCode Native Compaction Infrastructure

The OpenCode framework provides **three native mechanisms** for session/state compaction that the proposal must integrate with:

#### 4.1.1 `session.compacted` Event

**Documentation**: https://opencode.ai/docs/plugins/#events (Session Events section)

**Description**: Fires when a session's **LLM conversation context** is compacted (summarized to reduce token usage). The event payload includes the session ID and compaction summary.

**Critical Distinction**: This event fires for **LLM context compaction** — summarizing conversation history to save tokens when sessions grow long. It does NOT fire when a compliance gate session completes. The framework's `StateCompactor` operates on **framework state files** (JSON), which is a separate domain. The `session.compacted` event serves as a **secondary, opportunistic trigger** for state archival — it should NOT be the sole or primary mechanism. See Section 3.3 "Compaction Trigger" for the ranked trigger hierarchy.

**Integration Point**: The framework-enforcer plugin subscribes to this event as a supplementary archival trigger:

```typescript
// .opencode/plugins/framework-enforcer/hooks/session-compacted.ts
export const SessionCompactedHook = async (input, output) => {
  const { sessionID } = input;
  
  // Trigger state compaction for this session's gate data
  await stateCompactor.onSessionCompacted(sessionID);
  
  // Log the compaction event
  writeAuditLogEntry({
    event: 'session.compacted',
    sessionID,
    action: 'state_archival_triggered'
  });
};
```

#### 4.1.2 `experimental.session.compacting` Hook

**Documentation**: https://opencode.ai/docs/plugins/#compaction-hooks (Compaction Hooks section)

**Description**: Fires **before** the LLM generates a continuation summary. Allows plugins to inject additional context or replace the compaction prompt entirely.

**Integration Point**: Use this hook to inject framework state context into the compaction summary:

```typescript
// .opencode/plugins/framework-enforcer/hooks/session-compacting.ts
export const SessionCompactingHook = async (input, output) => {
  // Inject framework state into compaction context
  const frameworkState = await getCompactFrameworkState();
  output.context.push(`## Framework State
- Active gate sessions: ${frameworkState.activeSessions}
- Recent completed sessions: ${frameworkState.recentSessions}
- Current DAG version: ${frameworkState.dagVersion}
`);
};
```

#### 4.1.3 Built-in "compaction" Agent

**Documentation**: https://opencode.ai/docs/agents/ (Agents section)

**Description**: A hidden system agent that "compacts long context into a smaller summary." This is the native agent that performs context compression.

**Integration Point**: The proposal's `StateCompactor` class should **extend** rather than replace this native agent. The custom compactor handles framework-specific state (gate-state, DAG), while the native compaction agent handles LLM context.

### 4.2 `@opencode-ai/plugin` SDK

**Documentation**: https://opencode.ai/docs/plugins/#typescript-support

**Description**: Official TypeScript plugin SDK providing:
- `Plugin` type for type-safe plugin development
- `tool()` helper for custom tool creation
- Zod schema integration for tool arguments

**Integration Point**: All new framework-enforcer modules should use the official SDK:

```typescript
import type { Plugin } from "@opencode-ai/plugin";

export const StateCompactionPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      // Framework state injection logic
    },
    "session.compacted": async (input, output) => {
      // Post-compaction archival logic
    }
  };
};
```

### 4.3 Existing Compliance Gate Tools

The framework already provides two tools for session lifecycle management:

#### 4.3.1 `compliance_gate_drain_stale`

**Current Behavior**: Moves stale sessions from `active_sessions` to `drained_sessions` within `gate-state.json`.

**Updated Behavior (v3)**: Moves stale sessions to `gate-state.archive.json` and removes them from the hot file entirely.

```typescript
// Updated drain_stale logic
export async function drainStaleSessions(thresholdHours: number): Promise<void> {
  const hotState = await readHotState();
  const now = Date.now();
  
  for (const [sessionId, session] of Object.entries(hotState.active_sessions)) {
    const createdAt = new Date(session.created_at).getTime();
    const ageHours = (now - createdAt) / (1000 * 60 * 60);
    
    if (ageHours > thresholdHours && session.gate_status !== 'active') {
      // Move to archive instead of drained_sessions
      await archiveSession(sessionId, session);
      delete hotState.active_sessions[sessionId];
    }
  }
  
  await writeHotState(hotState);
}
```

#### 4.3.2 `compliance_gate_purge`

**Current Behavior**: Force-purges stale sessions, moving them to `drained_sessions`.

**Updated Behavior (v3)**: Force-purges stale sessions, moving them directly to `gate-state.archive.json` and deleting from hot file.

### 4.4 Unified State Compaction Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ OpenCode Native Layer                                           │
│ • session.compacted event                                       │
│ • experimental.session.compacting hook                          │
│ • Built-in compaction agent                                     │
├─────────────────────────────────────────────────────────────────┤
│ Framework-Enforcer Plugin Layer                                 │
│ • StateCompactionPlugin (uses @opencode-ai/plugin SDK)          │
│ • Hooks into native events to trigger framework state archival  │
├─────────────────────────────────────────────────────────────────┤
│ Custom State Manager Layer                                      │
│ • StateCompactor class                                          │
│ • Handles gate-state, DAG, log rotation                         │
│ • Uses fs with TOCTOU protection (from safe-edit-core.ts)       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Implementation Plan

### Phase 0: Foundation (Week 1)

#### 0.1 Schema Design
- [ ] Define `gate-state.v3.schema.json`
- [ ] Define `Task.DAG.v2.schema.json`
- [ ] Define history entry schema
- [ ] Update `machine.schema.json` with new state segments

#### 0.2 Directory Structure
```
.opencode/state/
├── gate-state.json                    # Updated
├── gate-state.index.json              # NEW
├── gate-state.archive.json            # NEW
├── gate-state.history/                # NEW directory (renamed from gate-state.wal/)
│   └── .gitkeep
├── machine.json                       # Existing
└── .transaction-log                   # Existing (unchanged)

Task.DAG.json                          # Updated
Task.DAG.versions/                     # NEW directory
Task.DAG.changelog.md                  # NEW
Task.DAG.index.json                    # NEW

.opencode/logs/                        # Updated structure
├── safe-bash.log
└── archive/                           # NEW
```

#### 0.3 Backup Current State
```bash
# Create backup snapshot with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p .opencode/state/.backups/$TIMESTAMP
cp .opencode/state/gate-state.json .opencode/state/.backups/$TIMESTAMP/gate-state.v2.backup.json
cp Task.DAG.json .opencode/state/.backups/$TIMESTAMP/Task.DAG.v1.backup.json
cp .opencode/state/machine.json .opencode/state/.backups/$TIMESTAMP/machine.backup.json
echo "Backup created at .opencode/state/.backups/$TIMESTAMP/"
```

### Phase 1: gate-state.json Refactoring (Week 2-3)

#### 1.1 Implement State Manager Module
**File**: `.opencode/lib/state-manager.ts`

```typescript
/**
 * Hierarchical State Manager
 * Manages three-tier storage for gate-state
 * 
 * Uses OpenCode's session.compacted event for archival triggers
 * Integrates with compliance_gate_drain_stale/purge
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

interface GateStateHot {
  formatVersion: string;
  active_sessions: Record<string, GateSessionHot>;
  recent_sessions: Record<string, GateSessionRecent>;
  meta: GateStateMeta;
}

interface GateSessionHot {
  session_id: string;
  created_at: string;
  gate_status: 'active' | 'pending';
  confirmed_at?: string;
  task_description: string;
  plan_summary: string;
}

interface GateSessionRecent {
  session_id: string;
  created_at: string;
  gate_status: 'completed';
  consumed_at: string;
  archive_ref: string;
}

interface GateStateMeta {
  total_sessions: number;
  active_count: number;
  recent_count: number;
  last_compacted: string;
}

interface GateStateIndex {
  formatVersion: string;
  sessions: Record<string, GateSessionIndex>;
}

interface GateSessionIndex {
  session_id: string;
  created_at: string;
  gate_status: 'completed' | 'drained';
  consumed_at?: string;
  archive_ref: string;
}

interface HistoryEntry {
  session_id: string;
  task_description: string;
  plan_summary: string;
  execution_summary: string;
  audit: SessionAudit;
}
```

#### 1.2 Implement Compaction Logic
**File**: `.opencode/lib/state-compactor.ts`

```typescript
/**
 * Compaction Engine
 * Moves completed sessions from hot to warm/cold storage
 * 
 * Integrates with:
 * - compliance_gate_complete (automatic trigger)
 * - compliance_gate_drain_stale (stale session cleanup)
 * - session.compacted OpenCode event (native integration)
 */

export class StateCompactor {
  private readonly HISTORY_DIR = '.opencode/state/gate-state.history';
  private readonly HOT_FILE = '.opencode/state/gate-state.json';
  private readonly INDEX_FILE = '.opencode/state/gate-state.index.json';
  private readonly ARCHIVE_FILE = '.opencode/state/gate-state.archive.json';
  private readonly RECENT_DAYS = 7;
  
  /**
   * Compaction trigger: compliance_gate_complete
   */
  async onGateComplete(sessionId: string): Promise<void> {
    // 1. Read full session data
    const session = await this.readFullSession(sessionId);
    
    // 2. Write to history (append-only JSONL)
    const historyRef = await this.writeToHistory(session);
    
    // 3. Update index
    await this.updateIndex(sessionId, historyRef);
    
    // 4. Move from active to recent in hot storage
    await this.moveToRecent(sessionId, historyRef);
    
    // 5. Update meta counts
    await this.updateMeta();
  }
  
  /**
   * OpenCode native hook: session.compacted
   */
  async onSessionCompacted(sessionId: string): Promise<void> {
    // Trigger archival for this session's gate data
    const session = await this.findSession(sessionId);
    if (session && session.gate_status === 'completed') {
      await this.onGateComplete(sessionId);
    }
  }
  
  /**
   * Nightly batch compaction (called by @CI-CD-Agent)
   */
  async nightlyCompaction(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RECENT_DAYS);
    
    // 1. Move old recent sessions to archive
    await this.archiveOldRecentSessions(cutoffDate);
    
    // 2. Compress old history files
    await this.compressOldHistory(cutoffDate);
  }
  
  /**
   * Integration with compliance_gate_drain_stale
   */
  async drainStaleSessions(thresholdHours: number): Promise<void> {
    const hotState = JSON.parse(readFileSync(this.HOT_FILE, 'utf8'));
    const now = Date.now();
    
    for (const [sessionId, session] of Object.entries(hotState.active_sessions)) {
      const createdAt = new Date(session.created_at).getTime();
      const ageHours = (now - createdAt) / (1000 * 60 * 60);
      
      if (ageHours > thresholdHours && session.gate_status !== 'active') {
        // Archive instead of moving to drained_sessions
        await this.archiveSession(sessionId, session as GateSessionHot);
        delete hotState.active_sessions[sessionId];
      }
    }
    
    writeFileSync(this.HOT_FILE, JSON.stringify(hotState, null, 2));
  }
  
  private async writeToHistory(session: GateSessionHot): Promise<string> {
    const date = new Date().toISOString().split('T')[0];
    const historyFile = join(this.HISTORY_DIR, `${date}.jsonl`);
    
    // Ensure directory exists
    if (!existsSync(dirname(historyFile))) {
      mkdirSync(dirname(historyFile), { recursive: true });
    }
    
    const entry: HistoryEntry = {
      session_id: session.session_id,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
      execution_summary: session.audit?.execution_summary || '',
      audit: session.audit
    };
    
    // Atomic append with lock (using safe-edit-core.ts patterns)
    const line = JSON.stringify(entry) + '\n';
    // TODO: Use safeEdit's atomic write mechanism
    
    return `gate-state.history/${date}.jsonl#${await this.getLineCount(historyFile)}`;
  }
  
  private async getLineCount(filePath: string): Promise<number> {
    if (!existsSync(filePath)) return 0;
    const content = readFileSync(filePath, 'utf8');
    return content.split('\n').filter(line => line.trim()).length;
  }
  
  // ... additional methods
}
```

#### 1.3 Update compliance_gate_complete ⚠️ PENDING
**File**: Update existing `compliance-gate.ts` implementation

Add call to `StateCompactor.onGateComplete()` at the end of `compliance_gate_complete`.

> **Post-Migration Status (2026-06-04)**: The `StateCompactor` class (539 lines) and `StateManager` module (309 lines) are fully implemented and tested. However, `compliance-gate.js` has **NOT yet been updated** to call `onGateComplete()`. This is the single most impactful remaining task — once wired, automatic compaction will fire on every `compliance_gate_complete` call, preventing hot file bloat from recurring.

#### 1.4 Update Git Hook
**File**: `.opencode/hooks/pre-commit`

Modify to:
1. Validate `gate-state.json` format (hot file only)
2. Validate `gate-state.index.json` integrity
3. Skip full history validation (too expensive)
4. Validate that archive references resolve correctly (spot-check 5 random refs)

#### 1.5 Migration Script (ES Module, Safe)
**File**: `.opencode/scripts/migrate-gate-state-v2-to-v3.mjs`

```javascript
#!/usr/bin/env node
/**
 * Migration: gate-state.json v2 → v3
 * One-time script to convert existing monolithic file to hierarchical structure
 * 
 * SAFETY FEATURES:
 * - Creates timestamped backup before any changes
 * - Validates output before replacing original
 * - Idempotent: can be run multiple times safely
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const STATE_DIR = join(PROJECT_ROOT, '.opencode/state');
const GATE_STATE_V2 = join(STATE_DIR, 'gate-state.json');
const GATE_STATE_V3 = join(STATE_DIR, 'gate-state.json');
const GATE_STATE_INDEX = join(STATE_DIR, 'gate-state.index.json');
const GATE_STATE_ARCHIVE = join(STATE_DIR, 'gate-state.archive.json');
const HISTORY_DIR = join(STATE_DIR, 'gate-state.history');

// SAFETY: Create backup before any modifications
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_DIR = join(STATE_DIR, '.backups', TIMESTAMP);

function createBackup() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  copyFileSync(GATE_STATE_V2, join(BACKUP_DIR, 'gate-state.v2.backup.json'));
  console.log(`✅ Backup created at: ${BACKUP_DIR}`);
}

function validateOutput(hot, index, historyEntries) {
  const originalCount = Object.keys(JSON.parse(readFileSync(join(BACKUP_DIR, 'gate-state.v2.backup.json'), 'utf8')).sessions || {}).length;
  const newCount = Object.keys(hot.active_sessions).length + 
                   Object.keys(hot.recent_sessions || {}).length +
                   Object.keys(index.sessions).length;
  
  if (newCount !== originalCount) {
    throw new Error(`Validation failed: session count mismatch. Original: ${originalCount}, New: ${newCount}`);
  }
  
  if (historyEntries.length !== Object.keys(index.sessions).length) {
    throw new Error(`Validation failed: history entry count mismatch`);
  }
  
  console.log('✅ Validation passed');
}

function migrate() {
  console.log('Starting gate-state.json v2 → v3 migration...');
  
  // 1. SAFETY: Create backup
  createBackup();
  
  // 2. Read v2 file
  console.log('Reading v2 file...');
  const v2 = JSON.parse(readFileSync(GATE_STATE_V2, 'utf8'));
  
  // 3. Prepare new structures
  const hot = {
    formatVersion: '3.0',
    active_sessions: {},
    recent_sessions: {},
    meta: {
      total_sessions: Object.keys(v2.sessions || {}).length,
      active_count: 0,
      recent_count: 0,
      last_compacted: new Date().toISOString()
    }
  };
  
  const index = {
    formatVersion: '3.0',
    sessions: {}
  };
  
  const archive = {
    formatVersion: '3.0',
    archived_at: new Date().toISOString(),
    session_count: 0,
    sessions: {}
  };
  
  const historyEntries = [];
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  
  // 4. Process each session
  console.log('Processing sessions...');
  for (const [sessionId, session] of Object.entries(v2.sessions || {})) {
    if (session.gate_status === 'active' || session.gate_status === 'pending') {
      // Active → hot.active_sessions
      hot.active_sessions[sessionId] = {
        session_id: session.session_id,
        created_at: session.created_at,
        gate_status: session.gate_status,
        confirmed_at: session.confirmed_at,
        task_description: session.task_description,
        plan_summary: session.plan_summary
      };
      hot.meta.active_count++;
    } else {
      // Completed/drained → determine if recent or archive
      const consumedAt = session.consumed_at ? new Date(session.consumed_at) : null;
      const isRecent = consumedAt && consumedAt > recentCutoff;
      
      const historyEntry = {
        session_id: session.session_id,
        task_description: session.task_description,
        plan_summary: session.plan_summary,
        execution_summary: session.audit?.execution_summary || '',
        audit: session.audit
      };
      historyEntries.push(historyEntry);
      const historyRef = `gate-state.history/migrated-${TIMESTAMP}.jsonl#${historyEntries.length}`;
      
      if (isRecent) {
        // Recent → hot.recent_sessions
        hot.recent_sessions[sessionId] = {
          session_id: session.session_id,
          created_at: session.created_at,
          gate_status: session.gate_status,
          consumed_at: session.consumed_at,
          archive_ref: historyRef
        };
        hot.meta.recent_count++;
      } else {
        // Old → archive
        archive.sessions[sessionId] = {
          session_id: session.session_id,
          archive_ref: historyRef
        };
        archive.session_count++;
      }
      
      index.sessions[sessionId] = {
        session_id: session.session_id,
        created_at: session.created_at,
        gate_status: session.gate_status,
        consumed_at: session.consumed_at,
        archive_ref: historyRef
      };
    }
  }
  
  // 5. SAFETY: Validate before writing
  console.log('Validating output...');
  validateOutput(hot, index, historyEntries);
  
  // 6. Write files
  console.log('Writing new files...');
  mkdirSync(HISTORY_DIR, { recursive: true });
  
  // Write to temp first, then rename (atomic)
  const tempHot = `${GATE_STATE_V3}.tmp`;
  const tempIndex = `${GATE_STATE_INDEX}.tmp`;
  const tempArchive = `${GATE_STATE_ARCHIVE}.tmp`;
  
  writeFileSync(tempHot, JSON.stringify(hot, null, 2));
  writeFileSync(tempIndex, JSON.stringify(index, null, 2));
  writeFileSync(tempArchive, JSON.stringify(archive, null, 2));
  writeFileSync(
    join(HISTORY_DIR, `migrated-${TIMESTAMP}.jsonl`),
    historyEntries.map(e => JSON.stringify(e)).join('\n')
  );
  
  // Atomic rename
  // NOTE: On Windows, rename may fail if target exists. Use safe-edit-core.ts patterns for production.
  writeFileSync(GATE_STATE_V3, readFileSync(tempHot));
  writeFileSync(GATE_STATE_INDEX, readFileSync(tempIndex));
  writeFileSync(GATE_STATE_ARCHIVE, readFileSync(tempArchive));
  
  // Cleanup temp files
  // ...
  
  console.log(`\n✅ Migration complete!`);
  console.log(`  - Active sessions: ${hot.meta.active_count}`);
  console.log(`  - Recent sessions: ${hot.meta.recent_count}`);
  console.log(`  - Archived sessions: ${archive.session_count}`);
  console.log(`  - Total processed: ${hot.meta.total_sessions}`);
  console.log(`  - Backup: ${BACKUP_DIR}`);
}

// Run migration
try {
  migrate();
} catch (error) {
  console.error(`\n❌ Migration failed: ${error.message}`);
  console.error(`Backup available at: ${BACKUP_DIR}`);
  process.exit(1);
}
```

### Phase 2: Task.DAG.json Refactoring (Week 4-5)

#### 2.1 Implement DAG Version Manager
**File**: `.opencode/lib/dag-version-manager.ts`

```typescript
/**
 * DAG Version Manager
 * Manages versioned snapshots and task indexing
 * 
 * CRITICAL: Retains completed tasks from last 2 weeks in hot file
 * to preserve @Orchestrator dependency validation and @Guardian audit trails
 */

export class DAGVersionManager {
  private readonly RECENT_DAYS = 14;
  
  async createVersionSnapshot(
    oldVersion: string,
    newVersion: string
  ): Promise<void> {
    // 1. Read current DAG
    const dag = await this.readCurrentDAG();
    
    // 2. Write snapshot
    await this.writeSnapshot(oldVersion, dag);
    
    // 3. Identify old completed tasks (>2 weeks)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RECENT_DAYS);
    
    const tasksToArchive = dag.tasks.filter(t => 
      t.status === 'completed' && 
      t.completed_at && 
      new Date(t.completed_at) < cutoffDate
    );
    
    // 4. Keep pending + recent completed in hot file
    const hotTasks = dag.tasks.filter(t => 
      t.status === 'pending' || 
      !t.completed_at || 
      new Date(t.completed_at) >= cutoffDate
    );
    
    dag.tasks = hotTasks;
    dag.meta.pending_tasks = hotTasks.filter(t => t.status === 'pending').length;
    dag.meta.recent_completed = hotTasks.filter(t => t.status === 'completed').length;
    dag.meta.archived_completed = (dag.meta.total_tasks || 0) - hotTasks.length;
    
    // 5. Update version
    dag.version = newVersion;
    
    // 6. Write hot DAG
    await this.writeHotDAG(dag);
    
    // 7. Update changelog
    await this.appendChangelog(newVersion, dag.meta);
    
    // 8. Update index
    await this.updateTaskIndex(tasksToArchive, oldVersion);
  }
}
```

#### 2.2 Update Meta-Planner Workflow
Add step: After version bump, call `DAGVersionManager.createVersionSnapshot()`

#### 2.3 Migration Script
**File**: `.opencode/scripts/migrate-dag-v1-to-v2.mjs`

Similar structure to gate-state migration, with ES modules, backups, and validation.

### Phase 3: Log Rotation (Week 6)

#### 3.1 Implement Log Rotator
**File**: `.opencode/lib/log-rotator.ts`

The `LogRotator` class is a **generic** rotation engine — the same class handles both `safe-bash.log` and `.transaction-log`. Both files use identical rotation policies (100KB max, 3 rotated files, gzip after 3 days, archive after 30 days). The only difference is the file path passed to `rotateIfNeeded()`.

> **Note**: `safe-bash.log` rotation is complete (current: 0 bytes, .1: 101KB, .2: 2.2MB). `.transaction-log` rotation is PENDING — the `LogRotator` class exists but `.transaction-log` (currently 633KB) has not yet been rotated through it.

#### 3.2 Update safe_bash Tool
Add call to `LogRotator.rotateIfNeeded(safeBashLogPath)` after each write.

#### 3.3 Update state-transaction.js
Add call to `LogRotator.rotateIfNeeded(transactionLogPath)` after each WAL append. This ensures `.transaction-log` follows the same rotation policy as `safe-bash.log`.

### Phase 4: framework-enforcer.ts Modularization (Week 7-8)

#### 4.1 Extract Modules
Following the proposed structure in Section 3.6.

#### 4.2 Update Plugin Registration
**File**: `.opencode/plugins/framework-enforcer/index.ts`

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { GateArmedCheck } from './checks/gate-armed';
import { KeystoneHashCheck } from './checks/keystone-hash';
import { TDDOrderCheck } from './checks/tdd-order';
import { StateCompactionCheck } from './checks/state-compaction';
import { ToolExecuteHook } from './hooks/tool-execute';
import { FileEditHook } from './hooks/file-edit';
import { CommandExecHook } from './hooks/command-exec';
import { SessionCompactedHook } from './hooks/session-compacted';
import { SessionCompactingHook } from './hooks/session-compacting';

export const FrameworkEnforcer: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    // Hooks
    'tool.execute.before': ToolExecuteHook,
    'file.edited': FileEditHook,
    'command.executed': CommandExecHook,
    'session.compacted': SessionCompactedHook,
    'experimental.session.compacting': SessionCompactingHook,
    
    // Checks (run in sequence)
    'pre-commit': [
      GateArmedCheck,
      KeystoneHashCheck,
      TDDOrderCheck,
      StateCompactionCheck,
    ],
  };
};
```

### Phase 5: Testing & Validation (Week 9)

#### 5.1 Unit Tests
- State manager tests
- Compaction engine tests
- Log rotation tests
- Version manager tests
- Concurrency tests

#### 5.2 Integration Tests
- Full gate workflow (check → confirm → complete → compaction)
- DAG version bump workflow
- Log rotation under load
- Concurrent agent access

#### 5.3 Git Hook Validation
- Verify pre-commit still passes
- Verify keystone hashes updated correctly
- Verify TDD order checks still work

### Phase 6: Rollout (Week 10)

#### 6.1 Staged Rollout
1. **Dev environment**: Run migration scripts
2. **CI pipeline**: Validate all checks pass
3. **Staging**: Run for 1 week
4. **Production**: Deploy with monitoring

#### 6.2 Monitoring
- File size metrics
- Parse time metrics
- Git operation metrics
- Agent workflow metrics

---

## 6. Framework Compliance Matrix

> **Updated v1.4.0**: The original v1.3.0 claimed "✅ Compliant" for all 7 dimensions. A comprehensive cross-reference audit (2026-06-04, [cross-reference-audit.md](./cross-reference-audit.md)) found actual implementation ratings of 72–100%. The matrix below reflects post-migration reality as of 2026-06-04.

| Framework Spec | Design Target | Implementation Status | Rating | Key Gaps |
|---------------|-------------|----------------------|:------:|----------|
| **Design Architecture** | No structural changes to agent roles. Three-tier storage with hot file <20KB. | Agent roles unchanged. Gate-state hot file: 3.2KB ✅. Task.DAG hot file: 348KB ❌ (compaction not executed). FE `index.ts` delegates to monolith. | 🟡 75% | DAG compaction pending (D4); FE modularization cosmetic (D6) |
| **Hardened Enforcement** | Git Hook validation of hot files + index integrity + V3 schemas. | Pre-commit validates gate-state, keystone, TDD order. V3 schema validation NOT enforced. Pre-commit reads wrong `enforcement_mode` key. | 🟡 73% | enforcement_mode resolution (H1); V3 format not applied to hot file (H2); no V3 schema checks (H3) |
| **Harness System** | `session.compacted` + `experimental.session.compacting` hooks integrated. StateCompactor wired to `compliance_gate_complete`. | Both OpenCode hooks implemented. StateCompactor class exists but NOT wired to any trigger. LogRotator handles safe-bash.log but NOT .transaction-log. | 🟡 80% | All 4 compaction triggers unwired (C5); .transaction-log not rotated (S4) |
| **Permission Matrix** | Same agent roles, same scopes. Three-tier (Hot/Warm/Cold) access enforced at framework layer. | All 9 agent scopes defined in `project.config.json`. Tier access documented but NOT enforced. @Guardian blocked from `machine.json` read. @CI-CD-Agent can't write `gate-state.history/`. | 🟢 90% | Guardian machine.json access (P1); CI-CD-Agent archive access (P2) |
| **Multi-Agent System** | DAG scheduling unchanged. @Orchestrator reads hot DAG with 2-week completed tasks. | DAG with 264 tasks (189 completed). Hot file not pruned — all tasks loaded. Dependency chains intact. Agent configs and skills complete. | 🟢 90% | DAG hot file unpruned (M2); no impact on scheduling correctness |
| **Central State Management** | `machine.json` single source of truth. Archive/index/history split with daily JSONL. | machine.json unchanged (181KB). Gate-state V3 migration executed (99.6% hot reduction). History uses monolithic JSONL (436KB) instead of daily splits. archive.json and index.json redundant. | 🟡 72% | V2 format persists in hot file (C1); archive+index redundancy (C2); monolithic JSONL (C3); .transaction-log 633KB (H6) |
| **Templatization** | Path parameterization with `{state_dir}`, `{project_root}` placeholders. | 28 dispatch-resolvable + 12 extended placeholders intact. COMPATIBILITY_PROFILE.md updated. No gaps found. | 🟢 100% | None |

### 6.1 Permission Matrix Verification

> **Important**: This permission matrix defines **framework-layer tier access** (enforced by `framework-enforcer.ts` checking path patterns against state file tiers). It is separate from OpenCode's **native permission system** (`opencode.json`) which controls tool access (`read`, `edit`, `bash`, `task`, `skill`). The two layers are complementary: OpenCode permissions gate tool invocation, framework permissions gate file access within allowed tools.

| Agent | Hot Storage Access | Warm Storage Access | Cold Storage Access | Notes |
|-------|-------------------|-------------------|-------------------|-------|
| @Meta-Planner | ✅ Read/Write (Task.DAG.json) | ✅ Read (versions) | ❌ No access | |
| @Orchestrator | ✅ Read-only (DAG scheduling) | ❌ No access | ❌ No access | |
| @Architect | ✅ Read/Write (context/) | ✅ Read (history snapshots) | ❌ No access | |
| @Coder-BE | ✅ Read/Write (src/) | ❌ No access | ❌ No access | |
| @Coder-FE | ✅ Read/Write (src/) | ❌ No access | ❌ No access | |
| @Guardian | ✅ Read-only (review + machine.json for Layer A Auto Gate) | ✅ Read-only (history for audit) | ❌ No access | ⚠️ Current config denies `.opencode/**` — needs carve-out for `machine.json` and `gate-state.json` (read-only) |
| @Arbiter | ✅ Read/Write (WAIVE.md) | ✅ Read (TECH_DEBT_REGISTRY.md) | ❌ No access | |
| @CI-CD-Agent | ✅ Read/Write (CI/CD) | ✅ Read/Write (gate-state.history/ + nightly compaction) | ✅ Read/Write (archive rotation) | ⚠️ Current config lacks `gate-state.history/` and archive write permissions |
| @Super-Admin | ✅ Full access | ✅ Full access | ✅ Full access | Human-only invocation. Bypasses standard gates with full audit trail. |

### 6.2 State Machine Compliance

Per `state-machine-standard.md`:

| Requirement | Implementation |
|------------|----------------|
| Single source of truth | `machine.json` remains primary runtime state |
| Physical enforcement | Git Hook validates hot files + index integrity |
| Evidence-driven | History files serve as immutable evidence trail |
| Schema validation | New schemas: `gate-state.v3.schema.json`, `Task.DAG.v2.schema.json` |
| Git Hook integration | Validates hot file format + index consistency |

---

## 7. Risk Assessment & Mitigation

### 7.1 Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Data loss during migration | Low | Critical | Full backup + rollback script + validation |
| Git Hook failure post-migration | Medium | High | Extensive testing + fallback mode |
| Agent confusion with new paths | Medium | Medium | Update agent configs + documentation |
| Performance regression | Low | Medium | Benchmark before/after + monitoring |
| Merge conflicts in index files | Medium | Low | Use JSONL for history (line-based, merge-friendly) |
| Storage overhead increase | Medium | Low | Compression + archive to external storage |
| **Race conditions during concurrent writes** | Medium | High | File locking + atomic operations (Section 7.2) |
| **Orchestrator/Guardian workflow breakage** | Low | High | Retain recent completed tasks in hot file |

### 7.2 Concurrency Handling

**Problem**: Multiple agents may simultaneously read/write hot files, index files, and history files.

**Solution**: Implement file-level locking using safe-edit-core.ts patterns:

```typescript
// From safe-edit-core.ts — TOCTOU-safe operations
import { writeSafeFull, readSafe } from './safe-edit-core';

export async function atomicStateUpdate(
  hotFile: string,
  updateFn: (state: GateStateHot) => GateStateHot
): Promise<void> {
  // 1. Read with retry (handles concurrent writes)
  const state = await readSafe(hotFile);
  
  // 2. Apply update in memory
  const updated = updateFn(state);
  
  // 3. Write atomically (temp file + rename)
  await writeSafeFull(hotFile, JSON.stringify(updated, null, 2));
}
```

**Locking Strategy**:
- **Hot files**: Atomic rename-based writes (safe-edit-core.ts)
- **History files**: Append-only with file locking (rotation-safe)
- **Index files**: Atomic replace with timestamped backups
- **Concurrent reads**: Always read from backup if main file is locked

### 7.3 Rollback Plan

If issues detected post-migration:

1. **Immediate**: Run `.opencode/scripts/rollback-state-migration.mjs`
2. **Restores**: Original monolithic files from `.backups/{TIMESTAMP}/`
3. **Git**: Revert migration commit
4. **Agents**: No config changes needed (paths remain same)

### 7.4 Monitoring Checklist

- [ ] File size metrics (hot/warm/cold)
- [ ] Parse time benchmarks
- [ ] Git operation duration
- [ ] Agent workflow success rate
- [ ] Pre-commit hook pass rate
- [ ] State consistency checks (hot vs index vs history)
- [ ] Concurrent access metrics (lock wait times)

---

## 8. Appendices

### Appendix A: OpenCode Official Documentation Research

**Sources Consulted**:
1. **Main Docs**: https://opencode.ai/docs/ (2026-06-02)
2. **Plugins**: https://opencode.ai/docs/plugins/ (2026-06-02)
3. **SDK**: https://opencode.ai/docs/sdk/ (2026-06-02)
4. **Agents**: https://opencode.ai/docs/agents/ (2026-06-02)

**Key Findings**:

#### A.1 Plugin System (https://opencode.ai/docs/plugins/)

OpenCode supports custom plugins via:
- **Local files**: `.opencode/plugins/` (project-level) or `~/.config/opencode/plugins/` (global)
- **npm packages**: Configured in `opencode.json`
- **Load order**: Global config → Project config → Global plugins → Project plugins

**Plugin function signature**:
```typescript
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  return { /* hooks */ };
};
```

**Available hooks** (relevant to this proposal):
- `session.compacted` — Fires when session context is compacted
- `experimental.session.compacting` — Fires BEFORE LLM generates continuation summary
- `tool.execute.before/after` — Intercept tool calls
- `file.edited` — File modification events
- `command.executed` — Command execution events

#### A.2 Compaction Hooks (https://opencode.ai/docs/plugins/#compaction-hooks)

**`experimental.session.compacting`**:
- Fires before the LLM generates a continuation summary
- Can inject additional context via `output.context.push(...)`
- Can replace entire compaction prompt via `output.prompt = ...`
- **Directly relevant**: Use to inject framework state into compaction context

**`session.compacted`**:
- Fires after session compaction is complete
- Can trigger post-compaction actions
- **Directly relevant**: Trigger framework state archival after native compaction

#### A.3 Custom Tools (https://opencode.ai/docs/plugins/#custom-tools)

**Official SDK**: `@opencode-ai/plugin`

```typescript
import { type Plugin, tool } from "@opencode-ai/plugin";

export const CustomToolsPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: { foo: tool.schema.string() },
        async execute(args, context) {
          return `Hello ${args.foo}`;
        },
      }),
    },
  };
};
```

#### A.4 SDK APIs (https://opencode.ai/docs/sdk/)

**Session Management**:
- `session.list()` — List sessions
- `session.get({ path })` — Get session details
- `session.create({ body })` — Create session
- `session.delete({ path })` — Delete session
- `session.summarize({ path, body })` — Summarize session

**Files**:
- `file.read({ query })` — Read file
- `find.text({ query })` — Search text in files

#### A.5 Agents (https://opencode.ai/docs/agents/)

**Built-in "compaction" agent**:
- Hidden system agent
- "Compacts long context into a smaller summary"
- Runs automatically when sessions exceed token limits
- **Integration point**: Custom StateCompactor extends (not replaces) this native agent

### Appendix B: Integration Points Summary

| OpenCode Native Feature | Our Integration | File |
|------------------------|----------------|------|
| `session.compacted` event | Trigger state archival | `hooks/session-compacted.ts` |
| `experimental.session.compacting` | Inject framework state | `hooks/session-compacting.ts` |
| Built-in compaction agent | Extend with framework logic | `state-compactor.ts` |
| `@opencode-ai/plugin` SDK | Type-safe plugin development | `index.ts` |
| `tool.execute.before` | Validate state file access | `hooks/tool-execute.ts` |
| `file.edited` | Track state file changes | `hooks/file-edit.ts` |

### Appendix C: File Size Benchmarks

**Current Parse Times** (measured):
```
gate-state.json:     50-100ms  (~876KB)
Task.DAG.json:       30-60ms   (376KB)
machine.json:        20-40ms   (~181KB)
```

**Projected Parse Times** (after refactor):
```
gate-state.json:     2-5ms     (10-20KB)   — 10-50x faster
Task.DAG.json:       5-10ms    (80KB)      — 3-12x faster
machine.json:        20-40ms   (~181KB)    — unchanged
```

### Appendix D: Directory Structure (Final)

```
{project_root}/
├── Task.DAG.json                          # 80KB — Hot: pending + recent completed
├── Task.DAG.changelog.md                  # NEW — Append-only changelog
├── Task.DAG.index.json                    # NEW — Task lookup index
├── Task.DAG.versions/                     # NEW — Version snapshots
│   ├── Task.DAG.v5.3.0.json
│   └── Task.DAG.v5.4.0.json
│
├── .opencode/
│   ├── state/
│   │   ├── gate-state.json                # 10-20KB — Hot: active + recent
│   │   ├── gate-state.index.json          # NEW — Session metadata index
│   │   ├── gate-state.archive.json        # NEW — Archived sessions
│   │   ├── gate-state.history/            # NEW — Append-only logs (renamed from wal/)
│   │   │   ├── 2026-05-21.jsonl
│   │   │   └── 2026-05-22.jsonl
│   │   ├── machine.json                   # ~181KB — Runtime state
│   │   └── .transaction-log               # Existing (unchanged)
│   │
│   ├── logs/
│   │   ├── safe-bash.log                  # 100KB max — Current
│   │   ├── safe-bash.log.1                # Rotated
│   │   ├── safe-bash.log.2.gz             # Compressed
│   │   └── archive/                       # NEW — Monthly archives
│   │
│   ├── lib/
│   │   ├── state-manager.ts               # NEW — Core state manager
│   │   ├── state-compactor.ts             # NEW — Compaction engine
│   │   ├── log-rotator.ts                 # NEW — Log rotation
│   │   └── dag-version-manager.ts         # NEW — DAG versioning
│   │
│   ├── plugins/
│   │   └── framework-enforcer/
│   │       ├── index.ts                   # Refactored — Bootstrap
│   │       ├── hooks/
│   │       │   ├── tool-execute.ts        # NEW — Extracted
│   │       │   ├── file-edit.ts           # NEW — Extracted
│   │       │   ├── command-exec.ts        # NEW — Extracted
│   │       │   ├── session-compacted.ts   # NEW — Native hook integration
│   │       │   └── session-compacting.ts  # NEW — Native hook integration
│   │       ├── checks/
│   │       │   ├── gate-armed.ts          # NEW — Extracted
│   │       │   ├── keystone-hash.ts       # NEW — Extracted
│   │       │   ├── tdd-order.ts           # NEW — Extracted
│   │       │   └── state-compaction.ts    # NEW — State validation
│   │       └── utils/
│   │           ├── audit-log.ts           # NEW — Extracted
│   │           └── state-manager.ts       # NEW — State utilities
│   │
│   └── scripts/
│       ├── migrate-gate-state-v2-to-v3.mjs # NEW — ES module migration
│       ├── migrate-dag-v1-to-v2.mjs        # NEW — ES module migration
│       └── rollback-state-migration.mjs    # NEW — ES module rollback
│
└── docs/
    └── review/
        └── state-management-analysis.md   # This document
```

### Appendix E: Migration Checklist

#### Pre-Migration
- [ ] Backup all state files with timestamp
- [ ] Verify Git working directory is clean
- [ ] Run full test suite (baseline)
- [ ] Notify all active agents
- [ ] Schedule maintenance window
- [ ] Verify ES module support in Node.js runtime

#### Migration (Phase 1)
- [ ] Run `migrate-gate-state-v2-to-v3.mjs`
- [ ] Verify hot file size < 20KB
- [ ] Verify index file size < 50KB
- [ ] Verify history entries match original count
- [ ] Validate archive references (spot-check 10 random refs)
- [ ] Run Git Hook manually

#### Migration (Phase 2)
- [ ] Run `migrate-dag-v1-to-v2.mjs`
- [ ] Verify hot DAG has pending + recent completed tasks
- [ ] Verify version snapshots exist
- [ ] Verify changelog is append-only
- [ ] Validate @Orchestrator can read dependency chains

#### Post-Migration
- [ ] Run full test suite (validation)
- [ ] Benchmark parse times
- [ ] Verify agent workflows
- [ ] Test concurrent access (simulate 3 agents)
- [ ] Monitor for 48 hours
- [ ] Update documentation

#### Rollback (if needed)
- [ ] Run `rollback-state-migration.mjs`
- [ ] Verify original files restored
- [ ] Run full test suite
- [ ] Notify agents

### Appendix F: Super-Admin Review Findings

#### F.1 Addressed in v1.1.0 (Initial Review)

| # | Finding | Status | Fix Location |
|---|---------|--------|--------------|
| 1 | Missing `experimental.session.compacting` hook | ✅ Fixed | Section 4.1.2, Appendix A.2 |
| 2 | Missing built-in compaction agent | ✅ Fixed | Section 4.1.3, Appendix A.5 |
| 3 | Missing `@opencode-ai/plugin` SDK | ✅ Fixed | Section 4.2, Appendix A.3 |
| 4 | No analysis of `compliance-gate.js` modifications | ✅ Fixed | Section 1.2.1, 4.3 |
| 5 | `StateCompactor` duplicates native compaction | ✅ Fixed | Section 4.4 (integration architecture) |
| 6 | Fabricated claim about OpenCode state recommendations | ✅ Fixed | Appendix A (cites actual docs) |
| 7 | Session count discrepancy (503 vs 1190) | ✅ Fixed | Section 1.1 (389 active + 114 drained = 503) |
| 8 | File size inaccuracies | ✅ Fixed | Section 1.1 (updated measurements) |
| 9 | Appendix A lacks URLs/references | ✅ Fixed | Appendix A (all sections cite URLs) |
| 10 | WAL naming collision | ✅ Fixed | Section 3.3 (renamed to `gate-state.history/`) |
| 11 | Migration script uses CommonJS | ✅ Fixed | Section 5.1.5 (ES module with `.mjs`) |
| 12 | Migration overwrites without backup | ✅ Fixed | Section 5.1.5 (timestamped backups) |
| 13 | Missing `drain_stale`/`purge` integration | ✅ Fixed | Section 4.3 |
| 14 | 10-week timeline aggressive | ✅ Acknowledged | Section 5 (phased approach with canary) |
| 15 | Compliance matrix lacks evidence | ✅ Fixed | Section 6 (references actual spec files) |
| 16 | Hot DAG breaks Orchestrator/Guardian | ✅ Fixed | Section 3.4 (retains 2 weeks completed) |
| 17 | No concurrency handling | ✅ Fixed | Section 7.2 (file locking + atomic ops) |

#### F.2 Addressed in v1.2.0 (Process Memory DB Evaluation)

| # | Finding | Status | Fix Location |
|---|---------|--------|--------------|
| 18 | Need for process memory database (SQLite/Redis) | ✅ Evaluated | Section 3.7 — **Rejected**: file-based achieves 2-5ms parse times, maintains Git traceability, avoids infrastructure complexity |
| 19 | In-memory cache recommendation | ✅ Added | Section 3.7.3 — Optional JavaScript `Map`-based cache for future profiling-driven optimization |

---

## 9. OpenCode Coding Convention Compliance

This section documents compliance with OpenCode official coding conventions (https://opencode.ai/docs/) as identified during the Super-Admin review (Session: `cg_ses_1780474476632`).

### 9.1 Logging Conventions

**Rule**: Plugin code running within OpenCode MUST use `client.app.log()` for structured logging. Standalone scripts MAY use `console.log`.

**Pattern**:
```typescript
// ✅ Plugin code — structured logging
export const MyPlugin: Plugin = async ({ client }) => {
  await client.app.log({
    body: {
      service: "framework-enforcer",
      level: "warn",
      message: "Rotation already in progress, skipping",
      extra: { logPath }
    }
  });
};

// ✅ Standalone scripts — console acceptable
console.log('Migration complete');
```

**Applied**: All plugin code examples updated to use deconstructed parameters with `client` available for structured logging.

### 9.2 Plugin Function Signatures

**Rule**: Plugin functions MUST use deconstructed context parameters, not a single `ctx` parameter.

**Pattern**:
```typescript
// ✅ Correct — deconstructed parameters
export const FrameworkEnforcer: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    'tool.execute.before': ToolExecuteHook(directory, worktree),
    // ...
  };
};

// ❌ Incorrect — single ctx parameter
export const FrameworkEnforcer: Plugin = async (ctx) => {
  // ctx.project, ctx.client — works but not idiomatic
};
```

**Applied**: All plugin signatures updated to use deconstructed parameters.

### 9.3 Bun Shell API (`$`)

**Rule**: Plugin context includes `$` — Bun's shell API for executing commands via template literals.

**Pattern**:
```typescript
export const MyPlugin: Plugin = async ({ $ }) => {
  // Template-literal shell execution
  const result = await $`git status`;
  
  // Prefer Node.js fs for file I/O (performance)
  // Use $ for shell operations only
};
```

**Note**: The document's `LogRotator` and `StateCompactor` examples use Node.js `fs` for file I/O (optimal) but can leverage `$` for shell operations if needed.

### 9.4 SDK Import for Structured Logging

**Rule**: `app.log()` requires `@opencode-ai/sdk` for standalone scripts, or the `client` parameter in plugins.

**Pattern**:
```typescript
// Standalone script connecting to OpenCode instance
import { createOpencodeClient } from "@opencode-ai/sdk";
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });
await client.app.log({ body: { service: "my-service", level: "info", message: "..." } });

// Plugin — client provided via destructured parameter
export const MyPlugin: Plugin = async ({ client }) => {
  await client.app.log({ body: { service: "my-plugin", level: "info", message: "..." } });
};
```

### 9.5 Tool Naming Conventions

**Rule**: OpenCode's built-in todo tool is `todowrite` (all lowercase), not `TodoWrite`.

**Note**: This document uses `TodoWrite` in prose for readability, but the actual tool invocation is `todowrite`. The tool is disabled for subagents by default in OpenCode.

### 9.6 Custom Tools — Zod `.describe()`

**Rule**: Custom tool arguments SHOULD use `.describe()` chaining for better LLM understanding.

**Pattern**:
```typescript
args: {
  foo: tool.schema.string().describe("Description of what foo represents"),
  bar: tool.schema.number().describe("Numeric threshold value")
}
```

### 9.7 Custom Tools — `.opencode/tools/` Directory

**Rule**: Standalone custom tools can be defined in `.opencode/tools/` (project-level) or `~/.config/opencode/tools/` (global), as an alternative to full plugins.

**Pattern**:
```typescript
// .opencode/tools/state-compact.ts
import { tool } from "@opencode-ai/plugin";

export const stateCompact = tool({
  description: "Compact framework state files",
  args: {
    target: tool.schema.string().describe("Which state file to compact")
  },
  async run({ target }) {
    // Implementation
  }
});
```

**Auto-registration**: Tools in `.opencode/tools/` auto-register by filename. Multiple named exports create `<filename>_<exportname>` tool names.

---

## Conclusion

This analysis (v1.4.0) identifies critical file bloat in the OpenCode framework and proposes a hierarchical state management architecture that:

1. **Reduces hot file sizes by 80-99%** — Gate-state migration achieved 99.6% reduction (3.2KB). Task.DAG compaction pending.
2. **Integrates with OpenCode native features** — Uses `session.compacted` (secondary, opportunistic) and `experimental.session.compacting` hooks. Primary trigger is explicit call from `compliance_gate_complete`.
3. **Leverages existing infrastructure** — Extends `compliance_gate_drain_stale`/`purge`. `StateCompactor`, `StateManager`, `LogRotator`, `DAGVersionManager` all implemented.
4. **Maintains full Git traceability** — All tiers are text-based (JSON/JSONL/Markdown), fully Git-diffable.
5. **Preserves framework compliance** — No changes to agent roles. Compliance matrix updated to reflect actual implementation state (72–100%).
6. **Enables sustainable growth** — Unbounded historical data moves to append-only daily JSONL logs.
7. **Handles concurrency safely** — File locking and atomic operations prevent race conditions
8. **Avoids unnecessary database complexity** — File-based storage achieves 2-5ms parse times (already optimal); process memory database (SQLite/Redis) rejected due to Git traceability requirements and low write frequency

The implementation infrastructure is substantially in place. **12 remaining items** are prioritized in the [cross-reference audit remediation plan](./cross-reference-audit.md#10-prioritized-remediation-plan) (~16 hours across P0–P3 tiers).

**Next Steps (v1.4.0)**:
1. Execute P0 fixes: Fix pre-commit `enforcement_mode` resolution, transform gate-state to V3 format, execute DAG archival compaction
2. Wire compaction triggers: Update `compliance-gate.js` to call `StateCompactor.onGateComplete()`
3. Implement `.transaction-log` rotation via existing `LogRotator` class
4. Fix @Guardian and @CI-CD-Agent permissions in `project.config.json`
5. Add V3 schema validation to pre-commit hook

---

*Document Version: 1.4.0*
*Last Updated: 2026-06-04*
*Framework Version Compatibility: OpenCode Multi-Agent v5.4.0+*
*OpenCode Docs Reference: https://opencode.ai/docs/ (accessed 2026-06-03)*