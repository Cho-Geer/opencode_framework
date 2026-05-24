#!/usr/bin/env node
"use strict";

/**
 * Unified MCP Server — qoder-framework-tools
 * ============================================
 * Single entry point aggregating all framework MCP tools.
 *
 * Tools exposed:
 *   1. compliance_gate_check(task_description)
 *   2. compliance_gate_confirm(session_id, plan_summary)
 *   3. compliance_gate_complete(session_id, execution_summary)
 *   4. run_write_check(changed_file, agent_type, task_id)
 *   5. eslint_audit(scope)
 *   6. keystone_validate(mode, target?)
 *
 * Architecture:
 *   - Scripts with `require.main === module` guards are imported directly
 *     (code-quality-gate.js, keystone-validate.js)
 *   - Scripts without guards (compliance-gate.js, eslint-audit.js) are invoked
 *     via child process spawn with MCP client transport
 *
 * Usage:
 *   node .qoder/mcp-server.js
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const path = require("path");
const { spawn } = require("child_process");

const OPENCODE_ROOT = path.resolve(__dirname, "..");
const SCRIPTS_DIR = path.join(__dirname, "scripts", "mcp-tools");

// ─── Direct Imports (scripts with require.main === module guards) ────────

const codeQualityGate = require(path.join(__dirname, "scripts", "mcp-tools", "code-quality-gate.js"));
const keystoneValidate = require(path.join(__dirname, "scripts", "mcp-tools", "keystone-validate.js"));

// ─── Child Process MCP Client Helper ────────────────────────────────────

/**
 * Spawn an MCP tool script as a subprocess and invoke a tool on it.
 * Uses JSON-RPC 2.0 protocol over stdio (MCP standard).
 *
 * @param {string} scriptPath - Absolute path to the MCP tool script
 * @param {string} toolName - Name of the tool to call
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} - Tool result content
 */
function callSubprocessTool(scriptPath, toolName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath], {
      cwd: OPENCODE_ROOT,
      env: { ...process.env, OPENCODE_ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // MCP stdio protocol: send initialize, then tools/call
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "qoder-unified-server", version: "1.0.0" },
      },
    });

    const callRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args || {} },
    });

    // Send both requests with slight delay for initialization
    child.stdin.write(initRequest + "\n");
    setTimeout(() => {
      child.stdin.write(callRequest + "\n");
      // Close stdin after sending to signal we're done
      setTimeout(() => {
        child.stdin.end();
      }, 100);
    }, 50);

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error(`Subprocess timeout for tool ${toolName}`));
      }
    }, 30000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (resolved) return;
      resolved = true;

      // Parse JSON-RPC responses from stdout
      const lines = stdout.split("\n").filter((l) => l.trim());
      let toolResult = null;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result) {
            toolResult = msg.result;
            break;
          }
          if (msg.id === 2 && msg.error) {
            reject(new Error(msg.error.message || "Tool call failed"));
            return;
          }
        } catch {
          // Not a JSON line, skip
        }
      }

      if (toolResult) {
        resolve(toolResult);
      } else {
        // Fallback: if no proper JSON-RPC response, return raw output
        resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: code === 0 ? "completed" : "error",
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                },
                null,
                2,
              ),
            },
          ],
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

// ─── Tool Definitions ───────────────────────────────────────────────────

