// service/session/rule-attest.ts — Rule read attestation
// Verifies agent has read all required rules via read_audit DB
// Part of agent-read-enforcement blueprint (2026-07-01)

import * as path from "node:path";
import * as fs from "node:fs";
import { writeLog } from "../../lib/log-manager";
import { verifyRead } from "../file-guard/read-audit-verify";
import { normalizeReadAuditPath } from "../file-guard/read-audit-write";
import { dbAtomicWriteSubState } from "../../lib/db-state-manager";
import { checklistWirePassed } from "../../lib/checklist-hooks";

const SRC = "service-rule-attest";

/**
 * Get required rule file paths from project.config.json.
 * Paths are relative to project root (worktree).
 * Falls back to empty array if not configured.
 */
function getRequiredRules(worktree: string): string[] {
  try {
    const configPath = path.resolve(worktree, ".opencode/project.config.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const list = config?.template_resolution?.required_rule_reads;
    if (Array.isArray(list)) return list.filter((s: string) => typeof s === "string" && s.trim());
  } catch {}
  return [];
}

/**
 * Resolve relative rule path to absolute path.
 */
function resolveRulePath(rulePath: string, worktree: string): string {
  if (path.isAbsolute(rulePath)) return rulePath;
  return path.join(worktree, rulePath);
}

export interface AttestRuleReadInput {
  agent: string;
  sessionID: string;
  worktree: string;
  taskId: string | null;
}

export interface AttestRuleReadResult {
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
 * Verify agent has read all required rule files, write attestation to DB.
 */
export function attestRuleRead(input: AttestRuleReadInput): AttestRuleReadResult {
  const { agent, sessionID, worktree, taskId } = input;

  if (!agent) {
    const msg = "rule_read_attest: agent identity not available.";
    writeLog(SRC, "ERROR", { event: "RULE-READ-ATTEST-FAIL", detail: msg });
    return { verified: false, error: msg };
  }

  const requiredRules = getRequiredRules(worktree);

  if (requiredRules.length === 0) {
    writeLog(SRC, "INFO", { event: "RULE-READ-ATTEST-SKIP", detail: "No required rules configured" });
    return { verified: true, session_id: sessionID, attested_at: new Date().toISOString(), files_verified: [], state_written: false };
  }

  const rulePaths = requiredRules.map((r) => resolveRulePath(r, worktree));

  writeLog(SRC, "INFO", {
    event: "RULE-READ-ATTEST",
    session_id: sessionID,
    agent,
    requiredRules,
    rulePaths,
    taskId,
  });

  const unreadFiles: string[] = [];
  const readVerifications: Array<{ file: string; timestamp: string | null }> = [];

  for (const filePath of rulePaths) {
    const normalized = normalizeReadAuditPath(filePath);
    const result = verifyRead(agent, filePath);

    if (result.verified && result.matchedEntry) {
      readVerifications.push({ file: normalized, timestamp: result.matchedEntry.timestamp });
    } else {
      unreadFiles.push(normalized);
    }
  }

  const allRead = unreadFiles.length === 0;

  if (allRead) {
    const sessionEntry = {
      session_id: sessionID,
      agent,
      attested_at: new Date().toISOString(),
      files: rulePaths.map((f) => normalizeReadAuditPath(f)),
      verified: true,
    };

    const written = dbAtomicWriteSubState("rule_read_state", (current: any) => {
      current.sessions = current.sessions || {};
      current.sessions[sessionID] = sessionEntry;
    });

    writeLog(SRC, "INFO", {
      event: "RULE-READ-ATTEST",
      session_id: sessionID,
      status: "passed",
      files_verified: readVerifications.length,
    });

    checklistWirePassed(sessionID, agent, taskId, "rule_read_attested", JSON.stringify(readVerifications));

    return {
      verified: true,
      session_id: sessionID,
      attested_at: sessionEntry.attested_at,
      files_verified: readVerifications,
      state_written: written,
    };
  }

  writeLog(SRC, "WARN", {
    event: "RULE-READ-ATTEST",
    session_id: sessionID,
    status: "failed",
    unread_files: unreadFiles,
  });

  return {
    verified: false,
    error: `Missing read audit records for ${unreadFiles.length} rule file(s)`,
    unread_files: unreadFiles,
    hint: `Read all required rule files using the read tool, then re-run rule_read_attest.`,
  };
}
