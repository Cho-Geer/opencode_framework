// service/knowledge/gap-report.ts — Knowledge coverage gap analysis
// Source: tools/knowledge_gap_report.ts (pure read, no DB writes)

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-knowledge-gap-report";

export interface GapReportResult {
  cache_status: string;
  total_entries: number;
  manifest_version: string;
  total_domains: number;
  domains_with_coverage: number;
  domains_insufficient: number;
  domain_report: Array<{
    domain_id: string;
    cached_count: number;
    cached_entries: string[];
    cache_sufficient: boolean;
    missing_topics: string[];
  }>;
  tag_coverage: {
    total_tags: number;
    covered_tags: number;
    uncovered_tags_count: number;
    coverage_pct: number;
    uncovered_tags: string[];
    tag_domain_map: Record<string, string[]>;
  };
  recommendations: string[];
}

/**
 * Analyze knowledge cache coverage across all semantic domains.
 * Compare knowledge_semantic_map domains against index.json entries.
 */
export function gapReport(): GapReportResult {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const indexPath = path.resolve(projectRoot, "docs", "official_docs", "index.json");
  const configPath = path.resolve(projectRoot, ".opencode", "project.config.json");

  // ── Read index.json ──
  if (!fs.existsSync(indexPath)) {
    return {
      cache_status: "empty",
      total_entries: 0,
      manifest_version: "?",
      total_domains: 0,
      domains_with_coverage: 0,
      domains_insufficient: 0,
      domain_report: [],
      tag_coverage: { total_tags: 0, covered_tags: 0, uncovered_tags_count: 0, coverage_pct: 0, uncovered_tags: [], tag_domain_map: {} },
      recommendations: ["Cache empty. Dispatch @Knowledge-Curator."],
    };
  }

  let index: any;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return {
      cache_status: "corrupt",
      total_entries: 0,
      manifest_version: "?",
      total_domains: 0,
      domains_with_coverage: 0,
      domains_insufficient: 0,
      domain_report: [],
      tag_coverage: { total_tags: 0, covered_tags: 0, uncovered_tags_count: 0, coverage_pct: 0, uncovered_tags: [], tag_domain_map: {} },
      recommendations: ["Cannot read index.json"],
    };
  }

  const entries: any[] = index.entries || [];

  // Build tag universe
  const allTags: Record<string, boolean> = {};
  for (const entry of entries) {
    for (const tag of (entry.tags || [])) {
      allTags[tag] = true;
    }
  }

  // ── Read project.config.json for domains ──
  let domains: any[] = [];
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      domains = config.knowledge_semantic_map?.domains || [];
    }
  } catch {
    writeLog(SRC, "WARN", { event: "GAP-REPORT-CONFIG-FAIL", detail: "Cannot read config" });
  }

  // ── Per-domain coverage ──
  const domainReport: GapReportResult["domain_report"] = [];
  let withCoverage = 0;
  let insufficient = 0;
  const recs: string[] = [];

  for (const domain of domains) {
    const keywords: string[] = domain.keywords || [];
    const cached: string[] = [];

    for (const entry of entries) {
      const eTags: string[] = entry.tags || [];
      for (const kw of keywords) {
        if (eTags.includes(kw)) {
          cached.push(entry.query_topic || entry.library_id || "?");
          break;
        }
      }
    }

    // Deduplicate
    const unique = [...new Set(cached)];
    const sufficient = unique.length > 0;
    if (sufficient) {
      withCoverage++;
    } else {
      insufficient++;
      recs.push(`[${domain.domain_id}] No cache. Dispatch @KC for: ${keywords.slice(0, 3).join(",")}`);
    }

    domainReport.push({
      domain_id: domain.domain_id,
      cached_count: unique.length,
      cached_entries: unique.slice(0, 10),
      cache_sufficient: sufficient,
      missing_topics: keywords.filter((kw) => !allTags[kw]).slice(0, 5),
    });
  }

  // ── KC-13: Tag-to-domain reverse coverage ──
  const knownKeywords: Record<string, string> = {};
  for (const dom of domains) {
    knownKeywords[dom.domain_id.toLowerCase()] = dom.domain_id;
    for (const kw of (dom.keywords || [])) {
      knownKeywords[kw.toLowerCase()] = dom.domain_id;
    }
  }

  const uncoveredTags: string[] = [];
  const tagDomainMap: Record<string, string[]> = {};
  for (const tag of Object.keys(allTags)) {
    const mapped = knownKeywords[tag.toLowerCase()];
    if (mapped) {
      if (!tagDomainMap[tag]) tagDomainMap[tag] = [];
      if (!tagDomainMap[tag].includes(mapped)) tagDomainMap[tag].push(mapped);
    } else {
      uncoveredTags.push(tag);
    }
  }

  const totalTags = Object.keys(allTags).length;
  const coveredTags = totalTags - uncoveredTags.length;
  const tagCoveragePct = totalTags > 0 ? Math.round((coveredTags / totalTags) * 100) : 0;

  if (uncoveredTags.length > 0) {
    recs.push(
      `[TAG-COVERAGE] ${uncoveredTags.length} tags not covered by any semantic_map domain. Uncovered: ${uncoveredTags.slice(0, 10).join(", ")}` +
      (uncoveredTags.length > 10 ? ` (+${uncoveredTags.length - 10} more)` : "") +
      ". Consider adding these tags to knowledge_semantic_map.",
    );
  }

  const ratio = domains.length > 0 ? withCoverage / domains.length : 0;
  const status = ratio >= 0.8 ? "healthy" : ratio >= 0.5 ? "stale" : ratio > 0 ? "stale" : "empty";

  writeLog(SRC, "INFO", {
    event: "GAP-REPORT",
    total_entries: entries.length,
    total_domains: domains.length,
    with_coverage: withCoverage,
    status,
  });

  return {
    cache_status: status,
    total_entries: entries.length,
    manifest_version: index.manifest_version || "?",
    total_domains: domains.length,
    domains_with_coverage: withCoverage,
    domains_insufficient: insufficient,
    domain_report: domainReport,
    tag_coverage: {
      total_tags: totalTags,
      covered_tags: coveredTags,
      uncovered_tags_count: uncoveredTags.length,
      coverage_pct: tagCoveragePct,
      uncovered_tags: uncoveredTags.slice(0, 30),
      tag_domain_map: tagDomainMap,
    },
    recommendations: recs,
  };
}
