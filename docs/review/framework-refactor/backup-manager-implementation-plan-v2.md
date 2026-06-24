# Backup Manager Implementation Plan v2.0

**Version**: v2.0.0
**Created**: 2026-06-24
**Author**: @Super-Admin
**Status**: draft
**Supersedes**: v1.0.0 (file-based backup with DB tracking)

## 1. Overview

### 1.1 Problem

1. Backups scattered - each operation creates .opencode_backups/ in the file parent directory
2. No DB tracking - backup metadata embedded only in filenames, not queryable
3. Backups disappear on restart - OpenCode binary removes .opencode_backups/ directories during startup
4. No traceability - cannot correlate backup with agent, session, DAG task, or log entry
5. Full file copy every time - no deduplication, large files consume excessive disk space

### 1.2 Solution

Independent git repository for backup storage + DB-only backup_log table for metadata.

- Backup content stored in .task_temp/.backups/ (independent git repo, no remote)
- All metadata in SQLite backup_log table (DB-canonical, no file-based logs)
- UUID links DB records to git commits
- Git provides content-addressed storage, deduplication, and compression

### 1.3 Cleanup Policy

- TTL: 7 days only (no count cap)
- Cleanup via git log --before + git rm + git gc

## 2. Subsystem Compliance

### 2.1 Layout Architecture

- Backup root: .task_temp/.backups/ (independent git repo)
- Each backup: .task_temp/.backups/{uuid}/{original_filename}
- .task_temp/ is in .gitignore of main repo - zero conflict
- Independent repo has no remote - never pushed

### 2.2 DB-only and DB-canonical

- All metadata in SQLite backup_log table (schema v25)
- No JSON state files, no \_logs/ file entries
- writeLog() NOT used - replaced by direct DB INSERT
- DB is single source of truth

### 2.3 Permission Matrix

- backup-manager.ts is a library - does NOT enforce permissions
- Permission enforcement remains in scope-before.ts / audit-before.ts
- safe_edit and safe_delete call createBackup() AFTER permission checks pass

### 2.4 Concurrency Safe

- UUID primary key eliminates collisions
- Git index lock provides file-level concurrency safety
- SQLite transactions ensure atomic metadata insertion
- Multiple agents backing up same file creates separate UUID entries

### 2.5 Hardened Enforcement

- Backup creation mandatory before modifying/deleting
- If createBackup() fails, operation aborted (fail-closed)
- restoreBackup() uses git checkout (atomic, version-controlled)
- cleanupStaleBackups marks DB before git rm (DB-first, file-second)

### 2.6 Framework Harness

- backup-manager.ts is a lib module (not plugin, not tool, not MCP)
- Imported by safe-edit-core.ts and migration scripts
- Uses getDb() from db-manager.ts
- Uses execFileSync('git', ...) for git operations

### 2.7 Central State Management

- backup_log is a typed DB table, not a sub-state
- Schema version bump: v24 to v25 in db-manager.ts

### 2.8 Multi-Agent

- agent field records which agent triggered backup
- session_id links to session_map for identity resolution
- dag_task_id links to Task.DAG.json for task context
- dag_session_id links to dispatch session for sub-agent traceability

### 2.9 Log Central Management

- Backup events stored directly in backup_log DB table (DB-only)
- Events: BACKUP-CREATED, BACKUP-RESTORED, BACKUP-CLEANUP, BACKUP-SKIP
- UUID in DB links to git commit message for content retrieval
- Cross-reference with existing audit_log table via session_id + agent

### 2.10 DB-canonical Management

- Schema managed by db-manager.ts migration system
- Migration v25 creates backup_log table + indexes
- getDb() singleton, WAL mode

### 2.11 Templatization and Parameterization

- Uses process.env.OPENCODE_ROOT for project root
- Git repo path: {OPENCODE_ROOT}/.task_temp/.backups/
- No hardcoded project-specific paths

### 2.12 TypeScript + Bun Runtime

- Pure TypeScript ES module syntax
- Uses node:fs, node:path, node:crypto, node:child_process
- execFileSync('git', ...) - synchronous
- Bun-compatible, no transpilation

## 3. Architecture

### 3.1 Storage Layout

    .task_temp/.backups/                    <- independent git repo (no remote)
      .git/                                 <- git internal (objects, refs, etc.)
      {uuid-1}/
        {original_filename}                 <- file content at backup time
      {uuid-2}/
        {original_filename}
      ...

### 3.2 DB Schema (Migration v25)

    CREATE TABLE IF NOT EXISTS backup_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid            TEXT NOT NULL UNIQUE,
        timestamp       TEXT NOT NULL,
        event           TEXT NOT NULL,
        agent           TEXT DEFAULT 'unknown',
        session_id      TEXT,
        dag_task_id     TEXT,
        dag_session_id  TEXT,
        task_id         TEXT,
        reason          TEXT NOT NULL,
        original_file_path TEXT NOT NULL,
        backup_file_path   TEXT NOT NULL,
        git_commit      TEXT,
        file_size       INTEGER DEFAULT 0,
        file_hash       TEXT,
        cleanup_time    TEXT,
        cleanup_reason  TEXT,
        status          TEXT DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_backup_uuid ON backup_log(uuid);
    CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_log(original_file_path);
    CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_log(agent);
    CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_log(dag_task_id);
    CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_log(status);
    CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_backup_event ON backup_log(event);

