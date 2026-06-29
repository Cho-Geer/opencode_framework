// search-add-write.ts — Knowledge manifest write operations
// Split from search-add.ts (Phase 1f → Phase 2 sub-split)
// Contains: writeManifest, addEntry, writeManifestViaFile (private)

import * as fs from "node:fs";
import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import type {
  KnowledgeManifest,
  AddEntryResult,
  AddEntryParams,
} from "./types-paths";
import { getIndexPath } from "./types-paths";
import {
  materializeManifestFromDb,
  upsertEntryInDb,
} from "./manifest";
import { readManifest } from "./search-add-read";

const SRC = "service-search-add";

// ═══════════════════════════════════════════════════════════════
// writeManifest
// ═══════════════════════════════════════════════════════════════

/**
 * Write the knowledge manifest.
 *
 * KC-15: This operation imports/upserts entries into the DB and then
 * materializes the manifest to docs/official_docs/index.json.
 * For direct file write (legacy), use materializeManifestFromDb().
 *
 * @param manifest - The manifest to write (upserted into DB, then materialized)
 */
export function writeManifest(manifest: KnowledgeManifest): void {
  // KC-15: Write manifest entries to DB, then materialize
  try {
    const db = getDb({ skipSchema: true });
    const now = Date.now();

    // For each entry, upsert into DB
    let upserted = 0;
    for (const entry of manifest.entries) {
      try {
        // Find or create entry
        const existing = db
          .query(
            `SELECT id FROM knowledge_entries
             WHERE library_id = ? AND query_topic = ?`,
          )
          .get(entry.library_id, entry.query_topic) as { id: number } | null;

        let entryId: number;
        const entryNow = entry.files?.[0]?.created_at
          ? new Date(entry.files[0].created_at).getTime()
          : now;

        if (existing) {
          db.run(
            `UPDATE knowledge_entries
             SET domain = ?, tags = ?, updated_at = ?
             WHERE id = ?`,
            [
              entry.domain || "fallback",
              JSON.stringify(entry.tags || []),
              now,
              existing.id,
            ],
          );
          entryId = existing.id;
        } else {
          const result = db.run(
            `INSERT INTO knowledge_entries
               (library_id, query_topic, domain, tags, source, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
            [
              entry.library_id,
              entry.query_topic,
              entry.domain || "fallback",
              JSON.stringify(entry.tags || []),
              entry.files?.[0]?.source || null,
              entryNow,
              now,
            ],
          );
          entryId = Number(result.lastInsertRowid);
        }

        // Upsert files
        for (const file of entry.files || []) {
          const fileCreated = file.created_at
            ? new Date(file.created_at).getTime()
            : now;
          db.run(
            `INSERT OR IGNORE INTO knowledge_files
               (entry_id, file_path, sha256, size_bytes, source, ttl_days,
                status, access_count, last_accessed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
            [
              entryId,
              file.path,
              file.sha256 || null,
              file.size_bytes || 0,
              file.source || null,
              file.ttl_days ?? 30,
              file.access_count || 0,
              file.last_accessed
                ? new Date(file.last_accessed).getTime()
                : null,
              fileCreated,
              now,
            ],
          );
        }

        // Replace tags
        db.run("DELETE FROM knowledge_entry_tags WHERE entry_id = ?", [
          entryId,
        ]);
        if ((entry.tags || []).length > 0) {
          const insertTagStmt = db.prepare(
            `INSERT OR IGNORE INTO knowledge_entry_tags (entry_id, tag) VALUES (?, ?)`,
          );
          for (const tag of entry.tags) {
            insertTagStmt.run(entryId, tag);
          }
        }

        upserted++;
      } catch (entryErr: any) {
        writeLog(SRC, "ERROR", {
          event: "KC-MANIFEST-WRITE-ENTRY-FAILED",
          detail: `library=${entry.library_id} err=${entryErr.message}`,
        });
      }
    }

    // Materialize to file
    if (upserted > 0) {
      materializeManifestFromDb();
    }

    writeLog(SRC, "INFO", {
      event: "KC-MANIFEST-WRITTEN",
      detail: `entries=${upserted} version=${manifest.manifest_version}`,
    });
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-MANIFEST-WRITE-FAILED",
      detail: err.message || String(err),
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// addEntry
// ═══════════════════════════════════════════════════════════════

/**
 * Add a knowledge entry.
 *
 * KC-15: DB-first — upsertEntryInDb() (single transaction), then
 * materializeManifestFromDb() to update index.json.
 * Falls back to file-based write if DB upsert fails.
 *
 * @param data - Entry data: library_id, query_topic, domain, tags, file
 * @returns Result with action type ("added"|"updated"|"dedup") and the entry
 */
export function addEntry(data: AddEntryParams): AddEntryResult {
  // ── Try DB upsert first ──────────────────────────────────────
  const dbResult = upsertEntryInDb(data);
  if (dbResult) {
    // Materialize the updated DB to index.json
    materializeManifestFromDb();
    return dbResult;
  }

  // ── Fallback: file-based write (legacy path) ─────────────────
  writeLog(SRC, "WARN", {
    event: "UC7KS-DB-FALLBACK",
    detail: `upsertEntryInDb failed — falling back to file-based addEntry`,
  });

  try {
    const manifest = readManifest();
    const file = data.file;

    // Dedup check: same SHA-256?
    const existingByHash = manifest.entries.find(
      (e) => e.files && e.files.some((f) => f.sha256 === file.sha256),
    );
    if (existingByHash) {
      const ef = existingByHash.files.find((f) => f.sha256 === file.sha256);
      if (ef) {
        ef.access_count = (ef.access_count || 0) + 1;
        ef.last_accessed = new Date().toISOString();
      }
      if (Array.isArray(data.tags)) {
        existingByHash.tags = [
          ...new Set([...(existingByHash.tags || []), ...data.tags]),
        ];
      }
      writeManifestViaFile(manifest);
      writeLog(SRC, "INFO", {
        event: "KC-ENTRY-DEDUP",
        detail: `action=dedup library=${data.library_id} topic="${data.query_topic}" (file fallback)`,
      });
      return { action: "dedup", entry: existingByHash };
    }

    let entry = manifest.entries.find(
      (e) =>
        e.library_id === data.library_id && e.query_topic === data.query_topic,
    );
    if (entry) {
      entry.files.push({
        ...file,
        created_at: file.created_at || new Date().toISOString(),
        access_count: 0,
        status: "active",
      });
      if (Array.isArray(data.tags))
        entry.tags = [...new Set([...(entry.tags || []), ...data.tags])];
      writeManifestViaFile(manifest);
      writeLog(SRC, "INFO", {
        event: "KC-ENTRY-UPDATED",
        detail: `action=updated library=${data.library_id} topic="${data.query_topic}" (file fallback)`,
      });
      return { action: "updated", entry };
    }

    entry = {
      library_id: data.library_id,
      query_topic: data.query_topic,
      domain: data.domain || "fallback",
      tags: Array.isArray(data.tags) ? data.tags : [],
      files: [
        {
          ...file,
          created_at: file.created_at || new Date().toISOString(),
          access_count: 0,
          status: "active",
        },
      ],
    };
    manifest.entries.push(entry);
    writeManifestViaFile(manifest);
    writeLog(SRC, "INFO", {
      event: "KC-ENTRY-ADDED",
      detail: `action=added library=${data.library_id} topic="${data.query_topic}" (file fallback)`,
    });
    return { action: "added", entry };
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-ENTRY-ADD-FAILED",
      detail: `library=${data.library_id} err=${err.message || String(err)}`,
    });
    return {
      action: "added",
      entry: {
        library_id: data.library_id,
        query_topic: data.query_topic,
        domain: data.domain || "fallback",
        tags: data.tags || [],
        files: [{ ...data.file, status: "active" }],
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// PRIVATE: File-based write helper (legacy fallback)
// ═══════════════════════════════════════════════════════════════

/**
 * KC-15: Direct file-based write (legacy path for fallback only).
 * Uses atomic tmp+rename per UC7-007.
 */
function writeManifestViaFile(manifest: KnowledgeManifest): void {
  const indexPath = getIndexPath();
  try {
    manifest.last_updated = new Date().toISOString();
    manifest.total_entries = (manifest.entries || []).length;
    // Phase 3: Unique tmp path per process to avoid collisions
    const tmp = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf-8");
    fs.renameSync(tmp, indexPath);
    writeLog(SRC, "INFO", {
      event: "KC-MANIFEST-WRITTEN-VIA-FILE",
      detail: `entries=${manifest.total_entries}`,
    });
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-MANIFEST-WRITE-VIA-FILE-FAILED",
      detail: err.message || String(err),
    });
  }
}
