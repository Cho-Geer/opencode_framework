/**
 * shell-config.ts — Safe Shell Config, Constants & Allowlist Loader
 * ==================================================================
 *
 * Extracted from safe-bash-core.ts during FileGuard Service migration (Phase 1a).
 *
 * SINGLE SOURCE OF TRUTH for ALLOWED_COMMANDS, DANGEROUS_PATTERNS, and
 * runtime config loading from project.config.json.
 *
 * Exports:
 *   - DEFAULT_ALLOWLIST: string[]
 *   - AGENT_ALLOWLISTS: Record<string, string[]>
 *   - DANGEROUS_PATTERNS: RegExp[]
 *   - ALLOWED_SCRIPT_PATHS, AGENT_ALLOWED_SCRIPTS, WRITE_PATTERNS
 *   - matchGlob(command, pattern): boolean
 *   - getAllowlist(agent): string[] | "ALL_ALLOWED"
 *   - _loadSafeShellConfig(), resetSafeShellConfigCache()
 *   - _getConfigList(), _getConfigMap()
 *   - _hasAgentDangerousBypass()
 *
 * @author @Architect
 * @version 1.0.0
 *
 * REVISION (P2-D v2.1, 2026-06-17):
 *   - getAllowlist() now uses opencode.json (via getAgentShellAllowlist) for per-agent
 *     command permissions, with AGENT_ALLOWLISTS as fallback only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { getAgentShellAllowlist } from "../../lib/permission-reader";

// ════════════════════════════════════════════════════════════
// CONFIG LOADER — reads project.config.json.safe_shell at runtime
// FW-UNIFY-TS-P3: Externalizes allowlists/patterns from hardcoded constants.
// Falls back to hardcoded values when config section is absent.
// ════════════════════════════════════════════════════════════

let _safeShellConfigCache: any = null;
let _safeShellConfigLoaded = false;

export function _loadSafeShellConfig(): any {
  if (_safeShellConfigLoaded) return _safeShellConfigCache;
  _safeShellConfigLoaded = true;
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.resolve(root, ".opencode", "project.config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      _safeShellConfigCache = config.safe_shell || null;
    }
  } catch {
    /* use hardcoded fallbacks */
  }
  return _safeShellConfigCache;
}

/**
 * FW-PERM-AUDIT-FIX: Reset the safe shell config cache.
 * Call after modifying project.config.json to force reload on next safe_shell call.
 */
export function resetSafeShellConfigCache(): void {
  _safeShellConfigLoaded = false;
  _safeShellConfigCache = null;
}

export function _getConfigList(key: string, fallback: string[]): string[] {
  const cfg = _loadSafeShellConfig();
  return cfg && Array.isArray(cfg[key]) ? cfg[key] : fallback;
}

export function _getConfigMap(
  key: string,
  fallback: Record<string, string[]>,
): Record<string, string[]> {
  const cfg = _loadSafeShellConfig();
  return cfg && cfg[key] && typeof cfg[key] === "object" ? cfg[key] : fallback;
}

/**
 * FW-REPAIR-BUN-CACHE-001 (2026-06-12): Agent-specific dangerous pattern bypass.
 * Returns true if the agent has a bypass entry for this specific command,
 * allowing the command to skip the global DANGEROUS_PATTERNS check.
 *
 * This is more surgical than modifying global dangerous_patterns — only
 * explicitly listed agents can bypass for explicitly listed commands.
 *
 * @param agent - Agent name (with or without @ prefix)
 * @param command - The shell command to check
 * @returns true if the agent is allowed to bypass dangerous patterns for this command
 */
export function _hasAgentDangerousBypass(agent: string, command: string): boolean {
  const normalizedAgent = agent.startsWith("@") ? agent : "@" + agent;
  const cfg = _loadSafeShellConfig();
  if (!cfg || !cfg.agent_dangerous_bypass) return false;
  const bypasses: string[] = cfg.agent_dangerous_bypass[normalizedAgent];
  if (!Array.isArray(bypasses) || bypasses.length === 0) return false;
  return bypasses.some((pattern) => matchGlob(command, pattern));
}

// ════════════════════════════════════════════════════════════
// CONSTANTS — Single source of truth
// ════════════════════════════════════════════════════════════

/**
 * Default allowlist for safe bash commands.
 * These patterns are allowed for ALL agents by default.
 * Overridable via project.config.json.safe_shell.default_allowlist.
 */
export const DEFAULT_ALLOWLIST: string[] = [
  "npm run *",
  "npx jest *",
  "npx tsc *",
  "npx eslint *",
  "node * --help",
  "node *.js",
  "node *.ts",
  "node *.js *",
  "node *.ts *",
  "node -e *",
  "bun *.ts",
  "bun *.ts *",
  "bun -e *",
  "/home/zhaoge/.bun/bin/bun *.ts",
  "/home/zhaoge/.bun/bin/bun *.ts *",
  "git status",
  "git log *",
  "git diff", // Bare git diff (no args) — needed when agent identity resolution falls back to "unknown"
  "git diff *",
  "git show *",
  "git branch *",
  "docker --version",
  "docker-compose --version",
  "echo *",
  "cat *",
  "ls *",
  "pwd",
  "mkdir -p *",
  "rm -rf .task_temp/*",
  "rm -rf .opencode/lib/*",
  "rm -rf .opencode/scripts/*.js",
  "rm -rf .opencode/scripts/*.ts",
  "rm -rf .opencode/scripts/*.mjs",
  "touch *",
  "cp * *",
  "mv * *",
  "grep *",
  "find *",
  "head *",
  "tail *",
  "wc -l *",
  "sort *",
  "uniq *",
  "whoami",
  "date",
  "uname *",
  "which *",
  "env | grep *",
];

