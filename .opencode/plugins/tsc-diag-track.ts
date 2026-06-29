/**
 * tsc-diag-track.ts v2 — Zero-tolerance TypeScript diagnostic gating plugin
 * ═══════════════════════════════════════════════════════════════════════
 * Part of the 3-layer tsc diagnostic gate (lsp-diagnostic-gate-implementation-plan.md v2.2).
 *
 * Layer 1 (beforeWriteBlock): Runs tsc BEFORE write. If target file has ANY
 *   TSC errors, blocks the write in strict/locked mode.
 * Layer 1.5 (afterWriteTscCheck): Runs tsc AFTER write, updates diagnostic_state.
 *
 * KEY BEHAVIOR CHANGE (v2):
 *   - Zero-tolerance: target file with ANY TSC error → BLOCK write
 *   - "动过的文件所有tsc错误必须清理干净": any file you modify must have 0 TSC errors
 *   - Non-target file errors: recorded to diagnostic_state but do NOT block
 *   - compareWithBaseline removed: baseline only used for progress tracking
 *
 * CONCURRENCY:
 *   - File-level locks (tsc_gate_locks table): prevent concurrent modification of same file
 *   - tsc mutex (__TSC_MUTEX__): prevent concurrent tsc processes
 *   - Different files: no interference
 *   - Same file, different agent: second agent blocked with clear error
 *
 * Design coverage:
 *   - Hardened Enforcement Subsystem: strict/locked = block, advisory = warn
 *   - DB-canonical: all state via substate_kv (diagnostic_state)
 *   - Log Central Management: all events via writeLog()
 *   - Multi-Agent Subsystem: file locks + tsc mutex
 *   - Framework Harness Subsystem: tool.execute.before + tool.execute.after hooks
 *
 * @author @Super-Admin
 * @since 2026-06-26
 * @revised 2026-06-27 — v2: zero-tolerance, file locks, tsc mutex
 * @revised 2026-06-29 — Batch 2: imports from service/ layer
 */

import * as path from "node:path";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import {
  isModifyTool,
  getModifyPath,
  getEffectivePathScopePaths,
} from "../lib/tool-scope";
import { getEnforcementMode } from "../lib/gate-core";
import { readSubState } from "../lib/substate-manager";
import {
  runTscDiagnostic,
  acquireFileLock,
  releaseFileLock,
  acquireTscMutex,
  releaseTscMutex,
  logTscGateEvent,
  getTscGateConfig,
  updateDiagnosticState,
} from "../service/file-guard";

const PLUGIN_NAME = "tsc-diag-track";

export default withPluginLifecycle(PLUGIN_NAME, {
  "tool.execute.before": beforeWriteBlock,
  "tool.execute.after": afterWriteTscCheck,
});

// ── Helper: get all TS/TSX write targets from a tool operation ──

function getTypeScriptWriteTargets(tool: string, args: any): string[] {
  const scope = getEffectivePathScopePaths(tool, args || {});
  if (scope.applies && scope.paths.length > 0) {
    return scope.paths.filter(
      (p) => typeof p === "string" && /\.(ts|tsx)$/.test(p),
    );
  }
  // Fallback: direct file path for safe_edit/write/edit
  const directPath = getModifyPath(args);
  if (directPath && /\.(ts|tsx)$/.test(directPath)) {
    return [directPath];
  }
  return [];
}

// ── Layer 1: BEFORE write — Run tsc, check target file, block if errors ──

