// service/context/tool-summaries.ts
// ═══════════════════════════════════════════════════════════════
// One-line summaries for MCP tools (replaces full JSON Schema in context)
// Maintained manually — keep descriptions under 40 chars when possible.
// ═══════════════════════════════════════════════════════════════

export const TOOL_SUMMARIES: Record<string, string> = {
  // ── compliance-gate (9 tools) ──
  "compliance_gate_check": "门禁合规检查（读取状态，不写入）",
  "compliance_gate_confirm": "确认门禁检查通过",
  "compliance_gate_complete": "完成门禁 session",
  "compliance_gate_submit_deliverables": "提交交付物供审批",
  "compliance_gate_approve_deliverables": "审批交付物",
  "compliance_gate_purge": "清除过期门禁数据",
  "compliance_gate_drain_stale": "排空过期 session",
  "compliance_gate_retry_confirm": "重试门禁确认",
  "compliance_gate_bulk_review_deliverables": "批量审查交付物",

  // ── codegraph (9 tools) ──
  "codegraph_query": "搜索代码符号",
  "codegraph_explore": "分析修改某符号的影响范围",
  "codegraph_callers": "查找调用某符号的所有函数",
  "codegraph_callees": "查找某函数调用的所有函数",
  "codegraph_node": "查看单个符号的源码和调用链",
  "codegraph_files": "查看项目文件结构",
  "codegraph_status": "查看索引状态",
  "codegraph_sync": "增量同步索引",

  // ── eslint-audit (1 tool) ──
  "run_audit": "运行 ESLint 审计",

  // ── code-quality-check (2 tools) ──
  "code_quality_check.run_depcruise_check": "依赖循环检查",
  "code_quality_check.run_full_scan": "全量代码质量扫描",

  // ── context7 (2 tools) ──
  "resolve-library-id": "查询第三方库的 Context7 ID",
  "get-library-docs": "获取第三方库的最新文档",

  // ── playwright (8 tools) ──
  "browser_close": "关闭浏览器",
  "browser_navigate": "导航到 URL",
  "browser_screenshot": "浏览器截图",
  "browser_click": "点击元素",
  "browser_type": "输入文本",
  "browser_select_option": "选择下拉选项",
  "browser_hover": "悬停在元素上",
  "browser_evaluate": "执行 JavaScript",

  // ── github (15 tools) ──
  "github_search_repositories": "搜索 GitHub 仓库",
  "github_search_code": "搜索 GitHub 代码",
  "github_search_issues": "搜索 GitHub Issues",
  "github_get_issue": "获取 Issue 详情",
  "github_create_issue": "创建 Issue",
  "github_list_issues": "列出 Issues",
  "github_get_pull_request": "获取 PR 详情",
  "github_list_pull_requests": "列出 PRs",
  "github_create_pull_request": "创建 PR",
  "github_get_file_contents": "获取仓库文件内容",
  "github_create_or_update_file": "创建或更新文件",
  "github_list_commits": "列出 Commits",
  "github_get_branch": "获取分支信息",
  "github_list_branches": "列出分支",
  "github_fork_repository": "Fork 仓库",

  // ── postgre_sql (2 tools) ──
  "query": "执行 SQL 查询",
  "list_tables": "列出数据库表",

  // ── docker (5 tools) ──
  "docker_list_containers": "列出容器",
  "docker_inspect_container": "检查容器详情",
  "docker_list_images": "列出镜像",
  "docker_exec_container": "在容器中执行命令",
  "docker_logs": "查看容器日志",

  // ── pandoc (3 tools) ──
  "pandoc_convert": "文档格式转换",
  "pandoc_list_formats": "列出支持的格式",
  "pandoc_get_template": "获取转换模板",

  // ── excel (5 tools) ──
  "excel_describe_sheets": "列出工作表",
  "excel_read_sheet": "读取工作表数据",
  "excel_write_to_sheet": "写入工作表",
  "excel_create_table": "创建表格",
  "excel_format_range": "格式化单元格",
};

// ── Tools that MUST keep full schema (critical for all agents) ──
export const CRITICAL_TOOLS = new Set<string>([
  // No tools are critical enough to warrant full schema.
  // Add tool names here if agents frequently misuse them with summary-only.
]);

// ── Helper: get summary for a tool ──
export function getToolSummary(toolName: string): string | undefined {
  return TOOL_SUMMARIES[toolName];
}

// ── Helper: check if tool should keep full schema ──
export function isCriticalTool(toolName: string): boolean {
  return CRITICAL_TOOLS.has(toolName);
}
