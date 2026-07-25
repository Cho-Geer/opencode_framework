// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/anti-bypass.ts — Detect failures + reward reporting
// Migrated from plugins/anti-bypass.ts (tool.execute.after portion)
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import {
  rewardReport,
  recordResult,
  isReadOnlyTool,
  recordSoftRejection,
  getGuidanceStatus,
  getFailureSummary,
  clearGuidance,
} from "../../service/enforcement/tool-tracker";

export const name = "anti-bypass";
export const tools = ["*"];

type ToolOutput = {
  isError?: boolean;
  output?: unknown;
  status?: unknown;
  reason?: unknown;
};

function tryParseOutputJson(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Detect soft rejection: tool executed but returned rejection/error */
function detectSoftRejection(output: ToolOutput | null | undefined): { rejected: boolean; reason: string } {
  if (!output) return { rejected: false, reason: "" };

  // MCP standard error format
  if (output.isError === true) return { rejected: true, reason: "isError=true" };

  // Parse nested output (output.output is a JSON string)
  const innerText = typeof output.output === "string" ? output.output : "";
  const inner = tryParseOutputJson(innerText);

  // Check top-level status
  if (output.status === "rejected") {
    return { rejected: true, reason: String(output.reason || "rejected") };
  }
  if (inner?.status === "rejected") {
    return { rejected: true, reason: String(inner.reason || "rejected") };
  }

  // Check for error patterns
  if (innerText.includes('"session not found"')) return { rejected: true, reason: "session not found" };
  if (inner?.error) return { rejected: true, reason: String(inner.error).slice(0, 200) };
  if (inner?.verified === false && inner?.error) {
    return { rejected: true, reason: "verified=false: " + String(inner.error).slice(0, 150) };
  }

  return { rejected: false, reason: "" };
}

export async function handle(input: any, output: any): Promise<void> {
  const tool = input.tool as string;
  const sessionId = input.sessionID || "unknown";

  try {
    const agent = resolveAgent(sessionId);

    // ── NEW: question tool success → trigger recovery ──
    if (tool === "question") {
      const status = getGuidanceStatus(sessionId);
      const summary = getFailureSummary(sessionId);
      // If in guidance gate, or has cumulative failures, trigger recovery
      if (status.awaiting || (summary && summary.consecutiveFailures > 0)) {
        // Step 1: rewardReport generates token + sets awaiting_guidance=1
        const result = rewardReport(sessionId, agent);
        if (result.token) {
          // Step 2: clearGuidance verifies token + resets all counters
          const cleared = clearGuidance(sessionId, agent, result.token);
          writeLog("plugin-anti-bypass", "INFO", {
            event: "QUESTION-RECOVERY-COMPLETE",
            agent, sessionId,
            previousCount: result.previousCount,
            cleared: cleared.success,
            detail: "Agent called question, QoderWork answered, counters reset",
          });
        }
      }
      return;
    }


    // Normal: detect tool failure
    const { failed, count, error } = recordResult(sessionId, agent, tool, output);

    if (failed) {
      writeLog("plugin-anti-bypass", isReadOnlyTool(tool) ? "INFO" : "WARN", {
        event: "TOOL-FAILURE-DETECTED",
        agent, sessionId, tool,
        consecutive: count,
        error: error?.slice(0, 200),
      });
    }

    // v32: Detect soft rejections (tool executed but returned rejection/error)
    if (!failed) {
      const softReject = detectSoftRejection(output);
      if (softReject.rejected) {
        const rejCount = recordSoftRejection(sessionId, tool, softReject.reason);
        writeLog("plugin-anti-bypass", "WARN", {
          event: "SOFT-REJECTION-DETECTED",
          agent, sessionId, tool,
          rejectionCount: rejCount,
          reason: softReject.reason?.slice(0, 200),
        });
      }
    }
  } catch (e: any) {
    writeLog("plugin-anti-bypass", "ERROR", {
      event: "AFTER-HOOK-ERR", tool, sessionId, error: e.message,
    });
  }
}
