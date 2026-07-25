// service/knowledge/cache-attest.ts — Knowledge Cache Attestation Service
// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Extracted from tools/knowledge_cache_attest.ts (650L).
// 10+ step verification pipeline for agent read-evidence attestation.

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { getRuleDisposition } from "../enforcement/rule-disposition";
import { normalizeAgentKey } from "./schema";
import {
  checklistWirePassed,
  checklistWireFailed,
} from "../../lib/checklist-hooks";
import {
  getReadEventsForSession,
  normalizeReadAuditPath,
} from "../../lib/read-audit";
import {
  resolvePipelineId,
  readDiscoveryForAttest,
  atomicUpsertAttestation,
  readPipelineState,
} from "./pipeline-db";
import { incrementAuditCounter } from "./audit";
import { readManifest, searchByDomain } from "./search-add";

const SRC = "knowledge-cache-attest-svc";
const MAX_RETRIES = 3;

// ── Types ────────────────────────────────────────────────────────────

export interface AttestCacheInput {
  agent: string;
  sessionId: string;
  domain: string;
  taskId: string;
  reason: string;
  filesRead: string[];
  contentSummary: string;
}

export interface AttestCacheResult {
  attested: boolean;
  step: number | string;
  cache_sufficient?: boolean;
  error?: string;
  [key: string]: any;
}

// ── Service Function ─────────────────────────────────────────────────

