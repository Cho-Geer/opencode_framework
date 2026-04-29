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
  try {
    return JSON.parse(require('fs').readFileSync(
      path.join(OPENCODE_ROOT, '.opencode', 'project.config.json'), 'utf8'
    ));
  } catch { return { project_root: 'booking_system_refactor' }; }
}

function findStateDir() {
  const cfg = readProjectConfig();
  const pr = cfg.project_root || 'booking_system_refactor';
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
main().catch(console.error);
