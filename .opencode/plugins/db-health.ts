// db-health.ts — Plugin: 数据库健康维护（硬化到 OpenCode 生命周期）
// ═══════════════════════════════════════════════════════════════
// Batch 2: DB writes delegated to lib/db-maintenance (runAuditCleanup, runDbVacuum)
// Plugin is now pure middleware: reads DB + delegates writes to infrastructure layer.
//
// @version 2.0.0
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
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

const SRC = "plugin-db-health";

// ── 配置 ──────────────────────────────────────────────────────

const CONFIG = {
  MAX_AUDIT_ROWS: 10_000,
  RETENTION_DAYS: 7,
  MAX_DB_SIZE_MB: 100,
  VACUUM_EVERY_IDLE: 5,
  TABLE_SIZE_WARN_MB: 50,
  GATE_SAMPLE_INTERVAL: 50,
};

// ── 状态 ──────────────────────────────────────────────────────

let _idleCount = 0;
let _gateToolCallCount = 0;
let _lastHealthReport = 0;
const HEALTH_REPORT_INTERVAL = 5 * 60 * 1000;

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, ".opencode/state/framework-state.db");

const GATE_TOOLS = new Set([
  "compliance_gate_check",
  "compliance_gate_arm",
  "compliance_gate_deliver",
  "compliance_gate_approve",
  "compliance_gate_complete",
]);

export default withPluginLifecycle("db-health", {
  "session.created": onSessionCreated,
  "session.idle": onSessionIdle,
  "session.compacted": onSessionCompacted,
  "tool.execute.after": onToolExecuteAfter,
});

// ═══════════════════════════════════════════════════════════════
// session.created — 启动健康检查
// ═══════════════════════════════════════════════════════════════

