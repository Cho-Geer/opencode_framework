// service/dispatch/prompt-builder.ts — Dispatch prompt builder
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/command-tools/dispatch-subagent.ts
// Orchestrates all prompt sections into the final dispatch prompt.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import { deliverablesTemplateMarkdown } from "../gate/deliverables";
import {
  findRelevantStacks,
  isFrameworkTask,
  buildContext7Section,
  buildProjectContextSection,
  buildScopeLine,
  buildKCGateFlowSection,
  buildTemplateResolutionMap,
  resolveTemplateVariables,
  type ProjectConfig,
  type TechStackEntry,
} from "./prompt-sections";
import { loadCodingStandardsForAgent } from "./coding-standards-loader";
import { resolveDispatchTarget } from "./agent-target";

const SRC = "service-dispatch-prompt-builder";

// PREAMBLE_FILE removed in T1.7 — content migrated to Skills
const PROJECT_CONFIG = path.join(process.env.OPENCODE_ROOT || process.cwd(), ".opencode", "project.config.json");

export interface PromptBuildInput {
  agentType: string;
  taskDescription: string;
  taskId?: string | null;
  dagTaskId?: string | null;
  openCodeRoot: string;
}

export interface PromptBuildResult {
  prompt: string;
  promptHash: string;
  dispatchToken: string;
  agentName: string;
  agentFile: string;
  resolvedTaskDescription: string;
}

/**
 * Parse YAML frontmatter from agent config file.
 */
function parseFrontmatter(content: string): Record<string, any> {
  const lines = content.split("\n");
  let inFrontmatter = false;
  let frontmatterLines: string[] = [];
  let frontmatterCount = 0;

  for (const line of lines) {
    if (line.trim() === "---") {
      frontmatterCount++;
      if (frontmatterCount === 1) { inFrontmatter = true; continue; }
      if (frontmatterCount === 2) break;
    }
    if (inFrontmatter) frontmatterLines.push(line);
  }

  return parseYamlSimple(frontmatterLines.join("\n"));
}

/**
 * Simple YAML parser for frontmatter.
 */
function parseYamlSimple(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentKey: string | null = null;

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const topMatch = trimmed.match(/^(\w[\w_-]*):\s*(.*)/);
    if (topMatch && !trimmed.startsWith("-")) {
      currentKey = topMatch[1];
      const val = topMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) result[currentKey] = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) result[currentKey] = val.slice(1, -1);
      else if (val !== "") result[currentKey] = val;
      else result[currentKey] = [];
      continue;
    }

    const listMatch = trimmed.match(/^-\s+(.*)/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(listMatch[1].trim());
    }
  }

  return result;
}

/**
 * Read project config with trailing comma tolerance.
 */
function readProjectConfig(): ProjectConfig {
  const raw = fs.readFileSync(PROJECT_CONFIG, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned);
  }
}

/**
 * Build the complete dispatch prompt.
 */
