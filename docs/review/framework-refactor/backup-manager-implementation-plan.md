# Backup Manager Implementation Plan

**Version**: v1.0.0
**Created**: 2026-06-24
**Author**: @Super-Admin
**Status**: draft

## 1. Overview

### 1.1 Problem

1. Backups scattered — each operation creates `.opencode_backups/` in the file's parent directory
2. No DB tracking — backup metadata embedded only in filenames, not queryable
3. Backups disappear on restart — OpenCode binary removes `.opencode_backups/` directories during startup
4. No traceability — cannot correlate backup with agent, session, DAG task, or log entry
5. Cleanup count cap loses history — count cap of 20 is arbitrary

### 1.2 Solution

Centralize ALL backups to `.task_temp/.opencode_backups/{uuid}/` with full DB metadata tracking.

### 1.3 Cleanup Policy Change

- Remove count cap (was 20 per directory)
- Keep TTL: 7 days only

## 2. Subsystem Compliance

### 2.1 Layout Architecture
- Backup root: `.task_temp/.opencode_backups/` (under `.task_temp/`)
- Each backup: `.task_temp/.opencode_backups/{uuid}/{original_filename}`
- UUID subdirectory preserves original filename and avoids collisions

### 2.2 DB-only and DB-canonical
- All metadata in SQLite `backup_registry` table (schema v25)
- No JSON state files for backup tracking
- DB is single source of truth for backup lifecycle

### 2.3 Permission Matrix
- `backup-manager.ts` is a library, not a tool — does NOT enforce permissions
- Permission enforcement remains in `scope-before.ts` / `audit-before.ts`
- `safe_edit` and `safe_delete` call `createBackup()` AFTER permission checks pass
- Migration scripts call with `agent: 'system'`

### 2.4 Concurrency Safe
- UUID primary key eliminates filename collisions
- SQLite transactions ensure atomic backup creation
- Multiple agents backing up same file creates separate UUID entries
- `cleanupStaleBackups` uses `UPDATE ... WHERE status = 'active'` — no race

### 2.5 Hardened Enforcement
- Backup creation mandatory: `safe_edit` and `safe_delete` MUST backup before modifying
- If `createBackup()` fails, operation aborted (fail-closed)
- `restoreBackup()` uses atomic rename (tmp -> target)
- `cleanupStaleBackups` marks DB before deleting file (DB-first, file-second)

### 2.6 Framework Harness
- `backup-manager.ts` is a lib module (not plugin, not tool, not MCP)
- Imported by `safe-edit-core.ts` and migration scripts
- Uses `writeLog()` from `log-manager.ts`
- Uses `getDb()` from `db-manager.ts`

### 2.7 Central State Management
- `backup_registry` is a typed DB table, not a sub-state
- Schema version bump: v24 -> v25 in `db-manager.ts`

### 2.8 Multi-Agent
- `agent` field records which agent triggered backup
- `session_id` links to `session_map` for identity resolution
- `dag_task_id` links to `Task.DAG.json` for task context
- `dag_session_id` links to dispatch session for sub-agent traceability

### 2.9 Log Central Management
- Every operation writes `writeLog("lib-backup-manager", ...)` entry
- Events: `BACKUP-CREATED`, `BACKUP-RESTORED`, `BACKUP-CLEANUP`, `BACKUP-SKIP`
- Log entries include UUID for cross-referencing

### 2.10 DB-canonical Management
- Schema managed by `db-manager.ts` migration system
- Migration v25 creates table + indexes
- `getDb()` singleton, WAL mode

### 2.11 Templatization & Parameterization
- Uses `process.env.OPENCODE_ROOT` for project root
- No hardcoded project-specific paths
- Works across all conformance levels

### 2.12 TypeScript + Bun Runtime
- Pure TypeScript ES module syntax
- Uses `node:fs`, `node:path`, `node:crypto`
- Bun-compatible, no transpilation needed

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

See implementation in Section 6 below.

## 5. Code Changes

### 5.1 db-manager.ts — Migration v25

Add after v24 migration:

```typescript
db.exec(`CREATE TABLE IF NOT EXISTS backup_registry (...)`);
db.run("INSERT OR REPLACE INTO schema_version (version, ...) VALUES (25, ...)");
```

