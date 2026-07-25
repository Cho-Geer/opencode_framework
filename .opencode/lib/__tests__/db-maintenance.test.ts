import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { closeDb, getDb } from "../db-manager";
import { runAuditCleanup } from "../db-maintenance";

let tempDir = "";

function setupTempDb(): void {
  closeDb();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-maintenance-"));
  process.env.FRAMEWORK_DB_PATH = path.join(tempDir, "framework-state.db");
  getDb({ forceReset: true });
}

function insertRepoGrant(input: {
  id: string;
  status: "pending" | "bound" | "consumed" | "revoked";
  expiresAt: number;
  createdAt: number;
  consumedAt?: number | null;
  revokedAt?: number | null;
}): void {
  const db = getDb();
  db.run(
    `INSERT INTO repo_operation_grants (
      id, dispatch_key, parent_session_id, child_session_id, dag_task_id,
      agent_type, privilege, allowed_tools, allowed_paths, allowed_remotes,
      reason, status, requires_human_confirmation, human_confirmed_at,
      expires_at, created_at, bound_at, consumed_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      `dispatch-${input.id}`,
      "parent-session",
      input.status === "bound" ? "child-session" : null,
      null,
      "build",
      "repo_maintenance",
      JSON.stringify(["safe_repo_commit"]),
      JSON.stringify(["src/example.ts"]),
      JSON.stringify([]),
      "test",
      input.status,
      0,
      null,
      input.expiresAt,
      input.createdAt,
      input.status === "bound" ? input.createdAt : null,
      input.consumedAt ?? null,
      input.revokedAt ?? null,
    ],
  );
}

function insertRepoEvent(id: string, createdAt: number): void {
  const db = getDb();
  db.run(
    `INSERT INTO repo_operation_events (
      id, session_id, agent, tool, operation_kind, provider,
      command_summary, paths, grant_id, result, commit_sha, error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      "session",
      "build",
      "safe_repo_commit",
      "local_write",
      "git",
      "git commit -m test",
      JSON.stringify(["src/example.ts"]),
      null,
      "success",
      null,
      null,
      createdAt,
    ],
  );
}

describe("runAuditCleanup repo grant cleanup", () => {
  beforeEach(() => {
    setupTempDb();
  });

  afterEach(() => {
    closeDb();
    delete process.env.FRAMEWORK_DB_PATH;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("revokes expired pending and bound repo grants", () => {
    const now = Date.now();
    insertRepoGrant({
      id: "expired-pending",
      status: "pending",
      expiresAt: now - 1_000,
      createdAt: now - 10_000,
    });
    insertRepoGrant({
      id: "expired-bound",
      status: "bound",
      expiresAt: now - 1_000,
      createdAt: now - 10_000,
    });

    runAuditCleanup(7, 10_000);

    const db = getDb();
    const pendingRow = db.query(
      "SELECT status, revoked_at FROM repo_operation_grants WHERE id = ?",
    ).get("expired-pending") as { status: string; revoked_at: number | null };
    const boundRow = db.query(
      "SELECT status, revoked_at FROM repo_operation_grants WHERE id = ?",
    ).get("expired-bound") as { status: string; revoked_at: number | null };

    expect(pendingRow.status).toBe("revoked");
    expect(boundRow.status).toBe("revoked");
    expect(pendingRow.revoked_at).toBeGreaterThan(0);
    expect(boundRow.revoked_at).toBeGreaterThan(0);
  });

  test("deletes old terminal repo grants and repo audit events", () => {
    const now = Date.now();
    const old = now - 9 * 24 * 60 * 60 * 1000;

    insertRepoGrant({
      id: "old-consumed",
      status: "consumed",
      expiresAt: old,
      createdAt: old,
      consumedAt: old,
    });
    insertRepoGrant({
      id: "old-revoked",
      status: "revoked",
      expiresAt: old,
      createdAt: old,
      revokedAt: old,
    });
    insertRepoGrant({
      id: "fresh-consumed",
      status: "consumed",
      expiresAt: now + 60_000,
      createdAt: now,
      consumedAt: now,
    });
    insertRepoEvent("event-old", old);
    insertRepoEvent("event-fresh", now);

    runAuditCleanup(7, 10_000);

    const db = getDb();
    const oldConsumed = db.query(
      "SELECT id FROM repo_operation_grants WHERE id = ?",
    ).get("old-consumed");
    const oldRevoked = db.query(
      "SELECT id FROM repo_operation_grants WHERE id = ?",
    ).get("old-revoked");
    const freshConsumed = db.query(
      "SELECT id FROM repo_operation_grants WHERE id = ?",
    ).get("fresh-consumed") as { id: string };
    const oldEvent = db.query(
      "SELECT id FROM repo_operation_events WHERE id = ?",
    ).get("event-old");
    const freshEvent = db.query(
      "SELECT id FROM repo_operation_events WHERE id = ?",
    ).get("event-fresh") as { id: string };

    expect(oldConsumed).toBeNull();
    expect(oldRevoked).toBeNull();
    expect(freshConsumed.id).toBe("fresh-consumed");
    expect(oldEvent).toBeNull();
    expect(freshEvent.id).toBe("event-fresh");
  });
});
