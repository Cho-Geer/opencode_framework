// scope-before.ts — "tool.execute.before" plugin: write scope enforcement
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent, resolveTaskId, resolveDomainId } from "../lib/agent-resolver";
import { isModifyTool, getModifyPath, readDispatchAllowedTools, isToolAllowed, getEffectivePathScopeFilePath } from "../lib/tool-scope";
import { getEnforcementMode } from "../lib/gate-core";
import { isWriteAllowed } from "../lib/gate-checks";
import { isSourceFile } from "../lib/state-utils";
import { checkUC7KSWrite } from "../lib/uc7ks-utils";
import {
  readRouteConfig,
  isFrameworkInfraFile,
  isBusinessCodeFile,
  findRouteAgentForFile,
} from "../lib/route-validator";

export default withPluginLifecycle("scope-before", { "tool.execute.before": toolExecuteBefore });

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  writeLog("scope-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | mode=${mode}`,
  });

  // Only enforce scope for modify tools
  if (!isModifyTool(input.tool)) {
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (pass) non-modify tool",
    });
    return;
  }

  const filePath = getModifyPath(output.args || {});
  if (!filePath) {
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (pass) no file path",
    });
    return;
  }

  // Get effective file path for path-scope checks (safe_shell handling)
  const effectivePath = getEffectivePathScopeFilePath(input.tool, output.args || {});
  const applyPathScope = effectivePath !== null;

  // Agent dispatch tool check
  const allowedTools = readDispatchAllowedTools(agent);
  if (!isToolAllowed(allowedTools, input.tool)) {
    const msg = `[FW-ENFORCE] Agent "${agent}" not allowed to use tool "${input.tool}"`;
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `BLOCKED | ${msg}`,
    });
    if (mode === "strict" || mode === "locked") throw new Error(msg);
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // P0-3 ROUTE-MISMATCH: Agent → file scope (MIGRATED to route-validator.ts)
  // Originally from enforce.ts L1370-1398 (FW-ROUTE-FIX-04)
  //
  // Uses route_rules.scope_to_agent from project.config.json instead
  // of hardcoded path/agent comparisons. Configuration-driven:
  // adding new route rules only requires editing project.config.json.
  // ═══════════════════════════════════════════════════════════════
  if (applyPathScope) {
    const scopePath = effectivePath;
    const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
    const routeConfig = readRouteConfig();
    const scopeRules = routeConfig?.scope_to_agent?.rules;

    if (scopeRules) {
      const expectedAgent = findRouteAgentForFile(scopePath, scopeRules);
      if (expectedAgent) {
        const expectedNorm = expectedAgent.replace(/^@/, "").toLowerCase();
        if (expectedNorm !== agentNorm) {
          const msg =
            `[FW-ENFORCE][ROUTE-MISMATCH] ${agent} has no authority to modify ` +
            `"${scopePath}". This file should be handled by ${expectedAgent}. ` +
            `Route rules defined in project.config.json route_rules.scope_to_agent.`;
          writeLog("scope-before", "runtime", {
            sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
            level: "ERROR", event: "TOOL-BEFORE",
            detail: `BLOCKED | ROUTE-MISMATCH | agent=${agent} file=${scopePath} expected=${expectedAgent}`,
          });
          if (mode === "strict" || mode === "locked") throw new Error(msg);
          return; // advisory: logged, pass through
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // P1-2 UC7-008: Knowledge-Curator Scope Isolation
    // Migrated from enforce.ts (archived) + UC7KS-PIPELINE-STANDARD §3.8
    //
    // KC may ONLY write to:
    //   docs/official_docs/**, .metadata/**, .task_temp/**
    // KC is DENIED from:
    //   .opencode/**, booking_system_refactor/**, project.config.json,
    //   opencode.json, Task.DAG.json
    // ═══════════════════════════════════════════════════════════════
    if (agentNorm === "knowledge-curator") {
      const kcAllowed =
        scopePath.includes("docs/official_docs/") ||
        scopePath.includes(".metadata/") ||
        scopePath.includes(".task_temp/");
      if (!kcAllowed) {
        const msg =
          `[FW-ENFORCE][UC7-008] Knowledge-Curator scope violation: ` +
          `cannot write to "${scopePath}". ` +
          `Allowed: docs/official_docs/**, .metadata/**, .task_temp/**.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-008 | file=${scopePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return; // advisory: logged, pass through
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // P0-5 Write PATH Scope Check (isWriteAllowed)
    // Migrated from enforce.ts L1457-1478
    //
    // isWriteAllowed() reads project.config.json → agent_write_scopes
    // and checks denied patterns first, then allowed patterns.
    //
    // FIX: Also blocks writes when agent identity is unresolved
    // (empty string, "1", or "human") — mirrors enforce.ts L1459-1468.
    // Without this, isWriteAllowed("", fp) returns true (no scopes
    // defined for empty agent) — security hole.
    // ═══════════════════════════════════════════════════════════════
    if (!agent || agent === "1" || agent === "human") {
      const msg =
        `[FW-ENFORCE] Agent identity unresolved — write to "${scopePath}" ` +
        `BLOCKED. Agent="" (resolveAgent returned no identity). ` +
        `This indicates a dispatch mechanism failure. ` +
        `Use human dispatch (@Super-Admin) to repair or set ` +
        `FW_PROMPT_QUEUE_DRAIN=true.`;
      writeLog("scope-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-BEFORE",
        detail: `BLOCKED | UNRESOLVED-AGENT | file=${scopePath}`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return; // advisory: logged, pass through
    }

    if (!isWriteAllowed(agent, scopePath)) {
      const msg =
        `[FW-ENFORCE][WRITE-SCOPE] Agent "${agent}" write to "${scopePath}" ` +
        `blocked by permission.safe_edit in opencode.json (P2-D: authoritative source).`;
      writeLog("scope-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-BEFORE",
        detail: `BLOCKED | WRITE-SCOPE | agent=${agent} file=${scopePath}`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return; // advisory: logged, pass through
    }

    // ═══════════════════════════════════════════════════════════════
    // P1-1 UC7-001: Knowledge Cache Search Before Write
    // Migrated from enforce.ts L1426-1454 (P0-FIX-UC7KS-HARDEN-18)
    //
    // Blocks agents from writing source files without first searching
    // the local knowledge cache. P1-3 handles SA emergency bypass.
    //
    // Gate: only fires for source files (.ts/.tsx/.js/.jsx/.html/.scss/.prisma)
    // and non-advisory modes. Skips safe_shell non-modify commands
    // via applyPathScope.
    // ═══════════════════════════════════════════════════════════════
    if (isSourceFile(scopePath)) {
      // FW-UC7KS-DOMAIN-001: Pass sessionId/taskId/domainId for per-domain check.
      // resolveTaskId reads session_map DB dag_task_id; resolveDomainId reads domain_id.
      // When neither is available (manual invocation), falls back to global check.
      const taskId = resolveTaskId(input.sessionID);
      const domainId = resolveDomainId(input.sessionID);
      const uc7Block = checkUC7KSWrite(agent, mode, input.sessionID, taskId, domainId || undefined);
      if (uc7Block) {
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-001-WRITE | agent=${agent} file=${scopePath} | ${uc7Block.substring(0, 120)}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(uc7Block);
        return; // advisory: logged, pass through
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // P1-4 UC7-005: Knowledge Cache Size Cap
    // Migrated from UC7KS-PIPELINE-STANDARD §3.5
    //
    // Max single file: 500KB (524288 bytes).
    // Only applies to writes targeting docs/official_docs/.
    // Content extracted from write/edit tool args.
    // ═══════════════════════════════════════════════════════════════
    if (scopePath.includes("docs/official_docs/")) {
      const content = ((output.args?.content || output.args?.newString || "") as string);
      if (content && content.length > 524288) {
        const msg =
          `[FW-ENFORCE][UC7-005] Knowledge cache file exceeds 500KB limit: ` +
          `"${scopePath}" (${content.length} bytes > 524288). ` +
          `Split into smaller chunks or compress.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-005 | size=${content.length} | file=${scopePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return; // advisory: logged, pass through
      }
    }
  } // end if (applyPathScope)

  writeLog("scope-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: `exit (ok) tool=${input.tool} file=${filePath}`,
  });
}
