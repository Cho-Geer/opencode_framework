// safe_bash: allow-write
/**
 * dispatch-subagent.js
 * General-purpose sub-agent dispatcher with P0 protocol enforcement.
 *
 * Usage:
 *   node dispatch-subagent.js <agent_type> "<task_description>"
 *   node dispatch-subagent.js <agent_type> "<task_id>" "<task_description>"
 *
 * When 1 positional param follows agent_type → treated as task_description.
 * When 2 positional params follow agent_type → first = task_id, second = task_description.
 * Env vars (FRAMEWORK_TASK_ID, DISPATCH_TASK_DESC) and --task-id flag always take precedence.
 *
 * NOTE: task_id (FRAMEWORK_TASK_ID) is a dispatch session identifier — an ID
 * assigned to the background sub-agent process/delegation in OpenCode. It is
 * used for output path namespacing (.task_temp/{taskId}/) and session tracking.
 * It is NOT a DAG task ID and should NOT be validated against Task.DAG.json.
 * Pre-execution gate is called with --dispatch-session flag to skip DAG checks.
 *
 * Reads:
 *   .opencode/project.config.json          — project config (project_root, tech_stack, paths)
 *   .opencode/agents/<agent_type>.md       — agent skills + MCP tools
 *   .opencode/subagent-preamble.md         — P0 protocol template
 *
 * Outputs:
 *   Wrapped prompt to stdout (file path) + saves to .task_temp/_dispatch/<timestamp>.md
 *
 * The primary agent MUST:
 *   1. Run this script via bash
 *   2. Read the output file
 *   3. Use the content as the prompt for Task(subagent_type)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OPENCODE_ROOT =
  process.env.OPENCODE_ROOT ? path.resolve(process.env.OPENCODE_ROOT) : path.resolve(__dirname, "..", "..", "..");
const AGENTS_DIR = path.join(OPENCODE_ROOT, ".opencode", "agents");
const PREAMBLE_FILE = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "subagent-preamble.md",
);
const PROJECT_CONFIG = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "project.config.json",
);
const OUTPUT_DIR = path.join(OPENCODE_ROOT, ".task_temp", "_dispatch");

// ── 日志重定向 ──
const LOG_FILE = path.join(OPENCODE_ROOT, ".task_temp", "_dispatch", "dispatch.log");

function logInfo(msg) {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] INFO  ${msg}\n`);
}
function logWarn(msg) {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] WARN  ${msg}\n`);
}

// ──────────────────────────────────────────────
// 1. Parse CLI arguments
// ──────────────────────────────────────────────
// Support:
//   node dispatch-subagent.js <agent_type> "<task_description>" [--task-id <id>]
//   node dispatch-subagent.js <agent_type> "<task_id>" "<task_description>" [--task-id <id>]
//
// Resolution priority (highest wins):
//   1. Env vars: FRAMEWORK_TASK_ID, DISPATCH_TASK_DESC (set by dispatch_subagent.ts)
//   2. Positional args: argv[3]=task_id, argv[4]=task_description (if both present)
//   3. --task-id CLI flag (legacy)
//   4. Single positional arg: argv[3]=task_description (backward compatible)
let taskId = process.env.FRAMEWORK_TASK_ID || null;

// NEW: Detect 2+ positional params after agent_type for task_id+task_description
// Pattern: node dispatch-subagent.js <agent_type> "<task_id>" "<task_description>"
if (!taskId && process.argv.length >= 5 && !process.argv[3].startsWith('--')) {
  taskId = process.argv[3];
  // Remove task_id from argv so process.argv[3] shifts to task_description
  process.argv.splice(3, 1);
}

// Fall back to --task-id CLI flag
if (!taskId) {
  const taskIdFlagIdx = process.argv.indexOf("--task-id");
  if (taskIdFlagIdx !== -1 && taskIdFlagIdx + 1 < process.argv.length) {
    taskId = process.argv[taskIdFlagIdx + 1];
    // Remove --task-id and its value from argv for clean processing
    process.argv.splice(taskIdFlagIdx, 2);
  }
}
process.env.FRAMEWORK_TASK_ID = taskId || "";
process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated";

const agentType = process.argv[2];
process.env.FRAMEWORK_AGENT = '@' + agentType;

// task_description: env var > argv[4] (if task_id was spliced, argv[3] is now desc) > argv[3]
const taskDescription = process.env.DISPATCH_TASK_DESC || process.argv[3] || "";

if (!agentType) {
  console.error(
    'Usage: node dispatch-subagent.js <agent_type> "<task_description>"',
  );
  console.error(
    '       node dispatch-subagent.js <agent_type> "<task_id>" "<task_description>"',
  );
  console.error(
    'Example: node dispatch-subagent.js Architect "Validate architecture"',
  );
  console.error(
    'Example: node dispatch-subagent.js Architect "dispatch-20260603" "Implement booking service"',
  );
  process.exit(1);
}

if (!taskDescription) {
  console.error("ERROR: task_description is required");
  console.error(
    'Usage: node dispatch-subagent.js <agent_type> "<task_description>"',
  );
  console.error(
    '       node dispatch-subagent.js <agent_type> "<task_id>" "<task_description>"',
  );
  process.exit(1);
}

// ──────────────────────────────────────────────
// 1.5 Pre-Execution Gate Check (if --task-id provided)
// ──────────────────────────────────────────────
if (taskId) {
  const gateScript = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "pre-execution-gate.js",
  );
  if (fs.existsSync(gateScript)) {
    logInfo(`Running pre-execution-gate.js for dispatch session '${taskId}' (--dispatch-session)...`);
    try {
      const { execSync } = require("child_process");
      const gateResult = execSync(`"${process.execPath}" "${gateScript}" "${taskId}" --dispatch-session`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15000,
        env: { ...process.env, OPENCODE_ROOT },
      });
      logInfo(`Pre-execution gate passed: ${gateResult.substring(0, 200)}`);
    } catch (e) {
      logWarn(`Pre-execution gate failed: ${e.stderr?.toString() || e.message}`);
      console.error(
        `[dispatch] ❌ Pre-execution gate BLOCKED dispatch for task '${taskId}'.`,
      );
      console.error(
        `[dispatch] Exit code: ${e.status}, Signal: ${e.signal || "none"}`,
      );
      process.exit(e.status || 1);
    }
  } else {
    console.error(
      `[dispatch] ⚠️  pre-execution-gate.js not found — skipping gate check.`,
    );
    console.error(
      `[dispatch] ⚠️  Install with: node .opencode/scripts/install-hooks.js`,
    );
  }
}

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
            label:
              stack && typeof stack === "object"
                ? stack.framework ||
                  stack.orm ||
                  stack.engine ||
                  stack.mechanism ||
                  stack.unit ||
                  stack.name ||
                  ""
                : typeof stack === "string"
                  ? stack
                  : stackKey,
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

function extractPermission(rawContent) {
  const permission = {};
  const lines = rawContent.split("\n");
  let capture = false;

  for (const line of lines) {
    if (line.trim() === "permission:") {
      capture = true;
      continue;
    }
    if (!capture) continue;

    if (
      line.trim() === "---" ||
      (line.trim() !== "" &&
        !line.startsWith("  ") &&
        !line.startsWith("\t") &&
        !line.trim().startsWith("#"))
    ) {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(\w[\w_-]*):\s*(.*)/);
    if (match) {
      permission[match[1]] = match[2].trim();
    }
  }

  return Object.keys(permission).length > 0 ? permission : null;
}

// ──────────────────────────────────────────────
// Read opencode.json runtime permissions for this agent
// ──────────────────────────────────────────────
function readRuntimePermissions(agentType) {
  const opencodeJsonPath = path.join(OPENCODE_ROOT, "opencode.json");
  if (!fs.existsSync(opencodeJsonPath)) {
    logWarn(`opencode.json not found at ${opencodeJsonPath}`);
    return null;
  }
  try {
    const raw = fs.readFileSync(opencodeJsonPath, "utf8");
    const opencodeConfig = JSON.parse(raw);
    const agentDict = opencodeConfig.agent || {};
    const agentKey = Object.keys(agentDict).find(
      (key) => key.toLowerCase() === agentType.toLowerCase()
    );
    if (!agentKey) {
      logWarn(`Agent "${agentType}" not found in opencode.json`);
      return null;
    }
    return {
      permission: agentDict[agentKey].permission || {},
    };
  } catch (e) {
    console.error(
      `[dispatch] WARNING: Failed to parse opencode.json for ${agentType}: ${e.message}`
    );
    return null;
  }
}

const agentConfig = parseFrontmatter(agentContent);
const agentName = agentConfig.name || agentType;
const skills = agentConfig.skills || [];
const mcpTools = agentConfig.mcp_tools || [];
const permission = extractPermission(agentContent);

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
    logWarn(
      `Unresolvable placeholder '${match}' in ${sourceLabel}`,
    );
    return `UNRESOLVED${match}`;
  });
}

const templateMap = buildTemplateResolutionMap(projectConfig);
logInfo(
  `Template resolution map: ${Object.keys(templateMap).length} keys`,
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

logInfo(`Project: ${projectConfig.project.name}`);
logInfo(`Project root: ${projectRoot}`);
logInfo(`OPENCODE_ROOT: ${OPENCODE_ROOT}`);
logInfo(`Agent: ${agentName}`);
logInfo(`Skills: ${skills.join(", ")}`);
logInfo(`MCP tools: ${mcpTools.join(", ")}`);
logInfo(
  `Context7 stacks matched: ${relevantStacks.map((s) => s.label).join(", ")}`,
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
  ...Object.entries(techStack).map(
    ([key, val]) =>
      `  - ${key}: ${typeof val === "string" ? val : val && typeof val === "object" ? val.framework || val.orm || val.engine || val.mechanism || val.unit || val.name || Object.values(val)[0] || "" : val}`,
  ),
  `**Backend path**: \`${resolvedBackend}\``,
  `**Frontend path**: \`${resolvedFrontend}\``,
  `**Contracts**: \`${resolvedContracts}\``,
].join("\n");

// ──────────────────────────────────────────────
// Build Permissions Section
// ──────────────────────────────────────────────
const runtimePerms = readRuntimePermissions(agentType);

const configPermSection = permission
  ? Object.entries(permission)
      .map(([tool, access]) => `  - ${tool}: ${access}`)
      .join("\n")
  : "  - (no permission block declared in agent config)";

const runtimePermSection = (runtimePerms && runtimePerms.permission)
  ? Object.entries(runtimePerms.permission)
      .map(([key, val]) => {
        const valStr = typeof val === "object" ? JSON.stringify(val, null, 4).replace(/\n/g, "\n    ") : String(val);
        return `  - ${key}: ${valStr}`;
      })
      .join("\n")
  : "  - (not found in opencode.json — check your permissions manually)";

const permissionsSection = `
## 🔑 Your Permissions

### Source 1: Agent Config File (.opencode/agents/${agentFileEntry})
_A declarative guide — tells you which tools are relevant to your role_
${configPermSection}

### Source 2: Runtime Enforcement (opencode.json)
_The authoritative source — controls what you can actually invoke_
${runtimePermSection}

### Conflict Resolution
If Source 1 and Source 2 conflict, **Source 2 (opencode.json) is authoritative**.
- Tools/config declared in your config file but NOT in opencode.json → may be blocked at runtime
- Permissions granted in opencode.json but NOT in your config file → still usable (opencode.json grants them)
- Always verify by reading opencode.json directly (see Step 1a of P0 protocol)
`;

const wrappedPrompt = `## 🔒 SUBAGENT: ${agentName}

### P0 Protocol — Read and execute FIRST

${preamble}

/**
 * Phase 2 R5: Agent-type awareness injection.
 * Injects targeted guidance so code-producing agents (@Coder-BE, @Coder-FE)
 * know that Steps 5a/5b are mandatory; non-coding agents see them as informational.
 */
