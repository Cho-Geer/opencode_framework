// service/dispatch/framework-maintenance-plan.ts — Framework maintenance plan lifecycle
// Manages plans declared by child agents after CodeGraph impact analysis. A plan
// records planned_paths, codegraph_targets, rationale and links a grant to a child
// session. safe_framework_edit checks the active plan before writing.

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import { randomUUID } from "node:crypto";
import {
  getFrameworkMaintenancePolicy,
  isFrameworkPathAllowed,
} from "./framework-maintenance-policy";

const SRC = "service-dispatch-framework-maintenance-plan";

export interface FrameworkMaintenancePlan {
  id: string;
  grant_id: string;
  child_session_id: string;
  dag_task_id: string | null;
  planned_paths: string;
  codegraph_targets: string;
  rationale: string;
  risk_level: string;
  status: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface CreateFrameworkMaintenancePlanInput {
  sessionId: string;
  grantId: string;
  dagTaskId?: string;
  plannedPaths: string[];
  codegraphTargets: string[];
  rationale: string;
  riskLevel?: "low" | "medium" | "high";
}

export function createFrameworkMaintenancePlan(
  input: CreateFrameworkMaintenancePlanInput,
): { id: string; grantId: string; plannedPaths: string[] } | null {
  const db = getDb();
  const policy = getFrameworkMaintenancePolicy();

  if (!input.plannedPaths || input.plannedPaths.length === 0) {
    throw new Error("[FRAMEWORK-PLAN] planned_paths must not be empty");
  }

  if (!input.codegraphTargets || input.codegraphTargets.length === 0) {
    throw new Error("[FRAMEWORK-PLAN] codegraph_targets must not be empty");
  }

  // Verify grant exists and is bound to this session
  const grant = db.query(
    `SELECT id, allowed_paths, child_session_id, status, expires_at
     FROM dispatch_privilege_grants WHERE id = ? AND privilege = 'framework_maintenance'`,
  ).get(input.grantId) as any;

  if (!grant) {
    throw new Error(`[FRAMEWORK-PLAN] Grant ${input.grantId} not found`);
  }

  if (grant.child_session_id !== input.sessionId) {
    throw new Error(`[FRAMEWORK-PLAN] Grant ${input.grantId} is not bound to session ${input.sessionId}`);
  }

  if (grant.status !== "bound") {
    throw new Error(`[FRAMEWORK-PLAN] Grant ${input.grantId} is not in bound status`);
  }

  if (grant.expires_at < Date.now()) {
    throw new Error(`[FRAMEWORK-PLAN] Grant ${input.grantId} has expired`);
  }

  const allowedPaths: string[] = JSON.parse(grant.allowed_paths || "[]");
  const blockedPaths = policy.blockedPaths;

  for (const p of input.plannedPaths) {
    const normalized = p.replace(/\\/g, "/");
    if (!isFrameworkPathAllowed(normalized, allowedPaths, blockedPaths)) {
      throw new Error(
        `[FRAMEWORK-PLAN] Path "${p}" is not allowed by framework maintenance policy or grant allowlist`
      );
    }
  }

  // Reject if an active plan already exists for this session+grant
  const existing = db.query(
    `SELECT id FROM framework_maintenance_plans
     WHERE child_session_id = ? AND grant_id = ? AND status = 'active' LIMIT 1`,
  ).get(input.sessionId, input.grantId) as any;

  if (existing) {
    throw new Error(
      `[FRAMEWORK-PLAN] An active plan already exists for this session and grant. ` +
      `Complete it before creating a new one.`
    );
  }

  const now = Date.now();
  const id = randomUUID();
  const plannedPathsStr = JSON.stringify(input.plannedPaths.map((p) => p.replace(/\\/g, "/")));
  const codegraphTargetsStr = JSON.stringify(input.codegraphTargets);

  db.run(
    `INSERT INTO framework_maintenance_plans
     (id, grant_id, child_session_id, dag_task_id, planned_paths, codegraph_targets,
      rationale, risk_level, status, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.grantId, input.sessionId, input.dagTaskId || null,
      plannedPathsStr, codegraphTargetsStr, input.rationale,
      input.riskLevel || "medium", "active", now, now, null,
    ],
  );

  writeLog(SRC, "INFO", {
    event: "FRAMEWORK-PLAN-CREATED",
    planId: id,
    grantId: input.grantId,
    childSessionId: input.sessionId,
    plannedPaths: plannedPathsStr,
    codegraphTargets: codegraphTargetsStr,
  });

  return { id, grantId: input.grantId, plannedPaths: input.plannedPaths };
}

export function getActiveFrameworkMaintenancePlan(
  sessionId: string,
  grantId: string,
): FrameworkMaintenancePlan | null {
  const db = getDb();
  const row = db.query(
    `SELECT * FROM framework_maintenance_plans
     WHERE child_session_id = ? AND grant_id = ? AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
  ).get(sessionId, grantId) as any;

  return row ? (row as FrameworkMaintenancePlan) : null;
}

export function assertPathInActivePlan(
  sessionId: string,
  grantId: string,
  path: string,
): void {
  const plan = getActiveFrameworkMaintenancePlan(sessionId, grantId);
  if (!plan) {
    throw new Error("[FRAMEWORK-PLAN] No active framework maintenance plan. Create a plan before writing.");
  }

  const normalized = path.replace(/\\/g, "/");
  const plannedPaths: string[] = JSON.parse(plan.planned_paths || "[]");

  const inPlan = plannedPaths.some((p) => {
    if (p === normalized) return true;
    if (p.endsWith("/**")) {
      const prefix = p.slice(0, -3);
      return normalized === prefix || normalized.startsWith(prefix + "/");
    }
    return false;
  });

  if (!inPlan) {
    throw new Error(
      `[FRAMEWORK-PLAN] Target path "${path}" is not in the active plan. ` +
      `Planned paths: ${plannedPaths.join(", ")}`
    );
  }
}

export function completeFrameworkMaintenancePlan(sessionId: string, grantId: string): void {
  const db = getDb();
  const now = Date.now();

  db.run(
    `UPDATE framework_maintenance_plans SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE child_session_id = ? AND grant_id = ? AND status = 'active'`,
    [now, now, sessionId, grantId],
  );

  writeLog(SRC, "INFO", {
    event: "FRAMEWORK-PLAN-COMPLETED",
    childSessionId: sessionId,
    grantId,
  });
}
