// uc7ks-utils.ts — UC7KS knowledge pipeline compliance utilities (lib)
// BUN-CACHE-VERSION: 2026-06-18-UC7KS-PHASE0 (dual-state discovery/attestation)
import * as fs from "node:fs";
import * as path from "node:path";
import {
  readCacheSufficiency,
  getSufficientDomains,
  readCacheDiscovery,
  readCacheAttestation,
  isDomainKnowledgeAttested,
  normalizeAgentKey,
} from "./uc7ks-schema";
import { readSubState } from "./substate-manager";
import { writeLog } from "./log-manager";

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
  } catch { return null; }
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
    const kcs = readSubState("knowledge_cache_state");
    agentReadCache = !!kcs?.session_access?.[agent]?.uc7_001_compliant;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "UC7KS-COMPLIANT-CHECK-FAILED",
      detail: `agent=${agent} err=${e.message}`,
    });
  }

  if (!agentReadCache && cacheAvailable) {
    return buildUC7KSError(agent, tool, mode, true, "UC7-001: Agent has not read local knowledge cache before external query.");
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
    } catch (e: any) {
      writeLog(SRC, "ERROR", {
        event: "UC7KS-SUFFICIENCY-CHECK-FAILED",
        detail: `agent=${agent} err=${e.message}`,
      });
    }
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
  if (taskId && domainId) {
    if (sa?.tasks?.[taskId]?.domains?.[domainId]) {
      // Path A: per-domain data exists → dual-state check (discovery + attestation)
      var disc = readCacheDiscovery(sa, agentKey, taskId, domainId);
      var att = readCacheAttestation(sa, agentKey, taskId, domainId);

      // Sub-path A1: discovery insufficient → BLOCK
      if (!disc || disc.status !== "sufficient") {
        writeLog(SRC, "ERROR", {
          event: "UC7KS-WRITE-BLOCK-DISCOVERY",
          agent,
          sessionID: sessionId,
          taskId,
          domainId,
          detail: `discovery ${disc?.status || "missing"}. Missing topics: ${disc?.missing_topics?.join(", ") || "none"}`,
        });
        return buildBlockMessage(
          "UC7-001: 知识缓存不足",
          agent,
          `Missing topics: ${disc?.missing_topics?.join(", ") || "unknown"}.`,
          "1. 调 knowledge_cache_search(domain, task_id) 换 domain\n2. 如仍不足 → 通知 @Orchestrator 派遣 @Knowledge-Curator"
        );
      }

      // Sub-path A2: discovery sufficient but attestation missing/pending → BLOCK in strict/locked
      // §2.7 Legacy compat: advisory mode accepts legacy_discovered_only
      if (mode === "advisory") {
        // Advisory: pass if legacy cache_sufficiency was sufficient (grace period)
        if (att && (att.status === "legacy_discovered_only" || att.status === "attested")) {
          writeLog(SRC, "WARN", {
            event: "UC7KS-WRITE-PASS-LEGACY",
            agent,
            sessionID: sessionId,
            taskId,
            domainId,
            detail: `advisory mode: accepting attestation status=${att.status}`,
          });
          return null;
        }
        // Advisory: also accept discovery-only (no attestation) with warning
        writeLog(SRC, "WARN", {
          event: "UC7KS-WRITE-WARN-NO-ATTEST",
          agent,
          sessionID: sessionId,
          taskId,
          domainId,
          detail: `advisory mode: discovery sufficient but no attestation — WARN only`,
        });
        return null;
      }

      // Strict/Locked: attestation is REQUIRED
      // FW-FIX-UC7KS-ATTEST-V2: legacy_discovered_only no longer passes in strict/locked.
      // Previously L285 included `&& att.status !== "legacy_discovered_only"` which allowed
      // agents to bypass attestation. Now legacy_discovered_only falls through to L321-336
      // where it is properly blocked with a remediation message.
      if (!att || att.status !== "attested") {
        // Missing attestation entirely
        if (!att) {
          writeLog(SRC, "ERROR", {
            event: "UC7KS-WRITE-BLOCK-ATTEST",
            agent,
            sessionID: sessionId,
            taskId,
            domainId,
            detail: "discovery sufficient but no attestation — must call knowledge_cache_attest",
          });
          return buildBlockMessage(
            "UC7-001: 缓存已搜索但未证明已读",
            agent,
            `Discovery sufficient (${disc.discovered_files.length} files discovered) but no read attestation.`,
            `调 knowledge_cache_attest(domain="${domainId}", task_id="${taskId}", reason="...", files_read=[...], content_summary="...")`
          );
        }
        // Has attestation but status is pending/skipped
        if (att.status === "pending" || att.status === "skipped") {
          writeLog(SRC, "ERROR", {
            event: "UC7KS-WRITE-BLOCK-ATTEST",
            agent,
            sessionID: sessionId,
            taskId,
            domainId,
            detail: `attestation status=${att.status} — must be "attested"`,
          });
          return buildBlockMessage(
            "UC7-001: 阅读证明未完成",
            agent,
            `Attestation status is "${att.status}" (requires "attested").`,
            `调 knowledge_cache_attest(domain="${domainId}", task_id="${taskId}", reason="...", files_read=[...], content_summary="...")`
          );
        }
        // legacy_discovered_only in strict/locked → BLOCK (§2.7: no implicit pass)
        if (att.status === "legacy_discovered_only") {
          writeLog(SRC, "ERROR", {
            event: "UC7KS-WRITE-BLOCK-LEGACY",
            agent,
            sessionID: sessionId,
            taskId,
            domainId,
            detail: `strict/locked: legacy_discovered_only rejected — must re-read and attest`,
          });
          return buildBlockMessage(
            "UC7-001: 遗留缓存数据未经验证",
            agent,
            `Cache was previously marked sufficient but has NOT been verified against read_audit.jsonl (§2.7: legacy data requires re-attestation in ${mode} mode).`,
            `1. 用 read 工具打开相关缓存文件\n2. 调 knowledge_cache_attest(domain="${domainId}", task_id="${taskId}", ...)`
          );
        }

        // §2.7 DEFENSIVE FALLBACK (SA-FIX-UC7KS-ATTEST-GAP-V3):
        // Any attestation status that is NOT "attested" AND not explicitly
        // handled above (pending, skipped, legacy_discovered_only) is treated
        // as a BLOCK. This prevents future attestation statuses from silently
        // passing the write-block gate.
        writeLog(SRC, "ERROR", {
          event: "UC7KS-WRITE-BLOCK-UNKNOWN",
          agent,
          sessionID: sessionId,
          taskId,
          domainId,
          detail: `strict/locked: unknown attestation status="${att.status}" — must be "attested"`,
        });
        return buildBlockMessage(
          "UC7-001: 阅读证明状态未知",
          agent,
          `Attestation status "${att.status}" is not recognized as valid (requires "attested").`,
          `调 knowledge_cache_attest(domain="${domainId}", task_id="${taskId}", reason="...", files_read=[...], content_summary="...")`
        );
      }

      // Sub-path A3: discovery sufficient + attestation attested → PASS
      writeLog(SRC, "INFO", {
        event: "UC7KS-WRITE-PASS-ATTESTED",
        agent,
        sessionID: sessionId,
        taskId,
        domainId,
        detail: `discovery sufficient + attestation attested (${att.files_read.length} files verified)`,
      });
      return null;
    } else {
      // Path B: taskId+domainId provided but per-task data missing
      // FW-UC7KS-DOMAIN-001-v3: Check global compliant flag before blocking.
      // FW-UC7KS-DOMAIN-001-v4 (M5, 2026-06-19): Only tolerate domain mismatch if
      // the agent has AT LEAST ONE attested domain. This closes the bypass where
      // uc7_001_compliant=true from a prior session but no domain was ever attested.
      // Fix: docs/review/framework-refactor/uc7ks-write-block-gap-analysis-and-repair-plan.md §M5
      if (sa?.uc7_001_compliant && hasAtLeastOneAttestedDomain(sa, agentKey)) {
        // Fall through to Path C (global check) — tolerate domain mismatch
        // because agent has proven knowledge of at least one domain
        writeLog(SRC, "INFO", {
          event: "UC7KS-WRITE-PATH-B-TOLERATE",
          agent,
          sessionID: sessionId,
          taskId,
          domainId,
          detail: "path B: domain mismatch tolerated (>=1 attested domain exists)",
        });
      } else if (sa?.uc7_001_compliant) {
        // M5 HARDEN: uc7_001_compliant=true but NO attested domains.
        // Cannot fall through — agent must attest at least one domain first.
        writeLog(SRC, "ERROR", {
          event: "UC7KS-WRITE-BLOCK-NO-ATTESTED-DOMAIN",
          agent,
          sessionID: sessionId,
          taskId,
          domainId,
          detail: `uc7_001_compliant=true but no attested domains. Must call knowledge_cache_attest.`,
        });
        return buildBlockMessage(
          "UC7-001: 缓存已搜索但无任何域已证明已读",
          agent,
          `Agent has searched cache (uc7_001_compliant=true) but has 0 attested domains. ` +
          `Requires >=1 domain attested before writing (M5).`,
          `调 knowledge_cache_attest(domain="...", task_id="${taskId || "TASK"}", reason="...", files_read=[...], content_summary="...")`
        );
      } else {
        writeLog(SRC, "ERROR", {
          event: "UC7KS-WRITE-BLOCK-NO-PER-TASK",
          agent,
          sessionID: sessionId,
          taskId,
          domainId,
          detail: "taskId+domainId provided but no per-task cache_sufficiency data. " +
                  "Agent must call knowledge_cache_search(domain, task_id) before writing.",
        });
        return [
          `[FW-ENFORCE][UC7-001] Knowledge cache not searched for task "${taskId}" domain "${domainId}".`,
          `No per-domain cache_sufficiency data found — agent must search knowledge cache before writing.`,
          `Call knowledge_cache_search("${domainId}", "${taskId}") first.`,
          `提示：请检查 module_scope_declare 的 module 参数是否与 dispatch 的 domain 一致`,
          `Agent: ${agent}`,
        ].join(" ");
      }
    }

/**
 * Phase 0 (2026-06-18): Build formatted UC7-001 block error message.
 * Replaces the old buildUC7KSError for write-time blocks.
 */
function buildBlockMessage(title: string, agent: string, detail: string, remediation: string): string {
  return [
    `╔══════════════════════════════════════════════════════════════╗`,
    `║  ${title.padEnd(56)}║`,
    `║  Agent: ${(agent || "unknown").padEnd(48)}║`,
    `║  ${detail.substring(0, 54).padEnd(54)}║`,
    `║  修复:${' '.repeat(56)}║`,
  ].concat(
    remediation.split("\n").map(function (l) { return `║  ${l.substring(0, 54).padEnd(54)}║`; })
  ).concat([
    `╚══════════════════════════════════════════════════════════════╝`,
  ]).join("\n");
}

  // ── Path C: All-domain attestation check (M3, 2026-06-19) ──
  // Replaces legacy global uc7_001_compliant check.
  // Iterates ALL session domains for this agent/task — every domain
  // MUST have attestation.status === "attested" for writes to pass.
  // Strict/Locked: BLOCK on first non-attested domain.
  // Advisory: WARN (log) but PASS (non-blocking).
  // Design: docs/review/framework-refactor/uc7ks-write-block-gap-analysis-and-repair-plan.md §M3
  var allDomainsAttested = checkAllDomainsAttested(sa, agentKey, taskId, mode, sessionId, agent);
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
}

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
  // Collect domains: if taskId provided, check only that task's domains.
  // Otherwise, check ALL tasks' domains.
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

  // If no domains exist at all, check legacy global flag for backward compat
  if (domainEntries.length === 0) {
    if (sa?.uc7_001_compliant) {
      return true; // Legacy global pass (no per-domain data, but cache was searched)
    }
    if (mode === "advisory") {
      writeLog(SRC, "WARN", {
        event: "UC7KS-WRITE-WARN-NO-DOMAINS",
        agent,
        sessionID: sessionId,
        taskId,
        detail: "advisory mode: no domains in state, uc7_001_compliant not set — WARN only",
      });
      return null;
    }
    return buildBlockMessage(
      "UC7-001: 知识缓存未搜索",
      agent,
      "No domain cache data found and uc7_001_compliant not set.",
      "Call knowledge_cache_search(domain, task_id) first, then knowledge_cache_attest()."
    );
  }

  // Iterate all domains: check attestation
  var unattestedDomains: string[] = [];
  for (var i = 0; i < domainEntries.length; i++) {
    var de = domainEntries[i];
    var att = readCacheAttestation(sa, agentKey, de.taskId, de.domainId);
    if (!att || att.status !== "attested") {
      unattestedDomains.push(de.domainId + " (task " + de.taskId + ")");
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
    `对每个未 attest 的域调用:\nknowledge_cache_attest(domain="...", task_id="...", reason="...", files_read=[...], content_summary="...")`
  );
}

