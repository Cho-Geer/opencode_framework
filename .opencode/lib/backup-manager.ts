// backup-manager.ts — Git-backed backup management with DB-only logging
// ======================================================================
// All backup operations (safe_edit, safe_delete, migrations, rollbacks)
// MUST go through this module. Backups are stored in an independent git
// repo at .task_temp/.backups/ with full DB metadata in backup_log table.
//
// UUID links DB records to git commits for content retrieval.
// No file-based logs — DB-only, DB-canonical.
//
// @author @Super-Admin
// @version 1.0.0
// @since 2026-06-24

import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SRC = "lib-backup-manager";
const BACKUP_REPO = ".task_temp/.backups";

// ── Types ──────────────────────────────────────────────────────

export interface BackupCreateInput {
  filePath: string;
  reason: string;
  agent?: string;
  sessionId?: string;
  dagTaskId?: string;
  taskId?: string;
}

export interface BackupRecord {
  id: number;
  uuid: string;
  timestamp: string;
  event: string;
  agent: string;
  session_id: string | null;
  dag_task_id: string | null;
  dag_session_id: string | null;
  task_id: string | null;
  reason: string;
  original_file_path: string;
  backup_file_path: string;
  git_commit: string | null;
  file_size: number;
  file_hash: string;
  cleanup_time: string | null;
  cleanup_reason: string | null;
  status: string;
}

// ── Git Helpers ────────────────────────────────────────────────

function gitRepoPath(): string {
  return path.join(process.env.OPENCODE_ROOT || ".", BACKUP_REPO);
}

function git(args: string[]): string {
  return execFileSync("git", ["-C", gitRepoPath(), ...args], {
    encoding: "utf8",
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function ensureGitRepo(): void {
  const repoPath = gitRepoPath();
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", repoPath], {
      encoding: "utf8",
      timeout: 10000,
    });
    git(["config", "user.email", "backup@opencode-framework"]);
    git(["config", "user.name", "Backup Manager"]);
  }
}

// ── Core API ───────────────────────────────────────────────────

