// service/session/config-attest.ts — Config read attestation
// Per-round reset + attestation logic for P0 checklist
// Source: session.ts Step 10 + tools/config_read_attest.ts

import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { verifyRead } from "../file-guard/read-audit-verify";
import { normalizeReadAuditPath } from "../file-guard/read-audit-write";
import { dbAtomicWriteSubState } from "../../lib/db-state-manager";
import { checklistWirePassed } from "../../lib/checklist-hooks";

const SRC = "service-config-attest";

/** 3 config files that MUST be read before write permission is granted */
const MANDATORY_CONFIG_FILES = [
  "opencode.json",
  ".opencode/project.config.json",
];

/**
 * Compute agent config path from agent type.
 */
function resolveAgentConfigPath(agent: string, worktree: string): string {
  return path.join(worktree, ".opencode", "agents", `${agent}.md`);
}

/**
 * Resolve all 3 config file paths for the given agent.
 */
function resolveConfigPaths(agent: string, worktree: string): string[] {
  return [
    resolveAgentConfigPath(agent, worktree),
    path.join(worktree, MANDATORY_CONFIG_FILES[0]),
    path.join(worktree, MANDATORY_CONFIG_FILES[1]),
  ];
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
  hint?: string;
}

/**
 * Verify agent has read all 3 mandatory config files, write attestation to DB.
 * Migrated from tools/config_read_attest.ts — Service layer DB write entry.
 */
export function attestConfigRead(input: AttestConfigReadInput): AttestConfigReadResult {
  const { agent, sessionID, worktree, taskId } = input;

  if (!agent) {
    const msg =
      "config_read_attest: agent identity not available. " +
      "Ensure dispatch_subagent() is used to spawn sub-agents.";
    writeLog(SRC, "ERROR", { event: "CONFIG-READ-ATTEST-FAIL", detail: msg });
    return { verified: false, error: msg };
  }

  const configPaths = resolveConfigPaths(agent, worktree);

  writeLog(SRC, "INFO", {
    event: "CONFIG-READ-ATTEST",
    session_id: sessionID,
    agent,
    configPaths,
    taskId,
  });

  const unreadFiles: string[] = [];
  const readVerifications: Array<{ file: string; timestamp: string | null }> = [];

  for (const filePath of configPaths) {
    const normalized = normalizeReadAuditPath(filePath, worktree);
    const result = verifyRead(agent, filePath);

    if (result.verified && result.matchedEntry) {
      readVerifications.push({
        file: normalized,
        timestamp: result.matchedEntry.timestamp,
      });
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
      files: configPaths.map((f) => normalizeReadAuditPath(f, worktree)),
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
    unread_files: unreadFiles,
  });

  return {
    verified: false,
    error: `Missing read audit records for ${unreadFiles.length} config file(s)`,
    unread_files: unreadFiles,
    hint:
      "Run P0 Step 0e: read all 3 config files (agent config, opencode.json, " +
      "project.config.json) using the read tool, then re-run config_read_attest.",
  };
}

// ════════════════════════════════════════════════
// resetConfigReadPerRound
// ════════════════════════════════════════════════

/**
 * Reset config_read_attested per-round (strict/locked mode only).
 * Forces agents to re-read config files every conversation round.
 */
export function resetConfigReadPerRound(sessionID: string, agent: string): void {
  const { getEnforcementMode } = require("../../lib/gate-core");
  const mode = getEnforcementMode();

  if (mode !== "strict" && mode !== "locked") return;
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
          "per-round re-attestation required (strict/locked mode)",
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
