
# ARCHITECT-VERIFICATION-REPORT.md — OpenCode 官方文档验证报告

**验证日期**: 2026-06-01  
**验证者**: @Architect  
**验证范围**: OpenCode 官方文档 vs ARCHITECT-TOOL-GAP-PLAN.md 分析假设  
**官方文档来源**: https://opencode.ai/docs/

---

## 1. 验证目标

验证以下 ARCHITECT-TOOL-GAP-PLAN.md 中的核心假设：

| # | 假设 | 来源 |
|---|------|------|
| H1 | Plugin 工具（通过 `@opencode-ai/plugin` SDK 的 `tool()` 注册）**不会被注入到子 Agent 的 LLM function call schema 中** | ARCHITECT-TOOL-GAP-PLAN.md §问题回顾 |
| H2 | OpenCode 平台**没有**任何配置项可以让 Plugin 工具注入子 Agent | 方案2a/2b 分析 |
| H3 | `scope`、`inject_tools` 等字段**不存在**于当前 OpenCode 配置中 | 方案2d 路径 A/B 提案 |
| H4 | Phase 1 的 `detectPluginToolGaps()` 方案与 OpenCode 设计哲学一致 | Phase 1 实施建议 |

---

## 2. 官方文档搜索结果

### 2.1 搜索来源

| 文档 | URL | 关键章节 |
|------|-----|---------|
| Plugins | https://opencode.ai/docs/plugins/ | Custom tools, tool() API, Events |
| Agents | https://opencode.ai/docs/agents/ | Types, Subagents, Permissions, Task permissions |
| Tools | https://opencode.ai/docs/tools/ | Built-in, Custom tools, MCP servers |
| Permissions | https://opencode.ai/docs/permissions/ | Granular Rules, Available Permissions, Agents |
| Custom Tools | https://opencode.ai/docs/custom-tools/ | Creating a tool, Multiple tools per file, Name collisions |
| Config | https://opencode.ai/docs/config/ | Schema, Agents, Permissions, Plugins |
| SDK | https://opencode.ai/docs/sdk/ | Session API |

### 2.2 关键官方文档原文引用

---

#### 引用 1：Plugin 工具的全局可用性（Plugins 文档）

**来源**: https://opencode.ai/docs/plugins/#custom-tools

> **原文**:
> "Your custom tools will be available to opencode alongside built-in tools."
>
> "If a plugin tool uses the same name as a built-in tool, the plugin tool takes precedence."

**分析**: 文档明确指出 Plugin 工具"will be available to opencode alongside built-in tools"。这里使用的措辞是 "opencode"（整体应用），**未区分** Primary Agent 和 Sub-Agent 上下文。暗示 Plugin 工具应具有与内置工具同等的作用域。

---

#### 引用 2：子 Agent 的工具权限（Agents 文档）

**来源**: https://opencode.ai/docs/agents/#permissions

> **原文**:
> "You can configure permissions to manage what actions an agent can take. Each permission key can be set to: `"ask"` — Prompt for approval before running the tool; `"allow"` — Allow all operations without approval; `"deny"` — Disable the tool."
>
> "Permission keys are matched as wildcard patterns against the underlying tool name, so the same syntax works for built-ins, custom tools, and MCP tools — for example `"mymcp_*": "deny"` denies every tool from an MCP server, and `"mymcp_search": "ask"` targets a single one."

**分析**: 
- 权限系统明确支持 custom tools（Plugin 工具）和 MCP 工具
- "so the same syntax works for built-ins, custom tools, and MCP tools" 表明这三种工具在权限层面是平等对待的
- **但文档未明确说明**：权限 "allow" 了某 Plugin 工具后，该工具是否会被注入到子 Agent 的 function call schema 中

---

#### 引用 3：Agent `permission` 字段的完整 key 清单（Agents 文档）

**来源**: https://opencode.ai/docs/agents/#permissions

> **原文** (Available Permission Keys 表格):

