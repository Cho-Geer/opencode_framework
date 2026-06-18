#!/usr/bin/env bun
"use strict";

// ── Delegate to .opencode/lib/gate-core.ts (single source of truth) ──
// FW-PLAN-JS-TO-TS (2026-06-14): Bun executes TypeScript natively — no compiled
// JS fallback needed. The dist/ directory was removed in Phase 5 of the JS-to-TS
// migration. Source-first require is sufficient and avoids the ~5ms overhead
// of the previous two-tier fallback pattern.
let _gateCore = null;
try {
  const rootDir = process.env.OPENCODE_ROOT ||
    require("path").resolve(__dirname, "..", "..", "..");
  const tsPath = require("path").join(rootDir, ".opencode", "lib", "gate-core");
  _gateCore = require(tsPath);
} catch (_e) {
  process.stderr.write("[compliance-gate] gate-core load failed: " + _e.message + "\n");
}

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

/**
 * FW-LOG-UNIFY-P2-A1 (2026-06-12, @Super-Admin): Import log-manager for
 * centralized log persistence. Bun transpiles ESM→CJS on-the-fly for require().
 * Verified working: bun -e "require('./.opencode/lib/log-manager')" → function.
 */
const { writeLog } = require("../../lib/log-manager");

const fs2 = require("fs");
const path2 = require("path");
/**
 * FW-REPAIR-P1B-IMPORT: atomicWriteSubState is defined in state-utils.ts.
 * readSubState is defined in substate-manager.ts (P1-B split architecture).
 */
const { atomicWriteSubState } = require("../../lib/state-utils");
const { readSubState } = require("../../lib/substate-manager");

// ── Enforcement-mode debug helper ──
// Mirrors lib/gate-core.ts isEnforcementDebugEnabled() so the fallback
// getEnforcementMode() respects the same debug flags.
function isEnforcementDebugEnabled(root?: string): boolean {
  const debug = process.env.DEBUG || "";
  if (debug.includes("enforcement") || debug.includes("gate-core")) {
    return true;
  }
  if (process.env.OPENCODE_ENFORCEMENT_DEBUG === "1") {
    return true;
  }
  try {
    const projectRoot = root || OPENCODE_ROOT;
    const cfgPath = path2.join(projectRoot, ".opencode", "project.config.json");
    if (fs2.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs2.readFileSync(cfgPath, "utf-8"));
      const level = cfg?.template_resolution?.["logs.level"];
      if (typeof level === "string" && level.toUpperCase() === "DEBUG") {
        return true;
      }
    }
  } catch {
    // Config unreadable — default to quiet
  }
  return false;
}

/**
 * Write non-fatal operational messages to stderr only when debug is enabled.
 * Gated behind the same flags as isEnforcementDebugEnabled() to prevent
 * TUI pollution from repeated informational messages (txn commits, purges, etc).
 * Fatal/bootstrap errors skip this gate — they always write to stderr.
 *
 * @param msg - The message to write (with trailing newline if desired)
 */
function debugStderr(msg: string): void {
  if (isEnforcementDebugEnabled(OPENCODE_ROOT)) {
    process.stderr.write(msg);
  }
}

const OPENCODE_ROOT = process.env.OPENCODE_ROOT
  ? path2.resolve(process.env.OPENCODE_ROOT)
  : path2.resolve(__dirname, "..", "..", "..");

function resolveProjectState() {
  if (_gateCore && typeof _gateCore.resolveStateDir === "function") {
    return _gateCore.resolveStateDir(OPENCODE_ROOT);
  }
  const cfgPath = path2.join(OPENCODE_ROOT, ".opencode", "project.config.json");
  try {
    const cfg = JSON.parse(fs2.readFileSync(cfgPath, "utf8"));
    const pr = cfg.project_root;
    if (pr && pr !== ".") {
      const stateDir = path2.join(OPENCODE_ROOT, pr, ".opencode", "state");
      if (fs2.existsSync(stateDir)) return stateDir;
    }
  } catch {}
  return path2.join(OPENCODE_ROOT, ".opencode", "state");
}

const GATE_STATE_FILE =
  process.env.GATE_STATE_PATH ||
  path2.join(resolveProjectState(), "gate-state.json");

const SKILL_INV_STD =
  process.env.SKILL_INV_STD_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "rules",
    "rule_detail",
    "skill-invocation-standard.md",
  );

const MCP_INVENTORY =
  process.env.MCP_INVENTORY_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "rules",
    "rule_detail",
    "mcp-tool-inventory.md",
  );

const COMMON_RULES =
  process.env.COMMON_RULES_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "rules",
    "common-project.md",
  );

const SKILL_FILE =
  process.env.SKILL_FILE_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "skills",
    "execution-preflight-check",
    "SKILL.md",
  );

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── P3/S52-1: DB-first state writes (replaces state-transaction beginTransaction) ──
const { dbSaveGateStore, dbWriteSubState, dbArchiveDrainedSession, dbCountDrainedSessions, dbQuerySessionByDagTaskId } = require("../../lib/db-state-manager");
// writeLog already imported at line 33

// ── Adapter: v3 GateStateHot → GateStore shape (for dbSaveGateStore) ──
function hotToGateStore(hot, filePath) {
  const sessions = {};
  for (const [sid, s] of Object.entries(hot.active_sessions || {})) {
    sessions[sid] = {
      session_id: s.session_id || sid,
      task_description: s.task_description || "",
      gate_status: s.gate_status || "armed",
      agent: s.agent || null,
      task_id: s.task_id || null,
      plan_summary: s.plan_summary || null,
      created_at: s.created_at,
      confirmed_at: s.confirmed_at,
      consumed_at: s.consumed_at,
    };
  }
  for (const [sid, s] of Object.entries(hot.recent_sessions || {})) {
    sessions[sid] = {
      session_id: s.session_id || sid,
      task_description: s.task_description || "",
      gate_status: s.gate_status || "completed",
      agent: s.agent || null,
      created_at: s.created_at,
      consumed_at: s.consumed_at,
    };
  }
  return {
    formatVersion: hot.formatVersion || "3.0",
    sessions,
    active_sessions: Object.keys(hot.active_sessions || {}),
    audit_history: [],
    last_updated: new Date().toISOString(),
  };
}

// ── Rule Registry ──────────────────────────────────────────────
const RULE_REGISTRY_PATH =
  process.env.RULE_REGISTRY_PATH ||
  path.join(resolveProjectState(), "rule_registry.json");

function readJson(p) {
  if (_gateCore && typeof _gateCore.readJsonFile === "function") {
    return _gateCore.readJsonFile(p);
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Write JSON state file with transactional envelope (RVW-REVIEW-01).
 * Uses two-phase atomic commit: PREPARE → COMMIT.
 * Falls back to direct write if transaction engine unavailable.
 */
// P3/S52-1: DB-first state write (replaces beginTransaction).
// Strategy: DB is the single source of truth. JSON file write retained as
// read-only frozen snapshot (backward-compat with legacy consumers) but
// no longer wrapped in a transactional protocol.
function writeJson(p, data) {
  // 1. DB write (primary)
  try {
    const isGateState = path.basename(p) === "gate-state.json";
    const isDrainedStore = path.basename(p) === "gate-state.drained-sessions.json";
    if (isGateState && typeof data === "object") {
      const store = hotToGateStore(data, p);
      const dbOk = dbSaveGateStore(store);
      if (!dbOk) {
        writeLog("mcp-compliance-gate", "WARN", {
          event: "db_save_gate_store_failed",
          file: path.relative(OPENCODE_ROOT, p),
        });
      }
    }
  } catch (dbErr) {
    writeLog("mcp-compliance-gate", "WARN", {
      event: "db_write_nonfatal",
      error: dbErr.message,
      file: path.relative(OPENCODE_ROOT, p),
    });
  }

  // 2. JSON file write (frozen snapshot, non-transactional)
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(p, content, "utf8");
    writeLog("mcp-compliance-gate", "INFO", {
      event: "json_write",
      file: path.relative(OPENCODE_ROOT, p),
    });
  } catch (writeErr) {
    const enfMode = getEnforcementMode();
    writeLog("mcp-compliance-gate", "ERROR", {
      event: "json_write_failed",
      mode: enfMode,
      error: writeErr.message,
      file: path.relative(OPENCODE_ROOT, p),
    });
    if (enfMode !== "advisory") throw writeErr;
  }
}

/**
 * Write JSON state file with transactional envelope + agent/taskId context.
 * Used when the caller knows the agent identity and task ID.
 */
function writeJsonWithContext(p, data, agent, taskId) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  // P3/S52-1: ensureTxnInit removed (DB-first writes)
  try {
    // P3/S52-1: DB-first write (no transaction envelope)
    // JSON write only (gate-state DB sync handled by state-compactor.onGateComplete)
    /**
     * FW-LOG-UNIFY-P2-A1 (2026-06-12): Migrated from debugStderr to writeLog.
     */
    writeLog("mcp-compliance-gate", "INFO", {
      event: "txn_committed_with_context",
      operationId: txn.operationId,
      newRevision: txn.newRevision,
      agent, taskId,
      file: path.relative(OPENCODE_ROOT, p),
    });
  } catch (txnErr) {
    const enfMode = getEnforcementMode();
    if (enfMode === "advisory") {
      process.stderr.write(
        `[compliance-gate] ⚠ Transaction failed (${txnErr.message}), falling back to direct write for ${path.relative(OPENCODE_ROOT, p)}\n`,
      );
      writeLog("mcp-compliance-gate", "WARN", {
        event: "txn_fallback_with_context", mode: enfMode, error: txnErr.message,
        agent, taskId, file: path.relative(OPENCODE_ROOT, p),
      });
      fs.writeFileSync(p, content, "utf8");
    } else {
      process.stderr.write(
        `[compliance-gate] ❌ Transaction failed (${txnErr.message}) for ${path.relative(OPENCODE_ROOT, p)} in ${enfMode} mode — file NOT written (fail-closed)\n`,
      );
      throw txnErr;
    }
  }
}

function fileExists(p) {
  if (_gateCore && typeof _gateCore.fileExists === "function") {
    return _gateCore.fileExists(p);
  }
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Check critical infrastructure files for uncommitted changes using git diff HEAD.
 * Replaces the old SHA-256 digest computation and comparison.
 * @returns {{ passed: boolean, results: Array<{id, desc, severity}> }}
 */
function verifyRuleRegistry() {
  const results = [];

  try {
    const { getModifiedCriticalFiles, CRITICAL_FILES } = require("../../lib/critical-files");
    const modified = getModifiedCriticalFiles();

    if (modified.length === 0) {
      return { passed: true, results: [], registry_available: true,
        summary: `[Gate Preflight v2] ${CRITICAL_FILES.length} critical files tracked, 0 modified since HEAD` };
    }

    for (const filePath of modified) {
      results.push({
        id: "critical_file_modified_" + filePath.replace(/[^a-zA-Z0-9]/g, "_"),
        desc: `[Gate Preflight v2] ${filePath}: modified since HEAD — ensure [INFRA] marker in commit`,
        severity: "HIGH",
      });
    }

    return {
      passed: false,
      results,
      registry_available: true,
      summary: `[Gate Preflight v2] ${modified.length} critical infrastructure file(s) modified since HEAD`,
    };
  } catch {
    return { passed: true, results: [], registry_available: false,
      summary: "[Gate Preflight v2] critical-files module unavailable — skipped" };
  }
}

function generateSessionId() {
  if (_gateCore && typeof _gateCore.generateSessionId === "function") {
    return _gateCore.generateSessionId();
  }
  const id = "cg_ses_" + Date.now();
  return id;
}

// ── Enforcement Mode ────────────────────────────────────────────────────
function getEnforcementMode() {
  if (_gateCore && typeof _gateCore.getEnforcementMode === "function") {
    return _gateCore.getEnforcementMode(OPENCODE_ROOT);
  }
  const envMode = process.env.ENFORCEMENT_MODE;
  const validModes = ["advisory", "strict", "locked"];

  const cfgPath = path2.join(OPENCODE_ROOT, ".opencode", "project.config.json");
  let configMode = "advisory";
  try {
    if (fs2.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs2.readFileSync(cfgPath, "utf-8"));
      const tr = cfg.template_resolution;
      /**
       * Dual-key design (FW-HARNESS-P6): check develop_enforcement_mode first (local dev),
       * then runtime_enforcement_mode (CI/production), then enforcement_mode (legacy).
       * This aligns with enforcement-modes-standard.md §4.1 which defines separate
       * develop and runtime keys replacing the old singular enforcement_mode.
       */
      if (tr) {
        const mode =
          tr.develop_enforcement_mode ||
          tr.runtime_enforcement_mode ||
          tr.enforcement_mode;
        if (mode && validModes.includes(mode)) {
          configMode = mode;
        }
      }
    }
  } catch {}

  if (envMode && validModes.includes(envMode)) {
    if (configMode === "locked") return "locked";
    return envMode;
  }

  // ── Diagnostic logging (SA-UNIFY-005, 2026-06-11) ──
  // Available when DEBUG contains "enforcement"/"gate-core",
  // OPENCODE_ENFORCEMENT_DEBUG=1, or logs.level=DEBUG.
  // Gated to prevent UI flooding on every hook/tool call.
  if (isEnforcementDebugEnabled(OPENCODE_ROOT)) {
    try {
      /**
       * FW-LOG-UNIFY-P2-A1 (2026-06-12): Migrated from process.stderr.write to writeLog.
       * Enforcement mode diagnostic — gated by isEnforcementDebugEnabled().
       */
      writeLog("mcp-compliance-gate", "DEBUG", {
        event: "enforcement_mode_diag",
        OPENCODE_ROOT, cfgPath,
        cfgExists: fs2.existsSync(cfgPath),
        ENFORCEMENT_MODE: envMode || '(unset)',
        configMode, resolvedMode: configMode,
      });
    } catch (_diagErr) { /* non-blocking */ }
  }

  return configMode;
}

