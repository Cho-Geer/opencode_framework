/**
 * safe-bash-core.ts — Shared Bash Command Validation & Allowlist
 * ==============================================================
 *
 * SINGLE SOURCE OF TRUTH for ALLOWED_COMMANDS.
 * Currently duplicated in:
 *   - .opencode/tools/safe-bash.js (CommonJS)
 *   - .opencode/plugins/lib/safe-bash.ts (TypeScript)
 *
 * Both will import from this file after consolidation.
 *
 * Exports:
 *   - DEFAULT_ALLOWLIST: string[]
 *   - AGENT_ALLOWLISTS: Record<string, string[]>
 *   - DANGEROUS_PATTERNS: RegExp[]
 *   - matchGlob(command, pattern): boolean
 *   - isAllowed(command, allowlist): boolean
 *   - isDangerous(command): boolean
 *   - getAllowlist(agent): string[]
 *
 * @author @Architect
 * @version 1.0.0
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

export interface SafeBashResult {
  command: string;
  agent: string;
  allowed: boolean;
  executed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  blockedReason: string | null;
  timestamp: string;
}

export interface SafeBashOptions {
  command: string;
  timeout?: number;
  dryRun?: boolean;
  agent?: string;
}

// ════════════════════════════════════════════════════════════
// CONSTANTS — Single source of truth
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// CONFIG LOADER — reads project.config.json.safe_shell at runtime
// FW-UNIFY-TS-P3: Externalizes allowlists/patterns from hardcoded constants.
// Falls back to hardcoded values when config section is absent.
// ════════════════════════════════════════════════════════════

let _safeShellConfigCache: any = null;
let _safeShellConfigLoaded = false;

function _loadSafeShellConfig(): any {
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

function _getConfigList(key: string, fallback: string[]): string[] {
  const cfg = _loadSafeShellConfig();
  return cfg && Array.isArray(cfg[key]) ? cfg[key] : fallback;
}

function _getConfigMap(
  key: string,
  fallback: Record<string, string[]>,
): Record<string, string[]> {
  const cfg = _loadSafeShellConfig();
  return cfg && cfg[key] && typeof cfg[key] === "object" ? cfg[key] : fallback;
}

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
 *
 * Added FW-REPAIR-14: Super-Admin needs rule-registry-verify.js --repair to
 * regenerate digests after framework sync operations.
 */
export const AGENT_ALLOWED_SCRIPTS: Record<string, string[]> = {
  "@Super-Admin": [
    "rule-registry-verify.js",
    "state-reconciliation.js",
    "state-transaction.js",
  ],
};

