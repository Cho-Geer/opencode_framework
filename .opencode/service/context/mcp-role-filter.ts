// @ts-ignore: require used for lazy circular import
declare const require: any;
// service/context/mcp-role-filter.ts
// ═══════════════════════════════════════════════════════════════
// LEGACY / FUTURE CODE — NOT currently wired (no active caller).
// Do not count this as an active capability. See plans/02-phase1-skill-first.md Step 6.
// Per-agent MCP server visibility map.
// Maps agent name → set of MCP server prefixes they can see.
// Tools not in the allowed set are completely hidden from the agent.
// ═══════════════════════════════════════════════════════════════

// ── MCP server prefix map ──
// Tool names are prefixed by their MCP server name (with underscore separator).
// e.g., "compliance_gate_check" → server "compliance-gate"
//        "codegraph_query" → server "codegraph"
//        "run_audit" → server "eslint-audit" (no prefix, single tool)
//        "code_quality_check.run_full_scan" → server "code-quality-check"

const SERVER_PREFIXES: Record<string, string[]> = {
  "compliance-gate": ["compliance_gate_"],
  "codegraph": ["codegraph_"],
  "eslint-audit": ["run_audit"],
  "code-quality-check": ["code_quality_check."],
  "context7": ["resolve-library-id", "get-library-docs"],
  "playwright": ["browser_"],
  "github": ["github_"],
  "postgre_sql": ["query", "list_tables"],
  "docker": ["docker_"],
  "pandoc": ["pandoc_"],
  "excel": ["excel_"],
};

// ── Per-agent allowed MCP servers ──
// "ALL" means all servers visible (no filtering).
const AGENT_MCP_SERVERS: Record<string, string[]> = {
  "Orchestrator":         ["ALL"],
  "Super-Admin":          ["ALL"],
  "Meta-Planner":         ["codegraph"],
  "Architect":            ["codegraph", "compliance-gate", "eslint-audit", "code-quality-check", "context7"],
  "Coder-BE":             ["codegraph", "compliance-gate", "eslint-audit", "code-quality-check", "context7"],
  "Coder-FE":             ["codegraph", "compliance-gate", "eslint-audit", "code-quality-check", "context7", "playwright"],
  "Guardian":             ["compliance-gate", "eslint-audit", "code-quality-check", "codegraph"],
  "CI-CD-Agent":          ["docker", "compliance-gate", "codegraph", "github"],
  "Knowledge-Curator":    ["codegraph", "context7"],
  "Arbiter":              ["codegraph", "compliance-gate"],
};

// ── Build the allowed tool prefix set for an agent ──
export function getAllowedToolPrefixes(agentName: string): string[] | null {
  const servers = AGENT_MCP_SERVERS[agentName];
  if (!servers) return null; // unknown agent → no filtering
  if (servers.includes("ALL")) return null; // ALL → no filtering

  const prefixes: string[] = [];
  for (const server of servers) {
    const serverPrefixes = SERVER_PREFIXES[server];
    if (serverPrefixes) {
      prefixes.push(...serverPrefixes);
    }
  }
  return prefixes;
}

// ── Check if a tool should be visible for an agent ──
export function isToolVisibleForAgent(toolName: string, agentName: string): boolean {
  const prefixes = getAllowedToolPrefixes(agentName);
  if (prefixes === null) return true; // no filtering

  return prefixes.some(p => toolName.startsWith(p) || toolName === p);
}

// ── Get agent name from sessionID ──
// This is a best-effort lookup. The agent name is stored in session_map table.
export function getAgentForSession(sessionID: string): string | null {
  try {
    // Lazy import to avoid circular dependency
    const { getDb } = require("../../lib/db-manager");
    const db = getDb();
    const row = db.query(
      `SELECT agent FROM session_map WHERE session_id = ? LIMIT 1`
    ).get(sessionID) as { agent: string } | undefined;
    return row?.agent ?? null;
  } catch {
    return null;
  }
}
