// log-manager.ts — Framework log system v3.0
// ═══════════════════════════════════════════════════════════════
// Core logging infrastructure for all OpenCode framework plugins,
// MCP tools, CLI scripts, and library modules.
//
// Provides buffered async logging, POSIX O_APPEND atomic flush,
// source-aware index tracking, and log-level filtering.
//
// @author @Super-Admin
// @version 3.0.0
// @since 2026-06-10
//
// Changelog:
//   v3.0.0 (2026-06-13): FW-LOG-UNIFY Phase 0 — F1 category fix,
//     O_APPEND flush, LogIndex.sources, log-level filtering, B2 fix.
//   v2.0.0 (2026-06-10): Initial buffered logging with index.
//
// Design reference: docs/review/log-backlog/framework-log-system-design.md
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getEnforcementMode } from "./gate-core";

// ── Types ──────────────────────────────────────────────────────

/** Log level enumeration */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/**
 * Log category for file segregation.
 *
 * FW-LOG-UNIFY-F1: Extended to accept LogLevel strings as categories.
 * When a caller passes a LogLevel (e.g. "INFO", "ERROR") as the category,
 * normalizeCategory() maps it to "runtime" for correct file routing.
 * This fixes the API mismatch where 30+ callers passed log levels as categories.
 */
export type LogCategory = "loaded" | "hooks" | "runtime" | LogLevel;

/** Unified log entry fields */
export interface LogFields {
  sessionID?: string;
  /** Alias for sessionID (camelCase variant used by some callers) */
  sessionId?: string;
  callID?: string;
  call_id?: string;
  agent?: string;
  agentType?: string;
  level?: LogLevel;
  event: string;
  detail?: string;
  candidates?: string;
  /** Optional gate session ID for gate-related log entries (FW-REPAIR-TS-BASELINE) */
  gate_session_id?: string;
  /** Optional DAG task ID for task-related log entries (FW-REPAIR-TS-BASELINE) */
  taskId?: string;
  /** Optional DAG task ID in snake_case (FW-REPAIR-TS-BASELINE) */
  task_id?: string;
  /** Optional full DAG task ID key (FW-REPAIR-TS-BASELINE) */
  dag_task_id?: string;
  /** Optional purposes for route-validator L0 purpose inference */
  purposes?: string;
  /** Optional kind/category classification (e.g. "interrupt", "error") */
  kind?: string;
  /** Optional domain ID in snake_case (UC7KS pipeline) */
  domain_id?: string;
  /** Optional domain ID in camelCase (UC7KS pipeline) */
  domainId?: string;
  /** Optional error message */
  error?: string;
  /** Optional file path */
  filePath?: string;
  /** Optional file count */
  fileCount?: number;
  /** Optional args hash for approval context */
  args_hash?: string;
  /** Optional OpenCode session ID (distinct from gate session ID) */
  opencode_session_id?: string;
  /** Optional pruned count (read-audit cleanup) */
  pruned?: number;
  /** Optional not-read count */
  notReadCount?: number;
  /** Optional generic count */
  count?: number;
  /** Optional command string (safe-bash) */
  command?: string;
  /** Optional pipeline ID (UC7KS pipeline DB) */
  pipeline_id?: string;
  /** Optional consumed_at timestamp */
  consumed_at?: string | number | null;
  /** Optional exit code */
  exitCode?: number | null;
  /** Optional timestamp */
  timestamp?: string;
  /** Optional db flag */
  db?: boolean;
  /** Optional pipeline ID (camelCase) */
  pipelineId?: string;
  /** Optional agent key */
  agentKey?: string;
  /** Allow additional fields for extensibility */
  [key: string]: unknown;
}

/**
 * Source index entry — tracks each unique log-producing file.
 * FW-LOG-UNIFY Phase 0: enables source-aware log discovery.
 */
export interface SourceIndexEntry {
  /** Relative path from log root (e.g. "2026-06-13/plugin-mcp-compliance-gate-runtime.log") */
  file: string;
  /** Source identifier (e.g. "mcp-compliance-gate", "script-framework-self-test") */
  source: string;
  /** Category after normalization */
  category: "loaded" | "hooks" | "runtime";
  /** First write timestamp */
  first_seen: string;
  /** Last write timestamp */
  last_seen: string;
  /** Total lines written */
  line_count: number;
}

/** Index manifest structure — v3.0 with sources section */
export interface LogIndex {
  version: string;
  last_updated: string;
  plugins: Record<string, PluginIndexEntry>;
  dates: Record<string, DateIndexEntry>;
  /** FW-LOG-UNIFY Phase 0: source-level tracking for all log files */
  sources: Record<string, SourceIndexEntry>;
}

