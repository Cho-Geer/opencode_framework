// service/dispatch/prompt-sections.ts — Prompt section builders
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/command-tools/dispatch-subagent.ts
// Individual section generators for the dispatch prompt.
// ═══════════════════════════════════════════════════════════════

import * as path from "node:path";

// ── Types ──
export interface TechStackEntry {
  key: string;
  label: string;
  query: string;
}

export interface ProjectConfig {
  project?: { name?: string; version?: string };
  project_root?: string;
  tech_stack?: Record<string, any>;
  paths?: Record<string, string>;
  context7_task_mapping?: Array<{ keywords: string[]; stacks: string[] }>;
  [key: string]: any;
}

// ── Framework task keywords (avoid business-stack injection) ──
const FRAMEWORK_TASK_KEYWORDS = [
  "framework-self-test", "checklist", "db-canonical", "p0-checklist",
  "dispatch-subagent", "dispatch-protocol", "scope-before", "checklist-before",
  "execution-checklist", "framework-doctor", "e2e-final", "e2e-test",
  "framework-state.db",
];

/**
 * Find relevant tech stacks based on task description keywords.
 */
export function findRelevantStacks(
  description: string,
  mapping: Array<{ keywords: string[]; stacks: string[] }>,
  stackConfig: Record<string, any>,
): TechStackEntry[] {
  const result: TechStackEntry[] = [];
  for (const entry of mapping) {
    if (!entry || !Array.isArray(entry.keywords)) continue;
    const match = entry.keywords.some((kw) => description.toLowerCase().includes(kw));
    if (match) {
      for (const stackKey of entry.stacks) {
        const stack = stackConfig[stackKey];
        if (stack && !result.find((r) => r.key === stackKey)) {
          result.push({
            key: stackKey,
            label: stack && typeof stack === "object"
              ? stack.framework || stack.orm || stack.engine || stack.mechanism || stack.unit || stack.name || ""
              : typeof stack === "string" ? stack : stackKey,
            query: stack.context7_query,
          });
        }
      }
    }
  }
  return result;
}

/**
 * Check if task is a framework task (no business-stack injection).
 */
export function isFrameworkTask(description: string): boolean {
  return FRAMEWORK_TASK_KEYWORDS.some((k) => description.toLowerCase().includes(k));
}

/**
 * Build Context7 section for the prompt.
 */
export function buildContext7Section(relevantStacks: TechStackEntry[]): string {
  if (relevantStacks.length === 0) {
    return "- (determine based on task — see `project.config.json` `context7_task_mapping`)";
  }
  return `This task touches the following stacks. Resolve and query each via \`context7_resolve-library-id\` + \`context7_query-docs\`:\n${relevantStacks.map((s) => `- **${s.label}** — query: \`${s.query}\``).join("\n")}`;
}

/**
 * Build project context section.
 */
export function buildProjectContextSection(
  projectConfig: ProjectConfig,
  openCodeRoot: string,
): string {
  const projectRoot = projectConfig.project_root || ".";
  const techStack = projectConfig.tech_stack || {};
  const paths = projectConfig.paths || {};

  const resolvePath = (p: string) => {
    if (projectRoot === "." || projectRoot === "") return path.join(openCodeRoot, p);
    return path.join(openCodeRoot, projectRoot, p);
  };

  const lines = [
    `**Project**: ${projectConfig.project?.name || "(unnamed)"}`,
    `**OPENCODE_ROOT**: \`${openCodeRoot}\``,
    `**project_root**: \`${projectRoot}\``,
    `**Tech stack**:`,
    ...Object.entries(techStack).map(([key, val]) => {
      const v = typeof val === "string" ? val : val && typeof val === "object" ? val.framework || val.orm || val.engine || val.mechanism || val.unit || val.name || Object.values(val)[0] || "" : val;
      return `  - ${key}: ${v}`;
    }),
    `**Backend path**: \`${resolvePath(paths.backend_src || "")}\``,
    `**Frontend path**: \`${resolvePath(paths.frontend_src || "")}\``,
    `**Contracts**: \`${resolvePath(paths.contracts || "")}\``,
  ];
  return lines.join("\n");
}

/**
 * Build scope line for agent.
 */
