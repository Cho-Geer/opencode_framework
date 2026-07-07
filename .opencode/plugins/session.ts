// plugins/session.ts — Session lifecycle management (consolidated)

// ═══════════════════════════════════════════════════════════════
// Consolidates:
//   1. Original session.ts (chat.message + session lifecycle)
//   2. db-health.ts session hooks (created/idle/compacted)
//   3. task-after.ts experimental.session.compacting hook
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import {
  runStartupCleanup,
  resetConfigReadPerRound,
  writeSessionMapWithConstraint,
  runPreflightAutoMark,
  handleSessionError,
  handleSessionCompacted,
  handleSessionIdle,
  updateMemorySessionMap,
  getMemorySessionMapSize,
  runComplianceAudit,
} from "../service/session";
import { upsertSessionMap } from "../service/session/session-map";

// ── db-health imports (session lifecycle portion) ──
import { getDb } from "../lib/db-manager";
import {
  safeCheckpoint,
  integrityCheck,
  runAuditCleanup,
  runDbVacuum,
} from "../lib/db-maintenance";
import { dbAuditHistoryRowCount } from "../lib/db-state-manager";
import * as fs from "node:fs";
import * as path from "node:path";

// ── gate reminder import (from task-after compaction hook) ──
import { getGateReminderText } from "../service/gate";

// ── skill-summary user-message bridge (v2.2 P0 bug fix) ──
// chat.message is the only hook that carries the raw user message; system.transform
// only receives `{ sessionID?, model }`. Capture here so keyword matching works.
import { captureUserMessage } from "../plugin-handlers/system/skill-summary";

// ═══════════════════════════════════════════════════════════════
// db-health config + state
// ═══════════════════════════════════════════════════════════════

const DB_CONFIG = {
  MAX_AUDIT_ROWS: 10_000,
  RETENTION_DAYS: 7,
  MAX_DB_SIZE_MB: 100,
  VACUUM_EVERY_IDLE: 5,
  TABLE_SIZE_WARN_MB: 50,
};

let _idleCount = 0;
let _lastHealthReport = 0;
const HEALTH_REPORT_INTERVAL = 5 * 60 * 1000;
const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, ".opencode/state/framework-state.db");

// ═══════════════════════════════════════════════════════════════
// Plugin export — all session lifecycle hooks
// ═══════════════════════════════════════════════════════════════

export default withPluginLifecycle("session", {
  "chat.message": chatMessageHook,
  "session.created": onSessionCreated,
  "session.error": handleSessionError,
  "session.compacted": onSessionCompacted,
  "session.idle": onSessionIdle,
  "experimental.session.compacting": onCompacting,
});

// ═══════════════════════════════════════════════════════════════
// session.created — session_map write + db health startup check
// ═══════════════════════════════════════════════════════════════

