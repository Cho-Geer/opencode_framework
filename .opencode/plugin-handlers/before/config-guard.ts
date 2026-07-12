// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — reached via delegate require() from permission-safety (active)
// Kept as delegate dependency or for rollback only.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/config-guard.ts — Hook config bypass prevention + plugin parts guard
// Migrated from plugins/hook-config-guard.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { isApprovedScriptCmd } from "../../service/enforcement/exemptions";
import { shouldBlock } from "../../service/enforcement/rule-disposition";

export const name = "config-guard";
export const tools = ["safe_shell", "bash"];

// Run plugin parts guard at module load time
setTimeout(() => runPluginPartsGuard(), 0);

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /git\s+commit\s+.*--no-verify/, name: "git commit --no-verify" },
  { pattern: /git\s+commit\s+.*\s-n\b/, name: "git commit -n (no-verify)" },
  { pattern: /--no-commit-msg-verify/, name: "--no-commit-msg-verify" },
  { pattern: /git\s+config\s+core\.hooksPath/, name: "git config core.hooksPath" },
  { pattern: /git\s+config\s+core\.skipHooks/, name: "git config core.skipHooks" },
  { pattern: /git\s+-c\s+core\.hooksPath/, name: "git -c core.hooksPath= (inline override)" },
  { pattern: /git\s+update-index\s+.*--skip-worktree/, name: "git update-index --skip-worktree" },
];

const PLUGIN_PARTS_MUTATION_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /output\.parts\.unshift\s*\(/, name: "output.parts.unshift()" },
  { pattern: /output\.parts\.push\s*\(/, name: "output.parts.push()" },
  { pattern: /output\.parts\.splice\s*\(/, name: "output.parts.splice()" },
  { pattern: /output\.parts\.pop\s*\(/, name: "output.parts.pop()" },
  { pattern: /output\.parts\.shift\s*\(/, name: "output.parts.shift()" },
  { pattern: /output\.parts\s*=\s*\[/, name: "output.parts = [...] (reassignment)" },
  { pattern: /output\.parts\s*\+=/, name: "output.parts += (concatenation)" },
];

const APPROVED_SCRIPTS = [
  ".opencode/scripts/install-hooks.ts",
  ".opencode/scripts/install-hooks.js",
];

export function validatePluginFiles(root: string = process.cwd()): Array<{ file: string; pattern: string; line: number }> {
  const violations: Array<{ file: string; pattern: string; line: number }> = [];
  const pluginsDir = require("path").join(root, ".opencode", "plugins");
  const fs = require("fs");
  const path = require("path");
  const EXEMPT_FILES = new Set(["hook-config-guard.ts", "hook-config-guard.js"]);

  let entries: string[];
  try { entries = fs.readdirSync(pluginsDir); } catch { return violations; }

  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".js")) continue;
    if (EXEMPT_FILES.has(entry)) continue;
    const filePath = path.join(pluginsDir, entry);
    let content: string;
    try { content = fs.readFileSync(filePath, "utf-8"); } catch { continue; }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of PLUGIN_PARTS_MUTATION_PATTERNS) {
        if (p.pattern.test(line)) {
          violations.push({ file: entry, pattern: p.name, line: i + 1 });
        }
      }
    }
  }
  return violations;
}

function runPluginPartsGuard(): void {
  const violations = validatePluginFiles();
  if (violations.length === 0) {
    writeLog("hook-config-guard", "loaded", {
      event: "PLUGIN-PARTS-GUARD",
      detail: "All plugins clean — no output.parts mutations detected",
    });
    return;
  }
  for (const v of violations) {
    const msg = `[FW-PLUGIN-PARTS-GUARD] Plugin ${v.file}:${v.line} contains forbidden "${v.pattern}".`;
    writeLog("hook-config-guard", "ERROR", {
      event: "PLUGIN-PARTS-VIOLATION",
      detail: `${v.file}:${v.line} | ${v.pattern}`,
    });
  }
}

function extractCommand(input: any): string {
  if (input.args?.command && typeof input.args.command === "string") return input.args.command;
  if (typeof input.args === "string") return input.args;
  if (input.args?.cmd && typeof input.args.cmd === "string") return input.args.cmd;
  try { return JSON.stringify(input.args); } catch { return ""; }
}

function isApprovedScript(cmd: string): boolean {
  // Config-driven: reads from enforcement_exemptions.config_guard.approved_scripts
  if (isApprovedScriptCmd(cmd)) return true;
  return APPROVED_SCRIPTS.some((script) => cmd.includes(script));
}

export async function handle(input: any, _output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  const shellTools = ["safe_shell", "bash"];
  if (!shellTools.includes(input.tool)) return;

  const cmd = extractCommand(input);
  if (!cmd) return;

  if (isApprovedScript(cmd)) {
    writeLog("hook-config-guard", "runtime", {
      sessionID: input.sessionID, agent, event: "APPROVED_SCRIPT",
      detail: `Approved script allowed: ${cmd.substring(0, 120)}`,
    });
    return;
  }

  for (const fp of FORBIDDEN_PATTERNS) {
    if (fp.pattern.test(cmd)) {
      const blockMsg = `[FW-ENFORCE][HOOK-CONFIG-GUARD] Blocked "${fp.name}" in ${input.tool} command.
Command: ${cmd.substring(0, 200)}
Agent: ${agent}
Policy: dangerous-shell-command

This command bypasses Git hook enforcement. Use an approved repair path:
  - For hook repairs: bun .opencode/scripts/install-hooks.ts
  - For emergency framework repair: use [INFRA] commit marker + CI validation

To use --no-verify in an emergency:
  1. Commit with [INFRA] marker in the commit message
  2. Include incident ID in commit body: Incident: <id>
  3. CI semantic validator will verify the marker\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`;

      writeLog("hook-config-guard", "ERROR", {
        sessionID: input.sessionID, callID: input.callID, agent,
        event: "BLOCKED", detail: `Blocked ${fp.name} | policy=dangerous-shell-command`,
        command: cmd.substring(0, 500),
      });

      if (shouldBlock("dangerous-shell-command")) {
        throw new Error(blockMsg);
      }
      writeLog("hook-config-guard", "runtime", {
        sessionID: input.sessionID, agent, event: "WARNING",
        detail: `Hook bypass detected: ${fp.name}`,
      });
    }
  }
}
