// service/knowledge/cache-search.ts — Knowledge Cache Search Service
// ═══════════════════════════════════════════════════════════════════
// Phase 2: Extracted from tools/knowledge_cache_search.ts (385L).
// Pipeline validation + manifest search + DB writes + audit.

import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../../lib/tolerant-json";
import { writeLog } from "../../lib/log-manager";
import {
  readManifest,
  searchByTags,
  searchByDomain,
} from "./search-add";
import { readManifestFromDb } from "./manifest";
import type { KnowledgeManifest } from "./types-paths";
import {
  resolvePipelineId,
  atomicUpsertDiscovery,
  readPipelineState,
} from "./pipeline-db";
import {
  incrementAuditCounter,
  touchCacheCheck,
} from "./audit";
import { checklistWirePassed } from "../../lib/checklist-hooks";

const SRC = "knowledge-cache-search-svc";

// ── Types ────────────────────────────────────────────────────────────

export interface SearchCacheInput {
  domain: string;
  taskId: string;
  agent: string;
  sessionId?: string;
}

export interface SearchCacheResult {
  cache_available: boolean;
  total_entries?: number;
  search_domain: string;
  hits: number;
  hit_entries?: any[];
  discovery?: any;
  cache_sufficiency?: any;
  uc7_001_recorded?: boolean;
  next_step?: string;
  error?: string;
}

// ── Service Function ─────────────────────────────────────────────────

