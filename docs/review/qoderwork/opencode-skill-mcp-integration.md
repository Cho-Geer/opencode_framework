## OpenCode 框架 Skill 与 MCP 整合机制

**日期**: 2026-06-27
**范围**: `.opencode/` 框架源码 + `opencode.json` 配置

---

### 一、Skill 整合机制

#### 1.1 目录结构

```
.opencode/skills/<skill-name>/SKILL.md
```

- 每个 skill 是一个独立目录
- 目录名即 skill 标识符，必须匹配正则 `^[a-z0-9]+(-[a-z0-9]+)*$`（小写字母、数字、连字符）
- 核心文件为 `SKILL.md`，包含 YAML frontmatter + Markdown 内容

#### 1.2 SKILL.md 格式

```yaml
---
name: "context7-first"           # 必填，与目录名一致
description: "Forces the model to use the UC7KS knowledge acquisition pipeline..."
                                  # 必填，≤1024 字符，描述触发条件和用途
---

# Skill 标题

## 触发条件
描述何时应该激活此 skill

## 执行流程
详细的步骤指南

## 输出规范
期望的输出格式
```

#### 1.3 Agent 引用方式

在 `.opencode/agents/<AgentName>.md` 的 YAML frontmatter 中声明：

```yaml
---
name: Knowledge-Curator
mode: subagent
skills:
  - execution-preflight-check
  - context7-first
  - spreadsheet-processor
mcp_tools:
  - context7_resolve-library-id
  - context7_query-docs
  - webfetch
permission:
  skill: allow
---
```

#### 1.4 权限控制

| 配置值 | 行为 |
|--------|------|
| `skill: allow` | Agent 可自由调用 skill |
| `skill: deny` | 禁止 Agent 调用 skill |
| `skill: ask` | 每次调用需用户确认 |

#### 1.5 当前框架中的 Skills（20 个）

| Skill 名称 | 用途 | 触发场景 |
|------------|------|---------|
| `context7-first` | 强制 UC7KS 知识获取流程 | 任何涉及技术栈的任务 |
| `execution-preflight-check` | 任务执行前检查清单 | 所有任务开始前 |
| `playwright-mcp-expert` | Playwright E2E 测试专家 | 前端 E2E 测试 |
| `devops-ci-cd-guardrails` | CI/CD 护栏 | 部署和流水线操作 |
| `prisma-seed-cicd` | Prisma 种子数据 CI/CD | 数据库种子脚本 |
| `sqlite-bloat-investigation` | SQLite 膨胀调查 | 数据库异常膨胀 |
| `multi-agent-orchestration` | 多 Agent 编排 | 复杂任务分发 |
| `skill-creator` | Skill 创建器 | 添加新 skill |
| `brainstorming` | 头脑风暴 | 创意和方案设计 |
| `auto-commit` | 自动提交 | Git 提交操作 |
| `spreadsheet-processor` | 电子表格处理 | Excel/CSV 操作 |
| `salesforce-dx-expert` | Salesforce DX 专家 | Salesforce 开发 |
| `nextjs-router-guardrails` | Next.js 路由护栏 | Next.js 路由开发 |
| `learning-mode-executor` | 学习模式执行器 | 教学场景 |
| `new-asset-integrator` | 新资产集成 | 引入新依赖 |
| `fullstack-ci-cd-guardrails` | 全栈 CI/CD 护栏 | 前后端部署 |
| `global-cicd-practices-enforcement` | 全局 CI/CD 实践执行 | 规范化流水线 |
| `cross-directory-ci` | 跨目录 CI | 多项目 CI |
| `cicd-database-seeding` | CI/CD 数据库种子 | 测试数据准备 |
| `devops-architect` | DevOps 架构师 | 基础设施设计 |

#### 1.6 添加新 Skill 的步骤

1. **创建目录**: `.opencode/skills/<new-skill-name>/`
2. **编写 SKILL.md**:
   - YAML frontmatter: `name` + `description`
   - Markdown 正文: 触发条件、执行流程、输出规范
3. **在 Agent 中引用**: 编辑 `.opencode/agents/<AgentName>.md`，在 `skills:` 列表中添加新 skill 名称
4. **（可选）注册到合规清单**: 更新 `.opencode/rules/rule_detail/skill-invocation-standard.md`

