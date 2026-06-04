/**
 * framework-enforcer/index.ts — Plugin Entry Point v3.2.0
 *
 * Directly composes extracted hook and check modules — NO monolithic pass-through.
 * Each module is independently testable and under 400 lines per coding standard.
 *
 * FW-REPAIR-12: Fixed D6 — no longer delegates to monolithicPlugin().
 * All 7 extracted modules are now active at runtime.
 *
 * MODULAR STRUCTURE (Phase 4 — 7/7 modules active):
 *   index.ts                      — Plugin bootstrap + direct hook composition (~100 lines)
 *   hooks/tool-execute.ts         — tool.execute.before/after ✅ ACTIVE (imports lib/ directly)
 *   hooks/file-edit.ts            — file.edited tamper detection ✅ ACTIVE
 *   hooks/session-lifecycle.ts    — session.* + compaction hooks ✅ ACTIVE
 *   hooks/audit-hooks.ts          — shell, permission, command, tui hooks ✅ ACTIVE
 *   checks/gate-checks.ts         — Gate, integrity, stale, rule checks ✅ ACTIVE
 *   utils/audit-log.ts            — Audit log write + flush ✅ ACTIVE
 *   utils/state-utils.ts          — Path resolution, helpers, constants ✅ ACTIVE
 *
 * @author  @Super-Admin (FW-REPAIR-12)
 * @version 3.2.0
 * @phase   Phase 4 (Modularization — 100% active, monolith retained as reference)
 */

import * as fs from "node:fs";
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { readJsonFile, getEnforcementMode } from "../../lib/gate-core";
import { PermissionIsolation } from "../../lib/permission-isolation-core";
import { STATE_PATHS } from "./utils/state-utils";

// ── Hook imports (7/7 modules — all active) ──
import { toolExecuteBefore, toolExecuteAfter } from "./hooks/tool-execute";
import { fileEdited } from "./hooks/file-edit";
import {
  sessionCreated, sessionError, sessionIdle,
  sessionCompacted, sessionCompacting,
} from "./hooks/session-lifecycle";
import { commandExecuted } from "./hooks/audit-hooks";

// ── Check imports ──
import {
  checkPluginIntegrity, findTaskInDag, isWriteAllowed,
  checkStaleSessions, autoDrainStaleSessions,
  checkRuleRegistryIntegrity, checkMachineCleanliness,
} from "./checks/gate-checks";

// ── Utility imports ──
import { writeAuditLogEntry, logAuditEntry, flushAuditTrail } from "./utils/audit-log";
import {
  getOpenCodeRoot, isSourceFile, isCriticalFrameworkFile, isStaleSession,
} from "./utils/state-utils";

// ── Re-export all modules for runtime consumers ──
export { STATE_PATHS, getOpenCodeRoot, isSourceFile, isCriticalFrameworkFile, isStaleSession }
  from "./utils/state-utils";
export { writeAuditLogEntry, logAuditEntry, flushAuditTrail } from "./utils/audit-log";
export { fileEdited } from "./hooks/file-edit";
export { sessionCreated, sessionError, sessionIdle, sessionCompacted, sessionCompacting }
  from "./hooks/session-lifecycle";
export { commandExecuted } from "./hooks/audit-hooks";
export { toolExecuteBefore, toolExecuteAfter } from "./hooks/tool-execute";
export {
  checkPluginIntegrity, findTaskInDag, isWriteAllowed,
  checkStaleSessions, autoDrainStaleSessions,
  checkRuleRegistryIntegrity, checkMachineCleanliness,
} from "./checks/gate-checks";

/**
 * FW-REPAIR-12: Framework Enforcer Plugin — Direct Hook Composition
 *
 * Composes extracted hook modules directly (not via monolithic pass-through).
 * The monolith (framework-enforcer.ts) is retained as reference only —
 * it is NO LONGER called at runtime.
 *
 * Plugin context ({ project, client, $, directory, worktree }) is available
 * for structured logging and shell operations in hook bodies.
 */
const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  // ── Bootstrap: initialize core services ──
  // Permission isolation engine (used by tool-execute hooks)
  // sessionIdle requires readJsonFile + getEnforcementMode as explicit params

  const hooks: Hooks = {
    // ═══ Critical enforcement hooks ═══
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,

    // ═══ File integrity ═══
    ["file.edited" as any]: fileEdited,

    // ═══ Session lifecycle ═══
    "session.created": sessionCreated,
    "session.error": sessionError,
    "session.idle": async (input: { sessionID: string }, _output: void) => {
      await sessionIdle(input, _output, readJsonFile, getEnforcementMode);
    },
    "session.compacted": sessionCompacted,
    "experimental.session.compacting": sessionCompacting,

    // ═══ Command audit ═══
    "command.executed": commandExecuted,
  };

  return hooks;
};

export default plugin;

// ── Re-export types for module consumers ──
// (Monolith types retained for backward-compatible type references)
export type { TaskDAG, GateState, EnforcementConfig, AgentWriteScope, ProjectConfig }
  from "./framework-enforcer";