export function searchCache(input: SearchCacheInput): SearchCacheResult {
  const { domain, taskId, agent, sessionId } = input;
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();

  // ── Pipeline chain validation (DB-canonical) ──
  let pipelineValid = true;
  try {
    const pipelineId = resolvePipelineId({ task_id: taskId }, sessionId);
    const pipelineRow = readPipelineState({ pipelineId, agent, domainId: domain });
    if (!pipelineRow || pipelineRow.discovery_status === "undeclared") {
      pipelineValid = false;
      writeLog(SRC, "INFO", {
        event: "UC7KS-PIPELINE-NOT-DECLARED",
        detail: `Domain ${domain} not declared for pipeline_id=${pipelineId} agent=${agent}.`,
      });
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "UC7KS-PIPELINE-VALIDATION-DB-FAIL",
      detail: `DB validation failed (${e.message}) — allowing search to proceed`,
    });
  }

  if (!pipelineValid && taskId) {
    return {
      cache_available: true,
      search_domain: domain || "all",
      hits: 0,
      error: `Pipeline chain broken: module_scope_declare must be called first with same task_id (${taskId}) and domain (${domain}).`,
      next_step: `Call module_scope_declare(module: "${domain}", task_id: "${taskId}") first.`,
    };
  }

  // ── Read manifest ──
  const indexPath = path.resolve(projectRoot, "docs", "official_docs", "index.json");
  if (!fs.existsSync(indexPath)) {
    return {
      cache_available: false,
      search_domain: domain || "all",
      hits: 0,
      next_step: "Cache not initialized. Request @Knowledge-Curator.",
    };
  }

  let manifest: KnowledgeManifest;
  try {
    manifest = readManifestFromDb() ?? readManifest();
    if (!manifest || !Array.isArray(manifest.entries)) {
      return {
        cache_available: false,
        search_domain: domain || "all",
        hits: 0,
        error: "Malformed index.json (via knowledge-store)",
        next_step: "Rebuild via @Knowledge-Curator.",
      };
    }
  } catch {
    return {
      cache_available: false,
      search_domain: domain || "all",
      hits: 0,
      error: "Read error (via knowledge-store)",
      next_step: "Cannot read index.json.",
    };
  }

  // ── Domain keywords from config ──
  const configPath = path.resolve(projectRoot, ".opencode", "project.config.json");
  let domainKeywords: string[] = [];
  try {
    if (fs.existsSync(configPath)) {
      const config = tolerantParse(fs.readFileSync(configPath, "utf8"));
      const domains = config.knowledge_semantic_map?.domains || [];
      for (const d of domains) {
        if (d.domain_id === domain) {
          domainKeywords = d.keywords || [];
          break;
        }
      }
    }
  } catch { /* non-fatal */ }

  writeLog(SRC, "INFO", {
    event: "KC-SEARCH-VIA-STORE",
    detail: `store-based search domain=${domain || "all"} tags=[${domainKeywords.join(",")}]`,
    task_id: taskId,
    domain,
  });

  // ── Build search results ──
  const hitEntries: Array<{ library_id: string; topic: string; tags: string[]; cached_files: string[] }> = [];
  const entries = manifest.entries;

  if (!domain) {
    for (const e of entries) {
      hitEntries.push({
        library_id: e.library_id,
        topic: e.query_topic,
        tags: e.tags || [],
        cached_files: (e.files || []).map((f: any) => f.path),
      });
    }
  } else {
    const seen = new Set<string>();
    try {
      const domainResults = searchByDomain(domain);
      for (const e of domainResults) {
        const key = `${e.library_id}|${e.query_topic}`;
        if (!seen.has(key)) {
          seen.add(key);
          hitEntries.push({
            library_id: e.library_id,
            topic: e.query_topic,
            tags: e.tags || [],
            cached_files: (e.files || []).map((f: any) => f.path),
          });
        }
      }
    } catch { /* non-fatal */ }
    const tagResults = searchByTags(domainKeywords);
    for (const e of tagResults) {
      const key = `${e.library_id}|${e.query_topic}`;
      if (!seen.has(key)) {
        seen.add(key);
        hitEntries.push({
          library_id: e.library_id,
          topic: e.query_topic,
          tags: e.tags || [],
          cached_files: (e.files || []).map((f: any) => f.path),
        });
      }
    }
  }

  // ── Build discovery + sufficiency ──
  const discoveredFiles: string[] = [];
  for (const h of hitEntries) {
    for (const f of h.cached_files) discoveredFiles.push(f);
  }

  const cacheSufficient = hitEntries.length > 0;
  const discoveredAt = new Date().toISOString();
  const discovery = {
    status: cacheSufficient ? "sufficient" : "insufficient",
    missing_topics: cacheSufficient
      ? []
      : domainKeywords.length > 0
        ? domainKeywords.slice(0, 5)
        : [`No domain keywords found for: ${domain || "unknown"}`],
    discovered_files: discoveredFiles,
    discovered_at: discoveredAt,
  };

  const sufficiency = {
    status: cacheSufficient ? "pending_attestation" : "insufficient",
    missing_topics: discovery.missing_topics,
    declared_at: discoveredAt,
    reason: "[DEPRECATED] Use knowledge_cache_attest for verified read evidence.",
    files_read: [],
    content_summary: "[DEPRECATED] Use knowledge_cache_attest for verified read evidence.",
    discovery,
  };

  // ── DB write (canonical) ──
  let uc7Recorded = false;
  try {
    const pipelineId = resolvePipelineId({ task_id: taskId }, sessionId);
    uc7Recorded = atomicUpsertDiscovery({
      pipelineId,
      agent,
      domainId: domain || "all",
      sessionId,
      dagTaskId: taskId || undefined,
      discovery: {
        status: (sufficiency.discovery?.status || sufficiency.status) as "sufficient" | "insufficient",
        discovered_files: discoveredFiles,
        missing_topics: [],
        discovered_at: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "UC7KS-DB-CANONICAL-WRITE-FAILED",
      detail: `DB-canonical discovery write failed (non-fatal): ${e.message}`,
    });
  }

  // ── Audit counters (non-fatal) ──
  try { incrementAuditCounter("total_cache_checks"); } catch {}
  try { touchCacheCheck(); } catch {}
  if (hitEntries.length > 0) {
    try { incrementAuditCounter("total_cache_hits"); } catch {}
  } else {
    try { incrementAuditCounter("total_cache_misses"); } catch {}
  }

  // ── Checklist wire ──
  try {
    checklistWirePassed(
      sessionId || "",
      agent,
      taskId || "",
      "knowledge_search_completed",
      `domain=${domain || "all"} hits=${hitEntries.length}`,
    );
  } catch {}

  return {
    cache_available: true,
    total_entries: manifest.total_entries,
    search_domain: domain || "all",
    hits: hitEntries.length,
    hit_entries: hitEntries,
    discovery,
    cache_sufficiency: sufficiency,
    uc7_001_recorded: uc7Recorded,
    next_step: hitEntries.length > 0
      ? "Cache sufficient — NOW: (1) read cache files with 'read' tool, (2) call knowledge_cache_attest to verify read evidence before writing."
      : "Cache insufficient. Proceed to Step 0c — request @Knowledge-Curator dispatch.",
  };
}
