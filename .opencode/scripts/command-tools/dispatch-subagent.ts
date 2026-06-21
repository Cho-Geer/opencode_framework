// safe_bash: allow-write
// BUN-CACHE-VERSION: 2026-06-09-v5 — HARDENED: dag_task_id reuse → FATAL EXIT (not warning)
/**
 * dispatch-subagent.ts
 * General-purpose sub-agent dispatcher with P0 protocol enforcement.
 *
 * Usage:
 *   bun dispatch-subagent.ts <agent_type> "<task_description>"
 *   bun dispatch-subagent.ts <agent_type> "<task_id>" "<task_description>"
 *
 * When 1 positional param follows agent_type → treated as task_description.
 * When 2 positional params follow agent_type → first = task_id, second = task_description.
 * --task-id CLI flag and .dispatch_ctx file always take precedence.
 *
 * M14 (2026-06-19): Extended dispatch permissions — sub-agents (all non-Orchestrator,
 * non-Super-Admin agents) may now dispatch directly to @Knowledge-Curator for
 * UC7KS knowledge acquisition without routing through @Orchestrator.
 * Enforced by dispatch-before.ts plugin (M14 dispatch target restriction).
 * Sub-agents remain restricted to Knowledge-Curator only; all other targets
 * must be routed through @Orchestrator or @Super-Admin.
 *
 * NOTE: task_id is a dispatch session identifier — an ID
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
const {
  deliverablesTemplateMarkdown,
  isExemptAgent,
} = require("../../lib/deliverables-templates");
const { dbQuerySessionByDagTaskId } = require("../../lib/db-state-manager");
const { writeLog } = require("../../lib/log-manager");

const OPENCODE_ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(__dirname, "..", "..", "..");
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
function logInfo(msg) {
  writeLog("dispatch-subagent", "runtime", {
    level: "INFO",
    event: "DISPATCH-INFO",
    detail: msg,
  });
}
function logWarn(msg) {
  writeLog("dispatch-subagent", "runtime", {
    level: "WARN",
    event: "DISPATCH-WARN",
    detail: msg,
  });
}

// ──────────────────────────────────────────────
// 1. Parse CLI arguments
// ──────────────────────────────────────────────
// Support:
//   bun dispatch-subagent.ts <agent_type> "<task_description>" [--task-id <id>]
//   bun dispatch-subagent.ts <agent_type> "<task_id>" "<task_description>" [--task-id <id>]
//
// Resolution priority (highest wins):
//   1. --task-id CLI flag (explicit)
//   2. Positional args: argv[3]=task_id, argv[4]=task_description (if both present)
//   3. .dispatch_ctx file (written by dispatch_subagent.ts, dag_task_id field)
//   4. Single positional arg: argv[3]=task_description (backward compatible)
// FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): FRAMEWORK_TASK_ID env var removed from all paths.
// The child script now reads task_id from .dispatch_ctx file or CLI args only.
let taskId = null;

// NEW: Detect 2+ positional params after agent_type for task_id+task_description
// Pattern: bun dispatch-subagent.ts <agent_type> "<task_id>" "<task_description>"
if (!taskId && process.argv.length >= 5 && !process.argv[3].startsWith("--")) {
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

// Fall back to .dispatch_ctx file (written by parent dispatch_subagent.ts)
if (!taskId) {
  try {
    const ctxPath = path.join(
      OPENCODE_ROOT,
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      taskId = ctx.dagTaskId || null;
    }
  } catch {
    /* file missing or malformed — continue without task_id */
  }
}
process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated";

const agentType = process.argv[2];

// Identity propagated via TASK-IDENTITY in plugin toolExecuteBefore (v4.2.0)

// task_description: env var > argv[4] (if task_id was spliced, argv[3] is now desc) > argv[3]
const taskDescription = process.env.DISPATCH_TASK_DESC || process.argv[3] || "";

if (!agentType) {
  writeLog("dispatch-subagent", "runtime", {
    level: "ERROR",
    event: "CLI-ARGUMENT-ERROR",
    detail:
      'Missing agent_type. Usage: bun dispatch-subagent.ts <agent_type> "<task_description>"',
  });
  console.error(
    'Usage: bun dispatch-subagent.ts <agent_type> "<task_description>"',
  );
  process.exit(1);
}