/**
 * Agent-specific allowlist extensions.
 * Each agent gets its own set of additional allowed commands.
 */
export const AGENT_ALLOWLISTS: Record<string, string[]> = {
  /**
   * FW-REPAIR-SHELL-TSX (2026-06-06): Expanded docker commands for CI-CD-Agent.
   * Added docker compose (v2), inspect, exec, stop, start, restart, rm,
   * network, volume, system, info, cp, tag, stats, port subcommands.
   * These are needed for container management in CI/CD pipelines.
   */
  "@CI-CD-Agent": [
    "docker build *",
    "docker push *",
    "docker pull *",
    "docker run *",
    "docker ps *",
    "docker images *",
    "docker logs *",
    "docker inspect *",
    "docker exec *",
    "docker stop *",
    "docker start *",
    "docker restart *",
    "docker rm *",
    "docker network *",
    "docker volume *",
    "docker system *",
    "docker info *",
    "docker cp *",
    "docker tag *",
    "docker stats *",
    "docker port *",
    "docker compose *",
    "docker-compose up *",
    "docker-compose down *",
    "docker-compose *",
    "kubectl *",
    "helm *",
    "terraform *",
    "ansible-playbook *",
    "git *",
  ],
  "@Coder-BE": [
    "npx prisma *",
    "npm run db:*",
    "npm run test:*",
    "npm run build",
    "npm run lint",
    "npm run format",
    "curl *",
  ],
  "@Orchestrator": ["node *.js *", "node *.ts *", "node -e *"],
  "@Architect": ["sed *"],
  /**
   * FW-REPAIR-SHELL-TSX (2026-06-06): Added docker commands for emergency
   * framework repairs (container inspection, restart for CI failures, etc.).
   * Also includes tsx patterns from FW-REPAIR-15 for running TypeScript
   * maintenance scripts.
   */
  "@Super-Admin": [
    "git *",
    "/home/zhaoge/.bun/bin/bun *",
    "rm -rf .opencode/lib/*",
    "rm -rf .opencode/scripts/*.js",
    "rm -rf .opencode/scripts/*.ts",
    "rm -rf .opencode/scripts/*.mjs",
    "mv .opencode/scripts/*.js .opencode/scripts/*.ts",
    "mv .opencode/scripts/*.ts .opencode/scripts/*.js",
    "chmod +x .opencode/**",
    "sed -i *",
    // FW-REPAIR-15 (2026-06-06): Add tsx patterns for Super-Admin only.
    // tsx is a TypeScript executor (alternative to ts-node). These patterns
    // allow Super-Admin to run framework maintenance scripts via tsx.
    "npx tsx *",
    "tsx *",
    "bunx tsx *",
    // FW-REPAIR-SHELL-TSX (2026-06-06): Docker commands for emergency
    // framework repairs (container inspection, restart, etc.)
    "docker *",
    "docker compose *",
    "docker-compose *",
  ],
};

/**
 * Dangerous command patterns that are ALWAYS blocked,
 * regardless of the allowlist.
 */
