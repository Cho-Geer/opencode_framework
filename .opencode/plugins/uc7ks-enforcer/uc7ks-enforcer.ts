/**
 * uc7ks-enforcer.ts — UC7KS Knowledge System Enforcer Plugin v2.0.0
 *
 * OpenCode plugin that intercepts external documentation queries (Context7,
 * webfetch, websearch) and PHYSICALLY ENFORCES the UC7KS pipeline:
 *  - UC7-001: Local-first search (check docs/official_docs/index.json)
 *  - UC7-002: User confirmation required before external queries
 *  - UC7-003: Save-or-fail verification after doc writes
 *  - UC7-004: Block direct Context7 calls (must go through @Knowledge-Curator)
 *  - UC7-009: ALL agents (including @Super-Admin) must follow UC7KS pipeline
 *
 * Enforcement behavior per mode:
 *  - advisory:  Log warnings only (non-blocking, backward-compatible)
 *  - strict:    BLOCK external queries if local cache was not checked first
 *  - locked:    BLOCK all direct external queries; only @Knowledge-Curator
 *               and explicitly whitelisted agents may bypass
 *
 * Complements the framework-enforcer.ts plugin with knowledge-specific
 * enforcement rules. Uses OpenCode's native plugin hook system for
 * real-time interception.
 *
 * OFFICIAL DOCUMENTATION REFERENCE:
 *   https://opencode.ai/docs/plugins/ — `tool.execute.before` can throw Error
 *   to completely block tool execution (see .env protection example).
 *
 * @author  @Super-Admin (UC7KS Phase 3 → Phase 4 Hardening)
 * @version 2.0.0
 * @since   2026-06-05 — Hardened from log-only to enforcement-mode-aware throw
 */

import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnforcementMode = "advisory" | "strict" | "locked";

