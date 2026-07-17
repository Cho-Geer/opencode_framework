---
name: sqlite-bloat-investigation
description: Investigate SQLite database bloat — locate which tables consume the most space, trace write patterns, and identify O(n²) load-save feedback loops. Use when a SQLite file has grown far beyond expected size, when disk I/O is saturated by database writes, or when diagnosing append-only tables with no effective cleanup. Covers WSL + bun:sqlite and standard sqlite3/python3 environments.
version: 1.0.0
---

# SQLite Bloat Investigation

Standardized diagnostic flow for SQLite databases that have grown abnormally large.

## Pitfalls

- **bun:sqlite API differs by version**: Bun >= 1.2 exposes `new Bun.SQLiteDatabase(path)`. Older versions require `import { Database } from 'bun:sqlite'; new Database(path, { readonly: true })`. Always probe the API before writing queries.
- **WSL shell escaping**: Inline `bun -e "..."` with nested quotes breaks easily through `wsl bash -c`. The reliable pattern is: write a `.js` script file, copy it to `/tmp/` inside WSL, then execute with bun. Never try to escape complex JS inside bash -c.
- **SUM(LENGTH()) on NULL columns**: `LENGTH(NULL)` returns `NULL`, which makes `SUM` return `NULL`. Always wrap with `COALESCE(LENGTH(col), 0)`.
- **SQLite has no native per-table size**: Unlike PostgreSQL, there is no `pg_relation_size`. You must estimate via `SUM(LENGTH(...))` across columns, or use `page_count` delta after `ANALYZE`.
- **Read-only mode**: Always open the DB in read-only mode during investigation to avoid triggering writes or WAL growth.

## Step 1: Environment Detection & Connection

Probe available tools and establish a working query method:

```bash
# Check what's available
which sqlite3 2>/dev/null && echo "sqlite3 OK"
which bun 2>/dev/null && echo "bun OK"
python3 -c "import sqlite3; print('python3 sqlite3 OK')" 2>/dev/null
```

**If using bun in WSL**, create a script file and copy it:

```javascript
// Write this file first, then cp into WSL /tmp/
import { Database } from 'bun:sqlite';

const db = new Database(process.argv[2], { readonly: true });
// ... queries here ...
db.close();
```

```bash
# Copy and run
wsl -d Ubuntu-24.04 bash -c "cp /mnt/c/.../db_probe.js /tmp/db_probe.js && cd PROJECT_DIR && /home/USER/.bun/bin/bun /tmp/db_probe.js 2>&1"
```

**If using sqlite3 CLI**, direct queries work but be aware it may not be installed. Fall back to python3.

## Step 2: Database-Level Metrics

Collect these PRAGMA values first to understand overall state:

```sql
PRAGMA page_count;        -- total pages in DB
PRAGMA page_size;         -- bytes per page (usually 4096)
PRAGMA freelist_count;    -- reclaimable pages (fragmentation indicator)
PRAGMA journal_mode;      -- WAL vs DELETE vs TRUNCATE
PRAGMA wal_autocheckpoint;-- auto-checkpoint threshold
```

Calculate:
- **Total DB size** = page_count * page_size
- **Data size** = (page_count - freelist_count) * page_size
- **Fragmentation ratio** = freelist_count / page_count (if > 10%, VACUUM helps)
- **WAL file size**: Check `-wal` file on disk; if large, checkpoint is not running

Also check WAL file sizes on disk:
```bash
ls -lh *.db *.db-wal *.db-shm 2>/dev/null
```

## Step 3: Per-Table Size Estimation

The core diagnostic query. For each table, estimate data bytes by summing column lengths:

```javascript
// Get all tables
const tables = db.query(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();

for (const t of tables) {
  // Get column names for this table
  const cols = db.query(`PRAGMA table_info("${t.name}")`).all();
  const textCols = cols.filter(c =>
    ['TEXT','BLOB','VARCHAR','CLOB','JSON'].some(typ =>
      (c.type || '').toUpperCase().includes(typ)
    )
  );

  if (textCols.length === 0) continue;

  // Build SUM(LENGTH()) expression with COALESCE for NULL safety
  const sumExpr = textCols
    .map(c => `COALESCE(LENGTH("${c.name}"), 0)`)
    .join(' + ');

  const row = db.query(
    `SELECT COUNT(*) as cnt, SUM(${sumExpr}) as data_bytes FROM "${t.name}"`
  ).get();

  console.log(`${t.name}: ${row.cnt} rows, ${(row.data_bytes / 1024 / 1024).toFixed(2)} MB`);
}
```

