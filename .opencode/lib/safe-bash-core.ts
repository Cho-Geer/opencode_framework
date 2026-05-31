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

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

/**
 * Default allowlist for safe bash commands.
 * These patterns are allowed for ALL agents by default.
 */
export const DEFAULT_ALLOWLIST: string[] = [
  'npm run *',
  'npx jest *',
  'npx tsc *',
  'npx eslint *',
  'node * --help',
  'node *.js',
  'node *.ts',
  'node *.js *',
  'node *.ts *',
  'node -e *',
  'git status',
  'git log *',
  'git diff *',
  'git add *',
  'git commit *',
  'git *',
  'docker --version',
  'docker-compose --version',
  'echo *',
  'cat *',
  'ls *',
  'pwd',
  'mkdir -p *',
  'rm -rf .task_temp/*',
  'touch *',
  'cp * *',
  'mv * *',
  'grep *',
  'find *',
  'head *',
  'tail *',
  'wc -l *',
  'sort *',
  'uniq *',
  'whoami',
  'date',
  'uname *',
  'which *',
  'env | grep *',
];

/**
 * Agent-specific allowlist extensions.
 * Each agent gets its own set of additional allowed commands.
 */
export const AGENT_ALLOWLISTS: Record<string, string[]> = {
  '@CI-CD-Agent': [
    'docker build *',
    'docker push *',
    'docker pull *',
    'docker run *',
    'docker-compose up *',
    'docker-compose down *',
    'docker ps *',
    'docker images *',
    'docker logs *',
    'kubectl *',
    'helm *',
    'terraform *',
    'ansible-playbook *',
  ],
  '@Coder-BE': [
    'npx prisma *',
    'npm run db:*',
    'npm run test:*',
    'npm run build',
    'npm run lint',
    'npm run format',
    'curl *',
  ],
  '@Orchestrator': [
    'node *.js *',
    'node *.ts *',
    'node -e *',
    'git *',
  ],
};

/**
 * Dangerous command patterns that are ALWAYS blocked,
 * regardless of the allowlist.
 */
