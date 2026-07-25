# OpenCode CLI 与 ACP 协议集成报告

**日期**: 2026-06-28
**状态**: ACP 协议验证通过，可进入实装阶段
**OpenCode 版本**: v1.17.11

---

## 1. OpenCode CLI 命令全览

二进制路径：`/home/zhaoge/.opencode/bin/opencode`

### 1.1 核心运行模式

| 命令 | 用途 | 交互方式 |
|------|------|----------|
| `opencode [project]` | 启动 TUI 交互界面（默认模式） | 终端 UI |
| `opencode run [message..]` | 非交互式执行任务 | CLI → 输出结果 |
| `opencode serve` | 启动无头 HTTP 服务器 | HTTP REST API |
| `opencode web` | 启动服务器 + 打开 Web UI | 浏览器 |
| `opencode acp` | 启动 ACP 协议服务器 | stdio JSON-RPC 2.0 |
| `opencode attach <url>` | 连接到运行中的服务器 | CLI |

### 1.2 `opencode run` — 非交互式任务投放

```bash
opencode run --agent <agent-name> "任务描述"
```

关键参数：

| 参数 | 说明 |
|------|------|
| `--agent <name>` | 指定 Agent 角色（如 Super-Admin, Coder-BE） |
| `-m, --model <provider/model>` | 指定模型（如 deepseek/deepseek-v4-pro） |
| `--format <default\|json>` | 输出格式，json 为原始 JSON 事件流 |
| `-f, --file <path>` | 附加文件到消息 |
| `-c, --continue` | 继续上一个 session |
| `-s, --session <id>` | 继续指定 session |
| `--fork` | 分叉 session（配合 -c 或 -s） |
| `--thinking` | 显示思考过程 |
| `--title <text>` | 为 session 指定标题 |
| `--attach <url>` | 连接到已运行的服务器执行 |
| `--dir <path>` | 指定工作目录 |
| `--variant <level>` | 模型变体（reasoning effort: high/max/minimal） |
| `--dangerously-skip-permissions` | 自动批准权限（危险！） |

**适用场景**：一次性任务投放，fire-and-forget，无法观察推理过程。

**示例**：
```bash
# 让 Super-Admin 调查 bug
opencode run --agent Super-Admin "检查 config_read_attest.ts 第49行的大小写 bug"

# 让 Coder-BE 执行代码修改
opencode run --agent Coder-BE --format json "修复 db-manager.ts 中的连接泄漏"

# 继续已有 session
opencode run --continue --agent Guardian "检查刚才的修改是否通过测试"
```

### 1.3 `opencode acp` — ACP 协议服务器

```bash
opencode acp [--cwd <path>] [--port <n>] [--hostname <host>]
```

| 参数 | 说明 |
|------|------|
| `--cwd <path>` | 工作目录 |
| `--port <n>` | 监听端口（默认 0） |
| `--hostname <host>` | 监听地址（默认 127.0.0.1） |
| `--mdns` | 启用 mDNS 服务发现 |
| `--mdns-domain <name>` | 自定义 mDNS 域名（默认 opencode.local） |

**传输方式**：stdio JSON-RPC 2.0（非 HTTP）

**适用场景**：交互式协作，需要观察推理过程、多轮对话、实时反馈。

### 1.4 `opencode serve` — 无头 HTTP 服务器

```bash
opencode serve [--port <n>] [--hostname <host>]
```

REST API 能力有限：GET /api/session（列出会话）、POST /api/session（创建会话）。Chat 端点返回 SPA HTML，不适合作为 REST API 使用。

**替代方案**：使用 `opencode acp` 或 `opencode web`。

### 1.5 辅助命令

| 命令 | 用途 |
|------|------|
| `opencode session list` | 列出所有会话 |
| `opencode session delete <id>` | 删除指定会话 |
| `opencode models [provider]` | 列出可用模型 |
| `opencode stats` | 查看 token 用量和成本统计 |
| `opencode export [sessionID]` | 导出会话数据为 JSON |
| `opencode import <file>` | 导入会话数据 |
| `opencode agent` | 管理 Agent 配置 |
| `opencode plugin <module>` | 安装插件 |
| `opencode mcp` | 管理 MCP 服务器 |
| `opencode debug` | 调试和排错工具 |
| `opencode providers` | 管理 AI 提供商和凭证（别名 auth） |
| `opencode pr <number>` | 拉取 GitHub PR 分支并运行 |
| `opencode upgrade [target]` | 升级 OpenCode |
| `opencode completion` | 生成 shell 自动补全脚本 |

---

## 2. ACP 协议验证结果

### 2.1 完整交互流程

