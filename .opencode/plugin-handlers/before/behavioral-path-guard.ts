// plugin-handlers/before/behavioral-path-guard.ts — Behavioral Path Guard
// Does NOT depend on agent identity. Only looks at:
//   - What tool (safe_edit, safe_delete, safe_restore)
//   - Where (target file path)
//   - Context (is it a protected framework path?)
//
// Protected paths are globally enforced for ALL agents.
// breakGlass=true in tool args bypasses the check (with audit log).
//
// v1.0 (2026-07-05) — Smoke test for behavioral enforcement model.
import { writeLog } from "../../lib/log-manager";
import { writeJsonl } from "../../lib/jsonl-writer";

const SRC = "plugin-behavioral-path-guard";

export const name = "behavioral-path-guard";
export const tools = ["*"];

// Write tools that modify files
const WRITE_TOOLS = new Set([
  "safe_edit", "safe_delete", "safe_restore", "safe_shell", "safe_mkdir", "safe_framework_edit",
]);

// Protected framework paths — regex patterns with reasons.
// Any write to these paths is blocked unless breakGlass=true.
const PROTECTED_PATHS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\.opencode\/plugins\//, reason: "plugin dispatcher code is framework infrastructure" },
  { pattern: /\.opencode\/plugin-handlers\//, reason: "plugin handler code is enforcement pipeline" },
  { pattern: /\.opencode\/lib\//, reason: "shared library code is framework foundation" },
  { pattern: /\.opencode\/service\//, reason: "service layer is framework core" },
  { pattern: /\.opencode\/hooks\//, reason: "git hooks are enforcement boundary" },
  { pattern: /opencode\.json$/, reason: "config file is framework authority" },
  { pattern: /\.opencode\/project\.config\.json$/, reason: "project config is runtime authority" },
];

export async function handle(input: any, _output: any): Promise<void> {
  const toolName = input.tool as string;
  const args = input.args || _output?.args || {};

  // Only check write tools
  if (!WRITE_TOOLS.has(toolName)) return;
  const filePath = (args.filePath || args.path || args.uuid || "") as string;
  // For safe_shell, extract path from command argument
  const command = (args.command || "") as string;
  const sessionID = input.sessionID || "unknown";
  // For safe_shell, check if command targets a protected path
  if (!filePath && toolName === "safe_shell" && command) {
    // Exempt read-only commands from protected-path blocking
    const readOnlyPattern = /^(cat|head|tail|ls|wc|grep|find|sha256sum|md5sum|file|stat|diff|tree)\b/;
    if (readOnlyPattern.test(command.trim())) return;
    for (const { pattern, reason } of PROTECTED_PATHS) {
      if (pattern.test(command)) {
        if (args.breakGlass === true) {
          writeLog(SRC, "WARN", {
            event: "BREAK-GLASS-PATH-GUARD",
            tool: toolName, command: command.slice(0, 200), sessionID,
            detail: "shell command on protected path bypassed via breakGlass=true",
          });
          writeJsonl("break-glass", {
            event: "path_guard_bypassed", tool: toolName, command: command.slice(0, 200),
          }, { sessionID, tool: toolName });
          return;
        }
        writeLog(SRC, "WARN", {
          event: "BEHAVIORAL-PATH-BLOCKED", tool: toolName,
          command: command.slice(0, 200), reason, sessionID,
        });
        writeJsonl("audit", {
          event: "behavioral_path_blocked", tool: toolName,
          command: command.slice(0, 200), reason, result: "blocked",
        }, { sessionID, tool: toolName });
        throw new Error(
          `[BEHAVIORAL-PATH-GUARD] ${toolName} blocked: command targets protected path (${reason}). ` +
          `Use breakGlass=true to override if authorized.`
        );
      }
    }
    // Log allowed shell for audit
    writeJsonl("audit", {
      event: "behavioral_path_allowed", tool: toolName,
      command: command.slice(0, 200), result: "allowed",
    }, { sessionID, tool: toolName });
    return;
  }

  if (!filePath) return;

  // Check breakGlass flag — if set, log and allow
  if (args.breakGlass === true) {
    writeLog(SRC, "WARN", {
      event: "BREAK-GLASS-PATH-GUARD",
      tool: toolName,
      path: filePath,
      sessionID,
      detail: "path guard bypassed via breakGlass=true",
    });
    writeJsonl("break-glass", {
      event: "path_guard_bypassed",
      tool: toolName,
      path: filePath,
    }, { sessionID, tool: toolName });
    return;
  }

  // safe_framework_edit is grant-aware and has its own policy + plan checks.
  // Delegate to that tool rather than treating it like a normal safe_edit.
  if (toolName === "safe_framework_edit") {
    writeLog(SRC, "INFO", {
      event: "BEHAVIORAL-PATH-GUARD-DELEGATED-FRAMEWORK-GRANT",
      tool: toolName,
      path: filePath,
      sessionID,
    });
    return;
  }

  // Check against protected paths
  for (const { pattern, reason } of PROTECTED_PATHS) {
    if (pattern.test(filePath)) {
      writeLog(SRC, "WARN", {
        event: "BEHAVIORAL-PATH-BLOCKED",
        tool: toolName,
        path: filePath,
        reason,
        sessionID,
      });
      writeJsonl("audit", {
        event: "behavioral_path_blocked",
        tool: toolName,
        path: filePath,
        reason,
        result: "blocked",
      }, { sessionID, tool: toolName });

      throw new Error(
        `[BEHAVIORAL-PATH-GUARD] ${toolName} blocked: "${filePath}" is a protected path (${reason}). ` +
        `Use breakGlass=true to override if authorized.`
      );
    }
  }

  // Log allowed write for audit trail
  writeJsonl("audit", {
    event: "behavioral_path_allowed",
    tool: toolName,
    path: filePath,
    result: "allowed",
  }, { sessionID, tool: toolName });
}
