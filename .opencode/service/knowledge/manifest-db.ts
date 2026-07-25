// manifest-db.ts — Knowledge manifest DB core operations
// Split from manifest.ts (Phase 1f → Phase 2 sub-split)
// Contains: readManifestFromDb, upsertEntryInDb, getEntryFilesFromDb,
//           getEntryTagsFromDb, insertMaterializationJob (internal)

import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import type {
  KnowledgeFile,
  KnowledgeEntry,
  KnowledgeManifest,
  AddEntryResult,
  AddEntryParams,
  DbEntryRow,
  DbFileRow,
  DbTagRow,
} from "./types-paths";

const SRC = "service-knowledge-manifest";


// ═══════════════════════════════════════════════════════════════
// PRIVATE: DB-First Core Functions (KC-15)
// ═══════════════════════════════════════════════════════════════

/**
 * KC-15: Read the knowledge manifest from v11 typed DB tables.
 * JOINs knowledge_entries + knowledge_files + knowledge_entry_tags.
 * This is the canonical read path. Returns null if DB is unavailable
 * or empty, triggering file fallback in readManifest().
 *
 * @returns The parsed manifest, or null if DB read failed/empty
 */
export function readManifestFromDb(): KnowledgeManifest | null {
  // Try-catch the entire function to handle DB connection failures gracefully
  try {
    const db = getDb({ skipSchema: true });

    // ── Check if knowledge_entries table exists ──────────────────
    const tableCheck = db
      .query(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='knowledge_entries'",
      )
      .get() as { c: number } | null;
    if (!tableCheck || tableCheck.c === 0) {
      writeLog(SRC, "INFO", {
        event: "KC-DB-READ-NO-TABLE",
        detail: "knowledge_entries table not found — triggering file fallback",
      });
      return null;
    }

    // ── Step 1: Query all active entries ─────────────────────────
    const entryRows = db
      .query(
        `SELECT id, library_id, query_topic, domain, tags, source, status,
                created_at, updated_at
         FROM knowledge_entries
         WHERE status = 'active'
         ORDER BY id`,
      )
      .all() as DbEntryRow[];

    if (entryRows.length === 0) {
      // DB has the table but no rows — may not have been backfilled yet
      writeLog(SRC, "INFO", {
        event: "KC-DB-READ-EMPTY",
        detail:
          "knowledge_entries table has 0 active rows — triggering file fallback",
      });
      return null;
    }

    // ── Step 2: Batch-query all files for these entries ──────────
    // Collect entry IDs for batch file query
    const entryIds = entryRows.map((r) => r.id);
    const fileRows: DbFileRow[] = [];
    // SQLite supports up to 999 parameters; batch in chunks of 500
    const BATCH = 500;
    for (let i = 0; i < entryIds.length; i += BATCH) {
      const batch = entryIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      const batchRows = db
        .query(
          `SELECT id, entry_id, file_path, sha256, size_bytes, source,
                  ttl_days, status, access_count, last_accessed,
                  created_at, updated_at
           FROM knowledge_files
           WHERE entry_id IN (${placeholders}) AND status = 'active'
           ORDER BY entry_id, id`,
        )
        .all(...batch) as DbFileRow[];
      fileRows.push(...batchRows);
    }

    // ── Step 3: Batch-query all tags — prefer normalized table ───
    // Fall back to parsed JSON from knowledge_entries.tags if
    // knowledge_entry_tags table is empty
    const tagRows: DbTagRow[] = [];
    for (let i = 0; i < entryIds.length; i += BATCH) {
      const batch = entryIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      const batchRows = db
        .query(
          `SELECT id, entry_id, tag
           FROM knowledge_entry_tags
           WHERE entry_id IN (${placeholders})
           ORDER BY entry_id, id`,
        )
        .all(...batch) as DbTagRow[];
      tagRows.push(...batchRows);
    }

    // ── Step 4: Build KnowledgeEntry objects ─────────────────────
    // Index files and tags by entry_id for O(1) lookup
    const filesByEntry = new Map<number, KnowledgeFile[]>();
    for (const fr of fileRows) {
      const list = filesByEntry.get(fr.entry_id) || [];
      list.push({
        path: fr.file_path,
        source: fr.source || "unknown",
        sha256: fr.sha256 || "",
        size_bytes: fr.size_bytes || 0,
        created_at: new Date(fr.created_at).toISOString(),
        ttl_days: fr.ttl_days || 30,
        access_count: fr.access_count || 0,
        last_accessed: fr.last_accessed
          ? new Date(fr.last_accessed).toISOString()
          : null,
        status: fr.status || "active",
      });
      filesByEntry.set(fr.entry_id, list);
    }

    const tagsByEntry = new Map<number, string[]>();
    for (const tr of tagRows) {
      const list = tagsByEntry.get(tr.entry_id) || [];
      list.push(tr.tag);
      tagsByEntry.set(tr.entry_id, list);
    }

    const entries: KnowledgeEntry[] = [];
    let latestTimestamp: string | null = null;

    for (const er of entryRows) {
      // Tags: prefer normalized table, fall back to parsed JSON
      let tags: string[] = tagsByEntry.get(er.id) || [];
      if (tags.length === 0 && er.tags) {
        try {
          const parsed = JSON.parse(er.tags);
          if (Array.isArray(parsed)) tags = parsed;
        } catch {
          // corrupt JSON — leave empty
        }
      }

      const fileList = filesByEntry.get(er.id) || [];

      // Track latest updated_at for manifest-level timestamp
      const entryDate = new Date(er.updated_at).toISOString();
      if (!latestTimestamp || entryDate > latestTimestamp) {
        latestTimestamp = entryDate;
      }

      entries.push({
        library_id: er.library_id,
        query_topic: er.query_topic,
        domain: er.domain || "fallback",
        tags,
        files: fileList,
      });
    }

    writeLog(SRC, "INFO", {
      event: "KC-DB-READ-SUCCESS",
      detail: `entries=${entries.length} db-rows=${entryRows.length}`,
    });

    return {
      manifest_version: "1.5.0",
      last_updated: latestTimestamp || new Date().toISOString(),
      total_entries: entries.length,
      entries,
    };
  } catch (err: any) {
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-FALLBACK",
      detail: `DB read failed: ${err.message || String(err)} — falling back to file`,
    });
    return null;
  }
}

