#!/usr/bin/env node
"use strict";

/**
 * code-quality-gate.js — MCP Tool
 * ================================
 * OpenCode v3.0 Write-Time Audit Engine
 *
 * Exposes tool `run_write_check` (DEPRECATED — use code-quality-lib.js functions directly) that runs 6 checks on a changed file:
 *   1. Agent Write Scope  (<0.1s, BLOCKER)
 *   2. Prettier Format    (<0.5s, auto-fix)
 *   3. dependency-cruiser (<1s,   ERROR)
 *   4. ESLint mock-audit  (<1s,   TIER1 BLOCKER)
 *   5. tsc incremental    (2-5s,  BLOCKER)
 *   6. TDD Order          (<0.1s, BLOCKER)
 *
 * Exposes tool `run_full_scan` for Commit-Time / compliance_gate_complete.
 *
 * All results written to machine.json.{write_audit_state,type_check_state,dependency_state,format_state}
 *
 * Cross-Workspace Protection (FW-REPAIR-09):
 *   - Bootstrap validates all file paths in machine.json belong to current OPENCODE_ROOT
 *   - Foreign (cross-workspace) paths trigger state-reset warnings and auto-cleaning
 *   - write_audit_state rejects paths outside current workspace at write-time
 *   - type_check_state dirty_files filtered to current workspace paths on read
 *   - JSON Schema validation against machine.schema.json on bootstrap (AJV)
 *
 * CI-EMBED-001: Core audit logic extracted to ./code-quality-lib.js
 *   - This file now delegates all 6 checks to the shared library
 *   - State persistence (machine.json) remains in this MCP server
 *
 * Phase 2 R6 (2026-06-03, @Super-Admin): write_audit_log.json unified into machine.json.
 *   - Per-task write_audit_log.json files (.task_temp/{taskId}/write_audit_log.json) have been
 *     removed from all agent instructions (Coder-BE, Coder-FE, Guardian, preamble Step 5b).
 *   - machine.json.write_audit_state is now the SINGLE source of truth for write audit data.
 *   - @Guardian CAT5.1 checks now read from machine.json.write_audit_state instead of per-task JSON.
 *   - framework-enforcer.ts toolExecuteAfter auto-triggers write-time checks (Phase 2 R4),
 *     updating machine.json states directly without agent-initiated MCP calls.
 */

// ═══ Library import (CI-EMBED-001) ═══
const lib = require("./code-quality-lib.ts");

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * FW-LOG-UNIFY-P2-A2 (2026-06-12, @Super-Admin): Import log-manager for
 * centralized log persistence. Bun transpiles ESM→CJS for require().
 */
const { writeLog } = require("../../lib/log-manager");

// ─── State Transaction Engine (RVW-REVIEW-01) ─────────────────────
const {
  beginTransaction,
  initializeTransactionSystem,
} = require("../state-transaction");

// ─── Workspace-Root Canonicalization (RVW-REVIEW-02) ─────────
const stateCanon = require("../state-canonicalize");
let _cqTxnInitialized = false;
function ensureCqTxnInit() {
  if (!_cqTxnInitialized) {
    initializeTransactionSystem();
    _cqTxnInitialized = true;
  }
}

// ─── Constants ────────────────────────────────────────────
/**
 * OPENCODE_ROOT — workspace root resolution (FW-REPAIR-09)
 *
 * Priority:
 *   1. OPENCODE_ROOT env var (explicit override)
 *   2. process.cwd() (runtime working directory)
 *
 * The original __dirname-based path.resolve(__dirname, "..", "..", "..")
 * can be used for debugging: export OPENCODE_ROOT=$(pwd)
 */
const OPENCODE_ROOT = path.resolve(process.env.OPENCODE_ROOT || process.cwd());
const PROJECT_CONFIG_PATH = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "project.config.json",
);

