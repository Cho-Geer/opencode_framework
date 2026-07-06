// plugin-handlers/before/git-guard.ts — git hook bypass prevention
// Migrated from plugins/git-guard-before.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { isBreakGlassAuthorized } from "../../service/enforcement/exemptions";

export const name = "git-guard";
export const tools = ["safe_shell"];

const GIT_BYPASS_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp; description: string }> = [
  { name: "GIT_COMMIT_NO_VERIFY", pattern: /\bgit\s+commit\b.*(--no-verify\b|\s+-n\b)/, description: "git commit with --no-verify or -n flag" },
  { name: "GIT_COMMIT_NO_COMMIT_MSG_VERIFY", pattern: /\bgit\s+commit\b.*--no-commit-msg-verify\b/, description: "git commit with --no-commit-msg-verify flag" },
  { name: "GIT_CORE_HOOKSPATH_COMMIT", pattern: /\bgit\s+-c\s+core\.hooksPath\s*=\s*\S+\s+commit\b/, description: "git -c core.hooksPath=<path> commit" },
  { name: "GIT_CORE_SKIPHOOKS_COMMIT", pattern: /\bgit\s+-c\s+core\.skipHooks\s*=\s*\S+\s+commit\b/, description: "git -c core.skipHooks=<bool> commit" },
  { name: "GIT_CONFIG_HOOKSPATH", pattern: /\bgit\s+config\b.*\bcore\.hooksPath\b/, description: "git config core.hooksPath <path>" },
  { name: "GIT_CONFIG_SKIPHOOKS", pattern: /\bgit\s+config\b.*\bcore\.skipHooks\b/, description: "git config core.skipHooks <bool>" },
];

export async function handle(input: any, output: any): Promise<void> {
  if (input.tool !== "safe_shell") return;

  const agent = resolveAgent(input.sessionID);
  const command: string = (output.args?.command || "").toString().trim();
  if (!command) return;

  let matchedPattern: (typeof GIT_BYPASS_PATTERNS)[number] | null = null;
  for (const bp of GIT_BYPASS_PATTERNS) {
    if (bp.pattern.test(command)) { matchedPattern = bp; break; }
  }
  if (!matchedPattern) return;

  // FIX-002: Governed break-glass for @Super-Admin
  const bypassMatch = /\[BYPASS\s+(.+?)\]/i.exec(command);
  const bypassIncident = bypassMatch ? bypassMatch[1].trim() : "";

  // Config-driven: reads from enforcement_exemptions.git_guard.break_glass_agents
  if (bypassIncident && isBreakGlassAuthorized(agent)) {
    writeLog("git-guard-before", "WARN", {
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "GIT_HOOK_BYPASS_BREAK_GLASS",
      detail: `BREAK-GLASS: ${matchedPattern.name} bypass authorized for incident "${bypassIncident}"`,
      command: command.substring(0, 200), bypass_incident: bypassIncident,
      pattern: matchedPattern.name, pattern_desc: matchedPattern.description,
    });
    return;
  }

  writeLog("git-guard-before", "ERROR", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "GIT_HOOK_BYPASS_BLOCKED",
    detail: `BLOCKED: ${matchedPattern.name} — ${matchedPattern.description}`,
    command: command.substring(0, 200),
    pattern: matchedPattern.name, pattern_desc: matchedPattern.description,
  });

  throw new Error(
    `[FW-ENFORCE][GIT-GUARD] Git hook bypass command blocked: ` +
    `${matchedPattern.name} — ${matchedPattern.description}. ` +
    `Pre-commit/commit-msg hooks must not be circumvented. ` +
    `If this is an emergency framework repair by @Super-Admin, ` +
    `include [BYPASS <incident_id>] in your commit message and retry.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`
  );
}
