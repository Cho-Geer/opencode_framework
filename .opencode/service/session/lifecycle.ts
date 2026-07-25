import { generateRoundSummary } from "./round-summary";
// service/session/lifecycle.ts — Session lifecycle management
// 9-step startup cleanup + session map write + preflight auto-mark
// + session event handlers (error/compacted/idle)
// Source: session.ts (chatMessageHook, error/compacted/idle hooks)

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { isInterruptError } from "../../lib/interrupt-guard";
import { atomicWriteJson } from "../../lib/state-utils";
import { getDb } from "../../lib/db-manager";
import { markChecklistRunInterrupted } from "../../lib/execution-checklist";
import { isDagExempt } from "../../lib/agent-identity";
import {
  resolveTaskIdWithSource,
  resolveDomainIdWithSource,
} from "./resolver";
import { upsertSessionMap, cleanOrphanSessionMaps } from "./session-map";
import { resetConfigReadPerRound } from "./config-attest";
import { handleGateSessionInterrupted } from "../gate/session-context-service";

const SRC = "service-lifecycle";
const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const INTERRUPT_SENTINEL_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "state",
  ".last-interrupt.json",
);

// In-memory session map — reset on session.compacted to avoid stale scope.
let _sessionMap: Record<string, { agent: string; ts: string }> = {};

// ── Gate stale threshold helper ────────────────────────────────────

function _readGateThreshold(key: string, defaultValue: number): number {
  const { readGateStaleThresholds } = require("../../lib/gate-stale");
  const thresholds = readGateStaleThresholds();
  const val = (thresholds as any)[key];
  return typeof val === "number" && val > 0 ? val : defaultValue;
}

// ═══════════════════════════════════════════════════════════════════
// 9-Step Startup Cleanup
// ═══════════════════════════════════════════════════════════════════

