/**
 * Route Validator — L0-L2 Validation Layers (route-validator-l0-l2)
 *
 * L0: Purpose inference and filtering (FIX-G1-ROUTE-PURPOSE-v1)
 * L1: Verb → Candidate Pool mapping
 * L2: Scope-based filtering
 *
 * Split from lib/route-validator.ts for modularity.
 *
 * @module route-validator-l0-l2
 */

import { writeLog } from "../../lib/log-manager";
import type { VerbRule, ScopeRule, PurposeRule, RouteConfig } from "./route-validator-config";

// ═══ Layer 1: Verb → Candidate Pool ═══

export function l1_verbCandidates(
  taskDescription: string,
  verbRules: Record<string, VerbRule>,
): string[] {
  const lower = taskDescription.toLowerCase();
  const agents = new Set<string>();

  // GAP-B-KEYWORD-BOUNDARY (2026-06-27): \b word-boundary matching
  // prevents substring false positives (e.g. "prefix" vs "fix").
  for (const rule of Object.values(verbRules)) {
    if (!rule || !Array.isArray(rule.keywords)) continue;
    for (const kw of rule.keywords) {
      var kwLower = kw.toLowerCase();
      var escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, function (m) {
        return "\\" + m;
      });
      var re = new RegExp("\\b" + escaped + "\\b", "iu");
      if (re.test(lower)) {
        rule.agents.forEach((a) => agents.add(a));
        break;
      }
    }
  }

  if (agents.size === 0) {
    return [
      "@plan",
      "@Orchestrator",
      "@Architect",
      "@Coder-BE",
      "@Coder-FE",
      "@Guardian",
      "@Arbiter",
      "@CI-CD-Agent",
      "@Super-Admin",
      "@Knowledge-Curator",
    ];
  }
  return [...agents];
}

// ═══ Layer 0: Purpose Inference (FIX-G1-ROUTE-PURPOSE-v1, 2026-06-27) ═══
//
// inferDispatchPurpose() maps a task description to a canonical dispatch purpose
// using purpose-specific keywords and priority scoring. This is more reliable than
// L1 verb matching because:
//   - Purpose keywords are stronger signals (e.g., "修复" → repair purpose)
//   - Priority-based disambiguation prevents false positives
//   - Explicit mapping to agents avoids multi-agent ambiguity
//
// l0_purposeFilter() narrows or overrides the L1 candidate pool based on the
// inferred purpose. When a high-confidence purpose match is found, the purpose
// agent takes priority over verb-matched candidates.

/**
 * Infer the dispatch purpose from a task description.
 * Uses purpose_rules from project.config.json route_rules.purpose_to_agent.
 *
 * Scoring: each matching keyword contributes 1 point per purpose.
 * The purpose with the highest score wins. In case of ties,
 * the purpose with the lowest priority value wins.
 *
 * @param taskDescription - The task description text
 * @param purposeRules - Purpose-to-agent mapping rules from config
 * @returns The inferred purpose string, or "" if no match
 */
export function inferDispatchPurpose(
  taskDescription: string,
  purposeRules: PurposeRule[],
): string {
  if (!purposeRules || purposeRules.length === 0) return "";
  if (!taskDescription) return "";

  const lower = taskDescription.toLowerCase();

  // Score each purpose by keyword matches
  const scored = purposeRules.map((rule) => {
    let hits = 0;
    for (const kw of rule.keywords) {
      const kwLower = kw.toLowerCase();
      // Use word-boundary matching to prevent substring false positives
      // (e.g., "prefix" should not match "fix")
      const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, function (m) { return "\\" + m; });
      const re = new RegExp("\\b" + escaped + "\\b", "iu");
      if (re.test(lower)) {
        hits++;
      }
    }
    return { purpose: rule.purpose, agent: rule.agent, hits, priority: rule.priority };
  });

  // Filter to purposes with at least 1 keyword hit
  const matched = scored.filter((s) => s.hits > 0);

  if (matched.length === 0) return "";

  // Sort by: more hits first, then lower priority first (tiebreaker)
  matched.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return a.priority - b.priority;
  });

  const best = matched[0];
  writeLog("route-validator", "runtime", {
    event: "L0-PURPOSE-INFERRED",
    detail: `Inferred purpose="${best.purpose}" agent=${best.agent} hits=${best.hits} from task="${taskDescription.substring(0, 120)}"`,
    purposes: matched
      .map((s) => `${s.purpose}=${s.hits}`)
      .join(", "),
  });

  return best.purpose;
}

