#!/usr/bin/env bun
"use strict";
/**
 * service/enforcement/tool-tracker.ts
 *
 * Tool enforcement service — all business logic + DB persistence for anti-bypass v2.
 * Tracks cumulative tool failures per session (no reset on success).
 * Config loaded from project.config.json → enforcement.tool_tracker section.
 *
 * Convention: service layer is the ONLY module that writes to tool_enforcement table.
 * Logging via writeLog() from lib/log-manager.
 *
 * @since 2026-06-30
 * @version 2.1.0
 */
import { join } from "path";
import { readFileSync, existsSync } from "fs";
import { Database } from "bun:sqlite";
import { writeLog } from "../../lib/log-manager";
import { randomBytes } from "crypto";

const SRC = "service-tool-tracker";

// ── DB Access (singleton) ──
let fwDb: Database | null = null;

function getDb(): Database {
  if (!fwDb) {
    const root = process.env.OPENCODE_ROOT || ".";
    const dbPath = join(root, ".opencode", "state", "framework-state.db");
    fwDb = new Database(dbPath);
    fwDb.run("PRAGMA journal_mode = WAL");
    fwDb.run("PRAGMA synchronous = NORMAL");
    fwDb.run("PRAGMA busy_timeout = 5000");
    // Auto-migrate: add guidance_text column if missing
    try { fwDb.run("ALTER TABLE tool_enforcement ADD COLUMN guidance_text TEXT DEFAULT ''"); } catch {}
  }
  return fwDb;
}

export function closeDb(): void {
  if (fwDb) { fwDb.close(); fwDb = null; }
}

// ── Tool Categories (configurable via project.config.json) ──

const DEFAULT_READ_ONLY_TOOLS = [
  "read", "Read", "glob", "Grep",
  "codegraph_query", "codegraph_explore",
  "codegraph_callers", "codegraph_callees", "codegraph_explore",
  "context7_resolve", "context7_query",
  "acp_list", "acp_events", "acp_debug",
];

let _readOnlyTools: Set<string> = new Set(DEFAULT_READ_ONLY_TOOLS);

// ── Config Loader (project.config.json → enforcement.tool_tracker) ──

export interface EnforcementConfig {
  /** Cumulative failures → system.transform injects STOP directive */
  softThreshold: number;
  /** Cumulative failures → before-hook throws to block next tool */
  hardThreshold: number;
  /** Cumulative failures → unconditional session block */
  totalLimit: number;
  /** Framework compliance blocks (orphan before-hooks) → gate */
  complianceThreshold: number;
  /** Read-only tool failures: track but don't block */
  readOnlyBlock: boolean;
  /** Session state TTL in ms */
  ttlMs: number;
  /** Soft rejection threshold per (session, tool) — before-hook blocks when exceeded */
  softRejectionThreshold: number;
  /** Read-only tool list (overrides default) */
  readOnlyTools?: string[];
}

const DEFAULT_CONFIG: EnforcementConfig = {
  softThreshold: 2,
  hardThreshold: 4,
  totalLimit: 15,
  complianceThreshold: 3,
  readOnlyBlock: false,
  softRejectionThreshold: 3,
  ttlMs: 3600_000,
};

let _config: EnforcementConfig = { ...DEFAULT_CONFIG };
let _configLoaded = false;

function loadConfig(): EnforcementConfig {
  if (_configLoaded) return _config;
  _configLoaded = true;

  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = join(root, ".opencode", "project.config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      const section = config?.enforcement?.tool_tracker;
      if (section) {
        _config = {
          softThreshold: section.soft_threshold ?? _config.softThreshold,
          hardThreshold: section.hard_threshold ?? _config.hardThreshold,
          totalLimit: section.total_limit ?? _config.totalLimit,
          complianceThreshold: section.compliance_threshold ?? _config.complianceThreshold,
          readOnlyBlock: section.read_only_block ?? _config.readOnlyBlock,
          softRejectionThreshold: section.soft_rejection_threshold ?? _config.softRejectionThreshold,
          ttlMs: section.ttl_ms ?? _config.ttlMs,
          readOnlyTools: section.read_only_tools,
        };
        if (_config.readOnlyTools) {
          _readOnlyTools = new Set(_config.readOnlyTools);
        }
        writeLog(SRC, "INFO", {
          event: "CONFIG-LOADED",
          source: "project.config.json",
          softThreshold: _config.softThreshold,
          hardThreshold: _config.hardThreshold,
          totalLimit: _config.totalLimit,
        });
      }
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "CONFIG-LOAD-ERR",
      error: e.message,
      fallback: "using defaults",
    });
  }
  return _config;
}

