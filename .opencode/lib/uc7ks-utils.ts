// uc7ks-utils.ts — UC7KS knowledge pipeline compliance utilities (lib)
// BUN-CACHE-VERSION: 2026-06-11-FW-BATCH-A (nested schema reader)
import * as fs from "node:fs";
import * as path from "node:path";
import { readCacheSufficiency, getSufficientDomains } from "./uc7ks-schema";

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
  } catch { return null; }
}

export function isLocalCacheAvailable(): boolean {
  const idx = readCacheIndex();
  return !!(idx && idx.total_entries > 0);
}

export function readCachedSessionAccess(agentKey: string): any {
  try {
    const mp = path.join(process.env.OPENCODE_ROOT || ".", ".opencode", "state", "machine.json");
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, "utf8"));
      return m?.knowledge_cache_state?.session_access?.[agentKey] || null;
    }
  } catch {}
  return null;
}

export function buildUC7KSError(agent: string, tool: string, mode: string, cacheAvail: boolean, reason: string): string {
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
  "context7_resolve-library-id", "context7_query-docs", "context7",
  "webfetch", "websearch",
  "github_get_file_contents", "github_search_code", "github_search_repositories", "github_search_issues",
  "playwright_browser_navigate",
]);

export function checkUC7KS(tool: string, agent: string, mode: string): string | null {
  if (!EXTERNAL_TOOLS.has(tool)) return null;

  if (agent === "@Knowledge-Curator" || agent === "Knowledge-Curator") return null;

  const cacheAvailable = isLocalCacheAvailable();

  let agentReadCache = false;
  try {
    const mp = path.join(process.env.OPENCODE_ROOT || ".", ".opencode", "state", "machine.json");
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, "utf8"));
      agentReadCache = !!m?.knowledge_cache_state?.session_access?.[agent]?.uc7_001_compliant;
    }
  } catch {}

  if (!agentReadCache && cacheAvailable) {
    return buildUC7KSError(agent, tool, mode, true, "UC7-001: Agent has not read local knowledge cache before external query.");
  }

  // ── F3: Per-domain sufficiency check with nested schema fallback ──
  if (agentReadCache && cacheAvailable) {
    try {
      const mp = path.join(process.env.OPENCODE_ROOT || ".", ".opencode", "state", "machine.json");
      if (fs.existsSync(mp)) {
        const m = JSON.parse(fs.readFileSync(mp, "utf8"));
        const sa = m?.knowledge_cache_state?.session_access || {};
        const agentKey = agent.replace(/^@/, "");

        // Try nested: find any completed domain with sufficient cache for this agent
        let hasSufficientCache = false;
        let suff: any = null;
        let evidenceOk = true;

        const agentEntry = sa[agent] || sa[agentKey];
        if (agentEntry?.tasks) {
          for (const tid of Object.keys(agentEntry.tasks)) {
            for (const domain of Object.keys(agentEntry.tasks[tid].domains || {})) {
              const d = agentEntry.tasks[tid].domains[domain];
              if (d.pipeline_status === "completed" && d.cache_sufficiency?.status === "sufficient") {
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
              for (const domain of Object.keys(agentEntry.tasks[tid].domains || {})) {
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
            if (flat.cache_sufficiency?.status === "insufficient") hasAnyCache = true;
            else if (!flat.cache_sufficiency?.status || flat.cache_sufficiency.status === "undeclared") {
              return buildUC7KSError(agent, tool, mode, true,
                `UC7-001b: Cache sufficiency not declared (status: ${flat.cache_sufficiency?.status || "undeclared"}). See subagent-preamble.md Step 0c.`);
            }
          }
        }

        // UC7-001c HARDEN: Verify evidence fields
        if (suff) {
          const missing: string[] = [];
          if (!suff.reason || suff.reason.length === 0) missing.push("reason");
          if (!suff.files_read || !Array.isArray(suff.files_read) || suff.files_read.length === 0) {
            if (suff.status === "sufficient") missing.push("files_read");
          }
          if (!suff.content_summary || suff.content_summary.length === 0) missing.push("content_summary");
          if (missing.length > 0) {
            return buildUC7KSError(agent, tool, mode, true,
              `UC7-001c: Cache sufficiency evidence incomplete. Missing: ${missing.join(", ")}. ` +
              `Must provide reason, files_read, and content_summary. See preamble Step 0.`);
          }
        }
      }
    } catch {}
  }

  if (mode === "advisory" || mode === "strict") {
    if (cacheAvailable) {
      return buildUC7KSError(agent, tool, mode, true, `Local cache exists. Agent must search cached docs before external queries (${mode} mode).`);
    }
    return null;
  }

  return buildUC7KSError(agent, tool, "locked", cacheAvailable, "LOCKED mode: ALL direct external queries blocked. Must use @Knowledge-Curator.");
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
export function checkUC7KSWrite(agent: string, mode: string): string | null {
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

  // Check uc7_001_compliant in machine.json
  const agentKey = agent.replace(/^@/, "");
  const sa = readCachedSessionAccess(agentKey);
  if (!sa?.uc7_001_compliant) {
    const cacheMsg = cacheHealthy
      ? "Local knowledge cache exists but has not been searched."
      : "Knowledge cache not initialized.";
    return [
      `[FW-ENFORCE][UC7-001] Knowledge cache not searched before write.`,
      `${cacheMsg}`,
      `Call knowledge_cache_search(domain, task_id) before writing source files.`,
      `Agent: ${agent}`,
    ].join(" ");
  }

  return null; // pass
}
