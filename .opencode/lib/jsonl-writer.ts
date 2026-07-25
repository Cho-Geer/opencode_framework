// lib/jsonl-writer.ts — Non-blocking JSONL audit writer (Phase 4)
// Writes append-only JSONL to .task_temp/_logs/{channel}.jsonl
// Failures are logged but never throw — audit writes must not block.
//
// v1.0 (2026-07-05)

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { writeLog } from "./log-manager";

const SRC = "lib-jsonl-writer";

// Channel → filename mapping
const CHANNEL_FILES: Record<string, string> = {
  audit: "audit.jsonl",
  quality: "quality.jsonl",
  skill: "skill.jsonl",
  guidance: "guidance.jsonl",
  dispatch: "dispatch.jsonl",
};

// Ensure log directory exists (lazy init)
let logDirReady = false;
let logDirPath = "";

function getLogDir(): string {
  if (logDirReady) return logDirPath;
  const root = process.env.OPENCODE_ROOT || process.cwd();
  logDirPath = join(root, ".task_temp", "_logs");
  if (!existsSync(logDirPath)) {
    try {
      mkdirSync(logDirPath, { recursive: true });
    } catch (e: any) {
      writeLog(SRC, "WARN", { event: "JSONL-DIR-CREATE-FAILED", error: e.message });
      return "";
    }
  }
  logDirReady = true;
  return logDirPath;
}

/**
 * Write a JSONL record to the specified channel.
 * Non-blocking: failures are logged but never throw.
 *
 * @param channel - One of: audit, quality, skill, guidance, dispatch
 * @param record - The data to write (will be JSON.stringify'd)
 * @param meta - Optional metadata (sessionID, agent, tool) to merge into record
 */
export function writeJsonl(
  channel: string,
  record: Record<string, any>,
  meta?: { sessionID?: string; agent?: string; tool?: string },
): void {
  try {
    const dir = getLogDir();
    if (!dir) return;

    const filename = CHANNEL_FILES[channel];
    if (!filename) {
      writeLog(SRC, "WARN", { event: "JSONL-UNKNOWN-CHANNEL", channel });
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      channel,
      ...(meta?.sessionID && { sessionID: meta.sessionID }),
      ...(meta?.agent && { agent: meta.agent }),
      ...(meta?.tool && { tool: meta.tool }),
      ...record,
    };

    const filePath = join(dir, filename);
    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
  } catch (e: any) {
    // Non-blocking: log but never throw
    writeLog(SRC, "WARN", {
      event: "JSONL-WRITE-FAILED",
      channel,
      error: e.message?.slice(0, 120),
    });
  }
}

/**
 * Batch write multiple records to the same channel.
 */
export function writeJsonlBatch(
  channel: string,
  records: Array<Record<string, any>>,
  meta?: { sessionID?: string; agent?: string; tool?: string },
): void {
  for (const record of records) {
    writeJsonl(channel, record, meta);
  }
}
