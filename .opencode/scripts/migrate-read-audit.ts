#!/usr/bin/env bun
/**
 * migrate-read-audit.ts — Import existing read_audit.jsonl into SQLite
 * ═══════════════════════════════════════════════════════════════════
 * Idempotent: uses INSERT OR IGNORE with event_key UNIQUE constraint.
 * Repeated runs produce increasing skipped count, no duplicate rows.
 *
 * Usage: bun .opencode/scripts/migrate-read-audit.ts
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-18
 *
 * @see docs/review/framework-refactor/read-audit-db-migration-plan.md §六
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../lib/db-manager";
import {
  normalizeAgent,
  normalizeReadAuditPath,
  makeEventKey,
} from "../lib/read-audit";

// ── Resolve JSONL path ──
const OPENCODE_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const JSONL_PATH = path.resolve(OPENCODE_ROOT, ".opencode", "state", "read_audit.jsonl");

// ── Stats ──
let imported = 0;
let skipped = 0;
let errors = 0;
let normMismatch = 0;

// ── Pre-count JSONL lines ──
let preCount = 0;
try {
  if (fs.existsSync(JSONL_PATH)) {
    const raw = fs.readFileSync(JSONL_PATH, "utf8");
    preCount = raw.trim().split("\n").filter(Boolean).length;
  }
} catch {
  console.error("Cannot read JSONL file:", JSONL_PATH);
  process.exit(1);
}

if (preCount === 0) {
  console.log("No entries in JSONL file — nothing to migrate.");
  process.exit(0);
}

// ── Get DB ──
let db;
try {
  db = getDb();
} catch (e: any) {
  console.error("Cannot open database:", e.message);
  process.exit(1);
}

// ── Pre-count DB rows ──
const preDbRow = db.query("SELECT COUNT(*) AS c FROM read_audit").get() as { c: number } | null;
const preDbCount = preDbRow?.c ?? 0;

// ── Import ──
const content = fs.readFileSync(JSONL_PATH, "utf8");
const lines = content.trim().split("\n").filter(Boolean);

db.transaction(() => {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO read_audit
     (event_key, timestamp, agent, file_path, opencode_session_id, task_id, call_id, raw_agent, raw_file_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      errors++;
      console.error(`[SKIP] Corrupted JSON at line: ${line.substring(0, 80)}...`);
      continue;
    }

    const timestamp = entry.timestamp || "";
    const rawAgent = entry.agent || "";
    const rawPath = entry.filePath || "";
    const sessionId = entry.sessionId || null;
    const taskId = entry.taskId || null;
    const callId = entry.callId || null;

    const normAgent = normalizeAgent(rawAgent);
    const normPath = normalizeReadAuditPath(rawPath);
    const eventKey = makeEventKey({
      timestamp,
      agent: rawAgent,
      filePath: rawPath,
      sessionId: sessionId || undefined,
      taskId: taskId || undefined,
      callId: callId || undefined,
    });

    // Normalization consistency check (warn on mismatch, still import)
    if (normAgent !== rawAgent.replace(/^@/, "").toLowerCase()) {
      normMismatch++;
      console.error(`[NORM] Agent mismatch: raw="${rawAgent}" norm="${normAgent}"`);
    }

    try {
      const result = stmt.run(
        eventKey,
        timestamp,
        normAgent,
        normPath,
        sessionId,
        taskId,
        callId,
        rawAgent,
        rawPath,
        Date.now(),
      );
      if (result.changes > 0) {
        imported++;
      } else {
        skipped++;
      }
    } catch (e: any) {
      errors++;
      console.error(`[ERROR] Insert failed: ${e.message}`);
    }
  }
})();

// ── Post-count DB rows ──
const postDbRow = db.query("SELECT COUNT(*) AS c FROM read_audit").get() as { c: number } | null;
const postDbCount = postDbRow?.c ?? 0;

// ── Report ──
console.log("══════════════════════════════════════════════════════");
console.log("  read_audit.jsonl → SQLite Migration Report");
console.log("══════════════════════════════════════════════════════");
console.log(`  JSONL lines:         ${preCount}`);
console.log(`  DB rows (before):    ${preDbCount}`);
console.log(`  DB rows (after):     ${postDbCount}`);
console.log(`  Imported:            ${imported}`);
console.log(`  Skipped (duplicate): ${skipped}`);
console.log(`  Errors:              ${errors}`);
console.log(`  Norm mismatches:     ${normMismatch}`);
console.log("══════════════════════════════════════════════════════");

if (errors > 0 || imported === 0) {
  console.error("⚠️  Migration completed with issues — see errors above.");
}

// Clean shutdown
try { db.close(); } catch {}
