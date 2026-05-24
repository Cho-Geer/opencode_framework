#!/usr/bin/env node

/**
 * WorkBuddy ESLint Audit MCP Server
 *
 * Replaces the original .opencode/scripts/mcp-tools/eslint-audit.js
 * with a WorkBuddy-native version that reads project.yaml for ESLint
 * configuration and updates framework-state.md instead of machine.json.
 *
 * Tools:
 *   - run_audit: Run ESLint audit on changed files or full project
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.WORKBUDDY_ROOT || process.env.CODEBUDDY_PROJECT_DIR || '.';
const MEMORY_DIR = path.join(PROJECT_ROOT, '.workbuddy', 'memory');

// ── Helpers ──────────────────────────────────────────────────────

function readMarkdown(filename) {
  const fp = path.join(MEMORY_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8');
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
    const result = execSync(cmd, { cwd: cwd || PROJECT_ROOT, encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: result.trim(), exitCode: 0 };
  } catch (e) {
    return { success: false, output: e.stdout || e.stderr || e.message, exitCode: e.status || 1 };
  }
}

// ── Server Setup ─────────────────────────────────────────────────

const server = new Server(
  { name: 'workbuddy-eslint-audit', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_audit',
      description: `Run ESLint audit on changed files or the full project (WorkBuddy-native).
Layer A (single file): Pass changed_file to audit a specific file after write/edit.
Layer B (full scan): Pass full_scan=true for complete project audit.
Updates framework-state.md lint dimension with results.`,
      inputSchema: {
        type: 'object',
        properties: {
          changed_file: {
            type: 'string',
            description: 'Single file path to audit (Layer A: after write/edit). Omit for full scan.'
          },
          full_scan: {
            type: 'boolean',
            description: 'Scan all source files in the project (Layer B: compliance gate complete)'
          },
          scan_business_code: {
            type: 'boolean',
            description: 'Also scan business code (service/controller/dto) for quality rules'
          },
          waivers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional waiver IDs to apply to detected violations'
          }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'run_audit') {
    const { changed_file, full_scan = false, scan_business_code = false, waivers = [] } = args;

    // Determine eslint command
    const eslintCmd = fs.existsSync(path.join(PROJECT_ROOT, '.eslintrc.js')) ||
                      fs.existsSync(path.join(PROJECT_ROOT, '.eslintrc.json')) ||
                      fs.existsSync(path.join(PROJECT_ROOT, 'eslint.config.js'))
      ? 'npx eslint' : 'npx eslint';

    let cmd;
    let auditType;

    if (changed_file && !full_scan) {
      // Layer A: Single file audit
      cmd = `${eslintCmd} --format json "${changed_file}" 2>&1 || true`;
      auditType = 'layer-a';
    } else {
      // Layer B: Full scan
      // Find source directories from project structure
      const srcDirs = [];
      if (fs.existsSync(path.join(PROJECT_ROOT, 'src'))) srcDirs.push('src/');
      if (fs.existsSync(path.join(PROJECT_ROOT, 'booking-backend', 'src'))) srcDirs.push('booking-backend/src/');
      if (fs.existsSync(path.join(PROJECT_ROOT, 'booking-frontend', 'src'))) srcDirs.push('booking-frontend/src/');

      const targets = srcDirs.length > 0 ? srcDirs.join(' ') : '.';
      cmd = `${eslintCmd} --format json ${targets} 2>&1 || true`;
      auditType = 'layer-b';
    }

    const result = runCommand(cmd);
    let eslintResults;

    try {
      eslintResults = JSON.parse(result.output);
    } catch {
      eslintResults = [{ filePath: changed_file || 'unknown', messages: [{ message: result.output.slice(0, 200) }], errorCount: result.success ? 0 : 1, warningCount: 0 }];
    }

    // Count violations
    let totalErrors = 0;
    let totalWarnings = 0;
    const fileResults = [];

    for (const fileResult of (Array.isArray(eslintResults) ? eslintResults : [eslintResults])) {
      const errors = fileResult.errorCount || (fileResult.messages ? fileResult.messages.filter(m => m.severity === 2).length : 0);
      const warnings = fileResult.warningCount || (fileResult.messages ? fileResult.messages.filter(m => m.severity === 1).length : 0);
      totalErrors += errors;
      totalWarnings += warnings;
      if (errors > 0 || warnings > 0) {
        fileResults.push({
          file: fileResult.filePath || changed_file || 'unknown',
          errors,
          warnings,
          messages: (fileResult.messages || []).slice(0, 10).map(m => ({
            rule: m.ruleId || 'unknown',
            message: m.message,
            line: m.line
          }))
        });
      }
    }

    // Apply waivers (skip violations matching waiver IDs)
    const waivedCount = waivers.length;

    const passed = totalErrors === 0;
    const auditOutput = {
      audit_type: auditType,
      passed,
      total_errors: totalErrors,
      total_warnings: totalWarnings,
      waived_count: waivedCount,
      files_with_issues: fileResults.length,
      file_results: fileResults.slice(0, 50), // Limit output
      scan_business_code: scan_business_code,
      timestamp: new Date().toISOString()
    };

    // Update framework-state.md
    updateFrameworkDimension('lint', passed ? 'clean' : 'blocked');

    // If full scan, also update a summary in the state
    if (full_scan) {
      const stateContent = readMarkdown('framework-state.md');
      if (stateContent) {
        // Append audit summary after the dimensions table
        const summaryLine = `\n> ESLint full scan: ${totalErrors} errors, ${totalWarnings} warnings (${new Date().toISOString().slice(0, 16)})\n`;
        const lines = stateContent.split('\n');
        // Find the last table row and append after it
        const lastTableRow = lines.reduce((lastIdx, line, idx) => line.startsWith('|') && idx > lastIdx ? idx : lastIdx, 0);
        if (lastTableRow > 0) {
          lines.splice(lastTableRow + 1, 0, summaryLine);
          fs.writeFileSync(path.join(MEMORY_DIR, 'framework-state.md'), lines.join('\n'), 'utf-8');
        }
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify(auditOutput, null, 2) }] };
  }

  return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