if (!taskDescription) {
  writeLog("dispatch-subagent", "runtime", {
    level: "ERROR",
    event: "CLI-ARGUMENT-ERROR",
    detail: "task_description is required",
  });
  console.error("ERROR: task_description is required");
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
    "pre-execution-gate.ts",
  );
  if (fs.existsSync(gateScript)) {
    logInfo(
      `Running pre-execution-gate.ts for dispatch session '${taskId}' (--dispatch-session)...`,
    );
    try {
      const { execSync } = require("child_process");
      const gateResult = execSync(
        `"${process.execPath}" "${gateScript}" "${taskId}" --dispatch-session`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15000,
          env: { ...process.env, OPENCODE_ROOT },
        },
      );
      logInfo(`Pre-execution gate passed: ${gateResult.substring(0, 200)}`);
    } catch (e) {
      const errMsg = e.stderr?.toString() || e.message || "";
      logWarn(`Pre-execution gate failed: ${errMsg.substring(0, 300)}`);

      // Smart detection: check if failure is ONLY due to rule_registry digest mismatch
      const isCriticalFileModified = /critical.*(file|infrastructure)/i.test(
        errMsg,
      );
      const hasOtherBlockers =
        /DAG.*missing|task.*not found|gate.*not armed|TDD.*violation/i.test(
          errMsg,
        );

      if (isCriticalFileModified && !hasOtherBlockers) {
        writeLog("dispatch-subagent", "runtime", {
          level: "WARN",
          event: "GATE-BLOCKED-CRITICAL-INFRA",
          detail: `Dispatch blocked by critical infrastructure file modification. Review modified files and commit with [INFRA] marker, then retry.`,
        });
      }

      writeLog("dispatch-subagent", "runtime", {
        level: "ERROR",
        event: "PRE-EXECUTION-GATE-FAILED",
        detail: `Pre-execution gate BLOCKED dispatch for task '${taskId}'. Exit code: ${e.status}, Signal: ${e.signal || "none"}`,
      });
      console.error(
        `[dispatch] ❌ Pre-execution gate BLOCKED dispatch for task '${taskId}'.`,
      );
      process.exit(e.status || 1);
    }
  } else {
    writeLog("dispatch-subagent", "runtime", {
      level: "WARN",
      event: "GATE-SCRIPT-MISSING",
      detail:
        "pre-execution-gate.ts not found — skipping gate check. Install with: bun .opencode/scripts/install-hooks.ts",
    });
    console.error(
      `[dispatch] ⚠️  pre-execution-gate.ts not found — skipping gate check.`,
    );
  }
}

// ──────────────────────────────────────────────
// 2. Read project config (with trailing comma tolerance)
// ──────────────────────────────────────────────
/**
 * Parse JSON with trailing comma tolerance.
 * SA-FIX-P0-0-CRITICAL (2026-06-11): strict JSON.parse fails on
 * project.config.json when safe_edit introduces trailing commas.
 * This inline function mirrors lib/tolerant-json.ts::tolerantParse()
 * and prevents dispatch-subagent from crashing — which would block
 * ALL sub-agent dispatches.
 */
function tolerantParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    var cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    if (cleaned === raw) throw e;
    return JSON.parse(cleaned);
  }
}
const projectConfig = tolerantParse(fs.readFileSync(PROJECT_CONFIG, "utf8"));
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
    /**
     * BUG-DISPATCH-KEYWORDS-001 (defense-in-depth): Guard against entries
     * in context7_task_mapping that may lack a keywords array (malformed
     * or metadata entries). Skip instead of crashing on .some() call.
     */
    if (!entry || !Array.isArray(entry.keywords)) continue;
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
  writeLog("dispatch-subagent", "runtime", {
    level: "ERROR",
    event: "AGENT-CONFIG-NOT-FOUND",
    detail: `Agent config not found for "${agentType}". Available: ${agentFiles.filter((f) => f.endsWith(".md")).join(", ")}`,
  });
  console.error(`ERROR: Agent config not found for "${agentType}".`);
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
      (key) => key.toLowerCase() === agentType.toLowerCase(),
    );
    if (!agentKey) {
      logWarn(`Agent "${agentType}" not found in opencode.json`);
      return null;
    }
    return {
      permission: agentDict[agentKey].permission || {},
    };
  } catch (e) {
    logWarn(`Failed to parse opencode.json for ${agentType}: ${e.message}`);
    return null;
  }
}

