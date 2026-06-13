// dispatch-before.ts — "tool.execute.before" plugin: pending queue consumption
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent, resolveTaskId, sessionLastDispatched } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import { normalizeAgentKey } from "../lib/uc7ks-schema";

ensureLogDir();
writeLog("dispatch-before", "loaded", { event: "PLUGIN-LOADED", detail: "dispatch-before.ts" });
updateIndex("dispatch-before", "PLUGIN-LOADED");

const PENDING_FILE = ".task_temp/_dispatch/.pending.json";
const FAILED_FILE = ".task_temp/_dispatch/.pending.json.failed";
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

/** P2-2: UC7KS knowledge patterns for SA→KC dispatch validation */
const KC_PATTERNS = [
  "knowledge", "cache", "docs", "official", "context7", "uc7ks",
  "fetch", "curator", "index", "explore", "source", "repository",
  "github", "documentation", "library", "api reference",
];

/** P2-2: Repair patterns for SA target dispatch validation */
const REPAIR_PATTERNS = [
  "repair", "fix", "restore", "corrupt", "broken", "emergency",
  "reset", "drain", "purge", "reconcile", "inconsistency", "state",
  "hook", "plugin", "integrity", "machine.json", "gate-state",
  "compliance", "validate", "audit", "test", "baseline",
];

/**
 * P0-6: Normalize agent name to PascalCase (e.g. "coder-be" → "Coder-BE").
 * _dispatch_target.json.agent must match actual agent directory names
 * (.opencode/agents/Coder-BE.md, .opencode/agents/Meta-Planner.md, etc.).
 */
function properCaseAgent(name: string): string {
  const map: Record<string, string> = {
    "meta-planner": "Meta-Planner",
    "orchestrator": "Orchestrator",
    "architect": "Architect",
    "coder-be": "Coder-BE",
    "coder-fe": "Coder-FE",
    "guardian": "Guardian",
    "arbiter": "Arbiter",
    "ci-cd-agent": "CI-CD-Agent",
    "knowledge-curator": "Knowledge-Curator",
    "super-admin": "Super-Admin",
  };
  return map[name.toLowerCase()] || name;
}

