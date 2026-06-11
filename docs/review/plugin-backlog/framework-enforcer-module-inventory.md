# framework-enforcer.ts 功能模块清单

**日期**: 2026-06-11  
**来源**: `_bk_framework-enforcer/enforce.ts` (原始备份)  
**用途**: 扁平化重构时确保无遗漏，逐个恢复定位编译失败根因

---

## 关键修复记录

### 2026-06-11 — 修复 scope-after.ts after-hook 不触发 + log-manager.ts 计数竞态

**现象 1**：scope-after.ts 已加载（loaded/hooks 日志正常），但执行 safe_edit 后未生成 plugin-scope-after-runtime.log。

**根因 1**：OpenCode 的 tool.execute.after 与 tool.execute.before 的参数位置不同：

```typescript
// before-hook：args 在 output.args
yield* plugin.trigger("tool.execute.before", { tool, sessionID, callID }, { args })
// after-hook：args 在 input.args；output 是工具结果
yield* plugin.trigger("tool.execute.after", { tool, sessionID, callID, args }, output)
```

原 scope-after.ts 使用了 output.args，导致 getModifyPath() 返回空字符串，hook 直接 return。

**修复 1**：将 scope-after.ts 改为读取 input.args，并更新错题集 plugin-debugging-precautions.md §6 记录此差异。

**现象 2**：index.json.dates["2026-06-10"].plugins_loaded 显示 6，但实际加载了 7 个插件（含 scope-after）。

**根因 2**：log-manager.ts 的 writeLog() 对日志做内存缓冲（BUFFER_SIZE = 20），而 updateIndex() 在调用时立即扫描日志目录计数。scope-after 的 loaded 日志仍在缓冲区中未落盘，导致计数时该文件不存在。

**修复 2**：在 writeLog() 中，当 category === "loaded" 时立即调用 flushBuffer()，确保 updateIndex() 扫描前日志已落盘。

| 文件 | 修复内容 |
|------|---------|
| plugins/scope-after.ts | getModifyPath(output.args) → getModifyPath(input.args) |
| lib/log-manager.ts | category === "loaded" 时立即 flush，修复 plugins_loaded 计数竞态 |
| docs/official_docs/framework/mistake_precautions/plugin-debugging-precautions.md | 新增 before/after hook 参数位置差异说明 |

### 2026-06-11 — 修复 readJsonFile is not a function 运行时崩溃

**现象**：所有修改类工具（safe_edit、safe_shell 等）触发 tool.execute.before 钩子后崩溃，错误信息：

```
readJsonFile is not a function. (In 'readJsonFile(STATE_PATHS.projectConfig())', 'readJsonFile' is undefined)
```

**根因**：lib/gate-checks.ts 使用依赖注入模式声明 let readJsonFile，并通过 initDeps(rjf, chf) 初始化，但 **没有任何插件调用 initDeps()**，导致 readJsonFile 始终为 undefined。调用链：

```
audit-before.ts → write-audit-lib.ts → gate-checks.ts::isWriteAllowed()
  → readJsonFile(STATE_PATHS.projectConfig()) → 💥 undefined
```

**修复方案**：将 readJsonFile 和 computeFileHash 内联为本地函数，移除未调用的 initDeps()。

| 文件 | 修复内容 |
|------|---------|
| lib/gate-checks.ts | let readJsonFile + initDeps() → 内联 readJsonFile<T>() + computeFileHash() |
| lib/tool-scope.ts | import { readJsonFile } from "./gate-core" → 内联 fs.readFileSync + JSON.parse |
| lib/write-audit-lib.ts | import { readJsonFile } from "./gate-core" → 内联 fs.readFileSync + JSON.parse |

**验证**：重启 OpenCode 后，safe_edit 和 safe_shell 均可正常执行。


## 重构完成（2026-06-11）

15/15 插件全部上线并通过运行时验证。plugins_loaded: 15。

| 域名 | before | after | 状态 |
|------|--------|-------|:---:|
| session | session.ts | — | ✅ |
| scope | scope-before.ts | scope-after.ts | ✅ |
| uc7ks | uc7ks-before.ts | uc7ks-after.ts | ✅ |
| dispatch | dispatch-before.ts | dispatch-after.ts | ✅ |
| gate | gate-before.ts | gate-after.ts | ✅ |
| audit | audit-before.ts | audit-after.ts | ✅ |
| tdd | tdd-before.ts | — | ✅ |
| task | — | task-after.ts | ✅ |
| cache | — | cache-after.ts | ✅ |

## 模块统计：共 26 個

