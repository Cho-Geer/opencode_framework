#!/usr/bin/env bun
"use strict";

/**
 * MCP Tool: code-quality-check
 * Replaces deprecated code-quality-gate.ts (code-quality-cleanup-plan Phase 1)
 *
 * Exposes tools:
 *   code_quality_check.run_depcruise_check({ changed_file }) — single-file dependency-cruiser
 *   code_quality_check.run_full_scan() — full depcruise + prettier scan (tsc removed, handled by tsc-diag-track plugin)
 *
 * Uses code-quality-lib.ts functions: runDepCruiserCheck(), runFullScan()
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import fs from "node:fs";
import path from "node:path";
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
import { runDepCruiserCheck,
  // runTscCheck removed — tsc now handled automatically by tsc-diag-track.ts plugin (2026-06-26)
  runFullScan, } from "./code-quality-lib";

// ─── Server Setup ─────────────────────────────────────────
const cqServer = new McpServer(
  { name: "code-quality-check", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

cqServer.registerTool("code_quality_check.run_depcruise_check", {
  description: "Run dependency-cruiser architecture boundary check on a single file",
  inputSchema: {
    changed_file: z.string().describe("Path to the changed file"),
  },
}, (args) => {
  const { projectRoot } = getConfig();
  const result = runDepCruiserCheck(args.changed_file, projectRoot);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
});

cqServer.registerTool("code_quality_check.run_full_scan", {
  description: "Full project scan: dependency-cruiser + prettier on entire codebase (tsc handled automatically by tsc-diag-track plugin)",
  inputSchema: {},
}, () => {
  const { projectRoot, backendDir, frontendDir } = getConfig();
  const result = runFullScan(projectRoot, backendDir, frontendDir);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
});

// ─── Entry Point ──────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await cqServer.connect(transport);
  process.stderr.write("[code-quality-check] started (McpServer)\n");
}

main().catch((err) => {
  process.stderr.write("Fatal error: " + err.message + "\n");
  process.exit(1);
});

// ─── Exports for Testability ──────────────────────────────
export { getConfig };
