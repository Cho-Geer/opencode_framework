import { writeLog } from "../../lib/log-manager";
import { writeJsonl } from "../../lib/jsonl-writer";

/**
 * Skill Audit After-Hook
 * Records when agents load skills via the `skill` tool.
 * Phase 1 addition (2026-07-05).
 */
export async function handle(input: any, output: any): Promise<void> {
  // Only track skill tool calls
  if (input.tool !== "skill" && input.tool !== "skill_read_attest") return;

  const skillName = input.args?.name || input.args?.skill_name || "unknown";
  const sessionId = input.sessionID || "unknown";

  try {
    writeLog("skill-audit", "INFO", {
      event: "SKILL-LOADED",
      sessionId,
      tool: input.tool,
      skillName,
      timestamp: new Date().toISOString(),
    });

      // Phase 4: JSONL skill landing
      writeJsonl("skill", {
        event: "SKILL-LOADED",
        skillName: skillName,
        tool: input.tool,
      }, { sessionID: sessionId, tool: input.tool });
  } catch (e) {
    // Non-blocking: audit failure should not affect main flow
    writeLog("skill-audit", "WARN", {
      event: "AUDIT-FAILED",
      error: String(e),
      timestamp: new Date().toISOString(),
    });
  }
}
