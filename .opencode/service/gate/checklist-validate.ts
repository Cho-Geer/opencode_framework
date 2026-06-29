// service/gate/checklist-validate.ts — Checklist before-hook validation logic
// Source: checklist-before.ts plugin (423L → service extraction)
// P0 checklist enforcement + parent-run fallback + auto-advance + phase block.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeLog } from "../../lib/log-manager";
import { resolveAgent, resolveTaskId } from "../../lib/agent-resolver";
import { getEnforcementMode } from "../../lib/gate-core";
import {
  createChecklistRun,
  markChecklistPassed,
  requireChecklistPassed,
  advanceChecklistPhase,
  getChecklistSummary,
} from "../../lib/execution-checklist";

const SRC = "service-checklist-validate";

// ════════════════════════════════════════════════
// PASSTHROUGH & BYPASS CONFIG
// ════════════════════════════════════════════════

/** Core diagnostic tools that ALWAYS bypass the checklist phase gate. */
const CORE_PASSTHROUGH_TOOLS = new Set([
  "checklist_status",
  "advance_checklist_phase",
  "resolve_domain_id",
  "knowledge_cache_search",
  "config_read_attest",
  "module_scope_declare",
  "todowrite",
  "question",
  "skill",
  "dispatch_subagent",
]);

function getPassthroughTools(): Set<string> {
  const merged = new Set(CORE_PASSTHROUGH_TOOLS);
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = readFileSync(join(root, ".opencode", "project.config.json"), "utf8");
    const cfg = JSON.parse(raw);
    const extras: string[] = cfg?.template_resolution?.checklist_passthrough_tools ?? [];
    for (const t of extras) merged.add(t);
  } catch { /* Config unreadable → use core set only */ }
  return merged;
}

function getChecklistTaskBypassAgents(): string[] {
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = readFileSync(join(root, ".opencode", "project.config.json"), "utf8");
    const cfg = JSON.parse(raw);
    return cfg?.template_resolution?.checklist_task_bypass_agents ?? [];
  } catch { return []; }
}

function getChecklistAgentBypass(): string[] {
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = readFileSync(join(root, ".opencode", "project.config.json"), "utf8");
    const cfg = JSON.parse(raw);
    return cfg?.template_resolution?.checklist_agent_bypass ?? [];
  } catch { return []; }
}

// ════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════

function resolveRun(sessionID: string, agent: string, taskId: string | null) {
  try {
    return createChecklistRun({ opencode_session_id: sessionID, agent, task_id: taskId });
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "CHECKLIST-RUN-RESOLVE-FAILED", detail: `session=${sessionID} error=${e.message}` });
    return null;
  }
}

function resolveParentSession(taskId: string): string | null {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const root = process.env.OPENCODE_ROOT || ".";
    const ctxPath = path.join(root, ".task_temp", "_dispatch", "ctx", taskId + ".json");
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx.parentSessionId) return ctx.parentSessionId;
    }
    return null;
  } catch { return null; }
}