export const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+.*\.(json|yaml|yml|md|ts|js)\b/i, // Don't delete source files
  /rm\s+-rf\s+\//i, // Never delete root filesystem
  />\s*\.(opencode|git)/i, // Don't redirect to framework dirs
  /curl\s+.*\|\s*sh/i, // No pipe to shell
  /wget\s+.*\|\s*sh/i, // No pipe to shell
  /eval\s*\(/i, // No eval
  /exec\s*\(/i, // No exec
  /child_process/i, // No child_process in child_process
  /require\s*\(\s*['"]http['"]\s*\)/i, // No HTTP requests
  /require\s*\(\s*['"]https['"]\s*\)/i, // No HTTPS requests
  /git\s+add\s+.*\.opencode\/(?:state|agents|rules|hooks|lib)\b/i, // B2: Don't stage framework files (bypasses pre-commit hooks)
  /(?:cp|mv)\s+.*\.opencode\/(?:hooks|state|agents|rules)\b/i, // B3: Don't overwrite framework files (hooks/state/agents)
  /tee\s+.*\.opencode\/(?:hooks|state|agents|rules)\b/i, // Don't tee to framework dirs
  /chmod\s+.*\.opencode\/(?:hooks|agents)\b/i, // Don't chmod hooks/agents
  /sed\s+-i\s+.*\.opencode\/(?:hooks|state|agents|rules|lib)\b/i, // Don't sed-edit framework files

  /**
   * UC7KS-HARDEN-SHELL (2026-06-07): Block safe_shell write operations targeting
   * the knowledge cache (docs/official_docs/). Only @Knowledge-Curator may modify
   * the knowledge cache (UC7-008 scope isolation), and it uses safe_edit/write tools,
   * not safe_shell. These patterns mirror the existing .opencode/ protection above.
   *
   * @rationale Without these patterns, safe_shell operations like `cp`, `mv`, `touch`,
   *   `tee`, redirects (`>`, `>>`), and `sed -i` could silently modify or corrupt
   *   the knowledge cache, bypassing the UC7KS pipeline (UC7-001, UC7-008) and
   *   causing machine.json.knowledge_cache_state to diverge from actual cache state.
   */
  />\s*docs\/official_docs\//i, // B5: Block redirect (> or >>) to knowledge cache
  /tee\s+.*docs\/official_docs\//i, // B6: Block tee to knowledge cache files
  /touch\s+.*docs\/official_docs\//i, // B7: Block touch creating files in knowledge cache
  /sed\s+-i\s+.*docs\/official_docs\//i, // B8: Block sed in-place edits to knowledge cache
  /(?:cp|mv)\s+.*docs\/official_docs\//i, // B9: Block cp/mv involving knowledge cache
];

// ════════════════════════════════════════════════════════════
// SCRIPT PATH CONSTANTS — Content scanning for node *.ts/*.js
// ════════════════════════════════════════════════════════════

/** Script paths where file-write operations are permitted (no scan needed) */
export const ALLOWED_SCRIPT_PATHS: string[] = [
  "__tests__",
  ".opencode_backups",
  ".task_temp",
];

/**
 * Agent-specific script allowlist — bypasses content scanning for maintenance
 * scripts that legitimately need file-write operations (e.g., rule_registry repair,
 * state reset). Only the listed agents may execute these scripts via `node <script>`.
 */
export const AGENT_ALLOWED_SCRIPTS: Record<string, string[]> = {
  "@Super-Admin": [
    "state-reconciliation.js",
    "state-transaction.js",
    "framework-self-test.js",
    "framework-doctor.js",
  ],
};

/** File-write patterns to detect in scanned scripts */
export const WRITE_PATTERNS: RegExp[] = [
  /.writeFileSync\s*\(/,
  /.writeFile\s*\(/,
  /.appendFileSync\s*\(/,
  /.createWriteStream\s*\(/,
  /.renameSync\s*\(/,
  /.copyFileSync\s*\(/,
  /.mkdirSync\s*\(/,
];

// ════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Performs glob-style matching of a command against a pattern.
 * Supports `*` as a wildcard for any sequence of characters.
 *
 * @public — Command pattern matching. Also used by framework-enforcer.ts for write-scope checks.
 */
export function matchGlob(command: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
  return new RegExp(`^${regex}$`, "is").test(command.trim());
}

/**
 * Get the effective allowlist for a given agent.
 *
 * P2-D v2.1: per-agent command permissions are now read from opencode.json
 * (authoritative source) via getAgentShellAllowlist(). Returns "ALL_ALLOWED"
 * sentinel when opencode.json grants permissive "allow", meaning all commands
 * are permitted beyond the dangerous_patterns check.
 *
 * Caller MUST check for "ALL_ALLOWED" sentinel before invoking isAllowed().
 * toolDenied / denied / needsConfirmation checks are performed in safeBashTool()
 * BEFORE this function is called, so this function only returns the positive
 * allowlist (or ALL_ALLOWED marker).
 *
 * @public — Agent-specific merged allowlist; used by safeBashTool and framework-enforcer.
 */
export function getAllowlist(agent: string): string[] | "ALL_ALLOWED" {
  // Normalize: ensure leading @ for AGENT_ALLOWLISTS lookup
  if (!agent.startsWith("@")) agent = "@" + agent;
  // P2-D v2.1: per-agent shell permissions from opencode.json (authoritative)
  const shellResult = getAgentShellAllowlist(agent);

  if (shellResult.toolDenied) {
    // Tool itself denied — caller (safeBashTool) should have already blocked
    return [];
  }

  // Permissive "allow": all commands permitted beyond dangerous_patterns check
  if (shellResult.allAllowed) {
    writeLog("safe-bash", "runtime", {
      agent,
      level: "INFO",
      event: "ALLOWLIST-SOURCE-SWITCH",
      detail: `agent="${agent}" source=opencode.json mode=all_allowed (permissive)`,
    });
    return "ALL_ALLOWED";
  }

  // Merge default_allowlist (project.config.json framework policy) with
  // opencode.json per-agent allowed patterns. deny/ask handled by safeBashTool.
  const configDefaults = _getConfigList("default_allowlist", DEFAULT_ALLOWLIST);
  const allowed = [...configDefaults, ...shellResult.allowed];
  writeLog("safe-bash", "runtime", {
    agent,
    level: "INFO",
    event: "ALLOWLIST-SOURCE-SWITCH",
    detail: `agent="${agent}" source=opencode.json entries=${shellResult.allowed.length} merged=${allowed.length}`,
  });
  return allowed;
}
