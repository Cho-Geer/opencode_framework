// service/dispatch/privilege.ts — DB-backed dispatch privilege grant lifecycle
// P1: Orchestrator can create one-time framework maintenance grants

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import { randomUUID } from "node:crypto";
import {
  getFrameworkMaintenancePolicy,
  resolveGrantAllowedPaths,
  resolveGrantMaxWrites,
} from "./framework-maintenance-policy";

const SRC = "service-dispatch-privilege";

const ALLOWED_PRIVILEGES = new Set(["framework_maintenance"]);
const DEFAULT_TTL_MS = 45 * 60 * 1000;

export interface PrivilegeGrant {
  id: string;
  dispatch_key: string;
  parent_session_id: string;
  child_session_id: string | null;
  dag_task_id: string | null;
  agent_type: string;
  privilege: string;
  allowed_tools: string;
  allowed_paths: string;
  reason: string;
  status: string;
  max_writes: number;
  writes_used: number;
  policy_version: string;
  completed_at: number | null;
  expires_at: number;
  created_at: number;
  bound_at: number | null;
  consumed_at: number | null;
  revoked_at: number | null;
}

export interface CreateGrantInput {
  dispatch_key: string;
  parent_session_id: string;
  agent_type: string;
  privilege: string;
  allowed_tools: string[];
  allowed_paths?: string[];
  max_writes?: number;
  reason: string;
  dag_task_id?: string;
  ttl_ms?: number;
}

