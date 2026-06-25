// hook-config-guard.ts — "tool.execute.before" plugin: block hook bypass commands
//
// FIX-010 (2026-06-21 @Super-Admin): Blocks OpenCode-invoked shell commands
// that bypass Git hook enforcement or mutate hook configuration.
// This is the Phase 1 foundation for the full command guard (FIX-001, Phase 0).
//
// Blocked commands:
//   - git commit --no-verify / git commit -n
//   - git config core.hooksPath (unauthorized)
//   - git config core.skipHooks
//   - git update-index --skip-worktree (against governance files)
//   - git -c core.hooksPath=... commit
//
// Approved exception: .opencode/scripts/install-hooks.ts is allowed to set
// core.hooksPath during installation.

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";

// Run plugin parts guard at module load time (startup validation).
// FW-PLUGIN-PARTS-GUARD (2026-06-24 @Super-Admin)
setTimeout(() => runPluginPartsGuard(), 0);

export default withPluginLifecycle("hook-config-guard", {
  "tool.execute.before": toolExecuteBefore,
});

// ── Forbidden patterns ──────────────────────────────────────
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // Direct hook bypass
  { pattern: /git\s+commit\s+.*--no-verify/, name: "git commit --no-verify" },
  { pattern: /git\s+commit\s+.*\s-n\b/, name: "git commit -n (no-verify)" },
  { pattern: /--no-commit-msg-verify/, name: "--no-commit-msg-verify" },

  // Hook path manipulation
  {
    pattern: /git\s+config\s+core\.hooksPath/,
    name: "git config core.hooksPath",
  },
  {
    pattern: /git\s+config\s+core\.skipHooks/,
    name: "git config core.skipHooks",
  },

  // Inline hook path override
  {
    pattern: /git\s+-c\s+core\.hooksPath/,
    name: "git -c core.hooksPath= (inline override)",
  },

  // Worktree skip (hides governance files from Git tracking)
  {
    pattern: /git\s+update-index\s+.*--skip-worktree/,
    name: "git update-index --skip-worktree",
  },
];

