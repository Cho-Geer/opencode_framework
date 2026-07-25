# OpenCode SSE 事件完整参考

> 来源：OpenCode 官方源码 (github.com/sst/opencode, packages/schema/src/)
> 整理日期：2026-07-02

---

## SSE 端点

| 端点 | Schema | 说明 |
|------|--------|------|
| `GET /event` | Event | 实例级事件流 |
| `GET /global/event` | GlobalEvent | 全局事件流 |
| `GET /api/event` | V2Event | V2 事件流 |

---

## 一、Session V1 事件（经典事件）

来源：`packages/schema/src/v1/session.ts`

### 1. session.created
- **说明**：会话创建
- **字段**：sessionID, info

### 2. session.updated
- **说明**：会话更新
- **字段**：sessionID, info

### 3. session.deleted
- **说明**：会话删除
- **字段**：sessionID, info

### 4. message.updated
- **说明**：消息更新
- **字段**：sessionID, info

### 5. message.removed
- **说明**：消息移除
- **字段**：sessionID, messageID

### 6. message.part.updated
- **说明**：消息部件更新
- **字段**：sessionID, part, time

### 7. message.part.removed
- **说明**：消息部件移除
- **字段**：sessionID, messageID, partID

### 8. message.part.delta
- **说明**：消息部件增量
- **字段**：sessionID, messageID, partID, field, delta

### 9. session.diff
- **说明**：会话 diff 变更
- **字段**：sessionID, diff

### 10. session.error
- **说明**：会话错误
- **字段**：sessionID (optional), error

---

## 二、Session Next 事件（细粒度流式事件）

来源：`packages/schema/src/session-event.ts`

### 控制/状态类

#### session.next.agent.switched
- **说明**：Agent 切换
- **字段**：timestamp, sessionID, messageID, agent

#### session.next.model.switched
- **说明**：Model 切换
- **字段**：timestamp, sessionID, messageID, model

#### session.next.moved
- **说明**：工作目录变更
- **字段**：timestamp, sessionID, location, subdirectory

#### session.next.prompted
- **说明**：收到用户提示
- **字段**：timestamp, sessionID, messageID, prompt, delivery

#### session.next.prompt.admitted
- **说明**：提示被准入
- **字段**：timestamp, sessionID, messageID, prompt, delivery

#### session.next.context.updated
- **说明**：上下文更新
- **字段**：timestamp, sessionID, messageID, text

#### session.next.synthetic
- **说明**：合成消息
- **字段**：timestamp, sessionID, messageID, text

#### session.next.retried
- **说明**：重试
- **字段**：timestamp, sessionID, attempt, error

### Shell 执行

#### session.next.shell.started
- **说明**：Shell 命令开始
- **字段**：timestamp, sessionID, messageID, callID, command

#### session.next.shell.ended
- **说明**：Shell 命令结束
- **字段**：timestamp, sessionID, callID, output

### Step（LLM 步骤）

#### session.next.step.started
- **说明**：步骤开始
- **字段**：timestamp, sessionID, assistantMessageID, agent, model, snapshot

#### session.next.step.ended
- **说明**：步骤结束
- **字段**：timestamp, sessionID, assistantMessageID, finish, cost, tokens (input, output, reasoning, cache), snapshot, files

#### session.next.step.failed
- **说明**：步骤失败
- **字段**：timestamp, sessionID, assistantMessageID, error

### 文本流

#### session.next.text.started
- **说明**：文本输出开始
- **字段**：timestamp, sessionID, assistantMessageID, textID

#### session.next.text.delta
- **说明**：文本增量
- **字段**：timestamp, sessionID, assistantMessageID, textID, delta

#### session.next.text.ended
- **说明**：文本输出结束
- **字段**：timestamp, sessionID, assistantMessageID, textID, text

### Reasoning（推理）

#### session.next.reasoning.started
- **说明**：推理开始
- **字段**：timestamp, sessionID, assistantMessageID, reasoningID, providerMetadata

#### session.next.reasoning.delta
- **说明**：推理增量
- **字段**：timestamp, sessionID, assistantMessageID, reasoningID, delta

#### session.next.reasoning.ended
- **说明**：推理结束
- **字段**：timestamp, sessionID, assistantMessageID, reasoningID, text, providerMetadata

### Tool（工具调用）

#### session.next.tool.input.started
- **说明**：工具输入开始
- **字段**：timestamp, sessionID, assistantMessageID, callID, name

