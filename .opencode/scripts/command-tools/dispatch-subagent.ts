#!/usr/bin/env bun
"use strict";

// dispatch-subagent.ts — CLI thin shell for dispatch prompt generation
// ═══════════════════════════════════════════════════════════════
// Phase 4B: Business logic extracted to service/dispatch/prompt-builder.ts
// This file handles CLI arg parsing, output file writing, and queue management.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { checklistWirePassed } from "../../service/gate/checklist-hooks";
const { generatePayloadId } = require("../../service/gate/checklist-phase");
const { recordDispatchPayloadIntegrity } = require("../../service/gate/checklist-payload");
import { buildDispatchPrompt } from "../../service/dispatch/prompt-builder";

const OPENCODE_ROOT = process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", "..", "..");
const OUTPUT_DIR = path.join(OPENCODE_ROOT, ".task_temp", "_dispatch");

// ── CLI argument parsing ──
let sessionNamespace = process.env.DISPATCH_NAMESPACE || null;
let dagTaskId = process.env.DISPATCH_DAG_TASK_ID || null;
let taskId: string | null = null;

// Detect 2+ positional params: <agent_type> "<session_namespace>" "<task_description>"
if (process.argv.length >= 5 && !process.argv[3].startsWith("--")) {
  taskId = process.argv[3];
  if (!sessionNamespace) sessionNamespace = taskId;
  process.argv.splice(3, 1);
}

// Fall back to --task-id CLI flag
if (!taskId) {
  const idx = process.argv.indexOf("--task-id");
  if (idx !== -1 && idx + 1 < process.argv.length) {
    taskId = process.argv[idx + 1];
    if (!sessionNamespace) sessionNamespace = taskId;
    process.argv.splice(idx, 2);
  }
}

if (!dagTaskId) dagTaskId = sessionNamespace || taskId;
if (!sessionNamespace) sessionNamespace = dagTaskId || taskId;
if (!taskId) taskId = sessionNamespace;

const agentType = process.argv[2];
const taskDescription = process.env.DISPATCH_TASK_DESC || process.argv[3] || "";

if (!agentType || !taskDescription) {
  console.error('Usage: bun dispatch-subagent.ts <agent_type> "<task_description>" [--task-id <id>]');
  process.exit(1);
}

// ── Build prompt via service layer ──
let result;
try {
  result = buildDispatchPrompt({
    agentType,
    taskDescription,
    taskId,
    dagTaskId,
    openCodeRoot: OPENCODE_ROOT,
  });
} catch (e: any) {
  writeLog("dispatch-subagent", "ERROR", { event: "PROMPT_BUILD_FAILED", detail: e.message });
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}

// ── Write output file ──
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputFile = path.join(OUTPUT_DIR, `dispatch-${agentType}-${timestamp}.md`);
fs.writeFileSync(outputFile, result.prompt, "utf8");

// ── Checklist wiring ──
const sessionId = process.env.OPENCODE_SESSION_ID || "";
try {
  checklistWirePassed(sessionId, agentType, taskId, "payload_complete", "prompt saved to " + outputFile);
  checklistWirePassed(sessionId, agentType, taskId, "dispatch_token_created", "token=" + result.dispatchToken.substring(0, 16));
  checklistWirePassed(sessionId, agentType, taskId, "session_context_bound", "child slot bound to " + (taskId || "none"));
} catch (e: any) {
  writeLog("dispatch-subagent", "WARN", { event: "CHECKLIST_WIRE_FAILED", detail: e.message });
}

// ── Record dispatch payload integrity for child inheritance ──
try {
  recordDispatchPayloadIntegrity({
    payload_id: generatePayloadId(),
    parent_session_id: sessionId || null,
    agent_type: agentType,
    dag_task_id: dagTaskId,
    task_description: taskDescription,
    normalized_payload: result.prompt,
    sha256: result.promptHash || "",
    completeness_status: (result.prompt && result.prompt.length > 20) ? "complete" : "incomplete",
    prompt_path: outputFile,
  });
} catch (e: any) {
  writeLog("dispatch-subagent", "WARN", { event: "DISPATCH-PAYLOAD-INTEGRITY-FAILED", detail: e.message });
}

// ── DB dedup check ──
try {
  const { dbCheckDuplicateDispatch } = require("../../lib/dispatch-db");
  if (dbCheckDuplicateDispatch(agentType, dagTaskId || "(no-task-id)")) {
    writeLog("dispatch-subagent", "WARN", { event: "DISPATCH-DEDUP-BLOCKED", detail: `Duplicate dispatch for ${agentType}:${dagTaskId}` });
    console.error("FATAL: Duplicate dispatch detected");
    process.exit(1);
  }
} catch { /* DB unavailable */ }

