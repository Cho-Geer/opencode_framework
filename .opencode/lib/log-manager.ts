// log-manager.ts — Framework log system v2.0
// ═══════════════════════════════════════════════════════════════
// Core logging infrastructure for all OpenCode framework plugins.
// Provides buffered async logging, atomic index updates, and
// automatic archival based on project.config.json template variables.
//
// @author @Super-Admin
// @version 2.0.0
// @since 2026-06-10
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

/** Log category for file segregation */
export type LogCategory = "loaded" | "hooks" | "runtime";

/** Unified log entry fields */
export interface LogFields {
  sessionID?: string;
  callID?: string;
  agent?: string;
  agentType?: string;
  level?: LogLevel;
  event: string;
  detail: string;
}

/** Index manifest structure */
export interface LogIndex {
  version: string;
  last_updated: string;
  plugins: Record<string, PluginIndexEntry>;
  dates: Record<string, DateIndexEntry>;
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

// ── Configuration (overridable via project.config.json) ────────

const LOG_ROOT_DEFAULT = ".task_temp/_logs";
const RETENTION_DAYS_DEFAULT = 7;
const DELIMITER_DEFAULT = " | ";
const BUFFER_SIZE_DEFAULT = 20;
const FLUSH_INTERVAL_MS_DEFAULT = 5000;

/** Resolve config from project.config.json template_resolution */
function resolveConfig(): {
  logRoot: string;
  retentionDays: number;
  delimiter: string;
  bufferSize: number;
  flushIntervalMs: number;
} {
  const root = process.env.OPENCODE_ROOT || ".";
  let config = {
    logRoot: LOG_ROOT_DEFAULT,
    retentionDays: RETENTION_DAYS_DEFAULT,
    delimiter: DELIMITER_DEFAULT,
    bufferSize: BUFFER_SIZE_DEFAULT,
    flushIntervalMs: FLUSH_INTERVAL_MS_DEFAULT,
  };

  try {
    const cfgPath = path.join(root, ".opencode", "project.config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const tr = cfg.template_resolution || {};
      if (tr["logs.dir"]) config.logRoot = tr["logs.dir"];
      if (tr["logs.retention_days"]) config.retentionDays = Number(tr["logs.retention_days"]);
      if (tr["logs.delimiter"]) config.delimiter = tr["logs.delimiter"];
      if (tr["logs.buffer_size"]) config.bufferSize = Number(tr["logs.buffer_size"]);
      if (tr["logs.flush_interval_ms"]) config.flushIntervalMs = Number(tr["logs.flush_interval_ms"]);
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
  return `${plugin}:${category}`;
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

/** Resolve log level based on enforcement mode */
function resolveLogLevel(explicitLevel?: LogLevel): LogLevel {
  if (explicitLevel) return explicitLevel;

  // Check project.config.json.template_resolution.logs.level override
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const cfgPath = path.join(root, ".opencode", "project.config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const tr = cfg.template_resolution || {};
      if (tr["logs.level"]) {
        const lv = tr["logs.level"].toUpperCase();
        if (["DEBUG","INFO","WARN","ERROR"].includes(lv)) return lv as LogLevel;
      }
    }
  } catch {}

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

// ── Core write function ────────────────────────────────────────

/**
 * Write a log entry. Uses in-memory buffering to avoid blocking
 * the hook execution chain. Flush triggered by buffer size or timer.
 */
export function writeLog(
  plugin: string,
  category: LogCategory,
  fields: LogFields,
): void {
  try {
    const level = resolveLogLevel(fields.level);

    const line = [
      new Date().toISOString(),
      fields.sessionID || "—",
      fields.callID || "—",
      fields.agent || "—",
      fields.agentType || "—",
      level,
      fields.event,
      fields.detail,
    ].join(config.delimiter) + "\n";

    const key = getBufferKey(plugin, category);
    if (!buffer.has(key)) {
      buffer.set(key, []);
    }
    buffer.get(key)!.push(line);

    // Critical: "loaded" logs must be flushed immediately because updateIndex()
    // scans the log directory to count plugins_loaded. If buffered, the file
    // won't exist on disk when updateIndex() runs, causing an undercount.
    if (category === "loaded") {
      flushBuffer(plugin, category);
    } else if (buffer.get(key)!.length >= config.bufferSize) {
      flushBuffer(plugin, category);
    }

    // Trigger archive check for runtime logs (non-blocking)
    if (category === "runtime") {
      triggerArchiveCheck();
    }
  } catch (err: any) {
    logSelfError(`writeLog failed for ${plugin}/${category}: ${err.message}`);
  }
}

// ── Buffer flush ───────────────────────────────────────────────

/** Flush a single plugin/category buffer to disk */
export function flushBuffer(plugin: string, category: LogCategory): void {
  const key = getBufferKey(plugin, category);
  const lines = buffer.get(key);
  if (!lines || lines.length === 0) return;

  try {
    ensureLogDir();
    const file = path.join(getLogDir(), `plugin-${plugin}-${category}.log`);
    fs.appendFileSync(file, lines.join(""), "utf8");
    buffer.set(key, []);
  } catch (err: any) {
    logSelfError(`flushBuffer failed for ${plugin}/${category}: ${err.message}`);
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

// ── Atomic index update ────────────────────────────────────────

/**
 * Update the global index.json with plugin load information.
 * Uses atomic write (tmp + rename) to prevent corruption from
 * concurrent writes by multiple agents.
 */
export function updateIndex(plugin: string, event: string): void {
  try {
    const root = getLogRoot();
    const idxPath = path.join(root, "index.json");
    let idx: LogIndex = {
      version: "2.0",
      last_updated: new Date().toISOString(),
      plugins: {},
      dates: {},
    };

    if (fs.existsSync(idxPath)) {
      try {
        const raw = fs.readFileSync(idxPath, "utf8");
        idx = JSON.parse(raw) as LogIndex;
      } catch {
        // Corrupted index — start fresh
      }
    }

    idx.last_updated = new Date().toISOString();
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
        const m = f.match(/^plugin-(.+)-loaded\.log$/);
        if (m) loadedPlugins.add(m[1]);
      }
    }
    idx.dates[today] = {
      plugins_loaded: loadedPlugins.size,
      active: true,
    };

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

/** Log errors from log-manager itself to _error.log */
function logSelfError(message: string): void {
  try {
    const root = getLogRoot();
    const errFile = path.join(root, "_error.log");
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
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

/** Get the log file path for a specific plugin and category */
export function getPluginLogPath(plugin: string, category: LogCategory): string {
  return path.join(getLogDir(), `plugin-${plugin}-${category}.log`);
}