```
Client (QoderWork)                    Server (opencode acp)
    │                                        │
    │── initialize ──────────────────────────>│
    │<── agentCapabilities, agentInfo ───────│
    │                                        │
    │── session/new {agent, cwd} ────────────>│
    │<── sessionId, configOptions, commands ─│
    │<── available_commands_update (notify) ──│
    │                                        │
    │── session/prompt {sessionId, msg} ─────>│
    │<── agent_thought_chunk ×N (流式思考) ──│
    │<── agent_message_chunk ×N (流式输出) ──│
    │<── usage_update (token 消耗) ──────────│
    │<── {stopReason, usage} (最终响应) ─────│
    │                                        │
    │── session/close ───────────────────────>│
    │<── {} ─────────────────────────────────│
```

### 2.2 JSON-RPC 消息格式

**Initialize**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "capabilities": {},
    "clientInfo": { "name": "qoderwork", "version": "1.0" }
  }
}
```

**Session/New**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "agent": "Super-Admin",
    "cwd": "/home/zhaoge/workspace/opencode/work-one",
    "mcpServers": []
  }
}
```

**Session/Prompt**:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "ses_0f2a2e5ecffeRrjv1hfl7xNl65",
    "prompt": [{ "type": "text", "text": "请回答：1+1等于几？" }]
  }
}
```

### 2.3 流式事件类型

| 事件 | sessionUpdate 值 | 内容 |
|------|-----------------|------|
| Agent 思考 | `agent_thought_chunk` | 推理过程，逐 chunk 推送 |
| Agent 输出 | `agent_message_chunk` | 最终回答，逐 chunk 推送 |
| Token 用量 | `usage_update` | `{used, size, cost}` |
| 可用命令 | `available_commands_update` | skill/command 列表 |

### 2.4 测试数据

| 指标 | 值 |
|------|-----|
| 流式通知数 | 86 个 session/update 事件 |
| 思考 token | 83 |
| 输出 token | 2 |
| 输入 token | 113,592（含框架上下文） |
| 会话能力 | close, fork, list, resume |

### 2.5 Agent 能力声明（initialize 返回）

```json
{
  "loadSession": true,
  "mcpCapabilities": { "http": true, "sse": true },
  "promptCapabilities": { "embeddedContext": true, "image": true },
  "sessionCapabilities": { "close": {}, "fork": {}, "list": {}, "resume": {} }
}
```

---

## 3. 两种集成方式对比

| 维度 | `opencode run` | `opencode acp` |
|------|---------------|-----------------|
| 交互模式 | Fire-and-forget | 持久双向 |
| 流式输出 | 无（或 --format json 原始事件） | 有（thought + message 分离） |
| 多轮对话 | 不支持（每次新进程） | 支持（同一 sessionId） |
| 观察推理过程 | 不可能 | 可以（thought_chunk） |
| Token 追踪 | 无 | 有（usage_update） |
| 会话恢复 | 不可能 | 可以（session/resume） |
| 会话分叉 | 不可能 | 可以（session/fork） |
| 进程开销 | 每次启动新进程 | 持久连接，复用 |
| 适用场景 | 一次性任务投放 | 交互式协作、调试 |

---

## 4. QoderWork 两层调度架构

```
QoderWork (外层协调 — 轻量、对话式)
    │
    ├── 简单查询 → 直接 bash
    │   ├── codegraph CLI（query/impact/callers/callees）
    │   ├── bun:sqlite（查询 framework-state.db）
    │   └── 文件读写、grep 等
    │
    ├── 一次性任务 → opencode run --agent <name>
    │   ├── 代码修改、bug 修复
    │   ├── 配置更新
    │   └── 不需要实时观察的执行类任务
    │
    └── 交互式协作 → opencode acp (stdio JSON-RPC)
        ├── 需要观察推理过程的复杂任务
        ├── 多轮对话式调试
        ├── 需要实时反馈的探索性工作
        └── 跨 Agent 协作编排
```

---

## 5. 待解决问题

1. **ACP Server 生命周期管理** — 谁启动/停止 `opencode acp` 进程？QoderWork session 级别还是 task 级别？
2. **权限控制** — ACP session 是否继承 opencode.json 的 permission 配置？
3. **审计日志** — ACP 交互是否自动写入 audit_log 表？
4. **Gate 系统交互** — ACP session 中的 Agent 能否触发 Gate 门禁？
5. **并发** — 多个 ACP session 能否并行（不同 agent）？
6. **错误恢复** — ACP 连接断开后如何 resume？

---

## 6. 测试脚本

`/tmp/acp-test.ts` — bun 脚本，完整实现 initialize → session/new → session/prompt → session/close 流程。

运行方式：
```bash
export PATH='/home/zhaoge/.bun/bin:/home/zhaoge/.opencode/bin:$PATH'
cd /home/zhaoge/workspace/opencode/work-one
bun run /tmp/acp-test.ts
```
