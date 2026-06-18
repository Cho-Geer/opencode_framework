# Read Audit JSONL → SQLite Migration — Knowledge Summary

**Date**: 2026-06-18
**Migration Script**: `.opencode/scripts/migrate-read-audit.ts`
**Author**: @Knowledge-Curator (via @Super-Admin dispatch)

## Purpose

Migrate read audit events from `read_audit.jsonl` (line-delimited JSON) to a SQLite table `read_audit` within `framework-state.db`. This enables efficient querying, indexing, and JOIN operations for READ-BEFORE-APPROVE enforcement and UC7KS attestation.

## Architecture

- **Phase 1 (current)**: DB-first with JSONL fallback (dual-write)
- **Phase 2 (future)**: DB-only, JSONL archived

### Files Involved

| File | Role |
|------|------|
| `.opencode/lib/db-manager.ts` | DB connection, schema v10 (read_audit table + 4 indexes) |
| `.opencode/lib/read-audit.ts` | recordRead(), verifyRead(), getReadEventsForSession() |
| `.opencode/scripts/migrate-read-audit.ts` | One-time migration script |
| `.opencode/state/read_audit.jsonl` | Source JSONL data (Phase 1 dual-write keeps it updated) |
| `.opencode/state/framework-state.db` | Target SQLite database |

## Schema (v10 — FW-READ-AUDIT-DB)

```sql
CREATE TABLE IF NOT EXISTS read_audit (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key           TEXT    NOT NULL UNIQUE,   -- SHA-256 dedup key
  timestamp           TEXT    NOT NULL,           -- ISO 8601
  agent               TEXT    NOT NULL,           -- normalized agent name
  file_path           TEXT    NOT NULL,           -- normalized absolute path
  opencode_session_id TEXT,                        -- ses_* (NOT cg_ses_*)
  task_id             TEXT,
  call_id             TEXT,
  raw_agent           TEXT,                        -- original agent value
  raw_file_path       TEXT,                        -- original file path
  created_at          INTEGER NOT NULL             -- Unix ms
);
```

Indexes:
- `idx_read_audit_lookup` — (agent, file_path, timestamp DESC)
- `idx_read_audit_session_agent` — (opencode_session_id, agent, timestamp DESC)
- `idx_read_audit_task` — (task_id, timestamp DESC)
- `idx_read_audit_created` — (created_at)

## Migration Results (2026-06-18)

| Metric | Value |
|--------|-------|
| JSONL lines | 241 |
| DB rows (before) | 238 |
| DB rows (after) | 241 |
| Imported (new) | 3 |
| Skipped (duplicate) | 238 |
| Errors | 0 |
| Norm mismatches | 0 |
| DB integrity | ✅ ok |
| Schema version | 10 |
| **Idempotency** | ✅ Verified (2nd run: 0 imported, 241 skipped) |

## Key Design Decisions

1. **event_key UNIQUE**: SHA-256(timestamp + agent + file_path + sessionId + taskId + callId) via `makeEventKey()` — enables true idempotency with `INSERT OR IGNORE`
2. **Dual-write (Phase 1)**: `recordRead()` writes to both DB and JSONL, with separate try/catch blocks — DB failure never prevents JSONL write
3. **DB-first reads with JSONL fallback**: Both `verifyRead()` and `getReadEventsForSession()` try DB first, fall back to JSONL only on DB error
4. **Transaction atomicity**: `recordRead()` uses `db.transaction()` to wrap INSERT + DELETE in a single transaction

## Related Documents

- `docs/review/framework-refactor/read-audit-db-migration-plan.md` v1.2.0
- `docs/review/framework-refactor/read-audit-db-migration-audit-report.md` (P0 audit)
- `.opencode/lib/read-audit.ts` (v2.0.0 — DB-first migration)
- `.opencode/lib/db-manager.ts` (v10 schema)