/**
 * L0 purpose filter: narrow L1 candidates based on inferred dispatch purpose.
 *
 * When a purpose is confidently inferred (hits >= 2 or only one purpose matched),
 * the purpose agent is used as the authoritative candidate, overriding L1 verb matching.
 * When confidence is low (single hit that's ambiguous), the purpose agent is added
 * to the L1 candidate pool as a preferred candidate.
 *
 * @param l1Candidates - Candidate agents from L1 verb matching
 * @param purpose - Inferred purpose string
 * @param purposeRules - Purpose-to-agent mapping rules
 * @returns Filtered/overridden candidate array
 */
export function l0_purposeFilter(
  l1Candidates: string[],
  purpose: string,
  purposeRules: PurposeRule[],
): { candidates: string[]; overridden: boolean } {
  if (!purpose || !purposeRules || purposeRules.length === 0) {
    return { candidates: l1Candidates, overridden: false };
  }

  const rule = purposeRules.find((r) => r.purpose === purpose);
  if (!rule) {
    return { candidates: l1Candidates, overridden: false };
  }

  // Count keyword hits for confidence assessment
  const lower = purpose; // purpose is already lowercase from inferDispatchPurpose
  const confidenceKeywords: string[] = [];
  for (const kw of rule.keywords) {
    const kwLower = kw.toLowerCase();
    const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, function (m) { return "\\" + m; });
    const re = new RegExp("\\b" + escaped + "\\b", "iu");
    if (re.test(lower)) {
      confidenceKeywords.push(kw);
    }
  }

  // High confidence: purpose agent overrides L1
  // (multiple keyword hits or purpose-only match)
  const highConfidence = confidenceKeywords.length >= 2 || l1Candidates.length === 0;

  if (highConfidence) {
    writeLog("route-validator", "runtime", {
      event: "L0-PURPOSE-OVERRIDE",
      detail: `Purpose "${purpose}" → agent ${rule.agent} overrides L1 candidates [${l1Candidates.join(",")}] (confidence: ${confidenceKeywords.length} keyword hits)`,
    });
    return { candidates: [rule.agent], overridden: true };
  }

  // Low confidence: prepend purpose agent as preferred, keep L1 candidates as fallback
  const preferred = [rule.agent, ...l1Candidates.filter((a) => a !== rule.agent)];
  writeLog("route-validator", "runtime", {
    event: "L0-PURPOSE-PREFER",
    detail: `Purpose "${purpose}" → preferred ${rule.agent}, L1 fallback [${l1Candidates.join(",")}] (confidence: ${confidenceKeywords.length} keyword hits)`,
  });
  return { candidates: preferred, overridden: false };
}


// ═══ Layer 2: Scope → Filter ═══

export function l2_scopeFilter(
  candidates: string[],
  targetFiles: string[],
  scopeConfig: RouteConfig["scope_to_agent"],
): string[] {
  const sorted = [...scopeConfig.rules].sort((a, b) => a.priority - b.priority);

  const matchedAgents = new Set<string>();
  const matchedScopes: string[] = [];
  for (const file of targetFiles) {
    for (const rule of sorted) {
      if (file.includes(rule.scope)) {
        matchedAgents.add(rule.agent);
        matchedScopes.push(rule.scope);
        break;
      }
    }
  }

  if (matchedAgents.size === 0) {
    return candidates;
  }

  const bizScopes = new Set(["booking-backend/src/", "booking-frontend/"]);
  const fwScopes = new Set([".opencode/", "opencode.json", "AGENTS.md"]);
  const hasBizScope = matchedScopes.some((s) => bizScopes.has(s));
  const hasFwScope = matchedScopes.some((s) => fwScopes.has(s));

  if (hasBizScope && hasFwScope) {
    return [scopeConfig.cross_domain.agent];
  }

  const intersection = candidates.filter((a) => matchedAgents.has(a));

  if (intersection.length > 0) {
    return intersection;
  }

  if (scopeConfig.scope_priority_over_l1) {
    return [...matchedAgents];
  }

  return candidates;
}
