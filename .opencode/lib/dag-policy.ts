/**
 * dag-policy.ts — PLAN-FIRST Dispatch Policy (single source of truth)
 * =====================================================================
 *
 * Centralizes:
 *   1. The canonical DAG-exempt agent list (consumed by gate-before.ts,
 *      pre-execution-gate.ts, dispatch_subagent.ts, state-reconciliation.ts).
 *   2. Reading `dispatch_policy` from project.config.json.
 *   3. Recording auto-plan history to machine.json.auto_plan_history.
 *   4. The autoPlan() self-healing flow.
 *
 * Design doc: docs/review/cicd-dag-block/plan-first-redesign.md
 *
 * @author @Super-Admin (framework architect)
 * @since 2026-06-14
 * @tag FW-PLAN-FIRST
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { findTaskInDag } from "./gate-checks";
import { writeAuditLogEntry } from "./audit-log";
import { writeLog } from "./log-manager";
import { atomicWriteSubState } from "./state-utils";
import { readSubState } from "./substate-manager";

// ───────────────────────────────────────────────────────────────────────────
// §1  CANONICAL DAG-EXEMPT AGENT LIST
// ───────────────────────────────────────────────────────────────────────────
//
// These agents are allowed to dispatch (and to be dispatched) without a
// corresponding Task.DAG.json entry. Any agent NOT in this list is a
// "non-DAG-exempt" subagent and is subject to the PLAN-FIRST constraint.
//
// Current members:
//   - meta-planner   — creates the DAG; cannot logically require a DAG entry
//                      before it has created one.
//   - orchestrator   — manages the DAG; dispatches themselves are rare but
//                      legitimate for DAG introspection tasks.
//   - super-admin    — framework maintenance (docs/, rules, plugins) is
//                      outside DAG coverage by design.
//   - knowledge-curator — dispatched for UC7KS knowledge acquisition, which
//                      is not a DAG-tracked activity. Exempted from both the
//                      pre-execution gate and the P2-1 audit.
//
// To add a new exempt agent: edit this array and update the documentation in
// plan-first-redesign.md §3. All gates read from this list — there is no
// other place to change.
//
// Decision record:
//   - Knowledge-Curator exempted per user decision 2026-06-14: "Knowledge-
//     Curator should live in DAG-exempt array, and dispatch it should bypass
//     DAG audit."
export const DAG_EXEMPT_AGENTS: readonly string[] = Object.freeze([
  "meta-planner",
  "orchestrator",
  "super-admin",
  "knowledge-curator",
]);

/**
 * Normalize an agent string (strip leading '@', lowercase) and check whether
 * it belongs to the DAG-exempt set.
 */
export function isDagExempt(agent: string | undefined | null): boolean {
  if (!agent) return false;
  const normalized = String(agent).toLowerCase().replace(/^@/, "");
  return (DAG_EXEMPT_AGENTS as readonly string[]).includes(normalized);
}

// ───────────────────────────────────────────────────────────────────────────
// §2  DISPATCH POLICY (from project.config.json)
// ───────────────────────────────────────────────────────────────────────────

export interface DispatchPolicy {
  /**
   * Master switch. When true, non-DAG-exempt dispatches require a DAG entry.
   * Default: false during rollout (observation window); flipped to true in
   * strict mode after a one-week observation window.
   */
  require_dag_entry: boolean;

  /**
   * Self-healing: when true and a dispatch would block on a missing DAG
   * entry, the framework auto-dispatches @Meta-Planner to plan the task
   * first. Opt-in (default false). Forced to false in locked mode.
   */
  auto_plan_enabled: boolean;

  /** Per-session rate limit on auto-plan attempts. Default 5. */
  auto_plan_max_per_session: number;

  /** Per-attempt timeout in ms. Default 120_000. */
  auto_plan_timeout_ms: number;
}

export const DEFAULT_DISPATCH_POLICY: DispatchPolicy = Object.freeze({
  require_dag_entry: false,
  auto_plan_enabled: false,
  auto_plan_max_per_session: 5,
  auto_plan_timeout_ms: 120_000,
});

let _policyCache: DispatchPolicy | null = null;
let _policyCacheLoaded = false;

/**
 * Read `dispatch_policy` from project.config.json. Cached after first read.
 * Call `resetDispatchPolicyCache()` after modifying project.config.json.
 *
 * Hardening rules:
 *   - If the block is missing or malformed → defaults are used.
 *   - If enforcement mode is "locked" → auto_plan_enabled is forced to false
 *     regardless of the config value (locked mode = human-in-the-loop).
 */