const agentConfig = parseFrontmatter(agentContent);
const agentName = agentConfig.name || agentType;
const skills = agentConfig.skills || [];
const rawMcpTools = agentConfig.mcp_tools || [];
/**
 * M16 (2026-06-19): Filter dispatch_subagent from KC's MCP tools listing.
 * KC is a documentation curator — it must never see dispatch_subagent as available.
 * This is defense-in-depth alongside M15 (removal from project.config.json
 * agent_dispatch_allowed_tools). If the KC agent config frontmatter still lists
 * dispatch_subagent, this filter removes it from the generated prompt.
 */
const mcpTools =
  agentType.toLowerCase() === "knowledge-curator"
    ? rawMcpTools.filter((t) => t !== "dispatch_subagent")
    : rawMcpTools;
if (rawMcpTools.length !== mcpTools.length) {
  logWarn(
    `Filtered dispatch_subagent from KC agent config (M16 defense-in-depth)`,
  );
}
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
    logWarn(`Unresolvable placeholder '${match}' in ${sourceLabel}`);
    return `UNRESOLVED${match}`;
  });
}

const templateMap = buildTemplateResolutionMap(projectConfig);
logInfo(`Template resolution map: ${Object.keys(templateMap).length} keys`);

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

// P2-FIX R4: Inject dag_task_id into preamble so sub-agent knows its assigned task_id
// taskId is resolved from CLI args, .dispatch_ctx file, or positional arguments.
// This prevents the sub-agent from fabricating a task_id from thin air.
if (taskId) {
  preamble += `\n> **Your dispatch-assigned task_id**: \`${taskId}\` — use this exact value when calling compliance_gate_check(task_id=...). Do NOT fabricate a different task_id.\n`;
}

// P2-FIX R2: Pre-write session_map BEFORE generating prompt to eliminate race condition
// Without this, session.ts chat.message hook may write session_map AFTER sub-agent's
// compliance_gate_check, causing DISPATCH_TASKID_TAMPER false positive
if (taskId) {
  try {
    const {
      dbWriteSessionMap,
      dbReadSessionMap,
    } = require("../../lib/db-state-manager");
    const sessionId = process.env.OPENCODE_SESSION_ID || "";
    if (sessionId) {
      dbWriteSessionMap(sessionId, agentType, taskId);
      const verify = dbReadSessionMap(sessionId);
      if (!verify?.dag_task_id) {
        writeLog("dispatch-subagent", "ERROR", {
          event: "SESSION_MAP_WRITE_FAILED",
          detail: `dbWriteSessionMap succeeded but read-back failed for sessionId=${sessionId} taskId=${taskId}`,
        });
      }
    }
  } catch (e: any) {
    writeLog("dispatch-subagent", "ERROR", {
      event: "SESSION_MAP_WRITE_ERROR",
      detail: `Failed to pre-write session_map: ${e?.message ?? e}`,
    });
  }
}

