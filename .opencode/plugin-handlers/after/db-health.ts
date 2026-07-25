// plugin-handlers/after/db-health.ts — DB health: write amplification monitoring
// Migrated from plugins/db-health.ts (tool.execute.after portion only)
// Session lifecycle hooks (created/idle/compacted) → merged into plugins/session.ts
import { writeLog } from "../../lib/log-manager";
import { dbAuditHistoryRowCount } from "../../lib/db-state-manager";
import { runAuditCleanup } from "../../lib/db-maintenance";

export const name = "db-health";
export const tools = ["*"]; // filters internally for gate tools

const CONFIG = {
  MAX_AUDIT_ROWS: 10_000,
  RETENTION_DAYS: 7,
  GATE_SAMPLE_INTERVAL: 50,
};

const GATE_TOOLS = new Set([
  "compliance_gate_check",
  "compliance_gate_arm",
  "compliance_gate_deliver",
  "compliance_gate_approve",
  "compliance_gate_complete",
]);

let _gateToolCallCount = 0;

export async function handle(input: any, _output: any): Promise<void> {
  if (!GATE_TOOLS.has(input.tool)) return;
  _gateToolCallCount++;

  if (_gateToolCallCount % CONFIG.GATE_SAMPLE_INTERVAL === 0) {
    try {
      const rowCount = dbAuditHistoryRowCount();
      if (rowCount > CONFIG.MAX_AUDIT_ROWS) {
        writeLog("plugin-db-health", "WARN", {
          event: "DB-HEALTH-GATE-AMPLIFICATION",
          detail: `gate_tool_calls=${_gateToolCallCount} audit_rows=${rowCount}`,
        });
        runAuditCleanup(CONFIG.RETENTION_DAYS, CONFIG.MAX_AUDIT_ROWS);
      }
    } catch { /* non-critical */ }
  }
}