| Key | Tools it gates |
|-----|---------------|
| `read` | `read` |
| `edit` | `write`, `edit`, `apply_patch` |
| `glob` | `glob` |
| `grep` | `grep` |
| `list` | `list` |
| `bash` | `bash` |
| `task` | `task` |
| `external_directory` | Any tool that reads or writes files outside the project worktree |
| `todowrite` | `todowrite`, `todoread` |
| `webfetch` | `webfetch` |
| `websearch` | `websearch` |
| `lsp` | `lsp` |
| `skill` | `skill` |
| `question` | `question` |
| `doom_loop` | Recovery prompts when an agent appears stuck |

**分析**: 
- 权限 key 清单中**没有** `safe_bash`、`safe_edit` 等 Plugin 自定义工具名
- 但文档同时说 "Permission keys are matched as wildcard patterns against the underlying tool name" — 这意味着 `"safe_bash": "allow"` 应该能匹配 Plugin 注册的 `safe_bash` 工具
- 文档中的 key 清单更像是"内置权限类别"而非"所有可能的工具名"

---

#### 引用 4：Custom Tools 与内置工具的优先关系（Custom Tools 文档）

**来源**: https://opencode.ai/docs/custom-tools/#name-collisions-with-built-in-tools

> **原文**:
> "Custom tools are keyed by tool name. If a custom tool uses the same name as a built-in tool, the custom tool takes precedence."
>
> "Prefer unique names unless you intentionally want to replace a built-in tool."

**分析**:
- Custom tools 与内置工具在命名空间中平等
- Plugin 工具覆盖内置工具是官方支持的行为
- 但同样**未区分** Primary Agent 和 Sub-Agent 上下文

---

#### 引用 5：子 Agent 类型和调用方式（Agents 文档）

**来源**: https://opencode.ai/docs/agents/#subagents

> **原文**:
> "Subagents are specialized assistants that primary agents can invoke for specific tasks. You can also manually invoke them by **@ mentioning** them in your messages."
>
> "Subagents can be invoked: **Automatically** by primary agents for specialized tasks based on their descriptions."

**分析**: 子 Agent 是独立会话（sessions.children），工具注入由平台在子会话创建时完成。文档**未说明** Plugin 注册的工具在子会话创建时是否被注入。

---

#### 引用 6：`Task` 工具的权限控制（Agents 文档）

**来源**: https://opencode.ai/docs/agents/#task-permissions

> **原文**:
> "Control which subagents an agent can invoke via the Task tool with `permission.task`. Uses glob patterns for flexible matching."
>
> "When set to `deny`, the subagent is removed from the Task tool description entirely, so the model won't attempt to invoke it."

**分析**: `task` 权限仅控制"哪些子 Agent 可以被调用"，不控制"子 Agent 获得哪些工具"。

---

#### 引用 7：Config Schema 完整字段（Config 文档）

**来源**: https://opencode.ai/docs/config/

**分析**: 遍历 `opencode.ai/config.json` Schema 中所有字段。在 `agent` 配置中，支持的字段有:
- `description`, `temperature`, `steps`, `disable`, `prompt`, `model`, `tools` (deprecated), `permission`, `mode`, `hidden`, `color`, `top_p`, 以及任意 provider-specific additional 字段

**关键结论**: Config Schema 中**不存在**以下字段：
- ❌ `inject_tools` — 不存在
- ❌ `scope` — 不存在（Plugin 层）
- ❌ `force_inject` — 不存在
- ❌ 任何"强制注入工具到子 Agent"的配置项

### 2.3 GitHub Issues 搜索

搜索 `is:issue plugin subagent tool` 在 `anomalyco/opencode` 仓库中，未找到直接相关的 Issue。表明此问题**尚未被社区广泛报告**。

---

## 3. 逐假设验证

### H1: Plugin 工具不会被注入到子 Agent ✅ **确认正确，但可能是 BUG**

| 证据来源 | 证据内容 | 结论 |
|---------|---------|------|
| 官方 Plugins 文档 | "Your custom tools will be available to opencode alongside built-in tools" | 官方设计的**预期行为**是 Plugin 工具应与内置工具同等可用 |
| 官方 Custom Tools 文档 | "If a custom tool uses the same name as a built-in tool, the custom tool takes precedence" | 支持工具覆盖，暗示全局作用域 |
| 实际运行时观察 | Architect 子 Agent 无法调用 `safe_bash`/`write`/`safe_edit` | **实际行为与文档预期不符** |
| CI-CD-Agent dispatch 记录 | Prompt 中的 "Use safe_bash to run git commands" 无法执行 | 证据确凿 |