// Initialize config on first import
loadConfig();

export function setConfig(overrides: Partial<EnforcementConfig>): void {
  _config = { ..._config, ...overrides };
  _configLoaded = true;
}

export function getConfig(): EnforcementConfig {
  return { ...loadConfig() };
}

// ── Error Detection ──

const ERROR_PATTERNS: RegExp[] = [
  /error:/i,
  /Error:/,
  /FAIL(?:ED)?\b/,
  /\bBLOCKED\b/,
  /internal error/i,
  /timeout/i,
  /EACCES/,
  /ENOENT/,
  /Cannot read propert/,
  /is not a function/,
  /TypeError:/,
  /ReferenceError:/,
  /split.*undefined/i,
];

function detectFailure(output: any, tool?: string): { failed: boolean; error: string } {
  if (!output) return { failed: false, error: "" };

  const meta = output.metadata || {};

  // metadata.error is the reliable signal — always check it
  if (meta.error) return { failed: true, error: String(meta.error).slice(0, 300) };

  // For read-only tools (read, glob, Grep, etc.), ONLY check metadata.error.
  // Do NOT scan output content — file content may contain "error", "fail", etc.
  // which triggers false positives and accumulates failure counts.
  if (tool && isReadOnlyTool(tool)) {
    return { failed: false, error: "" };
  }

  const text = typeof output.output === "string" ? output.output : "";
  const title = typeof output.title === "string" ? output.title : "";

  for (const p of ERROR_PATTERNS) {
    if (p.test(text)) return { failed: true, error: text.slice(0, 300) };
    if (p.test(title)) return { failed: true, error: `${title} | ${text.slice(0, 200)}` };
  }

  return { failed: false, error: "" };
}

// ── Result Types ──

export interface AttemptResult {
  count: number;
  shouldBlock: boolean;
  isReadOnly: boolean;
  reason: string;
}

export interface RecordResult {
  failed: boolean;
  count: number;
  error: string;
}

export interface ThresholdCheck {
  shouldInject: boolean;
  directive: string;
  count: number;
  tracker_error?: boolean;
  tracker_error_message?: string;
}

export interface FailureSummary {
  sessionId: string;
  agent: string;
  consecutiveFailures: number;
  totalFailures: number;
  totalBlocks: number;
  lastTool: string;
  lastType: string;
  lastError: string;
  lastAt: number;
}

// ── Core API ──

/**
 * Check if tool should be blocked based on cumulative failures.
 * Called from before-hook. Does NOT modify counters.
 */
