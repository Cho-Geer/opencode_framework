/**
 * .opencode/lib/index.ts — Core Library Barrel Export
 * ====================================================
 *
 * Single source of truth for shared framework logic.
 * All tools/ and plugins/ files import from here instead
 * of duplicating logic.
 *
 * Exports:
 *   - safe-edit-core: validateEdit, generateDiff, writeSafe
 *   - safe-bash-core: ALLOWED_COMMANDS, isAllowed, isDangerous, getAllowlist
 *   - safe-test-core: validateTestReport, SafeTestResult, SafeTestPhase
 *   - permission-isolation-core: PermissionIsolation, PermissionResult, ScopeResult
 *
 * @author @Architect
 * @version 1.0.0
 */

export * from './safe-edit-core';
export * from './safe-bash-core';
export * from './safe-test-core';
export * from './permission-isolation-core';

// gate-core is exported separately since it has dependencies
// on the compliance gate MCP tool infrastructure

// Explicit re-exports for safeBash public API
export {
  safeBashTool,
  ALLOWED_SCRIPT_PATHS,
  WRITE_PATTERNS,
} from './safe-bash-core';

// FW-INTERRUPT-GUARD (2026-06-14): Cooperative interrupt trap.
// Prevents the upstream TUI from rendering raw "Unexpected {interrupt}"
// template text when local tools are cancelled mid-flight.
export {
  withInterruptGuard,
  installSigintCleanup,
  isInterruptError,
} from './interrupt-guard';
export type { InterruptTrapPayload } from './interrupt-guard';
