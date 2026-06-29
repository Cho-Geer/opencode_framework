// uc7ks-utils.ts — UC7KS knowledge pipeline compliance utilities (lib)
// BUN-CACHE-VERSION: 2026-06-24-SA-FIX-v2 — verified fix
// Phase 3 (v19 DB-Canonical): enforcement sources unified to uc7ks_pipeline_state
import * as fs from "node:fs";
import * as path from "node:path";
// readCachedSessionAccess moved to uc7ks-schema
// import { readCachedSessionAccess } from "./uc7ks-schema";
import { readSubState } from "../../lib/substate-manager";
import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import { normalize } from "../../lib/agent-identity";

const SRC = "lib-uc7ks-utils";

/** Resolve pipeline ID from session or task context */
function resolvePipelineId(sessionId, taskId) {
  return taskId || sessionId || 'unknown';
}


const INDEX_PATH = "docs/official_docs/index.json";

interface IndexManifest {
  manifest_version: string;
  total_entries: number;
  entries: any[];
}

export function readCacheIndex(): IndexManifest | null {
  try {
    const p = path.join(process.env.OPENCODE_ROOT || ".", INDEX_PATH);
    if (!fs.existsSync(p)) return null;
    const c = JSON.parse(fs.readFileSync(p, "utf8"));
    return c.manifest_version && Array.isArray(c.entries) ? c : null;
  } catch {
    return null;
  }
}

export function isLocalCacheAvailable(): boolean {
  const idx = readCacheIndex();
  return !!(idx && idx.total_entries > 0);
}

export function readCachedSessionAccess(agentKey: string): any {
  try {
    const kcs = readSubState("knowledge_cache_state");
    return kcs?.session_access?.[agentKey] || null;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "READ-CACHED-SESSION-ACCESS-FAILED",
      detail: `agentKey=${agentKey} err=${e.message}`,
    });
  }
  return null;
}

/**
 * A3 (2026-06-21): DB-first enforcement — query typed knowledge tables
 * (knowledge_session_access, knowledge_discovery, knowledge_attestation)
 * instead of relying exclusively on the knowledge_cache_state JSON blob.
 * Each function returns null on DB error (caller falls back to JSON blob).
 *
 * @see docs/review/framework-refactor/read-audit-db-migration-plan.md for DB-first pattern
 */

/** Query knowledge_session_access row for (agent, taskId, domainId) */
function getKnowledgeAccessFromDb(
  agent: string,
  taskId: string,
  domainId: string,
): any | null {
  try {
    const db = getDb({ skipSchema: true });
    return (
      db
        .query(
          `SELECT * FROM knowledge_session_access WHERE agent = ? AND task_id = ? AND domain_id = ?`,
        )
        .get(agent, taskId, domainId) || null
    );
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-QUERY-ACCESS-FAILED",
      detail: `agent=${agent} task=${taskId} domain=${domainId} err=${e.message}`,
    });
    return null; // ← caller falls back to JSON blob
  }
}

/** Query knowledge_discovery row for (agent, taskId, domainId) */
function getKnowledgeDiscoveryFromDb(
  agent: string,
  taskId: string,
  domainId: string,
): any | null {
  try {
    const db = getDb({ skipSchema: true });
    return (
      db
        .query(
          `SELECT * FROM knowledge_discovery WHERE agent = ? AND task_id = ? AND domain_id = ?`,
        )
        .get(agent, taskId, domainId) || null
    );
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-QUERY-DISCOVERY-FAILED",
      detail: `agent=${agent} task=${taskId} domain=${domainId} err=${e.message}`,
    });
    return null;
  }
}

/** Query knowledge_attestation row for (agent, taskId, domainId) */
function getKnowledgeAttestationFromDb(
  agent: string,
  taskId: string,
  domainId: string,
): any | null {
  try {
    const db = getDb({ skipSchema: true });
    return (
      db
        .query(
          `SELECT * FROM knowledge_attestation WHERE agent = ? AND task_id = ? AND domain_id = ?`,
        )
        .get(agent, taskId, domainId) || null
    );
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-QUERY-ATTESTATION-FAILED",
      detail: `agent=${agent} task=${taskId} domain=${domainId} err=${e.message}`,
    });
    return null;
  }
}

/**
 * A3: Try to build enforcement discovery + attestation records from DB.
 * Returns { disc, att } on success, null on any DB error (→ JSON fallback).
 * This is the DB-first entry point for checkUC7KSWrite Path A.
 */
