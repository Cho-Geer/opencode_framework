// service/dispatch/dag-policy.ts — PLAN-FIRST Dispatch Policy (single source of truth)
// Source: lib/dag-policy.ts (imports updated for service/dispatch/ location)

import * as fs from "node:fs";
import * as path from "node:path";
import { findTaskInDag } from "../../lib/gate-checks";
import { writeAuditLogEntry } from "../../lib/audit-log";
import { writeLog } from "../../lib/log-manager";
import { atomicWriteSubState } from "../../lib/state-utils";
import { readSubState } from "../../lib/substate-manager";

// Re-export canonical DAG-exempt list and check from agent-identity.ts
export { DAG_EXEMPT_AGENTS, isDagExempt } from "../../lib/agent-identity";

// ───────────────────────────────────────────────────────────────────────────
// §2  DISPATCH POLICY (from project.config.json)
// ───────────────────────────────────────────────────────────────────────────

export interface DispatchPolicy {
  require_dag_entry: boolean;
  auto_plan_enabled: boolean;
  auto_plan_max_per_session: number;
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
    const mode = tr.develop_enforcement_mode || tr.runtime_enforcement_mode;
    return mode === "locked";
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// §3  AUTO-PLAN HISTORY
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

function appendAutoPlanRecord(rec: AutoPlanRecord): void {
  const ok = atomicWriteSubState("transaction_state", (txn) => {
    if (!Array.isArray(txn.auto_plan_history)) {
      txn.auto_plan_history = [];
    }
    txn.auto_plan_history.push(rec);
    if (txn.auto_plan_history.length > 200) {
      txn.auto_plan_history = txn.auto_plan_history.slice(-200);
    }
  });

  if (!ok) {
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
  dispatchMetaPlanner: (
    planningPrompt: string,
    planningDagId: string,
  ) => Promise<string>;
}

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

export async function autoPlan(opts: AutoPlanOptions): Promise<boolean> {
  const startedAt = Date.now();
  const planningDagId = `PLAN-${opts.dagTaskId}`;

  appendAutoPlanRecord({
    timestamp: new Date().toISOString(),
    caller_session: opts.callerSession,
    caller_agent: opts.callerAgent,
    target_agent: opts.targetAgent,
    dag_task_id: opts.dagTaskId,
    planning_dispatch_id: planningDagId,
    status: "attempt",
  });

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

  const planningPrompt = synthesizePlanningPrompt({
    dagTaskId: opts.dagTaskId,
    targetAgent: opts.targetAgent,
    taskDescription: opts.taskDescription,
  });

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