export function attestCache(input: AttestCacheInput): AttestCacheResult {
  const { agent, sessionId, domain: domainId, taskId } = input;
  const filesRead: string[] = input.filesRead || [];
  const contentSummary = (input.contentSummary || "").trim();
  const rawReason = (input.reason || "").trim();

  // ── M9: Parse reason prefix ──
  const SUFFICIENT_RE = /^\[SUFFICIENT\]\s*/i;
  const INSUFFICIENT_RE = /^\[INSUFFICIENT\]\s*/i;
  let cacheSufficient = true;
  let reason = rawReason;
  let insufficiencyReason = "";

  if (INSUFFICIENT_RE.test(rawReason)) {
    cacheSufficient = false;
    reason = rawReason.replace(INSUFFICIENT_RE, "").trim();
    insufficiencyReason = reason;
  } else {
    reason = rawReason.replace(SUFFICIENT_RE, "").trim();
  }

  const pipelineId = resolvePipelineId({ task_id: taskId }, sessionId);

  // ── Step 1: Verify discovery exists and is sufficient ──
  const discovery = readDiscoveryForAttest({ pipelineId, agent, domainId });
  if (!discovery || discovery.status !== "sufficient") {
    writeLog(SRC, "ERROR", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-FAIL-DISCOVERY",
      detail: `discovery ${discovery?.status || "missing"}. Must call knowledge_cache_search first.`,
    });
    return {
      attested: false, step: 1,
      error: `Discovery insufficient. Call knowledge_cache_search(${domainId}, ${taskId}) first.`,
      discovery_status: discovery?.status || "missing",
    };
  }

  // ── Step 1.5: Reject empty files_read ──
  if (!filesRead || filesRead.length === 0) {
    writeLog(SRC, "ERROR", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-FAIL-EMPTY-FILES",
      detail: "files_read is empty.",
    });
    return {
      attested: false, step: "1.5",
      error: "files_read is empty. You MUST read at least one cache file via the 'read' tool before calling knowledge_cache_attest.",
      cache_sufficient: false,
      remediation: `Step 1: Use 'read' tool. Step 2: knowledge_cache_attest(domain='${domainId}', task_id='${taskId}', ...)`,
    };
  }

  // ── Step 2: Verify files_read ⊆ discovered_files ──
  const discoveredSet = new Set(discovery.discovered_files.map(f => f.toLowerCase()));
  const invalidFiles: string[] = [];
  for (const f of filesRead) {
    const normalized = f.toLowerCase();
    const withPrefix = ("docs/official_docs/" + normalized).toLowerCase();
    if (!discoveredSet.has(normalized) && !discoveredSet.has(withPrefix)) {
      invalidFiles.push(f);
    }
  }
  if (invalidFiles.length > 0) {
    writeLog(SRC, "ERROR", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-FAIL-FILES",
      detail: `${invalidFiles.length} files not in discovered_files`,
    });
    return {
      attested: false, step: 2,
      error: `${invalidFiles.length} file(s) not in discovered_files.`,
      invalid_files: invalidFiles,
      discovered_files: discovery.discovered_files,
    };
  }

  // ── Step 2.5: Cross-validate against manifest (non-fatal) ──
  const manifestPaths = new Set<string>();
  try {
    const manifest = readManifest();
    const domainEntries = searchByDomain(domainId);
    for (const entry of domainEntries) {
      for (const f of (entry.files || [])) {
        if (entry.library_id) manifestPaths.add(entry.library_id.toLowerCase());
      }
    }
    writeLog(SRC, "INFO", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-MANIFEST-CHECK",
      detail: `domain=${domainId} manifest_entries=${domainEntries.length} manifest_paths=${manifestPaths.size}`,
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-MANIFEST-FAILED",
      detail: `Cannot read knowledge manifest: ${e.message || String(e)}`,
    });
  }

  const unmatchedInManifest: string[] = [];
  for (const f of filesRead) {
    const declared = f.toLowerCase();
    if (manifestPaths.size > 0 && !manifestPaths.has(declared)) {
      unmatchedInManifest.push(f);
    }
  }
  if (unmatchedInManifest.length > 0) {
    writeLog(SRC, "WARN", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-MANIFEST-MISMATCH",
      detail: `${unmatchedInManifest.length} file(s) not in manifest for "${domainId}"`,
    });
  }

  // ── Step 3: Cross-verify against read_audit ──
  if (!sessionId) {
    return {
      attested: false, step: 3,
      error: "Cannot verify read evidence: context.sessionID is not available.",
    };
  }

  const sessionEntries = getReadEventsForSession(agent, sessionId);
  const readPaths = new Set<string>();
  for (const e of sessionEntries) {
    readPaths.add(normalizeReadAuditPath(e.filePath));
  }

  const notRead: string[] = [];
  for (const declared of filesRead) {
    const absDeclared = normalizeReadAuditPath(
      path.resolve(process.env.OPENCODE_ROOT || ".", "docs/official_docs", declared),
    );
    if (!readPaths.has(absDeclared)) {
      const shortDeclared = normalizeReadAuditPath(declared);
      if (!readPaths.has(shortDeclared)) {
        notRead.push(declared);
      }
    }
  }

  if (notRead.length > 0) {
    writeLog(SRC, "ERROR", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-FAIL-AUDIT",
      detail: `${notRead.length} file(s) not in read_audit`,
    });
    return {
      attested: false, step: 3,
      error: `${notRead.length} file(s) NOT actually read. Use 'read' tool first.`,
      not_read: notRead,
      files_actually_read: Array.from(readPaths).slice(0, 20),
    };
  }

  // ── Step 4: Validate fields + retry limit ──
  const emptyFields: string[] = [];
  if (!reason || reason.length < 10)
    emptyFields.push(`reason (min 10 chars, got ${reason?.length || 0})`);
  if (!contentSummary || contentSummary.length < 10)
    emptyFields.push(`content_summary (min 10 chars, got ${contentSummary?.length || 0})`);
  if (!cacheSufficient && (!insufficiencyReason || insufficiencyReason.length < 10)) {
    emptyFields.push(`insufficiency_reason (min 10 chars after [INSUFFICIENT] prefix, got ${insufficiencyReason?.length || 0})`);
  }

  let currentRetryCount = 0;
  if (!cacheSufficient) {
    try {
      const state = readPipelineState({ pipelineId, agent, domainId });
      if (state?.attestation_status === "insufficient") currentRetryCount = 1;
    } catch { /* first attempt */ }
    if (currentRetryCount >= MAX_RETRIES) {
      return {
        attested: false, step: 4, cache_sufficient: false,
        error: `Retry limit reached (${MAX_RETRIES}). Human intervention required.`,
        retry_count: currentRetryCount, max_retries: MAX_RETRIES,
      };
    }
  }

  if (emptyFields.length > 0) {
    return {
      attested: false, step: 4,
      error: "Reason and content_summary must be non-empty (min 10 chars each).",
      empty_fields: emptyFields,
    };
  }

  // ── Step 4.5: Mandatory knowledge check (错题集) ──
  try {
    const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.resolve(projectRoot, ".opencode", "project.config.json");
    if (fs.existsSync(configPath)) {
      const pc = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const mk = pc.mandatory_knowledge;
      if (mk) {
        let mandatoryForDomain: string[] = [];
        if (mk.domains && typeof mk.domains === "object") {
          mandatoryForDomain = mk.domains[domainId] || [];
        } else if (mk.files && Array.isArray(mk.files) && mk.files.length > 0) {
          const applyDomains = mk.apply_to_domains || [];
          if (applyDomains.length === 0 || applyDomains.indexOf(domainId) >= 0) {
            mandatoryForDomain = mk.files;
          }
        }
        if (mandatoryForDomain.length > 0) {
          const mandatoryEnabled = mk.enabled !== false;
          const enforcedByRule = mk.enforced_by_rule || "knowledge-cache-miss";
          if (mandatoryEnabled) {
            const missingFiles: string[] = [];
            for (const mf of mandatoryForDomain) {
              if (!filesRead.some(f => f.indexOf(mf) >= 0 || f === mf)) {
                missingFiles.push(mf);
              }
            }
            if (missingFiles.length > 0) {
              writeLog(SRC, "ERROR", {
                sessionID: sessionId, agent, taskId, domainId,
                event: "UC7KS-ATTEST-FAIL-MANDATORY",
                detail: `Missing mandatory files: ${missingFiles.join(", ")}`,
              });
              try {
                checklistWireFailed(sessionId, agent, taskId,
                  "mistake_precautions_read",
                  `Missing mandatory files: ${missingFiles.join(", ")}`,
                  `Read the files and re-attest: ${missingFiles.join(", ")}`);
              } catch {}
              return {
                attested: false, step: "4.5",
                error: "MANDATORY_KNOWLEDGE_MISSING",
                missing_files: missingFiles,
                mandatory_total: mandatoryForDomain.length,
                enforcement_rule: enforcedByRule,
                remediation: `Read these files first:\n  - ${missingFiles.join("\n  - ")}`,
              };
            }
            try {
              checklistWirePassed(sessionId, agent, taskId,
                "mistake_precautions_read",
                JSON.stringify({ files: mandatoryForDomain.length, enforcement_rule: enforcedByRule }));
            } catch {}
          }
        }
      }
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      sessionID: sessionId, agent,
      event: "UC7KS-MANDATORY-CHECK-FAILED",
      detail: e.message || String(e),
    });
  }

  // ── Step 5: Write attestation ──
  const attestationStatus = cacheSufficient ? "attested" : "insufficient";
  try {
    const writeOk = atomicUpsertAttestation({
      pipelineId, agent, domainId, sessionId,
      attestation: {
        status: attestationStatus,
        cache_sufficient: cacheSufficient,
        files_read: filesRead,
        content_summary: input.contentSummary || "",
        attested_at: Date.now(),
      },
    });
    if (!writeOk) throw new Error("atomicUpsertAttestation returned false");
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-FAIL-WRITE",
      detail: `Failed to write attestation: ${e.message}`,
    });
    try { incrementAuditCounter("total_attestation_failures"); } catch {}
    return { attested: false, step: 5, error: `Failed to write attestation: ${e.message}` };
  }

  // ── Success/insufficient logging + audit ──
  if (cacheSufficient) {
    writeLog(SRC, "INFO", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-PASS",
      detail: `taskId=${taskId} domainId=${domainId} files=${filesRead.length} status=attested`,
    });
    try { incrementAuditCounter("total_attestations"); } catch {}
    try {
      checklistWirePassed(sessionId, agent, taskId, "knowledge_attested",
        JSON.stringify({ files: filesRead.length, domain: domainId }));
    } catch {}
    return {
      attested: true, step: 5, cache_sufficient: true,
      verified_files: filesRead,
      next_step: "Knowledge attestation complete. You may now write source files.",
    };
  } else {
    writeLog(SRC, "WARN", {
      sessionID: sessionId, agent, taskId, domainId,
      event: "UC7KS-ATTEST-INSUFFICIENT",
      detail: `retry=${currentRetryCount + 1}/${MAX_RETRIES} reason="${insufficiencyReason}"`,
    });
    try { incrementAuditCounter("total_attestation_failures"); } catch {}
    return {
      attested: false, step: 5, cache_sufficient: false,
      status: "insufficient", reason: insufficiencyReason,
      retry_count: currentRetryCount + 1, max_retries: MAX_RETRIES,
      error: "Cache self-declared insufficient. Writes BLOCKED until re-attested.",
      remediation: currentRetryCount + 1 < MAX_RETRIES
        ? "Dispatch @Knowledge-Curator, re-read, re-attest (without [INSUFFICIENT] prefix)."
        : "Retry limit reached. Human intervention required.",
    };
  }
}
