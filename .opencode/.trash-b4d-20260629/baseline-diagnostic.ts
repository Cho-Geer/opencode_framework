/**
 * baseline-diagnostic.ts — MCP tool for capturing TS diagnostic baseline
 * ═══════════════════════════════════════════════════════════════════════
 * Part of G-7 TypeScript baseline cleanup (2026-06-27).
 * Provides framework_capture_diagnostic_baseline MCP tool.
 *
 * @see docs/review/framework-refactor/g7-ts-baseline-cleanup-plan.md
 * ═══════════════════════════════════════════════════════════════════════
 */

import { captureBaseline } from "../../lib/baseline-diagnostic";

export const tool = {
  name: "framework_capture_diagnostic_baseline",
  description:
    "Capture the current `npx tsc --noEmit` error set as the project baseline. " +
    "Stored in SQLite substate_kv as `diagnostic_baseline`. Used by the LSP " +
    "diagnostic gate to differentiate NEW errors from pre-existing baseline.",
  parameters: {
    task_id: { type: "string", description: "DAG task id driving the refresh" },
    reason: {
      type: "string",
      description:
        "Why: phase-A-complete / manual / drift-recovery / initial-capture",
    },
    mode: {
      type: "string",
      enum: ["manual", "auto_refresh"],
      default: "manual",
    },
  },
};

export async function handler(args: any, _ctx: any) {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const ok = captureBaseline({
    projectRoot,
    source: args.mode || "manual",
    taskId: args.task_id,
  });
  return ok
    ? { status: "ok", reason: args.reason, task_id: args.task_id }
    : { status: "failed", reason: "atomicWriteSubState returned false" };
}