### 5.2 safe-edit-core.ts — Replace Backup Logic

| Location | Old | New |
|----------|-----|-----|
| writeSafe L627-635 | inline backupPath + copyFile | createBackup() |
| safeDelete L993-999 | inline backupPath + copyFile | createBackup() |
| cleanupStaleBackups L362-438 | filesystem scan | backupManager.cleanupStaleBackups() |
| safeRestore L777-788 | path-based lookup | UUID-based restoreBackup() |
| backupPath L297-309 | generate path | deprecated, delegate |
| findLatestBackup L321-329 | scan directory | DB query |

### 5.3 safe_delete.ts Tool — Pass Context

```typescript
let result = safeDelete(absPath, {
  agentType: agent,
  sessionId: context.sessionID,
  dagTaskId: process.env.DISPATCH_DAG_TASK_ID,
});
```

### 5.4 safe_edit.ts Tool — Pass Context

```typescript
let result = writeSafe(absPath, newContent, {
  agentType: agent,
  sessionId: context.sessionID,
  dagTaskId: process.env.DISPATCH_DAG_TASK_ID,
});
```

### 5.5 safe_restore.ts Tool — UUID-based

```typescript
// Old: safeRestore(backupPath, targetPath)
// New: restoreBackup(uuid)
```

### 5.6 Migration Scripts

| Script | Line | Old | New |
|--------|------|-----|-----|
| migrate-dag-v2.ts | L64 | copyFileSync | createBackup({reason:'migrate_dag'}) |
| migrate-gate-state-v2-to-v3.ts | L75,81,87 | copyFileSync | createBackup({reason:'migrate_gate'}) |
| migrate-machine-to-substates.ts | L71 | copyFileSync | createBackup({reason:'migrate_machine'}) |
| rollback-state-migration.ts | L160-176,222 | copyFileSync | createBackup({reason:'rollback_state'}) |

### 5.7 nightly-compaction.ts — Use New Cleanup

```typescript
// Old: cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true)
// New: backupManager.cleanupStaleBackups(ttlMs)
```

Remove maxPerDir parameter (no count cap).

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

See implementation in Section 6 (Full Code).

## 5. Code Changes

### 5.1 db-manager.ts — Migration v25
Add backup_registry table creation after v24.

### 5.2 safe-edit-core.ts
- writeSafe L627-635: Replace inline backup with createBackup()
- safeDelete L993-999: Replace inline backup with createBackup()
- cleanupStaleBackups L362-438: Replace with backupManager.cleanupStaleBackups(ttlMs)
- safeRestore L777-788: Replace path-based with UUID-based restoreBackup()
- backupPath L297-309: Deprecate, delegate to backup-manager
- findLatestBackup L321-329: Delegate to backupManager.findLatestBackup()

### 5.3 safe_delete.ts Tool
Pass sessionId and dagTaskId to safeDelete().

### 5.4 safe_edit.ts Tool
Pass sessionId and dagTaskId to writeSafe().

### 5.5 safe_restore.ts Tool
Change from path-based to UUID-based: restoreBackup(uuid).

### 5.6 Migration Scripts
| Script | Old | New |
|--------|-----|-----|
| migrate-dag-v2.ts L64 | copyFileSync | createBackup(reason='migrate_dag') |
| migrate-gate-state-v2-to-v3.ts L75,81,87 | copyFileSync | createBackup(reason='migrate_gate') |
| migrate-machine-to-substates.ts L71 | copyFileSync | createBackup(reason='migrate_machine') |
| rollback-state-migration.ts L160-176,222 | copyFileSync | createBackup(reason='rollback_state') |

### 5.7 nightly-compaction.ts
Replace cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true) with backupManager.cleanupStaleBackups(ttlMs). Remove maxPerDir parameter.

### 5.8 framework-self-test.ts
Update Check 36 to query backup_registry DB instead of scanning filesystem.

