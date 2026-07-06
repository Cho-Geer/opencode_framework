#!/usr/bin/env bun
/**
 * scripts/generate-agent-manifests.ts — Generate Agent .md manifests from config sources
 *
 * Reads:
 *   1. docs/agent-alias-map.md — alias → native executor mapping
 *   2. project.config.json — agent_tool_scopes, enforcement_exemptions
 *   3. Existing agents/*.md — current skills, mcp_tools, permission fields
 *
 * Writes:
 *   agents/*.md — regenerated manifests with complete frontmatter
 *
 * Phase 5 (2026-07-05)
 *
 * Usage: bun run .opencode/scripts/generate-agent-manifests.ts [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = process.env.OPENCODE_ROOT || process.cwd();
const AGENTS_DIR = join(ROOT, ".opencode", "agents");
const CONFIG_PATH = join(ROOT, ".opencode", "project.config.json");

// ── Agent alias → native executor mapping ──
const ALIAS_MAP: Record<string, { executor: string; risk: string; writeScope: string[]; bridge: string }> = {
  Orchestrator:       { executor: "Plan",    risk: "normal",      writeScope: [],                bridge: "连续失败3次以上 或 跨session恢复 或 架构级决策" },
  "Meta-Planner":     { executor: "Plan",    risk: "low",         writeScope: [],                bridge: "规划失败3次 或 需求不明确" },
  Architect:          { executor: "General", risk: "normal",      writeScope: [],                bridge: "架构决策 或 跨模块影响" },
  "Coder-BE":         { executor: "Build",   risk: "normal",      writeScope: ["src/**"],        bridge: "实现失败3次 或 API设计不确定" },
  "Coder-FE":         { executor: "Build",   risk: "normal",      writeScope: ["src/**"],        bridge: "实现失败3次 或 UI设计不确定" },
  Guardian:           { executor: "Explore", risk: "low",         writeScope: [],                bridge: "审查发现严重问题 或 安全漏洞" },
  Arbiter:            { executor: "General", risk: "low",         writeScope: [],                bridge: "仲裁分歧无法解决" },
  "CI-CD-Agent":      { executor: "Build",   risk: "normal",      writeScope: ["src/**", "infra/**"], bridge: "部署失败 或 CI持续失败3次" },
  "Knowledge-Curator":{ executor: "Explore", risk: "low",         writeScope: ["docs/**"],       bridge: "知识缺口 或 文档矛盾" },
  "Super-Admin":      { executor: "Build",   risk: "break-glass", writeScope: [".opencode/**"],  bridge: "框架紧急修复 或 DB损坏 或 hook阻断" },
};

// ── Description templates ──
const DESCRIPTIONS: Record<string, string> = {
  Orchestrator:        "Project coordination alias → Plan native executor. Task scheduling, dispatch, result merging.",
  "Meta-Planner":      "Planning alias → Plan native executor. Requirements analysis, DAG planning, task decomposition.",
  Architect:           "Architecture alias → General native executor. System design, API contracts, code review.",
  "Coder-BE":          "Backend implementation alias → Build native executor. NestJS, Prisma, PostgreSQL, Redis.",
  "Coder-FE":          "Frontend implementation alias → Build native executor. Angular, TypeScript, RxJS.",
  Guardian:            "Review alias → Explore native executor. Code review, security audit, compliance check.",
  Arbiter:             "Arbitration alias → General native executor. Conflict resolution, decision documentation.",
  "CI-CD-Agent":       "CI/CD alias → Build native executor. Pipeline config, deployment, infrastructure.",
  "Knowledge-Curator": "Knowledge alias → Explore native executor. UC7KS pipeline, documentation, knowledge base.",
  "Super-Admin":       "Break-glass alias → Build native executor. Framework repair, DB recovery, emergency ops.",
};

interface AgentManifest {
  name: string;
  description: string;
  alias_of: string;
  default_skills: string[];
  risk_profile: string;
  write_scope: string[];
  qoderwork_bridge: { trigger: string; tool: string };
  skills: string[];
  mcp_tools: string[];
  permission: Record<string, string>;
  body: string;
}

// ── Parse existing agent .md to extract skills/mcp_tools/permission ──
function parseExistingManifest(filePath: string): Partial<AgentManifest> {
  try {
    const content = readFileSync(filePath, "utf8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return {};

    const fm = fmMatch[1];
    const result: Partial<AgentManifest> = {};

    // Extract skills
    const skillsMatch = fm.match(/^skills:\n((?:  - .+\n?)+)/m);
    if (skillsMatch) {
      result.skills = skillsMatch[1].split("\n").filter(l => l.trim().startsWith("- ")).map(l => l.replace(/^\s*- /, "").trim());
    }

    // Extract mcp_tools
    const mcpMatch = fm.match(/^mcp_tools:\n((?:  - .+\n?)+)/m);
    if (mcpMatch) {
      result.mcp_tools = mcpMatch[1].split("\n").filter(l => l.trim().startsWith("- ")).map(l => l.replace(/^\s*- /, "").trim());
    }

    // Extract permission
    const permMatch = fm.match(/^permission:\n((?:  \w+: \w+\n?)+)/m);
    if (permMatch) {
      result.permission = {};
      for (const line of permMatch[1].split("\n")) {
        const m = line.match(/^\s+(\w+):\s+(\w+)/);
        if (m) result.permission[m[1]] = m[2];
      }
    }

    // Extract body (after second ---)
    const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/m);
    if (bodyMatch) result.body = bodyMatch[1].trim();

    return result;
  } catch {
    return {};
  }
}

// ── Generate YAML frontmatter ──
function generateFrontmatter(m: AgentManifest): string {
  const yaml = [
    "---",
    `name: ${m.name}`,
    `description: ${m.description}`,
    `alias_of: ${m.alias_of}`,
    `default_skills:`,
    ...m.default_skills.map(s => `  - ${s}`),
    `risk_profile: ${m.risk_profile}`,
    `write_scope:`,
    ...(m.write_scope.length > 0 ? m.write_scope.map(s => `  - "${s}"`) : ["  []"]),
    `qoderwork_bridge:`,
    `  trigger: "${m.qoderwork_bridge.trigger}"`,
    `  tool: ${m.qoderwork_bridge.tool}`,
    `skills:`,
    ...m.skills.map(s => `  - ${s}`),
    `mcp_tools:`,
    ...m.mcp_tools.map(s => `  - ${s}`),
    `permission:`,
    ...Object.entries(m.permission).map(([k, v]) => `  ${k}: ${v}`),
    "---",
    "",
    m.body || `# ${m.name} (Alias → ${m.alias_of})`,
    "",
  ];
  return yaml.join("\n");
}

// ── Main ──
function main(): void {
  console.log(`generate-agent-manifests: ROOT=${ROOT}`);
  console.log(`DRY_RUN=${DRY_RUN}`);

  // Load project config for agent_tool_scopes
  let config: any = {};
  if (existsSync(CONFIG_PATH)) {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  }

  const agentToolScopes = config?.agent_tool_scopes || {};

  // Process each agent
  const agentFiles = readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md"));
  let generated = 0;

  for (const file of agentFiles) {
    const name = file.replace(".md", "");
    const filePath = join(AGENTS_DIR, file);
    const alias = ALIAS_MAP[name];

    if (!alias) {
      console.log(`  SKIP: ${name} (no alias mapping)`);
      continue;
    }

    // Parse existing manifest
    const existing = parseExistingManifest(filePath);

    // Build complete manifest
    const manifest: AgentManifest = {
      name,
      description: DESCRIPTIONS[name] || `${name} alias → ${alias.executor} native executor.`,
      alias_of: alias.executor,
      default_skills: existing.skills || [],
      risk_profile: alias.risk,
      write_scope: alias.writeScope,
      qoderwork_bridge: { trigger: alias.bridge, tool: "question" },
      skills: existing.skills || [],
      mcp_tools: existing.mcp_tools || [],
      permission: existing.permission || { skill: "allow" },
      body: existing.body || `# ${name} (Alias → ${alias.executor})\n\n${DESCRIPTIONS[name] || ""}`,
    };

    const output = generateFrontmatter(manifest);

    if (DRY_RUN) {
      console.log(`\n── ${name} (${alias.executor}) ──`);
      console.log(output.slice(0, 300) + "...");
    } else {
      writeFileSync(filePath, output);
      console.log(`  WRITE: ${file} (${output.split("\n").length} lines, alias→${alias.executor}, risk=${alias.risk})`);
    }
    generated++;
  }

  console.log(`\n${DRY_RUN ? "DRY RUN" : "Generated"}: ${generated} agent manifests`);
}

main();
