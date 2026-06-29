#!/usr/bin/env bun
"use strict";

// dispatch-subagent.ts — CLI thin shell for dispatch prompt generation
// ═══════════════════════════════════════════════════════════════
// Phase 4B: Business logic extracted to service/dispatch/prompt-builder.ts
// This file handles CLI arg parsing, output file writing, and queue management.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { checklistWirePassed } from "../../service/gate/checklist-hooks";
import { buildDispatchPrompt } from "../../service/dispatch/prompt-builder";

const OPENCODE_ROOT = process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", "..", "..");
const OUTPUT_DIR = path.join(OPENCODE_ROOT, ".task_temp", "_dispatch");
const PENDING_FILE = path.join(OUTPUT_DIR, ".pending.json");

// ── CLI argument parsing ──
let sessionNamespace = process.env.DISPATCH_NAMESPACE || null;
let dagTaskId = process.env.DISPATCH_DAG_TASK_ID || null;
let taskId: string | null = null;

// Detect 2+ positional params: <agent_type> "<session_namespace>" "<task_description>"
if (process.argv.length >= 5 && !process.argv[3].startsWith("--")) {
  taskId = process.argv[3];
  if (!sessionNamespace) sessionNamespace = taskId;
  process.argv.splice(3, 1);
}

// Fall back to --task-id CLI flag
if (!taskId) {
  const idx = process.argv.indexOf("--task-id");
  if (idx !== -1 && idx + 1 < process.argv.length) {
    taskId = process.argv[idx + 1];
    if (!sessionNamespace) sessionNamespace = taskId;
    process.argv.splice(idx, 2);
  }
}

if (!dagTaskId) dagTaskId = sessionNamespace || taskId;
if (!sessionNamespace) sessionNamespace = dagTaskId || taskId;
if (!taskId) taskId = sessionNamespace;

const agentType = process.argv[2];
const taskDescription = process.env.DISPATCH_TASK_DESC || process.argv[3] || "";

if (!agentType || !taskDescription) {
  console.error('Usage: bun dispatch-subagent.ts <agent_type> "<task_description>" [--task-id <id>]');
  process.exit(1);
}

// ── Build prompt via service layer ──
let result;
try {
  result = buildDispatchPrompt({
    agentType,
    taskDescription,
    taskId,
    dagTaskId,
    openCodeRoot: OPENCODE_ROOT,
  });
} catch (e: any) {
  writeLog("dispatch-subagent", "ERROR", { event: "PROMPT_BUILD_FAILED", detail: e.message });
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}

// ── Write output file ──
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputFile = path.join(OUTPUT_DIR, `dispatch-${agentType}-${timestamp}.md`);
fs.writeFileSync(outputFile, result.prompt, "utf8");

// ── Checklist wiring ──
const sessionId = process.env.OPENCODE_SESSION_ID || "";
try {
  checklistWirePassed(sessionId, agentType, taskId, "payload_complete", "prompt saved to " + outputFile);
  checklistWirePassed(sessionId, agentType, taskId, "dispatch_token_created", "token=" + result.dispatchToken.substring(0, 16));
  checklistWirePassed(sessionId, agentType, taskId, "session_context_bound", "child slot bound to " + (taskId || "none"));
} catch (e: any) {
  writeLog("dispatch-subagent", "WARN", { event: "CHECKLIST_WIRE_FAILED", detail: e.message });
}

// ── .pending.json queue management ──
let queue: any[] = [];
try {
  if (fs.existsSync(PENDING_FILE)) {
    queue = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
    if (!Array.isArray(queue)) queue = [];
  }
} catch { queue = []; }

// Dedup by agentType + dagTaskId
queue = queue.filter((e) => !(e.agentType === agentType && e.taskId === dagTaskId));
queue.push({
  dispatchId: outputFile,
  promptHash: result.promptHash,
  filePath: outputFile,
  createdAt: new Date().toISOString(),
  agentType,
  taskId: dagTaskId || null,
});

try {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(queue, null, 2), "utf8");
} catch (e: any) {
  writeLog("dispatch-subagent", "ERROR", { event: "PENDING_WRITE_FAILED", detail: e.message });
  console.error("FATAL: Cannot write .pending.json");
  process.exit(1);
}

// ── DB enqueue (non-fatal) ──
try {
  const { dbEnqueueDispatch } = require("../../lib/dispatch-db");
  dbEnqueueDispatch(agentType, taskId || "(no-task-id)", outputFile, result.promptHash, Buffer.byteLength(result.prompt, "utf8"));
} catch { /* DB unavailable, file-based fallback intact */ }

// ── Output file path to stdout ──
console.log(outputFile);
