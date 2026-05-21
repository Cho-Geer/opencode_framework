#!/usr/bin/env node
/**
 * dispatch-subagent.js
 * General-purpose sub-agent dispatcher with P0 protocol enforcement.
 *
 * Usage: node dispatch-subagent.js <agent_type> "<task_description>"
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

const fs = require('fs');
const path = require('path');

const OPENCODE_ROOT = process.env.OPENCODE_ROOT || path.resolve(__dirname, '..', '..', '..');
const AGENTS_DIR = path.join(OPENCODE_ROOT, '.opencode', 'agents');
const PREAMBLE_FILE = path.join(OPENCODE_ROOT, '.opencode', 'subagent-preamble.md');
const PROJECT_CONFIG = path.join(OPENCODE_ROOT, '.opencode', 'project.config.json');
const OUTPUT_DIR = path.join(OPENCODE_ROOT, '.task_temp', '_dispatch');

// ──────────────────────────────────────────────
// 1. Parse CLI arguments
// ──────────────────────────────────────────────
const agentType = process.argv[2];
const taskDescription = process.argv[3] || '';

if (!agentType) {
  console.error('Usage: node dispatch-subagent.js <agent_type> "<task_description>"');
  console.error('Example: node dispatch-subagent.js Architect "Validate architecture"');
  process.exit(1);
}

if (!taskDescription) {
  console.error('ERROR: task_description is required');
  process.exit(1);
}

// ──────────────────────────────────────────────
// 2. Read project config
// ──────────────────────────────────────────────
const projectConfig = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf8'));
const projectRoot = projectConfig.project_root || '.';
const techStack = projectConfig.tech_stack || {};
const taskMapping = projectConfig.context7_task_mapping || [];

// Resolve a path: OPENCODE_ROOT / project_root / path_value
function resolveProjectPath(relativePath) {
  if (projectRoot === '.' || projectRoot === '') {
    return path.join(OPENCODE_ROOT, relativePath);
  }
  return path.join(OPENCODE_ROOT, projectRoot, relativePath);
}

// Determine which tech stacks are relevant based on task description keywords
function findRelevantStacks(description, mapping, stackConfig) {
  const result = [];
  for (const entry of mapping) {
    const match = entry.keywords.some(kw => description.toLowerCase().includes(kw));
    if (match) {
      for (const stackKey of entry.stacks) {
        const stack = stackConfig[stackKey];
        if (stack && !result.find(r => r.key === stackKey)) {
          result.push({ key: stackKey, label: stack.name, query: stack.context7_query });
        }
      }
    }
  }
  return result;
}

const relevantStacks = findRelevantStacks(taskDescription, taskMapping, techStack);

// ──────────────────────────────────────────────
// 3. Read agent config file (case-insensitive lookup)
// ──────────────────────────────────────────────
const agentFiles = fs.readdirSync(AGENTS_DIR);
const agentFileEntry = agentFiles.find(f => f.toLowerCase() === `${agentType.toLowerCase()}.md`);
if (!agentFileEntry) {
  console.error(`ERROR: Agent config not found for "${agentType}". Available: ${agentFiles.filter(f => f.endsWith('.md')).join(', ')}`);
  process.exit(1);
}
const agentFile = path.join(AGENTS_DIR, agentFileEntry);
const agentContent = fs.readFileSync(agentFile, 'utf8');

// Parse YAML frontmatter
function parseFrontmatter(content) {
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterLines = [];
  let frontmatterCount = 0;

  for (const line of lines) {
    if (line.trim() === '---') {
      frontmatterCount++;
      if (frontmatterCount === 1) { inFrontmatter = true; continue; }
      if (frontmatterCount === 2) break;
    }
    if (inFrontmatter) frontmatterLines.push(line);
  }

  return parseYamlSimple(frontmatterLines.join('\n'));
}

function parseYamlSimple(yaml) {
  const result = {};
  let currentKey = null;

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const topMatch = trimmed.match(/^(\w[\w_-]*):\s*(.*)/);
    if (topMatch && !trimmed.startsWith('-')) {
      currentKey = topMatch[1];
      const val = topMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        result[currentKey] = val.slice(1, -1);
      } else if (val.startsWith("'") && val.endsWith("'")) {
        result[currentKey] = val.slice(1, -1);
      } else if (val !== '') {
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

console.error(`[dispatch] Project: ${projectConfig.project.name}`);
console.error(`[dispatch] Project root: ${projectRoot}`);
console.error(`[dispatch] OPENCODE_ROOT: ${OPENCODE_ROOT}`);
console.error(`[dispatch] Agent: ${agentName}`);
console.error(`[dispatch] Skills: ${skills.join(', ')}`);
console.error(`[dispatch] MCP tools: ${mcpTools.join(', ')}`);
console.error(`[dispatch] Context7 stacks matched: ${relevantStacks.map(s => s.label).join(', ')}`);

// ──────────────────────────────────────────────
// 4. Read preamble template
// ──────────────────────────────────────────────
let preamble = '';
if (fs.existsSync(PREAMBLE_FILE)) {
  preamble = fs.readFileSync(PREAMBLE_FILE, 'utf8');
  preamble = preamble.replace(/^---[\s\S]*?---\n*/, ''); // strip frontmatter
}

