import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

const SRC = "repo-grants";

export type RepoPrivilege =
  | "repo_maintenance"
  | "remote_repo_write"
  | "repo_destructive_emergency";

export interface RepoGrant {
  id: string;
  dispatch_key: string;
  parent_session_id: string;
  child_session_id: string | null;
  dag_task_id: string | null;
  agent_type: string;
  privilege: RepoPrivilege;
  allowed_tools: string;
  allowed_paths: string;
  allowed_remotes: string;
  reason: string;
  status: "pending" | "bound" | "consumed" | "revoked";
  requires_human_confirmation: 0 | 1;
  human_confirmed_at: number | null;
  expires_at: number;
  created_at: number;
  bound_at: number | null;
  consumed_at: number | null;
  revoked_at: number | null;
}

export interface CreateRepoGrantInput {
  dispatch_key: string;
  parent_session_id: string;
  agent_type: string;
  privilege: RepoPrivilege;
  allowed_tools: string[];
  allowed_paths: string[];
  allowed_remotes?: string[];
  reason: string;
  dag_task_id?: string;
  ttl_ms?: number;
  requires_human_confirmation?: boolean;
}

export interface ConfirmLatestRepoGrantInput {
  parent_session_id: string;
  privilege: RepoPrivilege;
  agent_type?: string;
  allowed_remote?: string;
}

const DEFAULT_TTL_MS: Record<RepoPrivilege, number> = {
  repo_maintenance: 30 * 60 * 1000,
  remote_repo_write: 10 * 60 * 1000,
  repo_destructive_emergency: 5 * 60 * 1000,
};

const RUNTIME_BLOCKED_PATTERNS = [
  ".opencode/state.db",
  ".opencode/state/",
  ".opencode/_test_framework/",
  ".task_temp/",
  "node_modules/",
];

export function toRepoRelativePath(inputPath: string, root?: string): string {
  const repoRoot = root || process.cwd();
  if (path.isAbsolute(inputPath)) {
    const rel = path.relative(repoRoot, inputPath);
    if (rel.startsWith("..")) return inputPath;
    return rel;
  }
  return inputPath;
}

export function isPathAllowedByPatterns(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of patterns) {
    const p = pattern.replace(/\\/g, "/");
    if (p.endsWith("/**")) {
      const prefix = p.slice(0, -3);
      if (normalized === prefix || normalized.startsWith(prefix + "/")) return true;
    } else if (p.endsWith("/*")) {
      const prefix = p.slice(0, -2);
      if (normalized.startsWith(prefix + "/") && !normalized.slice(prefix.length + 1).includes("/")) return true;
    } else {
      if (normalized === p) return true;
    }
  }
  return false;
}

export function assertNoRuntimeStatePaths(paths: string[]): void {
  for (const p of paths) {
    const normalized = p.replace(/\\/g, "/");
    for (const blocked of RUNTIME_BLOCKED_PATTERNS) {
      if (normalized === blocked || normalized.startsWith(blocked)) {
        throw new Error(
          `[REPO-RUNTIME-PATH-BLOCKED] Path "${p}" matches blocked pattern "${blocked}". ` +
          `Runtime state and test scaffold files must not be staged or committed.`,
        );
      }
    }
    if (normalized.includes("..")) {
      throw new Error(
        `[REPO-PATH-TRAVERSAL-BLOCKED] Path "${p}" contains path traversal ("..").`,
      );
    }
  }
}