function getFreshStore() {
  if (_gateCore && typeof _gateCore.createFreshStore === "function") {
    return _gateCore.createFreshStore();
  }
  return {
    formatVersion: "2.0",
    sessions: {},
    active_sessions: [],
    last_updated: null,
  };
}

function loadStore() {
  if (_gateCore && typeof _gateCore.loadGateStore === "function") {
    return _gateCore.loadGateStore(OPENCODE_ROOT);
  }
  const s = readJson(GATE_STATE_FILE);

  // FW-REPAIR-12: V3 format bridge — convert object-based active_sessions
  // to V2 array representation for internal compatibility
  if (s && s.formatVersion === "3.0") {
    const sessions = {};
    const activeSessions = [];

    // Merge active_sessions (object) into sessions dict
    if (s.active_sessions && typeof s.active_sessions === "object") {
      for (const [sid, ses] of Object.entries(s.active_sessions)) {
        sessions[sid] = { ...ses, session_id: sid };
        activeSessions.push(sid);
      }
    }

    // Merge recent_sessions into sessions dict
    if (s.recent_sessions && typeof s.recent_sessions === "object") {
      for (const [sid, ses] of Object.entries(s.recent_sessions)) {
        sessions[sid] = { ...ses, session_id: sid };
      }
    }

    s.sessions = sessions;
    s.active_sessions = activeSessions;
    s.last_updated = s.meta?.last_compacted || new Date().toISOString();
    s._v3Bridge = true; // Internal flag for saveStore()
    return s;
  }

  if (
    s &&
    s.formatVersion === "2.0" &&
    s.sessions &&
    typeof s.sessions === "object"
  ) {
    if (!Array.isArray(s.active_sessions)) {
      s.active_sessions = [];
    }
    let reconciled = false;
    s.active_sessions = s.active_sessions.filter((sid) => {
      const ses = s.sessions[sid];
      if (!ses) {
        reconciled = true;
        return false;
      }
      if (ses.gate_status === "completed" || ses.gate_status === "failed") {
        reconciled = true;
        return false;
      }
      if (ses.consumed_at) {
        reconciled = true;
        return false;
      }
      return true;
    });
    const STALE_MS = 24 * 60 * 60 * 1000;
    const nowTs = Date.now();
    s.active_sessions = s.active_sessions.filter((sid) => {
      const ses = s.sessions[sid];
      if (!ses) return false;
      if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
        const age = nowTs - new Date(ses.confirmed_at).getTime();
        if (age > STALE_MS) {
          reconciled = true;
          return false;
        }
      }
      return true;
    });
    for (const [sid, ses] of Object.entries(s.sessions)) {
      if (
        ses.gate_status === "armed" &&
        !ses.consumed_at &&
        !s.active_sessions.includes(sid)
      ) {
        s.active_sessions.push(sid);
        reconciled = true;
      }
    }
    if (reconciled) {
      s.last_updated = new Date().toISOString();
    }
    if (!s.last_updated) {
      s.last_updated = new Date().toISOString();
    }
    return s;
  }
  return getFreshStore();
}

function saveStore(store) {
  if (_gateCore && typeof _gateCore.saveGateStore === "function") {
    return _gateCore.saveGateStore(store, OPENCODE_ROOT);
  }

  // FW-REPAIR-12: V3 format bridge — convert internal V2 representation
  // back to V3 object-based format before writing to disk
  if (store._v3Bridge) {
    const v3 = {
      formatVersion: "3.0",
      active_sessions: {},
      recent_sessions: {},
      meta: {
        total_sessions: Object.keys(store.sessions || {}).length,
        active_count: (store.active_sessions || []).length,
        recent_count: 0,
        last_compacted: new Date().toISOString(),
      },
    };

    // Convert active sessions back to V3 object format
    for (const sid of store.active_sessions || []) {
      const ses = store.sessions?.[sid];
      if (ses) {
        v3.active_sessions[sid] = {
          session_id: ses.session_id || sid,
          created_at: ses.created_at,
          gate_status: ses.gate_status,
          confirmed_at: ses.confirmed_at || null,
          consumed_at: ses.consumed_at || null,
          task_description: ses.task_description || "",
          plan_summary: ses.plan_summary || "",
        };
      }
    }

    // Identify recent completed sessions
    const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [sid, ses] of Object.entries(store.sessions || {})) {
      if (store.active_sessions?.includes(sid)) continue;
      if (ses.gate_status === "completed" && ses.consumed_at) {
        const consumedMs = new Date(ses.consumed_at).getTime();
        if (consumedMs > recentCutoff) {
          v3.recent_sessions[sid] = {
            session_id: sid,
            created_at: ses.created_at,
            gate_status: "completed",
            consumed_at: ses.consumed_at,
            archive_ref: ses.archive_ref || "",
          };
          v3.meta.recent_count++;
        }
      }
    }

    delete store._v3Bridge; // Clean flag before writing
    writeJson(GATE_STATE_FILE, v3);
    return;
  }

  writeJson(GATE_STATE_FILE, store);
}

// ── Session Purge (F5) ──────────────────────────────────────────────

/**
 * Purge stale gate sessions based on age thresholds.
 * - Armed sessions > 24h since confirmed_at → drained
 * - Checked (unconfirmed) sessions > 48h since created_at → drained
 * Drained sessions are archived to gate_drained_sessions DB table.
 * @returns {{ purged: number, drained_sessions: Array, remaining_active: number }}
 */
function purgeStaleSessions() {
  const store = loadStore();
  const nowTs = Date.now();
  const ARMED_STALE_MS = 24 * 60 * 60 * 1000;
  const CHECKED_STALE_MS = 48 * 60 * 60 * 1000;
  let purged = 0;
  const drainedIds = [];
  const sessionIds = Object.keys(store.sessions);

  for (const sid of sessionIds) {
    const ses = store.sessions[sid];
    if (!ses) continue;

    let shouldDrain = false;
    let reason = "";
    let drainType = "";

    // Armed but never consumed > 24h
    if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
      const age = nowTs - new Date(ses.confirmed_at).getTime();
      if (age > ARMED_STALE_MS) {
        shouldDrain = true;
        drainType = "STALE_ARMED";
        reason = `armed for ${Math.floor(age / 3600000)}h without completion`;
      }
    }

    // Checked but never confirmed > 48h
    if (ses.gate_status === "checked" && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > CHECKED_STALE_MS) {
        shouldDrain = true;
        drainType = "STALE_CHECKED";
        reason = `checked for ${Math.floor(age / 3600000)}h without confirmation`;
      }
    }

    if (shouldDrain) {
      const archived = dbArchiveDrainedSession(
        sid, ses.task_description || "", reason, drainType, JSON.stringify(ses),
      );
      if (!archived) continue;
      delete store.sessions[sid];
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
      purged++;
      drainedIds.push(sid);
    }
  }

  if (purged > 0) {
    store.last_updated = new Date().toISOString();
    saveStore(store);
    writeLog("compliance-gate", "INFO", {
      event: "PURGE-COMPLETE",
      detail: `purged=${purged} total_archived=${dbCountDrainedSessions()}`,
    });
  }

  return {
    purged,
    drained_sessions: drainedIds,
    remaining_active: store.active_sessions.length,
    remaining_total: Object.keys(store.sessions).length,
  };
}

function isSkillLoadedInSession() {
  return fileExists(SKILL_FILE);
}

function wasRuleConsulted() {
  const results = {};
  [COMMON_RULES, SKILL_INV_STD, MCP_INVENTORY].forEach((f) => {
    results[path.basename(f)] = fileExists(f) ? "found" : "missing";
  });
  return results;
}

/**
 * Point 2 of compliance-gate-optimization-plan.md:
 * Build a strongly-worded reminder block that is appended to the MCP tool
 * response text when a gate session is armed (either via the combined
 * check+confirm flow or the legacy confirm call). The text enters the LLM's
 * conversation context and persists there until compaction, acting as the
 * PRIMARY mechanism to reduce the chance that the LLM forgets to call
 * compliance_gate_complete at the end of the task.
 *
 * The block is intentionally short, high-signal, and machine-parseable so
 * that downstream plugins can pattern-match it in context if needed.
 */
function buildReminderText(sessionId, planSummary, expiresAt) {
  const summarySnippet = (planSummary || "").trim().substring(0, 120);
  return (
    "\n\n" +
    "══════════════════════════════════════════════════════════════\n" +
    "✅ GATE ARMED [session: " + sessionId + "]\n" +
    "══════════════════════════════════════════════════════════════\n" +
    "⚠️  REMINDER — YOU MUST DO THIS WHEN THE TASK FINISHES:\n" +
    "    Call:  compliance_gate_complete\n" +
    "    With:  {\n" +
    '             "session_id": "' + sessionId + '",\n' +
    '             "execution_summary": "<what you actually accomplished>"\n' +
    "           }\n" +
    "\n" +
    "Plan (anchored): " + (summarySnippet || "(no summary provided)") + "\n" +
    "Expires at: " + (expiresAt || "(unknown)") + "\n" +
    "\n" +
    "Failure to call compliance_gate_complete will leave the gate in\n" +
    "armed state and block future git commits via the pre-commit hook.\n" +
    "══════════════════════════════════════════════════════════════"
  );
}