**修正结论**: ARCHITECT-TOOL-GAP-PLAN.md 中假设"Plugin 工具故意不会被注入到子 Agent"可能是**错误的**。根据官方文档，Plugin 工具**应该**被注入。当前无法注入的现象更有可能是 **OpenCode 平台的 BUG**，而非设计决策。

### H2: 没有配置项可以让 Plugin 工具注入子 Agent ✅ **确认正确**

| 证据来源 | 证据内容 | 结论 |
|---------|---------|------|
| Config 文档 Schema | `agent` 配置中无 `inject_tools` 字段 | 确认 |
| Agents 文档 Permissions | 权限 key 清单中无 `inject` 语义 | 确认 |
| Permissions 文档 | 只有 `allow`/`ask`/`deny` 三种 action | 确认 |

**结论**: 当前 OpenCode 版本**确实没有**任何机制来配置"强制注入 Plugin 工具"。`allow`/`ask`/`deny` 仅影响工具调用时的权限检查，不影响工具是否出现在 LLM 的 function call schema 中。

### H3: `scope`、`inject_tools` 字段不存在 ✅ **确认正确**

Config Schema (`https://opencode.ai/config.json`) 和 Plugin API (`@opencode-ai/plugin`) 中均不存在这些字段。ARCHITECT-TOOL-GAP-PLAN.md 方案2d 中提出的路径 A（`scope: "global"`）和路径 B（`inject_tools`）是**新提案**，需要 OpenCode 平台团队接受并实现。

### H4: Phase 1 检测方案与设计哲学一致 ✅ **确认正确**

| 维度 | 官方文档支持 |
|------|------------|
| 在 prompt 中增加运行时检测步骤 | 文档推荐使用 `instructions` 字段加载规则文件，prompt 注入是标准做法 |
| 使用 dispatch-subagent.js 检测工具缺口 | 官方 Config 允许自定义 `OPENCODE_CONFIG_DIR`，框架层脚本是常见扩展模式 |
| 在 TASK_LOG.md 中记录可用工具 | 文档未规定 TASK_LOG.md（框架自定义），但不冲突 |

---

## 4. 关键发现修正

### 4.1 对 ARCHITECT-TOOL-GAP-PLAN.md 的修正

| 原分析位置 | 原描述 | 修正后描述 |
|-----------|--------|-----------|
| §问题回顾 — 根因简述 | "Plugin 工具**不会被注入**到子 Agent 的 LLM function call schema 中" | "Plugin 工具**当前未被注入**到子 Agent 的 LLM function call schema 中。这与官方文档的预期行为（Plugin 工具应与内置工具同等可用）**不一致**，可能是 OpenCode 平台的 BUG" |
| §方案2d — 路径 A 描述 | "在 `@opencode-ai/plugin` 包中为 `tool()` 增加 `scope` 选项" | 保持不变 — 这是有效的新功能提案。但应**同时向 OpenCode 提 Bug Report**，说明当前行为与文档不符 |
| §Phase 3 — 平台推动 | "准备 PR" | 应**先提 Issue** 确认这是 BUG（当前行为 vs 文档声明），再根据平台团队反馈决定是提 Bug Fix PR 还是 Feature PR |

### 4.2 Phase 优先级调整

基于官方文档验证，Phase 优先级应调整为：

```
Phase 0 (立即 — 今天)                Phase 1 (本周)                 Phase 2 (平台修复后)
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│ 向 OpenCode 提 Bug Report │    │ 方案1: 增强 Step 1a 检测  │    │ 移除临时权限调整           │
│                          │    │ + Phase 2: 临时权限调整   │    │ 恢复 safe_bash: allow     │
│ 描述：Plugin 工具未注入   │    │                          │    │ 移除 detectPluginToolGaps │
│ 子 Agent，违背官方文档    │    │ (平台修复前的缓解措施)    │    │                          │
│                          │    │                          │    │                          │
└──────────────────────────┘    └──────────────────────────┘    └──────────────────────────┘
```

---

## 5. 文档一致性检查

