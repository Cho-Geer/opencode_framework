// scope-before.ts — "tool.execute.before" plugin: write scope enforcement
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { isModifyTool, getModifyPath, readDispatchAllowedTools, isToolAllowed } from "../lib/tool-scope";
import { getEnforcementMode } from "../lib/gate-core";
import { isWriteAllowed } from "../lib/gate-checks";
import { isModifyShell } from "../lib/tool-scope";
import { isSourceFile } from "../lib/state-utils";
import { checkUC7KSWrite } from "../lib/uc7ks-utils";

ensureLogDir();
writeLog("scope-before", "loaded", { event: "PLUGIN-LOADED", detail: "scope-before.ts" });
updateIndex("scope-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("scope-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

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

  // safe_shell guard: only apply path scope to cp/mv/rm commands.
  // For safe_shell, getModifyPath() returns args.command (the shell
  // command string, not a file path). Applying ROUTE-MISMATCH and
  // isWriteAllowed to arbitrary command strings produces false
  // positives (e.g., "cat .opencode/x" would match .opencode/).
  const applyPathScope =
    input.tool !== "safe_shell"
      ? true
      : isModifyShell(output.args || {});

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
  // P0-3 ROUTE-MISMATCH: Architect/Orchestrator → framework files
  // Migrated from enforce.ts L1370-1398 (FW-ROUTE-FIX-04)
  //
  // @Architect and @Orchestrator must NOT modify framework infra.
  // Framework files: .opencode/**, opencode.json, AGENTS.md
  // Route to @Super-Admin for framework changes.
  // ═══════════════════════════════════════════════════════════════
  if (applyPathScope) {
    const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
    if (agentNorm === "architect" || agentNorm === "orchestrator") {
      if (filePath.includes(".opencode/") || filePath === "opencode.json" || filePath.includes("AGENTS.md")) {
        const msg =
          `[FW-ENFORCE][ROUTE-MISMATCH] ${agent} has no authority to modify ` +
          `framework files (${filePath}). Framework infrastructure is ` +
          `administered by @Super-Admin. Auto-route this task to @Super-Admin.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | ROUTE-MISMATCH | framework-file | agent=${agent} file=${filePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        return; // advisory: logged, pass through
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // P0-4 ROUTE-MISMATCH: Super-Admin → business code
    // Migrated from enforce.ts L1400-1425 (FW-ROUTE-FIX-04)
    // FIX: Original enforce.ts had SA bypass at L1327 that made this
    // check dead code. Migration removes the bypass — SA is now
    // subject to business code restriction.
    //
    // Business paths mirror project.config.json agent_write_scopes
    // @Super-Admin.denied (L830-832).
    // ═══════════════════════════════════════════════════════════════
    if (agentNorm === "super-admin") {
      const businessPaths = [
        "booking_system_refactor/booking-backend/src/",
        "booking_system_refactor/booking-frontend/src/",
        "booking_system_refactor/booking-backend/prisma/schema.prisma",
      ];
      for (const bp of businessPaths) {
        if (filePath.includes(bp)) {
          const msg =
            `[FW-ENFORCE][ROUTE-MISMATCH] Super-Admin has no authority to ` +
            `modify business code (${filePath}). Business code modifications ` +
            `must be handled by @Coder-BE or @Coder-FE.`;
          writeLog("scope-before", "runtime", {
            sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
            level: "ERROR", event: "TOOL-BEFORE",
            detail: `BLOCKED | ROUTE-MISMATCH | SA→business | file=${filePath}`,
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
        filePath.includes("docs/official_docs/") ||
        filePath.includes(".metadata/") ||
        filePath.includes(".task_temp/");
      if (!kcAllowed) {
        const msg =
          `[FW-ENFORCE][UC7-008] Knowledge-Curator scope violation: ` +
          `cannot write to "${filePath}". ` +
          `Allowed: docs/official_docs/**, .metadata/**, .task_temp/**.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-008 | file=${filePath}`,
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
        `[FW-ENFORCE] Agent identity unresolved — write to "${filePath}" ` +
        `BLOCKED. Agent="" (resolveAgent returned no identity). ` +
        `This indicates a dispatch mechanism failure. ` +
        `Use human dispatch (@Super-Admin) to repair or set ` +
        `FW_PROMPT_QUEUE_DRAIN=true.`;
      writeLog("scope-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-BEFORE",
        detail: `BLOCKED | UNRESOLVED-AGENT | file=${filePath}`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return; // advisory: logged, pass through
    }

    if (!isWriteAllowed(agent, filePath)) {
      const msg =
        `[FW-ENFORCE][WRITE-SCOPE] Agent "${agent}" write to "${filePath}" ` +
        `blocked by agent_write_scopes in project.config.json.`;
      writeLog("scope-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-BEFORE",
        detail: `BLOCKED | WRITE-SCOPE | agent=${agent} file=${filePath}`,
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
    if (isSourceFile(filePath)) {
      const uc7Block = checkUC7KSWrite(agent, mode);
      if (uc7Block) {
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-001-WRITE | agent=${agent} file=${filePath} | ${uc7Block.substring(0, 120)}`,
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
    if (filePath.includes("docs/official_docs/")) {
      const content = ((output.args?.content || output.args?.newString || "") as string);
      if (content && content.length > 524288) {
        const msg =
          `[FW-ENFORCE][UC7-005] Knowledge cache file exceeds 500KB limit: ` +
          `"${filePath}" (${content.length} bytes > 524288). ` +
          `Split into smaller chunks or compress.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "ERROR", event: "TOOL-BEFORE",
          detail: `BLOCKED | UC7-005 | size=${content.length} | file=${filePath}`,
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
