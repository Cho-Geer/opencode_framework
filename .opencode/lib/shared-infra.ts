// shared-infra.ts — framework shared utilities for all plugins
import * as fs from "node:fs";
import * as path from "node:path";

const DEMO_LOG_FILE = ".task_temp/_dispatch/chat_message_hook.log";

export function getDemoLogPath(): string {
  return path.join(process.env.OPENCODE_ROOT || ".", DEMO_LOG_FILE);
}

export function demoLog(level: "INFO" | "ERROR", message: string): void {
  try {
    const lp = getDemoLogPath();
    const dir = path.dirname(lp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(lp, `[${new Date().toISOString()}][${level}] ${message}\n`, "utf8");
  } catch { /* silent */ }
}