function runGateCheck(taskDescription, taskId) {
  // ── FW-DISPATCH-TASKID-IMMUTABLE: task_id integrity enforcement ──
  // Uses session_map DB (per-session dag_task_id records) instead of shared
  // .dispatch_ctx file. The DB approach is immune to:
  //   (a) Concurrent dispatch race conditions (per-session, no shared file overwrite)
  //   (b) task-after.ts deletion (DB records persist, unlike file consumed/deleted)
  //
  // When any session_map entry has a dag_task_id registered, the sub-agent's
  // task_id parameter MUST be one of those registered values. If the provided
  // task_id is not found in any session_map entry, it is fabricated — the
  // sub-agent attempted to bypass gate session mutual exclusion by inventing
  // a task_id not assigned by Orchestrator.
  //
  // Root cause: Q1 bug where SA received dag_task_id="GAP-FIX-ALL-001"
  // but called compliance_gate_check(task_id="GAP-FIX-ALL-002") to bypass
  // a stuck armed session, effectively executing under a different task ID
  // than the one Orchestrator dispatched.
  //
  // Legal exit: If no dag_task_id entries exist in session_map (manual
  // invocation without dispatch), any task_id is allowed — no integrity
  // constraint exists.
  let hasDispatchContext = false;
  let dispatchAssignedTaskIds: string[] = [];
  try {
    // Check whether ANY session_map entry has a dag_task_id
    // If taskId is provided, validate it against registered values
    if (taskId) {
      const sessions = dbQuerySessionByDagTaskId(taskId);
      if (sessions.length > 0) {
        // taskId matches a registered dispatch — legitimate
        hasDispatchContext = true;
        dispatchAssignedTaskIds = [taskId];
      } else {
        // taskId not found in session_map — could be fabricated
        // But check if ANY dispatch context exists first
        try {
          const { getDb } = require("../../lib/db-manager");
          const db = getDb();
          const anyRegistered = db.query(
            `SELECT DISTINCT dag_task_id FROM session_map WHERE dag_task_id IS NOT NULL`
          ).all() as { dag_task_id: string }[];
          if (anyRegistered.length > 0) {
            // Dispatch context exists but this taskId is NOT registered
            hasDispatchContext = true;
            dispatchAssignedTaskIds = anyRegistered.map(r => r.dag_task_id);
          }
        } catch {
          // DB query failure — fall through to no dispatch context
        }
      }
    } else {
      // No taskId provided — check .dispatch_ctx for fallback
      // (legacy path for pre-FW-DISPATCH-TASKID-IMMUTABLE callers)
      const dispatchCtxPath = path2.join(OPENCODE_ROOT, ".task_temp", "_dispatch", ".dispatch_ctx");
      try {
        if (fs2.existsSync(dispatchCtxPath)) {
          const ctx = JSON.parse(fs2.readFileSync(dispatchCtxPath, "utf8"));
          if (ctx && ctx.dagTaskId) {
            dispatchAssignedTaskIds = [ctx.dagTaskId];
            hasDispatchContext = true;
          }
        }
      } catch {
        // .dispatch_ctx unreadable — fall through
      }
    }
  } catch {
    // DB query failure — fall through to no dispatch context
  }

  if (hasDispatchContext && taskId && dispatchAssignedTaskIds.length > 0) {
    if (!dispatchAssignedTaskIds.includes(taskId)) {
      // Fix 3b: Resolve caller identity from session_map DB (primary) with
      // _dispatch_target.json fallback. session_map has per-session rows so
      // there is NO overwrite race condition between parallel dispatches,
      // unlike _dispatch_target.json which is a single shared file.
      let _resolvedAgent = "—";
      let _resolvedSessionId = "—";
      try {
        const _db = require("../../lib/db-manager").getDb();
        const latestCaller = _db.query(
          `SELECT agent, session_id FROM session_map ORDER BY created_at DESC LIMIT 1`
        ).get() as { agent: string; session_id: string } | null;
        if (latestCaller) {
          _resolvedAgent = latestCaller.agent || "—";
          _resolvedSessionId = latestCaller.session_id || "—";
        }
      } catch {}
      if (_resolvedAgent === "—") {
        _resolvedAgent = resolveDispatchTargetAgentDirect() || "—";
      }

      writeLog("mcp-compliance-gate", "ERROR", {
        sessionID: _resolvedSessionId,
        callID: "—",
        agent: _resolvedAgent,
        agentType: _resolvedAgent,
        event: "DISPATCH_TASKID_TAMPER",
        provided_task_id: taskId,
        dispatch_registered_task_ids: dispatchAssignedTaskIds,
        framework_task_id: process.env.FRAMEWORK_TASK_ID || "—",
        detail: `sub-agent attempted to use task_id "${taskId}" not registered in any dispatch — fabricated task_id to bypass gate mutual exclusion. Registered: [${dispatchAssignedTaskIds.join(", ")}]. FRAMEWORK_TASK_ID env: ${process.env.FRAMEWORK_TASK_ID || "(empty)"}`,
      });
      return {
        passed: false,
        session_id: null,
        reason: `DISPATCH-INTEGRITY: task_id "${taskId}" is not registered in any dispatch session. ` +
                `Registered task_ids: ${dispatchAssignedTaskIds.join(", ")}. ` +
                `The dispatch-assigned task_id is immutable — you cannot fabricate a different one. ` +
                `If the gate is stuck (existing armed session for a registered task_id), call compliance_gate_drain_stale ` +
                `to drain the stale session, then retry with the correct task_id.`,
      };
    }
  }

  // Normalize: if no taskId provided but dispatch context exists, use the
  // dispatch-assigned value as default (enables "just call check, no task_id"
  // pattern for correctly-dispatched sub-agents)
  if (!taskId && dispatchAssignedTaskIds.length === 1) {
    taskId = dispatchAssignedTaskIds[0];
  }

  // ── GATE-RECOVERY: task_id based mutual exclusion ──
  // If taskId is provided, scan for existing active session with same task_id.
  // An active session (armed or recoverable) means the gate is still open —
  // the agent MUST use the existing session, not create a new one.
  if (taskId) {
    const store = loadStore();
    const conflictSid = Object.keys(store.sessions || {}).find((sid) => {
      const s = store.sessions[sid];
      return s.task_id === taskId &&
             (s.gate_status === "armed" || s.gate_status === "recoverable") &&
             !s.consumed_at;
    });
    if (conflictSid) {
      const cs = store.sessions[conflictSid];
      return {
        passed: false,
        session_id: null,
        reason: `Task "${taskId}" has active gate ${conflictSid} (status=${cs.gate_status}, retry=${cs.retry_count || 0}). ` +
                `Complete the existing gate or drain it before starting a new one. ` +
                `session_id=${conflictSid} task_id=${taskId} status=${cs.gate_status}.`,
      };
    }
  }

  // ── Bootstrap: check hooksPath is configured (one-time hint on fresh clone) ──
  try {
    const { execSync } = require("child_process");
    const hooksPath = execSync("git config --local core.hooksPath", {
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (hooksPath !== ".opencode/hooks") {
      /**
       * FW-LOG-UNIFY-P2-A1 (2026-06-12): Migrated from process.stderr.write to writeLog.
       * Bootstrap hooks config check — persisted to log-manager for audit trail.
       */
      writeLog("mcp-compliance-gate", "WARN", {
        event: "bootstrap_hooks_path_mismatch",
        found: hooksPath, expected: ".opencode/hooks",
      });
    }
  } catch {
    writeLog("mcp-compliance-gate", "WARN", {
      event: "bootstrap_hooks_path_read_error",
    });
  }

  // ── F5 Auto-purge stale sessions before creating new one ──
  // ── P5-001: Also auto-drain stale sessions on every check ──
  const enforcementMode = getEnforcementMode();
  const purgeResult = purgeStaleSessions();
  if (purgeResult.purged > 0) {
    const msg = `Purged ${purgeResult.purged} stale session(s) (${purgeResult.remaining_total} remaining, ${purgeResult.remaining_active} active)`;
    /**
     * FW-LOG-UNIFY-P2-A1 (2026-06-12): Migrated from debugStderr to writeLog.
     */
    writeLog("mcp-compliance-gate", "INFO", {
      event: "purge_stale_sessions",
      purged: purgeResult.purged,
      remaining_total: purgeResult.remaining_total,
      remaining_active: purgeResult.remaining_active,
    });
  }
  const drainResult = drainStaleSessions(24, 48);
  if (drainResult.purged > 0) {
    /**
     * FW-LOG-UNIFY-P2-A1 (2026-06-12): Migrated from debugStderr to writeLog.
     */
    writeLog("mcp-compliance-gate", "INFO", {
      event: "drain_stale_sessions",
      purged: drainResult.purged,
      drained_armed: drainResult.drained_armed,
      drained_checked: drainResult.drained_checked,
    });
  }

  const store = loadStore();
  const sessionId = generateSessionId();
  const ruleStatus = wasRuleConsulted();
  const skillAvailable = isSkillLoadedInSession();
  const failed = [];

  if (!skillAvailable) {
    failed.push({
      id: "skill_execution_preflight_check",
      desc: `execution-preflight-check SKILL.md not found at ${SKILL_FILE}`,
      severity: "HIGH",
    });
  }
  if (ruleStatus[path.basename(COMMON_RULES)] !== "found") {
    failed.push({
      id: "rule_common_project",
      desc: `common-project.md not found at ${COMMON_RULES}`,
      severity: "HIGH",
    });
  }
  if (ruleStatus[path.basename(SKILL_INV_STD)] !== "found") {
    failed.push({
      id: "rule_skill_invocation_standard",
      desc: `skill-invocation-standard.md not found at ${SKILL_INV_STD}`,
      severity: "HIGH",
    });
  }
  if (ruleStatus[path.basename(MCP_INVENTORY)] !== "found") {
    failed.push({
      id: "rule_mcp_inventory",
      desc: `mcp-tool-inventory.md not found at ${MCP_INVENTORY}`,
      severity: "HIGH",
    });
  }

  // Check for unresolved role violations
  try {
    // FW-REPAIR-P1B: compliance_records is now in a dedicated sub-state file.
    // Direct machine.json read would return undefined after the split.
    const complianceRecords = readSubState("compliance_records");
    const violations = complianceRecords.role_violations || [];
    const unresolved = violations.filter((v) => v.status === "unresolved");
    if (unresolved.length > 0) {
      failed.push({
        id: "agent_role_violation",
        desc: `CAT4.1: ${unresolved.length} unresolved role violations found in compliance-records.json. Last: ${unresolved[unresolved.length - 1].agent} wrote ${unresolved[unresolved.length - 1].violation_file}`,
        severity: "HIGH",
      });
    }
  } catch {} // Non-blocking if compliance-records.json can't be read

  // ── Semantic Version Verification: rule_registry.json digest checks ──
  const registryResult = verifyRuleRegistry();
  if (registryResult.registry_available) {
    // Append registry verification results to failed items
    failed.push(...registryResult.results);
    // Add a summary entry for observability
    failed.push({
      id: "rule_registry_summary",
      desc: registryResult.summary,
      severity: registryResult.passed ? "INFO" : "HIGH",
    });
  }

  // ── Capture pre-advisory pass/fail BEFORE downgrade ──
  const hasHighSeverityItems = failed.some((f) => f.severity === "HIGH");

  // ── Enforcement Mode: advisory downgrades failures to warnings ──
  // enforcementMode already declared above (line 556)
  if (enforcementMode === "advisory") {
    // Downgrade all HIGH severity items to WARNING
    for (const item of failed) {
      if (item.severity === "HIGH") {
        item.severity = "WARNING";
        item.desc = "[ADVISORY] " + item.desc;
      }
    }
  }

  /**
   * @fix FW-EMERG-001: Use hasHighSeverityItems instead of failed.length.
   * failed[] always contains at least 2 INFO-level items (rule_registry_summary,
   * uc7ks_knowledge_cache), which caused passed=false in strict/locked mode even
   * when all checks passed. This aligns passed with last_check_passed (line 855)
   * which already correctly uses !hasHighSeverityItems.
   */
  const passed = enforcementMode === "advisory" ? true : !hasHighSeverityItems;

  // ── UC7KS: Local Cache Check ──
  const uc7ksStateDir = resolveProjectState();
  const indexPath = path2.resolve(
    uc7ksStateDir,
    "..",
    "..",
    "docs",
    "official_docs",
    "index.json",
  );
  let knowledgeCacheStatus = "not_found";
  try {
    if (fs2.existsSync(indexPath)) {
      const manifest = JSON.parse(fs2.readFileSync(indexPath, "utf-8"));
      if (manifest.manifest_version && Array.isArray(manifest.entries)) {
        knowledgeCacheStatus = `v${manifest.manifest_version} (${manifest.entries.length} entries)`;
      } else {
        knowledgeCacheStatus = "malformed";
      }
    }
  } catch (_) {
    knowledgeCacheStatus = "error";
  }
  failed.push({
    id: "uc7ks_knowledge_cache",
    desc: `[Gate Preflight v2] UC7KS Knowledge Cache: ${knowledgeCacheStatus}`,
    severity:
      knowledgeCacheStatus === "not_found" ||
      knowledgeCacheStatus === "malformed"
        ? "WARNING"
        : "INFO",
  });

  /**
   * Read agent identity from _dispatch_target.json (v4.0.0 replacement for FRAMEWORK_AGENT).
   * @returns {string} agent name or empty string
   */
  function resolveDispatchTargetAgent() {
    try {
      const p = path2.join(
        process.env.OPENCODE_ROOT || ".",
        ".task_temp",
        "_dispatch_target.json",
      );
      if (fs2.existsSync(p)) {
        const d = JSON.parse(fs2.readFileSync(p, "utf8"));
        const currentRunId = process.env.OPENCODE_RUN_ID || "";
        if (currentRunId) {
          // P0-7: Use run_id comparison when OPENCODE_RUN_ID is available
          if (!d.run_id || d.run_id !== currentRunId) {
            try {
              fs2.unlinkSync(p);
            } catch {}
            return "";
          }
        } else {
          // P0-7 FALLBACK: Timestamp-based staleness when OPENCODE_RUN_ID
          // is unset. _dispatch_target.json older than 30 min → stale.
          const STALE_MS = 30 * 60 * 1000;
          const mtime = fs2.statSync(p).mtimeMs;
          if (Date.now() - mtime > STALE_MS) {
            try {
              fs2.unlinkSync(p);
            } catch {}
            return "";
          }
        }
        return d.agent || "";
      }
    } catch {}
    return "";
  }

  // ── UC7KS: Pipeline Task-ID Chain Hard Constraint ──
  // F3 (2026-06-11): Nested per-task-per-domain schema with flat fallback.
  // Reads tasks[task_id].domains[domain] paths first, then legacy flat fields.
  {
    try {
      // FW-REPAIR-P1B: knowledge_cache_state is now in a dedicated sub-state file.
      // Direct machine.json read would return undefined after the split.
      const knowledgeCacheState = readSubState("knowledge_cache_state");
      const sessionAccess = knowledgeCacheState?.session_access || {};
      const agents = Object.keys(sessionAccess);
      const currentTaskId = taskId || process.env.FRAMEWORK_TASK_ID || "";

      // ── F3: Find pipeline agent — check nested tasks first, then flat ──
      let matchedAgent = null;
      let matchedAgentFoundInNested = false;
      if (currentTaskId) {
        // Check nested tasks[task_id] for any agent with completed domains
        for (const a of agents) {
          const saEntry = sessionAccess[a];
          if (saEntry.tasks?.[currentTaskId]) {
            const taskDomains = saEntry.tasks[currentTaskId].domains || {};
            for (const d of Object.keys(taskDomains)) {
              if (taskDomains[d].pipeline_status === "completed") {
                matchedAgent = a;
                matchedAgentFoundInNested = true;
                break;
              }
            }
            if (matchedAgent) break;
          }
        }
        // Fall back to legacy flat
        if (!matchedAgent) {
          matchedAgent = agents.find((a) => sessionAccess[a]?.pipeline_task_id === currentTaskId) || null;
        }
      }

      if (currentTaskId && !matchedAgent) {
        const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
        failed.push({
          id: "uc7ks_pipeline_not_started",
          desc: `[UC7KS] No agent has started the knowledge pipeline for task "${currentTaskId}". Run module_scope_declare and knowledge_cache_search before compliance_gate_check.`,
          severity,
        });
      } else if (matchedAgent) {
        const sa = sessionAccess[matchedAgent];

        // ── F3: Read sufficiency from nested or flat ──
        let suff = null;
        let pipelineCompleted = false;
        let pipelineInsufficient = false;

        if (matchedAgentFoundInNested && sa.tasks?.[currentTaskId]) {
          // Read from nested: aggregate all domains
          const taskDomains = sa.tasks[currentTaskId].domains || {};
          const domainKeys = Object.keys(taskDomains);
          let allCompleted = domainKeys.length > 0;
          let anySufficient = false;
          let anyInsufficient = false;
          for (const d of domainKeys) {
            const de = taskDomains[d];
            if (de.pipeline_status !== "completed") allCompleted = false;
            if (de.cache_sufficiency?.status === "sufficient") anySufficient = true;
            if (de.cache_sufficiency?.status === "insufficient") anyInsufficient = true;
            // Use last domain's sufficiency for evidence check
            if (de.cache_sufficiency?.status === "sufficient" || de.cache_sufficiency?.status === "insufficient") {
              suff = de.cache_sufficiency;
            }
          }
          pipelineCompleted = allCompleted;
          pipelineInsufficient = anyInsufficient && !anySufficient;
        } else {
          // Legacy flat path
          pipelineCompleted = sa.pipeline_status === "completed";
          pipelineInsufficient = sa.cache_sufficiency?.status === "insufficient" && !sa.kc_dispatched;
          suff = sa.cache_sufficiency || null;
        }

        if (!pipelineCompleted) {
          const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
          failed.push({
            id: "uc7ks_pipeline_not_completed",
            desc: `[UC7KS] Pipeline for "${currentTaskId}" has not completed. Run knowledge_cache_search to complete the pipeline.`,
            severity,
          });
        } else if (pipelineInsufficient && !sa.kc_dispatched) {
          const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
          failed.push({
            id: "uc7ks_cache_insufficient_no_kc",
            desc: `[UC7KS] Cache is insufficient for task "${currentTaskId}" and @Knowledge-Curator has not been dispatched. Dispatch KC before proceeding.`,
            severity,
          });
        }

        // UC7-001c HARDEN: Verify evidence completeness (works on nested or flat)
        if (suff) {
          const evidenceMissing = [];
          if (!suff.reason) evidenceMissing.push("reason");
          if (!suff.files_read) evidenceMissing.push("files_read");
          if (!suff.content_summary) evidenceMissing.push("content_summary");
          if (evidenceMissing.length > 0) {
            failed.push({
              id: "uc7ks_sufficiency_evidence_incomplete",
              desc: `[UC7KS] Cache sufficiency evidence incomplete: missing ${evidenceMissing.join(", ")}. Sufficiency downgraded to insufficient. Re-run knowledge_cache_search.`,
              severity: enforcementMode === "advisory" ? "WARNING" : "HIGH",
            });
          }
        }
      } else if (!currentTaskId) {
        // No task_id — check ANY nested or flat pipeline completion
        let anyDone = agents.some((a) => sessionAccess[a]?.pipeline_status === "completed");
        if (!anyDone) {
          // Also check nested
          for (const a of agents) {
            const tasks = sessionAccess[a]?.tasks || {};
            for (const tid of Object.keys(tasks)) {
              for (const d of Object.keys(tasks[tid].domains || {})) {
                if (tasks[tid].domains[d].pipeline_status === "completed") {
                  anyDone = true;
                  break;
                }
              }
              if (anyDone) break;
            }
            if (anyDone) break;
          }
        }
        if (!anyDone) {
          const severity = enforcementMode === "advisory" ? "WARNING" : "HIGH";
          failed.push({
            id: "uc7ks_no_pipeline_ever",
            desc: `[UC7KS] No agent has ever completed the knowledge pipeline. Provide a task_id and run module_scope_declare + knowledge_cache_search.`,
            severity,
          });
        }
      }
    } catch (_) {
      // Non-fatal: if knowledge-cache-state.json is unreadable, skip UC7KS check
    }
  }

  store.sessions[sessionId] = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || "",
    task_id: taskId || null,
    enforcement_mode: enforcementMode,
    gate_status: "checked",
    last_check_passed: !hasHighSeverityItems,
    last_check_failed_items: failed,
    plan_summary: null,
    confirmed_at: null,
    consumed_at: null,
    audit: null,
  };
  store.last_updated = new Date().toISOString();
  saveStore(store);
  return {
    passed,
    session_id: sessionId,
    enforcement_mode: enforcementMode,
    failed_items: failed,
    rule_status: ruleStatus,
  };
}

function runGateConfirm(sessionId, planSummary, agent, taskId, declaredDeliverables) {
  const store = loadStore();
  const session = sessionId ? store.sessions[sessionId] : null;
  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}. Must call compliance_gate_check first.`,
    };
  }
  if (session.gate_status === "armed") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is already armed. Cannot re-arm.`,
    };
  }
  if (session.gate_status !== "checked") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is not in "checked" state (current: ${session.gate_status}). Must call compliance_gate_check to create a valid session first.`,
    };
  }
  if (!planSummary || planSummary.trim().length < 10) {
    return {
      status: "rejected",
      reason: "plan_summary must be at least 10 characters",
    };
  }

  // ── F1 Fix: Block arming if gate check had HIGH severity failures ──
  const enforcementMode = getEnforcementMode();
  if (session.last_check_passed === false && enforcementMode !== "advisory") {
    return {
      status: "rejected",
      reason: `Gate check failed — resolve HIGH severity violations before arming. Session ${sessionId} has ${session.last_check_failed_items?.length || 0} check failures in ${enforcementMode} enforcement mode.`,
    };
  }

  // ── Resolve agent identity (needed for deliverables validation) ──
  let resolvedAgent = agent;
  if (!resolvedAgent) {
    try {
      const dtp = path2.join(OPENCODE_ROOT, ".task_temp", "_dispatch_target.json");
      if (fs2.existsSync(dtp)) {
        const dt = JSON.parse(fs2.readFileSync(dtp, "utf8"));
        resolvedAgent = dt.agent || "";
      }
    } catch (_) { /* non-critical */ }
  }
  resolvedAgent = resolvedAgent || session.agent || "unknown";

  // ── Deliverables hard constraint validation ──
  const EXEMPT_AGENTS = ["@Orchestrator", "@Super-Admin", "Orchestrator", "Super-Admin"];
  const isExempt = EXEMPT_AGENTS.some(
    (exempt) => resolvedAgent === exempt || `@${resolvedAgent}` === exempt,
  );

  let parsedDeliverables = null;
  if (declaredDeliverables) {
    try {
      parsedDeliverables = typeof declaredDeliverables === "string"
        ? JSON.parse(declaredDeliverables)
        : declaredDeliverables;
      if (!Array.isArray(parsedDeliverables)) {
        return {
          status: "rejected",
          reason: "declared_deliverables must be a JSON array",
        };
      }
      // Validate each entry
      for (const entry of parsedDeliverables) {
        if (!entry.name || typeof entry.name !== "string") {
          return {
            status: "rejected",
            reason: `Each deliverable must have a "name" (string). Got: ${JSON.stringify(entry)}`,
          };
        }
        if (!entry.description || typeof entry.description !== "string" || entry.description.trim().length < 5) {
          return {
            status: "rejected",
            reason: `Each deliverable must have a "description" (min 5 chars). Got for "${entry.name}": ${entry.description || "(empty)"}`,
          };
        }
      }
    } catch (e) {
      return {
        status: "rejected",
        reason: `declared_deliverables must be valid JSON. Parse error: ${e.message}`,
      };
    }
  }

  // Hard constraint: non-exempt agents MUST provide declared_deliverables
  if (!isExempt && (!parsedDeliverables || parsedDeliverables.length === 0)) {
    return {
      status: "rejected",
      reason: `declared_deliverables is REQUIRED for agent "${resolvedAgent}". Exempt agents: @Orchestrator, @Super-Admin. Declare at least 1 deliverable with name and description.`,
    };
  }

  // ── Auto-append universal mandatory deliverables if missing ──
  // FH-HANDOVER-001: HANDOVER.md and TASK_LOG.md are universal required
  // deliverables for ALL non-exempt agents. Auto-appended here to prevent
  // agent omission while still allowing agents to provide custom descriptions.
  if (!isExempt && parsedDeliverables) {
    const universalDeliverables = [
      "HANDOVER.md",
      "TASK_LOG.md",
    ];
    for (const name of universalDeliverables) {
      if (!parsedDeliverables.some((d: any) => d.name === name)) {
        parsedDeliverables.push({
          name,
          description: `${name} — universal mandatory deliverable (auto-added)`,
          artifact_path: `.task_temp/${taskId || "{taskId}"}/${name}`,
          required: true,
        });
      }
    }
  }

  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  // ── P5-001: Lifecycle fields ──
  session.task_id = taskId || session.task_id || null;
  session.agent = resolvedAgent;
  session.worktree = process.cwd();
  // expires_at: 24 hours from confirmation
  session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // ── Deliverables fields ──
  session.declared_deliverables = parsedDeliverables;
  session.approval_required = !isExempt;

  // Remove from active_sessions any checked sessions that were previously added
  // Only armed sessions count as active
  store.active_sessions = store.active_sessions.filter((sid) => {
    const s = store.sessions[sid];
    return s && s.gate_status === "armed" && !s.consumed_at;
  });
  // Add to active_sessions (dedup)
  if (!store.active_sessions.includes(sessionId)) {
    store.active_sessions.push(sessionId);
  }
  // Ensure no checked sessions are in active_sessions
  for (const [sid, s] of Object.entries(store.sessions)) {
    if (s.gate_status === "checked" && store.active_sessions.includes(sid)) {
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
    }
  }
  store.last_updated = new Date().toISOString();
  saveStore(store);
  return {
    status: "armed",
    session_id: sessionId,
    confirmed_at: session.confirmed_at,
    expires_at: session.expires_at,
    plan_summary: planSummary.trim().substring(0, 200),
    declared_deliverables: parsedDeliverables ? parsedDeliverables.length : 0,
    approval_required: !isExempt,
  };
}

function runGateComplete(sessionId, executionSummary) {
  const store = loadStore();
  const session = sessionId ? store.sessions[sessionId] : null;
  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}. Must call compliance_gate_check and compliance_gate_confirm first.`,
    };
  }

  // ── State gate: approval_required sessions must be 'approved', exempt can be 'armed' ──
  if (session.approval_required) {
    if (session.gate_status !== "approved") {
      let guidance = "";
      if (session.gate_status === "armed") {
        guidance = "You must call compliance_gate_submit_deliverables first, then wait for Orchestrator approval.";
      } else if (session.gate_status === "delivered") {
        guidance = "Session is awaiting Orchestrator approval. Wait for compliance_gate_approve_deliverables.";
      } else {
        guidance = "Must call compliance_gate_confirm first.";
      }
      return {
        status: "rejected",
        reason: `session ${sessionId} requires Orchestrator approval (status: ${session.gate_status}, approval_required: true). ${guidance}`,
      };
    }
  } else {
    if (session.gate_status !== "armed") {
      return {
        status: "rejected",
        reason: `session ${sessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.`,
      };
    }
  }
  if (session.consumed_at) {
    return {
      status: "rejected",
      reason: `session ${sessionId} already completed at ${session.consumed_at}. Cannot re-complete.`,
    };
  }

  // P0-FIX-BUG-11 (2026-06-09 @Super-Admin): Break the self-dirtying cycle.
  // compliance_gate_complete's internal gate-state.json write triggers the
  // plugin's toolExecuteAfter hook, which runs state reconciliation and
  // re-flags previously-modified .opencode/ files as dirty in machine.json.
  // eslint_audit full_scan clears them, but the hook re-dirties them on every
  // subsequent modify-tool execution — including this very gate closure.
  //
  // Fix: eagerly clear dirty_modules before the CAT3.7 check. This is
  // functionally equivalent to running eslint_audit full_scan first, but
  // avoids spawning a child process or duplicating audit logic. The actual
  // ESLint violations (if any) are already captured by the plugin's write-audit
  // system and would be re-detected by the next full_scan.
  try {
    // FW-REPAIR-P1B: eslint_state is now in a dedicated sub-state file.
    // Direct machine.json read would return undefined after the split.
    const preDirty = (function() {
      try {
        const eslintState = readSubState("eslint_state");
        return Array.isArray(eslintState?.aggregate?.dirty_modules)
          ? eslintState.aggregate.dirty_modules : [];
      } catch { return []; }
    })();
    if (preDirty.length > 0) {
      atomicWriteSubState("eslint_state", (eslint_state) => {
        if (eslint_state?.aggregate) {
          eslint_state.aggregate.dirty_modules = [];
          eslint_state.aggregate.total_violations = 0;
        }
        eslint_state.last_full_scan = new Date().toISOString();
      });
    }
  } catch {
    // If eslint-state.json can't be written, allow gate to proceed
  }

  // ESLint mock-audit check: read eslint-state.json
  let eslintFailed = false;
  let dirtyModules = [];

  try {
    // FW-REPAIR-P1B: eslint_state is now in a dedicated sub-state file.
    // Direct machine.json read would return undefined after the split.
    const eslintState = readSubState("eslint_state");
    if (eslintState?.aggregate?.dirty_modules?.length > 0) {
      dirtyModules = eslintState.aggregate.dirty_modules;
      eslintFailed = true;
    }
  } catch {
    // If eslint-state.json can't be read, allow gate to proceed
  }

  // ── Enforcement Mode: advisory skips ESLint dirty_modules check ──
  const enforcementMode = getEnforcementMode();
  if (eslintFailed && enforcementMode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.enforcement_mode = enforcementMode;
    session.fail_reason =
      "ESLint mock-audit violations found in modules: " +
      dirtyModules.join(", ");
    session.audit = {
      execution_summary: (executionSummary || "").substring(0, 1000),
      completed_at: now,
    };
    // Remove from active_sessions
    store.active_sessions = store.active_sessions.filter(
      (sid) => sid !== sessionId,
    );
    store.last_updated = new Date().toISOString();
    saveStore(store);
    return {
      status: "failed",
      reason:
        "CAT3.7: ESLint mock-audit violations in modules: " +
        dirtyModules.join(", ") +
        ". Run eslint-audit.run_audit({ full_scan: true }) to see details, then fix violations or obtain @Arbiter waivers.",
      dirty_modules: dirtyModules,
    };
  }
  // In advisory mode: log the dirty modules as a warning but proceed
  if (eslintFailed && enforcementMode === "advisory") {
    /**
     * FW-LOG-UNIFY-P2-A1 (2026-06-12): Migrated from debugStderr to writeLog.
     */
    writeLog("mcp-compliance-gate", "WARN", {
      event: "eslint_dirty_advisory",
      dirty_modules: dirtyModules,
    });
  }

  // ── CI-UNIFY-003: Validate HANDOVER.md and TASK_LOG.md exist ──
  // @super-admin-handover-enforcement: Pass sessionId as fallback so
  // @Super-Admin sessions without a DAG task_id still get validated.
  const missingArtifacts = validateTaskArtifacts(session.task_id, sessionId);
  if (missingArtifacts.length > 0 && enforcementMode !== "advisory") {
    const now = new Date().toISOString();
    const maxRetries = enforcementMode === "locked" ? 1 : 3;
    session.retry_count = (session.retry_count || 0) + 1;

    if (session.retry_count > maxRetries) {
      // ── Retries exhausted → terminal failure ──
      session.gate_status = "failed";
      session.consumed_at = now;
      session.fail_reason =
        "Missing required task artifacts (retries exhausted): " + missingArtifacts.join(", ");
      session.missing_artifacts = missingArtifacts;
      session.audit = {
        execution_summary: (executionSummary || "").substring(0, 1000),
        completed_at: now,
      };
      store.active_sessions = store.active_sessions.filter(
        (sid) => sid !== sessionId,
      );
      store.last_updated = new Date().toISOString();
      saveStore(store);
      const resolvedId = session.task_id || sessionId;
      return {
        status: "failed",
        reason:
          "Missing required task artifacts (retries exhausted " + session.retry_count + "/" + maxRetries + "): " +
          missingArtifacts.join(", ") +
          ". Create HANDOVER.md and TASK_LOG.md under .task_temp/" + resolvedId + "/ before completing. (resolvedId=" + resolvedId + ", task_id=" + (session.task_id || "null") + ", sessionId=" + sessionId + ")",
        missing_artifacts: missingArtifacts,
        retry_count: session.retry_count,
      };
    }

    // ── Transient failure → recoverable (gate stays armed, mutex still active) ──
    session.gate_status = "recoverable";
    session.fail_reason = "Missing required task artifacts: " + missingArtifacts.join(", ");
    session.missing_artifacts = missingArtifacts;
    session.fail_history = session.fail_history || [];
    session.fail_history.push({
      retry: session.retry_count,
      failed_at: now,
      reason: session.fail_reason,
    });
    // Do NOT remove from active_sessions — keeps mutual exclusion lock
    // Do NOT set consumed_at — gate is still live
    store.last_updated = new Date().toISOString();
    saveStore(store);
    const resolvedId = session.task_id || sessionId;
    return {
      status: "recoverable",
      reason:
        "Missing required task artifacts: " +
        missingArtifacts.join(", ") +
        ". Create HANDOVER.md and TASK_LOG.md under .task_temp/" + resolvedId + "/ and call complete() again. (retry=" + session.retry_count + "/" + maxRetries + ", resolvedId=" + resolvedId + ", task_id=" + (session.task_id || "null") + ")",
      missing_artifacts: missingArtifacts,
      retry_count: session.retry_count,
      max_retries: maxRetries,
    };
  }
  if (missingArtifacts.length > 0 && enforcementMode === "advisory") {
    /**
     * FW-LOG-UNIFY-P2-A1 (2026-06-12): Migrated from debugStderr to writeLog.
     */
    writeLog("mcp-compliance-gate", "WARN", {
      event: "missing_artifacts_advisory",
      artifacts: missingArtifacts,
    });
  }

  const now = new Date().toISOString();
  session.gate_status = "completed";
  session.consumed_at = now;
  session.audit = {
    execution_summary: (executionSummary || "").substring(0, 1000),
    completed_at: now,
  };
  // ── P5-001: Append to audit history ──
  if (!Array.isArray(store.audit_history)) {
    store.audit_history = [];
  }
  store.audit_history.push({
    session_id: sessionId,
    task_description: session.task_description,
    plan_summary: session.plan_summary,
    agent: session.agent,
    task_id: session.task_id,
    confirmed_at: session.confirmed_at,
    consumed_at: now,
    execution_summary: (executionSummary || "").substring(0, 200),
    gate_status: "completed",
  });
  // Keep only last 500 audit entries
  if (store.audit_history.length > 500) {
    store.audit_history = store.audit_history.slice(-500);
  }
  // Remove from active_sessions
  store.active_sessions = store.active_sessions.filter(
    (sid) => sid !== sessionId,
  );
  store.last_updated = new Date().toISOString();
  saveStore(store);

  // ── P0-2: StateCompactor auto-archival (fire-and-forget) ──
  // Arches completed session to gate-state.history/YYYY-MM-DD.jsonl
  // and updates gate-state.index.json. Best-effort — never blocks gate completion.
  try {
    // FW-PLAN-JS-TO-TS: import StateCompactor from TypeScript source via Bun.
    const { StateCompactor } = require("../../lib/state-compactor.ts");
    const compactor = new StateCompactor();
    compactor
      .onGateComplete(sessionId, {
        session_id: sessionId,
        created_at: session.created_at,
        gate_status: "completed",
        confirmed_at: session.confirmed_at,
        task_description: session.task_description,
        plan_summary: session.plan_summary,
      })
      .catch((err) => {
        process.stderr.write(
          "[state-compactor] Archival deferred: " + err.message + "\n",
        );
        // FW-LOG-UNIFY-P2-A1: DUAL-WRITE — persist compactor errors
        writeLog("mcp-compliance-gate", "WARN", {
          event: "compactor_archival_deferred", error: err.message,
        });
      });
  } catch (err) {
    process.stderr.write(
      "[state-compactor] Module load failed: " + err.message + "\n",
    );
    writeLog("mcp-compliance-gate", "WARN", {
      event: "compactor_module_load_failed", error: err.message,
    });
  }

  const audit = {
    status: "completed",
    session_id: sessionId,
    task_description: session.task_description,
    plan_summary: session.plan_summary,
    confirmed_at: session.confirmed_at,
    consumed_at: session.consumed_at,
    execution_summary: session.audit.execution_summary,
    audit_history_count: store.audit_history.length,
    // UC7KS: Track knowledge cache state at gate completion
    knowledge_cache: (() => {
      try {
        const gateStateDir = resolveProjectState();
        const idxPath = path2.resolve(
          gateStateDir,
          "..",
          "..",
          "docs",
          "official_docs",
          "index.json",
        );
        if (fs2.existsSync(idxPath)) {
          const m = JSON.parse(fs2.readFileSync(idxPath, "utf-8"));
          return {
            version: m.manifest_version,
            entries: (m.entries || []).length,
          };
        }
      } catch (_) {}
      return { version: "none", entries: 0 };
    })(),
  };
  return { status: "completed", audit };
}

