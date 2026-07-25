// service/session/skill-attest.ts — Skill read attestation
// Verifies agent has read all required skills via read_audit DB
// PT-WM-00R: DB-canonical hard gate contract (2026-07-14)

import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import { verifyRead } from "../file-guard/read-audit-verify";
import { normalizeReadAuditPath } from "../file-guard/read-audit-write";
import { dbAtomicWriteSubState, dbReadSubState } from "../../lib/db-state-manager";
import { checklistWirePassed } from "../../lib/checklist-hooks";
import { resolveTaskId } from "./resolver";
import type { SkillReadSessionFileEntry, SkillReadSessionState, LegacySkillReadSessionState } from "../state/substate-types";

const SRC = "service-skill-attest";

/**
 * Calculate SHA-256 hash of file content
 */
function calculateFileHash(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Calculate canonical hash of required skill set (sorted paths + file hashes)
 */
function calculateRequiredSetHash(files: SkillReadSessionFileEntry[]): string {
  const canonical = files
    .map((f) => ({ path: f.path, file_hash: f.file_hash }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

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

/**
 * Invalidate any existing successful attestation for a session
 */
function invalidateSessionState(sessionID: string): boolean {
  try {
    return dbAtomicWriteSubState("skill_read_state", (current: any) => {
      if (current.sessions && current.sessions[sessionID]) {
        delete current.sessions[sessionID];
      }
    });
  } catch {
    return false;
  }
}

// ── Canonical Identity Resolution (PT-WM-00R2) ─────────────────────────────

/**
 * Canonical identity for skill attestation.
 * - task_scope_id: The authoritative identity for authorization
 *   - "task:<dag_task_id>" for child sessions with dag_task_id
 *   - "session:<sessionID>" for root sessions without dag_task_id
 * - scope_type: Whether this is a task-scoped or session-scoped identity
 * - requested_task_id: Caller-supplied task_id (audit only, never for authorization)
 */
export interface SkillAttestationIdentity {
  task_scope_id: string;
  scope_type: "session" | "task";
  requested_task_id: string | null;
}

/**
 * Resolve canonical identity for skill attestation.
 * 
 * Priority:
 * 1. If session has dag_task_id in session_map → "task:<dag_task_id>"
 * 2. Otherwise → "session:<sessionID>" (root session)
 * 
 * The caller-supplied taskId is preserved for audit but NEVER used for authorization.
 */
export function resolveSkillAttestationIdentity(
  sessionID: string,
  callerTaskId?: string | null,
): SkillAttestationIdentity {
  // 1. Try to get dag_task_id from session_map
  const dagTaskId = resolveTaskId(sessionID);

  if (dagTaskId && dagTaskId.trim() !== "") {
    // Child session with dag_task_id
    return {
      task_scope_id: `task:${dagTaskId}`,
      scope_type: "task",
      requested_task_id: callerTaskId || null,
    };
  }

  // Root session without dag_task_id
  return {
    task_scope_id: `session:${sessionID}`,
    scope_type: "session",
    requested_task_id: callerTaskId || null,
  };
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
  files_verified?: Array<{ file: string; file_hash: string; timestamp: string | null }>;
  state_written?: boolean;
  required_set_hash?: string;
  error?: string;
  unread_files?: string[];
  hint?: string;
}

/**
 * Verify agent has read all required skill files, write attestation to DB atomically.
 * PT-WM-00R2: Hard gate contract - only returns verified:true if DB atomic write succeeds,
 * all required fields match, and fail-closed on any error.
 * 
 * Canonical identity: Uses task_scope_id for authorization (task:<dag_task_id> or session:<sessionID>).
 * The caller-supplied taskId is preserved as requested_task_id for audit only.
 */
export function attestSkillRead(input: AttestSkillReadInput): AttestSkillReadResult {
  const { agent, sessionID, worktree, taskId } = input;

  // First invalidate any existing state for this session to prevent stale reuse
  invalidateSessionState(sessionID);

  if (!agent || !sessionID || !worktree) {
    const msg = "skill_read_attest: Missing required identity fields (agent/sessionID/worktree).";
    writeLog(SRC, "ERROR", { event: "SKILL-READ-ATTEST-FAIL", detail: msg, agent, sessionID });
    return { verified: false, error: msg };
  }

  // Resolve canonical identity (taskId is optional for root sessions)
  const identity = resolveSkillAttestationIdentity(sessionID, taskId);

  const requiredSkills = getRequiredSkills(worktree);

  // Hard gate enabled (FRAMEWORK_SKILL_READ_HARD_GATE=1) requires non-empty required list
  const hardGateEnabled = process.env.FRAMEWORK_SKILL_READ_HARD_GATE === "1";
  if (hardGateEnabled && requiredSkills.length === 0) {
    const msg = "skill_read_attest: Hard gate enabled but required_skill_reads is empty - fail closed.";
    writeLog(SRC, "ERROR", { event: "SKILL-READ-ATTEST-FAIL", detail: msg, agent, sessionID });
    return { verified: false, error: msg };
  }

  if (requiredSkills.length === 0) {
    writeLog(SRC, "INFO", { event: "SKILL-READ-ATTEST-SKIP", detail: "No required skills configured" });
    return { verified: false, error: "No required skills configured" };
  }

  const skillPaths = requiredSkills.map((s) => resolveSkillPath(s, worktree));

  writeLog(SRC, "INFO", {
    event: "SKILL-READ-ATTEST",
    session_id: sessionID,
    agent,
    task_scope_id: identity.task_scope_id,
    scope_type: identity.scope_type,
    requested_task_id: identity.requested_task_id,
    requiredSkills,
    skillPaths,
    hardGateEnabled,
  });

  const unreadFiles: string[] = [];
  const unreadReasons: string[] = [];
  const fileEntries: SkillReadSessionFileEntry[] = [];
  const readVerifications: Array<{ file: string; file_hash: string; timestamp: string | null }> = [];

  for (const filePath of skillPaths) {
    const normalized = normalizeReadAuditPath(filePath);
    const fileHash = calculateFileHash(filePath);

    if (!fileHash) {
      unreadFiles.push(normalized);
      unreadReasons.push(`${normalized}: File not found or unreadable`);
      continue;
    }

    const result = verifyRead(agent, filePath);

    if (result.verified && result.matchedEntry) {
      fileEntries.push({
        path: normalized,
        file_hash: fileHash,
        read_at: result.matchedEntry.timestamp,
      });
      readVerifications.push({
        file: normalized,
        file_hash: fileHash,
        timestamp: result.matchedEntry.timestamp,
      });
    } else {
      unreadFiles.push(normalized);
      unreadReasons.push(`${normalized}: ${result.reason}`);
    }
  }

  const allRead = unreadFiles.length === 0;

  if (allRead) {
    const requiredSetHash = calculateRequiredSetHash(fileEntries);
    const attestedAt = new Date().toISOString();

    const sessionEntry: SkillReadSessionState = {
      session_id: sessionID,
      agent,
      task_scope_id: identity.task_scope_id,
      requested_task_id: identity.requested_task_id,
      required_set_hash: requiredSetHash,
      files: fileEntries,
      verified: true,
      attested_at: attestedAt,
    };

    let written = false;
    try {
      written = dbAtomicWriteSubState("skill_read_state", (current: any) => {
        current.sessions = current.sessions || {};
        current.sessions[sessionID] = sessionEntry;
      });
    } catch (err) {
      const msg = `skill_read_attest: DB write failed: ${err instanceof Error ? err.message : String(err)}`;
      writeLog(SRC, "ERROR", { event: "SKILL-READ-ATTEST-FAIL", detail: msg, agent, sessionID });
      invalidateSessionState(sessionID);
      return { verified: false, error: msg };
    }

    if (!written) {
      const msg = "skill_read_attest: DB atomic write returned false - state not persisted.";
      writeLog(SRC, "ERROR", { event: "SKILL-READ-ATTEST-FAIL", detail: msg, agent, sessionID });
      invalidateSessionState(sessionID);
      return { verified: false, error: msg };
    }

    writeLog(SRC, "INFO", {
      event: "SKILL-READ-ATTEST-PASSED",
      session_id: sessionID,
      agent,
      task_scope_id: identity.task_scope_id,
      scope_type: identity.scope_type,
      requested_task_id: identity.requested_task_id,
      required_set_hash: requiredSetHash,
      files_verified: readVerifications.length,
    });

    checklistWirePassed(sessionID, agent, identity.requested_task_id || "", "skill_read_attested", JSON.stringify(readVerifications));

    return {
      verified: true,
      session_id: sessionID,
      attested_at: attestedAt,
      files_verified: readVerifications,
      state_written: true,
      required_set_hash: requiredSetHash,
    };
  }

  writeLog(SRC, "WARN", {
    event: "SKILL-READ-ATTEST-FAILED",
    session_id: sessionID,
    agent,
    task_scope_id: identity.task_scope_id,
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

/**
 * Validate that a session has a valid skill read attestation.
 * PT-WM-00R2: Used by skill-policy before handler to hard gate non-allowlist tools.
 * Returns {valid: true} only if all fields match current state and hard gate conditions are met.
 * 
 * Canonical identity: Validates task_scope_id matches the resolved canonical identity.
 * Legacy state with task_id but no task_scope_id is treated as invalid (fail-closed).
 */
export interface ValidateSkillAttestationInput {
  agent: string;
  sessionID: string;
  worktree: string;
  taskId: string | null;
}

export interface ValidateSkillAttestationResult {
  valid: boolean;
  reason?: string;
  ruleId?: string;
}

export function validateSkillAttestation(input: ValidateSkillAttestationInput): ValidateSkillAttestationResult {
  const { agent, sessionID, worktree, taskId } = input;
  const hardGateEnabled = process.env.FRAMEWORK_SKILL_READ_HARD_GATE === "1";

  // If hard gate is not enabled, skip validation (backward compatible)
  if (!hardGateEnabled) {
    return { valid: true };
  }

  if (!agent || !sessionID || !worktree) {
    return {
      valid: false,
      reason: "Missing required identity fields for skill attestation validation",
      ruleId: "skill-read-attest-required",
    };
  }

  // Resolve canonical identity for validation
  const identity = resolveSkillAttestationIdentity(sessionID, taskId);

  // Read current required skills and calculate current hash
  const requiredSkills = getRequiredSkills(worktree);
  if (requiredSkills.length === 0) {
    return {
      valid: false,
      reason: "Hard gate enabled but no required skills configured - fail closed",
      ruleId: "skill-read-attest-required",
    };
  }

  // Build current expected file entries
  const currentFiles: SkillReadSessionFileEntry[] = [];
  for (const skillName of requiredSkills) {
    const filePath = resolveSkillPath(skillName, worktree);
    const normalized = normalizeReadAuditPath(filePath);
    const fileHash = calculateFileHash(filePath);
    if (!fileHash) {
      return {
        valid: false,
        reason: `Required skill file not found: ${skillName}`,
        ruleId: "skill-read-attest-required",
      };
    }
    currentFiles.push({ path: normalized, file_hash: fileHash, read_at: null });
  }

  const currentRequiredSetHash = calculateRequiredSetHash(currentFiles);

  // Read DB state
  let state: any;
  try {
    state = dbReadSubState("skill_read_state");
  } catch (err) {
    return {
      valid: false,
      reason: `Failed to read skill attestation state from DB: ${err instanceof Error ? err.message : String(err)}`,
      ruleId: "skill-read-attest-required",
    };
  }

  const sessionState = state?.sessions?.[sessionID] as SkillReadSessionState | undefined;

  if (!sessionState || sessionState.verified !== true) {
    return {
      valid: false,
      reason: "No valid skill read attestation found for current session",
      ruleId: "skill-read-attest-required",
    };
  }

  // Check for legacy state format (fail-closed)
  const legacyState = sessionState as unknown as LegacySkillReadSessionState;
  if (legacyState.task_id && !legacyState.task_scope_id) {
    return {
      valid: false,
      reason: "Legacy state format detected (task_id without task_scope_id) - state is invalid, please re-attest",
      ruleId: "skill-read-attest-legacy",
    };
  }

  // Validate all fields match
  if (sessionState.agent !== agent) {
    return {
      valid: false,
      reason: "Attestation agent identity does not match current agent",
      ruleId: "skill-read-attest-required",
    };
  }

  // Validate canonical identity matches
  if (sessionState.task_scope_id !== identity.task_scope_id) {
    writeLog(SRC, "WARN", {
      event: "SKILL-ATTEST-SCOPE-MISMATCH",
      session_id: sessionID,
      stored_scope: sessionState.task_scope_id,
      resolved_scope: identity.task_scope_id,
      scope_type: identity.scope_type,
    });
    return {
      valid: false,
      reason: `Attestation task_scope_id (${sessionState.task_scope_id}) does not match resolved canonical identity (${identity.task_scope_id})`,
      ruleId: "skill-read-attest-required",
    };
  }

  if (sessionState.required_set_hash !== currentRequiredSetHash) {
    return {
      valid: false,
      reason: "Required skill set or file content has changed since attestation",
      ruleId: "skill-read-attest-required",
    };
  }

  // Validate all required files are present with matching hashes
  const fileMap = new Map(sessionState.files.map((f) => [f.path, f.file_hash]));
  for (const expected of currentFiles) {
    const storedHash = fileMap.get(expected.path);
    if (storedHash !== expected.file_hash) {
      return {
        valid: false,
        reason: `Skill file hash mismatch for ${expected.path} - file may have been modified`,
        ruleId: "skill-read-attest-required",
      };
    }
  }

  return { valid: true };
}