const TOOLS = [
  {
    name: "compliance_gate_check",
    description:
      "MANDATORY runtime compliance gate. Must be called BEFORE any task execution. Returns session_id on success.",
    inputSchema: {
      type: "object",
      properties: {
        task_description: {
          type: "string",
          description: "Brief description of the task to be executed",
        },
      },
      required: ["task_description"],
    },
  },
  {
    name: "compliance_gate_confirm",
    description:
      'Mark compliance gate as "armed" after user confirms the plan. Call AFTER compliance_gate_check passes.',
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID returned by compliance_gate_check",
        },
        plan_summary: {
          type: "string",
          description: "Summary of the confirmed plan (min 10 chars)",
        },
      },
      required: ["session_id", "plan_summary"],
    },
  },
  {
    name: "compliance_gate_complete",
    description:
      "Mark compliance gate session as completed. Consumes armed state and outputs audit summary. Internally checks machine.json.eslint_state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID returned by compliance_gate_check",
        },
        execution_summary: {
          type: "string",
          description: "Brief summary of what was executed (max 1000 chars)",
        },
      },
      required: ["session_id", "execution_summary"],
    },
  },
  {
    name: "run_write_check",
    description:
      "Write-Time audit on a single changed file. Checks: Agent Scope, Prettier, dependency-cruiser, ESLint mock-audit, tsc incremental.",
    inputSchema: {
      type: "object",
      required: ["changed_file", "agent_type"],
      properties: {
        changed_file: {
          type: "string",
          description: "Path of the changed file (absolute or project-relative)",
        },
        agent_type: {
          type: "string",
          enum: [
            "@Coder-BE",
            "@Coder-FE",
            "@Architect",
            "@Orchestrator",
            "@Guardian",
            "@Meta-Planner",
          ],
          description: "Agent identity for write scope enforcement",
        },
        task_id: {
          type: "string",
          description: "Current task ID for audit trail",
        },
      },
    },
  },
  {
    name: "eslint_audit",
    description:
      "Run ESLint mock-audit on changed files or full project. Updates machine.json.eslint_state.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["file", "full"],
          description:
            "Audit scope: 'file' for single file check, 'full' for full project scan",
        },
        changed_file: {
          type: "string",
          description: "File path for file-scope audit",
        },
      },
    },
  },
  {
    name: "keystone_validate",
    description:
      "Run Keystone validation checks (contract hash, task lifecycle, TDD, compliance gate).",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["audit", "pre-commit", "ci"],
          description:
            "audit: working tree (default), pre-commit: staged changes, ci: hash-only fast check",
        },
        target: {
          type: "string",
          description: "Optional target file for validation",
        },
      },
    },
  },
];

// ─── Tool Routing Map ───────────────────────────────────────────────────

const COMPLIANCE_GATE_SCRIPT = path.join(SCRIPTS_DIR, "compliance-gate.js");
const ESLINT_AUDIT_SCRIPT = path.join(SCRIPTS_DIR, "eslint-audit.js");

// ─── Tool Handler ───────────────────────────────────────────────────────

async function handleToolCall(toolName, args) {
  switch (toolName) {
    // ── Compliance Gate tools → subprocess (no require.main guard) ──
    case "compliance_gate_check":
      return callSubprocessTool(COMPLIANCE_GATE_SCRIPT, "compliance_gate_check", {
        task_description: args?.task_description || "",
      });

    case "compliance_gate_confirm":
      return callSubprocessTool(COMPLIANCE_GATE_SCRIPT, "compliance_gate_confirm", {
        session_id: args?.session_id,
        plan_summary: args?.plan_summary,
      });

    case "compliance_gate_complete":
      return callSubprocessTool(COMPLIANCE_GATE_SCRIPT, "compliance_gate_complete", {
        session_id: args?.session_id,
        execution_summary: args?.execution_summary,
      });

    // ── Write Check → direct import (has require.main guard) ──
    case "run_write_check": {
      const result = codeQualityGate.runWriteCheck({
        changed_file: args?.changed_file,
        agent_type: args?.agent_type,
        skip_checks: args?.skip_checks || [],
        auto_fix: args?.auto_fix !== false,
        task_id: args?.task_id || "unknown",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: result.overall === "fail",
      };
    }

    // ── ESLint Audit → subprocess (updateMachineJson not exported) ──
    case "eslint_audit": {
      const auditArgs = {};
      if (args?.scope === "full") {
        auditArgs.full_scan = true;
        auditArgs.scan_business_code = true;
      } else if (args?.changed_file) {
        auditArgs.changed_file = args.changed_file;
      }
      return callSubprocessTool(ESLINT_AUDIT_SCRIPT, "run_audit", auditArgs);
    }

    // ── Keystone Validate → direct import (has require.main guard) ──
    case "keystone_validate": {
      const mode = args?.mode || "audit";
      const result = keystoneValidate.runValidate(mode);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─── MCP Server Setup ───────────────────────────────────────────────────

const server = new Server(
  { name: "qoder-framework-tools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args);
});

// ─── Start Server ───────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[qoder-framework-tools] Unified MCP server started\n");
}

main().catch((err) => {
  process.stderr.write(`[qoder-framework-tools] Fatal error: ${err.message}\n`);
  process.exit(1);
});
