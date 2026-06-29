// manifest-materialize.ts — Knowledge manifest materialization
// Split from manifest.ts (Phase 1f → Phase 2 sub-split)
// Contains: materializeManifestFromDb
// Re-exports: getEntryFilesFromDb, getEntryTagsFromDb (for search-add.ts)

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import type { KnowledgeManifest } from "./types-paths";
import {
  getIndexPath,
  acquireMaterializationLock,
  releaseMaterializationLock,
} from "./types-paths";
import {
  readManifestFromDb,
  insertMaterializationJob,
} from "./manifest-db";

// Re-export DB helpers so search-add.ts can import them from the
// manifest module (preserving the original import surface).
export { getEntryFilesFromDb, getEntryTagsFromDb } from "./manifest-db";

const SRC = "service-knowledge-manifest";

/**
 * KC-15: Materialize the current DB state to docs/official_docs/index.json.
 * Uses atomic tmp+rename per UC7-007. Called after every DB mutation.
 *
 * A6 (2026-06-21): Every materialization now creates a job row in
 * knowledge_materialization_jobs (status='written' on success,
 * status='failed' on error) for observability and retry support.
 *
 * @returns true on success, false on failure
 */
export function materializeManifestFromDb(): boolean {
  writeLog(SRC, "INFO", {
    event: "KC-MATERIALIZE-REQUESTED",
    detail: `pid=${process.pid}`,
  });

  // Phase 3: Acquire materialization lock to prevent concurrent writes
  if (!acquireMaterializationLock("materializeManifestFromDb")) {
    return false; // Lock busy — another materialization is in progress
  }

  try {
    const manifest = readManifestFromDb();
    if (!manifest) {
      const msg = "readManifestFromDb returned null — nothing to materialize";
      writeLog(SRC, "WARN", {
        event: "KC-MATERIALIZE-SKIP",
        detail: msg,
      });
      insertMaterializationJob({
        job_type: "index_json",
        status: "failed",
        error_msg: msg,
      });
      return false;
    }

    const indexPath = getIndexPath();
    // Phase 3: Unique tmp path per process to avoid collisions
    const tmp = `${indexPath}.${process.pid}.${Date.now()}.tmp`;

    // Ensure directory exists
    const dir = path.dirname(indexPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const json = JSON.stringify(manifest, null, 2);
    // A6: Compute SHA-256 of the materialized content BEFORE writing
    const sha256 = createHash("sha256").update(json).digest("hex");

    fs.writeFileSync(tmp, json, "utf-8");
    fs.renameSync(tmp, indexPath); // Atomic rename (UC7-007)

    // Clean up stale unique tmp files from previous failed writes
    // (non-fatal — do not block materialization)
    try {
      const docDir = path.dirname(indexPath);
      const baseName = path.basename(indexPath);
      for (const entry of fs.readdirSync(docDir)) {
        if (
          entry.startsWith(`${baseName}.`) &&
          entry.endsWith(".tmp") &&
          entry !== path.basename(tmp)
        ) {
          try {
            fs.unlinkSync(path.join(docDir, entry));
          } catch {
            // Non-fatal cleanup
          }
        }
      }
    } catch {
      // Non-fatal cleanup
    }

    // A6: Insert success job row
    insertMaterializationJob({
      job_type: "index_json",
      status: "written",
      file_path: indexPath,
      sha256,
    });

    writeLog(SRC, "INFO", {
      event: "KC-MATERIALIZED",
      detail: `entries=${manifest.total_entries} version=${manifest.manifest_version} path=${indexPath} sha256=${sha256} job_status=written`,
    });
    return true;
  } catch (err: any) {
    // A6: Insert failed job row
    insertMaterializationJob({
      job_type: "index_json",
      status: "failed",
      error_msg: err.message || String(err),
    });
    writeLog(SRC, "ERROR", {
      event: "KC-MATERIALIZE-FAILED",
      detail: err.message || String(err),
    });
    return false;
  } finally {
    releaseMaterializationLock();
  }
}
