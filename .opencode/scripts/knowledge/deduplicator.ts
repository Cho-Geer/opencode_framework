/**
 * deduplicator.js — UC7KS Knowledge Deduplicator v1.0.0
 *
 * Prevents duplicate content in docs/official_docs/ by checking SHA-256 hashes
 * before saving new files. If content matches an existing file, the new query
 * topic is added as a tag alias rather than creating a duplicate file.
 *
 * Usage: node .opencode/scripts/knowledge/deduplicator.js <sha256>
 * Returns: { is_duplicate: boolean, existing_path: string|null }
 */

const { readManifest } = require("./indexer");

function checkDuplicate(sha256) {
  const manifest = readManifest();
  for (const entry of manifest.entries) {
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
function computeHash(filePath) {
  const crypto = require("crypto");
  const fs = require("fs");
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest("hex")}`;
}

if (require.main === module) {
  const sha = process.argv[2];
  if (!sha) {
    console.log("UC7KS Deduplicator v1.0.0\nUsage: deduplicator.js <sha256>");
    process.exit(1);
  }
  console.log(JSON.stringify(checkDuplicate(sha), null, 2));
}

module.exports = { checkDuplicate, computeHash };