export const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+.*\.(json|yaml|yml|md|ts|js)\b/i,      // Don't delete source files
  /rm\s+-rf\s+\//i,                               // Never delete root filesystem
  />\s*\.(opencode|git)/i,                         // Don't redirect to framework dirs
  /curl\s+.*\|\s*sh/i,                             // No pipe to shell
  /wget\s+.*\|\s*sh/i,                             // No pipe to shell
  /eval\s*\(/i,                                    // No eval
  /exec\s*\(/i,                                    // No exec
  /child_process/i,                                // No child_process in child_process
  /require\s*\(\s*['"]http['"]\s*\)/i,            // No HTTP requests
  /require\s*\(\s*['"]https['"]\s*\)/i,            // No HTTPS requests
  /git\s+add\s+.*\.opencode\/(?:state|agents|rules|hooks|lib)\b/i,  // B2: Don't stage framework files (bypasses pre-commit hooks)
  /(?:cp|mv)\s+.*\.opencode\/(?:hooks|state|agents|rules)\b/i,     // B3: Don't overwrite framework files (hooks/state/agents)
  /tee\s+.*\.opencode\/(?:hooks|state|agents|rules)\b/i,            // Don't tee to framework dirs
  /chmod\s+.*\.opencode\/(?:hooks|agents)\b/i,                      // Don't chmod hooks/agents
  /sed\s+-i\s+.*\.opencode\/(?:hooks|state|agents|rules|lib)\b/i,   // Don't sed-edit framework files
];

// ════════════════════════════════════════════════════════════
// SCRIPT PATH CONSTANTS — Content scanning for node *.ts/*.js
// ════════════════════════════════════════════════════════════

/** Script paths where file-write operations are permitted (no scan needed) */
export const ALLOWED_SCRIPT_PATHS: string[] = ['__tests__', '.opencode_backups', '.task_temp'];

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
 */
export function matchGlob(command: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  return new RegExp(`^${regex}$`, 'i').test(command.trim());
}

/**
 * Check if a command matches any pattern in the given allowlist.
 */
export function isAllowed(command: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => matchGlob(command, pattern));
}

/**
 * Check if a command contains any dangerous patterns.
 */
export function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Get the effective allowlist for a given agent.
 * Merges DEFAULT_ALLOWLIST with agent-specific extensions.
 */
export function getAllowlist(agent: string): string[] {
  const extensions = AGENT_ALLOWLISTS[agent] || [];
  return [...DEFAULT_ALLOWLIST, ...extensions];
}

// ════════════════════════════════════════════════════════════
// SCRIPT CONTENT SCANNING — Close node *.ts/*.js write backdoor
// ════════════════════════════════════════════════════════════

/**
 * Scan a .ts/.js script file for file-write operations.
 * Returns blocking info if write patterns found and no opt-in header.
 */
export function _scriptContainsFileWrite(
  scriptPath: string,
): { blocked: boolean; reason: string | null } {
  let content: string;
  try {
    content = fs.readFileSync(scriptPath, 'utf8');
  } catch {
    // File does not exist or can't be read → not a threat
    return { blocked: false, reason: null };
  }

  // Check for opt-in header comment (must be first line)
  const firstLine = content.split('\n')[0].trim();
  if (firstLine === '// safe_bash: allow-write') {
    return { blocked: false, reason: null };
  }

  // Scan for file-write patterns
  for (const pattern of WRITE_PATTERNS) {
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
  const normalized = path.resolve(scriptPath).replace(/\\/g, '/');
  return ALLOWED_SCRIPT_PATHS.some(
    (allowed) =>
      normalized.includes(`/${allowed}/`) ||
      normalized.endsWith(`/${allowed}`),
  );
}

// ════════════════════════════════════════════════════════════
// ACTION LOGGING
// ════════════════════════════════════════════════════════════

/**
 * Log safe bash action to log file
 */
function logAction(result: SafeBashResult): void {
  const logDir = path.join(process.cwd(), '.opencode', 'logs');
  const logFile = path.join(logDir, 'safe-bash.log');

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const entry = {
    ...result,
    timestamp: new Date().toISOString(),
  };

  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

// ════════════════════════════════════════════════════════════
// PUBLIC API — safeBashTool execution function
// ════════════════════════════════════════════════════════════

/**
 * Execute safe bash command with allowlist validation, dangerous pattern
 * detection, and script content scanning for node *.ts/*.js scripts.
 */
export function safeBashTool(options: SafeBashOptions): SafeBashResult {
  const {
    command,
    timeout = 300000,
    dryRun = false,
    agent = process.env.FRAMEWORK_AGENT || 'unknown',
  } = options;

  const allowlist = getAllowlist(agent);

  // 1. Check for dangerous patterns
  if (isDangerous(command)) {
    const result: SafeBashResult = {
      command, agent, allowed: false, executed: false,
      exitCode: null, stdout: '', stderr: '',
      blockedReason: 'DANGEROUS_PATTERN: Command matches blocked pattern',
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 2. Check allowlist
  if (!isAllowed(command, allowlist)) {
    const result: SafeBashResult = {
      command, agent, allowed: false, executed: false,
      exitCode: null, stdout: '', stderr: '',
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

    if (!_isScriptInAllowedPath(scriptPath)) {
      const scanResult = _scriptContainsFileWrite(scriptPath);
      if (scanResult.blocked) {
        const result: SafeBashResult = {
          command, agent, allowed: false, executed: false,
          exitCode: null, stdout: '', stderr: '',
          blockedReason: scanResult.reason,
          timestamp: new Date().toISOString(),
        };
        logAction(result);
        return result;
      }
    }
  }

  // 4. Dry run - validate only
  if (dryRun) {
    const result: SafeBashResult = {
      command, agent, allowed: true, executed: false,
      exitCode: null, stdout: '', stderr: '',
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 5. Execute command
  try {
    const stdout = execSync(command, {
      timeout, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result: SafeBashResult = {
      command, agent, allowed: true, executed: true,
      exitCode: 0, stdout: stdout.trim(), stderr: '',
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  } catch (error: unknown) {
    const err = error as Error & {
      status?: number; stdout?: Buffer; stderr?: Buffer;
    };
    const result: SafeBashResult = {
      command, agent, allowed: true, executed: true,
      exitCode: err.status || 1,
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || err.message,
      blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
}