/**
 * KC-15: Upsert a knowledge entry into v11 typed DB tables.
 * Uses a single transaction: INSERT OR REPLACE into knowledge_entries,
 * then upsert files (INSERT OR IGNORE by unique entry_id+file_path),
 * then replace tags (DELETE old + INSERT new into knowledge_entry_tags).
 *
 * Deduplication: checks SHA-256 hash across all files first.
 *
 * @param data - Entry data: library_id, query_topic, domain, tags, file
 * @returns The action taken and the resulting entry
 */
export function upsertEntryInDb(data: AddEntryParams): AddEntryResult | null {
  try {
    const db = getDb({ skipSchema: true });
    const now = Date.now();
    const file = data.file;
    const domain = data.domain || "fallback";
    const tags = Array.isArray(data.tags) ? data.tags : [];

    return db.transaction((d: AddEntryParams) => {
      // ── Dedup check by SHA-256 ──────────────────────────────────
      const dupRow = db
        .query(
          `SELECT kf.entry_id
           FROM knowledge_files kf
           WHERE kf.sha256 = ? AND kf.status = 'active'
           LIMIT 1`,
        )
        .get(file.sha256) as { entry_id: number } | null;

      if (dupRow) {
        // Update access count on existing file
        db.run(
          `UPDATE knowledge_files
           SET access_count = access_count + 1,
               last_accessed = ?,
               updated_at = ?
           WHERE sha256 = ?`,
          [now, now, file.sha256],
        );

        // Add new tags as aliases via knowledge_entry_tags
        if (tags.length > 0) {
          const insertTagStmt = db.prepare(
            `INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag) VALUES (?, ?)`,
          );
          for (const tag of tags) {
            insertTagStmt.run(dupRow.entry_id, tag);
          }
        }

        // Read the entry to return
        const er = db
          .query(
            `SELECT id, library_id, query_topic, domain, tags
             FROM knowledge_entries WHERE id = ?`,
          )
          .get(dupRow.entry_id) as DbEntryRow | null;
        const existingTags = getEntryTagsFromDb(db, dupRow.entry_id, er?.tags);
        const existingFiles = getEntryFilesFromDb(db, dupRow.entry_id);

        writeLog(SRC, "INFO", {
          event: "KC-DB-DEDUP",
          detail: `action=dedup library=${d.library_id} topic="${d.query_topic}"`,
        });

        return {
          action: "dedup" as const,
          entry: {
            library_id: er?.library_id || d.library_id,
            query_topic: er?.query_topic || d.query_topic,
            domain: er?.domain || domain,
            tags: existingTags,
            files: existingFiles,
          },
        };
      }

      // ── Upsert entry ────────────────────────────────────────────
      const fileCreated = file.created_at
        ? new Date(file.created_at).getTime()
        : now;

      // Try existing entry
      const existing = db
        .query(
          `SELECT id FROM knowledge_entries
           WHERE library_id = ? AND query_topic = ?`,
        )
        .get(d.library_id, d.query_topic) as { id: number } | null;

      let entryId: number;

      if (existing) {
        // Update existing entry
        db.run(
          `UPDATE knowledge_entries
           SET domain = ?, tags = ?, updated_at = ?
           WHERE id = ?`,
          [domain, JSON.stringify(tags), now, existing.id],
        );
        entryId = existing.id;
      } else {
        // Insert new entry
        const result = db.run(
          `INSERT INTO knowledge_entries
             (library_id, query_topic, domain, tags, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
          [
            d.library_id,
            d.query_topic,
            domain,
            JSON.stringify(tags),
            file.source || null,
            fileCreated,
            now,
          ],
        );
        entryId = Number(result.lastInsertRowid);
      }

      // ── Upsert file ─────────────────────────────────────────────
      // UNIQUE index on (entry_id, file_path) enables INSERT OR IGNORE
      db.run(
        `INSERT OR IGNORE INTO knowledge_files
           (entry_id, file_path, sha256, size_bytes, source, ttl_days,
            status, access_count, last_accessed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, NULL, ?, ?)`,
        [
          entryId,
          file.path,
          file.sha256 || null,
          file.size_bytes || 0,
          file.source || null,
          file.ttl_days ?? 30,
          fileCreated,
          now,
        ],
      );

      // ── Replace tags ────────────────────────────────────────────
      db.run("DELETE FROM knowledge_entry_tags WHERE entry_id = ?", [entryId]);
      if (tags.length > 0) {
        const insertTagStmt = db.prepare(
          `INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag) VALUES (?, ?)`,
        );
        for (const tag of tags) {
          insertTagStmt.run(entryId, tag);
        }
      }

      const action = existing ? "updated" : "added";
      writeLog(SRC, "INFO", {
        event: "KC-DB-UPSERT",
        detail: `action=${action} library=${d.library_id} topic="${d.query_topic}"`,
      });

      return {
        action: action as "added" | "updated",
        entry: {
          library_id: d.library_id,
          query_topic: d.query_topic,
          domain,
          tags,
          files: [
            {
              ...file,
              created_at:
                file.created_at || new Date(fileCreated).toISOString(),
              access_count: 0,
              status: "active",
            },
          ],
        },
      };
    })(data);
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-DB-UPSERT-FAILED",
      detail: `library=${data.library_id} err=${err.message || String(err)}`,
    });
    return null;
  }
}

/**
 * A6: Insert a row into knowledge_materialization_jobs table.
 * Non-fatal helper — failures are logged but never thrown,
 * so job tracking never blocks the primary materialization path.
 *
 * Exported for use by manifest-materialize.ts (not re-exported from bridge).
 *
 * @param params - job_type, status, file_path, sha256, error_msg, entry_id, retry_count
 */
export function insertMaterializationJob(params: {
  job_type: string;
  status: string;
  file_path?: string;
  sha256?: string;
  error_msg?: string;
  entry_id?: number;
  retry_count?: number;
}): void {
  try {
    const db = getDb({ skipSchema: true });
    const now = Date.now();
    db.run(
      `INSERT INTO knowledge_materialization_jobs
         (entry_id, job_type, status, file_path, sha256, error_msg, retry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.entry_id || null,
        params.job_type,
        params.status,
        params.file_path || null,
        params.sha256 || null,
        params.error_msg || null,
        params.retry_count || 0,
        now,
        now,
      ],
    );
    writeLog(SRC, "INFO", {
      event: "KC-JOB-INSERTED",
      detail: `job_type=${params.job_type} status=${params.status} sha256=${params.sha256 || "none"}`,
    });
  } catch (dbErr: any) {
    // Non-fatal: never let job tracking prevent materialization
    writeLog(SRC, "ERROR", {
      event: "KC-JOB-INSERT-FAILED",
      detail: `job_type=${params.job_type} status=${params.status} err=${dbErr.message || String(dbErr)}`,
    });
  }
}

// ── DB Helper Functions ────────────────────────────────────────

/**
 * Read files for a given entry_id from knowledge_files table.
 */
export function getEntryFilesFromDb(
  db: ReturnType<typeof getDb>,
  entryId: number,
): KnowledgeFile[] {
  const rows = db
    .query(
      `SELECT file_path, sha256, size_bytes, source, ttl_days,
              status, access_count, last_accessed, created_at
       FROM knowledge_files
       WHERE entry_id = ? AND status = 'active'
       ORDER BY id`,
    )
    .all(entryId) as DbFileRow[];

  return rows.map((fr) => ({
    path: fr.file_path,
    source: fr.source || "unknown",
    sha256: fr.sha256 || "",
    size_bytes: fr.size_bytes || 0,
    created_at: new Date(fr.created_at).toISOString(),
    ttl_days: fr.ttl_days || 30,
    access_count: fr.access_count || 0,
    last_accessed: fr.last_accessed
      ? new Date(fr.last_accessed).toISOString()
      : null,
    status: fr.status || "active",
  }));
}

/**
 * Read tags for a given entry_id. Prefers normalized knowledge_entry_tags
 * table, falling back to parsed JSON from the tags column.
 */
export function getEntryTagsFromDb(
  db: ReturnType<typeof getDb>,
  entryId: number,
  jsonTags?: string | null,
): string[] {
  const tagRows = db
    .query(
      "SELECT tag FROM knowledge_entry_tags WHERE entry_id = ? ORDER BY id",
    )
    .all(entryId) as { tag: string }[];

  if (tagRows.length > 0) {
    return tagRows.map((r) => r.tag);
  }

  // Fall back to JSON
  if (jsonTags) {
    try {
      const parsed = JSON.parse(jsonTags);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // corrupt JSON
    }
  }
  return [];
}