interface PluginIndexEntry {
  first_loaded: string;
  last_loaded: string;
  total_loads: number;
  status: "active" | "inactive";
}

interface DateIndexEntry {
  plugins_loaded: number;
  active: boolean;
}

// ── Log level ordering ─────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// ── Category normalization (F1 fix) ────────────────────────────

/**
 * Normalize a LogCategory to one of the three canonical categories.
 *
 * FW-LOG-UNIFY-F1: When callers pass a LogLevel string as the category
 * (e.g. writeLog("mcp-compliance-gate", "INFO", {...})), this function
 * maps it to "runtime" so the file is correctly named
 * plugin-mcp-compliance-gate-runtime.log instead of
 * plugin-mcp-compliance-gate-INFO.log.
 *
 * @param cat - Raw category from caller (may be a LogLevel string)
 * @returns Canonical category for file routing
 */
export function normalizeCategory(
  cat: LogCategory,
): "loaded" | "hooks" | "runtime" {
  if (cat === "loaded" || cat === "hooks" || cat === "runtime") return cat;
  // LogLevel strings → "runtime"
  return "runtime";
}

// ── Configuration (overridable via project.config.json) ────────

const LOG_ROOT_DEFAULT = ".task_temp/_logs";
const RETENTION_DAYS_DEFAULT = 7;
const DELIMITER_DEFAULT = " | ";
const BUFFER_SIZE_DEFAULT = 20;
const FLUSH_INTERVAL_MS_DEFAULT = 5000;
const LOG_LEVEL_DEFAULT = "INFO";
const FILE_PREFIX_DEFAULT = "plugin";

/** Resolve config from project.config.json template_resolution */
function resolveConfig(): {
  logRoot: string;
  retentionDays: number;
  delimiter: string;
  bufferSize: number;
  flushIntervalMs: number;
  logLevel: LogLevel;
  filePrefix: string;
} {
  const root = process.env.OPENCODE_ROOT || ".";
  let config = {
    logRoot: LOG_ROOT_DEFAULT,
    retentionDays: RETENTION_DAYS_DEFAULT,
    delimiter: DELIMITER_DEFAULT,
    bufferSize: BUFFER_SIZE_DEFAULT,
    flushIntervalMs: FLUSH_INTERVAL_MS_DEFAULT,
    logLevel: LOG_LEVEL_DEFAULT as LogLevel,
    filePrefix: FILE_PREFIX_DEFAULT,
  };

  try {
    const cfgPath = path.join(root, ".opencode", "project.config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const tr = cfg.template_resolution || {};
      if (tr["logs.dir"]) config.logRoot = tr["logs.dir"];
      if (tr["logs.retention_days"])
        config.retentionDays = Number(tr["logs.retention_days"]);
      if (tr["logs.delimiter"]) config.delimiter = tr["logs.delimiter"];
      if (tr["logs.buffer_size"])
        config.bufferSize = Number(tr["logs.buffer_size"]);
      if (tr["logs.flush_interval_ms"])
        config.flushIntervalMs = Number(tr["logs.flush_interval_ms"]);
      if (tr["logs.level"]) {
        const lv = tr["logs.level"].toUpperCase();
        if (["DEBUG", "INFO", "WARN", "ERROR"].includes(lv))
          config.logLevel = lv as LogLevel;
      }
      if (tr["logs.file_prefix"]) config.filePrefix = tr["logs.file_prefix"];
    }
  } catch {
    // Silently use defaults if config read fails
  }

  return config;
}

const config = resolveConfig();

// ── In-memory buffer (non-blocking hook chain) ─────────────────

const buffer: Map<string, string[]> = new Map();

function getBufferKey(plugin: string, category: LogCategory): string {
  return `${plugin}:${normalizeCategory(category)}`;
}

// ── Directory helpers ──────────────────────────────────────────

/** Get today's log directory path */
export function getLogDir(): string {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(process.env.OPENCODE_ROOT || ".", config.logRoot, today);
}

/** Get log root directory path */
export function getLogRoot(): string {
  return path.join(process.env.OPENCODE_ROOT || ".", config.logRoot);
}