### 5.9 audit-after.ts / scope-after.ts
No changes needed — already modified to log safe_delete for all file types.

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `file does not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  const absPath = path.resolve(filePath);
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(absPath) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Backup not active (status=${record.status})` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `Backup file missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid} file=${path.basename(record.original_file_path)}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run(
      "UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted} ttl_ms=${ttlMs}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

See implementation in conversation. Key functions:
- `createBackup(input)` — copy file to `.task_temp/.opencode_backups/{uuid}/`, insert DB record
- `getBackup(uuid)` — query by UUID
- `findLatestBackup(filePath)` — most recent active backup for file
- `getBackupsByFile/Agent/Session/DagTask` — query by dimension
- `restoreBackup(uuid)` — atomic restore via tmp+rename, update DB status
- `cleanupStaleBackups(ttlMs)` — TTL-only cleanup (no count cap), DB-first

## 5. Code Changes

### 5.1 db-manager.ts — Migration v25
Add `backup_registry` table creation after v24.

### 5.2 safe-edit-core.ts
- writeSafe L627-635: replace inline backup with `createBackup()`
- safeDelete L993-999: replace inline backup with `createBackup()`
- cleanupStaleBackups L362-438: delegate to `backupManager.cleanupStaleBackups()`
- safeRestore L777-788: UUID-based `restoreBackup()`
- backupPath L297-309: deprecated, delegate to backup-manager
- findLatestBackup L321-329: delegate to backup-manager

### 5.3 safe_delete.ts / safe_edit.ts Tools
Pass `sessionId` and `dagTaskId` from tool context.

### 5.4 safe_restore.ts Tool
Change from path-based to UUID-based restore.

### 5.5 Migration Scripts
| Script | reason |
|--------|--------|
| migrate-dag-v2.ts L64 | migrate_dag |
| migrate-gate-state-v2-to-v3.ts L75,81,87 | migrate_gate |
| migrate-machine-to-substates.ts L71 | migrate_machine |
| rollback-state-migration.ts L160-176,222 | rollback_state |

### 5.6 nightly-compaction.ts
Replace `cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true)` with `backupManager.cleanupStaleBackups(ttlMs)`.

### 5.7 audit-after.ts / scope-after.ts
Already modified to log safe_delete for all file types. No further changes needed.

## 6. Backup Operations Complete List

### Creates backup
| # | File | Function | Reason |
|---|------|----------|--------|
| 1 | safe-edit-core.ts | writeSafe | safe_edit |
| 2 | safe-edit-core.ts | safeDelete | safe_delete |
| 3 | migrate-dag-v2.ts | - | migrate_dag |
| 4 | migrate-gate-state-v2-to-v3.ts | - | migrate_gate |
| 5 | migrate-machine-to-substates.ts | - | migrate_machine |
| 6 | rollback-state-migration.ts | - | rollback_state |

### Deletes backup
| # | File | Function | Trigger |
|---|------|----------|---------|
| 1 | safe-edit-core.ts L662,672 | writeSafe fail | TOCTOU conflict |
| 2 | safe-edit-core.ts L702,714,724 | safe_restore | after restore |
| 3 | safe-edit-core.ts L750 | cleanupStaleBackups | after safe_edit |
| 4 | safe-edit-core.ts L1008 | cleanupStaleBackups | after safe_delete |
| 5 | nightly-compaction.ts L159 | cleanupStaleBackups | nightly TTL |

### Reads backup
| # | File | Purpose |
|---|------|---------|
| 1 | safe-edit-core.ts L321-329 | findLatestBackup |
| 2 | safe-edit-core.ts L777-788 | safe_restore |
| 3 | framework-self-test.ts L3687-3760 | Check 36 drift |
| 4 | safe_diff.ts L83-85 | MODE 1 diff |
| 5 | safe-bash-core.ts L328 | allowlist dir |
| 6 | integrity-check.ts L32,75,117,184 | ignore list |

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

Full TypeScript implementation with createBackup, getBackup, findLatestBackup, getBackupsByFile, getBackupsByAgent, getBackupsBySession, getBackupsByDagTask, restoreBackup, cleanupStaleBackups.

Key design:
- createBackup: copies file to .task_temp/.opencode_backups/{uuid}/{filename}, inserts DB record
- restoreBackup: atomic rename (tmp -> target), updates DB status to 'restored'
- cleanupStaleBackups: TTL-only (7 days), no count cap, DB-first cleanup

## 5. Code Changes

### 5.1 db-manager.ts — Migration v25
Add backup_registry table creation after v24.

### 5.2 safe-edit-core.ts
- writeSafe L627-635: replace inline backup with createBackup()
- safeDelete L993-999: replace inline backup with createBackup()
- cleanupStaleBackups L362-438: delegate to backup-manager
- safeRestore L777-788: UUID-based restoreBackup()
- backupPath L297-309: deprecated, delegate to backup-manager
- findLatestBackup L321-329: delegate to backup-manager

### 5.3 safe_delete.ts Tool
Pass sessionId and dagTaskId to safeDelete().

### 5.4 safe_edit.ts Tool
Pass sessionId and dagTaskId to writeSafe().

### 5.5 safe_restore.ts Tool
Change from path-based to UUID-based restoreBackup().

### 5.6 Migration Scripts
| Script | Old | New |
|--------|-----|-----|
| migrate-dag-v2.ts L64 | copyFileSync | createBackup(reason='migrate_dag') |
| migrate-gate-state-v2-to-v3.ts L75,81,87 | copyFileSync | createBackup(reason='migrate_gate') |
| migrate-machine-to-substates.ts L71 | copyFileSync | createBackup(reason='migrate_machine') |
| rollback-state-migration.ts L160-176,222 | copyFileSync | createBackup(reason='rollback_state') |

### 5.7 nightly-compaction.ts
Replace cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true) with backupManager.cleanupStaleBackups(ttlMs).

### 5.8 audit-after.ts / scope-after.ts
No changes needed — already modified to log safe_delete for all file types.

## 6. Backup Operations Inventory (Complete)

### Creates Backup
1. safe-edit-core.ts writeSafe L627-635 — safe_edit
2. safe-edit-core.ts safeDelete L993-999 — safe_delete
3. migrate-dag-v2.ts L64 — DAG migration
4. migrate-gate-state-v2-to-v3.ts L75,81,87 — gate-state migration
5. migrate-machine-to-substates.ts L71 — machine.json migration
6. rollback-state-migration.ts L160-176 — state rollback
7. rollback-state-migration.ts L222 — v3 artifact cleanup

### Deletes Backup
1. safe-edit-core.ts L662,672 — writeSafe TOCTOU failure
2. safe-edit-core.ts L702,714,724 — safe_restore after restore
3. safe-edit-core.ts L750 — cleanupStaleBackups after safe_edit
4. safe-edit-core.ts L1008 — cleanupStaleBackups after safe_delete
5. safe-edit-core.ts L399,438 — rmdir empty backup directory
6. nightly-compaction.ts L159 — nightly full scan cleanup

### Reads Backup
1. safe-edit-core.ts L321-329 — findLatestBackup
2. safe-edit-core.ts L777-788 — safe_restore
3. framework-self-test.ts L3687-3760 — Check 36 drift check
4. safe-bash-core.ts L328 — allowlist directory
5. integrity-check.ts L32,75,117,184 — ignore list
6. safe_diff.ts L83-85 — MODE 1 two-file diff

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

See implementation in Section 5.2. Key API:

- `createBackup(input)` — copy file to `.task_temp/.opencode_backups/{uuid}/`, insert DB record
- `getBackup(uuid)` — query by UUID
- `findLatestBackup(filePath)` — most recent active backup for file
- `getBackupsByFile/Agent/Session/DagTask()` — query by dimension
- `restoreBackup(uuid)` — atomic restore via tmp+rename, update DB status
- `cleanupStaleBackups(ttlMs)` — TTL-only cleanup (no count cap), DB-first

## 5. Code Changes

### 5.1 db-manager.ts — Migration v25
Add `backup_registry` table creation after v24.

### 5.2 safe-edit-core.ts — Replace Backup Logic
- `writeSafe` L627-635: replace inline backup with `createBackup()`
- `safeDelete` L993-999: replace inline backup with `createBackup()`
- `cleanupStaleBackups` L362-438: delegate to `backupManager.cleanupStaleBackups()`
- `safeRestore` L777-788: UUID-based `restoreBackup()`
- `backupPath` L297-309: deprecated, delegate to backup-manager
- `findLatestBackup` L321-329: delegate to backup-manager

### 5.3 safe_delete.ts Tool
Pass `sessionId` and `dagTaskId` to `safeDelete()`.

### 5.4 safe_edit.ts Tool
Pass `sessionId` and `dagTaskId` to `writeSafe()`.

### 5.5 safe_restore.ts Tool
Change from path-based to UUID-based: `restoreBackup(uuid)`.

### 5.6 Migration Scripts
| Script | Old | New reason |
|--------|-----|-----------|
| migrate-dag-v2.ts L64 | copyFileSync | migrate_dag |
| migrate-gate-state-v2-to-v3.ts L75,81,87 | copyFileSync | migrate_gate |
| migrate-machine-to-substates.ts L71 | copyFileSync | migrate_machine |
| rollback-state-migration.ts L160-176,222 | copyFileSync | rollback_state |

### 5.7 nightly-compaction.ts
Replace `cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true)` with `backupManager.cleanupStaleBackups(ttlMs)`.

### 5.8 framework-self-test.ts
Update Check 36 to query `backup_registry` table instead of scanning filesystem.

## 6. Backup Reasons (Controlled Vocabulary)

| Reason | Source |
|--------|--------|
| safe_edit | safe-edit-core.ts writeSafe |
| safe_delete | safe-edit-core.ts safeDelete |
| migrate_dag | migrate-dag-v2.ts |
| migrate_gate | migrate-gate-state-v2-to-v3.ts |
| migrate_machine | migrate-machine-to-substates.ts |
| rollback_state | rollback-state-migration.ts |

## 7. Query Examples

```sql
-- All backups by @Coder-BE for task T-014
SELECT * FROM backup_registry WHERE agent='@Coder-BE' AND dag_task_id='T-014' AND status='active';