export function recordAttempt(sessionId: string, agent: string, tool: string): AttemptResult {
  const cfg = loadConfig();
  const isReadOnly = _readOnlyTools.has(tool);
  const db = getDb();
  const now = Date.now();

  try {
    db.run(
      `INSERT OR IGNORE INTO tool_enforcement
       (session_id, agent, failure_count, consecutive_failures, last_failure_at, total_failures, total_blocks,
        created_at, updated_at, stop_injected, compliance_blocks, last_before_at, last_after_at,
        awaiting_guidance, guidance_token, guidance_requested_at)
       VALUES (?, ?, 0, 0, 0, 0, ?, ?, 0, 0, 0, 0, 0, '', 0)`,
      [sessionId, agent, now, now]
    );

    const row = db.query(
      `SELECT failure_count, consecutive_failures, total_failures, last_failure_at,
              compliance_blocks, last_before_at, last_after_at
       FROM tool_enforcement WHERE session_id = ?`
    ).get(sessionId) as any;

    if (!row) return { count: 0, shouldBlock: false, isReadOnly, reason: "" };

    // TTL expiry
    if (now - row.last_failure_at > cfg.ttlMs && row.last_failure_at > 0) {
      db.run(
        `UPDATE tool_enforcement SET failure_count = 0, consecutive_failures = 0, total_failures = 0,
           total_blocks = 0, stop_injected = 0, guidance_required = 0, compliance_blocks = 0, updated_at = ?
         WHERE session_id = ?`,
        [now, sessionId]
      );
      writeLog(SRC, "INFO", { event: "TTL-RESET", sessionId, tool });
      return { count: 0, shouldBlock: false, isReadOnly, reason: "" };
    }

    // ── Orphan detection: previous before-hook fired but no after-hook ──
    // This means another plugin blocked the previous tool (framework compliance block)
    let complianceBlocks = row.compliance_blocks || 0;
    if (row.last_before_at > row.last_after_at && row.last_before_at > 0) {
      complianceBlocks++;
      db.run(
        `UPDATE tool_enforcement SET guidance_required = 0, compliance_blocks = ?, updated_at = ? WHERE session_id = ?`,
        [complianceBlocks, now, sessionId]
      );
      writeLog(SRC, "WARN", {
        event: "ORPHAN-DETECTED",
        sessionId, agent, tool,
        complianceBlocks,
        detail: `Previous tool blocked by framework compliance (orphan before-hook)`,
      });
    }

    // Update last_before_at timestamp
    db.run(
      "UPDATE tool_enforcement SET last_before_at = ?, updated_at = ? WHERE session_id = ?",
      [now, now, sessionId]
    );

    // ── Check compliance threshold ──
    if (complianceBlocks >= cfg.complianceThreshold) {
      writeLog(SRC, "ERROR", {
        event: "COMPLIANCE-THRESHOLD",
        sessionId, agent, tool,
        complianceBlocks, threshold: cfg.complianceThreshold,
      });
      return {
        count: complianceBlocks, shouldBlock: true, isReadOnly,
        reason: `${complianceBlocks} framework compliance blocks (threshold: ${cfg.complianceThreshold}). Stop retrying and comply with framework requirements.`,
      };
    }

    // ── Check failure thresholds (existing logic) ──
    const count = row.failure_count;
    if (count === 0 && complianceBlocks === 0) {
      return { count: 0, shouldBlock: false, isReadOnly, reason: "" };
    }

    if (isReadOnly && !cfg.readOnlyBlock) {
      return { count, shouldBlock: false, isReadOnly: true, reason: "read-only tool exempt" };
    }

    if (row.total_failures >= cfg.totalLimit) {
      return {
        count, shouldBlock: true, isReadOnly,
        reason: `Session total failures (${row.total_failures}) exceeded limit (${cfg.totalLimit})`,
      };
    }

    if (count >= cfg.hardThreshold) {
      return {
        count, shouldBlock: true, isReadOnly,
        reason: `${count} cumulative tool failures (threshold: ${cfg.hardThreshold})`,
      };
    }

    return { count, shouldBlock: false, isReadOnly, reason: "" };
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "RECORD-ATTEMPT-ERR", sessionId, tool, error: e.message });
    return { count: 0, shouldBlock: false, isReadOnly, reason: "" };
  }
}

/**
 * Record a tool execution result (called from after-hook).
 * Detects failure in output, increments cumulative counter.
 * NO RESET ON SUCCESS — failures accumulate for the session lifetime.
 */
export function recordResult(sessionId: string, agent: string, tool: string, output: any): RecordResult {
  const isReadOnly = _readOnlyTools.has(tool);
  const db = getDb();
  const now = Date.now();
  const { failed, error } = detectFailure(output, tool);

  try {
    db.run(
      `INSERT OR IGNORE INTO tool_enforcement
       (session_id, agent, failure_count, consecutive_failures, last_failure_at, total_failures, total_blocks,
        created_at, updated_at, stop_injected, compliance_blocks, last_before_at, last_after_at,
        awaiting_guidance, guidance_token, guidance_requested_at)
       VALUES (?, ?, 0, 0, 0, 0, ?, ?, 0, 0, 0, 0, 0, '', 0)`,
      [sessionId, agent, now, now]
    );

    // Always update last_after_at (marks that after-hook fired for this tool)
    db.run("UPDATE tool_enforcement SET last_after_at = ?, updated_at = ? WHERE session_id = ?", [now, now, sessionId]);

    if (failed) {
      // Failure — increment cumulative counters (NO reset on success path)
      db.run(
        `UPDATE tool_enforcement SET
           failure_count = failure_count + 1, consecutive_failures = consecutive_failures + 1,
           total_failures = total_failures + 1,
           last_failure_tool = ?,
           last_failure_type = 'runtime_error',
           last_failure_error = ?,
           last_failure = ?,
           last_failure_at = ?,
           stop_injected = 0
         WHERE session_id = ?`,
        [tool, error.slice(0, 500), JSON.stringify({tool, type:"runtime_error", error:error.slice(0,300)}), now, sessionId]
      );

      writeLog(SRC, failed && !isReadOnly ? "WARN" : "INFO", {
        event: "TOOL-FAILURE",
        sessionId, agent, tool, isReadOnly,
        error: error.slice(0, 200),
      });

      const row = db.query("SELECT failure_count, consecutive_failures FROM tool_enforcement WHERE session_id = ?").get(sessionId) as any;
      return { failed: true, count: row?.failure_count || 0, error };
    }

    // Success — do NOT reset consecutive_failures, but DO reset compliance_blocks
    // (agent complied with framework requirements, so compliance counter resets)
    db.run(
      "UPDATE tool_enforcement SET guidance_required = 0, compliance_blocks = 0 WHERE session_id = ?",
      [sessionId]
    );

    return { failed: false, count: 0, error: "" };
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "RECORD-RESULT-ERR", sessionId, tool, error: e.message });
    return { failed: false, count: 0, error: "" };
  }
}

