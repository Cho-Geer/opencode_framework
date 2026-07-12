// plugin-handlers/system/anti-bypass.ts — Two-phase dynamic prompt injection
// Phase 1: Block detected, inject "report + wait" directive (NO token)
// Phase 2: QoderWork delivered guidance, inject token + recovery instructions
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { getGuidanceStatus, checkThreshold } from "../../service/enforcement/tool-tracker";
import { writeJsonl } from "../../lib/jsonl-writer";

export const name = "anti-bypass";

function buildPersistenceFailureDirective(reason: string): string {
  return [
    `[CRITICAL][FW-ENFORCE][PERSISTENCE-FAILURE]`,
    `Framework persistence/enforcement state is unavailable.`,
    `Error: ${reason}`,
    ``,
    `DO NOT retry tools.`,
    `Call acp_notify(event_type="task_blocked") immediately.`,
    `If acp_notify fails or returns unresolved, call question immediately.`,
    `Do NOT continue autonomous recovery.`,
  ].join("\n");
}

export async function handle(input: any, output: any): Promise<void> {
  const sessionId = input?.sessionID;
  if (!sessionId) return;

  try {
    const agent = resolveAgent(sessionId);

    // ── NEW: softThreshold STOP injection (fix checkThreshold dead code) ──
    const thresholdCheck = checkThreshold(sessionId);
    
    // ── NEW: fail-closed on tracker error ──
    if (thresholdCheck.tracker_error) {
      const fallbackDirective = buildPersistenceFailureDirective(
        thresholdCheck.tracker_error_message || "Unknown tracker error"
      );
      if (output?.system && Array.isArray(output.system)) {
        output.system.push(fallbackDirective);
      }
      writeLog("plugin-anti-bypass", "ERROR", {
        event: "TRACKER-ERROR-FALLBACK-INJECTED",
        sessionId,
        agent,
        error: thresholdCheck.tracker_error_message,
      });
      // Continue to check other injections, but we've already injected the fail-closed directive
    }

    if (thresholdCheck.shouldInject) {
      if (output?.system && Array.isArray(output.system)) {
        output.system.push(thresholdCheck.directive);
      }
      writeLog("plugin-anti-bypass", "WARN", {
        event: "STOP-INJECTED",
        sessionId,
        agent,
        consecutive: thresholdCheck.count,
      });
      writeJsonl("guidance", {
        event: "STOP-INJECTED",
        rule_id: "non-question-during-guidance",
        result: "block",
        consecutive: thresholdCheck.count,
        detail: "softThreshold STOP directive injected",
      }, { sessionID: sessionId, agent, tool: input?.tool });
    }

    // ── 原有: guidance gate injection ──
    let status;
    try {
      status = getGuidanceStatus(sessionId);
    } catch (e: any) {
      // getGuidanceStatus also failed — inject fallback directive
      const fallbackDirective = buildPersistenceFailureDirective(e.message);
      if (output?.system && Array.isArray(output.system)) {
        output.system.push(fallbackDirective);
      }
      writeLog("plugin-anti-bypass", "ERROR", {
        event: "GUIDANCE-STATUS-ERR-FALLBACK-INJECTED",
        sessionId,
        agent,
        error: e.message,
      });
      return;
    }

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
        event: "PHASE1-DIRECTIVE-INJECTED",
        sessionId,
        agent,
        lastTool: status.lastFailureTool,
      });
      writeJsonl("guidance", {
        event: "PHASE1-DIRECTIVE-INJECTED",
        rule_id: "non-question-during-guidance",
        result: "block",
        lastFailureTool: status.lastFailureTool,
        detail: "guidance gate active; agent instructed to call question tool",
      }, { sessionID: sessionId, agent, tool: input?.tool });
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
        event: "PHASE2-DIRECTIVE-INJECTED",
        sessionId,
        agent,
        guidanceLength: status.guidanceText.length,
      });
      writeJsonl("guidance", {
        event: "PHASE2-DIRECTIVE-INJECTED",
        rule_id: "non-question-during-guidance",
        result: "recover",
        guidanceLength: status.guidanceText.length,
        detail: "QoderWork delivered guidance; recovery instructions injected",
      }, { sessionID: sessionId, agent, tool: input?.tool });
    }
  } catch (e: any) {
    // Catch-all: if anything fails, inject fallback directive
    const fallbackDirective = buildPersistenceFailureDirective(e.message);
    if (output?.system && Array.isArray(output.system)) {
      output.system.push(fallbackDirective);
    }
    writeLog("plugin-anti-bypass", "ERROR", {
      event: "SYSTEM-TRANSFORM-ERR-FALLBACK-INJECTED",
      sessionId: input?.sessionID,
      error: e.message,
    });
  }
}
