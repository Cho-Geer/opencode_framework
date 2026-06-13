/**
 * shared-infra.ts — framework shared utilities for all plugins
 *
 * FW-LOG-UNIFY-P1-D1 (2026-06-12, @Super-Admin): demoLog() migrated from
 * direct appendFileSync to writeLog() for centralized log persistence.
 * Preserved getDemoLogPath() for backward compatibility with legacy callers.
 *
 * @module shared-infra
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "./log-manager";

const DEMO_LOG_FILE = ".task_temp/_dispatch/chat_message_hook.log";

export function getDemoLogPath(): string {
  return path.join(process.env.OPENCODE_ROOT || ".", DEMO_LOG_FILE);
}

/**
 * Write a structured log entry via the centralized log-manager.
 * Falls back silently if log-manager import fails (non-blocking diagnostic).
 *
 * @param level - Log severity level
 * @param message - Human-readable log message
 */
export function demoLog(level: "INFO" | "ERROR", message: string): void {
  try {
    writeLog("lib-shared-infra", level, { event: "demo", detail: message });
  } catch { /* silent — diagnostic-only, must not throw */ }
}