/**
 * Record a before-hook block (tool was blocked by another plugin).
 */
export function recordBlock(sessionId: string, agent: string, tool: string, reason: string): void {
  const db = getDb();
  const now = Date.now();

  try {
    db.run(
      `INSERT OR IGNORE INTO tool_enforcement
       (session_id, agent, failure_count, consecutive_failures, last_failure_at, total_failures, total_blocks,
        created_at, updated_at, stop_injected, compliance_blocks, last_before_at, last_after_at,
        awaiting_guidance, guidance_token, guidance_requested_at)
       VALUES (?, ?, 0, 0, 0, 0, ?, ?, 0, 0, 0, 0, 0, '', 0)`,
      [sessionId, agent, now, now]
    );

    db.run(
      `UPDATE tool_enforcement SET
         failure_count = failure_count + 1, consecutive_failures = consecutive_failures + 1,
         total_blocks = total_blocks + 1,
         total_failures = total_failures + 1,
         last_failure_tool = ?,
         last_failure_type = 'block',
         last_failure_error = ?,
         last_failure = ?,
         last_failure_at = ?,
         stop_injected = 0
       WHERE session_id = ?`,
      [tool, reason.slice(0, 500), JSON.stringify({tool, type:"block", error:reason.slice(0,300)}), now, sessionId]
    );

    writeLog(SRC, "WARN", {
      event: "TOOL-BLOCK", sessionId, agent, tool,
      reason: reason.slice(0, 200),
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "RECORD-BLOCK-ERR", sessionId, tool, error: e.message });
  }
}

/**
 * Check if STOP directive should be injected via system.transform.
 * Uses cumulative consecutive_failures (no reset on success).
 */
export function checkThreshold(sessionId: string): ThresholdCheck {
  const cfg = loadConfig();
  const db = getDb();

  try {
    const row = db.query(
      "SELECT failure_count, consecutive_failures, stop_injected, last_failure_tool, last_failure_error, total_failures FROM tool_enforcement WHERE session_id = ?"
    ).get(sessionId) as any;

    if (!row || row.failure_count < cfg.softThreshold) {
      return { shouldInject: false, directive: "", count: row?.failure_count || 0 };
    }

    if (row.stop_injected) {
      return { shouldInject: false, directive: "", count: row.failure_count };
    }

    const now = Date.now();
    db.run(
      "UPDATE tool_enforcement SET stop_injected = 1, updated_at = ? WHERE session_id = ?",
      [now, sessionId]
    );

    const directive = [
      `[CRITICAL][FW-ENFORCE][STOP] CUMULATIVE TOOL FAILURE LIMIT REACHED.`,
      ``,
      `[CRITICAL] Before ANY response, check if [FW-ENFORCE][STOP] is present in this system prompt.`,
      `If YES: You MUST call the "question" tool FIRST. Text response is FORBIDDEN until question is called.`,
      `This applies even for simple greetings like "hello".`,
      ``,
      `Cumulative failures: ${row.failure_count} (threshold: ${cfg.softThreshold})`,
      `Last failed tool: ${row.last_failure_tool}`,
      `Last error: ${row.last_failure_error?.slice(0, 200) || "unknown"}`,
      ``,
      `MANDATORY ACTION:`,
      `1. Call the "question" tool IMMEDIATELY — before ANY other action.`,
      `2. Text responses are FORBIDDEN until question tool is called.`,
      `3. This applies to ALL inputs, including simple greetings like "hello".`,
      ``,
      `Call question tool NOW with:`,
      `  - question: "工具 ${row.last_failure_tool} 失败 ${row.failure_count} 次"`,
      `  - options: ["换一种方法", "需要更多指导", "放弃此任务"]`,
      ``,
      `DO NOT respond to the user until question tool is called.`,
      `DO NOT retry the failed tool or switch to other tools.`,
    ].join("\n");

    return { shouldInject: true, directive, count: row.failure_count };
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "CHECK-THRESHOLD-ERR", sessionId, error: e.message });
    return {
      shouldInject: false,
      directive: "",
      count: 0,
      tracker_error: true,
      tracker_error_message: e.message,
    };
  }
}