// IMPLEMENT-DISPATCH-CTX-FIX: Per-dispatch context file (dagTaskId-keyed, no overwrites)
// Eliminates the session_map race condition caused by concurrent dispatches
// overwriting the shared .dispatch_ctx singleton.
if (taskId) {
  try {
    const { writeDispatchCtx } = require("../../lib/agent-resolver");
    // Infer domainId from agent_domain_map in project config
    let inferredDomainId: string | null = null;
    try {
      const agentDomainMap = projectConfig.agent_domain_map || {};
      inferredDomainId = agentDomainMap[agentType] || null;
    } catch {}
    writeDispatchCtx(taskId, agentType, inferredDomainId || undefined);
  } catch (e: any) {
    writeLog("dispatch-subagent", "ERROR", {
      event: "DISPATCH_CTX_WRITE_ERROR",
      detail: `Failed to write per-dispatch ctx: ${e?.message ?? e}`,
    });
  }
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
// Build Permissions Section (R1 SLIM, 2026-06-19)
// Replaces inline ~30 permission lines with a single read() instruction.
// Agents now self-read their permissions via P0 Step 0e (config_read_attest).
// ──────────────────────────────────────────────

const permissionsSection = `
## 🔑 Your Permissions

See your agent config (\`.opencode/agents/${agentFileEntry}\`) + \`opencode.json\` for full permissions.

**IMPORTANT**: P0 Step 0e requires you to read these files using the \`read\` tool
and call \`config_read_attest()\` to unlock writes. The \`scope-before\` plugin
will BLOCK writes until this attestation is complete.

### Conflict Resolution
If agent config and opencode.json conflict, **opencode.json is authoritative**.
- Tools/config declared in your config file but NOT in opencode.json → may be blocked at runtime
- Permissions granted in opencode.json but NOT in your config file → still usable (opencode.json grants them)
`;

// ── Agent-specific scope line (replaces the full 8-agent table) ──
function scopeLine(agentType) {
  const map = {
    Architect:
      "Write: contract.yaml, docs/ | Deny: .opencode/ framework files | Route: @Super-Admin",
    "Coder-BE":
      "Write: booking-backend/src/, booking-backend/test/ | Deny: booking-frontend/**, .opencode/ | Route: @Orchestrator",
    "Coder-FE":
      "Write: booking-frontend/ | Deny: booking-backend/**, .opencode/ | Route: @Orchestrator",
    Orchestrator:
      "Write: Task.DAG.json, .task_temp/ | Deny: .opencode/ framework files | Route: @Super-Admin",
    "Super-Admin":
      "Write: .opencode/**, opencode.json, AGENTS.md | Deny: booking-*/src/ (business code)",
    Guardian:
      "Write: .task_temp/**, .opencode/state/ | Deny: business code, contract.yaml | Route: @Arbiter",
    Arbiter:
      "Write: WAIVE.md, TECH_DEBT_REGISTRY.md | Deny: business code | Route: @Meta-Planner",
    "CI-CD-Agent":
      "Write: .github/, Dockerfile*, docker-compose* | Deny: business code (src/), .opencode/agents/ | Route: @Orchestrator",
    "Knowledge-Curator":
      "Write: docs/official_docs/**, .task_temp/** | Deny: .opencode/**, business code",
    "Meta-Planner":
      "Write: docs/, Task.DAG.json | Deny: .opencode/ framework files, business code",
  };
  return map[agentType] || `Execute within your role's declared scope`;
}

// ── Context7: only inject when stacks are actually matched ──
const context7Block =
  relevantStacks.length > 0
    ? `

---

### Context7 Technology Lookup Requirements

${context7Section}`
    : "";

const wrappedPrompt = `## 🔒 SUBAGENT: ${agentName}

### P0 Protocol — Read and execute FIRST

${preamble}

${deliverablesTemplateMarkdown(agentType)}${
  agentType.toLowerCase() === "knowledge-curator"
    ? `

### 🚀 KC Combined Gate Flow (M17-M19, 2026-06-19)

**Skip the 3-step gate.** KC uses the **combined check+confirm flow**:

\`\`\`
compliance_gate_check(
  task_description="Knowledge acquisition: <topic>",
  plan_summary="<your knowledge acquisition plan>",
  task_id="<your-task-id>"
)  → session_id (gate is ARMED in this single call)
\`\`\`

**No separate** \`compliance_gate_confirm\` call — the \`plan_summary\` parameter
handles both check + confirm in one call. This eliminates the user-confirmation
bottleneck for automated knowledge acquisition.

**After cache update:**
\`\`\`
compliance_gate_submit_deliverables(session_id, evidence)
compliance_gate_complete(session_id, execution_summary)
\`\`\`

**M17 — [INSUFFICIENT] attest handling**: If \`knowledge_cache_attest\` returns
\`cache_sufficient=false\`, use the combined flow above to fetch missing docs.
Do NOT loop on insufficient attest — acquire, re-attest, complete.`
    : ""
}

---

### Agent Configuration (from .opencode/agents/${agentFileEntry})

**Agent Name**: ${agentName}

**IMPORTANT — R1 SLIM (2026-06-19)**: Your skills and MCP tools are defined in your
agent config file. Read \`.opencode/agents/${agentFileEntry}\` via the \`read\` tool
as part of P0 Step 0e to see the full list. This saves ~194 lines per dispatch.

${permissionsSection}

---

### Project Context (from .opencode/project.config.json)

${projectContext}${context7Block}

---

### 📊 Mandatory Audit Trail

Append \`## 📊 Invocation Summary\` to your output: skills invoked, MCP tools called, gate session status (check/confirm/complete). Save to \`.task_temp/_dispatch/INVOCATION_SUMMARY.md\` (append).

---

### Task

**Agent**: ${agentName}
**Description**: ${resolvedTaskDescription}

### 🚨 Your Scope — Framework-Enforced
${scopeLine(agentType)}

### Execution Order
1. Execute all P0 protocol steps (pipeline → skills → gate → deliverables)
2. Perform the task
3. Include \`## 📊 Invocation Summary\` in output

Remember: All runtime artifacts go to \`.task_temp/{taskId}/\`.`;

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
// FW-TDZ-FIX-01: dispatchToken must hash resolvedPrompt (BEFORE DISPATCH_TOKEN line) to avoid TDZ circular reference
const dispatchToken = crypto
  .createHash("sha256")
  .update(resolvedPrompt, "utf8")
  .digest("hex");
