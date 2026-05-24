#!/usr/bin/env node

/**
 * WorkBuddy Keystone Validate MCP Server
 *
 * Replaces the original .opencode/scripts/mcp-tools/keystone-validate.js
 * with a WorkBuddy-native version that validates contract hashes stored
 * in framework-state.md instead of machine.json.keystone_hashes.
 *
 * Tools:
 *   - keystone_validate: Validate contract hash integrity
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = process.env.WORKBUDDY_ROOT || process.env.CODEBUDDY_PROJECT_DIR || '.';
const MEMORY_DIR = path.join(PROJECT_ROOT, '.workbuddy', 'memory');

// ── Helpers ──────────────────────────────────────────────────────

function readMarkdown(filename) {
  const fp = path.join(MEMORY_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8');
}

function computeFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function parseContractHashes() {
  const content = readMarkdown('framework-state.md');
  if (!content) return {};

  const hashes = {};
  // Find the Contract Hashes section
  const sectionMatch = content.match(/## Contract Hashes[\s\S]*?(?=\n##|\n---|\Z)/);
  if (!sectionMatch) return hashes;

  const tableRows = sectionMatch[0].split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('File'));
  for (const row of tableRows) {
    const cols = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length >= 2) {
      hashes[cols[0]] = cols[1];
    }
  }
  return hashes;
}

function parseContractFiles() {
  const projectYaml = path.join(PROJECT_ROOT, '.workbuddy', 'project.yaml');
  if (!fs.existsSync(projectYaml)) return [];

  const content = fs.readFileSync(projectYaml, 'utf-8');
  const files = [];
  let inContracts = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('contracts:')) {
      inContracts = true;
      continue;
    }
    if (inContracts && trimmed.startsWith('files:')) continue;
    if (inContracts && trimmed.startsWith('- ')) {
      const f = trimmed.replace(/^-\s*"?/, '').replace(/"?,?\s*$/, '').trim();
      if (f && f !== '[]') files.push(f);
    }
    if (inContracts && /^[a-z_]+:/.test(trimmed) && !trimmed.startsWith('-') && !trimmed.startsWith('files')) {
      inContracts = false;
    }
  }
  return files;
}

// ── Validation Logic ─────────────────────────────────────────────

function validateAudit() {
  // Working tree validation: compute hashes of all contract files and compare with stored
  const storedHashes = parseContractHashes();
  const contractFiles = parseContractFiles();
  const results = { mode: 'audit', passed: true, checks: [] };

  // If no contract files configured, check common locations
  const filesToCheck = contractFiles.length > 0
    ? contractFiles
    : ['contract.yaml', 'openapi.yaml', 'api-spec.yaml'].filter(f => fs.existsSync(path.join(PROJECT_ROOT, f)));

  if (filesToCheck.length === 0) {
    results.checks.push({ file: '(none configured)', status: 'skip', message: 'No contract files found in project.yaml or workspace root' });
    results.warnings = ['No contract files configured. Add contracts.files to .workbuddy/project.yaml'];
    return results;
  }

  for (const file of filesToCheck) {
    const filePath = path.join(PROJECT_ROOT, file);
    const computedHash = computeFileHash(filePath);
    const storedHash = storedHashes[file];

    if (!computedHash) {
      results.checks.push({ file, status: 'missing', computed: null, stored: storedHash || null, message: `Contract file not found: ${file}` });
      results.passed = false;
    } else if (!storedHash) {
      results.checks.push({ file, status: 'new', computed: computedHash, stored: null, message: `Contract file has no stored hash — run PostToolUse hook to register` });
    } else if (computedHash !== storedHash) {
      results.checks.push({ file, status: 'mismatch', computed: computedHash, stored: storedHash, message: `Hash mismatch: contract was modified without updating framework-state.md` });
      results.passed = false;
    } else {
      results.checks.push({ file, status: 'match', computed: computedHash, stored: storedHash, message: 'Hash verified' });
    }
  }

  // Also validate framework core files
  const coreFiles = [
    '.codebuddy/rules/framework-core.md',
    '.codebuddy/settings.json',
    '.workbuddy/project.yaml',
    '.workbuddy/FRAMEWORK.md'
  ];

  for (const file of coreFiles) {
    const filePath = path.join(PROJECT_ROOT, file);
    if (fs.existsSync(filePath)) {
      const hash = computeFileHash(filePath);
      results.checks.push({ file, status: 'info', computed: hash, message: `Framework file hash: ${hash}` });
    }
  }

  return results;
}

function validatePreCommit() {
  // Staged changes check — validate only modified/staged files
  const results = validateAudit();
  results.mode = 'pre-commit';
  return results;
}

function validateCI() {
  // Fast hash-only check for CI
  const storedHashes = parseContractHashes();
  const contractFiles = parseContractFiles();
  const results = { mode: 'ci', passed: true, checks: [], mismatches: 0 };

  const filesToCheck = contractFiles.length > 0
    ? contractFiles
    : ['contract.yaml', 'openapi.yaml'].filter(f => fs.existsSync(path.join(PROJECT_ROOT, f)));

  for (const file of filesToCheck) {
    const computedHash = computeFileHash(path.join(PROJECT_ROOT, file));
    const storedHash = storedHashes[file];
    if (computedHash && storedHash && computedHash !== storedHash) {
      results.checks.push({ file, status: 'mismatch', computed: computedHash, stored: storedHash });
      results.passed = false;
      results.mismatches++;
    } else {
      results.checks.push({ file, status: 'ok', hash: computedHash || storedHash });
    }
  }

  return results;
}

// ── Server Setup ─────────────────────────────────────────────────

const server = new Server(
  { name: 'workbuddy-keystone-validate', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'keystone_validate',
      description: `Validate contract hash integrity against framework-state.md (WorkBuddy-native).
Supports three modes:
- audit (default): Validate all contract files against stored hashes in framework-state.md
- pre-commit: Validate only staged/modified files
- ci: Fast hash-only check for CI pipelines`,
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['audit', 'pre-commit', 'ci'],
            description: 'Validation mode. Default: "audit"'
          }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'keystone_validate') {
    const mode = args.mode || 'audit';
    let results;

    switch (mode) {
      case 'pre-commit':
        results = validatePreCommit();
        break;
      case 'ci':
        results = validateCI();
        break;
      case 'audit':
      default:
        results = validateAudit();
        break;
    }

    results.timestamp = new Date().toISOString();
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }

  return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