export function readDispatchPolicy(): DispatchPolicy {
  if (_policyCacheLoaded && _policyCache) return _policyCache;
  _policyCacheLoaded = true;

  let raw: Partial<DispatchPolicy> | null = null;
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.join(root, ".opencode", "project.config.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (cfg.dispatch_policy && typeof cfg.dispatch_policy === "object") {
        raw = cfg.dispatch_policy;
      }
    }
  } catch {
    /* fall through to defaults */
  }

  const merged: DispatchPolicy = {
    require_dag_entry:
      typeof raw?.require_dag_entry === "boolean"
        ? raw.require_dag_entry
        : DEFAULT_DISPATCH_POLICY.require_dag_entry,
    auto_plan_enabled:
      typeof raw?.auto_plan_enabled === "boolean"
        ? raw.auto_plan_enabled
        : DEFAULT_DISPATCH_POLICY.auto_plan_enabled,
    auto_plan_max_per_session:
      typeof raw?.auto_plan_max_per_session === "number" &&
      raw.auto_plan_max_per_session >= 0
        ? raw.auto_plan_max_per_session
        : DEFAULT_DISPATCH_POLICY.auto_plan_max_per_session,
    auto_plan_timeout_ms:
      typeof raw?.auto_plan_timeout_ms === "number" &&
      raw.auto_plan_timeout_ms > 0
        ? raw.auto_plan_timeout_ms
        : DEFAULT_DISPATCH_POLICY.auto_plan_timeout_ms,
  };

  // Locked mode: force auto_plan_enabled to false (human-in-the-loop).
  if (isLockedMode()) {
    merged.auto_plan_enabled = false;
  }

  _policyCache = merged;
  return merged;
}

export function resetDispatchPolicyCache(): void {
  _policyCache = null;
  _policyCacheLoaded = false;
}

