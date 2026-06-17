// db-manager.ts — SQLite database connection manager (bun:sqlite)
// ═══════════════════════════════════════════════════════════════════════
// P2-A: Database migration — foundation layer.
//
// Responsibilities:
//   1. Single-instance Database connection (singleton per process)
//   2. WAL mode + busy_timeout + foreign_keys PRAGMA setup
//   3. Schema initialization (CREATE TABLE IF NOT EXISTS)
//   4. Migration entry point: JSON → DB
//   5. DB health + export helpers
//
// Design constraints:
//   - NO dependency on gate-core (gate-core is a future consumer)
//   - Only depends on log-manager (writeLog) for structured logging
//   - Synchronous API matches existing framework I/O style
//
// @author @Super-Admin
// @version 1.0.0
// @since 2026-06-16
//
// @see docs/review/framework-refactor/database-migration-plan.md (Step 0)
// ═══════════════════════════════════════════════════════════════════════

import { Database, type SQLQueryBindings } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "./log-manager";

const SRC = "lib-db-manager";

// ════════════════════════════════════════════════════════════
// PATH RESOLUTION
// ════════════════════════════════════════════════════════════

/**
 * Resolve the state directory path.
 * Mirrors gate-core.resolveStateDir to keep db-manager independent.
 */
function resolveStateDir(root?: string): string {
  const projectRoot = root || process.env.OPENCODE_ROOT || process.cwd();
  const cfgPath = path.join(projectRoot, ".opencode", "project.config.json");
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const pr = cfg.project_root;
      if (pr && pr !== ".") {
        const stateDir = path.join(projectRoot, pr, ".opencode", "state");
        if (fs.existsSync(stateDir)) return stateDir;
      }
    }
  } catch {
    // fall through
  }
  return path.join(projectRoot, ".opencode", "state");
}

export const DB_FILENAME = "framework-state.db";

export function getDbPath(root?: string): string {
  const envPath = process.env.FRAMEWORK_DB_PATH;
  if (envPath) return envPath;
  return path.join(resolveStateDir(root), DB_FILENAME);
}

// ════════════════════════════════════════════════════════════
// CONNECTION SINGLETON
// ════════════════════════════════════════════════════════════

let _db: Database | null = null;
let _dbPath: string | null = null;

export interface DbInitOptions {
  /** Project root (optional, defaults to OPENCODE_ROOT || cwd) */
  root?: string;
  /** Skip schema initialization (for testing / read-only inspection) */
  skipSchema?: boolean;
  /** Force re-open even if a connection exists */
  forceReset?: boolean;
}

/**
 * Get the singleton Database connection.
 *
 * On first call, opens the SQLite file, enables WAL + NORMAL synchronous,
 * sets busy_timeout=5000, and runs initializeSchema().
 *
 * Subsequent calls return the cached connection. Use forceReset=true to
 * close and re-open (used after VACUUM or migration).
 */
export function getDb(opts: DbInitOptions = {}): Database {
  if (_db && !opts.forceReset) return _db;

  if (_db) {
    try { _db.close(); } catch { /* already closed */ }
    _db = null;
  }

  const dbPath = getDbPath(opts.root);
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch {
    // directory already exists or cannot be created — let Database throw
  }

  try {
    _db = new Database(dbPath, { create: true });
    _dbPath = dbPath;

    // PRAGMA setup — order matters
    _db.run("PRAGMA journal_mode = WAL");
    _db.run("PRAGMA synchronous = NORMAL");
    _db.run("PRAGMA foreign_keys = ON");
    _db.run("PRAGMA busy_timeout = 5000");
    // Performance tuning for framework workloads (small rows, frequent writes)
    _db.run("PRAGMA temp_store = MEMORY");
    _db.run("PRAGMA cache_size = -4000"); // 4MB

    if (!opts.skipSchema) {
      initializeSchema(_db);
    }

    writeLog(SRC, "INFO", {
      event: "DB-INITIALIZED",
      detail: `path=${dbPath} wal=true`,
    });

    return _db;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-CONN-FAILED",
      detail: `path=${dbPath} err=${e.message}`,
    });
    throw e;
  }
}

/**
 * Close the singleton connection. Safe to call multiple times.
 * WAL+SHM files are auto-cleaned by SQLite when last connection closes.
 */
