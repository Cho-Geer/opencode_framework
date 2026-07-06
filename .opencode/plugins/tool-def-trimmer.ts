// plugins/tool-def-trimmer.ts — MCP tool schema slimming (tool.definition hook)
// Migrated from plugins/context-trimmer.ts (tool.definition portion only)
// This remains as a separate plugin entry because tool.definition is a
// different hook type that cannot be merged into before/after dispatchers.

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { getToolSummary, isCriticalTool } from "../service/context/tool-summaries";

const SRC = "plugin-context-trimmer";

let _trimmedCount = 0;
let _lastLogTime = 0;
const LOG_INTERVAL = 120_000;

const EMPTY_SCHEMA = { type: "object", properties: {} };

const MCP_PREFIXES = [
  "compliance_gate_", "codegraph_", "run_audit",
  "code_quality_check.", "resolve-library-id", "get-library-docs",
  "browser_", "github_", "docker_", "pandoc_", "excel_",
  "query", "list_tables",
];

function isMcpTool(toolID: string): boolean {
  if (toolID === "query" || toolID === "list_tables") return true;
  return MCP_PREFIXES.some(p => p !== "query" && p !== "list_tables" && toolID.startsWith(p));
}

function maybeLog() {
  const now = Date.now();
  if (now - _lastLogTime < LOG_INTERVAL) return;
  _lastLogTime = now;
  writeLog(SRC, "INFO", { event: "CONTEXT-TRIMMER-STATS", detail: `tools_trimmed=${_trimmedCount}` });
}

export default withPluginLifecycle("tool-def-trimmer", {
  "tool.definition": async (input: any, output: any) => {
    const toolID: string = input?.toolID ?? "";
    if (!toolID) return;
    if (!isMcpTool(toolID)) return;
    if (isCriticalTool(toolID)) return;

    const summary = getToolSummary(toolID);
    if (!summary) return;

    output.description = summary;
    output.parameters = EMPTY_SCHEMA;
    output.jsonSchema = EMPTY_SCHEMA;

    _trimmedCount++;
    maybeLog();
  },
});