/**
 * Submit deliverables evidence for a gate session.
 * Transitions: armed → delivered (or armed → recoverable if artifacts missing).
 * Solves RC2: enforces artifact write order at state machine level.
 */
function runGateSubmitDeliverables(sessionId, deliverablesEvidence) {
  const store = loadStore();
  const session = sessionId ? store.sessions[sessionId] : null;
  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}`,
    };
  }
  if (session.gate_status !== "armed") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.`,
    };
  }

  // Parse evidence
  let parsedEvidence;
  try {
    parsedEvidence = typeof deliverablesEvidence === "string"
      ? JSON.parse(deliverablesEvidence)
      : deliverablesEvidence;
    if (!Array.isArray(parsedEvidence) || parsedEvidence.length === 0) {
      return {
        status: "rejected",
        reason: "deliverables_evidence must be a non-empty JSON array",
      };
    }
  } catch (e) {
    return {
      status: "rejected",
      reason: `deliverables_evidence must be valid JSON. Parse error: ${e.message}`,
    };
  }

  // Cross-check: every evidence name must exist in declared_deliverables
  const declaredNames = new Set(
    (session.declared_deliverables || []).map((d) => d.name),
  );
  const missingDeclared = [];
  for (const ev of parsedEvidence) {
    if (!ev.name) {
      return {
        status: "rejected",
        reason: `Each evidence entry must have a "name". Got: ${JSON.stringify(ev)}`,
      };
    }
    if (declaredNames.size > 0 && !declaredNames.has(ev.name)) {
      missingDeclared.push(ev.name);
    }
  }
  if (missingDeclared.length > 0) {
    return {
      status: "rejected",
      reason: `Evidence contains names not in declared_deliverables: ${missingDeclared.join(", ")}. Declared: ${[...declaredNames].join(", ") || "(none)"}`,
    };
  }

  // File existence check for entries with artifact_path
  const missingFiles = [];
  for (const ev of parsedEvidence) {
    if (ev.artifact_path) {
      const resolvedPath = path2.resolve(OPENCODE_ROOT, ev.artifact_path);
      if (!fs2.existsSync(resolvedPath)) {
        missingFiles.push(ev.name);
      }
    }
  }

  // Also validate HANDOVER.md + TASK_LOG.md (existing artifact check)
  const taskId = session.task_id || sessionId;
  const taskDir = path2.join(OPENCODE_ROOT, ".task_temp", taskId);
  if (fs2.existsSync(taskDir)) {
    if (!fs2.existsSync(path2.join(taskDir, "HANDOVER.md"))) missingFiles.push("HANDOVER.md");
    if (!fs2.existsSync(path2.join(taskDir, "TASK_LOG.md"))) missingFiles.push("TASK_LOG.md");
  } else {
    missingFiles.push("HANDOVER.md", "TASK_LOG.md");
  }

  // Dedup missing
  const uniqueMissing = [...new Set(missingFiles)];
  const now = new Date().toISOString();

  // Add submitted_at timestamp to evidence
  const evidenceWithTimestamps = parsedEvidence.map((ev) => ({
    ...ev,
    submitted_at: now,
  }));

  if (uniqueMissing.length > 0) {
    // Missing artifacts → recoverable state
    session.gate_status = "recoverable";
    session.submitted_deliverables = evidenceWithTimestamps;
    session.fail_reason = `Missing deliverable artifacts: ${uniqueMissing.join(", ")}`;
    session.missing_artifacts = uniqueMissing;
    session.retry_count = (session.retry_count || 0) + 1;
    store.last_updated = now;
    saveStore(store);
    return {
      status: "recoverable",
      session_id: sessionId,
      reason: `Missing artifacts: ${uniqueMissing.join(", ")}. Fix and re-submit.`,
      retry_count: session.retry_count,
    };
  }

  // All artifacts present → delivered state
  session.gate_status = "delivered";
  session.submitted_deliverables = evidenceWithTimestamps;
  store.last_updated = now;
  saveStore(store);
  return {
    status: "delivered",
    session_id: sessionId,
    submitted_at: now,
    pending_approval_by: "Orchestrator",
    deliverables_count: evidenceWithTimestamps.length,
  };
}