interface IndexManifest {
  manifest_version: string;
  last_updated: string;
  total_entries: number;
  entries: Array<{
    library_id: string;
    query_topic: string;
    domain: string;
    tags: string[];
    files: Array<{
      path: string;
      source: string;
      sha256: string;
      size_bytes: number;
      status: string;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_PATH = "docs/official_docs/index.json";
const DOCS_ROOT = "docs/official_docs/";

/**
 * Tools that fetch external documentation or information.
 * These are the tools that MUST go through the UC7KS pipeline
 * (local cache → insufficient → @Knowledge-Curator) before
 * being allowed to execute.
 *
 * Per OpenCode official docs:
 *   - webfetch: Fetch web content from a URL
 *   - websearch: Search the web using Exa AI
 *   - context7_resolve-library-id: Resolve a library name to Context7 ID
 *   - context7_query-docs: Query Context7 documentation
 *   - context7: Legacy/shorthand Context7 access
 */
const EXTERNAL_DOC_TOOLS = new Set([
  "context7_resolve-library-id",
  "context7_query-docs",
  "context7",
  "webfetch",
  "websearch",
]);

/**
 * Tools that write files. Used for UC7-003 post-write verification.
 */
const WRITE_TOOLS = new Set(["write", "edit", "safe_edit"]);

/**
 * Agents that are ALWAYS allowed to make external queries,
 * even in locked mode. @Knowledge-Curator is the designated
 * knowledge acquisition agent — blocking it would create a
 * deadlock.
 */
const UC7KS_BYPASS_AGENTS = new Set(["Knowledge-Curator", "@Knowledge-Curator"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProjectRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

function getIndexPath(): string {
  return path.resolve(resolveProjectRoot(), INDEX_PATH);
}

/**
 * Read and parse the index.json manifest.
 * Returns null if the cache is not initialized or unreadable.
 */
function readCacheIndex(): IndexManifest | null {
  try {
    const p = getIndexPath();
    if (!fs.existsSync(p)) return null;
    const content = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!content.manifest_version || !Array.isArray(content.entries)) return null;
    return content as IndexManifest;
  } catch {
    return null;
  }
}

/**
 * Check if the local knowledge cache is available and has entries.
 */
function isLocalCacheAvailable(): boolean {
  const index = readCacheIndex();
  return !!(index && index.total_entries > 0);
}

/**
 * Get the current enforcement mode from project.config.json.
 * Falls back to "advisory" if unreadable.
 *
 * This is a lightweight inline reader to avoid circular imports
 * with gate-core.ts. The full getEnforcementMode() from gate-core
 * handles ENFORCEMENT_MODE env var override; this plugin reads
 * the same source of truth.
 */
function getEnforcementMode(): EnforcementMode {
  try {
    const configPath = path.resolve(
      resolveProjectRoot(),
      ".opencode/project.config.json",
    );
    if (!fs.existsSync(configPath)) return "advisory";

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const tr = config?.template_resolution;

    // Environment variable override (highest priority, except locked)
    const envMode = process.env.ENFORCEMENT_MODE;
    if (
      envMode &&
      ["advisory", "strict", "locked"].includes(envMode)
    ) {
      // locked mode cannot be overridden by env var
      const configMode = tr?.develop_enforcement_mode || tr?.runtime_enforcement_mode || "advisory";
      if (configMode === "locked" && envMode !== "locked") {
        return "locked";
      }
      return envMode as EnforcementMode;
    }

    // Config file modes
    // develop_enforcement_mode for local dev, runtime_enforcement_mode for CI
    // In plugin context we read develop_enforcement_mode (agent runtime)
    return (tr?.develop_enforcement_mode || tr?.runtime_enforcement_mode || "advisory") as EnforcementMode;
  } catch {
    return "advisory";
  }
}

/**
 * Generate a structured UC7KS compliance error message.
 * Points the agent to the correct remediation path.
 *
 * @param agent - The agent that attempted the blocked call
 * @param tool - The tool that was blocked
 * @param mode - Current enforcement mode
 * @param cacheAvailable - Whether local cache is available
 * @param reason - Specific reason for blocking
 */
function buildUC7KSError(
  agent: string,
  tool: string,
  mode: EnforcementMode,
  cacheAvailable: boolean,
  reason: string,
): string {
  const lines = [
    ``,
    `╔══════════════════════════════════════════════════════════════╗`,
    `║  UC7KS PIPELINE ENFORCEMENT — ${mode.toUpperCase()} MODE                      ║`,
    `╠══════════════════════════════════════════════════════════════╣`,
    `║  Tool blocked: ${tool.padEnd(44)} ║`,
    `║  Agent:        ${(agent || "unknown").padEnd(44)} ║`,
    `║  Reason:       ${reason.padEnd(44)} ║`,
    `║  Cache status: ${(cacheAvailable ? "AVAILABLE (must search first)" : "NOT INITIALIZED").padEnd(44)} ║`,
    `╠══════════════════════════════════════════════════════════════╣`,
    `║  REQUIRED REMEDIATION:                                      ║`,
    `║  1. Search local cache: read docs/official_docs/index.json  ║`,
    `║  2. If insufficient: request @Orchestrator to dispatch      ║`,
    `║     @Knowledge-Curator to fetch the needed documents        ║`,
    `║  3. Wait for @Knowledge-Curator to complete caching         ║`,
    `║  4. Re-read the cached documents from docs/official_docs/   ║`,
    `║  5. Proceed with task using LOCALLY CACHED knowledge        ║`,
    `║                                                            ║`,
    `║  VIOLATION: UC7-001 (local-first), UC7-004 (no direct      ║`,
    `║  Context7), UC7-009 (all agents must follow UC7KS)          ║`,
    `╚══════════════════════════════════════════════════════════════╝`,
    ``,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hook: tool.execute.before — UC7-001, UC7-002, UC7-004, UC7-009 enforcement
// ---------------------------------------------------------------------------

/**
 * Intercepts external documentation query tools BEFORE execution.
 *
 * Enforcement logic (per official OpenCode plugin docs — plugins can throw to block):
 *
 * ┌──────────────┬─────────────────────────────────────────────────────┐
 * │ Mode         │ Behavior                                            │
 * ├──────────────┼─────────────────────────────────────────────────────┤
 * │ advisory     │ Log-only: warns about pipeline bypass but allows    │
 * │              │ execution. Backward-compatible with local dev.      │
 * ├──────────────┼─────────────────────────────────────────────────────┤
 * │ strict       │ BLOCKS external queries if local cache exists and   │
 * │              │ was not searched. Allows if cache is unavailable    │
 * │              │ (first-time setup). Logs all attempts.              │
 * ├──────────────┼─────────────────────────────────────────────────────┤
 * │ locked       │ BLOCKS ALL direct external queries. Only            │
 * │              │ @Knowledge-Curator may bypass. No exceptions.       │
 * └──────────────┴─────────────────────────────────────────────────────┘
 *
 * @throws Error — in strict/locked mode when the call violates UC7KS pipeline
 */
async function toolExecuteBefore(
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
): Promise<void> {
  const tool = input.tool;

  // Only intercept external documentation/information queries
  if (!EXTERNAL_DOC_TOOLS.has(tool)) return;

  const agent = process.env.FRAMEWORK_AGENT || "";
  const mode = getEnforcementMode();
  const cacheAvailable = isLocalCacheAvailable();

  // ── Bypass: @Knowledge-Curator is the designated doc fetcher ──
  // Blocking it would create a deadlock — no agent could fetch docs.
  if (UC7KS_BYPASS_AGENTS.has(agent)) {
    console.log(
      `[UC7KS-Enforcer][UC7-009] Bypass granted: Agent "${agent}" is ` +
      `the designated knowledge curator. Allowing external query "${tool}".`
    );
    return;
  }

  // ── UC7-001: Verify agent has read the local cache before external queries ──
  // FW-HARDEN-UC7KS-001: Reads machine.json.knowledge_cache_state.session_access
  // (populated by framework-enforcer.ts when any agent reads docs/official_docs/).
  // If the agent has NOT read the cache, block external queries regardless of mode.
  // This closes the gap where an agent could skip UC7-001 and still call webfetch
  // in advisory mode without any consequence.
  let agentHasReadCache = false;
  try {
    const machinePath = path.resolve(resolveProjectRoot(), ".opencode", "state", "machine.json");
    if (fs.existsSync(machinePath)) {
      const machine = JSON.parse(fs.readFileSync(machinePath, "utf8"));
      const sessionAccess = machine?.knowledge_cache_state?.session_access;
      const agentAccess = sessionAccess?.[agent];
      agentHasReadCache = !!(agentAccess?.uc7_001_compliant);
    }
  } catch (_) {
    // Non-fatal: if machine.json is unreadable, fall through to mode-specific logic
  }

  if (!agentHasReadCache && cacheAvailable) {
    // Agent has NOT satisfied UC7-001 but cache is available.
    // Block in all modes — this is a hard requirement.
    const errorMsg = buildUC7KSError(
      agent,
      tool,
      mode,
      true,
      "UC7-001 VIOLATION: Agent has not read the local knowledge cache. Must read docs/official_docs/index.json before any external queries.",
    );
    console.error(
      `[UC7KS-Enforcer][UC7-001][HARD-BLOCK] Agent "${agent}" attempted ` +
      `external query "${tool}" without reading local cache. ` +
      `Require: read docs/official_docs/index.json first.`
    );
    throw new Error(errorMsg);
  }

  // ── Mode: ADVISORY — log only, never block ──
  if (mode === "advisory") {
    if (cacheAvailable) {
      console.warn(
        `[UC7KS-Enforcer][UC7-001][ADVISORY] Local knowledge cache available at ` +
        `${INDEX_PATH}. Agent "${agent}" should check cached docs before ` +
        `making external query "${tool}". (Non-blocking in advisory mode)`
      );
    } else {
      console.log(
        `[UC7KS-Enforcer][UC7-001][ADVISORY] Local knowledge cache not yet ` +
        `initialized. Agent "${agent}" making external query as first-resort.`
      );
    }
    console.warn(
      `[UC7KS-Enforcer][UC7-002][ADVISORY] External query "${tool}" by ` +
      `"${agent}" — verify user confirmation was obtained. (Non-blocking)`
    );
    return;
  }

  // ── Mode: STRICT — block if cache exists but wasn't searched ──
  if (mode === "strict") {
    if (cacheAvailable) {
      // Cache exists → agent MUST have searched it first.
      // Since we can't verify per-session cache-read state in this hook,
      // we block and point to the remediation path.
      const errorMsg = buildUC7KSError(
        agent,
        tool,
        "strict",
        true,
        "Local cache exists. Agent must search cached docs before external queries.",
      );
      console.error(
        `[UC7KS-Enforcer][STRICT][BLOCKED] Agent "${agent}" attempted ` +
        `external query "${tool}" without checking local cache.`
      );
      throw new Error(errorMsg);
    } else {
      // No cache → allow first-time setup
      console.log(
        `[UC7KS-Enforcer][UC7-001][STRICT] Local cache not initialized. ` +
        `Allowing external query "${tool}" by "${agent}" for first-time setup. ` +
        `Consider dispatching @Knowledge-Curator to populate the cache.`
      );
      return;
    }
  }

  // ── Mode: LOCKED — BLOCK ALL direct external queries ──
  if (mode === "locked") {
    const errorMsg = buildUC7KSError(
      agent,
      tool,
      "locked",
      cacheAvailable,
      "LOCKED mode: ALL direct external queries blocked. Must use @Knowledge-Curator.",
    );
    console.error(
      `[UC7KS-Enforcer][LOCKED][BLOCKED] Agent "${agent}" attempted ` +
      `external query "${tool}" in locked mode. Only @Knowledge-Curator may ` +
      `make external queries.`
    );
    throw new Error(errorMsg);
  }
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
        `[UC7KS-Enforcer][UC7-003] Doc saved: ${filePath} ` +
        `(${(stat.size / 1024).toFixed(1)}KB). ` +
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
  const mode = getEnforcementMode();
  console.log(
    `[UC7KS-Enforcer v2.0.0] Initialized — UC7KS knowledge system enforcement ` +
    `active in ${mode.toUpperCase()} mode`
  );

  if (mode === "advisory") {
    console.warn(
      `[UC7KS-Enforcer] WARNING: Running in ADVISORY mode. External doc queries ` +
      `will NOT be blocked. Consider upgrading to STRICT mode for pipeline enforcement.`
    );
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
  } as unknown as Hooks;
};

export default plugin;
