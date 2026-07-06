// plugin-handlers/before/skill-policy.ts — Skill governance (Phase 3)
// Extracted from phase0-enforce: Skill whitelist + read attestation,
// WITHOUT the full initial_read gate (only warn for write tools).
//
// v1.0 (2026-07-05)
import { writeLog } from "../../lib/log-manager";
import { writeJsonl } from "../../lib/jsonl-writer";
import { resolveAgent } from "../../lib/agent-resolver";

const SRC = "plugin-skill-policy";

export const name = "skill-policy";
export const tools = ["*"];

// Track per-session attestation and skill loading state
const configAttested = new Set<string>();
const skillsLoaded = new Map<string, string[]>();

// Write/sensitive tools that should have skills loaded first
const WRITE_TOOLS = new Set([
  "safe_edit", "safe_shell", "safe_delete", "safe_mkdir",
  "safe_restore", "dispatch_subagent",
]);

// Attest tools — always pass, and track state
const ATTEST_TOOLS = new Set([
  "config_read_attest", "skill_read_attest", "rule_read_attest",
]);

// Read-only tools — always pass, no skill check needed
const PASSTHROUGH = new Set([
  "read", "glob", "grep", "webfetch", "websearch", "question",
]);

export async function handle(input: any, _output: any): Promise<void> {
  const toolName = input.tool as string;
  const sessionID = input.sessionID || "unknown";

  try {
    const agent = resolveAgent(sessionID) || input.agent || "unknown";

    // Track config attestation
    if (toolName === "config_read_attest") {
      configAttested.add(sessionID);
      return;
    }

    // Track skill reads
    if (toolName === "skill_read_attest" || toolName === "skill") {
      const skillName = input.args?.name as string;
      if (skillName) {
        const loaded = skillsLoaded.get(sessionID) || [];
        if (!loaded.includes(skillName)) loaded.push(skillName);
        skillsLoaded.set(sessionID, loaded);
      }
      return;
    }

    // Passthrough tools — no check
    if (PASSTHROUGH.has(toolName) || ATTEST_TOOLS.has(toolName)) return;

    // Enforcement for write tools
    if (WRITE_TOOLS.has(toolName)) {
      const loadedSkills = skillsLoaded.get(sessionID) || [];
      const hasAttest = configAttested.has(sessionID);

      if (!hasAttest) {
        writeLog(SRC, "WARN", {
          event: "SKILL-POLICY-NO-CONFIG-ATTEST",
          sessionID, agent, tool: toolName,
          detail: "Write tool before config_read_attest",
        });

      writeJsonl("quality", {
        event: "SKILL-POLICY-NO-CONFIG-ATTEST",
        severity: "warn",
      }, { sessionID, agent, tool: toolName });
      }

      if (loadedSkills.length === 0) {
        writeLog(SRC, "WARN", {
          event: "SKILL-POLICY-NO-SKILL",
          sessionID, agent, tool: toolName,
          detail: "Write tool with zero Skills loaded",
        });

      writeJsonl("quality", {
        event: "SKILL-POLICY-NO-SKILL",
        severity: "warn",
      }, { sessionID, agent, tool: toolName });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "SKILL-POLICY-ERR",
      tool: toolName, sessionID, error: e.message?.slice(0, 120),
    });
  }
}
