/**
 * knowledge_cache_attest.ts — UC7-001 Read-Before-Write Attestation Tool
 * ═══════════════════════════════════════════════════════════════════
 * Phase 1 NEW (2026-06-18): Agent-submitted read evidence verification.
 *
 * This tool is called by agents AFTER they have:
 *   1. Called knowledge_cache_search (discovery)
 *   2. Used the `read` tool to open and review cache files
 *
 * It performs 5-step cross-verification before writing attestation:
 *   Step 1: discovery.status === "sufficient"
 *   Step 2: files_read ⊆ discovered_files
 *   Step 3: Cross-verify against read_audit.jsonl (context.sessionID)
 *   Step 4: reason + content_summary non-empty (agent-written)
 *   Step 5: Write attestation on success
 *
 * Design: docs/review/framework-refactor/uc7ks-read-before-write-plan.md §2.3
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-18
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  readSubState,
} from "../lib/substate-manager";
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
    "Agent-submitted read evidence attestation with self-declared cache sufficiency (M9). Verifies that the agent actually read the declared cache files (via read tool + read_audit cross-check). Writes status 'attested' (cache_sufficient=true) or 'insufficient' (cache_sufficient=false). 'insufficient' blocks all writes until re-attested. REQUIRED before writing source files in strict/locked mode (UC7-001 Phase 0+M3).",
  args: {
    domain: tool.schema
      .string()
      .describe("Domain ID to attest (e.g., 'opencode_framework', 'backend_api')"),
    task_id: tool.schema
      .string()
      .describe("DAG task ID for session tracking"),
    reason: tool.schema
      .string()
      .describe("Agent-written reason: WHY these cache files are needed for the task"),
    files_read: tool.schema
      .array(tool.schema.string())
      .describe("List of cache file paths the agent ACTUALLY read (relative to docs/official_docs/, e.g. 'opencode/framework/plugins.md')"),
    content_summary: tool.schema
      .string()
      .describe("Agent-written summary: WHAT was learned from the read files"),
    cache_sufficient: tool.schema
      .boolean()
      .optional()
      .describe("M9 (2026-06-19): Agent's own judgment — are the cached docs SUFFICIENT for this task? true = sufficient (attested), false = insufficient (BLOCK writes until re-attested). Defaults to true for backward compatibility."),
    insufficiency_reason: tool.schema
      .string()
      .optional()
      .describe("M9: REQUIRED when cache_sufficient=false. Agent-written reason why cache is insufficient (min 10 chars). E.g., 'Cache has NestJS v10 patterns but task needs v11 Guard patterns.'"),
  },

  async execute(args, context) {
    return withInterruptGuard("knowledge_cache_attest", async function () {
      var agent = (context && context.agent) || "unknown";
      var sessionId = (context && context.sessionID) || "";
      var agentRef = normalizeAgentKey(agent);
      var domain = args.domain;
      var taskId = args.task_id || "";
      var reason = (args.reason || "").trim();
      var filesRead: string[] = args.files_read || [];
      var contentSummary = (args.content_summary || "").trim();
      var attestedAt = new Date().toISOString();
      // M9 (2026-06-19): Agent self-declared cache sufficiency
      var cacheSufficient = args.cache_sufficient !== false; // default true for backward compat
      var insufficiencyReason = (args.insufficiency_reason || "").trim();

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
          error: "Cannot read knowledge_cache_state. Run knowledge_cache_search first.",
        });
      }

      var discovery = readCacheDiscovery(
        kcs?.session_access || {},
        agentRef,
        taskId,
        domain
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
          error: "Discovery insufficient. Call knowledge_cache_search(" + domain + ", " + taskId + ") first.",
          discovery_status: discovery?.status || "missing",
        });
      }

      // ════════════════════════════════════════════════════
      // Step 2: Verify files_read ⊆ discovered_files
      // ════════════════════════════════════════════════════
      var discoveredSet = new Set(discovery.discovered_files.map(function (f) { return f.toLowerCase(); }));
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
          error: invalidFiles.length + " file(s) not in discovered_files. These files were NOT found by knowledge_cache_search for this domain.",
          invalid_files: invalidFiles,
          discovered_files: discovery.discovered_files,
        });
      }

      // ════════════════════════════════════════════════════
      // Step 3: Cross-verify against read_audit (DB-first, JSONL fallback)
      // Uses shared read-audit API (getReadEventsForSession + normalizeReadAuditPath)
      // instead of direct JSONL reading. Phase 1: DB-first with JSONL fallback.
      // @see docs/review/framework-refactor/read-audit-db-migration-plan.md §5.3
      // ════════════════════════════════════════════════════════
      if (!sessionId) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-SESSION",
          detail: "context.sessionID unavailable — cannot cross-verify read_audit",
        });
        return JSON.stringify({
          attested: false,
          step: 3,
          error: "Cannot verify read evidence: context.sessionID is not available. Attestation requires OpenCode session context.",
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
        var absDeclared = normalizeReadAuditPath(path.resolve(
          process.env.OPENCODE_ROOT || ".",
          "docs/official_docs",
          declared
        ));
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
          error: notRead.length + " file(s) NOT actually read in this session. Use the 'read' tool to open these files first, then re-attest.",
          not_read: notRead,
          files_actually_read: Array.from(readPaths).slice(0, 20),
        });
      }

      // ════════════════════════════════════════════════════
      // Step 4: Verify reason + content_summary non-empty
      // M9: Also validate insufficiency_reason when cache_sufficient=false
      // ════════════════════════════════════════════════════
      var emptyFields: string[] = [];
      if (!reason || reason.length < 10) emptyFields.push("reason (min 10 chars, got " + (reason?.length || 0) + ")");
      if (!contentSummary || contentSummary.length < 10) emptyFields.push("content_summary (min 10 chars, got " + (contentSummary?.length || 0) + ")");
      // M9: Validate insufficiency_reason when cache_sufficient=false
      if (!cacheSufficient) {
        if (!insufficiencyReason || insufficiencyReason.length < 10) {
          emptyFields.push("insufficiency_reason (min 10 chars, REQUIRED when cache_sufficient=false, got " + (insufficiencyReason?.length || 0) + ")");
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
            currentRetryCount = agentEntry2.tasks[taskId].domains[domain].attestation.retry_count || 0;
          }
        } catch (e: any) { /* ignore — first attempt */ }
        if (currentRetryCount >= MAX_RETRIES) {
          return JSON.stringify({
            attested: false,
            step: 4,
            cache_sufficient: false,
            error: "Retry limit reached (" + MAX_RETRIES + "). Cannot re-request @Knowledge-Curator automatically. Human intervention required.",
            retry_count: currentRetryCount,
            max_retries: MAX_RETRIES,
            suggestion: "Please manually dispatch @Knowledge-Curator with specific documentation needs, or verify the cached docs cover your task.",
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
          error: "Reason and content_summary must be non-empty (min 10 chars each). Agent must write meaningful evidence.",
          empty_fields: emptyFields,
        });
      }

      // ════════════════════════════════════════════════════
      // Step 5: All checks passed — write attestation
      // M9: Status = "insufficient" when cache_sufficient=false
      //    Status = "attested" when cache_sufficient=true (default)
      // ════════════════════════════════════════════════════
      var attestationStatus = cacheSufficient ? "attested" : "insufficient";
      var attestation: CacheAttestation & { cache_sufficient?: boolean; insufficiency_reason?: string; retry_count?: number; max_retries?: number } = {
        status: attestationStatus,
        reason: reason,
        files_read: filesRead,
        content_summary: contentSummary,
        attested_at: attestedAt,
      };
      if (cache_sufficient !== undefined) {
        attestation.cache_sufficient = cacheSufficient;
      }
      if (!cacheSufficient && insufficiencyReason) {
        attestation.insufficiency_reason = insufficiencyReason;
        attestation.retry_count = currentRetryCount + 1;
        attestation.max_retries = MAX_RETRIES;
      }

      var writeOk = false;
      try {
        writeOk = atomicWriteSubState("knowledge_cache_state", function (state: any) {
          state.session_access = state.session_access || {};
          var ok = writeCacheAttestation(state.session_access, agentRef, taskId, domain, attestation as any);
          if (!ok) {
            throw new Error("writeCacheAttestation failed — discovery not sufficient");
          }
          // M9: Persist retry_count for insufficiency tracking
          if (!cacheSufficient && state.session_access[agentRef]?.tasks?.[taskId]?.domains?.[domain]?.attestation) {
            state.session_access[agentRef].tasks[taskId].domains[domain].attestation.retry_count = currentRetryCount + 1;
            state.session_access[agentRef].tasks[taskId].domains[domain].attestation.max_retries = MAX_RETRIES;
          }
        });
      } catch (e: any) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domain,
          event: "UC7KS-ATTEST-FAIL-WRITE",
          detail: `Failed to write attestation: ${e.message}`,
        });
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
        return JSON.stringify({
          attested: true,
          step: 5,
          cache_sufficient: true,
          attestation: attestation,
          verified_files: filesRead,
          next_step: "Knowledge attestation complete. You may now write source files. Call compliance_gate_complete when task finishes.",
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
        return JSON.stringify({
          attested: false,
          step: 5,
          cache_sufficient: false,
          status: "insufficient",
          reason: insufficiencyReason,
          retry_count: currentRetryCount + 1,
          max_retries: MAX_RETRIES,
          error: "Cache self-declared insufficient. Writes are BLOCKED until re-attested with cache_sufficient=true.",
          remediation: (currentRetryCount + 1) < MAX_RETRIES
            ? "Dispatch @Knowledge-Curator to fetch missing docs, then re-read and re-attest with cache_sufficient=true."
            : "Retry limit reached. Human intervention required to resolve cache insufficiency.",
          next_step: (currentRetryCount + 1) < MAX_RETRIES
            ? "1. dispatch_subagent(@Knowledge-Curator, ...) 2. Re-read updated cache 3. knowledge_cache_attest(cache_sufficient=true, ...)"
            : "Please manually dispatch @Knowledge-Curator or verify the cached documentation.",
        });
      }
    });
  },
});