${agentType === "Coder-BE" || agentType === "Coder-FE"
  ? `> **Agent-type note**: As a code-producing agent (@${agentType}), Steps 5a (docs consistency) and 5b (write-time quality) in the P0 protocol above are **MANDATORY** for all source code changes.`
  : `> **Agent-type note**: As a ${agentType}, Steps 5a and 5b in the P0 protocol above are informational — you may not be writing source code.`}

---

### Agent Configuration (from .opencode/agents/${agentFileEntry})

**Agent Name**: ${agentName}

**Your Skills** (invoke in this order; P0 skills first):
${skills.map((s) => `- \`${s}\``).join("\n")}

**Your MCP Tools** (call as needed):
${mcpTools.map((t) => `- \`${t}\``).join("\n")}

${permissionsSection}

---

### Project Context (from .opencode/project.config.json)

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

**File persistence**: ALSO save a copy to \`.task_temp/_dispatch/INVOCATION_SUMMARY.md\` (append, do not overwrite). This creates a persistent audit trail across all sub-agent invocations.

---

### Task

**Agent**: ${agentName}
**Description**: ${resolvedTaskDescription}

### Execution Order
1. Read your agent configuration above
2. Execute all P0 protocol steps (skills → context7 → compliance gate → confirm)
3. Perform the task and produce output
4. Include \`## 📊 Invocation Summary\` section in your output

Remember: All runtime artifacts (test_report.json, HANDOVER.md, TASK_LOG.md, *_report.json) go to \`.task_temp/{taskId}/\`.`;

// ──────────────────────────────────────────────
// 5.5 Final template resolution pass on the wrapped prompt
// ──────────────────────────────────────────────
// The wrappedPrompt may contain unresolved {project.*}, {backend.*},
// {frontend.*}, {cache.*} placeholders from taskDescription or
// embedded content. This final pass ensures all template variables
// are resolved before the prompt is consumed by the sub-agent.
const resolvedPrompt = resolveTemplateVariables(
  wrappedPrompt,
  templateMap,
  "wrappedPrompt",
);

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
// Append DISPATCH_TOKEN for orchestrator enforcement verification
const dispatchToken = crypto.createHash("sha256").update(resolvedPrompt, "utf8").digest("hex");
const tokenizedPrompt = resolvedPrompt + `\n//DISPATCH_TOKEN:${dispatchToken}`;
fs.writeFileSync(outputFile, tokenizedPrompt, "utf8");

logInfo(`Output: ${outputFile}`);

// ──────────────────────────────────────────────
// 7. Output file path to stdout (for the primary agent)
// ──────────────────────────────────────────────
console.log(outputFile);
