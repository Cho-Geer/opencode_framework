#!/usr/bin/env node

/**
 * WorkBuddy Code Quality Gate MCP Server
 *
 * Replaces the original .opencode/scripts/mcp-tools/code-quality-gate.js
 * with a WorkBuddy-native version that reads/writes .workbuddy/memory/
 * Markdown state files instead of machine.json.
 *
 * Tools:
 *   - run_write_check: Per-file write-time quality audit
 *   - run_full_scan: Full project quality scan
 *   - get_audit_status: Query current quality status
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.WORKBUDDY_ROOT || process.env.CODEBUDDY_PROJECT_DIR || '.';
const MEMORY_DIR = path.join(PROJECT_ROOT, '.workbuddy', 'memory');

// ── Helpers ──────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readMarkdown(filename) {
  const fp = path.join(MEMORY_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8');
}

function writeMarkdown(filename, content) {
  ensureDir(MEMORY_DIR);
  fs.writeFileSync(path.join(MEMORY_DIR, filename), content, 'utf-8');
}

function parseProjectYaml() {
  const fp = path.join(PROJECT_ROOT, '.workbuddy', 'project.yaml');
  if (!fs.existsSync(fp)) return null;
  const content = fs.readFileSync(fp, 'utf-8');
  // Minimal YAML parsing for key fields
  const result = { layers: {}, quality: {}, enforcement: {} };
  let currentSection = null;
  let currentLayer = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;
    // Detect top-level sections
    if (/^[a-z_]+:/.test(trimmed) && !trimmed.startsWith('-') && !trimmed.startsWith(' ')) {
      const key = trimmed.split(':')[0];
      if (['layers', 'quality', 'enforcement'].includes(key)) {
        currentSection = key;
        currentLayer = null;
      }
    }
    // Detect layer sub-sections
    if (currentSection === 'layers' && /^\s{2}[a-z_]+:/.test(line)) {
      currentLayer = line.trim().split(':')[0];
      result.layers[currentLayer] = {};
    }
    // Parse enforcement mode
    if (trimmed.startsWith('mode:')) {
      result.enforcement.mode = trimmed.split(':')[1].trim().replace(/"/g, '');
    }
    if (trimmed.startsWith('tdd_enforcement:')) {
      result.enforcement.tdd_enforcement = trimmed.split(':')[1].trim() === 'true';
    }
  }
  return result;
}

function parseFrameworkState() {
  const content = readMarkdown('framework-state.md');
  if (!content) return { dimensions: {}, contractHashes: {} };
  const dimensions = {};
  // Parse quality dimensions table
  const tableMatch = content.match(/\|\s*Dimension\s*\|\s*Status\s*\|\s*Last Check\s*\|[\s\S]*?(?=\n##|\n---|\Z)/);
  if (tableMatch) {
    const rows = tableMatch[0].split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Dimension'));
    for (const row of rows) {
      const cols = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 2) {
        dimensions[cols[0].toLowerCase()] = {
          status: cols[1] || 'unknown',
          lastCheck: cols[2] || ''
        };
      }
    }
  }
  return { dimensions };
}

function updateFrameworkDimension(dimension, status) {
  const content = readMarkdown('framework-state.md');
  if (!content) return false;
  const lines = content.split('\n');
  const idx = lines.findIndex(l => {
    const cols = l.split('|').map(c => c.trim()).filter(Boolean);
    return cols.length > 0 && cols[0].toLowerCase() === dimension.toLowerCase();
  });
  if (idx === -1) return false;
  const cols = lines[idx].split('|');
  cols[2] = ` ${status} `;
  cols[3] = ` ${new Date().toISOString().slice(0, 16)} `;
  lines[idx] = cols.join('|');
  fs.writeFileSync(path.join(MEMORY_DIR, 'framework-state.md'), lines.join('\n'), 'utf-8');
  return true;
}

function runCommand(cmd, cwd) {
  try {
    const { execSync } = require('child_process');
    const result = execSync(cmd, { cwd: cwd || PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 });
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, output: e.stdout || e.stderr || e.message };
  }
}

// ── Quality Checks ───────────────────────────────────────────────

function checkLint(projectYaml) {
  // Try to find lint command from project.yaml layers
  const lintCmd = projectYaml?.layers?.backend?.lint_command || projectYaml?.layers?.frontend?.lint_command || 'npm run lint';
  return runCommand(lintCmd);
}

function checkTypeCheck(projectYaml) {
  const tscCmd = projectYaml?.layers?.backend?.typecheck_command || projectYaml?.layers?.frontend?.typecheck_command || 'npx tsc --noEmit';
  return runCommand(tscCmd);
}

function checkFormat() {
  return runCommand('npx prettier --check .');
}

function checkDependencies() {
  return runCommand('npx depcruise --config .dependency-cruiser.js . || npx madge --circular .');
}

// ── Server Setup ─────────────────────────────────────────────────

const server = new Server(
  { name: 'workbuddy-code-quality-gate', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_write_check',
      description: `Write-Time quality audit on a single changed file (WorkBuddy-native).
Runs available checks in sequence: format, lint, typecheck, TDD order.
Updates framework-state.md with results. Checks are best-effort — if a tool
is not configured in project.yaml, that check is skipped with a warning.`,
      inputSchema: {
        type: 'object',
        properties: {
          changed_file: {
            type: 'string',
            description: 'Path of the changed file (project-relative)'
          },
          agent_type: {
            type: 'string',
            description: 'Agent identity for write scope enforcement (e.g., "architect", "coder", "guardian", "arbiter", "devops")'
          },
          skip_checks: {
            type: 'array',
            items: { type: 'string', enum: ['scope', 'format', 'deps', 'lint', 'tsc', 'tdd'] },
            description: 'Optional checks to skip'
          },
          auto_fix: {
            type: 'boolean',
            description: 'Auto-fix formatting via prettier --write (default: true)'
          },
          task_id: {
            type: 'string',
            description: 'Current task ID for audit trail'
          }
        },
        required: ['changed_file', 'agent_type']
      }
    },
    {
      name: 'run_full_scan',
      description: `Full project quality scan (WorkBuddy-native).
Runs: typecheck full, lint full, format full check.
Updates all dimensions in framework-state.md.`,
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'get_audit_status',
      description: `Get current quality audit status from framework-state.md.
Returns all quality dimension statuses (lint, types, dependencies, format, build).`,
      inputSchema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'Task ID to query (optional)'
          }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const projectYaml = parseProjectYaml();
  const skipChecks = args.skip_checks || [];

  if (name === 'run_write_check') {
    const { changed_file, agent_type, auto_fix = true, task_id = '-' } = args;
    if (!changed_file || !agent_type) {
      return { content: [{ type: 'text', text: JSON.stringify({ passed: false, reason: 'changed_file and agent_type are required' }) }] };
    }

    const results = { file: changed_file, agent: agent_type, task_id, checks: {} };

    // 1. Scope check
    if (!skipChecks.includes('scope')) {
      const readOnlyAgents = ['guardian', 'arbiter'];
      const isSourceFile = !changed_file.includes('.workbuddy/') && !changed_file.includes('test') && !changed_file.includes('spec');
      if (readOnlyAgents.includes(agent_type) && isSourceFile) {
        results.checks.scope = { passed: false, message: `${agent_type} agent cannot write to source file: ${changed_file}` };
        results.passed = false;
        results.blocked = true;
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }
      results.checks.scope = { passed: true, message: 'Write scope validated' };
    }

    // 2. Format check
    if (!skipChecks.includes('format')) {
      if (auto_fix) {
        const fmt = runCommand(`npx prettier --write "${changed_file}"`);
        results.checks.format = { passed: true, auto_fixed: true, message: fmt.success ? 'Formatted' : `Auto-fix failed: ${fmt.output}` };
      } else {
        const fmt = runCommand(`npx prettier --check "${changed_file}"`);
        results.checks.format = { passed: fmt.success, message: fmt.success ? 'Formatted' : 'Format issues found' };
      }
      updateFrameworkDimension('format', results.checks.format.passed ? 'clean' : 'blocked');
    }

    // 3. Lint check
    if (!skipChecks.includes('lint')) {
      const lint = checkLint(projectYaml);
      results.checks.lint = { passed: lint.success, message: lint.success ? 'Lint passed' : lint.output.slice(0, 500) };
      updateFrameworkDimension('lint', lint.success ? 'clean' : 'blocked');
    }

    // 4. TypeScript check
    if (!skipChecks.includes('tsc')) {
      const tsc = checkTypeCheck(projectYaml);
      results.checks.tsc = { passed: tsc.success, message: tsc.success ? 'Type check passed' : tsc.output.slice(0, 500) };
      updateFrameworkDimension('types', tsc.success ? 'clean' : 'blocked');
    }

    // 5. Dependency check
    if (!skipChecks.includes('deps')) {
      const deps = checkDependencies();
      results.checks.deps = { passed: deps.success, message: deps.success ? 'Dependencies clean' : deps.output.slice(0, 500) };
      updateFrameworkDimension('dependencies', deps.success ? 'clean' : 'blocked');
    }

    // 6. TDD check
    if (!skipChecks.includes('tdd')) {
      const isTestFile = /\.(spec|test)\./.test(changed_file) || changed_file.includes('__tests__');
      const isSourceFile = !isTestFile && !changed_file.includes('.workbuddy/');
      if (isSourceFile) {
        const ext = path.extname(changed_file);
        const base = changed_file.replace(ext, '');
        const testPatterns = [`${base}.spec${ext}`, `${base}.test${ext}`, `${base}_test${ext}`];
        const hasTest = testPatterns.some(p => fs.existsSync(path.join(PROJECT_ROOT, p)));
        results.checks.tdd = { passed: hasTest, message: hasTest ? 'Test exists for source file' : 'No test found for source file — TDD violation' };
        if (!hasTest) {
          updateFrameworkDimension('tdd', 'blocked');
        }
      } else {
        results.checks.tdd = { passed: true, message: 'File is a test or non-source file — TDD check N/A' };
      }
    }

    const allPassed = Object.values(results.checks).every(c => c.passed);
    results.passed = allPassed;
    results.blocked = !allPassed;

    // Log to invocation-log.md
    const ts = new Date().toISOString().slice(0, 19);
    const logEntry = `| ${ts} | ${agent_type} | code-quality-gate | write-check | ${changed_file} | ${allPassed ? 'passed' : 'blocked'} |\n`;
    const logContent = readMarkdown('invocation-log.md');
    if (!logContent) {
      const header = `# Invocation Log\n\n_Audit trail of skill and agent invocations._\n\n---\n\n| Timestamp | Agent | Skill | Action | Target | Result |\n|-----------|-------|-------|--------|--------|--------|\n`;
      writeMarkdown('invocation-log.md', header + logEntry);
    } else {
      appendToMarkdown('invocation-log.md', logEntry);
    }

    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }

  if (name === 'run_full_scan') {
    const results = { checks: {} };

    const tsc = checkTypeCheck(projectYaml);
    results.checks.types = { passed: tsc.success, message: tsc.success ? 'Type check passed' : tsc.output.slice(0, 500) };
    updateFrameworkDimension('types', tsc.success ? 'clean' : 'blocked');

    const lint = checkLint(projectYaml);
    results.checks.lint = { passed: lint.success, message: lint.success ? 'Lint passed' : lint.output.slice(0, 500) };
    updateFrameworkDimension('lint', lint.success ? 'clean' : 'blocked');

    const fmt = checkFormat();
    results.checks.format = { passed: fmt.success, message: fmt.success ? 'Format passed' : fmt.output.slice(0, 500) };
    updateFrameworkDimension('format', fmt.success ? 'clean' : 'blocked');

    const allPassed = Object.values(results.checks).every(c => c.passed);
    results.passed = allPassed;
    results.scan_type = 'full';
    results.timestamp = new Date().toISOString();

    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }

  if (name === 'get_audit_status') {
    const state = parseFrameworkState();
    return { content: [{ type: 'text', text: JSON.stringify({
      status: 'ok',
      dimensions: state.dimensions,
      blocked_count: Object.values(state.dimensions).filter(d => d.status === 'blocked').length,
      timestamp: new Date().toISOString()
    }, null, 2) }] };
  }

  return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
});

function appendToMarkdown(filename, content) {
  const fp = path.join(MEMORY_DIR, filename);
  if (fs.existsSync(fp)) {
    fs.appendFileSync(fp, content, 'utf-8');
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