export function runStartupCleanup(sessionID: string, agent: string): void {
  let db: any = null;
  try { db = getDb(); } catch { /* DB unavailable */ }

  // Step 1: Mark stuck dispatch_payload checklist runs as interrupted
  try {
    if (db) {
      const interrupted = markChecklistRunInterrupted("dispatch_payload", "active");
      if (interrupted > 0) {
        writeLog(SRC, "INFO", { sessionID, agent, event: "CHECKLIST-INTERRUPT-CLEANUP",
          detail: `${interrupted} stuck dispatch_payload checklist run(s) marked as interrupted` });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "CHECKLIST-INTERRUPT-CLEANUP-FAILED", detail: e.message });
  }

  // Step 2: Drain stale delivered/approved gate sessions
  try {
    if (db) {
      const deliveredHours = _readGateThreshold("delivered_hours", 4);
      const approvedHours = _readGateThreshold("approved_hours", 4);
      const thresholdMs = Math.max(deliveredHours, approvedHours) * 3600000;
      const txn = db.transaction(() => {
        const staleCutoff = Date.now() - thresholdMs;
        const result = db.run(
          `UPDATE gate_sessions SET status = 'drained', updated_at = ?
           WHERE status IN ('delivered', 'approved') AND consumed_at IS NULL AND created_at < ?`,
          [Date.now(), staleCutoff],
        );
        return result.changes;
      });
      const drained = txn();
      if (drained > 0) {
        writeLog(SRC, "INFO", { sessionID, agent, event: "GATE-DRAIN-STALE-DELIVERED",
          detail: `${drained} stale delivered/approved gate session(s) drained` });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "GATE-DRAIN-DELIVERED-FAILED", detail: e.message });
  }

  // Step 3: Drain stale armed gate sessions (includes interrupt orphans with null confirmed_at)
  try {
    if (db) {
      const txn = db.transaction(() => {
        const armedHours = _readGateThreshold("startup_cleanup_armed_hours", 1);
        const armedCutoff = Date.now() - armedHours * 3600000;
        const result = db.run(
          `UPDATE gate_sessions SET status = 'drained', updated_at = ?
           WHERE status = 'armed' AND consumed_at IS NULL
             AND ((confirmed_at IS NOT NULL AND confirmed_at < ?)
                  OR (confirmed_at IS NULL AND created_at < ?))`,
          [Date.now(), armedCutoff, armedCutoff],
        );
        return result.changes;
      });
      const drained = txn();
      if (drained > 0) {
        writeLog(SRC, "INFO", { sessionID, agent, event: "GATE-DRAIN-STALE-INTERRUPT",
          detail: `${drained} stale armed gate session(s) drained` });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "GATE-DRAIN-STALE-FAILED", detail: e.message });
  }

  // Step 4: Drain stale dispatch_queue entries (>24h)
  try {
    if (db) {
      const staleHours = _readGateThreshold("dispatch_queue_stale_hours", 24);
      const cutoff = Date.now() - staleHours * 3600000;
      const txn = db.transaction(() => {
        const result = db.run(
          `UPDATE dispatch_queue SET status = 'expired', updated_at = ?
           WHERE status IN ('stale', 'pending') AND created_at < ?`,
          [Date.now(), cutoff],
        );
        return result.changes;
      });
      const expired = txn();
      if (expired > 0) {
        writeLog(SRC, "INFO", { sessionID, agent, event: "DISPATCH-QUEUE-CLEANUP",
          detail: `${expired} stale dispatch_queue entries expired (> ${staleHours}h)` });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "DISPATCH-QUEUE-CLEANUP-FAILED", detail: e.message });
  }

  // Step 5: Clean orphan session_map entries
  try {
    const cleaned = cleanOrphanSessionMaps();
    if (cleaned > 0) {
      writeLog(SRC, "INFO", { sessionID, agent, event: "SESSION-MAP-ORPHAN-CLEANUP",
        detail: `${cleaned} orphan session_map entries removed` });
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "SESSION-MAP-CLEANUP-FAILED", detail: e.message });
  }

  // Step 6: GC orphan ctx/*.json files
  try {
    const ctxDir = path.join(PROJECT_ROOT, ".task_temp", "_dispatch", "ctx");
    if (fs.existsSync(ctxDir)) {
      const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
      let cleaned = 0;
      for (const f of files) {
        const dagTaskId = f.replace(".json", "");
        let exists = false;
        try {
          if (db) {
            const row = db.query("SELECT 1 FROM session_map WHERE dag_task_id = ?").get(dagTaskId);
            exists = !!row;
          }
        } catch {
          // FW-DB-CANONICAL-13: Defense-in-depth — prevent mass deletion on query failure
          exists = true;
        }
        if (!exists) {
          try { fs.unlinkSync(path.join(ctxDir, f)); cleaned++; } catch { /* skip */ }
        }
      }
      if (cleaned > 0) {
        writeLog(SRC, "INFO", { sessionID, agent, event: "CTX-FILE-GC",
          detail: `${cleaned} orphan ctx/*.json files removed` });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "CTX-FILE-GC-FAILED", detail: e.message });
  }

  // Step 7: GC orphan prompt files (>24h, not referenced in DB)
  try {
    const dispatchDir = path.join(PROJECT_ROOT, ".task_temp", "_dispatch");
    if (fs.existsSync(dispatchDir)) {
      const promptFiles = fs.readdirSync(dispatchDir)
        .filter((f) => f.startsWith("dispatch-") && f.endsWith(".md"));
      let cleaned = 0;
      for (const f of promptFiles) {
        const filePath = path.join(dispatchDir, f);
        try {
          let referenced = false;
          if (db) {
            const ref = db.query("SELECT 1 FROM dispatch_prompt_refs WHERE file_path = ?").get(filePath);
            referenced = !!ref;
          }
          if (!referenced) {
            const stat = fs.statSync(filePath);
            if (Date.now() - stat.mtimeMs > 24 * 3600000) {
              fs.unlinkSync(filePath);
              cleaned++;
            }
          }
        } catch { /* skip per-file errors */ }
      }
      if (cleaned > 0) {
        writeLog(SRC, "INFO", { sessionID, agent, event: "PROMPT-FILE-GC",
          detail: `${cleaned} orphan prompt files removed` });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "PROMPT-FILE-GC-FAILED", detail: e.message });
  }

  // Step 8: Clear interrupt sentinel
  try {
    clearInterruptSentinel();
    writeLog(SRC, "INFO", { sessionID, agent, event: "INTERRUPT-SENTINEL-CLEARED",
      detail: "Interrupt sentinel removed" });
  } catch (e: any) {
    writeLog(SRC, "ERROR", { sessionID, agent, event: "INTERRUPT-SENTINEL-CLEAR-FAILED", detail: e.message });
  }

}