---

### 二、MCP 整合机制

#### 2.1 配置位置

`opencode.json` 的 `"mcp"` 字段：

```json
{
  "mcp": {
    "<server-name>": {
      "type": "local",
      "command": ["<runtime>", "<script-path-or-package>"],
      "environment": { "KEY": "value" },
      "timeout": 60000,
      "enabled": true
    }
  }
}
```

#### 2.2 当前框架中的 MCP Servers（11 个）

| Server | 运行时 | 启动命令 | 提供的工具 |
|--------|--------|---------|-----------|
| **compliance-gate** | Bun (TypeScript) | `bun ./.opencode/scripts/mcp-tools/compliance-gate.ts` | compliance_gate_check, compliance_gate_arm, compliance_gate_deliver, compliance_gate_approve, compliance_gate_complete |
| **eslint-audit** | Bun (TypeScript) | `bun ./.opencode/scripts/mcp-tools/eslint-audit.ts` | eslint_audit_run |
| **code-quality-check** | Bun (TypeScript) | `bun ./.opencode/scripts/mcp-tools/code-quality-check.ts` | code_quality_gate |
| **context7** | Node.js (npm) | `npx -y @upstash/context7-mcp@latest` | context7_resolve-library-id, context7_query-docs |
| **playwright** | Node.js (npm) | `npx @playwright/mcp@latest` | browser_navigate, browser_click, browser_type, browser_screenshot 等 |
| **github** | Node.js (npm) | `npx -y @modelcontextprotocol/server-github` | github_create_issue, github_list_repos 等 |
| **postgre_sql** | Node.js (npm) | `npx -y @modelcontextprotocol/server-postgres` | query |
| **docker** | Python (uvx) | `uvx mcp-server-docker` | docker_list_containers, docker_run, docker_build 等 9 个工具 |
| **pandoc** | Python (uvx) | `uvx mcp-pandoc` | pandoc_convert |
| **excel** | Node.js (npm) | `npx --yes @negokaz/excel-mcp-server` | excel_read_sheet, excel_write_sheet 等 |

#### 2.3 自定义 MCP Server 开发模式

框架自身的 `compliance-gate.ts` 是 TypeScript MCP Server 的规范实现（1,881 行）：

```typescript
#!/usr/bin/env bun
"use strict";

// ── SDK 导入（CommonJS 风格，Bun 原生支持） ──
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

// ── 框架库导入 ──
const { writeLog } = require("../../lib/log-manager");
const { gateCheck, gateConfirm } = require("../../lib/gate-core");

// ── 创建 Server 实例 ──
const server = new Server(
  { name: "my-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── 注册工具列表 ──
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "my_tool",
      description: "工具描述",
      inputSchema: {
        type: "object",
        properties: {
          param1: { type: "string", description: "参数说明" },
          param2: { type: "number", description: "参数说明" }
        },
        required: ["param1"]
      }
    }
  ]
}));

// ── 处理工具调用 ──
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case "my_tool":
      const result = await handleMyTool(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ── 启动 ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[my-mcp-server] started\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
```

#### 2.4 Agent 引用 MCP 工具

在 `.opencode/agents/<AgentName>.md` 的 frontmatter 中声明：

```yaml
mcp_tools:
  - compliance_gate_check
  - compliance_gate_arm
  - context7_resolve-library-id
  - docker_list_containers
```

#### 2.5 权限控制

在 `opencode.json` 的 agent permission 中配置：

```json
{
  "agent": {
    "Coder-BE": {
      "permission": {
        "compliance_gate_check": "allow",
        "docker_run": "deny",
        "github_create_issue": "ask"
      }
    }
  }
}
```

#### 2.6 添加新 MCP Server 的步骤

1. **创建 TypeScript 文件**: `.opencode/scripts/mcp-tools/<server-name>.ts`
2. **实现 MCP 协议**:
   - 导入 `@modelcontextprotocol/sdk`
   - 创建 Server 实例
   - 实现 `ListToolsRequestSchema` handler（声明工具列表）
   - 实现 `CallToolRequestSchema` handler（处理工具调用）
