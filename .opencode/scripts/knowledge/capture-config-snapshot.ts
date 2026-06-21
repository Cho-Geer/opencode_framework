/**
 * capture-config-snapshot.ts — A9 Config Indexing Snapshot Script
 * ════════════════════════════════════════════════════════════════════════
 *
 * Reads authoritative config sources and snapshots them into the
 * framework-state.db for drift detection.
 *
 * P2-D source inversion: opencode.json is the authoritative source.
 * The DB tables (permission_snapshot, agent_registry_snapshot,
 * template_resolution_snapshot) are snapshots/index only. They are
 * NOT authoritative — they exist to detect when the authoritative
 * source drifts from the last-known-good state.
 *
 * Snapshots captured:
 *   1. permission_snapshot: agent permission entries from opencode.json
 *      → composite PK (agent_name, permission_key)
 *      → permission_value stored as JSON string
 *      → source_sha256 = SHA-256 of entire opencode.json file
 *
 *   2. agent_registry_snapshot: agent registrations from opencode.json
 *      → PK (agent_name)
 *      → mode, model, prompt_path, hidden flag
 *      → source_sha256 = SHA-256 of entire opencode.json file
 *
 *   3. template_resolution_snapshot: template_resolution keys from
 *      .opencode/project.config.json
 *      → PK (key)
 *      → value stored as JSON string
 *      → source_sha256 = SHA-256 of entire project.config.json file
 *
 * Idempotent: uses INSERT OR REPLACE — safe to run multiple times.
 *
 * Usage: bun .opencode/scripts/knowledge/capture-config-snapshot.ts
 *
 * @author @Super-Admin
 * @task A9-CONFIG-INDEXING-v1
 * @version 1.0.0
 * @since 2026-06-20
 * ════════════════════════════════════════════════════════════════════════
 */

import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// ════════════════════════════════════════════════════════════
// PATH RESOLUTION — matches db-manager.ts resolveStateDir logic
// ════════════════════════════════════════════════════════════

const projectRoot = process.env.OPENCODE_ROOT || process.cwd();