### 导出 (4)
| 行 | 名称 | 说明 |
|----|------|------|
| 296 | `chatMessageHook` | 写 session map |
| 532 | `toolExecuteBefore` | 主执行前 hook (~1000行) |
| 1662 | `toolExecuteAfter` | 执行后 hook (~250行) |
| 1917 | `export default` | 插件入口 |

### 内部函数 (14)
| 行 | 名称 | 说明 |
|----|------|------|
| 72 | `resolveAgent` | 解析 Agent 身份 |
| 116 | `resolveTaskId` | 解析 Task ID |
| 141 | `isModifyTool` | 判断是否修改文件的工具 |
| 159 | `getModifyPath` | 提取修改的文件路径 |
| 168 | `isModifyShell` | 判断 shell 是否修改文件 |
| 186 | `readDispatchAllowedTools` | 读取 Agent 允许的工具 |
| 237 | `isToolAllowed` | 检查工具是否被允许 |
| 335 | `resolveAgentFromSessionMap` | 从 session map 解析 Agent |
| 362 | `readCacheIndex` | 读知识缓存索引 |
| 373 | `isLocalCacheAvailable` | 检查缓存可用性 |
| 383 | `readCachedSessionAccess` | 读缓存的会话访问记录 |
| 399 | `buildUC7KSError` | 构建 UC7KS 错误消息 |
| 427 | `checkUC7KS` | UC7KS 合规检查 |
| 1507 | `_executeWriteAuditCheck` | 写入审计检查 |

### 辅助 (3)
| 行 | 名称 |
|----|------|
| 268 | `getSessionMapPath` |
| 276 | `getDemoLogPath` |
| 284 | `demoLog` |

### 模块级 (4)
| 行 | 名称 |
|----|------|
| 67 | `sessionLastDispatched` Map |
| 264-266 | `SESSION_MAP_DIR`, `SESSION_MAP_FILE`, `DEMO_LOG_FILE` 常量 |
| 354 | `INDEX_PATH` |
| 356 | `IndexManifest` 接口 |

---

## 依赖关系

```
export default → toolExecuteBefore, toolExecuteAfter, chatMessageHook
    │
toolExecuteBefore → resolveAgent, resolveTaskId, isModifyTool, getModifyPath,
                     isModifyShell, isToolAllowed, checkUC7KS, buildUC7KSError,
                     _executeWriteAuditCheck, readCacheIndex, isLocalCacheAvailable,
                     resolveAgentFromSessionMap, demoLog
    │
    ├── ../lib/gate-core: getEnforcementMode, findArmedSession, computeSHA256
    ├── ../lib/gate-checks: findTaskInDag, isWriteAllowed, checkStaleSessions, autoDrainStaleSessions
    ├── ../lib/audit-log: writeAuditLogEntry, logAuditEntry
    └── ../lib/state-utils: STATE_PATHS, isSourceFile, getOpenCodeRoot

chatMessageHook → demoLog, getSessionMapPath
toolExecuteAfter → resolveAgent, resolveTaskId, _executeWriteAuditCheck, demoLog
```

---

## 重构进度

| 步骤 | 内容 | 状态 | 备注 |
|------|------|------|------|
| 1 | chatMessageHook + 依赖 | ✅ 完成 | `session.ts` |
| 2 | toolExecuteBefore + 全部依赖 | ✅ 完成 | 5 个 `*-before.ts` |
| 3 | toolExecuteAfter | ✅ 完成 | 7 个 `*-after.ts` |
| 4 | export default | ✅ 完成 | 13 个独立插件，扁平化架构 |

---

## 最终布局（v2）：before/after 配对 + 独立插件 + 共享 lib

```
.opencode/plugins/                          .opencode/lib/
────────────────────────                    ─────────────────

"tool.execute.before"       (6 plugins)    shared-infra.ts        demoLog, getDemoLogPath, DEMO_LOG_FILE
scope-before.ts             写权限检查
uc7ks-before.ts             知识管道合规    agent-resolver.ts      resolveAgent, resolveAgentFromSessionMap,
dispatch-before.ts          消费 pending                                resolveTaskId, getSessionMapPath,
gate-before.ts              门禁检查                                     sessionLastDispatched, SESSION_MAP_DIR/FILE
audit-before.ts             写入审计
tdd-before.ts               TDD强制执行
                                           tool-scope.ts          isModifyTool, getModifyPath, isModifyShell,
"tool.execute.after"        (8 plugins)                             readDispatchAllowedTools, isToolAllowed
scope-after.ts              状态同步
uc7ks-after.ts              文档合规       uc7ks-utils.ts         checkUC7KS, buildUC7KSError, readCacheIndex,
dispatch-after.ts           清理残留                                   isLocalCacheAvailable, readCachedSessionAccess,
gate-after.ts               过期门禁                                   INDEX_PATH, IndexManifest
audit-after.ts              审计日志
tdd-after.ts                TDD后验证
task-after.ts               失败记录       write-audit-lib.ts     executeWriteAuditCheck
cache-after.ts              缓存同步

"chat.message"              (1 plugin)     gate-core.ts           getEnforcementMode, findArmedSession, computeSHA256
session.ts                  会话管理       gate-checks.ts         findTaskInDag, isWriteAllowed,
                                                                    checkStaleSessions, autoDrainStaleSessions
                                           audit-log.ts           writeAuditLogEntry, logAuditEntry
                                           state-utils.ts         STATE_PATHS, isSourceFile, getOpenCodeRoot
```

