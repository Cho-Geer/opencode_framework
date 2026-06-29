// service/tdd/diff-verify.ts — diff 验证 + 浅测试检测
// 写后验证：对比备份与当前文件，确认测试有实际变更
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { getModifyPath } from "../../lib/tool-scope";
import {
  isBusinessSourceFile,
  isTddAgent,
  isTddTool,
} from "../../lib/state-utils";
import { generateDiff } from "../file-guard/execute";
import { findLatestBackup } from "../file-guard/backup";
import { readSubState } from "../../lib/substate-manager";
import { updateTddState, _diffSummary } from "./enforcement";
import * as fs from "node:fs";

const SRC = "service/tdd/diff-verify";

// ── 常量 ──────────────────────────────────────────────────────

const TEST_PATTERNS = [
  /\.spec\./,
  /\.test\./,
  /\/test\//,
  /__tests__\//,
];

// ── 导出函数 ──────────────────────────────────────────────────

export function isTestFile(fp: string): boolean {
  if (!fp) return false;
  for (const pat of TEST_PATTERNS) {
    if (pat.test(fp)) return true;
  }
  return false;
}

/**
 * 验证写入的文件的 diff，更新 TDD 状态
 * 由 tdd-after plugin 调用
 */
export function verifyTddWrite(
  sessionID: string,
  callID: string,
  tool: string,
  args: Record<string, any>,
): void {
  const agent = resolveAgent(sessionID);

  if (!isTddAgent(agent)) {
    writeLog(SRC, "runtime", {
      sessionID, callID, agent,
      event: "TOOL-AFTER",
      detail: "exit (skip) non-coder agent",
    });
    return;
  }

  if (!isTddTool(tool)) {
    writeLog(SRC, "runtime", {
      sessionID, callID, agent,
      event: "TOOL-AFTER",
      detail: "exit (skip) non-tdd tool: " + tool,
    });
    return;
  }

  const fp = getModifyPath(args || {});
  if (!isBusinessSourceFile(fp)) {
    writeLog(SRC, "runtime", {
      sessionID, callID, agent,
      event: "TOOL-AFTER",
      detail: "exit (skip) non-business file: " + (fp || "(none)"),
    });
    return;
  }

  // 读取备份，生成 diff
  const latestBackup = findLatestBackup(fp);
  let original = "";
  try {
    if (latestBackup && fs.existsSync(latestBackup.backup_file_path)) {
      original = fs.readFileSync(latestBackup.backup_file_path, "utf8");
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

  // 更新 TDD 状态（调 Service）
  updateTddState(fp, isTest, diffResult, agent);

  // 日志
  if (isTest) {
    if (diffResult.hasChanges) {
      writeLog(SRC, "runtime", {
        sessionID, callID, agent,
        event: "TOOL-AFTER",
        detail: "verified test file | " + fp + " | " + _diffSummary(diffResult),
      });
    } else {
      writeLog(SRC, "runtime", {
        sessionID, callID, agent,
        level: "WARN",
        event: "TOOL-AFTER",
        detail: "shallow-test warning | " + fp + " | no content changes detected",
      });
    }
  } else {
    writeLog(SRC, "runtime", {
      sessionID, callID, agent,
      event: "TOOL-AFTER",
      detail: "diff evidence captured | " + fp + " | " + _diffSummary(diffResult),
    });

    // 检测浅测试绕过
    try {
      const tddState = readSubState("tdd_enforcement_state");
      if (tddState?.current_session?.test_written && hasOnlyShallowTests(tddState)) {
        writeLog(SRC, "runtime", {
          sessionID, callID, agent,
          level: "WARN",
          event: "TOOL-AFTER",
          detail: "shallow-test circumvention detected | impl=" + fp + " | test files have no real changes",
        });
      }
    } catch (_err) {
      // ignore
    }
  }
}

/**
 * 检测是否只有浅测试（测试文件存在但无实际变更）
 */
export function hasOnlyShallowTests(tddState: any): boolean {
  const sess = tddState?.current_session;
  if (!sess?.test_files_written || sess.test_files_written.length === 0) return false;
  if (!sess.diff_evidence || sess.diff_evidence.length === 0) return false;

  const testEvidences = sess.diff_evidence.filter(
    (e: any) => e.type === "test" && sess.test_files_written.includes(e.file),
  );
  if (testEvidences.length === 0) return true;
  return testEvidences.every((e: any) => !e.hasChanges);
}