#### session.next.tool.input.delta
- **说明**：工具输入增量
- **字段**：timestamp, sessionID, assistantMessageID, callID, delta

#### session.next.tool.input.ended
- **说明**：工具输入结束
- **字段**：timestamp, sessionID, assistantMessageID, callID, text

#### session.next.tool.called
- **说明**：工具被调用
- **字段**：timestamp, sessionID, assistantMessageID, callID, tool, input, provider

#### session.next.tool.progress
- **说明**：工具执行进度
- **字段**：timestamp, sessionID, assistantMessageID, callID, structured, content

#### session.next.tool.success
- **说明**：工具成功
- **字段**：timestamp, sessionID, assistantMessageID, callID, structured, content, outputPaths, result, provider

#### session.next.tool.failed
- **说明**：工具失败
- **字段**：timestamp, sessionID, assistantMessageID, callID, error, result, provider

### Compaction（压缩）

#### session.next.compaction.started
- **说明**：压缩开始
- **字段**：timestamp, sessionID, messageID, reason

#### session.next.compaction.delta
- **说明**：压缩增量
- **字段**：timestamp, sessionID, messageID, text

#### session.next.compaction.ended
- **说明**：压缩结束
- **字段**：timestamp, sessionID, messageID, reason, text, recent

### Revert（回退）

#### session.next.revert.staged
- **说明**：回退暂存
- **字段**：timestamp, sessionID, revert

#### session.next.revert.cleared
- **说明**：回退清除
- **字段**：timestamp, sessionID

#### session.next.revert.committed
- **说明**：回退提交
- **字段**：timestamp, sessionID, messageID

---

## 三、Session 状态事件

来源：`packages/schema/src/session-status-event.ts`、`session-compaction-event.ts`

### session.status
- **说明**：会话状态变更
- **字段**：sessionID, status (idle | busy | retry)
- **retry 子字段**：attempt, message, action (reason, provider, title, message, label, link?), next

### session.idle（已废弃）
- **说明**：会话空闲
- **字段**：sessionID

### session.compacted
- **说明**：会话已压缩
- **字段**：sessionID

---


## 四、Server 事件

来源：`packages/schema/src/server-event.ts`

### server.connected
- **说明**：服务器连接
- **字段**：(空)

### global.disposed
- **说明**：全局销毁
- **字段**：(空)

### server.instance.disposed
- **说明**：实例销毁
- **字段**：id, directory

### server.heartbeat
- **说明**：服务器心跳（定期发送，保持 SSE 连接活跃）
- **字段**：(空)
- **发现**：v1.17.13 实测，未在官方 schema 中记录

---

## 五、Workspace 事件

来源：`packages/schema/src/workspace-event.ts`

### workspace.ready
- **说明**：工作区就绪
- **字段**：name

### workspace.failed
- **说明**：工作区失败
- **字段**：message

### workspace.status
- **说明**：工作区状态
- **字段**：workspaceID, status (connected | connecting | disconnected | error)

---

## 六、MCP 事件

来源：`packages/schema/src/mcp-event.ts`

### mcp.tools.changed
- **说明**：MCP 工具变更
- **字段**：server

### mcp.browser.open.failed
- **说明**：浏览器打开失败
- **字段**：mcpName, url

---

## 七、LSP 事件

来源：`packages/schema/src/lsp-event.ts`

### lsp.updated
- **说明**：语言服务更新
- **字段**：(空)

---

## 八、VCS 事件

来源：`packages/schema/src/vcs-event.ts`

### vcs.branch.updated
- **说明**：分支变更
- **字段**：branch (optional)

---

## 九、Worktree 事件

来源：`packages/schema/src/worktree-event.ts`

### worktree.ready
- **说明**：工作树就绪
- **字段**：name, branch (optional)

### worktree.failed
- **说明**：工作树失败
- **字段**：message

---

## 十、Legacy 事件

来源：`packages/schema/src/v1/legacy-event.ts`

### command.executed
- **说明**：命令执行
- **字段**：name, sessionID, arguments, messageID

---

## 统计

| 分类 | 数量 |
|------|------|
| Session V1 经典事件 | 10 |
| Session Next 流式事件 | 32 |
| Session 状态事件 | 3 |
| Server 事件 | 4 |
| Workspace 事件 | 3 |
| MCP 事件 | 2 |
| LSP 事件 | 1 |
| VCS 事件 | 1 |
| Worktree 事件 | 2 |
| Legacy 事件 | 1 |
| **总计** | **59** |
