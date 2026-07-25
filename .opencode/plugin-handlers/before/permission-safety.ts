// permission-safety.ts — Merged from config-guard + git-guard
// Phase 3 (2026-07-05)
import { writeLog } from "../../lib/log-manager";

export async function handle(input: any, output: any): Promise<void> {
  // Delegate to config-guard
  try {
    const configGuard = require("./config-guard");
    if (configGuard && configGuard.handle) {
      await configGuard.handle(input, output);
    }
  } catch (e: any) {
    writeLog("permission-safety", "WARN", { event: "config-guard-block", detail: String(input.tool) });
    throw e;
  }
  
  // Delegate to git-guard
  try {
    const gitGuard = require("./git-guard");
    if (gitGuard && gitGuard.handle) {
      await gitGuard.handle(input, output);
    }
  } catch (e: any) {
    writeLog("permission-safety", "WARN", { event: "git-guard-block", detail: String(input.tool) });
    throw e;
  }
}
