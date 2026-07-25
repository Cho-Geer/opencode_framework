#!/usr/bin/env bun
"use strict";

/**
 * code-quality-lib.ts — Bridge (B-4C, ESM)
 * =====================================
 * Thin re-export bridge. All business logic moved to service/file-guard/:
 *   - quality-checks.ts  (individual checks)
 *   - quality-batch.ts   (runAllChecks, runFullScan)
 *   - tsc-diagnostic.ts  (runTscDiagnostic, parseTscOutput)
 *
 * Converted from CJS to ESM to fix TypeScript global scope conflicts.
 */

import {
  matchGlob,
  firstPathSegment,
  runScopeCheck,
  runPrettierCheck,
  runDepCruiserCheck,
  runEslintAudit,
  runTddOrderCheck,
  runTddSpecCheck,
} from "../../service/file-guard/quality-checks";

import {
  runAllChecks,
  runFullScan,
} from "../../service/file-guard/quality-batch";

import {
  runTscDiagnostic,
} from "../../service/file-guard/tsc-diagnostic";

// Re-export all for backward compatibility
export {
  matchGlob,
  firstPathSegment,
  runScopeCheck,
  runPrettierCheck,
  runDepCruiserCheck,
  runEslintAudit,
  runTddOrderCheck,
  runTddSpecCheck,
  runAllChecks,
  runFullScan,
  runTscDiagnostic,
};

/** @deprecated runTscCheck removed — tsc handled by tsc-diag-track plugin */
export const runTscCheck = undefined;