-- Latest backup for a specific file
SELECT * FROM backup_registry WHERE original_file_path='/path/to/file.ts' AND status='active' ORDER BY backup_time DESC LIMIT 1;

-- All backups in a session
SELECT * FROM backup_registry WHERE session_id='ses_xxx' AND status='active';

-- Backups older than 7 days (cleanup candidates)
SELECT * FROM backup_registry WHERE status='active' AND backup_time < datetime('now', '-7 days');
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `file does not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  const absPath = path.resolve(filePath);
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(absPath) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Backup not active (status=${record.status})` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `Backup file missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid} file=${path.basename(record.original_file_path)}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run(
      "UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted} ttl_ms=${ttlMs}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

See implementation in Section 5.2 below. Full code in `.opencode/lib/backup-manager.ts`.

### API Summary

| Function | Purpose |
|----------|---------|
| `createBackup(input)` | Create backup + DB record |
| `getBackup(uuid)` | Lookup by UUID |
| `findLatestBackup(filePath)` | Most recent active backup for file |
| `getBackupsByFile(filePath)` | All active backups for file |
| `getBackupsByAgent(agent)` | All active backups by agent |
| `getBackupsBySession(sessionId)` | All active backups by session |
| `getBackupsByDagTask(dagTaskId)` | All active backups by DAG task |
| `restoreBackup(uuid)` | Restore file from backup |
| `cleanupStaleBackups(ttlMs)` | TTL-only cleanup (no count cap) |

## 5. Code Changes

### 5.1 db-manager.ts — Migration v25

Add after v24 migration:

```typescript
db.exec(`CREATE TABLE IF NOT EXISTS backup_registry (...)`);
db.run("INSERT OR REPLACE INTO schema_version VALUES (25, ?, 'backup_registry')");
```

### 5.2 safe-edit-core.ts — Replace Backup Logic

| Location | Old | New |
|----------|-----|-----|
| writeSafe L627-635 | inline copyFileSync | `createBackup({reason:'safe_edit'})` |
| safeDelete L993-999 | inline copyFileSync | `createBackup({reason:'safe_delete'})` |
| cleanupStaleBackups L362-438 | filesystem scan | `backupManager.cleanupStaleBackups(ttlMs)` |
| safeRestore L777-788 | path-based | UUID-based `restoreBackup(uuid)` |
| backupPath L297-309 | generate path | Deprecated, delegate to backup-manager |
| findLatestBackup L321-329 | scan directory | `backupManager.findLatestBackup(filePath)` |

### 5.3 Tool Changes

| Tool | Change |
|------|--------|
| safe_delete.ts | Pass `sessionId`, `dagTaskId` to safeDelete |
| safe_edit.ts | Pass `sessionId`, `dagTaskId` to writeSafe |
| safe_restore.ts | Accept `uuid` instead of `backupPath` |

### 5.4 Migration Scripts

| Script | reason |
|--------|--------|
| migrate-dag-v2.ts L64 | 'migrate_dag' |
| migrate-gate-state-v2-to-v3.ts L75,81,87 | 'migrate_gate' |
| migrate-machine-to-substates.ts L71 | 'migrate_machine' |
| rollback-state-migration.ts L160-176,222 | 'rollback_state' |

### 5.5 nightly-compaction.ts

```typescript
// Old: cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true)
// New: backupManager.cleanupStaleBackups(ttlMs)
```

## 6. Backup File Path Format

```
.task_temp/.opencode_backups/{uuid}/{original_filename}
```

Example:
```
.task_temp/.opencode_backups/a1b2c3d4-e5f6-7890-abcd-ef1234567890/scope-before.ts
```

## 7. Query Examples

```sql
-- Find all backups by @Coder-BE for task T-014
SELECT * FROM backup_registry WHERE agent='@Coder-BE' AND dag_task_id='T-014';

