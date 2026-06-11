// uc7ks-utils.ts — UC7KS knowledge pipeline compliance utilities (lib)
import * as fs from "node:fs";
import * as path from "node:path";

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

  if (agentReadCache && cacheAvailable) {
    try {
      const mp = path.join(process.env.OPENCODE_ROOT || ".", ".opencode", "state", "machine.json");
      if (fs.existsSync(mp)) {
        const m = JSON.parse(fs.readFileSync(mp, "utf8"));
        const sa = m?.knowledge_cache_state?.session_access?.[agent] || {};
        const status = sa?.cache_sufficiency?.status;
        if (status !== "sufficient" && status !== "insufficient") {
          return buildUC7KSError(agent, tool, mode, true, `UC7-001b: Cache sufficiency not declared (status: ${status || "undeclared"}). See subagent-preamble.md Step 0c.`);
        }
        // UC7-001c HARDEN: Verify evidence fields (reason, files_read, content_summary)
        // are present and non-empty. Any missing → treated as insufficient.
        const suff = sa?.cache_sufficiency;
        if (suff) {
          const missing: string[] = [];
          if (!suff.reason || suff.reason.length === 0) missing.push("reason");
          if (!suff.files_read || !Array.isArray(suff.files_read) || suff.files_read.length === 0) {
            // files_read can be empty only when cache is actually empty (insufficient)
            if (status === "sufficient") missing.push("files_read");
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
