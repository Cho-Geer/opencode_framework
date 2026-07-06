// service/gate/scope-validate.ts — Write scope before-hook validation logic
// Source: scope-before.ts plugin (421L → service extraction)
// All read-only decision logic for write scope enforcement:
// tool allowed, path scope, backup-bypass, route mismatch, KC scope,
// write permission, config-read attest, UC7KS checks.

import { writeLog } from "../../lib/log-manager";
import {
  resolveAgent,
  resolveTaskId,
  resolveDomainId,
} from "../../lib/agent-resolver";
import {
  isModifyTool,
  getModifyPath,
  getEffectivePathScopePaths,
  isUC7KSWriteTarget,
  classifyShellCommand,
} from "../../lib/tool-scope";
import { shouldBlock } from "../enforcement/rule-disposition";
import { checkUC7KSWrite } from "../../lib/uc7ks-utils";
import { readSubState } from "../../lib/substate-manager";
import {
  readRouteConfig,
  findRouteAgentForFile,
} from "../../lib/route-validator";

const SRC = "service-scope-validate";

// Trusted script pattern: direct interpreter + explicit .opencode script path
const TRUSTED_INTERPRETERS = /^(bun|node|bash|sh|python|python3|ruby|perl)\s+(\.opencode\/(scripts|lib)\/[\w\-\.\/]+\.(ts|js|sh))(?:$|\s)/;
const INLINE_INTERPRETER = /(?:^|\s)(node|python|python3|ruby|perl)\s+(-e|-c)(?:\s|$)/;

