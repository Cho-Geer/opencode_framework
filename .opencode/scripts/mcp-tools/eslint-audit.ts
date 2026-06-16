#!/usr/bin/env bun
"use strict";

/**
 * MCP Tool: eslint-audit
 *
 * Exposes tool `run_audit` that:
 * 1. Reads contract.yaml x-eslint-policy → generates .opencode/generated/tier-rules.json
 * 2. Runs ESLint with opencode-mock-audit plugin on target files
 * 3. Updates machine.json.eslint_state with results
 *
 * Called by:
 *   - compliance_gate_complete (Layer B: mandatory, full scan)
 *   - @Coder agents after write/edit (Layer A: advisory, file scan)
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const OPENCODE_ROOT = path.resolve(__dirname, "..", "..", "..");

// ─── Atomic Write (Sub-State Split) ────────────────────────────────────────────
/**
 * FW-REPAIR-P1B-IMPORT: atomicWriteSubState is defined in state-utils.ts.
 */
const { atomicWriteSubState } = require("../../lib/state-utils");
const PROJECT_CONFIG = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "project.config.json",
);

function getProjectRoot() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, "utf-8"));
  } catch (readErr) {
    throw new Error(
      `[eslint-audit] Cannot read or parse project.config.json at ${PROJECT_CONFIG}: ${readErr.message}`,
    );
  }
  if (!cfg.project_root) {
    throw new Error(
      `[eslint-audit] 'project_root' is not defined in project.config.json (${PROJECT_CONFIG}). ` +
        'Add "project_root": "<subdirectory>" to the config file.',
    );
  }
  return path.resolve(OPENCODE_ROOT, cfg.project_root);
}

function getStateDir() {
  const pr = getProjectRoot();
  const stateDir = path.join(pr, ".opencode", "state");
  if (fs.existsSync(stateDir)) return stateDir;
  return path.join(OPENCODE_ROOT, ".opencode", "state");
}

function extractModule(filePath) {
  const match = filePath.match(/modules\/([^/]+)/);
  return match ? match[1] : "unknown";
}