// ──────────────────────────────────────────────
// 5. Build the wrapped prompt
// ──────────────────────────────────────────────

// Context7 section — generated from project.config.json
let context7Section = '- (determine based on task — see `project.config.json` `context7_task_mapping`)';
if (relevantStacks.length > 0) {
  context7Section = `This task touches the following stacks. Resolve and query each via \`context7_resolve-library-id\` + \`context7_query-docs\`:\n${
    relevantStacks.map(s => `- **${s.label}** — query: \`${s.query}\``).join('\n')
  }`;
}

// Resolve actual paths for display
const resolvedBackend = resolveProjectPath(projectConfig.paths.backend_src || '');
const resolvedFrontend = resolveProjectPath(projectConfig.paths.frontend_src || '');
const resolvedContracts = resolveProjectPath(projectConfig.paths.contracts || '');

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
].join('\n');

const wrappedPrompt = `## 🔒 SUBAGENT: ${agentName}

### P0 Protocol — Read and execute FIRST

${preamble}

---

### Agent Configuration (from .opencode/agents/${agentFileEntry})

**Agent Name**: ${agentName}

**Your Skills** (invoke in this order; P0 skills first):
${skills.map(s => `- \`${s}\``).join('\n')}

**Your MCP Tools** (call as needed):
${mcpTools.map(t => `- \`${t}\``).join('\n')}

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
${skills.map(s => `- \`${s}\`: ✅ Invoked or ❌ Not needed (state reason)`).join('\n')}

**MCP Tools** (from your agent config above):
${mcpTools.map(t => `- \`${t}\`: ✅ Called or ❌ Not applicable (state reason)`).join('\n')}

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
**Description**: ${taskDescription}

### Execution Order
1. Read your agent configuration above
2. Execute all P0 protocol steps (skills → context7 → compliance gate → confirm)
3. Perform the task and produce output
4. Include \`## 📊 Invocation Summary\` section in your output

Remember: All runtime artifacts (test_report.json, HANDOVER.md, TASK_LOG.md, *_report.json) go to \`.task_temp/{taskId}/\`.`;

// ──────────────────────────────────────────────
// 6. Save to output file
// ──────────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = path.join(OUTPUT_DIR, `dispatch-${agentType}-${timestamp}.md`);
fs.writeFileSync(outputFile, wrappedPrompt, 'utf8');

console.error(`[dispatch] Output: ${outputFile}`);

// ──────────────────────────────────────────────
// 7. Output file path to stdout (for the primary agent)
// ──────────────────────────────────────────────
console.log(outputFile);