// ── Plugin source code mutation guard ────────────────────────
// Plugins MUST NOT modify output.parts (message parts array).
// This array is reserved for OpenCode runtime and user/LLM interaction.
// Detected patterns indicate attempts to inject content into conversations.
// FW-PLUGIN-PARTS-GUARD (2026-06-24 @Super-Admin)
const PLUGIN_PARTS_MUTATION_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /output\.parts\.unshift\s*\(/, name: "output.parts.unshift()" },
  { pattern: /output\.parts\.push\s*\(/, name: "output.parts.push()" },
  { pattern: /output\.parts\.splice\s*\(/, name: "output.parts.splice()" },
  { pattern: /output\.parts\.pop\s*\(/, name: "output.parts.pop()" },
  { pattern: /output\.parts\.shift\s*\(/, name: "output.parts.shift()" },
  { pattern: /output\.parts\s*=\s*\[/, name: "output.parts = [...] (reassignment)" },
  { pattern: /output\.parts\s*\+=/, name: "output.parts += (concatenation)" },
];

/**
 * Scan all plugin source files for output.parts mutation patterns.
 * Called at plugin load time and exported for framework-self-test.ts.
 * Returns array of violations found (empty = all clean).
 * FW-PLUGIN-PARTS-GUARD (2026-06-24 @Super-Admin)
 */
export function validatePluginFiles(root: string = process.cwd()): Array<{
  file: string;
  pattern: string;
  line: number;
}> {
  const violations: Array<{ file: string; pattern: string; line: number }> = [];
  const pluginsDir = require("path").join(root, ".opencode", "plugins");
  const fs = require("fs");
  const path = require("path");

  // Skip the guard plugin itself — it defines the patterns, not violations.
  const EXEMPT_FILES = new Set(["hook-config-guard.ts", "hook-config-guard.js"]);

  let entries: string[];
  try {
    entries = fs.readdirSync(pluginsDir);
  } catch {
    return violations;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".js")) continue;
    if (EXEMPT_FILES.has(entry)) continue;
    const filePath = path.join(pluginsDir, entry);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

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

/**
 * Run plugin parts guard validation and log results.
 * Called once at plugin load time.
 */
function runPluginPartsGuard(): void {
  const violations = validatePluginFiles();
  const mode = getEnforcementMode();

  if (violations.length === 0) {
    writeLog("hook-config-guard", "loaded", {
      event: "PLUGIN-PARTS-GUARD",
      detail: "All plugins clean — no output.parts mutations detected",
    });
    return;
  }

  for (const v of violations) {
    const msg = `[FW-PLUGIN-PARTS-GUARD] Plugin ${v.file}:${v.line} contains forbidden "${v.pattern}". Plugins MUST NOT modify output.parts — this array is reserved for OpenCode runtime and user/LLM interaction. Remove the mutation or use output.context.push() in compaction hooks instead.`;

    writeLog("hook-config-guard", "reject", {
      event: "PLUGIN-PARTS-VIOLATION",
      detail: `${v.file}:${v.line} | ${v.pattern} | mode=${mode}`,
    });

    if (mode === "strict" || mode === "locked") {
      console.error(msg);
    } else {
      console.warn(`[ADVISORY] ${msg}`);
    }
  }
}

/**
 * Approved callers: scripts that are allowed to configure hooks.
 * Currently: install-hooks.ts (hook installation during setup).
 */
const APPROVED_SCRIPTS = [
  ".opencode/scripts/install-hooks.ts",
  ".opencode/scripts/install-hooks.js",
];

// ── Hook implementation ──────────────────────────────────────
async function toolExecuteBefore(input: any, _output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  // Only enforce on shell-capable tools (safe_shell, bash)
  const shellTools = ["safe_shell", "bash"];
  if (!shellTools.includes(input.tool)) {
    return; // Not a shell tool — skip
  }

  // Get the command string from args
  const cmd = extractCommand(input);
  if (!cmd) return;

  // Check for approved scripts (install-hooks.ts is allowed)
  if (isApprovedScript(cmd)) {
    writeLog("hook-config-guard", "runtime", {
      sessionID: input.sessionID,
      agent,
      agent,
      event: "APPROVED_SCRIPT",
      detail: `Approved script allowed: ${cmd.substring(0, 120)}`,
    });
    return;
  }

  // Check for forbidden patterns
  for (const fp of FORBIDDEN_PATTERNS) {
    if (fp.pattern.test(cmd)) {
      const blockMsg = `[FW-ENFORCE][HOOK-CONFIG-GUARD] Blocked "${fp.name}" in ${input.tool} command.
Command: ${cmd.substring(0, 200)}
Agent: ${agent}
Enforcement: ${mode}

This command bypasses Git hook enforcement. Use an approved repair path:
  - For hook repairs: bun .opencode/scripts/install-hooks.ts
  - For emergency framework repair: use [INFRA] commit marker + CI validation

To use --no-verify in an emergency:
  1. Commit with [INFRA] marker in the commit message
  2. Include incident ID in commit body: Incident: <id>
  3. CI semantic validator will verify the marker`;

      writeLog("hook-config-guard", "reject", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent,
        agent,
        event: "BLOCKED",
        detail: `Blocked ${fp.name} | mode=${mode}`,
        command: cmd.substring(0, 500),
      });

      // In strict/locked: throw to block execution
      if (mode === "strict" || mode === "locked") {
        throw new Error(blockMsg);
      }

      // In advisory: log warning only, allow execution
      writeLog("hook-config-guard", "runtime", {
        sessionID: input.sessionID,
        agent,
        event: "WARNING",
        detail: `[ADVISORY] Hook bypass detected: ${fp.name}`,
      });
      console.warn(`[ADVISORY] ${blockMsg}`);
    }
  }
}

/**
 * Extract the command string from tool input arguments.
 * Handles both direct command strings and structured args.
 */
function extractCommand(input: any): string {
  // safe_shell: args.command is the full command string
  if (input.args?.command && typeof input.args.command === "string") {
    return input.args.command;
  }

  // bash: args may vary; try common patterns
  if (typeof input.args === "string") {
    return input.args;
  }

  // Try to reconstruct from structured args
  if (input.args?.cmd && typeof input.args.cmd === "string") {
    return input.args.cmd;
  }

  // Fallback: stringify args
  try {
    return JSON.stringify(input.args);
  } catch {
    return "";
  }
}

/**
 * Check if the command is an approved script invocation.
 * install-hooks.ts is allowed to set core.hooksPath.
 */
function isApprovedScript(cmd: string): boolean {
  return APPROVED_SCRIPTS.some((script) => cmd.includes(script));
}
