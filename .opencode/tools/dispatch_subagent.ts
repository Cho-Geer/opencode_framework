// tools/dispatch_subagent.ts — Thin Controller
// Phase 2: Delegates to DispatchService.dispatch()
import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { withInterruptGuard } from "../lib";
import { resolveCallerIdentity } from "../service/session";
import {
  dispatch,
  loadUC7KSDispatchPatterns,
  loadSARepairPatterns,
  logOrchestratorSADispatch,
  logSuperAdminDispatchBypass,
  inferDomainId,
} from "../service/dispatch/router";
import { isDagExempt, readDispatchPolicy, autoPlan } from "../lib/dag-policy";
import { findTaskInDag } from "../lib/gate-checks";
import { atomicWriteJson } from "../lib/state-utils";
import { writeLog } from "../lib/log-manager";
import { dbReadSessionMap, dbWriteSessionMap } from "../lib/db-state-manager";
import type { FrameworkToolContext } from "./tool-context";

export default tool({
  description:
    "Generate a wrapped, compliance-enforced prompt for dispatching a sub-agent " +
    "via Task(). Runs dispatch-subagent.js to embed DISPATCH_TOKEN and P0 protocol. " +
    "Every dispatch creates a NEW session. Context between dispatches is carried " +
    "exclusively via HANDOVER.md files. Usable by @Orchestrator (all agents) and " +
    "@Super-Admin (@Knowledge-Curator only, UC7KS knowledge tasks).",
  args: {
    agent_type: tool.schema.string().describe(
      "Target agent type (e.g., 'Architect', 'Coder-BE', 'plan'). " +
      "@Super-Admin may only target 'Knowledge-Curator' or '@Knowledge-Curator'."),
    task_description: tool.schema.string().describe("Task description to wrap with P0 protocol and DISPATCH_TOKEN"),
    dag_task_id: tool.schema.string().optional().describe(
      "DAG Task ID — must exist in Task.DAG.json for non-DAG-exempt agents."),
    session_namespace: tool.schema.string().describe(
      "Output path namespace — used for .task_temp/{session_namespace}/ directory."),
    auto_plan: tool.schema.boolean().optional().describe(
      "PLAN-FIRST self-healing (opt-in). Auto-dispatches @plan if task not in DAG."),
    resume_session_id: tool.schema.string().optional().describe(
      "Session ID of a previously dispatched sub-agent to resume."),
    dispatch_privilege: tool.schema.string().optional().describe(
      "Privilege type to grant the child (e.g., 'framework_maintenance'). " +
      "Orchestrator-only — router rejects non-Orchestrator callers. " +
      "Creates a task-level dispatch_privilege_grant bound to the child session. " +
      "For framework_maintenance, the child must first run CodeGraph, then call " +
      "framework_maintenance_plan to declare planned paths, then use safe_framework_edit."),
    allowed_paths: tool.schema.array(tool.schema.string()).optional().describe(
      "Optional glob patterns that further narrow the privilege grant (e.g., ['.opencode/**']). " +
      "If omitted, framework_maintenance uses the default policy. Relative to worktree."),
    allowed_remotes: tool.schema.array(tool.schema.string()).optional().describe(
      "Optional remote names allowed for repo remote-write grants (e.g., ['origin'])."),
    privilege_reason: tool.schema.string().optional().describe(
      "Human-readable reason for the privilege grant (audit log)."),
    _frameworkMaintenance: tool.schema.boolean().optional().describe(
      "Internal compatibility flag for legacy framework-maintenance callers."),
  },
  async execute(args, context: FrameworkToolContext) {
    // Phase 2: ordinary path retirement - only explicit privilege dispatch remains on the wrapper
    const requestedPrivilege = (args.dispatch_privilege || process.env.DISPATCH_PRIVILEGE || "").trim();
    const isFrameworkMaintenance = requestedPrivilege === "framework_maintenance"
      || process.env.DISPATCH_PRIVILEGE_REASON?.includes("framework_maintenance")
      || args._frameworkMaintenance === true;
    const isRepoPrivilege = requestedPrivilege === "repo_maintenance"
      || requestedPrivilege === "remote_repo_write"
      || requestedPrivilege === "repo_destructive_emergency";
    if (!isFrameworkMaintenance && !isRepoPrivilege) {
      return JSON.stringify({
        output: "dispatch_subagent is retired for ordinary paths. Use native Task tool instead. "
          + "Privilege-bearing child work (framework_maintenance / repo_maintenance / "
          + "remote_repo_write / repo_destructive_emergency) may still use this wrapper.",
        metadata: { retired: true, alternative: "Task", requiresPrivilege: true },
      });
    }
    return withInterruptGuard("dispatch_subagent", async () => {
      // ── P0-1: Agent identity propagated via _dispatch_target.json (v4.0.0: FRAMEWORK_AGENT deprecated) ──
      // ── FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): FRAMEWORK_TASK_ID env var removed from parent process.
      // FRAMEWORK_TASK_ID was historically set on process.env to communicate the dag_task_id to
      // the dispatch-subagent.ts child script. This polluted the parent's environment and caused
      // tool-call blocking (pre-execution DAG gate). The child now reads dag_task_id from
      // .dispatch_ctx file or --task-id CLI argument instead.
      // The sub-agent spawned by Task() inherits FRAMEWORK_AGENT/DISPATCH_CONTEXT from the parent
      // (still correct), but FRAMEWORK_TASK_ID is no longer written to the parent process.
      process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated";

      // ── FW-PLAN-FIRST LAYER 2 (2026-06-14): Pre-flight DAG-existence check ──
      // Runs BEFORE spawning dispatch-subagent.ts. Defense-in-depth on top of
      // Layer 1 (dispatch-before.ts plugin) and Layer 3 (gate-before.ts P2-1).
      // For non-DAG-exempt targets, requires dag_task_id to exist in Task.DAG.json
      // unless auto_plan=true is set and the policy allows it — in which case
      // the framework plans the task via @Meta-Planner first.
      const targetAgent = args.agent_type || "";
      const dagTaskId = args.dag_task_id || "";
      const policy = readDispatchPolicy();
      const callerAgent = context.agent || "";

      if (!isDagExempt(targetAgent) && policy.require_dag_entry) {
        if (!dagTaskId) {
          throw new Error(
            `[FW-ENFORCE][PLAN-FIRST][LAYER-2] dispatch_subagent to ${targetAgent} ` +
              `requires a dag_task_id that exists in Task.DAG.json (dispatch_policy.require_dag_entry=true). ` +
              `Either provide a planned DAG ID, or set auto_plan=true to let the framework plan automatically, ` +
              `or dispatch @Meta-Planner first to plan the task.`,
          );
        }
        let tc = findTaskInDag(dagTaskId);
        if (!tc.found) {
          if (args.auto_plan === true && policy.auto_plan_enabled) {
            // Autonomous self-healing: dispatch @Meta-Planner to plan the task,
            // then re-verify.
            const planned = await autoPlan({
              dagTaskId,
              targetAgent,
              taskDescription: args.task_description || "",
              timeoutMs: policy.auto_plan_timeout_ms,
              callerSession: context.sessionID || "",
              callerAgent,
              dispatchMetaPlanner: async (planningPrompt, planningDagId) => {
                // Recursive call to the same tool, but targeting @Meta-Planner.
                // Meta-Planner is DAG-exempt, so this nested dispatch bypasses
                // the pre-flight check. We use execFileSync(bun, dispatch-subagent.ts)
                // directly rather than re-entering the tool, to avoid recursion limits
                // and to keep the planning dispatch independent of the outer dispatch context.
                const worktree = context.worktree || process.cwd();
                const scriptPath = require("path").join(
                  worktree,
                  ".opencode",
                  "scripts",
                  "command-tools",
                  "dispatch-subagent.ts",
                );
                require("child_process").execFileSync(
                  "bun",
                  [
                    "--no-cache",
                    scriptPath,
                    "Meta-Planner",
                    planningDagId,
                    planningPrompt,
                  ],
                  {
                    encoding: "utf8",
                    timeout: policy.auto_plan_timeout_ms,
                    stdio: ["pipe", "pipe", "pipe"],
                    env: {
                      ...process.env,
                      DISPATCH_TASK_DESC: planningPrompt,
                      // FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): FRAMEWORK_TASK_ID removed.
                      // planningDagId is passed as positional arg to dispatch-subagent.ts.
                    },
                  },
                );
                return planningDagId;
              },
            });
            if (!planned) {
              throw new Error(
                `[FW-ENFORCE][PLAN-FIRST][LAYER-2] auto_plan failed for dag_task_id ` +
                  `"${dagTaskId}" within ${policy.auto_plan_timeout_ms}ms. ` +
                  `Dispatch @Meta-Planner manually to plan the task, then retry.`,
              );
            }
            tc = findTaskInDag(dagTaskId); // re-verify
          }
          if (!tc.found) {
            if (args.auto_plan === true && !policy.auto_plan_enabled) {
              throw new Error(
                `[FW-ENFORCE][PLAN-FIRST][LAYER-2] auto_plan=true was set but ` +
                  `dispatch_policy.auto_plan_enabled=false in project.config.json. ` +
                  `Self-healing is blocked during rollout. ` +
                  `ACTION: dispatch @Meta-Planner to add "${dagTaskId}" to Task.DAG.json, ` +
                  `then re-dispatch ${targetAgent} with the same dag_task_id.`,
              );
            }
            throw new Error(
              `[FW-ENFORCE][PLAN-FIRST][LAYER-2] dag_task_id "${dagTaskId}" not in ` +
                `Task.DAG.json (checked both dag.tasks[] and dag.execution_order). ` +
                `Dispatch @Meta-Planner first, or set auto_plan=true.`,
            );
          }
        }
        // Status gate: only pending / in_progress may be dispatched.
        if (tc.status !== "pending" && tc.status !== "in_progress") {
          throw new Error(
            `[FW-ENFORCE][PLAN-FIRST][LAYER-2] dag_task_id "${dagTaskId}" has ` +
              `status "${tc.status}"; expected "pending" or "in_progress".`,
          );
        }
      }

      // FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): try/finally restored FRAMEWORK_TASK_ID previously.
      // Now the env var is no longer written, so the block is kept for structural clarity only.
      try {
        // ── Security: Orchestrator + Super-Admin/UC7KS gate ──
        const caller = context.agent || "";
        const isOrchestrator =
          caller === "Orchestrator" || caller === "@Orchestrator";
        const isSuperAdmin =
          caller === "Super-Admin" || caller === "@Super-Admin";
        const isKC =
          args.agent_type === "Knowledge-Curator" ||
          args.agent_type === "@Knowledge-Curator";

        if (!isOrchestrator) {
          // ── Any agent may dispatch Knowledge-Curator for UC7KS pipeline ──
          if (isKC) {
            // Allow: any agent can dispatch KC for knowledge acquisition
            // No pattern check needed for non-Super-Admin agents
          } else if (isSuperAdmin && isKC) {
            // Super-Admin UC7KS bypass (pattern check)
            const taskDesc = (args.task_description || "").toLowerCase();
            const patterns = loadUC7KSDispatchPatterns(
              context.worktree || process.cwd(),
            );
            const matched = patterns.filter((p) =>
              taskDesc.includes(p.toLowerCase()),
            );
            if (matched.length === 0) {
              throw new Error(
                `[FW-ENFORCE][LOCKED] Super-Admin dispatch bypass DENIED: ` +
                  `task_description must match UC7KS knowledge acquisition patterns. ` +
                  `Got: "${(args.task_description || "").slice(0, 100)}". ` +
                  `Required patterns: [${patterns.slice(0, 8).join(", ")}...]`,
              );
            }
            logSuperAdminDispatchBypass({
              caller,
              target: args.agent_type,
              task_description: args.task_description,
              dag_task_id: args.dag_task_id || "",
              patterns_matched: matched,
            });
          } else if (isSuperAdmin) {
            throw new Error(
              `[FW-ENFORCE][LOCKED] Super-Admin dispatch bypass DENIED: ` +
                `may only target @Knowledge-Curator. Got: "${args.agent_type}".`,
            );
          } else {
            throw new Error(
              `[FW-ENFORCE][LOCKED] dispatch_subagent restricted to @Orchestrator. ` +
                `Caller '${caller}' denied. (Only @Orchestrator may dispatch general agents; ` +
                `@Super-Admin may only dispatch @Knowledge-Curator for UC7KS.)`,
            );
          }
        }

        // ── Super-Admin target: repair-pattern validation (FW-DOWNGRADE-SA) ──
        // @Orchestrator may dispatch @Super-Admin for emergency framework repair.
        // Task must match repair patterns. Enforcement mode gating:
        //   advisory: unrestricted, strict: repair patterns required, locked: human-only
        const isSATarget =
          args.agent_type === "Super-Admin" ||
          args.agent_type === "@Super-Admin";
        if (isSATarget) {
          const repairPatterns = loadSARepairPatterns(
            context.worktree || process.cwd(),
          );
          const taskDesc = (args.task_description || "").toLowerCase();
          const matched = repairPatterns.filter((p) =>
            taskDesc.includes(p.toLowerCase()),
          );

          // Locked mode: Super-Admin is human-only
          const mode = (() => {
            try {
              const cp = path.join(
                context.worktree || process.cwd(),
                ".opencode",
                "project.config.json",
              );
              if (existsSync(cp)) {
                const c = JSON.parse(readFileSync(cp, "utf8"));
                return (
                  c?.template_resolution?.develop_enforcement_mode || "advisory"
                );
              }
            } catch {}
            return "advisory";
          })();

          if (mode === "locked") {
            throw new Error(
              `[FW-ENFORCE][LOCKED] Super-Admin dispatch DENIED in locked mode. ` +
                `Super-Admin is human-only when enforcement mode is locked.`,
            );
          }

          if (mode === "strict" && matched.length === 0) {
            throw new Error(
              `[FW-ENFORCE][STRICT] Super-Admin dispatch DENIED: ` +
                `task_description must match emergency repair patterns. ` +
                `Got: "${(args.task_description || "").slice(0, 100)}". ` +
                `Required patterns: [${repairPatterns.slice(0, 8).join(", ")}...]`,
            );
          }

          // ── Audit the dispatch ──
          logOrchestratorSADispatch({
            caller,
            target: args.agent_type,
            task_description: args.task_description,
            dag_task_id: args.dag_task_id || "",
            patterns_matched: matched,
            policy: mode,
          });
        }

        const worktree = context.worktree || process.cwd();
        const dagTaskId = args.dag_task_id || "";

        // ── Execute dispatch-subagent.js ──
        // Use execFileSync to bypass shell, preventing injection/misparsing of
        // special characters (newlines, backticks, CJK) in task_description.
        // task_description and dag_task_id passed via env vars (authoritative) AND
        // positional args (for CLI/test compatibility with the new 2-param pattern).
        const scriptPath = path.join(
          /**
           * FW-HOTFIX-001: Changed .js→.ts to match actual file extension.
           * The source file was renamed from .js to .ts but this reference wasn't updated,
           * causing a "file not found" error when dispatch_subagent tool tries to execute it.
           */
          worktree,
          ".opencode",
          "scripts",
          "command-tools",
          "dispatch-subagent.ts",
        );

        // Build argv: [scriptPath, agent_type, dag_task_id?, task_description?]
        // dag_task_id is passed as 2nd positional param so dispatch-subagent.js
        // can extract it when called with the 2-param pattern.
        const scriptArgs = [args.agent_type];
        if (dagTaskId) {
          scriptArgs.push(dagTaskId);
        }
        scriptArgs.push(args.task_description);

        let outputFilePath: string;
        try {
          /**
           * FW-HOTFIX-001: Changed node→bun to match project runtime.
           * The project uses bun as its JavaScript/TypeScript runtime; invoking with "node"
           * would fail since bun-specific APIs (Bun.file(), etc.) are used in the script.
           *
           * P0-FIX-BUG-12 (2026-06-09 @Super-Admin): Added --no-cache flag to bypass
           * Bun's compiled module cache. Without this, after an OpenCode restart Bun may
           * serve a stale cached version of dispatch-subagent.ts that lacks the
           * .pending.json write code (FW-PROMPT-HARDEN-04). This causes dispatch_subagent
           * to produce prompt files without populating the FIFO queue, which breaks the
           * MANDATORY-DISPATCH gate in enforce.ts.
           */
          const stdout = execFileSync(
            "bun",
            ["--no-cache", scriptPath, ...scriptArgs],
            {
              encoding: "utf8",
              timeout: 60000,
              stdio: ["pipe", "pipe", "pipe"],
              env: {
                ...process.env,
                DISPATCH_TASK_DESC: args.task_description,
                // FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): FRAMEWORK_TASK_ID removed from child env.
                // The child script now reads dag_task_id from .dispatch_ctx file instead.
                ...(args.resume_session_id
                  ? { DISPATCH_RESUME_SESSION_ID: args.resume_session_id }
                  : {}),
              },
            },
          );
          outputFilePath = stdout.trim();
        } catch (error) {
          const err = error as any;
          throw new Error(
            `dispatch_subagent: dispatch-subagent.js failed (exit ${err.status || 1}): ` +
              `${err.stderr?.toString() || err.message}`,
          );
        }

        const wrappedPrompt = await readFile(outputFilePath, "utf8");

        // ── LLM-FREE BRIDGE: Write .auto-dispatch marker (QUEUE-BASED v2) ──
        // task-before.ts detects this marker, loads the full prompt from
        // outputFilePath, and substitutes it for DISPATCH_TOKEN hash
        // verification. The LLM receives only a short confirmation.
        //
        // FIX v2 (2026-06-19, @Super-Admin, SA-REVIEW-AUTO-DISPATCH-BUG):
        // Changed from single-file overwrite to FIFO queue append.
        // The old design used a single .auto-dispatch file shared across ALL
        // dispatches — sequential dispatches would overwrite each other's
        // markers. Now each dispatch appends to a queue (.auto-dispatch.json)
        // and task-before.ts dequeues the matching entry.
        if (outputFilePath) {
          try {
            const root = process.env.OPENCODE_ROOT || process.cwd();
            const dispatchDir = path.join(root, ".task_temp", "_dispatch");
            const autoMarkerPath = path.join(
              dispatchDir,
              ".auto-dispatch.json",
            );
            const legacyPath = path.join(dispatchDir, ".auto-dispatch");

            /** Queue entry for auto-dispatch marker */
            interface AutoDispatchEntry {
              sessionId: string;
              agentType: string;
              taskId: string;
              filePath: string;
              createdAt: number;
            }
            let queue: AutoDispatchEntry[] = [];

            // Check new queue file first, then legacy single file
            if (existsSync(autoMarkerPath)) {
              try {
                const raw = readFileSync(autoMarkerPath, "utf8");
                queue = JSON.parse(raw);
                if (!Array.isArray(queue)) {
                  queue = [queue];
                }
              } catch {
                queue = [];
              }
            } else if (existsSync(legacyPath)) {
              // Migrate legacy single-entry format
              try {
                const raw = readFileSync(legacyPath, "utf8");
                const legacy = JSON.parse(raw);
                if (
                  legacy &&
                  typeof legacy === "object" &&
                  !Array.isArray(legacy)
                ) {
                  queue = [legacy];
                  writeLog("dispatch_subagent", "runtime", {
                    sessionID: context.sessionID || "",
                    agent: args.agent_type,
                    level: "INFO",
                    event: "AUTO-DISPATCH-LEGACY-MIGRATED",
                    detail: `Migrated legacy .auto-dispatch entry (agentType=${legacy.agentType})`,
                  });
                }
                try {
                  unlinkSync(legacyPath);
                } catch {}
              } catch {
                queue = [];
              }
            }

            // Log if queue already has entries (overwrite is now detected as queue buildup)
            if (queue.length > 0) {
              writeLog("dispatch_subagent", "runtime", {
                sessionID: context.sessionID || "",
                agent: args.agent_type,
                level: "WARN",
                event: "AUTO-DISPATCH-QUEUE-APPEND",
                detail: `Appending to queue (${queue.length} existing). New: ${args.agent_type}:${dagTaskId || "?"}`,
              });
            }

            queue.push({
              sessionId: context.sessionID || "",
              agentType: args.agent_type,
              taskId: dagTaskId || "",
              filePath: outputFilePath,
              createdAt: Date.now(),
            });

            // Cap at 50 entries to prevent unbounded growth
            if (queue.length > 50) {
              const removed = queue.splice(0, queue.length - 50);
              writeLog("dispatch_subagent", "runtime", {
                sessionID: context.sessionID || "",
                agent: args.agent_type,
                level: "WARN",
                event: "AUTO-DISPATCH-QUEUE-TRUNCATED",
                detail: `Trimmed ${removed.length} oldest entries`,
              });
            }

            atomicWriteJson(autoMarkerPath, queue);
          } catch {
            // Best-effort; fall through
          }
        }

        // ── S25-FIX-V4: Write .dispatch_ctx for task-after.ts ──
        // Replaces process.env.FRAMEWORK_TASK_ID propagation. The file is
        // consumed (read + delete) by task-after.ts after Task() completes.
        // FW-UC7KS-DOMAIN-001: domainId included for uc7ks-after.ts fallback.
        const inferredDomainId = inferDomainId(args.agent_type);
        if (dagTaskId) {
          const root = process.env.OPENCODE_ROOT || process.cwd();
          try {
            const dispatchCtxDir = path.join(root, ".task_temp", "_dispatch");
            const dispatchCtxPath = path.join(dispatchCtxDir, ".dispatch_ctx");
            if (!existsSync(dispatchCtxDir)) {
              require("node:fs").mkdirSync(dispatchCtxDir, { recursive: true });
            }
            writeFileSync(
              dispatchCtxPath,
              JSON.stringify({
                dagTaskId,
                domainId: inferredDomainId,
                createdAt: Date.now(),
              }),
              "utf8",
            );
          } catch {
            // Best-effort; never block dispatch
          }

          // §3.3: Per-dispatch ctx file (dagTaskId-keyed, no overwrites)
          // Eliminates the session_map race condition caused by concurrent dispatches
          // overwriting the shared .dispatch_ctx singleton. Each dispatch gets its own
          // ctx/{dagTaskId}.json file — isolated, race-free.
          // Phase 1 dual-write: legacy .dispatch_ctx above + per-dispatch ctx/ below.
          // Phase 2 (future): migrate all readers to ctx/ files, then remove .dispatch_ctx.
          try {
            const ctxPerDispatchDir = path.join(
              root,
              ".task_temp",
              "_dispatch",
              "ctx",
            );
            if (!existsSync(ctxPerDispatchDir)) {
              require("node:fs").mkdirSync(ctxPerDispatchDir, {
                recursive: true,
              });
            }
            const ctxPerDispatchPath = path.join(
              ctxPerDispatchDir,
              dagTaskId + ".json",
            );
            writeFileSync(
              ctxPerDispatchPath,
              JSON.stringify({
                dagTaskId,
                agentType: args.agent_type,
                domainId: inferredDomainId,
                createdAt: Date.now(),
              }),
              "utf8",
            );
          } catch {
            // Best-effort; never block dispatch
          }
        }

        // ── FW-DISPATCH-TASKID-IMMUTABLE + FW-UC7KS-DOMAIN-001 ──
        // Write dagTaskId + domainId to session_map DB.
        // Per-session DB record is immune to concurrent dispatch race conditions
        // (unlike shared .dispatch_ctx file) and survives task-after.ts deletion.
        // Preserves existing agent identity to avoid temporary agent mapping pollution
        // (parent session should keep its own agent, not the dispatched sub-agent type).
        if (dagTaskId && context.sessionID) {
          try {
            const existing = dbReadSessionMap(context.sessionID);
            dbWriteSessionMap(
              context.sessionID,
              existing?.agent || args.agent_type,
              dagTaskId,
              inferredDomainId || undefined,
            );
          } catch {
            // Best-effort; never block dispatch
          }
        }

        // ── FW-FIX-CHILD-SESSION-MAP (2026-06-21, @Super-Admin, Issue #117) ──
        // Write a child dispatch slot at session_id="dispatch:child:{dagTaskId}" so the
        // child agent can resolve its domain_id via Priority 1.5 before its own
        // session_map row exists (chatMessageHook has not fired yet).
        if (dagTaskId) {
          try {
            const childSessionId = "dispatch:child:" + dagTaskId;
            dbWriteSessionMap(
              childSessionId,
              args.agent_type,
              dagTaskId,
              inferredDomainId || undefined,
            );
          } catch {
            // Best-effort; never block dispatch
          }
        }

        // P0-FIX (2026-06-22, @Super-Admin): Auto-dispatch with inline wrapped prompt.
        // Previously task-before.ts loaded prompt from file — unreliable for KC.
        // Now: run dispatch-subagent.ts CLI and return its wrapped prompt directly,
        // matching the standard dispatch_subagent() → Task({prompt}) flow.
        try {
          const dp = require("path").join(
            process.cwd(),
            ".opencode",
            "scripts",
            "command-tools",
            "dispatch-subagent.ts",
          );
          const wrapped = require("child_process").execFileSync(
            "bun",
            [
              "--no-cache",
              dp,
              args.agent_type,
              dagTaskId || "(none)",
              args.task_description || "",
            ],
            {
              encoding: "utf8",
              timeout: 30000,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          return wrapped;
        } catch (e: any) {
          return [
            `/// DISPATCH RESULT (fallback — CLI failed: ${e?.message || e})`,
            `/// agent_type: ${args.agent_type}`,
            `/// dag_task_id: ${dagTaskId || "(none)"}`,
            `///    Retry with dispatch_subagent() manually.`,
          ].join("\n");
        }
      } finally {
        // ── FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): No-op finally block.
        // FRAMEWORK_TASK_ID is no longer written to the parent process (L264-266 removed).
        // task-after.ts reads dagTaskId from .dispatch_ctx file instead.
        // The save/restore dance here is no longer necessary.
      }
    });
  },
});
