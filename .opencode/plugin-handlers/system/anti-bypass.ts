// plugin-handlers/system/anti-bypass.ts — Two-phase dynamic prompt injection
// Phase 1: Block detected, inject "report + wait" directive (NO token)
// Phase 2: QoderWork delivered guidance, inject token + recovery instructions
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { getGuidanceStatus, checkThreshold } from "../../service/enforcement/tool-tracker";

export const name = "anti-bypass";

export async function handle(input: any, output: any): Promise<void> {
  const sessionId = input?.sessionID;
  if (!sessionId) return;

  try {
    const agent = resolveAgent(sessionId);

    // ── NEW: softThreshold STOP injection (fix checkThreshold dead code) ──
    const thresholdCheck = checkThreshold(sessionId);
    if (thresholdCheck.shouldInject) {
      if (output?.system && Array.isArray(output.system)) {
        output.system.push(thresholdCheck.directive);
      }
      writeLog("plugin-anti-bypass", "WARN", {
        event: "STOP-INJECTED", sessionId, agent,
        consecutive: thresholdCheck.count,
      });
    }

    // ── 原有: guidance gate injection ──
    const status = getGuidanceStatus(sessionId);

    if (!status.awaiting) return; // Not in guidance gate, nothing to inject

    if (!status.delivered) {
      // ═══ Phase 1: Guidance NOT yet delivered by QoderWork ═══
      // Inject "report + wait" directive with correct tool names
      // NO token — agent physically cannot self-clear
      const phase1Directive = [
        `[FW-ENFORCE][GUIDANCE-GATE] YOU ARE BLOCKED.`,
        `Cumulative tool failures triggered the enforcement gate.`,
        ``,
        `IMMEDIATE ACTION REQUIRED:`,
        `1. Call the "question" tool to report the failure to QoderWork:`,
        `   - question: "工具 ${status.lastFailureTool} 连续失败，错误: ${status.lastFailureError?.slice(0, 100) || "blocked"}"`,
        `   - options: ["我理解了，换一种方法", "需要更详细的指导", "此任务无法完成，需要帮助"]`,
        `2. After QoderWork responds, follow their instructions.`,
        ``,
        `DO NOT attempt to retry the failed tool or switch to other tools.`,
        `The question tool is the ONLY tool allowed while in this gate.`,
      ].join("\n");

      if (output?.system && Array.isArray(output.system)) {
        output.system.push(phase1Directive);
      }
      writeLog("plugin-anti-bypass", "WARN", {
        event: "PHASE1-DIRECTIVE-INJECTED", sessionId, agent,
        lastTool: status.lastFailureTool,
      });
    } else {
      // ═══ Phase 2: QoderWork has delivered guidance ═══
      // Inject token + recovery instructions
      const phase2Directive = [
        `[FW-ENFORCE][GUIDANCE] QoderWork has provided instructions.`,
        ``,
        `Follow the guidance below immediately:`,
        ``,
        `═══ GUIDANCE ═══`,
        status.guidanceText || "(No specific instructions — resume your previous task with corrected approach)",
        `═══ END GUIDANCE ═══`,
      ].join("\n");

      if (output?.system && Array.isArray(output.system)) {
        output.system.push(phase2Directive);
      }
      writeLog("plugin-anti-bypass", "INFO", {
        event: "PHASE2-DIRECTIVE-INJECTED", sessionId, agent,
        guidanceLength: status.guidanceText.length,
      });
    }
  } catch (e: any) {
    writeLog("plugin-anti-bypass", "ERROR", {
      event: "SYSTEM-TRANSFORM-ERR", sessionId: input?.sessionID, error: e.message,
    });
  }
}
