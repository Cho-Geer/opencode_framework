// uc7ks-utils.ts — UC7KS knowledge pipeline compliance utilities (lib)
// Phase 3 (v19 DB-Canonical): enforcement sources unified to uc7ks_pipeline_state
import * as fs from "node:fs";
import * as path from "node:path";
import {
  readCacheAttestation,
} from "./uc7ks-schema";
import { readSubState } from "./substate-manager";
import { writeLog } from "./log-manager";
import { getDb } from "./db-manager";

const SRC = "lib-uc7ks-utils";

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

const EXTERNAL_TOOLS = new Set([
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

export function checkUC7KS(
  tool: string,
  agent: string,
  mode: string,
): string | null {
  if (!EXTERNAL_TOOLS.has(tool)) return null;

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
      const agentKey = agent.replace(/^@/, "");

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
export function checkUC7KSWrite(
  agent: string,
  mode: string,
  sessionId?: string,
  taskId?: string,
  domainId?: string,
): string | null {
  // Advisory mode: no blocking
  if (mode === "advisory") return null;

  // KC exempt — writes to docs/official_docs/ are cache population
  const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
  if (agentNorm === "knowledge-curator") return null;

  // Read cache health and agent compliance
  const cacheHealthy = isLocalCacheAvailable();
  const isSA = agentNorm === "super-admin";

  // UC7-009: SA emergency bypass — cache unhealthy → allow writes
  if (isSA && !cacheHealthy) {
    return null; // bypass: SA repairing broken cache
  }

  // Check uc7_001_compliant via sub-state (knowledge-cache-state.json)
  const agentKey = agent.replace(/^@/, "");
  const sa = readCachedSessionAccess(agentKey);

  // ── FW-UC7KS-DOMAIN-001: Per-task per-domain check (priority) ──
  // Phase 0 (2026-06-18) dual-state: discovery (machine-generated) +
  // attestation (agent-submitted, verified against read_audit.jsonl).
  // 3-path design:
  //   Path A: taskId+domainId present AND per-domain data exists → dual-state verify
  //   Path B: taskId+domainId present BUT per-domain data missing → BLOCK
  //   Path C: no taskId/domainId → global check (backward compat)
  //
  // A3 (2026-06-21): DB-first enforcement. Path A now queries typed
  // knowledge tables (knowledge_session_access, knowledge_discovery,
  // knowledge_attestation) before falling back to JSON blob. This
  // follows the same pattern as read-audit DB-first migration.
  if (taskId && domainId) {
    // SA-FIX-UC7KS-PATH-A-FALLBACK (2026-06-24, @Super-Admin):
    //   When queryAttestationForWriteGate returns null (no DB row),
    //   fall through to Path C instead of blocking directly.
    var pathABlocked = false;
    var pathABlockMsg: string | null = null;
    try {
      const { queryAttestationForWriteGate, resolvePipelineId } = require("./uc7ks-pipeline-db");
      const pipelineId = resolvePipelineId({ task_id: taskId }, sessionId);
      if (pipelineId) {
        const gateResult = queryAttestationForWriteGate({
          pipelineId,
          agent,
          domainId,
        });
        if (gateResult) {
          if (
            gateResult.attestation_status === "attested" &&
            gateResult.cache_sufficient
          ) {
            return null; // allow write
          }
          pathABlocked = true;
          pathABlockMsg =
            "[FW-ENFORCE][UC7-001] " +
            `pipeline_id=${pipelineId} agent=${agent} domain=${domainId} ` +
            `attestation_status=${gateResult.attestation_status}. ` +
            "Call knowledge_cache_search + knowledge_cache_attest first.";
        } else {
          // No DB row for this pipeline+agent+domain — fall through to Path C
          writeLog(SRC, "INFO", {
            event: "UC7KS-PATH-A-NO-ROW-FALLBACK",
            agent,
            sessionID: sessionId,
            taskId,
            domainId,
            pipelineId,
            detail: "Path A: no DB row found — falling through to Path C",
          });
        }
      }
    } catch (e: any) {
      writeLog(SRC, "WARN", {
        event: "UC7KS-ENFORCEMENT-DB-FAILED",
        detail: `DB-canonical enforcement query failed: ${e.message}`,
      });
    }

    // If Path A found a DB row but it was not attested, return the block
    if (pathABlocked && pathABlockMsg) {
      return pathABlockMsg;
    }
    // Otherwise: fall through to Path C (all-domain check) below.
  }

  // ── Path C: All-domain attestation check (M3, 2026-06-19) ──
  // Replaces legacy global uc7_001_compliant check.
  // Iterates ALL session domains for this agent/task — every domain
  // MUST have attestation.status === "attested" for writes to pass.
  // Strict/Locked: BLOCK on first non-attested domain.
  // Advisory: WARN (log) but PASS (non-blocking).
  // Design: docs/review/framework-refactor/uc7ks-write-block-gap-analysis-and-repair-plan.md §M3

  // A3 F1: Resolve missing taskId from session_map → gate_sessions
  // When taskId is undefined, try to recover it from the database
  // to enable per-domain attestation lookup.
  var resolvedTaskId = taskId;
  if (!resolvedTaskId && sessionId) {
    try {
      const db = getDb({ skipSchema: true });
      // Priority 1: session_map.dag_task_id (dispatch-assigned)
      const smRow = db
        .query(`SELECT dag_task_id FROM session_map WHERE session_id = ?`)
        .get(sessionId) as { dag_task_id: string | null } | null;
      if (smRow?.dag_task_id) {
        resolvedTaskId = smRow.dag_task_id;
        writeLog(SRC, "INFO", {
          event: "UC7KS-TASKID-RESOLVED-SESSION-MAP",
          agent,
          sessionID: sessionId,
          taskId: resolvedTaskId,
          detail: `Path C: resolved taskId from session_map`,
        });
      } else {
        // Priority 2: gate_sessions.task_id (compliance gate)
        const gsRow = db
          .query(`SELECT task_id FROM gate_sessions WHERE session_id = ?`)
          .get(sessionId) as { task_id: string | null } | null;
        if (gsRow?.task_id) {
          resolvedTaskId = gsRow.task_id;
          writeLog(SRC, "INFO", {
            event: "UC7KS-TASKID-RESOLVED-GATE-SESSIONS",
            agent,
            sessionID: sessionId,
            taskId: resolvedTaskId,
            detail: `Path C: resolved taskId from gate_sessions`,
          });
        }
      }
    } catch (e: any) {
      writeLog(SRC, "WARN", {
        event: "UC7KS-TASKID-RESOLVE-FAILED",
        agent,
        sessionID: sessionId,
        detail: `Path C: failed to resolve taskId from DB: ${e.message}`,
      });
    }
  }

  // If taskId remains unresolved in strict/locked mode → BLOCK
  if (!resolvedTaskId && (mode === "strict" || mode === "locked")) {
    writeLog(SRC, "ERROR", {
      event: "UC7KS-WRITE-BLOCK-NO-TASKID",
      agent,
      sessionID: sessionId,
      detail: `Path C: no taskId available — cannot perform per-domain attestation check`,
    });
    return buildBlockMessage(
      "UC7-001: 无法解析任务ID",
      agent,
      `No taskId available for per-domain attestation check. ` +
        `sessionId=${sessionId || "none"}`,
      `1. Ensure dispatch went through dispatch_subagent\n` +
        `2. Or provide task_id explicitly to compliance_gate_check\n` +
        `3. Or use advisory mode for emergency bypass`,
    );
  }

  var allDomainsAttested = checkAllDomainsAttested(
    sa,
    agentKey,
    resolvedTaskId,
    mode,
    sessionId,
    agent,
  );
  if (allDomainsAttested === true) {
    // All domains attested → PASS
    writeLog(SRC, "INFO", {
      event: "UC7KS-WRITE-PASS-ALL-ATTESTED",
      agent,
      sessionID: sessionId,
      taskId,
      detail: `all domains attested for agent ${agent}`,
    });
    return null;
  }
  if (typeof allDomainsAttested === "string") {
    // Returned a block message (strict/locked mode, domain not attested)
    return allDomainsAttested;
  }
  // allDomainsAttested === null → advisory mode: warn but pass
  writeLog(SRC, "WARN", {
    event: "UC7KS-WRITE-WARN-NOT-ALL-ATTESTED",
    agent,
    sessionID: sessionId,
    taskId,
    detail: `advisory mode: domains not fully attested — WARN only`,
  });
  return null;

  /**
   * M5 helper: Checks whether the agent has at least one domain
   * with attestation.status === "attested" in ANY task.
   * Used by Path B to determine whether domain mismatch is tolerable.
   */
  function hasAtLeastOneAttestedDomain(sa: any, agentKey: string): boolean {
    if (!sa?.tasks) return false;
    for (const tid of Object.keys(sa.tasks)) {
      for (const domId of Object.keys(sa.tasks[tid].domains || {})) {
        const att = readCacheAttestation(sa, agentKey, tid, domId);
        if (att && att.status === "attested") return true;
      }
    }
    return false;
  }

  /**
   * M3: Checks all domains for the given agent/task.
   * Returns:
   *   true  — all domains attested (PASS)
   *   "" (string) — block message (BLOCK in strict/locked)
   *   null — advisory mode: not all attested but non-blocking (WARN)
   */
  function checkAllDomainsAttested(
    sa: any,
    agentKey: string,
    taskId: string | undefined,
    mode: string,
    sessionId: string | undefined,
    agent: string,
  ): true | string | null {
    // ════════════════════════════════════════════════════════════
    // DB-Canonical (v19 Phase 3): uc7ks_pipeline_state is the primary
    // enforcement source. JSON blob is fallback for legacy sessions.
    // ════════════════════════════════════════════════════════════
    var unattestedDomains: string[] = [];
    var dbUsed = false;

    // Path 1: Try DB-only query via uc7ks_pipeline_state
    try {
      const pipelineId = resolvePipelineId({ task_id: taskId }, sessionId);
      if (pipelineId) {
        const { queryAllAgentPipelineDomains } = require("./uc7ks-pipeline-db");
        const dbDomains = queryAllAgentPipelineDomains({
          pipelineId,
          agent: agentKey,
        });
        if (dbDomains.length > 0) {
          dbUsed = true;
          for (var d = 0; d < dbDomains.length; d++) {
            if (dbDomains[d].attestation_status !== "attested" || !dbDomains[d].cache_sufficient) {
              unattestedDomains.push(dbDomains[d].domain_id);
            }
          }
        }
      }
    } catch (e: any) {
      writeLog(SRC, "WARN", {
        event: "UC7KS-PATH-C-DB-FALLBACK",
        agent,
        sessionID: sessionId,
        taskId,
        detail: "DB query failed, falling back to JSON blob",
      });
    }

    // Path 2: JSON blob fallback (legacy sessions without uc7ks_pipeline_state data)
    if (!dbUsed) {
      var domainEntries: Array<{ taskId: string; domainId: string }> = [];
      if (taskId && sa?.tasks?.[taskId]?.domains) {
        for (const domId of Object.keys(sa.tasks[taskId].domains)) {
          domainEntries.push({ taskId, domainId: domId });
        }
      } else if (sa?.tasks) {
        for (const tid of Object.keys(sa.tasks)) {
          for (const domId of Object.keys(sa.tasks[tid].domains || {})) {
            domainEntries.push({ taskId: tid, domainId: domId });
          }
        }
      }

      if (domainEntries.length === 0) {
        if (sa?.uc7_001_compliant) {
          return true;
        }
        if (mode === "advisory") {
          writeLog(SRC, "WARN", {
            event: "UC7KS-WRITE-WARN-NO-DOMAINS",
            agent,
            sessionID: sessionId,
            taskId,
            detail: "advisory mode: no domains in state — WARN only",
          });
          return null;
        }
        return buildBlockMessage(
          "UC7-001: 知识缓存未搜索",
          agent,
          "No domain cache data found and uc7_001_compliant not set.",
          "Call knowledge_cache_search(domain, task_id) first, then knowledge_cache_attest().",
        );
      }

      for (var i = 0; i < domainEntries.length; i++) {
        var de = domainEntries[i];
        var att = readCacheAttestation(sa, agentKey, de.taskId, de.domainId);
        if (!att || att.status !== "attested") {
          unattestedDomains.push(de.domainId + " (task " + de.taskId + ")");
        }
      }
    }

    if (unattestedDomains.length === 0) {
      return true; // All attested
    }

    // Domain(s) not attested
    if (mode === "advisory") {
      writeLog(SRC, "WARN", {
        event: "UC7KS-WRITE-WARN-UNATTESTED-DOMAINS",
        agent,
        sessionID: sessionId,
        taskId,
        detail: `advisory mode: ${unattestedDomains.length} domains not attested: ${unattestedDomains.join(", ")}`,
      });
      return null;
    }

    // Strict/Locked: BLOCK
    writeLog(SRC, "ERROR", {
      event: "UC7KS-WRITE-BLOCK-UNATTESTED-DOMAINS",
      agent,
      sessionID: sessionId,
      taskId,
      detail: `${unattestedDomains.length} domain(s) not attested: ${unattestedDomains.join(", ")}`,
    });
    return buildBlockMessage(
      "UC7-001: 存在未证明已读的知识域",
      agent,
      `${unattestedDomains.length} domain(s) lack read attestation (M3): ${unattestedDomains.slice(0, 3).join(", ")}`,
      `对每个未 attest 的域调用:\nknowledge_cache_attest(domain="...", task_id="...", reason="...", files_read=[...], content_summary="...")`,
    );
  }

  // closes checkAllDomainsAttested
}
// closes checkUC7KSWrite (SA-FIX-UC7KS-UNCLOSED-BRACE)

/**
 * M11 (2026-06-19): File-level domain attestation check.
 *
 * Fix SA-FIX-UC7KS-UNCLOSED-BRACE: Added missing closing brace for checkUC7KSWrite function.
 * This function opens at line 205 and spans 3 nested functions:
 *   - buildBlockMessage (line 433-445)
 *   - hasAtLeastOneAttestedDomain (line 486-495)
 *   - checkAllDomainsAttested (line 504-590)
 * The closing brace at line 590 only closed checkAllDomainsAttested - the outer
 * checkUC7KSWrite function body had no matching closing brace, causing a syntax error
 * that prevented scope-before.ts plugin from loading.
 * Prevents bypass: "attest domain A, write domain B files".
 * Matches filePath against knowledge_semantic_map.save_path.
 * Returns null (PASS) or block message (BLOCK in strict/locked).
 * Advisory mode always returns null.
 */
export function checkUC7KSFileLevelDomain(
  filePath: string,
  agent: string,
  mode: string,
  sessionId?: string,
  taskId?: string,
): string | null {
  if (mode === "advisory") return null;
  const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
  if (agentNorm === "knowledge-curator") return null;
  if (agentNorm === "super-admin" && !isLocalCacheAvailable()) return null;
  var matchedDomain: string | null = null;
  try {
    const p2 = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".opencode",
      "project.config.json",
    );
    if (!fs.existsSync(p2)) return null;
    const cfg = JSON.parse(fs.readFileSync(p2, "utf8"));
    const doms = cfg?.knowledge_semantic_map?.domains || [];
    var best: { d: string; p: string; l: number } | null = null;
    for (var di = 0; di < doms.length; di++) {
      var sp = (doms[di].save_path || "").replace(/\/+$/, "") + "/";
      if (sp && filePath.indexOf(sp) >= 0) {
        if (!best || sp.length > best.l)
          best = { d: doms[di].domain_id, p: sp, l: sp.length };
      }
    }
    if (!best) return null;
    matchedDomain = best.d;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "UC7KS-M11-CFG-ERR",
      agent,
      sessionID: sessionId,
      detail: e.message,
    });
    return null;
  }
  if (!matchedDomain) return null;
  var ak = agent.replace(/^@/, "");
  var sa2 = readCachedSessionAccess(ak);
  if (!sa2) {
    writeLog(SRC, "ERROR", {
      event: "UC7KS-WRITE-BLOCK-M11-NO-STATE",
      agent,
      sessionID: sessionId,
      taskId,
      domainId: matchedDomain,
      detail: "no cache state for agent",
    });
    return buildBlockMessage(
      "UC7-001: No cache state for file domain (M11)",
      agent,
      `File maps to domain "${matchedDomain}" but agent has no cache state.`,
      "1. module_scope_declare 2. knowledge_cache_search 3. knowledge_cache_attest",
    );
  }
  var attOk = false;
  if (sa2.tasks) {
    for (var tk of Object.keys(sa2.tasks)) {
      var a2 = readCacheAttestation(sa2, ak, tk, matchedDomain);
      if (a2 && a2.status === "attested") {
        attOk = true;
        break;
      }
    }
  }
  if (!attOk) {
    writeLog(SRC, "ERROR", {
      event: "UC7KS-WRITE-BLOCK-M11-NOT-ATTESTED",
      agent,
      sessionID: sessionId,
      taskId,
      domainId: matchedDomain,
      detail: `domain "${matchedDomain}" not attested`,
    });
    return buildBlockMessage(
      "UC7-001: File domain not attested (M11)",
      agent,
      `File maps to domain "${matchedDomain}" which has NOT been attested.`,
      `1. Read docs/official_docs/ files for "${matchedDomain}"\n2. knowledge_cache_attest(domain="${matchedDomain}", ...)`,
    );
  }
  writeLog(SRC, "INFO", {
    event: "UC7KS-M11-PASS",
    agent,
    sessionID: sessionId,
    taskId,
    domainId: matchedDomain,
    detail: `file OK → domain "${matchedDomain}" attested`,
  });
  return null;
}
