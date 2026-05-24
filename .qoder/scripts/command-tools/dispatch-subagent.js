#!/usr/bin/env node
/**
 * dispatch-subagent.js
 * General-purpose sub-agent dispatcher with P0 protocol enforcement.
 *
 * Usage: node dispatch-subagent.js <agent_type> "<task_description>" [--platform qoder]
 *
 * Reads:
 *   .qoder/project.config.json             — project config (project_root, tech_stack, paths)
 *   .qoder/agents/<agent_type>.md          — agent skills + MCP tools
 *   .qoder/subagent-preamble.md            — P0 protocol template
 *
 * Outputs:
 *   Wrapped prompt to stdout (file path) + saves to .task_temp/_dispatch/<timestamp>.md
 *
 * The primary agent MUST:
 *   1. Run this script via run_in_terminal
 *   2. Read the output file
 *   3. Use the content as the prompt for Agent(subagent_type: X, ...)
 *
 * Platform modes:
 *   --platform qoder : Generates Qoder-compatible prompt with:
 *     - 8-role → Qoder subagent_type mapping
 *     - Qoder tool names (read_file, search_file, grep_code, run_in_terminal, etc.)
 *     - Agent(subagent_type: X, ...) dispatch pattern
 *   (default)        : Original OpenCode-compatible output (backward compat)
 */

const fs = require("fs");
const path = require("path");

const OPENCODE_ROOT =
  process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", "..", "..");
const AGENTS_DIR = path.join(OPENCODE_ROOT, ".qoder", "agents");
const PREAMBLE_FILE = path.join(
  OPENCODE_ROOT,
  ".qoder",
  "subagent-preamble.md",
);
const PROJECT_CONFIG = path.join(
  OPENCODE_ROOT,
  ".qoder",
  "project.config.json",
);
const OUTPUT_DIR = path.join(OPENCODE_ROOT, ".task_temp", "_dispatch");

// ──────────────────────────────────────────────
// 1. Parse CLI arguments
// ──────────────────────────────────────────────
const args = process.argv.slice(2);

// Extract --platform flag
let platform = "opencode"; // default: backward compatible
const platformIdx = args.indexOf("--platform");
if (platformIdx !== -1) {
  platform = (args[platformIdx + 1] || "opencode").toLowerCase();
  args.splice(platformIdx, 2); // remove flag from args
}

const agentType = args[0];
const taskDescription = args[1] || "";

if (!agentType) {
  console.error(
    'Usage: node dispatch-subagent.js <agent_type> "<task_description>" [--platform qoder]',
  );
  console.error(
    'Example: node dispatch-subagent.js Architect "Validate architecture" --platform qoder',
  );
  process.exit(1);
}

if (!taskDescription) {
  console.error("ERROR: task_description is required");
  process.exit(1);
}

// ──────────────────────────────────────────────
// 1.5 Qoder platform mapping
// ──────────────────────────────────────────────
const QODER_SUBAGENT_TYPE_MAP = {
  "meta-planner": "Research",
  "orchestrator": "Leader",
  "architect": "Research/Coding",
  "coder-be": "Coding",
  "coder-fe": "Coding",
  "guardian": "Verify",
  "arbiter": "Research",
  "ci-cd-agent": "Coding",
};

// Map OpenCode tool names → Qoder tool names
const QODER_TOOL_MAP = {
  "bash": "run_in_terminal",
  "Read": "read_file",
  "Write": "create_file",
  "Edit": "search_replace",
  "SearchCodebase": "search_codebase",
  "SearchFiles": "search_file",
  "Grep": "grep_code",
  "ListDir": "list_dir",
  "TodoWrite": "todo_write",
  "Task": "Agent",
};

function getQoderSubagentType(agentTypeLower) {
  return QODER_SUBAGENT_TYPE_MAP[agentTypeLower] || "Coding";
}