Sort output by `data_bytes` descending. The top offender is your primary suspect.

**Quick sanity check**: Sum of all table data_bytes should be within 50-80% of total DB size. If much less, the rest is index overhead or fragmentation.

## Step 4: Deep-Dive the Hot Table

Once the largest table is identified:

```sql
-- Row count and time span
SELECT COUNT(*) as total_rows,
       MIN(created_at) as earliest,
       MAX(created_at) as latest
FROM hot_table;

-- Column value distribution (NULL ratio, distinct ratio)
SELECT
  COUNT(*) as total,
  COUNT(some_col) as non_null,
  COUNT(DISTINCT some_col) as distinct_vals,
  AVG(LENGTH(some_col)) as avg_len,
  MAX(LENGTH(some_col)) as max_len
FROM hot_table;

-- Sample rows (latest 5)
SELECT * FROM hot_table ORDER BY id DESC LIMIT 5;

-- Check if cleanup columns are actually used
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN cleanup_col IS NOT NULL THEN 1 ELSE 0 END) as cleaned,
  SUM(CASE WHEN cleanup_col IS NULL THEN 1 ELSE 0 END) as not_cleaned
FROM hot_table;
```

Key questions to answer:
1. Is this table append-only? (no UPDATE/DELETE in code)
2. What fraction of rows are "dead" (archived/completed/processed) but never cleaned?
3. Is there a cleanup/compaction mechanism that exists but never fires?

## Step 5: Write Pattern Tracing

Search the codebase for all write operations targeting the hot table:

```bash
# Find all INSERT/UPDATE/DELETE referencing the table
grep -rn "INSERT.*hot_table\|UPDATE.*hot_table\|DELETE.*hot_table\|REPLACE.*hot_table" \
  --include="*.ts" --include="*.js" src/ lib/

# Find all SELECT that load the full table (missing LIMIT or WHERE)
grep -rn "SELECT.*FROM.*hot_table" --include="*.ts" --include="*.js" src/ lib/

# Count callers of the save/write function
grep -c "saveFunction\|writeFunction\|insertFunction" src/lib/*.ts
```

Map the write flow:
1. What triggers the write? (function call chain)
2. How many rows per write? (single INSERT vs batch)
3. Is there deduplication before INSERT?
4. How frequently is the write called? (per-request? per-event? timer?)

## Step 6: O(n²) Loop & Stale Cleanup Detection

The most dangerous pattern: **load-save feedback loop**.

### Identifying load-save loops

Look for this pattern in the code:
```
loadAll() -> returns full array
  -> append new item to array
    -> saveAll() -> INSERT every item in array
      -> next loadAll() returns even larger array
        -> O(n^2) total writes over time
```

Red flags in code:
- `SELECT * FROM table ORDER BY id ASC` with no LIMIT or WHERE
- Save function iterates entire in-memory array doing individual INSERTs
- No `last_saved_id` cursor or watermark to skip already-saved rows
- Multiple callers (10+) of the save function across different code paths

### Checking for stale cleanup mechanisms

```sql
-- If there's a status/lifecycle column, check distribution
SELECT status, COUNT(*) as cnt,
  SUM(CASE WHEN cleanup_marker IS NULL THEN 1 ELSE 0 END) as never_cleaned
FROM hot_table
GROUP BY status;
```

If all rows have `cleanup_marker = NULL` despite a compactor existing in code, the cleanup was designed but never activated. Check:
1. Is the compactor triggered by a timer, event, or manual call?
2. Is the trigger condition ever met? (threshold too high? flag never set?)
3. Was the migration applied but the runtime logic never wired up?

## Verification `[VERIFICATION]`

> **本步骤是 `[VERIFICATION]`**--根因结论必须基于实际 sqlite3 查询输出，不是推测。记录 `Verified-by: 实际查询输出`。「schema 看起来对」不是验证。

Confirm root cause is located when:
- Top table accounts for > 70% of DB size
- Write pattern explains growth curve (e.g., O(n^2) matches quadratic file size increase)
- Cleanup mechanism is provably dormant (all cleanup columns NULL, or trigger never fires)

## Remediation Direction

Once root cause is confirmed, the fix typically needs three simultaneous changes:
1. **Read side**: Replace full-table SELECT with paginated/filtered queries (by session_id, time window, or lazy loading)
2. **Write side**: Change save from "re-insert all" to "insert only new delta" — maintain a watermark cursor or detach append-only data from the main state object
3. **Cleanup side**: Activate the dormant compactor — lower its trigger threshold, wire it to a timer, or add a periodic DELETE for rows older than N days with terminal status
