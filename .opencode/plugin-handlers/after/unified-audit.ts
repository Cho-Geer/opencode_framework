// unified-audit.ts — Merged from scope + read-track + audit + codegraph audit
// Phase 3 (2026-07-05): Unified audit trail
import { writeLog } from "../../lib/log-manager";
import { writeJsonl } from "../../lib/jsonl-writer";

export async function handle(input: any, output: any): Promise<void> {
  writeLog("unified-audit", "INFO", {
    event: "TOOL-COMPLETE",
    tool: input.tool,
    timestamp: new Date().toISOString(),
  });
  
  // Delegate to existing audit handlers for detailed logging
  for (const handler of ["read-track", "scope", "codegraph"]) {
    try {
      const mod = require("./" + handler);
      if (mod && mod.handle) await mod.handle(input, output);
    } catch (error: unknown) {
      writeLog("unified-audit", "WARN", {
        event: "DELEGATE-HANDLER-FAILED",
        handler,
        tool: input.tool,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