function translateToolReferences(content) {
  let result = content;
  for (const [opencodeTool, qoderTool] of Object.entries(QODER_TOOL_MAP)) {
    // Replace backtick-wrapped tool references
    result = result.replace(
      new RegExp("`" + opencodeTool + "`", "g"),
      "`" + qoderTool + "`",
    );
    // Replace Task(subagent_type pattern → Agent(subagent_type pattern
    if (opencodeTool === "Task") {
      result = result.replace(
        /Task\(subagent_type/g,
        "Agent(subagent_type",
      );
      result = result.replace(
        /Task\(search\)/g,
        "search_codebase",
      );
    }
  }
  return result;
}

const isQoderMode = platform === "qoder";
const qoderSubagentType = isQoderMode
  ? getQoderSubagentType(agentType.toLowerCase())
  : null;

// ──────────────────────────────────────────────
// 2. Read project config
// ──────────────────────────────────────────────
const projectConfig = JSON.parse(fs.readFileSync(PROJECT_CONFIG, "utf8"));
const projectRoot = projectConfig.project_root || ".";
const techStack = projectConfig.tech_stack || {};
const taskMapping = projectConfig.context7_task_mapping || [];

// Resolve a path: OPENCODE_ROOT / project_root / path_value
function resolveProjectPath(relativePath) {
  if (projectRoot === "." || projectRoot === "") {
    return path.join(OPENCODE_ROOT, relativePath);
  }
  return path.join(OPENCODE_ROOT, projectRoot, relativePath);
}

// Determine which tech stacks are relevant based on task description keywords
function findRelevantStacks(description, mapping, stackConfig) {
  const result = [];
  for (const entry of mapping) {
    const match = entry.keywords.some((kw) =>
      description.toLowerCase().includes(kw),
    );
    if (match) {
      for (const stackKey of entry.stacks) {
        const stack = stackConfig[stackKey];
        if (stack && !result.find((r) => r.key === stackKey)) {
          result.push({
            key: stackKey,
            label: stack.name,
            query: stack.context7_query,
          });
        }
      }
    }
  }
  return result;
}

const relevantStacks = findRelevantStacks(
  taskDescription,
  taskMapping,
  techStack,
);

// ──────────────────────────────────────────────
// 3. Read agent config file (case-insensitive lookup)
// ──────────────────────────────────────────────
const agentFiles = fs.readdirSync(AGENTS_DIR);
const agentFileEntry = agentFiles.find(
  (f) => f.toLowerCase() === `${agentType.toLowerCase()}.md`,
);
if (!agentFileEntry) {
  console.error(
    `ERROR: Agent config not found for "${agentType}". Available: ${agentFiles.filter((f) => f.endsWith(".md")).join(", ")}`,
  );
  process.exit(1);
}
const agentFile = path.join(AGENTS_DIR, agentFileEntry);
const agentContent = fs.readFileSync(agentFile, "utf8");

// Parse YAML frontmatter
function parseFrontmatter(content) {
  const lines = content.split("\n");
  let inFrontmatter = false;
  let frontmatterLines = [];
  let frontmatterCount = 0;

  for (const line of lines) {
    if (line.trim() === "---") {
      frontmatterCount++;
      if (frontmatterCount === 1) {
        inFrontmatter = true;
        continue;
      }
      if (frontmatterCount === 2) break;
    }
    if (inFrontmatter) frontmatterLines.push(line);
  }

  return parseYamlSimple(frontmatterLines.join("\n"));
}

function parseYamlSimple(yaml) {
  const result = {};
  let currentKey = null;

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const topMatch = trimmed.match(/^(\w[\w_-]*):\s*(.*)/);
    if (topMatch && !trimmed.startsWith("-")) {
      currentKey = topMatch[1];
      const val = topMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        result[currentKey] = val.slice(1, -1);
      } else if (val.startsWith("'") && val.endsWith("'")) {
        result[currentKey] = val.slice(1, -1);
      } else if (val !== "") {
        result[currentKey] = val;
      } else {
        result[currentKey] = [];
      }
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

const agentConfig = parseFrontmatter(agentContent);
const agentName = agentConfig.name || agentType;
const skills = agentConfig.skills || [];
const mcpTools = agentConfig.mcp_tools || [];

// ──────────────────────────────────────────────
// 3.5 Build template variable resolution map
// ──────────────────────────────────────────────
// Resolution priority (highest wins):
//   1. template_resolution section (authoritative overrides)
//   2. tech_stack.* fields (standard technology descriptors)
//   3. paths.* fields (directory layout)
//   4. project.* fields (project metadata)
// All non-empty template_resolution entries are included automatically,
// so new placeholders added to project.config.json resolve without
// requiring code changes in this file.
function buildTemplateResolutionMap(projectConfig) {
  const map = {};
  const tr = projectConfig.template_resolution || {};

  // ── Phase 1: Base values from project metadata ──
  if (projectConfig.project) {
    map["project.name"] = projectConfig.project.name || "";
    map["project.version"] = projectConfig.project.version || "";
  }
  map["project_root"] = projectConfig.project_root || ".";

  // ── Phase 2: Base values from tech_stack (standard descriptors) ──
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
  map["testing.coverage_threshold"] = testStack.coverage_threshold
    ? String(testStack.coverage_threshold)
    : "";

  // ── Phase 3: Base values from paths ──
  if (projectConfig.paths?.backend_src)
    map["backend.src"] = projectConfig.paths.backend_src;
  if (projectConfig.paths?.frontend_src)
    map["frontend.src"] = projectConfig.paths.frontend_src;

  // ── Phase 4: template_resolution overrides (authoritative) ──
  // ALL non-empty string entries in template_resolution are added to the map.
  // Keys with a dot (e.g. "backend.orm.schema") are used as-is.
  // Bare keys without a dot (e.g. "contract_hash_command") are namespaced
  // under "project.*" since they represent project-level settings.
  // This ensures any placeholder defined in project.config.json is
  // automatically resolvable without code changes to this file.
  for (const key of Object.keys(tr)) {
    const val = tr[key];
    if (typeof val === "string" && val.trim() !== "") {
      const mapKey = key.includes(".") ? key : `project.${key}`;
      map[mapKey] = val;
    }
  }

  return map;
}

// ──────────────────────────────────────────────
// 3.6 Template variable resolution function
// ──────────────────────────────────────────────
function resolveTemplateVariables(content, templateMap, sourceLabel) {
  if (!content || Object.keys(templateMap).length === 0) return content;

  return content.replace(/\{([a-z_]+\.[a-z_.]+)\}/g, (match, key) => {
    if (templateMap.hasOwnProperty(key)) {
      return templateMap[key];
    }
    console.error(
      `[dispatch] WARNING: Unresolvable placeholder '${match}' in ${sourceLabel}`,
    );
    return `UNRESOLVED${match}`;
  });
}

const templateMap = buildTemplateResolutionMap(projectConfig);
console.error(
  `[dispatch] Template resolution map: ${Object.keys(templateMap).length} keys`,
);

// Resolve placeholders in CLI task description
const resolvedTaskDescription = resolveTemplateVariables(
  taskDescription,
  templateMap,
  "CLI task_description",
);

// Resolve placeholders in agent content
const resolvedAgentContent = resolveTemplateVariables(
  agentContent,
  templateMap,
  agentFileEntry,
);

console.error(`[dispatch] Platform: ${platform}`);
console.error(`[dispatch] Project: ${projectConfig.project.name}`);
console.error(`[dispatch] Project root: ${projectRoot}`);
console.error(`[dispatch] OPENCODE_ROOT: ${OPENCODE_ROOT}`);
console.error(`[dispatch] Agent: ${agentName}`);
if (isQoderMode) {
  console.error(`[dispatch] Qoder subagent_type: ${qoderSubagentType}`);
}
console.error(`[dispatch] Skills: ${skills.join(", ")}`);
console.error(`[dispatch] MCP tools: ${mcpTools.join(", ")}`);
console.error(
  `[dispatch] Context7 stacks matched: ${relevantStacks.map((s) => s.label).join(", ")}`,
);

// ──────────────────────────────────────────────
// 4. Read preamble template
// ──────────────────────────────────────────────
let preamble = "";
if (fs.existsSync(PREAMBLE_FILE)) {
  preamble = fs.readFileSync(PREAMBLE_FILE, "utf8");
  preamble = preamble.replace(/^---[\s\S]*?---\n*/, ""); // strip frontmatter
  // Resolve template variables in preamble
  preamble = resolveTemplateVariables(
    preamble,
    templateMap,
    "subagent-preamble.md",
  );
}

// ──────────────────────────────────────────────
// 5. Build the wrapped prompt
// ──────────────────────────────────────────────

// Context7 section — generated from project.config.json
let context7Section =
  "- (determine based on task — see `project.config.json` `context7_task_mapping`)";
if (relevantStacks.length > 0) {
  context7Section = `This task touches the following stacks. Resolve and query each via \`context7_resolve-library-id\` + \`context7_query-docs\`:\n${relevantStacks
    .map((s) => `- **${s.label}** — query: \`${s.query}\``)
    .join("\n")}`;
}

// Resolve actual paths for display
const resolvedBackend = resolveProjectPath(
  projectConfig.paths.backend_src || "",
);
const resolvedFrontend = resolveProjectPath(
  projectConfig.paths.frontend_src || "",
);
const resolvedContracts = resolveProjectPath(
  projectConfig.paths.contracts || "",
);

// Project context section
const projectContext = [
  `**Project**: ${projectConfig.project.name}`,
  `**OPENCODE_ROOT**: \`${OPENCODE_ROOT}\``,
  `**project_root**: \`${projectRoot}\``,
  `**Tech stack**:`,
  ...Object.entries(techStack).map(([key, val]) => `  - ${key}: ${val.name}`),
  `**Backend path**: \`${resolvedBackend}\``,
  `**Frontend path**: \`${resolvedFrontend}\``,
  `**Contracts**: \`${resolvedContracts}\``,
].join("\n");

