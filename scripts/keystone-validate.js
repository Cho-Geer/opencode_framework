#!/usr/bin/env node
/**
 * keystone-validate.js — Project-Level Keystone Validator
 *
 * Called by:
 *   - .opencode/hooks/pre-commit (--pre-commit)
 *   - .opencode/scripts/mcp-tools/keystone-validate.js (--pre-commit, --audit, --ci)
 *   - project.config.json contract_hash_command (--hash)
 *
 * Modes:
 *   --pre-commit   Validate contract.yaml hash against machine.json.keystone_hashes,
 *                  then run full --bundle integrity chain check.
 *   --bundle       Validate entire keystone_hashes integrity chain
 *                  (contract.yaml + all critical docs) against machine.json.
 *   --hash <file>  Compute and output sha256-<hex> for a single file.
 *   --audit        Same as --bundle (audit mode for MCP tool delegation).
 *   --ci           Fast hash-only check (same as --bundle, ci mode).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MACHINE_PATH = path.join(PROJECT_ROOT, ".opencode", "state", "machine.json");
const REQS_DIR = path.join(PROJECT_ROOT, ".opencode", "context", "requirements");
const RULES_DIR = path.join(PROJECT_ROOT, ".opencode", "rules");
const AGENTS_DIR = path.join(PROJECT_ROOT, ".opencode", "agents");

/** The 6 mandatory requirement docs per AGENTS.md Section 二 */
const CORE_REQUIREMENT_DOCS = [
  "系统架构设计文档（SAD）.md",
  "接口设计规范文档.md",
  "数据架构设计文档.md",
  "安全架构设计文档.md",
  "测试策略与计划.md",
  "运维与部署设计文档.md",
];

// ─────────────────────────────────────────────────────────
// Hash Computation
// ─────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a file's content.
 * For .yaml/.yml files with x-keystone-state-hash header, strips that header line.
 * Returns "sha256-<hex>" or "MISSING" if file not found.
 */
function computeFileHash(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(resolved)) {
    return "MISSING";
  }
  const lines = fs.readFileSync(resolved, "utf8").split("\n");
  // Strip x-keystone-state-hash header if present (for contract.yaml)
  const ext = path.extname(filePath).toLowerCase();
  const isYaml = ext === ".yaml" || ext === ".yml";
  let contentLines = lines;
  if (isYaml && lines.length > 0 && /^#\s*x-keystone-state-hash:/.test(lines[0])) {
    contentLines = lines.slice(1);
  }
  const content = contentLines.join("\n");
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `sha256-${hash}`;
}

// ─────────────────────────────────────────────────────────
// Bundle Integrity Chain — Computes all target hashes
// ─────────────────────────────────────────────────────────

/**
 * Collect all files that should be part of the integrity chain.
 * Returns a Map of relativePath → computedHash.
 */
function buildIntegrityChain() {
  const chain = new Map();

  // 1. contract.yaml
  chain.set("contract.yaml", computeFileHash("contract.yaml"));

  // 2. The 6 core requirement docs
  for (const doc of CORE_REQUIREMENT_DOCS) {
    const relPath = `.opencode/context/requirements/${doc}`;
    chain.set(relPath, computeFileHash(relPath));
  }

  // 3. All .opencode/rules/*.md files
  if (fs.existsSync(RULES_DIR)) {
    const ruleFiles = fs.readdirSync(RULES_DIR).filter(f => f.endsWith(".md"));
    for (const f of ruleFiles.sort()) {
      const relPath = `.opencode/rules/${f}`;
      // Skip rule_detail subdirectory files (validate them separately if needed)
      chain.set(relPath, computeFileHash(relPath));
    }
  }

  // 4. All .opencode/agents/*.md files
  if (fs.existsSync(AGENTS_DIR)) {
    const agentFiles = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md"));
    for (const f of agentFiles.sort()) {
      const relPath = `.opencode/agents/${f}`;
      chain.set(relPath, computeFileHash(relPath));
    }
  }

  // 5. AGENTS.md and PROJECT_REFERENCE.md
  chain.set("AGENTS.md", computeFileHash("AGENTS.md"));
  chain.set("PROJECT_REFERENCE.md", computeFileHash("PROJECT_REFERENCE.md"));

  return chain;
}

// ─────────────────────────────────────────────────────────
// Validation Logic
// ─────────────────────────────────────────────────────────

function readMachineJson() {
  if (!fs.existsSync(MACHINE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(MACHINE_PATH, "utf8"));
  } catch (e) {
    process.stderr.write(`[keystone-validate] Failed to parse machine.json: ${e.message}\n`);
    return null;
  }
}

/**
 * Validate the full integrity chain.
 * Compares current hashes against machine.json.keystone_hashes.
 *
 * @param {boolean} reportOnly - if true, only report (don't block on advisory)
 * @returns {{ passed: boolean, results: Array, summary: string }}
 */
