import type { ToolGovernanceContext } from "../context";
import type { ToolGovernanceDecision } from "../decision";

const PROTECTED_PATHS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\.opencode\/plugins\//, reason: "plugin dispatcher code is framework infrastructure" },
  { pattern: /\.opencode\/plugin-handlers\//, reason: "plugin handler code is enforcement pipeline" },
  { pattern: /\.opencode\/lib\//, reason: "shared library code is framework foundation" },
  { pattern: /\.opencode\/service\//, reason: "service layer is framework core" },
  { pattern: /\.opencode\/hooks\//, reason: "git hooks are enforcement boundary" },
  { pattern: /opencode\.json$/, reason: "config file is framework authority" },
  { pattern: /\.opencode\/project\.config\.json$/, reason: "project config is runtime authority" },
];

const WRITE_TOOLS = new Set(["safe_edit", "safe_delete", "safe_restore", "safe_shell", "safe_mkdir", "safe_framework_edit"]);

export function evaluate(ctx: ToolGovernanceContext): ToolGovernanceDecision | null {
  if (!WRITE_TOOLS.has(ctx.tool)) return null;
  if (ctx.args.breakGlass === true) return null;

  // Keep read-only safe_shell access aligned with behavioral-path-guard.
  if (ctx.tool === "safe_shell" && ctx.command) {
    const readOnlyPattern = /^(cat|head|tail|ls|wc|grep|find|sha256sum|md5sum|file|stat|diff|tree)\b/;
    if (readOnlyPattern.test(ctx.command.trim())) return null;
  }

  const checkStr = ctx.targetPaths.length > 0 ? ctx.targetPaths.join(" ") : (ctx.command || "");
  if (!checkStr) return null;

  for (const { pattern, reason } of PROTECTED_PATHS) {
    if (pattern.test(checkStr)) {
      return {
        outcome: "deny",
        ruleId: "BEHAVIORAL-PATH-GUARD",
        layer: "path-protection",
        severity: "warn",
        message: `[BEHAVIORAL-PATH-GUARD] ${ctx.tool} blocked: targets protected path (${reason}). Use breakGlass=true to override if authorized.`,
        details: { reason, pattern: pattern.source },
      };
    }
  }
  return null;
}