/** Ensure log directory exists */
export function ensureLogDir(): void {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Log level resolver ─────────────────────────────────────────

/**
 * Resolve effective log level.
 * Priority: explicit parameter > project.config.json > enforcement mode > default(INFO)
 */
function resolveLogLevel(explicitLevel?: LogLevel): LogLevel {
  if (explicitLevel) return explicitLevel;
  return config.logLevel;
}

/**
 * Resolve minimum log level from enforcement mode (fallback when config missing).
 * Kept for backward compatibility — config.logLevel is preferred.
 */
function resolveLogLevelFromMode(): LogLevel {
  try {
    const mode = getEnforcementMode();
    switch (mode) {
      case "locked":
        return "WARN";
      case "strict":
        return "INFO";
      case "advisory":
      default:
        return "DEBUG";
    }
  } catch {
    return "INFO";
  }
}

/**
 * Check if a log entry should be written based on level filtering.
 * FW-LOG-UNIFY Phase 0: prevents DEBUG entries when level is INFO+.
 *
 * @param entryLevel - The level of the log entry to check
 * @returns true if the entry should be written
 */
export function shouldLog(entryLevel: LogLevel): boolean {
  const minLevel = resolveLogLevel();
  return LEVEL_ORDER[entryLevel] >= LEVEL_ORDER[minLevel];
}

// ── POSIX O_APPEND flush ───────────────────────────────────────

/**
 * Flush a single plugin/category buffer to disk using POSIX O_APPEND.
 *
 * FW-LOG-UNIFY Phase 0: Replaces appendFileSync with openSync(O_APPEND) +
 * chunked writeSync for atomic appends without full-file reads.
 * This is safe for concurrent writers (multiple agents) because O_APPEND
 * guarantees atomic seek-to-end + write in a single syscall.
 *
 * @param plugin - Source identifier (e.g. "mcp-compliance-gate")
 * @param category - Log category (will be normalized)
 */
export function flushBuffer(plugin: string, category: LogCategory): void {
  const normCat = normalizeCategory(category);
  const key = getBufferKey(plugin, category);
  const lines = buffer.get(key);
  if (!lines || lines.length === 0) return;

  try {
    ensureLogDir();
    const file = path.join(
      getLogDir(),
      `${config.filePrefix}-${plugin}-${normCat}.log`,
    );
    const content = lines.join("");

    // POSIX O_APPEND: atomic seek-to-end + write
    // O_CREAT: create if not exists; O_WRONLY: write-only
    // Use fs.constants for correctness (0o8 is not valid octal — digits 0-7 only)
    const O_APPEND = fs.constants.O_APPEND; // 8 (decimal)
    const O_CREAT = fs.constants.O_CREAT; // 64 (0o100)
    const O_WRONLY = fs.constants.O_WRONLY; // 1 (0o1)

    let fd: number | null = null;
    try {
      fd = fs.openSync(file, O_WRONLY | O_CREAT | O_APPEND, 0o644);
      // Chunked write for large buffers (>64KB)
      const CHUNK = 65536;
      let offset = 0;
      while (offset < content.length) {
        const end = Math.min(offset + CHUNK, content.length);
        const chunk = Buffer.from(content.substring(offset, end), "utf8");
        fs.writeSync(fd, chunk, 0, chunk.length, null);
        offset = end;
      }
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }

    buffer.set(key, []);
  } catch (err: any) {
    logSelfError(
      `flushBuffer failed for ${plugin}/${category}: ${err.message}`,
    );
  }
}

/** Flush all pending buffers */
export function flushAll(): void {
  for (const key of buffer.keys()) {
    const [plugin, category] = key.split(":");
    flushBuffer(plugin, category as LogCategory);
  }
}

// ── Periodic flush timer ───────────────────────────────────────

const flushTimer = setInterval(() => flushAll(), config.flushIntervalMs);
flushTimer.unref();

// ── Core write function ────────────────────────────────────────

/**
 * Write a log entry. Uses in-memory buffering to avoid blocking
 * the hook execution chain. Flush triggered by buffer size or timer.
 *
 * FW-LOG-UNIFY-F1: Category parameter now accepts LogLevel strings.
 * They are normalized to "runtime" via normalizeCategory().
 *
 * @param plugin - Source identifier (e.g. "mcp-compliance-gate", "lib-shared-infra")
 * @param category - Log category: "loaded" | "hooks" | "runtime" | LogLevel
 * @param fields - Structured log entry fields
 */
export function writeLog(
  plugin: string,
  category: LogCategory,
  fields: LogFields,
): void {
  try {
    const level = resolveLogLevel(fields.level);

    // FW-LOG-UNIFY Phase 0: Level filtering — skip entries below threshold
    if (!shouldLog(level)) return;

    // Build detail string: use explicit detail if present, otherwise serialize
    // extra fields (callers often pass arbitrary key-value pairs instead of detail)
    let detail: string;
    if (fields.detail) {
      detail = fields.detail;
    } else {
      // Extract extra fields (everything not in LogFields keys)
      const knownKeys = new Set([
        "sessionID",
        "callID",
        "agent",
        "agentType",
        "level",
        "event",
        "detail",
      ]);
      const extras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (!knownKeys.has(k)) extras[k] = v;
      }
      detail = Object.keys(extras).length > 0 ? JSON.stringify(extras) : "—";
    }

    const line =
      [
        new Date().toISOString(),
        fields.sessionID || "—",
        fields.callID || "—",
        fields.agent || process.env.FRAMEWORK_AGENT || "—",
        fields.agentType || "—",
        level,
        fields.event,
        detail,
      ].join(config.delimiter) + "\n";

    const key = getBufferKey(plugin, category);
    if (!buffer.has(key)) {
      buffer.set(key, []);
    }
    buffer.get(key)!.push(line);

    const normCat = normalizeCategory(category);

    // Critical: "loaded" logs must be flushed immediately because updateIndex()
    // scans the log directory to count plugins_loaded. If buffered, the file
    // won't exist on disk when updateIndex() runs, causing an undercount.
    if (normCat === "loaded") {
      flushBuffer(plugin, category);
    } else if (buffer.get(key)!.length >= config.bufferSize) {
      flushBuffer(plugin, category);
    }

    // Trigger archive check for runtime logs (non-blocking)
    if (normCat === "runtime") {
      triggerArchiveCheck();
    }
  } catch (err: any) {
    logSelfError(`writeLog failed for ${plugin}/${category}: ${err.message}`);
  }
}