async function beforeWriteBlock(input: any, output: any): Promise<void> {
  if (!isModifyTool(input?.tool)) return;

  // GAP 1: args are in output.args for before hooks
  const args = output?.args || input?.args || {};
  const targets = getTypeScriptWriteTargets(input.tool, args);
  if (targets.length === 0) return;

  const mode = getEnforcementMode();
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const sessionID = input?.sessionID || input?.sessionId || "unknown";
  const config = getTscGateConfig();

  // ── v2: If mode is "baseline-diff", skip v2 zero-tolerance (v1 compat) ──
  if (config.mode === "baseline-diff") {
    writeLog(PLUGIN_NAME, "runtime", {
      sessionID,
      callID: input?.callID,
      event: "TSC-V1-COMPAT-MODE",
      detail: "baseline-diff mode — skipping v2 zero-tolerance checks",
    });
    return;
  }

  for (const filePath of targets) {
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectRoot, filePath);

    // ── 1. Acquire file lock ──
    const lockAcquired = acquireFileLock(
      absPath,
      sessionID,
      config.lock_timeout_ms,
    );
    if (!lockAcquired) {
      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-LOCK-CONFLICT",
        detail: "File held by another session",
      });
      if (mode !== "advisory") {
        throw new Error(
          `[FW-ENFORCE][TSC-LOCK-CONFLICT] File "${absPath}" is locked by another session. ` +
            `Wait for the other agent to complete or modify a different file. ` +
            `If the other agent has crashed, the lock will auto-release after ${config.lock_timeout_ms}ms.`,
        );
      }
      // Advisory: skip processing this target
      continue;
    }

    // ── 2. Acquire tsc mutex (prevent concurrent tsc) ──
    const startTime = Date.now();
    let mutexAcquired = acquireTscMutex(sessionID, config.lock_timeout_ms);
    if (!mutexAcquired) {
      writeLog(PLUGIN_NAME, "runtime", {
        sessionID,
        callID: input?.callID,
        event: "TSC-MUTEX-WAIT",
        detail: `Waiting for tsc mutex on ${absPath}`,
      });
      // Poll for mutex with timeout
      while (!mutexAcquired && Date.now() - startTime < config.timeout_ms) {
        await sleep(100);
        mutexAcquired = acquireTscMutex(sessionID, config.lock_timeout_ms);
      }
      if (!mutexAcquired) {
        releaseFileLock(absPath, sessionID);
        logTscGateEvent({
          session_id: sessionID,
          file_path: absPath,
          event_type: "TSC-MUTEX-TIMEOUT",
          detail: `Could not acquire tsc mutex within ${config.timeout_ms}ms`,
        });
        if (mode !== "advisory") {
          throw new Error(
            `[FW-ENFORCE][TSC-MUTEX-TIMEOUT] Could not acquire tsc mutex for "${absPath}" ` +
              `within ${config.timeout_ms}ms. Another tsc process may be stuck.`,
          );
        }
        continue;
      }
    }

    // ── 3. Run tsc --noEmit ──
    logTscGateEvent({
      session_id: sessionID,
      file_path: absPath,
      event_type: "TSC-CHECK-START",
      detail: "before-write",
    });

    const result = runTscDiagnostic(absPath, projectRoot);

    // ── 4. Release tsc mutex (so other agents can run tsc) ──
    releaseTscMutex(sessionID);

    // ── 5. Check target file for errors (zero-tolerance) ──
    if (result.errors && result.errors.length > 0) {
      // ⛔ Target file has TSC errors → BLOCK the write
      releaseFileLock(absPath, sessionID); // Release file lock before throwing

      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-CHECK-FAIL",
        error_count: result.errors.length,
        elapsed_ms: result.elapsed,
        detail: result.errors
          .slice(0, config.max_errors_shown)
          .map((e: any) => `L${e.line}: ${e.message} (TS${e.code})`)
          .join("; "),
      });

      // Update diagnostic_state before blocking
      updateDiagnosticState({ filePath: absPath, errors: result.errors, source: "before-write-gate", sessionID });

      // Determine if we should block
      const projectFrameworkDir = path.join(projectRoot, ".opencode");
      const isFrameworkFile = absPath.startsWith(
        projectFrameworkDir + path.sep,
      );
      // SA-EXCEPTION (2026-06-27): Bypass for Super-Admin framework repair
      const _saBypass =
        process.env.FRAMEWORK_AGENT === "Super-Admin" && isFrameworkFile;
      const shouldBlock =
        (mode !== "advisory" || isFrameworkFile) && !_saBypass;

      if (shouldBlock) {
        writeLog(PLUGIN_NAME, "ERROR", {
          sessionID,
          callID: input?.callID,
          event: "TSC-ERROR-BLOCK",
          detail: `${absPath} | ${result.errors.length} error(s) | zero-tolerance mode`,
        });
        throw new Error(
          `[FW-ENFORCE][TSC-ERROR-BLOCK] File "${absPath}" has ${result.errors.length} TSC error(s).\n` +
            `Fix ALL TypeScript errors before writing.\n` +
            `Errors:\n  ${result.errors
              .slice(0, config.max_errors_shown)
              .map((e: any) => `  L${e.line}: ${e.message} (TS${e.code})`)
              .join("\n")}`,
        );
      }
    } else {
      // ✅ Target file is clean
      const diagStatus = result.diagnostic_status || "clean";

      // P2-2 fix: handle unknown status explicitly (neither clean nor project_dirty)
      if (diagStatus === "unknown") {
        logTscGateEvent({
          session_id: sessionID,
          file_path: absPath,
          event_type: "TSC-CHECK-UNKNOWN",
          elapsed_ms: result.elapsed,
          detail: `tsc returned unknown status for ${absPath}`,
        });
        writeLog(PLUGIN_NAME, "WARN", {
          sessionID,
          callID: input?.callID,
          event: "TSC-CHECK-UNKNOWN",
          detail: `${absPath} | unknown tsc diagnostic status`,
        });
      } else {
        logTscGateEvent({
          session_id: sessionID,
          file_path: absPath,
          event_type: "TSC-CHECK-PASS",
          elapsed_ms: result.elapsed,
          detail: diagStatus,
        });
      }

      // Clear diagnostic_state for this file (if previously had errors)
      updateDiagnosticState({ filePath: absPath, errors: [], source: "before-write-gate", sessionID });

      // P1-1 fix: block_on_all_errors — if config says block on ALL errors
      // and the project has other TS errors, block even if target file is clean
      if (
        config.block_on_all_errors &&
        diagStatus === "target_clean_project_dirty"
      ) {
        releaseFileLock(absPath, sessionID);
        const blockMsg = `Project has unrepaired TS errors in other files (block_on_all_errors=true)`;
        logTscGateEvent({
          session_id: sessionID,
          file_path: absPath,
          event_type: "TSC-CHECK-FAIL",
          error_count: result.errors?.length || 0,
          elapsed_ms: result.elapsed,
          detail: blockMsg,
        });
        writeLog(PLUGIN_NAME, "ERROR", {
          sessionID,
          callID: input?.callID,
          event: "TSC-ERROR-BLOCK",
          detail: `${absPath} | block_on_all_errors | project has other TS errors`,
        });
        if (mode !== "advisory") {
          throw new Error(
            `[FW-ENFORCE][TSC-ERROR-BLOCK] File "${absPath}" is clean but ` +
              `the project has other TypeScript errors. ` +
              `Fix ALL project TS errors before writing (block_on_all_errors=true).`,
          );
        }
      }

      // Record project-dirty status (informational, non-blocking unless above)
      if (diagStatus === "target_clean_project_dirty") {
        writeLog(PLUGIN_NAME, "WARN", {
          sessionID,
          callID: input?.callID,
          event: "TSC-CHECK-PROJECT-DIRTY",
          detail: `${absPath} clean but project has other TS errors`,
        });
      }
    }
  }
}