export function buildScopeLine(agentType: string): string {
  const map: Record<string, string> = {
    Architect: "Write: contract.yaml, docs/ | Deny: .opencode/ framework files | Route: @Super-Admin",
    "Coder-BE": "Write: booking-backend/src/, booking-backend/test/ | Deny: booking-frontend/**, .opencode/ | Route: @Orchestrator",
    "Coder-FE": "Write: booking-frontend/ | Deny: booking-backend/**, .opencode/ | Route: @Orchestrator",
    Orchestrator: "Write: Task.DAG.json, .task_temp/ | Deny: .opencode/ framework files | Route: @Super-Admin",
    "Super-Admin": "Write: .opencode/**, opencode.json, AGENTS.md | Deny: booking-*/src/ (business code)",
    Guardian: "Write: .task_temp/**, .opencode/state/ | Deny: business code, contract.yaml | Route: @Arbiter",
    Arbiter: "Write: WAIVE.md, TECH_DEBT_REGISTRY.md | Deny: business code | Route: @plan",
    "CI-CD-Agent": "Write: .github/, Dockerfile*, docker-compose* | Deny: business code (src/), .opencode/agents/ | Route: @Orchestrator",
    "Knowledge-Curator": "Write: docs/official_docs/**, .task_temp/** | Deny: .opencode/**, business code",
    "Meta-Planner": "Write: docs/, Task.DAG.json | Deny: .opencode/ framework files, business code",
  };
  return map[agentType] || `Execute within your role's declared scope`;
}

/**
 * Build KC combined gate flow section (M17-M19).
 */
export function buildKCGateFlowSection(): string {
  return `

### 🚀 KC Combined Gate Flow (M17-M19, 2026-06-19)

**Skip the 3-step gate.** KC uses the **combined check+confirm flow**:

\`\`\`
compliance_gate_check(
  task_description="Knowledge acquisition: <topic>",
  plan_summary="<your knowledge acquisition plan>"
)  → session_id (gate is ARMED in this single call)
\`\`\`

**No separate** \`compliance_gate_confirm\` call — the \`plan_summary\` parameter
handles both check + confirm in one call.

**After cache update:**
\`\`\`
compliance_gate_submit_deliverables(session_id, evidence)
compliance_gate_complete(session_id, execution_summary)
\`\`\`

**M17 — [INSUFFICIENT] attest handling**: If \`knowledge_cache_attest\` returns
\`cache_sufficient=false\`, use the combined flow above to fetch missing docs.`;
}

/**
 * Build template resolution map from project config.
 */
export function buildTemplateResolutionMap(projectConfig: ProjectConfig): Record<string, string> {
  const map: Record<string, string> = {};
  const tr = projectConfig.template_resolution || {};

  // Project metadata
  if (projectConfig.project) {
    map["project.name"] = projectConfig.project.name || "";
    map["project.version"] = projectConfig.project.version || "";
  }
  map["project_root"] = projectConfig.project_root || ".";

  // Tech stack
  const beStack = projectConfig.tech_stack?.backend || {};
  map["backend.framework"] = beStack.framework || "";
  map["backend.runtime"] = beStack.runtime || "";
  map["backend.language"] = beStack.language || "";

  const feStack = projectConfig.tech_stack?.frontend || {};
  map["frontend.framework"] = feStack.framework || "";
  map["frontend.state_management"] = feStack.state_management || "";
  map["frontend.ui_library"] = feStack.ui_library || "";
  map["frontend.css"] = feStack.css || "";

  const cacheStack = projectConfig.tech_stack?.cache || {};
  map["cache.engine"] = cacheStack.engine || "";
  map["cache.client"] = cacheStack.client || "";
  map["queue.engine"] = projectConfig.tech_stack?.queue || "";

  const dbStack = projectConfig.tech_stack?.database || {};
  map["db.orm"] = dbStack.orm || "";
  map["db.engine"] = dbStack.engine || "";

  const authStack = projectConfig.tech_stack?.auth || {};
  map["auth.mechanism"] = authStack.mechanism || "";
  map["auth.token_validity"] = authStack.token_validity || "";
  map["auth.refresh_validity"] = authStack.refresh_validity || "";

  const testStack = projectConfig.tech_stack?.testing || {};
  map["testing.unit"] = testStack.unit || "";
  map["testing.e2e"] = testStack.e2e || "";
  map["testing.integration"] = testStack.integration || "";
  map["testing.coverage_threshold"] = testStack.coverage_threshold ? String(testStack.coverage_threshold) : "";

  // Paths
  if (projectConfig.paths?.backend_src) map["backend.src"] = projectConfig.paths.backend_src;
  if (projectConfig.paths?.frontend_src) map["frontend.src"] = projectConfig.paths.frontend_src;

  // template_resolution overrides (authoritative)
  for (const key of Object.keys(tr)) {
    const val = tr[key];
    if (typeof val === "string" && val.trim() !== "") {
      const mapKey = key.includes(".") ? key : `project.${key}`;
      map[mapKey] = val;
    }
  }

  return map;
}

/**
 * Resolve template variables in content.
 */
export function resolveTemplateVariables(
  content: string,
  templateMap: Record<string, string>,
  sourceLabel: string,
): string {
  if (!content || Object.keys(templateMap).length === 0) return content;
  return content.replace(/\{([a-z_]+\.[a-z_.]+)\}/g, (match, key) => {
    if (templateMap.hasOwnProperty(key)) return templateMap[key];
    return match;
  });
}
