// service/session/skill-attest.ts — Skill read attestation
// Verifies agent has read all required skills via read_audit DB
// Part of agent-read-enforcement blueprint (2026-07-01)

import * as path from "node:path";
import * as fs from "node:fs";
import { writeLog } from "../../lib/log-manager";
import { verifyRead } from "../file-guard/read-audit-verify";
import { normalizeReadAuditPath } from "../file-guard/read-audit-write";
import { dbAtomicWriteSubState } from "../../lib/db-state-manager";
import { checklistWirePassed } from "../../lib/checklist-hooks";

const SRC = "service-skill-attest";

/**
 * Get required skill names from project.config.json.
 * Falls back to empty array if not configured.
 */
function getRequiredSkills(worktree: string): string[] {
  try {
    const configPath = path.resolve(worktree, ".opencode/project.config.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const list = config?.template_resolution?.required_skill_reads;
    if (Array.isArray(list)) return list.filter((s: string) => typeof s === "string" && s.trim());
  } catch {}
  return [];
}

/**
 * Resolve skill name to the primary attestation target.
 * Prefer SKILL.md for lightweight universal skills; fall back to FULL.md when needed.
 */
function resolveSkillPath(skillName: string, worktree: string): string {
  const skillRoot = path.join(worktree, ".opencode/skills", skillName);
  const skillPath = path.join(skillRoot, "SKILL.md");
  if (fs.existsSync(skillPath)) return skillPath;
  return path.join(skillRoot, "FULL.md");
}

export interface AttestSkillReadInput {
  agent: string;
  sessionID: string;
  worktree: string;
  taskId: string | null;
}

export interface AttestSkillReadResult {
  verified: boolean;
  session_id?: string;
  attested_at?: string;
  files_verified?: Array<{ file: string; timestamp: string | null }>;
  state_written?: boolean;
  error?: string;
  unread_files?: string[];
  hint?: string;
}

/**
 * Verify agent has read all required skill files, write attestation to DB.
 */
export function attestSkillRead(input: AttestSkillReadInput): AttestSkillReadResult {
  const { agent, sessionID, worktree, taskId } = input;

  if (!agent) {
    const msg = "skill_read_attest: agent identity not available.";
    writeLog(SRC, "ERROR", { event: "SKILL-READ-ATTEST-FAIL", detail: msg });
    return { verified: false, error: msg };
  }

  const requiredSkills = getRequiredSkills(worktree);

  if (requiredSkills.length === 0) {
    writeLog(SRC, "INFO", { event: "SKILL-READ-ATTEST-SKIP", detail: "No required skills configured" });
    return { verified: true, session_id: sessionID, attested_at: new Date().toISOString(), files_verified: [], state_written: false };
  }

  const skillPaths = requiredSkills.map((s) => resolveSkillPath(s, worktree));

  writeLog(SRC, "INFO", {
    event: "SKILL-READ-ATTEST",
    session_id: sessionID,
    agent,
    requiredSkills,
    skillPaths,
    taskId,
  });

  const unreadFiles: string[] = [];
  const unreadReasons: string[] = [];
  const readVerifications: Array<{ file: string; timestamp: string | null }> = [];

  for (const filePath of skillPaths) {
    const normalized = normalizeReadAuditPath(filePath);
    const result = verifyRead(agent, filePath);

    if (result.verified && result.matchedEntry) {
      readVerifications.push({ file: normalized, timestamp: result.matchedEntry.timestamp });
    } else {
      unreadFiles.push(normalized);
      unreadReasons.push(`${normalized}: ${result.reason}`);
    }
  }

  const allRead = unreadFiles.length === 0;

  if (allRead) {
    const sessionEntry = {
      session_id: sessionID,
      agent,
      attested_at: new Date().toISOString(),
      files: skillPaths.map((f) => normalizeReadAuditPath(f)),
      verified: true,
    };

    const written = dbAtomicWriteSubState("skill_read_state", (current: any) => {
      current.sessions = current.sessions || {};
      current.sessions[sessionID] = sessionEntry;
    });

    writeLog(SRC, "INFO", {
      event: "SKILL-READ-ATTEST",
      session_id: sessionID,
      status: "passed",
      files_verified: readVerifications.length,
    });

    checklistWirePassed(sessionID, agent, taskId, "skill_read_attested", JSON.stringify(readVerifications));

    return {
      verified: true,
      session_id: sessionID,
      attested_at: sessionEntry.attested_at,
      files_verified: readVerifications,
      state_written: written,
    };
  }

  writeLog(SRC, "WARN", {
    event: "SKILL-READ-ATTEST",
    session_id: sessionID,
    status: "failed",
    unread_files: unreadFiles,
  });

  return {
    verified: false,
    error: `Missing read audit records for ${unreadFiles.length} skill file(s)`,
    unread_files: unreadFiles,
    hint: [
      "Verification failures:",
      ...unreadReasons,
      "",
      "ACTION: You must read the COMPLETE required skill file content, not just the first page.",
      "The read tool paginates large files. To read the full content:",
      "  1. Use read tool without --limit to get the default page",
      "  2. If the file is larger, use --offset and --limit to read remaining pages",
      "  3. Repeat until you have read the ENTIRE file (all lines)",
      `Required skills: ${requiredSkills.join(", ")}`,
      "After reading ALL files completely, re-run skill_read_attest.",
    ].join("\n"),
  };
}
