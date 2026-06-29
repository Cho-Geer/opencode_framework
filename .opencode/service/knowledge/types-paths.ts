// knowledge-store.ts — UC7KS Knowledge Store API v3.0.0 (KC-15)
// ═══════════════════════════════════════════════════════════════
// Unified knowledge manifest/search/materialization API.
// v3.0.0 (KC-15): DB-FIRST — v11/v12 SQLite typed tables are the
//   canonical source. docs/official_docs/index.json is a materialized
//   view generated from the DB (atomic tmp+rename per UC7-007).
//   readManifest() → DB-first, file fallback with UC7KS-DB-FALLBACK log.
//   addEntry() → upsert DB → materialize file.
//   searchManifest() → query DB directly.
//
// Design: docs/review/knowledge/KC-01-knowledge-store-design.md
//
// @author @Super-Admin (KC-01, KC-11, KC-15)
// @version 3.0.0
// @since 2026-06-21
//
// Integrates with log-manager.ts for writeLog-based audit trail
// and db-manager.ts for SQLite access.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import { getDb, closeDb } from "../../lib/db-manager";

// ── Types ──────────────────────────────────────────────────────

/** A single cached file within a knowledge entry */
export interface KnowledgeFile {
  /** Relative path within docs/official_docs/ (e.g. "opencode/framework/plugins.md") */
  path: string;
  /** Source of the file: "webfetch", "context7", "github-api", "curated", "webfetch+cache-compile", etc. */
  source: string;
  /** Original URL the file was fetched from (optional) */
  original_url?: string;
  /** SHA-256 hash of the file content */
  sha256: string;
  /** File size in bytes */
  size_bytes: number;
  /** ISO-8601 creation timestamp */
  created_at: string;
  /** TTL in days before the file is considered stale (default: 30) */
  ttl_days?: number;
  /** Number of times this file has been accessed */
  access_count?: number;
  /** ISO-8601 timestamp of last access, or null if never accessed */
  last_accessed?: string | null;
  /** Status: "active", "archived", or "evicted" */
  status?: string;
  /**
   * Layer D (step-0d-log-audit-mandate.md, v3.1): Provenance verification status.
   * - "verified": content was actually fetched from an external source
   * - "inferred": content was generated/fabricated without successful external fetch
   * - undefined: not yet classified (backward compatible)
   */
  verification_status?: "verified" | "inferred";
}

/** A knowledge entry in the manifest (one library + topic + tags → N files) */
export interface KnowledgeEntry {
  /** Identifies the library or domain (e.g. "opencode-framework", "nestjs") */
  library_id: string;
  /** Human-readable topic summary */
  query_topic: string;
  /** Knowledge domain (e.g. "opencode_framework", "backend_api") */
  domain: string;
  /** Searchable tags */
  tags: string[];
  /** Cached files for this entry */
  files: KnowledgeFile[];
}

/** The top-level manifest (docs/official_docs/index.json) */
export interface KnowledgeManifest {
  /** Manifest format version (e.g. "1.2.0") */
  manifest_version: string;
  /** ISO-8601 timestamp of last update, or null if never updated */
  last_updated: string | null;
  /** Total number of entries (auto-computed on write) */
  total_entries: number;
  /** All knowledge entries */
  entries: KnowledgeEntry[];
}

/** Statistics about the knowledge cache */
export interface ManifestStats {
  /** Manifest format version */
  manifest_version: string;
  /** Total number of entries */
  total_entries: number;
  /** Total number of files across all entries */
  total_files: number;
  /** Total size in bytes */
  total_size_bytes: number;
  /** Total size in MB (formatted string, 1 decimal) */
  total_size_mb: string;
  /** Per-domain breakdown */
  per_domain: Record<string, { size_bytes: number; file_count: number }>;
}

/** Result of an addEntry operation */
export interface AddEntryResult {
  /** What happened: "added" (new entry), "updated" (merged files), or "dedup" (SHA-256 match) */
  action: "added" | "updated" | "dedup";
  /** The resulting entry */
  entry: KnowledgeEntry;
}

/** Search options */
export interface SearchOptions {
  /** Filter by domain */
  domain?: string;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Search by keyword in library_id, query_topic, or tags */
  keyword?: string;
}

/** Parameters for addEntry */
export interface AddEntryParams {
  /** Library identifier */
  library_id: string;
  /** Topic description */
  query_topic: string;
  /** Knowledge domain (default: "fallback") */
  domain?: string;
  /** Tags for searchability */
  tags?: string[];
  /** The file to add */
  file: KnowledgeFile;
}

