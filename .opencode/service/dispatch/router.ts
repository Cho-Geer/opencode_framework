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

const SRC = "dispatch-router-svc";

// ── Helper Functions ─────────────────────────────────────────────────

function loadUC7KSDispatchPatterns(worktree: string): string[] {
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

function loadSARepairPatterns(worktree: string): string[] {
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

function logOrchestratorSADispatch(opts: {
  caller: string; target: string; task_description: string;
  dag_task_id: string; patterns_matched: string[]; mode: string;
}): void {
  try {
    writeAuditLogEntry({
      timestamp: new Date().toISOString(),
      event: "orchestrator_sa_dispatch",
      caller: opts.caller, target: opts.target,
      task_description_hash: opts.task_description.slice(0, 80),
      dag_task_id: opts.dag_task_id,
      patterns_matched: opts.patterns_matched, mode: opts.mode,
    });
    if (existsSync(path.join(process.env.OPENCODE_ROOT || process.cwd(), ".opencode", "state", "machine.json"))) {
      atomicWriteSubState("compliance_records", (cr) => {
        cr.orchestrator_sa_dispatches = cr.orchestrator_sa_dispatches || [];
        cr.orchestrator_sa_dispatches.push({
          timestamp: new Date().toISOString(), caller: opts.caller,
          target: opts.target, dag_task_id: opts.dag_task_id,
          patterns_matched: opts.patterns_matched, mode: opts.mode,
        });
        if (cr.orchestrator_sa_dispatches.length > 100)
          cr.orchestrator_sa_dispatches = cr.orchestrator_sa_dispatches.slice(-100);
      });
    }
  } catch {}
}

function logSuperAdminDispatchBypass(opts: {
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

function inferDomainId(agentType: string): string | null {
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
  sessionNamespace?: string;
  autoPlan?: boolean;
  resumeSessionId?: string;
  callerAgent: string;
  sessionId: string;
  worktree: string;
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
    callerAgent, sessionId, worktree,
  } = input;

  process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated";

  // ── Resolve caller identity ──
  const callerNorm = normalize(callerAgent);
  const isOrchestrator = callerNorm === "orchestrator";
  const isSuperAdmin = callerNorm === "super-admin";
  const isKCTarget = isKC(agentType);

  // ── Auto-generate tracking UUID if dag_task_id missing ──
  let effectiveDagTaskId = dagTaskId || "";
  if (!effectiveDagTaskId) {
    effectiveDagTaskId = require("node:crypto").randomUUID();
    writeLog(SRC, "INFO", {
      event: "DAGTASK-ID-AUTO-GENERATED",
      detail: `dispatch to ${agentType} (caller=${callerAgent}) — auto-generated tracking UUID: ${effectiveDagTaskId}`,
    });
  }

  // ── PLAN-FIRST Layer 2: Pre-flight DAG check ──
  const policy = readDispatchPolicy();
  if (!isDagExempt(agentType) && policy.require_dag_entry) {
    if (!dagTaskId) {
      throw new Error(
        `[FW-ENFORCE][PLAN-FIRST][LAYER-2] dispatch_subagent to ${agentType} requires a dag_task_id. ` +
        `Either provide a planned DAG ID, or set auto_plan=true.`
      );
    }
    let tc = findTaskInDag(dagTaskId);
    if (!tc.found) {
      if (autoPlanFlag === true && policy.auto_plan_enabled) {
        const planned = await autoPlan({
          dagTaskId, targetAgent: agentType,
          taskDescription: taskDescription || "",
          timeoutMs: policy.auto_plan_timeout_ms,
          callerSession: sessionId, callerAgent,
          dispatchMetaPlanner: async (planningPrompt, planningDagId) => {
            const scriptPath = path.join(worktree, ".opencode", "scripts", "command-tools", "dispatch-subagent.ts");
            execFileSync("bun", ["--no-cache", scriptPath, "Meta-Planner", planningDagId, planningPrompt], {
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

  // ── Security: caller authorization ──
  if (!isOrchestrator) {
    if (isKCTarget) {
      // Any agent may dispatch KC for UC7KS pipeline
    } else if (isSuperAdmin && isKCTarget) {
      const taskDesc = (taskDescription || "").toLowerCase();
      const patterns = loadUC7KSDispatchPatterns(worktree);
      const matched = patterns.filter(p => taskDesc.includes(p.toLowerCase()));
      if (matched.length === 0) {
        throw new Error(`[FW-ENFORCE][LOCKED] Super-Admin dispatch DENIED: task doesn't match UC7KS patterns.`);
      }
      logSuperAdminDispatchBypass({
        caller: callerAgent, target: agentType,
        task_description: taskDescription, dag_task_id: dagTaskId || "",
        patterns_matched: matched,
      });
    } else if (isSuperAdmin) {
      throw new Error(`[FW-ENFORCE][LOCKED] Super-Admin may only target @Knowledge-Curator. Got: "${agentType}".`);
    } else {
      throw new Error(`[FW-ENFORCE][LOCKED] dispatch_subagent restricted to @Orchestrator. Caller '${callerAgent}' denied.`);
    }
  }

  // ── Super-Admin target: repair-pattern validation ──
  const isSATarget = isKC(agentType) ? false : normalize(agentType) === "super-admin";
  if (isSATarget) {
    const repairPatterns = loadSARepairPatterns(worktree);
    const taskDesc = (taskDescription || "").toLowerCase();
    const matched = repairPatterns.filter(p => taskDesc.includes(p.toLowerCase()));

    const mode = (() => {
      try {
        const cp = path.join(worktree, ".opencode", "project.config.json");
        if (existsSync(cp)) {
          const c = JSON.parse(readFileSync(cp, "utf8"));
          return c?.template_resolution?.develop_enforcement_mode || "advisory";
        }
      } catch {}
      return "advisory";
    })();

    if (mode === "locked") throw new Error(`[FW-ENFORCE][LOCKED] Super-Admin dispatch DENIED in locked mode.`);
    if (mode === "strict" && matched.length === 0)
      throw new Error(`[FW-ENFORCE][STRICT] Super-Admin dispatch DENIED: task doesn't match repair patterns.`);

    logOrchestratorSADispatch({
      caller: callerAgent, target: agentType, task_description: taskDescription,
      dag_task_id: dagTaskId || "", patterns_matched: matched, mode,
    });
  }

  // ── Execute dispatch-subagent.ts ──
  const ns = sessionNamespace || dagTaskId;
  const scriptPath = path.join(worktree, ".opencode", "scripts", "command-tools", "dispatch-subagent.ts");
  const scriptArgs = [agentType];
  if (ns) scriptArgs.push(ns);
  scriptArgs.push(taskDescription);

  let outputFilePath: string;
  try {
    const stdout = execFileSync("bun", ["--no-cache", scriptPath, ...scriptArgs], {
      encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCODE_SESSION_ID: sessionId,
        DISPATCH_TASK_DESC: taskDescription,
        ...(ns ? { DISPATCH_NAMESPACE: ns } : {}),
        ...(effectiveDagTaskId ? { DISPATCH_DAG_TASK_ID: effectiveDagTaskId } : {}),
        ...(resumeSessionId ? { DISPATCH_RESUME_SESSION_ID: resumeSessionId } : {}),
      },
    });
    outputFilePath = stdout.trim();
  } catch (error: any) {
    throw new Error(`dispatch_subagent: dispatch-subagent.ts failed (exit ${error.status || 1}): ${error.stderr?.toString() || error.message}`);
  }

  const wrappedPrompt = await readFile(outputFilePath, "utf8");

  // ── Auto-dispatch queue (FIFO) ──
  writeAutoDispatchQueue(outputFilePath, agentType, ns || "", sessionId);

  // ── Per-dispatch ctx file ──
  const inferredDomainId = inferDomainId(agentType);
  writeDispatchCtx(effectiveDagTaskId, dagTaskId || "", agentType, inferredDomainId, sessionId);

  // ── Session map DB writes ──
  if (effectiveDagTaskId && sessionId) {
    try {
      const existing = dbReadSessionMap(sessionId);
      const agentForWrite = existing?.agent || "pending";
      dbWriteSessionMap(sessionId, agentForWrite, dagTaskId || "", inferredDomainId || undefined);
      writeLog(SRC, "INFO", {
        event: "SESSION-MAP-DAGTASK-WRITE",
        detail: `session=${sessionId} dagTaskId=${dagTaskId} agent=${agentForWrite}`,
      });
    } catch (err: any) {
      writeLog(SRC, "WARN", { event: "SESSION-MAP-DAGTASK-WRITE-FAILED", detail: err.message });
    }
  }
  if (dagTaskId) {
    try {
      dbWriteSessionMap("dispatch:child:" + dagTaskId, agentType, dagTaskId, inferredDomainId || undefined);
    } catch {}
  }

  // ── Final: run CLI and return wrapped prompt ──
  try {
    const dp = path.join(process.cwd(), ".opencode", "scripts", "command-tools", "dispatch-subagent.ts");
    const wrapped = execFileSync("bun", ["--no-cache", dp, agentType, effectiveDagTaskId || "(none)", taskDescription || ""], {
      encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
    });
    return { prompt: wrapped, outputFilePath, effectiveDagTaskId };
  } catch (e: any) {
    return {
      prompt: [
        `/// DISPATCH RESULT (fallback — CLI failed: ${e?.message || e})`,
        `/// agent_type: ${agentType}`,
        `/// dag_task_id: ${effectiveDagTaskId || "(none)"}`,
        `///    Retry with dispatch_subagent() manually.`,
      ].join("\n"),
      outputFilePath, effectiveDagTaskId,
    };
  }
}

// ── Private helpers (extracted for readability) ──────────────────────

function writeAutoDispatchQueue(
  outputFilePath: string, agentType: string, taskId: string, sessionId: string,
): void {
  if (!outputFilePath) return;
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const dispatchDir = path.join(root, ".task_temp", "_dispatch");
    const autoMarkerPath = path.join(dispatchDir, ".auto-dispatch.json");
    const legacyPath = path.join(dispatchDir, ".auto-dispatch");

    interface Entry { sessionId: string; agentType: string; taskId: string; filePath: string; createdAt: number; }
    let queue: Entry[] = [];

    if (existsSync(autoMarkerPath)) {
      try {
        const raw = readFileSync(autoMarkerPath, "utf8");
        queue = JSON.parse(raw);
        if (!Array.isArray(queue)) queue = [queue];
      } catch { queue = []; }
    } else if (existsSync(legacyPath)) {
      try {
        const raw = readFileSync(legacyPath, "utf8");
        const legacy = JSON.parse(raw);
        if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
          queue = [legacy];
          writeLog(SRC, "runtime", { event: "AUTO-DISPATCH-LEGACY-MIGRATED", detail: `Migrated legacy entry` });
        }
        try { unlinkSync(legacyPath); } catch {}
      } catch { queue = []; }
    }

    if (queue.length > 0) {
      writeLog(SRC, "runtime", {
        event: "AUTO-DISPATCH-QUEUE-APPEND",
        detail: `Appending to queue (${queue.length} existing). New: ${agentType}:${taskId || "?"}`,
      });
    }

    queue.push({ sessionId, agentType, taskId, filePath: outputFilePath, createdAt: Date.now() });
    if (queue.length > 50) {
      const removed = queue.splice(0, queue.length - 50);
      writeLog(SRC, "runtime", { event: "AUTO-DISPATCH-QUEUE-TRUNCATED", detail: `Trimmed ${removed.length} oldest` });
    }

    atomicWriteJson(autoMarkerPath, queue);
  } catch {}
}

function writeDispatchCtx(
  effectiveDagTaskId: string, dagTaskId: string,
  agentType: string, inferredDomainId: string | null, sessionId: string,
): void {
  if (!effectiveDagTaskId) return;
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const ctxDir = path.join(root, ".task_temp", "_dispatch", "ctx");
    if (!existsSync(ctxDir)) mkdirSync(ctxDir, { recursive: true });
    writeFileSync(
      path.join(ctxDir, effectiveDagTaskId + ".json"),
      JSON.stringify({
        pipeline_id: effectiveDagTaskId, dagTaskId, agentType,
        domainId: inferredDomainId, parentSessionId: sessionId, createdAt: Date.now(),
      }), "utf8",
    );
    writeLog(SRC, "INFO", {
      event: "DISPATCH-CTX-WRITTEN",
      detail: `ctx/${dagTaskId}.json written`,
    });
  } catch {}
}