### 11 个插件：before/after 配对

| 域名 | before | after | 总体职责 |
|------|--------|-------|---------|
| scope | `scope-before.ts` | `scope-after.ts` | 写入范围 |
| uc7ks | `uc7ks-before.ts` | `uc7ks-after.ts` | 知识管道 |
| dispatch | `dispatch-before.ts` | `dispatch-after.ts` | 派遣生命周期 |
| gate | `gate-before.ts` | `gate-after.ts` | 门禁管理 |
| audit | `audit-before.ts` | `audit-after.ts` | 审计追踪 |
| tdd | `tdd-before.ts` | `tdd-after.ts` | TDD per-write 强制执行 + post-write safe_diff 验证 |
| task | — | `task-after.ts` | 失败记录 |
| cache | — | `cache-after.ts` | 缓存同步 |
| session | `session.ts` (`chat.message`) | — | 会话管理 |

### 5 个 lib 共享模块

| 模块 | 包含函数 | 被哪些插件引用 |
|------|---------|--------------|
| `shared-infra.ts` | demoLog, getDemoLogPath, DEMO_LOG_FILE | agent-resolver |
| `agent-resolver.ts` | resolveAgent, resolveAgentFromSessionMap, resolveTaskId, getSessionMapPath, sessionLastDispatched | scope, dispatch, gate, audit, task |
| `tool-scope.ts` | isModifyTool, getModifyPath, isModifyShell, readDispatchAllowedTools, isToolAllowed | scope, audit |
| `uc7ks-utils.ts` | checkUC7KS, buildUC7KSError, readCacheIndex, isLocalCacheAvailable, readCachedSessionAccess | uc7ks |
| `write-audit-lib.ts` | executeWriteAuditCheck | scope, audit |
| `log-manager.ts` | writeLog, updateIndex, ensureLogDir, flushAll, archiveCheck | 全部 |

### 模块映射（26 → 11 插件 + 5 lib + 4 已有 lib）

| 原模块 (行) | 新位置 |
|-------------|--------|
| chatMessageHook (296) | `session.ts` |
| toolExecuteBefore (532) | 拆为 5 个 `*-before.ts` |
| toolExecuteAfter (1662) | 拆为 7 个 `*-after.ts` |
| resolveAgent (72) | `lib/agent-resolver.ts` |
| resolveTaskId (116) | `lib/agent-resolver.ts` |
| isModifyTool (141) | `lib/tool-scope.ts` |
| getModifyPath (159) | `lib/tool-scope.ts` |
| isModifyShell (168) | `lib/tool-scope.ts` |
| readDispatchAllowedTools (186) | `lib/tool-scope.ts` |
| isToolAllowed (237) | `lib/tool-scope.ts` |
| resolveAgentFromSessionMap (335) | `lib/agent-resolver.ts` |
| readCacheIndex (362) | `lib/uc7ks-utils.ts` |
| isLocalCacheAvailable (373) | `lib/uc7ks-utils.ts` |
| readCachedSessionAccess (383) | `lib/uc7ks-utils.ts` |
| buildUC7KSError (399) | `lib/uc7ks-utils.ts` |
| checkUC7KS (427) | `lib/uc7ks-utils.ts` |
| _executeWriteAuditCheck (1507) | `lib/write-audit-lib.ts` | 已导出为 `executeWriteAuditCheck` |
| demoLog (284) | `lib/shared-infra.ts` |
| getDemoLogPath (276) | `lib/shared-infra.ts` |
| getSessionMapPath (268) | `lib/agent-resolver.ts` |
| sessionLastDispatched (67) | `lib/agent-resolver.ts` |
| 常量 SESSION_MAP_* (264-266) | `lib/agent-resolver.ts` |
| DEMO_LOG_FILE (266) | `lib/shared-infra.ts` |
| INDEX_PATH (354) | `lib/uc7ks-utils.ts` |
| IndexManifest (356) | `lib/uc7ks-utils.ts` |