// ── Atomic index update ────────────────────────────────────────

/**
 * Update the global index.json with plugin load information and source tracking.
 * Uses atomic write (tmp + rename) to prevent corruption from
 * concurrent writes by multiple agents.
 *
 * FW-LOG-UNIFY Phase 0: Added sources section for source-aware log discovery.
 */
export function updateIndex(plugin: string, event: string): void {
  try {
    const root = getLogRoot();
    const idxPath = path.join(root, "index.json");
    let idx: LogIndex = {
      version: "3.0",
      last_updated: new Date().toISOString(),
      plugins: {},
      dates: {},
      sources: {},
    };

    if (fs.existsSync(idxPath)) {
      try {
        const raw = fs.readFileSync(idxPath, "utf8");
        const parsed = JSON.parse(raw);
        // Migrate v2.0 index (no sources) to v3.0
        if (!parsed.sources) parsed.sources = {};
        idx = parsed as LogIndex;
      } catch {
        // Corrupted index — start fresh
      }
    }

    idx.last_updated = new Date().toISOString();
    idx.version = "3.0";
    const today = new Date().toISOString().slice(0, 10);

    if (!idx.plugins[plugin]) {
      idx.plugins[plugin] = {
        first_loaded: new Date().toISOString(),
        last_loaded: "",
        total_loads: 0,
        status: "active",
      };
    }
    idx.plugins[plugin].last_loaded = new Date().toISOString();
    idx.plugins[plugin].total_loads++;

    // Count loaded plugins for today
    const logDir = getLogDir();
    const loadedPlugins = new Set<string>();
    if (fs.existsSync(logDir)) {
      for (const f of fs.readdirSync(logDir)) {
        const m = f.match(
          new RegExp(`^${escapeRegex(config.filePrefix)}-(.+)-loaded\\.log$`),
        );
        if (m) loadedPlugins.add(m[1]);
      }
    }
    idx.dates[today] = {
      plugins_loaded: loadedPlugins.size,
      active: true,
    };

    // FW-LOG-UNIFY Phase 0: Scan all log files and populate sources index
    idx.sources = scanSources(logDir, idx.sources || {});

    // Atomic write: tmp → rename
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    const tmpPath = idxPath + ".tmp." + crypto.randomBytes(4).toString("hex");
    fs.writeFileSync(tmpPath, JSON.stringify(idx, null, 2), "utf8");
    fs.renameSync(tmpPath, idxPath);
  } catch (err: any) {
    logSelfError(`updateIndex failed for ${plugin}: ${err.message}`);
  }
}

/**
 * Scan a log directory for all log files and build/update source index.
 * FW-LOG-UNIFY Phase 0: enables source-aware log discovery.
 *
 * @param logDir - Today's log directory to scan
 * @param existingSources - Existing source entries to preserve counts for
 * @returns Updated sources map
 */
