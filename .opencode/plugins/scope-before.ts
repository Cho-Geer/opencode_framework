// scope-before.ts — "tool.execute.before" plugin: write scope enforcement
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import {
  resolveAgent,
  resolveTaskId,
  resolveDomainId,
} from "../lib/agent-resolver";
import {
  isModifyTool,
  getModifyPath,
  readDispatchAllowedTools,
  isToolAllowed,
  getEffectivePathScopeFilePath,
  getEffectivePathScopePaths,
  isUC7KSWriteTarget,
} from "../lib/tool-scope";
import { getEnforcementMode } from "../lib/gate-core";
import { isWriteAllowed } from "../lib/gate-checks";
import { isSourceFile } from "../lib/state-utils";
import { checkUC7KSWrite } from "../lib/uc7ks-utils";
import { readSubState } from "../lib/substate-manager";
import {
  readRouteConfig,
  isFrameworkInfraFile,
  isBusinessCodeFile,
  findRouteAgentForFile,
} from "../lib/route-validator";

export default withPluginLifecycle("scope-before", {
  "tool.execute.before": toolExecuteBefore,
});

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
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (pass) non-modify tool",
    });
    return;
  }

  const filePath = getModifyPath(output.args || {});
  if (!filePath) {
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (pass) no file path",
    });
    return;
  }

  // Phase 2 (2026-06-18): Get all effective write target paths.
  // For non-shell tools: single path from getModifyPath.
  // For safe_shell: parsed write targets from command.
  // Returns ScopePathResult with applies, paths, and reason.
  const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");

  // Agent dispatch tool check (runs before path scope)
  const allowedTools = readDispatchAllowedTools(agent);
  if (!isToolAllowed(allowedTools, input.tool)) {
    const msg = `[FW-ENFORCE] Agent "${agent}" not allowed to use tool "${input.tool}"`;
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `BLOCKED | ${msg}`,
    });
    if (mode === "strict" || mode === "locked") throw new Error(msg);
    return;
  }

  // Phase 2 (2026-06-18): Multi-path scope check
  const scopeResult = getEffectivePathScopePaths(input.tool, output.args || {});
  const applyPathScope = scopeResult.applies;

  // Handle unparseable modify shell in strict/locked mode
  if (applyPathScope && scopeResult.reason === "unparseable_modify_shell") {
    const msg =
      `[FW-ENFORCE][UC7-001] safe_shell write command could not be parsed ` +
      `for write target paths. Use safe_edit/safe_mkdir instead of shell commands. ` +
      `Command: "${(output.args?.command || "").toString().substring(0, 80)}".`;
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `BLOCKED | UNPARSEABLE-MODIFY-SHELL | agent=${agent}`,
    });
    if (mode === "strict" || mode === "locked") throw new Error(msg);
    // advisory: warn but pass through
  }

  if (applyPathScope && scopeResult.paths.length > 0) {
    // Resolve task/domain for UC7KS per-domain check (shared across all paths)
    const taskId = resolveTaskId(input.sessionID);
    const domainId = resolveDomainId(input.sessionID);

    for (const scopePath of scopeResult.paths) {
      // ═══════════════════════════════════════════════════════════════
      // P0-3 ROUTE-MISMATCH: Agent → file scope
      // ═══════════════════════════════════════════════════════════════
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
              sessionID: input.sessionID,
              callID: input.callID,
              agent,
              agentType: agent,
              level: "ERROR",
              event: "TOOL-BEFORE",
              detail: `BLOCKED | ROUTE-MISMATCH | agent=${agent} file=${scopePath} expected=${expectedAgent}`,
            });
            if (mode === "strict" || mode === "locked") throw new Error(msg);
            return;
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // P1-2 UC7-008: Knowledge-Curator Scope Isolation
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
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            level: "ERROR",
            event: "TOOL-BEFORE",
            detail: `BLOCKED | UC7-008 | file=${scopePath}`,
          });
          if (mode === "strict" || mode === "locked") throw new Error(msg);
          return;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // P0-5 Write PATH Scope Check (isWriteAllowed)
      // ═══════════════════════════════════════════════════════════════
      if (!agent || agent === "1" || agent === "human") {
        const msg =
          `[FW-ENFORCE] Agent identity unresolved — write to "${scopePath}" ` +
          `BLOCKED. Use human dispatch (@Super-Admin) to repair.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
          level: "ERROR",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | UNRESOLVED-AGENT | file=${scopePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return;
      }

      if (!isWriteAllowed(agent, scopePath)) {
        const msg =
          `[FW-ENFORCE][WRITE-SCOPE] Agent "${agent}" write to "${scopePath}" ` +
          `blocked by permission.safe_edit in opencode.json (P2-D: authoritative source).`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
          level: "ERROR",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | WRITE-SCOPE | agent=${agent} file=${scopePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return;
      }

      // ═══════════════════════════════════════════════════════════════
      // R4 (2026-06-19): Config Read Attestation Pre-Gate — FIXED
      // RACE CONDITION FIX: Uses nested sessions map (sessions[sessionID])
      // instead of global singleton session_id. Each session's attestation
      // is independently stored and looked up — no cross-agent overwrites.
      // dbAtomicWriteSubState provides atomic append within SQLite transaction.
      // Runs BEFORE UC7-001 knowledge cache check.
      // Sessions without config_read_state → skip (backward compatible).
      // ═══════════════════════════════════════════════════════════════
      const configReadState = readSubState("config_read_state");
      const sessions = configReadState?.sessions || {};
      const myAttestation = sessions[input.sessionID];

      if (myAttestation && myAttestation.session_id === input.sessionID) {
        // Session-specific attestation found in sessions map — attestation complete
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
          event: "TOOL-BEFORE",
          detail: `config_read_state verified (sessions map) — attestation complete`,
        });
      } else {
        // No config_read_state attestation for this session.
        // In strict/locked mode, BLOCK writes until Step 0e is completed.
        // In advisory mode, warn but allow (backward compatible).
        if (mode === "strict" || mode === "locked") {
          const msg =
            `[FW-ENFORCE][CONFIG-READ-ATTEST] Config read attestation ` +
            `has not been completed. ` +
            `Run P0 Step 0e BEFORE writing: read your agent config ` +
            `(.opencode/agents/{Type}.md), opencode.json, and ` +
            `project.config.json using the 'read' tool, then call ` +
            `config_read_attest() to unlock writes.`;
          writeLog("scope-before", "runtime", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            level: "ERROR",
            event: "TOOL-BEFORE",
            detail: `BLOCKED | CONFIG-READ-ATTEST-MISSING | agent=${agent} | session=${input.sessionID}`,
          });
          throw new Error(msg);
        }
        // advisory: warn only
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
          event: "TOOL-BEFORE",
          detail: `config_read_state not yet attested (session=${input.sessionID}) — advisory mode, allowing writes`,
        });
      }

      // ═══════════════════════════════════════════════════════════════
      // P1-1 UC7-001: Knowledge Cache Search Before Write
      // Phase 2 (2026-06-18): Expanded to all UC7KS write targets
      // (framework files, review/design docs, root config, source files)
      // Uses isUC7KSWriteTarget() instead of isSourceFile().
      // ═══════════════════════════════════════════════════════════════
      if (isUC7KSWriteTarget(scopePath)) {
        const uc7Block = checkUC7KSWrite(
          agent,
          mode,
          input.sessionID,
          taskId,
          domainId || undefined,
        );
        if (uc7Block) {
          writeLog("scope-before", "runtime", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            level: "ERROR",
            event: "TOOL-BEFORE",
            detail: `BLOCKED | UC7-001-WRITE | agent=${agent} file=${scopePath} | ${uc7Block.substring(0, 120)}`,
          });
          if (mode === "strict" || mode === "locked") throw new Error(uc7Block);
          return;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // P1-4 UC7-005: Knowledge Cache Size Cap
      // ═══════════════════════════════════════════════════════════════
      if (scopePath.includes("docs/official_docs/")) {
        const content = (output.args?.content ||
          output.args?.newString ||
          "") as string;
        if (content && content.length > 524288) {
          const msg =
            `[FW-ENFORCE][UC7-005] Knowledge cache file exceeds 500KB limit: ` +
            `"${scopePath}" (${content.length} bytes > 524288). ` +
            `Split into smaller chunks or compress.`;
          writeLog("scope-before", "runtime", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
            level: "ERROR",
            event: "TOOL-BEFORE",
            detail: `BLOCKED | UC7-005 | size=${content.length} | file=${scopePath}`,
          });
          if (mode === "strict" || mode === "locked") throw new Error(msg);
          return;
        }
      }
    } // end for each scopePath
  } // end if (applyPathScope) else if unparseable_modify_shell — handled above

  writeLog("scope-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    agentType: agent,
    event: "TOOL-BEFORE",
    detail: `exit (ok) tool=${input.tool} file=${filePath} scopePaths=${scopeResult.paths.length}`,
  });
}
