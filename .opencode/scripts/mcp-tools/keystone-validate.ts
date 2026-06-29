#!/usr/bin/env bun
"use strict";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import crypto from "node:crypto";

const OPENCODE_ROOT =
  process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", "..", "..");

function readProjectConfig() {
  const configPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "project.config.json",
  );
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (readErr) {
    throw new Error(
      `[keystone-validate] Cannot read or parse project.config.json at ${configPath}: ${readErr.message}`,
    );
  }
  if (!cfg.project_root) {
    throw new Error(
      `[keystone-validate] 'project_root' is not defined in project.config.json (${configPath}). ` +
        'Add "project_root": "<subdirectory>" to the config file.',
    );
  }
  return cfg;
}

function findStateDir() {
  const cfg = readProjectConfig();
  const pr = cfg.project_root;
  const innerRepo = path.resolve(OPENCODE_ROOT, pr);
  const stateDir = path.join(innerRepo, ".opencode", "state");
  if (fs.existsSync(stateDir)) return stateDir;
  return path.join(OPENCODE_ROOT, ".opencode", "state");
}

function runValidate(mode: string) {
  const stateDir = findStateDir();
  const innerRepo = path.resolve(stateDir, "..", "..");
  const script = path.join(
    innerRepo,
    ".opencode",
    "scripts",
    "mcp-tools",
    "keystone-validate.ts",
  );

  if (!fs.existsSync(script)) {
    return {
      overall: "ERROR",
      detail: `keystone-validate.js not found at ${script}`,
    };
  }

  try {
    const out = execSync(`node "${script}" --${mode}`, {
      cwd: innerRepo,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      return JSON.parse(out.trim());
    } catch {
      return { overall: "PASS", detail: out.trim(), raw: true };
    }
  } catch (e: any) {
    const stderr = e.stderr || "";
    try {
      return JSON.parse(stderr);
    } catch {
      return { overall: "FAIL", detail: e.message, stdout: e.stdout };
    }
  }
}

const server = new McpServer(
  { name: "keystone-validate", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.registerTool("keystone_validate", {
  description: "Run Keystone validation checks (contract hash, task lifecycle, TDD, compliance gate)",
  inputSchema: {
    mode: z.enum(["audit", "pre-commit", "ci"]).optional().describe("audit: working tree (default), pre-commit: staged changes, ci: hash-only fast check"),
  },
}, (args) => {
  const mode = args.mode || "audit";
  const result = runValidate(mode);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ──────────────────────────────────────────────
// CLI mode: --hash <file>  (compute keystone hash)
// ──────────────────────────────────────────────
function computeKeystoneHash(filePath: string) {
  const resolvedPath = path.resolve(OPENCODE_ROOT, filePath);
  if (!fs.existsSync(resolvedPath)) {
    process.stderr.write(
      `[keystone-validate] File not found: ${resolvedPath}\n`,
    );
    process.exit(1);
  }
  const lines = fs
    .readFileSync(resolvedPath, "utf8")
    .split("\n");
  // Strip x-keystone-state-hash header line (must be line 0) if present
  const contentLines =
    lines.length > 0 && /^#\s*x-keystone-state-hash:/.test(lines[0])
      ? lines.slice(1)
      : lines;
  const content = contentLines.join("\n");
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  process.stdout.write(`sha256-${hash}\n`);
}

function cliMain() {
  const args = process.argv.slice(2);
  if (args[0] === "--hash" && args[1]) {
    computeKeystoneHash(args[1]);
    return;
  }
  // Default: start MCP server
  /**
   * FW-LOG-UNIFY-P2-A5 (2026-06-12, @Super-Admin): Replaced console.error with
   * process.stderr.write — console.error writes to stdout in some Bun contexts,
   * potentially polluting MCP protocol. process.stderr.write is the safe channel.
   */
  main().catch((err) =>
    process.stderr.write(`[keystone-validate] Fatal error: ${err.message}\n`),
  );
}

// Start (when run directly, not when require()d by tests)
if (import.meta.main) {
  cliMain();
}

// Export internals for testing
export { readProjectConfig };
export { findStateDir };
export { runValidate };
export { computeKeystoneHash };
