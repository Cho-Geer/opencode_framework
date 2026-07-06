// service/dispatch/marker-consume.ts — Auto-dispatch marker consumption
// Source: task-before.ts plugin
// Handles: DB-canonical dispatch dequeue + DISPATCH_TOKEN integrity verification.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { shouldBlock } from "../enforcement/rule-disposition";

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
 * Steps (DB-canonical):
 *   1. Check bypass agents (config-extensible)
 *   2. DB lookup pending dispatch (dbFindPendingDispatch)
 *   3. Load prompt from dispatch_prompt_refs file_path
 *   4. Verify DISPATCH_TOKEN SHA-256 integrity
 *   5. DB dequeue with lease (dbDequeueWithLease)
 */
export function consumeDispatchMarker(params: {
  sessionID: string;
  callID: string;
  prompt: string;
  subagentType: string;
}): MarkerConsumeResult {
  const agent = resolveAgent(params.sessionID) || "unknown";

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
  const directTokenMatch = prompt.match(/\/\/DISPATCH_TOKEN:([a-f0-9]{64})/);
  if (directTokenMatch) {
    const token = directTokenMatch[1];
    const cleanPrompt = prompt.replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
    const expectedHash = crypto.createHash("sha256").update(cleanPrompt).digest("hex");
    if (token !== expectedHash) {
      writeLog("task-before", "runtime", {
        sessionID: params.sessionID,
        callID: params.callID,
        agent,
        level: shouldBlock("dispatch-marker-consume") ? "ERROR" : "WARN",
        event: shouldBlock("dispatch-marker-consume")
          ? "DISPATCH-INTEGRITY-BLOCK"
          : "DISPATCH-INTEGRITY-AUDIT",
        detail: `hash mismatch | expected=${expectedHash.slice(0, 16)}... got=${token.slice(0, 16)}...`,
      });
      if (shouldBlock("dispatch-marker-consume")) {
        return {
          blocked: true,
          message: "[FW-ENFORCE][DISPATCH-INTEGRITY] Task() prompt tampered — DISPATCH_TOKEN hash mismatch.",
        };
      }
      return { blocked: false };
    }

    writeLog("task-before", "runtime", {
      sessionID: params.sessionID,
      callID: params.callID,
      agent,
      event: "TOOL-BEFORE",
      detail: "pass | DISPATCH-INTEGRITY hash verified from inline prompt",
    });

    try {
      const { dbDequeueWithHash } = require("../../lib/dispatch-db");
      const promptHash = crypto.createHash("sha256").update(prompt).digest("hex");
      const entry = dbDequeueWithHash(promptHash, params.sessionID || "unknown");
      if (entry) {
        writeLog("task-before", "runtime", {
          sessionID: params.sessionID,
          callID: params.callID,
          agent,
          event: "DISPATCH-QUEUE-LEASE",
          detail: `Leased dispatch queueId=${entry.id} requestedAgent=${entry.agent_type} dagTaskId=${entry.dag_task_id}`,
        });
      }
    } catch (e: any) {
      writeLog("task-before", "runtime", {
        sessionID: params.sessionID,
        callID: params.callID,
        agent,
        level: "WARN",
        event: "DISPATCH-DB-UNAVAILABLE",
        detail: `DB hash dequeue unavailable: ${e.message}`,
      });
    }

    return { blocked: false };
  }

  // ── DB-canonical dispatch: find pending dispatch ──
  try {
    const { dbFindPendingDispatch } = require("../../lib/dispatch-db");
    const pending = dbFindPendingDispatch(params.subagentType);

    if (pending) {
      // Check prompt file exists
      if (!fs.existsSync(pending.filePath)) {
        writeLog("task-before", "runtime", {
          sessionID: params.sessionID, callID: params.callID, agent,
          level: "ERROR", event: "DISPATCH-PROMPT-FILE-MISSING",
          detail: `Prompt file not found: ${pending.filePath}`,
        });
        if (shouldBlock("dispatch-marker-consume")) {
          return { blocked: true, message: "[FW-ENFORCE][DISPATCH-PROMPT-FILE-MISSING] Prompt blob file missing." };
        }
      } else {
        const fullPrompt = fs.readFileSync(pending.filePath, "utf8");
        if (fullPrompt) {
          prompt = fullPrompt;
          writeLog("task-before", "runtime", {
            sessionID: params.sessionID, callID: params.callID, agent,
            event: "DB-DISPATCH-CONSUMED",
            detail: `Loaded full prompt (${fullPrompt.length} bytes) from ${pending.filePath} | queueId=${pending.queueId}`,
          });
        }
      }
    }
  } catch (e: any) {
    writeLog("task-before", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: "ERROR", event: "DISPATCH-DB-UNAVAILABLE",
      detail: `DB dispatch unavailable: ${e.message}`,
    });
    if (shouldBlock("dispatch-marker-consume")) {
      return { blocked: true, message: "[FW-ENFORCE][DISPATCH-DB-UNAVAILABLE] Dispatch DB unavailable." };
    }
  }

  // ── DISPATCH-INTEGRITY v2: SHA-256 hash verification ──
  const tokenMatch = prompt.match(/\/\/DISPATCH_TOKEN:([a-f0-9]{64})/);

  if (!tokenMatch) {
    writeLog("task-before", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: shouldBlock("dispatch-marker-consume") ? "ERROR" : "WARN",
      event: shouldBlock("dispatch-marker-consume") ? "DISPATCH-INTEGRITY-BLOCK" : "NATIVE-TASK-DISPATCH",
      detail: shouldBlock("dispatch-marker-consume")
        ? "missing DISPATCH_TOKEN"
        : "missing DISPATCH_TOKEN; allowing native Task dispatch path",
    });
    if (shouldBlock("dispatch-marker-consume")) {
      return {
        blocked: true,
        message: "[FW-ENFORCE][DISPATCH-INTEGRITY] Task() prompt missing DISPATCH_TOKEN.",
      };
    }
    return { blocked: false, resolvedPrompt: prompt !== params.prompt ? prompt : undefined };
  }

  const token = tokenMatch[1];
  const cleanPrompt = prompt.replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
  const expectedHash = crypto.createHash("sha256").update(cleanPrompt).digest("hex");

  if (token !== expectedHash) {
    writeLog("task-before", "runtime", {
      sessionID: params.sessionID, callID: params.callID, agent,
      level: shouldBlock("dispatch-marker-consume") ? "ERROR" : "WARN",
      event: shouldBlock("dispatch-marker-consume") ? "DISPATCH-INTEGRITY-BLOCK" : "DISPATCH-INTEGRITY-AUDIT",
      detail: `hash mismatch | expected=${expectedHash.slice(0, 16)}... got=${token.slice(0, 16)}...`,
    });
    if (shouldBlock("dispatch-marker-consume")) {
      return {
        blocked: true,
        message: "[FW-ENFORCE][DISPATCH-INTEGRITY] Task() prompt tampered — DISPATCH_TOKEN hash mismatch.",
      };
    }
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
