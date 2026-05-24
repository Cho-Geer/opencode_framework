#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const OPENCODE_ROOT = process.env.OPENCODE_ROOT || ".";
const fs2 = require("fs");
const path2 = require("path");

function resolveProjectState() {
  const cfgPath = path2.join(OPENCODE_ROOT, ".qoder", "project.config.json");
  try {
    const cfg = JSON.parse(fs2.readFileSync(cfgPath, "utf8"));
    const pr = cfg.project_root;
    if (pr && pr !== ".") {
      const stateDir = path2.join(OPENCODE_ROOT, pr, ".qoder", "state");
      if (fs2.existsSync(stateDir)) return stateDir;
    }
  } catch {}
  return path2.join(OPENCODE_ROOT, ".qoder", "state");
}

const GATE_STATE_FILE =
  process.env.GATE_STATE_PATH ||
  path2.join(resolveProjectState(), "gate-state.json");

const SKILL_INV_STD =
  process.env.SKILL_INV_STD_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".qoder",
    "rules",
    "rule_detail",
    "skill-invocation-standard.md",
  );

const MCP_INVENTORY =
  process.env.MCP_INVENTORY_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".qoder",
    "rules",
    "rule_detail",
    "mcp-tool-inventory.md",
  );

const COMMON_RULES =
  process.env.COMMON_RULES_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".qoder",
    "rules",
    "common-project.md",
  );

const SKILL_FILE =
  process.env.SKILL_FILE_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".qoder",
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
    // Fallback: direct write if transaction engine fails
    process.stderr.write(
      `[compliance-gate] ⚠ Transaction failed (${txnErr.message}), falling back to direct write for ${path.relative(OPENCODE_ROOT, p)}\n`,
    );
    fs.writeFileSync(p, content, "utf8");
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
    process.stderr.write(
      `[compliance-gate] ⚠ Transaction failed (${txnErr.message}), falling back to direct write for ${path.relative(OPENCODE_ROOT, p)}\n`,
    );
    fs.writeFileSync(p, content, "utf8");
  }
}

function fileExists(p) {
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
  try {
    const resolved = path.resolve(OPENCODE_ROOT, filePath);
    const content = fs.readFileSync(resolved, "utf8");
    // Pattern 1: YAML frontmatter `version: "1.2.3"` or `version: 1.2.3`
    const fmMatch = content.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m);
    if (fmMatch) return fmMatch[1];
    // Pattern 2: Markdown header `## Version 1.2.3` or `# v1.2.3`
    const hdrMatch = content.match(
      /^#{1,3}\s+(?:Version|v)\s*(\d+\.\d+\.\d+)/im,
    );
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
  const ts = Date.now().toString();
  return `cg_ses_${ts}`;
}

// ── Enforcement Mode ────────────────────────────────────────────────────
function getEnforcementMode() {
  // Priority: ENFORCEMENT_MODE env var > project.config.json > default "advisory"
  const envMode = process.env.ENFORCEMENT_MODE;
  const validModes = ["advisory", "strict", "locked"];

  // Read from project.config.json
  const cfgPath = path2.join(OPENCODE_ROOT, ".qoder", "project.config.json");
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

  // ENFORCEMENT_MODE env var override (with locked-mode safety)
  if (envMode && validModes.includes(envMode)) {
    // Safety: locked mode cannot be overridden by env var
    if (configMode === "locked") {
      return "locked";
    }
    return envMode;
  }

  return configMode;
}

function getFreshStore() {
  return {
    formatVersion: "2.0",
    sessions: {},
    active_sessions: [],
    last_updated: null,
  };
}

function loadStore() {
  const s = readJson(GATE_STATE_FILE);
  if (
    s &&
    s.formatVersion === "2.0" &&
    s.sessions &&
    typeof s.sessions === "object"
  ) {
    // Backward compat: ensure active_sessions exists
    if (!Array.isArray(s.active_sessions)) {
      s.active_sessions = [];
    }
    // Reconciliation pass: bidirectional — remove stale + add missing
    let reconciled = false;

    // Phase 1: Remove completed/expired sessions from active_sessions
    s.active_sessions = s.active_sessions.filter((sid) => {
      const ses = s.sessions[sid];
      if (!ses) {
        reconciled = true;
        return false;
      } // orphaned ref
      if (ses.gate_status === "completed" || ses.gate_status === "failed") {
        reconciled = true;
        return false;
      }
      if (ses.consumed_at) {
        reconciled = true;
        return false;
      } // consumed but not marked completed/failed
      return true; // still active (checked or armed)
    });

    // Phase 1.5: Remove stale armed sessions (>24h since confirmation, no completion)
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

    // Phase 2: Add armed sessions missing from active_sessions
    // Only "armed" (post-confirm, pre-complete) — matches runGateConfirm add behavior.
    // "checked" sessions are pre-confirmation and should not count as active.
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
    // Ensure last_updated exists
    if (!s.last_updated) {
      s.last_updated = new Date().toISOString();
    }
    return s;
  }
  return getFreshStore();
}

function saveStore(store) {
  writeJson(GATE_STATE_FILE, store);
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

  // ── Enforcement Mode: advisory downgrades failures to warnings ──
  const enforcementMode = getEnforcementMode();
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

function runGateConfirm(sessionId, planSummary) {
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

  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  // Add to active_sessions (dedup)
  if (!store.active_sessions.includes(sessionId)) {
    store.active_sessions.push(sessionId);
  }
  store.last_updated = new Date().toISOString();
  saveStore(store);
  return {
    status: "armed",
    session_id: sessionId,
    confirmed_at: session.confirmed_at,
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

  const now = new Date().toISOString();
  session.gate_status = "completed";
  session.consumed_at = now;
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

  const audit = {
    status: "completed",
    session_id: sessionId,
    task_description: session.task_description,
    plan_summary: session.plan_summary,
    confirmed_at: session.confirmed_at,
    consumed_at: session.consumed_at,
    execution_summary: session.audit.execution_summary,
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
  ],
}));

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
    const result = runGateConfirm(args.session_id, args.plan_summary);
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
