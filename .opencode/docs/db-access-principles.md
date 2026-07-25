# DB Access Principles (Phase 4)

> **Created**: 2026-07-05
> **Phase**: 4

---

## Principles

1. **Read-only tools don't write DB.** If a tool only reads files, it should not trigger any DB write.

2. **Ordinary write tools: max 1 hot-path DB transaction.** A safe_edit should touch at most backup/audit in DB. Everything else goes to JSONL.

3. **Before-hooks: read-only by default.** Only safety/permission/guidance hooks may write DB. All others use in-memory config cache.

4. **After-hooks: batch, sample, async flush.** Audit writes from after-hooks can be batched and flushed asynchronously. Not every tool call needs an immediate DB write.

5. **Skill attestation: only for high-risk tasks.** Don't write skill_read_attest records for every tool call. Only when task is flagged high-risk.

6. **JSONL is the default audit store.** All append-only audit events should write to `.task_temp/_logs/audit.jsonl` instead of DB tables.

## Implementation Priority

| Priority | Action | Impact |
|----------|--------|--------|
| P0 | Stop writing Optional tables for ordinary tasks | Immediate hot-path reduction |
| P1 | Migrate read_audit writes to JSONL | Largest single table (104 rows) |
| P2 | Migrate dispatch_attempts to JSONL | Reduces Observable writes |
| P3 | Batch after-hook audit writes | Reduces DB I/O frequency |

## Current Hot-Path Write Sources

| Source | Tables Written | Phase 4 Action |
|--------|---------------|----------------|
| before/scope | backup_log | Keep (critical) |
| before/codegraph | (read-only) | No change |
| after/read-track | read_audit | Migrate to JSONL |
| after/audit | audit_log | Keep (critical) |
| after/task | dispatch_queue, session_map | Keep (critical) |
| after/gate | gate_sessions | Keep (observable) |
| after/cache | substate_kv | Keep (critical) |
| after/db-health | (read-only) | No change |

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始原则定义 |
