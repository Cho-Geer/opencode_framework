// search-add-read.ts — Knowledge manifest read/query operations
// Split from search-add.ts (Phase 1f → Phase 2 sub-split)
// Contains: readManifest, searchManifest, getStats,
//           searchByDomain, searchByTags, getEntryByLibraryId,
//           searchByKeyword, materializeToFile

import * as fs from "node:fs";
import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import type {
  KnowledgeEntry,
  KnowledgeManifest,
  ManifestStats,
  SearchOptions,
  DbEntryRow,
} from "./types-paths";
import { getIndexPath } from "./types-paths";
import {
  readManifestFromDb,
  getEntryFilesFromDb,
  getEntryTagsFromDb,
  materializeManifestFromDb,
} from "./manifest";

const SRC = "service-search-add";

// ═══════════════════════════════════════════════════════════════
// PUBLIC: readManifest / getStats
// ═══════════════════════════════════════════════════════════════

/**
 * Read the knowledge manifest. DB-first with file fallback.
 *
 * KC-15: Tries readManifestFromDb() (v11 typed tables) first.
 * Falls back to reading docs/official_docs/index.json directly
 * if the DB is unavailable, missing, or empty — logging
 * UC7KS-DB-FALLBACK.
 *
 * @returns The parsed manifest, or a default empty manifest
 */
export function readManifest(): KnowledgeManifest {
  // ── Try DB first (canonical source) ───────────────────────────
  const dbManifest = readManifestFromDb();
  if (dbManifest) {
    return dbManifest;
  }

  // ── Fallback: read index.json directly ────────────────────────
  const indexPath = getIndexPath();
  try {
    if (!fs.existsSync(indexPath)) {
      writeLog(SRC, "WARN", {
        event: "UC7KS-DB-FALLBACK",
        detail:
          "entries=0 version=1.2.0 (file fallback — index.json not found, DB unavailable)",
      });
      return {
        manifest_version: "1.2.0",
        last_updated: null,
        total_entries: 0,
        entries: [],
      };
    }
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-FALLBACK",
      detail: `entries=${raw.total_entries || 0} version=${raw.manifest_version || "unknown"} (file fallback)`,
    });
    return raw as KnowledgeManifest;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-MANIFEST-READ-FAILED",
      detail: `Both DB and file failed: ${err.message || String(err)}`,
    });
    return {
      manifest_version: "1.2.0",
      last_updated: null,
      total_entries: 0,
      entries: [],
    };
  }
}

/**
 * Get statistics about the knowledge cache.
 *
 * KC-15: Uses DB directly — more efficient than file I/O.
 *
 * @returns Manifest statistics with size breakdown
 */
