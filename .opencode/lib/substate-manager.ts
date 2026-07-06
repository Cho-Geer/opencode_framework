// substate-manager.ts — Split sub-state DB-only manager
// ═══════════════════════════════════════════════════════════════════════
// P2-A Step 8 (2026-06-16): DB-only — removed JSON dual-write.
// DB (SQLite) is now the single source of truth for all sub-states.
// JSON files remain on disk as frozen snapshots (last dual-write state)
// but are no longer read or written by this module.
//
// Logging: Uses writeLog() from log-manager (never console.log/error).
// @see docs/review/framework-refactor/database-migration-plan.md
// ═══════════════════════════════════════════════════════════════════════

import { writeLog } from "./log-manager";
import {
  dbReadSubState,
  dbWriteSubState,
  dbReadMachineMeta,
  dbWriteMachineMeta,
} from "./db-state-manager";
import type { SubStateMap, SubStateKey } from "./substate-types";

// Sub-state file mapping: key → filename (used for SUBSTATE_FILES type)
export const SUBSTATE_FILES: Record<SubStateKey, string> = {
  eslint_state: "eslint-state.json",
  // type_check_state: "type-check-state.json",  ← deprecated (replaced by diagnostic_state, 2026-06-26)
  diagnostic_state: "diagnostic-state.json",
  dependency_state: "dependency-state.json",
  format_state: "format-state.json",
  write_audit_state: "write-audit-state.json",
  knowledge_cache_state: "knowledge-cache-state.json",
  compliance_records: "compliance-records.json",
  knowledge_audit_state: "knowledge-audit-state.json",
  tdd_enforcement_state: "tdd-enforcement-state.json",
  keystone_hashes: "keystone-hashes.json",
  transaction_state: "transaction-state.json",
  knowledge_state: "knowledge-state.json",
  config_read_state: "config-read-state.json",
  diagnostic_baseline: "diagnostic-baseline.json",
  skill_read_state: "skill_read_state",
    rule_read_state: "rule_read_state",
    tool_audit_state: "tool-audit-state.json",
};

const SRC = "lib-substate-manager";

/**
 * Read a specific sub-state (DB-only).
 */
export function readSubState<K extends SubStateKey>(key: K): SubStateMap[K] {
  try {
    const dbResult = dbReadSubState(key);
    if (dbResult !== null && dbResult !== undefined) return dbResult;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-READ-SUBSTATE-FAILED",
      detail: `key=${key} err=${e.message}`,
    });
  }
  return {} as SubStateMap[K];
}

/**
 * Write a specific sub-state (DB-only).
 *
 * G3 FIX (2026-06-23): Supports expectedUpdatedAt for optimistic concurrency.
 * When provided, write fails if concurrent write detected (changes === 0).
 */
export function writeSubState<K extends SubStateKey>(
  key: K,
  value: SubStateMap[K],
  expectedUpdatedAt?: number,
): boolean {
  try {
    return dbWriteSubState(key, value, expectedUpdatedAt);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-WRITE-SUBSTATE-FAILED",
      detail: `key=${key} err=${e.message}`,
    });
    return false;
  }
}

/**
 * Read main machine.json (meta + contracts only) — DB-only.
 */
export function readMachineMeta(): any {
  try {
    const dbResult = dbReadMachineMeta();
    if (dbResult) return dbResult;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-READ-META-FAILED",
      detail: e.message,
    });
  }
  return { meta: {}, contracts: {} };
}

/**
 * Write main machine.json (meta + contracts only) — DB-only.
 */
export function writeMachineMeta(value: any): boolean {
  try {
    return dbWriteMachineMeta(value);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-WRITE-META-FAILED",
      detail: e.message,
    });
    return false;
  }
}