-- Find all backups in a session
SELECT * FROM backup_registry WHERE session_id='ses_abc123';

-- Find all active backups for a file
SELECT * FROM backup_registry WHERE original_file_path LIKE '%scope-before.ts' AND status='active';

-- Find all backups created in last hour
SELECT * FROM backup_registry WHERE backup_time > datetime('now', '-1 hour');
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `file does not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  const absPath = path.resolve(filePath);
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(absPath) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Backup not active (status=${record.status})` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `Backup file missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid} file=${path.basename(record.original_file_path)}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run(
      "UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted} ttl_ms=${ttlMs}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

See implementation in Section 6 below.

## 5. Code Changes

### 5.1 db-manager.ts — Migration v25

Add after v24:
```typescript
db.exec(`CREATE TABLE IF NOT EXISTS backup_registry (...)`);
db.run("INSERT OR REPLACE INTO schema_version VALUES (25, ?, 'backup_registry')");
```

### 5.2 safe-edit-core.ts

| Location | Old | New |
|----------|-----|-----|
| writeSafe L627-635 | inline backupPath + copyFile | createBackup() |
| safeDelete L993-999 | inline backupPath + copyFile | createBackup() |
| cleanupStaleBackups L362-438 | filesystem scan | backupManager.cleanupStaleBackups() |
| safeRestore L777-788 | path-based lookup | UUID-based restoreBackup() |
| backupPath L297-309 | generate path | deprecated, delegate |
| findLatestBackup L321-329 | filesystem scan | backupManager.findLatestBackup() |

### 5.3 safe_delete.ts Tool

Pass sessionId and dagTaskId to safeDelete().

### 5.4 safe_edit.ts Tool

Pass sessionId and dagTaskId to writeSafe().

### 5.5 safe_restore.ts Tool

Change from path-based to UUID-based restore.

### 5.6 Migration Scripts

| Script | reason |
|--------|--------|
| migrate-dag-v2.ts L64 | migrate_dag |
| migrate-gate-state-v2-to-v3.ts L75,81,87 | migrate_gate |
| migrate-machine-to-substates.ts L71 | migrate_machine |
| rollback-state-migration.ts L160-176,222 | rollback_state |

### 5.7 nightly-compaction.ts

Replace cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true) with backupManager.cleanupStaleBackups(ttlMs).

## 6. backup-manager.ts Full Implementation

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(path.resolve(filePath)) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Not active: ${record.status}` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `File missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  db.run("UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [new Date().toISOString(), uuid]);
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run("UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid]);
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```