function isLockedMode(): boolean {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const cfg = JSON.parse(
      fs.readFileSync(
        path.join(root, ".opencode", "project.config.json"),
        "utf8",
      ),
    );
    const tr = cfg?.template_resolution || {};
    const mode =
      tr.develop_enforcement_mode ||
      tr.runtime_enforcement_mode ||
      tr.enforcement_mode;
    return mode === "locked";
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// §3  AUTO-PLAN HISTORY (machine.json.auto_plan_history)
// ───────────────────────────────────────────────────────────────────────────

export interface AutoPlanRecord {
  timestamp: string;
  caller_session: string;
  caller_agent: string;
  target_agent: string;
  dag_task_id: string;
  planning_dispatch_id: string;
  status: "attempt" | "success" | "timeout" | "rate_limited" | "failure";
  elapsed_ms?: number;
  error?: string;
}

function machinePath(): string {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  return path.join(root, ".opencode", "state", "machine.json");
}

function appendAutoPlanRecord(rec: AutoPlanRecord): void {
  const ok = atomicWriteSubState("transaction_state", (txn) => {
    if (!Array.isArray(txn.auto_plan_history)) {
      txn.auto_plan_history = [];
    }
    txn.auto_plan_history.push(rec);
    // Cap at 200 entries to bound the file size.
    if (txn.auto_plan_history.length > 200) {
      txn.auto_plan_history = txn.auto_plan_history.slice(-200);
    }
  });

  if (!ok) {
    /**
     * FW-STDERR-POLLUTION-FIX: Replaced process.stderr.write with writeLog
     * to stop TUI pollution. writeLog writes to buffered file-based logs
     * (.task_temp/_logs/) instead of stderr which leaks to the TUI.
     * See: docs/official_docs/opencode/findings/01-log-central-management.md
     */
    writeLog("dag-policy", "ERROR", {
      event: "AUTO-PLAN-HISTORY-FAILED",
      detail: "Failed to write auto_plan_history after 3 retries",
    });
  }

  writeAuditLogEntry({
    event: "AUTO-PLAN-" + rec.status.toUpperCase(),
    agent: rec.caller_agent,
    level: rec.status === "success" ? "INFO" : "WARN",
    detail: JSON.stringify(rec),
  });
}

export function countAutoPlanAttempts(callerSession: string): number {
  const txn = readSubState("transaction_state");
  const history: AutoPlanRecord[] = txn.auto_plan_history || [];
  return history.filter((r) => r.caller_session === callerSession).length;
}

// ───────────────────────────────────────────────────────────────────────────
// §4  AUTO-PLAN SELF-HEALING
// ───────────────────────────────────────────────────────────────────────────

export interface AutoPlanOptions {
  dagTaskId: string;
  targetAgent: string;
  taskDescription: string;
  timeoutMs: number;
  callerSession: string;
  callerAgent: string;
  /**
   * Callback that actually dispatches @Meta-Planner. Injected to avoid a
   * circular import with dispatch_subagent.ts. The callback must return the
   * dispatch session ID (e.g. "PLAN-<dagTaskId>") or throw.
   */
  dispatchMetaPlanner: (
    planningPrompt: string,
    planningDagId: string,
  ) => Promise<string>;
}

/**
 * Synthesize a planning prompt for @Meta-Planner that requests adding a
 * specific task to Task.DAG.json. The prompt is deliberately narrow:
 * - add the task
 * - do not change any other task
 * - produce HANDOVER.md
 */
export function synthesizePlanningPrompt(opts: {
  dagTaskId: string;
  targetAgent: string;
  taskDescription: string;
}): string {
  return [
    `# Planning request — auto-generated by PLAN-FIRST self-healing`,
    ``,
    `## Required output`,
    `Add the following task to \`Task.DAG.json\` (either in the top-level`,
    `\`tasks[]\` array or in an appropriate \`execution_order\` group):`,
    ``,
    `- **task_id**: \`${opts.dagTaskId}\``,
    `- **owner**: \`@${opts.targetAgent.replace(/^@/, "")}\``,
    `- **status**: \`pending\``,
    `- **description**: ${opts.taskDescription}`,
    `- **dependencies**: [] (unless inferable from description)`,
    `- **acceptance_criteria**: derive from description`,
    ``,
    `## Constraints`,
    `- Do NOT change any other task in the DAG.`,
    `- Do NOT modify \`project.config.json\`, \`opencode.json\`, or any plugin file.`,
    `- Write only to \`Task.DAG.json\` and your \`.task_temp/${opts.dagTaskId}/\` directory.`,
    `- Produce a HANDOVER.md summarizing what you added.`,
    ``,
    `## Completion`,
    `When the DAG entry is in place, output exactly:`,
    `\`\`\``,
    `PLAN-FIRST: ${opts.dagTaskId} planned`,
    `\`\`\``,
  ].join("\n");
}

/**
 * Autonomous PLAN-FIRST self-healing.
 *
 * Flow:
 *   1. Record the attempt in machine.json.auto_plan_history.
 *   2. Check the per-session rate limit.
 *   3. Synthesize a planning prompt.
 *   4. Dispatch @Meta-Planner via the injected callback.
 *   5. Poll Task.DAG.json until dagTaskId appears or timeout.
 *   6. Record success or failure.
 *
 * Returns true if the DAG entry was created within the timeout; false
 * otherwise. The caller is expected to re-verify with findTaskInDag()
 * before proceeding with the original dispatch.
 */
export async function autoPlan(opts: AutoPlanOptions): Promise<boolean> {
  const startedAt = Date.now();
  const planningDagId = `PLAN-${opts.dagTaskId}`;

  // 1. Record attempt.
  appendAutoPlanRecord({
    timestamp: new Date().toISOString(),
    caller_session: opts.callerSession,
    caller_agent: opts.callerAgent,
    target_agent: opts.targetAgent,
    dag_task_id: opts.dagTaskId,
    planning_dispatch_id: planningDagId,
    status: "attempt",
  });

  // 2. Rate limit.
  const policy = readDispatchPolicy();
  const attempts = countAutoPlanAttempts(opts.callerSession);
  if (attempts > policy.auto_plan_max_per_session) {
    appendAutoPlanRecord({
      timestamp: new Date().toISOString(),
      caller_session: opts.callerSession,
      caller_agent: opts.callerAgent,
      target_agent: opts.targetAgent,
      dag_task_id: opts.dagTaskId,
      planning_dispatch_id: planningDagId,
      status: "rate_limited",
      elapsed_ms: Date.now() - startedAt,
      error: `auto_plan_max_per_session (${policy.auto_plan_max_per_session}) exceeded`,
    });
    return false;
  }

  // 3. Synthesize prompt.
  const planningPrompt = synthesizePlanningPrompt({
    dagTaskId: opts.dagTaskId,
    targetAgent: opts.targetAgent,
    taskDescription: opts.taskDescription,
  });

  // 4. Dispatch @Meta-Planner. If this throws, record failure.
  try {
    await opts.dispatchMetaPlanner(planningPrompt, planningDagId);
  } catch (e: any) {
    appendAutoPlanRecord({
      timestamp: new Date().toISOString(),
      caller_session: opts.callerSession,
      caller_agent: opts.callerAgent,
      target_agent: opts.targetAgent,
      dag_task_id: opts.dagTaskId,
      planning_dispatch_id: planningDagId,
      status: "failure",
      elapsed_ms: Date.now() - startedAt,
      error: `Meta-Planner dispatch failed: ${e?.message || e}`,
    });
    return false;
  }

  // 5. Poll for the DAG entry.
  const pollInterval = 1000;
  while (Date.now() - startedAt < opts.timeoutMs) {
    const tc = findTaskInDag(opts.dagTaskId);
    if (tc.found && (tc.status === "pending" || tc.status === "in_progress")) {
      appendAutoPlanRecord({
        timestamp: new Date().toISOString(),
        caller_session: opts.callerSession,
        caller_agent: opts.callerAgent,
        target_agent: opts.targetAgent,
        dag_task_id: opts.dagTaskId,
        planning_dispatch_id: planningDagId,
        status: "success",
        elapsed_ms: Date.now() - startedAt,
      });
      return true;
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  // 6. Timeout.
  appendAutoPlanRecord({
    timestamp: new Date().toISOString(),
    caller_session: opts.callerSession,
    caller_agent: opts.callerAgent,
    target_agent: opts.targetAgent,
    dag_task_id: opts.dagTaskId,
    planning_dispatch_id: planningDagId,
    status: "timeout",
    elapsed_ms: Date.now() - startedAt,
    error: `DAG entry "${opts.dagTaskId}" did not appear within ${opts.timeoutMs}ms`,
  });
  return false;
}
