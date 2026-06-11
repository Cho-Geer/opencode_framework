# OpenCode 框架插件调试防坑指南

**日期**: 2026-06-07
**适用范围**: OpenCode 框架插件开发、framework-enforcer 调试、Bun 运行时问题排查
**来源**: framework-enforcer 插件加载失败调试经验总结

---

## 目录

1. [语法陷阱：单引号字符串中的字面换行符](#1-语法陷阱单引号字符串中的字面换行符)
2. [导入解析：Bun 子目录相对路径失败](#2-导入解析bun-子目录相对路径失败)
3. [Bun 缓存：过时的编译模块](#3-bun-缓存过时的编译模块)
4. [插件加载机制：INDEX_FILES 与 Hook 链式调用](#4-插件加载机制index_files-与-hook-链式调用)
5. [诊断策略：基于文件系统的日志方案](#5-诊断策略基于文件系统的日志方案)
6. [MCP 工具数据：output.args 形状因工具类型而异](#6-mcp-工具数据outputargs-形状因工具类型而异)

---

## 1. 语法陷阱：单引号字符串中的字面换行符

### 问题描述

在 TypeScript/JavaScript 中，单引号字符串 **不能** 包含字面换行符。以下代码会在编译时**静默失败**：

```typescript
// ❌ 错误：单引号字符串中包含字面换行符
const metadata = {
  description: '这是一个很长的描述
    它被意外地折行了
    导致编译器报错',
};
```

Bun 在遇到此类错误时会输出：

```
error: Unexpected token
```

但 **不会明确指明** 问题是换行符引起的。编译器只报告语法错误位置，不说明根本原因。

### 正确做法

使用 **反引号模板字符串** 包含多行文本：

```typescript
// ✅ 正确：使用反引号模板字符串
const metadata = {
  description: `这是一个很长的描述
    它被意外地折行了
    现在可以正常编译`,
};
```

或使用显式的 `\n` 转义序列：

```typescript
// ✅ 可选：使用显式 \n
const metadata = {
  description: '第一行\n第二行\n第三行',
};
```

### 排查要点

| 要点 | 说明 |
|------|------|
| 编译错误定位 | Bun 报 `Unexpected token` 时，检查报错行号附近的字符串 |
| 字符串类型 | 优先检查单引号 `'...'` 和双引号 `"..."` 字符串 |
| 快速验证 | 将可疑字符串替换为反引号模板字符串确认问题 |
| ESLint 规则 | `no-unexpected-multiline` 规则可以检测此类问题 |

### 深层原因

Bun 的 TypeScript 解析器在单引号字符串中遇到字面换行符时，会尝试恢复解析但最终失败，产生模糊的语法错误消息。这与 TypeScript 官方编译器（tsc）的行为一致，但 Bun 的错误信息更加简略，增加了排查难度。

---

## 2. 导入解析：Bun 子目录相对路径失败

### 问题描述

当 TypeScript 源文件位于 **子目录** 中时，Bun 的相对路径导入可能失败，尤其是在以下场景：

- 插件目录结构：`.opencode/plugins/my-plugin/hooks/tool-execute.ts`
- 尝试导入同级或上级目录的模块

```typescript
// ❌ 错误：子目录中的相对路径导入
// 文件位置: .opencode/plugins/my-plugin/hooks/tool-execute.ts
import { someFunction } from '../utils/helper'; // Bun 可能无法解析
import { config } from '../../config';           // 多层相对路径失败
```

Bun 在子目录中解析相对路径时，**不从源文件位置解析**，而是从 **工作目录或包根目录** 解析。这导致 `../` 层级超出工作目录后解析失败。

### 正确做法

#### 方案 A：使用扁平目录结构（推荐）

将插件代码组织为扁平结构，最小化子目录深度：

```
.opencode/plugins/framework-enforcer/
├── index.ts              # 插件入口，直接导入同级文件
├── hooks.ts              # Hook 函数定义
├── utils.ts              # 工具函数
└── package.json
```

```typescript
// ✅ 正确：同级导入，路径简单
// 文件位置: .opencode/plugins/framework-enforcer/index.ts
import { registerHooks } from './hooks';
import { getConfig } from './utils';
```

#### 方案 B：使用 `package.json` 的 `exports` 字段

```json
{
  "name": "framework-enforcer",
  "exports": {
    ".": "./index.ts",
    "./hooks": "./hooks/tool-execute.ts"
  }
}
```

```typescript
// ✅ 正确：通过包名导入
import { executeBefore } from "framework-enforcer/hooks";
```

#### 方案 C：使用绝对路径（仅用于调试）

```typescript
// ⚠️ 调试用途，不建议用于生产代码
import { resolve } from 'path';
const helper = await import(resolve(import.meta.dir, '../utils/helper'));
```

### 排查要点

| 要点 | 说明 |
|------|------|
| 错误特征 | `Cannot find module` 或 `Module not found` |
| 目录深度 | 同一目录内的导入总是安全的；跨目录导入 `../` 层级越多风险越大 |
| 快速测试 | 将文件移到同一目录测试导入是否正常 |
| 工作目录 | 检查 Bun 的当前工作目录 `process.cwd()` |

---

## 3. Bun 缓存：过时的编译模块

### 问题描述

Bun 会缓存已编译的 TypeScript 文件，当源文件被修改后，缓存可能 **不自动失效**，导致运行时仍在执行旧代码：

```bash
# 修改了源文件，但 Bun 使用缓存的编译结果
$ bun run .opencode/plugins/framework-enforcer/index.ts
# 实际运行的是修改前的代码！
```

### 缓存失效的场景

| 场景 | 是否触发缓存更新 |
|------|:-:|
| 修改 `.ts` 文件内容 | ❌ 未必 — Bun 缓存键基于文件路径和内容哈希 |
| 修改导入的依赖文件 | ❌ 未必 — 缓存链可能不完整 |
| 重命名文件 | ✅ 是的 — 新路径触发新编译 |
| 删除文件并重建 | ✅ 是的 — 文件名改变触发新编译 |
| 清除缓存目录 | ✅ 是的 — 强制重新编译 |

### 正确做法

#### 方案 A：修改文件名强制刷新（推荐用于调试）

```bash
# 修改文件名触发重新编译
mv index.ts index-v2.ts
# 更新 opencode.json 中的引用
```

文件名变化 = 新缓存键 = 强制重新编译。

#### 方案 B：清除 Bun 缓存

```bash
# 清除特定插件的缓存
rm -rf ~/.cache/bun/plugins/framework-enforcer

# 或清除所有缓存（激进方案）
rm -rf ~/.cache/bun
```

#### 方案 C：使用 `--no-cache` 标志

```bash
# 跳过缓存（如支持）
bun run --no-cache .opencode/plugins/framework-enforcer/index.ts
```

#### 方案 D：添加版本注释到入口文件

```typescript
// 版本: 2.0.1 — 修改此注释以强制刷新缓存
// bun 的缓存键基于文件内容哈希，修改注释会改变哈希
export const VERSION = '2.0.1';
```

### 排查要点

| 要点 | 说明 |
|------|------|
| 怀疑缓存 | 修改代码后行为无变化 → 首先怀疑缓存 |
| 验证方法 | 在文件中添加 `console.log('VERSION_X')` 并递增版本号 |
| 文件时间戳 | Bun 缓存可能基于内容哈希而非 mtime |
| 最终手段 | 重命名文件是 100% 可靠的缓存突破方法 |

---

## 4. 插件加载机制：INDEX_FILES 与 Hook 链式调用

### 问题描述

OpenCode 的插件加载机制有两条关键规则，开发者经常误解：

#### 规则 1：OpenCode 不使用任意的 `.ts` 文件扫描

框架不会扫描插件目录下的所有 `.ts` 文件。它只查找：

1. **`package.json`** — 读取 `exports["./server"]`、`exports["./tui"]` 或 `main` 字段
2. **`INDEX_FILES`** — 固定的入口文件名列表

```typescript
// OpenCode 内部源码 (shared.ts)
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs'];
```

这意味着 **只有 `index.ts` 文件被加载**，其他文件除非被 `index.ts` 导入，否则不会被加载：

```
.opencode/plugins/framework-enforcer/
├── index.ts              # ✅ 被加载（INDEX_FILES 匹配）
├── hooks/tool-execute.ts # ❌ 不会被扫描到，除非被 index.ts 导入
└── utils.ts              # ❌ 不会被扫描到，除非被 index.ts 导入
```

#### 规则 2：Hook 是链式调用的，不是最后写入者胜出

当多个插件注册同一 Hook 事件（如 `tool.execute.before`）时，**所有** 插件的 Hook 都会按注册顺序依次执行：

```typescript
// OpenCode 内部源码 (plugin.ts)
for (const item of hooks) {
  // item.id !== 'my-plugin' 不会跳过
  const match = item.hooks[name];
  if (!match) continue;
  yield* match(event as any);  // ← 调用每个插件的 Hook
}
```

**关键细节**：如果两个插件使用 **不同的 ID**，两者的 Hook 都会触发。如果同一 ID 重新注册，会替换旧的 Hook。

### 常见错误

#### 错误 1：创建非 `index.ts` 的入口文件

```typescript
// ❌ 错误：main.ts 不会被加载
// .opencode/plugins/framework-enforcer/main.ts
export const MyPlugin = async () => {
  return { 'tool.execute.before': async (input, output) => { ... } };
};
```

#### 错误 2：假设最后注册的插件覆盖前面的

```typescript
// ❌ 错误假设：framework-enforcer 覆盖 uc7ks-enforcer
// 实际上两个都会触发（不同 ID 时）
```

#### 错误 3：创建深层嵌套目录结构

```typescript
// ❌ 错误：深层导入路径导致 Bun 解析失败
.opencode/plugins/my-plugin/src/deep/nested/hooks/impl.ts
```

### 正确做法

```typescript
// ✅ 正确：始终使用 index.ts 作为入口
// .opencode/plugins/framework-enforcer/index.ts

// 在入口文件中组合所有 Hook
import { toolExecuteBefore } from './hooks/tool-execute';
import { toolExecuteAfter } from './hooks/tool-execute';
import { shellEnv } from './hooks/shell-env';

export const FrameworkEnforcer = async ({ project, client, $, directory, worktree }) => {
  return {
    'tool.execute.before': toolExecuteBefore,
    'tool.execute.after': toolExecuteAfter,
    'shell.env': shellEnv,
  };
};
```

#### 合并冲突插件

当两个插件必须共存时，**合并为一个插件**：

```
.opencode/plugins/
├── framework-enforcer/     # ✅ 单一插件，合并所有功能
│   ├── index.ts            # 入口
│   ├── hooks.ts            # 所有 Hook
│   └── enforcers/
│       ├── uc7ks-enforcer.ts     # UC7KS 规则
│       └── framework-enforcer.ts # 框架规则
```

```typescript
// index.ts — 合并两个 enforcer
import { uc7ksHooks } from './enforcers/uc7ks-enforcer';
import { frameworkHooks } from './enforcers/framework-enforcer';

export const MergedPlugin = async (ctx) => {
  return {
    'tool.execute.before': async (input, output) => {
      await uc7ksHooks.before(input, output);
      await frameworkHooks.before(input, output);
    },
    'tool.execute.after': async (input, output) => {
      await uc7ksHooks.after(input, output);
      await frameworkHooks.after(input, output);
    },
  };
};
```

### 在 opencode.json 中注册

```json
{
  "plugins": [
    ".opencode/plugins/framework-enforcer"
  ]
}
```

> OpenCode 会自动查找该目录下的 `index.ts`。

---

## 5. 诊断策略：基于文件系统的日志方案

### 问题描述

在 OpenCode 插件环境中，`console.log` 的输出 **不会出现在标准终端** 中，因为插件在 OpenCode 进程内运行，stdout 被重定向或忽略。这导致传统的打印调试完全无效。

```typescript
// ❌ 无效：console.log 不会出现在任何可查看的地方
export const MyPlugin = async () => {
  console.log('This will NOT be visible');
  return {
    'tool.execute.before': async (input, output) => {
      console.log('Debug:', input.tool); // ❌ 永远看不到
    },
  };
};
```

### 正确做法

#### 方案 A：基于文件系统的日志（推荐）

将调试信息写入日志文件：

```typescript
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

function logDebug(message: string, data?: any) {
  const logDir = join(process.cwd(), '.task_temp/_logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}\n`;
  appendFileSync(join(logDir, 'plugin-debug.log'), logLine);
}

// 使用
export const MyPlugin = async () => {
  logDebug('Plugin initializing');
  return {
    'tool.execute.before': async (input, output) => {
      logDebug('tool.execute.before fired', { tool: input.tool, args: input.args });
    },
  };
};
```

#### 方案 B：增量导入测试

逐步添加导入语句以定位错误：

```typescript
// 步骤 1：从最简单的导入开始
export const TestPlugin = async () => {
  return { 'tool.execute.before': async () => { /* 空实现 */ } };
};

// 步骤 2：添加第一个导入
import { someFunction } from './utils';
export const TestPlugin = async () => {
  someFunction(); // 测试是否能正常工作
  return { 'tool.execute.before': async () => { /* ... */ } };
};

// 步骤 3：逐步添加更多导入...
```

#### 方案 C：二分搜索法

当有大量代码但不确定错误位置时，将代码二分并逐一测试：

```
1. 注释掉 50% 的代码 → 测试是否加载成功
2. 如果成功 → 错误在注释掉的 50% 中
3. 如果失败 → 错误在当前 50% 中
4. 重复直到找到具体位置
```

```typescript
// 第 1 次迭代：注释掉上半部分
export const MyPlugin = async () => {
  return {
    'tool.execute.before': async (input, output) => {
      // ... 保留下半部分代码 ...
      // const result = await complexOperation(); // 注释掉
    },
  };
};
```

#### 方案 D：最小复现用例

创建独立的测试文件，最小化所有外部依赖：

```typescript
// test-minimal.ts — 独立测试，无框架依赖
import { resolve } from 'path';
console.log('Import test starting...');

// 逐个测试导入
try {
  const mod = await import('./utils');
  console.log('utils.ts loaded:', Object.keys(mod));
} catch (e) {
  console.error('utils.ts FAILED:', e.message);
}
```

运行方式：

```bash
bun run test-minimal.ts
```

### 排查要点

| 方案 | 适用场景 | 可靠度 |
|------|----------|:------:|
| 文件日志 | 运行时动态调试 | ⭐⭐⭐⭐⭐ |
| 增量导入 | 定位导入错误 | ⭐⭐⭐⭐ |
| 二分搜索 | 大段代码定位 | ⭐⭐⭐⭐ |
| 最小复现 | 隔离框架依赖 | ⭐⭐⭐⭐⭐ |

---

## 6. MCP 工具数据：output.args 形状因工具类型而异

### 问题描述

在 `tool.execute.before` / `tool.execute.after` Hook 中，`output.args` 对象的形状 **因工具类型不同而不同**。不能假设所有工具的 args 结构相同。

```typescript
// ❌ 错误：假设所有工具 args 都有相同的字段
'tool.execute.before': async (input, output) => {
  const filePath = output.args.filePath; // 某些工具没有 filePath！
  // read 工具有 filePath
  // safe_edit 工具没有 filePath，而是有 filePath + mode + oldString + newString
  // bash 工具有 command
  // glob 工具有 pattern
}
```

### 各工具 args 形状速查

| 工具类型 | `output.args` 的字段 | 示例值 |
|----------|----------------------|--------|
| `read` | `{ filePath }` | `{ filePath: "/path/to/file.ts" }` |
| `safe_edit` | `{ filePath, mode, oldString?, newString?, content?, dryRun? }` | `{ filePath: "...", mode: "patch", oldString: "...", newString: "..." }` |
| `safe_shell` | `{ command, timeout?, dryRun? }` | `{ command: "npm test", timeout: 300000 }` |
| `safe_mkdir` | `{ dirPath, recursive? }` | `{ dirPath: "/path/to/dir", recursive: true }` |
| `safe_delete` | `{ filePath }` | `{ filePath: "/path/to/file.ts" }` |
| `safe_diff` | `{ backupPath?, targetPath?, fileA?, content? }` | `{ fileA: "...", content: "..." }` |
| `glob` | `{ pattern, path? }` | `{ pattern: "**/*.ts", path: "/src" }` |
| `grep` | `{ pattern, path?, include? }` | `{ pattern: "function", include: "*.ts" }` |
| `webfetch` | `{ url, format? }` | `{ url: "https://...", format: "markdown" }` |
| `question` | `{ questions }` | `{ questions: [{ question: "...", options: [...] }] }` |
| `todowrite` | `{ todos }` | `{ todos: [{ content: "...", status: "pending" }] }` |
| `context7_query-docs` | `{ libraryId, query }` | `{ libraryId: "/nestjs/nest", query: "guards" }` |
| `context7_resolve-library-id` | `{ query, libraryName }` | `{ query: "NestJS guards", libraryName: "NestJS" }` |

### 正确做法

```typescript
// ✅ 正确：基于工具类型处理不同的 args 形状
'tool.execute.before': async (input, output) => {
  const tool = input.tool;

  switch (tool) {
    case 'read':
    case 'safe_delete':
      handleFileOp(output.args.filePath); // 有 filePath
      break;

    case 'safe_edit':
      handleEditOp({
        filePath: output.args.filePath,
        mode: output.args.mode,
      });
      break;

    case 'safe_shell':
      handleCommandOp(output.args.command); // 有 command
      break;

    case 'glob':
      handlePatternOp(output.args.pattern); // 有 pattern
      break;

    case 'question':
      // question 工具的 args 结构完全不同
      handleQuestionOp(output.args.questions);
      break;

    case 'todowrite':
      handleTodoWriteOp(output.args.todos);
      break;

    default:
      logDebug(`Unknown tool type: ${tool}`, { args: output.args });
  }
}
```

### 通用字段说明

所有工具都至少有以下通用字段在 `input` 中：

```typescript
input = {
  tool: string;       // 工具名称，如 "safe_edit"
  sessionID: string;  // 会话 ID
  callID: string;     // 调用 ID
};
```

`output` 的结构 **因 hook 类型不同而不同**，这是最容易踩坑的地方：

```typescript
// tool.execute.before
output = {
  args: Record<string, any>;  // 工具原始参数
};

// tool.execute.after
// output 是工具执行后的结果对象，args 已移动到 input.args
input = {
  tool: string;
  sessionID: string;
  callID: string;
  args: Record<string, any>;  // ✅ after-hook 从这里读参数
};
output = {
  // 工具返回值/结果，结构因工具而异
};
```

### before vs after Hook 参数位置

| Hook | 参数位置 | 示例 |
|------|---------|------|
| `tool.execute.before` | `output.args.filePath` | `output.args.filePath` |
| `tool.execute.after` | `input.args.filePath` | `input.args.filePath` |

**来源**：`packages/opencode/src/session/tools.ts` 中的触发代码：

```typescript
yield* plugin.trigger("tool.execute.before", { tool, sessionID, callID }, { args })
yield* plugin.trigger("tool.execute.after", { tool, sessionID, callID, args }, output)
```

### 排查要点

| 要点 | 说明 |
|------|------|
| 不假设字段存在 | 总是检查字段是否存在：`if (output.args.filePath)` |
| 工具名是区分键 | 使用 `input.tool` 确定 args 形状 |
| **区分 before/after** | `before` 用 `output.args`，`after` 用 `input.args` |
| 日志 args 结构 | 遇到未知工具时先记录完整的 args 结构 |
| 防御性编程 | `output.args?.filePath` / `input.args?.filePath` 使用可选链 |

---

## 附录 A：调试检查清单

当插件加载失败时，按以下顺序排查：

- [ ] **检查入口文件**：是否为 `index.ts`？（见 §4）
- [ ] **检查字符串**：单引号字符串中是否有字面换行符？（见 §1）
- [ ] **检查导入路径**：相对路径是否跨子目录？（见 §2）
- [ ] **清除缓存**：重命名入口文件以突破 Bun 缓存？（见 §3）
- [ ] **添加文件日志**：用 `appendFileSync` 替代 `console.log`（见 §5）
- [ ] **增量导入测试**：从空实现开始逐个添加导入（见 §5）
- [ ] **检查注册配置**：`opencode.json` 中 `plugins` 数组是否正确？
- [ ] **检查 package.json**：`exports` 或 `main` 字段是否正确？

## 附录 B：关键文件参考

| 文件 | 路径 | 用途 |
|------|------|------|
| 插件入口 | `.opencode/plugins/framework-enforcer/index.ts` | 插件入口点 |
| 插件配置 | `opencode.json` 中 `plugins` 数组 | 注册插件 |
| Hook 实现 | `.opencode/plugins/framework-enforcer/hooks/` | 各 Hook 实现 |
| Bun 缓存 | `~/.cache/bun/` | 编译缓存 |
| 调试日志 | `.task_temp/_logs/plugin-debug.log` | 文件日志输出 |

---

*本文档基于 framework-enforcer 插件调试过程中遇到的真实问题总结，将持续更新。*