// Build agent scope constraints section from agent config content
const agentScopeSection = isQoderMode
  ? `### Agent Scope Constraints (from .qoder/agents/${agentFileEntry})

${resolvedAgentContent.replace(/^---[\s\S]*?---\n*/, "").trim()}

---`
  : "";

// Build Qoder-specific dispatch header
const dispatchHeader = isQoderMode
  ? `## 🔒 QODER SUBAGENT: ${agentName} (type: ${qoderSubagentType})`
  : `## 🔒 SUBAGENT: ${agentName}`;

// Build tool reference section for Qoder
const toolReferenceSection = isQoderMode
  ? `### Qoder Tool Reference

You have access to these Qoder platform tools:
- \`read_file\` — Read file contents
- \`search_file\` — Find files by glob pattern
- \`grep_code\` — Search code with regex (ripgrep)
- \`search_codebase\` — Semantic code search
- \`search_symbol\` — Find symbol definitions and relationships
- \`list_dir\` — List directory contents
- \`create_file\` — Create or overwrite files
- \`search_replace\` — Edit files with precise replacements
- \`run_in_terminal\` — Execute shell commands
- \`todo_write\` — Track task progress
- \`search_memory\` / \`update_memory\` — Recall and store knowledge
- \`TaskGet\` / \`TaskUpdate\` / \`TaskList\` — Task board management
- \`SendMessage\` — Communicate with Leader agent
- \`Skill\` — Invoke registered skills

MCP tools (compliance gate, context7) remain unchanged.

---`
  : "";

