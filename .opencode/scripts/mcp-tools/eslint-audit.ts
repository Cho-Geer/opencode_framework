#!/usr/bin/env bun
"use strict";

/**
 * MCP Tool: eslint-audit (Thin Shell — B-4C)
 *
 * Exposes tool `run_audit` that:
 * 1. Reads contract.yaml x-eslint-policy → generates tier-rules.json
 * 2. Runs ESLint with opencode-mock-audit plugin on target files
 * 3. Updates machine.json.eslint_state with results
 *
 * All business logic delegated to service/file-guard/eslint-runner.ts
 *
 * Called by:
 *   - compliance_gate_complete (Layer B: mandatory, full scan)
 *   - @Coder agents after write/edit (Layer A: advisory, file scan)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Service Layer ──────────────────────────────────────────
import { getProjectRoot,
  generateTierRules,
  runESLint,
  extractModule,
  updateEslintState, } from "../../service/file-guard/eslint-runner";

// ─── MCP Server ─────────────────────────────────────────────
const server = new McpServer(
  { name: "eslint-audit", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.registerTool("run_audit", {
  description: "Run ESLint mock-audit on changed files or full project. Updates machine.json.eslint_state.",
  inputSchema: {
    changed_file: z.string().optional().describe("Single changed file path (Layer A). Optional; omit for full scan."),
    full_scan: z.boolean().optional().describe("Scan all spec files (Layer B: compliance_gate_complete)"),
    scan_business_code: z.boolean().optional().describe("Also scan business code (service/controller/dto)"),
    waivers: z.array(z.string()).optional().describe("Optional waiver IDs"),
  },
}, (args) => {
  const projectRoot = getProjectRoot();
  const tierRules = generateTierRules(projectRoot);

  const targetFiles: string[] = [];
  if (args.changed_file && !args.full_scan) targetFiles.push(args.changed_file);

  const result = runESLint(projectRoot, targetFiles, args.scan_business_code || args.full_scan);
  const moduleName = args.changed_file ? extractModule(args.changed_file) : "all_modules";
  const stateUpdate = updateEslintState(
    args.full_scan ? "all_modules" : moduleName,
    result.violations || [],
    args.waivers || [],
    undefined,
  );

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        status: result.violations?.length > 0 ? "fail" : "pass",
        module: moduleName,
        violations: result.violations || [],
        violations_count: result.violations?.length || 0,
        eslint_exit_code: result.exitCode,
        tier_rules_generated: { tier1_count: tierRules.tier1.length, tier2_count: tierRules.tier2.length, tier3_count: tierRules.tier3.length },
        machine_json_updated: stateUpdate.updated,
        state_status: stateUpdate.status || "unknown",
      }, null, 2),
    }],
  };
});

// ─── Server Lifecycle ───────────────────────────────────────
let _activeTransport = null;
async function main() {
  const transport = new StdioServerTransport();
  _activeTransport = transport;
  await server.connect(transport);
  process.stderr.write("[eslint-audit] started (McpServer)\n");
}

process.on("SIGINT", async () => {
  try {
    process.stderr.write("[eslint-audit] SIGINT — shutting down\n");
    if (_activeTransport) { try { await (_activeTransport as any).close(); } catch {} }
    try { await server.close(); } catch {}
  } catch {}
  process.exit(0);
});

main().catch((err) => { process.stderr.write(`[eslint-audit] Fatal error: ${err.message}\n`); process.exit(1); });

  export { getProjectRoot };
export { generateTierRules };
export { runESLint };
