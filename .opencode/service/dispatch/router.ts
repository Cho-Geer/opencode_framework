// service/dispatch/router.ts — Dispatch Service (Core Dispatch Logic)
// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Extracted from tools/dispatch_subagent.ts (869L).
// Contains: security gates, PLAN-FIRST L2, execFileSync, auto-dispatch
// queue, ctx writes, session_map writes.

import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import {
  existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync,
} from "node:fs";
import { atomicWriteSubState, atomicWriteJson } from "../../lib/state-utils";
import { writeAuditLogEntry } from "../../lib/audit-log";
import { writeLog } from "../../lib/log-manager";
import { isDagExempt, readDispatchPolicy, autoPlan } from "../../lib/dag-policy";
import { findTaskInDag } from "../../lib/gate-checks";
import {
  isPrivileged, isKnowledgeCurator as isKC, normalize,
} from "../../lib/agent-identity";
import {
  dbWriteSessionMap, dbReadSessionMap, dbQuerySessionByDagTaskId,
} from "../../lib/db-state-manager";
import { resolveDispatchTarget } from "./agent-target";

const SRC = "dispatch-router-svc";

// ── Helper Functions ─────────────────────────────────────────────────

export function loadUC7KSDispatchPatterns(worktree: string): string[] {
  const DEFAULTS = [
    "knowledge", "cache", "docs", "official", "context7", "uc7ks",
    "fetch", "curator", "index", "explore", "source code", "repository",
    "github", "documentation", "library", "api reference",
  ];
  try {
    const configPath = path.join(worktree, ".opencode", "project.config.json");
    if (!existsSync(configPath)) return DEFAULTS;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const patterns = config?.template_resolution?.super_admin_uc7ks_dispatch_patterns;
    return Array.isArray(patterns) && patterns.length > 0 ? patterns : DEFAULTS;
  } catch { return DEFAULTS; }
}

export function loadSARepairPatterns(worktree: string): string[] {
  const DEFAULTS = [
    "repair", "fix", "restore", "corrupt", "broken", "emergency",
    "reset", "drain", "purge", "reconcile", "inconsistency", "state",
    "hook", "plugin", "integrity", "machine.json", "gate-state", "compliance",
  ];
  try {
    const configPath = path.join(worktree, ".opencode", "project.config.json");
    if (!existsSync(configPath)) return DEFAULTS;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const patterns = config?.template_resolution?.super_admin_repair_patterns;
    return Array.isArray(patterns) && patterns.length > 0 ? patterns : DEFAULTS;
  } catch { return DEFAULTS; }
}

export function logOrchestratorSADispatch(opts: {
  caller: string; target: string; task_description: string;
  dag_task_id: string; patterns_matched: string[]; policy: string;
}): void {
  try {
    writeAuditLogEntry({
      timestamp: new Date().toISOString(),
      event: "orchestrator_sa_dispatch",
      caller: opts.caller, target: opts.target,
      task_description_hash: opts.task_description.slice(0, 80),
      dag_task_id: opts.dag_task_id,
      patterns_matched: opts.patterns_matched, policy: opts.policy,
    });
    if (existsSync(path.join(process.env.OPENCODE_ROOT || process.cwd(), ".opencode", "state", "machine.json"))) {
      atomicWriteSubState("compliance_records", (cr) => {
        cr.orchestrator_sa_dispatches = cr.orchestrator_sa_dispatches || [];
        cr.orchestrator_sa_dispatches.push({
          timestamp: new Date().toISOString(), caller: opts.caller,
          target: opts.target, dag_task_id: opts.dag_task_id,
          patterns_matched: opts.patterns_matched, policy: opts.policy,
        });
        if (cr.orchestrator_sa_dispatches.length > 100)
          cr.orchestrator_sa_dispatches = cr.orchestrator_sa_dispatches.slice(-100);
      });
    }
  } catch {}
}

export function logSuperAdminDispatchBypass(opts: {
  caller: string; target: string; task_description: string;
  dag_task_id: string; patterns_matched: string[];
}): void {
  try {
    writeAuditLogEntry({
      timestamp: new Date().toISOString(),
      event: "super_admin_kc_dispatch_bypass",
      caller: opts.caller, target: opts.target,
      task_description_hash: opts.task_description.slice(0, 80),
      dag_task_id: opts.dag_task_id, patterns_matched: opts.patterns_matched,
    });
  } catch {}
}