function resolveStateDir(): string {
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

function getDbPath(): string {
  const envPath = process.env.FRAMEWORK_DB_PATH;
  if (envPath) return envPath;
  return path.join(resolveStateDir(), "framework-state.db");
}

function openDb(): Database {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`[capture-config-snapshot] DB not found: ${dbPath}`);
    console.error(
      "[capture-config-snapshot] Run the framework first to initialize the DB.",
    );
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/**
 * Ensure v16 snapshot tables exist. Idempotent (IF NOT EXISTS).
 * Called before capture to handle the case where db-manager.ts
 * initializeSchema() hasn't been called yet after the v16 migration
 * was added to the source.
 */
function ensureTables(db: Database): void {
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
}

// ════════════════════════════════════════════════════════════
// SHA-256 helper
// ════════════════════════════════════════════════════════════

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ════════════════════════════════════════════════════════════
// CONFIG FILE READING
// ════════════════════════════════════════════════════════════

interface AgentConfig {
  mode?: string;
  model?: string;
  prompt?: string;
  hidden?: boolean;
  permission?: Record<string, unknown>;
}

interface OpenCodeJson {
  agent?: Record<string, AgentConfig>;
}

interface ProjectConfig {
  template_resolution?: Record<string, unknown>;
}

function readOpenCodeJson(): { data: OpenCodeJson; raw: string; hash: string } {
  const opencodePath = path.join(projectRoot, "opencode.json");
  if (!fs.existsSync(opencodePath)) {
    console.error(
      `[capture-config-snapshot] opencode.json not found: ${opencodePath}`,
    );
    process.exit(1);
  }
  const raw = fs.readFileSync(opencodePath, "utf8");
  const hash = sha256(raw);
  let data: OpenCodeJson;
  try {
    data = JSON.parse(raw);
  } catch (e: any) {
    console.error(
      `[capture-config-snapshot] Failed to parse opencode.json: ${e.message}`,
    );
    process.exit(1);
  }
  return { data, raw, hash };
}

function readProjectConfig(): {
  data: ProjectConfig;
  raw: string;
  hash: string;
} {
  const configPath = path.join(projectRoot, ".opencode", "project.config.json");
  if (!fs.existsSync(configPath)) {
    console.error(
      `[capture-config-snapshot] project.config.json not found: ${configPath}`,
    );
    process.exit(1);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const hash = sha256(raw);
  let data: ProjectConfig;
  try {
    data = JSON.parse(raw);
  } catch (e: any) {
    console.error(
      `[capture-config-snapshot] Failed to parse project.config.json: ${e.message}`,
    );
    process.exit(1);
  }
  return { data, raw, hash };
}

// ════════════════════════════════════════════════════════════
// SNAPSHOT CAPTURE
// ════════════════════════════════════════════════════════════

interface CaptureResult {
  permissionRows: number;
  agentRows: number;
  templateRows: number;
}

/**
 * Capture all three config snapshots to the DB.
 * Idempotent: uses INSERT OR REPLACE.
 */
function captureAll(db: Database): CaptureResult {
  const now = Date.now();

  // ── 1. permission_snapshot from opencode.json ────────────
  const oc = readOpenCodeJson();
  let permissionRows = 0;
  const insertPermission = db.prepare(`
    INSERT OR REPLACE INTO permission_snapshot
      (agent_name, permission_key, permission_value, source_sha256, captured_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  if (oc.data.agent) {
    for (const [agentName, agentCfg] of Object.entries(oc.data.agent)) {
      if (agentCfg.permission && typeof agentCfg.permission === "object") {
        for (const [permKey, permValue] of Object.entries(
          agentCfg.permission,
        )) {
          const valueJson = JSON.stringify(permValue);
          insertPermission.run(agentName, permKey, valueJson, oc.hash, now);
          permissionRows++;
        }
      }
    }
  }

  // ── 2. agent_registry_snapshot from opencode.json ────────
  let agentRows = 0;
  const insertAgent = db.prepare(`
    INSERT OR REPLACE INTO agent_registry_snapshot
      (agent_name, mode, model, prompt_path, hidden, source_sha256, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  if (oc.data.agent) {
    for (const [agentName, agentCfg] of Object.entries(oc.data.agent)) {
      insertAgent.run(
        agentName,
        agentCfg.mode || "unknown",
        agentCfg.model || null,
        agentCfg.prompt || "",
        agentCfg.hidden ? 1 : 0,
        oc.hash,
        now,
      );
      agentRows++;
    }
  }

  // ── 3. template_resolution_snapshot from project.config.json ──
  const pc = readProjectConfig();
  let templateRows = 0;
  const insertTemplate = db.prepare(`
    INSERT OR REPLACE INTO template_resolution_snapshot
      (key, value, source_sha256, captured_at)
    VALUES (?, ?, ?, ?)
  `);

  if (pc.data.template_resolution) {
    for (const [key, value] of Object.entries(pc.data.template_resolution)) {
      const valueStr =
        typeof value === "string" ? value : JSON.stringify(value);
      insertTemplate.run(key, valueStr, pc.hash, now);
      templateRows++;
    }
  }

  return { permissionRows, agentRows, templateRows };
}

// ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════

function main(): void {
  console.log(
    "[capture-config-snapshot] Reading authoritative config sources...",
  );

  const db = openDb();

  // Ensure v16 tables exist (idempotent — CREATE IF NOT EXISTS)
  // Handles case where db-manager.ts initializeSchema() hasn't run yet
  // after the v16 migration was added to source.
  ensureTables(db);

  const result = captureAll(db);

  console.log("[capture-config-snapshot] Snapshot captured successfully:");
  console.log(`  permission_snapshot:       ${result.permissionRows} rows`);
  console.log(`  agent_registry_snapshot:   ${result.agentRows} rows`);
  console.log(`  template_resolution_snapshot: ${result.templateRows} rows`);

  // Verify rows were actually written
  const verify = {
    permissions: (
      db.query("SELECT COUNT(*) AS c FROM permission_snapshot").get() as {
        c: number;
      }
    ).c,
    agents: (
      db.query("SELECT COUNT(*) AS c FROM agent_registry_snapshot").get() as {
        c: number;
      }
    ).c,
    templates: (
      db
        .query("SELECT COUNT(*) AS c FROM template_resolution_snapshot")
        .get() as { c: number }
    ).c,
  };

  console.log("[capture-config-snapshot] Verification:");
  console.log(`  permission_snapshot:       ${verify.permissions} rows in DB`);
  console.log(`  agent_registry_snapshot:   ${verify.agents} rows in DB`);
  console.log(`  template_resolution_snapshot: ${verify.templates} rows in DB`);

  if (
    verify.permissions === 0 ||
    verify.agents === 0 ||
    verify.templates === 0
  ) {
    console.error(
      "[capture-config-snapshot] WARNING: One or more tables are empty.",
    );
    console.error(
      "  This may indicate the source config files have no data, or parsing failed silently.",
    );
  }

  db.close();
  console.log("[capture-config-snapshot] Done.");
}

main();
