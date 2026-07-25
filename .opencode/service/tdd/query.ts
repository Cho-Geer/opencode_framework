// service/tdd/query.ts — 只读查询接口
// 供 Plugin (Middleware) 使用，禁止任何 INSERT/UPDATE/DELETE
import { readSubState } from "../../lib/substate-manager";
import type { TddEnforcementState } from "./enforcement";

/**
 * 获取当前 TDD 状态（只读）
 */
export function getTddState(): TddEnforcementState | null {
  try {
    return readSubState("tdd_enforcement_state") as TddEnforcementState | null;
  } catch {
    return null;
  }
}

/**
 * 检查 test_written 标志（只读）
 */
export function isTestWritten(): boolean {
  const state = getTddState();
  return state?.current_session?.test_written === true;
}

/**
 * 获取已写入的测试文件列表（只读）
 */
export function getTestFilesWritten(): string[] {
  const state = getTddState();
  return state?.current_session?.test_files_written || [];
}

/**
 * 获取 diff 证据列表（只读）
 */
export function getDiffEvidence(): any[] {
  const state = getTddState();
  return state?.current_session?.diff_evidence || [];
}
