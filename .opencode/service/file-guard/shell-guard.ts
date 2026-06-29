/**
 * shell-guard.ts — Safe Bash Command Validation & Execution
 * Extracted from safe-bash-core.ts during FileGuard Service migration (Phase 1a).
 * Config/constants imported from ./shell-config.
 *
 * Exports: SafeBashResult, SafeBashOptions, isAllowed, isDangerous,
 *   _scriptContainsFileWrite, _isScriptInAllowedPath, safeBashTool
 *
 * @author @Architect
 * @version 1.0.0
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { getAgentShellAllowlist } from "../../lib/permission-reader";
import { normalize } from "../../lib/agent-identity";
import {
  matchGlob,
  DEFAULT_ALLOWLIST,
  AGENT_ALLOWLISTS,
  DANGEROUS_PATTERNS,
  ALLOWED_SCRIPT_PATHS,
  AGENT_ALLOWED_SCRIPTS,
  WRITE_PATTERNS,
  getAllowlist,
  _hasAgentDangerousBypass,
  _loadSafeShellConfig,
  _getConfigList,
  _getConfigMap,
  resetSafeShellConfigCache,
} from "./shell-config";

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
  success?: boolean;
  duration?: number;
}

export interface SafeBashOptions {
  command: string;
  timeout?: number;
  dryRun?: boolean;
  agent?: string;
  /** FW-INTERRUPT-GUARD: AbortSignal forwarded from execution context. */
  signal?: AbortSignal;
}

// ════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ════════════════════════════════════════════════════════════

/** @public — Allowlist validation; used by safeBashTool and framework-enforcer. */
export function isAllowed(command: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => matchGlob(command, pattern));
}