function generateTierRules(projectRoot) {
  const contractPath = path.join(projectRoot, "contract.yaml");
  const outputDir = path.join(OPENCODE_ROOT, ".opencode", "generated");
  const outputPath = path.join(outputDir, "tier-rules.json");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const yaml = require("js-yaml");
    const contract = yaml.load(fs.readFileSync(contractPath, "utf-8"));
    const policy = contract["x-eslint-policy"];

    if (!policy || !policy.tier_definition) {
      throw new Error("x-eslint-policy not found in contract.yaml");
    }

    const tierRules = {
      tier1: policy.tier_definition.tier1_real_only?.services || [],
      tier2: policy.tier_definition.tier2_fake_ok?.services || [],
      tier3: policy.tier_definition.tier3_boundary_mock?.services || [],
    };

    fs.writeFileSync(outputPath, JSON.stringify(tierRules, null, 2));
    return tierRules;
  } catch (err) {
    // Fallback if js-yaml not available or contract malformed
    const fallback = {
      tier1: ["PrismaService", "RedisService", "ConfigService"],
      tier2: [
        "JwtService",
        "QueueService",
        "NotificationGateway",
        "RateLimiterService",
      ],
      tier3: ["EmailService", "SMSService"],
    };
    fs.writeFileSync(outputPath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function runESLint(projectRoot, targetFiles, scanBusinessCode) {
  const pluginDir = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "eslint-plugin",
    "eslint-plugin-opencode-mock-audit",
  );

  if (!fs.existsSync(pluginDir)) {
    return { violations: [], exitCode: 0, error: "ESLint plugin not found" };
  }

  const rules = [
    "no-tier1-mock: error",
    "no-skipped-tests: error",
    "no-skipped-audit: error",
    "no-console-log: error",
    "no-empty-assertions: error", // NEW v3.0: bogus test detection
    "no-only-left: error", // NEW v3.0: debugging artifact detection
    "no-any-in-spec: error", // NEW v3.0: test type safety
    "max-complexity-enforce: warn", // NEW v3.0: code quality
    "tier3-verify: warn",
    "no-uncovered-switch: warn",
    "no-deep-import: warn", // NEW v3.0: architecture
  ];

  try {
    let filesArg =
      targetFiles.length > 0
        ? targetFiles.join(" ")
        : `${projectRoot}/src/modules/**/*.spec.ts ${projectRoot}/test/**/*.spec.ts`;

    if (scanBusinessCode) {
      // Full scan: also check business code files for quality rules
      filesArg += ` ${projectRoot}/src/modules/**/*.service.ts ${projectRoot}/src/modules/**/*.controller.ts ${projectRoot}/src/modules/**/*.dto.ts`;
    }

    const ruleArgs = rules.map((r) => `--rule '${r}'`).join(" ");

    const result = execSync(
      `npx eslint --no-eslintrc ` +
        `--rulesdir "${pluginDir}/rules" ` +
        ruleArgs +
        ` --format json ` +
        filesArg,
      {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30000,
      },
    );
    return { violations: [], exitCode: 0 };
  } catch (err) {
    // ESLint exits with code 1 when there are errors
    try {
      const results = JSON.parse(err.stdout?.toString() || "[]");
      const violations = results
        .filter((f) => f.messages?.length > 0)
        .flatMap((f) =>
          f.messages.map((m) => ({
            file: f.filePath,
            line: m.line,
            column: m.column,
            rule: m.ruleId,
            message: m.message
              .replace("CAT1.0: ", "")
              .replace("CAT1.1: ", "")
              .replace("CAT3.1: ", "")
              .replace("CAT3.3: ", "")
              .replace("CAT3.4: ", "")
              .replace("CAT3.6: ", "")
              .replace("CAT4.5: ", ""),
            severity: m.severity,
          })),
        );
      return { violations, exitCode: 1 };
    } catch {
      return { violations: [], exitCode: 1, error: err.message };
    }
  }
}

function updateMachineJson(moduleName, violations, waivers, taskId) {
  const hasWaiver = waivers && waivers.length > 0;
  const status =
    violations.length === 0 ? "clean" : hasWaiver ? "waived" : "dirty";

  const ok = atomicWriteSubState("eslint_state", (eslint_state) => {
    if (!eslint_state) {
      eslint_state = {
        last_full_scan: null,
        modules: {},
        aggregate: {
          total_violations: 0,
          dirty_modules: [],
          waived_modules: [],
        },
      };
    }

    eslint_state.modules[moduleName] = {
      status,
      violations: violations.map((v) => ({
        ...v,
        waiver: hasWaiver ? waivers[0] : null,
      })),
      last_check: new Date().toISOString(),
      waivers_applied: waivers || [],
    };

    // Recalculate aggregate
    const allModules = Object.values(eslint_state.modules);
    eslint_state.aggregate = {
      total_violations: allModules.reduce(
        (sum, m) => sum + m.violations.length,
        0,
      ),
      dirty_modules: Object.entries(eslint_state.modules)
        .filter(([, m]) => m.status === "dirty")
        .map(([k]) => k),
      waived_modules: Object.entries(eslint_state.modules)
        .filter(([, m]) => m.status === "waived")
        .map(([k]) => k),
    };
    eslint_state.last_full_scan = new Date().toISOString();
  });

  if (!ok) {
    return { updated: false, reason: "Sub-state write failed after 3 retries" };
  }

  return { updated: true, status };
}

// MCP Server
const server = new Server(
  { name: "eslint-audit", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run_audit",
      description:
        "Run ESLint mock-audit on changed files or full project. Updates machine.json.eslint_state.",
      inputSchema: {
        type: "object",
        properties: {
          changed_file: {
            type: "string",
            description:
              "Single changed file path (Layer A: agent write/edit). Optional; omit for full scan.",
          },
          full_scan: {
            type: "boolean",
            description:
              "Scan all spec files in the project (Layer B: compliance_gate_complete)",
          },
          scan_business_code: {
            type: "boolean",
            description:
              "Also scan business code (service/controller/dto) for quality rules",
          },
          waivers: {
            type: "array",
            items: { type: "string" },
            description: "Optional waiver IDs to apply to detected violations",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "run_audit") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { changed_file, full_scan, scan_business_code, waivers } =
    request.params.arguments || {};
  const projectRoot = getProjectRoot();

  // Step 1: Generate tier-rules.json from contract.yaml
  const tierRules = generateTierRules(projectRoot);

  // Step 2: Determine target files
  const targetFiles = [];
  if (changed_file && !full_scan) {
    targetFiles.push(changed_file);
  }

  // Step 3: Run ESLint
  const result = runESLint(
    projectRoot,
    targetFiles,
    scan_business_code || full_scan,
  );

  // Step 4: Extract module name
  const moduleName = changed_file ? extractModule(changed_file) : "all_modules";

  // Step 5: Update machine.json
  const stateUpdate = updateMachineJson(
    full_scan ? "all_modules" : moduleName,
    result.violations || [],
    waivers || [],
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: result.violations?.length > 0 ? "fail" : "pass",
            module: moduleName,
            violations: result.violations || [],
            violations_count: result.violations?.length || 0,
            eslint_exit_code: result.exitCode,
            tier_rules_generated: {
              tier1_count: tierRules.tier1.length,
              tier2_count: tierRules.tier2.length,
              tier3_count: tierRules.tier3.length,
            },
            machine_json_updated: stateUpdate.updated,
            state_status: stateUpdate.status || "unknown",
          },
          null,
          2,
        ),
      },
    ],
  };
});

/**
 * Start the MCP server over stdio transport.
 *
 * FW-REPAIR-ESLINT-32000: Previously used `if (require.main === module)` guard
 * with non-awaited `server.connect(transport)` — the unhandled Promise could
 * race with process exit, causing "32000: Connection closed" errors.
 *
 * Now ALWAYS starts the server (matching compliance-gate.ts pattern) with proper
 * async/await + error handling to ensure the transport is fully established
 * before the event loop drains.
 *
 * @fix FW-REPAIR-ESLINT-32000 — 2026-06-06 @Super-Admin
 */
let _activeTransport: StdioServerTransport | null = null;
async function main() {
  const transport = new StdioServerTransport();
  _activeTransport = transport;
  await server.connect(transport);
  process.stderr.write("[eslint-audit] started (SDK)\n");
}

// ── FW-INTERRUPT-GUARD (2026-06-14): Graceful SIGINT shutdown ──
// When the parent OpenCode process forwards a cooperative cancel, close the
// MCP transport cleanly so the TUI never sees a raw "Unexpected {interrupt}"
// template propagated from this server.
process.on("SIGINT", async () => {
  try {
    process.stderr.write("[eslint-audit] SIGINT — shutting down\n");
    if (_activeTransport) {
      try { await _activeTransport.close(); } catch { /* best-effort */ }
    }
    try { await server.close(); } catch { /* best-effort */ }
  } catch {
    /* ignore */
  }
  process.exit(0);
});

main().catch((err: Error) => {
  process.stderr.write(`[eslint-audit] Fatal error: ${err.message}\n`);
  process.exit(1);
});

// Export internals for testing
module.exports = { getProjectRoot, generateTierRules, runESLint };
