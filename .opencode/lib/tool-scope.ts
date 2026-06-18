// tool-scope.ts — Tool scope guard utilities (lib)
import * as fs from "node:fs";
// readJsonFile removed: inline fs read for OpenCode plugin runtime compatibility
import { STATE_PATHS } from "./state-utils";

export function isModifyTool(tool: string): boolean {
  return tool === "write" || tool === "edit" || tool === "safe_edit" || tool === "safe_mkdir" || tool === "safe_delete" || tool === "safe_shell";
}

export function getModifyPath(args: Record<string, unknown>): string {
  return (args?.filePath || args?.dirPath || args?.command || "") as string;
}

export function isModifyShell(args: Record<string, unknown>): boolean {
  return /^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash)\b/.test((args?.command || "") as string);
}

/**
 * Get the effective file path for path-scope checks, handling safe_shell
 * specially: only cp/mv/rm commands have a meaningful file path; other
 * shell commands return null (their args.command is an arbitrary string,
 * not a file path).
 */
export function getEffectivePathScopeFilePath(
  tool: string, args: Record<string, any>
): string | null {
  if (tool === "safe_shell") return isModifyShell(args) ? getModifyPath(args) : null;
  return getModifyPath(args);
}

export function readDispatchAllowedTools(agent: string): string[] | "*" {
  const FALLBACK = ["task","read","todowrite","compliance_gate_check","compliance_gate_confirm","compliance_gate_complete","dispatch_subagent"];
  try {
    let cfg: any = null;
    try { cfg = JSON.parse(fs.readFileSync(STATE_PATHS.projectConfig(), "utf8")); } catch {}
    const tools = cfg?.agent_dispatch_allowed_tools;
    if (!tools || typeof tools !== "object") return FALLBACK;
    const atForm = agent.startsWith("@") ? agent : "@" + agent;
    const plainForm = agent.replace(/^@/, "");
    const entry = tools[atForm] || tools[plainForm];
    if (!entry) return FALLBACK;
    if (entry === "*" || (Array.isArray(entry) && entry.length === 1 && entry[0] === "*")) return "*";
    if (Array.isArray(entry)) return entry;
    return FALLBACK;
  } catch { return FALLBACK; }
}

export function isToolAllowed(allowedList: string[] | "*", tool: string): boolean {
  if (allowedList === "*") return true;
  if (!Array.isArray(allowedList)) return false;
  if (allowedList.includes(tool)) return true;
  const shortName = tool.replace(/^[a-zA-Z0-9-]+_/, "");
  if (shortName !== tool && allowedList.includes(shortName)) return true;
  return false;
}