async function onSessionCreated(_input: any, _output: any) {
  writeLog(SRC, "INFO", {
    event: "DB-HEALTH-STARTUP-CHECK",
    detail: "Session started — running startup health check",
  });

  try {
    const integrity = integrityCheck();
    if (!integrity.ok) {
      writeLog(SRC, "ERROR", {
        event: "DB-HEALTH-INTEGRITY-FAILED",
        detail: `Integrity check failed: ${JSON.stringify(integrity.details)}`,
      });
      return;
    }

    const tableSizes = getTableSizes();
    const dbSizeMB = getDbSizeMB();

    const warnings: string[] = [];
    if (dbSizeMB > CONFIG.MAX_DB_SIZE_MB) {
      warnings.push(`DB size ${dbSizeMB.toFixed(1)}MB exceeds limit ${CONFIG.MAX_DB_SIZE_MB}MB`);
    }
    for (const [table, sizeMB] of Object.entries(tableSizes)) {
      if (sizeMB > CONFIG.TABLE_SIZE_WARN_MB) {
        warnings.push(`Table ${table}: ${sizeMB.toFixed(1)}MB exceeds ${CONFIG.TABLE_SIZE_WARN_MB}MB`);
      }
    }

    if (warnings.length > 0) {
      writeLog(SRC, "WARN", {
        event: "DB-HEALTH-STARTUP-WARNING",
        detail: warnings.join("; "),
      });
      const deleted = runAuditCleanup(CONFIG.RETENTION_DAYS, CONFIG.MAX_AUDIT_ROWS);
      if (deleted > 0) {
        writeLog(SRC, "INFO", {
          event: "DB-HEALTH-STARTUP-CLEANUP",
          detail: `startup cleanup deleted=${deleted}`,
        });
      }
    } else {
      writeLog(SRC, "INFO", {
        event: "DB-HEALTH-STARTUP-OK",
        detail: `db=${dbSizeMB.toFixed(1)}MB tables=${Object.keys(tableSizes).length} integrity=ok`,
      });
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-HEALTH-STARTUP-FAILED",
      detail: e.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// session.idle — 周期性维护
// ═══════════════════════════════════════════════════════════════

async function onSessionIdle(_input: any, _output: any) {
  _idleCount++;

  try {
    const auditRowCount = dbAuditHistoryRowCount();
    if (auditRowCount > CONFIG.MAX_AUDIT_ROWS) {
      writeLog(SRC, "WARN", {
        event: "DB-HEALTH-AUDIT-ROW-LIMIT",
        detail: `gate_audit_history has ${auditRowCount} rows (limit: ${CONFIG.MAX_AUDIT_ROWS})`,
      });
      runAuditCleanup(CONFIG.RETENTION_DAYS, CONFIG.MAX_AUDIT_ROWS);
    }

    if (_idleCount % CONFIG.VACUUM_EVERY_IDLE === 0) {
      writeLog(SRC, "INFO", {
        event: "DB-HEALTH-PERIODIC-MAINTENANCE",
        detail: `idle_count=${_idleCount} — running periodic maintenance`,
      });

      runAuditCleanup(CONFIG.RETENTION_DAYS, CONFIG.MAX_AUDIT_ROWS);

      try {
        const cp = safeCheckpoint();
        writeLog(SRC, "INFO", {
          event: "DB-HEALTH-CHECKPOINT",
          detail: `busy=${cp.busy} log=${cp.log} checkpointed=${cp.checkpointed}`,
        });
      } catch (e: any) {
        writeLog(SRC, "WARN", {
          event: "DB-HEALTH-CHECKPOINT-FAILED",
          detail: e.message,
        });
      }

      const reclaimed = runDbVacuum();
      if (reclaimed > 0) {
        writeLog(SRC, "INFO", {
          event: "DB-HEALTH-VACUUM",
          detail: `freelist_pages=${reclaimed} reclaimed`,
        });
      }

      reportHealthStats();
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-HEALTH-IDLE-MAINTENANCE-FAILED",
      detail: e.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// session.compacted — 压缩后清理
// ═══════════════════════════════════════════════════════════════

async function onSessionCompacted(_input: any, _output: any) {
  writeLog(SRC, "INFO", {
    event: "DB-HEALTH-SESSION-COMPACTED",
    detail: "Session compacted — resetting in-memory health counters",
  });
  _idleCount = 0;
  _gateToolCallCount = 0;
}

// ═══════════════════════════════════════════════════════════════
// tool.execute.after — 写入放大监控
// ═══════════════════════════════════════════════════════════════

async function onToolExecuteAfter(input: any, _output: any) {
  if (!GATE_TOOLS.has(input.tool)) return;
  _gateToolCallCount++;

  if (_gateToolCallCount % CONFIG.GATE_SAMPLE_INTERVAL === 0) {
    try {
      const rowCount = dbAuditHistoryRowCount();
      if (rowCount > CONFIG.MAX_AUDIT_ROWS) {
        writeLog(SRC, "WARN", {
          event: "DB-HEALTH-GATE-AMPLIFICATION",
          detail: `gate_tool_calls=${_gateToolCallCount} audit_rows=${rowCount}`,
        });
        runAuditCleanup(CONFIG.RETENTION_DAYS, CONFIG.MAX_AUDIT_ROWS);
      }
    } catch { /* non-critical */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// Read-only helper functions (remain in plugin)
// ═══════════════════════════════════════════════════════════════

function getTableSizes(): Record<string, number> {
  const result: Record<string, number> = {};
  try {
    const db = getDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    for (const t of tables) {
      try {
        const cols = db
          .query(`PRAGMA table_info("${t.name}")`)
          .all() as { name: string }[];
        const lenExprs = cols
          .map((c) => `COALESCE(LENGTH(CAST("${c.name}" AS TEXT)), 0)`)
          .join(" + ");
        const size = db
          .query(`SELECT SUM(${lenExprs}) as total_bytes FROM "${t.name}"`)
          .get() as { total_bytes: number | null };
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
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, mb]) => `${name}=${mb.toFixed(2)}MB`)
      .join(", ");
    writeLog(SRC, "INFO", {
      event: "DB-HEALTH-REPORT",
      detail: `db=${dbSizeMB.toFixed(1)}MB top=[${topTables}] gate_calls=${_gateToolCallCount} idle_cycles=${_idleCount}`,
    });
  } catch { /* non-critical */ }
}
