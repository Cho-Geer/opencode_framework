// service/gate/store-crud.ts — Gate store runtime code: I/O, path resolution, utilities
// Split from: store.ts

import { getDb } from "../../lib/db-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  dbLoadGateStore,
  dbSaveGateStore,
} from "../../lib/db-state-manager";
import type { GateStore, GateSession } from "./store-types";

const SRC = "service-gate-store";

let _writeLog:
  | ((src: string, level: string, payload: Record<string, unknown>) => void)
  | null = null;
function writeLogSafe(
  src: string,
  level: string,
  payload: Record<string, unknown>,
): void {
  try {
    if (!_writeLog) {
      _writeLog = require("../../lib/log-manager").writeLog;
    }
    _writeLog!(src, level, payload);
  } catch {
    // Circular dependency or module unavailable — swallow silently
  }
}

// ════════════════════════════════════════════════
// PATH RESOLUTION
// ════════════════════════════════════════════════

export function getProjectRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

export function resolveStateDir(root?: string): string {
  const projectRoot = root || getProjectRoot();
  const cfgPath = path.join(projectRoot, ".opencode", "project.config.json");
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const pr = cfg.project_root;
      if (pr && pr !== ".") {
        const stateDir = path.join(projectRoot, pr, ".opencode", "state");
        if (fs.existsSync(stateDir)) return stateDir;
      }
    }
  } catch {
    // fall through
  }
  return path.join(projectRoot, ".opencode", "state");
}