---

## Plugin 日志系统（v2.0）

> 完整设计见 [`docs/review/log-backlog/framework-log-system-design.md`](../../log-backlog/framework-log-system-design.md)

### 日志目录

```
.task_temp/_logs/
├── index.json                          ← 全量索引（原子写）
├── _error.log                          ← log-manager 自身错误
├── 2026-06-10/                         ← 按日期分目录
│   ├── plugin-session-loaded.log
│   ├── plugin-session-hooks.log
│   ├── plugin-session-runtime.log
│   └── ...
└── _archive/                           ← >7 天归档
```

### 日志格式

```
timestamp | sessionID | callID | agent | agentType | level | event | detail
```

心跳日志缺 session 上下文时填 `—`。

### 一键验证

```bash
ls .task_temp/_logs/$(date +%Y-%m-%d)/plugin-*-loaded.log | wc -l   # 应 = 9
ls .task_temp/_logs/$(date +%Y-%m-%d)/plugin-*-hooks.log | wc -l    # 应 = 9
```

### 代码模板

```typescript
import { writeLog, updateIndex, ensureLogDir } from "../lib/log-manager";

ensureLogDir();
writeLog("scope-before", "loaded", { event: "PLUGIN-LOADED", detail: "scope-before.ts" });
updateIndex("scope-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("scope-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": myHook };
}) as any;
```

### 构建进度

| 步骤 | 文件 | 类型 | loaded | hooks | runtime | 备注 |
|:---:|:---:|------|:---:|:---:|:---:|:---|
| 1 | `lib/log-manager.ts` | lib | — | — | — | 核心日志库 |
| 2 | `lib/shared-infra.ts` | lib | — | — | — | demoLog 工具函数 |
| 3 | `lib/agent-resolver.ts` | lib | — | — | — | agent/task/session 解析 |
| 4 | `lib/tool-scope.ts` | lib | — | — | — | 已修复 readJsonFile 内联 |
| 5 | `lib/uc7ks-utils.ts` | lib | — | — | — | UC7KS 检查 |
| 6 | `lib/write-audit-lib.ts` | lib | — | — | — | 已修复 readJsonFile 内联 |
| 7 | `lib/gate-checks.ts` | lib | — | — | — | 已修复 readJsonFile / initDeps |
| 8 | `session.ts` | 插件 | ✅ | ✅ | ✅ | chat.message |
| 9 | `scope-before.ts` | 插件 | ✅ | ✅ | ✅ | tool.execute.before |
| 10 | `uc7ks-before.ts` | 插件 | ✅ | ✅ | ✅ | tool.execute.before |
| 11 | `dispatch-before.ts` | 插件 | ✅ | ✅ | ✅ | tool.execute.before |
| 12 | `gate-before.ts` | 插件 | ✅ | ✅ | ✅ | tool.execute.before |
| 13 | `audit-before.ts` | 插件 | ✅ | ✅ | ✅ | tool.execute.before |
| 14 | `scope-after.ts` | 插件 | ✅ | ✅ | ✅ | `tool.execute.after`（input.args 修复后通过） |
| 15 | `uc7ks-after.ts` | 插件 | ✅ | ✅ | ✅ | cache-read 追踪 + total_cache_reads 递增 |
| 16 | `dispatch-after.ts` | 插件 | ✅ | ✅ | ✅ | Task() 调用时记录 dispatch-complete |
| 17 | `gate-after.ts` | 插件 | ✅ | ✅ | ✅ | startsWith 匹配 + stale drain |
| 18 | `audit-after.ts` | 插件 | ✅ | ✅ | ✅ | write_audit_state.history 持久化 |
| 19 | `task-after.ts` | 插件 | ✅ | ✅ | ✅ | Task() 调用时记录 dispatch-outcome |
| 20 | `cache-after.ts` | 插件 | ✅ | ✅ | ✅ | 读 index.json 时同步 cache_status |
| 21 | `tdd-before.ts` | 插件 | ✅ | ✅ | ✅ | TDD per-write 强制执行 (Coder-BE/FE only) |
| 22 | `tdd-after.ts` | 插件 | ✅ | ✅ | ✅ | TDD post-write safe_diff 验证 (P3 增强) |

> **验证依据**：`.task_temp/_logs/` 下 15 loaded + 15 hooks + runtime 日志文件。`index.json` 显示 `plugins_loaded: 15`。
