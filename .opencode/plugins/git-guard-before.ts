/**
 * git-guard-before.ts — "tool.execute.before" plugin: git hook bypass prevention
 * =============================================================================
 *
 * FIX-001: Blocks git commands that bypass pre-commit/commit-msg hooks via
 * safe_shell or equivalent shell-capable tools. Prevents circumvention of
 * the framework's hook enforcement.
 *
 * FIX-002: Provides a governed break-glass path for @Super-Admin emergency
 * operations. Requires explicit incident ID and [INFRA] acknowledgment.
 *
 * Blocked bypass methods:
 *   - git commit --no-verify / git commit -n
 *   - git commit --no-commit-msg-verify
 *   - git -c core.hooksPath=... commit
 *   - git -c core.skipHooks=... commit
 *   - git config core.hooksPath ...
 *   - git config core.skipHooks ...
 *
 * Break-glass (FIX-002):
 *   Include [BYPASS <incident_id>] in the commit message to bypass.
 *   Only honored for @Super-Admin agent. Full audit via writeLog.
 *   FIX-002-B2 (2026-06-21): Replaced env var approach — process.env
 *   is invisible to plugin context when safe_shell spawns subprocesses.
 *
 * Registry: auto-discovered from .opencode/plugins/ directory
 * Hook: tool.execute.before (intercepts BEFORE execution)
 *
 * @author @Super-Admin
 * @since 2026-06-21 — FIX-001/FIX-002 git hook bypass prevention
 * @module git-guard-before
 */

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import { isSuperAdmin } from "../lib/agent-identity";

export default withPluginLifecycle("git-guard-before", {
  "tool.execute.before": toolExecuteBefore,
});

/**
 * Regex patterns matching git hook bypass commands.
 * These are applied to the command string BEFORE execution.
 */
const GIT_BYPASS_PATTERNS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
  description: string;
}> = [
  {
    name: "GIT_COMMIT_NO_VERIFY",
    pattern: /\bgit\s+commit\b.*(--no-verify\b|\s+-n\b)/,
    description: "git commit with --no-verify or -n flag",
  },
  {
    name: "GIT_COMMIT_NO_COMMIT_MSG_VERIFY",
    pattern: /\bgit\s+commit\b.*--no-commit-msg-verify\b/,
    description: "git commit with --no-commit-msg-verify flag",
  },
  {
    name: "GIT_CORE_HOOKSPATH_COMMIT",
    pattern: /\bgit\s+-c\s+core\.hooksPath\s*=\s*\S+\s+commit\b/,
    description: "git -c core.hooksPath=<path> commit",
  },
  {
    name: "GIT_CORE_SKIPHOOKS_COMMIT",
    pattern: /\bgit\s+-c\s+core\.skipHooks\s*=\s*\S+\s+commit\b/,
    description: "git -c core.skipHooks=<bool> commit",
  },
  {
    name: "GIT_CONFIG_HOOKSPATH",
    pattern: /\bgit\s+config\b.*\bcore\.hooksPath\b/,
    description: "git config core.hooksPath <path>",
  },
  {
    name: "GIT_CONFIG_SKIPHOOKS",
    pattern: /\bgit\s+config\b.*\bcore\.skipHooks\b/,
    description: "git config core.skipHooks <bool>",
  },
];

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  // Only intercept shell-capable tools: safe_shell
  if (input.tool !== "safe_shell") {
    return;
  }

  const command: string = (output.args?.command || "").toString().trim();
  if (!command) {
    return;
  }

  // Check command against each bypass pattern
  let matchedPattern: (typeof GIT_BYPASS_PATTERNS)[number] | null = null;

  for (const bp of GIT_BYPASS_PATTERNS) {
    if (bp.pattern.test(command)) {
      matchedPattern = bp;
      break;
    }
  }

  if (!matchedPattern) {
    return;
  }

  // ── FIX-002: Governed break-glass for @Super-Admin ──
  // FIX-002-B2 (2026-06-21): Replaced process.env.GIT_GUARD_BYPASS_INCIDENT with
  // commit-message-based bypass detection. The env var approach failed because
  // safe_shell spawns a subprocess where inline env vars are invisible to the
  // plugin's Node.js process context. New approach:
  //   - @Super-Admin is authenticated by the framework (resolveAgent)
  //   - The commit message must contain [BYPASS <incident-id>]
  //   - Full audit via writeLog with event GIT_HOOK_BYPASS_BREAK_GLASS
  const bypassMatch = /\[BYPASS\s+(.+?)\]/i.exec(command);
  const bypassIncident = bypassMatch ? bypassMatch[1].trim() : "";

  if (bypassIncident && isSuperAdmin(agent)) {
    writeLog("git-guard-before", "warn", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      event: "GIT_HOOK_BYPASS_BREAK_GLASS",
      detail: `BREAK-GLASS: ${matchedPattern.name} bypass authorized for incident "${bypassIncident}"`,
      command: command.substring(0, 200),
      bypass_incident: bypassIncident,
      pattern: matchedPattern.name,
      pattern_desc: matchedPattern.description,
    });
    // Allow the bypass — log heavily for audit trail
    return;
  }

  // Block with audit log
  writeLog("git-guard-before", "error", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    event: "GIT_HOOK_BYPASS_BLOCKED",
    detail: `BLOCKED: ${matchedPattern.name} — ${matchedPattern.description}`,
    command: command.substring(0, 200),
    pattern: matchedPattern.name,
    pattern_desc: matchedPattern.description,
  });

  const msg =
    `[FW-ENFORCE][GIT-GUARD] Git hook bypass command blocked: ` +
    `${matchedPattern.name} — ${matchedPattern.description}. ` +
    `Pre-commit/commit-msg hooks must not be circumvented. ` +
    `If this is an emergency framework repair by @Super-Admin, ` +
    `include [BYPASS <incident_id>] in your commit message and retry.`;

  // Throw in all modes — git bypass should never be silently permitted
  throw new Error(msg);
}