function validateBundle(reportOnly) {
  const machine = readMachineJson();
  if (!machine || !machine.keystone_hashes) {
    return {
      passed: false,
      results: [],
      summary: "No keystone_hashes found in machine.json",
    };
  }

  const storedHashes = machine.keystone_hashes || {};
  const chain = buildIntegrityChain();
  const results = [];

  let passCount = 0;
  let failCount = 0;
  let missingCount = 0;
  let untrackedCount = 0;

  // Check each file in the integrity chain
  for (const [relPath, computedHash] of chain) {
    const storedHash = storedHashes[relPath];
    if (computedHash === "MISSING") {
      results.push({ path: relPath, status: "MISSING", expected: storedHash, actual: "FILE_NOT_FOUND" });
      missingCount++;
    } else if (!storedHash) {
      results.push({ path: relPath, status: "UNTRACKED", expected: "N/A", actual: computedHash });
      untrackedCount++;
    } else if (computedHash !== storedHash) {
      results.push({ path: relPath, status: "MISMATCH", expected: storedHash, actual: computedHash });
      failCount++;
    } else {
      results.push({ path: relPath, status: "OK", expected: storedHash, actual: computedHash });
      passCount++;
    }
  }

  // Check for extraneous entries in keystone_hashes not in chain
  const chainPaths = new Set(chain.keys());
  for (const [relPath, storedHash] of Object.entries(storedHashes)) {
    if (!chainPaths.has(relPath)) {
      results.push({ path: relPath, status: "STALE", expected: storedHash, actual: "NOT_IN_CHAIN" });
      failCount++;
    }
  }

  const total = passCount + failCount + missingCount + untrackedCount;
  const passed = failCount === 0 && missingCount === 0;

  const lines = [];
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  🔐 Keystone Integrity Chain Validation");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push(`  Files checked: ${total}`);
  lines.push(`  ✅ OK:          ${passCount}`);
  if (failCount > 0) lines.push(`  ❌ MISMATCH:    ${failCount}`);
  if (missingCount > 0) lines.push(`  ⚠️  MISSING:     ${missingCount}`);
  if (untrackedCount > 0) lines.push(`  ⚠️  UNTRACKED:   ${untrackedCount}`);
  lines.push("");

  for (const r of results) {
    const icon = r.status === "OK" ? "  ✅" : r.status === "MISMATCH" ? "  ❌" : r.status === "MISSING" ? "  🚫" : r.status === "UNTRACKED" ? "  ⚠️" : "  🔶";
    lines.push(`${icon} ${r.path}`);
    if (r.status === "MISMATCH") {
      lines.push(`     expected: ${r.expected}`);
      lines.push(`     actual:   ${r.actual}`);
    } else if (r.status === "MISSING") {
      lines.push(`     file not found: ${r.path}`);
    } else if (r.status === "UNTRACKED") {
      lines.push(`     not in keystone_hashes — run integrity-chain-bundle.sh to add`);
    }
  }
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");

  const summary = passed
    ? "  ✅ INTEGRITY CHAIN VALID — All hashes match"
    : "  ❌ INTEGRITY CHAIN BROKEN — Fix mismatches and re-run integrity-chain-bundle.sh";

  lines.push(summary);
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  return { passed, results, summary: lines.join("\n") };
}

/**
 * Validate contract.yaml hash only.
 */
function validateContract() {
  const machine = readMachineJson();
  if (!machine || !machine.keystone_hashes) {
    process.stderr.write("[keystone-validate] No keystone_hashes in machine.json\n");
    return { passed: false, detail: "No keystone_hashes in machine.json" };
  }

  const storedHash = machine.keystone_hashes["contract.yaml"];
  const computedHash = computeFileHash("contract.yaml");

  if (!storedHash) {
    process.stderr.write("[keystone-validate] contract.yaml not found in keystone_hashes\n");
    return { passed: false, detail: "contract.yaml not in keystone_hashes" };
  }

  if (computedHash !== storedHash) {
    process.stderr.write(`[keystone-validate] contract.yaml HASH MISMATCH\n`);
    process.stderr.write(`  stored:  ${storedHash}\n`);
    process.stderr.write(`  actual:  ${computedHash}\n`);
    return {
      passed: false,
      detail: `contract.yaml hash mismatch: stored=${storedHash} actual=${computedHash}`,
    };
  }

  return { passed: true, detail: "contract.yaml hash verified" };
}

// ─────────────────────────────────────────────────────────
// CLI Main
// ─────────────────────────────────────────────────────────

function cliMain() {
  const args = process.argv.slice(2);
  const mode = args[0];

  // --hash <file>
  if (mode === "--hash" && args[1]) {
    const hash = computeFileHash(args[1]);
    process.stdout.write(`${hash}\n`);
    process.exit(0);
  }

  // --bundle (full integrity chain validation)
  if (mode === "--bundle") {
    const result = validateBundle(false);
    process.stdout.write(result.summary);
    process.exit(result.passed ? 0 : 1);
  }

  // --ci (fast CI check = bundle)
  if (mode === "--ci") {
    const result = validateBundle(false);
    process.stdout.write(result.summary);
    process.exit(result.passed ? 0 : 1);
  }

  // --audit (audit mode = bundle)
  if (mode === "--audit") {
    const result = validateBundle(false);
    // For audit mode, output JSON for MCP tool consumption
    process.stdout.write(JSON.stringify({
      overall: result.passed ? "PASS" : "FAIL",
      results: result.results,
      detail: result.summary,
    }, null, 2));
    process.exit(result.passed ? 0 : 1);
  }

  // --pre-commit (contract hash + full bundle)
  if (mode === "--pre-commit") {
    // Step 1: Validate contract hash
    const contractResult = validateContract();
    if (!contractResult.passed) {
      process.stderr.write("[keystone-validate] ❌ Contract hash validation failed\n");
      process.exit(1);
    }

    // Step 2: Validate full integrity chain
    const bundleResult = validateBundle(false);
    process.stdout.write(bundleResult.summary);
    process.exit(bundleResult.passed ? 0 : 1);
  }

  // No mode specified
  process.stderr.write("Usage: node keystone-validate.js [--pre-commit|--bundle|--audit|--ci|--hash <file>]\n");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────
// Exports for testing
// ─────────────────────────────────────────────────────────

if (require.main === module) {
  cliMain();
}

module.exports = {
  computeFileHash,
  buildIntegrityChain,
  validateBundle,
  validateContract,
  readMachineJson,
  CORE_REQUIREMENT_DOCS,
};