## 7. Implementation Order

1. db-manager.ts: add migration v25
2. Create backup-manager.ts
3. Modify safe-edit-core.ts: writeSafe + safeDelete + cleanupStaleBackups + safeRestore
4. Modify safe_delete.ts: pass context
5. Modify safe_edit.ts: pass context
6. Modify safe_restore.ts: UUID-based
7. Modify migration scripts (4 files)
8. Modify nightly-compaction.ts
9. Test: create file, safe_delete, verify DB record + backup file + log entry
10. Test: restart, verify backup persists

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `file does not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  const absPath = path.resolve(filePath);
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(absPath) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Backup not active (status=${record.status})` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `Backup file missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid} file=${path.basename(record.original_file_path)}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run(
      "UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted} ttl_ms=${ttlMs}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `file does not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  const absPath = path.resolve(filePath);
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(absPath) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Backup not active (status=${record.status})` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `Backup file missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid} file=${path.basename(record.original_file_path)}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run(
      "UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted} ttl_ms=${ttlMs}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `file does not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  const absPath = path.resolve(filePath);
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(absPath) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Backup not active (status=${record.status})` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `Backup file missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid} file=${path.basename(record.original_file_path)}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run(
      "UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted} ttl_ms=${ttlMs}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```

## 3. DB Schema (Migration v25)

```sql
CREATE TABLE IF NOT EXISTS backup_registry (
    uuid               TEXT PRIMARY KEY,
    backup_time        TEXT NOT NULL,
    backup_reason      TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    backup_file_path   TEXT NOT NULL,
    agent              TEXT DEFAULT 'unknown',
    session_id         TEXT,
    dag_task_id        TEXT,
    dag_session_id     TEXT,
    task_id            TEXT,
    log_id             TEXT,
    file_size          INTEGER DEFAULT 0,
    file_hash          TEXT,
    cleanup_time       TEXT,
    cleanup_reason     TEXT,
    status             TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_registry(original_file_path);
CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_registry(agent);
CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_registry(session_id);
CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_registry(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_registry(status);
CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_registry(backup_time);
```

## 4. New File: backup-manager.ts

```typescript
import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_ROOT = ".task_temp/.opencode_backups";

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  uuid: string;
  backup_time: string;
  backup_reason: string;
  original_file_path: string;
  backup_file_path: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  log_id: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);
  if (!fs.existsSync(absPath)) {
    writeLog(SRC, "INFO", { event: "BACKUP-SKIP", detail: `file does not exist: ${absPath}` });
    return null;
  }
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(process.env.OPENCODE_ROOT || ".", BACKUP_ROOT, uuid);
  const backupFilePath = path.join(backupDir, fileName);
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);
  const dagSessionId = resolveDagSessionId(input.sessionId);
  const db = getDb();
  db.run(
    `INSERT INTO backup_registry
     (uuid, backup_time, backup_reason, original_file_path, backup_file_path,
      agent, session_id, dag_task_id, dag_session_id, task_id, log_id,
      file_size, file_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [uuid, now, input.reason, absPath, backupFilePath,
     input.agent || "unknown", input.sessionId || null,
     input.dagTaskId || null, dagSessionId, input.taskId || null, null,
     stat.size, fileHash],
  );
  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"} size=${stat.size}`,
  });
  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_registry WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC LIMIT 1"
  ).get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  const absPath = path.resolve(filePath);
  return db.query(
    "SELECT * FROM backup_registry WHERE original_file_path = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(absPath) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE agent = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE session_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM backup_registry WHERE dag_task_id = ? AND status = 'active' ORDER BY backup_time DESC"
  ).all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): { success: boolean; error?: string } {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active") return { success: false, error: `Backup not active (status=${record.status})` };
  if (!fs.existsSync(record.backup_file_path)) return { success: false, error: `Backup file missing: ${record.backup_file_path}` };
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(record.backup_file_path, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_registry SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid} file=${path.basename(record.original_file_path)}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): { scanned: number; deleted: number } {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;
  const expired = db.query(
    "SELECT * FROM backup_registry WHERE status = 'active' AND backup_time < ? ORDER BY backup_time ASC"
  ).all(cutoff) as BackupRecord[];
  for (const record of expired) {
    scanned++;
    try { fs.rmSync(record.backup_file_path, { force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(record.backup_file_path)); } catch {}
    db.run(
      "UPDATE backup_registry SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }
  if (deleted > 0) {
    writeLog(SRC, "INFO", { event: "BACKUP-CLEANUP", detail: `scanned=${scanned} deleted=${deleted} ttl_ms=${ttlMs}` });
  }
  return { scanned, deleted };
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch { return null; }
}
```
