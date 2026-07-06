// service/enforcement/rule-disposition.ts — Per-rule disposition (Phase 3 T3.1)
// Replaces global enforcement mode (advisory/strict/locked) with per-rule dispositions.
// Each rule independently declares its enforcement level: hard_block / audit_only / warn_continue.
//
// Migration: getEnforcementMode() → getRuleDisposition(ruleId)
// Source: Phase 3 plan Task 3.4 + blueprint §3 hard constraint classification
//
// v1.0 (2026-07-05)

import { writeLog } from "../../lib/log-manager";

const SRC = "service-rule-disposition";

// ── Disposition types ──────────────────────────────────────────────

/** hard_block: throw to prevent action. Safety-critical, cannot be downgraded. */
/** audit_only: log structured event, do NOT block. Quality signal for QoderWork. */
/** warn_continue: emit warning, continue execution. Advisory prompt for agent. */
export type RuleDisposition = "hard_block" | "audit_only" | "warn_continue";

// ── Rule ID registry ───────────────────────────────────────────────
// Each rule ID maps to exactly one disposition.
// Rule IDs follow pattern: <domain>-<constraint>
// Consumers call getRuleDisposition(ruleId) at each decision point.

const RULE_TABLE: Record<string, RuleDisposition> = {
  // ── hard_block: Safety-critical (7 rules) ──
  "native-edit-disabled":           "hard_block",  // permission-safety
  "native-bash-disabled":           "hard_block",  // permission-safety
  "dangerous-shell-command":        "hard_block",  // permission-safety
  "backup-bypass":                  "hard_block",  // scope
  "write-scope-violation":          "hard_block",  // scope
  "framework-config-unauthorized":  "hard_block",  // permission-safety
  "source-edit-without-codegraph":  "hard_block",  // codegraph
  "non-question-during-guidance":   "hard_block",  // guidance-bridge

  // ── audit_only: Quality signals (4 rules) ──
  "checklist-incomplete":           "audit_only",  // quality-contract
  "tdd-order-violation":            "audit_only",  // quality-contract
  "route-mismatch":                 "audit_only",  // dispatch-signal
  "deliverable-format":             "audit_only",  // quality-contract

  // ── warn_continue: Advisory (2 rules) ──
  "recommended-skill-missing":      "warn_continue",  // skill-policy
  "output-missing-evidence":        "warn_continue",  // quality-contract

  // ── Gate/session rules (mapped from old mode checks) ──
  "gate-check-block":               "audit_only",  // gate-validate (was strict/locked block)
  "session-check-failed":           "audit_only",  // checklist-validate
  "dispatch-dag-missing":           "audit_only",  // dispatch-validate
  "dispatch-target-mismatch":       "audit_only",  // dispatch-validate
  "scope-write-out-of-bounds":      "hard_block",  // scope-validate
  "scope-tool-not-allowed":         "hard_block",  // scope-validate
  "file-audit-write":               "audit_only",  // file-guard/audit
  "tdd-enforcement":                "audit_only",  // tdd/enforcement
  "knowledge-cache-miss":           "audit_only",  // knowledge/enforcement
  "knowledge-external-query":       "audit_only",  // knowledge/cache-check
  "permission-config-unreadable":   "hard_block",  // permission/reader (was fail-closed)
  "permission-denied":              "hard_block",  // permission/reader
  "compliance-audit":               "audit_only",  // session/compliance-audit
  "config-attest-required":         "audit_only",  // session/config-attest
  "uc7ks-tracking":                 "audit_only",  // knowledge/after-track
  "mcp-gate-check":                 "audit_only",  // gate/mcp-check
  "mcp-complete-eslint":            "audit_only",  // gate/mcp-complete
  "mcp-complete-tsc":               "audit_only",  // gate/mcp-complete
  "mcp-complete-artifact":          "audit_only",  // gate/mcp-complete
  "mcp-confirm-block":              "audit_only",  // gate/mcp-confirm
  "mcp-deliverable-check":          "audit_only",  // gate/mcp-deliverables
  "session-mgmt-block":            "audit_only",  // gate/session-mgmt
  "session-complete-check":        "audit_only",  // gate/session-complete
  "dispatch-marker-consume":       "hard_block",   // dispatch/marker-consume
  "dag-access":                     "audit_only",  // dispatch/dag-policy
  "log-level-selection":            "warn_continue",  // lib/log-manager
};

// ── Core API ───────────────────────────────────────────────────────

/**
 * Get the disposition for a specific rule.
 * Replaces getEnforcementMode() + inline mode branching.
 *
 * @param ruleId - Rule identifier (e.g. "write-scope-violation")
 * @returns The disposition for this rule
 */
export function getRuleDisposition(ruleId: string): RuleDisposition {
  const disposition = RULE_TABLE[ruleId];
  if (!disposition) {
    writeLog(SRC, "WARN", {
      event: "UNKNOWN-RULE-ID",
      ruleId,
      detail: `Rule "${ruleId}" not in RULE_TABLE, defaulting to warn_continue`,
    });
    return "warn_continue";
  }
  return disposition;
}

/**
 * Check if a rule should hard-block the current action.
 * Convenience wrapper: returns true if disposition is "hard_block".
 */
export function shouldBlock(ruleId: string): boolean {
  return getRuleDisposition(ruleId) === "hard_block";
}

/**
 * Check if a rule should produce an audit event only (no block).
 */
export function isAuditOnly(ruleId: string): boolean {
  return getRuleDisposition(ruleId) === "audit_only";
}

/**
 * Get all rule IDs and their dispositions.
 * Useful for diagnostics and framework doctor.
 */
export function getAllRules(): Record<string, RuleDisposition> {
  return { ...RULE_TABLE };
}

/**
 * Get rules grouped by disposition level.
 */
export function getRulesByDisposition(): Record<RuleDisposition, string[]> {
  const result: Record<RuleDisposition, string[]> = {
    hard_block: [],
    audit_only: [],
    warn_continue: [],
  };
  for (const [ruleId, disposition] of Object.entries(RULE_TABLE)) {
    result[disposition].push(ruleId);
  }
  return result;
}

// ── Migration helpers ──────────────────────────────────────────────
// These functions bridge the old API during migration.
// Once all consumers are migrated, these can be removed.

/**
 * @deprecated Use getRuleDisposition(ruleId) instead.
 * Compatibility shim: returns "strict" if any relevant rule is hard_block.
 */
export function getEnforcementModeCompat(): "advisory" | "strict" | "locked" {
  // Since all safety rules are hard_block, this always returns "strict"
  // which matches the current configured behavior.
  return "strict";
}

/**
 * @deprecated Use shouldBlock(ruleId) instead.
 * Compatibility shim: returns true if mode was "strict" or "locked".
 */
export function isStrictOrLockedCompat(): boolean {
  return true; // Current mode is "strict"
}
