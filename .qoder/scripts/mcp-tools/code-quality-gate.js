#!/usr/bin/env node
"use strict";

/**
 * code-quality-gate.js — MCP Tool
 * ================================
 * OpenCode v3.0 Write-Time Audit Engine
 *
 * Exposes tool `run_write_check` that runs 5 checks on a changed file:
 *   1. Agent Write Scope  (<0.1s, BLOCKER)
 *   2. Prettier Format    (<0.5s, auto-fix)
 *   3. dependency-cruiser (<1s,   ERROR)
 *   4. ESLint mock-audit  (<1s,   TIER1 BLOCKER)
 *   5. tsc incremental    (2-5s,  BLOCKER)
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
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── State Transaction Engine (RVW-REVIEW-01) ─────────────────────
const { beginTransaction, initializeTransactionSystem } = require("../state-transaction");

// ─── Workspace-Root Canonicalization (RVW-REVIEW-02) ─────────
const stateCanon = require("../state-canonicalize");
let _cqTxnInitialized = false;
function ensureCqTxnInit() {
  if (!_cqTxnInitialized) { initializeTransactionSystem(); _cqTxnInitialized = true; }
}

// ─── Constants ────────────────────────────────────────────
const OPENCODE_ROOT = path.resolve(process.env.OPENCODE_ROOT || process.cwd());
const PROJECT_CONFIG_PATH = path.join(OPENCODE_ROOT, ".qoder", "project.config.json");

function getProjectRoot() {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG_PATH, "utf-8")); } catch (readErr) {
    throw new Error(`[code-quality-gate] Cannot read or parse project.config.json at ${PROJECT_CONFIG_PATH}: ${readErr.message}`);
  }
  if (!cfg.project_root) {
    throw new Error(`[code-quality-gate] 'project_root' is not defined in project.config.json (${PROJECT_CONFIG_PATH}). Add "project_root": "<subdirectory>" to the config file.`);
  }
  return path.resolve(OPENCODE_ROOT, cfg.project_root);
}

function ensureStateDir(stateDir) { if (!fs.existsSync(stateDir)) { fs.mkdirSync(stateDir, { recursive: true }); } }

function getStatePath() {
  const pr = getProjectRoot();
  const stateDir = path.join(pr, ".qoder", "state");
  ensureStateDir(stateDir);
  return path.join(stateDir, "machine.json");
}

function getProjectConfig() { return JSON.parse(fs.readFileSync(PROJECT_CONFIG_PATH, "utf-8")); }

function firstPathSegment(relativePath) {
  return relativePath.replace(/\\/g, "/").split("/").filter(Boolean)[0] || relativePath;
}

function getBackendDir() {
  const cfg = getProjectConfig();
  if (!cfg.paths || !cfg.paths.backend_src) {
    throw new Error("[code-quality-gate] 'paths.backend_src' is not defined in project.config.json. " + 'Add "paths": { "backend_src": "<relative_path>" } to the config file.');
  }
  return path.resolve(getProjectRoot(), firstPathSegment(cfg.paths.backend_src));
}

function getFrontendDir() {
  const cfg = getProjectConfig();
  if (!cfg.paths || !cfg.paths.frontend_src) {
    throw new Error("[code-quality-gate] 'paths.frontend_src' is not defined in project.config.json. " + 'Add "paths": { "frontend_src": "<relative_path>" } to the config file.');
  }
  return path.resolve(getProjectRoot(), firstPathSegment(cfg.paths.frontend_src));
}

function getDefaultMachine() {
  return {
    meta: { version: "1.0.0", createdAt: new Date().toISOString(), lastUpdated: null, project: "unknown", framework: "opencode-v3" },
    eslint_state: { last_full_scan: null, modules: {}, aggregate: { total_violations: 0, dirty_modules: [], waived_modules: [] } },
    type_check_state: { last_full_check: null, last_incremental_check: null, full_errors: 0, incremental_errors: 0, dirty_files: [], status: "clean" },
    dependency_state: { last_check: null, violations: [], forbidden_rules_applied: 0, status: "clean" },
    format_state: { last_check: null, unformatted_files: [], auto_fix_count: 0, status: "clean" },
    write_audit_state: { enabled: true, current_session: null, history: [] },
    compliance_records: { role_violations: [], gate_violations: [], tdd_violations: [] },
    tdd_enforcement_state: { enabled: true, current_session: null, violations: [], history: [] },
    contracts: ["contract.yaml"],
    keystone_hashes: {},
    transaction_state: { last_operation_id: null, last_transaction_at: null, pending_operations: [], transaction_log_path: ".qoder/state/.transaction-log" },
  };
}

function getMachine() {
  try {
    const raw = JSON.parse(fs.readFileSync(getStatePath(), "utf-8"));
    const integrity = stateCanon.validateWorkspaceIntegrity(raw, OPENCODE_ROOT);
    if (integrity.warnings.length > 0) { process.stderr.write(integrity.warnings.join("\n") + "\n"); }
    if (integrity.hasForeignPaths) {
      stateCanon.sanitizePathsInMachine(raw, OPENCODE_ROOT);
      writeMachine(raw);
      process.stderr.write(`[code-quality-gate] ⚠ Cross-workspace paths detected and auto-cleaned. State has been sanitized for current workspace: ${OPENCODE_ROOT}\n`);
    }
    stateCanon.canonicalizePathsInMachine(raw, OPENCODE_ROOT);
    const schemaResult = validateMachineSchema(raw);
    if (schemaResult.warnings.length > 0) { process.stderr.write(schemaResult.warnings.join("\n") + "\n"); }
    if (schemaResult.errors.length > 0) { process.stderr.write(`[code-quality-gate] ⚠ machine.json schema validation errors:\n` + schemaResult.errors.map((e) => `  - ${e}`).join("\n") + "\n"); }
    return raw;
  } catch {
    const defaultMachine = getDefaultMachine();
    const schemaResult = validateMachineSchema(defaultMachine);
    if (schemaResult.warnings.length > 0) { process.stderr.write(schemaResult.warnings.join("\n") + "\n"); }
    if (schemaResult.errors.length > 0) { process.stderr.write(`[code-quality-gate] ⚠ Default machine.json schema validation errors:\n` + schemaResult.errors.map((e) => `  - ${e}`).join("\n") + "\n"); }
    writeMachine(defaultMachine);
    return defaultMachine;
  }
}

function writeMachine(machine) {
  if (!machine.meta) { machine.meta = { version: "1.0.0", createdAt: new Date().toISOString(), lastUpdated: null }; }
  machine.meta.lastUpdated = new Date().toISOString();
  stateCanon.sanitizePathsInMachine(machine, OPENCODE_ROOT);
  stateCanon.canonicalizePathsInMachine(machine, OPENCODE_ROOT);
  const statePath = getStatePath();
  ensureStateDir(path.dirname(statePath));
  const content = JSON.stringify(machine, null, 2) + "\n";
  ensureCqTxnInit();
  const agent = machine.write_audit_state?.current_session?.agent || "@Architect";
  const taskId = machine.write_audit_state?.current_session?.task_id || "unknown";
  try {
    const txn = beginTransaction(statePath, agent, taskId);
    txn.prepare(content);
    txn.commit();
    process.stderr.write(`[code-quality-gate] ✓ txn ${txn.operationId} committed (rev ${txn.newRevision}) → machine.json\n`);
  } catch (txnErr) {
    process.stderr.write(`[code-quality-gate] ⚠ Transaction failed (${txnErr.message}), falling back to direct write\n`);
    fs.writeFileSync(statePath, content, "utf-8");
  }
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }

// ─── Cross-Workspace Protection & Canonicalization (FW-REPAIR-09 + RVW-REVIEW-02) ──
// Path validation, sanitization, and canonicalization functions have been
// extracted to ../state-canonicalize.js for reuse across the framework.
// See: .qoder/scripts/state-canonicalize.js
// Available via: const stateCanon = require("../state-canonicalize");

function validateMachineSchema(machine) {
  const errors = []; const warnings = []; let ajv;
  try { ajv = require("ajv"); } catch {
    warnings.push("[code-quality-gate] AJV not installed — skipping machine.json schema validation. Run: npm install ajv");
    return { valid: true, errors, warnings };
  }
  const schemaPath = path.join(OPENCODE_ROOT, ".qoder", "state", "machine.schema.json");
  if (!fs.existsSync(schemaPath)) { warnings.push(`[code-quality-gate] Schema not found at ${schemaPath} — skipping machine.json schema validation.`); return { valid: true, errors, warnings }; }
  let schema;
  try { schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")); } catch (parseErr) { warnings.push(`[code-quality-gate] Failed to parse machine.schema.json: ${parseErr.message} — skipping validation.`); return { valid: true, errors, warnings }; }
  try {
    const Ajv = ajv.default || ajv;
    const validator = new Ajv({ allErrors: true, strict: false });
    const validate = validator.compile(schema);
    const valid = validate(machine);
    if (!valid && validate.errors) {
      const topErrors = validate.errors.slice(0, 10).map((e) => { const instancePath = e.instancePath || "(root)"; return `${instancePath}: ${e.message}${e.params ? " (" + JSON.stringify(e.params) + ")" : ""}`; });
      errors.push(...topErrors);
      if (validate.errors.length > 10) { errors.push(`... and ${validate.errors.length - 10} more validation errors`); }
    }
    return { valid, errors, warnings };
  } catch (compileErr) { warnings.push(`[code-quality-gate] Schema compilation failed: ${compileErr.message}`); return { valid: true, errors, warnings }; }
}

// ─── Glob Matching ────────────────────────────────────────
function matchGlob(filePath, pattern) {
  const regexStr = "^" + pattern.replace(/\*\*/g, "___DOUBLESTAR___").replace(/\*/g, "[^/]*").replace(/___DOUBLESTAR___/g, ".*") + "$";
  return new RegExp(regexStr).test(filePath);
}

