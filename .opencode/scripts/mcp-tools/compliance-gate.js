#!/usr/bin/env node
"use strict";

// ── Delegate to .opencode/lib/gate-core.ts (single source of truth) ──
let _gateCore = null;
try {
  const gateCorePath = require("path").join(
    process.env.OPENCODE_ROOT || require("path").resolve(__dirname, "..", "..", ".."),
    ".opencode", "lib", "gate-core"
  );
  _gateCore = require(gateCorePath);
} catch (_e) {
  // Fallback: inline implementations used
}

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const fs2 = require("fs");
const path2 = require("path");
const OPENCODE_ROOT = process.env.OPENCODE_ROOT ? path2.resolve(process.env.OPENCODE_ROOT) : path2.resolve(__dirname, "..", "..", "..");

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

// ── State Transaction Engine (RVW-REVIEW-01) ─────────────────────
const {
  beginTransaction,
  initializeTransactionSystem,
} = require("../state-transaction");
// Initialize on first load (crash recovery + revision bootstrap)
let _txnInitialized = false;
function ensureTxnInit() {
  if (!_txnInitialized) {
    initializeTransactionSystem();
    _txnInitialized = true;
  }
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
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  ensureTxnInit();
  try {
    const txn = beginTransaction(p, "@Architect", "compliance-gate");
    txn.prepare(content);
    txn.commit();
    // Log resolution so pre-commit hook Layer 3 can see it
    process.stderr.write(
      `[compliance-gate] ✓ txn ${txn.operationId} committed (rev ${txn.newRevision}) → ${path.relative(OPENCODE_ROOT, p)}\n`,
    );
  } catch (txnErr) {
    // F6 Fix: Read enforcement mode before handling transaction failure
    const enfMode = getEnforcementMode();
    if (enfMode === "advisory") {
      // Advisory: preserve existing fallback
      process.stderr.write(
        `[compliance-gate] ⚠ Transaction failed (${txnErr.message}), falling back to direct write for ${path.relative(OPENCODE_ROOT, p)}\n`,
      );
      fs.writeFileSync(p, content, "utf8");
    } else {
      // Strict/locked: fail-closed — NO file written
      process.stderr.write(
        `[compliance-gate] ❌ Transaction failed (${txnErr.message}) for ${path.relative(OPENCODE_ROOT, p)} in ${enfMode} mode — file NOT written (fail-closed)\n`,
      );
      throw txnErr;
    }
  }
}

/**
 * Write JSON state file with transactional envelope + agent/taskId context.
 * Used when the caller knows the agent identity and task ID.
 */
