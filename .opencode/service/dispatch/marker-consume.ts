// service/dispatch/marker-consume.ts — Auto-dispatch marker consumption
// Source: task-before.ts plugin
// Handles: auto-dispatch queue dequeue + DISPATCH_TOKEN integrity verification.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { atomicWriteJson } from "../../lib/state-utils";
import { getEnforcementMode } from "../../lib/gate-core";

const SRC = "service-marker-consume";

/**
 * Load dispatch_integrity_bypass_agents from project.config.json.
 */
function getBypassAgents(): string[] {
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = fs.readFileSync(
      path.join(root, ".opencode", "project.config.json"), "utf8",
    );
    const cfg = JSON.parse(raw);
    return cfg?.template_resolution?.dispatch_integrity_bypass_agents ?? [];
  } catch {
    return [];
  }
}

export interface MarkerConsumeResult {
  /** Whether the Task() call should be blocked */
  blocked: boolean;
  /** Error message if blocked */
  message?: string;
  /** Resolved prompt (from auto-dispatch marker) */
  resolvedPrompt?: string;
}

/**
 * Consume auto-dispatch marker and verify DISPATCH_TOKEN integrity.
 * Called by task-before plugin.
 *
 * Steps:
 *   1. Check bypass agents (config-extensible)
 *   2. Consume auto-dispatch marker (queue-based FIFO)
 *   3. Verify DISPATCH_TOKEN SHA-256 integrity
 *   4. DB-canonical dispatch dequeue with lease
 *
 * The hook must update output.args.prompt with resolvedPrompt if provided.
 * The hook must throw if blocked=true in strict/locked mode.
 */
