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

const SRC = "service-dispatch-prompt-builder";

const AGENTS_DIR = path.join(process.env.OPENCODE_ROOT || process.cwd(), ".opencode", "agents");
const PREAMBLE_FILE = path.join(process.env.OPENCODE_ROOT || process.cwd(), ".opencode", "subagent-preamble.md");
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
 * Find agent config file (case-insensitive).
 */
function findAgentFile(agentType: string): { file: string; entry: string } | null {
  const agentFiles = fs.readdirSync(AGENTS_DIR);
  const entry = agentFiles.find((f) => f.toLowerCase() === `${agentType.toLowerCase()}.md`);
  if (!entry) return null;
  return { file: path.join(AGENTS_DIR, entry), entry };
}

/**
 * Build the complete dispatch prompt.
 */
export function buildDispatchPrompt(input: PromptBuildInput): PromptBuildResult {
  const { agentType, taskDescription, taskId, dagTaskId, openCodeRoot } = input;

  // Read project config
  const projectConfig = readProjectConfig();
  const techStack = projectConfig.tech_stack || {};
  const taskMapping = projectConfig.context7_task_mapping || [];

  // Find relevant tech stacks
  const isFramework = isFrameworkTask(taskDescription);
  const relevantStacks: TechStackEntry[] = isFramework ? [] : findRelevantStacks(taskDescription, taskMapping, techStack);

  // Read agent config
  const agentFileResult = findAgentFile(agentType);
  if (!agentFileResult) {
    throw new Error(`Agent config not found for "${agentType}".`);
  }
  const agentContent = fs.readFileSync(agentFileResult.file, "utf8");
  const agentConfig = parseFrontmatter(agentContent);
  const agentName = agentConfig.name || agentType;

  // M16: Filter dispatch_subagent from KC's MCP tools
  let mcpTools = agentConfig.mcp_tools || [];
  if (agentType.toLowerCase() === "knowledge-curator") {
    mcpTools = mcpTools.filter((t: string) => t !== "dispatch_subagent");
  }

  // Read preamble
  let preamble = "";
  if (fs.existsSync(PREAMBLE_FILE)) {
    preamble = fs.readFileSync(PREAMBLE_FILE, "utf8").replace(/^---[\s\S]*?---\n*/, "");
  }

  // Inject dag_task_id into preamble
  if (dagTaskId) {
    preamble += `\n> **Your dispatch-assigned dag_task_id**: \`${dagTaskId}\` — use this exact value when calling compliance_gate_check(task_id=...). Do NOT fabricate a different task_id.\n`;
  }

  // Build template resolution map
  const templateMap = buildTemplateResolutionMap(projectConfig);

  // Resolve template variables in task description and agent content
  const resolvedTaskDescription = resolveTemplateVariables(taskDescription, templateMap, "CLI task_description");
  const resolvedAgentContent = resolveTemplateVariables(agentContent, templateMap, agentFileResult.entry);
  preamble = resolveTemplateVariables(preamble, templateMap, "subagent-preamble.md");

  // Build sections
  const context7Section = buildContext7Section(relevantStacks);
  const projectContext = buildProjectContextSection(projectConfig, openCodeRoot);
  const scopeLine = buildScopeLine(agentType);
  const context7Block = relevantStacks.length > 0 ? `\n\n---\n\n### Context7 Technology Lookup Requirements\n\n${context7Section}` : "";

  // Build deliverables template
  const deliverablesSection = deliverablesTemplateMarkdown(agentType);

  // A-5: Role-based coding standards injection
  const codingStandardsSection = loadCodingStandardsForAgent(agentType);

  // KC-specific gate flow section
  const kcSection = agentType.toLowerCase() === "knowledge-curator" ? buildKCGateFlowSection() : "";

  // Assemble wrapped prompt
  const wrappedPrompt = `## 🔒 SUBAGENT: ${agentName}

### Task Payload

- **Agent**: ${agentName}
- **Task**: ${resolvedTaskDescription}
- **payload_sha256**: ${crypto.createHash("sha256").update(resolvedTaskDescription, "utf8").digest("hex").substring(0, 16)}
- **task_id**: ${taskId || "(none)"}
- **Invocation Summary**: append \`## 📊 Invocation Summary\` to output and \`.task_temp/_dispatch/INVOCATION_SUMMARY.md\`

### 🚨 Your Scope — Framework-Enforced
${scopeLine}

### P0 Protocol — Read and execute FIRST

${preamble}

${deliverablesSection}${kcSection}

${codingStandardsSection}

---

### Agent Configuration (from .opencode/agents/${agentFileResult.entry})

**Agent Name**: ${agentName}

**IMPORTANT — R1 SLIM (2026-06-19)**: Your skills and MCP tools are defined in your
agent config file. Read \`.opencode/agents/${agentFileResult.entry}\` via the \`read\` tool
as part of P0 Step 0e to see the full list. This saves ~194 lines per dispatch.

---

### Project Context (from .opencode/project.config.json)

${projectContext}${context7Block}


---

`;

  // Final template resolution pass
  const resolvedPrompt = resolveTemplateVariables(wrappedPrompt, templateMap, "wrappedPrompt");

  // Generate dispatch token and hash
  const dispatchToken = crypto.createHash("sha256").update(resolvedPrompt, "utf8").digest("hex");
  const tokenizedPrompt = resolvedPrompt + `\n//DISPATCH_TOKEN:${dispatchToken}`;
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
    agentFile: agentFileResult.entry,
    resolvedTaskDescription,
  };
}
