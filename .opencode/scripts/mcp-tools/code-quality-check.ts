#!/usr/bin/env bun
"use strict";

/**
 * MCP Tool: code-quality-check
 * Replaces deprecated code-quality-gate.ts (code-quality-cleanup-plan Phase 1)
 *
 * Exposes tools:
 *   code_quality_check.run_depcruise_check({ changed_file }) — single-file dependency-cruiser
 *   code_quality_check.run_tsc_check({ changed_file }) — single-file tsc incremental check
 *   code_quality_check.run_full_scan() — full tsc + depcruise + prettier scan
 *
 * Uses code-quality-lib.ts functions: runDepCruiserCheck(), runTscCheck(), runFullScan()
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const fs = require("node:fs");
const path = require("node:path");
const OPENCODE_ROOT = path.resolve(__dirname, "..", "..", "..");

const PROJECT_CONFIG = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "project.config.json",
);

function getProjectRoot() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, "utf-8"));
  } catch (e) {
    throw new Error(
      "[code-quality-check] Cannot read project.config.json: " + e.message,
    );
  }
  if (!cfg.project_root)
    throw new Error("[code-quality-check] project_root not defined");
  return path.resolve(OPENCODE_ROOT, cfg.project_root);
}

function getConfig() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, "utf-8"));
  } catch (e) {
    throw new Error(
      "[code-quality-check] Cannot read project.config.json: " + e.message,
    );
  }
  const projectRoot = path.resolve(OPENCODE_ROOT, cfg.project_root || ".");
  const backendSrc = cfg.paths?.backend_src || "";
  const frontendSrc = cfg.paths?.frontend_src || "";
  return {
    projectRoot,
    backendDir: path.resolve(projectRoot, backendSrc),
    frontendDir: path.resolve(projectRoot, frontendSrc),
  };
}

// ─── Load Shared Library ──────────────────────────────────
const {
  runDepCruiserCheck,
  runTscCheck,
  runFullScan,
} = require("./code-quality-lib");

// ─── Server Setup ─────────────────────────────────────────
const server = new Server(
  { name: "code-quality-check", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "code_quality_check.run_depcruise_check",
      description:
        "Run dependency-cruiser architecture boundary check on a single file",
      inputSchema: {
        type: "object",
        properties: {
          changed_file: {
            type: "string",
            description: "Path to the changed file",
          },
        },
        required: ["changed_file"],
      },
    },
    {
      name: "code_quality_check.run_tsc_check",
      description: "Run tsc --noEmit incremental type check on a single file",
      inputSchema: {
        type: "object",
        properties: {
          changed_file: {
            type: "string",
            description: "Path to the changed file",
          },
        },
        required: ["changed_file"],
      },
    },
    {
      name: "code_quality_check.run_full_scan",
      description:
        "Full project scan: tsc + dependency-cruiser + prettier on entire codebase",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const { projectRoot, backendDir, frontendDir } = getConfig();

  switch (name) {
    case "code_quality_check.run_depcruise_check": {
      const result = runDepCruiserCheck(args.changed_file, projectRoot);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "code_quality_check.run_tsc_check": {
      const result = runTscCheck(
        args.changed_file,
        projectRoot,
        backendDir,
        frontendDir,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "code_quality_check.run_full_scan": {
      const result = runFullScan(projectRoot, backendDir, frontendDir);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    default:
      throw new Error("Unknown tool: " + name);
  }
});

// ─── Entry Point ──────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[code-quality-check] started\n");
}

main().catch((err) => {
  process.stderr.write("Fatal error: " + err.message + "\n");
  process.exit(1);
});

// ─── Exports for Testability ──────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getConfig };
}