### 5.1 官方文档之间的内部一致性

| 文档 A | 文档 B | 一致性 | 说明 |
|--------|--------|:------:|------|
| Plugins: "tools will be available to opencode" | Agents: Subagents 工具由 permission 控制 | ⚠️ | 未明确说明 Plugin 工具在子 Agent 中的作用域 |
| Permissions: "same syntax works for built-ins, custom tools, and MCP tools" | 实际行为: Plugin 工具未注入子 Agent | ❌ | **行为不一致** — 权限配置了但工具不可用 |
| Custom Tools: "custom tool takes precedence over built-in" | Agents: 子 Agent 的工具配置 | ⚠️ | 文档暗示全局可用，但未涵盖子 Agent 场景 |

### 5.2 框架文档与官方文档的一致性

| 框架文档 | 官方文档 | 一致性 | 说明 |
|---------|---------|:------:|------|
| opencode.json 中 `safe_bash: "allow"` | Permissions: "same syntax for built-ins, custom tools, MCP" | ✅ | 语法正确 |
| dispatch-subagent.js prompt 包装 | Agents: `prompt` 字段 + `instructions` 字段 | ✅ | 符合扩展模式 |
| subagent-preamble.md Step 1a/1b | 无冲突 | ✅ | 框架自定义协议，官方文档无相关规定 |

---

## 6. 最终结论

### 6.1 验证总结

| 假设 | 验证结果 | 置信度 |
|------|:------:|:------:|
| H1: Plugin 工具不被注入子 Agent | ✅ 确认（行为存在），🟡 但官方文档暗示应注入（可能是 BUG） | 高 |
| H2: 无配置项强制注入 | ✅ 确认 | 高 |
| H3: scope/inject_tools 不存在 | ✅ 确认 | 高 |
| H4: Phase 1 方案与设计哲学一致 | ✅ 确认 | 高 |

### 6.2 行动建议

1. **P0 — 向 OpenCode 提 Bug Report**: 当前 Plugin 工具（`safe_bash` 等）未被注入到子 Agent 的 LLM function call schema，与官方 Plugins 文档中 "Your custom tools will be available to opencode alongside built-in tools" 的声明不一致。

2. **P1 — 实施 Phase 1 检测**: 在 `dispatch-subagent.js` 中增加 `detectPluginToolGaps()` 函数，在调度阶段输出警告。考虑到这可能是平台 BUG，警告措辞应反映"可能与平台预期不符"而非"这是预期行为"。

3. **P1 — 实施 Phase 2 临时缓解**: 对 CI-CD-Agent，临时将 `bash` 权限改为有条件 `allow`（依赖 framework-enforcer hook 做安全控制）。

4. **P2 — 跟踪平台修复**: 等待 OpenCode 平台修复后，恢复 `safe_bash` 为主工具，`bash` 恢复为 `deny`。

### 6.3 官方文档引用清单

| # | 引用 | 文档 URL |
|---|------|---------|
| 1 | "Your custom tools will be available to opencode alongside built-in tools" | https://opencode.ai/docs/plugins/#custom-tools |
| 2 | "If a plugin tool uses the same name as a built-in tool, the plugin tool takes precedence" | https://opencode.ai/docs/plugins/#custom-tools |
| 3 | "Permission keys are matched as wildcard patterns against the underlying tool name, so the same syntax works for built-ins, custom tools, and MCP tools" | https://opencode.ai/docs/agents/#permissions |
| 4 | "Subagents are specialized assistants that primary agents can invoke for specific tasks" | https://opencode.ai/docs/agents/#subagents |
| 5 | "Custom tools are keyed by tool name. If a custom tool uses the same name as a built-in tool, the custom tool takes precedence" | https://opencode.ai/docs/custom-tools/#name-collisions-with-built-in-tools |
| 6 | Agent permission keys: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `todowrite`, `webfetch`, `websearch`, `lsp`, `skill`, `question`, `doom_loop` | https://opencode.ai/docs/agents/#permissions |
| 7 | Config Schema reference: `https://opencode.ai/config.json` | https://opencode.ai/docs/config/ |

---

*验证完成时间: 2026-06-01*
*文档版本: v1.0*
