// ────────────────────────────────────────────────────────────────────
// RETIRED-ROLLBACK — NOT in active execution_order; kept for rollback only
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/phase0-enforce.ts — Phase 0 (initial_read) hard constraint
// Runs BEFORE codegraph/scope/gate/checklist to ensure:
//   1. Checklist run exists (lazy create on first tool call)
//   2. Phase-0 hard block: only read/attest tools allowed during initial_read
// This solves the deadlock where codegraph throws before checklist creates the run.
//
// v0.3 (2026-07-02):
// - MVC: removed direct DB query (findExistingRun → getLatestChecklistRun from service)
// - Fixed TS(2741): status missing in type after createChecklistRun

import { writeLog } from "../../lib/log-manager";
import { isInitialReadAllowed } from "../../service/enforcement/exemptions";
import { resolveAgent, resolveTaskId } from "../../lib/agent-resolver";
import { createChecklistRun, getLatestChecklistRun } from "../../service/gate";
import { resetSoftRejections } from "../../service/enforcement/tool-tracker";

const SRC = "plugin-phase0-enforce";

// Config-driven: reads from enforcement_exemptions.phase0_enforce.initial_read_allowed_tools

// Phase-0 block counter — prevents infinite retry when agent is stuck
const phase0BlockCounter = new Map<string, number>();
const PHASE0_BLOCK_THRESHOLD = 3;

export const name = "phase0-enforce";
export const tools = ["*"];

const TERMINAL_STATUSES = new Set(["interrupted", "completed", "failed"]);

export async function handle(input: any, _output: any): Promise<void> {
  const toolName = input.tool as string;
  const sessionID = input.sessionID || "unknown";

  try {
    const agent = resolveAgent(sessionID) || input.agent || "unknown";
    const taskId = resolveTaskId(sessionID) || null;

    // 1. Find existing run via service layer (MVC: no direct DB queries in hooks)
    const existing = getLatestChecklistRun(sessionID);

    // Terminal state cleanup — reset soft rejections when session ends
    if (existing && TERMINAL_STATUSES.has(existing.status)) {
      resetSoftRejections(sessionID);
    }

    // 2. If no active run exists, create one
    let phase = existing && !TERMINAL_STATUSES.has(existing.status)
      ? existing.phase
      : null;

    if (!phase) {
      try {
        const created = createChecklistRun({
          opencode_session_id: sessionID,
          agent,
          task_id: taskId,
        });
        phase = created.phase;
      } catch (e: any) {
        writeLog(SRC, "WARN", {
          event: "PHASE0-RUN-CREATE-FAILED",
          sessionID, agent, detail: e.message?.slice(0, 80),
        });
        return; // Can't enforce without a run
      }
    }

    // 3. Phase-0 hard constraint
    if (phase === "initial_read") {
      if (!isInitialReadAllowed(toolName)) {
        // Block counter — detect stuck agent
        const blockCount = (phase0BlockCounter.get(sessionID) || 0) + 1;
        phase0BlockCounter.set(sessionID, blockCount);

        writeLog(SRC, "ERROR", {
          event: "PHASE0-HARD-BLOCK",
          sessionID, agent, tool: toolName,
          blockCount,
          detail: `blocked in initial_read phase (attempt ${blockCount})`,
        });

        // After threshold, log deadlock warning
        if (blockCount >= PHASE0_BLOCK_THRESHOLD) {
          writeLog(SRC, "WARN", {
            event: "PHASE0-DEADLOCK-DETECTED",
            sessionID, agent, blockCount,
            detail: `Agent stuck in Phase-0: ${blockCount} blocks on "${toolName}". QoderWork should intervene via prompt_async.`,
          });
        }

        throw new Error(
          `[FW-ENFORCE][PHASE-0] Tool "${toolName}" is BLOCKED during initial_read phase. ` +
          `You MUST first read your role profile (.opencode/agents/Orchestrator.md or .opencode/legacy/agent-profiles/${agent}.md) ` +
          `using the 'read' tool, then read required skill and rule files, ` +
          `then call config_read_attest, skill_read_attest, and rule_read_attest. ` +
          `Only after all attestations pass will other tools become available.\n` +
          `[STOP] Do NOT attempt alternative tools or workarounds. This is a HARD CONSTRAINT.\n` +
          `[ACTION] Use the 'read' tool to read required files, then run the three attest tools.`
        );
      }

      // Tool is allowed — reset block counter
      phase0BlockCounter.delete(sessionID);
    }
  } catch (e: any) {
    if (e.message?.startsWith("[FW-ENFORCE]")) throw e;
    writeLog(SRC, "ERROR", {
      event: "PHASE0-ENFORCE-ERR",
      tool: toolName, sessionID, error: e.message?.slice(0, 120),
    });
  }
}
