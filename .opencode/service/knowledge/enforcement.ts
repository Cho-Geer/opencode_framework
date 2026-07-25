// enforcement.ts — UC7KS write-time compliance enforcement (checkUC7KSWrite)
// Phase 1f: Split from uc7ks-utils.ts

import { shouldBlock } from "../enforcement/rule-disposition";
import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import { readSubState } from "../../lib/substate-manager";
import { normalize } from "../../lib/agent-identity";
import { isLocalCacheAvailable, readCachedSessionAccess } from "./cache-check";
import { queryAttestationForWriteGate, queryAllAgentPipelineDomains, resolvePipelineId } from "./pipeline-db";

const SRC = "service-knowledge-enforcement";

export function checkUC7KSWrite(
  agent: string,
  sessionId?: string,
  taskId?: string,
  domainId?: string,
): string | null {
  // Audit-only policy: no blocking
  if (!shouldBlock("knowledge-cache-miss")) return null;

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
  const agentKey = normalize(agent);
  const sa = readCachedSessionAccess(agentKey);

  /**
   * Build a formatted block message for UC7-001 write enforcement.
   * Used by all enforcement paths within checkUC7KSWrite.
   * @internal — defined inside checkUC7KSWrite closure
   */
  function buildBlockMessage(
    title: string,
    agent: string,
    detail: string,
    remediation: string,
  ): string {
    return (
      `[FW-ENFORCE][UC7-001] ${title}\n` +
      `Agent: ${agent || "unknown"}\n` +
      `Detail: ${detail.substring(0, 200)}\n` +
      `Remediation:\n${remediation
        .split("\n")
        .map(function (l) {
          return "  " + l.substring(0, 100);
        })
        .join("\n")}` +
      `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`
    );
  }

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
      const {
        queryAttestationForWriteGate,
        resolvePipelineId,
      } = require("./uc7ks-pipeline-db");
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
            "Call knowledge_cache_search + knowledge_cache_attest first." + "\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.";
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
  // hard_block policy: BLOCK on first non-attested domain.
  // audit_only policy: WARN (log) but PASS (non-blocking).
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

  // If taskId remains unresolved under blocking policy → BLOCK
  if (!resolvedTaskId && (shouldBlock("knowledge-cache-miss"))) {
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
      `1. Ensure child work went through native Task or the legacy dispatch_subagent wrapper\n` +
        `2. Or provide task_id explicitly to compliance_gate_check\n` +
        `3. Or downgrade this rule to audit_only if this path should stay non-blocking`,
    );
  }

  var allDomainsAttested = checkAllDomainsAttested(
    sa,
    agentKey,
    resolvedTaskId,
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
    // Returned a block message (blocking policy, domain not attested)
    return allDomainsAttested;
  }
  // allDomainsAttested === null → audit-only policy: warn but pass
  writeLog(SRC, "WARN", {
    event: "UC7KS-WRITE-WARN-NOT-ALL-ATTESTED",
    agent,
    sessionID: sessionId,
    taskId,
    detail: `audit-only policy: domains not fully attested — WARN only`,
  });
  return null;

  // OPT-02 (2026-06-25): hasAtLeastOneAttestedDomain removed — dead code (0 callers).
  // This was the last JSON blob reader via readCacheAttestation() inside checkUC7KSWrite.

  /**
   * M3: Checks all domains for the given agent/task.
   * Returns:
   *   true  — all domains attested (PASS)
   *   "" (string) — block message (BLOCK under hard policy)
   *   null — audit-only policy: not all attested but non-blocking (WARN)
   */
  function checkAllDomainsAttested(
    sa: any,
    agentKey: string,
    taskId: string | undefined,
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
        // (dynamic require replaced by static import above)
        const dbDomains = queryAllAgentPipelineDomains({
          pipelineId,
          agent: agentKey,
        });
        if (dbDomains.length > 0) {
          dbUsed = true;
          for (var d = 0; d < dbDomains.length; d++) {
            if (
              dbDomains[d].attestation_status !== "attested" ||
              !dbDomains[d].cache_sufficient
            ) {
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

    // Path 2: No uc7ks_pipeline_state data — DB-canonical (v19 Phase 3)
    // JSON blob fallback removed. DB is the sole enforcement source.
    if (!dbUsed) {
      if (!shouldBlock("knowledge-cache-miss")) {
        writeLog(SRC, "WARN", {
          event: "UC7KS-WRITE-WARN-NO-PIPELINE-DATA",
          agent,
          sessionID: sessionId,
          taskId,
          detail:
            "audit-only policy: no uc7ks_pipeline_state data — WARN only (DB-canonical, JSON blob fallback removed)",
        });
        return null;
      }
      writeLog(SRC, "ERROR", {
        event: "UC7KS-WRITE-BLOCK-NO-PIPELINE-DATA",
        agent,
        sessionID: sessionId,
        taskId,
        detail:
          "No uc7ks_pipeline_state rows found — pipeline not started. DB-canonical (v19 Phase 3), JSON blob fallback removed.",
      });
      return buildBlockMessage(
        "UC7-001: UC7KS 管线未启动",
        agent,
        "No uc7ks_pipeline_state rows found for this pipeline/agent. The UC7KS pipeline must be started before writes are allowed.",
        "Call module_scope_declare(module, task_id) → knowledge_cache_search(domain, task_id) → knowledge_cache_attest(domain, task_id, reason, files_read, content_summary).",
      );
    }

    if (unattestedDomains.length === 0) {
      return true; // All attested
    }

    // Domain(s) not attested
    if (!shouldBlock("knowledge-cache-miss")) {
      writeLog(SRC, "WARN", {
        event: "UC7KS-WRITE-WARN-UNATTESTED-DOMAINS",
        agent,
        sessionID: sessionId,
        taskId,
        detail: `audit-only policy: ${unattestedDomains.length} domains not attested: ${unattestedDomains.join(", ")}`,
      });
      return null;
    }

    // hard_block: BLOCK
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

// OPT-02 (2026-06-25): checkUC7KSFileLevelDomain (M11) removed.
// This function was dead code — never called by any consumer (0 callers verified).
// It read attestation status from the JSON blob via readCacheAttestation(),
// which was the last remaining JSON blob read path for domain attestation.
// The DB-canonical uc7ks_pipeline_state is the sole enforcement source.
