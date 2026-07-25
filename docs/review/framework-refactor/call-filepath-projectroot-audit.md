# Call & FilePath & ProjectRoot 概念审计

**版本**: v1.0.0  
**日期**: 2026-06-23  
**Agent**: @Super-Admin  
**来源**: `parameter-name-confusion-audit.md` §9, §10, §11

---

## §1 Call / Message 标识

### 1.1 3 种写法

| 写法      | 出现位置                                    | 语义                     |
| --------- | ------------------------------------------- | ------------------------ |
| `callID`  | Plugin hook `input.callID`（OpenCode 原生） | OpenCode 工具调用唯一 ID |
| `call_id` | DB 列 `read_audit.call_id`                  | snake_case DB 版本       |
| `callId`  | 内部变量, read-audit 迁移                   | camelCase JS 变量        |

### 1.2 使用统计

| 写法                   | 出现文件数 | 说明                                           |
| ---------------------- | ---------- | ---------------------------------------------- |
| `input.callID`         | 18 plugins | 所有 plugin 均从 hook input 读取               |
| `callID: input.callID` | 70+ 处     | writeLog 中传递调用 ID                         |
| `callId` (变量)        | 2          | `read-track-after.ts`, `migrate-read-audit.ts` |
| `call_id` (DB)         | 1 表       | `read_audit` 表                                |

### 1.3 问题

| 问题                            | 严重性 | 说明                                                                                                                               |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `input.callID` vs 变量 `callId` | LOW    | OpenCode 原生格式是 `callID`（大写 ID），但 JS 惯例是 `callId`。`read-track-after.ts` 做了兼容：`input?.callID \|\| input?.callId` |

---

## §2 File Path

### 2.1 5 种写法

| 写法         | 出现位置                         | 语义                  |
| ------------ | -------------------------------- | --------------------- |
| `filePath`   | tools args, 函数参数（最常用）   | 通用文件路径          |
| `absPath`    | safe-edit-core 内部 normalize 后 | 解析后的绝对路径      |
| `scopePath`  | scope-before 内部变量            | 范围检查使用          |
| `targetPath` | safe_restore, safe_diff args     | diff/restore 目标路径 |
| `file_path`  | DB 列 `read_audit.file_path`     | snake_case DB 版本    |

### 2.2 使用统计

| 写法         | 文件数 | 典型模块                                                       |
| ------------ | ------ | -------------------------------------------------------------- |
| `filePath`   | 30+    | 所有 tools, lib/safe-edit-core, gate-checks, permission-reader |
| `absPath`    | 2      | safe-edit-core（内部函数）                                     |
| `scopePath`  | 1      | scope-before.ts                                                |
| `targetPath` | 2      | safe_restore, safe_diff                                        |
| `file_path`  | 3 表   | read_audit, agent_registry_snapshot, dispatch_prompt_refs      |

### 2.3 流转

```
args.filePath / args.dirPath
    │
    ▼
path.resolve(filePath) → absPath (normalized absolute)
    │
    ├── safe-edit-core: writeSafe(absPath, content)
    ├── scope-before:   scopePath (for ROUTE-MISMATCH check)
    ├── gate-checks:    isWriteAllowed(agent, filePath)
    └── read-audit:     file_path (DB column)
```

### 2.4 问题

| 问题                                   | 说明                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `filePath` vs `absPath`                | 同一文件对象在 normalize 前后使用不同变量名，偶尔混淆（如 `validateEdit` 返回值同时有 `resolvedPath` 和原始 `filePath`） |
| `backupPath` + `targetPath` 命名不对称 | `safe_diff` 用 `backupPath`/`targetPath`，但 `safe_restore` 用 `backupPath`/`targetPath`；其他模块用 `filePath`          |

---

## §3 Project Root

### 3.1 3 种写法

| 写法            | 出现位置                         | 语义                               |
| --------------- | -------------------------------- | ---------------------------------- |
| `OPENCODE_ROOT` | env var（全项目标准）            | 项目根目录绝对路径                 |
| `projectRoot`   | 内部变量简写                     | `OPENCODE_ROOT \|\| process.cwd()` |
| `worktree`      | Tool context: `context.worktree` | OpenCode 运行时工作树              |

### 3.2 解析优先级

```
context.worktree           ← OpenCode Tool.Context（最高优先级）
    │
process.env.OPENCODE_ROOT  ← env var（所有子进程标准）
    │
process.cwd()              ← fallback（当前工作目录）
```

### 3.3 使用统计

| 写法                        | 出现文件数 | 说明                                  |
| --------------------------- | ---------- | ------------------------------------- |
| `process.env.OPENCODE_ROOT` | 30+        | 所有插件、工具、lib                   |
| `projectRoot`               | 10+        | 局部变量缓存                          |
| `context.worktree`          | 2          | dispatch_subagent, config_read_attest |
| `process.cwd()` fallback    | 20+        | 配合 `OPENCODE_ROOT` 使用             |

### 3.4 问题

| 问题                             | 说明                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `worktree` vs `projectRoot` 重复 | `context.worktree` 和 `process.env.OPENCODE_ROOT` 通常指向同一目录，但路径可能存在符号链接差异 |
| `process.cwd()` 在子进程中不可靠 | 子进程可能在不同目录启动                                                                       |

---

## §4 汇总 (3 概念)

| 概念         | 变体数 | 最严重混淆                                             |
| ------------ | ------ | ------------------------------------------------------ |
| Call/Message | 3      | `callID` (OpenCode) vs `callId` (JS 惯例) — 需兼容读取 |
| File Path    | 5      | `filePath` vs `absPath` — normalize 前后命名不一致     |
| Project Root | 3      | `worktree` vs `OPENCODE_ROOT` — 可能因符号链接不同     |

---

## §5 相关文档

| 文档                                | 关系                    |
| ----------------------------------- | ----------------------- |
| `parameter-name-confusion-audit.md` | §9, §10, §11 为本文来源 |

---

## §6 实施记录

### Call/Message — 已符合规范

| 语境                | 命名           | 状态                      |
| ------------------- | -------------- | ------------------------- |
| OpenCode hook input | `input.callID` | ✅ 原生                   |
| TS 接口 (映射 DB)   | `callId`       | ✅ camelCase of `call_id` |
| DB 列               | `call_id`      | ✅ 正确                   |

### File Path — 已符合规范

| 语境         | 命名        | 状态          |
| ------------ | ----------- | ------------- |
| 变量/参数    | `filePath`  | ✅ 全项目统一 |
| DB 列        | `file_path` | ✅ 正确       |
| normalize 后 | `absPath`   | ✅ 特殊用途   |

无需代码变更。审计 v1.1.0。