// ─── Check 1: Agent Write Scope ───────────────────────────
function checkScope(changedFile, agentType, machine) {
  const config = getProjectConfig();
  const scopes = config.agent_write_scopes;
  if (!scopes || !scopes[agentType]) { return { status: "error", violation: true, message: `No write scope defined for ${agentType}` }; }
  const scope = scopes[agentType];
  const projectRoot = getProjectRoot();
  let normFile = changedFile;
  if (normFile.startsWith(projectRoot + "/") || normFile.startsWith(projectRoot)) { normFile = normFile.replace(projectRoot, "").replace(/^\//, ""); }
  for (const deny of scope.denied || []) {
    if (matchGlob(normFile, deny)) {
      if (machine.compliance_records) {
        machine.compliance_records.role_violations.push({ timestamp: new Date().toISOString(), agent: agentType, violation_file: normFile, status: "unresolved", severity: "BLOCKER", denied_by: deny });
        writeMachine(machine);
      }
      return { status: "fail", violation: true, severity: "BLOCKER", message: `CAT4.1: ${agentType} DENIED from writing ${normFile}. Scope rule: denied ${deny}.` };
    }
  }
  for (const allow of scope.allowed || []) { if (matchGlob(normFile, allow)) return { status: "pass", violation: false }; }
  return { status: "fail", violation: true, severity: "BLOCKER", message: `CAT4.1: ${agentType} attempted to write ${normFile} — not in allowed scopes.` };
}

// ─── Check 2: Prettier Format ────────────────────────────
function checkFormat(changedFile, projectRoot, autoFix) {
  let filePath = changedFile;
  if (!path.isAbsolute(filePath)) filePath = path.resolve(projectRoot, filePath);
  if (!fs.existsSync(filePath)) return { status: "skip", message: "File not found" };
  const ext = path.extname(filePath);
  if (!/\.(ts|js|html|scss|css|json|ya?ml|md)$/i.test(ext)) return { status: "skip", message: `Non-formattable: ${ext}` };
  try { execSync(`npx prettier --check "${filePath}"`, { cwd: projectRoot, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }); return { status: "pass", formatted: true }; } catch {
    if (autoFix) { try { execSync(`npx prettier --write "${filePath}"`, { cwd: projectRoot, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }); return { status: "pass", formatted: true, auto_fixed: true }; } catch { return { status: "fail", formatted: false, message: "Prettier check failed and auto-fix failed" }; } }
    return { status: "fail", formatted: false, message: "Prettier check failed. Run: npx prettier --write <file>" };
  }
}

// ─── Check 3: dependency-cruiser ─────────────────────────
function checkDeps(changedFile, projectRoot) {
  let filePath = changedFile;
  if (!path.isAbsolute(filePath)) filePath = path.resolve(projectRoot, filePath);
  if (!fs.existsSync(filePath)) return { status: "skip", message: "File not found" };
  try {
    const result = execSync(`npx depcruise --include-only "^${filePath}" --output-type json "${projectRoot}"`, { cwd: projectRoot, encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
    const data = JSON.parse(result);
    if (data.summary?.violations?.length > 0) { return { status: "fail", violations: data.summary.violations, count: data.summary.violations.length }; }
    return { status: "pass", violations: [] };
  } catch (e) {
    try { const data = JSON.parse(e.stdout?.toString() || "{}"); if (data.summary?.violations?.length > 0) { return { status: "fail", violations: data.summary.violations, count: data.summary.violations.length }; } } catch {}
    if (e.message && e.message.includes("Cannot find module")) { return { status: "skip", message: "dependency-cruiser not installed. Run: npm install --save-dev dependency-cruiser" }; }
    return { status: "error", message: e.message?.substring(0, 200) || "Unknown error" };
  }
}

// ─── Check 4: ESLint mock-audit ─────────────────────────
function checkESLint(changedFile, projectRoot) {
  let filePath = changedFile;
  if (!path.isAbsolute(filePath)) filePath = path.resolve(projectRoot, filePath);
  if (!fs.existsSync(filePath)) return { status: "skip", message: "File not found" };
  const isTestFile = filePath.includes(".spec.") || filePath.includes(".test.") || filePath.includes("/test/");
  if (!isTestFile) return { status: "skip", message: "Not a test file" };
  const pluginDir = path.join(OPENCODE_ROOT, ".qoder", "tools", "eslint-plugin-opencode-mock-audit");
  if (!fs.existsSync(pluginDir)) return { status: "skip", message: "ESLint plugin not found" };
  try {
    execSync(`npx eslint --no-eslintrc --rulesdir "${pluginDir}/rules" --rule 'no-tier1-mock: error' --rule 'no-skipped-tests: error' --rule 'no-skipped-audit: error' --rule 'no-console-log: error' --rule 'tier3-verify: warn' --format json "${filePath}"`, { cwd: projectRoot, encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
    return { status: "pass", violations: [], tier1_mock_count: 0 };
  } catch (e) {
    try {
      const results = JSON.parse(e.stdout?.toString() || "[]");
      const violations = results.filter((f) => f.messages?.length > 0).flatMap((f) => f.messages.map((m) => ({ file: f.filePath, line: m.line, rule: m.ruleId, message: m.message, severity: m.severity })));
      const tier1Mocks = violations.filter((v) => v.rule === "no-tier1-mock");
      return { status: violations.length > 0 ? "fail" : "pass", violations, tier1_mock_count: tier1Mocks.length };
    } catch { return { status: "error", message: e.message?.substring(0, 200) || "ESLint error" }; }
  }
}

// ─── Check 6: TDD Order Enforcement ─────────────────────
function checkTDDOrder(machine, changedFile) {
  const fileName = path.basename(changedFile);
  const relFile = stateCanon.makePathRelativeToWorkspace(changedFile, OPENCODE_ROOT);
  if (!relFile) { return { status: "skip", message: `Foreign workspace path rejected: ${fileName}` }; }
  const isTestFile = fileName.includes(".spec.") || fileName.includes(".test.") || relFile.includes("/test/");
  const isImplFile = /\.(ts|js)$/.test(relFile) && !isTestFile && !relFile.includes(".config.");
  const isConfigOrDoc = /\.(json|yaml|yml|md)$/.test(relFile);
  if (!machine.tdd_enforcement_state) {
    machine.tdd_enforcement_state = { enabled: true, current_session: { test_written: false, impl_files_attempted: [], blocked_attempts: [], test_files_written: [] }, violations: [], history: [] };
  }
  const state = machine.tdd_enforcement_state;
  if (isTestFile || isImplFile) {
    if (!state.current_session || !state.current_session.initialized) { state.current_session = { test_written: false, impl_files_attempted: [], blocked_attempts: [], test_files_written: [], initialized: true }; }
  }
  if (isConfigOrDoc || (!isTestFile && !isImplFile)) { return { status: "pass", message: "Skipped (config/doc/non-code)" }; }
  if (isTestFile) { state.current_session.test_written = true; state.current_session.test_files_written.push(relFile); return { status: "pass", message: `Test file recorded: ${fileName}` }; }
  if (isImplFile) {
    if (!state.current_session.test_written) {
      state.current_session.impl_files_attempted.push(relFile);
      state.current_session.blocked_attempts.push({ file: relFile, timestamp: new Date().toISOString() });
      state.violations.push({ timestamp: new Date().toISOString(), file: relFile, code: "CAT5.2", message: `Implementation written without preceding test: ${fileName}` });
      writeMachine(machine);
      return { status: "fail", violation: true, severity: "BLOCKER", code: "CAT5.2", message: `CAT5.2: Implementation file "${fileName}" written without a preceding test file. Write the test first (RED phase), then implement (GREEN phase).` };
    }
    return { status: "pass", message: `Impl file allowed (test already written): ${fileName}` };
  }
}

// ─── Check 5: tsc incremental ────────────────────────────
function checkTsc(changedFile, projectRoot) {
  let filePath = changedFile;
  if (!path.isAbsolute(filePath)) filePath = path.resolve(projectRoot, filePath);
  if (!fs.existsSync(filePath)) return { status: "skip", message: "File not found" };
  if (!filePath.endsWith(".ts")) return { status: "skip", message: "Not a TypeScript file" };
  const beDir = getBackendDir();
  const feDir = getFrontendDir();
  const isBackend = filePath.startsWith(beDir) || filePath.includes(path.basename(beDir));
  const isFrontend = filePath.startsWith(feDir) || filePath.includes(path.basename(feDir));
  if (!isBackend && !isFrontend) return { status: "skip", message: "Not in backend or frontend src" };
  const cwd = isBackend ? beDir : feDir;
  try {
    const start = Date.now();
    execSync("npx tsc --noEmit --incremental --pretty false", { cwd, encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
    return { status: "pass", errors: 0, time_ms: Date.now() - start };
  } catch (e) {
    return { status: "fail", errors: 1, time_ms: Date.now() - (e.elapsed || 0), message: e.stderr?.substring(0, 300) || e.stdout?.substring(0, 300) || "TypeScript error" };
  }
}

// ─── Update machine.json states ──────────────────────────
function updateStates(machine, results, agentType, taskId, file) {
  if (!machine.write_audit_state) machine.write_audit_state = { current_session: null, history: [] };
  const relFile = stateCanon.makePathRelativeToWorkspace(file, OPENCODE_ROOT);
  const session = machine.write_audit_state.current_session || { agent: agentType, task_id: taskId || "unknown", files_written: [], checks_run: 0, checks_passed: 0, checks_failed: 0, violations_found: 0, violations_resolved: 0, scope_violations_attempted: 0 };
  if (relFile) { session.files_written.push(relFile); } else { process.stderr.write(`[code-quality-gate] ⚠ Rejected foreign-workspace path from write audit: "${file}" (not within OPENCODE_ROOT: ${OPENCODE_ROOT})\n`); }
  session.checks_run++;
  const hasFail = Object.values(results.checks).some((c) => c?.status === "fail");
  if (hasFail) { session.checks_failed++; session.violations_found++; } else { session.checks_passed++; }
  if (results.checks.scope?.violation) session.scope_violations_attempted++;
  machine.write_audit_state.current_session = session;
  if (results.checks.tsc) {
    machine.type_check_state.last_incremental_check = new Date().toISOString();
    if (results.checks.tsc.status === "fail") { machine.type_check_state.incremental_errors++; if (relFile) machine.type_check_state.dirty_files.push(relFile); machine.type_check_state.status = "dirty"; }
  }
  if (results.checks.deps) {
    machine.dependency_state.last_check = new Date().toISOString();
    if (results.checks.deps.status === "fail") { machine.dependency_state.violations.push(...(results.checks.deps.violations || [])); machine.dependency_state.status = "dirty"; }
    machine.dependency_state.forbidden_rules_applied++;
  }
  if (results.checks.format) {
    machine.format_state.last_check = new Date().toISOString();
    if (results.checks.format.auto_fixed) machine.format_state.auto_fix_count++;
    if (results.checks.format.status === "fail") { if (relFile) machine.format_state.unformatted_files.push(relFile); machine.format_state.status = "dirty"; }
  }
  writeMachine(machine);
}

// ─── Main: run_write_check ────────────────────────────────
function runWriteCheck(params) {
  const { changed_file, agent_type, skip_checks, auto_fix, task_id } = params;
  const projectRoot = getProjectRoot();
  const machine = getMachine() || {};
  const skip = new Set(skip_checks || []);
  const results = { checks: {}, overall: "pass", violations: [], fixes_applied: [] };
  let filePath = changed_file;
  if (!path.isAbsolute(filePath)) filePath = path.resolve(projectRoot, filePath);
  if (!skip.has("scope")) { const r = checkScope(filePath, agent_type, machine); results.checks.scope = r; if (r.violation) { results.overall = "fail"; results.violations.push({ check: "scope", ...r }); } }
  if (!skip.has("format")) { const r = checkFormat(filePath, projectRoot, auto_fix !== false); results.checks.format = r; if (r.auto_fixed) results.fixes_applied.push({ check: "format", action: "prettier --write" }); if (r.status === "fail") { results.overall = "fail"; results.violations.push({ check: "format", ...r }); } }
  if (!skip.has("deps")) { const r = checkDeps(filePath, projectRoot); results.checks.deps = r; if (r.status === "fail") { results.overall = "fail"; results.violations.push({ check: "deps", ...r }); } }
  if (!skip.has("eslint")) { const r = checkESLint(filePath, projectRoot); results.checks.eslint = r; if (r.tier1_mock_count > 0) { results.overall = "fail"; results.violations.push({ check: "eslint", severity: "BLOCKER", message: `CAT1.1: ${r.tier1_mock_count} Tier1 service mock(s) detected` }); } else if (r.status === "fail") { results.violations.push({ check: "eslint", severity: "ERROR", message: `${r.violations?.length || 0} ESLint violations` }); } }
  if (!skip.has("tsc")) { const r = checkTsc(filePath, projectRoot); results.checks.tsc = r; if (r.status === "fail") { results.overall = "fail"; results.violations.push({ check: "tsc", severity: "BLOCKER", message: r.message }); } }
  if (!skip.has("tdd")) { const r = checkTDDOrder(machine, filePath); results.checks.tdd = r; if (r.violation) { results.overall = "fail"; results.violations.push({ check: "tdd", ...r }); } }
  updateStates(machine, results, agent_type, task_id, filePath);
  return results;
}

// ─── Main: run_full_scan (for compliance_gate_complete) ──
function runFullScan() {
  const projectRoot = getProjectRoot();
  const machine = getMachine() || {};
  const results = { overall: "pass", violations: [] };
  const beCwd = getBackendDir();
  const feCwd = getFrontendDir();
  let tscErrors = 0;
  for (const cwd of [beCwd, feCwd]) {
    try { execSync("npx tsc --noEmit --pretty false", { cwd, encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] }); } catch (e) { tscErrors++; results.overall = "fail"; results.violations.push({ check: "tsc_full", severity: "BLOCKER", message: `TypeScript errors in ${path.basename(cwd)}` }); }
  }
  try { execSync("npx depcruise --config .dependency-cruiser.js --output-type json .", { cwd: projectRoot, encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }); } catch (e) { try { const data = JSON.parse(e.stdout?.toString() || "{}"); const depsViolations = data.summary?.violations?.length || 0; if (depsViolations > 0) { machine.dependency_state.violations = data.summary.violations; machine.dependency_state.status = "dirty"; results.overall = "fail"; results.violations.push({ check: "dep_full", severity: "ERROR", message: `${depsViolations} dependency violations` }); } } catch {} }
  try { execSync('npx prettier --check "src/**/*.{ts,html,scss,css,json}"', { cwd: projectRoot, encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }); } catch { machine.format_state.status = "dirty"; results.overall = "fail"; results.violations.push({ check: "format_full", severity: "ERROR", message: "Some files are not formatted" }); }
  machine.type_check_state.last_full_check = new Date().toISOString();
  machine.type_check_state.full_errors = tscErrors;
  if (tscErrors > 0) machine.type_check_state.status = "dirty";
  writeMachine(machine);
  return results;
}

// ─── MCP Server ───────────────────────────────────────────
const server = new Server({ name: "code-quality-gate", version: "3.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "run_write_check", description: "Write-Time audit on a single changed file (Layer A). Checks: Agent Scope, Prettier, dependency-cruiser, ESLint mock-audit, tsc incremental.", inputSchema: { type: "object", required: ["changed_file", "agent_type"], properties: { changed_file: { type: "string", description: "Path of the changed file (absolute or project-relative)" }, agent_type: { type: "string", enum: ["@Coder-BE", "@Coder-FE", "@Architect", "@Orchestrator", "@Guardian", "@Meta-Planner"], description: "Agent identity for write scope enforcement" }, skip_checks: { type: "array", items: { type: "string", enum: ["scope", "format", "deps", "eslint", "tsc", "tdd"] }, description: "Optional checks to skip" }, auto_fix: { type: "boolean", description: "Auto-fix formatting via prettier --write (default: true)" }, task_id: { type: "string", description: "Current task ID for audit trail" } } } },
    { name: "run_full_scan", description: "Full project scan (Layer B). Runs: tsc full, depcruise full, prettier full. Updates machine.json states.", inputSchema: { type: "object", properties: {} } },
    { name: "get_audit_status", description: "Get current Write-Time audit status for a task.", inputSchema: { type: "object", properties: { task_id: { type: "string", description: "Task ID to query" } } } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "run_write_check") {
    if (!args?.changed_file || !args?.agent_type) { throw new Error("Missing required parameters: changed_file and agent_type"); }
    const result = runWriteCheck({ changed_file: args.changed_file, agent_type: args.agent_type, skip_checks: args.skip_checks || [], auto_fix: args.auto_fix !== false, task_id: args.task_id || "unknown" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: result.overall === "fail" };
  }
  if (name === "run_full_scan") { const result = runFullScan(); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: result.overall === "fail" }; }
  if (name === "get_audit_status") { const machine = getMachine(); const state = machine?.write_audit_state || {}; return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] }; }
  throw new Error(`Unknown tool: ${name}`);
});

// ─── Start Server (only when run directly) ───────────────
if (require.main === module) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => { process.stderr.write(`[code-quality-gate] Fatal error: ${err.message}\n`); process.exit(1); });
}

// Export internals for testing
module.exports = { getProjectRoot, getBackendDir, getFrontendDir, checkScope, checkFormat, checkDeps, checkESLint, checkTDDOrder, checkTsc, runWriteCheck, runFullScan };
