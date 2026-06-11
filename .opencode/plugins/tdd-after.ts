// tdd-after.ts — "tool.execute.after" plugin: post-write TDD verification
//
// P3 enhancement per tdd-integration.md §8. After each write/edit/safe_edit
// to a business source file by @Coder-BE/@Coder-FE, this plugin:
//
//   1. Diff the written file against its latest atomic backup (from
//      .opencode_backups/) using generateDiff() from safe-edit-core.ts.
//   2. For test files: verify the write produced *actual* content changes
//      (not just a touch/empty write). If real changes exist, set
//      machine.json.tdd_enforcement_state.current_session.test_written = true
//      and record diff evidence.
//   3. For impl files: record diff evidence in impl_files_attempted for
//      audit trail and downstream Guardian review.
//
// WHY: tdd-before.ts only checks whether a test file exists. tdd-after.ts
// adds defense-in-depth by verifying test files have substantive changes,
// preventing shallow-test circumvention.
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { getModifyPath } from "../lib/tool-scope";
import { isSourceFile, STATE_PATHS } from "../lib/state-utils";
import { generateDiff } from "../lib";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Constants ──

/** TDD enforcement targets only Coder-BE / Coder-FE */
const TDD_AGENTS = new Set(["@Coder-BE", "@Coder-FE", "Coder-BE", "Coder-FE"]);

/** Tool scope: only the 3 content-writing tools (same as tdd-before.ts) */
const TDD_MODIFY_TOOLS = new Set(["write", "edit", "safe_edit"]);

/** Framework paths NEVER subject to TDD enforcement */
const FRAMEWORK_PATH_PREFIXES = [
  ".opencode/",
  "docs/",
  ".task_temp/",
  "node_modules/",
];

/** Root-level framework files NEVER subject to TDD enforcement */
const FRAMEWORK_ROOT_FILES = new Set([
  "opencode.json",
  "AGENTS.md",
  "contract.yaml",
  "Task.DAG.json",
  "TECH_DEBT_REGISTRY.md",
  "WAIVE.md",
  "PROJECT_REFERENCE.md",
  "Project.graph",
]);

/** File patterns to exclude from TDD */
const EXCLUDE_PATTERNS = [
  /\.spec\./,
  /\.test\./,
  /\/test\//,
  /\.config\./,
  /__tests__\//,
];

/** Test file detection: opposite of isImplFile */
const TEST_PATTERNS = [
  /\.spec\./,
  /\.test\./,
  /\/test\//,
  /__tests__\//,
];

// ── Helpers ──

function isFrameworkPath(fp: string): boolean {
  const normalized = fp.replace(/\\/g, "/");
  if (FRAMEWORK_ROOT_FILES.has(normalized)) return true;
  for (const prefix of FRAMEWORK_PATH_PREFIXES) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Returns true if the file path is a business source file subject to TDD enforcement.
 * Same logic as tdd-before.ts — duplicated here because each plugin is independent
 * and importing across plugins creates Bun cache coupling risk.
 */
function isBusinessSourceFile(fp: string): boolean {
  if (!fp || !isSourceFile(fp)) return false;
  if (isFrameworkPath(fp)) return false;
  for (const pat of EXCLUDE_PATTERNS) {
    if (pat.test(fp)) return false;
  }
  return true;
}

function isTestFile(fp: string): boolean {
  if (!fp) return false;
  for (const pat of TEST_PATTERNS) {
    if (pat.test(fp)) return true;
  }
  return false;
}

/**
 * Find the most recent atomic backup for a given file in its sibling
 * .opencode_backups/ directory. safe-edit-core.ts names backups as:
 *   {basename}.{ts}.{pid}.{agent}.{task}.safe_backup
 */
function findLatestBackup(filePath: string): string | null {
  try {
    const dir = path.join(path.dirname(filePath), ".opencode_backups");
    if (!fs.existsSync(dir)) return null;

    const base = path.basename(filePath);
    const candidates = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".safe_backup"));

    if (candidates.length === 0) return null;

    // Backup filenames embed timestamps; lexical sort of full name works because
    // timestamp is left-padded and appears early in the name.
    candidates.sort();
    return path.join(dir, candidates[candidates.length - 1]);
  } catch {
    return null;
  }
}

/**
 * Generate a diff summary string suitable for storing in machine.json.
 */
function diffSummary(result: { hasChanges: boolean; added: number; removed: number }): string {
  if (!result.hasChanges) return "no changes";
  const parts: string[] = [];
  if (result.added > 0) parts.push(`+${result.added}`);
  if (result.removed > 0) parts.push(`-${result.removed}`);
  return parts.join(", ") + " lines";
}

/**
 * Update machine.json tdd_enforcement_state with post-write diff evidence.
 */