const wrappedPrompt = `${dispatchHeader}

### P0 Protocol — Read and execute FIRST

${preamble}

---

${agentScopeSection}

### Agent Configuration (from .qoder/agents/${agentFileEntry})

**Agent Name**: ${agentName}${isQoderMode ? `\n**Qoder Subagent Type**: ${qoderSubagentType}` : ""}

**Your Skills** (invoke in this order; P0 skills first):
${skills.map((s) => `- \`${s}\``).join("\n")}

**Your MCP Tools** (call as needed):
${mcpTools.map((t) => `- \`${t}\``).join("\n")}

---

${toolReferenceSection}

### Project Context (from .qoder/project.config.json)

${projectContext}

---

### Context7 Technology Lookup Requirements

${context7Section}

---

### 📊 Mandatory Audit Trail — Include in your final output

After task completion, you MUST append a section titled \`## 📊 Invocation Summary\` to your output. Include:

**Skills** (from your agent config above):
${skills.map((s) => `- \`${s}\`: ✅ Invoked or ❌ Not needed (state reason)`).join("\n")}

**MCP Tools** (from your agent config above):
${mcpTools.map((t) => `- \`${t}\`: ✅ Called or ❌ Not applicable (state reason)`).join("\n")}

**Context7** (for each tech stack queried):
- Library resolved: ... → Query: ... → Key finding: ...

**System tools**:
- \`compliance_gate_check\`: Session ID — status
- \`compliance_gate_confirm\`: Armed at timestamp
- \`compliance_gate_complete\`: Completed at timestamp
- \`context7_resolve-library-id\`: List libraries resolved
- \`context7_query-docs\`: List queries run with key results

Do NOT skip this section. It is required for audit trail compliance.

---

### Task

**Agent**: ${agentName}
**Description**: ${resolvedTaskDescription}

### Execution Order
1. Read your agent configuration above
2. Execute all P0 protocol steps (skills → context7 → compliance gate → confirm)
3. Perform the task and produce output
4. Include \`## 📊 Invocation Summary\` section in your output
${isQoderMode ? `5. Call \`TaskUpdate(taskId, status: completed)\` when done\n6. Call \`SendMessage\` to report completion to Leader` : ""}

Remember: All runtime artifacts (test_report.json, HANDOVER.md, TASK_LOG.md, *_report.json) go to \`.task_temp/{taskId}/\`.`;

// ──────────────────────────────────────────────
// 5.5 Final template resolution pass on the wrapped prompt
// ──────────────────────────────────────────────
// The wrappedPrompt may contain unreoslved {project.*}, {backend.*},
// {frontend.*}, {cache.*} placeholders from taskDescription or
// embedded content. This final pass ensures all template variables
// are resolved before the prompt is consumed by the sub-agent.
let resolvedPrompt = resolveTemplateVariables(
  wrappedPrompt,
  templateMap,
  "wrappedPrompt",
);

// ──────────────────────────────────────────────
// 5.6 Qoder platform tool translation pass
// ──────────────────────────────────────────────
if (isQoderMode) {
  resolvedPrompt = translateToolReferences(resolvedPrompt);
  console.error(`[dispatch] Applied Qoder tool translations`);
}

// ──────────────────────────────────────────────
// 6. Save to output file
// ──────────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputFile = path.join(
  OUTPUT_DIR,
  `dispatch-${agentType}-${timestamp}.md`,
);
fs.writeFileSync(outputFile, resolvedPrompt, "utf8");

console.error(`[dispatch] Output: ${outputFile}`);

// ──────────────────────────────────────────────
// 7. Output file path to stdout (for the primary agent)
// ──────────────────────────────────────────────
console.log(outputFile);