export function createRepoGrant(input: CreateRepoGrantInput): RepoGrant | null {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = Date.now();
    const ttl = input.ttl_ms || DEFAULT_TTL_MS[input.privilege];
    const expiresAt = now + ttl;

    const requiresHuman = (
      input.privilege === "remote_repo_write" ||
      input.privilege === "repo_destructive_emergency" ||
      input.requires_human_confirmation === true
    ) ? 1 : 0;

    const grant: RepoGrant = {
      id,
      dispatch_key: input.dispatch_key,
      parent_session_id: input.parent_session_id,
      child_session_id: null,
      dag_task_id: input.dag_task_id || null,
      agent_type: input.agent_type,
      privilege: input.privilege,
      allowed_tools: JSON.stringify(input.allowed_tools),
      allowed_paths: JSON.stringify(input.allowed_paths),
      allowed_remotes: JSON.stringify(input.allowed_remotes || []),
      reason: input.reason,
      status: "pending",
      requires_human_confirmation: requiresHuman as 0 | 1,
      human_confirmed_at: null,
      expires_at: expiresAt,
      created_at: now,
      bound_at: null,
      consumed_at: null,
      revoked_at: null,
    };

    db.run(
      `INSERT INTO repo_operation_grants (
        id, dispatch_key, parent_session_id, child_session_id, dag_task_id,
        agent_type, privilege, allowed_tools, allowed_paths, allowed_remotes,
        reason, status, requires_human_confirmation, human_confirmed_at,
        expires_at, created_at, bound_at, consumed_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grant.id, grant.dispatch_key, grant.parent_session_id, grant.child_session_id,
        grant.dag_task_id, grant.agent_type, grant.privilege, grant.allowed_tools,
        grant.allowed_paths, grant.allowed_remotes, grant.reason, grant.status,
        grant.requires_human_confirmation, grant.human_confirmed_at,
        grant.expires_at, grant.created_at, grant.bound_at,
        grant.consumed_at, grant.revoked_at,
      ],
    );

    writeLog(SRC, "INFO", {
      event: "REPO-GRANT-CREATED",
      grant_id: id,
      privilege: input.privilege,
      dispatch_key: input.dispatch_key,
      expires_at: expiresAt,
    });

    return grant;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "REPO-GRANT-CREATE-FAILED",
      error: e.message,
    });
    return null;
  }
}

export function bindRepoGrant(dispatchKey: string, childSessionId: string): RepoGrant | null {
  try {
    const db = getDb();
    const now = Date.now();

    const row = db.query(
      `SELECT * FROM repo_operation_grants
       WHERE dispatch_key = ? AND status = 'pending' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(dispatchKey, now) as any;

    if (!row) {
      writeLog(SRC, "WARN", {
        event: "REPO-GRANT-BIND-NO-MATCH",
        dispatch_key: dispatchKey,
        child_session_id: childSessionId,
      });
      return null;
    }

    db.run(
      `UPDATE repo_operation_grants
       SET child_session_id = ?, status = 'bound', bound_at = ?
       WHERE id = ?`,
      [childSessionId, now, row.id],
    );

    writeLog(SRC, "INFO", {
      event: "REPO-GRANT-BOUND",
      grant_id: row.id,
      child_session_id: childSessionId,
      dispatch_key: dispatchKey,
    });

    return { ...row, child_session_id: childSessionId, status: "bound", bound_at: now } as RepoGrant;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "REPO-GRANT-BIND-FAILED",
      error: e.message,
    });
    return null;
  }
}

export function confirmRepoGrant(
  grantId: string,
  confirmerSessionId: string,
  confirmationNote?: string,
): RepoGrant | null {
  try {
    const db = getDb();
    const now = Date.now();

    const row = db.query(
      `SELECT * FROM repo_operation_grants WHERE id = ? AND status IN ('pending', 'bound')`,
    ).get(grantId) as any;

    if (!row) {
      writeLog(SRC, "WARN", {
        event: "REPO-GRANT-CONFIRM-NO-MATCH",
        grant_id: grantId,
      });
      return null;
    }

    db.run(
      `UPDATE repo_operation_grants SET human_confirmed_at = ? WHERE id = ?`,
      [now, grantId],
    );

    writeLog(SRC, "INFO", {
      event: "REPO-GRANT-CONFIRMED",
      grant_id: grantId,
      confirmer_session_id: confirmerSessionId,
      note: confirmationNote || undefined,
    });

    return { ...row, human_confirmed_at: now } as RepoGrant;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "REPO-GRANT-CONFIRM-FAILED",
      error: e.message,
    });
    return null;
  }
}

export function confirmLatestRepoGrantForParent(
  input: ConfirmLatestRepoGrantInput,
  confirmerSessionId: string,
  confirmationNote?: string,
): RepoGrant | null {
  try {
    const db = getDb();
    const now = Date.now();

    const rows = db.query(
      `SELECT * FROM repo_operation_grants
       WHERE parent_session_id = ? AND privilege = ? AND status IN ('pending', 'bound') AND expires_at > ?
       ORDER BY created_at DESC`,
    ).all(input.parent_session_id, input.privilege, now) as any[];

    const row = rows.find((candidate) => {
      if (input.agent_type && candidate.agent_type !== input.agent_type) return false;
      if (!input.allowed_remote) return true;
      const allowedRemotes: string[] = JSON.parse(candidate.allowed_remotes || "[]");
      return allowedRemotes.length === 0 || allowedRemotes.includes(input.allowed_remote);
    });

    if (!row) {
      writeLog(SRC, "WARN", {
        event: "REPO-GRANT-CONFIRM-NO-PARENT-MATCH",
        parent_session_id: input.parent_session_id,
        privilege: input.privilege,
        agent_type: input.agent_type,
        allowed_remote: input.allowed_remote,
      });
      return null;
    }

    if (row.human_confirmed_at) {
      writeLog(SRC, "INFO", {
        event: "REPO-GRANT-CONFIRM-ALREADY-CONFIRMED",
        grant_id: row.id,
        confirmer_session_id: confirmerSessionId,
      });
      return row as RepoGrant;
    }

    return confirmRepoGrant(row.id, confirmerSessionId, confirmationNote);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "REPO-GRANT-CONFIRM-PARENT-LOOKUP-FAILED",
      error: e.message,
      parent_session_id: input.parent_session_id,
      privilege: input.privilege,
    });
    return null;
  }
}