function writeJsonWithContext(p, data, agent, taskId) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  ensureTxnInit();
  try {
    const txn = beginTransaction(p, agent, taskId);
    txn.prepare(content);
    txn.commit();
    process.stderr.write(
      `[compliance-gate] ✓ txn ${txn.operationId} committed (rev ${txn.newRevision}) → ${path.relative(OPENCODE_ROOT, p)}\n`,
    );
  } catch (txnErr) {
    // F6 Fix: Read enforcement mode before handling transaction failure
    const enfMode = getEnforcementMode();
    if (enfMode === "advisory") {
      process.stderr.write(
        `[compliance-gate] ⚠ Transaction failed (${txnErr.message}), falling back to direct write for ${path.relative(OPENCODE_ROOT, p)}\n`,
      );
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
 * Compute SHA-256 digest of a file.
 * @param {string} filePath - Absolute or relative path to the file
 * @returns {{ digest: string|null, error: string|null }}
 *   digest format: "sha256-{hex}" (consistent with keystone hash convention)
 */
function computeDigest(filePath) {
  if (_gateCore && typeof _gateCore.computeDigest === "function") {
    return _gateCore.computeDigest(OPENCODE_ROOT, filePath);
  }
  try {
    const resolved = path.resolve(OPENCODE_ROOT, filePath);
    const content = fs.readFileSync(resolved);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return { digest: "sha256-" + hash, error: null };
  } catch (err) {
    return { digest: null, error: err.message };
  }
}

/**
 * Extract semantic version from file content.
 * Searches for patterns: YAML frontmatter `version:`, markdown `## Version X.Y.Z`,
 * or inline `vX.Y.Z`.
 * @param {string} filePath
 * @returns {string|null} - Semantic version string or null
 */
function extractSemver(filePath) {
  if (_gateCore && typeof _gateCore.extractSemver === "function") {
    return _gateCore.extractSemver(OPENCODE_ROOT, filePath);
  }
  try {
    const resolved = path.resolve(OPENCODE_ROOT, filePath);
    const content = fs.readFileSync(resolved, "utf8");
    const fmMatch = content.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m);
    if (fmMatch) return fmMatch[1];
    const hdrMatch = content.match(/^#{1,3}\s+(?:Version|v)\s*(\d+\.\d+\.\d+)/im);
    if (hdrMatch) return hdrMatch[1];
    // Pattern 3: Inline `v1.2.3`
    const inlineMatch = content.match(/v(\d+\.\d+\.\d+)/);
    if (inlineMatch) return inlineMatch[1];
  } catch {}
  return null;
}

/**
 * Verify rule/skill/agent file digests against the registry.
 * Compares current file digest with expected registry entry.
 * Classifies mismatches by severity per verification_policy.
 *
 * @returns {{ passed: boolean, results: Array<{id, desc, severity}> }}
 */
function verifyRuleRegistry() {
  const results = [];
  const registry = readJson(RULE_REGISTRY_PATH);

  // No registry found → no verification, not an error (graceful degradation)
  if (!registry || !registry.entries) {
    return { passed: true, results: [], registry_available: false };
  }

  const policy = registry.verification_policy || {};
  const entries = registry.entries;
  const digestFormat =
    (registry.meta && registry.meta.digest_format) || "sha256-{hex}";

  let verifiedCount = 0;
  let mismatchCount = 0;
  let warningCount = 0;
  const criticalMismatches = [];

  for (const [key, entry] of Object.entries(entries)) {
    const filePath = entry.path || key;
    const fullPath = path.resolve(OPENCODE_ROOT, filePath);

    // --- File existence check (fast path, retained) ---
    if (!fileExists(fullPath)) {
      mismatchCount++;
      const item = {
        id: "rule_registry_missing_" + key.replace(/[^a-zA-Z0-9]/g, "_"),
        desc: `[Gate Preflight v2] ${filePath}: file registered but MISSING (expected v${entry.semver}/sha256-${entry.sha256})`,
        severity: "HIGH",
      };
      results.push(item);
      criticalMismatches.push(filePath);
      continue;
    }

    // --- Digest verification ---
    const { digest: currentDigest, error: digestError } =
      computeDigest(filePath);

    if (digestError) {
      mismatchCount++;
      results.push({
        id: "rule_registry_read_error_" + key.replace(/[^a-zA-Z0-9]/g, "_"),
        desc: `[Gate Preflight v2] ${filePath}: cannot compute digest (${digestError})`,
        severity: "HIGH",
      });
      criticalMismatches.push(filePath);
      continue;
    }

    const expectedDigestHex = entry.sha256; // raw hex (no prefix)
    const currentDigestHex = currentDigest.replace(/^sha256-/, "");

    if (currentDigestHex === expectedDigestHex) {
      // Digest match → PASS
      verifiedCount++;
      continue;
    }

    // --- Digest mismatch → determine severity ---
    const currentSemver = extractSemver(filePath);
    const expectedSemver = entry.semver || "0.0.0";

    let severity;
    let descSuffix;

    if (currentSemver && currentSemver !== expectedSemver) {
      // Version bumped → intentional update, WARNING
      severity = "WARNING";
      warningCount++;
      descSuffix = `version bump detected (${expectedSemver} → ${currentSemver}) — verify compatibility`;
    } else {
      // Digest changed but version unchanged → possible unauthorized modification, HIGH
      severity = "HIGH";
      mismatchCount++;
      descSuffix = `NO version change (expected v${expectedSemver}/sha256-${expectedDigestHex.substring(0, 16)}..., got sha256-${currentDigestHex.substring(0, 16)}...) — possible unauthorized modification`;
      criticalMismatches.push(filePath);
    }

    results.push({
      id: "rule_registry_digest_mismatch_" + key.replace(/[^a-zA-Z0-9]/g, "_"),
      desc: `[Gate Preflight v2] ${filePath}: digest mismatch — ${descSuffix}`,
      severity,
    });
  }

  // Update registry integrity tracking
  try {
    const updatedRegistry = readJson(RULE_REGISTRY_PATH);
    if (updatedRegistry && updatedRegistry.integrity) {
      updatedRegistry.integrity.last_full_verification =
        new Date().toISOString();
      updatedRegistry.integrity.verified_count = verifiedCount;
      updatedRegistry.integrity.mismatch_count = mismatchCount;
      updatedRegistry.integrity.warning_count = warningCount;
      updatedRegistry.integrity.critical_mismatches = criticalMismatches;
      updatedRegistry.integrity.status =
        mismatchCount > 0 ? "failed" : warningCount > 0 ? "warning" : "clean";
      updatedRegistry.integrity.last_verified_digest = currentDigestHex;
      updatedRegistry.meta.last_updated = new Date().toISOString();
      writeJson(RULE_REGISTRY_PATH, updatedRegistry);
    }
  } catch {
    // Non-blocking: integrity update failure does not affect gate result
  }

  const hasHighSeverity = results.some((r) => r.severity === "HIGH");
  return {
    passed: !hasHighSeverity,
    results,
    registry_available: true,
    summary: `[Gate Preflight v2] ${verifiedCount} digests verified, ${mismatchCount} mismatches (HIGH), ${warningCount} warnings`,
  };
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
      const mode = cfg.template_resolution?.enforcement_mode;
      if (mode && validModes.includes(mode)) {
        configMode = mode;
      }
    }
  } catch {}

  if (envMode && validModes.includes(envMode)) {
    if (configMode === "locked") return "locked";
    return envMode;
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
  if (s && s.formatVersion === "2.0" && s.sessions && typeof s.sessions === "object") {
    if (!Array.isArray(s.active_sessions)) { s.active_sessions = []; }
    let reconciled = false;
    s.active_sessions = s.active_sessions.filter((sid) => {
      const ses = s.sessions[sid];
      if (!ses) { reconciled = true; return false; }
      if (ses.gate_status === "completed" || ses.gate_status === "failed") { reconciled = true; return false; }
      if (ses.consumed_at) { reconciled = true; return false; }
      return true;
    });
    const STALE_MS = 24 * 60 * 60 * 1000;
    const nowTs = Date.now();
    s.active_sessions = s.active_sessions.filter((sid) => {
      const ses = s.sessions[sid];
      if (!ses) return false;
      if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
        const age = nowTs - new Date(ses.confirmed_at).getTime();
        if (age > STALE_MS) { reconciled = true; return false; }
      }
      return true;
    });
    for (const [sid, ses] of Object.entries(s.sessions)) {
      if (ses.gate_status === "armed" && !ses.consumed_at && !s.active_sessions.includes(sid)) {
        s.active_sessions.push(sid);
        reconciled = true;
      }
    }
    if (reconciled) { s.last_updated = new Date().toISOString(); }
    if (!s.last_updated) { s.last_updated = new Date().toISOString(); }
    return s;
  }
  return getFreshStore();
}

