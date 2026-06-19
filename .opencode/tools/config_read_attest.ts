/**
 * config_read_attest.ts — Config Read Attestation MCP Tool
 * ═══════════════════════════════════════════════════════════════════
 * SA-IMPLEMENT-CONFIG-ATTEST-001 R3 (2026-06-19): New MCP tool for
 * verifying that the agent has read the 3 mandatory config files before
 * being allowed to write via scope-before.ts pre-gate check.
 *
 * The 3 mandatory config files:
 *   1. agent config      — .opencode/agents/{Type}.md
 *   2. opencode.json     — runtime permissions (authoritative source)
 *   3. project.config.json — framework policies + template_resolution
 *
 * Uses verifyRead() from read-audit.ts to cross-check against the
 * read_audit SQLite DB. Writes result to config_read_state sub-state.
 *
 * Logging: writeLog() via log-manager (primary channel).
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-19
 *
 * @see docs/review/framework-refactor/config-attest-pipeline.md
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { verifyRead, normalizeReadAuditPath } from "../lib/read-audit";
import { writeSubState } from "../lib/substate-manager";
import { dbAtomicWriteSubState } from "../lib/db-state-manager";
import { writeLog } from "../lib/log-manager";

const SRC = "tool-config-read-attest";

// ── Constants ──────────────────────────────────────────────────

/** 3 config files that MUST be read before write permission is granted */
const MANDATORY_CONFIG_FILES = [
  "opencode.json",
  ".opencode/project.config.json",
];

/**
 * Compute the agent config path from the agent type.
 * The agent type is resolved from context.agent (dispatch-assigned identity).
 */
function resolveAgentConfigPath(agentType: string, worktree: string): string {
  return path.join(worktree, ".opencode", "agents", `${agentType}.md`);
}

/**
 * Resolve all 3 config file paths for the given agent.
 */
function resolveConfigPaths(agentType: string, worktree: string): string[] {
  return [
    resolveAgentConfigPath(agentType, worktree),
    path.join(worktree, MANDATORY_CONFIG_FILES[0]),
    path.join(worktree, MANDATORY_CONFIG_FILES[1]),
  ];
}

// ── Main Tool ──────────────────────────────────────────────────

export default tool({
  description:
    "Verify that the agent has read all 3 mandatory config files " +
    "(agent config, opencode.json, project.config.json) before being " +
    "allowed to write. Cross-checks against read_audit SQLite DB. " +
    "Writes result to config_read_state sub-state. " +
    "Called by agents during P0 Step 0e.",

  args: {
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },

  async execute(args: { task_id?: string }, context: any) {
    const { agent, sessionID, directory, worktree } = context;
    const taskId = args.task_id || null;

    if (!agent) {
      const msg =
        "config_read_attest: agent identity not available from context";
      writeLog(SRC, "ERROR", {
        event: "CONFIG-READ-ATTEST-FAILED",
        detail: msg,
      });
      return JSON.stringify({ verified: false, error: msg });
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
    const readVerifications: Array<{ file: string; timestamp: string | null }> =
      [];

    for (const filePath of configPaths) {
      // Normalize path for read_audit matching
      const normalized = normalizeReadAuditPath(filePath, worktree);

      // verifyRead returns { verified: boolean, reason: string, matchedEntry?: ReadAuditEntry }
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

    // ── Write to config_read_state sub-state (atomic append to sessions map) ──
    if (allRead) {
      const sessionEntry = {
        session_id: sessionID,
        agent,
        attested_at: new Date().toISOString(),
        files: configPaths.map((f) => normalizeReadAuditPath(f, worktree)),
        verified: true,
      };

      // Atomic append within SQLite transaction — prevents cross-agent overwrites
      // RACE CONDITION FIX (2026-06-19): Uses dbAtomicWriteSubState for concurrent-safe
      // read-modify-write. Each session's attestation is stored in sessions[sessionID].
      // Follows the same pattern as KnowledgeCacheState.session_access.
      const written = dbAtomicWriteSubState("config_read_state", (current) => {
        current.sessions = current.sessions || {};
        current.sessions[sessionID] = sessionEntry;
      });

      writeLog(SRC, "INFO", {
        event: "CONFIG-READ-ATTEST",
        session_id: sessionID,
        status: "passed",
        files_verified: readVerifications.length,
      });

      return JSON.stringify({
        verified: true,
        session_id: sessionID,
        attested_at: sessionEntry.attested_at,
        files_verified: readVerifications,
        state_written: written,
      });
    } else {
      writeLog(SRC, "WARN", {
        event: "CONFIG-READ-ATTEST",
        session_id: sessionID,
        status: "failed",
        unread_files: unreadFiles,
      });

      return JSON.stringify({
        verified: false,
        error: `Missing read audit records for ${unreadFiles.length} config file(s)`,
        unread_files: unreadFiles,
        hint:
          "Run P0 Step 0e: read all 3 config files (agent config, opencode.json, " +
          "project.config.json) using the read tool, then re-run config_read_attest.",
      });
    }
  },
});
