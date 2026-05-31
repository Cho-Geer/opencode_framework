/**
 * gate-lifecycle.ts — Plugin Compliance Gate Lifecycle Module
 * =========================================================================
 *
 * Provides independent gate check/confirm/complete/purge functions.
 * Shares gate-state.json and machine.json with the MCP compliance-gate tool,
 * but has zero code dependency on it. Both implementations coexist independently.
 *
 * Uses: framework-validation.ts for common utilities (readJsonFile, paths, etc.)
 *
 * Data files:
 *   - gate-state.json (read/write) — session lifecycle state
 *   - machine.json (read) — role violations, eslint state
 *   - rule_registry.json (read) — digest verification
 *   - project.config.json (read) — enforcement_mode
 *
 * @author  @Architect
 * @version 1.0.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { readJsonFile, fileExists, resolveFrameworkPaths, getEnforcementMode } from "./framework-validation";
import {
  resolveStateDir,
  generateSessionId as coreGenerateSessionId,
  computeDigest,
  loadGateStore,
  saveGateStore,
  drainStaleSessions,
  validateTaskArtifacts as coreValidateTaskArtifacts,
  writeJsonFile,
} from "../../lib/gate-core";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface GateSession {
  session_id: string;
  created_at: string;
  task_description?: string;
  enforcement_mode?: string;
  gate_status: "checked" | "armed" | "completed" | "failed" | "drained";
  last_check_passed?: boolean;
  last_check_failed_items?: GateCheckItem[];
  plan_summary?: string | null;
  confirmed_at?: string | null;
  consumed_at?: string | null;
  expires_at?: string | null;
  task_id?: string | null;
  agent?: string;
  worktree?: string;
  audit?: { execution_summary: string; completed_at: string } | null;
  fail_reason?: string;
  missing_artifacts?: string[];
}

interface GateCheckItem {
  id: string;
  desc: string;
  severity: "HIGH" | "WARNING" | "INFO";
}

interface GateStore {
  formatVersion: string;
  active_sessions: string[];
  sessions: Record<string, GateSession>;
  audit_history?: GateAuditEntry[];
  last_updated?: string;
}

interface GateAuditEntry {
  session_id: string;
  task_description?: string;
  plan_summary?: string | null;
  agent?: string;
  task_id?: string | null;
  confirmed_at?: string | null;
  consumed_at?: string;
  execution_summary?: string;
  gate_status?: string;
}

// ═══════════════════════════════════════════════════════════════════
// PATH RESOLUTION
// ═══════════════════════════════════════════════════════════════════

function getProjectRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

function getStateDir(): string {
  const root = getProjectRoot();
  return resolveStateDir(root);
}

// ═══════════════════════════════════════════════════════════════════
// FILE PATHS
// ═══════════════════════════════════════════════════════════════════

const GATE_STATE_FILE = process.env.GATE_STATE_PATH ||
  path.join(getStateDir(), "gate-state.json");

const RULES_DIR = path.join(getProjectRoot(), ".opencode", "rules", "rule_detail");
const SKILLS_DIR = path.join(getProjectRoot(), ".opencode", "skills");

const RULE_FILES = {
  commonProject: path.join(getProjectRoot(), ".opencode", "rules", "common-project.md"),
  skillInvStd: path.join(RULES_DIR, "skill-invocation-standard.md"),
  mcpInventory: path.join(RULES_DIR, "mcp-tool-inventory.md"),
};

const SKILL_FILE = path.join(SKILLS_DIR, "execution-preflight-check", "SKILL.md");

const MACHINE_PATH = path.join(getStateDir(), "machine.json");
const RULE_REGISTRY_PATH = path.join(getStateDir(), "rule_registry.json");

// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

function writeJson(p: string, data: unknown): void {
  writeJsonFile(p, data);
}

function generateSessionId(): string {
  return coreGenerateSessionId();
}

function computeSHA256(filePath: string): string {
  const result = computeDigest(filePath);
  return result.digest ? result.digest.replace("sha256-", "") : "";
}

// ═══════════════════════════════════════════════════════════════════
// GATE STORE I/O
// ═══════════════════════════════════════════════════════════════════

function loadStore(): GateStore {
  const store = loadGateStore(getProjectRoot()) as unknown as GateStore;
  if (store && store.sessions) return store;
  return {
    formatVersion: "2.0",
    active_sessions: [],
    sessions: {},
    audit_history: [],
  };
}

function saveStore(store: GateStore): void {
  saveGateStore(store, getProjectRoot());
}

// ═══════════════════════════════════════════════════════════════════
// RULE VERIFICATION
// ═══════════════════════════════════════════════════════════════════

function verifyRules(): { status: Record<string, string>; failed: GateCheckItem[] } {
  const status: Record<string, string> = {};
  const failed: GateCheckItem[] = [];

  if (!fileExists(SKILL_FILE)) {
    failed.push({ id: "skill_execution_preflight_check", desc: `SKILL.md not found at ${SKILL_FILE}`, severity: "HIGH" });
  }

  for (const [key, filePath] of Object.entries(RULE_FILES)) {
    status[path.basename(filePath)] = fileExists(filePath) ? "found" : "missing";
    if (!fileExists(filePath)) {
      failed.push({ id: `rule_${key}`, desc: `${path.basename(filePath)} not found`, severity: "HIGH" });
    }
  }

  return { status, failed };
}

function verifyRuleRegistry(): { results: GateCheckItem[]; summary: string; passed: boolean } {
  const registry = readJsonFile<any>(RULE_REGISTRY_PATH);
  const results: GateCheckItem[] = [];

  if (!registry?.entries) {
    return { results, summary: "Registry not available", passed: true };
  }

  const entries = registry.entries;
  let verified = 0;
  let mismatches = 0;

  for (const [key, entry] of Object.entries(entries)) {
    const e = entry as any;
    const filePath = path.join(getProjectRoot(), e.path);
    const storedHash = e.sha256 || "";

    if (!fileExists(filePath)) {
      mismatches++;
      results.push({ id: `rule_registry_missing_${key}`, desc: `${e.path}: file not found`, severity: "HIGH" });
      continue;
    }

    const actualHash = computeSHA256(filePath);
    if (actualHash !== storedHash) {
      mismatches++;
      results.push({
        id: `rule_registry_digest_mismatch_${key}`,
        desc: `${e.path}: digest mismatch — expected ${storedHash.substring(0, 16)}..., got ${actualHash.substring(0, 16)}...`,
        severity: "WARNING",
      });
    } else {
      verified++;
    }
  }

  const summary = `${verified} digests verified, ${mismatches} mismatches`;
  results.push({ id: "rule_registry_summary", desc: summary, severity: mismatches > 0 ? "HIGH" : "INFO" });
  return { results, summary, passed: mismatches === 0 };
}

function checkRoleViolations(): GateCheckItem[] {
  const failed: GateCheckItem[] = [];
  try {
    const machine = readJsonFile<any>(MACHINE_PATH);
    const violations = machine?.compliance_records?.role_violations || [];
    const unresolved = violations.filter((v: any) => v.status === "unresolved");
    if (unresolved.length > 0) {
      failed.push({
        id: "agent_role_violation",
        desc: `CAT4.1: ${unresolved.length} unresolved role violations`,
        severity: "HIGH",
      });
    }
  } catch {}
  return failed;
}

// ═══════════════════════════════════════════════════════════════════
// STALE SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

function drainStale(armedHours = 24, checkedHours = 48): number {
  const result = drainStaleSessions(armedHours, checkedHours, getProjectRoot());
  return result.purged;
}

// ═══════════════════════════════════════════════════════════════════
// TASK ARTIFACT VALIDATION
// ═══════════════════════════════════════════════════════════════════

function validateTaskArtifacts(taskId: string | null): string[] {
  return coreValidateTaskArtifacts(taskId, getProjectRoot());
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC: compliance_gate_check
// ═══════════════════════════════════════════════════════════════════

export interface GateCheckResult {
  passed: boolean;
  session_id: string;
  enforcement_mode: string;
  failed_items: GateCheckItem[];
  rule_status: Record<string, string>;
}

export function gateCheck(taskDescription: string): GateCheckResult {
  // Auto-drain stale sessions
  const drained = drainStale();
  if (drained > 0) {
    process.stderr.write(`[gate-plugin] Drained ${drained} stale session(s)\n`);
  }

  const mode = getEnforcementMode(resolveFrameworkPaths(getProjectRoot()));
  const sessionId = generateSessionId();
  const { status: ruleStatus, failed } = verifyRules();

  // Rule registry verification
  const registryResult = verifyRuleRegistry();
  failed.push(...registryResult.results);

  // Role violations
  failed.push(...checkRoleViolations());

  // Enforcement mode: advisory downgrades failures to warnings
  if (mode === "advisory") {
    for (const item of failed) {
      if (item.severity === "HIGH") {
        item.severity = "WARNING";
        item.desc = "[ADVISORY] " + item.desc;
      }
    }
  }

  const passed = mode === "advisory" ? true : failed.filter((f) => f.severity === "HIGH").length === 0;
  const hasHigh = failed.some((f) => f.severity === "HIGH");

  // Persist session
  const store = loadStore();
  store.sessions[sessionId] = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || "",
    enforcement_mode: mode,
    gate_status: "checked",
    last_check_passed: !hasHigh,
    last_check_failed_items: failed,
    plan_summary: null,
    confirmed_at: null,
    consumed_at: null,
    audit: null,
  };
  store.last_updated = new Date().toISOString();
  saveStore(store);

  return { passed, session_id: sessionId, enforcement_mode: mode, failed_items: failed, rule_status: ruleStatus };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC: compliance_gate_confirm
// ═══════════════════════════════════════════════════════════════════

export interface GateConfirmResult {
  status: "armed" | "rejected";
  reason?: string;
  session_id?: string;
  confirmed_at?: string;
  expires_at?: string;
  plan_summary?: string;
}

export function gateConfirm(
  sessionId: string,
  planSummary: string,
  agent?: string,
  taskId?: string,
): GateConfirmResult {
  const store = loadStore();
  const session = store.sessions[sessionId];
  if (!session) return { status: "rejected", reason: `session not found: ${sessionId}` };
  if (session.gate_status === "armed") return { status: "rejected", reason: "already armed" };
  if (session.gate_status !== "checked") return { status: "rejected", reason: `not in checked state: ${session.gate_status}` };
  if (!planSummary || planSummary.trim().length < 10) return { status: "rejected", reason: "plan_summary must be at least 10 characters" };

  const mode = getEnforcementMode(resolveFrameworkPaths(getProjectRoot()));
  if (session.last_check_passed === false && mode !== "advisory") {
    return { status: "rejected", reason: "Gate check failed — resolve HIGH severity violations first" };
  }

  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.task_id = taskId || session.task_id || null;
  session.agent = agent || "unknown";
  session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  if (!store.active_sessions.includes(sessionId)) store.active_sessions.push(sessionId);
  store.last_updated = new Date().toISOString();
  saveStore(store);

  return {
    status: "armed",
    session_id: sessionId,
    confirmed_at: session.confirmed_at,
    expires_at: session.expires_at,
    plan_summary: planSummary.trim().substring(0, 200),
  };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC: compliance_gate_complete
// ═══════════════════════════════════════════════════════════════════

export interface GateCompleteResult {
  status: "completed" | "failed" | "rejected";
  reason?: string;
  audit?: {
    session_id: string;
    task_description?: string;
    plan_summary?: string | null;
    confirmed_at?: string | null;
    consumed_at?: string;
    execution_summary?: string;
    audit_history_count?: number;
  };
  dirty_modules?: string[];
  missing_artifacts?: string[];
}

export function gateComplete(sessionId: string, executionSummary: string): GateCompleteResult {
  const store = loadStore();
  const session = store.sessions[sessionId];
  if (!session) return { status: "rejected", reason: `session not found: ${sessionId}` };
  if (session.gate_status !== "armed") return { status: "rejected", reason: `not armed: ${session.gate_status}` };
  if (session.consumed_at) return { status: "rejected", reason: `already completed at ${session.consumed_at}` };

  const mode = getEnforcementMode(resolveFrameworkPaths(getProjectRoot()));

  // ESLint dirty_modules check
  let eslintFailed = false;
  let dirtyModules: string[] = [];
  try {
    const machine = readJsonFile<any>(MACHINE_PATH);
    const dirty = machine?.eslint_state?.aggregate?.dirty_modules;
    if (dirty && dirty.length > 0) {
      dirtyModules = dirty;
      eslintFailed = true;
    }
  } catch {}

  if (eslintFailed && mode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason = "ESLint dirty_modules: " + dirtyModules.join(", ");
    store.active_sessions = store.active_sessions.filter((s) => s !== sessionId);
    saveStore(store);
    return { status: "failed", reason: "CAT3.7: ESLint violations: " + dirtyModules.join(", "), dirty_modules: dirtyModules };
  }

  // Task artifact validation
  const missing = validateTaskArtifacts(session.task_id || null);
  if (missing.length > 0 && mode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason = "Missing artifacts: " + missing.join(", ");
    session.missing_artifacts = missing;
    store.active_sessions = store.active_sessions.filter((s) => s !== sessionId);
    saveStore(store);
    return { status: "failed", reason: "Missing artifacts: " + missing.join(", "), missing_artifacts: missing };
  }

  const now = new Date().toISOString();
  session.gate_status = "completed";
  session.consumed_at = now;
  session.audit = { execution_summary: (executionSummary || "").substring(0, 1000), completed_at: now };

  store.audit_history = store.audit_history || [];
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
  store.active_sessions = store.active_sessions.filter((s) => s !== sessionId);
  store.last_updated = now;
  saveStore(store);

  return {
    status: "completed",
    audit: {
      session_id: sessionId,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
      confirmed_at: session.confirmed_at,
      consumed_at: now,
      execution_summary: (executionSummary || "").substring(0, 200),
      audit_history_count: store.audit_history.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC: purge
// ═══════════════════════════════════════════════════════════════════

export function gatePurge(): { purged: number } {
  const drained = drainStale();
  return { purged: drained };
}