export function getStats(): ManifestStats {
  try {
    const manifest = readManifest();
    let totalSize = 0;
    let totalFiles = 0;
    const perDomain: Record<
      string,
      { size_bytes: number; file_count: number }
    > = {};
    for (const entry of manifest.entries) {
      for (const file of entry.files || []) {
        totalSize += file.size_bytes || 0;
        totalFiles++;
        const d = entry.domain || "unknown";
        if (!perDomain[d]) perDomain[d] = { size_bytes: 0, file_count: 0 };
        perDomain[d].size_bytes += file.size_bytes || 0;
        perDomain[d].file_count++;
      }
    }
    const result: ManifestStats = {
      manifest_version: manifest.manifest_version,
      total_entries: manifest.total_entries,
      total_files: totalFiles,
      total_size_bytes: totalSize,
      total_size_mb: (totalSize / 1048576).toFixed(1),
      per_domain: perDomain,
    };
    writeLog(SRC, "INFO", {
      event: "KC-STATS-COMPUTED",
      detail: `entries=${result.total_entries} size=${result.total_size_mb}MB`,
    });
    return result;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-STATS-FAILED",
      detail: err.message || String(err),
    });
    return {
      manifest_version: "1.2.0",
      total_entries: 0,
      total_files: 0,
      total_size_bytes: 0,
      total_size_mb: "0.0",
      per_domain: {},
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// searchManifest
// ═══════════════════════════════════════════════════════════════

/**
 * Search the knowledge manifest with optional domain, tags, and keyword filters.
 *
 * KC-15: Query DB first via knowledge_entries + knowledge_entry_tags.
 * Falls back to manifest-based search if DB unavailable.
 *
 * @param opts - Search options: domain, tags, keyword (all optional)
 * @returns Matching entries
 */
export function searchManifest(opts: SearchOptions = {}): KnowledgeEntry[] {
  // ── Try DB search first ──────────────────────────────────────
  try {
    const db = getDb({ skipSchema: true });

    // Check table existence
    const tableCheck = db
      .query(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='knowledge_entries'",
      )
      .get() as { c: number } | null;
    if (!tableCheck || tableCheck.c === 0) {
      // Fall through to manifest-based search
      throw new Error("knowledge_entries table not found");
    }

    // Build WHERE clauses
    const conditions: string[] = ["ke.status = 'active'"];
    const params: any[] = [];

    if (opts.domain) {
      conditions.push("LOWER(ke.domain) = LOWER(?)");
      params.push(opts.domain);
    }

    if (opts.keyword) {
      const kw = `%${opts.keyword.toLowerCase()}%`;
      conditions.push(
        "(LOWER(ke.library_id) LIKE ? OR LOWER(ke.query_topic) LIKE ? OR EXISTS (SELECT 1 FROM knowledge_entry_tags kt2 WHERE kt2.entry_id = ke.id AND LOWER(kt2.tag) LIKE ?))",
      );
      params.push(kw, kw, kw);
    }

    if (opts.tags && opts.tags.length > 0) {
      // Tag filter via knowledge_entry_tags — entry must have at least one matching tag
      const tagPlaceholders = opts.tags.map(() => "LOWER(?)").join(",");
      const lowerTags = opts.tags.map((t) => t.toLowerCase());
      conditions.push(
        `EXISTS (SELECT 1 FROM knowledge_entry_tags kt3
                  WHERE kt3.entry_id = ke.id
                    AND LOWER(kt3.tag) IN (${tagPlaceholders}))`,
      );
      params.push(...lowerTags);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const entryRows = db
      .query(
        `SELECT id, library_id, query_topic, domain, tags, source, status
         FROM knowledge_entries ke
         ${whereClause}
         ORDER BY id`,
      )
      .all(...params) as DbEntryRow[];

    // Build results with files and tags
    const results: KnowledgeEntry[] = [];
    for (const er of entryRows) {
      const fileRows = getEntryFilesFromDb(db, er.id);
      const tagList = getEntryTagsFromDb(db, er.id, er.tags);

      results.push({
        library_id: er.library_id,
        query_topic: er.query_topic,
        domain: er.domain || "fallback",
        tags: tagList,
        files: fileRows,
      });
    }

    writeLog(SRC, "INFO", {
      event: "KC-SEARCH-PERFORMED",
      detail: `domain=${opts.domain || "all"} tags=[${(opts.tags || []).join(",")}] keyword=${opts.keyword || "none"} hits=${results.length} source=db`,
    });
    return results;
  } catch (dbErr: any) {
    // ── Fallback: manifest-based search ─────────────────────────
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-FALLBACK",
      detail: `searchManifest DB query failed: ${dbErr.message || String(dbErr)} — falling back to file`,
    });

    try {
      const manifest = readManifest();
      let results = manifest.entries;

      if (opts.domain) {
        const d = opts.domain.toLowerCase();
        results = results.filter((e) => (e.domain || "").toLowerCase() === d);
      }

      if (opts.tags && opts.tags.length > 0) {
        const lowerTags = opts.tags.map((t) => t.toLowerCase());
        results = results.filter((e) =>
          (e.tags || []).some((t) => lowerTags.includes(t.toLowerCase())),
        );
      }

      if (opts.keyword) {
        const kw = opts.keyword.toLowerCase();
        results = results.filter(
          (e) =>
            (e.library_id || "").toLowerCase().includes(kw) ||
            (e.query_topic || "").toLowerCase().includes(kw) ||
            (e.tags || []).some((t) => t.toLowerCase().includes(kw)),
        );
      }

      writeLog(SRC, "INFO", {
        event: "KC-SEARCH-PERFORMED",
        detail: `domain=${opts.domain || "all"} tags=[${(opts.tags || []).join(",")}] keyword=${opts.keyword || "none"} hits=${results.length} source=file-fallback`,
      });
      return results;
    } catch (fallbackErr: any) {
      writeLog(SRC, "ERROR", {
        event: "KC-SEARCH-FAILED",
        detail: fallbackErr.message || String(fallbackErr),
      });
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Convenience Helpers
// ═══════════════════════════════════════════════════════════════

/** Search entries by domain (exact match, case-insensitive) */
export function searchByDomain(domain: string): KnowledgeEntry[] {
  return searchManifest({ domain });
}

/** Search entries matching any of the given tags */
export function searchByTags(tags: string[]): KnowledgeEntry[] {
  return searchManifest({ tags });
}

/** Get a single entry by its library_id (exact match) */
export function getEntryByLibraryId(
  libraryId: string,
): KnowledgeEntry | undefined {
  const manifest = readManifest();
  return manifest.entries.find((e) => e.library_id === libraryId);
}

/** Search entries by keyword */
export function searchByKeyword(keyword: string): KnowledgeEntry[] {
  return searchManifest({ keyword });
}

// ── Materialization Export (for scripts that need explicit materialization) ──

/**
 * KC-15: Explicitly materialize the DB state to index.json.
 * Used by maintainer scripts to force a file regeneration.
 *
 * @returns true on success
 */
export function materializeToFile(): boolean {
  return materializeManifestFromDb();
}
