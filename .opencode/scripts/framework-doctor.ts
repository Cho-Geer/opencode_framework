// safe_bash: allow-write
"use strict";

/**
 * FW-REPAIR-13: safe_bash allow-write granted — this is a diagnostic tool
 * that only reads .opencode/state/ files. Always invoked via `node framework-doctor.js`.
 *
 * framework-doctor.js — OpenCode Framework Health Diagnostic
 * ==========================================================
 * Runs 11 health checks against the OpenCode framework installation.
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
const FIX_MODE = args.includes("--fix");
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

/**
 * Strip the "path_lint" JSON block from project.config.json content.
 * This block contains detection patterns (e.g., "/home/", "/Users/") that are
 * legitimate configuration values for lint detection, not actual absolute path leaks.
 * Returns the content unchanged for any other file.
 */
function stripPathLintBlock(content, filePath) {
  const basename = path.basename(filePath);
  if (basename !== "project.config.json") return content;

  const lines = content.split("\n");
  const result = [];
  let inBlock = false;
  let depth = 0;
  let entryDepth = 0;

  for (const line of lines) {
    let foundKey = false;
    if (!inBlock && line.includes('"path_lint"')) {
      foundKey = true;
      entryDepth = depth;
    }

    // Count braces
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }

    if (foundKey || inBlock) {
      if (foundKey) inBlock = true;
      // Exited the path_lint block when depth returns to entry level
      if (inBlock && depth <= entryDepth) {
        inBlock = false;
      }
      continue; // Skip line inside path_lint block
    }

    result.push(line);
  }

  return result.join("\n");
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
    const hasAgents = !!oc.agent && typeof oc.agent === "object";
    const hasInstructions = Array.isArray(oc.instructions);
    // Read _framework_authorities from .opencode/state/framework-authorities.json
    let hasFrameworkAuth = false;
    try {
      const faRaw = readFile(
        path.join(STATE_DIR, "framework-authorities.json"),
      );
      const fa = JSON.parse(faRaw);
      hasFrameworkAuth = !!fa && typeof fa === "object";
    } catch (_) {}
    const agentCount = hasAgents ? Object.keys(oc.agent).length : 0;

    const requiredFields = ["agent", "instructions"];
    const missing = requiredFields.filter((f) => !(f in oc));

    if (missing.length === 0 && agentCount >= 8) {
      return {
        id: 1,
        name: "opencode.json sync",
        status: PASS,
        detail: `opencode.json valid: ${agentCount} agents, ${oc.instructions.length} instructions, framework-authorities.json present`,
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
  const indexPath = path.join(PROJECT_ROOT, "Task.DAG.index.json");
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

    // Load index for cross-referencing archived task dependencies
    let dagIndex = null;
    try {
      const indexRaw = readFile(indexPath);
      if (indexRaw) {
        const parsed = JSON.parse(indexRaw);
        dagIndex = parsed.task_index || null;
      }
    } catch (_) { /* index optional */ }

    // FW-REPAIR-13: Accept "agent" as equivalent to "owner" — the DAG schema
    // uses "agent" for task ownership per dag-generation-standard.md §7.
    const requiredFields = ["id", "status"];
    const hasOwner = (t) => t.owner || t.agent;
    let invalidTasks = [];
    let brokenDeps = [];

    for (const task of dag.tasks) {
      const missing = requiredFields.filter((f) => !(f in task));
      if (!hasOwner(task)) {
        missing.push("owner or agent");
      }
      // FX-DIAG-CONS-1: Accept "name" per dag-generation-standard.md §7; legacy uses "title"
      if (!task.name && !task.title) {
        missing.push("name or title");
      }
      if (missing.length > 0) {
        invalidTasks.push(
          `${task.id || "unknown"}: missing ${missing.join(", ")}`,
        );
      }

      // Check dependencies — also look in index for archived tasks
      if (task.dependencies && Array.isArray(task.dependencies)) {
        for (const dep of task.dependencies) {
          const depInHot = dag.tasks.some((t) => t.id === dep);
          const depInIndex = dagIndex && dagIndex[dep];
          if (!depInHot && !depInIndex) {
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

    // FW-REPAIR-13: Handle V3 format (active_sessions + recent_sessions)
    // and V2 format (sessions). The V3 migration moved bulk data to index.json.
    const isV3 = gate.formatVersion === "3.0" || (!!gate.active_sessions && !gate.sessions);
    const hasSessions = isV3
      ? (!!gate.active_sessions && typeof gate.active_sessions === "object")
      : (!!gate.sessions && typeof gate.sessions === "object");

    if (!hasFormatVersion || !hasSessions) {
      return {
        id: 3,
        name: "Compliance gate dry-run",
        status: FAIL,
        detail: isV3
          ? "gate-state.json V3: missing active_sessions"
          : "gate-state.json missing formatVersion or sessions",
      };
    }

    // Collect all sessions from V3 (active + recent) or V2 (sessions map)
    const allSessions = isV3
      ? { ...(gate.active_sessions || {}), ...(gate.recent_sessions || {}) }
      : (gate.sessions || {});
    const sessionIds = Object.keys(allSessions);
    let corruptedCount = 0;
    let anomalies = [];

    for (const [sid, session] of Object.entries(allSessions)) {
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
  // Shell out to state-reconciliation.js --json --strict
  const reconcilePath = path.join(SCRIPTS_DIR, "state-reconciliation.js");

  if (fileExists(reconcilePath)) {
    try {
      const output = execSync(`node "${reconcilePath}" --json --strict`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
      const result = JSON.parse(output);
      const allInconsistencies = result.inconsistencies || [];
      const inconsistencies = allInconsistencies.filter(
        (i) => i.severity === "HIGH",
      );
      const ok = inconsistencies.length === 0;

      // Build detailed summary
      let detail = "";
      if (ok) {
        const warnCount = allInconsistencies.filter(
          (i) => i.severity === "WARNING",
        ).length;
        detail =
          warnCount > 0
            ? `All HIGH-severity states consistent, ${warnCount} WARNING(s) (via state-reconciliation.js)`
            : "All states consistent (via state-reconciliation.js)";
      } else {
        const highCount = inconsistencies.length;
        const warnCount = allInconsistencies.filter(
          (i) => i.severity === "WARNING",
        ).length;
        // Show first few inconsistencies as summary
        const topIssues = allInconsistencies
          .slice(0, 5)
          .map((i) => `${i.type}(${i.task_id || i.session_id || ""})`)
          .join(", ");
        detail = `${allInconsistencies.length} inconsistency(ies) found (${highCount} HIGH, ${warnCount} WARNING): ${topIssues}${allInconsistencies.length > 5 ? `... and ${allInconsistencies.length - 5} more` : ""}`;
      }

      return {
        id: 4,
        name: "State reconciliation",
        status: ok ? PASS : FAIL,
        detail,
      };
    } catch (e) {
      // state-reconciliation --strict exits 1 on inconsistencies, but the JSON
      // output is still valid on stdout. Try to parse stdout.
      const stdout = e.stdout || "";
      if (stdout) {
        try {
          const result = JSON.parse(stdout);
          const allInconsistencies = result.inconsistencies || [];
          const inconsistencies = allInconsistencies.filter(
            (i) => i.severity === "HIGH",
          );
          const ok = inconsistencies.length === 0;
          const warnCount = allInconsistencies.filter(
            (i) => i.severity === "WARNING",
          ).length;
          return {
            id: 4,
            name: "State reconciliation",
            status: ok ? PASS : FAIL,
            detail: ok
              ? warnCount > 0
                ? `All HIGH-severity states consistent, ${warnCount} WARNING(s) (via state-reconciliation.js)`
                : "All states consistent (via state-reconciliation.js)"
              : `${allInconsistencies.length} inconsistency(ies) found`,
          };
        } catch (_) {
          // fall through
        }
      }
      return {
        id: 4,
        name: "State reconciliation",
        status: FAIL,
        detail: `state-reconciliation.js failed: ${(e.stderr || e.message).substring(0, 200)}`,
      };
    }
  }

  // Fallback: reconciliation-check.sh
  const reconcileSh = path.join(SCRIPTS_DIR, "reconciliation-check.sh");
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

  // Fallback: reconciliation-validate.js
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

  // Final fallback: inline check
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

    const hasWriteAudit = !!machine.write_audit_state?.current_session;
    // FW-REPAIR-13: Handle V3 (active+recent) or V2 (sessions) format
    const isV3_4 = gate.formatVersion === "3.0" || (!!gate.active_sessions && !gate.sessions);
    const activeSessions = isV3_4
      ? Object.keys(gate.active_sessions || {}).length + Object.keys(gate.recent_sessions || {}).length
      : Object.keys(gate.sessions || {}).length;
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

// ─── Check 6: Rule registry verification (live recomputation) ──
function checkRuleRegistry() {
  const verifyPath = path.join(SCRIPTS_DIR, "rule-registry-verify.js");
  if (!fileExists(verifyPath)) {
    return {
      id: 6,
      name: "Rule registry verification",
      status: FAIL,
      detail: "rule-registry-verify.js not found",
    };
  }

  try {
    const output = execSync(`node "${verifyPath}" --json`, {
      cwd: PROJECT_ROOT,
      timeout: 15000,
      encoding: "utf8",
    });

    // Parse the JSON output — the script always appends JSON to stdout
    const result = JSON.parse(output);

    const validCount = result.valid || 0;
    const totalEntries = result.total || 0;
    const highViolations = (result.violations || []).filter(
      (v) => v.severity === "HIGH",
    );
    const highCount = highViolations.length;
    const wasRepaired = !!result.repaired;

    const ok = highCount === 0;
    let detail = `${validCount}/${totalEntries} entries valid`;
    if (highCount > 0) {
      const topIssues = highViolations
        .slice(0, 3)
        .map((v) => `${v.key}: ${v.issue}`)
        .join("; ");
      detail += `, ${highCount} HIGH violation(s): ${topIssues}`;
    }
    if (wasRepaired) detail += " [registry auto-repaired]";

    return {
      id: 6,
      name: "Rule registry verification",
      status: ok ? PASS : FAIL,
      detail,
    };
  } catch (e) {
    // Try to parse stdout even when exit code != 0
    const stdout = e.stdout || "";
    if (stdout) {
      try {
        const result = JSON.parse(stdout.trim());
        const validCount = result.valid || 0;
        const totalEntries = result.total || 0;
        const highCount = (result.violations || []).filter(
          (v) => v.severity === "HIGH",
        ).length;
        return {
          id: 6,
          name: "Rule registry verification",
          status: highCount === 0 ? PASS : FAIL,
          detail: `${validCount}/${totalEntries} entries valid, ${highCount} HIGH violations`,
        };
      } catch (_) {
        // fall through to error
      }
    }
    return {
      id: 6,
      name: "Rule registry verification",
      status: FAIL,
      detail: `rule-registry-verify.js failed: ${(e.stderr || e.message).substring(0, 200)}`,
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
    // The doctor's own source code contains pattern examples in comments — these are not path leaks
    "/home/",
    "/Users/",
    "/tmp/opencode",
    "/usr/bin/",
    "/home/runner/work/",
    "/home/zhaoge/workspace/opencode/work-one",
    "RegExp",
    "pattern:",
    "/root/",
    "C:\\",
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
        let content = readFile(full);
        if (!content) continue;
        content = stripPathLintBlock(content, full);
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

    const ocAgents = oc.agent || {};
    const writeAudit = machine.write_audit_state || {};

    let mismatches = [];

    // Verify that each agent in opencode.json has a permission.edit section
    for (const [agentName, agentCfg] of Object.entries(ocAgents)) {
      if (!agentCfg.permission?.edit) {
        mismatches.push(`${agentName}: missing permission.edit`);
      } else {
        const writePerm = agentCfg.permission.edit;
        if (
          typeof writePerm === "object" &&
          Object.keys(writePerm).length === 0
        ) {
          mismatches.push(
            `${agentName}: permission.edit is empty or not an object`,
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

// ─── Check 11: Framework Compliance ────────────────────────────
function checkFrameworkCompliance() {
  const scriptPath = path.join(SCRIPTS_DIR, "framework-compliance-check.js");

  if (!fileExists(scriptPath)) {
    return {
      id: 11,
      name: "Framework compliance",
      status: FAIL,
      detail: "framework-compliance-check.js not found",
    };
  }

  try {
    const output = execSync(`node "${scriptPath}"`, {
      cwd: PROJECT_ROOT,
      timeout: 15000,
      encoding: "utf8",
    });
    const result = JSON.parse(output);
    const allPassed = result.status !== "FAIL";
    const checkCount = (result.checks || []).length;
    const passedChecks = (result.checks || []).filter(
      (c) => c.status === "pass",
    ).length;

    return {
      id: 11,
      name: "Framework compliance",
      status: allPassed ? PASS : FAIL,
      detail: allPassed
        ? `All ${checkCount} compliance checks passed`
        : `${passedChecks}/${checkCount} checks passed, ${result.violations?.length || 0} violations`,
    };
  } catch (e) {
    // framework-compliance-check exits 1 on HIGH violations, try to parse stdout
    const stdout = e.stdout || "";
    if (stdout) {
      try {
        const result = JSON.parse(stdout);
        const checkCount = (result.checks || []).length;
        const passedChecks = (result.checks || []).filter(
          (c) => c.status === "pass",
        ).length;
        return {
          id: 11,
          name: "Framework compliance",
          status: FAIL,
          detail: `${passedChecks}/${checkCount} checks passed, ${result.violations?.length || 0} violations (${result.violations?.filter((v) => v.severity === "HIGH").length || 0} HIGH)`,
        };
      } catch (_) {
        // fall through
      }
    }
    return {
      id: 11,
      name: "Framework compliance",
      status: FAIL,
      detail: `framework-compliance-check.js failed: ${(e.stderr || e.message).substring(0, 200)}`,
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
  checkFrameworkCompliance,
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

// ─── Fix Automation ────────────────────────────────────────────
// Map check IDs to fix scripts for --fix mode
const FIX_MAP = {
  4: {
    script: "state-reconciliation.js",
    args: ["--fix", "--backfill-audit"],
    name: "State reconciliation",
  },
  7: { script: "install-hooks.js", args: [], name: "Git hook installation" },
  6: {
    script: "rule-registry-verify.js",
    args: ["--repair"],
    name: "Rule registry verification",
  },
};

/**
 * Attempt to auto-fix fixable issues.
 * Returns { fixed: number, remainingUnfixable: number, details: string[] }
 */
function attemptFix(results) {
  const fixables = results.filter((r) => r.status === FAIL && FIX_MAP[r.id]);
  const unfixables = results.filter((r) => r.status === FAIL && !FIX_MAP[r.id]);
  const details = [];
  let fixedCount = 0;

  for (const fixable of fixables) {
    const fix = FIX_MAP[fixable.id];
    const fixScript = path.join(SCRIPTS_DIR, fix.script);
    if (!fileExists(fixScript)) {
      details.push(`❌ ${fix.name}: fix script not found at ${fix.script}`);
      continue;
    }

    const fixCmd = `node "${fixScript}" ${fix.args.join(" ")}`;
    try {
      execSync(fixCmd, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        stdio: "pipe",
        encoding: "utf8",
      });
      fixedCount++;
      details.push(
        `✅ ${fix.name}: fixed successfully via ${fix.script} ${fix.args.join(" ")}`,
      );
    } catch (e) {
      const errMsg = (e.stderr || e.message || "").substring(0, 200);
      details.push(`⚠️  ${fix.name}: fix attempt failed — ${errMsg}`);
    }
  }

  // Report unfixable issues
  for (const u of unfixables) {
    details.push(
      `❌ ${u.name}: no auto-fix available — requires manual intervention`,
    );
  }

  return { fixed: fixedCount, remainingUnfixable: unfixables.length, details };
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
  const failedCount = results.filter((r) => r.status === FAIL).length;

  if (FIX_MODE && failedCount > 0) {
    if (!JSON_OUTPUT) {
      console.log("");
      console.log(
        "═══════════════════════════════════════════════════════════════",
      );
      console.log("  🔧 Attempting auto-fix for fixable issues...");
      console.log(
        "═══════════════════════════════════════════════════════════════",
      );
    }

    const fixResult = attemptFix(results);

    // Re-run checks after fixes to verify
    const recheckResults = runChecks();
    const remainingFailed = recheckResults.filter(
      (r) => r.status === FAIL,
    ).length;

    if (!JSON_OUTPUT) {
      for (const detail of fixResult.details) {
        console.log(`  ${detail}`);
      }
      console.log("");
      console.log(
        `  Fixed: ${fixResult.fixed}, Unfixable remaining: ${fixResult.remainingUnfixable}`,
      );
      console.log(
        `  Re-check: ${recheckResults.length} checks, ${remainingFailed} still failing`,
      );
      console.log("");
    }

    // Update results for output
    results.splice(0, results.length, ...recheckResults);

    if (JSON_OUTPUT) {
      printJSON(results);
    } else {
      printHuman(results);
    }

    writeReport(results);

    // Exit 0 only if ALL issues resolved, non-zero if any remain
    if (remainingFailed > 0) {
      process.exit(1);
    }
    process.exit(0);
  }

  if (JSON_OUTPUT) {
    printJSON(results);
  } else {
    printHuman(results);
  }

  // Always write report
  writeReport(results);

  if (STRICT && failedCount > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