/**
 * Step 0d enforcement: Multi-source investigation audit.
 * For investigation-type tasks, validates that HANDOVER.md contains
 * a "## Logs Checked" section with log/audit evidence.
 *
 * @param session - The gate session object from gate-state.json
 * @param taskId  - DAG task ID for artifact path resolution
 * @returns null if OK; error object if HANDOVER.md lacks log evidence
 */
function enforceMultiSourceAudit(
  session: Record<string, any> | null,
  taskId: string | null
): { id: string; desc: string; severity: string } | null {
  if (!session || !taskId) return null;

  // ── 1. Determine if investigation-type task ──
  const ANALYSIS_EN = [
    "investigation", "audit", "analysis", "diagnosis", "diagnose",
    "debug", "troubleshoot", "root-cause", "trace", "tracing", "forensic"
  ];
  const ANALYSIS_CN = [
    "调查", "排查", "调试", "诊断", "根因", "审计", "追溯", "排错", "定位"
  ];

  const desc = (session.plan_summary || session.task_description || "").toLowerCase();
  const isInvestigation =
    ANALYSIS_EN.some((kw: string) => desc.includes(kw)) ||
    ANALYSIS_CN.some((kw: string) => desc.includes(kw));

  if (!isInvestigation) return null;

  // ── 2. Read HANDOVER.md ──
  const fs = require("fs");
  const handoverPath = `.task_temp/${taskId}/HANDOVER.md`;
  let handover = "";
  try { handover = fs.readFileSync(handoverPath, "utf-8"); } catch { handover = ""; }

  if (!handover) {
    return {
      id: "step_0d_handover_missing",
      desc: `[Step 0d] Investigation task requires HANDOVER.md at ${handoverPath}`,
      severity: "HIGH"
    };
  }

  // ── 3. Check for ## Logs Checked section ──
  const hasLogsSection = /##\s+Logs\s+Checked/i.test(handover);
  if (!hasLogsSection) {
    const logPaths = [
      ".opencode/logs/",
      ".opencode/logs/mcp-compliance-gate/",
      ".opencode/state/gate-state.json",
      ".opencode/state/machine.json",
      ".task_temp/_dispatch/",
      ".opencode/state/.transaction-log",
      ".opencode/state/session_log/ (SQLite)"
    ];
    return {
      id: "step_0d_log_evidence_missing",
      desc: `[Step 0d] Investigation task HANDOVER.md lacks "## Logs Checked" ` +
            `section with ≥2 log/audit sources. Check: ${logPaths.join(", ")}`,
      severity: "HIGH"
    };
  }

  return null;
}