export function hasRepoGrant(
  childSessionId: string,
  privilege: RepoPrivilege,
  toolName: string,
  paths?: string[],
  remotes?: string[],
): RepoGrant | null {
  try {
    const db = getDb();
    const now = Date.now();

    const row = db.query(
      `SELECT * FROM repo_operation_grants
       WHERE child_session_id = ? AND privilege = ? AND status = 'bound' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(childSessionId, privilege, now) as any;

    if (!row) {
      writeLog(SRC, "WARN", {
        event: "REPO-GRANT-MISSING",
        child_session_id: childSessionId,
        privilege,
        tool: toolName,
      });
      return null;
    }

    if (row.requires_human_confirmation === 1 && !row.human_confirmed_at) {
      writeLog(SRC, "WARN", {
        event: "REPO-GRANT-HUMAN-CONFIRMATION-REQUIRED",
        grant_id: row.id,
        tool: toolName,
      });
      return null;
    }

    const allowedTools: string[] = JSON.parse(row.allowed_tools || "[]");
    if (allowedTools.length > 0 && !allowedTools.includes(toolName)) {
      writeLog(SRC, "WARN", {
        event: "REPO-GRANT-TOOL-MISMATCH",
        grant_id: row.id,
        requested_tool: toolName,
        allowed_tools: allowedTools,
      });
      return null;
    }

    if (paths && paths.length > 0) {
      const allowedPaths: string[] = JSON.parse(row.allowed_paths || "[]");
      if (allowedPaths.length > 0) {
        for (const p of paths) {
          const rel = toRepoRelativePath(p);
          if (!isPathAllowedByPatterns(rel, allowedPaths)) {
            writeLog(SRC, "WARN", {
              event: "REPO-GRANT-PATH-MISMATCH",
              grant_id: row.id,
              requested_path: rel,
              allowed_paths: allowedPaths,
            });
            return null;
          }
        }
      }
    }

    if (remotes && remotes.length > 0) {
      const allowedRemotes: string[] = JSON.parse(row.allowed_remotes || "[]");
      if (allowedRemotes.length > 0) {
        for (const r of remotes) {
          if (!allowedRemotes.includes(r)) {
            writeLog(SRC, "WARN", {
              event: "REPO-GRANT-REMOTE-MISMATCH",
              grant_id: row.id,
              requested_remote: r,
              allowed_remotes: allowedRemotes,
            });
            return null;
          }
        }
      }
    }

    return row as RepoGrant;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "REPO-GRANT-CHECK-FAILED",
      error: e.message,
    });
    return null;
  }
}

export function consumeRepoGrant(grantId: string): void {
  try {
    const db = getDb();
    const now = Date.now();

    db.run(
      `UPDATE repo_operation_grants SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'bound'`,
      [now, grantId],
    );

    writeLog(SRC, "INFO", {
      event: "REPO-GRANT-CONSUMED",
      grant_id: grantId,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "REPO-GRANT-CONSUME-FAILED",
      error: e.message,
    });
  }
}

export function revokeRepoGrant(grantId: string, reason?: string): void {
  try {
    const db = getDb();
    const now = Date.now();

    db.run(
      `UPDATE repo_operation_grants SET status = 'revoked', revoked_at = ? WHERE id = ? AND status IN ('pending', 'bound')`,
      [now, grantId],
    );

    writeLog(SRC, "INFO", {
      event: "REPO-GRANT-REVOKED",
      grant_id: grantId,
      reason: reason || "manual",
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "REPO-GRANT-REVOKE-FAILED",
      error: e.message,
    });
  }
}
