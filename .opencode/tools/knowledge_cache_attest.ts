/**
 * knowledge_cache_attest.ts — UC7-001 Read-Before-Write Attestation Tool
 * ═══════════════════════════════════════════════════════════════════
 * Phase 1 NEW (2026-06-18): Agent-submitted read evidence verification.
 *
 * This tool is called by agents AFTER they have:
 *   1. Called knowledge_cache_search (discovery)
 *   2. Used the `read` tool to open and review cache files
 *
 * It performs 6-step cross-verification before writing attestation:
 *   Step 1: discovery.status === "sufficient"
 *   Step 2: files_read ⊆ discovered_files
 *   Step 2.5: Cross-validate files_read against knowledge-store manifest (KC-07, non-fatal)
 *   Step 3: Cross-verify against read_audit.jsonl (context.sessionID)
 *   Step 4: reason + content_summary non-empty (agent-written)
 *   Step 5: Write attestation on success + non-fatal knowledge_attestation DB write (KC-07)
 *
 * Design: docs/review/framework-refactor/uc7ks-read-before-write-plan.md §2.3
 *
 * @author @Super-Admin
 * @version 1.3.0 — KC-07 (2026-06-21): Replaced direct file reads with knowledgeStore.searchByDomain()
 *   + readManifest() APIs. Added Step 2.5 (non-fatal manifest cross-validation). Added
 *   non-fatal knowledge_attestation DB table write after successful attestation.
 *   Preserved all read_audit verification logic and audit rollup calls.
 * @since 2026-06-18
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { readSubState } from "../lib/substate-manager";
import {
  readCacheDiscovery,
  writeCacheAttestation,
  type CacheDiscovery,
  type CacheAttestation,
  normalizeAgentKey,
} from "../lib/uc7ks-schema";
import { atomicWriteSubState } from "../lib/state-utils";
import { withInterruptGuard } from "../lib";
import { writeLog } from "../lib/log-manager";
import {
  getReadEventsForSession,
  normalizeReadAuditPath,
} from "../lib/read-audit";
import { incrementAuditCounter } from "../lib/knowledge-audit";
import { readManifest, searchByDomain } from "../lib/knowledge-store";
import { getDb } from "../lib/db-manager";

const SRC = "knowledge-cache-attest";

// ── Helpers ────────────────────────────────────────────────────
// Path normalization and audit log access now uses shared API:
//   normalizeReadAuditPath() + getReadEventsForSession() from ../lib/read-audit
// These replaced the previous inline readAuditLog() and normalizePathForAudit()
// as part of the read_audit.jsonl → SQLite migration (Phase 1).
// @see docs/review/framework-refactor/read-audit-db-migration-plan.md §5.3

// ── Main Tool ──────────────────────────────────────────────────

export default tool({
  description:
    "Agent-submitted read evidence attestation with self-declared cache sufficiency (M9). Verifies that the agent actually read the declared cache files (via read tool + read_audit cross-check). Writes status 'attested' (cache sufficient) or 'insufficient' (cache insufficient, writes BLOCKED). REQUIRED before writing source files in strict/locked mode (UC7-001 Phase 0+M3).\n\nM9 CACHE SUFFICIENCY: Prefix the `reason` parameter with '[INSUFFICIENT]' to declare cache insufficiency and BLOCK writes until re-attested. Omit the prefix (or use '[SUFFICIENT]') for normal sufficient-cache attestation. Example: reason='[INSUFFICIENT] Missing v11 Guard patterns' declares insufficiency.",
  args: {
    domain: tool.schema
      .string()
      .describe(
        "Domain ID to attest (e.g., 'opencode_framework', 'backend_api')",
      ),
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
    reason: tool.schema
      .string()
      .describe(
        "Agent-written reason: WHY these cache files are needed for the task. M9: prefix with '[INSUFFICIENT]' to declare cache insufficient and BLOCK writes until re-attested. Default (no prefix) = sufficient. E.g., '[INSUFFICIENT] Missing NestJS v11 guard docs' or just 'Need docs for implementation' (sufficient).",
      ),
    files_read: tool.schema
      .array(tool.schema.string())
      .describe(
        "List of cache file paths the agent ACTUALLY read (relative to docs/official_docs/, e.g. 'opencode/framework/plugins.md')",
      ),
    content_summary: tool.schema
      .string()
      .describe("Agent-written summary: WHAT was learned from the read files"),
  },

  async execute(args, context) {
    return withInterruptGuard("knowledge_cache_attest", async function () {
      var agent = (context && context.agent) || "unknown";
      var sessionId = (context && context.sessionID) || "";
      var agentRef = normalizeAgentKey(agent);
      var domain = args.domain;
      var taskId = args.task_id || "";
      var rawReason = (args.reason || "").trim();
      var filesRead: string[] = args.files_read || [];
      var contentSummary = (args.content_summary || "").trim();
      var attestedAt = new Date().toISOString();

      // M9 (2026-06-19): Agent self-declared cache sufficiency via reason prefix.
      // M9-FIX: Instead of adding cache_sufficient/insufficiency_reason to the
      // Zod schema (which the OpenCode runtime cache rejects with "is not
      // defined"), we use a prefix convention on the existing `reason` param:
      //   "[INSUFFICIENT] <reason>" → cacheSufficient = false
      //   "[SUFFICIENT] <reason>" or no prefix → cacheSufficient = true
      var SUFFICIENT_RE = /^\[SUFFICIENT\]\s*/i; // "i" for case-insensitive
      var INSUFFICIENT_RE = /^\[INSUFFICIENT\]\s*/i;
      var insufficiencyReason = "";
      var cacheSufficient = true;
      var reason = rawReason; // cleaned version for attestation

      if (INSUFFICIENT_RE.test(rawReason)) {
        cacheSufficient = false;
        reason = rawReason.replace(INSUFFICIENT_RE, "").trim();
        // Extract insufficiency reason from after the prefix
        insufficiencyReason = reason;
      } else {
        // Strip [SUFFICIENT] prefix if present (explicit sufficient declaration)
        reason = rawReason.replace(SUFFICIENT_RE, "").trim();
        cacheSufficient = true;
      }

      // ════════════════════════════════════════════════════
      // Step 1: Verify discovery exists and is sufficient
      // ════════════════════════════════════════════════════
      var kcs: any;
      try {
        kcs = readSubState("knowledge_cache_state");
      } catch (e: any) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          event: "UC7KS-ATTEST-FAIL-STATE",
          detail: `Cannot read knowledge_cache_state: ${e.message}`,
        });
        return JSON.stringify({
          attested: false,
          step: 1,
          error:
            "Cannot read knowledge_cache_state. Run knowledge_cache_search first.",
        });
      }

      var discovery = readCacheDiscovery(
        kcs?.session_access || {},
        agentRef,
        taskId,
        domain,
      );

      if (!discovery || discovery.status !== "sufficient") {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-DISCOVERY",
          detail: `discovery ${discovery?.status || "missing"}. Must call knowledge_cache_search first.`,
        });
        return JSON.stringify({
          attested: false,
          step: 1,
          error:
            "Discovery insufficient. Call knowledge_cache_search(" +
            domain +
            ", " +
            taskId +
            ") first.",
          discovery_status: discovery?.status || "missing",
        });
      }

      // ════════════════════════════════════════════════════
      // Step 2: Verify files_read ⊆ discovered_files
      // ════════════════════════════════════════════════════
      var discoveredSet = new Set(
        discovery.discovered_files.map(function (f) {
          return f.toLowerCase();
        }),
      );
      var invalidFiles: string[] = [];
      for (var i = 0; i < filesRead.length; i++) {
        var f = filesRead[i];
        // Try both relative (as-is) and docs-prefixed forms
        var normalized = f.toLowerCase();
        var withPrefix = ("docs/official_docs/" + normalized).toLowerCase();
        if (!discoveredSet.has(normalized) && !discoveredSet.has(withPrefix)) {
          invalidFiles.push(f);
        }
      }
      if (invalidFiles.length > 0) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-FILES",
          detail: `${invalidFiles.length} files not in discovered_files: ${invalidFiles.join(", ")}`,
        });
        return JSON.stringify({
          attested: false,
          step: 2,
          error:
            invalidFiles.length +
            " file(s) not in discovered_files. These files were NOT found by knowledge_cache_search for this domain.",
          invalid_files: invalidFiles,
          discovered_files: discovery.discovered_files,
        });
      }

      // ════════════════════════════════════════════════════
      // Step 2.5 (KC-07): Cross-validate files_read against
      // knowledge-store manifest entries for the declared domain.
      // Uses readManifest() + searchByDomain() from knowledge-store.ts.
      // NON-FATAL — logs warnings but does NOT block attestation.
      // This ensures the cached docs are indexed and discoverable.
      // ════════════════════════════════════════════════════
      var manifestPaths = new Set<string>();
      try {
        var manifest = readManifest();
        var domainEntries = searchByDomain(domain);
        for (var de = 0; de < domainEntries.length; de++) {
          var entry = domainEntries[de];
          for (var df = 0; df < (entry.files || []).length; df++) {
            var f = entry.files[df];
            if (f.path) {
              manifestPaths.add(f.path.toLowerCase());
            }
          }
        }
        writeLog(SRC, "INFO", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-MANIFEST-CHECK",
          detail: `domain=${domain} manifest_entries=${domainEntries.length} manifest_paths=${manifestPaths.size}`,
        });
      } catch (e: any) {
        // Non-fatal: manifest read failure logs a warning but does not block
        writeLog(SRC, "WARN", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-MANIFEST-FAILED",
          detail: `Cannot read knowledge manifest: ${e.message || String(e)}`,
        });
      }

      // Cross-check declared files against manifest paths (non-fatal)
      var unmatchedInManifest: string[] = [];
      for (var fi = 0; fi < filesRead.length; fi++) {
        var declaredF = filesRead[fi].toLowerCase();
        if (manifestPaths.size > 0 && !manifestPaths.has(declaredF)) {
          unmatchedInManifest.push(filesRead[fi]);
        }
      }
      if (unmatchedInManifest.length > 0) {
        writeLog(SRC, "WARN", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-MANIFEST-MISMATCH",
          detail: `${unmatchedInManifest.length} file(s) not found in knowledge-store manifest for domain "${domain}": ${unmatchedInManifest.join(", ")}`,
        });
      }

      // ════════════════════════════════════════════════════
      // Step 3: Cross-verify against read_audit (DB-first, JSONL fallback)
      // Uses shared read-audit API (getReadEventsForSession + normalizeReadAuditPath)
      // instead of direct JSONL reading. Phase 1: DB-first with JSONL fallback.
      // @see docs/review/framework-refactor/read-audit-db-migration-plan.md §5.3
      // ════════════════════════════════════════════════════
      if (!sessionId) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-SESSION",
          detail:
            "context.sessionID unavailable — cannot cross-verify read_audit",
        });
        return JSON.stringify({
          attested: false,
          step: 3,
          error:
            "Cannot verify read evidence: context.sessionID is not available. Attestation requires OpenCode session context.",
        });
      }

      // Use shared read-audit API (DB-first with JSONL fallback)
      var sessionEntries = getReadEventsForSession(agent, sessionId);

      // Collect all file paths the agent read in this session
      var readPaths = new Set<string>();
      for (var j = 0; j < sessionEntries.length; j++) {
        readPaths.add(normalizeReadAuditPath(sessionEntries[j].filePath));
      }

      // Check each declared file against the audit log
      var notRead: string[] = [];
      for (var k = 0; k < filesRead.length; k++) {
        var declared = filesRead[k];
        // Try matching with both forms (absolute vs relative from docs/official_docs/)
        var absDeclared = normalizeReadAuditPath(
          path.resolve(
            process.env.OPENCODE_ROOT || ".",
            "docs/official_docs",
            declared,
          ),
        );
        if (!readPaths.has(absDeclared)) {
          // Also try without the docs/official_docs prefix
          var shortDeclared = normalizeReadAuditPath(declared);
          if (!readPaths.has(shortDeclared)) {
            notRead.push(declared);
          }
        }
      }

      if (notRead.length > 0) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-AUDIT",
          detail: `${notRead.length} file(s) not found in read_audit for session ${sessionId}: ${notRead.join(", ")}`,
        });
        return JSON.stringify({
          attested: false,
          step: 3,
          error:
            notRead.length +
            " file(s) NOT actually read in this session. Use the 'read' tool to open these files first, then re-attest.",
          not_read: notRead,
          files_actually_read: Array.from(readPaths).slice(0, 20),
        });
      }

      // ════════════════════════════════════════════════════
      // Step 4: Verify reason + content_summary non-empty
      // M9: Also validate insufficiency_reason when cache_sufficient=false
      // ════════════════════════════════════════════════════
      var emptyFields: string[] = [];
      if (!reason || reason.length < 10)
        emptyFields.push(
          "reason (min 10 chars, got " + (reason?.length || 0) + ")",
        );
      if (!contentSummary || contentSummary.length < 10)
        emptyFields.push(
          "content_summary (min 10 chars, got " +
            (contentSummary?.length || 0) +
            ")",
        );
      // M9: When cache insufficient, the reason body (after [INSUFFICIENT] prefix)
      // serves as the insufficiency_reason and must be >= 10 chars.
      if (!cacheSufficient) {
        if (!insufficiencyReason || insufficiencyReason.length < 10) {
          emptyFields.push(
            "insufficiency_reason (min 10 chars after [INSUFFICIENT] prefix, got " +
              (insufficiencyReason?.length || 0) +
              ")",
          );
        }
      }
      // M9: Check retry limits
      var currentRetryCount = 0;
      var MAX_RETRIES = 3;
      if (!cacheSufficient) {
        try {
          var kcs2 = readSubState("knowledge_cache_state");
          var agentEntry2 = kcs2?.session_access?.[agentRef];
          if (agentEntry2?.tasks?.[taskId]?.domains?.[domain]?.attestation) {
            currentRetryCount =
              agentEntry2.tasks[taskId].domains[domain].attestation
                .retry_count || 0;
          }
        } catch (e: any) {
          /* ignore — first attempt */
        }
        if (currentRetryCount >= MAX_RETRIES) {
          return JSON.stringify({
            attested: false,
            step: 4,
            cache_sufficient: false,
            error:
              "Retry limit reached (" +
              MAX_RETRIES +
              "). Cannot re-request @Knowledge-Curator automatically. Human intervention required.",
            retry_count: currentRetryCount,
            max_retries: MAX_RETRIES,
            suggestion:
              "Please manually dispatch @Knowledge-Curator with specific documentation needs, or verify the cached docs cover your task.",
          });
        }
      }
      if (emptyFields.length > 0) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-EMPTY",
          detail: `Empty fields: ${emptyFields.join(", ")}`,
        });
        return JSON.stringify({
          attested: false,
          step: 4,
          error:
            "Reason and content_summary must be non-empty (min 10 chars each). Agent must write meaningful evidence.",
          empty_fields: emptyFields,
        });
      }

      // ════════════════════════════════════════════════════
      // Step 5: All checks passed — write attestation
      // M9: Status = "insufficient" when cache_sufficient=false
      //    Status = "attested" when cache_sufficient=true (default)
      // ════════════════════════════════════════════════════
      var attestationStatus = cacheSufficient ? "attested" : "insufficient";
      var attestation: CacheAttestation & {
        cache_sufficient?: boolean;
        insufficiency_reason?: string;
        retry_count?: number;
        max_retries?: number;
      } = {
        status: attestationStatus,
        reason: reason,
        files_read: filesRead,
        content_summary: contentSummary,
        attested_at: attestedAt,
      };
      if (cacheSufficient !== undefined) {
        attestation.cache_sufficient = cacheSufficient;
      }
      if (!cacheSufficient && insufficiencyReason) {
        attestation.insufficiency_reason = insufficiencyReason;
        attestation.retry_count = currentRetryCount + 1;
        attestation.max_retries = MAX_RETRIES;
      }

      var writeOk = false;
      try {
        writeOk = atomicWriteSubState(
          "knowledge_cache_state",
          function (state: any) {
            state.session_access = state.session_access || {};
            var ok = writeCacheAttestation(
              state.session_access,
              agentRef,
              taskId,
              domain,
              attestation as any,
            );
            if (!ok) {
              throw new Error(
                "writeCacheAttestation failed — discovery not sufficient",
              );
            }
            // M9: Persist retry_count for insufficiency tracking
            if (
              !cacheSufficient &&
              state.session_access[agentRef]?.tasks?.[taskId]?.domains?.[domain]
                ?.attestation
            ) {
              state.session_access[agentRef].tasks[taskId].domains[
                domain
              ].attestation.retry_count = currentRetryCount + 1;
              state.session_access[agentRef].tasks[taskId].domains[
                domain
              ].attestation.max_retries = MAX_RETRIES;
            }
          },
        );
      } catch (e: any) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-WRITE",
          detail: `Failed to write attestation: ${e.message}`,
        });
        // KC-02 (2026-06-21): Non-fatal — count write failure as attestation failure
        try {
          incrementAuditCounter("total_attestation_failures");
        } catch {}
        return JSON.stringify({
          attested: false,
          step: 5,
          error: "Failed to write attestation: " + e.message,
        });
      }

      // M9: Log appropriate event based on cache_sufficient
      if (cacheSufficient) {
        writeLog(SRC, "INFO", {
          sessionID: sessionId,
          agent,
          agentType: agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-PASS",
          detail: `taskId=${taskId} domainId=${domain} files=${filesRead.length} status=attested`,
        });
        // KC-02 (2026-06-21): Non-fatal audit rollup — count attestations
        try {
          incrementAuditCounter("total_attestations");
        } catch {}

        // KC-07 + A2 (v13 UPSERT): Non-fatal knowledge_attestation DB write
        // Records each attestation event in the knowledge_attestation table
        // for audit trail and analytics. Failure does NOT block attestation.
        //
        // A2: Replaced INSERT with UPSERT using v13 unique index on
        // (agent, task_id, domain_id). ON CONFLICT DO UPDATE ensures
        // idempotent re-runs: subsequent attestations for the same
        // agent+task+domain overwrite the previous record.
        // Monotonic: never downgrade from 'attested' to 'insufficient'.
        try {
          var db = getDb();
          db.run(
            `INSERT INTO knowledge_attestation
             (session_id, agent, task_id, domain_id, status, cache_sufficient, files_read, evidence_file_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(agent, task_id, domain_id) DO UPDATE SET
               session_id = excluded.session_id,
               status = CASE WHEN knowledge_attestation.status = 'attested'
                         THEN 'attested'
                         ELSE excluded.status END,
               cache_sufficient = excluded.cache_sufficient,
               files_read = excluded.files_read,
               evidence_file_count = excluded.evidence_file_count,
               created_at = excluded.created_at`,
            [
              sessionId || null,
              agent,
              taskId,
              domain,
              attestationStatus,
              cacheSufficient ? 1 : 0,
              JSON.stringify(filesRead),
              filesRead.length,
              Date.now(),
            ],
          );
          writeLog(SRC, "INFO", {
            sessionID: sessionId,
            agent,
            taskId,
            domainId: domain,
            event: "KC-ATTESTATION-DB-WRITTEN",
            detail: `taskId=${taskId} domainId=${domain} status=${attestationStatus} files=${filesRead.length}`,
          });
          // KC-08 (2026-06-21): Non-fatal audit rollup — count DB attestation writes
          try {
            incrementAuditCounter("total_attestations");
          } catch {}
        } catch (dbErr: any) {
          writeLog(SRC, "WARN", {
            sessionID: sessionId,
            agent,
            taskId,
            domainId: domain,
            event: "KC-ATTESTATION-DB-FAILED",
            detail: `Non-fatal: knowledge_attestation DB write failed: ${dbErr.message || String(dbErr)}`,
          });
        }

        return JSON.stringify({
          attested: true,
          step: 5,
          cache_sufficient: true,
          attestation: attestation,
          verified_files: filesRead,
          next_step:
            "Knowledge attestation complete. You may now write source files. Call compliance_gate_complete when task finishes.",
        });
      } else {
        writeLog(SRC, "WARN", {
          sessionID: sessionId,
          agent,
          agentType: agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-INSUFFICIENT",
          detail: `taskId=${taskId} domainId=${domain} retry=${currentRetryCount + 1}/${MAX_RETRIES} reason="${insufficiencyReason}"`,
        });
        // KC-02 (2026-06-21): Non-fatal audit rollup — count attestation failures
        try {
          incrementAuditCounter("total_attestation_failures");
        } catch {}
        return JSON.stringify({
          attested: false,
          step: 5,
          cache_sufficient: false,
          status: "insufficient",
          reason: insufficiencyReason,
          retry_count: currentRetryCount + 1,
          max_retries: MAX_RETRIES,
          error:
            "Cache self-declared insufficient. Writes are BLOCKED until re-attested with sufficient cache.",
          remediation:
            currentRetryCount + 1 < MAX_RETRIES
              ? "Dispatch @Knowledge-Curator to fetch missing docs, then re-read and re-attest (without [INSUFFICIENT] prefix)."
              : "Retry limit reached. Human intervention required to resolve cache insufficiency.",
          next_step:
            currentRetryCount + 1 < MAX_RETRIES
              ? "1. dispatch_subagent(@Knowledge-Curator, ...) 2. Re-read updated cache 3. knowledge_cache_attest(reason='...', ...) (omit [INSUFFICIENT] prefix)"
              : "Please manually dispatch @Knowledge-Curator or verify the cached documentation.",
        });
      }
    });
  },
});