export default (async (_ctx: any) => {
  writeLog("dispatch-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  writeLog("dispatch-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | mode=${mode}`,
  });

  // Only process Task() calls for pending queue consumption
  const isTask = input.tool === "Task" || input.tool === "task";
  if (!isTask) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (skip) not a Task call",
    });
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // P2-2: Dispatch Caller Authorization
  // Migrated from enforce.ts L949–1117
  //
  // Gate 1: Only @Orchestrator may dispatch general agents.
  //   - @Super-Admin may dispatch @Knowledge-Curator only (UC7KS).
  //   - All other agents: unauthorized.
  //
  // Gate 2: SA target repair pattern validation.
  //   - Locked: SA dispatch DENIED (human-only).
  //   - Strict: SA target requires repair pattern match.
  //
  // Enforcement modes:
  //   advisory → WARN log only (no throw)
  //   strict   → throw for unauthorized dispatch
  //   locked   → throw for unauthorized + SA target deny
  // ═══════════════════════════════════════════════════════════════
  const targetAgent = ((output.args?.subagent_type as string) || "").toLowerCase().replace(/^@/, "");
  const callerNorm = agent.toLowerCase().replace(/^@/, "");
  const isOrchestrator = callerNorm === "orchestrator";
  const isSuperAdmin = callerNorm === "super-admin";
  const isKCTarget = targetAgent === "knowledge-curator";
  const isSATarget = targetAgent === "super-admin";
  const taskDesc = (
    (output.args?.description as string) || (output.args?.prompt as string) || ""
  ).toLowerCase();

  // Gate 1: Dispatch authorization
  if (!isOrchestrator) {
    if (isSuperAdmin && isKCTarget) {
      // SA→KC: UC7KS knowledge pattern matching required
      const matched = KC_PATTERNS.filter(p => taskDesc.includes(p));
      if (matched.length === 0) {
        writeLog("dispatch-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DISPATCH-GATE-KC-PATTERN | desc=${taskDesc.slice(0, 80)}`,
        });
        if (mode !== "advisory") {
          throw new Error(
            `[FW-ENFORCE][DISPATCH-GATE] Super-Admin→KC dispatch: task description ` +
            `must match UC7KS knowledge patterns. Got: "${taskDesc.slice(0, 80)}"`,
          );
        }
      }
    } else if (isSuperAdmin) {
      // SA dispatch restricted to @Knowledge-Curator
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "WARN",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-SA-RESTRICTED | target=${targetAgent}`,
      });
      if (mode !== "advisory") {
        throw new Error(
          `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch restricted to ` +
          `@Knowledge-Curator. Got: "${targetAgent}".`,
        );
      }
    } else {
      // Non-Orchestrator/non-SA: unauthorized
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "WARN",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-UNAUTHORIZED | caller=${agent} target=${targetAgent}`,
      });
      if (mode !== "advisory") {
        throw new Error(
          `[FW-ENFORCE][DISPATCH-GATE] Non-Orchestrator agent "${agent}" may not ` +
          `dispatch sub-agents. Only @Orchestrator may dispatch general agents.`,
        );
      }
    }
  }

  // Gate 2: SA target repair pattern validation
  if (isSATarget) {
    const matched = REPAIR_PATTERNS.filter(p => taskDesc.includes(p));
    if (mode === "locked") {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-SA-LOCKED | caller=${agent}`,
      });
      throw new Error(
        `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch DENIED in locked mode. ` +
        `Super-Admin is human-only when enforcement mode is locked.`,
      );
    } else if (mode === "strict" && matched.length === 0) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | DISPATCH-GATE-SA-REPAIR | desc=${taskDesc.slice(0, 80)}`,
      });
      throw new Error(
        `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch requires repair pattern ` +
        `match in strict mode. Task: "${taskDesc.slice(0, 80)}"`,
      );
    }
  }

  const root = process.env.OPENCODE_ROOT || ".";
  const pf = path.join(root, PENDING_FILE);

  // ═══════════════════════════════════════════════════════════════
  // P0-2 MANDATORY-DISPATCH: All Task() dispatches must go through
  // dispatch_subagent. The .pending.json queue is the proof that
  // dispatch_subagent was called. If the queue doesn't exist or is
  // empty, the agent bypassed dispatch_subagent → BLOCK.
  //
  // Emergency override: FW_PROMPT_QUEUE_DRAIN=true allows bypass
  // for deadlock recovery (e.g., queue corruption).
  //
  // Idempotency guard: callID-based double-hook detection prevents
  // false-positive blocks on retry of the same dispatch.
  //
  // Enforcement modes:
  //   advisory → WARN log only (no throw)
  //   strict   → throw [FW-ENFORCE][MANDATORY-DISPATCH]
  //   locked   → throw [FW-ENFORCE][MANDATORY-DISPATCH]
  // ═══════════════════════════════════════════════════════════════

  let queueExists = false;
  let queueEmpty = true;
  let queue: any[] = [];
  try {
    if (fs.existsSync(pf)) {
      queueExists = true;
      queue = JSON.parse(fs.readFileSync(pf, "utf8"));
      queueEmpty = !Array.isArray(queue) || queue.length === 0;
    }
  } catch {
    // Parse/corruption failure → treated as empty (blocked below)
  }

  if (!queueExists || queueEmpty) {
    // G-01: Emergency bypass via environment variable
    if (process.env.FW_PROMPT_QUEUE_DRAIN === "true") {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "WARN",
        event: "TOOL-BEFORE",
        detail: "MANDATORY-DISPATCH bypassed: FW_PROMPT_QUEUE_DRAIN=true",
      });
      return;
    }

    // G-02: Idempotent retry guard (same callID already dispatched)
    if (sessionLastDispatched.has(input.callID)) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        event: "TOOL-BEFORE",
        detail: "MANDATORY-DISPATCH bypassed: callID idempotent retry",
      });
      return;
    }

    // G-03: Enforcement — block in strict/locked, warn in advisory
    const reason = !queueExists ? "no .pending.json queue file"
      : "queue is empty (no pending dispatch entries)";
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `MANDATORY-DISPATCH blocked: ${reason} | agent=${agent}`,
    });

    if (mode !== "advisory") {
      throw new Error(
        `[FW-ENFORCE][MANDATORY-DISPATCH] All Task() dispatches must go through ` +
        `dispatch_subagent. ${reason}. ` +
        `Call dispatch_subagent(agent_type, task_description) first to generate ` +
        `a valid dispatch entry with P0 protocol, agent config, DISPATCH_TOKEN, ` +
        `template resolution, and UC7KS pipeline injection. ` +
        `Emergency override: set FW_PROMPT_QUEUE_DRAIN=true.`
      );
    }
    // Advisory mode: log only, allow through
    return;
  }

  const now = Date.now();

  // Drain stale entries (> 30 min)
  const staleIndices: number[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].createdAt) {
      const age = now - new Date(queue[i].createdAt).getTime();
      if (age > STALE_TIMEOUT_MS) staleIndices.push(i);
    }
  }
  if (staleIndices.length > 0) {
    for (let i = staleIndices.length - 1; i >= 0; i--) queue.splice(staleIndices[i], 1);
    fs.writeFileSync(pf, JSON.stringify(queue, null, 2), "utf8");
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `stale drain: ${staleIndices.length} entries`,
    });
  }

  if (queue.length === 0) return;

  // Match by requested subagent_type in Task() output args
  const reqType = ((output.args?.subagent_type as string) || "").toLowerCase().replace(/^@/, "");
  if (!reqType) return;

  // ── FW-FIX-DISPATCH-FILE: Unified file-injection dispatch ──
  // SA-FIX-PARALLEL-DISPATCH-20260611 (@Super-Admin): Replaced two-path logic
  // (dag_task_id path + legacy prompt-hash path) with a single unified path.
  //
  // WHY: The Task() tool schema does NOT expose a dag_task_id parameter, so
  // output.args?.dag_task_id was always undefined. The legacy prompt-hash path
  // required byte-identical prompt reconstruction, which is impossible when
  // dispatch_subagent wraps the prompt with preamble + rules + template resolution.
  // Both paths caused TASK-PROMPT-MISMATCH errors.
  //
  // HOW: Match by agentType (from subagent_type) against .pending.json entries.
  // If dag_task_id is somehow provided (backward compat), prefer exact match.
  // Otherwise, take the first FIFO entry for the matching agentType.
  // Read the dispatch file, verify SHA-256 hash, inject content as prompt.

  // Step 1: Try exact dag_task_id match (backward compat — if Task() ever exposes it)
  const dagTaskId = (output.args?.dag_task_id as string) || "";
  let matchIdx = -1;
  if (dagTaskId) {
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].dagTaskId === dagTaskId) { matchIdx = i; break; }
    }
  }

  // Step 2: Fallback — match by agentType (first FIFO entry)
  if (matchIdx === -1) {
    for (let i = 0; i < queue.length; i++) {
      const et = ((queue[i].agentType || "") as string).toLowerCase().replace(/^@/, "");
      if (et === reqType) { matchIdx = i; break; }
    }
  }

  // Step 3: If matched, read file, verify hash, inject prompt
  if (matchIdx >= 0) {
    const entry = queue[matchIdx];
    try {
      const fileContent = fs.readFileSync(entry.filePath, "utf8");
      const fileHash = crypto.createHash("sha256").update(fileContent, "utf8").digest("hex");
      if (fileHash === entry.promptHash) {
        // Hash match — inject prompt and consume entry
        const consumed = queue.splice(matchIdx, 1)[0];
        output.args.prompt = fileContent;
        fs.writeFileSync(pf, JSON.stringify(queue, null, 2), "utf8");
        sessionLastDispatched.set(input.sessionID, { agentType: reqType, ts: Date.now() });
        sessionLastDispatched.set(input.callID, { agentType: reqType, ts: Date.now() });

        // ═══════════════════════════════════════════════════════════════
        // P0-6 TASK-IDENTITY: Write _dispatch_target.json for sub-agent
        // identity propagation. Sub-agent processes start with no agent
        // info (AGENT=1 boolean only). This file bridges the gap:
        //   agent-resolver.ts (priority 1) reads it on startup
        //   compliance-gate.ts reads it for gate session attribution
        //   pre-execution-gate.ts reads it for DAG gate identity
        //
        // Schema: { agent, task_id, run_id, timestamp }
        // Staleness: readers check run_id against OPENCODE_RUN_ID
        // Cleanup: P0-7 in dispatch-after.ts deletes after Task() returns
        // ═══════════════════════════════════════════════════════════════
        try {
          const dtPath = path.join(root, ".task_temp", "_dispatch_target.json");
          const dtDir = path.dirname(dtPath);
          if (!fs.existsSync(dtDir)) fs.mkdirSync(dtDir, { recursive: true });
          fs.writeFileSync(
            dtPath,
            JSON.stringify(
              {
                agent: "@" + properCaseAgent(reqType.replace(/^@/, "")),
                task_id: consumed.dagTaskId || resolveTaskId() || null,
                run_id: process.env.OPENCODE_RUN_ID || "",
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
            "utf8",
          );
          writeLog("dispatch-before", "runtime", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            event: "TOOL-BEFORE",
            detail: `TASK-IDENTITY: wrote _dispatch_target.json → @${reqType.replace(/^@/, "")} (caller: ${agent})`,
          });
        } catch (e: any) {
          writeLog("dispatch-before", "runtime", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            level: "WARN",
            event: "TOOL-BEFORE",
            detail: `TASK-IDENTITY: write failed: ${e.message}`,
          });
        }

        writeLog("dispatch-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          event: "TOOL-BEFORE",
          detail: `consumed-file | agentType=${reqType} | dagTaskId=${consumed.dagTaskId || "?"} | matchBy=${dagTaskId ? "dagTaskId" : "agentType"} | remaining=${queue.length}`,
        });
        // ── G-09 RECURSION GUARD ──
        // Prevent Knowledge-Curator from dispatching itself recursively.
        // If the caller agent is also KC, check for existing active dispatch.
        if (reqType === "knowledge-curator" || reqType === "@knowledge-curator") {
          const callerAgent = (agent || "").toLowerCase().replace(/^@/, "");
          if (callerAgent === "knowledge-curator") {
            try {
              const mp = path.join(process.env.OPENCODE_ROOT || ".", ".opencode", "state", "machine.json");
              if (fs.existsSync(mp)) {
                const m = JSON.parse(fs.readFileSync(mp, "utf8"));
                const kcs = m.knowledge_cache_state || {};
                const canonicalAgent = normalizeAgentKey(agent);
                const session = kcs.session_access?.[canonicalAgent];
                if (session?.kc_dispatched) {
                  const age = Date.now() - new Date(session.kc_dispatched_at).getTime();
                  if (age < 300000) { // 5 minute throttle window
                    writeLog("dispatch-before", "runtime", {
                      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
                      level: "WARN",
                      event: "TOOL-BEFORE",
                      detail: `KC self-dispatch blocked (recursion guard): age=${age}ms < 300000ms threshold`,
                    });
                    if (mode !== "advisory") {
                      throw new Error("KC-SELF-DISPATCH-BLOCKED: Knowledge-Curator cannot dispatch itself while an active KC session exists (recursion guard)");
                    }
                    return;
                  }
                }
              }
            } catch (e: any) {
              if (e.message?.includes("KC-SELF-DISPATCH-BLOCKED")) throw e;
              /* non-fatal: proceed if machine.json unavailable */
            }
          }
          // If dispatching Knowledge-Curator → mark kc_dispatched for UC7KS hard constraint
          
          try {
            const mp = path.join(process.env.OPENCODE_ROOT || ".", ".opencode", "state", "machine.json");
            if (fs.existsSync(mp)) {
              const m = JSON.parse(fs.readFileSync(mp, "utf8"));
              const kcs = m.knowledge_cache_state || {};
              kcs.session_access = kcs.session_access || {};
              const canonicalAgent = normalizeAgentKey(agent);
              kcs.session_access[canonicalAgent] = kcs.session_access[canonicalAgent] || {};
              kcs.session_access[canonicalAgent].kc_dispatched = true;
              kcs.session_access[canonicalAgent].kc_dispatched_at = new Date().toISOString();
              fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");
            }
          } catch (e) { /* non-fatal */ }
        }
        return;
      }
      // Hash mismatch: file content changed on disk
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `file hash mismatch | agentType=${reqType} | dagTaskId=${dagTaskId || "?"} | expected=${entry.promptHash?.substring(0, 12)} | actual=${fileHash.substring(0, 12)}`,
      });
      if (mode !== "advisory") throw new Error(`DISPATCH-FILE-MISMATCH: File hash mismatch for ${reqType} (dagTaskId=${dagTaskId || "?"})`);
      return;
    } catch (e: any) {
      if (e.message?.includes("DISPATCH-FILE-MISMATCH")) throw e;
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `file read failed | agentType=${reqType} | dagTaskId=${dagTaskId || "?"} | ${e.message}`,
      });
      if (mode !== "advisory") throw new Error(`DISPATCH-FILE-MISMATCH: Cannot read dispatch file for ${reqType}: ${e.message}`);
      return;
    }
  }

  // No matching entry — check idempotency
  const sessionEntry = sessionLastDispatched.get(input.sessionID);
  if (sessionEntry && sessionEntry.agentType === reqType) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `exit (idempotent) duplicate Task() for ${reqType}`,
    });
    return;
  }

  writeLog("dispatch-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: `exit (no match) agentType=${reqType} queueSize=${queue.length}`,
  });
}
