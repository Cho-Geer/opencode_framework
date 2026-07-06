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
    try {
      _db.close();
    } catch {
      /* already closed */
    }
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
    try {
      _db.close();
    } catch {
      /* ignore */
    }
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
  // F2 (2026-06-27): Added version column for optimistic lock.
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
      updated_at        INTEGER NOT NULL,
      version           INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gate_status ON gate_sessions(status)`);
  // F2 migration: add version column to existing tables
  try { db.run(`ALTER TABLE gate_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 1`); } catch {}

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
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_gate_audit_session ON gate_audit_history(session_id)`,
  );

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
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)`,
  );
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
  db.run(
    `
    INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
    VALUES (1, ?, 'P2-A initial schema')
  `,
    [Date.now()],
  );
  db.run(
    `
    INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
    VALUES (2, ?, 'P2-A Step 1: add substate_kv for dual-write transition')
  `,
    [Date.now()],
  );

  // v3: Add last_full_scan column to eslint_state (INC-3 fix)
  try {
    const hasLastFullScan = db
      .query(
        "SELECT COUNT(*) AS c FROM pragma_table_info('eslint_state') WHERE name='last_full_scan'",
      )
      .get() as { c: number } | null;
    if ((hasLastFullScan?.c ?? 0) === 0) {
      db.run("ALTER TABLE eslint_state ADD COLUMN last_full_scan TEXT");
      db.run(
        `
        INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (3, ?, 'P2-A: add last_full_scan to eslint_state')
      `,
        [Date.now()],
      );
      writeLog(SRC, "INFO", {
        event: "DB-SCHEMA-MIGRATION",
        detail: "v3: eslint_state.last_full_scan added",
      });
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v3: ${e.message}`,
    });
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
    const legacyRow = db
      .query(
        "SELECT COUNT(*) AS c FROM machine_meta WHERE key = 'last_updated'",
      )
      .get() as { c: number } | null;
    if ((legacyRow?.c ?? 0) > 0) {
      db.run("DELETE FROM machine_meta WHERE key = 'last_updated'");
      writeLog(SRC, "INFO", {
        event: "DB-SCHEMA-MIGRATION",
        detail: "v4: removed legacy 'last_updated' from machine_meta",
      });
    }

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (4, ?, 'P3: add file_baseline_kv (G11) + cleanup legacy last_updated (G2)')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v4: file_baseline_kv + G2 cleanup complete",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v4: ${e.message}`,
    });
  }

  // v5: Deliverables hard constraint + Orchestrator approval gate
  //     6 new columns on gate_sessions for declared/submitted deliverables tracking
  try {
    const existingCols = db
      .query("PRAGMA table_info(gate_sessions)")
      .all() as Array<{ name: string }>;
    const colNames = new Set(existingCols.map((c) => c.name));

    const columns: Array<[string, string]> = [
      ["declared_deliverables", "TEXT"],
      ["submitted_deliverables", "TEXT"],
      ["deliverables_approved_by", "TEXT"],
      ["deliverables_approved_at", "INTEGER"],
      ["deliverables_approval_note", "TEXT"],
      ["approval_required", "INTEGER DEFAULT 0"],
    ];

    for (const [col, type] of columns) {
      if (!colNames.has(col)) {
        db.run(`ALTER TABLE gate_sessions ADD COLUMN ${col} ${type}`);
      }
    }

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (5, ?, 'P3: add deliverables hard constraint columns to gate_sessions')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v5: deliverables columns added to gate_sessions",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v5: ${e.message}`,
    });
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
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_slog_dag ON session_log(dag_task_id, created_at DESC)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_slog_session ON session_log(session_id)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_slog_agent ON session_log(agent_type)`,
    );

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
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_dfl_dag ON dispatch_failed_log(dag_task_id)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_dfl_agent ON dispatch_failed_log(agent_type)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_dfl_reason ON dispatch_failed_log(reason)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_dfl_failed_at ON dispatch_failed_log(failed_at)`,
    );

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

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (6, ?, 'S25-v4+DB: add session_log, dispatch_failed_log, session_map tables')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v6: session_log + dispatch_failed_log + session_map tables created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v6: ${e.message}`,
    });
  }

  // v7: Drop 13 unused typed sub-state tables (never populated, zero SQL readers)
  try {
    const deadTables = [
      "eslint_state",
      "write_audit_state",
      "compliance_records",
      "knowledge_session_access",
      "knowledge_cache_meta",
      "tdd_enforcement_state",
      "keystone_hashes",
      "transaction_state",
      "knowledge_state",
      "knowledge_audit_state",
      "type_check_state", // deprecated — but still may exist from pre-2026-06-26 runs
      "diagnostic_state", // replaces type_check_state (2026-06-26)
      "format_state",
      "dependency_state",
    ];
    for (const t of deadTables) {
      db.run(`DROP TABLE IF EXISTS ${t}`);
    }
    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (7, ?, 'Drop 13 unused typed sub-state tables — substate_kv is sole storage')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v7: dropped 13 unused typed tables",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v7: ${e.message}`,
    });
  }

  // v8: Add dag_task_id to session_map for FW-DISPATCH-TASKID-IMMUTABLE
  // Stores the dispatch-assigned dagTaskId alongside agent identity,
  // enabling MCP server to validate sub-agent task_id integrity without
  // session context (replaces shared .dispatch_ctx file which had race conditions).
  try {
    db.run(`ALTER TABLE session_map ADD COLUMN dag_task_id TEXT DEFAULT NULL`);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_smap_dag ON session_map(dag_task_id)`,
    );
    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (8, ?, 'FW-DISPATCH-TASKID-IMMUTABLE: add dag_task_id to session_map')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v8: dag_task_id column added to session_map",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v8: ${e.message}`,
    });
  }

  // v9: Add domain_id to session_map for FW-UC7KS-DOMAIN-001
  // Stores the dispatch-assigned domain_id (from knowledge_semantic_map) alongside
  // dag_task_id, enabling scope-before.ts to validate per-domain UC7KS compliance
  // without relying on the global uc7_001_compliant boolean bypass.
  try {
    db.run(`ALTER TABLE session_map ADD COLUMN domain_id TEXT DEFAULT NULL`);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_smap_domain ON session_map(domain_id)`,
    );
    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (9, ?, 'FW-UC7KS-DOMAIN-001: add domain_id to session_map for per-domain UC7KS write check')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v9: domain_id column added to session_map",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v9: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v10: FW-READ-AUDIT-DB — read_audit table for READ-BEFORE-APPROVE
  //      and UC7KS attestation. Replaces JSONL-only read_audit.jsonl
  //      with DB-first access + JSONL fallback (Phase 1 dual-write).
  //
  // event_key = sha256(timestampagentfile_pathsessiontaskcall)
  // ensures idempotent INSERT OR IGNORE across migration and runtime.
  //
  // @see docs/review/framework-refactor/read-audit-db-migration-plan.md §四
  // ════════════════════════════════════════════════════════════
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS read_audit (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key           TEXT    NOT NULL UNIQUE,
        timestamp           TEXT    NOT NULL,
        agent               TEXT    NOT NULL,
        file_path           TEXT    NOT NULL,
        opencode_session_id TEXT,
        task_id             TEXT,
        call_id             TEXT,
        raw_agent           TEXT,
        raw_file_path       TEXT,
        created_at          INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_read_audit_lookup
      ON read_audit(agent, file_path, timestamp DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_read_audit_session_agent
      ON read_audit(opencode_session_id, agent, timestamp DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_read_audit_task
      ON read_audit(task_id, timestamp DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_read_audit_created
      ON read_audit(created_at)`);
    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (10, ?, 'FW-READ-AUDIT-DB: add read_audit table for read-before-approve + UC7KS attestation')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v10: read_audit table + 4 indexes created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v10: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v11: KC-05 — Typed knowledge tables for the UC7KS pipeline.
  //      Replaces knowledge_cache_state summary-only approach
  //      with concrete, queryable typed tables that mirror
  //      index.json entries. Enables per-agent, per-domain,
  //      and per-entry knowledge tracking.
  //
  //      These are NEW tables — NOT mirrors of v7 dropped tables.
  //      Each has concrete planned writers:
  //        - knowledge_entries ← knowledge_cache_attest, backfill
  //        - knowledge_files   ← knowledge_cache_attest, backfill
  //        - knowledge_entry_tags ← knowledge_cache_attest, backfill
  //        - knowledge_session_access ← knowledge_cache_search
  //        - knowledge_discovery ← knowledge_cache_search
  //        - knowledge_attestation ← knowledge_cache_attest
  //        - knowledge_materialization_jobs ← @Knowledge-Curator
  //
  //      knowledge_cache_state kept as compatibility summary (NOT removed).
  //      v10 behavior preserved intact.
  // ════════════════════════════════════════════════════════════
  try {
    // ── knowledge_entries: one row per index.json entry ──────
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id   TEXT    NOT NULL,
        query_topic  TEXT    NOT NULL,
        domain       TEXT    NOT NULL DEFAULT 'fallback',
        tags         TEXT,
        source       TEXT,
        status       TEXT    DEFAULT 'active',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_entries_domain_status
      ON knowledge_entries(domain, status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_entries_library_topic
      ON knowledge_entries(library_id, query_topic)`);
    // UNIQUE index enables idempotent INSERT OR IGNORE in backfill
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_entries_unique
      ON knowledge_entries(library_id, query_topic)`);

    // ── knowledge_files: one row per cached file ─────────────
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_files (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id      INTEGER NOT NULL REFERENCES knowledge_entries(id),
        file_path     TEXT    NOT NULL,
        sha256        TEXT,
        size_bytes    INTEGER DEFAULT 0,
        source        TEXT,
        ttl_days      INTEGER DEFAULT 30,
        status        TEXT    DEFAULT 'active',
        access_count  INTEGER DEFAULT 0,
        last_accessed INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_files_entry_id
      ON knowledge_files(entry_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_files_sha256
      ON knowledge_files(sha256)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_files_path
      ON knowledge_files(file_path)`);
    // UNIQUE index enables idempotent INSERT OR IGNORE in backfill.
    // Wrapped in try-catch because existing duplicate rows (from
    // prior non-idempotent runs) would block the UNIQUE constraint.
    try {
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_files_unique
        ON knowledge_files(entry_id, file_path)`);
    } catch (e: any) {
      // If duplicates exist, clean them up first, then retry
      writeLog(SRC, "WARN", {
        event: "DB-SCHEMA-MIGRATION",
        detail: `v11: unique index on knowledge_files failed (${e.message}) — deduplicating`,
      });
      db.run(`
        DELETE FROM knowledge_files WHERE id NOT IN (
          SELECT MIN(id) FROM knowledge_files GROUP BY entry_id, file_path
        )
      `);
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_files_unique
        ON knowledge_files(entry_id, file_path)`);
    }

    // ── knowledge_entry_tags: normalized tags per entry ──────
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_entry_tags (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL REFERENCES knowledge_entries(id),
        tag      TEXT    NOT NULL,
        UNIQUE(entry_id, tag)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_entry_tags_tag
      ON knowledge_entry_tags(tag)`);

    // ── knowledge_session_access: per-session domain access ──
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_session_access (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        agent               TEXT    NOT NULL,
        task_id             TEXT    NOT NULL,
        domain_id           TEXT    NOT NULL,
        opencode_session_id TEXT,
        status              TEXT    DEFAULT 'discovered',
        attested_at         INTEGER,
        discovered_at       INTEGER,
        declared_at         INTEGER,
        last_read_at        INTEGER,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_session_access_agent_task_domain
      ON knowledge_session_access(agent, task_id, domain_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_session_access_session_agent
      ON knowledge_session_access(opencode_session_id, agent)`);

    // ── knowledge_discovery: cache search result records ─────
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_discovery (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT,
        agent           TEXT    NOT NULL,
        task_id         TEXT    NOT NULL,
        domain_id       TEXT    NOT NULL,
        library_id      TEXT,
        result_status   TEXT    NOT NULL,
        matched_entries INTEGER DEFAULT 0,
        created_at      INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_discovery_agent_task
      ON knowledge_discovery(agent, task_id)`);

    // ── knowledge_attestation: attestation event records ─────
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_attestation (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id            TEXT,
        agent                 TEXT    NOT NULL,
        task_id               TEXT    NOT NULL,
        domain_id             TEXT    NOT NULL,
        status                TEXT    NOT NULL,
        cache_sufficient      INTEGER DEFAULT 0,
        files_read            TEXT,
        insufficiency_reason  TEXT,
        evidence_file_count   INTEGER DEFAULT 0,
        created_at            INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_attestation_agent_task
      ON knowledge_attestation(agent, task_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_attestation_domain_status
      ON knowledge_attestation(domain_id, status)`);

    // ── knowledge_materialization_jobs: KC fetch job tracker ─
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_materialization_jobs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id     INTEGER REFERENCES knowledge_entries(id),
        job_type     TEXT    NOT NULL,
        status       TEXT    DEFAULT 'pending',
        file_path    TEXT,
        sha256       TEXT,
        error_msg    TEXT,
        retry_count  INTEGER DEFAULT 0,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_materialization_jobs_status
      ON knowledge_materialization_jobs(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_materialization_jobs_entry_id
      ON knowledge_materialization_jobs(entry_id)`);

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (11, ?, 'KC-05: add v11 typed knowledge tables (entries, files, tags, session_access, discovery, attestation, materialization_jobs)')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v11: 7 knowledge tables + indexes created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v11: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v12: KC-14 — knowledge_session_access_archive table.
  //      Retains historical session data before pruning stale
  //      entries. Mirrors knowledge_session_access schema plus
  //      archived_at (timestamp) and archived_reason (text).
  //      Controlled by config toggle
  //      knowledge.session_access_archive_enabled (default true).
  //      Idempotent: CREATE TABLE IF NOT EXISTS.
  // ════════════════════════════════════════════════════════════
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_session_access_archive (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        agent               TEXT    NOT NULL,
        task_id             TEXT    NOT NULL,
        domain_id           TEXT    NOT NULL,
        opencode_session_id TEXT,
        status              TEXT,
        attested_at         INTEGER,
        discovered_at       INTEGER,
        declared_at         INTEGER,
        last_read_at        INTEGER,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        archived_at         INTEGER NOT NULL,
        archived_reason     TEXT    NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ksaa_agent_task_domain
      ON knowledge_session_access_archive(agent, task_id, domain_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ksaa_archived_at
      ON knowledge_session_access_archive(archived_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ksaa_agent
      ON knowledge_session_access_archive(agent)`);

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (12, ?, 'KC-14: add knowledge_session_access_archive table for historical session data retention')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v12: knowledge_session_access_archive table + 3 indexes created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v12: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v13: A2 — Add unique indexes to knowledge_session_access,
  //      knowledge_discovery, knowledge_attestation tables.
  //      These UNIQUE indexes enable UPSERT (INSERT ... ON CONFLICT
  //      DO UPDATE) for idempotent knowledge pipeline operations.
  //
  //      Design decision: session_id is excluded from the unique
  //      key on knowledge_session_access because SQLite treats
  //      NULL values as distinct in UNIQUE indexes. Instead we
  //      use (agent, task_id, domain_id) which ensures one row
  //      per agent+task+domain combination. The latest session_id
  //      and timestamps are updated via UPSERT.
  //
  //      Monotonic status guard: UPSERT DO UPDATE includes
  //      WHERE status < excluded.status for monotonic progression
  //      (declared → discovered → attested).
  //
  //      Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
  //      Wrapped in try-catch per entry in case duplicates exist
  //      from prior non-idempotent INSERT OR IGNORE runs.
  // ════════════════════════════════════════════════════════════
  try {
    // knowledge_session_access: one row per agent+task+domain
    try {
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_session_access_agent_task_domain_unique
         ON knowledge_session_access(agent, task_id, domain_id)`,
      );
    } catch (dupErr: any) {
      writeLog(SRC, "WARN", {
        event: "DB-SCHEMA-MIGRATION",
        detail: `v13: unique index on knowledge_session_access failed (${dupErr.message}) — deduplicating`,
      });
      db.run(`
        DELETE FROM knowledge_session_access WHERE id NOT IN (
          SELECT MIN(id) FROM knowledge_session_access GROUP BY agent, task_id, domain_id
        )
      `);
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_session_access_agent_task_domain_unique
         ON knowledge_session_access(agent, task_id, domain_id)`,
      );
    }

    // knowledge_discovery: one row per agent+task+domain
    try {
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_discovery_agent_task_domain_unique
         ON knowledge_discovery(agent, task_id, domain_id)`,
      );
    } catch (dupErr: any) {
      writeLog(SRC, "WARN", {
        event: "DB-SCHEMA-MIGRATION",
        detail: `v13: unique index on knowledge_discovery failed (${dupErr.message}) — deduplicating`,
      });
      db.run(`
        DELETE FROM knowledge_discovery WHERE id NOT IN (
          SELECT MIN(id) FROM knowledge_discovery GROUP BY agent, task_id, domain_id
        )
      `);
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_discovery_agent_task_domain_unique
         ON knowledge_discovery(agent, task_id, domain_id)`,
      );
    }

    // knowledge_attestation: one row per agent+task+domain
    try {
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_attestation_agent_task_domain_unique
         ON knowledge_attestation(agent, task_id, domain_id)`,
      );
    } catch (dupErr: any) {
      writeLog(SRC, "WARN", {
        event: "DB-SCHEMA-MIGRATION",
        detail: `v13: unique index on knowledge_attestation failed (${dupErr.message}) — deduplicating`,
      });
      db.run(`
        DELETE FROM knowledge_attestation WHERE id NOT IN (
          SELECT MIN(id) FROM knowledge_attestation GROUP BY agent, task_id, domain_id
        )
      `);
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_attestation_agent_task_domain_unique
         ON knowledge_attestation(agent, task_id, domain_id)`,
      );
    }

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (13, ?, 'A2: add unique indexes on knowledge_session_access, knowledge_discovery, knowledge_attestation for UPSERT support')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v13: unique indexes added to knowledge_session_access + knowledge_discovery + knowledge_attestation",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v13: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v14: A8 — Gate Compactor DB-First. Adds gate_compactor_index
  //      table (authoritative for compactor index) and extends
  //      gate_audit_history with compactor_event and archive_path
  //      columns for DB-first history tracking.
  //
  //      Migration:
  //        - gate_compactor_index: per-session compactor state
  //          (active/consumed/drained/archived with timestamps)
  //        - gate_audit_history.compactor_event: hot/warm/cold/export
  //        - gate_audit_history.archive_path: path to archived JSONL
  //
  //      Design: DB is authoritative. JSON/JSONL files are export
  //      caches that can be regenerated from DB via
  //      regenerateGateFiles().
  //
  //      Idempotent: CREATE TABLE IF NOT EXISTS, ALTER TABLE with
  //      PRAGMA table_info guard, INSERT OR IGNORE schema version.
  // ════════════════════════════════════════════════════════════
  try {
    // ── gate_compactor_index: per-session compactor state ──
    db.run(`
      CREATE TABLE IF NOT EXISTS gate_compactor_index (
        session_id  TEXT PRIMARY KEY,
        status      TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        consumed_at INTEGER,
        drained_at  INTEGER,
        archive_ref TEXT,
        updated_at  INTEGER NOT NULL
      )
    `);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_gate_compactor_status
       ON gate_compactor_index(status, created_at)`,
    );

    // ── gate_audit_history: add compactor_event column ──
    const auditCols = db
      .query("PRAGMA table_info(gate_audit_history)")
      .all() as Array<{ name: string }>;
    const auditColNames = new Set(auditCols.map((c) => c.name));

    if (!auditColNames.has("compactor_event")) {
      db.run("ALTER TABLE gate_audit_history ADD COLUMN compactor_event TEXT");
    }
    if (!auditColNames.has("archive_path")) {
      db.run("ALTER TABLE gate_audit_history ADD COLUMN archive_path TEXT");
    }

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (14, ?, 'A8: add gate_compactor_index table + compactor_event/archive_path columns to gate_audit_history for DB-first gate compaction')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v14: gate_compactor_index table + gate_audit_history.compactor_event/archive_path columns created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v14: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v15: A7 — Dispatch Queue DB Canonical. Replaces file-based
  //      dispatch runtime state (.pending.json, .auto-dispatch.json,
  //      ctx/*.json, .dispatch_ctx) with 4 typed DB tables.
  //
  //      Phase 1 (dual-write): DB is primary for reads, file
  //      writes are kept as fallback for the rollout period.
  //
  //      Tables:
  //        - dispatch_queue: FIFO queue of dispatch entries with
  //          status tracking (pending/running/consumed/failed/stale)
  //          and lease-based consumer ownership
  //        - dispatch_context: per-dispatch session context linking
  //          dispatch to agent, task, and domain (replaces ctx/*.json)
  //        - dispatch_prompt_refs: generated prompt file metadata
  //          with SHA-256 hash and file path (immutable reference)
  //        - dispatch_attempts: attempt history for each dispatch
  //          with status tracking (pending/success/failed)
  //
  //      Lease design: Consumers SELECT ... WHERE status='pending'
  //      ORDER BY created_at LIMIT 1 in a transaction, then UPDATE
  //      status='running' with lease_owner (sessionID) and
  //      lease_expiry (60s TTL). On lease expiry, janitor
  //      reclaims as stale. This prevents double-consumption.
  //
  //      Idempotent: CREATE TABLE IF NOT EXISTS.
  // ════════════════════════════════════════════════════════════
  try {
    // ── dispatch_queue: FIFO dispatch entry queue ──────────────
    db.run(`
      CREATE TABLE IF NOT EXISTS dispatch_queue (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        status            TEXT NOT NULL DEFAULT 'pending',
        agent_type        TEXT NOT NULL,
        dag_task_id       TEXT NOT NULL,
        session_id        TEXT,
        prompt_ref_id     INTEGER REFERENCES dispatch_prompt_refs(id),
        lease_owner       TEXT,
        lease_expiry      INTEGER,
        dispatch_key      TEXT,
        parent_session_id TEXT,
        call_id           TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dq_status_agent_created
      ON dispatch_queue(status, agent_type, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dq_session
      ON dispatch_queue(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dq_lease_expiry
      ON dispatch_queue(lease_expiry)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dq_dag_task
      ON dispatch_queue(dag_task_id)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dq_dispatch_key
      ON dispatch_queue(dispatch_key) WHERE dispatch_key IS NOT NULL`);

    // P0-B migration: add dispatch_key, parent_session_id, call_id to existing tables
    for (const col of ["dispatch_key TEXT", "parent_session_id TEXT", "call_id TEXT"]) {
      try { db.run(`ALTER TABLE dispatch_queue ADD COLUMN ${col}`); } catch {}
    }

    // ── P1: dispatch_privilege_grants ──────────────────────────
    db.run(`
      CREATE TABLE IF NOT EXISTS dispatch_privilege_grants (
        id                 TEXT PRIMARY KEY,
        dispatch_key       TEXT NOT NULL,
        parent_session_id  TEXT NOT NULL,
        child_session_id   TEXT,
        dag_task_id        TEXT,
        agent_type         TEXT NOT NULL,
        privilege          TEXT NOT NULL,
        allowed_tools      TEXT NOT NULL,
        allowed_paths      TEXT NOT NULL,
        reason             TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'pending',
        expires_at         INTEGER NOT NULL,
        created_at         INTEGER NOT NULL,
        bound_at           INTEGER,
        consumed_at        INTEGER,
        revoked_at         INTEGER
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dispatch_privilege_child
      ON dispatch_privilege_grants(child_session_id, privilege, status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dispatch_privilege_dispatch
      ON dispatch_privilege_grants(dispatch_key, status)`);

    // ── dispatch_context: per-dispatch session context ─────────
    // Replaces per-dispatch ctx/{dagTaskId}.json files.
    // Links dispatch to agent identity, task, and knowledge domain.
    db.run(`
      CREATE TABLE IF NOT EXISTS dispatch_context (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        dispatch_id  INTEGER REFERENCES dispatch_queue(id),
        session_id   TEXT NOT NULL,
        dag_task_id  TEXT NOT NULL,
        agent_type   TEXT NOT NULL,
        domain_id    TEXT,
        opened_at    INTEGER NOT NULL,
        consumed_at  INTEGER
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dctx_session
      ON dispatch_context(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dctx_dag_task
      ON dispatch_context(dag_task_id)`);

    // ── dispatch_prompt_refs: generated prompt file metadata ───
    // Immutable reference to the dispatch .md file on disk.
    // Enables prompt hash verification without re-reading files.
    db.run(`
      CREATE TABLE IF NOT EXISTS dispatch_prompt_refs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path  TEXT NOT NULL,
        sha256     TEXT,
        size_bytes INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dpr_sha256
      ON dispatch_prompt_refs(sha256)`);

    // ── dispatch_attempts: per-dispatch attempt history ─────────
    // Records each dispatch attempt with status and optional error.
    // Enables retry tracking and failure diagnosis.
    db.run(`
      CREATE TABLE IF NOT EXISTS dispatch_attempts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        dispatch_id    INTEGER REFERENCES dispatch_queue(id),
        attempt_number INTEGER DEFAULT 1,
        status         TEXT NOT NULL,
        session_id     TEXT,
        error_msg      TEXT,
        created_at     INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_da_dispatch_attempt
      ON dispatch_attempts(dispatch_id, attempt_number)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_da_status
      ON dispatch_attempts(status)`);

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (15, ?, 'A7: add dispatch_queue, dispatch_context, dispatch_prompt_refs, dispatch_attempts tables for DB-canonical dispatch state')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v15: dispatch_queue + dispatch_context + dispatch_prompt_refs + dispatch_attempts tables created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v15: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v16: A9 — Config indexing snapshot tables for drift detection.
  //      P2-D source inversion preserved: opencode.json is the
  //      authoritative source; DB tables are snapshots/index only.
  //
  //      Tables:
  //        - permission_snapshot: agent permissions from opencode.json.
  //          Composite PK (agent_name, permission_key). Stores JSON
  //          permission values + source SHA-256 for drift detection.
  //        - agent_registry_snapshot: agent registrations from
  //          opencode.json.agent section. PK by agent_name. Stores
  //          mode, model, prompt_path, hidden status + source SHA-256.
  //        - template_resolution_snapshot: template_resolution keys
  //          from .opencode/project.config.json. PK by key. Stores
  //          values + source SHA-256 for drift detection against
  //          the authoritative source.
  //
  //      These tables are populated by:
  //        .opencode/scripts/knowledge/capture-config-snapshot.ts
  //      which idempotently snapshots the source files.
  //
  //      Idempotent: CREATE TABLE IF NOT EXISTS.
  // ════════════════════════════════════════════════════════════
  try {
    // ── permission_snapshot: agent permissions from opencode.json ──
    // One row per (agent_name, permission_key). permission_value stores
    // the JSON permission object for that key. source_sha256 is the
    // SHA-256 of the entire opencode.json file (for detecting drift
    // between snapshot and authoritative source).
    db.run(`
      CREATE TABLE IF NOT EXISTS permission_snapshot (
        agent_name       TEXT NOT NULL,
        permission_key   TEXT NOT NULL,
        permission_value TEXT NOT NULL,
        source_sha256    TEXT NOT NULL,
        captured_at      INTEGER NOT NULL,
        PRIMARY KEY (agent_name, permission_key)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_perm_snapshot_agent
      ON permission_snapshot(agent_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_perm_snapshot_captured
      ON permission_snapshot(captured_at)`);

    // ── agent_registry_snapshot: agent registrations from opencode.json ──
    // One row per registered agent. mode is the agent mode (primary/subagent/all).
    // model is the LLM model name. prompt_path is the path to the agent config markdown.
    // source_sha256 is the SHA-256 of the entire opencode.json file.
    db.run(`
      CREATE TABLE IF NOT EXISTS agent_registry_snapshot (
        agent_name   TEXT PRIMARY KEY,
        mode         TEXT NOT NULL,
        model        TEXT,
        prompt_path  TEXT NOT NULL,
        hidden       INTEGER DEFAULT 0,
        source_sha256 TEXT NOT NULL,
        captured_at  INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_agent_reg_snapshot_mode
      ON agent_registry_snapshot(mode)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_agent_reg_snapshot_captured
      ON agent_registry_snapshot(captured_at)`);

    // ── template_resolution_snapshot: template_resolution from project.config.json ──
    // One row per template_resolution key. value stores the resolved value.
    // source_sha256 is the SHA-256 of the project.config.json file.
    db.run(`
      CREATE TABLE IF NOT EXISTS template_resolution_snapshot (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        captured_at   INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_template_snapshot_captured
      ON template_resolution_snapshot(captured_at)`);

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (16, ?, 'A9: add permission_snapshot, agent_registry_snapshot, template_resolution_snapshot tables for config indexing/drift detection')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v16: permission_snapshot + agent_registry_snapshot + template_resolution_snapshot tables created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v16: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v17: READ-BEFORE-APPROVE-P1 — approval_read_context table
  //      for session-bound approval enforcement.
  //
  //      Bridges the gap between OpenCode plugin-side
  //      (gate-before.ts capturing tool.execute.before) and MCP
  //      server-side (compliance-gate.ts approve_deliverables).
  //
  //      gate_session_id + args_hash UNIQUE ensures one context
  //      per approve call — prevents concurrent serialization.
  //      consumed_at marks context as consumed (idempotency for
  //      approve → re-approve within the same session).
  //
  //      Writers:
  //        - gate-before.ts via approval-read-context.ts → recordApprovalContext()
  //      Readers:
  //        - compliance-gate.ts via approval-read-context.ts → getApprovalContext()
  //        - compliance-gate.ts via approval-read-context.ts → markApprovalContextConsumed()
  //
  //      @see docs/review/framework-refactor/read-before-approve-e2e-findings.md §8
  // ════════════════════════════════════════════════════════════
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS approval_read_context (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        gate_session_id     TEXT    NOT NULL,
        opencode_session_id TEXT    NOT NULL,
        call_id             TEXT,
        agent               TEXT,
        tool_name           TEXT    NOT NULL,
        args_hash           TEXT    NOT NULL,
        created_at          INTEGER NOT NULL,
        consumed_at         INTEGER,
        UNIQUE(gate_session_id, args_hash)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_approval_read_context_lookup
      ON approval_read_context(gate_session_id, args_hash, consumed_at, created_at DESC)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_read_context_unique
      ON approval_read_context(gate_session_id, args_hash)`);

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (17, ?, 'READ-BEFORE-APPROVE-P1: add approval_read_context for session-bound approval context bridging')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v17: approval_read_context table + indexes created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v17: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v18 — P0-CHECKLIST: Add DB-canonical execution checklist
  //   and dispatch payload integrity tables.
  //
  //   Tables:
  //   1. execution_checklist_runs — tracks checklist execution
  //      sessions per opencode session
  //   2. execution_checklist_items — individual checklist items
  //      within a run, with status and verification tracking
  //   3. execution_checklist_events — event log for checklist
  //      state transitions (audit trail)
  //   4. dispatch_payload_integrity — normalized dispatch
  //      payloads with SHA-256 integrity and completeness
  //      verification
  //
  //   Writers:
  //     - gate-before.ts (checklist enforcement)
  //     - dispatch-subagent.ts (payload integrity)
  //   Readers:
  //     - gate-before.ts (checklist status queries)
  //     - framework-enforcer.ts (dispatch audit)
  //     - framework-self-test.ts (compliance verification)
  //
  //   @see docs/review/cicd-dag-block/p0-checklist-optimization-plan.md
  // ════════════════════════════════════════════════════════════
  try {
    // 1. execution_checklist_runs
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_checklist_runs (
        run_id              TEXT PRIMARY KEY,
        opencode_session_id TEXT NOT NULL,
        parent_session_id   TEXT,
        task_id             TEXT,
        agent               TEXT NOT NULL,
        domain_id           TEXT,
        worktree            TEXT,
        phase               TEXT NOT NULL,
        status              TEXT NOT NULL,
        task_payload_hash   TEXT,
        payload_ref         TEXT,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        completed_at        INTEGER
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ecr_session
      ON execution_checklist_runs(opencode_session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ecr_task
      ON execution_checklist_runs(task_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ecr_agent_status
      ON execution_checklist_runs(agent, status)`);

    // 2. execution_checklist_items
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_checklist_items (
        item_id       TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL REFERENCES execution_checklist_runs(run_id),
        item_key      TEXT NOT NULL,
        phase         TEXT NOT NULL,
        required_when TEXT NOT NULL,
        status        TEXT NOT NULL,
        blocking      INTEGER NOT NULL DEFAULT 1,
        verifier      TEXT NOT NULL,
        evidence_ref  TEXT,
        fail_reason   TEXT,
        remediation   TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        UNIQUE(run_id, item_key)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_eci_run_status
      ON execution_checklist_items(run_id, status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_eci_item
      ON execution_checklist_items(item_key)`);

    // 3. execution_checklist_events
    db.run(`
      CREATE TABLE IF NOT EXISTS execution_checklist_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id       TEXT NOT NULL,
        item_id      TEXT,
        event_type   TEXT NOT NULL,
        actor        TEXT,
        tool_name    TEXT,
        old_status   TEXT,
        new_status   TEXT,
        evidence_ref TEXT,
        message      TEXT,
        created_at   INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ece_run_created
      ON execution_checklist_events(run_id, created_at)`);

    // 4. dispatch_payload_integrity
    db.run(`
      CREATE TABLE IF NOT EXISTS dispatch_payload_integrity (
        payload_id          TEXT PRIMARY KEY,
        dispatch_ref_id     TEXT,
        parent_session_id   TEXT,
        agent_type          TEXT NOT NULL,
        dag_task_id         TEXT,
        task_description    TEXT NOT NULL,
        normalized_payload  TEXT NOT NULL,
        sha256              TEXT NOT NULL,
        completeness_status TEXT NOT NULL,
        completeness_error  TEXT,
        prompt_path         TEXT,
        created_at          INTEGER NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dpi_session
      ON dispatch_payload_integrity(parent_session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dpi_task
      ON dispatch_payload_integrity(dag_task_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dpi_status
      ON dispatch_payload_integrity(completeness_status)`);

    // Schema version record
    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (18, ?, 'P0-CHECKLIST: add DB-canonical execution checklist and dispatch payload integrity tables')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v18: execution_checklist_runs/items/events + dispatch_payload_integrity tables + indexes created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v18: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v19 — UC7KS Pipeline DB-Canonical
  //   Replaces substate_kv JSON blob + knowledge_discovery +
  //   knowledge_attestation row tables with a single unified table.
  //
  //   Table: uc7ks_pipeline_state
  //   Unique key: (pipeline_id, agent, domain_id)
  //   Concurrency: SQLite UNIQUE + UPSERT (row-level lock)
  //
  //   Writers:
  //     - knowledge_cache_search.ts (discovery phase)
  //     - knowledge_cache_attest.ts (attestation phase)
  //   Readers:
  //     - knowledge_cache_attest.ts (read discovery for verification)
  //     - uc7ks-utils.ts checkUC7KSWrite (write gate)
  //     - framework-self-test.ts (compliance verification)
  //
  //   @see docs/review/framework-refactor/uc7ks-pipeline-db-canonical-design.md
  // ════════════════════════════════════════════════════════════
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS uc7ks_pipeline_state (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,

        -- ── 复合唯一键（并发隔离边界）──
        pipeline_id             TEXT NOT NULL,
        agent                   TEXT NOT NULL,
        domain_id               TEXT NOT NULL,

        -- ── 会话关联 ──
        session_id              TEXT,
        dag_task_id             TEXT,

        -- ── 发现阶段（knowledge_cache_search 写入）──
        discovery_status        TEXT DEFAULT 'undeclared',
        discovered_files        TEXT DEFAULT '[]',
        discovered_count        INTEGER DEFAULT 0,
        missing_topics          TEXT DEFAULT '[]',
        discovered_at           INTEGER,

        -- ── 验证阶段（knowledge_cache_attest 写入）──
        attestation_status      TEXT DEFAULT 'unattested',
        cache_sufficient        INTEGER DEFAULT 0,
        files_read              TEXT DEFAULT '[]',
        evidence_file_count     INTEGER DEFAULT 0,
        content_summary         TEXT DEFAULT '',
        attested_at             INTEGER,

        -- ── 元数据 ──
        created_at              INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
        updated_at              INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),

        UNIQUE(pipeline_id, agent, domain_id)
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_agent
      ON uc7ks_pipeline_state(agent)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_session
      ON uc7ks_pipeline_state(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_domain
      ON uc7ks_pipeline_state(domain_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_attestation
      ON uc7ks_pipeline_state(attestation_status, domain_id)
      WHERE attestation_status != 'unattested'`);

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (19, ?, 'UC7KS Pipeline DB-Canonical: uc7ks_pipeline_state table (replaces JSON blob + knowledge_discovery + knowledge_attestation)')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v19: uc7ks_pipeline_state table + indexes created (DB-canonical UC7KS pipeline)",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v19: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v20 — Phase 3 Cleanup: Drop legacy knowledge tables.
  //   Replaced by uc7ks_pipeline_state (v19).
  //   Tables dropped:
  //     - knowledge_session_access (v11)
  //     - knowledge_discovery (v11)
  //     - knowledge_attestation (v11)
  //   (knowledge_session_access_archive and knowledge_entries remain)
  // ════════════════════════════════════════════════════════════
  try {
    db.run(`DROP TABLE IF EXISTS knowledge_session_access`);
    db.run(`DROP TABLE IF EXISTS knowledge_discovery`);
    db.run(`DROP TABLE IF EXISTS knowledge_attestation`);
    db.run(
      `INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
       VALUES (20, ?, 'Phase 3 Cleanup: drop knowledge_session_access/knowledge_discovery/knowledge_attestation — replaced by uc7ks_pipeline_state (v19)')`,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v20: dropped legacy knowledge tables (replaced by uc7ks_pipeline_state)",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v20: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v21: V7.2-FIX — Add opencode_session_id to gate_sessions.
  //      Fixes bug where compliance-gate calls checklistWirePassed()
  //      with gateSessionId (cg_ses_*) instead of OpenCode session ID
  //      (ses_*), causing gate facts to be written to the wrong
  //      checklist run — the run keyed by cg_ses_* is never read
  //      by any agent.
  //
  //      Design: Column is nullable TEXT — backward compatible.
  //      When NULL, checklistWirePassed falls back to gateSessionId
  //      with a WARNING log.
  // ════════════════════════════════════════════════════════════
  try {
    const gateCols = db
      .query("PRAGMA table_info(gate_sessions)")
      .all() as Array<{ name: string }>;
    const gateColNames = new Set(gateCols.map((c) => c.name));

    if (!gateColNames.has("opencode_session_id")) {
      db.run(
        "ALTER TABLE gate_sessions ADD COLUMN opencode_session_id TEXT DEFAULT NULL",
      );
    }

    db.run(
      `
      INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
        VALUES (21, ?, 'V7.2-FIX: add opencode_session_id to gate_sessions for correct checklist run wiring')
    `,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v21: opencode_session_id column added to gate_sessions",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v21: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v22 — OPT-09 (2026-06-23): UC7KS pipeline index optimization.
  //   Adds covering indexes for high-frequency query patterns:
  //   1. idx_uc7ks_agent_domain: (agent, domain_id) — used by
  //      uc7ks-utils.ts to check attestation status by agent+domain.
  //   2. idx_uc7ks_dag_task: (dag_task_id) WHERE NOT NULL —
  //      used by resolvePipelineId to find pipeline rows by dagTaskId.
  //   Existing UNIQUE(pipeline_id, agent, domain_id) remains as PK.
  // ════════════════════════════════════════════════════════════
  try {
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_uc7ks_agent_domain ON uc7ks_pipeline_state(agent, domain_id)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_uc7ks_dag_task ON uc7ks_pipeline_state(dag_task_id) WHERE dag_task_id IS NOT NULL`,
    );
    db.run(
      `INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
       VALUES (22, ?, 'OPT-09: UC7KS pipeline index optimization — idx_uc7ks_agent_domain + idx_uc7ks_dag_task (partial)')`,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v22: UC7KS pipeline covering indexes added",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v22: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v23 — OPT-06 (2026-06-24): DROP dispatch_context table.
  //   dispatch_context was a write-only table (dbInsertDispatchContext
  //   inserted rows but no code ever SELECTed from it). session_map DB
  //   is the canonical source for dispatch context. The call to
  //   dbInsertDispatchContext was removed from task-after.ts.
  // ════════════════════════════════════════════════════════════
  try {
    db.run(`DROP TABLE IF EXISTS dispatch_context`);
    db.run(
      `INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
       VALUES (23, ?, 'OPT-06: DROP dispatch_context table — write-only dead table, session_map is canonical')`,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v23: dispatch_context table dropped (OPT-06)",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v23: ${e.message}`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // v24 — FW-SESSION-MODEL-IDENTITY (2026-06-24): Add model_id to session_map.
  //   Stores the LLM model identifier (e.g. "deepseek/deepseek-v4-pro")
  //   alongside the session agent mapping. Enables round-start agent/model
  //   identification logging and audit trail of which model served each
  //   conversation round.
  //
  //   Populated by session.ts chatMessageHook at every chat.message event.
  //   Model resolved from opencode.json agent configuration.
  //
  //   Subsystems: Log Central Management, DB-canonical, Central State Mgmt,
  //               Multi-Agent, Framework Harness
  // ════════════════════════════════════════════════════════════
  try {
    db.run(`ALTER TABLE session_map ADD COLUMN model_id TEXT DEFAULT NULL`);
    db.run(
      `INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
       VALUES (24, ?, 'FW-SESSION-MODEL-IDENTITY: add model_id to session_map')`,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v24: model_id column added to session_map",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v24: ${e.message}`,
    });
  }

  // ============================================================
  // v25 - BACKUP-MANAGER (2026-06-24): backup_log table.
  // FIX: Use db.run() per statement (not db.exec with multi-statement).
  // bun:sqlite db.exec() silently fails on multi-statement CREATE.
  // Each statement must be executed individually via db.run().
  // ============================================================
  try {
    db.run(`
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
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_backup_uuid ON backup_log(uuid)");
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_backup_file ON backup_log(original_file_path)",
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_backup_agent ON backup_log(agent)");
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_backup_session ON backup_log(session_id)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_backup_dag ON backup_log(dag_task_id)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_log(status)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_backup_time ON backup_log(timestamp)",
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_backup_event ON backup_log(event)");
    db.run(
      "INSERT OR IGNORE INTO schema_version (version, applied_at, comment) VALUES (25, ?, 'BACKUP-MANAGER: backup_log table (db.run fix)')",
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail:
        "v25: backup_log table + indexes created (db.run per-statement fix)",
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SCHEMA-MIGRATION-FAILED",
      detail: `v25 backup_log creation failed: ${e.message}`,
    });
  }

  // v26: TSC Diagnostic Gate v2 — tsc_gate_locks + tsc_gate_events tables
  // tsc_gate_locks: file-level write locks + tsc run mutex
  // tsc_gate_events: structured audit events from tsc-diag-track.ts
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS tsc_gate_locks (
        file_path  TEXT NOT NULL,
        session_id TEXT NOT NULL,
        locked_at  INTEGER NOT NULL,
        lock_type  TEXT NOT NULL DEFAULT 'file_write',
        PRIMARY KEY (file_path)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tsc_gate_events (
        event_id    TEXT PRIMARY KEY,
        session_id  TEXT,
        file_path   TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        error_count INTEGER DEFAULT 0,
        elapsed_ms  INTEGER,
        detail      TEXT,
        created_at  INTEGER NOT NULL
      )
    `);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_tge_session ON tsc_gate_events(session_id)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_tge_file ON tsc_gate_events(file_path)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_tge_type ON tsc_gate_events(event_type)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_tge_created ON tsc_gate_events(created_at)`,
    );
    db.run(
      `INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
       VALUES (26, ?, 'v26: tsc_gate_locks + tsc_gate_events tables — TSC Diagnostic Gate v2')`,
      [Date.now()],
    );
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v26: tsc_gate_locks + tsc_gate_events tables created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v26: ${e.message}`,
    });
  }

  // ── v27: session_map parent_id ──
  try {
    db.run(`ALTER TABLE session_map ADD COLUMN parent_id TEXT DEFAULT ''`);
    db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (27, ?, 'v27: parent_id column added to session_map — FW-SESSION-PARENT-ID')`,
      [Date.now()]);
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v27: session_map parent_id added",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v27: ${e.message}`,
    });
  }

  // ── v28: notifications + notification_readers ──
  try {
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent TEXT NOT NULL DEFAULT '',
      dag_task_id TEXT DEFAULT '',
      event_type TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS notification_readers (
      reader_id TEXT NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (reader_id)
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_notif_session ON notifications(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at)`);
    db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (28, ?, 'v28: notifications + notification_readers tables')`,
      [Date.now()]);
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v28: notifications + notification_readers tables created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v28: ${e.message}`,
    });
  }

  // ── v29: tool_enforcement table — anti-bypass v2 ──
  try {
    db.run(`CREATE TABLE IF NOT EXISTS tool_enforcement (
      session_id TEXT PRIMARY KEY,
      agent TEXT NOT NULL DEFAULT '',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      total_failures INTEGER NOT NULL DEFAULT 0,
      last_failure_tool TEXT DEFAULT '',
      last_failure_type TEXT DEFAULT '',
      last_failure_error TEXT DEFAULT '',
      last_failure_at INTEGER NOT NULL DEFAULT 0,
      last_before_at INTEGER NOT NULL DEFAULT 0,
      last_after_at INTEGER NOT NULL DEFAULT 0,
      stop_injected INTEGER NOT NULL DEFAULT 0,
      total_blocks INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_te_agent ON tool_enforcement(agent)`);
    db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (29, ?, 'v29: tool_enforcement table — anti-bypass v2 全工具覆盖')`,
      [Date.now()]);
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v29: tool_enforcement table created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v29: ${e.message}`,
    });
  }

  // ── v30: compliance tracking — orphan before-hook detection ──
  try {
    db.run(`ALTER TABLE tool_enforcement ADD COLUMN compliance_blocks INTEGER NOT NULL DEFAULT 0`);
    db.run(`ALTER TABLE tool_enforcement ADD COLUMN last_before_at INTEGER NOT NULL DEFAULT 0`);
    db.run(`ALTER TABLE tool_enforcement ADD COLUMN last_after_at INTEGER NOT NULL DEFAULT 0`);
    db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (30, ?, 'v30: compliance tracking — orphan before-hook detection')`,
      [Date.now()]);
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v30: compliance_blocks + last_before_at + last_after_at added",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v30: ${e.message}`,
    });
  }

  // ── v31: two-phase guidance gate ──
  try {
    db.run(`ALTER TABLE tool_enforcement ADD COLUMN awaiting_guidance INTEGER NOT NULL DEFAULT 0`);
    db.run(`ALTER TABLE tool_enforcement ADD COLUMN guidance_token TEXT DEFAULT ''`);
    db.run(`ALTER TABLE tool_enforcement ADD COLUMN guidance_requested_at INTEGER NOT NULL DEFAULT 0`);
    db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (31, ?, 'v31: two-phase guidance gate (awaiting_guidance + token + requested_at)')`,
      [Date.now()]);
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v31: awaiting_guidance + guidance_token + guidance_requested_at added",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v31: ${e.message}`,
    });
  }

  // ── v32: soft_rejections table — per-tool rejection tracking ──
  try {
    db.run(`CREATE TABLE IF NOT EXISTS soft_rejections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      rejection_count INTEGER NOT NULL DEFAULT 1,
      first_rejection_at INTEGER NOT NULL,
      last_rejection_at INTEGER NOT NULL,
      last_error TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(session_id, tool_name)
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sr_session ON soft_rejections(session_id)`);
    db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (32, ?, 'v32: soft_rejections table for tool rejection tracking')`,
      [Date.now()]);
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v32: soft_rejections table added",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v32: ${e.message}`,
    });
  }

  // ── v33: Phase 4 Minimal State — session_registry + session_events + tool_guidance_state ──
  try {
    // session_registry: merges session_map state + parent session tracking + Phase 5 alias metadata
    db.run(`CREATE TABLE IF NOT EXISTS session_registry (
      session_id        TEXT PRIMARY KEY,
      parent_session_id TEXT DEFAULT NULL,
      agent             TEXT NOT NULL DEFAULT 'pending',
      agent_alias       TEXT DEFAULT NULL,
      native_executor   TEXT DEFAULT NULL,
      dag_task_id       TEXT DEFAULT NULL,
      domain_id         TEXT DEFAULT NULL,
      model_id          TEXT DEFAULT NULL,
      status            TEXT DEFAULT 'active',
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sreg_agent ON session_registry(agent)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sreg_parent ON session_registry(parent_session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sreg_status ON session_registry(status)`);

    // session_events: append-only event log (merges session_log + dispatch trace)
    db.run(`CREATE TABLE IF NOT EXISTS session_events (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        TEXT NOT NULL,
      parent_session_id TEXT DEFAULT NULL,
      event_type        TEXT NOT NULL,
      dag_task_id       TEXT DEFAULT NULL,
      agent_type        TEXT NOT NULL DEFAULT '',
      agent_alias       TEXT DEFAULT NULL,
      native_executor   TEXT DEFAULT NULL,
      loaded_skills     TEXT DEFAULT NULL,
      run_id            TEXT DEFAULT NULL,
      payload           TEXT DEFAULT NULL,
      created_at        INTEGER NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sevt_session ON session_events(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sevt_dag ON session_events(dag_task_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sevt_type ON session_events(event_type)`);

    // tool_guidance_state: merges tool_enforcement runtime fields + soft_rejections
    // (Phase 3 added failure_count/guidance_required/tool_rejections columns to tool_enforcement;
    //  this table provides a clean consolidated schema for future use)
    db.run(`CREATE TABLE IF NOT EXISTS tool_guidance_state (
      session_id            TEXT PRIMARY KEY,
      agent                 TEXT NOT NULL DEFAULT '',
      failure_count         INTEGER NOT NULL DEFAULT 0,
      last_failure          TEXT DEFAULT '',
      guidance_required     INTEGER NOT NULL DEFAULT 0,
      tool_rejections       TEXT DEFAULT '',
      last_failure_at       INTEGER NOT NULL DEFAULT 0,
      stop_injected         INTEGER NOT NULL DEFAULT 0,
      awaiting_guidance     INTEGER NOT NULL DEFAULT 0,
      guidance_token        TEXT DEFAULT '',
      guidance_text         TEXT DEFAULT '',
      guidance_requested_at INTEGER NOT NULL DEFAULT 0,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_tgs_agent ON tool_guidance_state(agent)`);

    db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
      VALUES (33, ?, 'v33: Phase 4 Minimal State — session_registry + session_events + tool_guidance_state')`,
      [Date.now()]);
    writeLog(SRC, "INFO", {
      event: "DB-SCHEMA-MIGRATION",
      detail: "v33: session_registry + session_events + tool_guidance_state tables created",
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SCHEMA-MIGRATION-SKIPPED",
      detail: `v33: ${e.message}`,
    });
  }
}

// ════════════════════════════════════════════════════════════
// v11 BACKFILL — Populate typed knowledge tables from
//   docs/official_docs/index.json. Idempotent (INSERT OR IGNORE).
//
//   Reads the knowledge manifest and inserts each entry into
//   knowledge_entries, knowledge_files, and knowledge_entry_tags.
//   Designed to be called once after schema migration, safe to
//   call multiple times.
// ════════════════════════════════════════════════════════════

// (F2: duplicate removed)
export function backfillKnowledgeFromManifest(root?: string): {
  entriesInserted: number;
  filesInserted: number;
  tagsInserted: number;
} {
  // Initialize schema first (includes v11 tables), then backfill
  const db = getDb({ root });
  const entriesInserted = { count: 0 };
  const filesInserted = { count: 0 };
  const tagsInserted = { count: 0 };

  // Read index.json manifest
  const indexPath = path.join(
    root || process.env.OPENCODE_ROOT || process.cwd(),
    "docs",
    "official_docs",
    "index.json",
  );

  if (!fs.existsSync(indexPath)) {
    writeLog(SRC, "WARN", {
      event: "KC-BACKFILL-NO-MANIFEST",
      detail: `Manifest not found at ${indexPath}`,
    });
    return { entriesInserted: 0, filesInserted: 0, tagsInserted: 0 };
  }

  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-BACKFILL-PARSE-FAILED",
      detail: `Manifest parse error: ${e.message}`,
    });
    return { entriesInserted: 0, filesInserted: 0, tagsInserted: 0 };
  }

  const entries = manifest.entries || [];
  const now = Date.now();

  const insertEntry = db.prepare(`
    INSERT OR IGNORE INTO knowledge_entries
      (library_id, query_topic, domain, tags, source, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFile = db.prepare(`
    INSERT OR IGNORE INTO knowledge_files
      (entry_id, file_path, sha256, size_bytes, source, ttl_days, status,
       access_count, last_accessed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag) VALUES (?, ?)
  `);

  const insertRoute = db.transaction((manifestEntries: any[]) => {
    for (const entry of manifestEntries) {
      const tags = entry.tags || [];
      const entryFiles = entry.files || [];
      const source =
        entryFiles.length > 0 ? entryFiles[0].source : entry.source || null;
      const createdMs = entry.last_updated
        ? new Date(entry.last_updated).getTime()
        : entryFiles.length > 0 && entryFiles[0].created_at
          ? new Date(entryFiles[0].created_at).getTime()
          : now;

      const result = insertEntry.run(
        entry.library_id || "unknown",
        entry.query_topic || "untitled",
        entry.domain || "fallback",
        JSON.stringify(tags),
        source || null,
        entry.status || "active",
        createdMs,
        now,
      );

      if (result.changes > 0) {
        entriesInserted.count++;
      }

      // Get entry_id (newly inserted or existing)
      const entryRow = db
        .query(
          "SELECT id FROM knowledge_entries WHERE library_id = ? AND query_topic = ?",
        )
        .get(entry.library_id, entry.query_topic) as { id: number } | null;

      if (!entryRow) continue;
      const entryId = entryRow.id;

      // Insert files
      for (const file of entryFiles) {
        const fileCreated = file.created_at
          ? new Date(file.created_at).getTime()
          : now;
        const fileResult = insertFile.run(
          entryId,
          file.path || "",
          file.sha256 || null,
          file.size_bytes || 0,
          file.source || null,
          file.ttl_days ?? 30,
          file.status || "active",
          file.access_count || 0,
          file.last_accessed ? new Date(file.last_accessed).getTime() : null,
          fileCreated,
          now,
        );
        if (fileResult.changes > 0) {
          filesInserted.count++;
        }
      }

      // Insert tags
      for (const tag of tags) {
        const tagResult = insertTag.run(entryId, tag);
        if (tagResult.changes > 0) {
          tagsInserted.count++;
        }
      }
    }
  });

  try {
    insertRoute(entries);
    writeLog(SRC, "INFO", {
      event: "KC-BACKFILL-COMPLETE",
      detail: `entries=${entriesInserted.count} files=${filesInserted.count} tags=${tagsInserted.count}`,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-BACKFILL-FAILED",
      detail: e.message,
    });
  }

  return {
    entriesInserted: entriesInserted.count,
    filesInserted: filesInserted.count,
    tagsInserted: tagsInserted.count,
  };
}

// ════════════════════════════════════════════════════════════
// v11 BACKFILL — Populate typed knowledge tables from
//   docs/official_docs/index.json. Idempotent (INSERT OR IGNORE).
//
//   Reads the knowledge manifest and inserts each entry into
//   knowledge_entries, knowledge_files, and knowledge_entry_tags.
//   Designed to be called once after schema migration, safe to
//   call multiple times.
// ════════════════════════════════════════════════════════════

/**
 * Backfill typed knowledge tables from index.json manifest.
 * Idempotent — safe to call multiple times (INSERT OR IGNORE).
 *
 * @returns Summary of inserted rows: { entriesInserted, filesInserted, tagsInserted }
 */
// export function backfillKnowledgeFromManifest(root?: string): {
//   entriesInserted: number;
//   filesInserted: number;
//   tagsInserted: number;
// } {
//   // Initialize schema first (includes v11 tables), then backfill
//   const db = getDb({ root });
//   const entriesInserted = { count: 0 };
//   const filesInserted = { count: 0 };
//   const tagsInserted = { count: 0 };
// 
//   // Read index.json manifest
//   const indexPath = path.join(
//     root || process.env.OPENCODE_ROOT || process.cwd(),
//     "docs",
//     "official_docs",
//     "index.json",
//   );
// 
//   if (!fs.existsSync(indexPath)) {
//     writeLog(SRC, "WARN", {
//       event: "KC-BACKFILL-NO-MANIFEST",
//       detail: `Manifest not found at ${indexPath}`,
//     });
//     return { entriesInserted: 0, filesInserted: 0, tagsInserted: 0 };
//   }
// 
//   let manifest: any;
//   try {
//     manifest = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
//   } catch (e: any) {
//     writeLog(SRC, "ERROR", {
//       event: "KC-BACKFILL-PARSE-FAILED",
//       detail: `Manifest parse error: ${e.message}`,
//     });
//     return { entriesInserted: 0, filesInserted: 0, tagsInserted: 0 };
//   }
// 
//   const entries = manifest.entries || [];
//   const now = Date.now();
// 
//   const insertEntry = db.prepare(`
//     INSERT OR IGNORE INTO knowledge_entries
//       (library_id, query_topic, domain, tags, source, status, created_at, updated_at)
//     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
//   `);
// 
//   const insertFile = db.prepare(`
//     INSERT OR IGNORE INTO knowledge_files
//       (entry_id, file_path, sha256, size_bytes, source, ttl_days, status,
//        access_count, last_accessed, created_at, updated_at)
//     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//   `);
// 
//   const insertTag = db.prepare(`
//     INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag) VALUES (?, ?)
//   `);
// 
//   const insertRoute = db.transaction((manifestEntries: any[]) => {
//     for (const entry of manifestEntries) {
//       const tags = entry.tags || [];
//       const entryFiles = entry.files || [];
//       const source =
//         entryFiles.length > 0 ? entryFiles[0].source : entry.source || null;
//       const createdMs = entry.last_updated
//         ? new Date(entry.last_updated).getTime()
//         : entryFiles.length > 0 && entryFiles[0].created_at
//           ? new Date(entryFiles[0].created_at).getTime()
//           : now;
// 
//       const result = insertEntry.run(
//         entry.library_id || "unknown",
//         entry.query_topic || "untitled",
//         entry.domain || "fallback",
//         JSON.stringify(tags),
//         source || null,
//         entry.status || "active",
//         createdMs,
//         now,
//       );
// 
//       if (result.changes > 0) {
//         entriesInserted.count++;
//       }
// 
//       // Get entry_id (newly inserted or existing)
//       const entryRow = db
//         .query(
//           "SELECT id FROM knowledge_entries WHERE library_id = ? AND query_topic = ?",
//         )
//         .get(entry.library_id, entry.query_topic) as { id: number } | null;
// 
//       if (!entryRow) continue;
//       const entryId = entryRow.id;
// 
//       // Insert files
//       for (const file of entryFiles) {
//         const fileCreated = file.created_at
//           ? new Date(file.created_at).getTime()
//           : now;
//         const fileResult = insertFile.run(
//           entryId,
//           file.path || "",
//           file.sha256 || null,
//           file.size_bytes || 0,
//           file.source || null,
//           file.ttl_days ?? 30,
//           file.status || "active",
//           file.access_count || 0,
//           file.last_accessed ? new Date(file.last_accessed).getTime() : null,
//           fileCreated,
//           now,
//         );
//         if (fileResult.changes > 0) {
//           filesInserted.count++;
//         }
//       }
// 
//       // Insert tags
//       for (const tag of tags) {
//         const tagResult = insertTag.run(entryId, tag);
//         if (tagResult.changes > 0) {
//           tagsInserted.count++;
//         }
//       }
//     }
//   });
// 
//   try {
//     insertRoute(entries);
//     writeLog(SRC, "INFO", {
//       event: "KC-BACKFILL-COMPLETE",
//       detail: `entries=${entriesInserted.count} files=${filesInserted.count} tags=${tagsInserted.count}`,
//     });
//   } catch (e: any) {
//     writeLog(SRC, "ERROR", {
//       event: "KC-BACKFILL-FAILED",
//       detail: e.message,
//     });
//   }
// 
//   return {
//     entriesInserted: entriesInserted.count,
//     filesInserted: filesInserted.count,
//     tagsInserted: tagsInserted.count,
//   };
// }

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
    report.journal_mode =
      (db.query("PRAGMA journal_mode").get() as any)?.journal_mode ?? null;
    report.synchronous =
      (db.query("PRAGMA synchronous").get() as any)?.synchronous ?? null;
    report.page_count =
      (db.query("PRAGMA page_count").get() as any)?.page_count ?? null;
    report.page_size =
      (db.query("PRAGMA page_size").get() as any)?.page_size ?? null;
    report.free_pages =
      (db.query("PRAGMA freelist_count").get() as any)?.freelist_count ?? null;

    const integrityRows = db.query("PRAGMA integrity_check").all() as Array<{
      integrity_check: string;
    }>;
    report.integrity = integrityRows.map((r) => r.integrity_check);

    const sv = db
      .query("SELECT MAX(version) AS v FROM schema_version")
      .get() as { v: number | null } | null;
    report.schema_version = sv?.v ?? null;

    const tables = db
      .query(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .get() as { c: number } | null;
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
    writeLog(SRC, "INFO", { event: "DB-VACUUM-COMPLETE", detail: "vacuum completed" });
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
export function dbCleanStaleEntries(
  cutoffMs: number = 7 * 24 * 3600 * 1000,
  root?: string,
): number {
  const cutoff = Date.now() - cutoffMs;
  try {
    const db = getDb({ root });
    let total = 0;
    // 1. 统一循环只处理有 timestamp 列的表
    for (const table of ["audit_log", "write_audit_state", "eslint_state"]) {
      try {
        const res = db.run(`DELETE FROM ${table} WHERE timestamp < ?`, [cutoff]);
        total += res.changes;
      } catch { /* skip */ }
    }

    // 2. gate_audit_history 单独处理，使用正确的列名
    try {
      const res = db.run(
        "DELETE FROM gate_audit_history WHERE confirmed_at < ?",
        [cutoff],
      );
      total += res.changes;
    } catch { /* skip */ }

    // v6 tables: session_log uses created_at, dispatch_failed_log uses failed_at
    try {
      const res1 = db.run("DELETE FROM session_log WHERE created_at < ?", [
        cutoff,
      ]);
      total += res1.changes;
    } catch {
      /* table may not exist yet */
    }
    try {
      const res2 = db.run(
        "DELETE FROM dispatch_failed_log WHERE failed_at < ?",
        [cutoff],
      );
      total += res2.changes;
    } catch {
      /* table may not exist yet */
    }

    // session_map: 50-entry cap (keep newest by updated_at)
    try {
      const countRow = db
        .query("SELECT COUNT(*) AS c FROM session_map")
        .get() as { c: number } | null;
      const count = countRow?.c ?? 0;
      if (count > 50) {
        const res3 = db.run(`
          DELETE FROM session_map WHERE session_id NOT IN (
            SELECT session_id FROM session_map ORDER BY updated_at DESC LIMIT 50
          )
        `);
        total += res3.changes;
      }
    } catch {
      /* table may not exist yet */
    }

    // v15: dispatch_queue stale entry cleanup (7-day cutoff)
    try {
      const res4 = db.run(
        "DELETE FROM dispatch_queue WHERE status IN ('consumed', 'failed', 'stale') AND updated_at < ?",
        [cutoff],
      );
      total += res4.changes;
    } catch {
      /* table may not exist yet */
    }
    try {
      const res5 = db.run(
        "DELETE FROM dispatch_attempts WHERE created_at < ?",
        [cutoff],
      );
      total += res5.changes;
    } catch {
      /* table may not exist yet */
    }

    writeLog(SRC, "INFO", {
      event: "DB-CLEAN-STALE",
      detail: `deleted=${total} cutoff=${cutoff}`,
    });
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
  const rows = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Run a raw SELECT query. Used by diagnostic tools.
 * Parameters are bound as SQLQueryBindings.
 */
export function dbQuery(
  sql: string,
  params: SQLQueryBindings[] = [],
  root?: string,
): unknown[] {
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
process.on("SIGINT", () => {
  handleExit();
  process.exit(0);
});
process.on("SIGTERM", () => {
  handleExit();
  process.exit(0);
});