function updateTDDState(
  filePath: string,
  isTest: boolean,
  diffResult: { hasChanges: boolean; added: number; removed: number; diff: string },
  agent: string,
): void {
  try {
    const mp = STATE_PATHS.machine();
    if (!fs.existsSync(mp)) return;
    const machine = JSON.parse(fs.readFileSync(mp, "utf8"));
    if (!machine?.tdd_enforcement_state?.enabled) return;

    const tdd = machine.tdd_enforcement_state;
    tdd.current_session = tdd.current_session || {
      test_written: false,
      impl_files_attempted: [],
      blocked_attempts: [],
      test_files_written: [],
      initialized: true,
      diff_evidence: [],
    };
    const sess = tdd.current_session;
    sess.diff_evidence = sess.diff_evidence || [];

    const evidence = {
      file: filePath,
      timestamp: new Date().toISOString(),
      type: isTest ? "test" : "impl",
      hasChanges: diffResult.hasChanges,
      added: diffResult.added,
      removed: diffResult.removed,
      diffSummary: diffSummary(diffResult),
      agent,
    };
    sess.diff_evidence.push(evidence);

    // Cap diff_evidence to 100 entries to prevent unbounded growth
    if (sess.diff_evidence.length > 100) {
      sess.diff_evidence = sess.diff_evidence.slice(-100);
    }

    if (isTest && diffResult.hasChanges) {
      sess.test_written = true;
      sess.test_files_written = sess.test_files_written || [];
      if (!sess.test_files_written.includes(filePath)) {
        sess.test_files_written.push(filePath);
      }
    }

    if (!isTest) {
      sess.impl_files_attempted = sess.impl_files_attempted || [];
      if (!sess.impl_files_attempted.includes(filePath)) {
        sess.impl_files_attempted.push(filePath);
      }
    }

    fs.writeFileSync(mp, JSON.stringify(machine, null, 2), "utf8");
  } catch (_err: any) {
    // Non-critical — silently continue
  }
}

/**
 * Detect shallow-test circumvention: test files exist in the session but
 * none of them have actual content changes.
 */
function hasOnlyShallowTests(machine: any): boolean {
  const sess = machine?.tdd_enforcement_state?.current_session;
  if (!sess?.test_files_written || sess.test_files_written.length === 0) return false;
  if (!sess.diff_evidence || sess.diff_evidence.length === 0) return false;

  const testEvidences = sess.diff_evidence.filter(
    (e: any) => e.type === "test" && sess.test_files_written.includes(e.file),
  );
  if (testEvidences.length === 0) return true; // no diff evidence for claimed test files = shallow
  return testEvidences.every((e: any) => !e.hasChanges);
}

// ── Plugin boilerplate (identical pattern to all existing plugins) ──
ensureLogDir();
writeLog("tdd-after", "loaded", { event: "PLUGIN-LOADED", detail: "tdd-after.ts" });
updateIndex("tdd-after", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("tdd-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

// ── Hook handler ──
async function toolExecuteAfter(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  // ① Only enforce for Coder-BE / Coder-FE
  if (!TDD_AGENTS.has(agent)) {
    writeLog("tdd-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: "exit (skip) non-coder agent",
    });
    return;
  }

  // ② Only enforce for the 3 content-writing tools
  if (!TDD_MODIFY_TOOLS.has(input.tool)) {
    writeLog("tdd-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: `exit (skip) non-tdd tool: ${input.tool}`,
    });
    return;
  }

  // ③ after-hook: args live in input.args (NOT output.args)
  //    @see plugin-debugging-precautions.md §6 and scope-after.ts
  const fp = getModifyPath(input.args || {});
  if (!isBusinessSourceFile(fp)) {
    writeLog("tdd-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: `exit (skip) non-business file: ${fp || "(none)"}`,
    });
    return;
  }

  // ④ Generate diff against latest backup (if any). New files have no backup;
  // treat them as having changes by comparing against empty string.
  const latestBackup = findLatestBackup(fp);
  let original = "";
  try {
    if (latestBackup && fs.existsSync(latestBackup)) {
      original = fs.readFileSync(latestBackup, "utf8");
    }
  } catch (_err) {
    original = "";
  }

  let current = "";
  try {
    if (fs.existsSync(fp)) {
      current = fs.readFileSync(fp, "utf8");
    }
  } catch (_err) {
    current = "";
  }

  const diffResult = generateDiff(original, current);
  const isTest = isTestFile(fp);

  // ⑤ Update machine.json with diff evidence
  updateTDDState(fp, isTest, diffResult, agent);

  // ⑥ Log outcome
  if (isTest) {
    if (diffResult.hasChanges) {
      writeLog("tdd-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        event: "TOOL-AFTER",
        detail: `verified test file | ${fp} | ${diffSummary(diffResult)}`,
      });
    } else {
      writeLog("tdd-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "WARN",
        event: "TOOL-AFTER",
        detail: `shallow-test warning | ${fp} | no content changes detected`,
      });
    }
  } else {
    writeLog("tdd-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: `diff evidence captured | ${fp} | ${diffSummary(diffResult)}`,
    });

    // ⑦ Shallow-test circumvention detection
    try {
      const mp = STATE_PATHS.machine();
      if (fs.existsSync(mp)) {
        const machine = JSON.parse(fs.readFileSync(mp, "utf8"));
        if (machine?.tdd_enforcement_state?.current_session?.test_written && hasOnlyShallowTests(machine)) {
          writeLog("tdd-after", "runtime", {
            sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
            level: "WARN",
            event: "TOOL-AFTER",
            detail: `shallow-test circumvention detected | impl=${fp} | test files have no real changes`,
          });
        }
      }
    } catch (_err) {
      // ignore
    }
  }
}