function onSessionCreated(input: any): void {
  const sid = input?.sessionID || input?.session?.id || "";
  const agent = input?.agent || "";
    if (!sid) return;



  // ── Original: session_map early write ──
  try {
    let parentId: string | undefined;
    try {
      const { Database } = require("bun:sqlite");
      const sdkDbPath = process.env.OPENCODE_DB || `${process.env.HOME}/.local/share/opencode/opencode.db`;
      const sdkDb = new Database(sdkDbPath, { readonly: true });
      const row = sdkDb.query("SELECT parent_id FROM session WHERE id = ?").get(sid) as any;
      parentId = row?.parent_id || undefined;
      sdkDb.close();
    } catch { /* SDK DB may not be available */ }

    upsertSessionMap(sid, agent, undefined, undefined, parentId);
    writeLog("session", "INFO", {
      sessionID: sid, agent,
      event: "SESSION-CREATED-MAP-WRITE",
      detail: `session_map written on session.created (parent=${parentId || "root"})`,
    });

    // ── Grant binding for child sessions ──
    if (parentId) {
      try {
        writeLog("session", "INFO", {
          sessionID: sid, agent,
          event: "GRANT-BIND-LOOKUP-START",
          detail: `Looking up pending dispatch_queue for parentId=${parentId}`,
        });

        const { getDb } = require("../lib/db-manager");
        const db = getDb();
        const now = Date.now();
        const queueEntry = db.query(
          `SELECT dispatch_key FROM dispatch_queue
           WHERE parent_session_id = ? AND dispatch_key IS NOT NULL AND status IN ('pending', 'running')
           ORDER BY created_at DESC LIMIT 1`
        ).get(parentId) as any;

        if (queueEntry?.dispatch_key) {
          writeLog("session", "INFO", {
            sessionID: sid, agent,
            event: "GRANT-BIND-QUEUE-HIT",
            dispatchKey: queueEntry.dispatch_key,
            parentId,
            detail: `Found pending queue entry, attempting bindGrant`,
          });

          const { bindGrant } = require("../service/dispatch/privilege");
          const bound = bindGrant(queueEntry.dispatch_key, sid);
          if (bound) {
            writeLog("session", "INFO", {
              sessionID: sid, agent,
              event: "GRANT-BOUND-ON-SESSION-CREATED",
              grantId: bound.id,
              dispatchKey: queueEntry.dispatch_key,
              parentSession: parentId,
            });
          } else {
            writeLog("session", "WARN", {
              sessionID: sid, agent,
              event: "GRANT-BIND-NO-MATCH",
              dispatchKey: queueEntry.dispatch_key,
              parentId,
              detail: `bindGrant returned null — no pending grant found for dispatch_key`,
            });
          }

          // Repo grant binding (parallel to framework grant)
          try {
            const { bindRepoGrant } = require("../service/repo/grants");
            const repoBound = bindRepoGrant(queueEntry.dispatch_key, sid);
            if (repoBound) {
              writeLog("session", "INFO", {
                sessionID: sid, agent,
                event: "REPO-GRANT-BOUND-ON-SESSION-CREATED",
                grantId: repoBound.id,
                dispatchKey: queueEntry.dispatch_key,
                privilege: repoBound.privilege,
              });
            }
          } catch { /* non-blocking: repo grant binding is best-effort */ }
        } else {
          writeLog("session", "INFO", {
            sessionID: sid, agent,
            event: "GRANT-BIND-QUEUE-MISS",
            parentId,
            detail: `No pending dispatch_queue entry for parent session`,
          });
        }
      } catch (e: any) {
        writeLog("session", "WARN", {
          sessionID: sid, agent,
          event: "GRANT-BIND-ON-CREATE-FAILED",
          detail: `Non-blocking: ${e.message}`,
        });
      }
    }
  } catch (e: any) {
    writeLog("session", "WARN", {
      sessionID: sid, agent,
      event: "SESSION-CREATED-MAP-WRITE-FAILED",
      detail: e.message,
    });
  }

  // ── db-health: startup health check ──
  try {
    writeLog("plugin-db-health", "INFO", {
      event: "DB-HEALTH-STARTUP-CHECK",
      detail: "Session started — running startup health check",
    });

    const integrity = integrityCheck();
    if (!integrity.ok) {
      writeLog("plugin-db-health", "ERROR", {
        event: "DB-HEALTH-INTEGRITY-FAILED",
        detail: `Integrity check failed: ${JSON.stringify(integrity.details)}`,
      });
      return;
    }

    const tableSizes = getTableSizes();
    const dbSizeMB = getDbSizeMB();
    const warnings: string[] = [];

    if (dbSizeMB > DB_CONFIG.MAX_DB_SIZE_MB) {
      warnings.push(`DB size ${dbSizeMB.toFixed(1)}MB exceeds limit ${DB_CONFIG.MAX_DB_SIZE_MB}MB`);
    }
    for (const [table, sizeMB] of Object.entries(tableSizes)) {
      if (sizeMB > DB_CONFIG.TABLE_SIZE_WARN_MB) {
        warnings.push(`Table ${table}: ${sizeMB.toFixed(1)}MB exceeds ${DB_CONFIG.TABLE_SIZE_WARN_MB}MB`);
      }
    }

    if (warnings.length > 0) {
      writeLog("plugin-db-health", "WARN", {
        event: "DB-HEALTH-STARTUP-WARNING",
        detail: warnings.join("; "),
      });
      const deleted = runAuditCleanup(DB_CONFIG.RETENTION_DAYS, DB_CONFIG.MAX_AUDIT_ROWS);
      if (deleted > 0) {
        writeLog("plugin-db-health", "INFO", {
          event: "DB-HEALTH-STARTUP-CLEANUP",
          detail: `startup cleanup deleted=${deleted}`,
        });
      }
    } else {
      writeLog("plugin-db-health", "INFO", {
        event: "DB-HEALTH-STARTUP-OK",
        detail: `db=${dbSizeMB.toFixed(1)}MB tables=${Object.keys(tableSizes).length} integrity=ok`,
      });
    }
  } catch (e: any) {
    writeLog("plugin-db-health", "ERROR", {
      event: "DB-HEALTH-STARTUP-FAILED", detail: e.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// chat.message — orchestration only, all logic in Service
// ═══════════════════════════════════════════════════════════════

async function chatMessageHook(input: any, _output: any) {
  const agent = input.agent || "";
  const sid = input.sessionID || "";

  
  writeLog("session", "runtime", {
    sessionID: sid, agent, event: "CHAT-HOOK", detail: "enter",
  });

  if (!sid || !agent) {
        writeLog("session", "runtime", {
      sessionID: sid, agent, event: "CHAT-HOOK", detail: "exit (no sid/agent)",
    });
    return;
  }

  writeLog("session", "INFO", {
    sessionID: sid, agent, event: "ROUND-START",
    detail: "new conversation round detected",
  });

  try { runStartupCleanup(sid, agent); } catch { /* never block */ }
  try { resetConfigReadPerRound(sid, agent); } catch { /* never block */ }
  try { runComplianceAudit(sid, agent); } catch { /* never block */ }

  // ── Grant binding for child sessions (via chat.message, since session.created hook may not fire) ──
  try {
    const { Database } = require("bun:sqlite");
    const sdkDbPath = process.env.OPENCODE_DB || `${process.env.HOME}/.local/share/opencode/opencode.db`;
    const sdkDb = new Database(sdkDbPath, { readonly: true });
    const sessionRow = sdkDb.query("SELECT parent_id FROM session WHERE id = ?").get(sid) as any;
    const parentId = sessionRow?.parent_id || undefined;
    sdkDb.close();

    if (parentId) {
      const db = getDb();
      const queueEntry = db.query(
        `SELECT dispatch_key FROM dispatch_queue
         WHERE parent_session_id = ? AND dispatch_key IS NOT NULL AND status IN ('pending', 'running')
         ORDER BY created_at DESC LIMIT 1`
      ).get(parentId) as any;

      if (queueEntry?.dispatch_key) {
        const { bindGrant } = require("../service/dispatch/privilege");
        const bound = bindGrant(queueEntry.dispatch_key, sid);
        if (bound) {
          writeLog("session", "INFO", {
            sessionID: sid, agent,
            event: "GRANT-BOUND-ON-CHAT-MESSAGE",
            grantId: bound.id,
            dispatchKey: queueEntry.dispatch_key,
            parentSession: parentId,
          });
        }

        // Repo grant binding on chat.message
        try {
          const { bindRepoGrant } = require("../service/repo/grants");
          const repoBound = bindRepoGrant(queueEntry.dispatch_key, sid);
          if (repoBound) {
            writeLog("session", "INFO", {
              sessionID: sid, agent,
              event: "REPO-GRANT-BOUND-ON-CHAT-MESSAGE",
              grantId: repoBound.id,
              dispatchKey: queueEntry.dispatch_key,
              privilege: repoBound.privilege,
            });
          }
        } catch { /* non-blocking: repo grant binding is best-effort */ }
      }
    }
  } catch { /* non-blocking: grant binding is best-effort */ }

  try {
    writeSessionMapWithConstraint(sid, agent);
    runPreflightAutoMark(sid, agent);
    updateMemorySessionMap(sid, agent);

    // ── skill-summary user-message bridge (v2.2) ──
    // Extract text parts from output.parts (Part[] shape per @opencode-ai/plugin SDK)
    // and store in cross-hook Map keyed by sessionID. Cap at 4KB to bound memory.
    try {
      const parts = Array.isArray(_output?.parts) ? _output.parts : [];
      const text = parts
        .filter((p: any) => p && (p.type === "text" || typeof p.text === "string"))
        .map((p: any) => typeof p.text === "string" ? p.text : "")
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000);
      if (text) captureUserMessage(sid, text);
    } catch { /* bridge is best-effort */ }

    writeLog("session", "runtime", {
      sessionID: sid, agent, event: "CHAT-HOOK",
      detail: `exit (ok) map size=${getMemorySessionMapSize()}`,
    });
  } catch (err: any) {
    writeLog("session", "runtime", {
      sessionID: sid, agent, level: "ERROR", event: "CHAT-HOOK",
      detail: `exit (error) ${err.message}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// session.idle — periodic DB maintenance (from db-health)
// ═══════════════════════════════════════════════════════════════

async function onSessionIdle(input: any, output: any) {
  // ── Original session idle handler ──
  await handleSessionIdle(input);

  // ── db-health: periodic maintenance ──
  _idleCount++;
  try {
    const auditRowCount = dbAuditHistoryRowCount();
    if (auditRowCount > DB_CONFIG.MAX_AUDIT_ROWS) {
      writeLog("plugin-db-health", "WARN", {
        event: "DB-HEALTH-AUDIT-ROW-LIMIT",
        detail: `gate_audit_history has ${auditRowCount} rows (limit: ${DB_CONFIG.MAX_AUDIT_ROWS})`,
      });
      runAuditCleanup(DB_CONFIG.RETENTION_DAYS, DB_CONFIG.MAX_AUDIT_ROWS);
    }

    if (_idleCount % DB_CONFIG.VACUUM_EVERY_IDLE === 0) {
      writeLog("plugin-db-health", "INFO", {
        event: "DB-HEALTH-PERIODIC-MAINTENANCE",
        detail: `idle_count=${_idleCount} — running periodic maintenance`,
      });
      runAuditCleanup(DB_CONFIG.RETENTION_DAYS, DB_CONFIG.MAX_AUDIT_ROWS);

      try {
        const cp = safeCheckpoint();
        writeLog("plugin-db-health", "INFO", {
          event: "DB-HEALTH-CHECKPOINT",
          detail: `busy=${cp.busy} log=${cp.log} checkpointed=${cp.checkpointed}`,
        });
      } catch (e: any) {
        writeLog("plugin-db-health", "WARN", {
          event: "DB-HEALTH-CHECKPOINT-FAILED", detail: e.message,
        });
      }

      const reclaimed = runDbVacuum();
      if (reclaimed > 0) {
        writeLog("plugin-db-health", "INFO", {
          event: "DB-HEALTH-VACUUM",
          detail: `freelist_pages=${reclaimed} reclaimed`,
        });
      }
      reportHealthStats();
    }
  } catch (e: any) {
    writeLog("plugin-db-health", "ERROR", {
      event: "DB-HEALTH-IDLE-MAINTENANCE-FAILED", detail: e.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// session.compacted — reset counters (from db-health + original)
// ═══════════════════════════════════════════════════════════════

async function onSessionCompacted(input: any, output: any) {
  // ── Original compacted handler ──
  await handleSessionCompacted(input);

  // ── db-health: reset counters ──
  writeLog("plugin-db-health", "INFO", {
    event: "DB-HEALTH-SESSION-COMPACTED",
    detail: "Session compacted — resetting in-memory health counters",
  });
  _idleCount = 0;
}

// ═══════════════════════════════════════════════════════════════
// experimental.session.compacting — gate reminder (from task-after)
// ═══════════════════════════════════════════════════════════════

async function onCompacting(input: any, output: any): Promise<void> {
  try {
    const text = getGateReminderText();
    if (!text) return;
    if (!output || typeof output.context?.push !== "function") return;
    output.context.push(text);
  } catch {
    // Best-effort
  }
}

// ═══════════════════════════════════════════════════════════════
// db-health helpers (read-only)
// ═══════════════════════════════════════════════════════════════

function getTableSizes(): Record<string, number> {
  const result: Record<string, number> = {};
  try {
    const db = getDb();
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    for (const t of tables) {
      try {
        const cols = db.query(`PRAGMA table_info("${t.name}")`).all() as { name: string }[];
        const lenExprs = cols.map((c) => `COALESCE(LENGTH(CAST("${c.name}" AS TEXT)), 0)`).join(" + ");
        const size = db.query(`SELECT SUM(${lenExprs}) as total_bytes FROM "${t.name}"`).get() as { total_bytes: number | null };
        result[t.name] = (size.total_bytes || 0) / 1024 / 1024;
      } catch { result[t.name] = 0; }
    }
  } catch { /* skip */ }
  return result;
}

function getDbSizeMB(): number {
  try {
    if (fs.existsSync(DB_PATH)) return fs.statSync(DB_PATH).size / 1024 / 1024;
  } catch { /* skip */ }
  return 0;
}

function reportHealthStats() {
  const now = Date.now();
  if (now - _lastHealthReport < HEALTH_REPORT_INTERVAL) return;
  _lastHealthReport = now;
  try {
    const tableSizes = getTableSizes();
    const dbSizeMB = getDbSizeMB();
    const topTables = Object.entries(tableSizes)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, mb]) => `${name}=${mb.toFixed(2)}MB`).join(", ");
    writeLog("plugin-db-health", "INFO", {
      event: "DB-HEALTH-REPORT",
      detail: `db=${dbSizeMB.toFixed(1)}MB top=[${topTables}] idle_cycles=${_idleCount}`,
    });
  } catch { /* non-critical */ }
}