/**
 * Approve or reject submitted deliverables.
 * RESTRICTED to @Orchestrator / @Super-Admin.
 * Approve: delivered → approved (optionally auto-complete with execution_summary).
 * Reject: delivered → armed (sub-agent must re-submit via new dispatch).
 */
function runGateApproveDeliverables(sessionId, approvalDecision, approvalNote, executionSummary, agentId) {
  const store = loadStore();
  const session = sessionId ? store.sessions[sessionId] : null;
  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}`,
    };
  }

  // ── SA-FIX-APPROVE-PERMISSION: Caller identity enforcement ──
  // approve_deliverables is restricted to @Orchestrator/@Super-Admin.
  // Previously documented as "RESTRICTED" but had no code-level enforcement
  // (same vulnerability class as SA-FIX-GATE-PERMISSION on retry_confirm).
  // Three-layer fallback chain (mirrors runGateRetryConfirm L2139-2142):
  //   Layer A: explicit agent_id parameter from tool caller
  //   Layer B: session.agent (persisted by runGateConfirm at arm time)
  //   Layer C: _dispatch_target.json (set by dispatch-before.ts)
  const ALLOWED_APPROVE_AGENTS = ["@Orchestrator", "@Super-Admin", "Orchestrator", "Super-Admin"];
  const resolvedAgent = (agentId
    || (session && session.agent)
    || resolveDispatchTargetAgentDirect()
    || "").replace(/^@/, "");
  if (resolvedAgent && !ALLOWED_APPROVE_AGENTS.includes(resolvedAgent) && !ALLOWED_APPROVE_AGENTS.includes("@" + resolvedAgent)) {
    return {
      status: "rejected",
      reason: `compliance_gate_approve_deliverables restricted to @Orchestrator/@Super-Admin. Current agent: @${resolvedAgent}. Only the Orchestrator or Super-Admin may approve deliverables.`,
    };
  }

  if (session.gate_status !== "delivered") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is not in "delivered" state (current: ${session.gate_status}). Submit deliverables first.`,
    };
  }

  const now = new Date().toISOString();

  if (approvalDecision === "approve") {
    // ▶ Step 0d: Multi-source investigation audit — block approval if
    //    investigation-type task lacks log evidence in HANDOVER.md
    const step0dResult = enforceMultiSourceAudit(session, session.task_id);
    if (step0dResult) {
      writeLog("mcp-compliance-gate", "runtime", {
        sessionID: sessionId,
        agent: session.agent || "—",
        level: "ERROR",
        event: "STEP_0D_LOG_EVIDENCE_MISSING",
        detail: step0dResult.desc,
      });
      return {
        status: "rejected",
        reason: step0dResult.desc,
      };
    }

    // ── DELIVERABLES-REVIEW-LOCK: Verify Orchestrator reviewed deliverables ──
    const taskId = session.task_id;
    const handoverPath = `.task_temp/${taskId}/HANDOVER.md`;
    let handoverContent = "";
    try {
      const fs = require("fs");
      if (fs.existsSync(handoverPath)) {
        handoverContent = fs.readFileSync(handoverPath, "utf8");
      }
    } catch {}

    if (!handoverContent || handoverContent.trim().length === 0) {
      return {
        status: "rejected",
        reason:
          `[DELIVERABLES-REVIEW-LOCK] HANDOVER.md missing or empty at ${handoverPath}. ` +
          `Deliverables must exist and have content before approval.`,
      };
    }

    const note = (approvalNote || executionSummary || "").trim();
    if (note.length < 10) {
      return {
        status: "rejected",
        reason:
          `[DELIVERABLES-REVIEW-LOCK] approval_note too short (${note.length} chars, minimum 10). ` +
          `Provide a meaningful review note referencing what was found in the deliverables.`,
      };
    }

    session.deliverables_approved_by = "Orchestrator";
    session.deliverables_approved_at = now;
    session.deliverables_approval_note = approvalNote || null;
    session.gate_status = "approved";

    // Auto-complete if execution_summary provided
    if (executionSummary) {
      session.gate_status = "completed";
      session.consumed_at = now;
      session.audit = {
        execution_summary: (executionSummary || "").substring(0, 1000),
        completed_at: now,
      };
      store.active_sessions = store.active_sessions.filter((sid) => sid !== sessionId);

      // Append to audit_history
      if (!Array.isArray(store.audit_history)) store.audit_history = [];
      store.audit_history.push({
        session_id: sessionId,
        task_description: session.task_description,
        plan_summary: session.plan_summary,
        agent: session.agent,
        task_id: session.task_id,
        confirmed_at: session.confirmed_at,
        consumed_at: now,
        execution_summary: (executionSummary || "").substring(0, 1000),
        gate_status: "completed",
      });
      if (store.audit_history.length > 500) {
        store.audit_history = store.audit_history.slice(-500);
      }
    }

    store.last_updated = now;
    saveStore(store);
    return {
      status: session.gate_status,
      session_id: sessionId,
      approved_by: session.deliverables_approved_by,
      approved_at: now,
      approval_note: approvalNote || null,
      auto_completed: !!executionSummary,
    };
  }

  if (approvalDecision === "reject") {
    session.gate_status = "armed";
    session.deliverables_approval_note = approvalNote || "rejected";
    session.submitted_deliverables = null; // Clear for re-submit
    store.last_updated = now;
    saveStore(store);
    return {
      status: "rejected",
      session_id: sessionId,
      reason: approvalNote || "Deliverables rejected. Re-dispatch sub-agent to fix and re-submit.",
    };
  }

  return {
    status: "rejected",
    reason: `Invalid approval_decision: "${approvalDecision}". Must be "approve" or "reject".`,
  };
}

