#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const OPENCODE_ROOT = process.env.OPENCODE_ROOT || ".";
const fs2 = require("fs");
const path2 = require("path");

function resolveProjectState() {
  const cfgPath = path2.join(OPENCODE_ROOT, ".opencode", "project.config.json");
  try {
    const cfg = JSON.parse(fs2.readFileSync(cfgPath, "utf8"));
    const pr = cfg.project_root;
    if (pr && pr !== ".") {
      const stateDir = path2.join(OPENCODE_ROOT, pr, ".opencode", "state");
      if (fs2.existsSync(stateDir)) return stateDir;
    }
  } catch {}
  return path2.join(OPENCODE_ROOT, ".opencode", "state");
}

const GATE_STATE_FILE =
  process.env.GATE_STATE_PATH ||
  path2.join(resolveProjectState(), "gate-state.json");

const SKILL_INV_STD =
  process.env.SKILL_INV_STD_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "rules",
    "rule_detail",
    "skill-invocation-standard.md",
  );

const MCP_INVENTORY =
  process.env.MCP_INVENTORY_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "rules",
    "rule_detail",
    "mcp-tool-inventory.md",
  );

const COMMON_RULES =
  process.env.COMMON_RULES_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "rules",
    "common-project.md",
  );

const SKILL_FILE =
  process.env.SKILL_FILE_PATH ||
  require("path").join(
    OPENCODE_ROOT,
    ".opencode",
    "skills",
    "execution-preflight-check",
    "SKILL.md",
  );

const fs = require("fs");
const path = require("path");

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function generateSessionId() {
  const ts = Date.now().toString();
  return `cg_ses_${ts}`;
}

function getFreshStore() {
  return {
    formatVersion: "2.0",
    sessions: {},
    active_sessions: [],
    last_updated: null,
  };
}

function loadStore() {
  const s = readJson(GATE_STATE_FILE);
  if (s && s.formatVersion === '2.0' && s.sessions && typeof s.sessions === 'object') {
    // Backward compat: ensure active_sessions exists
    if (!Array.isArray(s.active_sessions)) {
      s.active_sessions = [];
    }
    // Reconciliation pass: remove completed/expired sessions from active_sessions
    let reconciled = false;
    s.active_sessions = s.active_sessions.filter(sid => {
      const ses = s.sessions[sid];
      if (!ses) { reconciled = true; return false; } // orphaned ref
      if (ses.gate_status === 'completed' || ses.gate_status === 'failed') { reconciled = true; return false; }
      if (ses.consumed_at) { reconciled = true; return false; } // consumed but not marked completed/failed
      return true; // still active (checked or armed)
    });
    if (reconciled) {
      s.last_updated = new Date().toISOString();
    }
    // Ensure last_updated exists
    if (!s.last_updated) {
      s.last_updated = new Date().toISOString();
    }
    return s;
  }
  return getFreshStore();
}

function saveStore(store) {
  writeJson(GATE_STATE_FILE, store);
}

function isSkillLoadedInSession() {
  return fileExists(SKILL_FILE);
}

function wasRuleConsulted() {
  const results = {};
  [COMMON_RULES, SKILL_INV_STD, MCP_INVENTORY].forEach((f) => {
    results[path.basename(f)] = fileExists(f) ? "found" : "missing";
  });
  return results;
}

