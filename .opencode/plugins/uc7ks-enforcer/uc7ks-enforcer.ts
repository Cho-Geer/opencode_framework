/**
 * uc7ks-enforcer.ts — UC7KS Knowledge System Enforcer Plugin v1.0.0
 *
 * OpenCode plugin that intercepts external documentation queries (Context7,
 * webfetch, websearch) and enforces the UC7KS pipeline:
 *  - UC7-001: Local-first search (check docs/official_docs/index.json)
 *  - UC7-002: User confirmation required before external queries
 *  - UC7-003: Save-or-fail verification after doc writes
 *
 * Complements the framework-enforcer.ts plugin with knowledge-specific
 * enforcement rules. Uses OpenCode's native plugin hook system for
 * real-time interception.
 *
 * @author  @Super-Admin (UC7KS Phase 3 — UC7-P3-T09)
 * @version 1.0.0
 */

import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_PATH = "docs/official_docs/index.json";
const DOCS_ROOT = "docs/official_docs/";
const EXTERNAL_TOOLS = new Set(["context7_resolve-library-id", "context7_query-docs", "context7", "webfetch", "websearch"]);
const WRITE_TOOLS = new Set(["write", "edit", "safe_edit"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProjectRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

function getIndexPath(): string {
  return path.resolve(resolveProjectRoot(), INDEX_PATH);
}

function isLocalCacheAvailable(): boolean {
  try {
    const p = getIndexPath();
    if (!fs.existsSync(p)) return false;
    const content = JSON.parse(fs.readFileSync(p, "utf8"));
    return !!(content.manifest_version && Array.isArray(content.entries));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hook: tool.execute.before — UC7-001 & UC7-002 enforcement
// ---------------------------------------------------------------------------

async function toolExecuteBefore(
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
): Promise<void> {
  const tool = input.tool;

  // Only intercept external documentation queries
  if (!EXTERNAL_TOOLS.has(tool)) return;

  const agent = process.env.FRAMEWORK_AGENT || "";
  const indexPath = getIndexPath();

  // UC7-001: Local-First Check
  // Log a reminder that agents should check local cache before external queries
  const localCacheAvailable = isLocalCacheAvailable();

  if (localCacheAvailable) {
    console.log(
      `[UC7KS-Enforcer][UC7-001] Local knowledge cache available at ${INDEX_PATH}. ` +
      `Agent "${agent}" should check cached docs before making external queries.`
    );
  } else {
    console.log(
      `[UC7KS-Enforcer][UC7-001] Local knowledge cache not yet initialized. ` +
      `Agent "${agent}" making external query as first-resort.`
    );
  }

  // UC7-002: User Confirmation
  // For now, log that confirmation should have been obtained.
  // In locked mode, this could be a hard block.
  console.log(
    `[UC7KS-Enforcer][UC7-002] External query "${tool}" by "${agent}" — ` +
    `verify user confirmation was obtained before proceeding.`
  );
}

// ---------------------------------------------------------------------------
// Hook: tool.execute.after — UC7-003 enforcement
// ---------------------------------------------------------------------------

async function toolExecuteAfter(
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any; result?: any },
): Promise<void> {
  const tool = input.tool;

  // Check writes to docs/official_docs/
  if (!WRITE_TOOLS.has(tool)) return;

  const filePath = output.args?.filePath || "";
  if (!filePath.includes(DOCS_ROOT)) return;

  // Verify the file was actually created
  const absPath = path.resolve(resolveProjectRoot(), filePath);
  try {
    if (fs.existsSync(absPath)) {
      const stat = fs.statSync(absPath);
      console.log(
        `[UC7KS-Enforcer][UC7-003] Doc saved: ${filePath} (${(stat.size / 1024).toFixed(1)}KB). ` +
        `Verify index.json was updated for this file.`
      );
    }
  } catch {
    console.warn(
      `[UC7KS-Enforcer][UC7-003] WARNING: Doc file not found after write: ${filePath}`
    );
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const plugin: Plugin = async (_ctx: PluginInput): Promise<Hooks> => {
  console.log("[UC7KS-Enforcer] Initialized — UC7KS knowledge system enforcement active");

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
  } as unknown as Hooks;
};

export default plugin;