function scanSources(
  logDir: string,
  existingSources: Record<string, SourceIndexEntry>,
): Record<string, SourceIndexEntry> {
  const sources: Record<string, SourceIndexEntry> = {};
  const prefix = escapeRegex(config.filePrefix);

  if (!fs.existsSync(logDir)) return sources;

  for (const f of fs.readdirSync(logDir)) {
    // Match pattern: {prefix}-{source}-{category}.log
    const m = f.match(
      new RegExp(`^${prefix}-(.+)-(loaded|hooks|runtime)\\.log$`),
    );
    if (!m) continue;

    const source = m[1];
    const category = m[2] as "loaded" | "hooks" | "runtime";
    const key = `${source}:${category}`;
    const filePath = path.relative(getLogRoot(), path.join(logDir, f));
    const now = new Date().toISOString();

    // Count lines in file
    let lineCount = 0;
    try {
      const content = fs.readFileSync(path.join(logDir, f), "utf8");
      lineCount = content.split("\n").filter((l: string) => l.trim()).length;
    } catch {
      lineCount = 0;
    }

    const existing = existingSources[key];
    sources[key] = {
      file: filePath,
      source,
      category,
      first_seen: existing?.first_seen || now,
      last_seen: now,
      line_count: lineCount,
    };
  }

  return sources;
}

/** Escape string for use in RegExp */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Archive check ──────────────────────────────────────────────

/**
 * Check for expired log directories and move them to _archive/.
 * Called periodically (triggered by runtime log writes).
 */
export function archiveCheck(): void {
  try {
    const root = getLogRoot();
    const archiveDir = path.join(root, "_archive");
    const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;

    if (!fs.existsSync(root)) return;

    for (const entry of fs.readdirSync(root)) {
      if (entry === "_archive" || entry === "index.json") continue;

      const d = path.join(root, entry);
      if (!fs.statSync(d).isDirectory()) continue;

      // Parse directory name as date (YYYY-MM-DD)
      const dateMatch = entry.match(/^\d{4}-\d{2}-\d{2}$/);
      if (!dateMatch) continue;

      const entryDate = new Date(entry + "T00:00:00Z").getTime();
      if (entryDate < cutoff) {
        if (!fs.existsSync(archiveDir)) {
          fs.mkdirSync(archiveDir, { recursive: true });
        }
        const target = path.join(archiveDir, entry);
        // If target exists, remove it first
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
        }
        fs.renameSync(d, target);
      }
    }
  } catch (err: any) {
    logSelfError(`archiveCheck failed: ${err.message}`);
  }
}

/** Trigger archive check asynchronously (non-blocking) */
export function triggerArchiveCheck(): void {
  setImmediate(() => archiveCheck());
}

// ── Self-error logging ─────────────────────────────────────────

/**
 * Log errors from log-manager itself to dated _error.log.
 * FW-LOG-UNIFY B2: Uses dated directory instead of log root.
 */
function logSelfError(message: string): void {
  try {
    const dir = getLogDir();
    const errFile = path.join(dir, "_error.log");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(
      errFile,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf8",
    );
  } catch {
    // Self-error logging failed — silently give up
  }
}

// ── Process exit handlers ──────────────────────────────────────

/** Flush all buffers on process exit */
function handleExit(): void {
  flushAll();
}

process.on("exit", handleExit);
process.on("SIGINT", () => {
  handleExit();
  process.exit(0);
});
process.on("SIGTERM", () => {
  handleExit();
  process.exit(0);
});

// ── Utility: Read index.json ───────────────────────────────────

/** Read and parse the current index.json */
export function readIndex(): LogIndex | null {
  try {
    const idxPath = path.join(getLogRoot(), "index.json");
    if (!fs.existsSync(idxPath)) return null;
    return JSON.parse(fs.readFileSync(idxPath, "utf8")) as LogIndex;
  } catch (err: any) {
    logSelfError(`readIndex failed: ${err.message}`);
    return null;
  }
}

// ── Utility: Get plugin log file path ──────────────────────────

/**
 * Get the log file path for a specific plugin and category.
 * FW-LOG-UNIFY-F1: Category is normalized before constructing path.
 */
export function getPluginLogPath(
  plugin: string,
  category: LogCategory,
): string {
  const normCat = normalizeCategory(category);
  return path.join(
    getLogDir(),
    `${config.filePrefix}-${plugin}-${normCat}.log`,
  );
}