// ═══════════════════════════════════════════════════════════════════
// Session map write with FW-SESSION-HOOK-WRITE-CONSTRAINT
// ═══════════════════════════════════════════════════════════════════

export function writeSessionMapWithConstraint(
  sessionID: string,
  agent: string,
): void {
  const taskIdResult = resolveTaskIdWithSource(sessionID);
  const domainResult = resolveDomainIdWithSource(sessionID);

  // FW-SESSION-TRUSTED-SOURCES: child_slot 来自 dispatch router 直接写入，可信
  const TRUSTED_DAG_SOURCES = ["session_map", "child_slot"];
  const TRUSTED_DOMAIN_SOURCES = ["session_map", "child_slot"];

  const dagTaskId =
    TRUSTED_DAG_SOURCES.includes(taskIdResult.resolved_from)
      ? taskIdResult.value || undefined
      : undefined;
  const domainId =
    TRUSTED_DOMAIN_SOURCES.includes(domainResult.resolved_from)
      ? domainResult.value || undefined
      : undefined;

  if (!TRUSTED_DAG_SOURCES.includes(taskIdResult.resolved_from) && taskIdResult.value) {
    writeLog(SRC, "runtime", {
      sessionID, agent, level: "WARN", event: "CHAT-HOOK",
      detail: `dagTaskId skipped: resolved_from=${taskIdResult.resolved_from} — trusted sources: ${TRUSTED_DAG_SOURCES.join(", ")}`,
    });
  }
  if (!TRUSTED_DOMAIN_SOURCES.includes(domainResult.resolved_from) && domainResult.value) {
    writeLog(SRC, "runtime", {
      sessionID, agent, level: "WARN", event: "CHAT-HOOK",
      detail: `domainId skipped: resolved_from=${domainResult.resolved_from} — trusted sources: ${TRUSTED_DOMAIN_SOURCES.join(", ")}`,
    });
  }

  // FW-SESSION-PARENT-ID: 从 SDK session 表读取 parent_id 并传递
  let parentId: string | undefined;
  try {
    const { Database } = require("bun:sqlite");
    const sdkDbPath = process.env.OPENCODE_DB || (process.env.HOME + "/.local/share/opencode/opencode.db");
    const sdkDb = new Database(sdkDbPath, { readonly: true });
    const row = sdkDb.query("SELECT parent_id FROM session WHERE id = ?").get(sessionID) as any;
    parentId = row?.parent_id || undefined;
    sdkDb.close();
  } catch { /* SDK DB 不可用时静默跳过 */ }

  upsertSessionMap(sessionID, agent, dagTaskId, domainId, parentId);
}

// ═══════════════════════════════════════════════════════════════════
// Preflight auto-mark for DAG-exempt main-agent sessions
// ═══════════════════════════════════════════════════════════════════

