// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/read-track.ts — READ-BEFORE-APPROVE audit
// Migrated from plugins/read-track-after.ts
// Enhanced 2026-07-01: record content_length, file_hash, file_size for full-read verification

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { trackReadEvent } from "../../service/file-guard";

export const name = "read-track";
export const tools = ["read", "Read"];

export async function handle(input: any, output: any): Promise<void> {
  const tool = input?.tool || "";
  if (tool !== "read" && tool !== "Read") return;
  const filePath = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
  if (!filePath) return;

  // ── NEW: Calculate file hash, size, and content length ──
  let contentLength = 0;
  let fileHash = "";
  let fileSize = 0;

  try {
    // Content length from output (what the agent actually received)
    const outputText = typeof output?.output === "string"
      ? output.output
      : (typeof output?.content === "string" ? output.content : "");
    contentLength = outputText.length;

    // File hash and size from disk
    const root = process.env.OPENCODE_ROOT || ".";
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
    if (fs.existsSync(absolutePath)) {
      const fileContent = fs.readFileSync(absolutePath, "utf8");
      fileHash = crypto.createHash("sha256").update(fileContent).digest("hex");
      fileSize = fileContent.length;
    }
  } catch {
    // Non-critical: if hash/size calculation fails, still record the read
  }

  trackReadEvent({
    sessionID: input?.sessionID || input?.sessionId || "",
    callID: input?.callID || input?.callId || "",
    filePath,
    contentLength,
    fileHash,
    fileSize,
  });
}