const tokenizedPrompt = resolvedPrompt + `\n//DISPATCH_TOKEN:${dispatchToken}`;
fs.writeFileSync(outputFile, tokenizedPrompt, "utf8");
/**
 * FW-PROMPT-HARDEN-04: Maintain FIFO queue of pending dispatch prompts.
 * Each dispatch saves an entry to .task_temp/_dispatch/.pending.json
 * with the SHA-256 hash of the generated prompt. The framework-enforcer
 * template literal consumes this entry when the primary agent calls Task().
 *
 * The primary agent MUST pass the full prompt verbatim to Task().
 * Any modification will produce a different hash, which is detected
 * by the enforcer's TASK-PROMPT-MISMATCH check.
 *
 * HASH SOURCE: tokenizedPrompt (includes DISPATCH_TOKEN line).
 * Using resolvedPrompt (no DISPATCH_TOKEN) causes a permanent mismatch
 * because enforce.ts computes actualHash from the full promptParam
 * (which always includes the DISPATCH_TOKEN line as it was injected
 * during dispatch-subagent generation).
 * Fixed in FW-PROMPT-HARDEN-03 (SA-PROMPT-HASH-FIX).
 *
 * FW-PROMPT-HARDEN-04 (2026-06-08, @Super-Admin): Added agentType field for
 * agent-type matching in enforce.ts; added MAX_QUEUE_SIZE guard; queue entry
 * is only written AFTER the dispatch file is successfully saved (above).
 *
 * Queue format:
 *   [{ dispatchId, promptHash, filePath, createdAt, agentType }]
 */
const promptHash = crypto
  .createHash("sha256")
  .update(tokenizedPrompt, "utf8")
  .digest("hex");
const PENDING_FILE = path.join(OUTPUT_DIR, ".pending.json");
let queue = [];
try {
  if (fs.existsSync(PENDING_FILE)) {
    queue = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
    if (!Array.isArray(queue)) queue = [];
  }
} catch {
  queue = [];
}

/**
 * P0-FIX-BUG-14 (2026-06-09, @Super-Admin): Three hardening layers for .pending.json writes.
 *
 * Layer 1 — Dedup by agentType: Remove existing entries for the same agentType
 *   before appending the new one. Prevents stale-orphan accumulation when the
 *   Orchestrator re-dispatches the same agent (e.g., double dispatch_subagent
 *   with same dag_task_id). The latest dispatch always wins.
 *
 * Layer 2 — Retry + Fatal: Previously, write failures were silently logged
 *   (logWarn) and the script continued — the dispatch file existed but the
 *   .pending.json entry was absent. This caused TASK-PROMPT-MISMATCH errors
 *   because enforce.ts found only stale entries in the queue. Now the write
 *   is retried once, and if both attempts fail, the script exits with code 1
 *   so the Orchestrator is alerted that the dispatch was not registered.
 *
 * Layer 3 — Read-back verification: After writing, immediately re-read the
 *   file and verify the entry is present. If not, exit with an error message
 *   identifying the missing entry.
 */