function runGateCheck(taskDescription) {
  const store = loadStore();
  const sessionId = generateSessionId();
  const ruleStatus = wasRuleConsulted();
  const skillAvailable = isSkillLoadedInSession();
  const failed = [];

  if (!skillAvailable) {
    failed.push({
      id: "skill_execution_preflight_check",
      desc: `execution-preflight-check SKILL.md not found at ${SKILL_FILE}`,
      severity: "HIGH",
    });
  }
  if (ruleStatus[path.basename(COMMON_RULES)] !== "found") {
    failed.push({
      id: "rule_common_project",
      desc: `common-project.md not found at ${COMMON_RULES}`,
      severity: "HIGH",
    });
  }
  if (ruleStatus[path.basename(SKILL_INV_STD)] !== "found") {
    failed.push({
      id: "rule_skill_invocation_standard",
      desc: `skill-invocation-standard.md not found at ${SKILL_INV_STD}`,
      severity: "HIGH",
    });
  }
  if (ruleStatus[path.basename(MCP_INVENTORY)] !== "found") {
    failed.push({
      id: "rule_mcp_inventory",
      desc: `mcp-tool-inventory.md not found at ${MCP_INVENTORY}`,
      severity: "HIGH",
    });
  }

  // Check for unresolved role violations
  try {
    const stateDir = resolveProjectState();
    const machinePath = path2.join(stateDir, "machine.json");
    if (fs2.existsSync(machinePath)) {
      const machine = JSON.parse(fs2.readFileSync(machinePath, "utf-8"));
      const violations = machine.compliance_records?.role_violations || [];
      const unresolved = violations.filter((v) => v.status === "unresolved");
      if (unresolved.length > 0) {
        failed.push({
          id: "agent_role_violation",
          desc: `CAT4.1: ${unresolved.length} unresolved role violations found in machine.json.compliance_records. Last: ${unresolved[unresolved.length - 1].agent} wrote ${unresolved[unresolved.length - 1].violation_file}`,
          severity: "HIGH",
        });
      }
    }
  } catch {} // Non-blocking if machine.json can't be read

  const passed = failed.length === 0;
  store.sessions[sessionId] = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || "",
    gate_status: passed ? "checked" : "failed",
    last_check_failed_items: failed,
    plan_summary: null,
    confirmed_at: null,
    consumed_at: null,
    audit: null,
  };
  saveStore(store);
  return {
    passed,
    session_id: sessionId,
    failed_items: failed,
    rule_status: ruleStatus,
  };
}

function runGateConfirm(sessionId, planSummary) {
  const store = loadStore();
  const session = sessionId ? store.sessions[sessionId] : null;
  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}. Must call compliance_gate_check first.`,
    };
  }
  if (session.gate_status === "armed") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is already armed. Cannot re-arm.`,
    };
  }
  if (!planSummary || planSummary.trim().length < 10) {
    return {
      status: "rejected",
      reason: "plan_summary must be at least 10 characters",
    };
  }

  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  // Add to active_sessions (dedup)
  if (!store.active_sessions.includes(sessionId)) {
    store.active_sessions.push(sessionId);
  }
  store.last_updated = new Date().toISOString();
  saveStore(store);
  return {
    status: "armed",
    session_id: sessionId,
    confirmed_at: session.confirmed_at,
    plan_summary: planSummary.trim().substring(0, 200),
  };
}