export function buildDispatchPrompt(input: PromptBuildInput): PromptBuildResult {
  const { agentType, taskDescription, taskId, dagTaskId, openCodeRoot } = input;
  const target = resolveDispatchTarget(agentType, openCodeRoot);

  // Read project config
  const projectConfig = readProjectConfig();
  const techStack = projectConfig.tech_stack || {};
  const taskMapping = projectConfig.context7_task_mapping || [];

  // Find relevant tech stacks
  const isFramework = isFrameworkTask(taskDescription);
  const relevantStacks: TechStackEntry[] = isFramework ? [] : findRelevantStacks(taskDescription, taskMapping, techStack);

  // Read agent config
  const profileRelativePath = target.profileRelativePath;
  const profileAbsolutePath = target.profileAbsolutePath;
  let agentContent = "";
  let agentConfig: Record<string, any> = {};
  let agentFileEntry = profileRelativePath || `(native:${target.nativeExecutor})`;
  if (profileAbsolutePath) {
    agentContent = fs.readFileSync(profileAbsolutePath, "utf8");
    agentConfig = parseFrontmatter(agentContent);
  }
  const agentName = agentConfig.name || target.displayName || agentType;

  // M16: Filter dispatch_subagent from KC's MCP tools
  let mcpTools = agentConfig.mcp_tools || [];
  if (target.requestedAgent.toLowerCase() === "knowledge-curator") {
    mcpTools = mcpTools.filter((t: string) => t !== "dispatch_subagent");
  }

  // Preamble removed in T1.7 — content migrated to Skills

  // dag_task_id is now injected directly into the task payload section (T1.7)
  const dagTaskIdNote = dagTaskId
    ? `> **dispatch-assigned dag_task_id**: \`${dagTaskId}\` — use this exact value when calling compliance_gate_check(task_id=...). Do NOT fabricate a different task_id.`
    : "";

  // Build template resolution map
  const templateMap = buildTemplateResolutionMap(projectConfig);

  // Resolve template variables in task description and agent content
  const resolvedTaskDescription = resolveTemplateVariables(taskDescription, templateMap, "CLI task_description");
  const resolvedAgentContent = agentContent
    ? resolveTemplateVariables(agentContent, templateMap, agentFileEntry)
    : "";
  // Preamble template resolution removed in T1.7

  // Build sections
  const context7Section = buildContext7Section(relevantStacks);
  const projectContext = buildProjectContextSection(projectConfig, openCodeRoot);
  const scopeLine = buildScopeLine(target.requestedAgent);
  const context7Block = relevantStacks.length > 0 ? `\n\n---\n\n### Context7 Technology Lookup Requirements\n\n${context7Section}` : "";

  // Build deliverables template
  const deliverablesSection = deliverablesTemplateMarkdown(target.requestedAgent);

  // A-5: Role-based coding standards injection
  const codingStandardsSection = loadCodingStandardsForAgent(target.requestedAgent);

  // KC-specific gate flow section
  const kcSection = target.requestedAgent.toLowerCase() === "knowledge-curator" ? buildKCGateFlowSection() : "";

  // Assemble wrapped prompt
  const wrappedPrompt = `## 🔒 SUBAGENT: ${agentName}

### Task Payload

- **Agent**: ${agentName}
- **Native executor**: ${target.nativeExecutor}
- **Task**: ${resolvedTaskDescription}
- **payload_sha256**: ${crypto.createHash("sha256").update(resolvedTaskDescription, "utf8").digest("hex").substring(0, 16)}
- **task_id**: ${taskId || "(none)"}
- **Invocation Summary**: append \`## 📊 Invocation Summary\` to output and \`.task_temp/_dispatch/INVOCATION_SUMMARY.md\`

### 🚨 Your Scope — Framework-Enforced
${scopeLine}

### Dispatch Protocol

${dagTaskIdNote}

- Load \`preflight-lite\` Skill for task classification and execution skill selection.
- For investigation/debug tasks, also load \`brainstorming\` and \`codegraph-first\`.
- For deliverable tasks, also load \`deliverable-contract\`.
- Prefer native \`Task\` for child work; use \`dispatch_subagent\` only when legacy wrapper behavior is explicitly required.
- Use TodoWrite as external working memory (one in_progress at a time).
- On tool failure, update todo with recovery intent before retrying.
- Comply with active hooks for scope/codegraph/permission; do not bypass blocks.

${deliverablesSection}${kcSection}

${codingStandardsSection}

---

### Agent Configuration (from ${agentFileEntry})

**Agent Name**: ${agentName}

**IMPORTANT — R1 SLIM (2026-06-19)**: Your role profile defines your skills and MCP expectations.
Read \`${agentFileEntry}\` via the \`read\` tool before framework-specific execution if you need
the full list. This saves ~194 lines per dispatch.

---

### Project Context (from .opencode/project.config.json)

${projectContext}${context7Block}


---

`;

  // Final template resolution pass
  const resolvedPrompt = resolveTemplateVariables(wrappedPrompt, templateMap, "wrappedPrompt");

  // Generate dispatch token and hash. Metadata markers are included in the
  // integrity envelope so task-before can safely rewrite subagent_type.
  const promptWithMetadata =
    resolvedPrompt +
    `\n//REQUESTED_AGENT:${target.requestedAgent}` +
    `\n//NATIVE_EXECUTOR:${target.nativeExecutor}`;
  const dispatchToken = crypto
    .createHash("sha256")
    .update(promptWithMetadata, "utf8")
    .digest("hex");
  const tokenizedPrompt = promptWithMetadata + `\n//DISPATCH_TOKEN:${dispatchToken}`;
  const promptHash = crypto.createHash("sha256").update(tokenizedPrompt, "utf8").digest("hex");

  writeLog(SRC, "INFO", {
    event: "PROMPT_BUILT",
    agent: agentType,
    task_id: taskId || "none",
    hash: promptHash.substring(0, 12),
  });

  return {
    prompt: tokenizedPrompt,
    promptHash,
    dispatchToken,
    agentName,
    agentFile: agentFileEntry,
    resolvedTaskDescription,
  };
}