// Layer 1: Deduplicate — remove existing entries for the same agentType + taskId
// P0-FIX-BUG-15-L1 (2026-06-09): HARDENED dag_task_id reuse BLOCK.
//   Same agentType + same taskId + same promptHash → idempotent re-dispatch → silent dedup ✅
//   Same agentType + same taskId + different promptHash → dag_task_id REUSED → FATAL EXIT ❌
//   Same agentType + DIFFERENT taskId → parallel dispatch → entry KEPT ✅
//   The Orchestrator MUST use a unique dag_task_id per dispatch. No warnings — block.
// SA-FIX-PARALLEL-DISPATCH-20260611 (@Super-Admin): Clarified that dedup key is
//   agentType+taskId composite, NOT agentType alone. Parallel dispatches for the
//   same agentType with different taskIds are allowed and preserved in the queue.
const beforeDedup = queue.length;
const dedupedEntries: any[] = [];
queue = queue.filter((e) => {
  if (e.agentType === agentType && e.taskId === taskId) {
    // Same agent type AND same dag_task_id → deduplicate old entry
    if (e.promptHash && e.promptHash !== promptHash) {
      dedupedEntries.push(e);
    }
    return false;
  }
  return true;
});
if (dedupedEntries.length > 0) {
  // P0-BUG-FIX-TDZ (2026-06-18): Use resolvedTaskId to avoid TDZ with outer let taskId.
  // FW-CLEANUP-FRAMEWORK-TASK-ID: env fallback removed; taskId comes from CLI/.dispatch_ctx.
  const resolvedTaskId = taskId || "(unknown)";
  // HARDENED CONSTRAINT: same dag_task_id → different task = BLOCKED.
  // This is NOT just a warning — the dispatch is PHYSICALLY REJECTED.
  // The Orchestrator MUST use a unique dag_task_id per dispatch.
  const fatalMsg =
    `\n╔══════════════════════════════════════════════════════════════════╗\n` +
    `║  HARDENED CONSTRAINT: DAG_TASK_ID REUSE BLOCKED                  ║\n` +
    `║  dag_task_id: "${resolvedTaskId}"                               \n` +
    `║  This ID was already used for a different task dispatch.         ║\n` +
    `║  Previous dispatch: ${dedupedEntries[0].dispatchId.split("/").pop()}\n` +
    `║                                                                  ║\n` +
    `║  CORRECT PRACTICE: Each dispatch MUST use a UNIQUE dag_task_id.  ║\n` +
    `║  Like a database primary key — one ID = one task.                ║\n` +
    `║                                                                  ║\n` +
    `║  FIX: Re-run dispatch_subagent with a DIFFERENT dag_task_id.     ║\n` +
    `║       e.g., "VERIFY-REPORT-FINAL" → "VERIFY-REPORT-FINAL-V2"     ║\n` +
    `╚══════════════════════════════════════════════════════════════════╝\n`;
  writeLog("dispatch-subagent", "runtime", {
    level: "ERROR",
    event: "DAG-TASK-ID-REUSE-BLOCKED",
    detail: `DAG_TASK_ID reuse blocked: ${taskId} (agentType=${agentType})`,
  });
  console.error(fatalMsg);
  logWarn(`DAG-TASK-ID REUSE BLOCKED: ${taskId} (agentType=${agentType})`);
  // FW-DIAG-D1 (2026-06-10, @Super-Admin): Diagnostic log for dedup block tracing.
  // Captures agentType, both taskIds, and both promptHashes to verify
  // whether stale .pending.json entries are blocking legitimate re-dispatches.
  logInfo(
    `DIAG-DEDUP-BLOCK | agentType=${agentType} | ` +
      `blockedDagTaskId=${dedupedEntries[0].taskId || "?"} | ` +
      `newDagTaskId=${taskId} | ` +
      `prevHash=${(dedupedEntries[0].promptHash || "").substring(0, 12)} | ` +
      `newHash=${promptHash.substring(0, 12)}`,
  );

  // ── P6/S23: RESUME BRANCH (S25 v4: DB query replaces SESSION_ID.md) ──
  // If DISPATCH_RESUME_SESSION_ID is set, this is a resume dispatch (not a new task).
  // Allow same dag_task_id + different promptHash when resuming a previous session.
  // Verify the prior session exists via session_log DB table to prevent misuse.
  const resumeSessionId = process.env.DISPATCH_RESUME_SESSION_ID || null;
  if (resumeSessionId) {
    const taskIdForResume = taskId || "(unknown)";
    const priorSession = dbQueryLatestSessionByDagTaskId(taskIdForResume);
    if (priorSession) {
      logInfo(
        `RESUME dispatch allowed: dag_task_id=${taskIdForResume} resume_session_id=${resumeSessionId} prior_session=${priorSession}`,
      );
      // Continue — skip fatal exit, proceed to push new entry
    } else {
      writeLog("dispatch-subagent", "runtime", {
        level: "ERROR",
        event: "DAG-TASK-ID-REUSE-BLOCKED",
        detail: `DAG_TASK_ID reuse blocked (no session_log entry): ${taskIdForResume}`,
      });
      console.error(fatalMsg);
      logWarn(
        `DAG-TASK-ID REUSE BLOCKED (no session_log entry): ${taskIdForResume}`,
      );
      process.exit(1);
    }
  } else {
    console.error(fatalMsg);
    process.exit(1);
  }
}
if (queue.length < beforeDedup) {
  logInfo(
    `Deduped ${beforeDedup - queue.length} stale .pending.json entries for agentType="${agentType}" taskId="${taskId}"`,
  );
}