// ── Source identifier for logging ──────────────────────────────

const SRC = "lib-knowledge-store";

// ── Path Resolution ────────────────────────────────────────────

/**
 * KC-11: Resolve the index.json path. Self-contained — no indexer dependency.
 */
export function getIndexPath(): string {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  return path.join(projectRoot, "docs", "official_docs", "index.json");
}

/**
 * KC-11: Resolve the docs directory path.
 */
export function getDocsDir(): string {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  return path.join(projectRoot, "docs", "official_docs");
}

// ── Materialization Lock (Phase 3) ─────────────────────────────
/**
 * Phase 3 (2026-06-21): File-based lock to prevent concurrent
 * materialization from multiple sessions/dispatches.
 *
 * Design:
 * - Lock path: .task_temp/_locks/knowledge-materialization.lock
 * - Lock TTL: configurable via project.config.json
 *   template_resolution["knowledge.materialization_lock_ttl_ms"],
 *   default 60000 (60 seconds)
 * - Stale locks (age > TTL) are automatically reclaimed
 * - Lock is acquired before any materialization and released after
 *
 * @see docs/review/framework-refactor/knowledge-store-api-integration-plan.md
 */
const LOCK_DIR = ".task_temp/_locks";
const LOCK_FILE = "knowledge-materialization.lock";
const DEFAULT_LOCK_TTL_MS = 60000;

export function getLockPath(): string {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  return path.join(projectRoot, LOCK_DIR, LOCK_FILE);
}

export function getLockTtlMs(): number {
  try {
    const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.join(
      projectRoot,
      ".opencode",
      "project.config.json",
    );
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const ttl =
        config.template_resolution?.["knowledge.materialization_lock_ttl_ms"];
      if (typeof ttl === "number" && ttl > 0) return ttl;
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_LOCK_TTL_MS;
}

export function acquireMaterializationLock(operation: string): boolean {
  const lockPath = getLockPath();
  const lockTtlMs = getLockTtlMs();
  const now = Date.now();
  const lockDir = path.dirname(lockPath);

  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  if (fs.existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
      const lockAge = now - lockData.timestamp;
      if (lockAge > lockTtlMs) {
        writeLog(SRC, "WARN", {
          event: "KC-MATERIALIZE-LOCK-STALE",
          detail: `lock_age_ms=${lockAge} pid=${lockData.pid} — reclaiming`,
        });
      } else {
        writeLog(SRC, "WARN", {
          event: "KC-MATERIALIZE-LOCK-BUSY",
          detail: `op=${operation} lock_age_ms=${lockAge} pid=${lockData.pid}`,
        });
        return false;
      }
    } catch {
      writeLog(SRC, "WARN", {
        event: "KC-MATERIALIZE-LOCK-CORRUPT",
        detail: "Corrupt lock file — reclaiming",
      });
    }
  }

  const lockData = { pid: process.pid, timestamp: now };
  fs.writeFileSync(lockPath, JSON.stringify(lockData), "utf-8");
  writeLog(SRC, "DEBUG", {
    event: "KC-MATERIALIZE-LOCK-ACQUIRED",
    detail: `pid=${process.pid} op=${operation}`,
  });
  return true;
}

export function releaseMaterializationLock(): void {
  const lockPath = getLockPath();
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch (err: any) {
    writeLog(SRC, "WARN", {
      event: "KC-MATERIALIZE-LOCK-RELEASE-FAILED",
      detail: err.message || String(err),
    });
  }
}

// ── DB Row Types ───────────────────────────────────────────────

/** Row shape from knowledge_entries table */
export interface DbEntryRow {
  id: number;
  library_id: string;
  query_topic: string;
  domain: string;
  tags: string | null; // JSON array string
  source: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

/** Row shape from knowledge_files table */
export interface DbFileRow {
  id: number;
  entry_id: number;
  file_path: string;
  sha256: string | null;
  size_bytes: number;
  source: string | null;
  ttl_days: number;
  status: string;
  access_count: number;
  last_accessed: number | null;
  created_at: number;
  updated_at: number;
}

/** Row shape from knowledge_entry_tags table */
export interface DbTagRow {
  id: number;
  entry_id: number;
  tag: string;
}

// ── Materialization Job Row Type ───────────────────────────────

/** A row from the knowledge_materialization_jobs table */
export interface MaterializationJob {
  id: number;
  entry_id: number | null;
  job_type: string;
  status: string;
  file_path: string | null;
  sha256: string | null;
  error_msg: string | null;
  retry_count: number;
  created_at: number;
  updated_at: number;
}