function getProjectRoot() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG_PATH, "utf-8"));
  } catch (readErr) {
    throw new Error(
      `[code-quality-gate] Cannot read or parse project.config.json at ${PROJECT_CONFIG_PATH}: ${readErr.message}`,
    );
  }
  if (!cfg.project_root) {
    throw new Error(
      `[code-quality-gate] 'project_root' is not defined in project.config.json (${PROJECT_CONFIG_PATH}). ` +
        'Add "project_root": "<subdirectory>" to the config file.',
    );
  }
  return path.resolve(OPENCODE_ROOT, cfg.project_root);
}

function ensureStateDir(stateDir) {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

function getStatePath() {
  const pr = getProjectRoot();
  const stateDir = path.join(pr, ".opencode", "state");
  ensureStateDir(stateDir);
  return path.join(stateDir, "machine.json");
}

function getProjectConfig() {
  return JSON.parse(fs.readFileSync(PROJECT_CONFIG_PATH, "utf-8"));
}

/**
 * Read backend_src path from config, extract first segment, resolve to absolute.
 */
function getBackendDir() {
  const cfg = getProjectConfig();
  if (!cfg.paths || !cfg.paths.backend_src) {
    throw new Error(
      "[code-quality-gate] 'paths.backend_src' is not defined in project.config.json. " +
        'Add "paths": { "backend_src": "<relative_path>" } to the config file.',
    );
  }
  const segment = lib.firstPathSegment(cfg.paths.backend_src);
  return path.resolve(getProjectRoot(), segment);
}

/**
 * Read frontend_src path from config, extract first segment, resolve to absolute.
 */
function getFrontendDir() {
  const cfg = getProjectConfig();
  if (!cfg.paths || !cfg.paths.frontend_src) {
    throw new Error(
      "[code-quality-gate] 'paths.frontend_src' is not defined in project.config.json. " +
        'Add "paths": { "frontend_src": "<relative_path>" } to the config file.',
    );
  }
  const segment = lib.firstPathSegment(cfg.paths.frontend_src);
  return path.resolve(getProjectRoot(), segment);
}

function getDefaultMachine() {
  return {
    meta: {
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      lastUpdated: null,
      project: "unknown",
      framework: "opencode-v3",
    },
    eslint_state: {
      last_full_scan: null,
      modules: {},
      aggregate: { total_violations: 0, dirty_modules: [], waived_modules: [] },
    },
    type_check_state: {
      last_full_check: null,
      last_incremental_check: null,
      full_errors: 0,
      incremental_errors: 0,
      dirty_files: [],
      status: "clean",
    },
    dependency_state: {
      last_check: null,
      violations: [],
      forbidden_rules_applied: 0,
      status: "clean",
    },
    format_state: {
      last_check: null,
      unformatted_files: [],
      auto_fix_count: 0,
      status: "clean",
    },
    write_audit_state: { enabled: true, current_session: null, history: [] },
    compliance_records: {
      role_violations: [],
      gate_violations: [],
      tdd_violations: [],
    },
    tdd_enforcement_state: {
      enabled: true,
      current_session: null,
      violations: [],
      history: [],
    },
    contracts: ["contract.yaml"],
    keystone_hashes: {},
    transaction_state: {
      last_operation_id: null,
      last_transaction_at: null,
      pending_operations: [],
      transaction_log_path: ".opencode/state/.transaction-log",
    },
  };
}

function getMachine() {
  try {
    const raw = JSON.parse(fs.readFileSync(getStatePath(), "utf-8"));

    // ─── Cross-Workspace Bootstrap Validation (FW-REPAIR-09) ───
    const integrity = stateCanon.validateWorkspaceIntegrity(raw, OPENCODE_ROOT);
    if (integrity.warnings.length > 0) {
      process.stderr.write(integrity.warnings.join("\n") + "\n");
      // FW-LOG-UNIFY-P2-A2: DUAL-WRITE integrity warnings
      writeLog("mcp-code-quality-gate", "WARN", {
        event: "workspace_integrity_warnings", warnings: integrity.warnings,
      });
    }
    if (integrity.hasForeignPaths) {
      stateCanon.sanitizePathsInMachine(raw, OPENCODE_ROOT);
      writeMachine(raw);
      process.stderr.write(
        `[code-quality-gate] ⚠ Cross-workspace paths detected and auto-cleaned. ` +
          `State has been sanitized for current workspace: ${OPENCODE_ROOT}\n`,
      );
      // FW-LOG-UNIFY-P2-A2: DUAL-WRITE cross-workspace sanitization
      writeLog("mcp-code-quality-gate", "WARN", {
        event: "cross_workspace_sanitized", workspace: OPENCODE_ROOT,
      });
    }

    stateCanon.canonicalizePathsInMachine(raw, OPENCODE_ROOT);

    const schemaResult = validateMachineSchema(raw);
    if (schemaResult.warnings.length > 0) {
      process.stderr.write(schemaResult.warnings.join("\n") + "\n");
      writeLog("mcp-code-quality-gate", "WARN", {
        event: "schema_validation_warnings", warnings: schemaResult.warnings,
      });
    }
    if (schemaResult.errors.length > 0) {
      process.stderr.write(
        `[code-quality-gate] ⚠ machine.json schema validation errors:\n` +
          schemaResult.errors.map((e) => `  - ${e}`).join("\n") +
          "\n",
      );
      writeLog("mcp-code-quality-gate", "ERROR", {
        event: "schema_validation_errors", errors: schemaResult.errors,
      });
    }

    return raw;
  } catch {
    const defaultMachine = getDefaultMachine();

    // ─── Validate default machine against schema ───
    const schemaResult = validateMachineSchema(defaultMachine);
    if (schemaResult.warnings.length > 0) {
      process.stderr.write(schemaResult.warnings.join("\n") + "\n");
      writeLog("mcp-code-quality-gate", "WARN", {
        event: "default_schema_warnings", warnings: schemaResult.warnings,
      });
    }
    if (schemaResult.errors.length > 0) {
      process.stderr.write(
        `[code-quality-gate] ⚠ Default machine.json schema validation errors:\n` +
          schemaResult.errors.map((e) => `  - ${e}`).join("\n") +
          "\n",
      );
      writeLog("mcp-code-quality-gate", "ERROR", {
        event: "default_schema_errors", errors: schemaResult.errors,
      });
    }

    writeMachine(defaultMachine);
    return defaultMachine;
  }
}

function writeMachine(machine) {
  if (!machine.meta) {
    machine.meta = {
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      lastUpdated: null,
    };
  }
  machine.meta.lastUpdated = new Date().toISOString();

  // ─── Pre-Write Path Sanitization (FW-REPAIR-09) ───
  stateCanon.sanitizePathsInMachine(machine, OPENCODE_ROOT);

  // ─── Pre-Write Canonicalization: Convert to relative paths (RVW-REVIEW-02) ───
  stateCanon.canonicalizePathsInMachine(machine, OPENCODE_ROOT);

  const statePath = getStatePath();
  ensureStateDir(path.dirname(statePath));
  const content = JSON.stringify(machine, null, 2) + "\n";

  // ─── Transactional Write (RVW-REVIEW-01) ───
  ensureCqTxnInit();
  const agent =
    machine.write_audit_state?.current_session?.agent || "@Architect";
  const taskId =
    machine.write_audit_state?.current_session?.task_id || "unknown";
  try {
    const txn = beginTransaction(statePath, agent, taskId);
    txn.prepare(content);
    txn.commit();
    /**
     * FW-LOG-UNIFY-P2-A2 (2026-06-12): Migrated from process.stderr.write to writeLog.
     */
    writeLog("mcp-code-quality-gate", "INFO", {
      event: "txn_committed", operationId: txn.operationId, newRevision: txn.newRevision,
    });
  } catch (txnErr) {
    process.stderr.write(
      `[code-quality-gate] ⚠ Transaction failed (${txnErr.message}), falling back to direct write\n`,
    );
    // FW-LOG-UNIFY-P2-A2: DUAL-WRITE transaction failure
    writeLog("mcp-code-quality-gate", "WARN", {
      event: "txn_fallback", error: txnErr.message,
    });
    fs.writeFileSync(statePath, content, "utf-8");
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// ─── Cross-Workspace Protection & Canonicalization (FW-REPAIR-09 + RVW-REVIEW-02) ──
//
// Path validation, sanitization, and canonicalization functions have been
// extracted to ../state-canonicalize.ts for reuse across the framework.
// See: .opencode/scripts/state-canonicalize.ts
//
// Available via: const stateCanon = require("../state-canonicalize");
//   - stateCanon.isPathInWorkspace(filePath, workspaceRoot)
//   - stateCanon.makePathRelativeToWorkspace(filePath, workspaceRoot)
//   - stateCanon.validateWorkspaceIntegrity(machine, workspaceRoot)
//   - stateCanon.sanitizePathsInMachine(machine, workspaceRoot)
//   - stateCanon.canonicalizePathsInMachine(machine, workspaceRoot)

/**
 * Validate the machine.json state object against machine.schema.json
 * using AJV (JSON Schema validator). AJV is loaded dynamically — if not
 * installed, validation is skipped with a notice.
 *
 * Returns: { valid: boolean, errors: string[], warnings: string[] }
 */
function validateMachineSchema(machine) {
  const errors = [];
  const warnings = [];
  let ajv;

  try {
    ajv = require("ajv");
  } catch {
    warnings.push(
      "[code-quality-gate] AJV not installed — skipping machine.json schema validation. Run: npm install ajv",
    );
    return { valid: true, errors, warnings };
  }

  const schemaPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "state",
    "machine.schema.json",
  );
  if (!fs.existsSync(schemaPath)) {
    warnings.push(
      `[code-quality-gate] Schema not found at ${schemaPath} — skipping machine.json schema validation.`,
    );
    return { valid: true, errors, warnings };
  }

  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  } catch (parseErr) {
    warnings.push(
      `[code-quality-gate] Failed to parse machine.schema.json: ${parseErr.message} — skipping validation.`,
    );
    return { valid: true, errors, warnings };
  }

  try {
    const Ajv = ajv.default || ajv;
    const validator = new Ajv({ allErrors: true, strict: false });
    const validate = validator.compile(schema);
    const valid = validate(machine);

    if (!valid && validate.errors) {
      // Limit error output to first 10 to avoid flooding
      const topErrors = validate.errors.slice(0, 10).map((e) => {
        const instancePath = e.instancePath || "(root)";
        return `${instancePath}: ${e.message}${e.params ? " (" + JSON.stringify(e.params) + ")" : ""}`;
      });
      errors.push(...topErrors);

      if (validate.errors.length > 10) {
        errors.push(
          `... and ${validate.errors.length - 10} more validation errors`,
        );
      }
    }

    return { valid, errors, warnings };
  } catch (compileErr) {
    warnings.push(
      `[code-quality-gate] Schema compilation failed: ${compileErr.message}`,
    );
    return { valid: true, errors, warnings };
  }
}

// ─── State Persistence: updateStates ──────────────────────
// MACHINE.JSON STATE UPDATES STAY IN THE MCP SERVER, not the library.
// The library functions return pure results; this function persists them.
function updateStates(machine, results, agentType, taskId, file) {
  if (!machine.write_audit_state)
    machine.write_audit_state = { current_session: null, history: [] };

  // ─── Canonicalize file path to relative (RVW-REVIEW-02) ───
  const relFile = stateCanon.makePathRelativeToWorkspace(file, OPENCODE_ROOT);

  // Build current session
  const session = machine.write_audit_state.current_session || {
    agent: agentType,
    task_id: taskId || "unknown",
    files_written: [],
    checks_run: 0,
    checks_passed: 0,
    checks_failed: 0,
    violations_found: 0,
    violations_resolved: 0,
    scope_violations_attempted: 0,
  };
  // ═══ Cross-Workspace Path Guard (FW-REPAIR-09) ═══
  if (relFile) {
    session.files_written.push(relFile);
  } else {
    process.stderr.write(
      `[code-quality-gate] ⚠ Rejected foreign-workspace path from write audit: "${file}" ` +
        `(not within OPENCODE_ROOT: ${OPENCODE_ROOT})\n`,
    );
    // FW-LOG-UNIFY-P2-A2: DUAL-WRITE foreign path rejection
    writeLog("mcp-code-quality-gate", "WARN", {
      event: "foreign_path_rejected", file, OPENCODE_ROOT,
    });
  }
  session.checks_run++;

  const hasFail = Object.values(results.checks).some(
    (c) => c?.pass === false || c?.status === "fail",
  );
  if (hasFail) {
    session.checks_failed++;
    session.violations_found++;
  } else {
    session.checks_passed++;
  }

  const scopeResult = results.checks.scope;
  if (scopeResult && !scopeResult.pass) session.scope_violations_attempted++;

  machine.write_audit_state.current_session = session;

  // Update independent states
  if (results.checks.tsc) {
    machine.type_check_state.last_incremental_check = new Date().toISOString();
    if (results.checks.tsc.pass === false) {
      machine.type_check_state.incremental_errors++;
      if (relFile) machine.type_check_state.dirty_files.push(relFile);
      machine.type_check_state.status = "dirty";
    }
  }
  if (results.checks.deps) {
    machine.dependency_state.last_check = new Date().toISOString();
    if (results.checks.deps.pass === false) {
      machine.dependency_state.violations.push(
        ...(results.checks.deps.violations || []),
      );
      machine.dependency_state.status = "dirty";
    }
    machine.dependency_state.forbidden_rules_applied++;
  }
  if (results.checks.format) {
    machine.format_state.last_check = new Date().toISOString();
    if (results.checks.format.auto_fixed) machine.format_state.auto_fix_count++;
    if (results.checks.format.pass === false) {
      if (relFile) machine.format_state.unformatted_files.push(relFile);
      machine.format_state.status = "dirty";
    }
  }

  // Record TDD violations from the library result
  if (results.checks.tdd && !results.checks.tdd.pass) {
    if (!machine.tdd_enforcement_state) {
      machine.tdd_enforcement_state = {
        enabled: true,
        current_session: null,
        violations: [],
        history: [],
      };
    }
    machine.tdd_enforcement_state.violations.push({
      timestamp: new Date().toISOString(),
      file: relFile,
      code: "CAT5.2",
      message: results.checks.tdd.detail,
    });
  }

  // Merge TDD state from library back into machine
  if (results.tddState) {
    if (!machine.tdd_enforcement_state) {
      machine.tdd_enforcement_state = {
        enabled: true,
        current_session: null,
        violations: [],
        history: [],
      };
    }
    machine.tdd_enforcement_state.current_session = results.tddState;
  }

  writeMachine(machine);
}

// Record scope violation in compliance_records (stays in server, not library)
function recordScopeViolation(machine, agentType, normFile, denyRule) {
  if (machine.compliance_records) {
    machine.compliance_records.role_violations.push({
      timestamp: new Date().toISOString(),
      agent: agentType,
      violation_file: normFile,
      status: "unresolved",
      severity: "BLOCKER",
      denied_by: denyRule,
    });
    writeMachine(machine);
  }
}

// ─── run_write_check (delegates to library) ────────────────
function runWriteCheck(params) {
// ─── DEPRECATED (CI-UNIFY-004) ────────────────────────────
  // The standalone run_write_check MCP tool is deprecated.
  // All audit logic has been extracted to code-quality-lib.js.
  // Use code-quality-lib.js functions directly for new integrations.
  /**
   * FW-LOG-UNIFY-P2-A2 (2026-06-12): Migrated from process.stderr.write to writeLog.
   */
  writeLog("mcp-code-quality-gate", "WARN", {
    event: "deprecated_run_write_check",
  });
  const { changed_file, agent_type, skip_checks, auto_fix, task_id } = params;
  const projectRoot = getProjectRoot();
  const machine = getMachine() || {};

  // Resolve file path
  let filePath = changed_file;
  if (!path.isAbsolute(filePath))
    filePath = path.resolve(projectRoot, filePath);

  // Build options for the library
  const config = getProjectConfig();
  const libOptions = {
    skip_checks: skip_checks || [],
    auto_fix: auto_fix !== false,
    agentWriteScopes:
      config.agent_write_scopes && config.agent_write_scopes[agent_type]
        ? config.agent_write_scopes[agent_type]
        : null,
    backendDir: getBackendDir(),
    frontendDir: getFrontendDir(),
    tddState:
      machine.tdd_enforcement_state &&
      machine.tdd_enforcement_state.current_session
        ? machine.tdd_enforcement_state.current_session
        : null,
  };

  // Run all checks via the library
  const results = lib.runAllChecks(
    filePath,
    projectRoot,
    agent_type,
    task_id,
    libOptions,
  );

  // Record scope violations in machine (persistence is server's job)
  if (results.checks.scope && !results.checks.scope.pass) {
    const normFile =
      stateCanon.makePathRelativeToWorkspace(filePath, OPENCODE_ROOT) ||
      filePath;
    const agentScopes =
      config.agent_write_scopes && config.agent_write_scopes[agent_type];
    const denyRule = "scope";
    recordScopeViolation(machine, agent_type, normFile, denyRule);
  }

  // Persist state updates to machine.json
  updateStates(machine, results, agent_type, task_id, filePath);

  return results;
}

// ─── run_full_scan (delegates to library) ──────────────────
function runFullScan() {
  const projectRoot = getProjectRoot();
  const machine = getMachine() || {};

  const beDir = getBackendDir();
  const feDir = getFrontendDir();

  // Run full scan via library
  const results = lib.runFullScan(projectRoot, beDir, feDir);

  // Update machine state
  machine.type_check_state.last_full_check = new Date().toISOString();
  machine.type_check_state.full_errors = results.tscErrors || 0;
  if (results.tscErrors > 0) machine.type_check_state.status = "dirty";

  // Update dependency state
  const depViolations = results.violations.filter(
    (v) => v.check === "dep_full",
  );
  if (depViolations.length > 0) {
    machine.dependency_state.status = "dirty";
  }

  // Update format state
  const fmtViolations = results.violations.filter(
    (v) => v.check === "format_full",
  );
  if (fmtViolations.length > 0) {
    machine.format_state.status = "dirty";
  }

  writeMachine(machine);

  return results;
}

// ─── MCP Server ───────────────────────────────────────────
const server = new Server(
  { name: "code-quality-gate", version: "3.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run_write_check",
      description:
        "[DEPRECATED] Write-Time audit on a single changed file (Layer A). Checks: Agent Scope, Prettier, dependency-cruiser, ESLint mock-audit, tsc incremental. Use code-quality-lib.js functions directly. See CI-UNIFY-004.",
      inputSchema: {
        type: "object",
        required: ["changed_file", "agent_type"],
        properties: {
          changed_file: {
            type: "string",
            description:
              "Path of the changed file (absolute or project-relative)",
          },
          agent_type: {
            type: "string",
            enum: [
              "@Coder-BE",
              "@Coder-FE",
              "@Architect",
              "@Orchestrator",
              "@Guardian",
              "@Meta-Planner",
            ],
            description: "Agent identity for write scope enforcement",
          },
          skip_checks: {
            type: "array",
            items: {
              type: "string",
              enum: ["scope", "format", "deps", "eslint", "tsc", "tdd"],
            },
            description: "Optional checks to skip",
          },
          auto_fix: {
            type: "boolean",
            description:
              "Auto-fix formatting via prettier --write (default: true)",
          },
          task_id: {
            type: "string",
            description: "Current task ID for audit trail",
          },
        },
      },
    },
    {
      name: "run_full_scan",
      description:
        "Full project scan (Layer B). Runs: tsc full, depcruise full, prettier full. Updates machine.json states.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_audit_status",
      description: "Get current Write-Time audit status for a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID to query" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "run_write_check") {
    if (!args?.changed_file || !args?.agent_type) {
      throw new Error(
        "Missing required parameters: changed_file and agent_type",
      );
    }
    const result = runWriteCheck({
      changed_file: args.changed_file,
      agent_type: args.agent_type,
      skip_checks: args.skip_checks || [],
      auto_fix: args.auto_fix !== false,
      task_id: args.task_id || "unknown",
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.overall === "fail",
    };
  }

  if (name === "run_full_scan") {
    const result = runFullScan();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.overall === "fail",
    };
  }

  if (name === "get_audit_status") {
    const machine = getMachine();
    const state = machine?.write_audit_state || {};
    return {
      content: [{ type: "text", text: JSON.stringify(state, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ─── Start Server (only when run directly) ───────────────
if (require.main === module) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    process.stderr.write(`[code-quality-gate] Fatal error: ${err.message}\n`);
    process.exit(1);
  });
}

// Export internals for testing (delegates to library where possible)
module.exports = {
  getProjectRoot,
  getBackendDir,
  getFrontendDir,
  // Individual checks — wrapped from library for backward compatibility
  checkScope: (filePath, agentType, machine) => {
    const r = lib.runScopeCheck(filePath, null, agentType, null);
    return { ...r, status: r.pass ? 'pass' : 'violation' };
  },
  checkFormat: (filePath, projectRoot, autoFix) => {
    const r = lib.runPrettierCheck(filePath, projectRoot, autoFix);
    return { ...r, status: r.pass ? 'pass' : 'violation' };
  },
  checkDeps: (filePath, projectRoot) => {
    const r = lib.runDepCruiserCheck(filePath, projectRoot);
    return { ...r, status: r.pass ? 'pass' : 'violation' };
  },
  checkESLint: (filePath, projectRoot) => {
    const r = lib.runEslintAudit(filePath, projectRoot);
    return { ...r, status: r.pass ? 'pass' : 'violation' };
  },
  checkTDDOrder: (machine, filePath) => {
    const wsRoot = process.env.OPENCODE_ROOT ? path.resolve(process.env.OPENCODE_ROOT) : path.resolve(__dirname, "..", "..", "..");
    const tddState = machine && machine.tdd_enforcement_state;
    const r = lib.runTddOrderCheck(filePath, wsRoot, tddState);
    return { ...r, status: r.pass ? 'pass' : 'violation' };
  },
  checkTsc: (filePath, projectRoot) => {
    const r = lib.runTscCheck(filePath, projectRoot, null, null);
    return { ...r, status: r.pass ? 'pass' : 'violation' };
  },
  // Orchestrators
  runWriteCheck,
  runFullScan,
  // UC7KS: Docs size validation
  checkDocsSize: () => {
    const docsDir = path.resolve(getProjectRoot(), "docs", "official_docs");
    const maxFileSize = 524288;   // 500KB (UC7-005)
    const maxTotalSize = 52428800; // 50MB
    const violations = [];
    let totalSize = 0;
    try {
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full); }
          else {
            const sz = fs.statSync(full).size;
            totalSize += sz;
            if (sz > maxFileSize) violations.push(`${path.relative(docsDir, full)}: ${(sz/1024).toFixed(1)}KB > 500KB`);
          }
        }
      };
      if (fs.existsSync(docsDir)) walk(docsDir);
    } catch (_) {}
    const pass = violations.length === 0 && totalSize <= maxTotalSize;
    return {
      pass,
      status: pass ? "pass" : "violation",
      violations,
      totalSize,
      totalSizeMB: (totalSize / 1048576).toFixed(1),
      maxTotalMB: 50,
    };
  },
  // Library reference for direct access
  lib,
};