export function consumeDispatchMarker(params: {
  sessionID: string;
  callID: string;
  prompt: string;
  subagentType: string;
}): MarkerConsumeResult {
  const agent = resolveAgent(params.sessionID) || "unknown";
  const mode = getEnforcementMode();
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const dispatchDir = root + "/.task_temp/_dispatch";
  const queuePath = dispatchDir + "/.auto-dispatch.json";
  const legacyPath = dispatchDir + "/.auto-dispatch";

  // ── Config-extensible bypass ──
  const bypassAgents = getBypassAgents();
  if (bypassAgents.includes(params.subagentType)) {
    writeLog("task-before", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: "INFO", event: "DISPATCH-INTEGRITY-BYPASS",
      detail: `Bypass agent "${params.subagentType}" — DISPATCH-INTEGRITY waived per config`,
    });
    return { blocked: false };
  }

  let prompt = params.prompt;

  // ── Auto-dispatch marker consumption ──
  const markerPath = fs.existsSync(queuePath)
    ? queuePath
    : fs.existsSync(legacyPath)
      ? legacyPath
      : null;

  if (markerPath) {
    try {
      const raw = fs.readFileSync(markerPath, "utf8");
      let queue = JSON.parse(raw);
      if (!Array.isArray(queue)) queue = [queue];

      interface AutoDispatchEntry {
        sessionId: string;
        agentType: string;
        taskId: string;
        filePath: string;
        createdAt: number;
      }
      let entry: AutoDispatchEntry | null = null;
      let matchQuality = "";

      // Strategy 1: Exact match by agentType + sessionId
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].agentType === params.subagentType && queue[i].sessionId === params.sessionID) {
          entry = queue.splice(i, 1)[0];
          matchQuality = "exact (agentType+sessionId)";
          break;
        }
      }

      // Strategy 2: Match by agentType only
      if (!entry) {
        for (let i = 0; i < queue.length; i++) {
          if (queue[i].agentType === params.subagentType) {
            entry = queue.splice(i, 1)[0];
            matchQuality = "agentType-only (session mismatch)";
            writeLog("task-before", "runtime", {
              sessionID: params.sessionID, callID: params.callID, agent,
              level: "WARN", event: "AUTO-DISPATCH-SESSION-MISMATCH",
              detail: `Matched by agentType only. Marker sessionId=${entry.sessionId} != current=${params.sessionID}`,
            });
            break;
          }
        }
      }

      // Strategy 3: Take oldest entry (fallback)
      if (!entry && queue.length > 0) {
        entry = queue.shift()!;
        matchQuality = "fallback-oldest (agent MISMATCH)";
        writeLog("task-before", "runtime", {
          sessionID: params.sessionID, callID: params.callID, agent,
          level: "ERROR", event: "AUTO-DISPATCH-AGENT-MISMATCH",
          detail: `No matching entry for ${params.subagentType}. Used oldest: ${entry.agentType}:${entry.taskId}`,
        });

        if ((mode === "strict" || mode === "locked") && entry.agentType !== params.subagentType) {
          return {
            blocked: true,
            message: `[FW-ENFORCE][AUTO-DISPATCH-AGENT-MISMATCH] ` +
              `Task() subagent_type="${params.subagentType}" but marker is for "${entry.agentType}". ` +
              `Re-dispatch with matching agent_type.`,
          };
        }
      }

      if (entry) {
        const fullPrompt = fs.readFileSync(entry.filePath, "utf8");
        if (fullPrompt) {
          prompt = fullPrompt;
          writeLog("task-before", "runtime", {
            sessionID: params.sessionID, callID: params.callID, agent,
            event: "AUTO-DISPATCH-CONSUMED",
            detail: `Loaded full prompt (${fullPrompt.length} bytes) from ${entry.filePath} | match=${matchQuality} | queue=${queue.length} remaining`,
          });
        }

        // Write back remaining queue or delete if empty
        if (markerPath === legacyPath || queue.length === 0) {
          try { fs.unlinkSync(markerPath); } catch {}
        } else {
          try { atomicWriteJson(markerPath, queue); } catch {}
        }
      }
    } catch (e: any) {
      if (e.message && e.message.includes("[FW-ENFORCE]")) {
        return { blocked: true, message: e.message };
      }
      writeLog("task-before", "runtime", {
        sessionID: params.sessionID, callID: params.callID, agent,
        level: "ERROR", event: "AUTO-DISPATCH-FAILED",
        detail: `Cannot load dispatch file from marker: ${e.message}`,
      });
    }
  }

  // ── DISPATCH-INTEGRITY v2: SHA-256 hash verification ──
  const tokenMatch = prompt.match(/\/\/DISPATCH_TOKEN:([a-f0-9]{64})/);

  if (!tokenMatch) {
    if (mode === "strict" || mode === "locked") {
      return {
        blocked: true,
        message: "[FW-ENFORCE][DISPATCH-INTEGRITY] Task() prompt missing DISPATCH_TOKEN. " +
          "All sub-agent dispatches MUST go through dispatch_subagent() first.",
      };
    }
    writeLog("task-before", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: "WARN", event: "TOOL-BEFORE",
      detail: "WARN | DISPATCH-INTEGRITY | missing token (advisory, allowed)",
    });
    return { blocked: false, resolvedPrompt: prompt !== params.prompt ? prompt : undefined };
  }

  const token = tokenMatch[1];
  const cleanPrompt = prompt.replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
  const expectedHash = crypto.createHash("sha256").update(cleanPrompt).digest("hex");

  if (token !== expectedHash) {
    if (mode === "strict" || mode === "locked") {
      return {
        blocked: true,
        message: "[FW-ENFORCE][DISPATCH-INTEGRITY] Task() prompt tampered — DISPATCH_TOKEN hash mismatch.",
      };
    }
    writeLog("task-before", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: "WARN", event: "TOOL-BEFORE",
      detail: `WARN | DISPATCH-INTEGRITY | hash mismatch (advisory) | expected=${expectedHash.slice(0, 16)}... got=${token.slice(0, 16)}...`,
    });
    return { blocked: false, resolvedPrompt: prompt !== params.prompt ? prompt : undefined };
  }

  // Token verified
  writeLog("task-before", "runtime", {
    sessionID: params.sessionID, callID: params.callID, agent,
    event: "TOOL-BEFORE",
    detail: "pass | DISPATCH-INTEGRITY hash verified",
  });

  // ── DB-canonical dispatch dequeue with lease ──
  try {
    const { dbDequeueWithLease, dbGetPendingCount } = require("../../lib/dispatch-db");

    if (params.subagentType) {
      const pendingCount = dbGetPendingCount(params.subagentType);
      if (pendingCount > 0) {
        const entry = dbDequeueWithLease(params.subagentType, params.sessionID || "unknown");
        if (entry) {
          writeLog("task-before", "runtime", {
            sessionID: params.sessionID, callID: params.callID, agent,
            event: "DISPATCH-QUEUE-LEASE",
            detail: `Leased dispatch queueId=${entry.id} agentType=${params.subagentType} dagTaskId=${entry.dag_task_id}`,
          });
        } else {
          writeLog("task-before", "runtime", {
            sessionID: params.sessionID, callID: params.callID, agent,
            level: "WARN", event: "DISPATCH-QUEUE-LEASE-FAILED",
            detail: `DB lease failed for agentType=${params.subagentType}`,
          });
        }
      } else {
        writeLog("task-before", "runtime", {
          sessionID: params.sessionID, callID: params.callID, agent,
          event: "DISPATCH-QUEUE-EMPTY",
          detail: `DB queue empty for agentType=${params.subagentType}`,
        });
      }
    }
  } catch (e: any) {
    writeLog("task-before", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: "WARN", event: "DISPATCH-DB-UNAVAILABLE",
      detail: `DB dispatch unavailable: ${e.message}`,
    });
  }

  return { blocked: false, resolvedPrompt: prompt !== params.prompt ? prompt : undefined };
}