export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
    _dbPath = null;
  }
}

/**
 * Return the active database file path (if opened).
 */
export function getActiveDbPath(): string | null {
  return _dbPath;
}

// ════════════════════════════════════════════════════════════
// SCHEMA
// ════════════════════════════════════════════════════════════

/**
 * Create all schema tables. Idempotent (IF NOT EXISTS).
 * Called once at first getDb().
 *
 * Schema design: @see docs/review/framework-refactor/database-migration-plan.md §三
 */
export function initializeSchema(db: Database): void {
  // ── machine meta + contracts ──────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS machine_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS machine_contracts (
      contract_path TEXT PRIMARY KEY,
      updated_at    INTEGER NOT NULL
    )
  `);

  // ── 13 typed sub-state tables REMOVED (v7) ────────────────
  // eslint_state, write_audit_state, compliance_records,
  // knowledge_session_access, knowledge_cache_meta, tdd_enforcement_state,
  // keystone_hashes, transaction_state, knowledge_state, knowledge_audit_state,
  // type_check_state, format_state, dependency_state.
  // All sub-state I/O uses substate_kv JSON blob (dbReadSubState/dbWriteSubState).
  // These tables were never populated and had zero SQL readers.

  // ── gate_sessions (gate-state.json replacement — solves G1) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS gate_sessions (
      session_id        TEXT PRIMARY KEY,
      task_desc         TEXT NOT NULL,
      status            TEXT NOT NULL,
      agent             TEXT,
      task_id           TEXT,
      plan_summary      TEXT,
      execution_summary TEXT,
      mode              TEXT,
      checked_at        INTEGER,
      armed_at          INTEGER,
      completed_at      INTEGER,
      drained_at        INTEGER,
      created_at        INTEGER NOT NULL,
      consumed_at       INTEGER,
      expires_at        INTEGER,
      enforcement_mode  TEXT,
      last_check_passed INTEGER,
      failed_items      TEXT,
      missing_artifacts TEXT,
      fail_reason       TEXT,
      worktree          TEXT,
      audit             TEXT,
      updated_at        INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gate_status ON gate_sessions(status)`);

  // ── gate_drained_sessions (archived drained sessions) ─────
  db.run(`
    CREATE TABLE IF NOT EXISTS gate_drained_sessions (
      session_id         TEXT PRIMARY KEY,
      original_task_desc TEXT,
      drain_reason       TEXT,
      drain_type         TEXT,
      drained_at         INTEGER NOT NULL,
      original_data      TEXT
    )
  `);

  // ── gate_session_index (lightweight status index) ─────────
  db.run(`
    CREATE TABLE IF NOT EXISTS gate_session_index (
      session_id   TEXT PRIMARY KEY,
      status       TEXT NOT NULL,
      last_updated INTEGER NOT NULL
    )
  `);

  // ── gate_store_meta (formatVersion, active_sessions[], last_updated) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS gate_store_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // ── gate_audit_history (append-only audit log) ────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS gate_audit_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        TEXT NOT NULL,
      task_description  TEXT,
      plan_summary      TEXT,
      agent             TEXT,
      task_id           TEXT,
      confirmed_at      INTEGER,
      consumed_at       INTEGER,
      execution_summary TEXT,
      gate_status       TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gate_audit_session ON gate_audit_history(session_id)`);

  // ── audit_log (replaces audit_log.jsonl — solves G6) ──────
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      agent      TEXT,
      event_type TEXT NOT NULL,
      detail     TEXT,
      timestamp  INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_type)`);

  // ── audit_trail (replaces audit_trail.json — solves G7) ───
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_trail (
      session_id TEXT PRIMARY KEY,
      trail_data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // ── substate_kv (JSON blob, 1:1 mapping to SUBSTATE_FILES keys) ──
  // Guarantees backward compatibility during dual-write transition.
  // Each row stores the full JSON structure for one sub-state key.
  // Populated by db-state-manager.dbWriteSubState().
  db.run(`
    CREATE TABLE IF NOT EXISTS substate_kv (
      key        TEXT PRIMARY KEY,
      json       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // ── schema_version (for future migrations) ───────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      comment    TEXT
    )
  `);

  // Record current schema version (idempotent)
  db.run(`
    INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
    VALUES (1, ?, 'P2-A initial schema')
  `, [Date.now()]);
  db.run(`
    INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
    VALUES (2, ?, 'P2-A Step 1: add substate_kv for dual-write transition')
  `, [Date.now()]);

  // v3: Add last_full_scan column to eslint_state (INC-3 fix)
  try {
    const hasLastFullScan = db.query(
      "SELECT COUNT(*) AS c FROM pragma_table_info('eslint_state') WHERE name='last_full_scan'",
    ).get() as { c: number } | null;
    if ((hasLastFullScan?.c ?? 0) === 0) {
      db.run("ALTER TABLE eslint_state ADD COLUMN last_full_scan TEXT");
      db.run(`
        INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (3, ?, 'P2-A: add last_full_scan to eslint_state')
      `, [Date.now()]);
      writeLog(SRC, "INFO", { event: "DB-SCHEMA-MIGRATION", detail: "v3: eslint_state.last_full_scan added" });
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "DB-SCHEMA-MIGRATION-SKIPPED", detail: `v3: ${e.message}` });
  }

  // v4 (P3): file_baseline_kv for cross-process TOCTOU detection (G11)
  //       + cleanup legacy 'last_updated' row from machine_meta (G2)
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS file_baseline_kv (
        path_hash  TEXT PRIMARY KEY,
        inode      INTEGER NOT NULL,
        size       INTEGER NOT NULL,
        mtime      INTEGER NOT NULL,
        ctime      INTEGER NOT NULL,
        dev        INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        process_id INTEGER NOT NULL
      )
    `);

    // S2-2: Delete legacy snake_case 'last_updated' row from machine_meta
    // (camelCase 'lastUpdated' is the canonical field; G2 normalization)
    const legacyRow = db.query(
      "SELECT COUNT(*) AS c FROM machine_meta WHERE key = 'last_updated'",
    ).get() as { c: number } | null;
    if ((legacyRow?.c ?? 0) > 0) {
      db.run("DELETE FROM machine_meta WHERE key = 'last_updated'");
      writeLog(SRC, "INFO", { event: "DB-SCHEMA-MIGRATION", detail: "v4: removed legacy 'last_updated' from machine_meta" });
    }

    db.run(`
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (4, ?, 'P3: add file_baseline_kv (G11) + cleanup legacy last_updated (G2)')
    `, [Date.now()]);
    writeLog(SRC, "INFO", { event: "DB-SCHEMA-MIGRATION", detail: "v4: file_baseline_kv + G2 cleanup complete" });
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "DB-SCHEMA-MIGRATION-SKIPPED", detail: `v4: ${e.message}` });
  }

  // v5: Deliverables hard constraint + Orchestrator approval gate
  //     6 new columns on gate_sessions for declared/submitted deliverables tracking
  try {
    const existingCols = db.query("PRAGMA table_info(gate_sessions)").all() as Array<{ name: string }>;
    const colNames = new Set(existingCols.map(c => c.name));

    const columns: Array<[string, string]> = [
      ['declared_deliverables', 'TEXT'],
      ['submitted_deliverables', 'TEXT'],
      ['deliverables_approved_by', 'TEXT'],
      ['deliverables_approved_at', 'INTEGER'],
      ['deliverables_approval_note', 'TEXT'],
      ['approval_required', 'INTEGER DEFAULT 0'],
    ];

    for (const [col, type] of columns) {
      if (!colNames.has(col)) {
        db.run(`ALTER TABLE gate_sessions ADD COLUMN ${col} ${type}`);
      }
    }

    db.run(`
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (5, ?, 'P3: add deliverables hard constraint columns to gate_sessions')
    `, [Date.now()]);
    writeLog(SRC, "INFO", { event: "DB-SCHEMA-MIGRATION", detail: "v5: deliverables columns added to gate_sessions" });
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "DB-SCHEMA-MIGRATION-SKIPPED", detail: `v5: ${e.message}` });
  }

  // v6: Dispatch/session infrastructure DB-ification (S25 v4 + audit §15)
  //     3 new tables: session_log, dispatch_failed_log, session_map
  //     Replaces: SESSION_ID.md, .pending.json.failed, .session_map.json
  try {
    // session_log: persistent record of Task() dispatch completions
    // Replaces SESSION_ID.md files; enables resume by dagTaskId query
    db.run(`
      CREATE TABLE IF NOT EXISTS session_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT NOT NULL,
        dag_task_id  TEXT NOT NULL,
        agent_type   TEXT NOT NULL,
        run_id       TEXT,
        created_at   INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_slog_dag ON session_log(dag_task_id, created_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_slog_session ON session_log(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_slog_agent ON session_log(agent_type)`);

    // dispatch_failed_log: dead-letter archive of failed/stale dispatches
    // Replaces .pending.json.failed; two data variants unified (stale drain + Task failure)
    db.run(`
      CREATE TABLE IF NOT EXISTS dispatch_failed_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        dispatch_id  TEXT NOT NULL,
        prompt_hash  TEXT,
        file_path    TEXT,
        agent_type   TEXT NOT NULL,
        dag_task_id  TEXT,
        session_id   TEXT,
        created_at   INTEGER NOT NULL,
        failed_at    INTEGER NOT NULL,
        reason       TEXT NOT NULL,
        error_msg    TEXT
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dfl_dag ON dispatch_failed_log(dag_task_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dfl_agent ON dispatch_failed_log(agent_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dfl_reason ON dispatch_failed_log(reason)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dfl_failed_at ON dispatch_failed_log(failed_at)`);

    // session_map: session ID → agent identity mapping
    // Replaces .session_map.json; primary path for P0-4 scope enforcement
    db.run(`
      CREATE TABLE IF NOT EXISTS session_map (
        session_id   TEXT PRIMARY KEY,
        agent        TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_smap_agent ON session_map(agent)`);

    db.run(`
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (6, ?, 'S25-v4+DB: add session_log, dispatch_failed_log, session_map tables')
    `, [Date.now()]);
    writeLog(SRC, "INFO", { event: "DB-SCHEMA-MIGRATION", detail: "v6: session_log + dispatch_failed_log + session_map tables created" });
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "DB-SCHEMA-MIGRATION-SKIPPED", detail: `v6: ${e.message}` });
  }

  // v7: Drop 13 unused typed sub-state tables (never populated, zero SQL readers)
  try {
    const deadTables = [
      "eslint_state", "write_audit_state", "compliance_records",
      "knowledge_session_access", "knowledge_cache_meta", "tdd_enforcement_state",
      "keystone_hashes", "transaction_state", "knowledge_state", "knowledge_audit_state",
      "type_check_state", "format_state", "dependency_state",
    ];
    for (const t of deadTables) {
      db.run(`DROP TABLE IF EXISTS ${t}`);
    }
    db.run(`
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (7, ?, 'Drop 13 unused typed sub-state tables — substate_kv is sole storage')
    `, [Date.now()]);
    writeLog(SRC, "INFO", { event: "DB-SCHEMA-MIGRATION", detail: "v7: dropped 13 unused typed tables" });
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "DB-SCHEMA-MIGRATION-SKIPPED", detail: `v7: ${e.message}` });
  }

}

// ════════════════════════════════════════════════════════════
// HEALTH / MAINTENANCE
// ════════════════════════════════════════════════════════════

export interface DbHealthReport {
  ok: boolean;
  path: string | null;
  journal_mode: string | null;
  synchronous: number | null;
  page_count: number | null;
  page_size: number | null;
  free_pages: number | null;
  integrity: string[];
  schema_version: number | null;
  table_count: number;
  error: string | null;
}

/**
 * Run DB health diagnostics. Used by framework-doctor / framework-self-test.
 */
export function getDbHealth(root?: string): DbHealthReport {
  const report: DbHealthReport = {
    ok: false,
    path: null,
    journal_mode: null,
    synchronous: null,
    page_count: null,
    page_size: null,
    free_pages: null,
    integrity: [],
    schema_version: null,
    table_count: 0,
    error: null,
  };

  try {
    const dbPath = getDbPath(root);
    report.path = dbPath;
    if (!fs.existsSync(dbPath)) {
      report.error = `DB file not found: ${dbPath}`;
      return report;
    }

    const db = getDb({ root, skipSchema: true });
    report.journal_mode = (db.query("PRAGMA journal_mode").get() as any)?.journal_mode ?? null;
    report.synchronous = (db.query("PRAGMA synchronous").get() as any)?.synchronous ?? null;
    report.page_count = (db.query("PRAGMA page_count").get() as any)?.page_count ?? null;
    report.page_size = (db.query("PRAGMA page_size").get() as any)?.page_size ?? null;
    report.free_pages = (db.query("PRAGMA freelist_count").get() as any)?.freelist_count ?? null;

    const integrityRows = db.query("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    report.integrity = integrityRows.map((r) => r.integrity_check);

    const sv = db.query("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null } | null;
    report.schema_version = sv?.v ?? null;

    const tables = db.query(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    ).get() as { c: number } | null;
    report.table_count = tables?.c ?? 0;

    report.ok =
      report.journal_mode === "wal" &&
      report.integrity.length === 1 &&
      report.integrity[0] === "ok";
  } catch (e: any) {
    report.error = e.message;
  }

  return report;
}

/**
 * Run VACUUM to reclaim free pages. Blocks — use sparingly.
 */
export function dbVacuum(root?: string): boolean {
  try {
    const db = getDb({ root });
    db.run("VACUUM");
    writeLog(SRC, "INFO", { event: "DB-VACUUM-COMPLETE" });
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "DB-VACUUM-FAILED", detail: e.message });
    return false;
  }
}

/**
 * Delete stale audit/write-audit rows older than cutoffMs.
 * Returns number of rows deleted.
 */
export function dbCleanStaleEntries(cutoffMs: number = 7 * 24 * 3600 * 1000, root?: string): number {
  const cutoff = Date.now() - cutoffMs;
  try {
    const db = getDb({ root });
    let total = 0;
    for (const table of ["audit_log", "write_audit_state", "eslint_state", "gate_audit_history"]) {
      try {
        const res = db.run(`DELETE FROM ${table} WHERE timestamp < ?`, [cutoff]);
        total += res.changes;
      } catch {
        // Some tables have different timestamp columns; skip silently
      }
    }

    // v6 tables: session_log uses created_at, dispatch_failed_log uses failed_at
    try {
      const res1 = db.run("DELETE FROM session_log WHERE created_at < ?", [cutoff]);
      total += res1.changes;
    } catch { /* table may not exist yet */ }
    try {
      const res2 = db.run("DELETE FROM dispatch_failed_log WHERE failed_at < ?", [cutoff]);
      total += res2.changes;
    } catch { /* table may not exist yet */ }

    // session_map: 50-entry cap (keep newest by updated_at)
    try {
      const countRow = db.query("SELECT COUNT(*) AS c FROM session_map").get() as { c: number } | null;
      const count = countRow?.c ?? 0;
      if (count > 50) {
        const res3 = db.run(`
          DELETE FROM session_map WHERE session_id NOT IN (
            SELECT session_id FROM session_map ORDER BY updated_at DESC LIMIT 50
          )
        `);
        total += res3.changes;
      }
    } catch { /* table may not exist yet */ }

    writeLog(SRC, "INFO", { event: "DB-CLEAN-STALE", detail: `deleted=${total} cutoff=${cutoff}` });
    return total;
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "DB-CLEAN-FAILED", detail: e.message });
    return 0;
  }
}

// ════════════════════════════════════════════════════════════
// EXPORT / MIGRATION HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Export a table as a JSON-compatible array.
 * Used for human-readable export and cross-project migration.
 */
export function dbExportTable(table: string, root?: string): unknown[] {
  const VALID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!VALID.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  const db = getDb({ root });
  return db.query(`SELECT * FROM ${table}`).all();
}

/**
 * List all user tables in the database.
 */
export function dbListTables(root?: string): string[] {
  const db = getDb({ root });
  const rows = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Run a raw SELECT query. Used by diagnostic tools.
 * Parameters are bound as SQLQueryBindings.
 */
export function dbQuery(sql: string, params: SQLQueryBindings[] = [], root?: string): unknown[] {
  const db = getDb({ root });
  return db.query(sql).all(...params);
}

// ════════════════════════════════════════════════════════════
// PROCESS EXIT
// ════════════════════════════════════════════════════════════

function handleExit(): void {
  closeDb();
}

process.on("exit", handleExit);
process.on("SIGINT", () => { handleExit(); process.exit(0); });
process.on("SIGTERM", () => { handleExit(); process.exit(0); });
