/**
 * hooks/audit-hooks.ts — Shell, Permission, Command, Message, Todo, TUI Hooks
 * Extracted from framework-enforcer.ts (lines ~1322-1625)
 * STATUS: ✅ EXTRACTED — 7 hooks live
 * @since Wave 3.1 (R5)
 */
import { writeAuditLogEntry, logAuditEntry } from "./audit-log";
type ModeFn = () => "advisory" | "strict" | "locked";

export async function shellEnv(
  _input: void, output: { env: Record<string, string>; cwd: string }
): Promise<void> {
  output.env.FRAMEWORK_ENFORCER = "active";
  output.env.ENFORCEMENT_MODE = process.env.ENFORCEMENT_MODE || "advisory";
  output.env.OPENCODE_ROOT = process.env.OPENCODE_ROOT || process.cwd();
}

export async function permissionAsked(
  input: { tool: string; agent: string; sessionID: string }, _output: void,
  getEnforcementMode: ModeFn
): Promise<void> {
  const { tool, agent, sessionID } = input;
  writeAuditLogEntry({ event: "permission.asked", tool, agent, session_id: sessionID, action: "permission_request" });
  const patterns = [{p:/rm\s+-rf/,s:"high"},{p:/chmod\s+777/,s:"high"},{p:/sudo/,s:"medium"},{p:/mv\s+.*\.opencode/,s:"high"}];
  const mode = getEnforcementMode();
  for (const ep of patterns) {
    if (ep.p.test(tool)) {
      logAuditEntry({ event: "silent_audit", detail: (mode==="strict"||mode==="locked"?"[FW-ENFORCE][BLOCK] ":"[FW-ENFORCE][WARN] ")+"Escalation: "+agent+" tool=""+tool+"" severity="+ep.s });
      break;
    }
  }
}

export async function permissionReplied(
  input: { tool: string; granted: boolean }, _output: void
): Promise<void> {
  writeAuditLogEntry({ event: "permission.replied", tool: input.tool, granted: input.granted, action: input.granted ? "permission_granted" : "permission_denied" });
  logAuditEntry({ event: "silent_audit", detail: "[FW-ENFORCE][AUDIT] Permission "+(input.granted?"granted":"denied")+" for tool ""+input.tool+""" });
}

export async function commandExecuted(
  input: { command: string; agent?: string }, _output: void
): Promise<void> {
  writeAuditLogEntry({ event: "command.executed", agent: input.agent||"", command: input.command.substring(0,200), action: "command_executed" });
}

export async function messageUpdated(
  input: { messageID: string }, _output: void
): Promise<void> {
  logAuditEntry({ tool: "message.updated", action: "message_changed", detail: input.messageID?.slice(0,50) });
}

export async function todoUpdated(_input: void, _output: void): Promise<void> {
  logAuditEntry({ tool: "todo.updated", action: "todo_changed" });
}

export async function tuiCommandExecute(
  input: { command: string; agent?: string }, _output: void,
  getEnforcementMode: ModeFn
): Promise<void> {
  const dangerous = ["/bash","/rm","/delete","/force"];
  const lower = input.command.toLowerCase();
  for (const dc of dangerous) {
    if (lower.startsWith(dc)) {
      const mode = getEnforcementMode();
      if (mode==="strict"||mode==="locked") throw new Error("[FW-ENFORCE] Dangerous TUI command blocked: "+input.command);
      logAuditEntry({ event: "silent_audit", detail: "[FW-ENFORCE][WARN][advisory] Dangerous TUI command: "+input.command });
      return;
    }
  }
  logAuditEntry({ tool: "tui.command.execute", action: "command_executed", detail: input.command?.slice(0,100) });
}