// ── Layer 1.5: AFTER write — Run tsc, update diagnostic_state ──

async function afterWriteTscCheck(input: any, _output: any): Promise<void> {
  if (!isModifyTool(input?.tool)) return;

  const args = input?.args || {};
  const targets = getTypeScriptWriteTargets(input.tool, args);
  if (targets.length === 0) {
    // Fallback: direct file path for safe_edit/write/edit
    const directPath = getModifyPath(args);
    if (directPath && /\.(ts|tsx)$/.test(directPath)) {
      targets.push(directPath);
    } else {
      return;
    }
  }

  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const sessionID = input?.sessionID || input?.sessionId || "unknown";
  const config = getTscGateConfig();

  for (const filePath of targets) {
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectRoot, filePath);

    // ── 1. Acquire tsc mutex ──
    const startTime = Date.now();
    let mutexAcquired = acquireTscMutex(sessionID, config.lock_timeout_ms);
    if (!mutexAcquired) {
      writeLog(PLUGIN_NAME, "runtime", {
        sessionID,
        callID: input?.callID,
        event: "TSC-MUTEX-WAIT",
        detail: `Waiting for tsc mutex on ${absPath}`,
      });
      while (!mutexAcquired && Date.now() - startTime < config.timeout_ms) {
        await sleep(100);
        mutexAcquired = acquireTscMutex(sessionID, config.lock_timeout_ms);
      }
      if (!mutexAcquired) {
        writeLog(PLUGIN_NAME, "WARN", {
          sessionID,
          callID: input?.callID,
          event: "TSC-MUTEX-TIMEOUT",
          detail: `Could not acquire tsc mutex for after-write check on ${absPath}`,
        });
        continue;
      }
    }

    // ── 2. Run tsc ──
    logTscGateEvent({
      session_id: sessionID,
      file_path: absPath,
      event_type: "TSC-CHECK-START",
      detail: "after-write",
    });

    const result = runTscDiagnostic(absPath, projectRoot);

    // ── 3. Release tsc mutex ──
    releaseTscMutex(sessionID);

    // ── 4. Update diagnostic_state ──
    updateDiagnosticState({ filePath: absPath, errors: result.errors || [], source: "after-write-gate", sessionID });

    // ── 5. Log audit event ──
    if (result.errors && result.errors.length > 0) {
      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-CHECK-FAIL",
        error_count: result.errors.length,
        elapsed_ms: result.elapsed,
        detail: result.errors
          .slice(0, config.max_errors_shown)
          .map((e: any) => `L${e.line}: ${e.message} (TS${e.code})`)
          .join("; "),
      });
      writeLog(PLUGIN_NAME, "ERROR", {
        sessionID,
        callID: input?.callID,
        event: "TSC-CHECK-FAIL",
        detail:
          `${absPath} | ${result.errors.length} error(s) | ` +
          result.errors
            .slice(0, 3)
            .map((e: any) => e.message)
            .join("; "),
      });
    } else {
      const diagStatus = result.diagnostic_status || "clean";

      // P2-2 fix: handle unknown status explicitly
      if (diagStatus === "unknown") {
        logTscGateEvent({
          session_id: sessionID,
          file_path: absPath,
          event_type: "TSC-CHECK-UNKNOWN",
          elapsed_ms: result.elapsed,
          detail: `tsc returned unknown status for ${absPath}`,
        });
        writeLog(PLUGIN_NAME, "WARN", {
          sessionID,
          callID: input?.callID,
          event: "TSC-CHECK-UNKNOWN",
          detail: `${absPath} | unknown tsc diagnostic status`,
        });
      } else {
        logTscGateEvent({
          session_id: sessionID,
          file_path: absPath,
          event_type: "TSC-CHECK-PASS",
          elapsed_ms: result.elapsed,
          detail: diagStatus,
        });
      }
      if (diagStatus === "target_clean_project_dirty") {
        writeLog(PLUGIN_NAME, "WARN", {
          sessionID,
          callID: input?.callID,
          event: "TSC-CHECK-PROJECT-DIRTY",
          detail: `${absPath} clean but project has other TS errors`,
        });
      }
    }

    // ── 6. Release file lock (acquired in beforeWriteBlock) ──
    releaseFileLock(absPath, sessionID);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
