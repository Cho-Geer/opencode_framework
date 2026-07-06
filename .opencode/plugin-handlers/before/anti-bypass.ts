// plugin-handlers/before/anti-bypass.ts — Guidance gate + threshold enforcement
// Migrated from plugins/anti-bypass.ts (tool.execute.before portion)
import { writeLog } from "../../lib/log-manager";
import { isGuidanceGateExempt, isPhase0FailureExempt, isEnforcementPassthrough } from "../../service/enforcement/exemptions";
import { resolveAgent } from "../../lib/agent-resolver";
import { buildStopMessage } from "../../lib/enforce-stop-message";
import {
  recordAttempt,
  checkThreshold,
  recordBlock,
  getAwaitingPhase,
  getSoftRejectionCount,
  getConfig,
} from "../../service/enforcement/tool-tracker";
import { createChecklistRun } from "../../service/gate";

export const name = "anti-bypass";
export const tools = ["*"];

function isClearGuidanceTool(tool: string): boolean {
  return isGuidanceGateExempt(tool);
}

export async function handle(input: any, _output: any): Promise<void> {
  const tool = input.tool as string;
  const sessionId = input.sessionID || "unknown";

  try {
    const agent = resolveAgent(sessionId);

    // ── GUIDANCE GATE (highest priority) ──
    const phase = getAwaitingPhase(sessionId);

    if (phase === 1) {
      if (isClearGuidanceTool(tool)) {
        writeLog("plugin-anti-bypass", "INFO", {
          event: "GATE-CLEAR-GUIDANCE-ALLOWED",
          agent, sessionId, tool,
          detail: "clear_guidance allowed through guidance gate",
        });
        return;
      }
      // 两条路径共用：汇报通道工具
      if (isEnforcementPassthrough(tool)) {
        writeLog("plugin-anti-bypass", "INFO", {
          event: "ENFORCEMENT-PASSTHROUGH-ALLOWED",
          agent, sessionId, tool,
          detail: `${tool} allowed through enforcement (passthrough)`,
        });
        return;
      }
      writeLog("plugin-anti-bypass", "ERROR", {
        event: "GATE-BLOCK",
        agent, sessionId, tool,
        detail: "Guidance gate active. Only clear_guidance and question allowed.",
      });
      throw new Error(
        `[FW-ENFORCE][GUIDANCE-GATE] BLOCKED. Your session is in the guidance gate. ` +
        `Call clear_guidance(agent_name="<your-name>", token="<token>") with the guidance token ` +
        `from QoderWork's response. No other tool calls permitted until the gate is cleared.`
      );
    }

    // ── Soft rejection threshold check (v32) ──
    const softRejCount = getSoftRejectionCount(sessionId, tool);
    const softRejThreshold = getConfig().softRejectionThreshold;
    if (softRejCount >= softRejThreshold) {
      writeLog("plugin-anti-bypass", "ERROR", {
        event: "SOFT-REJECTION-LIMIT",
        agent, sessionId, tool,
        rejectionCount: softRejCount,
        threshold: softRejThreshold,
        detail: `Tool "${tool}" rejected ${softRejCount} times (threshold: ${softRejThreshold}) — triggering anti-bypass`,
      });
      throw new Error(
        `[FW-ENFORCE][SOFT-REJECTION-LIMIT] Tool "${tool}" has been rejected ${softRejCount} times in this session (threshold: ${softRejThreshold}). ` +
        `STOP retrying this tool. Call the "question" tool to report to QoderWork and wait for guidance.`
      );
    }

    // ── Phase-0 exemption: don't count Phase-0 blocks as failures ──
    try {
      const run = createChecklistRun({
        opencode_session_id: sessionId,
        agent: agent || "",
        task_id: null,
      });
      if (run && run.phase === "initial_read") {
        if (!isPhase0FailureExempt(tool)) {
          writeLog("plugin-anti-bypass", "INFO", {
            event: "PHASE0-EXEMPT",
            agent, sessionId, tool,
            detail: "Phase-0 block — not counted as anti-bypass failure",
          });
          return;
        }
      }
    } catch { /* run check failure → fall through to normal enforcement */ }

    // ── Normal enforcement ──
    const { count, shouldBlock, isReadOnly, reason } = recordAttempt(sessionId, agent, tool);
    if (!shouldBlock) return;

    // 两条路径共用：汇报通道工具
    if (isEnforcementPassthrough(tool)) {
      writeLog("plugin-anti-bypass", "INFO", {
        event: "ENFORCEMENT-PASSTHROUGH-ALLOWED",
        agent, sessionId, tool,
        detail: `${tool} allowed through enforcement (passthrough)`,
      });
      return;
    }

    recordBlock(sessionId, agent, tool, reason);
    writeLog("plugin-anti-bypass", "ERROR", {
      event: "ANTI-BYPASS-BLOCK",
      agent, sessionId, tool, isReadOnly,
      consecutive: count,
    });

    throw new Error(buildStopMessage({
      pluginName: "anti-bypass",
      ruleId: "ANTI-BYPASS-MUST-REPORT",
      blockedTool: tool,
      agentName: agent,
      reason: `${count} cumulative tool failures — MANDATORY REPORTING not yet completed`,
      remediation: [
        `YOU MUST CALL the "question" tool IMMEDIATELY to report to QoderWork.`,
        `Parameters:`,
        `  question: "工具 ${tool} 连续失败 ${count} 次，需要指导"`,
        `  options: ["换一种方法", "需要更多指导", "放弃此任务"]`,
        `After reporting, wait for QoderWork's response before any other tool call.`,
      ].join("\n"),
    }));
  } catch (e: any) {
    if (e.message?.includes("[FW-ENFORCE]")) throw e;
    writeLog("plugin-anti-bypass", "ERROR", {
      event: "BEFORE-HOOK-ERR", tool, sessionId, error: e.message,
    });
  }
}
