// service/session/config-attest.ts — Config read attestation
// Per-round reset + attestation logic for P0 checklist
// Optimized 2026-07-01: reduced from 3 files to 1 (Agent.md only)
// opencode.json and project.config.json removed — too large for agent context, not needed for core workflow

import * as fs from "node:fs";
import * as path from "node:path";
import { shouldBlock } from "../enforcement/rule-disposition";
import { writeLog } from "../../lib/log-manager";
import { verifyRead } from "../file-guard/read-audit-verify";
import { normalizeReadAuditPath } from "../file-guard/read-audit-write";
import { dbAtomicWriteSubState } from "../../lib/db-state-manager";
import { checklistWirePassed } from "../../lib/checklist-hooks";
import { resolveAgentProfilePaths } from "../dispatch/agent-target";

const SRC = "service-config-attest";

/**
 * Compute agent config path from agent type.
 */
function resolveAgentConfigPath(agent: string, worktree: string): string {
  const candidates = resolveAgentProfilePaths(agent, worktree);
  return candidates[0] || path.join(worktree, ".opencode", "agents", `${agent}.md`);
}

/**
 * Resolve config file paths for the given agent.
 * Only Agent.md — opencode.json and project.config.json removed (too large, agent doesn't need them).
 */
function resolveConfigPaths(agent: string, worktree: string): string[] {
  return [resolveAgentConfigPath(agent, worktree)];
}

// ════════════════════════════════════════════════
// attestConfigRead
// ════════════════════════════════════════════════

export interface AttestConfigReadInput {
  agent: string;
  sessionID: string;
  worktree: string;
  taskId: string | null;
}

export interface AttestConfigReadResult {
  verified: boolean;
  session_id?: string;
  attested_at?: string;
  files_verified?: Array<{ file: string; timestamp: string | null }>;
  state_written?: boolean;
  error?: string;
  unread_files?: string[];
  unread_details?: Array<{ path: string; reason: string }>;
  hint?: string;
}

/**
 * Verify agent has read mandatory config file (Agent.md), write attestation to DB.
 * Reduced from 3 files to 1 — opencode.json/project.config.json too large for agent context.
 *
 * DEPRECATED (2026-07-07): Per-agent config read attestation is invalid for native
 * agents (build/general/explore don't have individual .opencode/agents/*.md files).
 * Phase 3 replaces this with risk-based skill_read_attest, not per-agent .md gating.
 * Callers: tools/config_read_attest.ts (MCP tool), scope-validate.ts (audit-only).
 */
