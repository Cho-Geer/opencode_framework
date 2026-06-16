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
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getModifyPath } from "../lib/tool-scope";
import {
  isBusinessSourceFile,
  STATE_PATHS,
  isTddAgent,
  isTddTool,
} from "../lib/state-utils";
import { generateDiff, findLatestBackup } from "../lib";
import { atomicWriteMachine } from "../lib/uc7ks-schema";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Constants ──

const TEST_PATTERNS = [
  /\.spec\./,
  /\.test\./,
  /\/test\//,
  /__tests__\//,
];

// ── Helpers ──

function isTestFile(fp: string): boolean {
  if (!fp) return false;
  for (const pat of TEST_PATTERNS) {
    if (pat.test(fp)) return true;
  }
  return false;
}

function diffSummary(result: { hasChanges: boolean; added: number; removed: number }): string {
  if (!result.hasChanges) return "no changes";
  const parts: string[] = [];
  if (result.added > 0) parts.push(`+${result.added}`);
  if (result.removed > 0) parts.push(`-${result.removed}`);
  return parts.join(", ") + " lines";
}

function updateTDDState(
  filePath: string,
  isTest: boolean,
  diffResult: { hasChanges: boolean; added: number; removed: number; diff: string },
  agent: string,
): void {
  try {
    atomicWriteMachine((machine) => {
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
    });
  } catch (_err: any) {
    // Non-critical — silently continue
  }
}

function hasOnlyShallowTests(machine: any): boolean {
  const sess = machine?.tdd_enforcement_state?.current_session;
  if (!sess?.test_files_written || sess.test_files_written.length === 0) return false;
  if (!sess.diff_evidence || sess.diff_evidence.length === 0) return false;

  const testEvidences = sess.diff_evidence.filter(
    (e: any) => e.type === "test" && sess.test_files_written.includes(e.file),
  );
  if (testEvidences.length === 0) return true;
  return testEvidences.every((e: any) => !e.hasChanges);
}

export default withPluginLifecycle("tdd-after", { "tool.execute.after": toolExecuteAfter });

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  if (!isTddAgent(agent)) {
    writeLog("tdd-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: "exit (skip) non-coder agent",
    });
    return;
  }

  if (!isTddTool(input.tool)) {
    writeLog("tdd-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: `exit (skip) non-tdd tool: ${input.tool}`,
    });
    return;
  }

  const fp = getModifyPath(input.args || {});
  if (!isBusinessSourceFile(fp)) {
    writeLog("tdd-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: `exit (skip) non-business file: ${fp || "(none)"}`,
    });
    return;
  }

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

  updateTDDState(fp, isTest, diffResult, agent);

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
