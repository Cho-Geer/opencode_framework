#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const path = require('path');
const { execSync } = require('child_process');

const OPENCODE_ROOT = process.env.OPENCODE_ROOT || path.resolve(__dirname, '..', '..', '..');

function readProjectConfig() {
  const configPath = path.join(OPENCODE_ROOT, '.opencode', 'project.config.json');
  let cfg;
  try {
    cfg = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
  } catch (readErr) {
    throw new Error(
      `[keystone-validate] Cannot read or parse project.config.json at ${configPath}: ${readErr.message}`
    );
  }
  if (!cfg.project_root) {
    throw new Error(
      `[keystone-validate] 'project_root' is not defined in project.config.json (${configPath}). ` +
      'Add "project_root": "<subdirectory>" to the config file.'
    );
  }
  return cfg;
}

function findStateDir() {
  const cfg = readProjectConfig();
  const pr = cfg.project_root;
  const innerRepo = path.resolve(OPENCODE_ROOT, pr);
  const stateDir = path.join(innerRepo, '.opencode', 'state');
  if (require('fs').existsSync(stateDir)) return stateDir;
  return path.join(OPENCODE_ROOT, '.opencode', 'state');
}

function runValidate(mode) {
  const stateDir = findStateDir();
  const innerRepo = path.resolve(stateDir, '..', '..');
  const script = path.join(innerRepo, 'scripts', 'keystone-validate.js');

  if (!require('fs').existsSync(script)) {
    return { overall: 'ERROR', detail: `keystone-validate.js not found at ${script}` };
  }

  try {
    const out = execSync(`node "${script}" --${mode}`, {
      cwd: innerRepo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    try { return JSON.parse(out.trim()); }
    catch { return { overall: 'PASS', detail: out.trim(), raw: true }; }
  } catch (e) {
    const stderr = e.stderr || '';
    try { return JSON.parse(stderr); }
    catch { return { overall: 'FAIL', detail: e.message, stdout: e.stdout }; }
  }
}

const server = new Server(
  { name: 'keystone-validate', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'keystone_validate',
    description: 'Run Keystone validation checks (contract hash, task lifecycle, TDD, compliance gate)',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['audit', 'pre-commit', 'ci'],
          description: 'audit: working tree (default), pre-commit: staged changes, ci: hash-only fast check'
        }
      }
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const mode = (request.params.arguments?.mode) || 'audit';
  const result = runValidate(mode);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Start server (only when run directly, not when require()d by tests)
if (require.main === module) {
  main().catch(console.error);
}

// Export internals for testing
module.exports = { readProjectConfig, findStateDir, runValidate };
