import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeAgentKey } from "../lib/uc7ks-schema";
import { withInterruptGuard } from "../lib";
import { writeLog } from "../lib/log-manager";
import { checklistWirePassed } from "../lib/checklist-hooks";
import {
  getReadEventsForSession,
  normalizeReadAuditPath,
} from "../lib/read-audit";
import { incrementAuditCounter } from "../lib/knowledge-audit";
import {
  resolvePipelineId,
  readDiscoveryForAttest,
  atomicUpsertAttestation,
} from "../lib/uc7ks-pipeline-db";
import { readManifest, searchByDomain } from "../lib/knowledge-store";

const SRC = "knowledge-cache-attest";

// ── Helpers ────────────────────────────────────────────────────
// BUN-CACHE-VERSION: 2026-06-23T11:06:00Z — force Bun recompilation
// Path normalization and audit log access now uses shared API:
//   normalizeReadAuditPath() + getReadEventsForSession() from ../lib/read-audit
// These replaced the previous inline readAuditLog() and normalizePathForAudit()
// as part of the read_audit JSONL → SQLite migration (Phase 1 — completed).
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
        "NON-EMPTY list of cache file paths the agent ACTUALLY read (relative to docs/official_docs/, e.g. 'opencode/framework/plugins.md'). Empty array [] will be rejected by Step 1.5 validation.",
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
      var domainId = args.domain;
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
      // DB-Canonical (v19 Phase 2): uc7ks_pipeline_state is the sole source.
      // JSON blob fallback removed.
      // ════════════════════════════════════════════════════
      const pipelineId = resolvePipelineId(args, sessionId);

      var discovery = readDiscoveryForAttest({
        pipelineId,
        agent,
        domainId: domainId,
      });

      if (!discovery || discovery.status !== "sufficient") {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domainId,
          event: "UC7KS-ATTEST-FAIL-DISCOVERY",
          detail: `discovery ${discovery?.status || "missing"}. Must call knowledge_cache_search first.`,
        });
        return JSON.stringify({
          attested: false,
          step: 1,
          error:
            "Discovery insufficient. Call knowledge_cache_search(" +
            domainId +
            ", " +
            taskId +
            ") first.",
          discovery_status: discovery?.status || "missing",
        });
      }

      // ════════════════════════════════════════════════════
      // Step 1.5 (FW-FIX-EMPTY-FILES-READ): Reject empty files_read array
      // M11 + M3-HARDEN (2026-06-21): An empty files_read array means the agent
      // did NOT actually read any cache files. This MUST be rejected to prevent
      // attestation bypass. The agent must use the `read` tool on at least one
      // discovered cache file before attestation.
      // ════════════════════════════════════════════════════
      if (!filesRead || filesRead.length === 0) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domainId,
          event: "UC7KS-ATTEST-FAIL-EMPTY-FILES",
          detail:
            "files_read is empty. Agent must read at least one cache file via 'read' tool before attesting.",
        });
        return JSON.stringify({
          attested: false,
          step: "1.5",
          error:
            "files_read is empty or missing. You MUST read at least one cache file (via the 'read' tool) from the discovered_files list before calling knowledge_cache_attest. An empty array is invalid — it indicates no documentation was actually reviewed.",
          cache_sufficient: false,
          remediation:
            "Step 1: Use the 'read' tool to open relevant cache files from discovered_files.\nStep 2: knowledge_cache_attest(domain='" +
            domainId +
            "', task_id='" +
            taskId +
            "', reason='...', files_read=[...], content_summary='...')",
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
          domainId: domainId,
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
        var domainEntries = searchByDomain(domainId);
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
          domainId: domainId,
          event: "UC7KS-ATTEST-MANIFEST-CHECK",
          detail: `domain=${domainId} manifest_entries=${domainEntries.length} manifest_paths=${manifestPaths.size}`,
        });
      } catch (e: any) {
        // Non-fatal: manifest read failure logs a warning but does not block
        writeLog(SRC, "WARN", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domainId,
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
          domainId: domainId,
          event: "UC7KS-ATTEST-MANIFEST-MISMATCH",
          detail: `${unmatchedInManifest.length} file(s) not found in knowledge-store manifest for domain "${domainId}": ${unmatchedInManifest.join(", ")}`,
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
          domainId: domainId,
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
          domainId: domainId,
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
      // M9: Retry limit check — query DB-canonical attestation status
      var currentRetryCount = 0;
      var MAX_RETRIES = 3;
      if (!cacheSufficient) {
        // DB-Canonical: query uc7ks_pipeline_state for attestation count
        // (retry tracking moved to DB in Phase 2)
        try {
          const { readPipelineState } = require("../lib/uc7ks-pipeline-db");
          const state = readPipelineState({
            pipelineId,
            agent,
            domainId: domainId,
          });
          if (state?.attestation_status === "insufficient") {
            currentRetryCount = 1; // at least one prior insufficient attestation
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
          domainId: domainId,
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
      // DB-Canonical (v19 Phase 2): uc7ks_pipeline_state is the sole writable source.
      // JSON blob (knowledge_cache_state) and v11 typed table
      // (knowledge_attestation) writes removed.
      // ════════════════════════════════════════════════════
      var attestationStatus = cacheSufficient ? "attested" : "insufficient";
      var writeOk = false;
      try {
        writeOk = atomicUpsertAttestation({
          pipelineId,
          agent,
          domainId: domainId,
          sessionId,
          attestation: {
            status: attestationStatus,
            cache_sufficient: cacheSufficient,
            files_read: filesRead,
            content_summary: args.content_summary || "",
            attested_at: Date.now(),
          },
        });
      } catch (e: any) {
        writeLog(SRC, "ERROR", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domainId,
          event: "UC7KS-ATTEST-FAIL-WRITE",
          detail: `Failed to write attestation to DB: ${e.message}`,
        });
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
          taskId,
          domainId: domainId,
          event: "UC7KS-ATTEST-PASS",
          detail: `taskId=${taskId} domainId=${domainId} files=${filesRead.length} status=attested`,
        });
        // KC-02 (2026-06-21): Non-fatal audit rollup — count attestations
        try {
          incrementAuditCounter("total_attestations");
        } catch {}

        // P0-CHECKLIST: wire attestation success to checklist
        try {
          checklistWirePassed(
            sessionId,
            agent,
            taskId,
            "knowledge_attested",
            JSON.stringify({ files: filesRead.length, domain: domainId }),
          );
        } catch {
          /* non-fatal */
        }

        return JSON.stringify({
          attested: true,
          step: 5,
          cache_sufficient: true,
          verified_files: filesRead,
          next_step:
            "Knowledge attestation complete. You may now write source files. Call compliance_gate_complete when task finishes.",
        });
      } else {
        writeLog(SRC, "WARN", {
          sessionID: sessionId,
          agent,
          taskId,
          domainId: domainId,
          event: "UC7KS-ATTEST-INSUFFICIENT",
          detail: `taskId=${taskId} domainId=${domainId} retry=${currentRetryCount + 1}/${MAX_RETRIES} reason="${insufficiencyReason}"`,
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