3. **注册到 opencode.json**:
   ```json
   {
     "mcp": {
       "<server-name>": {
         "type": "local",
         "command": ["bun", "./.opencode/scripts/mcp-tools/<server-name>.ts"],
         "timeout": 60000,
         "enabled": true
       }
     }
   }
   ```
4. **在 Agent 中引用**: 编辑 `.opencode/agents/<AgentName>.md`，在 `mcp_tools:` 列表中添加工具名
5. **配置权限**: 在 `opencode.json` 的 agent permission 中添加 `"my_tool": "allow"`

---

### 三、Skill vs MCP 对比

| 维度 | Skill | MCP |
|------|-------|-----|
| **本质** | 提示词模板 / 工作流指南 | 可执行的工具服务进程 |
| **格式** | Markdown (SKILL.md) | TypeScript / Python / JavaScript 代码 |
| **执行方式** | LLM 读取后遵循指南 | 运行时进程，通过 stdio JSON-RPC 通信 |
| **用途** | 规范行为流程（"怎么做"） | 提供外部能力（"做什么"） |
| **状态** | 无状态（纯文本） | 可有状态（进程内内存、数据库连接等） |
| **生命周期** | 按需加载到 LLM 上下文 | 随 OpenCode 启动，持续运行 |
| **典型场景** | "先查文档再编码"、"执行前检查"、"TDD 流程" | 查数据库、控制浏览器、调用外部 API、文件转换 |
| **开发成本** | 低（写 Markdown） | 中-高（写代码 + 实现 MCP 协议） |
| **运行时开销** | 无（仅消耗 LLM context window） | 有（独立进程，内存 + CPU） |

---

### 四、整合架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenCode Agent                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Agent Definition (.opencode/agents/<Name>.md)              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │ skills:      │  │ mcp_tools:   │  │ permission:      │  │   │
│  │  │  - skill-a   │  │  - tool_x    │  │  skill: allow    │  │   │
│  │  │  - skill-b   │  │  - tool_y    │  │  tool_x: allow   │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │   │
│  └─────────┼──────────────────┼────────────────────────────────┘   │
│            │                  │                                     │
│            ▼                  ▼                                     │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐    │
│  │  Skill Loader   │  │  MCP Client                          │    │
│  │  (skill tool)   │  │  (stdio JSON-RPC)                    │    │
│  └────────┬────────┘  └──────────────┬───────────────────────┘    │
│           │                          │                             │
└───────────┼──────────────────────────┼─────────────────────────────┘
            │                          │
            ▼                          ▼
┌───────────────────────┐  ┌─────────────────────────────────────────┐
│  .opencode/skills/    │  │  MCP Servers (独立进程)                  │
│  ┌─────────────────┐  │  │  ┌─────────────┐  ┌─────────────────┐  │
│  │ skill-a/        │  │  │  │compliance-  │  │ context7        │  │
│  │   SKILL.md      │  │  │  │gate (Bun)   │  │ (Node.js/npm)   │  │
│  └─────────────────┘  │  │  └─────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  │  │  ┌─────────────┐  ┌─────────────────┐  │
│  │ skill-b/        │  │  │  │ docker      │  │ playwright      │  │
│  │   SKILL.md      │  │  │  │ (Python/uvx)│  │ (Node.js/npm)   │  │
│  └─────────────────┘  │  │  └─────────────┘  └─────────────────┘  │
│                       │  │                                         │
│  纯文本，加载到 LLM   │  │  独立进程，通过 stdio 通信               │
│  上下文作为指令       │  │  提供可执行的工具能力                     │
└───────────────────────┘  └─────────────────────────────────────────┘
```

---

### 五、关键文件索引

| 文件/目录 | 用途 |
|----------|------|
| `.opencode/skills/*/SKILL.md` | Skill 定义文件 |
| `.opencode/agents/*.md` | Agent 定义（引用 skills 和 mcp_tools） |
| `opencode.json` → `"mcp"` | MCP Server 注册和配置 |
| `opencode.json` → `"agent"` → `"permission"` | 工具权限控制 |
| `.opencode/scripts/mcp-tools/*.ts` | 自定义 MCP Server 源码 |
| `.opencode/rules/skill-compliance-guide.md` | Skill 调用合规指南 |
| `.opencode/rules/mcp-compliance-guide.md` | MCP 调用合规指南 |