queue.push({
  dispatchId: outputFile,
  promptHash,
  filePath: outputFile,
  createdAt: new Date().toISOString(),
  agentType: agentType,
  taskId: taskId || null, // FW-CLEANUP-FRAMEWORK-TASK-ID: env fallback removed
});

// FW-DIAG-D2 (2026-06-10, @Super-Admin): Diagnostic log for entry creation tracing.
// Captures agentType, taskId, hash prefix, and queue size so we can
// track when entries are created and whether they're later consumed.
logInfo(
  `DIAG-ENTRY-CREATE | agentType=${agentType} | ` +
    `taskId=${taskId || "null"} | ` +
    `hash=${promptHash.substring(0, 12)} | ` +
    `queueSize=${queue.length}`,
);

// Layer 2: Retry + fatal on write failure
let writeOk = false;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(queue, null, 2), "utf8");
    writeOk = true;
    break;
  } catch (e) {
    if (attempt === 1) {
      logWarn(
        `Failed to write .pending.json (attempt 1): ${e.message}. Retrying...`,
      );
    } else {
      writeLog("dispatch-subagent", "runtime", {
        level: "ERROR",
        event: "PENDING-WRITE-FATAL",
        detail: `Cannot write .pending.json after 2 attempts: ${e.message}. Dispatch file created at ${outputFile} but NOT registered. Orchestrator MUST re-dispatch.`,
      });
      console.error(`FATAL: Cannot write .pending.json after 2 attempts.`);
      process.exit(1);
    }
  }
}

// Layer 3: Read-back verification
if (writeOk) {
  try {
    const verify = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
    const found =
      Array.isArray(verify) &&
      verify.some(
        (e: any) => e.filePath === outputFile && e.promptHash === promptHash,
      );
    if (!found) {
      writeLog("dispatch-subagent", "runtime", {
        level: "ERROR",
        event: "PENDING-READBACK-FAIL",
        detail: `.pending.json written but entry not found on read-back. Dispatch file: ${outputFile}. Expected hash: ${promptHash}`,
      });
      console.error(
        `FATAL: .pending.json written but entry not found on read-back.`,
      );
      process.exit(1);
    }
    logInfo(
      `.pending.json verified: entry for ${agentType} registered (queue size: ${verify.length})`,
    );
  } catch (e: any) {
    writeLog("dispatch-subagent", "runtime", {
      level: "ERROR",
      event: "PENDING-VERIFY-FATAL",
      detail: `Cannot verify .pending.json after write: ${e.message}`,
    });
    console.error(`FATAL: Cannot verify .pending.json after write.`);
    process.exit(1);
  }
}
logInfo(`Output: ${outputFile}`);

// ═══════════════════════════════════════════════════════════════════════
// A7: DB-canonical dispatch enqueue (Phase 1 dual-write).
// Inserts into dispatch_queue + dispatch_prompt_refs alongside the
// existing file-based .pending.json write. DB is primary for reads;
// files serve as fallback during the rollout period.
//
// Non-fatal: DB enqueue failures are logged but never block dispatch.
// The file-based .pending.json write above is the canonical fallback.
// ═══════════════════════════════════════════════════════════════════════
try {
  const { dbEnqueueDispatch } = require("../../lib/dispatch-db");
  const promptFileSize = Buffer.byteLength(tokenizedPrompt, "utf8");
  dbEnqueueDispatch(
    agentType,
    taskId || "(no-task-id)",
    outputFile,
    promptHash,
    promptFileSize,
  );
} catch (e: any) {
  writeLog("dispatch-subagent", "runtime", {
    level: "ERROR",
    event: "DISPATCH-DB-ENQUEUE-FAILED",
    detail: `Cannot enqueue dispatch to DB: ${e.message}. File-based fallback intact.`,
  });
}

// ──────────────────────────────────────────────
// 7. Output file path to stdout (for the primary agent)
// ──────────────────────────────────────────────
// FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): FRAMEWORK_TASK_ID env restore removed.
// task_id now flows through .dispatch_ctx file + session_map DB exclusively.
console.log(outputFile);