export function attestConfigRead(input: AttestConfigReadInput): AttestConfigReadResult {
  const { agent, sessionID, worktree, taskId } = input;

  if (!agent) {
    const msg =
      "config_read_attest: agent identity not available. " +
      "Ensure child work was spawned through native Task or the legacy dispatch_subagent wrapper.";
    writeLog(SRC, "ERROR", { event: "CONFIG-READ-ATTEST-FAIL", detail: msg });
    return { verified: false, error: msg };
  }

  const configPaths = resolveConfigPaths(agent, worktree);
  const existingConfigPaths = configPaths.filter((filePath) => fs.existsSync(filePath));

  writeLog(SRC, "INFO", {
    event: "CONFIG-READ-ATTEST",
    session_id: sessionID,
    agent,
    configPaths,
    existingConfigPaths,
    taskId: taskId ?? undefined,
  });

  if (existingConfigPaths.length === 0) {
    writeLog(SRC, "WARN", {
      event: "CONFIG-READ-ATTEST-NO-CONFIG-FILE",
      session_id: sessionID,
      agent,
      detail: `No agent config file found for ${agent}; treating attestation as audit-only`,
    });
    return {
      verified: true,
      session_id: sessionID,
      attested_at: new Date().toISOString(),
      files_verified: [],
      state_written: false,
    };
  }

  const unreadFiles: Array<{ path: string; reason: string }> = [];
  const readVerifications: Array<{ file: string; timestamp: string | null }> = [];

  for (const filePath of existingConfigPaths) {
    const normalized = normalizeReadAuditPath(filePath);
    const result = verifyRead(agent, filePath);

    if (result.verified && result.matchedEntry) {
      readVerifications.push({
        file: normalized,
        timestamp: result.matchedEntry.timestamp,
      });
    } else {
      unreadFiles.push({ path: normalized, reason: result.reason || "No read audit record found" });
    }
  }

  const allRead = unreadFiles.length === 0;

  if (allRead) {
    const sessionEntry = {
      session_id: sessionID,
      agent,
      attested_at: new Date().toISOString(),
      files: existingConfigPaths.map((f) => normalizeReadAuditPath(f)),
      verified: true,
    };

    const written = dbAtomicWriteSubState("config_read_state", (current: any) => {
      current.sessions = current.sessions || {};
      current.sessions[sessionID] = sessionEntry;
    });

    writeLog(SRC, "INFO", {
      event: "CONFIG-READ-ATTEST",
      session_id: sessionID,
      status: "passed",
      files_verified: readVerifications.length,
    });

    checklistWirePassed(
      sessionID,
      agent,
      taskId,
      "config_read_attested",
      JSON.stringify(readVerifications),
    );

    return {
      verified: true,
      session_id: sessionID,
      attested_at: sessionEntry.attested_at,
      files_verified: readVerifications,
      state_written: written,
    };
  }

  writeLog(SRC, "WARN", {
    event: "CONFIG-READ-ATTEST",
    session_id: sessionID,
    status: "failed",
    unread_files: unreadFiles.map((f) => f.path),
    unread_reasons: unreadFiles.map((f) => f.reason),
  });

  return {
    verified: false,
    error: `Config read attest failed for ${unreadFiles.length} file(s): ${unreadFiles.map((f) => `${f.path} — ${f.reason}`).join("; ")}`,
    unread_files: unreadFiles.map((f) => f.path),
    unread_details: unreadFiles,
    hint:
      "Use the read tool to read your role profile completely (.opencode/agents/Orchestrator.md or .opencode/legacy/agent-profiles/<agent>.md), without a limit parameter. Then re-run config_read_attest.",
  };
}

// ════════════════════════════════════════════════
// resetConfigReadPerRound
// ════════════════════════════════════════════════

/**
 * Reset config_read_attested per-round when config-attest-required is blocking.
 * Forces agents to re-read config files every conversation round.
 */
export function resetConfigReadPerRound(sessionID: string, agent: string): void {
  if (!shouldBlock("config-attest-required")) return;
  if (!sessionID) return;

  // 10a: Reset config_read_attested in checklist DB
  try {
    const {
      createChecklistRun,
      resetChecklistItemToPending,
    } = require("../../lib/execution-checklist");
    const run = createChecklistRun({
      opencode_session_id: sessionID,
      agent,
      task_id: null,
    });

    if (run) {
      resetChecklistItemToPending({
        run_id: run.run_id,
        item_key: "config_read_attested",
        reason:
          "per-round re-attestation required by active config-attest policy",
        actor: "service/session/config-attest.ts",
      });

      writeLog(SRC, "INFO", {
        sessionID,
        agent,
        event: "CONFIG-READ-RESET",
        detail: `config_read_attested reset to pending for run=${run.run_id}`,
      });
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      sessionID,
      agent,
      event: "CONFIG-READ-RESET-CHECKLIST-FAILED",
      detail: e.message,
    });
  }

  // 10b: Reset config_read_state substate (defense-in-depth)
  try {
    const {
      dbAtomicWriteSubState,
    } = require("../../lib/db-state-manager");
    dbAtomicWriteSubState("config_read_state", (current: any) => {
      if (current.sessions) {
        delete current.sessions[sessionID];
      }
    });

    writeLog(SRC, "INFO", {
      sessionID,
      agent,
      event: "CONFIG-READ-STATE-RESET",
      detail: `config_read_state substate cleared for session=${sessionID}`,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      sessionID,
      agent,
      event: "CONFIG-READ-STATE-RESET-FAILED",
      detail: e.message,
    });
  }
}