function saveStore(store) {
  if (_gateCore && typeof _gateCore.saveGateStore === "function") {
    return _gateCore.saveGateStore(store, OPENCODE_ROOT);
  }
  writeJson(GATE_STATE_FILE, store);
}

// ── Session Purge (F5) ──────────────────────────────────────────────
const DRAINED_STORE_FILE = GATE_STATE_FILE.replace(
  /\.json$/,
  ".drained_sessions.json",
);

/**
 * Purge stale gate sessions based on age thresholds.
 * - Armed sessions > 24h since confirmed_at → drained
 * - Checked (unconfirmed) sessions > 48h since created_at → drained
 * Drained sessions are moved to gate-state.json.drained_sessions to preserve audit trail.
 * @returns {{ purged: number, drained_sessions: Array, remaining_active: number }}
 */
function purgeStaleSessions() {
  const store = loadStore();
  const drainedSessions = readJson(DRAINED_STORE_FILE) || {
    formatVersion: "2.0",
    drained_sessions: {},
    last_drained: null,
  };
  const nowTs = Date.now();
  const ARMED_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
  const CHECKED_STALE_MS = 48 * 60 * 60 * 1000; // 48 hours
  let purged = 0;
  const sessionIds = Object.keys(store.sessions);

  for (const sid of sessionIds) {
    const ses = store.sessions[sid];
    if (!ses) continue;

    let shouldDrain = false;
    let reason = "";

    // Armed but never consumed > 24h
    if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
      const age = nowTs - new Date(ses.confirmed_at).getTime();
      if (age > ARMED_STALE_MS) {
        shouldDrain = true;
        reason = `armed for ${Math.floor(age / 3600000)}h without completion`;
      }
    }

    // Checked but never confirmed > 48h
    if (ses.gate_status === "checked" && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > CHECKED_STALE_MS) {
        shouldDrain = true;
        reason = `checked for ${Math.floor(age / 3600000)}h without confirmation`;
      }
    }

    if (shouldDrain) {
      drainedSessions.drained_sessions[sid] = {
        ...ses,
        drained_at: new Date().toISOString(),
        drain_reason: reason,
      };
      delete store.sessions[sid];
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
      purged++;
    }
  }

  if (purged > 0) {
    drainedSessions.last_drained = new Date().toISOString();
    drainedSessions.total_drained = Object.keys(
      drainedSessions.drained_sessions,
    ).length;
    writeJson(DRAINED_STORE_FILE, drainedSessions);
    store.last_updated = new Date().toISOString();
    saveStore(store);
  }

  return {
    purged,
    drained_sessions:
      purged > 0
        ? Object.keys(drainedSessions.drained_sessions).slice(-purged)
        : [],
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

function runGateCheck(taskDescription) {
  // ── Bootstrap: check hooksPath is configured (one-time hint on fresh clone) ──
  try {
    const { execSync } = require("child_process");
    const hooksPath = execSync("git config --local core.hooksPath", {
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (hooksPath !== ".opencode/hooks") {
      process.stderr.write(
        `[compliance-gate] ⚠ Bootstrap: core.hooksPath is "${hooksPath}", expected ".opencode/hooks".\n` +
          `  Run: git config core.hooksPath .opencode/hooks\n` +
          `  Or: bash .opencode/scripts/setup.sh\n`,
      );
    }
  } catch {
    process.stderr.write(
      `[compliance-gate] ⚠ Bootstrap: could not read core.hooksPath.\n` +
        `  Run: bash .opencode/scripts/setup.sh\n`,
    );
  }

  // ── F5 Auto-purge stale sessions before creating new one ──
  // ── P5-001: Also auto-drain stale sessions on every check ──
  const enforcementMode = getEnforcementMode();
  const purgeResult = purgeStaleSessions();
  if (purgeResult.purged > 0) {
    const msg = `Purged ${purgeResult.purged} stale session(s) (${purgeResult.remaining_total} remaining, ${purgeResult.remaining_active} active)`;
    if (enforcementMode === "advisory") {
      process.stderr.write(`[ADVISORY] ${msg}\n`);
    } else {
      process.stderr.write(`[compliance-gate] ${msg}\n`);
    }
  }
  // Also drain any remaining stale sessions
  const drainResult = drainStaleSessions(24, 48);
  if (drainResult.purged > 0) {
    const msg = `Drained ${drainResult.purged} stale session(s) (armed=${drainResult.drained_armed}, checked=${drainResult.drained_checked})`;
    if (enforcementMode === "advisory") {
      process.stderr.write(`[ADVISORY] ${msg}\n`);
    } else {
      process.stderr.write(`[compliance-gate] ${msg}\n`);
    }
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
    const stateDir = resolveProjectState();
    const machinePath = path2.join(stateDir, "machine.json");
    if (fs2.existsSync(machinePath)) {
      const machine = JSON.parse(fs2.readFileSync(machinePath, "utf-8"));
      const violations = machine.compliance_records?.role_violations || [];
      const unresolved = violations.filter((v) => v.status === "unresolved");
      if (unresolved.length > 0) {
        failed.push({
          id: "agent_role_violation",
          desc: `CAT4.1: ${unresolved.length} unresolved role violations found in machine.json.compliance_records. Last: ${unresolved[unresolved.length - 1].agent} wrote ${unresolved[unresolved.length - 1].violation_file}`,
          severity: "HIGH",
        });
      }
    }
  } catch {} // Non-blocking if machine.json can't be read

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

  const passed = enforcementMode === "advisory" ? true : failed.length === 0;
  store.sessions[sessionId] = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || "",
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

function runGateConfirm(sessionId, planSummary, agent, taskId) {
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

  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  // ── P5-001: Lifecycle fields ──
  session.task_id = taskId || session.task_id || null;
  session.agent = agent || session.agent || "unknown";
  session.worktree = process.cwd();
  // expires_at: 24 hours from confirmation
  session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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
  if (session.gate_status !== "armed") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.`,
    };
  }
  if (session.consumed_at) {
    return {
      status: "rejected",
      reason: `session ${sessionId} already completed at ${session.consumed_at}. Cannot re-complete.`,
    };
  }

  // ESLint mock-audit check: read machine.json.eslint_state
  const stateDir = resolveProjectState();
  const machinePath = path2.join(stateDir, "machine.json");
  let eslintFailed = false;
  let dirtyModules = [];

  try {
    if (fs2.existsSync(machinePath)) {
      const machine = JSON.parse(fs2.readFileSync(machinePath, "utf-8"));
      if (machine.eslint_state?.aggregate?.dirty_modules?.length > 0) {
        dirtyModules = machine.eslint_state.aggregate.dirty_modules;
        eslintFailed = true;
      }
    }
  } catch {
    // If machine.json can't be read, allow gate to proceed
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
    process.stderr.write(
      "[ADVISORY] ESLint dirty_modules found but ignored (advisory mode): " +
        dirtyModules.join(", ") +
        "\n",
    );
  }

  // ── CI-UNIFY-003: Validate HANDOVER.md and TASK_LOG.md exist ──
  const missingArtifacts = validateTaskArtifacts(session.task_id);
  if (missingArtifacts.length > 0 && enforcementMode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.enforcement_mode = enforcementMode;
    session.fail_reason =
      "Missing required task artifacts: " + missingArtifacts.join(", ");
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
    return {
      status: "failed",
      reason:
        "Missing required task artifacts: " +
        missingArtifacts.join(", ") +
        ". Create HANDOVER.md and TASK_LOG.md under .task_temp/ before completing.",
      missing_artifacts: missingArtifacts,
    };
  }
  if (missingArtifacts.length > 0 && enforcementMode === "advisory") {
    process.stderr.write(
      "[ADVISORY] Missing task artifacts (proceeding): " +
        missingArtifacts.join(", ") +
        "\n",
    );
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

  const audit = {
    status: "completed",
    session_id: sessionId,
    task_description: session.task_description,
    plan_summary: session.plan_summary,
    confirmed_at: session.confirmed_at,
    consumed_at: session.consumed_at,
    execution_summary: session.audit.execution_summary,
    audit_history_count: store.audit_history.length,
  };
  return { status: "completed", audit };
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
        "MANDATORY runtime compliance gate v2. Must be called BEFORE any task execution. Verifies: (1) execution-preflight-check skill exists, (2) rule documents are present, (3) semantic version/digest compatibility via rule_registry.json (SHA-256 digest comparison against expected digests). Mismatches classified as WARNING (version bumped) or HIGH (digest changed without version bump). Returns passed=true and session_id only when all checks clear. NOTE: Gate status is informational only - check does not require pre-armed gate, making it safe for concurrent sessions.",
      inputSchema: {
        type: "object",
        properties: {
          task_description: {
            type: "string",
            description: "Brief description of the task to be executed",
          },
        },
        required: ["task_description"],
      },
    },
    {
      name: "compliance_gate_confirm",
      description:
        'Mark the compliance gate as "armed" after the user has reviewed and confirmed the task plan. This must be called AFTER compliance_gate_check passes and AFTER the user explicitly confirms the plan. Provide the session_id returned by compliance_gate_check.',
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
  ],
}));

/**
 * Validate that HANDOVER.md and TASK_LOG.md exist for a given task.
 * Used by runGateComplete to enforce CI-UNIFY-003 artifact requirements.
 * @param {string|null} taskId - The task ID to validate
 * @returns {string[]} Array of missing artifact filenames (empty if all present or taskId unknown)
 */
function validateTaskArtifacts(taskId) {
  if (_gateCore && typeof _gateCore.validateTaskArtifacts === "function") {
    return _gateCore.validateTaskArtifacts(taskId, OPENCODE_ROOT);
  }
  if (!taskId) return [];
  const taskTempDir = path2.join(OPENCODE_ROOT, ".task_temp", taskId);
  const handoverPath = path2.join(taskTempDir, "HANDOVER.md");
  const taskLogPath = path2.join(taskTempDir, "TASK_LOG.md");
  const missing = [];
  if (!fileExists(handoverPath)) missing.push("HANDOVER.md");
  if (!fileExists(taskLogPath)) missing.push("TASK_LOG.md");
  return missing;
}

/**
 * Drain stale sessions with configurable thresholds.
 * Delegates to gate-core.ts when available.
 * @param {number} armedHours - Hours after which armed sessions are stale (default 24)
 * @param {number} checkedHours - Hours after which checked sessions are stale (default 48)
 * @returns {{ purged: number, drained_sessions: string[], remaining_active: number, drained_armed: number, drained_checked: number }}
 */
function drainStaleSessions(armedHours, checkedHours) {
  if (_gateCore && typeof _gateCore.drainStaleSessions === "function") {
    return _gateCore.drainStaleSessions(OPENCODE_ROOT, armedHours, checkedHours);
  }
  const ARMED_STALE_MS = (armedHours || 24) * 60 * 60 * 1000;
  const CHECKED_STALE_MS = (checkedHours || 48) * 60 * 60 * 1000;
  const store = loadStore();
  const DRAINED_STORE_FILE = GATE_STATE_FILE.replace(/\.json$/, ".drained_sessions.json");
  const drainedStore = readJson(DRAINED_STORE_FILE) || { formatVersion: "2.0", drained_sessions: {}, last_drained: null };
  const nowTs = Date.now();
  let purged = 0, drainedArmed = 0, drainedChecked = 0;
  const drainedIds = [];
  for (const [sid, ses] of Object.entries(store.sessions)) {
    if (!ses) continue;
    let shouldDrain = false, reason = "", drainType = "";
    if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
      const age = nowTs - new Date(ses.confirmed_at).getTime();
      if (age > ARMED_STALE_MS) { shouldDrain = true; drainType = "STALE_ARMED"; reason = `armed for ${Math.floor(age / 3600000)}h without completion (threshold: ${armedHours}h)`; }
    }
    if (ses.gate_status === "checked" && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > CHECKED_STALE_MS) { shouldDrain = true; drainType = "STALE_CHECKED"; reason = `checked for ${Math.floor(age / 3600000)}h without confirmation (threshold: ${checkedHours}h)`; }
    }
    if (shouldDrain) {
      drainedStore.drained_sessions[sid] = { ...ses, drained_at: new Date().toISOString(), drain_reason: reason, drain_type: drainType, drained_by: "compliance_gate_drain_stale" };
      delete store.sessions[sid];
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
      purged++; drainedIds.push(sid);
      if (drainType === "STALE_ARMED") drainedArmed++;
      if (drainType === "STALE_CHECKED") drainedChecked++;
    }
  }
  if (purged > 0) {
    drainedStore.last_drained = new Date().toISOString();
    drainedStore.total_drained = Object.keys(drainedStore.drained_sessions).length;
    fs.mkdirSync(path.dirname(DRAINED_STORE_FILE), { recursive: true });
    writeJson(DRAINED_STORE_FILE, drainedStore);
    store.last_updated = new Date().toISOString();
    saveStore(store);
  }
  return { purged, drained_sessions: drainedIds, drained_armed: drainedArmed, drained_checked: drainedChecked, remaining_active: store.active_sessions.length, remaining_total: Object.keys(store.sessions).length };
}

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "compliance_gate_check") {
    const result = runGateCheck(args?.task_description || "");
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
    );
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

  throw new Error(`Unknown tool: ${name}`);
});

// 启动 stdio 传输
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[compliance-gate] started (SDK)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});


// ── Module exports (for testability / CI-UNIFY-003) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runGateCheck,
    runGateConfirm,
    runGateComplete,
    validateTaskArtifacts,
    getEnforcementMode,
  };
}
