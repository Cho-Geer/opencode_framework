// service/tdd/enforcement.ts — TDD 状态管理
// 所有 tdd_enforcement_state 的读写操作唯一入口
import { writeLog } from "../../lib/log-manager";
import { readSubState } from "../../lib/substate-manager";
import {
  isTddAgent,
  isTddTool,
  isBusinessSourceFile,
  atomicWriteSubState,
} from "../../lib/state-utils";
import { getEnforcementMode } from "../../lib/gate-core";

const SRC = "service/tdd/enforcement";

// ── 类型 ──────────────────────────────────────────────────────

export interface TddDiffEvidence {
  file: string;
  timestamp: string;
  type: "test" | "impl";
  hasChanges: boolean;
  added: number;
  removed: number;
  diffSummary: string;
  agent: string;
}

export interface TddSessionState {
  test_written: boolean;
  impl_files_attempted: string[];
  blocked_attempts: string[];
  test_files_written: string[];
  initialized: boolean;
  diff_evidence: TddDiffEvidence[];
}

export interface TddEnforcementState {
  enabled: boolean;
  current_session: TddSessionState;
}

// ── 检查 ──────────────────────────────────────────────────────

export function checkTddEnforcement(
  agent: string,
  tool: string,
  filePath: string,
): { allowed: boolean; message?: string } {
  if (!isTddAgent(agent)) return { allowed: true };
  if (!isTddTool(tool)) return { allowed: true };
  if (!filePath || !isBusinessSourceFile(filePath)) return { allowed: true };

  let testWritten = false;
  try {
    const tdd = readSubState("tdd_enforcement_state") as TddEnforcementState | null;
    if (tdd?.current_session?.initialized) {
      testWritten = tdd.current_session.test_written === true;
    }
  } catch {}

  if (testWritten) {
    writeLog(SRC, "runtime", {
      event: "TDD-CHECK-PASS",
      detail: "test written, impl allowed: " + filePath,
    });
    return { allowed: true };
  }

  const mode = getEnforcementMode();
  const msg = '[FW-ENFORCE][TDD] TDD violation: writing to "' + filePath + '" without prior test changes. Write a .spec.ts/.test.ts file first.';

  writeLog(SRC, "runtime", {
    level: "ERROR",
    event: "TDD-CHECK-BLOCKED",
    detail: "BLOCKED | " + msg,
  });

  if (mode === "strict" || mode === "locked") {
    return { allowed: false, message: msg };
  }

  return { allowed: true };
}

// ── 状态更新 ──────────────────────────────────────────────────

export function updateTddState(
  filePath: string,
  isTest: boolean,
  diffResult: { hasChanges: boolean; added: number; removed: number; diff: string },
  agent: string,
): void {
  try {
    atomicWriteSubState("tdd_enforcement_state", (state: any) => {
      if (!state?.enabled) state.enabled = true;
      state.current_session = state.current_session || {
        test_written: false,
        impl_files_attempted: [],
        blocked_attempts: [],
        test_files_written: [],
        initialized: true,
        diff_evidence: [],
      };
      const sess = state.current_session;
      sess.diff_evidence = sess.diff_evidence || [];

      const evidence: TddDiffEvidence = {
        file: filePath,
        timestamp: new Date().toISOString(),
        type: isTest ? "test" : "impl",
        hasChanges: diffResult.hasChanges,
        added: diffResult.added,
        removed: diffResult.removed,
        diffSummary: _diffSummary(diffResult),
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
    // Non-critical
  }
}

// ── 内部工具函数 ──────────────────────────────────────────────

export function _diffSummary(result: { hasChanges: boolean; added: number; removed: number }): string {
  if (!result.hasChanges) return "no changes";
  const parts: string[] = [];
  if (result.added > 0) parts.push("+" + result.added);
  if (result.removed > 0) parts.push("-" + result.removed);
  return parts.join(", ") + " lines";
}
