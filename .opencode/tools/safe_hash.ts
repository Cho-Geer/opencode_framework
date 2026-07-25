/**
 * safe_hash.ts — SHA-256 File Hash Tool
 * ======================================
 *
 * Computes SHA-256 hash of a file. Read-only, zero side-effects.
 * Designed specifically for guidance/checklist recovery:
 * enables READ-BEFORE-APPROVE hash verification without safe_shell.
 *
 * Pattern: follows safe_diff.ts — minimal wrapper, no lib dependency.
 *
 * @author @Super-Admin
 * @since 2026-06-25
 */

import { tool } from "@opencode-ai/plugin";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export default tool({
  description:
    "Compute SHA-256 hash of a file. Read-only, zero side-effects. " +
    "Useful for verifying file integrity and for READ-BEFORE-APPROVE hash computation " +
    "when safe_shell is temporarily unavailable due to active governance hooks.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Absolute path to the file to hash"),
  },
  async execute(args, context) {
    const absPath = resolve(args.filePath);

    if (!existsSync(absPath)) {
      throw new Error(`[safe_hash] File not found: ${absPath}`);
    }

    const content = readFileSync(absPath);
    const hash = createHash("sha256").update(content).digest("hex");

    return JSON.stringify({
      file: absPath,
      sha256: hash,
    });
  },
});