function tryBuildEnforcementFromDb(
  agentKey: string,
  taskId: string,
  domainId: string,
): { disc: any; att: any } | null {
  try {
    const dbAccess = getKnowledgeAccessFromDb(agentKey, taskId, domainId);
    const dbDiscovery = getKnowledgeDiscoveryFromDb(agentKey, taskId, domainId);
    const dbAttestation = getKnowledgeAttestationFromDb(
      agentKey,
      taskId,
      domainId,
    );

    // DB is authoritative if we reached this point without exception.
    // Build CacheDiscovery-equivalent from knowledge_discovery row
    var disc: any = null;
    if (dbDiscovery) {
      disc = {
        status: dbDiscovery.result_status || "undeclared",
        missing_topics: [],
        discovered_files: [],
        discovered_at: dbDiscovery.created_at
          ? new Date(dbDiscovery.created_at).toISOString()
          : new Date(0).toISOString(),
      };
    }

    // Build CacheAttestation-equivalent from knowledge_attestation row
    var att: any = null;
    if (dbAttestation) {
      var filesRead: string[] = [];
      try {
        if (dbAttestation.files_read) {
          filesRead =
            typeof dbAttestation.files_read === "string"
              ? JSON.parse(dbAttestation.files_read)
              : dbAttestation.files_read;
        }
      } catch {
        filesRead = [];
      }

      att = {
        status: dbAttestation.status || "pending",
        reason: dbAttestation.insufficiency_reason || "",
        files_read: Array.isArray(filesRead) ? filesRead : [],
        content_summary: "",
        attested_at: dbAttestation.created_at
          ? new Date(dbAttestation.created_at).toISOString()
          : new Date(0).toISOString(),
      };
    }

    writeLog(SRC, "INFO", {
      event: "UC7KS-DB-ENFORCEMENT",
      agent: agentKey,
      taskId,
      domainId,
      detail: `DB-first: access=${!!dbAccess} discovery=${!!dbDiscovery} attestation=${!!dbAttestation}`,
    });
    return { disc, att };
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-FALLBACK",
      agent: agentKey,
      taskId,
      domainId,
      detail: `DB enforcement failed (${e.message}), falling back to JSON blob`,
    });
    return null; // ← JSON fallback
  }
}

export function buildUC7KSError(
  agent: string,
  tool: string,
  mode: string,
  cacheAvail: boolean,
  reason: string,
): string {
  return [
    `╔══════════════════════════════════════════════════════════════╗`,
    `║  UC7KS PIPELINE ENFORCEMENT — ${mode.toUpperCase()} MODE                      ║`,
    `║  Tool: ${tool.padEnd(48)}║`,
    `║  Agent: ${(agent || "unknown").padEnd(48)}║`,
    `║  Reason: ${reason.padEnd(48)}║`,
    `║  Cache: ${(cacheAvail ? "AVAILABLE" : "NOT INITIALIZED").padEnd(48)}║`,
    `║  REMEDIATION: 1) read docs/official_docs/index.json         ║`,
    `║  2) If insufficient: dispatch @Knowledge-Curator            ║`,
    `║  3) Re-read cached docs → proceed with task                 ║`,
    `╚══════════════════════════════════════════════════════════════╝`,
  ].join("\n");
}

/**
 * Core external tools that MUST always be blocked for non-KC agents.
 * These are the tools that directly query external sources, bypassing
 * the UC7KS local-first pipeline. Cannot be removed via config.
 */
const CORE_EXTERNAL_TOOLS = new Set([
  "context7_resolve-library-id",
  "context7_query-docs",
  "context7",
  "webfetch",
  "websearch",
  "github_get_file_contents",
  "github_search_code",
  "github_search_repositories",
  "github_search_issues",
  "playwright_browser_navigate",
]);

/**
 * CodeGraph MCP tools — explicitly exempt from UC7KS pipeline.
 * These tools query LOCAL code structure (Tree-sitter index), not external sources.
 * Added 2026-06-27 as part of CodeGraph MCP integration.
 */
const CODEGRAPH_TOOLS = new Set([
  "codegraph_search",
  "codegraph_explore",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_status",
  "codegraph_files",
]);

/**
 * Load config-extensible external tools from project.config.json.
 * No caching — always re-reads config for live updates.
 */
function getExternalTools(): Set<string> {
  const merged = new Set(CORE_EXTERNAL_TOOLS);
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = fs.readFileSync(
      path.join(root, ".opencode", "project.config.json"),
      "utf8",
    );
    const cfg = JSON.parse(raw);
    const extras: string[] =
      cfg?.template_resolution?.uc7ks_external_tools ?? [];
    for (const t of extras) merged.add(t);
  } catch {
    // Config unreadable → use core set only
  }
  return merged;
}

