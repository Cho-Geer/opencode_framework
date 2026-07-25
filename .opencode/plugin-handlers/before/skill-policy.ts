// plugin-handlers/before/skill-policy.ts — Skill read hard gate enforcement
// PT-WM-00R: DB-canonical skill read attestation hard gate (2026-07-14)
// Replaces old in-memory warn-only implementation with real hard block.
// Enforces that non-allowlist tools cannot execute until skill_read_attest passes.

import { writeLog } from "../../lib/log-manager";
import { getRuleDisposition } from "../../service/enforcement/rule-disposition";
import { resolveAgent, resolveTaskId } from "../../service/session/resolver";
import { validateSkillAttestation } from "../../service/session/skill-attest";

const SRC = "before-skill-policy";

export const name = "skill-policy";
export const tools = ["*"];

// ── Fixed allowlist for unauthenticated sessions (hard gate enabled) ──
// These tools are allowed BEFORE skill read attestation is completed.
// This list is fixed in code - cannot be extended by config or agent identity.
// Blueprint §2.2.7: "only allow read/glob/grep/question/skill/config_read_attest/skill_read_attest/rule_read_attest"
const PRE_ATTEST_ALLOWLIST = new Set<string>([
  // Read-only tools
  "read",
  "glob",
  "grep",
  // Interaction tools
  "question",
  "skill",
  // Attestation tools
  "config_read_attest",
  "skill_read_attest",
  "rule_read_attest",
]);

// ── Tool categorization for error messages ──
const WRITE_TOOLS = new Set<string>([
  "safe_edit",
  "safe_shell",
  "safe_delete",
  "safe_mkdir",
  "safe_restore",
  "safe_framework_edit",
  "dispatch_subagent",
  "write",
  "edit",
  "bash",
  // Repo write tools
  "safe_repo_commit",
  "safe_repo_push",
  "safe_repo_stage",
  "safe_repo_grant_create",
  "safe_repo_grant_bind",
  // GitHub write tools
  "github_create_pr",
  "github_merge_pr",
  "github_create_issue",
  "github_add_comment",
]);

function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName) || toolName.startsWith("safe_repo_") || toolName.startsWith("github_");
}

export async function handle(input: any, _output: any): Promise<void> {
  const toolName = input.tool as string;
  const sessionID = input.sessionID || "unknown";
  const hardGateEnabled = process.env.FRAMEWORK_SKILL_READ_HARD_GATE === "1";

  // If hard gate not enabled, skip enforcement (backward compatible)
  if (!hardGateEnabled) {
    return;
  }

  // Allow pre-attest tools always
  if (PRE_ATTEST_ALLOWLIST.has(toolName)) {
    writeLog(SRC, "DEBUG", {
      event: "SKILL-POLICY-PRE-ATTEST-ALLOW",
      session_id: sessionID,
      tool: toolName,
    });
    return;
  }

  // Resolve identity
  const agent = resolveAgent(sessionID) || input.agent;
  const taskId = resolveTaskId(sessionID);

  if (!agent) {
    const ruleId = "skill-read-attest-required";
    const disposition = getRuleDisposition(ruleId);
    writeLog(SRC, "ERROR", {
      event: "SKILL-POLICY-BLOCK",
      session_id: sessionID,
      tool: toolName,
      ruleId,
      reason: "Unable to resolve agent identity for session",
      disposition,
    });

    if (disposition === "hard_block") {
      throw new Error(
        `[${ruleId}] Agent identity not available. ` +
        `You must complete skill read attestation before using tool "${toolName}". ` +
        `First read all required skills, then run skill_read_attest with your task_id.`
      );
    }
    return;
  }

  // Validate attestation
  const worktree = process.cwd();
  const validation = validateSkillAttestation({
    agent,
    sessionID,
    worktree,
    taskId,
  });

  if (!validation.valid) {
    const ruleId = validation.ruleId || "skill-read-attest-required";
    const disposition = getRuleDisposition(ruleId);
    const toolType = isWriteTool(toolName) ? "write" : "non-allowlist";

    writeLog(SRC, "ERROR", {
      event: "SKILL-POLICY-BLOCK",
      session_id: sessionID,
      agent,
      taskId,
      tool: toolName,
      toolType,
      ruleId,
      reason: validation.reason,
      disposition,
    });

    if (disposition === "hard_block") {
      throw new Error(
        `[${ruleId}] ${validation.reason}. ` +
        `Tool "${toolName}" (${toolType}) is blocked until you complete skill read attestation. ` +
        `Allowed tools before attestation: ${Array.from(PRE_ATTEST_ALLOWLIST).join(", ")}. ` +
        `Action: 1) Read all required skill files completely, 2) Run skill_read_attest with your task_id, 3) Re-try your action.`
      );
    }
  }

  // Valid attestation - allow
  writeLog(SRC, "DEBUG", {
    event: "SKILL-POLICY-ALLOW",
    session_id: sessionID,
    agent,
    taskId,
    tool: toolName,
  });
}
