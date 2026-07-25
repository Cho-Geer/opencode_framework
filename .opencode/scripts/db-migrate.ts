#!/usr/bin/env bun
/**
 * db-migrate.ts — CI database initialization and migration entry point.
 *
 * Consolidates the inline bun scripts previously embedded in ci.yml:
 *   1. Schema initialization (via db-manager getDb → initializeSchema)
 *   2. Substate seeding (13 sub-states for fresh CI environments)
 *   3. CI gate session creation (strict_no_gate compliance)
 *   4. Stale gate session drain
 *
 * Usage:
 *   bun .opencode/scripts/db-migrate.ts          # full init (CI default)
 *   bun .opencode/scripts/db-migrate.ts --seed   # seed substates only
 *   bun .opencode/scripts/db-migrate.ts --gate   # create gate session only
 *
 * Exit codes: 0 = success, 1 = fatal error
 */

import { getDb, closeDb } from "../lib/db-manager";

const CI_SEED_STATES: Record<string, unknown> = {
  eslint_state: {
    modules: {},
    aggregate: { total_violations: 0, dirty_modules: [], waived_modules: [] },
  },
  type_check_state: {
    status: "clean",
    dirty_files: [],
    last_checked: null,
    errors: [],
  },
  dependency_state: {
    status: "clean",
    dirty_files: [],
    last_checked: null,
    packages: {},
  },
  format_state: {
    status: "clean",
    dirty_files: [],
    last_checked: null,
    formatter: "prettier",
  },
  write_audit_state: { sessions: {}, history: [] },
  knowledge_cache_state: {
    cache_status: "empty",
    total_entries: 0,
    last_index_check: null,
    last_fetch_at: null,
    compliance: {},
    pipeline_integrity: {},
    session_access: {},
    total_docs_count: 0,
    total_size_bytes: 0,
    last_verified: null,
  },
  compliance_records: {
    role_violations: [],
    gate_violations: [],
    tdd_violations: [],
    super_admin_dispatch_bypasses: [],
    orchestrator_sa_dispatches: [],
  },
  knowledge_audit_state: {
    last_audit: null,
    total_accesses: 0,
    coverage_score: 0,
  },
  tdd_enforcement_state: {
    enabled: true,
    current_session: {},
    violations: [],
    history: [],
  },
  keystone_hashes: {},
  transaction_state: {
    last_operation_id: null,
    last_transaction_at: null,
    pending_operations: [],
  },
  knowledge_state: {
    domains_covered: [],
    last_updated: null,
    coverage_score: 0,
  },
  config_read_state: { sessions: {} },
};

function seedSubstates(): void {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO substate_kv (key, json, updated_at) VALUES (?, ?, ?)",
  );

  let seeded = 0;
  for (const [key, val] of Object.entries(CI_SEED_STATES)) {
    const result = stmt.run(key, JSON.stringify(val), now);
    if (result.changes > 0) seeded++;
  }

  console.log(
    `✅ Substates: ${seeded} seeded, ${Object.keys(CI_SEED_STATES).length - seeded} already present`,
  );
}

function createGateSession(): void {
  const db = getDb();
  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const sessionId = `cg_ses_${now}`;

  db.run(
    `INSERT OR REPLACE INTO gate_sessions
      (session_id, task_desc, status, agent, task_id,
       plan_summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      "CI framework self-test gate session",
      "armed",
      null,
      null,
      "Automatic gate session for framework-self-test compliance check",
      now,
      now,
    ],
  );

  // Update active_sessions in gate_store_meta (V3 object format)
  let activeSessions: Record<string, unknown> = {};
  const metaRow = db
    .query("SELECT value FROM gate_store_meta WHERE key = ?")
    .get("active_sessions") as { value: string } | null;
  if (metaRow) {
    try {
      activeSessions = JSON.parse(metaRow.value);
    } catch {}
  }
  activeSessions[sessionId] = {
    session_id: sessionId,
    gate_status: "armed",
    created_at: nowISO,
  };

  const metaStmt = db.prepare(
    "INSERT OR REPLACE INTO gate_store_meta (key, value, updated_at) VALUES (?, ?, ?)",
  );
  metaStmt.run("active_sessions", JSON.stringify(activeSessions), now);
  metaStmt.run("formatVersion", JSON.stringify("3.0"), now);
  metaStmt.run("last_updated", JSON.stringify(nowISO), now);

  db.run(
    "INSERT OR REPLACE INTO gate_session_index (session_id, status, last_updated) VALUES (?, ?, ?)",
    [sessionId, "armed", now],
  );

  console.log(`✅ CI gate session created: ${sessionId}`);
}

function drainStaleSessions(): void {
  const db = getDb();
  const result = db.run(
    "DELETE FROM gate_sessions WHERE status = 'checked' AND task_id IS NULL",
  );
  db.run(
    "DELETE FROM gate_session_index WHERE session_id NOT IN (SELECT session_id FROM gate_sessions)",
  );
  console.log(`✅ Drained ${result.changes} stale gate session(s)`);
}

function main(): void {
  const args = process.argv.slice(2);
  const seedOnly = args.includes("--seed");
  const gateOnly = args.includes("--gate");

  try {
    // Always ensure schema exists
    getDb();
    console.log("✅ Schema initialized");

    if (seedOnly) {
      seedSubstates();
    } else if (gateOnly) {
      createGateSession();
    } else {
      seedSubstates();
      createGateSession();
      drainStaleSessions();
    }

    closeDb();
    console.log("✅ db-migrate complete");
  } catch (e: any) {
    console.error(`❌ db-migrate failed: ${e.message}`);
    process.exit(1);
  }
}

main();