export function createBackup(input: BackupCreateInput): BackupRecord | null {
  const absPath = path.resolve(input.filePath);

  if (!fs.existsSync(absPath)) {
    const db = getDb();
    db.run(
      "INSERT INTO backup_log (uuid, timestamp, event, reason, original_file_path, backup_file_path, status) VALUES (?, ?, 'BACKUP-SKIP', ?, ?, '', 'skipped')",
      [crypto.randomUUID(), new Date().toISOString(), input.reason, absPath],
    );
    return null;
  }

  ensureGitRepo();
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = path.basename(absPath);
  const backupDir = path.join(gitRepoPath(), uuid);
  const backupFilePath = path.join(backupDir, fileName);

  // Copy file to backup repo
  fs.mkdirSync(backupDir, { recursive: true });
  const stat = fs.statSync(absPath);
  const fileHash = sha256File(absPath);
  fs.copyFileSync(absPath, backupFilePath);

  // Git add + commit
  git(["add", path.join(uuid, fileName)]);
  const commitMsg = [
    `backup: uuid=${uuid}`,
    `reason=${input.reason}`,
    `agent=${input.agent || "unknown"}`,
    `session=${input.sessionId || ""}`,
    `dag_task=${input.dagTaskId || ""}`,
  ].join(" ");
  git(["commit", "-m", commitMsg]);
  const commitHash = git(["rev-parse", "HEAD"]);

  // Resolve dag_session_id
  const dagSessionId = resolveDagSessionId(input.sessionId);

  // Insert DB record
  const db = getDb();
  db.run(
    `INSERT INTO backup_log
     (uuid, timestamp, event, agent, session_id, dag_task_id, dag_session_id, task_id,
      reason, original_file_path, backup_file_path, git_commit, file_size, file_hash, status)
     VALUES (?, ?, 'BACKUP-CREATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      uuid,
      now,
      input.agent || "unknown",
      input.sessionId || null,
      input.dagTaskId || null,
      dagSessionId,
      input.taskId || null,
      input.reason,
      absPath,
      backupFilePath,
      commitHash,
      stat.size,
      fileHash,
    ],
  );

  writeLog(SRC, "INFO", {
    event: "BACKUP-CREATED",
    detail: `uuid=${uuid} reason=${input.reason} file=${fileName} agent=${input.agent || "unknown"}`,
  });

  return getBackup(uuid);
}

export function getBackup(uuid: string): BackupRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM backup_log WHERE uuid = ?").get(uuid);
  return row ? (row as BackupRecord) : null;
}

export function findLatestBackup(filePath: string): BackupRecord | null {
  const db = getDb();
  const absPath = path.resolve(filePath);
  const row = db
    .query(
      "SELECT * FROM backup_log WHERE original_file_path = ? AND event = 'BACKUP-CREATED' AND status = 'active' ORDER BY timestamp DESC LIMIT 1",
    )
    .get(absPath);
  return row ? (row as BackupRecord) : null;
}

export function getBackupsByFile(filePath: string): BackupRecord[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM backup_log WHERE original_file_path = ? AND status = 'active' ORDER BY timestamp DESC",
    )
    .all(path.resolve(filePath)) as BackupRecord[];
}

export function getBackupsByAgent(agent: string): BackupRecord[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM backup_log WHERE agent = ? AND status = 'active' ORDER BY timestamp DESC",
    )
    .all(agent) as BackupRecord[];
}

export function getBackupsBySession(sessionId: string): BackupRecord[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM backup_log WHERE session_id = ? AND status = 'active' ORDER BY timestamp DESC",
    )
    .all(sessionId) as BackupRecord[];
}

export function getBackupsByDagTask(dagTaskId: string): BackupRecord[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM backup_log WHERE dag_task_id = ? AND status = 'active' ORDER BY timestamp DESC",
    )
    .all(dagTaskId) as BackupRecord[];
}

export function restoreBackup(uuid: string): {
  success: boolean;
  error?: string;
} {
  const record = getBackup(uuid);
  if (!record) return { success: false, error: `Backup not found: ${uuid}` };
  if (record.status !== "active")
    return {
      success: false,
      error: `Backup not active (status=${record.status})`,
    };

  // Restore from git: checkout file at commit
  const fileName = path.basename(record.original_file_path);
  const relPath = path.join(uuid, fileName);
  try {
    git(["checkout", record.git_commit!, "--", relPath]);
  } catch (e: any) {
    return { success: false, error: `Git checkout failed: ${e.message}` };
  }

  // Copy restored file to original location (atomic rename)
  const restoredPath = path.join(gitRepoPath(), relPath);
  const tmpPath = record.original_file_path + ".restore." + Date.now();
  fs.copyFileSync(restoredPath, tmpPath);
  fs.renameSync(tmpPath, record.original_file_path);

  // Update DB
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE backup_log SET status = 'restored', cleanup_time = ?, cleanup_reason = 'restored' WHERE uuid = ?",
    [now, uuid],
  );
  db.run(
    `INSERT INTO backup_log (uuid, timestamp, event, agent, session_id, dag_task_id, dag_session_id, task_id, reason, original_file_path, backup_file_path, git_commit, file_size, file_hash, status)
     VALUES (?, ?, 'BACKUP-RESTORED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'restored')`,
    [
      uuid,
      now,
      record.agent,
      record.session_id,
      record.dag_task_id,
      record.dag_session_id,
      record.task_id,
      record.reason,
      record.original_file_path,
      record.backup_file_path,
      record.git_commit,
      record.file_size,
      record.file_hash,
    ],
  );

  writeLog(SRC, "INFO", { event: "BACKUP-RESTORED", detail: `uuid=${uuid}` });
  return { success: true };
}

export function cleanupStaleBackups(ttlMs: number = 7 * 24 * 60 * 60 * 1000): {
  scanned: number;
  deleted: number;
} {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - ttlMs).toISOString();
  let scanned = 0;
  let deleted = 0;

  const expired = db
    .query(
      "SELECT * FROM backup_log WHERE status = 'active' AND event = 'BACKUP-CREATED' AND timestamp < ? ORDER BY timestamp ASC",
    )
    .all(cutoff) as BackupRecord[];

  for (const record of expired) {
    scanned++;
    try {
      git(["rm", "-r", "--ignore-unmatch", record.uuid]);
    } catch {}
    try {
      git(["commit", "-m", `cleanup: uuid=${record.uuid} reason=ttl`]);
    } catch {}
    db.run(
      "UPDATE backup_log SET status = 'cleaned', cleanup_time = ?, cleanup_reason = 'ttl' WHERE uuid = ?",
      [now.toISOString(), record.uuid],
    );
    deleted++;
  }

  if (deleted > 0) {
    try {
      git(["gc", "--prune=now"]);
    } catch {}
    writeLog(SRC, "INFO", {
      event: "BACKUP-CLEANUP",
      detail: `scanned=${scanned} deleted=${deleted}`,
    });
  }

  return { scanned, deleted };
}

// ── Helpers ────────────────────────────────────────────────────

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveDagSessionId(sessionId?: string): string | null {
  if (!sessionId) return null;
  try {
    const { dbReadSessionMap } = require("./db-state-manager");
    const entry = dbReadSessionMap(sessionId);
    return entry?.session_id || null;
  } catch {
    return null;
  }
}