function tryParentRunFallback(
  childSessionID: string, agent: string, taskId: string | null, childRun: any,
): boolean {
  if (!taskId || childRun.phase !== "dispatch_payload") return false;

  const parentSession = resolveParentSession(taskId);
  if (!parentSession) {
    writeLog(SRC, "DEBUG", { event: "CHECKLIST-PARENT-NOT-FOUND", detail: `child=${childSessionID} task=${taskId}` });
    return false;
  }

  writeLog(SRC, "INFO", { event: "CHECKLIST-PARENT-RUN-FALLBACK", detail: `child=${childSessionID} parent=${parentSession}` });

  try {
    const parentRun = createChecklistRun({ opencode_session_id: parentSession, agent, task_id: taskId });
    if (parentRun.phase === "dispatch_payload") return false;

    const dispatchItems = ["payload_complete", "dispatch_token_created", "session_context_bound"];
    let copied = 0;
    for (const itemKey of dispatchItems) {
      try {
        markChecklistPassed({
          run_id: childRun.run_id, item_key: itemKey,
          evidence_ref: `parent-run-fallback from ${parentSession}`, actor: agent,
        });
        copied++;
      } catch { /* item may already be passed */ }
    }

    if (copied > 0) {
      writeLog(SRC, "INFO", { event: "CHECKLIST-DISPATCH-FACTS-COPIED", detail: `copied=${copied} from parent=${parentSession}` });
      advanceChecklistPhase({ run_id: childRun.run_id, current_phase: "dispatch_payload", next_phase: "preflight" });
      return true;
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", { event: "CHECKLIST-PARENT-FALLBACK-FAILED", detail: `error=${e.message}` });
  }
  return false;
}

const PHASE_ORDER = ["dispatch_payload", "preflight", "read_attest", "gate_armed", "execute", "deliver", "close"];

function tryAutoAdvance(run: any): boolean {
  const idx = PHASE_ORDER.indexOf(run.phase);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return false;
  const nextPhase = PHASE_ORDER[idx + 1];
  const result = advanceChecklistPhase({ run_id: run.run_id, current_phase: run.phase, next_phase: nextPhase });
  if (result.advanced) {
    writeLog(SRC, "INFO", { event: "CHECKLIST-AUTO-ADVANCE", detail: `run=${run.run_id} from=${run.phase} to=${nextPhase}` });
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════
// MAIN VALIDATION
// ════════════════════════════════════════════════

export function validateChecklistBefore(input: any, output: any): { blocked: boolean; message?: string } {
  try {
    const sessionID = input?.sessionID || input?.sessionId || "";
    if (!sessionID) return { blocked: false };

    const toolName = input?.tool || input?.args?.tool || "unknown";

    // Agent-level checklist bypass
    try {
      const callerAgent = (resolveAgent(sessionID) || "").replace(/^@/, "");
      if (callerAgent && getChecklistAgentBypass().includes(callerAgent)) {
        writeLog(SRC, "INFO", { event: "CHECKLIST-AGENT-BYPASS", detail: `agent "${callerAgent}" bypassed` });
        return { blocked: false };
      }
    } catch { /* agent resolution failure → fall through */ }

    // Passthrough: always allow diagnostic/read-only tools
    if (getPassthroughTools().has(toolName)) return { blocked: false };

    // Config-extensible task bypass for diagnostic agents
    if (toolName === "task" || toolName === "Task") {
      const subagentType = output?.args?.subagent_type || "";
      if (getChecklistTaskBypassAgents().includes(subagentType)) {
        writeLog(SRC, "INFO", { event: "CHECKLIST-TASK-BYPASS", detail: `task bypass for "${subagentType}"` });
        return { blocked: false };
      }
    }

    // Resolve agent and task ID
    const agent = resolveAgent(sessionID) || input?.agent || "unknown";
    const taskId = resolveTaskId(sessionID) || null;

    // Resolve checklist run (lazy create)
    const run = resolveRun(sessionID, agent, taskId);
    if (!run) return { blocked: false };

    // Parent-run fallback for child sessions stuck in dispatch_payload
    if (run.phase === "dispatch_payload") {
      const advanced = tryParentRunFallback(sessionID, agent, taskId, run);
      if (advanced) {
        const updatedRun = resolveRun(sessionID, agent, taskId);
        if (updatedRun && updatedRun.phase !== "dispatch_payload") return { blocked: false };
      }
    }

    // Auto-advance if all items are passed
    tryAutoAdvance(run);

    // Check blocking items for current phase
    const mode = getEnforcementMode();
    const result = requireChecklistPassed({ run_id: run.run_id, phase: run.phase });

    if (!result.passed) {
      const blockers = result.blockers || [];
      if (mode === "advisory") {
        writeLog(SRC, "WARN", {
          event: "P0-CHECKLIST-BLOCKED-ADVISORY", sessionID, agent,
          detail: `phase=${run.phase} tool=${toolName} blockers=[${blockers.join(",")}] — advisory, allowed`,
        });
        return { blocked: false };
      }

      writeLog(SRC, "ERROR", {
        event: "P0-CHECKLIST-BLOCKED", sessionID, agent,
        detail: `phase=${run.phase} tool=${toolName} blockers=[${blockers.join(",")}]`,
      });

      const summary = getChecklistSummary({ run_id: run.run_id });
      return {
        blocked: true,
        message:
          `[FW-ENFORCE][P0-CHECKLIST] Tool "${toolName}" blocked. ` +
          `Checklist phase "${run.phase}" has ${blockers.length} unresolved items: ` +
          `${blockers.slice(0, 5).join(", ")}. ` +
          (summary?.next_action || "Clear all blockers before proceeding."),
      };
    }
  } catch (e: any) {
    if (e.message && e.message.startsWith("[FW-ENFORCE]")) throw e;
    writeLog(SRC, "ERROR", { event: "CHECKLIST-BEFORE-ERROR", detail: e.message });
  }
  return { blocked: false };
}
