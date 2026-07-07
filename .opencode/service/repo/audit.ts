import type { RepoOperation } from "./types";
import { writeLog } from "../../lib/log-manager";

const SRC = "repo-operation-runtime";

function getLogDir(): string {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `.task_temp/_logs/${date}`;
}

export interface RepoAuditEvent {
  event: string;
  session_id?: string;
  agent?: string;
  tool?: string;
  operation_kind?: string;
  provider?: string;
  command_summary?: string;
  paths?: string[];
  grant_id?: string;
  result: string;
  commit_sha?: string;
  error?: string;
  created_at: number;
}

export function writeRepoAuditEvent(event: RepoAuditEvent): void {
  writeLog(SRC, "INFO", event);
}

export function auditRepoRead(
  session_id: string,
  agent: string,
  tool: string,
  op: RepoOperation,
  result: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-READ-ALLOWED",
    session_id,
    agent,
    tool,
    operation_kind: op.kind,
    provider: op.provider,
    command_summary: op.command,
    paths: op.paths,
    result,
    created_at: Date.now(),
  });
}

export function auditRepoWriteGrantMissing(
  session_id: string,
  agent: string,
  tool: string,
  op: RepoOperation,
): void {
  writeRepoAuditEvent({
    event: "REPO-WRITE-GRANT-MISSING",
    session_id,
    agent,
    tool,
    operation_kind: op.kind,
    provider: op.provider,
    command_summary: op.command,
    paths: op.paths,
    result: "blocked",
    created_at: Date.now(),
  });
}

export function auditRepoWriteGrantBound(
  session_id: string,
  agent: string,
  grant_id: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-WRITE-GRANT-BOUND",
    session_id,
    agent,
    tool: "",
    grant_id,
    result: "bound",
    created_at: Date.now(),
  });
}

export function auditRepoWriteStaged(
  session_id: string,
  agent: string,
  tool: string,
  paths: string[],
  grant_id?: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-WRITE-STAGED",
    session_id,
    agent,
    tool,
    operation_kind: "local_write",
    provider: "git",
    paths,
    grant_id,
    result: "staged",
    created_at: Date.now(),
  });
}

export function auditRepoCommitSuccess(
  session_id: string,
  agent: string,
  commit_sha: string,
  paths: string[],
  grant_id?: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-COMMIT-SUCCESS",
    session_id,
    agent,
    tool: "safe_repo_commit",
    operation_kind: "local_write",
    provider: "git",
    paths,
    grant_id,
    result: "success",
    commit_sha,
    created_at: Date.now(),
  });
}

export function auditRepoCommitHookFailed(
  session_id: string,
  agent: string,
  error: string,
  grant_id?: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-COMMIT-HOOK-FAILED",
    session_id,
    agent,
    tool: "safe_repo_commit",
    operation_kind: "local_write",
    provider: "git",
    result: "hook_failed",
    grant_id,
    error,
    created_at: Date.now(),
  });
}

export function auditRepoRemoteWriteBlocked(
  session_id: string,
  agent: string,
  tool: string,
  reason: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-REMOTE-WRITE-BLOCKED",
    session_id,
    agent,
    tool,
    operation_kind: "remote_write",
    result: "blocked",
    error: reason,
    created_at: Date.now(),
  });
}

export function auditRepoHookBypassBlocked(
  session_id: string,
  agent: string,
  tool: string,
  command_summary: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-HOOK-BYPASS-BLOCKED",
    session_id,
    agent,
    tool,
    operation_kind: "hook_bypass",
    command_summary,
    result: "blocked",
    created_at: Date.now(),
  });
}

export function auditRepoScoutWriteBlocked(
  session_id: string,
  agent: string,
  tool: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-SCOUT-WRITE-BLOCKED",
    session_id,
    agent,
    tool,
    result: "blocked",
    created_at: Date.now(),
  });
}

export function auditRepoClassified(
  op: RepoOperation,
  session_id?: string,
): void {
  writeRepoAuditEvent({
    event: "REPO-OP-CLASSIFIED",
    session_id,
    tool: "",
    operation_kind: op.kind,
    provider: op.provider,
    command_summary: op.command,
    paths: op.paths,
    result: op.decision,
    created_at: Date.now(),
  });
}
