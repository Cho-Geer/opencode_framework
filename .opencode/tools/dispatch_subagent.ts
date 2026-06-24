// .opencode/tools/dispatch_subagent.ts
import { tool } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { withInterruptGuard } from "../lib";
import { atomicWriteSubState, atomicWriteJson } from "../lib/state-utils";
import { writeAuditLogEntry } from "../lib/audit-log";
import { writeLog } from "../lib/log-manager";
import { isDagExempt, readDispatchPolicy, autoPlan } from "../lib/dag-policy";
import { findTaskInDag } from "../lib/gate-checks";
import {
  isPrivileged,
  isKnowledgeCurator as isKC,
  normalize,
} from "../lib/agent-identity";
import {
  dbWriteSessionMap,
  dbReadSessionMap,
  dbQuerySessionByDagTaskId,
} from "../lib/db-state-manager";

/** Log source identifier for writeLog calls. */
const SRC = "tool-dispatch-subagent";

// ── UC7KS Dispatch Bypass Helpers (FW-DISPATCH-BYPASS) ──

/**
 * Load UC7KS dispatch pattern list from project.config.json.
 * Returns built-in defaults if config is unreadable.
 * Patterns are case-insensitive matched against task_description.
 */
function loadUC7KSDispatchPatterns(worktree: string): string[] {
  const DEFAULTS = [
    "knowledge",
    "cache",
    "docs",
    "official",
    "context7",
    "uc7ks",
    "fetch",
    "curator",
    "index",
    "explore",
    "source code",
    "repository",
    "github",
    "documentation",
    "library",
    "api reference",
  ];
  try {
    const configPath = path.join(worktree, ".opencode", "project.config.json");
    if (!existsSync(configPath)) return DEFAULTS;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const patterns =
      config?.template_resolution?.super_admin_uc7ks_dispatch_patterns;
    return Array.isArray(patterns) && patterns.length > 0 ? patterns : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Load Super-Admin repair pattern list from project.config.json.
 * Returns built-in defaults if config is unreadable.
 */
function loadSARepairPatterns(worktree: string): string[] {
  const DEFAULTS = [
    "repair",
    "fix",
    "restore",
    "corrupt",
    "broken",
    "emergency",
    "reset",
    "drain",
    "purge",
    "reconcile",
    "inconsistency",
    "state",
    "hook",
    "plugin",
    "integrity",
    "machine.json",
    "gate-state",
    "compliance",
  ];
  try {
    const configPath = path.join(worktree, ".opencode", "project.config.json");
    if (!existsSync(configPath)) return DEFAULTS;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const patterns = config?.template_resolution?.super_admin_repair_patterns;
    return Array.isArray(patterns) && patterns.length > 0 ? patterns : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Log an Orchestrator → Super-Admin dispatch to the audit trail.
 */
function logOrchestratorSADispatch(opts: {
  caller: string;
  target: string;
  task_description: string;
  dag_task_id: string;
  patterns_matched: string[];
  mode: string;
}): void {
  try {
    writeAuditLogEntry({
      timestamp: new Date().toISOString(),
      event: "orchestrator_sa_dispatch",
      caller: opts.caller,
      target: opts.target,
      task_description_hash: opts.task_description.slice(0, 80),
      dag_task_id: opts.dag_task_id,
      patterns_matched: opts.patterns_matched,
      mode: opts.mode,
    });

    const machinePath = path.join(
      process.env.OPENCODE_ROOT || process.cwd(),
      ".opencode",
      "state",
      "machine.json",
    );
    if (existsSync(machinePath)) {
      atomicWriteSubState("compliance_records", (cr) => {
        cr.orchestrator_sa_dispatches = cr.orchestrator_sa_dispatches || [];
        cr.orchestrator_sa_dispatches.push({
          timestamp: new Date().toISOString(),
          caller: opts.caller,
          target: opts.target,
          dag_task_id: opts.dag_task_id,
          patterns_matched: opts.patterns_matched,
          mode: opts.mode,
        });
        if (cr.orchestrator_sa_dispatches.length > 100) {
          cr.orchestrator_sa_dispatches =
            cr.orchestrator_sa_dispatches.slice(-100);
        }
      });
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Log a Super-Admin → Knowledge-Curator dispatch bypass to the audit trail.
 */
function logSuperAdminDispatchBypass(opts: {
  caller: string;
  target: string;
  task_description: string;
  dag_task_id: string;
  patterns_matched: string[];
}): void {
  try {
    writeAuditLogEntry({
      timestamp: new Date().toISOString(),
      event: "super_admin_kc_dispatch_bypass",
      caller: opts.caller,
      target: opts.target,
      task_description_hash: opts.task_description.slice(0, 80),
      dag_task_id: opts.dag_task_id,
      patterns_matched: opts.patterns_matched,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * FW-UC7KS-DOMAIN-001: Infer primary domain_id from agent type.
 * Reads `agent_domain_map` from project.config.json. Returns null if
 * no mapping exists (e.g., cross-domain or non-writing roles like
 * Orchestrator, Knowledge-Curator).
 */
function inferDomainId(agentType: string): string | null {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.join(root, ".opencode", "project.config.json");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      const map = cfg.agent_domain_map;
      if (map && typeof map === "object") {
        const normalized = agentType.replace(/^@/, "");
        // Case-insensitive lookup
        for (const [key, val] of Object.entries(map)) {
          if (key.toLowerCase() === normalized.toLowerCase()) {
            return typeof val === "string" && val ? val : null;
          }
        }
      }
    }
  } catch {
    /* best-effort */
  }
  return null;
}

export default tool({
  description:
    "Generate a wrapped, compliance-enforced prompt for dispatching a sub-agent " +
    "via Task(). Runs dispatch-subagent.js to embed DISPATCH_TOKEN and P0 protocol. " +
    "Every dispatch creates a NEW session. Context between dispatches is carried " +
    "exclusively via HANDOVER.md files. Usable by @Orchestrator (all agents) and " +
    "@Super-Admin (@Knowledge-Curator only, UC7KS knowledge tasks).",
  args: {
    agent_type: tool.schema
      .string()
      .describe(
        "Target agent type (e.g., 'Architect', 'Coder-BE', 'Meta-Planner'). " +
          "@Super-Admin may only target 'Knowledge-Curator' or '@Knowledge-Curator'.",
      ),
    task_description: tool.schema
      .string()
      .describe("Task description to wrap with P0 protocol and DISPATCH_TOKEN"),
    dag_task_id: tool.schema
      .string()
      .optional()
      .describe(
        "DAG Task ID — must exist in Task.DAG.json for non-DAG-exempt agents. " +
          "This is the project work unit identifier assigned by @Meta-Planner. " +
          "It is validated against Task.DAG.json tasks[] and execution_order by " +
          "the PLAN-FIRST gate (Layer 1/2/3). When require_dag_entry=true in " +
          "dispatch_policy, this ID MUST be found in the DAG with status pending/in_progress. " +
          "DAG-exempt agents (Meta-Planner/Orchestrator/Super-Admin/Knowledge-Curator) " +
          "bypass this check. See docs/review/cicd-dag-block/plan-first-redesign.md.",
      ),
    session_namespace: tool.schema
      .string()
      .optional()
      .describe(
        "Output path namespace — used for .task_temp/{session_namespace}/ directory " +
          "and session tracking. This is conceptually the OpenCode upstream task_id: " +
          "the identifier passed to Task() for session naming and recovery. " +
          "Defaults to dag_task_id when not provided. " +
          "Use a distinct namespace when multiple dispatches target the same DAG task.",
      ),
    auto_plan: tool.schema
      .boolean()
      .optional()
      .describe(
        "PLAN-FIRST self-healing (opt-in, default false). " +
          "When true and dispatch_policy.auto_plan_enabled is true in project.config.json, " +
          "and the target agent is NOT DAG-exempt, and dag_task_id is not yet in Task.DAG.json, " +
          "the framework auto-dispatches @Meta-Planner to plan the task, polls Task.DAG.json " +
          "until the entry appears (bounded by dispatch_policy.auto_plan_timeout_ms), and " +
          "then proceeds with the original dispatch. Rate-limited to " +
          "dispatch_policy.auto_plan_max_per_session attempts per caller session. " +
          "Forced to false in locked enforcement mode (human-in-the-loop). " +
          "Every invocation is recorded in machine.json.auto_plan_history.",
      ),
    resume_session_id: tool.schema
      .string()
      .optional()
      .describe(
        "Session ID of a previously dispatched sub-agent to resume. " +
          "When provided, the output header will include task_id in the Task() invocation, " +
          "enabling session resumption via upstream OpenCode's task_id parameter. " +
          "Only set if you mean to resume a previous task. The session must have been " +
          "recorded in the session_log DB table (queryable by dag_task_id). When absent, every dispatch " +
          "creates a NEW session (default behavior).",
      ),
  },
  async execute(args, context) {
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

      // V1.1 FIX (2026-06-23, @Super-Admin, agent-execution-flow-vulnerability-analysis.md):
      // Auto-generate pipeline tracking UUID when dag_task_id is missing.
      // Ensures UC7KS resolvePipelineId has a deterministic, non-empty pipeline_id.
      // Design: docs/review/framework-refactor/uc7ks-pipeline-db-canonical-design.md §3.5.3
      var effectiveDagTaskId = dagTaskId;
      if (!effectiveDagTaskId) {
        const trackingUuid = require("node:crypto").randomUUID();
        effectiveDagTaskId = trackingUuid;
        writeLog(SRC, "INFO", {
          event: "DAGTASK-ID-AUTO-GENERATED",
          detail:
            `dispatch to ${targetAgent} (caller=${callerAgent}) has no dag_task_id — ` +
            `auto-generated tracking UUID: ${trackingUuid} for UC7KS pipeline continuity.`,
        });
      }

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
        const callerNorm = normalize(caller);
        const isOrchestrator = callerNorm === "orchestrator";
        const isSuperAdmin = callerNorm === "super-admin";
        const isKCTarget = isKC(args.agent_type);

        if (!isOrchestrator) {
          // ── Any agent may dispatch Knowledge-Curator for UC7KS pipeline ──
          if (isKCTarget) {
            // Allow: any agent can dispatch KC for knowledge acquisition
            // No pattern check needed for non-Super-Admin agents
          } else if (isSuperAdmin && isKCTarget) {
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
        const isSATarget = isKC(args.agent_type) // normalized check
          ? false // KC is not SA target
          : normalize(args.agent_type) === "super-admin";
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
            mode,
          });
        }

        const worktree = context.worktree || process.cwd();
        const dagTaskId = args.dag_task_id || "";
        /**
         * session_namespace: the OpenCode upstream task_id — used for output path
         * namespacing (.task_temp/{sessionNamespace}/) and session tracking.
         * Defaults to dag_task_id when not explicitly provided.
         * @see docs/review/framework-refactor/task-id-duality-complete-audit.md §1
         */
        const sessionNamespace = args.session_namespace || dagTaskId;

        // ── Execute dispatch-subagent.js ──
        // Use execFileSync to bypass shell, preventing injection/misparsing of
        // special characters (newlines, backticks, CJK) in task_description.
        // dag_task_id passed via env var for DAG audit; session_namespace passed as
        // positional arg for output path namespacing.
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

        // Build argv: [scriptPath, agent_type, sessionNamespace?, task_description?]
        // sessionNamespace is passed as 2nd positional param for output path namespacing
        // and .dispatch_ctx file content.
        const scriptArgs = [args.agent_type];
        if (sessionNamespace) {
          scriptArgs.push(sessionNamespace);
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
                OPENCODE_SESSION_ID: context.sessionID || "",
                DISPATCH_TASK_DESC: args.task_description,
                // DISPATCH_NAMESPACE: OpenCode upstream task_id for output path (.task_temp/...)
                ...(sessionNamespace
                  ? { DISPATCH_NAMESPACE: sessionNamespace }
                  : {}),
                // DISPATCH_DAG_TASK_ID: DAG task ID for audit/validation in child script
                ...(effectiveDagTaskId
                  ? { DISPATCH_DAG_TASK_ID: effectiveDagTaskId }
                  : {}),
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
                detail: `Appending to queue (${queue.length} existing). New: ${args.agent_type}:${sessionNamespace || "?"}`,
              });
            }

            queue.push({
              sessionId: context.sessionID || "",
              agentType: args.agent_type,
              taskId: sessionNamespace || "",
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

        // ── V1.3 Phase 2 FIX (2026-06-23, @Super-Admin): ──
        // REMOVED: Legacy .dispatch_ctx shared-singleton write.
        // Previously Phase 1 dual-wrote both .dispatch_ctx (shared, race-prone)
        // AND ctx/{dagTaskId}.json (per-dispatch, isolated). The shared file caused
        // race conditions when concurrent dispatches overwrote each other's data.
        //
        // Phase 2 removes the write side. Readers still fall back to existing
        // .dispatch_ctx files for backward compat (singleton cleanup still valid).
        // All NEW dispatches use ctx/{dagTaskId}.json only.
        //
        // §3.3: Per-dispatch ctx file (dagTaskId-keyed, no overwrites)
        // Eliminates the session_map race condition caused by concurrent dispatches
        // overwriting the shared .dispatch_ctx singleton. Each dispatch gets its own
        // ctx/{dagTaskId}.json file — isolated, race-free.
        const inferredDomainId = inferDomainId(args.agent_type);
        if (effectiveDagTaskId) {
          try {
            const root = process.env.OPENCODE_ROOT || process.cwd();
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
              effectiveDagTaskId + ".json",
            );
            writeFileSync(
              ctxPerDispatchPath,
              JSON.stringify({
                pipeline_id: effectiveDagTaskId,
                dagTaskId,
                agentType: args.agent_type,
                domainId: inferredDomainId,
                parentSessionId: context.sessionID,
                createdAt: Date.now(),
              }),
              "utf8",
            );
            writeLog(SRC, "INFO", {
              event: "DISPATCH-CTX-WRITTEN",
              detail: `ctx/${dagTaskId}.json — .dispatch_ctx write REMOVED (V1.3 Phase 2)`,
            });
          } catch {
            // Best-effort; never block dispatch
          }
        }

        // ── FW-DISPATCH-TASKID-IMMUTABLE + FW-UC7KS-DOMAIN-001 ──
        // Write dagTaskId + domainId to session_map DB.
        // Per-session DB record is immune to concurrent dispatch race conditions
        //
        // V1.2 FIX (2026-06-23, @Super-Admin, agent-execution-flow-vulnerability-analysis.md):
        //   Removed existing?.agent guard. Previously: when chatMessageHook (session.ts)
        //   had not yet fired, existing?.agent was null, and dbWriteSessionMap was
        //   skipped. This caused dagTaskId to never be written — breaking checklist
        //   resolution for the child agent.
        //
        //   New behavior: Always write dagTaskId + domainId. Use existing agent if
        //   available, else "pending" placeholder. chatMessageHook will overwrite
        //   with the actual agent when it fires (INSERT OR REPLACE handles this).
        //
        //   The child dispatch slot (dispatch:child:{dagTaskId}) is ALSO written
        //   below for redundancy — resolving via Priority 1.5 in agent-resolver.
        if (effectiveDagTaskId && context.sessionID) {
          try {
            const existing = dbReadSessionMap(context.sessionID);
            const agentForWrite = existing?.agent || "pending";
            dbWriteSessionMap(
              context.sessionID,
              agentForWrite,
              dagTaskId,
              inferredDomainId || undefined,
            );
            writeLog(SRC, "INFO", {
              event: "SESSION-MAP-DAGTASK-WRITE",
              detail: `session=${context.sessionID} dagTaskId=${dagTaskId} agent=${agentForWrite} domainId=${inferredDomainId || "—"}`,
            });
          } catch (err: any) {
            writeLog(SRC, "WARN", {
              event: "SESSION-MAP-DAGTASK-WRITE-FAILED",
              detail: `session=${context.sessionID} dagTaskId=${dagTaskId} err=${err.message}`,
            });
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
              effectiveDagTaskId || "(none)",
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
            `/// dag_task_id: ${effectiveDagTaskId || "(none)"}`,
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