export function runPreflightAutoMark(
  sessionID: string,
  agent: string,
  dagTaskId?: string,
): void {
  const agentNorm = agent.replace(/^@/, "");
  if (!isDagExempt(agentNorm)) return;

  try {
    const {
      createChecklistRun,
      markChecklistPassed,
    } = require("../../lib/execution-checklist");

    const run = createChecklistRun({
      opencode_session_id: sessionID,
      parent_session_id: null,
      task_id: dagTaskId || null,
      agent: agentNorm,
    });

    markChecklistPassed({
      run_id: run.run_id,
      item_key: "agent_scope_resolved",
      evidence_ref: "session_map:" + sessionID,
      actor: "service/session/lifecycle.ts",
    });

    // Read domain from project.config.json
    const { agent_domain_map } = JSON.parse(
      fs.readFileSync(
        path.join(PROJECT_ROOT, ".opencode", "project.config.json"),
        "utf8",
      ),
    );
    const domain =
      agent_domain_map?.[agentNorm] || agent_domain_map?.["@" + agentNorm];
    if (domain) {
      markChecklistPassed({
        run_id: run.run_id,
        item_key: "domain_resolved",
        evidence_ref: "agent_domain_map:" + domain,
        actor: "service/session/lifecycle.ts",
      });
      markChecklistPassed({
        run_id: run.run_id,
        item_key: "module_scope_declared",
        evidence_ref: "agent_domain_map:" + domain,
        actor: "service/session/lifecycle.ts",
      });
    }

    writeLog(SRC, "INFO", {
      sessionID, agent, event: "PREFLIGHT-AUTO-MARK",
      detail: `DAG-exempt main-agent preflight items auto-marked (run=${run.run_id})`,
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      sessionID, agent, event: "PREFLIGHT-AUTO-MARK-FAILED",
      detail: e.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Session event handlers
// ═══════════════════════════════════════════════════════════════════

export function handleSessionError(input: any): void {
  const sid = input?.sessionID || input?.session?.id || "";
  const error = input?.error ?? input?.message ?? "";
  const errorStr =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : JSON.stringify(error);

  const detection = isInterruptError(error);

  writeLog(SRC, "runtime", {
    sessionID: sid,
    event: "SESSION-ERROR",
    kind: detection.matched ? "interrupt" : "error",
    detail: errorStr.slice(0, 500),
  });

  if (detection.matched) {
    writeInterruptSentinel({
      sessionID: sid,
      reason: detection.reason,
      kind: detection.kind,
      raw: errorStr.slice(0, 500),
    });
    // v37: Interrupt all pending gate call contexts for this session
    handleGateSessionInterrupted(sid, detection.reason || "session_interrupt");
  }
}

export function handleSessionCompacted(input: any): void {
  const sid = input?.sessionID || input?.session?.id || "";
  _sessionMap = {};
  writeLog(SRC, "runtime", {
    sessionID: sid,
    event: "SESSION-COMPACTED",
    detail: "in-memory session map reset",
  });
}

export function handleSessionIdle(input: any): void {
  const sid = input?.sessionID || input?.session?.id || "";
  clearInterruptSentinel();
  writeLog(SRC, "runtime", {
    sessionID: sid,
    event: "SESSION-IDLE",
    detail: "interrupt sentinel cleared",
  });
  try {
    generateRoundSummary(sid);
  } catch {
    /* round-summary generation must never block session.idle */
  }
}

// ── In-memory session map management ───────────────────────────────

export function updateMemorySessionMap(sessionID: string, agent: string): void {
  _sessionMap[sessionID] = { agent, ts: new Date().toISOString() };
}

export function getMemorySessionMapSize(): number {
  return Object.keys(_sessionMap).length;
}

// ── Interrupt sentinel ─────────────────────────────────────────────

function writeInterruptSentinel(info: {
  sessionID: string;
  reason: string;
  kind: string;
  raw: string;
}): void {
  try {
    const payload = {
      interrupted: true,
      sessionID: info.sessionID,
      reason: info.reason,
      kind: info.kind,
      raw_message: info.raw,
      timestamp: new Date().toISOString(),
    };
    atomicWriteJson(INTERRUPT_SENTINEL_PATH, payload);
  } catch {
    /* sentinel write must never break the hook */
  }
}

function clearInterruptSentinel(): void {
  try {
    if (fs.existsSync(INTERRUPT_SENTINEL_PATH)) {
      fs.unlinkSync(INTERRUPT_SENTINEL_PATH);
    }
  } catch {
    /* ignore */
  }
}
