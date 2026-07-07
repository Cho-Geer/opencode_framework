// lib/tool-scope.ts — BRIDGE (Batch 6)
// Logic migrated to service/dispatch/tool-scope-{match,paths}.ts

export {
  isModifyTool, getModifyPath, splitShellCommand, isModifyShell,
  type ShellClassification, classifyShellCommand, getEffectivePathScopeFilePath,
  isUC7KSWriteTarget, isUC7KSExcludedPath,
} from "../service/dispatch/tool-scope-match";

export {
  type ScopePathResult, parseShellWriteTargets, getEffectivePathScopePaths,
} from "../service/dispatch/tool-scope-paths";
