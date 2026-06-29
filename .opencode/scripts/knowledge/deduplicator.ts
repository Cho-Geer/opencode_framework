/**
 * deduplicator.js — UC7KS Knowledge Deduplicator v1.0.0
 *
 * Prevents duplicate content in docs/official_docs/ by checking SHA-256 hashes
 * before saving new files. If content matches an existing file, the new query
 * topic is added as a tag alias rather than creating a duplicate file.
 *
 * Usage: bun .opencode/scripts/knowledge/deduplicator.ts <sha256>
 * Returns: { is_duplicate: boolean, existing_path: string|null }
 */

import { readManifest } from "../../lib/knowledge-store";

function checkDuplicate(sha256: string) {
  const manifest = readManifest();
  for (const entry of manifest.entries || []) {
    for (const file of entry.files || []) {
      if (file.sha256 === sha256) {
        return {
          is_duplicate: true,
          existing_path: file.path,
          existing_entry: entry.library_id,
          existing_topic: entry.query_topic,
        };
      }
    }
  }
  return { is_duplicate: false, existing_path: null };
}

/**
 * Compute SHA-256 of a file.
 */
function computeHash(filePath: string): string {
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest("hex")}`;
}

export { checkDuplicate, computeHash };