export function validateWriteScope(input: any, output: any): { blocked: boolean; message?: string } {
  const agent = resolveAgent(input.sessionID);
  const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");

  writeLog(SRC, "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TOOL-BEFORE", detail: `enter | tool=${input.tool}`,
  });

  // Only enforce scope for modify tools
  if (!isModifyTool(input.tool)) {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "TOOL-BEFORE", detail: "exit (pass) non-modify tool",
    });
    return { blocked: false };
  }

  const filePath = getModifyPath(output.args || {});
  if (!filePath) {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "TOOL-BEFORE", detail: "exit (pass) no file path",
    });
    return { blocked: false };
  }

  // ── Multi-path scope check ──
  const scopeResult = getEffectivePathScopePaths(input.tool, output.args || {});
  const applyPathScope = scopeResult.applies;

  // ── Unparseable modify shell handling ──
  if (applyPathScope && scopeResult.reason === "unparseable_modify_shell") {
    const cmdStr = (output.args?.command || "").toString();
    const classification = classifyShellCommand(cmdStr);

    // GAP B3: read-only commands — allow even in strict/locked
    if (classification.kind === "read_only") {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent,
        event: "TOOL-BEFORE",
        detail: `exit (pass) shell classified read_only | reason=${classification.reason}`,
      });
      return { blocked: false };
    }

    // Trusted script paths
    const hasInlineInterpreter = INLINE_INTERPRETER.test(cmdStr);
    const isTrustedScriptPath = !hasInlineInterpreter && TRUSTED_INTERPRETERS.test(cmdStr);

    if (isTrustedScriptPath) {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent,
        event: "TOOL-BEFORE", detail: `exit (pass) trusted script path`,
      });
    } else {
      const msg =
        `[FW-ENFORCE][BACKUP-BYPASS] safe_shell write command could not be parsed ` +
        `for write target paths. Use safe_edit/safe_mkdir instead of shell commands. ` +
        `Command: "${cmdStr.substring(0, 80)}".` +
        `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`;
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent,
        level: "ERROR", event: "TOOL-BEFORE",
        detail: `BLOCKED | UNPARSEABLE-MODIFY-SHELL | kind=${classification.kind}`,
      });
      if (shouldBlock("backup-bypass")) return { blocked: true, message: msg };
    }
  }

  // ── BACKUP-BYPASS PREVENTION ──
  // safe_shell/bash have NO backup mechanism — block file modifications
  if (
    applyPathScope &&
    scopeResult.paths.length > 0 &&
    (input.tool === "safe_shell" || input.tool === "bash")
  ) {
    const cmdPreview = (output.args?.command || "").toString().substring(0, 100);
    const msg =
      `[FW-ENFORCE][BACKUP-BYPASS] ${input.tool} file modification blocked. ` +
      `Use safe_edit or safe_delete instead — they create backups via createGitBackup(). ` +
      `Command: "${cmdPreview}". Write targets: ${scopeResult.paths.join(", ")}` +
        `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`;
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      level: "ERROR", event: "TOOL-BEFORE",
      detail: `BLOCKED | BACKUP-BYPASS-SAFE-SHELL-WRITE | targets=${scopeResult.paths.length}`,
    });
    if (shouldBlock("backup-bypass")) return { blocked: true, message: msg };
  }

  // ── Per-path checks ──
  if (applyPathScope && scopeResult.paths.length > 0) {
    const taskId = resolveTaskId(input.sessionID);
    const domainId = resolveDomainId(input.sessionID);

    for (const scopePath of scopeResult.paths) {
      // P0-3: ROUTE-MISMATCH (agent → file scope)
      const routeConfig = readRouteConfig();
      const scopeRules = routeConfig?.scope_to_agent?.rules;
      if (scopeRules) {
        const expectedAgent = findRouteAgentForFile(scopePath, scopeRules);
        if (expectedAgent) {
          const expectedNorm = expectedAgent.replace(/^@/, "").toLowerCase();
          if (expectedNorm !== agentNorm) {
            writeLog(SRC, "runtime", {
              sessionID: input.sessionID, callID: input.callID, agent,
              level: "WARN", event: "TOOL-BEFORE",
              detail: `ROUTE-MISMATCH-AUDIT | file=${scopePath} expected=${expectedAgent}`,
            });
          }
        }
      }

      // Identity resolution remains observable, but no longer blocks writes by itself.
      if (!agent || agent === "1" || agent === "human") {
        writeLog(SRC, "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          level: "WARN", event: "TOOL-BEFORE",
          detail: `AGENT-UNRESOLVED-AUDIT | file=${scopePath}`,
        });
      }

      // R4: Config Read Attestation Pre-Gate
      const configReadState = readSubState("config_read_state");
      const sessions = configReadState?.sessions || {};
      const myAttestation = sessions[input.sessionID];

      if (myAttestation && myAttestation.session_id === input.sessionID) {
        writeLog(SRC, "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          event: "TOOL-BEFORE",
          detail: `config_read_state verified (sessions map) — attestation complete`,
        });
      } else {
        writeLog(SRC, "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          level: "WARN", event: "TOOL-BEFORE",
          detail: `CONFIG-READ-ATTEST-MISSING | session=${input.sessionID} | audit only`,
        });
      }

      // P1-1: UC7-001 Knowledge Cache Search Before Write
      if (isUC7KSWriteTarget(scopePath)) {
        const uc7Block = checkUC7KSWrite(
          agent, input.sessionID, taskId, domainId || undefined,
        );
        if (uc7Block) {
          writeLog(SRC, "runtime", {
            sessionID: input.sessionID, callID: input.callID, agent,
            level: "ERROR", event: "TOOL-BEFORE",
            detail: `BLOCKED | UC7-001-WRITE | file=${scopePath} | ${uc7Block.substring(0, 120)}`,
          });
          if (shouldBlock("uc7ks-tracking")) return { blocked: true, message: uc7Block + "\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path." };
          return { blocked: false };
        }
      }

      // P1-4: UC7-005 Knowledge Cache Size Cap
      if (scopePath.includes("docs/official_docs/")) {
        const content = (output.args?.content || output.args?.newString || "") as string;
        if (content && content.length > 524288) {
          const msg =
            `[FW-ENFORCE][UC7-005] Knowledge cache file exceeds 500KB limit: ` +
            `"${scopePath}" (${content.length} bytes > 524288). ` +
            `Split into smaller chunks or compress.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`;
          writeLog(SRC, "runtime", {
            sessionID: input.sessionID, callID: input.callID, agent,
            level: "ERROR", event: "TOOL-BEFORE",
            detail: `BLOCKED | UC7-005 | size=${content.length} | file=${scopePath}`,
          });
          if (shouldBlock("write-scope-violation")) return { blocked: true, message: msg };
          return { blocked: false };
        }
      }
    }
  }

  writeLog(SRC, "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TOOL-BEFORE",
    detail: `exit (ok) tool=${input.tool} file=${filePath} scopePaths=${scopeResult.paths.length}`,
  });
  return { blocked: false };
}