/** @public — Dangerous pattern detection; used by safeBashTool. */
export function isDangerous(command: string): boolean {
  const cfg = _loadSafeShellConfig();
  if (cfg && Array.isArray(cfg.dangerous_patterns)) {
    return cfg.dangerous_patterns.some((p: string) =>
      new RegExp(p, "i").test(command),
    );
  }
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

// ════════════════════════════════════════════════════════════
// SCRIPT CONTENT SCANNING — Close node *.ts/*.js write backdoor
// ════════════════════════════════════════════════════════════

/** Scan a .ts/.js script file for file-write operations. */
export function _scriptContainsFileWrite(scriptPath: string): {
  blocked: boolean;
  reason: string | null;
} {
  let content: string;
  try {
    content = fs.readFileSync(scriptPath, "utf8");
  } catch {
    return { blocked: false, reason: null };
  }

  // FW-REPAIR-14: Skip shebang lines, check first non-shebang line for opt-in header
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

/** Check if a resolved script path is within an allowed directory. */
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

function logAction(result: SafeBashResult): void {
  writeLog("safe-bash", "INFO", {
    event: "SAFE-BASH-ACTION",
    command: result.command,
    agent: result.agent,
    exitCode: result.exitCode,
    success: result.success,
    duration: result.duration,
    timestamp: new Date().toISOString(),
    detail: `Safe bash: ${result.command} exit=${result.exitCode}`,
  });
}

// ════════════════════════════════════════════════════════════
// PUBLIC API — safeBashTool execution function
// ════════════════════════════════════════════════════════════

/** @public — Core safe bash execution. Entry point for safe_shell tool. */
export function safeBashTool(options: SafeBashOptions): SafeBashResult {
  const {
    command,
    timeout = 300000,
    dryRun = false,
    agent = "unknown",
    signal,
  } = options;

  const allowlist = getAllowlist(agent);
  const hasBypass = _hasAgentDangerousBypass(agent, command);

  // P2-D v2.1: Pre-check deny/ask veto from opencode.json (authority inversion).
  const shellResult = getAgentShellAllowlist(agent);
  if (shellResult.toolDenied) {
    const result: SafeBashResult = {
      command, agent, allowed: false, executed: false, exitCode: null,
      stdout: "", stderr: "",
      blockedReason: "SHELL_TOOL_DENIED: safe_shell denied by opencode.json permission",
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
  if (shellResult.denied.some((pattern) => matchGlob(command, pattern))) {
    const result: SafeBashResult = {
      command, agent, allowed: false, executed: false, exitCode: null,
      stdout: "", stderr: "",
      blockedReason: "SHELL_CMD_DENIED_BY_PERMISSION: command denied by opencode.json safe_shell",
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
  if (shellResult.needsConfirmation.some((pattern) => matchGlob(command, pattern))) {
    // "ask" semantics: in non-interactive context, degrade to deny (HIGH-1 fix)
    writeLog("safe-bash", "runtime", {
      agent, level: "WARN", event: "ASK-CMD-BLOCKED-IN-AUTO-CTX",
      detail: `agent="${agent}" command="${command}" blocked (ask requires confirmation, non-interactive)`,
    });
    const result: SafeBashResult = {
      command, agent, allowed: false, executed: false, exitCode: null,
      stdout: "", stderr: "",
      blockedReason: "ASK_CMD_BLOCKED_IN_AUTO_CTX: command requires confirmation",
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 1. Check for dangerous patterns (skip if agent has explicit bypass)
  if (!hasBypass && isDangerous(command)) {
    const result: SafeBashResult = {
      command, agent, allowed: false, executed: false, exitCode: null,
      stdout: "", stderr: "",
      blockedReason: "DANGEROUS_PATTERN: Command matches blocked pattern",
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 2. Check allowlist (handle "ALL_ALLOWED" sentinel from opencode.json)
  if (allowlist !== "ALL_ALLOWED" && !isAllowed(command, allowlist as string[])) {
    const result: SafeBashResult = {
      command, agent, allowed: false, executed: false, exitCode: null,
      stdout: "", stderr: "",
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
    const normalizedAgent = agent.startsWith("@") ? agent : "@" + agent;
    const configAgentScripts = _getConfigMap("agent_allowed_scripts", AGENT_ALLOWED_SCRIPTS);
    const agentScripts = configAgentScripts[normalizedAgent] || [];
    const isAgentAllowedScript = agentScripts.some((allowed) =>
      scriptArg.includes(allowed),
    );
    if (!isAgentAllowedScript && !_isScriptInAllowedPath(scriptPath)) {
      const scanResult = _scriptContainsFileWrite(scriptPath);
      if (scanResult.blocked) {
        const result: SafeBashResult = {
          command, agent, allowed: false, executed: false, exitCode: null,
          stdout: "", stderr: "", blockedReason: scanResult.reason,
          timestamp: new Date().toISOString(),
        };
        logAction(result);
        return result;
      }
    }
  }

  // FW-PERM-AUDIT-EXEC T3: Eval content scan for node -e / bun -e / tsx -e
  const evalMatch = command.match(
    /^(?:node|bun|npx\s+tsx|tsx|bunx\s+tsx)\s+(?:-e|--eval)\s+(.+)/i,
  );
  if (evalMatch && !hasBypass) {
    const evalArg = evalMatch[1].trim();
    const writePatterns = _getConfigList("write_patterns", []).map(
      (p: string) => new RegExp(p, "i"),
    );
    const patterns = writePatterns.length > 0 ? writePatterns : WRITE_PATTERNS;
    const evalPatterns = [
      ...patterns,
      /.unlinkSync\s*\(/,
      /.rmSync\s*\(/,
      /.rmdirSync\s*\(/,
    ];

    // FW-PERM-AUDIT-EXEC T4: Orchestrator path-aware eval constraints
    const isOrchestrator = normalize(agent) === "orchestrator";

    for (const pattern of evalPatterns) {
      if (pattern.test(evalArg)) {
        // Orchestrator path-aware bypass (FW-PERM-FIX-ORCH-DOCS-REPAIR)
        if (isOrchestrator) {
          if (/\.task_temp\//.test(evalArg) || /docs\/review\//.test(evalArg)) {
            break; // writes within Orchestrator's scope
          }
          const blockedResult: SafeBashResult = {
            command, agent, allowed: false, executed: false, exitCode: null,
            stdout: "", stderr: "",
            blockedReason: `EVAL_FILE_WRITE_SCOPE: Command "${command}" contains file-write/delete operations outside of Orchestrator's allowed scope (.task_temp/**, docs/review/**). Blocked by eval content scan.`,
            timestamp: new Date().toISOString(),
          };
          logAction(blockedResult);
          return blockedResult;
        }

        // Non-Orchestrator: block all write/delete
        const isDelete = /unlinkSync|rmSync|rmdirSync/.test(pattern.source);
        const reason = isDelete
          ? `EVAL_FILE_DELETE: Command "${command}" contains file-delete operations (unlinkSync/rmSync/rmdirSync) in -e argument. Blocked by eval content scan.`
          : `EVAL_FILE_WRITE: Command "${command}" contains file-write operations (writeFileSync/writeFile/etc) in -e argument. Blocked by eval content scan.`;
        const result: SafeBashResult = {
          command, agent, allowed: false, executed: false, exitCode: null,
          stdout: "", stderr: "", blockedReason: reason,
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
      command, agent, allowed: true, executed: false, exitCode: null,
      stdout: "", stderr: "", blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }

  // 5. Execute command
  // FW-INTERRUPT-GUARD: pre-flight abort check
  if (signal?.aborted) {
    const interrupted: SafeBashResult = {
      command, agent, allowed: true, executed: false, exitCode: 130,
      stdout: "", stderr: "interrupted", blockedReason: null,
      timestamp: new Date().toISOString(),
    };
    logAction(interrupted);
    return interrupted;
  }

  try {
    const execOptions: Parameters<typeof execSync>[1] = {
      timeout, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    };
    if (signal) {
      (execOptions as any).signal = signal;
    }
    const stdout = execSync(command, execOptions);
    const result: SafeBashResult = {
      command, agent, allowed: true, executed: true, exitCode: 0,
      stdout: (stdout as string).trim(), stderr: "", blockedReason: null,
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
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || err.message,
      blockedReason: null, timestamp: new Date().toISOString(),
    };
    logAction(result);
    return result;
  }
}