export function checkUC7KS(
  tool: string,
  agent: string,
  mode: string,
): string | null {
  // CodeGraph tools query local code structure — exempt from UC7KS pipeline
  if (CODEGRAPH_TOOLS.has(tool)) return null;

  if (!getExternalTools().has(tool)) return null;

  if (agent === "@Knowledge-Curator" || agent === "Knowledge-Curator")
    return null;

  const cacheAvailable = isLocalCacheAvailable();

  let agentReadCache = false;
  try {
    const kcs = readSubState("knowledge_cache_state");
    agentReadCache = !!kcs?.session_access?.[agent]?.uc7_001_compliant;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "UC7KS-COMPLIANT-CHECK-FAILED",
      detail: `agent=${agent} err=${e.message}`,
    });
  }

  if (!agentReadCache && cacheAvailable) {
    return buildUC7KSError(
      agent,
      tool,
      mode,
      true,
      "UC7-001: Agent has not read local knowledge cache before external query.",
    );
  }

  // ── F3: Per-domain sufficiency check with nested schema fallback ──
  if (agentReadCache && cacheAvailable) {
    try {
      const kcs = readSubState("knowledge_cache_state");
      const sa = kcs?.session_access || {};
      const agentKey = normalize(agent);

      // Try nested: find any completed domain with sufficient cache for this agent
      let hasSufficientCache = false;
      let suff: any = null;
      let evidenceOk = true;

      const agentEntry = sa[agent] || sa[agentKey];
      if (agentEntry?.tasks) {
        for (const tid of Object.keys(agentEntry.tasks)) {
          for (const domain of Object.keys(
            agentEntry.tasks[tid].domains || {},
          )) {
            const d = agentEntry.tasks[tid].domains[domain];
            if (
              d.pipeline_status === "completed" &&
              d.cache_sufficiency?.status === "sufficient"
            ) {
              hasSufficientCache = true;
              suff = d.cache_sufficiency;
              break;
            }
          }
          if (hasSufficientCache) break;
        }
      }

      // Fall back to legacy flat (F3: backward compat)
      if (!hasSufficientCache) {
        const flat = agentEntry || {};
        if (flat.cache_sufficiency?.status === "sufficient") {
          hasSufficientCache = true;
          suff = flat.cache_sufficiency;
        }
      }

      if (!hasSufficientCache) {
        // Check for any insufficient cache
        let hasAnyCache = false;
        if (agentEntry?.tasks) {
          for (const tid of Object.keys(agentEntry.tasks)) {
            for (const domain of Object.keys(
              agentEntry.tasks[tid].domains || {},
            )) {
              const d = agentEntry.tasks[tid].domains[domain];
              if (d.cache_sufficiency?.status === "insufficient") {
                hasAnyCache = true;
                break;
              }
            }
            if (hasAnyCache) break;
          }
        }
        if (!hasAnyCache) {
          const flat = agentEntry || {};
          if (flat.cache_sufficiency?.status === "insufficient")
            hasAnyCache = true;
          else if (
            !flat.cache_sufficiency?.status ||
            flat.cache_sufficiency.status === "undeclared"
          ) {
            return buildUC7KSError(
              agent,
              tool,
              mode,
              true,
              `UC7-001b: Cache sufficiency not declared (status: ${flat.cache_sufficiency?.status || "undeclared"}). See subagent-preamble.md Step 0c.`,
            );
          }
        }
      }

      // UC7-001c HARDEN: Verify evidence fields
      if (suff) {
        const missing: string[] = [];
        if (!suff.reason || suff.reason.length === 0) missing.push("reason");
        if (
          !suff.files_read ||
          !Array.isArray(suff.files_read) ||
          suff.files_read.length === 0
        ) {
          if (suff.status === "sufficient") missing.push("files_read");
        }
        if (!suff.content_summary || suff.content_summary.length === 0)
          missing.push("content_summary");
        if (missing.length > 0) {
          return buildUC7KSError(
            agent,
            tool,
            mode,
            true,
            `UC7-001c: Cache sufficiency evidence incomplete. Missing: ${missing.join(", ")}. ` +
              `Must provide reason, files_read, and content_summary. See preamble Step 0.`,
          );
        }
      }
    } catch (e: any) {
      writeLog(SRC, "ERROR", {
        event: "UC7KS-SUFFICIENCY-CHECK-FAILED",
        detail: `agent=${agent} err=${e.message}`,
      });
    }
  }

  if (mode === "advisory" || mode === "strict") {
    if (cacheAvailable) {
      return buildUC7KSError(
        agent,
        tool,
        mode,
        true,
        `Local cache exists. Agent must search cached docs before external queries (${mode} mode).`,
      );
    }
    return null;
  }

  return buildUC7KSError(
    agent,
    tool,
    "locked",
    cacheAvailable,
    "LOCKED mode: ALL direct external queries blocked. Must use @Knowledge-Curator.",
  );
}

/**
 * P1-3: UC7-001 write-time block + UC7-009 SA compliance.
 * Checks whether an agent has searched the knowledge cache before
 * writing a source file. SA has emergency bypass when cache is unhealthy.
 *
 * @param agent  Resolved agent name (e.g., "@Coder-BE")
 * @param mode   Enforcement mode ("advisory" | "strict" | "locked")
 * @returns Error string if blocked, null if allowed
 */
