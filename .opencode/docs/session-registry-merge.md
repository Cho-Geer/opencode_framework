# session_map + session_log → session_registry + session_events (Phase 4)

> **Created**: 2026-07-05
> **Phase**: 4
> **Status**: Design document (schema change, requires shadow period)

---

## Current State

### session_map (7 rows)
| Column | Purpose |
|--------|---------|
| session_id | Gate session ID |
| agent | Agent type |
| dag_task_id | DAG task reference |
| domain_id | Domain identifier |

### session_log (0 rows)
| Column | Purpose |
|--------|---------|
| session_id | Session reference |
| event | Event type |
| timestamp | Event time |
| data | JSON event data |

## Target State

### session_registry (replaces session_map)
Latest state per session. Same columns + created_at/updated_at.

### session_events (replaces session_log)
Append-only event stream. Partitioned by session_id for efficient queries.

## Migration Plan

### Step 1: Create new tables (schema v33)
```sql
CREATE TABLE session_registry (
  session_id TEXT PRIMARY KEY,
  agent TEXT,
  dag_task_id TEXT,
  domain_id TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  event TEXT,
  timestamp INTEGER,
  data TEXT
);
CREATE INDEX idx_session_events_sid ON session_events(session_id);
```

### Step 2: Dual-write period (1 week)
- Write to both old tables (session_map, session_log) and new tables
- Read from old tables (unchanged)

### Step 3: Switch read paths
- Change all reads from session_map → session_registry
- Change all reads from session_log → session_events

### Step 4: Stop writing old tables
- Remove INSERT/UPDATE to session_map and session_log
- Keep tables (don't DROP)

## Risk Assessment
- **Schema change is irreversible** — hence the shadow period
- **Data loss risk** — dual-write mitigates this
- **Performance** — new tables have better indexes

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始合并设计 |