export function inferDomainId(agentType: string): string | null {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.join(root, ".opencode", "project.config.json");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      const map = cfg.agent_domain_map;
      if (map && typeof map === "object") {
        const normalized = agentType.replace(/^@/, "");
        for (const [key, val] of Object.entries(map)) {
          if (key.toLowerCase() === normalized.toLowerCase())
            return typeof val === "string" && val ? val : null;
        }
      }
    }
  } catch {}
  return null;
}

// ── Types ────────────────────────────────────────────────────────────

export interface DispatchInput {
  agentType: string;
  taskDescription: string;
  dagTaskId?: string;
  sessionNamespace: string;
  autoPlan?: boolean;
  resumeSessionId?: string;
  callerAgent: string;
  sessionId: string;
  worktree: string;
  dispatch_privilege?: string;
  allowed_paths?: string[];
  allowed_remotes?: string[];
  privilege_reason?: string;
  callId?: string;
}

export interface DispatchResult {
  prompt: string;
  outputFilePath?: string;
  effectiveDagTaskId?: string;
}

// ── Main Dispatch Function ───────────────────────────────────────────

export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const {
    agentType, taskDescription, dagTaskId, sessionNamespace,
    autoPlan: autoPlanFlag, resumeSessionId,
    callerAgent, sessionId, worktree, callId,
  } = input;

  // ── 必填参数守卫 ──
  if (!sessionNamespace) {
    throw new Error(
      `[FW-ENFORCE][DISPATCH-REQUIRED] ` +
      `session_namespace is required but was not provided.\n\n` +
      `Fix: Add session_namespace to your dispatch_subagent call:\n` +
      `  dispatch_subagent({\n` +
      `    agent_type: "...",\n` +
      `    session_namespace: "<your-gate-session-id>",  ← Add this\n` +
      `    task_description: "..."\n` +
      `  })\n\n` +
      `Tip: Use your compliance gate session ID (e.g., "cg_ses_...") as the namespace\n` +
      `so the child agent's artifacts land in the same directory the gate expects.`
    );
  }

  const target = resolveDispatchTarget(agentType, worktree);

  process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated";

  // ── Resolve caller identity ──
  const callerNorm = normalize(callerAgent);
  const isOrchestrator = callerNorm === "orchestrator";
  const isSuperAdmin = callerNorm === "super-admin";
  const isKCTarget = isKC(target.requestedAgent);

  // ── P1: Privilege grant validation ──
  const { dispatch_privilege, allowed_paths, allowed_remotes, privilege_reason } = input;
  let dispatchKey: string | null = null;
  if (dispatch_privilege) {
    if (!isOrchestrator) {
      writeLog(SRC, "ERROR", {
        event: "PRIVILEGE-REJECTED-NON-ORCHESTRATOR",
        callerAgent,
        privilege: dispatch_privilege,
      });
      throw new Error(
        `[FW-ENFORCE][PRIVILEGE] Only Orchestrator can create privilege grants. Caller: ${callerAgent}`
      );
    }
    dispatchKey = require("node:crypto").randomUUID();
    writeLog(SRC, "INFO", {
      event: "DISPATCH-KEY-GENERATED",
      dispatchKey,
      privilege: dispatch_privilege,
      callerAgent,
    });
  }

  // ── Auto-generate tracking UUID if dag_task_id missing ──
  let effectiveDagTaskId = dagTaskId || sessionNamespace || "";
  if (!effectiveDagTaskId) {
    effectiveDagTaskId = require("node:crypto").randomUUID();
    writeLog(SRC, "INFO", {
      event: "DAGTASK-ID-AUTO-GENERATED",
      detail: `dispatch to ${target.requestedAgent} via ${target.nativeExecutor} (caller=${callerAgent}) — auto-generated tracking UUID: ${effectiveDagTaskId}`,
    });
  }

  // ── PLAN-FIRST Layer 2: Pre-flight DAG check (Phase 2: audit_only, ROUTE-SUGGESTION) ──
  const policy = readDispatchPolicy();
  try {
  if (!isDagExempt(target.requestedAgent) && policy.require_dag_entry) {
    if (!dagTaskId) {
      throw new Error(
        `[FW-ENFORCE][PLAN-FIRST][LAYER-2] Child dispatch to ${target.requestedAgent} requires a dag_task_id. ` +
        `Either provide a planned DAG ID, or set auto_plan=true.`
      );
    }
    let tc = findTaskInDag(dagTaskId);
    if (!tc.found) {
      if (autoPlanFlag === true && policy.auto_plan_enabled) {
        const planned = await autoPlan({
          dagTaskId, targetAgent: target.requestedAgent,
          taskDescription: taskDescription || "",
          timeoutMs: policy.auto_plan_timeout_ms,
          callerSession: sessionId, callerAgent,
          dispatchMetaPlanner: async (planningPrompt, planningDagId) => {
            const scriptPath = path.join(worktree, ".opencode", "scripts", "command-tools", "dispatch-subagent.ts");
            execFileSync("/home/zhaoge/.bun/bin/bun", ["--no-cache", scriptPath, "Meta-Planner", planningDagId, planningPrompt], {
              encoding: "utf8", timeout: policy.auto_plan_timeout_ms,
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, DISPATCH_TASK_DESC: planningPrompt },
            });
            return planningDagId;
          },
        });
        if (!planned) {
          throw new Error(`[FW-ENFORCE][PLAN-FIRST][LAYER-2] auto_plan failed for "${dagTaskId}".`);
        }
        tc = findTaskInDag(dagTaskId);
      }
      if (!tc.found) {
        if (autoPlanFlag === true && !policy.auto_plan_enabled) {
          throw new Error(`[FW-ENFORCE][PLAN-FIRST][LAYER-2] auto_plan=true but auto_plan_enabled=false.`);
        }
        throw new Error(`[FW-ENFORCE][PLAN-FIRST][LAYER-2] dag_task_id "${dagTaskId}" not in Task.DAG.json.`);
      }
    }
    if (tc.status !== "pending" && tc.status !== "in_progress") {
      throw new Error(`[FW-ENFORCE][PLAN-FIRST][LAYER-2] dag_task_id "${dagTaskId}" has status "${tc.status}".`);
    }
  }
  } catch (dagErr: any) {
    writeLog(SRC, "WARN", {
      event: "ROUTE-SUGGESTION",
      detail: dagErr.message?.slice(0, 200),
      agentType: target.requestedAgent, dagTaskId,
    });
  }

  // ── Security: caller authorization ──
  if (!isOrchestrator) {
    if (isKCTarget) {
      // Any agent may dispatch KC for UC7KS pipeline
    } else if (isSuperAdmin && isKCTarget) {
      const taskDesc = (taskDescription || "").toLowerCase();
      const patterns = loadUC7KSDispatchPatterns(worktree);
      const matched = patterns.filter(p => taskDesc.includes(p.toLowerCase()));
      if (matched.length === 0) {
        throw new Error(`[FW-ENFORCE][DISPATCH-AUTH] Super-Admin dispatch denied: task does not match UC7KS patterns.`);
      }
      logSuperAdminDispatchBypass({
        caller: callerAgent, target: target.requestedAgent,
        task_description: taskDescription, dag_task_id: dagTaskId || "",
        patterns_matched: matched,
      });
    } else if (isSuperAdmin) {
      throw new Error(`[FW-ENFORCE][DISPATCH-AUTH] Super-Admin may only target @Knowledge-Curator. Got: "${target.requestedAgent}".`);
    } else {
      throw new Error(`[FW-ENFORCE][DISPATCH-AUTH] Child dispatch is restricted to @Orchestrator. Caller '${callerAgent}' denied.`);
    }
  }

  // ── Super-Admin target: repair-pattern validation ──
  const isSATarget = isKC(target.requestedAgent)
    ? false
    : normalize(target.requestedAgent) === "super-admin";
  if (isSATarget) {
    const repairPatterns = loadSARepairPatterns(worktree);
    const taskDesc = (taskDescription || "").toLowerCase();
    const matched = repairPatterns.filter(p => taskDesc.includes(p.toLowerCase()));

    if (matched.length === 0) {
      throw new Error(`[FW-ENFORCE][DISPATCH-AUTH] Super-Admin dispatch denied: task does not match repair patterns.`);
    }

    logOrchestratorSADispatch({
      caller: callerAgent, target: target.requestedAgent, task_description: taskDescription,
      dag_task_id: dagTaskId || "", patterns_matched: matched,
      policy: "super-admin-repair:audit",
    });
  }

  // ── Execute dispatch-subagent.ts ──
  const ns = sessionNamespace;
  const scriptPath = path.join(worktree, ".opencode", "scripts", "command-tools", "dispatch-subagent.ts");
  const scriptArgs = [agentType];
  if (ns) scriptArgs.push(ns);
  scriptArgs.push(taskDescription);

  let outputFilePath: string;
  let parsedQueueId: string | null = null;
  try {
    const stdout = execFileSync("/home/zhaoge/.bun/bin/bun", ["--no-cache", scriptPath, ...scriptArgs], {
      encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCODE_SESSION_ID: sessionId,
        DISPATCH_TASK_DESC: taskDescription,
        ...{ DISPATCH_NAMESPACE: ns },
        ...(effectiveDagTaskId ? { DISPATCH_DAG_TASK_ID: effectiveDagTaskId } : {}),
        ...(resumeSessionId ? { DISPATCH_RESUME_SESSION_ID: resumeSessionId } : {}),
        ...(dispatchKey ? { DISPATCH_KEY: dispatchKey } : {}),
        ...(dispatch_privilege ? { DISPATCH_PRIVILEGE: dispatch_privilege } : {}),
        ...(allowed_paths?.length ? { DISPATCH_ALLOWED_PATHS: allowed_paths.join(",") } : {}),
        ...(allowed_remotes?.length ? { DISPATCH_ALLOWED_REMOTES: allowed_remotes.join(",") } : {}),
        ...(privilege_reason ? { DISPATCH_PRIVILEGE_REASON: privilege_reason } : {}),
        ...(callId ? { DISPATCH_CALL_ID: callId } : {}),
      },
    });
    const stdoutLines = stdout.trim().split("\n").map((l: string) => l.trim()).filter(Boolean);
    outputFilePath = stdoutLines[0] || "";
    const queueIdLine = stdoutLines.find((l: string) => l.startsWith("QUEUE_ID:"));
    parsedQueueId = queueIdLine ? queueIdLine.replace("QUEUE_ID:", "") : null;
  } catch (error: any) {
    throw new Error(`dispatch_subagent: dispatch-subagent.ts failed (exit ${error.status || 1}): ${error.stderr?.toString() || error.message}`);
  }

  let wrappedPrompt = await readFile(outputFilePath, "utf8");

  // Append QUEUE_ID reference marker for canonical prompt lookup in task handler
  if (parsedQueueId) {
    wrappedPrompt += `\n//QUEUE_ID:${parsedQueueId}`;
  }


  const inferredDomainId = inferDomainId(target.requestedAgent);
  // ── Session map DB writes ──
  if (effectiveDagTaskId && sessionId) {
    try {
      const existing = dbReadSessionMap(sessionId);
      const agentForWrite = existing?.agent || "pending";
      const canonicalDagId = dagTaskId || effectiveDagTaskId;
      dbWriteSessionMap(sessionId, agentForWrite, canonicalDagId, inferredDomainId || undefined);
      writeLog(SRC, "INFO", {
        event: "SESSION-MAP-DAGTASK-WRITE",
        detail: `session=${sessionId} dagTaskId=${canonicalDagId} agent=${agentForWrite}`,
      });
    } catch (err: any) {
      writeLog(SRC, "WARN", { event: "SESSION-MAP-DAGTASK-WRITE-FAILED", detail: err.message });
    }
  }
  // Synthetic child session_map entry — always use effectiveDagTaskId (canonical tracking ID)
  try {
    dbWriteSessionMap(
      "dispatch:child:" + effectiveDagTaskId,
      target.requestedAgent,
      effectiveDagTaskId,
      inferredDomainId || undefined,
    );
  } catch {}

  // Phase 4 dual-write: session_events (v33 table)
  try {
    const { getDb } = require("../../lib/db-manager");
    const db = getDb();
    db.run(
      `INSERT INTO session_events
       (session_id, parent_session_id, event_type, dag_task_id, agent_type, agent_alias, native_executor, loaded_skills, run_id, payload, created_at)
       VALUES (?, ?, 'dispatched', ?, ?, NULL, ?, NULL, ?, NULL, ?)`,
      [
        "dispatch:child:" + (dagTaskId || effectiveDagTaskId),
        sessionId,
        dagTaskId || effectiveDagTaskId,
        target.requestedAgent,
        target.nativeExecutor,
        effectiveDagTaskId,
        Date.now(),
      ]
    );
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "SESSION-EVENTS-DUAL-WRITE-FAILED", detail: e.message });
  }

  // ── Return the prompt from the first (successful) execution ──
  // Fix: Removed redundant second CLI execution that returned a bare file path
  // instead of the full prompt content, causing Orchestrator to default subagent_type to "general".
  return { prompt: wrappedPrompt, outputFilePath, effectiveDagTaskId };
}