// ── DB enqueue (fatal) ──
const dispatchKey = process.env.DISPATCH_KEY || result.dispatchToken || null;
const parentSessionId = process.env.OPENCODE_SESSION_ID || null;
const callId = process.env.DISPATCH_CALL_ID || null;
let queueId: number | null = null;
try {
  const { dbEnqueueDispatch } = require("../../lib/dispatch-db");
  queueId = dbEnqueueDispatch(
    agentType, dagTaskId || taskId || "(no-task-id)", outputFile, result.promptHash,
    Buffer.byteLength(result.prompt, "utf8"),
    dispatchKey || undefined, parentSessionId || undefined,
    callId || undefined,
  );
  if (!queueId) {
    console.error("FATAL: DB enqueue failed");
    process.exit(1);
  }
} catch (e: any) {
  console.error("FATAL: DB enqueue failed: " + e.message);
  process.exit(1);
}

// ── P1: Privilege grant creation ──
const dispatchPrivilege = process.env.DISPATCH_PRIVILEGE || "";
if (dispatchPrivilege) {
  try {
    const allowedPathsStr = process.env.DISPATCH_ALLOWED_PATHS || "";
    const allowedPaths = allowedPathsStr ? allowedPathsStr.split(",").map((p: string) => p.trim()) : [];
    const allowedRemotesStr = process.env.DISPATCH_ALLOWED_REMOTES || "";
    const allowedRemotes = allowedRemotesStr ? allowedRemotesStr.split(",").map((p: string) => p.trim()) : [];
    const grantDispatchKey = dispatchKey || require("node:crypto").randomUUID();
    const reason = process.env.DISPATCH_PRIVILEGE_REASON || "Dispatch privilege";

    const REPO_PRIVILEGES = new Set(["repo_maintenance", "remote_repo_write", "repo_destructive_emergency"]);

    if (REPO_PRIVILEGES.has(dispatchPrivilege)) {
      const { createRepoGrant } = require("../../service/repo/grants");
      const repoTools = dispatchPrivilege === "repo_maintenance"
        ? ["safe_repo_stage", "safe_repo_unstage", "safe_repo_commit"]
        : dispatchPrivilege === "remote_repo_write"
          ? ["safe_repo_push", "safe_gh_pr_create", "safe_gh_pr_comment", "safe_gh_issue_comment"]
          : [];
      const grant = createRepoGrant({
        dispatch_key: grantDispatchKey,
        parent_session_id: sessionId || "unknown",
        agent_type: agentType,
        privilege: dispatchPrivilege as any,
        allowed_tools: repoTools,
        allowed_paths: allowedPaths,
        allowed_remotes: allowedRemotes,
        reason,
        dag_task_id: dagTaskId || undefined,
        requires_human_confirmation: dispatchPrivilege !== "repo_maintenance",
      });
      if (grant) {
        writeLog("dispatch-subagent", "INFO", {
          event: "REPO-GRANT-CREATED",
          grantId: grant.id,
          privilege: grant.privilege,
          dispatchKey: grant.dispatch_key,
        });
      } else {
        writeLog("dispatch-subagent", "WARN", {
          event: "REPO-GRANT-CREATION-FAILED",
          privilege: dispatchPrivilege,
        });
      }
    } else {
      const { createGrant } = require("../../service/dispatch/privilege");
      const grant = createGrant({
        dispatch_key: grantDispatchKey,
        parent_session_id: sessionId || "unknown",
        agent_type: agentType,
        privilege: dispatchPrivilege,
        allowed_tools: ["safe_framework_edit"],
        allowed_paths: allowedPaths,
        reason,
        dag_task_id: dagTaskId || undefined,
      });
      if (grant) {
        writeLog("dispatch-subagent", "INFO", {
          event: "PRIVILEGE-GRANT-CREATED",
          grantId: grant.id,
          privilege: grant.privilege,
          dispatchKey: grant.dispatch_key,
        });
      } else {
        writeLog("dispatch-subagent", "WARN", {
          event: "PRIVILEGE-GRANT-CREATION-FAILED",
          privilege: dispatchPrivilege,
        });
      }
    }
  } catch (e: any) {
    writeLog("dispatch-subagent", "WARN", {
      event: "PRIVILEGE-GRANT-ERROR",
      detail: e.message,
    });
  }
}
// ── Output file path + queue_id to stdout (two lines) ──
console.log(outputFile);
console.log(`QUEUE_ID:${queueId}`);