/**
 * M11 (2026-06-19): File-level domain attestation check.
 * Prevents bypass: "attest domain A, write domain B files".
 * Matches filePath against knowledge_semantic_map.save_path.
 * Returns null (PASS) or block message (BLOCK in strict/locked).
 * Advisory mode always returns null.
 */
export function checkUC7KSFileLevelDomain(
  filePath: string, agent: string, mode: string, sessionId?: string, taskId?: string,
): string | null {
  if (mode === "advisory") return null;
  const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
  if (agentNorm === "knowledge-curator") return null;
  if (agentNorm === "super-admin" && !isLocalCacheAvailable()) return null;
  var matchedDomain: string | null = null;
  try {
    const p2 = path.join(process.env.OPENCODE_ROOT || ".", ".opencode", "project.config.json");
    if (!fs.existsSync(p2)) return null;
    const cfg = JSON.parse(fs.readFileSync(p2, "utf8"));
    const doms = cfg?.knowledge_semantic_map?.domains || [];
    var best: { d: string; p: string; l: number } | null = null;
    for (var di = 0; di < doms.length; di++) {
      var sp = (doms[di].save_path || "").replace(/\/+$/, "") + "/";
      if (sp && filePath.indexOf(sp) >= 0) {
        if (!best || sp.length > best.l) best = { d: doms[di].domain_id, p: sp, l: sp.length };
      }
    }
    if (!best) return null;
    matchedDomain = best.d;
  } catch (e: any) {
    writeLog(SRC, "ERROR", { event: "UC7KS-M11-CFG-ERR", agent, sessionID: sessionId, detail: e.message });
    return null;
  }
  if (!matchedDomain) return null;
  var ak = agent.replace(/^@/, "");
  var sa2 = readCachedSessionAccess(ak);
  if (!sa2) {
    writeLog(SRC, "ERROR", { event: "UC7KS-WRITE-BLOCK-M11-NO-STATE", agent, sessionID: sessionId, taskId,
      domainId: matchedDomain, detail: "no cache state for agent" });
    return buildBlockMessage("UC7-001: No cache state for file domain (M11)", agent,
      `File maps to domain "${matchedDomain}" but agent has no cache state.`,
      "1. module_scope_declare 2. knowledge_cache_search 3. knowledge_cache_attest");
  }
  var attOk = false;
  if (sa2.tasks) {
    for (var tk of Object.keys(sa2.tasks)) {
      var a2 = readCacheAttestation(sa2, ak, tk, matchedDomain);
      if (a2 && a2.status === "attested") { attOk = true; break; }
    }
  }
  if (!attOk) {
    writeLog(SRC, "ERROR", { event: "UC7KS-WRITE-BLOCK-M11-NOT-ATTESTED", agent, sessionID: sessionId, taskId,
      domainId: matchedDomain, detail: `domain "${matchedDomain}" not attested` });
    return buildBlockMessage("UC7-001: File domain not attested (M11)", agent,
      `File maps to domain "${matchedDomain}" which has NOT been attested.`,
      `1. Read docs/official_docs/ files for "${matchedDomain}"\n2. knowledge_cache_attest(domain="${matchedDomain}", ...)`);
  }
  writeLog(SRC, "INFO", { event: "UC7KS-M11-PASS", agent, sessionID: sessionId, taskId, domainId: matchedDomain,
    detail: `file OK → domain "${matchedDomain}" attested` });
  return null;
}
