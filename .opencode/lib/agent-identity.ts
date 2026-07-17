import { isPrivilegedAgent, isDagExemptAgent } from "../service/enforcement/exemptions";
/**
 * agent-identity.ts — Canonical Agent Identity Normalization
 * ============================================================
 * SINGLE SOURCE OF TRUTH for all agent name handling across the
 * OpenCode multi-agent framework. Every plugin, tool, MCP script,
 * and library MUST use these functions instead of manual
 * toLowerCase/@replace/case-sensitive string comparison.
 *
 * Why: Prior to this module, ~35 files had inline normalization
 * logic with inconsistent handling of "@" prefix and case. This
 * caused permission lookup failures, privileged agent detection
 * bypasses, and silent write-scope gaps.
 *
 * ## Two semantic layers
 *
 *   1. normalize()     → lowercase comparison key ("super-admin")
 *   2. toDisplayName() → PascalCase for opencode.json lookups ("Super-Admin")
 *
 * All agent-name equality checks must use normalize(). All
 * opencode.json "agent" key lookups must use toDisplayName().
 *
 * @author @Super-Admin (FW-AGENT-IDENTITY)
 * @since  2026-06-25
 */

// ═══════════════════════════════════════════════════════════════
// §1  Canonical Agent Name Constants
// ═══════════════════════════════════════════════════════════════

/** Canonical lowercase agent identifiers — single source of truth */
export const AGENTS = {
  META_PLANNER: "meta-planner",
  ORCHESTRATOR: "orchestrator",
  ARCHITECT: "architect",
  CODER_BE: "coder-be",
  CODER_FE: "coder-fe",
  GUARDIAN: "guardian",
  ARBITER: "arbiter",
  CI_CD_AGENT: "ci-cd-agent",
  KNOWLEDGE_CURATOR: "knowledge-curator",
  SUPER_ADMIN: "super-admin",
} as const;

export type AgentId = (typeof AGENTS)[keyof typeof AGENTS];

// ═══════════════════════════════════════════════════════════════
// §2  Display Name Mapping (lowercase → opencode.json PascalCase)
// ═══════════════════════════════════════════════════════════════

const DISPLAY_NAMES: Record<string, string> = {
  [AGENTS.META_PLANNER]: "Meta-Planner",
  [AGENTS.ORCHESTRATOR]: "Orchestrator",
  [AGENTS.ARCHITECT]: "Architect",
  [AGENTS.CODER_BE]: "Coder-BE",
  [AGENTS.CODER_FE]: "Coder-FE",
  [AGENTS.GUARDIAN]: "Guardian",
  [AGENTS.ARBITER]: "Arbiter",
  [AGENTS.CI_CD_AGENT]: "CI-CD-Agent",
  [AGENTS.KNOWLEDGE_CURATOR]: "Knowledge-Curator",
  [AGENTS.SUPER_ADMIN]: "Super-Admin",
};

// ═══════════════════════════════════════════════════════════════
// §3  Classification Sets (derived from AGENTS constants)
// ═══════════════════════════════════════════════════════════════

/** Agents exempt from DAG PLAN-FIRST enforcement */
const DAG_EXEMPT_SET: ReadonlySet<AgentId> = new Set([
  AGENTS.META_PLANNER,
  AGENTS.ORCHESTRATOR,
  AGENTS.SUPER_ADMIN,
  AGENTS.KNOWLEDGE_CURATOR,
]);

/** Privileged agents: allowed to dispatch any target + use question tool */
const PRIVILEGED_SET: ReadonlySet<AgentId> = new Set([
  AGENTS.ORCHESTRATOR,
  AGENTS.SUPER_ADMIN,
]);

/** DAG-exempt canonical list (for re-export / external consumers) */
export const DAG_EXEMPT_AGENTS: readonly string[] = Object.freeze([
  AGENTS.META_PLANNER,
  AGENTS.ORCHESTRATOR,
  AGENTS.SUPER_ADMIN,
  AGENTS.KNOWLEDGE_CURATOR,
]);

// ═══════════════════════════════════════════════════════════════
// §4  Core Normalization API
// ═══════════════════════════════════════════════════════════════

/**
 * Canonical normalization: strip leading "@", convert to lowercase.
 *
 * This is the ONE function every agent comparison must use.
 *
 * @example
 *   normalize("@Super-Admin")   → "super-admin"
 *   normalize("Orchestrator")   → "orchestrator"
 *   normalize("@coder-be")      → "coder-be"
 *   normalize("")               → ""
 */
export function normalize(input: string | undefined | null): string {
  return (input || "").replace(/^@/, "").toLowerCase();
}

/**
 * Convert to opencode.json agent-key format (PascalCase).
 *
 * Use this when looking up agents in opencode.json's "agent" dictionary.
 *
 * @example
 *   toDisplayName("super-admin")   → "Super-Admin"
 *   toDisplayName("@Coder-BE")     → "Coder-BE"
 *   toDisplayName("orchestrator")  → "Orchestrator"
 */
export function toDisplayName(input: string | undefined | null): string {
  const key = normalize(input);
  return DISPLAY_NAMES[key] || key;
}

// ═══════════════════════════════════════════════════════════════
// §5  Classification Predicates
// ═══════════════════════════════════════════════════════════════

/** True if the agent is Orchestrator or Super-Admin (privileged dispatchers) */
export function isPrivileged(input: string | undefined | null): boolean {
  // Config-driven override
  if (isPrivilegedAgent(input)) return true;
  return PRIVILEGED_SET.has(normalize(input) as AgentId);
}

/** True if the agent is DAG-exempt (Meta-Planner/Orchestrator/Super-Admin/Knowledge-Curator) */
export function isDagExempt(input: string | undefined | null): boolean {
  // Config-driven override
  if (isDagExemptAgent(input)) return true;
  return DAG_EXEMPT_SET.has(normalize(input) as AgentId);
}

/** True if the agent is Super-Admin specifically */
export function isSuperAdmin(input: string | undefined | null): boolean {
  return normalize(input) === AGENTS.SUPER_ADMIN;
}

/** True if the agent is Knowledge-Curator specifically */
export function isKnowledgeCurator(input: string | undefined | null): boolean {
  return normalize(input) === AGENTS.KNOWLEDGE_CURATOR;
}
