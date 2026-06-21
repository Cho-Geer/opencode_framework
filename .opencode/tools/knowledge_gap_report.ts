import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { withInterruptGuard } from "../lib";

export default tool({
  description:
    "Analyze knowledge cache coverage across all semantic domains. Compare knowledge_semantic_map domains against index.json entries to identify gaps.",
  args: {},
  async execute(args, context) {
    return withInterruptGuard("knowledge_gap_report", async () => {
      var projectRoot = process.env.OPENCODE_ROOT || process.cwd();
      var indexPath = path.resolve(
        projectRoot,
        "docs",
        "official_docs",
        "index.json",
      );
      var configPath = path.resolve(
        projectRoot,
        ".opencode",
        "project.config.json",
      );

      var index;
      try {
        if (!fs.existsSync(indexPath)) {
          return JSON.stringify({
            cache_status: "empty",
            total_entries: 0,
            recommendations: ["Cache empty. Dispatch @Knowledge-Curator."],
          });
        }
        index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      } catch (e) {
        return JSON.stringify({
          cache_status: "corrupt",
          total_entries: 0,
          error: "Cannot read index.json",
        });
      }

      var entries = index.entries || [];
      var allTags = {};
      for (var i = 0; i < entries.length; i++) {
        var tags = entries[i].tags || [];
        for (var j = 0; j < tags.length; j++) {
          allTags[tags[j]] = true;
        }
      }

      var domains = [];
      try {
        if (fs.existsSync(configPath)) {
          var config = JSON.parse(fs.readFileSync(configPath, "utf8"));
          domains =
            (config.knowledge_semantic_map &&
              config.knowledge_semantic_map.domains) ||
            [];
        }
      } catch (e) {
        return JSON.stringify({
          cache_status: "healthy",
          total_entries: entries.length,
          error: "Cannot read config",
        });
      }

      var domainReport = [];
      var withCoverage = 0;
      var insufficient = 0;
      var recs = [];

      for (var k = 0; k < domains.length; k++) {
        var domain = domains[k];
        var keywords = domain.keywords || [];
        var cached = [];
        for (var m = 0; m < entries.length; m++) {
          var entry = entries[m];
          var eTags = entry.tags || [];
          for (var n = 0; n < keywords.length; n++) {
            if (eTags.indexOf(keywords[n]) !== -1) {
              cached.push(entry.query_topic || entry.library_id || "?");
              break;
            }
          }
        }
        var unique = [];
        var seen = {};
        for (var p = 0; p < cached.length; p++) {
          if (!seen[cached[p]]) {
            seen[cached[p]] = true;
            unique.push(cached[p]);
          }
        }
        var sufficient = unique.length > 0;
        if (sufficient) {
          withCoverage++;
        } else {
          insufficient++;
          recs.push(
            "[" +
              domain.domain_id +
              "] No cache. Dispatch @KC for: " +
              keywords.slice(0, 3).join(","),
          );
        }
        domainReport.push({
          domain_id: domain.domain_id,
          cached_count: unique.length,
          cached_entries: unique.slice(0, 10),
          cache_sufficient: sufficient,
          missing_topics: keywords
            .filter(function (kw) {
              return !allTags[kw];
            })
            .slice(0, 5),
        });
      }

      var ratio = domains.length > 0 ? withCoverage / domains.length : 0;
      var status =
        ratio >= 0.8
          ? "healthy"
          : ratio >= 0.5
            ? "stale"
            : ratio > 0
              ? "stale"
              : "empty";

      // ── KC-13: Reverse coverage — tags not covered by any domain ──
      // Build a unified set of known keywords + domain_id aliases
      var knownKeywords = {};
      for (var dk = 0; dk < domains.length; dk++) {
        var dom = domains[dk];
        knownKeywords[dom.domain_id.toLowerCase()] = dom.domain_id;
        var kws = dom.keywords || [];
        for (var kw = 0; kw < kws.length; kw++) {
          knownKeywords[kws[kw].toLowerCase()] = dom.domain_id;
        }
      }

      // Find tags not covered by any domain's keywords or alias
      var uncoveredTags = [];
      for (var tag in allTags) {
        if (!knownKeywords.hasOwnProperty(tag.toLowerCase())) {
          uncoveredTags.push(tag);
        }
      }

      // Build tag-to-domain mapping for covered tags
      var tagDomainMap = {};
      for (var utag in allTags) {
        var mapped = knownKeywords[utag.toLowerCase()];
        if (mapped) {
          if (!tagDomainMap[utag]) tagDomainMap[utag] = [];
          if (tagDomainMap[utag].indexOf(mapped) === -1)
            tagDomainMap[utag].push(mapped);
        }
      }

      var totalTags = Object.keys(allTags).length;
      var coveredTags = totalTags - uncoveredTags.length;
      var tagCoveragePct =
        totalTags > 0 ? Math.round((coveredTags / totalTags) * 100) : 0;

      // Add tag-coverage recommendations if gaps exist
      if (uncoveredTags.length > 0) {
        recs.push(
          "[TAG-COVERAGE] " +
            uncoveredTags.length +
            " tags not covered by any semantic_map domain. Uncovered: " +
            uncoveredTags.slice(0, 10).join(", ") +
            (uncoveredTags.length > 10
              ? " (+" + (uncoveredTags.length - 10) + " more)"
              : "") +
            ". Consider adding these tags to knowledge_semantic_map.",
        );
      }

      return JSON.stringify({
        cache_status: status,
        total_entries: entries.length,
        manifest_version: index.manifest_version || "?",
        total_domains: domains.length,
        domains_with_coverage: withCoverage,
        domains_insufficient: insufficient,
        domain_report: domainReport,
        // KC-13: Tag-to-domain coverage analysis
        tag_coverage: {
          total_tags: totalTags,
          covered_tags: coveredTags,
          uncovered_tags_count: uncoveredTags.length,
          coverage_pct: tagCoveragePct,
          uncovered_tags: uncoveredTags.slice(0, 30),
          tag_domain_map: tagDomainMap,
        },
        recommendations: recs,
      });
    });
  },
});
