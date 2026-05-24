#!/usr/bin/env node

/**
 * WorkBuddy Compliance Gate MCP Server
 *
 * Replaces the original .opencode/scripts/mcp-tools/compliance-gate.js
 * with a WorkBuddy-native version that reads/writes .workbuddy/memory/
 * Markdown state files instead of .opencode/ JSON files.
 *
 * Tools:
 *   - compliance_gate_check: Pre-task compliance gate check
 *   - compliance_gate_confirm: Arm the gate after user confirmation
 *   - compliance_gate_complete: Close the gate after task execution
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readMarkdown(filename) {
  const fp = path.join(MEMORY_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8');
}

function appendToMarkdown(filename, content) {
  ensureDir(MEMORY_DIR);
  const fp = path.join(MEMORY_DIR, filename);
  if (fs.existsSync(fp)) {
    fs.appendFileSync(fp, content, 'utf-8');
  } else {
    fs.writeFileSync(fp, content, 'utf-8');
  }
}

function generateSessionId() {
  return `wb_ses_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function parseGateSessions() {
  const content = readMarkdown('gate-sessions.md');
  if (!content) return [];
  const lines = content.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Session ID'));
  return lines.map(line => {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    return {
      session_id: cols[0] || '',
      phase: cols[1] || '',
      task: cols[2] || '',
      started: cols[3] || '',
      status: cols[4] || ''
    };
  });
}

function updateGateSession(sessionId, newPhase, newStatus) {
  const content = readMarkdown('gate-sessions.md');
  if (!content) return false;
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.includes(sessionId));
  if (idx === -1) return false;
  const cols = lines[idx].split('|');
  // Phase is column index 2, Status is column index 5
  cols[2] = ` ${newPhase} `;
  cols[5] = ` ${newStatus} `;
  lines[idx] = cols.join('|');
  fs.writeFileSync(path.join(MEMORY_DIR, 'gate-sessions.md'), lines.join('\n'), 'utf-8');
  return true;
}

function addGateSession(sessionId, taskDescription) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const entry = `| ${sessionId} | check | ${taskDescription.slice(0, 60)} | ${ts} | active |\n`;
  const content = readMarkdown('gate-sessions.md');
  if (!content) {
    const header = `# Gate Sessions\n\n_Compliance gate session records. Replaces gate-state.json._\n\n---\n\n| Session ID | Phase | Task | Started | Status |\n|------------|-------|------|---------|--------|\n`;
    appendToMarkdown('gate-sessions.md', header + entry);
  } else {
    appendToMarkdown('gate-sessions.md', entry);
  }
}

function checkFrameworkPrerequisites() {
  const issues = [];

  // Check project.yaml exists
  const projectYaml = path.join(PROJECT_ROOT, '.workbuddy', 'project.yaml');
  if (!fs.existsSync(projectYaml)) {
    issues.push('WARNING: .workbuddy/project.yaml not found — project not configured');
  }

  // Check hooks are configured
  const settingsJson = path.join(PROJECT_ROOT, '.codebuddy', 'settings.json');
  if (!fs.existsSync(settingsJson)) {
    issues.push('WARNING: .codebuddy/settings.json not found — hooks not configured');
  } else {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsJson, 'utf-8'));
      if (!settings.hooks || !settings.hooks.PreToolUse || !settings.hooks.PostToolUse || !settings.hooks.Stop) {
        issues.push('WARNING: Incomplete hook configuration in settings.json');
      }
    } catch {
      issues.push('WARNING: .codebuddy/settings.json is malformed');
    }
  }

  // Check framework-core.md rule exists
  const coreRule = path.join(PROJECT_ROOT, '.codebuddy', 'rules', 'framework-core.md');
  if (!fs.existsSync(coreRule)) {
    issues.push('WARNING: .codebuddy/rules/framework-core.md not found — P0/P1/P2 rules not active');
  }

  // Check state files directory
  if (!fs.existsSync(MEMORY_DIR)) {
    issues.push('INFO: .workbuddy/memory/ does not exist — will be created on first gate check');
  }

  return issues;
}

// ── Server Setup ─────────────────────────────────────────────────

const server = new Server(
  { name: 'workbuddy-compliance-gate', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'compliance_gate_check',
      description: `Mandatory runtime compliance gate (WorkBuddy-native). Must be called BEFORE any task execution.
Verifies: (1) .workbuddy/project.yaml exists, (2) hooks are configured in .codebuddy/settings.json,
(3) framework-core.md rule is active, (4) state files are accessible.
Returns a session_id on success. This is informational — it does not block execution.`,
      inputSchema: {
        type: 'object',
        properties: {
          task_description: {
            type: 'string',
            description: 'Brief description of the task to be executed'
          }
        },
        required: ['task_description']
      }
    },
    {
      name: 'compliance_gate_confirm',
      description: `Arms the compliance gate after the user has reviewed and confirmed the task plan.
Must be called AFTER compliance_gate_check passes and AFTER the user explicitly confirms the plan.
Provide the session_id returned by compliance_gate_check.`,
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID returned by compliance_gate_check'
          },
          plan_summary: {
            type: 'string',
            description: 'Summary of the plan that the user confirmed (min 10 chars)'
          }
        },
        required: ['session_id', 'plan_summary']
      }
    },
    {
      name: 'compliance_gate_complete',
      description: `Marks the compliance gate session as completed after task execution.
Consumes the armed state and outputs an audit summary.
Must be called AFTER compliance_gate_confirm and AFTER the task has been executed.
Cannot be called twice for the same session.`,
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID returned by compliance_gate_check'
          },
          execution_summary: {
            type: 'string',
            description: 'Brief summary of what was executed (max 1000 chars)'
          }
        },
        required: ['session_id', 'execution_summary']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'compliance_gate_check') {
    const taskDescription = args.task_description;
    if (!taskDescription || taskDescription.length < 3) {
      return { content: [{ type: 'text', text: JSON.stringify({ passed: false, reason: 'task_description must be at least 3 characters' }) }] };
    }

    const issues = checkFrameworkPrerequisites();
    const sessionId = generateSessionId();

    // Record the gate check
    addGateSession(sessionId, taskDescription);

    const hasErrors = issues.some(i => i.startsWith('WARNING'));
    const result = {
      passed: !hasErrors,
      session_id: sessionId,
      task: taskDescription,
      timestamp: new Date().toISOString(),
      issues: issues.length > 0 ? issues : ['All prerequisites met'],
      message: hasErrors
        ? 'Gate check passed with warnings. Review issues before proceeding.'
        : 'Gate check passed. All prerequisites met. Proceed to compliance_gate_confirm after user reviews the plan.'
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  if (name === 'compliance_gate_confirm') {
    const { session_id, plan_summary } = args;
    if (!session_id || !plan_summary || plan_summary.length < 10) {
      return { content: [{ type: 'text', text: JSON.stringify({ confirmed: false, reason: 'session_id and plan_summary (min 10 chars) are required' }) }] };
    }

    const sessions = parseGateSessions();
    const session = sessions.find(s => s.session_id === session_id);
    if (!session) {
      return { content: [{ type: 'text', text: JSON.stringify({ confirmed: false, reason: `Session ${session_id} not found. Run compliance_gate_check first.` }) }] };
    }
    if (session.phase !== 'check') {
      return { content: [{ type: 'text', text: JSON.stringify({ confirmed: false, reason: `Session ${session_id} is in '${session.phase}' phase, not 'check'.` }) }] };
    }

    updateGateSession(session_id, 'confirm', 'armed');

    return { content: [{ type: 'text', text: JSON.stringify({
      confirmed: true,
      session_id,
      phase: 'confirm',
      status: 'armed',
      message: 'Compliance gate armed. You may now proceed with task execution. Call compliance_gate_complete when done.'
    }) }] };
  }

  if (name === 'compliance_gate_complete') {
    const { session_id, execution_summary } = args;
    if (!session_id || !execution_summary) {
      return { content: [{ type: 'text', text: JSON.stringify({ completed: false, reason: 'session_id and execution_summary are required' }) }] };
    }

    const sessions = parseGateSessions();
    const session = sessions.find(s => s.session_id === session_id);
    if (!session) {
      return { content: [{ type: 'text', text: JSON.stringify({ completed: false, reason: `Session ${session_id} not found. Run compliance_gate_check first.` }) }] };
    }
    if (session.phase !== 'confirm') {
      return { content: [{ type: 'text', text: JSON.stringify({ completed: false, reason: `Session ${session_id} is in '${session.phase}' phase, not 'confirm'. Gate must be armed before completion.` }) }] };
    }

    updateGateSession(session_id, 'complete', 'consumed');

    // Check framework-state.md for any blocked quality dimensions
    let qualityStatus = 'clean';
    const stateContent = readMarkdown('framework-state.md');
    if (stateContent) {
      const blockedMatch = stateContent.match(/\|\s*(lint|types|dependencies|format)\s*\|\s*blocked\s*\|/i);
      if (blockedMatch) {
        qualityStatus = 'blocked';
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify({
      completed: qualityStatus !== 'blocked',
      session_id,
      phase: 'complete',
      status: qualityStatus === 'blocked' ? 'failed' : 'consumed',
      execution_summary,
      quality_status: qualityStatus,
      message: qualityStatus === 'blocked'
        ? 'Gate complete but quality dimensions are blocked. Run /code-quality-gate to resolve.'
        : 'Compliance gate completed successfully. Session closed.'
    }) }] };
  }

  return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
});

// ── Start ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
