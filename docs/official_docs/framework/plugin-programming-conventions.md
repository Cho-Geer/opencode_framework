# OpenCode 插件编程规范与约束

**日期**: 2026-06-10  
**来源**: Context7 搜索 OpenCode 官方文档 + GitHub 源码分析 + 实战验证  
**关联文件**: `opencode-plugin-loading-bun-cache.md`, `plugin-debugging-precautions.md`

---

## 1. 插件文件组织

### 1.1 目录结构

```
.opencode/plugins/          ← 项目级插件，启动时自动扫描所有 *.ts, *.js
.opencode/lib/              ← 共享代码库，不在插件扫描路径内
~/.config/opencode/plugins/ ← 全局插件
```

### 1.2 多插件共存

**可以。** 多个 `.ts` 文件放在 `.opencode/plugins/` 下全部自动发现并加载。

| 特性 | 说明 |
|------|------|
| 自动发现 | `.opencode/plugins/*.ts` 全部加载 |
| 显式配置 | `opencode.json` → `"plugin": ["./a.ts", "./b.ts"]` |
| Hook 链式调用 | 多插件注册同一 hook → 全部依次执行，不覆盖 |
| 加载失败隔离 | 一个插件失败 → 回滚该插件注册，其他继续加载 |
| 重试 | 文件插件加载失败自动重试一次 |
| 加载顺序 | 全局配置 → 项目配置 → 全局插件目录 → 项目插件目录 |

---

## 2. 插件编写规范

### 2.1 导出格式

**必须使用 `export default`**。OpenCode 官方源码中所有示例均为默认导出。

```typescript
export default (async ({ client, project, directory, $ }) => {
  return {
    "tool.execute.before": async (input, output) => { },
    "tool.execute.after": async (input, output) => { },
    "chat.message": async (input, output) => { },
  };
}) as any;
```

**禁止 `export const` + 返回 hooks**（实战验证：静默失败）。

### 2.2 上下文参数

插件函数接收的上下文对象（类型定义自 `@opencode-ai/plugin`）：

```typescript
{
  client: OpenCode SDK Client,
  project: ProjectInfo,
  directory: string,     // 当前工作目录
  $: Bun Shell API,
}
```

### 2.3 可用 Hook 事件（完整列表）

**Tool Events**: `tool.execute.before`, `tool.execute.after`  
**Message Events**: `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`  
**Chat Events**: `chat.message` (源码中存在，文档未列出但可用)  
**Session Events**: `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`  
**File Events**: `file.edited`, `file.watcher.updated`  
**Shell Events**: `shell.env`  
**Command Events**: `command.executed`  
**Permission Events**: `permission.asked`, `permission.replied`  
**TUI Events**: `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`

---

## 3. 关键约束（实战验证）

### 3.1 Hook 函数必须在同一模块定义

```typescript
// ❌ 错误：import 的函数引用放入 return
import { myHook } from "./lib";
export default (async (ctx) => {
  return { "tool.execute.before": myHook };  // 静默失败
});

// ✅ 正确：本地定义
async function myHook(input, output) {
  // 可以在函数体内调用 import 的函数
  someImportedFunction(input);
}
export default (async (ctx) => {
  return { "tool.execute.before": myHook };
});
```

### 3.2 共享代码放 `.opencode/lib/`

插件可以 import `../lib/` 下的模块。这些模块不在插件扫描路径内，不会被当成插件加载。

```typescript
import { helperFunction } from "../lib/my-utils";
```

### 3.3 避免 `require()` 调用

在 ESM 插件文件中，`require` 不可用。使用 `import` 语法。

### 3.4 Hook 函数签名

```typescript
"tool.execute.before": (input: { tool, sessionID, callID }, output: { args }) => Promise<void>
"tool.execute.after": (input: { tool, sessionID, callID, args }, output: any) => Promise<void>
"chat.message": (input: { sessionID, agent?, model?, messageID?, variant? }, output: { message, parts }) => Promise<void>
```

### 3.5 模块级代码与函数体代码

| 位置 | 何时执行 | 用途 |
|------|---------|------|
| 模块顶层 | import 时 | 初始化、常量定义 |
| `export default` 函数体 | OpenCode 调用插件入口时 | 返回 hooks 对象 |
| hook 函数体 | 事件触发时 | 业务逻辑 |

---

## 4. Hook 分派机制

```typescript
// packages/core/src/plugin.ts — triggerFor
for (const item of hooks) {
  if (id !== ID.make("*") && item.id !== id) continue
  const match = item.hooks[name]
  if (!match) continue
  yield* match(event as any).pipe(...)
}
```

所有匹配的插件 hooks **链式调用**，不同 ID 的插件都会触发。两个插件注册同一 hook → 两个都执行（按加载顺序）。

---

## 5. opencode.json 配置方式

```json
{
  "plugin": [
    "npm-package-name",           // npm 包
    "npm-package@1.2.3",          // npm 包（锁定版本）
    "./local-plugin.ts",          // 相对路径
    "file:///abs/path/plugin.js", // 绝对路径
    ["pkg", { "key": "val" }]     // 带选项
  ]
}
```

**注意**：v2 规范中 `plugin` 重命名为 `plugins`。当前项目使用 `plugin`（v1）。

---

## 6. 推荐多插件架构

```
.opencode/plugins/
├── tool-before.ts       ← export default → "tool.execute.before"
├── tool-after.ts        ← export default → "tool.execute.after"
└── chat-message.ts      ← export default → "chat.message"

.opencode/lib/
└── shared-utils.ts      ← 共享逻辑
```

**优势**：
- 编译失败隔离：一个文件有问题不影响其他
- 易于定位问题
- 每个文件只有一个 hook，简洁