### 3.3 UUID Association Chain

    backup_log DB table
        |- uuid=xxx
        |- git_commit=abc123
        |
        v
    git repo (.task_temp/.backups/)
        |- commit abc123
        |   message: "backup: uuid=xxx reason=safe_edit agent=@Coder-BE session=ses_xxx dag_task=T-014"
        |- tree: {uuid}/{filename} -> file content
        |
        v
    Existing audit_log table
        |- session_id=ses_xxx (cross-reference)
        |- agent=@Coder-BE (cross-reference)

### 3.4 Query Paths (DB-only)

| Need                   | SQL                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup detail by UUID  | SELECT \* FROM backup_log WHERE uuid = ?                                                                                                            |
| All backups by agent   | SELECT \* FROM backup_log WHERE agent = ? AND status='active' ORDER BY timestamp DESC                                                               |
| Backups by session     | SELECT \* FROM backup_log WHERE session_id = ? AND status='active'                                                                                  |
| Backups by DAG task    | SELECT \* FROM backup_log WHERE dag_task_id = ? AND status='active'                                                                                 |
| File backup history    | SELECT \* FROM backup_log WHERE original_file_path = ? ORDER BY timestamp DESC                                                                      |
| Latest backup for file | SELECT uuid, git_commit FROM backup_log WHERE original_file_path = ? AND event='BACKUP-CREATED' AND status='active' ORDER BY timestamp DESC LIMIT 1 |
| Cross-ref audit_log    | SELECT b.\*, a.event_type, a.detail FROM backup_log b JOIN audit_log a ON b.session_id = a.session_id WHERE b.uuid = ?                              |

## 4. New File: .opencode/lib/backup-manager.ts

Full TypeScript implementation with createBackup, getBackup, findLatestBackup, getBackupsByFile, getBackupsByAgent, getBackupsBySession, getBackupsByDagTask, restoreBackup, cleanupStaleBackups functions. Uses independent git repo for content storage and SQLite backup_log table for metadata. See v1.0 plan for code template - same API, replace file-based backup with git add/commit and DB INSERT.

## 5. Code Changes

### 5.1 db-manager.ts - Migration v25

Add backup_log table creation + indexes + schema_version entry.

### 5.2 safe-edit-core.ts Changes

- writeSafe L627-635: Replace inline backup with createBackup() call
- safeDelete L993-999: Replace inline backup with createBackup() call
- cleanupStaleBackups L362-438: Replace with backupManager.cleanupStaleBackups()
- safeRestore L777-788: Replace with backupManager.restoreBackup(uuid)
- backupPath L297-309: Deprecate, delegate to backup-manager
- findLatestBackup L321-329: Delegate to backupManager.findLatestBackup()

### 5.3 safe_delete.ts Tool - Pass Context

Add sessionId and dagTaskId to safeDelete options.

### 5.4 safe_edit.ts Tool - Pass Context

Add sessionId and dagTaskId to writeSafe options.

### 5.5 safe_restore.ts Tool - UUID-based

Change from path-based to UUID-based restore.

### 5.6 Migration Scripts

| Script                                   | Old                         | New                                                                                  |
| ---------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| migrate-dag-v2.ts L64                    | copyFileSync(DAG_FILE, ...) | createBackup({ filePath: DAG_FILE, reason: 'migrate_dag', agent: 'system' })         |
| migrate-gate-state-v2-to-v3.ts L75,81,87 | copyFileSync(...)           | createBackup({ filePath: ..., reason: 'migrate_gate', agent: 'system' })             |
| migrate-machine-to-substates.ts L71      | fs.copyFileSync(...)        | createBackup({ filePath: MACHINE_PATH, reason: 'migrate_machine', agent: 'system' }) |
| rollback-state-migration.ts L160-176,222 | copyFileSync(...)           | createBackup({ filePath: ..., reason: 'rollback_state', agent: 'system' })           |

### 5.7 nightly-compaction.ts - Use New Cleanup

Replace cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true) with backupManager.cleanupStaleBackups(ttlMs).

## 6. Implementation Order

1. db-manager.ts: Add migration v25 (backup_log table)
2. Create backup-manager.ts (new file)
3. safe-edit-core.ts: Replace writeSafe backup logic
4. safe-edit-core.ts: Replace safeDelete backup logic
5. safe-edit-core.ts: Replace cleanupStaleBackups
6. safe-edit-core.ts: Replace safeRestore
7. safe_delete.ts: Pass session/dag context
8. safe_edit.ts: Pass session/dag context
9. safe_restore.ts: UUID-based API
10. Migration scripts: Replace copyFileSync
11. nightly-compaction.ts: Use new cleanup
12. framework-self-test.ts: Add backup_log check
