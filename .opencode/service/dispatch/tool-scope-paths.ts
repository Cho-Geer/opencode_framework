/**
 * Tool Scope — Path Resolution (tool-scope-paths)
 *
 * Shell write target parsing, effective path scope resolution,
 * and tool permission checking.
 *
 * Split from lib/tool-scope.ts for modularity.
 * Cross-imports matching functions from ./tool-scope-match.
 *
 * @module tool-scope-paths
 */

import { isModifyTool, getModifyPath, isModifyShell } from "./tool-scope-match";
import { parseShellWriteTargets, type ScopePathResult } from "../tool-governance/shell-targets";

export { parseShellWriteTargets };
export type { ScopePathResult };

// ============================================================================
// PHASE 2 (2026-06-18): Multi-path scope + UC7KS write targets
// ============================================================================

// ============================================================================
// Effective Path Scope Resolution
// ============================================================================

/**
 * Get all effective file paths for path-scope checks.
 * For non-shell tools, returns a single-element array [filePath] or [dirPath].
 * For safe_shell, parses the command to extract write targets.
 * Returns null if the tool is not a modify tool or targets cannot be determined.
 *
 * Phase 2 (2026-06-18): Replaces getEffectivePathScopeFilePath() for
 * multi-path shell write target support.
 */
export function getEffectivePathScopePaths(
  tool: string,
  args: Record<string, any>,
): ScopePathResult {
  // Non-modify tools
  if (!isModifyTool(tool)) {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  // Non-shell modify tools: safe_edit, safe_mkdir, safe_delete, write, edit
  if (tool !== "safe_shell" && tool !== "bash") {
    var fp = getModifyPath(args);
    if (!fp) return { applies: false, paths: [], reason: "read_only_shell" };
    return { applies: true, paths: [fp], reason: "parsed" };
  }

  // safe_shell / bash: parse command for write targets
  var cmd = (args?.command || "") as string;
  if (!cmd) return { applies: false, paths: [], reason: "read_only_shell" };

  // Check if it's a modify shell command at all
  if (!isModifyShell(args)) {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  return parseShellWriteTargets(cmd);
}