// ════════════════════════════════════════════════
// FILE OPERATIONS
// ════════════════════════════════════════════════

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function computeSHA256(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256");
    hash.update(content);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════
// GATE STORE I/O
// ════════════════════════════════════════════════

export function getGateStatePath(root?: string): string {
  const stateDir = resolveStateDir(root);
  return process.env.GATE_STATE_PATH || path.join(stateDir, "gate-state.json");
}

export function getMachinePath(root?: string): string {
  const stateDir = resolveStateDir(root);
  return path.join(stateDir, "machine.json");
}

export function createFreshStore(): GateStore {
  return {
    formatVersion: "2.0",
    sessions: {},
    active_sessions: [],
    last_updated: null as unknown as string,
  };
}

function loadGateStoreJson(root?: string): GateStore {
  const gateFile = getGateStatePath(root);
  const s = readJsonFile<GateStore>(gateFile);
  if (
    s &&
    s.formatVersion === "2.0" &&
    s.sessions &&
    typeof s.sessions === "object"
  ) {
    if (!Array.isArray(s.active_sessions)) {
      s.active_sessions = [];
    }
    if (!s.last_updated) {
      s.last_updated = new Date().toISOString();
    }
    return s;
  }
  return createFreshStore();
}

function reconcileGateStore(s: GateStore): boolean {
  let reconciled = false;

  s.active_sessions = s.active_sessions.filter((sid) => {
    const ses = s.sessions[sid];
    if (!ses) {
      reconciled = true;
      return false;
    }
    if (
      ses.gate_status === "completed" ||
      ses.gate_status === "failed" ||
      ses.gate_status === "drained"
    ) {
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
    if (ses.gate_status === "armed" && !ses.consumed_at) {
      const refTime = ses.confirmed_at || ses.created_at;
      const age = nowTs - new Date(refTime).getTime();
      if (age > STALE_MS) {
        reconciled = true;
        return false;
      }
    }
    return true;
  });

  const LIVE_STATUSES = ["armed", "delivered", "approved"];
  for (const [sid, ses] of Object.entries(s.sessions)) {
    if (
      LIVE_STATUSES.includes(ses.gate_status) &&
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

  return reconciled;
}

export function loadGateStore(root?: string): GateStore {
  let store: GateStore | null = null;
  let fromDb = false;
  try {
    const dbStore = dbLoadGateStore();
    if (dbStore && Object.keys(dbStore.sessions).length > 0) {
      store = dbStore as GateStore;
      fromDb = true;
    }
  } catch {
    // fall through to JSON
  }

  if (!store) {
    store = loadGateStoreJson(root);
  }

  const modified = reconcileGateStore(store);

  if (modified) {
    try {
      dbSaveGateStore(store);
    } catch (e: any) {
      writeLogSafe(SRC, "WARN", {
        event: "DB-RECONCILE-WRITE-FAILED",
        detail: e.message,
      });
    }
  }

  return store;
}

export function saveGateStore(store: GateStore, root?: string): boolean {
  try {
    const ok = dbSaveGateStore(store);
    if (!ok) {
      writeLogSafe(SRC, "ERROR", {
        event: "DB-SAVE-GATE-FAILED",
        level: "ERROR" as any,
        detail: "dbSaveGateStore returned false",
      });
    }
    return ok;
  } catch (e: any) {
    writeLogSafe(SRC, "ERROR", {
      event: "DB-SAVE-GATE-FAILED",
      level: "ERROR" as any,
      detail: e.message,
    });
    return false;
  }
}

// ════════════════════════════════════════════════
// SESSION FINDERS
// ════════════════════════════════════════════════

export function findArmedSession(root?: string): {
  found: boolean;
  gateSessionId: string | null;
} {
  const gate = loadGateStore(root);
  const sessions = Object.values(gate.sessions);
  const armed = sessions.find(
    (s) => s.gate_status === "armed" && s.consumed_at === null,
  );
  return armed
    ? { found: true, gateSessionId: armed.session_id }
    : { found: false, gateSessionId: null };
}

export function findAnyGateSession(root?: string): {
  found: boolean;
  gateSessionId: string | null;
} {
  const gate = loadGateStore(root);
  const sessions = Object.values(gate.sessions);
  const valid = sessions.find(
    (s) => s.consumed_at === null && s.gate_status !== "drained",
  );
  return valid
    ? { found: true, gateSessionId: valid.session_id }
    : { found: false, gateSessionId: null };
}

// ════════════════════════════════════════════════
// STATUS TRANSITION LOGGING
// ════════════════════════════════════════════════

export function logGateStatusTransition(
  sessionId: string,
  prevStatus: string,
  newStatus: string,
  caller: { source: string; agent?: string; sessionID?: string },
  extra: Record<string, any> = {},
): void {
  if (prevStatus === newStatus) return;
  writeLogSafe(SRC, "runtime", {
    sessionID: caller.sessionID || sessionId,
    agent: caller.agent,
    event: "GATE-STATUS-TRANSITION",
    detail:
      `session=${sessionId} | ${prevStatus} → ${newStatus} | source=${caller.source}` +
      (extra.version ? ` | version=${extra.version}` : "") +
      (extra.consumed_at ? ` | consumed_at=${extra.consumed_at}` : "") +
      (extra.reason ? ` | reason=${extra.reason}` : ""),
  });
}

// ════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════

export function generateGateSessionId(): string {
  return "cg_ses_" + Date.now();
}

export function computeDigest(filePath: string): {
  digest: string | null;
  error: string | null;
} {
  try {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return { digest: "sha256-" + hash, error: null };
  } catch (err: unknown) {
    return { digest: null, error: (err as Error).message };
  }
}

export function extractSemver(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const fmMatch = content.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m);
    if (fmMatch) return fmMatch[1];
    const hdrMatch = content.match(
      /^#{1,3}\s+(?:Version|v)\s*(\d+\.\d+\.\d+)/im,
    );
    if (hdrMatch) return hdrMatch[1];
    const inlineMatch = content.match(/v(\d+\.\d+\.\d+)/);
    if (inlineMatch) return inlineMatch[1];
  } catch {
    // ignore
  }
  return null;
}

export function pathMatchesGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  const regexStr = pat
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(normalized);
}

export { writeLogSafe };