// ── Tool Classification ──

export function isReadOnlyTool(tool: string): boolean {
  return _readOnlyTools.has(tool);
}

// ── Soft Rejection Tracking (per-tool, v32) ──

let _softRejTableReady = false;

function ensureSoftRejTable(db: Database): void {
  if (_softRejTableReady) return;
  try {
    db.run(`CREATE TABLE IF NOT EXISTS soft_rejections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      rejection_count INTEGER NOT NULL DEFAULT 1,
      first_rejection_at INTEGER NOT NULL,
      last_rejection_at INTEGER NOT NULL,
      last_error TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(session_id, tool_name)
    )`);
    _softRejTableReady = true;
  } catch {}
}

export function recordSoftRejection(sessionId: string, tool: string, reason: string): number {
  const db = getDb();
  const now = Date.now();

  try {
    ensureSoftRejTable(db);

    const row = db.query(
      "SELECT rejection_count FROM soft_rejections WHERE session_id = ? AND tool_name = ?"
    ).get(sessionId, tool) as any;

    if (row) {
      const newCount = (row.rejection_count || 0) + 1;
      db.run(
        `UPDATE soft_rejections SET
           rejection_count = ?,
           last_rejection_at = ?,
           last_error = ?
         WHERE session_id = ? AND tool_name = ?`,
        [newCount, now, reason.slice(0, 500), sessionId, tool]
      );
      // Dual-write: tool_rejections JSON on tool_enforcement
      try {
        const existing = db.query("SELECT tool_rejections FROM tool_enforcement WHERE session_id = ?").get(sessionId) as any;
        const map = existing?.tool_rejections ? JSON.parse(existing.tool_rejections || "{}") : {};
        map[tool] = newCount;
        db.run("UPDATE tool_enforcement SET tool_rejections = ?, updated_at = ? WHERE session_id = ?",
          [JSON.stringify(map), Date.now(), sessionId]);
      } catch {}

      return newCount;
    }

    db.run(
      `INSERT INTO soft_rejections
       (session_id, tool_name, rejection_count, first_rejection_at, last_rejection_at, last_error, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
      [sessionId, tool, now, now, reason.slice(0, 500), now]
    );
    // Dual-write: tool_rejections JSON on tool_enforcement
    try {
      const existing = db.query("SELECT tool_rejections FROM tool_enforcement WHERE session_id = ?").get(sessionId) as any;
      const map = existing?.tool_rejections ? JSON.parse(existing.tool_rejections || "{}") : {};
      map[tool] = (map[tool] || 0) + 1;
      db.run("UPDATE tool_enforcement SET tool_rejections = ?, updated_at = ? WHERE session_id = ?",
        [JSON.stringify(map), Date.now(), sessionId]);
    } catch {}

    return 1;
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "RECORD-SOFT-REJ-ERR", sessionId, tool, error: e.message });
    return 0;
  }
}

export function getSoftRejectionCount(sessionId: string, tool: string): number {
  const db = getDb();

  try {
    const row = db.query(
      "SELECT rejection_count FROM soft_rejections WHERE session_id = ? AND tool_name = ?"
    ).get(sessionId, tool) as any;

    return row?.rejection_count || 0;
  } catch {
    return 0;
  }
}

export function resetSoftRejections(sessionId: string): void {
  const db = getDb();

  try {
    ensureSoftRejTable(db);
    db.run("DELETE FROM soft_rejections WHERE session_id = ?", [sessionId]);
    writeLog(SRC, "INFO", { event: "SOFT-REJECTIONS-RESET", sessionId });
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "RESET-SOFT-REJ-ERR", sessionId, error: e.message });
  }
}

// ── Guidance Gate (Two-Phase) ──

export interface GuidanceStatus {
  awaiting: boolean;
  delivered: boolean;
  token: string;
  guidanceText: string;
  lastFailureTool: string;
  lastFailureError: string;
}

export interface RewardResult {
  token: string;
  previousCount: number;
}

export interface ClearResult {
  success: boolean;
  error?: string;
}

/**
 * Agent reported failure via question.
 * Generate a guidance token and enter the guidance gate (Phase 1).
 * Counters are FROZEN — not reset until clearGuidance/clearAwaitingGuidance.
 */
export function rewardReport(sessionId: string, agent: string): RewardResult {
  const db = getDb();
  const now = Date.now();

  try {
    db.run(
      `INSERT OR IGNORE INTO tool_enforcement
       (session_id, agent, failure_count, consecutive_failures, last_failure_at, total_failures, total_blocks,
        created_at, updated_at, stop_injected, compliance_blocks, last_before_at, last_after_at,
        awaiting_guidance, guidance_token, guidance_requested_at)
       VALUES (?, ?, 0, 0, 0, 0, ?, ?, 0, 0, 0, 0, 0, '', 0)`,
      [sessionId, agent, now, now]
    );

    const row = db.query(
      "SELECT failure_count, consecutive_failures, guidance_token FROM tool_enforcement WHERE session_id = ?"
    ).get(sessionId) as any;

    const previousCount = row?.failure_count || 0;
    const token = randomBytes(16).toString("hex");

    db.run(
      `UPDATE tool_enforcement SET
         awaiting_guidance = 1,
         guidance_token = ?,
         stop_injected = 1,
         updated_at = ?
       WHERE session_id = ?`,
      [token, now, sessionId]
    );

    writeLog(SRC, "INFO", {
      event: "REWARD-REPORT",
      sessionId, agent,
      previousCount,
      token: token.slice(0, 8) + "...",
    });

    return { token, previousCount };
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "REWARD-REPORT-ERR", sessionId, error: e.message });
    return { token: "", previousCount: 0 };
  }
}

/**
 * QoderWork delivered guidance — set Phase 2 markers.
 * Called when QoderWork writes guidance_text to DB directly.
 * Requires awaiting_guidance=1 (set by rewardReport).
 */
export function requestGuidance(sessionId: string, agent: string): ClearResult {
  const db = getDb();
  const now = Date.now();

  try {
    const row = db.query(
      "SELECT awaiting_guidance FROM tool_enforcement WHERE session_id = ?"
    ).get(sessionId) as any;

    if (!row || !row.awaiting_guidance) {
      return { success: false, error: "Not in guidance gate (awaiting_guidance=0)" };
    }

    db.run(
      `UPDATE tool_enforcement SET
         guidance_requested_at = ?,
         updated_at = ?
       WHERE session_id = ?`,
      [now, now, sessionId]
    );

    writeLog(SRC, "INFO", {
      event: "REQUEST-GUIDANCE",
      sessionId, agent,
    });

    return { success: true };
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "REQUEST-GUIDANCE-ERR", sessionId, error: e.message });
    return { success: false, error: e.message };
  }
}

/**
 * Clear guidance gate — legacy path (unused after question migration).
 * Requires awaiting_guidance=1 AND guidance_requested_at > 0.
 * Resets consecutive_failures, compliance_blocks, awaiting_guidance, stop_injected.
 */
export function clearAwaitingGuidance(sessionId: string, agent: string, token: string): ClearResult {
  const db = getDb();
  const now = Date.now();

  try {
    const row = db.query(
      "SELECT awaiting_guidance, guidance_token, guidance_requested_at FROM tool_enforcement WHERE session_id = ?"
    ).get(sessionId) as any;

    if (!row || !row.awaiting_guidance) {
      return { success: false, error: "Not in guidance gate" };
    }

    if (row.guidance_requested_at <= 0) {
      return { success: false, error: "Guidance not yet requested (guidance_requested_at=0)" };
    }

    if (row.guidance_token !== token) {
      return { success: false, error: "Invalid guidance token" };
    }

    db.run(
      `UPDATE tool_enforcement SET
         failure_count = 0, consecutive_failures = 0,
         guidance_required = 0, compliance_blocks = 0,
         awaiting_guidance = 0,
         guidance_token = '',
         stop_injected = 0,
         guidance_text = '',
         guidance_requested_at = 0,
         updated_at = ?
       WHERE session_id = ?`,
      [now, sessionId]
    );

    writeLog(SRC, "INFO", {
      event: "CLEAR-AWAITING-GUIDANCE",
      sessionId, agent,
    });

    return { success: true };
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "CLEAR-AWAITING-ERR", sessionId, error: e.message });
    return { success: false, error: e.message };
  }
}

/**
 * Get current guidance gate status.
 * Returns awaiting/delivered/token/guidanceText for system.transform injection.
 */
export function getGuidanceStatus(sessionId: string): GuidanceStatus {
  const db = getDb();

  try {
    const row = db.query(
      `SELECT awaiting_guidance, guidance_token, guidance_text, guidance_requested_at,
              last_failure_tool, last_failure_error
       FROM tool_enforcement WHERE session_id = ?`
    ).get(sessionId) as any;

    if (!row) {
      return {
        awaiting: false,
        delivered: false,
        token: "",
        guidanceText: "",
        lastFailureTool: "",
        lastFailureError: "",
      };
    }

    const awaiting = row.awaiting_guidance === 1;
    const delivered = awaiting && (row.guidance_text || "").length > 0;

    return {
      awaiting,
      delivered,
      token: row.guidance_token || "",
      guidanceText: row.guidance_text || "",
      lastFailureTool: row.last_failure_tool || "",
      lastFailureError: row.last_failure_error || "",
    };
  } catch {
    return {
      awaiting: false,
      delivered: false,
      token: "",
      guidanceText: "",
      lastFailureTool: "",
      lastFailureError: "",
    };
  }
}

/**
 * Get guidance phase number.
 * 0 = not in guidance gate
 * 1 = awaiting guidance (awaiting_guidance=1, no guidance_text)
 * 2 = guidance delivered (awaiting_guidance=1, guidance_text set)
 */
export function getAwaitingPhase(sessionId: string): number {
  const db = getDb();

  try {
    const row = db.query(
      "SELECT awaiting_guidance, guidance_text FROM tool_enforcement WHERE session_id = ?"
    ).get(sessionId) as any;

    if (!row || !row.awaiting_guidance) return 0;
    if ((row.guidance_text || "").length > 0) return 2;
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Clear guidance gate — question/clear_guidance path.
 * Does NOT require guidance_requested_at > 0 (simpler than clearAwaitingGuidance).
 * Resets consecutive_failures, compliance_blocks, awaiting_guidance, stop_injected.
 */
export function clearGuidance(sessionId: string, agent: string, token: string): ClearResult {
  const db = getDb();
  const now = Date.now();

  try {
    const row = db.query(
      "SELECT awaiting_guidance, guidance_token FROM tool_enforcement WHERE session_id = ?"
    ).get(sessionId) as any;

    if (!row || !row.awaiting_guidance) {
      return { success: false, error: "Not in guidance gate" };
    }

    if (row.guidance_token !== token) {
      return { success: false, error: "Invalid guidance token" };
    }

    db.run(
      `UPDATE tool_enforcement SET
         failure_count = 0, consecutive_failures = 0,
         guidance_required = 0, compliance_blocks = 0,
         awaiting_guidance = 0,
         guidance_token = '',
         stop_injected = 0,
         guidance_text = '',
         guidance_requested_at = 0,
         updated_at = ?
       WHERE session_id = ?`,
      [now, sessionId]
    );

    writeLog(SRC, "INFO", {
      event: "CLEAR-GUIDANCE",
      sessionId, agent,
    });

    return { success: true };
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "CLEAR-GUIDANCE-ERR", sessionId, error: e.message });
    return { success: false, error: e.message };
  }
}

/**
 * Get failure summary for a session.
 */
export function getFailureSummary(sessionId: string): FailureSummary | null {
  const db = getDb();

  try {
    const row = db.query(
      `SELECT session_id, agent, failure_count, consecutive_failures, total_failures, total_blocks,
              last_failure_tool, last_failure_type, last_failure_error, last_failure_at
       FROM tool_enforcement WHERE session_id = ?`
    ).get(sessionId) as any;

    if (!row) return null;

    return {
      sessionId: row.session_id,
      agent: row.agent || "",
      consecutiveFailures: row.failure_count || 0,
      totalFailures: row.total_failures || 0,
      totalBlocks: row.total_blocks || 0,
      lastTool: row.last_failure_tool || "",
      lastType: row.last_failure_type || "",
      lastError: row.last_failure_error || "",
      lastAt: row.last_failure_at || 0,
    };
  } catch {
    return null;
  }
}
