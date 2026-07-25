// safe-bash-core.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/shell-config.ts + shell-guard.ts.
// Phase 1a migration.

export {
  safeBashTool, isAllowed, isDangerous, matchGlob, getAllowlist,
  resetSafeShellConfigCache,
  _scriptContainsFileWrite, _isScriptInAllowedPath,
  _hasAgentDangerousBypass, _loadSafeShellConfig,
  DEFAULT_ALLOWLIST, AGENT_ALLOWLISTS, DANGEROUS_PATTERNS,
  ALLOWED_SCRIPT_PATHS, AGENT_ALLOWED_SCRIPTS, WRITE_PATTERNS,
} from "../service/file-guard";
export type { SafeBashResult, SafeBashOptions } from "../service/file-guard";