/** File-write patterns to detect in scanned scripts */
export const WRITE_PATTERNS: RegExp[] = [
  /fs\.writeFileSync\s*\(/,
  /fs\.writeFile\s*\(/,
  /fs\.appendFileSync\s*\(/,
  /fs\.createWriteStream\s*\(/,
  /fs\.renameSync\s*\(/,
  /fs\.copyFileSync\s*\(/,
  /fs\.mkdirSync\s*\(/,
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
 * Check if a command matches any pattern in the given allowlist.
 *
 * @public — Allowlist validation; used by safeBashTool and framework-enforcer.
 */
export function isAllowed(command: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => matchGlob(command, pattern));
}

/**
 * Check if a command contains any dangerous patterns.
 *
 * @public — Dangerous pattern detection; used by safeBashTool.
 */
export function isDangerous(command: string): boolean {
  // FW-UNIFY-TS-P3: Config-aware — read dangerous_patterns from project.config.json,
  // converting string patterns to RegExp at runtime. Falls back to hardcoded DANGEROUS_PATTERNS.
  const cfg = _loadSafeShellConfig();
  if (cfg && Array.isArray(cfg.dangerous_patterns)) {
    return cfg.dangerous_patterns.some((p: string) =>
      new RegExp(p, "i").test(command),
    );
  }
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Get the effective allowlist for a given agent.
 * Merges DEFAULT_ALLOWLIST with agent-specific extensions.
 *
 * @public — Agent-specific merged allowlist; used by safeBashTool and framework-enforcer.
 */
export function getAllowlist(agent: string): string[] {
  // Normalize: ensure leading @ for AGENT_ALLOWLISTS lookup
  if (!agent.startsWith("@")) agent = "@" + agent;
  // FW-UNIFY-TS-P3: Config-aware — merge project.config.json overrides with hardcoded fallbacks
  const configDefaults = _getConfigList("default_allowlist", DEFAULT_ALLOWLIST);
  const configAgents = _getConfigMap("agent_allowlists", AGENT_ALLOWLISTS);
  const extensions = configAgents[agent] || [];
  return [...configDefaults, ...extensions];
}

// ════════════════════════════════════════════════════════════
// SCRIPT CONTENT SCANNING — Close node *.ts/*.js write backdoor
// ════════════════════════════════════════════════════════════

/**
 * Scan a .ts/.js script file for file-write operations.
 * Returns blocking info if write patterns found and no opt-in header.
 */
export function _scriptContainsFileWrite(scriptPath: string): {
  blocked: boolean;
  reason: string | null;
} {
  let content: string;
  try {
    content = fs.readFileSync(scriptPath, "utf8");
  } catch {
    // File does not exist or can't be read → not a threat
    return { blocked: false, reason: null };
  }

  // Check for opt-in header comment.
  // FW-REPAIR-14: Skip shebang lines (#!/usr/bin/env node) and check the first
  // non-shebang, non-empty line. Previously only checked line 0, which broke
  // scripts with shebangs where the opt-in was on line 1.
  const lines = content.split("\n");
  let firstNonShebangLine = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#!")) {
      firstNonShebangLine = trimmed;
      break;
    }
  }
  if (firstNonShebangLine === "// safe_bash: allow-write") {
    return { blocked: false, reason: null };
  }

  // Scan for file-write patterns — config-aware (FW-UNIFY-TS-P3)
  const writePatterns = _getConfigList("write_patterns", []).map(
    (p: string) => new RegExp(p, "i"),
  );
  const patterns = writePatterns.length > 0 ? writePatterns : WRITE_PATTERNS;
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return {
        blocked: true,
        reason: `SCRIPT_FILE_WRITE: Script "${scriptPath}" contains file-write operations. Blocked by content scan. Add '// safe_bash: allow-write' as first line to override.`,
      };
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Check if a resolved script path is within an allowed directory.
 * Allowed directories: __tests__/, .opencode_backups/, .task_temp/
 */
export function _isScriptInAllowedPath(scriptPath: string): boolean {
  const normalized = path.resolve(scriptPath).replace(/\\/g, "/");
  const allowedPaths = _getConfigList(
    "allowed_script_paths",
    ALLOWED_SCRIPT_PATHS,
  );
  return allowedPaths.some(
    (allowed) =>
      normalized.includes(`/${allowed}/`) || normalized.endsWith(`/${allowed}`),
  );
}

// ════════════════════════════════════════════════════════════
// ACTION LOGGING
// ════════════════════════════════════════════════════════════

/**
 * Log safe bash action to log file
 */
function logAction(result: SafeBashResult): void {
  const logDir = path.join(process.cwd(), ".opencode", "logs");
  const logFile = path.join(logDir, "safe-bash.log");

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const entry = {
    ...result,
    timestamp: new Date().toISOString(),
  };

  fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");

  // ── P2-2: Log rotation trigger (best-effort, fire-and-forget) ──
  try {
    const { rotateSafeBashLogIfNeeded } = require("./dist/log-rotator");
    rotateSafeBashLogIfNeeded().catch(() => {});
  } catch {
    // Best-effort: rotation module may not be compiled yet
  }
}

// ════════════════════════════════════════════════════════════
// PUBLIC API — safeBashTool execution function
// ════════════════════════════════════════════════════════════

/**
 * Execute safe bash command with allowlist validation, dangerous pattern
 * detection, and script content scanning for node *.ts/*.js scripts.
 *
 * @public — Core safe bash execution. Entry point for safe_shell tool.
 */
export function safeBashTool(options: SafeBashOptions): SafeBashResult {
  const {
    command,
    timeout = 300000,
    dryRun = false,
    agent = "unknown", // v4.0.0: FRAMEWORK_AGENT deprecated; allowlist agent resolution uses caller-supplied value
  } = options;

  const allowlist = getAllowlist(agent);

  // 1. Check for dangerous patterns
  if (isDangerous(command)) {
    const result: SafeBashResult = {
      command,
      agent,
      allowed: false,
      executed: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      blockedReason: "DANGEROUS_PATTERN: Command matches blocked pattern",
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 2. Check allowlist
  if (!isAllowed(command, allowlist)) {
    const result: SafeBashResult = {
      command,
      agent,
      allowed: false,
      executed: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      blockedReason: `NOT_IN_ALLOWLIST: Command not in agent ${agent} allowlist`,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 3. Script content scan — block node *.ts/*.js scripts that write files
  const nodeScriptMatch = command.match(/^node\s+(.+\.(ts|js))(?:$|\s)/i);
  if (nodeScriptMatch) {
    const scriptArg = nodeScriptMatch[1];
    const scriptPath = path.resolve(process.cwd(), scriptArg);

    // FW-REPAIR-14: Agent-specific script bypass — config-aware (FW-UNIFY-TS-P3)
    const normalizedAgent = agent.startsWith("@") ? agent : "@" + agent;
    const configAgentScripts = _getConfigMap(
      "agent_allowed_scripts",
      AGENT_ALLOWED_SCRIPTS,
    );
    const agentScripts = configAgentScripts[normalizedAgent] || [];
    const isAgentAllowedScript = agentScripts.some((allowed) =>
      scriptArg.includes(allowed),
    );

    if (!isAgentAllowedScript) {
      if (!_isScriptInAllowedPath(scriptPath)) {
        const scanResult = _scriptContainsFileWrite(scriptPath);
        if (scanResult.blocked) {
          const result: SafeBashResult = {
            command,
            agent,
            allowed: false,
            executed: false,
            exitCode: null,
            stdout: "",
            stderr: "",
            blockedReason: scanResult.reason,
            timestamp: new Date().toISOString(),
          };
          logAction(result);
          return result;
        }
      }
    }
  }

  // 4. Dry run - validate only
  if (dryRun) {
    const result: SafeBashResult = {
      command,
      agent,
      allowed: true,
      executed: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 5. Execute command
  try {
    const stdout = execSync(command, {
      timeout,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result: SafeBashResult = {
      command,
      agent,
      allowed: true,
      executed: true,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: "",
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  } catch (error: unknown) {
    const err = error as Error & {
      status?: number;
      stdout?: Buffer;
      stderr?: Buffer;
    };
    const result: SafeBashResult = {
      command,
      agent,
      allowed: true,
      executed: true,
      exitCode: err.status || 1,
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || err.message,
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
}