function runGateComplete(sessionId, executionSummary) {
  const store = loadStore();
  const session = sessionId ? store.sessions[sessionId] : null;
  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}. Must call compliance_gate_check and compliance_gate_confirm first.`,
    };
  }
  if (session.gate_status !== "armed") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.`,
    };
  }
  if (session.consumed_at) {
    return {
      status: "rejected",
      reason: `session ${sessionId} already completed at ${session.consumed_at}. Cannot re-complete.`,
    };
  }

  // ESLint mock-audit check: read machine.json.eslint_state
  const stateDir = resolveProjectState();
  const machinePath = path2.join(stateDir, "machine.json");
  let eslintFailed = false;
  let dirtyModules = [];

  try {
    if (fs2.existsSync(machinePath)) {
      const machine = JSON.parse(fs2.readFileSync(machinePath, "utf-8"));
      if (machine.eslint_state?.aggregate?.dirty_modules?.length > 0) {
        dirtyModules = machine.eslint_state.aggregate.dirty_modules;
        eslintFailed = true;
      }
    }
  } catch {
    // If machine.json can't be read, allow gate to proceed
  }

  if (eslintFailed) {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason =
      "ESLint mock-audit violations found in modules: " +
      dirtyModules.join(", ");
    session.audit = {
      execution_summary: (executionSummary || "").substring(0, 1000),
      completed_at: now,
    };
    // Remove from active_sessions
    store.active_sessions = store.active_sessions.filter(sid => sid !== sessionId);
    store.last_updated = new Date().toISOString();
    saveStore(store);
    return {
      status: "failed",
      reason:
        "CAT3.7: ESLint mock-audit violations in modules: " +
        dirtyModules.join(", ") +
        ". Run eslint-audit.run_audit({ full_scan: true }) to see details, then fix violations or obtain @Arbiter waivers.",
      dirty_modules: dirtyModules,
    };
  }

  const now = new Date().toISOString();
  session.gate_status = "completed";
  session.consumed_at = now;
  session.audit = {
    execution_summary: (executionSummary || "").substring(0, 1000),
    completed_at: now,
  };
    // Remove from active_sessions
    store.active_sessions = store.active_sessions.filter(sid => sid !== sessionId);
    store.last_updated = new Date().toISOString();
  saveStore(store);

  const audit = {
    status: "completed",
    session_id: sessionId,
    task_description: session.task_description,
    plan_summary: session.plan_summary,
    confirmed_at: session.confirmed_at,
    consumed_at: session.consumed_at,
    execution_summary: session.audit.execution_summary,
  };
  return { status: "completed", audit };
}

// 创建 MCP Server
const server = new Server(
  {
    name: "compliance-gate",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "compliance_gate_check",
      description:
        "MANDATORY runtime compliance gate. Must be called BEFORE any task execution. Verifies: (1) execution-preflight-check skill exists, (2) rule documents are present. Returns passed=true and session_id only when all checks clear. NOTE: Gate status is informational only - check does not require pre-armed gate, making it safe for concurrent sessions.",
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
        'Mark the compliance gate as "armed" after the user has reviewed and confirmed the task plan. This must be called AFTER compliance_gate_check passes and AFTER the user explicitly confirms the plan. Provide the session_id returned by compliance_gate_check.',
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description:
              "Session ID returned by compliance_gate_check (e.g. cg_ses_1777110280157)",
          },
          plan_summary: {
            type: "string",
            description:
              "Summary of the plan that the user confirmed (min 10 chars)",
          },
        },
        required: ["session_id", "plan_summary"],
      },
    },
    {
      name: "compliance_gate_complete",
      description:
        "Mark the compliance gate session as completed after task execution. Consumes the armed state and outputs an audit summary. This must be called AFTER compliance_gate_confirm and AFTER the task has been executed. Cannot be called twice for the same session. INTERNALLY: reads machine.json.eslint_state and returns failed if dirty_modules exist (CAT3.7). Run eslint-audit.run_audit({ full_scan: true }) first.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description:
              "Session ID returned by compliance_gate_check (e.g. cg_ses_1777110280157)",
          },
          execution_summary: {
            type: "string",
            description: "Brief summary of what was executed (max 1000 chars)",
          },
        },
        required: ["session_id", "execution_summary"],
      },
    },
  ],
}));

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "compliance_gate_check") {
    const result = runGateCheck(args?.task_description || "");
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.passed,
    };
  }

  if (name === "compliance_gate_confirm") {
    if (!args?.plan_summary || !args?.session_id) {
      throw new Error(
        "Missing required parameters: session_id and plan_summary",
      );
    }
    const result = runGateConfirm(args.session_id, args.plan_summary);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.status !== "armed",
    };
  }

  if (name === "compliance_gate_complete") {
    if (!args?.session_id || !args?.execution_summary) {
      throw new Error(
        "Missing required parameters: session_id and execution_summary",
      );
    }
    const result = runGateComplete(args.session_id, args.execution_summary);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.status !== "completed",
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// 启动 stdio 传输
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[compliance-gate] started (SDK)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
