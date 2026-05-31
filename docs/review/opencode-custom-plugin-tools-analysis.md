# OpenCode 自定义插件工具（Custom Plugin Tools）用途分析报告

> **生成日期**: 2026-05-29  
> **数据来源**: [OpenCode 官方文档](https://opencode.ai/docs/) + 本项目 `.opencode/` 实际文件分析  
> **项目**: booking-system (Angular 21+ / NestJS 11+ / Prisma 7.x)

---

## 一、官方文档定义的四种扩展机制

### 1. Custom Tools（自定义工具）— `.opencode/tools/`

| 维度 | 说明 |
|------|------|
| **定位** | 创建 **LLM 可直接调用的新函数**，与内置工具（`read`, `write`, `bash` 等）并列工作 |
| **编写方式** | TypeScript / JavaScript 文件，使用 `tool()` helper 和 Zod schema 定义参数类型 |
| **核心能力** | 可调用任意语言脚本（Python、Shell 等）；同名工具会**覆盖**内置工具 |
| **感知上下文** | 可获取 `{ agent, sessionID, messageID, directory, worktree }` 等会话信息 |
| **核心用途** | **扩展 LLM 可执行的操作边界** — 连接数据库、调用外部 API、执行自定义逻辑等 |

### 2. Plugins（插件）— `.opencode/plugins/`

| 维度 | 说明 |
|------|------|
| **定位** | **更强大的扩展** — 可钩入 OpenCode 运行时生命周期的各个阶段 |
| **编写方式** | TypeScript / JavaScript 模块，导出返回 hooks 对象的异步函数 |
| **核心能力** | 拦截/修改工具执行（`tool.execute.before/after`）、注入 shell 环境变量、监听文件变更、会话事件、权限事件、TUI 事件等 |
| **额外能力** | 插件内部**也能注册自定义工具**（`tool` key），可引入 npm 依赖 |
| **核心用途** | **治理与管控** — 属于"元层面"的控制，实施安全策略、框架规则、审计日志等 |

### 3. MCP Servers（MCP 服务器）

| 维度 | 说明 |
|------|------|
| **定位** | 通过 **Model Context Protocol** 接入外部工具服务 |
| **类型** | 本地（local, CLI 方式启动）和远程（remote, HTTP 端点） |
| **认证** | 支持 OAuth 自动认证 / API Key / 无认证 |
| **管理** | 可在全局或**按 Agent** 维度启用/禁用，支持 glob 模式 (`mymcp_*`) |
| **核心用途** | **集成第三方服务** — Sentry 错误监控、Context7 文档查询、GitHub/Grep 等 |

### 4. Agent Skills（Agent 技能）— `.opencode/skills/`

| 维度 | 说明 |
|------|------|
| **定位** | **可复用指令集** — 定义在 `SKILL.md` 文件中，按需加载 |
| **加载方式** | Agent 通过 `skill` 工具按名称主动加载；由 YAML frontmatter 的 `description` 驱动匹配 |
| **核心用途** | **注入领域专有知识和标准化工作流** — 如 TDD 流程、CI/CD 规范、特定技术栈最佳实践 |

---

## 二、本项目中的实际使用全景

### Custom Tools（`.opencode/tools/`）—— 安全执行层

| 工具 | 用途 |
|------|------|
| `safe-edit.js/ts` | **原子化文件编辑** — TOCTOU 防护、自动备份、回滚支持 |
| `safe-bash.js` | **命令白名单执行** — 仅允许审批过的命令运行（`npm run *`, `npx jest *`, `git *` 等） |
| `safe-test.ts` | **测试证据验证** — 校验 `test_report.json` 的结构完整性、RED/GREEN 阶段匹配性 |
| `permission-isolation.ts` | **权限隔离执行** — 按 Agent 身份限制可操作的文件范围 |
| `eslint-plugin-opencode-mock-audit/` | **自定义 ESLint 规则** — 检测假性测试（空断言、skip、.only 残留、TIER1 Mock） |

### Plugins（`.opencode/plugins/`）—— 治理执行层

| 插件 | 用途 |
|------|------|
| `framework-enforcer.ts` (v2.3.2) | **核心治理插件** — 拦截所有工具执行，强制执行：DAG 覆盖率验证、合规门禁状态检查、Agent 写范围执法、TDD 顺序检查、契约哈希验证、三种模式策略（advisory / strict / locked） |

`framework-enforcer` 钩入的运行时事件包括：
- `tool.execute.before` — 每次工具调用前的**前置阻断**（DAG 门、门禁状态、越权写入）
- `tool.execute.after` — 每次工具调用后的**审计记录**
- `shell.env` — 注入框架上下文到 shell 环境
- `file.edited` — 关键框架文件的**防篡改检测**
- `session.*` — 会话创建/空闲/错误/压缩事件的审计
- `permission.*` — 权限请求/回复的审计和越权检测
- `command.executed`、`tui.command.execute` — 命令执行验证

### MCP Servers（外部集成层）

| MCP 服务器 | 用途 |
|------|------|
| `compliance-gate` | **P0 合规门禁** — 任务执行前/后的强制检查-确认-完成三件套 |
| `code-quality-gate` | **代码质量门** — write-time 即时检查 + commit-time 全量扫描 |
| `eslint-audit` | **ESLint 审计** — 检测 mock 违规、空断言、skip 残留等 |
| `keystone-validate` | **基石验证** — 契约哈希 + 任务生命周期证据 + TDD 合规性 |
| `context7` | **技术文档查询** — 获取最新技术栈文档 |
| `github`, `docker`, `postgresql`, `playwright`, `pandoc` | 各领域外部服务集成 |

### Skills（`.opencode/skills/`）—— 工作流层

| 技能 | 用途 |
|------|------|
| `execution-preflight-check` | **P0 前置检查** — 规则合规、MCP 准备、Skill 调用验证 |
| `brainstorming` | 模糊需求 → 结构化设计的澄清流程 |
| `devops-ci-cd-guardrails` | CI/CD 部署可靠性规范 |
| `context7-first` | 强制在编码前查询最新技术文档 |
| `multi-agent-orchestration` | 三层八角色多智能体全生命周期编排 |
| `auto-commit` | TDD 状态感知的交互式提交 |

---

## 三、整体架构关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                      OpenCode 扩展架构                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌───────────┐  提供领域工作流指令                                  │
│   │  Skills   │──────────────────────────────┐                       │
│   │ .opencode │  按需注入到 Agent 上下文中     │                       │
│   │ /skills/  │                              │                       │
│   └───────────┘                              │                       │
│                                              ▼                       │
│   ┌───────────┐  运行时生命周期钩子            ┌─────────────────┐   │
│   │ Plugins   │──拦截/增强每个工具调用────────▶│   Agent 上下文   │   │
│   │ .opencode │  注入治理策略                  │                 │   │
│   │ /plugins/ │                              │  LLM + 工具调用  │   │
│   └───────────┘                              │                 │   │
│                                              └───┬─────┬───────┘   │
│   ┌───────────┐  扩展 LLM 可调用的函数            │     │           │
│   │  Custom   │──安全执行层（safe-* 系列）────────▶│     │           │
│   │  Tools    │  提供增强的内置工具替代            │     │           │
│   │ .opencode │                                  │     │           │
│   │ /tools/   │                                  │     │           │
│   └───────────┘                                  │     │           │
│                                                  ▼     ▼           │
│   ┌───────────┐  外部服务集成                ┌─────────────────┐   │
│   │   MCP     │──数据库/文档/GitHub/Docker───▶│  外部世界        │   │
│   │ Servers   │  Playwright/Pandoc 等        │                 │   │
│   └───────────┘                             └─────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 四、核心结论

| 机制 | 本质目的 | 类比 |
|------|---------|------|
| **Custom Tools** | 给 LLM **新的手和脚** — 做之前做不了的事 | 操作系统新增系统调用 |
| **Plugins** | 给 LLM **套上缰绳** — 对已有的手和脚增加治理约束 | SELinux / AppArmor 安全策略 |
| **MCP Servers** | 给 LLM **连接外部世界** — 接通第三方数据和能力 | API Gateway |
| **Skills** | 给 LLM **灌输专业知识** — 注入标准化操作流程 | SOP 标准操作手册 |

**这四层扩展共同构成 OpenCode 的「可编程 Agent 平台」架构**：
- **Skills** 定义"该做什么"（工作流）
- **MCP** 提供"外部有什么"（数据和服务）
- **Custom Tools** 实现"怎么做"（执行器）
- **Plugins** 确保"做得对"（治理和审计）

---

## 五、官方文档参考链接

| 文档 | 地址 |
|------|------|
| Custom Tools | https://opencode.ai/docs/custom-tools/ |
| Plugins | https://opencode.ai/docs/plugins/ |
| MCP Servers | https://opencode.ai/docs/mcp-servers/ |
| Agent Skills | https://opencode.ai/docs/skills/ |
| Built-in Tools | https://opencode.ai/docs/tools/ |
| SDK | https://opencode.ai/docs/sdk/ |
| 项目 GitHub | https://github.com/anomalyco/opencode |

---

*本报告基于 2026-05-29 的 OpenCode 官方文档和项目 `.opencode/` 实际文件分析生成。*
