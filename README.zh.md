# opencode_framework

> OpenCode 框架实现 (work-one) — 面向自主软件开发的 Agent 治理基础

本仓库保留 **OpenCode 框架的实现与治理** —— 一个个人项目,
定义了 AI Agent 自运行所需的 Plugin / Skill / Tool / MCP / DB-canonical 各层,
并通过 GitHub Actions 实现自动化 CI 与开发流。

---

## 📌 这是什么?

本仓库是 work-one(框架代号)的**实运行态**。
`AGENTS.md` 是 Agent 会话启动时**自动加载的唯一权威规格文档**,
与 `blueprints/` 和 `docs/design/` 中的设计蓝图区分开来。

| 项目 | 数量 / 位置 |
| --- | --- |
| **Agent** | 5(Orchestrator + 4 native: build/general/plan/explore) |
| **Plugin 入口** | 5(before/after/system-dispatcher + session + tool-def-trimmer) |
| **Plugin Handler** | 43 文件;active 链:before 11 / after 7 / system 2 = 20 |
| **自定义 Tool** | 37(`.opencode/tools/*.ts`) |
| **MCP Server** | 12(`opencode.json` 的 `mcp` 块) |
| **Skill** | 18(`.opencode/skills/{name}/SKILL.md` 自动发现) |
| **代码基线** | CodeGraph 421 文件;active `.opencode` TS 369 文件 / 75,218 行(`rg`,遵守 gitignore) |
| **数据库** | SQLite 单一数据源 `framework-state.db`(schema v37,49 business / 50 total)、权威路径 `.opencode/state/framework-state.db` |

> ℹ️ **设计蓝图 ≠ 实运行态**。历史的「3 层 9 角色」架构
> (Meta-Planner / Architect / Coder-BE / Coder-FE / Guardian / Arbiter / CI-CD-Agent / Super-Admin / Knowledge-Curator)
> 是**设计蓝图**,当前**未注册运行**。仅作为参考保留在 `blueprints/`。

---

## 🏗 目录结构

| 路径 | 角色 |
| --- | --- |
| `.opencode/agents/` | Agent 定义(目前只有 Orchestrator.md) |
| `.opencode/plugins/` | Plugin 入口(5 个文件) |
| `.opencode/plugin-handlers/` | 43 个 handler 文件;20 个 active |
| `.opencode/tools/` | 37 个自定义 tool(safe_* 系列 + Read Attestation) |
| `.opencode/skills/` | 18 个 skill(自动发现) |
| `.opencode/state/` | SQLite 数据 + machine 状态文件 |
| `.opencode/context/` | 设计上下文(详细设计 / 代码规范 / 需求) |
| `.opencode/commands/` | 辅助命令(dispatch / compliance-gate / search-knowledge) |
| `docs/infrastructure/` | 框架深度文档(10 文件,~6,000 行) |
| `docs/design/` | UI / 交互设计规格 |
| `docs/official_docs/` | OpenCode 官方文档镜像 |
| `blueprints/` | 历史设计蓝图(仅参考) |
| `contracts/` | API 契约定义(如 contract.yaml) |
| `.github/workflows/` | 11 个 GitHub Actions(auto-pr / cascade-close / ci / framework-ci / state-sync 等) |
| `AGENTS.md` / `RULES.md` / `MEMORY.md` | 会话通用规则 |

---

## 🔁 典型工作流

```
1. Agent 启动
   → 自动加载 AGENTS.md / RULES.md / MEMORY.md
   → 默认 Orchestrator

2. 任务到达
   → preflight-lite 最小预检(风险分级)
   → 高风险升级到 compliance_gate_check

3. 工具调用
   → before-dispatcher → Handler 链(11 段)→ Tool 执行
   → after-dispatcher → Handler 链(7 段)→ 返回结果

4. CI / 治理
   → GitHub Actions:ci / framework-ci / auto-pr / state-sync
   → state hash(keystone)完整性验证
```

---

## ⚙️ 技术栈

- TypeScript 6.0+
- Bun 1.3.14(包管理器 + 运行时)
- SQLite(框架状态,schema v37)
- MCP SDK 1.29+
- GitHub Actions(11 个 workflow)

---

## 🔗 相关仓库

- [qoderwork](https://github.com/Cho-Geer/qoderwork) — 运营本框架的个人工作区
- [booking_system_refactor](https://github.com/Cho-Geer/booking_system_refactor) — 基于本框架的参考 Booking 系统实现

---

## ⚠️ 注意事项

- 个人 / 实验性项目
- 部分 Windows 测试因 `.opencode/.trash-*` 残留失败;建议干净 clone
- 设计蓝图(`blueprints/`、`docs/design/`)与实运行态(本 README + AGENTS.md)是**不同制品**
- 非生产用途

---

## 📄 许可证

未包含 LICENSE 文件。**仅可阅读**;如需再分发或修改,请先通过 Issue 沟通。

---

## 🇯🇵 日本語 | 🇬🇧 English

- [日本語版](./README.md)
- [English version](./README.en.md)