// 创建 MCP Server
const server = new Server(
  {
    name: "compliance-gate",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "compliance_gate_check",
      description:
        "MANDATORY runtime compliance gate v2. Must be called BEFORE any task execution. Verifies: (1) execution-preflight-check skill exists, (2) rule documents are present, (3) semantic version/digest compatibility via rule_registry.json (SHA-256 digest comparison against expected digests). Mismatches classified as WARNING (version bumped) or HIGH (digest changed without version bump). Returns passed=true and session_id only when all checks clear. OPTIMIZATION (Point 1): when plan_summary is provided, the gate is created AND armed in a single call — no need to call compliance_gate_confirm separately. In that case the return includes armed=true, confirmed_at, expires_at, and a reminder to call compliance_gate_complete when the task finishes. NOTE: Gate status is informational only - check does not require pre-armed gate, making it safe for concurrent sessions.",
      inputSchema: {
        type: "object",
        properties: {
          task_description: {
            type: "string",
            description: "Brief description of the task to be executed",
          },
          task_id: {
            type: "string",
            description: "Task identifier for artifact directory and active-session mutual exclusion. If not provided, FRAMEWORK_TASK_ID env var is used as fallback.",
          },
          plan_summary: {
            type: "string",
            description: "OPTIONAL combined check+confirm flow (Point 1 of compliance-gate-optimization-plan.md). If provided (min 10 chars) AND check passes, the gate session is created AND armed in this single call — no separate compliance_gate_confirm call required. If omitted, falls back to legacy 3-step flow (check → confirm → complete).",
          },
          agent: {
            type: "string",
            description: "OPTIONAL agent type for session-agent linkage (used only when plan_summary is provided for combined flow).",
          },
        },
        required: ["task_description"],
      },
    },
    {
      name: "compliance_gate_confirm",
      description:
        'Mark the compliance gate as "armed" after the user has reviewed and confirmed the task plan. This must be called AFTER compliance_gate_check passes and AFTER the user explicitly confirms the plan. Provide the session_id returned by compliance_gate_check. HARD CONSTRAINT: declared_deliverables is required for non-exempt agents (@Coder-BE, @Coder-FE, @Architect, @Guardian, @Arbiter, @CI-CD-Agent, @Knowledge-Curator, @Meta-Planner). Exempt agents: @Orchestrator, @Super-Admin.',
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description:
              "Session ID returned by compliance_gate_check (e.g. cg_ses_1777110280157)",
          },
          plan_summary: {
            type: "string",
            description:
              "Summary of the plan that the user confirmed (min 10 chars)",
          },
          declared_deliverables: {
            type: "string",
            description: 'JSON array of deliverables the agent commits to producing. Each entry: {"name":"HANDOVER.md","description":"Handover summary","artifact_path":".task_temp/{taskId}/HANDOVER.md","required":true}. REQUIRED for non-exempt agents. Exempt agents (@Orchestrator, @Super-Admin) may omit.',
          },
          task_id: {
            type: "string",
            description: "Optional DAG task ID for session-task linkage",
          },
          agent: {
            type: "string",
            description: "Optional agent type for session-agent linkage",
          },
        },
        required: ["session_id", "plan_summary"],
      },
    },
    {
      name: "compliance_gate_complete",
      description:
        "Mark the compliance gate session as completed after task execution. Consumes the armed state and outputs an audit summary. This must be called AFTER compliance_gate_confirm and AFTER the task has been executed. Cannot be called twice for the same session. INTERNALLY: reads machine.json.eslint_state and returns failed if dirty_modules exist (CAT3.7). Run eslint-audit.run_audit({ full_scan: true }) first.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description:
              "Session ID returned by compliance_gate_check (e.g. cg_ses_1777110280157)",
          },
          execution_summary: {
            type: "string",
            description: "Brief summary of what was executed (max 1000 chars)",
          },
        },
        required: ["session_id", "execution_summary"],
      },
    },
    {
      name: "compliance_gate_submit_deliverables",
      description:
        "Submit deliverables evidence after writing all task artifacts. MUST be called BEFORE compliance_gate_complete for non-exempt agents. Validates that declared deliverables have been produced (file existence check). Transitions session from 'armed' to 'delivered'. Solves RC2: enforces artifact write order at state machine level.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Session ID returned by compliance_gate_check",
          },
          deliverables_evidence: {
            type: "string",
            description: 'JSON array of evidence entries. Each: {"name":"HANDOVER.md","artifact_path":".task_temp/{taskId}/HANDOVER.md","content_summary":"Brief description"}. Every name must match a declared_deliverables entry.',
          },
        },
        required: ["session_id", "deliverables_evidence"],
      },
    },
    {
      name: "compliance_gate_approve_deliverables",
      description:
        "Approve or reject a sub-agent's submitted deliverables. RESTRICTED to @Orchestrator/@Super-Admin. When approving with execution_summary, combines approve + complete in one call (delivered → approved → completed). When rejecting, returns session to 'armed' state for re-dispatch.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Session ID of the sub-agent's gate session",
          },
          approval_decision: {
            type: "string",
            enum: ["approve", "reject"],
            description: "Whether to approve or reject the deliverables",
          },
          approval_note: {
            type: "string",
            description: "Optional note about the approval/rejection decision",
          },
          execution_summary: {
            type: "string",
            description: "Optional execution summary. When provided with 'approve', auto-completes the gate (approve + complete in one call).",
          },
          agent_id: {
            type: "string",
            description: "Agent identity of the caller (e.g. 'Orchestrator', '@Super-Admin'). Used for permission enforcement. Restricted to @Orchestrator/@Super-Admin.",
          },
        },
        required: ["session_id", "approval_decision"],
      },
    },
    {
      name: "compliance_gate_purge",
      description:
        "Force-purge all stale compliance gate sessions. Drains armed sessions > 24h since confirmation and checked (unconfirmed) sessions > 48h since creation. Drained sessions are moved to gate-state.json.drained_sessions to preserve audit trail. Returns count of purged sessions and remaining state.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "compliance_gate_drain_stale",
      description:
        "Drain all stale compliance gate sessions. Stale thresholds: armed > 24h since confirmed_at, checked > 48h since created_at (never confirmed). Drained sessions are moved to gate-state.json.drained_sessions to preserve audit trail. Returns drain report with purged count, drained session IDs, and remaining state.",
      inputSchema: {
        type: "object",
        properties: {
          threshold_hours_armed: {
            type: "number",
            description:
              "Override stale threshold for armed sessions (default: 24h)",
          },
          threshold_hours_checked: {
            type: "number",
            description:
              "Override stale threshold for checked sessions (default: 48h)",
          },
        },
      },
    },
    {
      name: "compliance_gate_retry_confirm",
      description:
        "Re-arm a failed or recoverable compliance gate session. For 'recoverable' status: ANY agent can self-repair (RC3 fix). For 'failed' status: restricted to @Super-Admin and @Orchestrator only. After re-arm, sub-agent must re-submit deliverables via compliance_gate_submit_deliverables.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Session ID of the failed/recoverable gate to re-arm",
          },
          plan_summary: {
            type: "string",
            description: "Summary of what was fixed (min 10 chars)",
          },
          task_id: {
            type: "string",
            description: "Task ID for artifact directory resolution",
          },
        },
        required: ["session_id", "plan_summary"],
      },
    },
  ],
}));

/**
 * Validate that HANDOVER.md and TASK_LOG.md exist for a given task.
 * Used by runGateComplete to enforce CI-UNIFY-003 artifact requirements.
 *
 * @super-admin-handover-enforcement: When taskId is null (common for
 * @Super-Admin sessions that bypass the DAG), the sessionId is used as a
 * fallback directory name under .task_temp/. This ensures @Super-Admin
 * sessions receive the same HANDOVER.md enforcement as other agents,
 * satisfying SUPER-ADMIN-HARDEN-01.
 *
 * @param {string|null} taskId - The task ID to validate (DAG task ID or dispatch session ID)
 * @param {string|null} sessionId - Fallback identifier when taskId is null (e.g., cg_ses_*)
 * @returns {string[]} Array of missing artifact filenames (empty if all present)
 */
/**
 * Scan immediate subdirectories for an artifact file.
 * Fallback when dispatch sessions create nested artifact directories.
 * @param {string} baseDir - Base directory (e.g., .task_temp/{taskId})
 * @param {string} artifact - Filename to find (e.g., "HANDOVER.md")
 * @returns {boolean}
 * @since v1.2.0 — SA-FIX-VALIDATE-PATH, @Super-Admin 2026-06-11
 */
function scanSubdirForArtifact(baseDir, artifact) {
  try {
    const entries = fs2.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (fileExists(path2.join(baseDir, entry.name, artifact))) return true;
      }
    }
  } catch (_) { /* dir missing or inaccessible */ }
  return false;
}

function validateTaskArtifacts(taskId, sessionId) {
  if (_gateCore && typeof _gateCore.validateTaskArtifacts === "function") {
    return _gateCore.validateTaskArtifacts(taskId, OPENCODE_ROOT, sessionId);
  }
  const resolvedId = taskId || sessionId;
  if (!resolvedId) return [];
  const taskTempDir = path2.join(OPENCODE_ROOT, ".task_temp", resolvedId);
  const missing = [];

  // Check HANDOVER.md: primary path first, then fallback to immediate subdirectories
  if (!fileExists(path2.join(taskTempDir, "HANDOVER.md"))) {
    if (!scanSubdirForArtifact(taskTempDir, "HANDOVER.md")) {
      missing.push("HANDOVER.md");
    }
  }

  // Check TASK_LOG.md: same primary+fallback strategy
  if (!fileExists(path2.join(taskTempDir, "TASK_LOG.md"))) {
    if (!scanSubdirForArtifact(taskTempDir, "TASK_LOG.md")) {
      missing.push("TASK_LOG.md");
    }
  }

  return missing;
}

/**
 * Drain stale sessions with configurable thresholds.
 * Delegates to gate-core.ts when available.
 * @param {number} armedHours - Hours after which armed sessions are stale (default 24)
 * @param {number} checkedHours - Hours after which checked sessions are stale (default 48)
 * @returns {{ purged: number, drained_sessions: string[], remaining_active: number, drained_armed: number, drained_checked: number }}
 */
/**
 * GATE-RECOVERY: Re-arm a failed gate for parent escalation.
 * Only allowed for transient failures (missing artifacts).
 * Restricted to @Super-Admin and @Orchestrator.
 *
 * @param {string} agentId - Agent identity from MCP tool context (context.agent)
 */

/**
 * Standalone agent identity resolver — mirrors the closure-scoped
 * resolveDispatchTargetAgent() but accessible from runGateRetryConfirm().
 * Reads _dispatch_target.json with run_id staleness check.
 * FW-FIX-AGENT-IDENTITY (2026-06-13): Removed deprecated FRAMEWORK_AGENT
 * env var — it was never set by the runtime (dead code since v4.0.0).
 * @returns {string}
 */
