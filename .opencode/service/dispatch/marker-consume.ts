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
  queueId?: number;
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

  // ── QUEUE_ID canonical prompt path (priority over inline DISPATCH_TOKEN) ──
  // When the prompt contains //QUEUE_ID:<id>, we look up the canonical prompt
  // from dispatch_prompt_refs via the queue entry. This avoids relying on
  // the LLM to copy the prompt byte-identically (whitespace/formatting drift
  // in the LLM-copied prompt would break the strict DISPATCH_TOKEN hash).
  if (params.queueId) {
    try {
      const { getDb } = require("../../lib/db-manager");
      const db = getDb();
      const row = db.query(
        `SELECT dq.dispatch_key, dq.dag_task_id, dq.status, pr.file_path, pr.sha256
         FROM dispatch_queue dq
         LEFT JOIN dispatch_prompt_refs pr ON dq.prompt_ref_id = pr.id
         WHERE dq.id = ?`,
      ).get(params.queueId) as any;

      if (row?.file_path && fs.existsSync(row.file_path)) {
        const canonicalPrompt = fs.readFileSync(row.file_path, "utf8");
        const canonicalTokenMatch = canonicalPrompt.match(/\/\/DISPATCH_TOKEN:([a-f0-9]{64})/);

        writeLog("task-before", "runtime", {
          sessionID: params.sessionID, callID: params.callID, agent,
          event: "QUEUE-ID-CANONICAL-LOOKUP",
          queueId: params.queueId,
          filePath: row.file_path,
          status: row.status,
          dispatchKey: row.dispatch_key || "none",
          hasCanonicalToken: !!canonicalTokenMatch,
          canonicalLength: canonicalPrompt.length,
          llmPromptLength: params.prompt.length,
          detail: `Canonical prompt loaded from disk (${canonicalPrompt.length} chars), LLM prompt was ${params.prompt.length} chars`,
        });

        if (canonicalTokenMatch) {
          const token = canonicalTokenMatch[1];
          const cleanPrompt = canonicalPrompt.replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
          const expectedHash = crypto.createHash("sha256").update(cleanPrompt).digest("hex");

          if (token === expectedHash) {
            writeLog("task-before", "runtime", {
              sessionID: params.sessionID, callID: params.callID, agent,
              event: "DISPATCH-INTEGRITY-PASS-CANONICAL",
              detail: `DISPATCH_TOKEN verified against canonical prompt file (not LLM copy)`,
            });

            // Dequeue the specific queue entry by ID (not by agentType — that would lease the earliest pending, which may be a stale entry)
            try {
              const now = Date.now();
              const leaseResult = db.run(
                `UPDATE dispatch_queue SET status = 'running', lease_owner = ?, lease_expiry = ?, updated_at = ?
                 WHERE id = ? AND status = 'pending'`,
                [params.sessionID, now + 45 * 60 * 1000, now, params.queueId],
              );
              const leased = leaseResult?.changes > 0;
              writeLog("task-before", "runtime", {
                sessionID: params.sessionID, callID: params.callID, agent,
                event: "DISPATCH-QUEUE-LEASE",
                requestedQueueId: params.queueId,
                leasedQueueId: leased ? params.queueId : "none",
                dispatchKey: row.dispatch_key || "none",
                detail: leased
                  ? `Precise lease: queueId=${params.queueId} status→running`
                  : `Lease failed: queueId=${params.queueId} not in pending state`,
              });
              if (leased && row.dispatch_key) {
                writeLog("task-before", "runtime", {
                  sessionID: params.sessionID, callID: params.callID, agent,
                  event: "GRANT-BIND-DEFERRED",
                  dispatchKey: row.dispatch_key,
                  detail: `Grant binding deferred to session.created`,
                });
              }
            } catch (e: any) {
              writeLog("task-before", "runtime", {
                sessionID: params.sessionID, callID: params.callID, agent,
                level: "WARN", event: "DISPATCH-DB-UNAVAILABLE",
                detail: `DB lease unavailable (non-blocking): ${e.message}`,
              });
            }

            return { blocked: false, resolvedPrompt: canonicalPrompt };
          } else {
            writeLog("task-before", "runtime", {
              sessionID: params.sessionID, callID: params.callID, agent,
              level: "ERROR", event: "DISPATCH-INTEGRITY-FAIL-CANONICAL",
              detail: `Canonical prompt DISPATCH_TOKEN hash mismatch (file may be corrupted)`,
            });
            if (shouldBlock("dispatch-marker-consume")) {
              return { blocked: true, message: "[FW-ENFORCE][DISPATCH-INTEGRITY] Canonical prompt file DISPATCH_TOKEN corrupted." };
            }
          }
        } else {
          writeLog("task-before", "runtime", {
            sessionID: params.sessionID, callID: params.callID, agent,
            level: "WARN", event: "CANONICAL-PROMPT-NO-TOKEN",
            detail: `Canonical prompt file has no DISPATCH_TOKEN marker`,
          });
        }
      } else {
        writeLog("task-before", "runtime", {
          sessionID: params.sessionID, callID: params.callID, agent,
          level: "WARN", event: "QUEUE-ID-LOOKUP-MISS",
          queueId: params.queueId,
          detail: row ? `Prompt file not found: ${row.file_path}` : `Queue entry ${params.queueId} not found in DB`,
        });
      }
    } catch (e: any) {
      writeLog("task-before", "runtime", {
        sessionID: params.sessionID, callID: params.callID, agent,
        level: "WARN", event: "QUEUE-ID-CANONICAL-FAILED",
        detail: `QUEUE_ID canonical path unavailable, falling back to inline token: ${e.message}`,
      });
    }
    // If canonical path didn't return, fall through to inline token check
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
        if (entry.dispatch_key) {
          writeLog("task-before", "runtime", {
            sessionID: params.sessionID, callID: params.callID, agent,
            event: "GRANT-BIND-DEFERRED",
            dispatchKey: entry.dispatch_key,
            detail: `Grant binding deferred to session.created (child session not yet created)`,
          });
        }
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
          if (entry.dispatch_key) {
            writeLog("task-before", "runtime", {
              sessionID: params.sessionID, callID: params.callID, agent,
              event: "GRANT-BIND-DEFERRED",
              dispatchKey: entry.dispatch_key,
              detail: `Grant binding deferred to session.created (child session not yet created)`,
            });
          }
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
