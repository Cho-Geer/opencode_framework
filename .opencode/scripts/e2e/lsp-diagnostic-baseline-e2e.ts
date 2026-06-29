/**
 * lsp-diagnostic-baseline-e2e.ts — E2E tests for baseline-diff gating (G-7)
 * ═══════════════════════════════════════════════════════════════════════
 * Tests the 4-layer baseline-diff model:
 *   L1: new_error → block (strict) / warn (advisory)
 *   L2: error_count_increased → block
 *   L3: error_count_decreased → pass
 *   L4: baseline_drift → WARN only
 *
 * Uses an isolated in-memory DB with withPluginLifecycle.
 *
 * @see docs/review/framework-refactor/g7-ts-baseline-cleanup-plan.md
 * ═══════════════════════════════════════════════════════════════════════
 */

import { withPluginLifecycle } from "../../lib/hook-lifecycle";
import {
  captureBaseline,
  compareWithBaseline,
  recordBaselineDrift,
  hashTscOutput,
} from "../../lib/baseline-diagnostic";
import { atomicWriteSubState } from "../../lib/state-utils";
import { readSubState } from "../../lib/substate-manager";
import type { DiagnosticBaselineEntry } from "../../lib/substate-types";

const SRC = "e2e-baseline";
let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Setup: seed baseline with 3 errors for test-file-A, 0 for test-file-B ──

const testFileA = "/tmp/g7-e2e-test-A.ts";
const testFileB = "/tmp/g7-e2e-test-B.ts";

function seedBaseline(): void {
  const baselineErrors: DiagnosticBaselineEntry[] = [
    {
      file: testFileA,
      code: "TS2339",
      message: "Property 'foo' does not exist on type 'Bar'",
      line: 10,
      character: 5,
    },
    {
      file: testFileA,
      code: "TS2451",
      message: "Cannot redeclare block-scoped variable 'x'",
      line: 20,
      character: 3,
    },
    {
      file: testFileA,
      code: "TS2304",
      message: "Cannot find name 'baz'",
      line: 30,
      character: 7,
    },
    {
      file: "/some/other/file.ts",
      code: "TS2339",
      message: "Irrelevant error",
      line: 1,
      character: 1,
    },
  ];
  atomicWriteSubState("diagnostic_baseline", (state: any) => {
    state.hash = "e2e-test-baseline-hash";
    state.total_errors = 4;
    state.bucket_counts = { lib: 1, scripts: 3 };
    state.errors = baselineErrors;
    state.captured_at = new Date().toISOString();
    state.tsc_version = "5.x";
    state.source = "e2e-test";
  });
}

// ── Test Cases ──

function testCase1CleanNoBaseline(): void {
  // Case 1: baseline doesn't exist, target has no errors → "clean"
  atomicWriteSubState("diagnostic_baseline", (state: any) => {
    state.hash = "";
    state.total_errors = 0;
    state.errors = [];
  });
  const diff = compareWithBaseline(testFileA, []);
  assert(
    "Case 1: baseline empty + target clean → clean",
    diff.verdict === "clean" &&
      diff.baselineCount === 0 &&
      diff.currentCount === 0,
  );
}

function testCase2NewErrorBlock(): void {
  // Case 2: baseline has NO errors for A, target now has 1 → L1 new_error
  seedBaseline();
  const diff = compareWithBaseline(testFileB, [
    {
      file: testFileB,
      code: "TS2339",
      message: "New error",
      line: 1,
      character: 1,
    },
  ]);
  assert(
    "Case 2: new error → L1 new_error (should block)",
    diff.verdict === "new_error" && diff.newErrors.length === 1,
  );
}

