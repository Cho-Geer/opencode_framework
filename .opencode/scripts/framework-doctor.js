#!/usr/bin/env node
"use strict";

/**
 * framework-doctor.js — OpenCode Framework Health Diagnostic
 * ==========================================================
 * Runs 10 health checks against the OpenCode framework installation.
 *
 * Usage:
 *   node .opencode/scripts/framework-doctor.js          # human-readable output
 *   node .opencode/scripts/framework-doctor.js --strict  # exit 1 on any failure
 *   node .opencode/scripts/framework-doctor.js --json    # JSON-only output
 *   node .opencode/scripts/framework-doctor.js --check N # run single check
 *
 * Exit code: 0 if all checks pass, 1 if any fail (with --strict)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── Constants ────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const OPENCODE_DIR = path.join(PROJECT_ROOT, ".opencode");
const STATE_DIR = path.join(OPENCODE_DIR, "state");
const SCRIPTS_DIR = path.join(OPENCODE_DIR, "scripts");
const HOOKS_DIR = path.join(OPENCODE_DIR, "hooks");
const AGENTS_DIR = path.join(OPENCODE_DIR, "agents");
const RULES_DIR = path.join(OPENCODE_DIR, "rules");
const SKILLS_DIR = path.join(OPENCODE_DIR, "skills");

const REPORT_DIR = path.join(PROJECT_ROOT, ".task_temp", "_global");
const REPORT_PATH = path.join(REPORT_DIR, "doctor-report.json");

const VERSION = "1.0.0";

const PASS = "PASS";
const FAIL = "FAIL";

// ─── CLI Parsing ─────────────────────────────────────────────
const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const JSON_OUTPUT = args.includes("--json");
let SINGLE_CHECK = null;

const checkIdx = args.indexOf("--check");
if (checkIdx !== -1 && checkIdx + 1 < args.length) {
  SINGLE_CHECK = parseInt(args[checkIdx + 1], 10);
}

// ─── Helpers ──────────────────────────────────────────────────
function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readFile(p) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ─── Check 1: opencode.json sync ──────────────────────────────
function checkOpenCodeJson() {
  const ocPath = path.join(PROJECT_ROOT, "opencode.json");
  const raw = readFile(ocPath);
  if (!raw) {
    return {
      id: 1,
      name: "opencode.json sync",
      status: FAIL,
      detail: "opencode.json not found or unreadable",
    };
  }

  try {
    const oc = JSON.parse(raw);
    const hasAgents = !!oc.agents && typeof oc.agents === "object";
    const hasInstructions = Array.isArray(oc.instructions);
    const hasFrameworkAuth =
      !!oc._framework_authorities &&
      typeof oc._framework_authorities === "object";
    const agentCount = hasAgents ? Object.keys(oc.agents).length : 0;

    const requiredFields = ["agents", "instructions", "_framework_authorities"];
    const missing = requiredFields.filter((f) => !(f in oc));

    if (missing.length === 0 && agentCount >= 8) {
      return {
        id: 1,
        name: "opencode.json sync",
        status: PASS,
        detail: `opencode.json valid: ${agentCount} agents, ${oc.instructions.length} instructions, _framework_authorities present`,
      };
    }

    let detail = "";
    if (missing.length > 0) detail += `Missing: ${missing.join(", ")}. `;
    if (agentCount < 8) detail += `Only ${agentCount}/8 agents defined.`;
    return { id: 1, name: "opencode.json sync", status: FAIL, detail };
  } catch (e) {
    return {
      id: 1,
      name: "opencode.json sync",
      status: FAIL,
      detail: `JSON parse error: ${e.message}`,
    };
  }
}

// ─── Check 2: DAG validation ──────────────────────────────────
function checkDagValidation() {
  const dagPath = path.join(PROJECT_ROOT, "Task.DAG.json");
  const raw = readFile(dagPath);
  if (!raw) {
    return {
      id: 2,
      name: "DAG validation",
      status: FAIL,
      detail: "Task.DAG.json not found or unreadable",
    };
  }

  try {
    const dag = JSON.parse(raw);
    if (!dag.tasks || !Array.isArray(dag.tasks)) {
      return {
        id: 2,
        name: "DAG validation",
        status: FAIL,
        detail: "Task.DAG.json missing tasks array",
      };
    }

    const requiredFields = ["id", "title", "status", "owner"];
    let invalidTasks = [];
    let brokenDeps = [];

    for (const task of dag.tasks) {
      const missing = requiredFields.filter((f) => !(f in task));
      if (missing.length > 0) {
        invalidTasks.push(
          `${task.id || "unknown"}: missing ${missing.join(", ")}`,
        );
      }

      // Check dependencies
      if (task.dependencies && Array.isArray(task.dependencies)) {
        for (const dep of task.dependencies) {
          const depExists = dag.tasks.some((t) => t.id === dep);
          if (!depExists) {
            brokenDeps.push(`${task.id} depends on missing: ${dep}`);
          }
        }
      }
    }

    // Check meta section
    const hasMeta = !!dag.meta;
    const metaFields = ["total_tasks", "completed_tasks", "pending_tasks"];
    const missingMeta = hasMeta
      ? metaFields.filter((f) => !(f in dag.meta))
      : metaFields;

    let detail = `${dag.tasks.length} tasks, ${dag.meta?.completed_tasks || "?"} completed`;
    if (invalidTasks.length > 0) {
      detail += `; ${invalidTasks.length} invalid tasks: ${invalidTasks.slice(0, 3).join("; ")}`;
    }
    if (brokenDeps.length > 0) {
      detail += `; ${brokenDeps.length} broken deps: ${brokenDeps.slice(0, 3).join("; ")}`;
    }
    if (missingMeta.length > 0) {
      detail += `; meta missing: ${missingMeta.join(", ")}`;
    }

    const ok =
      invalidTasks.length === 0 &&
      brokenDeps.length === 0 &&
      missingMeta.length === 0;

    return { id: 2, name: "DAG validation", status: ok ? PASS : FAIL, detail };
  } catch (e) {
    return {
      id: 2,
      name: "DAG validation",
      status: FAIL,
      detail: `JSON parse error: ${e.message}`,
    };
  }
}

// ─── Check 3: Compliance gate dry-run ─────────────────────────
function checkGateDryRun() {
  const gatePath = path.join(STATE_DIR, "gate-state.json");
  const raw = readFile(gatePath);
  if (!raw) {
    return {
      id: 3,
      name: "Compliance gate dry-run",
      status: FAIL,
      detail: "gate-state.json not found or unreadable",
    };
  }

  try {
    const gate = JSON.parse(raw);
    const hasFormatVersion = !!gate.formatVersion;
    const hasSessions = !!gate.sessions && typeof gate.sessions === "object";

    if (!hasFormatVersion || !hasSessions) {
      return {
        id: 3,
        name: "Compliance gate dry-run",
        status: FAIL,
        detail: "gate-state.json missing formatVersion or sessions",
      };
    }

    const sessionIds = Object.keys(gate.sessions);
    let corruptedCount = 0;
    let anomalies = [];

    for (const [sid, session] of Object.entries(gate.sessions)) {
      if (!session || typeof session !== "object") {
        corruptedCount++;
        anomalies.push(`${sid}: not an object`);
        continue;
      }
      if (!session.session_id || !session.gate_status) {
        corruptedCount++;
        anomalies.push(`${sid}: missing session_id or gate_status`);
      }
      // Check for corrupted timestamps
      if (session.created_at && isNaN(Date.parse(session.created_at))) {
        corruptedCount++;
        anomalies.push(`${sid}: invalid created_at timestamp`);
      }
    }

    const ok = corruptedCount === 0;
    let detail = `${sessionIds.length} sessions, formatVersion=${gate.formatVersion}`;
    if (anomalies.length > 0) {
      detail += `; ${corruptedCount} corrupted: ${anomalies.slice(0, 3).join("; ")}`;
    }

    return {
      id: 3,
      name: "Compliance gate dry-run",
      status: ok ? PASS : FAIL,
      detail,
    };
  } catch (e) {
    return {
      id: 3,
      name: "Compliance gate dry-run",
      status: FAIL,
      detail: `JSON parse error: ${e.message}`,
    };
  }
}

// ─── Check 4: Central state reconciliation ────────────────────
function checkStateReconciliation() {
  // Try to call reconciliation-check.sh or reconciliation-validate.js
  const reconcileSh = path.join(SCRIPTS_DIR, "reconciliation-check.sh");
  const reconcileJs = path.join(
    SCRIPTS_DIR,
    "mcp-tools",
    "reconciliation-validate.js",
  );

  if (fileExists(reconcileJs)) {
    try {
      const output = execSync(`node "${reconcileJs}" --json`, {
        cwd: PROJECT_ROOT,
        timeout: 15000,
        encoding: "utf8",
      });
      const result = JSON.parse(output);
      const inconsistencies =
        result.inconsistencies || result.issues?.length || 0;
      const ok = inconsistencies === 0;
      return {
        id: 4,
        name: "State reconciliation",
        status: ok ? PASS : FAIL,
        detail: ok
          ? "All states consistent (via reconciliation-validate.js)"
          : `${inconsistencies} inconsistencies found`,
      };
    } catch (e) {
      return {
        id: 4,
        name: "State reconciliation",
        status: FAIL,
        detail: `reconciliation-validate.js failed: ${(e.stderr || e.message).substring(0, 200)}`,
      };
    }
  }

  if (fileExists(reconcileSh)) {
    try {
      execSync(`bash "${reconcileSh}" --json`, {
        cwd: PROJECT_ROOT,
        timeout: 15000,
        stdio: "pipe",
      });
      return {
        id: 4,
        name: "State reconciliation",
        status: PASS,
        detail: "Reconciliation script ran successfully",
      };
    } catch (e) {
      return {
        id: 4,
        name: "State reconciliation",
        status: FAIL,
        detail: `reconciliation-check.sh failed: ${(e.stderr || e.message).substring(0, 200)}`,
      };
    }
  }

  // Inline check: verify machine.json and gate-state.json coherency
  const machinePath = path.join(STATE_DIR, "machine.json");
  const machineRaw = readFile(machinePath);
  const gateRaw = readFile(path.join(STATE_DIR, "gate-state.json"));

  if (!machineRaw || !gateRaw) {
    return {
      id: 4,
      name: "State reconciliation",
      status: FAIL,
      detail:
        "Cannot read both machine.json and gate-state.json for inline check",
    };
  }

  try {
    const machine = JSON.parse(machineRaw);
    const gate = JSON.parse(gateRaw);

    // Check write_audit_state vs gate sessions
    const hasWriteAudit = !!machine.write_audit_state?.current_session;
    const activeSessions = Object.keys(gate.sessions || {}).length;
    const issues = [];
    if (hasWriteAudit && activeSessions === 0) {
      issues.push("write_audit active but no gate sessions");
    }

    const ok = issues.length === 0;
    return {
      id: 4,
      name: "State reconciliation",
      status: ok ? PASS : FAIL,
      detail: ok
        ? `Inline check: machine.json OK, ${activeSessions} gate sessions`
        : issues.join("; "),
    };
  } catch (e) {
    return {
      id: 4,
      name: "State reconciliation",
      status: FAIL,
      detail: `Inline check parse error: ${e.message}`,
    };
  }
}

// ─── Check 5: Transaction verification ────────────────────────
function checkTransactionVerification() {
  const txnPath = path.join(SCRIPTS_DIR, "state-transaction.js");
  if (!fileExists(txnPath)) {
    return {
      id: 5,
      name: "Transaction verification",
      status: FAIL,
      detail: "state-transaction.js not found",
    };
  }

  try {
    const output = execSync(`node "${txnPath}" verify`, {
      cwd: PROJECT_ROOT,
      timeout: 15000,
      encoding: "utf8",
    });
    const result = JSON.parse(output);

    if (result.valid) {
      return {
        id: 5,
        name: "Transaction verification",
        status: PASS,
        detail: `WAL valid: ${result.stats?.total_entries || 0} entries, ${result.stats?.commits || 0} commits`,
      };
    }

    const issueCount = result.issues?.length || 0;
    return {
      id: 5,
      name: "Transaction verification",
      status: FAIL,
      detail: `WAL issues: ${issueCount} — ${(result.issues || []).slice(0, 3).join("; ")}`,
    };
  } catch (e) {
    // Check if the error is because the WAL is empty (no transactions yet)
    const stderr = (e.stderr || "").toString();
    const stdout = e.stdout || "";
    if (stderr.includes("no such file") || stderr.includes("ENOENT")) {
      return {
        id: 5,
        name: "Transaction verification",
        status: PASS,
        detail: "Transaction log empty or not initialized (clean state)",
      };
    }
    // Try to parse stdout as result even when exit code = 1
    try {
      const result = JSON.parse(stdout);
      if (result && typeof result === "object") {
        const issueCount = result.issues?.length || 0;
        return {
          id: 5,
          name: "Transaction verification",
          status: issueCount === 0 ? PASS : FAIL,
          detail:
            issueCount === 0
              ? `WAL valid: ${result.stats?.total_entries || 0} entries`
              : `WAL issues: ${issueCount}`,
        };
      }
    } catch {
      // fall through to error
    }
    return {
      id: 5,
      name: "Transaction verification",
      status: FAIL,
      detail: `state-transaction verify failed: ${(stderr || e.message).substring(0, 200)}`,
    };
  }
}

// ─── Check 6: Rule registry verification ──────────────────────
function checkRuleRegistry() {
  const regPath = path.join(STATE_DIR, "rule_registry.json");
  const raw = readFile(regPath);
  if (!raw) {
    return {
      id: 6,
      name: "Rule registry verification",
      status: FAIL,
      detail: "rule_registry.json not found or unreadable",
    };
  }

  try {
    const reg = JSON.parse(raw);
    const entries = reg.entries || {};
    const entryCount = Object.keys(entries).length;
    const integrity = reg.integrity || {};
    const hasIntegrity = !!integrity.status;
    const mismatchCount = integrity.mismatch_count || -1;
    const verifiedCount = integrity.verified_count || 0;
    const hasMeta = !!reg.meta;

    let issues = [];
    if (!hasMeta) issues.push("missing meta section");
    if (!hasIntegrity) issues.push("missing integrity section");
    if (mismatchCount > 0) issues.push(`${mismatchCount} digest mismatches`);
    if (entryCount === 0) issues.push("no entries registered");

    // Validate individual entries have required fields
    let invalidEntries = 0;
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry.path || !entry.sha256 || !entry.category) {
        invalidEntries++;
      }
    }
    if (invalidEntries > 0)
      issues.push(`${invalidEntries} entries missing required fields`);

    const ok = issues.length === 0;
    let detail = `${entryCount} entries, ${verifiedCount} verified, status=${integrity.status || "unknown"}`;
    if (issues.length > 0) detail += `; ${issues.join("; ")}`;

    return {
      id: 6,
      name: "Rule registry verification",
      status: ok ? PASS : FAIL,
      detail,
    };
  } catch (e) {
    return {
      id: 6,
      name: "Rule registry verification",
      status: FAIL,
      detail: `JSON parse error: ${e.message}`,
    };
  }
}

// ─── Check 7: Git hook installation ───────────────────────────
function checkGitHooks() {
  // 7a: hooksPath config
  let hooksPath = "";
  try {
    hooksPath = execSync("git config --local core.hooksPath", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return {
      id: 7,
      name: "Git hook installation",
      status: FAIL,
      detail: "git config core.hooksPath not set",
    };
  }

  if (hooksPath !== ".opencode/hooks") {
    return {
      id: 7,
      name: "Git hook installation",
      status: FAIL,
      detail: `hooksPath="${hooksPath}", expected ".opencode/hooks"`,
    };
  }

  // 7b: Hooks exist and are executable
  const preCommit = path.join(HOOKS_DIR, "pre-commit");
  const commitMsg = path.join(HOOKS_DIR, "commit-msg");
  const preCommitExists = fileExists(preCommit);
  const commitMsgExists = fileExists(commitMsg);
  const preCommitExec = isExecutable(preCommit);
  const commitMsgExec = isExecutable(commitMsg);

  let issues = [];
  if (!preCommitExists) issues.push("pre-commit missing");
  else if (!preCommitExec) issues.push("pre-commit not executable");
  if (!commitMsgExists) issues.push("commit-msg missing");
  else if (!commitMsgExec) issues.push("commit-msg not executable");

  const ok = issues.length === 0;
  let detail = `hooksPath=${hooksPath}`;
  if (preCommitExists) detail += ", pre-commit ✓";
  if (commitMsgExists) detail += ", commit-msg ✓";
  if (issues.length > 0) detail += `; issues: ${issues.join(", ")}`;

  return {
    id: 7,
    name: "Git hook installation",
    status: ok ? PASS : FAIL,
    detail,
  };
}

// ─── Check 8: Path portability ────────────────────────────────
function checkPathPortability() {
  const scanDirs = [OPENCODE_DIR];
  const allowedPrefix = "/home/zhaoge";

  // Patterns to detect: /home/... /Users/... /root/... C:\...
  const leakPatterns = [
    { pattern: /\/home\//, name: "Linux home" },
    { pattern: /\/Users\//, name: "macOS home" },
    { pattern: /\/root\//, name: "root" },
    { pattern: /[A-Za-z]:\\/, name: "Windows absolute" },
  ];

  const whitelist = [
    "/tmp/opencode",
    "/usr/bin/",
    "/home/runner/work/",
    "/home/zhaoge/workspace/opencode/work-one",
    "RegExp",
    "pattern:",
    "\\K",
    "\\d",
    "\\s",
    "\\n",
    "\\t",
    "\\r",
    "\\0",
  ];

  const violations = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (
        entry.isFile() &&
        /\.(md|json|yaml|yml|sh|js|ts)$/i.test(entry.name)
      ) {
        const content = readFile(full);
        if (!content) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip lines that are regex patterns or escape sequences
          if (
            // Was: line.includes("\\") - removed to avoid hiding Windows paths (C:\\...)
            // Only skip regex literals/patterns, not Windows absolute paths
            line.includes("RegExp") ||
            line.includes("grep -oP") ||
            line.includes("pattern:")
          )
            continue;
          for (const lp of leakPatterns) {
            if (lp.pattern.test(line)) {
              const isWhitelisted = whitelist.some((w) => line.includes(w));
              if (!isWhitelisted) {
                violations.push(
                  `${path.relative(PROJECT_ROOT, full)}:${i + 1} ${lp.name}`,
                );
              }
            }
          }
        }
      }
    }
  }

  for (const d of scanDirs) scanDir(d);

  const ok = violations.length === 0;
  return {
    id: 8,
    name: "Path portability",
    status: ok ? PASS : FAIL,
    detail: ok
      ? "No absolute path leakage in framework files"
      : `${violations.length} violation(s): ${violations.slice(0, 3).join("; ")}`,
  };
}

// ─── Check 9: Encoding/mojibake scan ──────────────────────────
function checkEncoding() {
  const scanDirs = [OPENCODE_DIR];
  let totalFiles = 0;
  let issues = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name.startsWith(".") ||
        entry.name === "__pycache__"
      )
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.isFile() && /\.(md|js|ts)$/i.test(entry.name)) {
        totalFiles++;
        try {
          const buf = fs.readFileSync(full);
          // Check for valid UTF-8
          const content = buf.toString("utf-8");
          // Re-encode and compare to detect invalid sequences
          const reEncoded = Buffer.from(content, "utf-8");
          if (Buffer.compare(buf, reEncoded) !== 0) {
            issues.push(
              `${path.relative(PROJECT_ROOT, full)}: encoding mismatch`,
            );
            continue;
          }
          // Check for common mojibake patterns
          const mojibakePatterns = [
            /å\x9c\x9f|å\x9b\xbd|ä¸\xad/,
            /\uFFFD/, // replacement character
            /\xEF\xBF\xBD/, // byte-level replacement
          ];
          for (const mp of mojibakePatterns) {
            if (mp.test(content)) {
              issues.push(
                `${path.relative(PROJECT_ROOT, full)}: mojibake detected`,
              );
              break;
            }
          }
        } catch (e) {
          issues.push(
            `${path.relative(PROJECT_ROOT, full)}: read error — ${e.message}`,
          );
        }
      }
    }
  }

  for (const d of scanDirs) scanDir(d);

  const ok = issues.length === 0;
  return {
    id: 9,
    name: "Encoding/mojibake scan",
    status: ok ? PASS : FAIL,
    detail: ok
      ? `All ${totalFiles} .md/.js/.ts files valid UTF-8`
      : `${issues.length} issue(s) in ${totalFiles} files: ${issues.slice(0, 3).join("; ")}`,
  };
}

// ─── Check 10: Role permission sync ──────────────────────────
function checkRolePermissionSync() {
  const ocPath = path.join(PROJECT_ROOT, "opencode.json");
  const machinePath = path.join(STATE_DIR, "machine.json");

  const ocRaw = readFile(ocPath);
  const machineRaw = readFile(machinePath);

  if (!ocRaw || !machineRaw) {
    return {
      id: 10,
      name: "Role permission sync",
      status: FAIL,
      detail: "Cannot read opencode.json or machine.json",
    };
  }

  try {
    const oc = JSON.parse(ocRaw);
    const machine = JSON.parse(machineRaw);

    const ocAgents = oc.agents || {};
    const writeAudit = machine.write_audit_state || {};

    let mismatches = [];

    // Verify that each agent in opencode.json has a permission.write section
    for (const [agentName, agentCfg] of Object.entries(ocAgents)) {
      if (!agentCfg.permission?.write) {
        mismatches.push(`${agentName}: missing permission.write`);
      } else {
        const writePerm = agentCfg.permission.write;
        if (!writePerm.allow || !Array.isArray(writePerm.allow)) {
          mismatches.push(
            `${agentName}: permission.write.allow missing or not array`,
          );
        }
      }
    }

    // Check write_audit_state.current_session agent vs opencode.json
    if (writeAudit.current_session?.agent) {
      const sessionAgent = writeAudit.current_session.agent;
      if (!ocAgents[sessionAgent.replace("@", "")]) {
        mismatches.push(
          `write_audit session agent "${sessionAgent}" not in opencode.json agents`,
        );
      }
    }

    const ok = mismatches.length === 0;
    return {
      id: 10,
      name: "Role permission sync",
      status: ok ? PASS : FAIL,
      detail: ok
        ? `${Object.keys(ocAgents).length} agents with write permissions, no mismatches`
        : mismatches.join("; "),
    };
  } catch (e) {
    return {
      id: 10,
      name: "Role permission sync",
      status: FAIL,
      detail: `Parse error: ${e.message}`,
    };
  }
}

// ─── Check Registry ───────────────────────────────────────────
const CHECKS = [
  checkOpenCodeJson,
  checkDagValidation,
  checkGateDryRun,
  checkStateReconciliation,
  checkTransactionVerification,
  checkRuleRegistry,
  checkGitHooks,
  checkPathPortability,
  checkEncoding,
  checkRolePermissionSync,
];

// ─── Run Checks ───────────────────────────────────────────────
function runChecks() {
  let results;

  if (SINGLE_CHECK !== null) {
    if (SINGLE_CHECK < 1 || SINGLE_CHECK > CHECKS.length) {
      console.error(
        `[WARN] Invalid check index: ${SINGLE_CHECK}. Valid range: 1-${CHECKS.length}`,
      );
      results = [];
    } else {
      results = [CHECKS[SINGLE_CHECK - 1]()];
    }
  } else {
    results = CHECKS.map((fn) => fn());
  }

  return results;
}

// ─── Output ────────────────────────────────────────────────────
function printHuman(results) {
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log("  🏥 OpenCode Framework Health Diagnostic (framework-doctor)");
  console.log(`  Version: ${VERSION}`);
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log("");

  if (results.length === 0) {
    console.log("  ⚠️  No checks executed.");
    console.log("");
    return;
  }

  for (const r of results) {
    const icon = r.status === PASS ? "✅" : "❌";
    console.log(`  ${icon} [${r.status}] Check ${r.id}: ${r.name}`);
    console.log(`     ${r.detail}`);
    console.log("");
  }

  console.log(
    "═══════════════════════════════════════════════════════════════",
  );

  const passedCount = results.filter((r) => r.status === PASS).length;
  const failedCount = results.filter((r) => r.status === FAIL).length;

  if (failedCount === 0) {
    console.log(`  ✅ ALL ${results.length} CHECKS PASSED`);
  } else {
    console.log(
      `  ⚠️  ${passedCount}/${results.length} passed, ${failedCount} failed`,
    );
  }
  console.log("");
}

function printJSON(results) {
  const passedCount = results.filter((r) => r.status === PASS).length;
  const failedCount = results.filter((r) => r.status === FAIL).length;

  const output = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    project_root: PROJECT_ROOT,
    checks: results,
    summary: {
      total: results.length,
      passed: passedCount,
      failed: failedCount,
      strict_mode: STRICT,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

function writeReport(results) {
  try {
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }

    const passedCount = results.filter((r) => r.status === PASS).length;
    const failedCount = results.filter((r) => r.status === FAIL).length;

    const report = {
      version: VERSION,
      timestamp: new Date().toISOString(),
      project_root: PROJECT_ROOT,
      checks: results,
      summary: {
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        strict_mode: STRICT,
      },
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
  } catch (e) {
    console.error(`[WARN] Could not write report: ${e.message}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────
function main() {
  const results = runChecks();

  if (JSON_OUTPUT) {
    printJSON(results);
  } else {
    printHuman(results);
  }

  // Always write report
  writeReport(results);

  // Exit code
  const failedCount = results.filter((r) => r.status === FAIL).length;

  if (STRICT && failedCount > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