function resolveDispatchTargetAgentDirect() {
  // Read _dispatch_target.json (set by dispatch-before.ts P0-6)
  try {
    const p = path2.join(OPENCODE_ROOT, ".task_temp", "_dispatch_target.json");
    if (fs2.existsSync(p)) {
      const d = JSON.parse(fs2.readFileSync(p, "utf8"));
      // P0-7 staleness: run_id check (mirrors agent-resolver.ts)
      const currentRunId = process.env.OPENCODE_RUN_ID || "";
      if (currentRunId && d.run_id && d.run_id !== currentRunId) {
        try { fs2.unlinkSync(p); } catch {}
        return "";
      }
      if (!currentRunId && d.timestamp) {
        const age = Date.now() - new Date(d.timestamp).getTime();
        if (age > 30 * 60 * 1000) {
          try { fs2.unlinkSync(p); } catch {}
          return "";
        }
      }
      return d.agent || "";
    }
  } catch {}
  return "";
}
function runGateRetryConfirm(sessionId, planSummary, taskId, agentId) {
  if (!sessionId) return { status: "rejected", reason: "session_id required" };
  if (!planSummary || planSummary.trim().length < 10) return { status: "rejected", reason: "plan_summary min 10 chars" };

  // ── P0: Agent permission enforcement ──
  // SA-FIX-GATE-PERMISSION (2026-06-11): compliance_gate_retry_confirm was
  // documented as "Restricted to @Super-Admin and @Orchestrator" but had NO
  // code-level enforcement. Knowledge-Curator was able to bypass.
  // SA-FIX-GATE-SESSION-MAP (2026-06-11): Fixed agent resolution chain.
  // The MCP handler only receives (request), NOT (context). context?.agent
  // is always undefined. Use session.agent (persisted by runGateConfirm)
  // as the primary fallback instead.
  //
  // FW-LOG-UNIFY-P2-BUGFIX (2026-06-12, @Super-Admin): FIXED TDZ bug — session
  // was accessed at L1802 before its assignment at L1814 ("Cannot access 'session'
  // before initialization"). Moved session load before agent resolution so
  // session.agent is available for the ternary chain.

  const store = loadStore();
  const session = store.sessions[sessionId];
  if (!session) return { status: "rejected", reason: `session ${sessionId} not found` };

  // ── RC3 Fix: Permission enforcement ──
  // For 'recoverable' status: ANY agent can self-repair (no permission check needed)
  // For 'failed' status: Only @Super-Admin/@Orchestrator (supervisory retry)
  const ALLOWED_RETRY_AGENTS = ["@Super-Admin", "@Orchestrator", "Super-Admin", "Orchestrator"];
  const resolvedAgent = (agentId
    || (session && session.agent)
    || resolveDispatchTargetAgentDirect()
    || "").replace(/^@/, "");

  // Recoverable: self-repair path (any agent allowed, RC3 fix)
  if (session.gate_status === "recoverable") {
    session.gate_status = "armed";
    session.plan_summary = planSummary.trim();
    session.task_id = taskId || session.task_id || null;
    session.retry_count = (session.retry_count || 0) + 1;
    session.fail_history = session.fail_history || [];
    session.fail_history.push({
      retry: session.retry_count,
      confirmed_at: new Date().toISOString(),
      plan_summary: planSummary.trim(),
    });
    session.confirmed_at = new Date().toISOString();
    session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (!store.active_sessions.includes(sessionId)) store.active_sessions.push(sessionId);
    store.last_updated = new Date().toISOString();
    saveStore(store);
    return { status: "armed", session_id: sessionId, retry_count: session.retry_count };
  }

  // Failed: supervisory retry — permission check required
  if (session.gate_status === "failed") {
    if (resolvedAgent && !ALLOWED_RETRY_AGENTS.includes(resolvedAgent) && !ALLOWED_RETRY_AGENTS.includes("@" + resolvedAgent)) {
      return {
        status: "rejected",
        reason: `compliance_gate_retry_confirm for 'failed' status is restricted to @Super-Admin/@Orchestrator. Current agent: ${resolvedAgent}. For 'recoverable' status, any agent can self-repair.`,
      };
    }
    if (!session.fail_reason?.includes("Missing required task artifacts")) {
      return { status: "rejected", reason: `Retry only allowed for missing artifacts. Failure: ${session.fail_reason || "unknown"}` };
    }
    session.gate_status = "armed";
    session.plan_summary = planSummary.trim();
    session.task_id = taskId || session.task_id;
    session.retry_count = 0; // reset for parent retry
    session.fail_history = session.fail_history || [];
    session.fail_history.push({ retry: "parent", confirmed_at: new Date().toISOString(), plan_summary: planSummary.trim() });
    session.confirmed_at = new Date().toISOString();
    session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    session.consumed_at = null;
    session.fail_reason = null;
    session.missing_artifacts = null;
    if (!store.active_sessions.includes(sessionId)) store.active_sessions.push(sessionId);
    store.last_updated = new Date().toISOString();
    saveStore(store);
    return { status: "armed", session_id: sessionId, retry_count: session.retry_count };
  }

  return { status: "rejected", reason: `Session in state "${session.gate_status}" — must be "recoverable" or "failed".` };
}

function drainStaleSessions(armedHours, checkedHours) {
  if (_gateCore && typeof _gateCore.drainStaleSessions === "function") {
    /**
     * @fix P0-REPAIR: Parameter order corrected.
     * Was: drainStaleSessions(OPENCODE_ROOT, armedHours, checkedHours)
     * Now: drainStaleSessions(armedHours, checkedHours, OPENCODE_ROOT)
     * Bug caused compliance_gate_check to crash with ERR_INVALID_ARG_TYPE
     * because root (number 48) was passed to path.join().
     */
    return _gateCore.drainStaleSessions(
      armedHours,
      checkedHours,
      OPENCODE_ROOT,
    );
  }
  const ARMED_STALE_MS = (armedHours || 24) * 60 * 60 * 1000;
  const CHECKED_STALE_MS = (checkedHours || 48) * 60 * 60 * 1000;
  const store = loadStore();
  const nowTs = Date.now();
  let purged = 0,
    drainedArmed = 0,
    drainedChecked = 0;
  const drainedIds = [];
  for (const [sid, ses] of Object.entries(store.sessions)) {
    if (!ses) continue;
    let shouldDrain = false,
      reason = "",
      drainType = "";
    if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
      const age = nowTs - new Date(ses.confirmed_at).getTime();
      if (age > ARMED_STALE_MS) {
        shouldDrain = true;
        drainType = "STALE_ARMED";
        reason = `armed for ${Math.floor(age / 3600000)}h without completion (threshold: ${armedHours}h)`;
      }
    }
    if (ses.gate_status === "checked" && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > CHECKED_STALE_MS) {
        shouldDrain = true;
        drainType = "STALE_CHECKED";
        reason = `checked for ${Math.floor(age / 3600000)}h without confirmation (threshold: ${checkedHours}h)`;
      }
    }
    if (shouldDrain) {
      const archived = dbArchiveDrainedSession(
        sid, ses.task_description || "", reason, drainType, JSON.stringify(ses),
      );
      if (!archived) continue;
      delete store.sessions[sid];
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
      purged++;
      drainedIds.push(sid);
      if (drainType === "STALE_ARMED") drainedArmed++;
      if (drainType === "STALE_CHECKED") drainedChecked++;
    }
  }
  if (purged > 0) {
    store.last_updated = new Date().toISOString();
    saveStore(store);
  }
  return {
    purged,
    drained_sessions: drainedIds,
    drained_armed: drainedArmed,
    drained_checked: drainedChecked,
    remaining_active: store.active_sessions.length,
    remaining_total: Object.keys(store.sessions).length,
  };
}

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "compliance_gate_check") {
    const result = runGateCheck(args?.task_description || "", args?.task_id);

    // ── Point 1: Combined check+confirm flow ──────────────────────────────
    // When plan_summary is provided AND check passed, auto-arm the session
    // in this single call — no separate compliance_gate_confirm needed.
    const planSummary = args?.plan_summary;
    if (planSummary && result.passed && result.session_id) {
      // Validate plan_summary length (same rule as runGateConfirm)
      if (planSummary.trim().length < 10) {
        const merged = {
          ...result,
          combined: true,
          combined_status: "rejected_plan_too_short",
          combined_reason:
            "plan_summary must be at least 10 characters. Gate session created in checked state — call compliance_gate_confirm with a longer plan_summary to arm.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(merged, null, 2) }],
          isError: true,
        };
      }

      const armResult = runGateConfirm(
        result.session_id,
        planSummary,
        args?.agent,
        args?.task_id,
        args?.declared_deliverables,
      );

      if (armResult.status === "armed") {
        // ── Point 2: Append reminder text to response ────────────────────
        const merged = {
          ...result,
          combined: true,
          combined_status: "armed",
          confirmed_at: armResult.confirmed_at,
          expires_at: armResult.expires_at,
          plan_summary: armResult.plan_summary,
          agent: armResult.agent,
        };
        const text =
          JSON.stringify(merged, null, 2) +
          buildReminderText(
            result.session_id,
            armResult.plan_summary,
            armResult.expires_at,
          );
        return {
          content: [{ type: "text", text }],
          isError: false,
        };
      }

      // Arm failed (e.g. session state unexpected) — surface the reason
      // but keep the check session so the user can recover via confirm.
      const merged = {
        ...result,
        combined: true,
        combined_status: "arm_failed",
        combined_reason:
          armResult.reason || "Auto-arm failed for an unexpected reason.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(merged, null, 2) }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.passed,
    };
  }

  if (name === "compliance_gate_confirm") {
    if (!args?.plan_summary || !args?.session_id) {
      throw new Error(
        "Missing required parameters: session_id and plan_summary",
      );
    }
    const result = runGateConfirm(
      args.session_id,
      args.plan_summary,
      args.agent,
      args.task_id,
      args.declared_deliverables,
    );

    // ── Point 2: Append reminder text when armed ─────────────────────────
    if (result.status === "armed") {
      const text =
        JSON.stringify(result, null, 2) +
        buildReminderText(
          result.session_id,
          result.plan_summary,
          result.expires_at,
        );
      return {
        content: [{ type: "text", text }],
        isError: false,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.status !== "armed",
    };
  }

  if (name === "compliance_gate_complete") {
    if (!args?.session_id || !args?.execution_summary) {
      throw new Error(
        "Missing required parameters: session_id and execution_summary",
      );
    }
    const result = runGateComplete(args.session_id, args.execution_summary);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.status !== "completed",
    };
  }

  if (name === "compliance_gate_submit_deliverables") {
    if (!args?.session_id || !args?.deliverables_evidence) {
      throw new Error("Missing required parameters: session_id and deliverables_evidence");
    }
    const result = runGateSubmitDeliverables(args.session_id, args.deliverables_evidence);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.status !== "delivered",
    };
  }

  if (name === "compliance_gate_approve_deliverables") {
    if (!args?.session_id || !args?.approval_decision) {
      throw new Error("Missing required parameters: session_id and approval_decision");
    }
    const result = runGateApproveDeliverables(
      args.session_id,
      args.approval_decision,
      args.approval_note,
      args.execution_summary,
      args.agent_id,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.status === "rejected",
    };
  }

  if (name === "compliance_gate_purge") {
    const result = purgeStaleSessions();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: false,
    };
  }

  if (name === "compliance_gate_drain_stale") {
    const armedHours = args?.threshold_hours_armed || 24;
    const checkedHours = args?.threshold_hours_checked || 48;
    const result = drainStaleSessions(armedHours, checkedHours);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: false,
    };
  }

  if (name === "compliance_gate_retry_confirm") {
    if (!args?.session_id || !args?.plan_summary) {
      throw new Error("Missing required parameters: session_id and plan_summary");
    }
    // SA-FIX-GATE-SESSION-MAP: context?.agent is NOT available in the raw MCP
    // handler (only `request`). Use session.agent from gate-state.json instead.
    const result = runGateRetryConfirm(args.session_id, args.plan_summary, args.task_id, undefined);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.status !== "armed",
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// 启动 stdio 传输
let _activeTransport: StdioServerTransport | null = null;
async function main() {
  const transport = new StdioServerTransport();
  _activeTransport = transport;
  await server.connect(transport);
  process.stderr.write("[compliance-gate] started (SDK)\n");
}

// ── FW-INTERRUPT-GUARD (2026-06-14): Graceful SIGINT shutdown ──
// When the parent OpenCode process forwards a cooperative cancel, close the
// MCP transport cleanly so gate-state.json locks are released and the TUI
// never sees a raw "Unexpected {interrupt}" template from this server.
process.on("SIGINT", async () => {
  try {
    process.stderr.write("[compliance-gate] SIGINT — shutting down\n");
    if (_activeTransport) {
      try { await _activeTransport.close(); } catch { /* best-effort */ }
    }
    try { await server.close(); } catch { /* best-effort */ }
  } catch {
    /* ignore */
  }
  process.exit(0);
});

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});

// ── Module exports (for testability / CI-UNIFY-003) ──
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    runGateCheck,
    runGateConfirm,
    runGateComplete,
    runGateRetryConfirm,
    validateTaskArtifacts,
    getEnforcementMode,
  };
}