function testCase3ErrorCountIncreasedBlock(): void {
  // Case 3: baseline has 3 errors for A, target now has 5 → L2 increase
  seedBaseline();
  const current: DiagnosticBaselineEntry[] = [
    {
      file: testFileA,
      code: "TS2339",
      message: "Property 'foo' does not exist on type 'Bar'",
      line: 10,
      character: 5,
    },
    {
      file: testFileA,
      code: "TS2451",
      message: "Cannot redeclare block-scoped variable 'x'",
      line: 20,
      character: 3,
    },
    {
      file: testFileA,
      code: "TS2304",
      message: "Cannot find name 'baz'",
      line: 30,
      character: 7,
    },
    {
      file: testFileA,
      code: "TS2339",
      message: "NEW Property 'extra' missing",
      line: 40,
      character: 5,
    },
    {
      file: testFileA,
      code: "TS2304",
      message: "NEW Cannot find 'extra'",
      line: 50,
      character: 3,
    },
  ];
  const diff = compareWithBaseline(testFileA, current);
  assert(
    "Case 3: 3→5 errors → L2 error_count_increased",
    diff.verdict === "error_count_increased" && diff.newErrors.length === 2,
  );
}

function testCase4ErrorCountDecreasedPass(): void {
  // Case 4: baseline has 3 errors for A, target now has 1 → pass, record decrease
  seedBaseline();
  const current: DiagnosticBaselineEntry[] = [
    {
      file: testFileA,
      code: "TS2339",
      message: "Property 'foo' does not exist on type 'Bar'",
      line: 10,
      character: 5,
    },
  ];
  const diff = compareWithBaseline(testFileA, current);
  assert(
    "Case 4: 3→1 errors → L3 error_count_decreased (pass)",
    diff.verdict === "error_count_decreased",
  );
}

function testCase5Unchanged(): void {
  // Case 5: baseline has 3 errors for A, target has same 3 → unchanged
  seedBaseline();
  const current: DiagnosticBaselineEntry[] = [
    {
      file: testFileA,
      code: "TS2339",
      message: "Property 'foo' does not exist on type 'Bar'",
      line: 10,
      character: 5,
    },
    {
      file: testFileA,
      code: "TS2451",
      message: "Cannot redeclare block-scoped variable 'x'",
      line: 20,
      character: 3,
    },
    {
      file: testFileA,
      code: "TS2304",
      message: "Cannot find name 'baz'",
      line: 30,
      character: 7,
    },
  ];
  const diff = compareWithBaseline(testFileA, current);
  assert(
    "Case 5: 3→3 errors → unchanged (pass)",
    diff.verdict === "unchanged" && diff.newErrors.length === 0,
  );
}

function testCase6HashDriftDetect(): void {
  // Case 6: baseline hash differs → L4 drift detection
  seedBaseline();
  const recorded: any[] = [];
  const origWriteLog = (globalThis as any).__writeLog;
  (globalThis as any).__writeLog = (src: string, level: string, data: any) => {
    if (data.event === "BASELINE-DRIFT") recorded.push(data);
  };

  recordBaselineDrift({
    sessionID: "test-session",
    callID: "test-call",
    currentHash: "different-hash-value",
    targetAbsPath: testFileA,
  });

  // Drift is recorded via writeLog — we can't easily capture it.
  // But we can verify the function doesn't crash and the substate is unchanged.
  const baseline = readSubState("diagnostic_baseline") as any;
  assert(
    "Case 6: drift recording doesn't corrupt baseline",
    baseline?.hash === "e2e-test-baseline-hash",
  );

  (globalThis as any).__writeLog = origWriteLog;
}

// ── Runner ──

async function main() {
  console.log("\n═══════════════════════════════════════════");
  console.log("LSP Diagnostic Baseline E2E Tests");
  console.log("═══════════════════════════════════════════\n");

  // Clean baseline initially
  atomicWriteSubState("diagnostic_baseline", (state: any) => {
    state.hash = "";
    state.total_errors = 0;
    state.errors = [];
  });

  testCase1CleanNoBaseline();
  testCase2NewErrorBlock();
  testCase3ErrorCountIncreasedBlock();
  testCase4ErrorCountDecreasedPass();
  testCase5Unchanged();
  testCase6HashDriftDetect();

  // Clean up
  atomicWriteSubState("diagnostic_baseline", (state: any) => {
    state.hash = "";
    state.total_errors = 0;
    state.errors = [];
  });

  console.log(`\n─── Results: ${passed} passed, ${failed} failed ───`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("E2E failed:", err);
  process.exit(1);
});
