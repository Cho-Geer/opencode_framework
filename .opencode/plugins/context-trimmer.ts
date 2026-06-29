// plugins/context-trimmer.ts — Plugin: 上下文按需加载
// ═══════════════════════════════════════════════════════════════
// Phase 1 (v1.0): MCP tool schema 瘦身（通用，不区分 agent）
//   - tool.definition: 替换所有 MCP tool 的完整 JSON Schema 为一行摘要
//   - 保留 description 为摘要文本，清空 parameters/jsonSchema
//
// 后续版本:
//   - experimental.chat.system.transform: 按 agent 角色过滤 rules
//   - docs_search meta-tool: 替代 index.json 全量注入
//
// 技术依据:
//   - tool.definition hook input = {toolID}, output = {description, parameters, jsonSchema}
//   - 修改 output 即可改变发送给 LLM 的工具定义
//   - 预估收益: 每 agent 减少 20-40K tokens
//
// @version 1.0.0
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { getToolSummary, isCriticalTool } from "../service/context/tool-summaries";

const SRC = "plugin-context-trimmer";

// ── 统计 ──
let _trimmedCount = 0;
let _lastLogTime = 0;
const LOG_INTERVAL = 120_000; // 2 min rate limit

// ── 空 schema（替换完整 JSON Schema）──
const EMPTY_SCHEMA = { type: "object", properties: {} };

// ── MCP 工具前缀（用于区分内置工具和 MCP 工具）──
const MCP_PREFIXES = [
  "compliance_gate_",
  "codegraph_",
  "run_audit",
  "code_quality_check.",
  "resolve-library-id",
  "get-library-docs",
  "browser_",
  "github_",
  "docker_",
  "pandoc_",
  "excel_",
  "query",       // postgre_sql (注意: 也可能匹配内置工具，需额外检查)
  "list_tables", // postgre_sql
];

export default withPluginLifecycle("context-trimmer", {
  "tool.definition": onToolDefinition,
});

// ═══════════════════════════════════════════════════════════════
// tool.definition — MCP 工具 Schema 瘦身
// ═══════════════════════════════════════════════════════════════

async function onToolDefinition(input: any, output: any): Promise<void> {
  const toolID: string = input?.toolID ?? "";
  if (!toolID) return;

  // 只处理 MCP 工具，跳过内置工具（read, edit, bash, glob, grep 等）
  if (!isMcpTool(toolID)) return;

  // 关键工具保留完整 schema
  if (isCriticalTool(toolID)) return;

  // 查找摘要
  const summary = getToolSummary(toolID);
  if (!summary) return; // 无摘要的工具保持原样

  // 替换: description → 摘要, parameters → 空, jsonSchema → 空
  output.description = summary;
  output.parameters = EMPTY_SCHEMA;
  output.jsonSchema = EMPTY_SCHEMA;

  _trimmedCount++;
  maybeLog();
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function isMcpTool(toolID: string): boolean {
  // "query" and "list_tables" are ambiguous — only match exact
  if (toolID === "query" || toolID === "list_tables") return true;
  return MCP_PREFIXES.some(p => p !== "query" && p !== "list_tables" && toolID.startsWith(p));
}

function maybeLog() {
  const now = Date.now();
  if (now - _lastLogTime < LOG_INTERVAL) return;
  _lastLogTime = now;

  writeLog(SRC, "INFO", {
    event: "CONTEXT-TRIMMER-STATS",
    detail: `tools_trimmed=${_trimmedCount}`,
  });
}