export function createGrant(input: CreateGrantInput): PrivilegeGrant | null {
  if (!ALLOWED_PRIVILEGES.has(input.privilege)) {
    writeLog(SRC, "WARN", {
      event: "GRANT-REJECTED-INVALID-PRIVILEGE",
      privilege: input.privilege,
      parent: input.parent_session_id,
    });
    return null;
  }

  if (!input.dispatch_key) {
    writeLog(SRC, "WARN", {
      event: "GRANT-REJECTED-NO-DISPATCH-KEY",
      parent: input.parent_session_id,
    });
    return null;
  }

  const policy = getFrameworkMaintenancePolicy();
  const allowedPaths = input.allowed_paths
    ? resolveGrantAllowedPaths(input.allowed_paths)
    : resolveGrantAllowedPaths();
  const maxWrites = resolveGrantMaxWrites(input.max_writes);

  const now = Date.now();
  const ttl = input.ttl_ms || DEFAULT_TTL_MS;
  const grant: PrivilegeGrant = {
    id: randomUUID(),
    dispatch_key: input.dispatch_key,
    parent_session_id: input.parent_session_id,
    child_session_id: null,
    dag_task_id: input.dag_task_id || null,
    agent_type: input.agent_type,
    privilege: input.privilege,
    allowed_tools: JSON.stringify(input.allowed_tools),
    allowed_paths: JSON.stringify(allowedPaths),
    reason: input.reason,
    status: "pending",
    max_writes: maxWrites,
    writes_used: 0,
    policy_version: policy.policyVersion,
    completed_at: null,
    expires_at: now + ttl,
    created_at: now,
    bound_at: null,
    consumed_at: null,
    revoked_at: null,
  };

  const db = getDb();
  db.run(
    `INSERT INTO dispatch_privilege_grants
      (id, dispatch_key, parent_session_id, child_session_id, dag_task_id,
       agent_type, privilege, allowed_tools, allowed_paths, reason,
       status, max_writes, writes_used, policy_version, completed_at,
       expires_at, created_at, bound_at, consumed_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      grant.id, grant.dispatch_key, grant.parent_session_id, grant.child_session_id,
      grant.dag_task_id, grant.agent_type, grant.privilege, grant.allowed_tools,
      grant.allowed_paths, grant.reason, grant.status, grant.max_writes,
      grant.writes_used, grant.policy_version, grant.completed_at,
      grant.expires_at, grant.created_at, grant.bound_at, grant.consumed_at,
      grant.revoked_at,
    ],
  );

  writeLog(SRC, "INFO", {
    event: "GRANT-CREATED",
    grantId: grant.id,
    privilege: grant.privilege,
    dispatchKey: grant.dispatch_key,
    parent: grant.parent_session_id,
    maxWrites: grant.max_writes,
    allowedPaths: grant.allowed_paths,
    expiresAt: grant.expires_at,
  });

  return grant;
}

export function bindGrant(dispatchKey: string, childSessionId: string): PrivilegeGrant | null {
  const db = getDb();
  const now = Date.now();

  writeLog(SRC, "INFO", {
    event: "GRANT-BIND-QUERY",
    dispatchKey,
    childSessionId,
    detail: `Querying pending grants for dispatch_key=${dispatchKey.slice(0, 16)}...`,
  });

  const row = db.query(
    `SELECT * FROM dispatch_privilege_grants
     WHERE dispatch_key = ? AND status = 'pending' AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(dispatchKey, now) as any;

  if (!row) {
    writeLog(SRC, "INFO", {
      event: "GRANT-BIND-NO-MATCH",
      dispatchKey,
      childSessionId,
      detail: `No pending grant found (dispatch_key=${dispatchKey.slice(0, 16)}... expired or already bound)`,
    });
    return null;
  }

  db.run(
    `UPDATE dispatch_privilege_grants
     SET child_session_id = ?, status = 'bound', bound_at = ?
     WHERE id = ?`,
    [childSessionId, now, row.id],
  );

  writeLog(SRC, "INFO", {
    event: "GRANT-BOUND",
    grantId: row.id,
    childSessionId,
    dispatchKey,
    privilege: row.privilege,
    agentType: row.agent_type,
    dagTaskId: row.dag_task_id || "none",
    detail: `Grant bound successfully | grant=${row.id} child=${childSessionId}`,
  });

  return { ...row, child_session_id: childSessionId, status: "bound", bound_at: now };
}

export function hasGrant(
  childSessionId: string,
  privilege: string,
  filePath?: string,
): PrivilegeGrant | null {
  const db = getDb();
  const now = Date.now();

  const row = db.query(
    `SELECT * FROM dispatch_privilege_grants
     WHERE child_session_id = ? AND privilege = ? AND status = 'bound' AND expires_at > ?
     ORDER BY bound_at DESC LIMIT 1`,
  ).get(childSessionId, privilege, now) as any;

  if (!row) return null;

  if (row.writes_used >= row.max_writes) {
    writeLog(SRC, "WARN", {
      event: "GRANT-WRITE-BUDGET-EXHAUSTED",
      grantId: row.id,
      writesUsed: row.writes_used,
      maxWrites: row.max_writes,
    });
    return null;
  }

  if (filePath) {
    const allowedPaths: string[] = JSON.parse(row.allowed_paths || "[]");
    const matched = allowedPaths.some((p: string) => {
      if (p === filePath) return true;
      if (p.endsWith("/**")) return filePath.startsWith(p.slice(0, -3));
      if (p.endsWith("/*")) return filePath.startsWith(p.slice(0, -2));
      return false;
    });
    if (!matched) {
      writeLog(SRC, "WARN", {
        event: "GRANT-PATH-MISMATCH",
        grantId: row.id,
        filePath,
        allowedPaths: row.allowed_paths,
      });
      return null;
    }
  }

  return row as PrivilegeGrant;
}

export function recordGrantWrite(grantId: string): void {
  const db = getDb();
  const now = Date.now();

  const row = db.query(
    `SELECT max_writes, writes_used FROM dispatch_privilege_grants WHERE id = ? AND status = 'bound'`,
  ).get(grantId) as any;

  if (!row) {
    writeLog(SRC, "WARN", { event: "GRANT-WRITE-RECORD-FAILED", grantId, reason: "not found or not bound" });
    return;
  }

  const newWritesUsed = (row.writes_used || 0) + 1;
  const shouldConsume = newWritesUsed >= row.max_writes;

  db.run(
    `UPDATE dispatch_privilege_grants SET writes_used = ?${shouldConsume ? ", status = 'consumed', consumed_at = ?" : ""} WHERE id = ? AND status = 'bound'`,
    shouldConsume ? [newWritesUsed, now, grantId] : [newWritesUsed, grantId],
  );

  writeLog(SRC, "INFO", {
    event: "GRANT-WRITE-RECORDED",
    grantId,
    writesUsed: newWritesUsed,
    maxWrites: row.max_writes,
    consumed: shouldConsume,
  });
}

export function completeGrant(grantId: string): void {
  const db = getDb();
  const now = Date.now();

  db.run(
    `UPDATE dispatch_privilege_grants SET status = 'consumed', consumed_at = ?, completed_at = ? WHERE id = ? AND status = 'bound'`,
    [now, now, grantId],
  );

  writeLog(SRC, "INFO", { event: "GRANT-COMPLETED", grantId });
}

export function consumeGrant(grantId: string): void {
  const db = getDb();
  db.run(
    `UPDATE dispatch_privilege_grants SET status = 'consumed', consumed_at = ? WHERE id = ?`,
    [Date.now(), grantId],
  );
  writeLog(SRC, "INFO", { event: "GRANT-CONSUMED", grantId });
}

export function revokeGrant(grantId: string): void {
  const db = getDb();
  db.run(
    `UPDATE dispatch_privilege_grants SET status = 'revoked', revoked_at = ? WHERE id = ?`,
    [Date.now(), grantId],
  );
  writeLog(SRC, "INFO", { event: "GRANT-REVOKED", grantId });
}
