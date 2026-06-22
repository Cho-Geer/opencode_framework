# OpenCode 会话工作区/分支绑定 - 可行性分析与实施计划

> 版本: 1.0.0
> 日期: 2026-06-22
> 范围: 当前 `work-one` 框架代码、项目配置、本地 Git 工作区布局以及缓存的 OpenCode 官方文档
> 状态: 提案

---

## 1. 结论

这个想法是现实的，但前提是有一个精确的定义：

1. **推荐的第一个目标**：每个顶层人工/OpenCode 工作会话获得一个专用的 Git 工作区和一个专用的 Git 分支。
2. **子代理会话最初应该继承父工作区**，而不是创建它们自己的分支。当前的框架调度、交接、读写审计和 DAG 流程都假定代理在同一文件系统状态上协作。
3. **更严格的“每个子代理 Task() 会话获得自己的工作区”模型只能作为后续的 P2/P3 功能**实现，并且需要一个合并队列和分支编排。它作为第一个实现并不安全。

当前仓库已经处于工作区布局中：

```text
/home/zhaoge/workspace/opencode/develop   -> 分支 develop
/home/zhaoge/workspace/opencode/work-one  -> 分支 work-one
```

`work-one/.git` 指向：

```text
/home/zhaoge/workspace/opencode/develop/.git/worktrees/work-one
```

因此 Git 基础已经存在。缺少的部分是框架级别的生命周期：

- 在开始新的顶层会话之前创建一个工作区
- 在数据库中绑定 `OpenCode sessionID -> 工作区 -> 分支 -> 基础提交`
- 强制要求只在绑定的工作区中写入
- 使调度/读取/门禁/日志记录按工作区隔离
- 安全地关闭、合并、归档和清理工作区

---
## 2. 当前证据

### 2.1 Git 布局

当前本地状态：

| 项目 | 当前值 |
|---|---|
| 主工作区 | `/home/zhaoge/workspace/opencode/develop` |
| 主分支 | `develop` |
| 活动框架工作区 | `/home/zhaoge/workspace/opencode/work-one` |
| 活动分支 | `work-one` |
| 远程仓库 | `opencode-framework` |
| 当前分支追踪 | `work-one -> opencode-framework/work-one` |
| `core.hooksPath` | `.opencode/hooks` |
| `extensions.worktreeConfig` | `true` |

重要含义：Git 对象存储和引用在主仓库下共享。每个工作区有独立的工作树、索引和 HEAD，但分支引用和远程配置是共享的。

### 2.2 OpenCode 官方功能

缓存的 OpenCode 官方文档支持此架构：

- 插件初始化上下文包含 `worktree`
- 自定义工具执行上下文包含 `sessionID`、`agent`、`directory` 和 `worktree`
- 插件可以使用 `tool.execute.before`、`tool.execute.after` 和 `session.*` 事件
- `tool.execute.before` 可以通过抛出异常来阻止执行
- OpenCode 会话按位置存储，除非提供了之前的 `task_id`，否则 Task() 会创建一个新的子代理会话

因此正确的集成点是**围绕 OpenCode 会话的插件/自定义工具强制**，而不是修改上游会话存储。

### 2.3 现有框架钩子和表

框架已经有部分工作区/会话概念：

| 领域 | 当前代码证据 | 当前差距 |
|---|---|---|
| 门禁会话 | `gate_sessions.worktree`；`GateSession.worktree`；`armSession()` 写入 `process.cwd()` | 工作区已记录，但未作为执行边界强制 |
| 会话标识 | `session_map(session_id, agent, dag_task_id, domain_id)` | 没有 `worktree_id`、分支或基础提交 |
| 调度队列 | `dispatch_queue`、`dispatch_context`、`dispatch_prompt_refs`、`dispatch_attempts` | 没有工作区维度；除非修复，否则共享数据库将允许跨工作区队列消费 |
| 读取审计 | `read_audit(opencode_session_id, agent, file_path, task_id, call_id)` | 存储规范化的绝对文件路径，但没有工作区 id |
| 审批桥接 | `approval_read_context(gate_session_id, opencode_session_id, ...)` | 没有工作区 id |
| 日志 | `log-manager.ts` 相对于 `OPENCODE_ROOT` 写入 `.task_temp/_logs` | 每个工作区的日志是隔离的，但全局分析需要工作区元数据 |
| 权限 | OpenCode `external_directory` 默认询问；框架 `scope-before.ts` 强制写入范围 | 需要显式阻止绑定工作区之外的写入 |
| Git 守卫 | `git-guard-before.ts` 和 `hook-config-guard.ts` 阻止钩子绕过 | 需要额外的守卫来阻止分支/工作区变更命令 |

### 2.4 项目代码布局风险

`.opencode/project.config.json` 将业务路径指向：

```text
booking_system_refactor/
```

但是 `.gitignore` 忽略了：

```text
booking_system_refactor/
```

这意味着一个新创建的 Git 工作区将**不包含被忽略的业务源代码树**，除非它被追踪、单独挂载、通过引导脚本复制，或者作为第二个仓库/工作区管理。这是最大的项目代码约束。

如果每个会话工作区模型仅用于框架工作，这是可以接受的。如果它用于业务开发，则业务源代码必须通过定义的机制在每个会话工作区中可用。

---

## 3. 可行性边界

### 3.1 什么是现实的

| 目标 | 可行性 | 备注 |
|---|---|---|
| 顶层 OpenCode 会话 -> 一个工作区 + 一个分支 | 高 | 最佳的第一个实现 |
| 子代理继承父工作区 | 高 | 与当前调度/DAG/交接设计兼容 |
| 会话恢复返回到相同的工作区/分支 | 高 | 需要数据库绑定和启动包装器 |
| 工作区绑定写入强制 | 高 | 添加插件前置钩子和数据库查找 |
| 带有工作区作用域行的中央数据库 | 中 | 需要架构和查询更新 |
| 每个子代理会话一个工作区 | 低/中 | 需要分支合并队列、制品提升和跨分支 DAG 语义 |
| 将已运行的 OpenCode 会话透明迁移到新工作区 | 低 | 插件钩子无法可靠地更改运行进程的位置/cwd |

### 3.2 必需的解释

请使用此定义进行部署：

```text
OpenCode 顶层会话 = 会话工作区 = 会话分支
子代理 Task() 会话 = 绑定到相同父工作区的子会话
主工作区 = develop
```

这在实现实用的隔离目标的同时保持了框架的连贯性：并行用户任务不再竞争同一个检出。

---

## 4. 设计决策

### 4.1 工作区根目录

不要在现有工作区下创建会话工作区。使用同级的运行时目录：

```text
/home/zhaoge/workspace/opencode/
  develop/                # 主工作区，分支 develop
  work-one/               # 当前工作区，分支 work-one
  sessions/               # 建议的生成会话工作区
    ses_<短ID>/
```

`sessions/` 不应该在 Git 工作树内部。这避免了意外提交生成的工作区目录。

### 4.2 分支命名

使用确定性、防冲突的分支命名方案：

```text
oc/session/<yyyyMMdd>/<短会话ID>-<简短描述>
```

示例：

```text
oc/session/20260622/ses-122e0093-framework-audit
```

规则：

- 分支名生成一次并存储在数据库中
- 一个分支只能在一个工作区中检出
- 恢复的会话必须重用相同的分支/工作区
- 分支基于 `develop` 或 `opencode-framework/develop`，具体取决于策略

在启用此工作流之前，`develop` 必须保持足够新，以便成为真正的基础分支。当前本地证据表明 `develop` 落后于其远程，因此同步策略必须明确。

### 4.3 状态模型

推荐目标：**带有工作区作用域行的中央框架数据库**。

原因：

- 框架对于子状态已经是仅数据库的
- 调度/会话/门禁/读取审计必须在并发会话中可查询
- 在工作区之间复制 SQLite WAL 文件是不安全的
- 每个工作区的数据库使全局编排和清理更加困难

推荐的数据库位置：

```text
/home/zhaoge/workspace/opencode/.opencode-runtime/framework-state.db
```

OpenCode 包装器应设置：

```bash
FRAMEWORK_DB_PATH=/home/zhaoge/workspace/opencode/.opencode-runtime/framework-state.db
OPENCODE_ROOT=<会话工作区路径>
FRAMEWORK_WORKTREE_ID=<数据库工作区id>
FRAMEWORK_BRANCH=<会话分支>
```

**不要**用 `cp` 或 `mv` 复制 `.opencode/state/framework-state.db`。如果曾经需要种子快照，请在检查点后使用 SQLite 备份 API 或 `VACUUM INTO`，而不是文件级别的 WAL 复制。

### 4.4 架构迁移守卫

中央数据库意味着功能分支不能随意变更架构。添加一个守卫：

- 架构迁移仅从配置的迁移分支运行，通常是 `develop`
- 非 develop 会话分支可以初始化现有架构，但除非存在 Super-Admin 迁移覆盖，否则不得添加新架构版本
- 所有迁移尝试通过 Log Central 记录

如果没有这个守卫，包含实验性 `db-manager.ts` 更改的会话分支可能会悄然地为每个其他会话更改共享数据库。

---
## 5. 必需的数据库添加

### 5.1 新表：`worktree_registry`

```sql
CREATE TABLE worktree_registry (
  worktree_id        TEXT PRIMARY KEY,
  opencode_session_id TEXT UNIQUE,
  parent_session_id TEXT,
  session_kind      TEXT NOT NULL, -- top_level | subagent | system
  branch_name       TEXT NOT NULL UNIQUE,
  base_branch       TEXT NOT NULL,
  base_ref          TEXT NOT NULL,
  base_commit       TEXT NOT NULL,
  worktree_path     TEXT NOT NULL UNIQUE,
  git_dir           TEXT,
  status            TEXT NOT NULL, -- creating | active | closing | merged | archived | failed
  owner_agent       TEXT,
  dag_task_id       TEXT,
  domain_id         TEXT,
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER,
  closed_at         INTEGER,
  merge_commit      TEXT,
  error_msg         TEXT
);
```

索引：

```sql
CREATE INDEX idx_worktree_registry_status ON worktree_registry(status);
CREATE INDEX idx_worktree_registry_branch ON worktree_registry(branch_name);
CREATE INDEX idx_worktree_registry_parent ON worktree_registry(parent_session_id);
```

### 5.2 新表：`worktree_locks`

```sql
CREATE TABLE worktree_locks (
  lock_key      TEXT PRIMARY KEY,
  holder        TEXT NOT NULL,
  acquired_at   INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
```

用于以下操作：

- 分支创建
- 工作区清理
- 合并/关闭操作
- 绝不能与调度写入竞争的数据库维护操作

### 5.3 扩展当前表

至少：

| 表 | 必需的添加 | 原因 |
|---|---|---|
| `session_map` | `worktree_id`、`branch_name` | 精确的会话 -> 代理/任务/领域/工作区绑定 |
| `session_log` | `worktree_id`、`branch_name` | 按工作区恢复和审计 |
| `gate_sessions` | `branch_name`、`worktree_id` | `worktree` 路径已存在；添加稳定键 |
| `dispatch_queue` | `worktree_id` | 防止一个工作区中的 Task() 租用另一个工作区的调度 |
| `dispatch_context` | `worktree_id` | 审计和清理 |
| `dispatch_prompt_refs` | `worktree_id` | 提示文件路径是工作区本地的 |
| `read_audit` | `worktree_id`、`relative_file_path` | 避免绝对路径冲突，并保持读写审计按会话绑定 |
| `approval_read_context` | `worktree_id` | 防止审批上下文跨越工作区 |
| `knowledge_session_access` | `worktree_id` 可选 | 如果知识访问变为分支特定，则需要 |

不要立即删除现有列。先添加兼容性读取，然后将强制迁移到感知工作区的路径。

---

## 6. 运行时组件

### 6.1 新库：`.opencode/lib/worktree-manager.ts`

职责：

- 解析配置的主工作区和会话工作区根目录
- 生成分支/工作区名称
- 获取/释放数据库锁
- 通过 `execFileSync` 参数数组运行安全的 Git 命令，而不是 shell 字符串
- 创建工作区和分支
- 在数据库中注册绑定
- 通过 `OPENCODE_SESSION_ID`、OpenCode `sessionID` 或 `FRAMEWORK_WORKTREE_ID` 解析当前绑定
- 验证当前 cwd/工作区
- 关闭/归档/清理工作区
- 通过 `writeLog()` 写入结构化日志

仅使用 Bun/TypeScript 和本地框架辅助函数。

### 6.2 新脚本：`.opencode/scripts/worktree-session.ts`

CLI 操作：

```bash
bun .opencode/scripts/worktree-session.ts create --title "<任务标题>"
bun .opencode/scripts/worktree-session.ts status --session <ses_*>
bun .opencode/scripts/worktree-session.ts close --session <ses_*> --mode merge|archive|discard
bun .opencode/scripts/worktree-session.ts prune --older-than-days 14 --dry-run
```

create 命令应：

1. 验证主工作区路径存在且是 `develop` 分支
2. 验证父 Git 元数据可写
3. 根据策略可选地获取/同步基础引用
4. 如果策略要求干净的基础，确保基础工作区没有脏
5. 创建分支和工作区：

```bash
git -C <主工作区> worktree add -b <分支> <会话路径> <基础引用>
```

6. 在新工作区配置钩子：

```bash
git -C <会话路径> config core.hooksPath .opencode/hooks
```

7. 初始化或验证框架数据库路径
8. 记录 `worktree_registry`
9. 输出在工作区中启动 OpenCode 的确切命令及所需的环境变量

### 6.3 新可选工具：`.opencode/tools/worktree_session.ts`

符合官方自定义工具风格：

```ts
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "...",
  args: { ... },
  async execute(args, context) { ... }
});
```

该工具可以创建或检查绑定，但不应尝试将当前运行的 OpenCode 进程移动到新创建的工作区中。它应该返回启动/恢复说明。

### 6.4 新插件：`.opencode/plugins/worktree-guard-before.ts`

钩子：

```text
tool.execute.before
```

职责：

- 对于修改工具，解析当前 OpenCode 会话绑定
- 将绑定的工作区路径与 `OPENCODE_ROOT`/`process.cwd()` 比较
- 如果会话未绑定且策略要求工作区绑定，则阻止写入
- 如果当前分支与数据库绑定不同，则阻止写入
- 阻止危险的 Git 操作：
  - 在批准的关闭路径之外运行 `git worktree remove`
  - 对于活动会话分支运行 `git branch -D`
  - 在活动会话工作区中运行 `git checkout`/`git switch` 远离绑定分支
  - 除非由批准的脚本/工具调用，否则运行 `git worktree add`
- 使用 `writeLog()` 记录所有阻止和警告

此插件应与 `scope-before.ts` 分开，以便工作区策略与角色/路径权限保持正交。

### 6.5 会话插件更新

`.opencode/plugins/session.ts` 当前写入：

```text
session_map(session_id, agent, dag_task_id, domain_id)
```

更新它以也写入：

```text
worktree_id, branch_name
```

源优先级：

1. `FRAMEWORK_WORKTREE_ID` / `FRAMEWORK_BRANCH`
2. 按 `context.worktree` 或 `OPENCODE_ROOT` 数据库查找
3. 仅在咨询模式下自动注册当前工作区
4. 在严格/锁定模式下，当不存在绑定时阻止

### 6.6 调度更新

当前的 `dispatch_queue` 租用逻辑仅按 `agent_type` 过滤：

```text
WHERE status = 'pending' AND agent_type = ?
```

使用共享的中央数据库，这必须变成：

```text
WHERE status = 'pending' AND agent_type = ? AND worktree_id = ?
```

所有调度队列写入和读取必须携带 `worktree_id`。

如果没有此更改，调度相同代理类型的两个会话工作区可能会消费彼此的队列提示。

---
## 7. 配置

添加到 `.opencode/project.config.json`：

```json
{
  "worktree_policy": {
    "enabled": false,
    "mode": "top_level_session",
    "main_worktree": "/home/zhaoge/workspace/opencode/develop",
    "base_branch": "develop",
    "remote": "opencode-framework",
    "session_worktree_root": "/home/zhaoge/workspace/opencode/sessions",
    "branch_prefix": "oc/session",
    "subagent_policy": "inherit_parent_worktree",
    "db_mode": "central_worktree_scoped",
    "central_db_path": "/home/zhaoge/workspace/opencode/.opencode-runtime/framework-state.db",
    "require_clean_base": true,
    "allow_auto_fetch": false,
    "max_active_worktrees": 8,
    "stale_after_hours": 48,
    "delete_after_merge": false,
    "schema_migration_branch": "develop"
  }
}
```

保持它禁用以便第一次代码合并。仅在自我测试和 E2E 证明绑定安全后启用。

为了通用性，绝对默认值应该由设置/引导程序生成，而不是硬编码到模板项目中。此仓库可以使用上面的显式路径。

---

## 8. 操作流程

### 8.1 创建新的顶层会话

```text
用户启动新任务
  -> 运行 worktree-session create
  -> 从 develop 创建分支
  -> 在 sessions/ 下创建工作区
  -> 注册 worktree_registry 行
  -> 使用 OPENCODE_ROOT 和 FRAMEWORK_WORKTREE_ID 启动 OpenCode
  -> session.ts 将 OpenCode sessionID 绑定到 worktree_id
  -> 所有子代理继承父工作区
```

### 8.2 调度子代理

```text
父会话在工作区 W 中调度子代理
  -> dispatch_subagent 写入数据库队列行，worktree_id=W
  -> task-before 仅租用 W 的行
  -> task-after 写入 session_log/session_map，worktree_id=W
  -> HANDOVER/TASK_LOG 保留在 W/.task_temp/<taskId>/
```

### 8.3 提交和合并

正常提交发生在会话工作区/分支内部，并保留现有钩子：

```bash
git -C <会话工作区> status
git -C <会话工作区> add ...
git -C <会话工作区> commit -m "[Green] TASK-ID ..."
```

关闭流程：

```text
worktree-session close --session <ses_*> --mode merge
  -> 验证门禁完成
  -> 验证自我测试/医生或任务特定检查
  -> 验证分支领先于基础或干净
  -> 记录合并提交
  -> 将注册表行标记为合并/归档
  -> 可选地清理工作区
```

优先通过 PR/合并到 develop 而不是直接快进，直到工作流程被证明。

---

## 9. 子系统影响

| 子系统 | 必需处理 |
|---|---|
| 布局架构系统 | 工作区运行时文件必须保留在跟踪的布局之外；`.opencode/` 在每个工作区中保持项目本地 |
| 权限矩阵系统 | 在现有的 `safe_edit`/`safe_shell` 权限检查旁边添加工作区守卫；使用 OpenCode `external_directory` 拒绝/询问模型 |
| 并发会话/调度写入系统 | 向调度队列/上下文添加 `worktree_id` 并按工作区过滤租用 |
| 强化执行系统 | 当会话/工作区/分支绑定缺失或不匹配时阻止写入 |
| 线束系统 | 添加临时仓库 Git 工作区 E2E 测试和多工作区调度测试 |
| 中央状态管理 | 在数据库中存储绑定；避免原始 JSON 会话注册表 |
| 多智能体系统 | 子代理在 P1 中继承父工作区；可选的每子代理工作区需要稍后的合并队列 |
| 日志中央管理系统 | 为工作区相关事件向日志负载添加 `worktree_id` 和分支 |
| 数据库管理系统 | 添加架构 v18+；中央数据库迁移守卫；绝不要复制 WAL 数据库文件 |
| 模板化和参数化 | 将路径和策略放在 `project.config.json` 中；在设置期间生成绝对默认值 |
| 基于 TypeScript 和 Bun 的系统 | 使用 Bun 和 `@opencode-ai/plugin` `tool()` 助手实现为 TS 库/脚本/工具 |

---

## 10. 主要风险和缓解措施

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 新工作区中缺少被忽略的 `booking_system_refactor/` | 业务代理无法编辑/测试业务代码 | 追踪业务代码，在引导程序中挂载/复制它，或限制工作区模式用于框架任务 |
| 共享中央数据库队列交叉消费 | 错误的子代理消费错误的提示 | 向调度队列添加 `worktree_id` 并在启用中央数据库模式之前按工作区过滤租用查询 |
| 会话分支的架构突变 | 一个分支可以为所有会话更改数据库 | 仅限主分支的迁移守卫 |
| 已在错误目录中创建的 OpenCode 会话 | 无法安全透明地移动进程 | 使用会话前包装器；插件仅阻止/警告 |
| 新工作区中钩子路径不匹配 | 提交绕过本地钩子策略 | 引导程序运行 `git config core.hooksPath .opencode/hooks`；医生/自我测试验证 |
| 父 `.git/worktrees` 不可写 | 工作区创建/获取失败 | 预先检查父 gitdir 在创建/获取之前的可写性 |
| node_modules 不存在 | 测试/构建在新工作区中失败 | 依赖 Bun 缓存，但根据需要每个工作区运行安装/引导程序 |
| read_audit 中的绝对路径 | 来自一个工作区的读取可能与另一个混淆 | 存储 `worktree_id` 和 `relative_file_path`；通过会话绑定验证 |
| 太多过时的工作区/分支 | 磁盘和分支混乱 | 数据库清理程序和显式关闭/归档策略 |

---
## 11. 实施计划

### Phase 0 - 策略和可观察性

1. 将 `worktree_policy` 添加到 `.opencode/project.config.json` 并设置 `enabled=false`。
2. 添加架构 v18 表 `worktree_registry` 和 `worktree_locks`。
3. 在 `.opencode/lib/worktree-manager.ts` 中添加数据库辅助函数。
4. 添加医生/自我测试只读检查：
   - 主工作区存在
   - 基础分支存在
   - 会话工作区根目录在任何 Git 工作区之外
   - `core.hooksPath` 是 `.opencode/hooks`
   - 活动注册表行指向存在的工作区

### Phase 1 - 引导程序创建/恢复

1. 添加 `.opencode/scripts/worktree-session.ts`。
2. 实现 `create`、`status`、`close --dry-run` 和 `prune --dry-run`。
3. 生成分支/工作区并注册数据库行。
4. 提供包装命令，使用以下内容启动 OpenCode：

```bash
OPENCODE_ROOT=<会话工作区>
FRAMEWORK_DB_PATH=<中央数据库>
FRAMEWORK_WORKTREE_ID=<工作区id>
FRAMEWORK_BRANCH=<分支>
```

5. 暂不强制执行；仅记录不匹配情况。

### Phase 2 - 强制执行

1. 将 `worktree_id` 和 `branch_name` 添加到 `session_map`、`session_log` 和 `gate_sessions`。
2. 更新 `session.ts` 以将 OpenCode `sessionID` 绑定到当前工作区。
3. 添加 `worktree-guard-before.ts`：
   - 咨询模式仅记录
   - 严格模式在绑定不匹配时阻止修改工具
   - 锁定模式阻止所有未绑定的写入
4. 扩展 `git-guard-before.ts`/`hook-config-guard.ts` 或在新守卫中为 `git switch`、`git checkout`、`git branch -D` 和 `git worktree remove` 添加规则。

### Phase 3 - 调度和读取/审批作用域

1. 将 `worktree_id` 添加到调度表和数据库 API。
2. 将出队/消费查询更改为按 `worktree_id` 过滤。
3. 将 `worktree_id` 和 `relative_file_path` 添加到 `read_audit`。
4. 更新 `recordRead()`、`verifyRead()` 和 `getReadEventsForSession()` 以优先使用会话绑定的工作区检查。
5. 将 `worktree_id` 添加到 `approval_read_context`。

### Phase 4 - 关闭/合并生命周期

1. 实现 `worktree-session close --mode archive`。
2. 首先将 `close --mode merge` 实现为干运行：
   - 验证门禁完成
   - 验证没有等待审批的已交付会话
   - 验证分支领先于基础或干净
   - 生成合并计划
3. 稍后通过 CI-CD-Agent/GitHub 工具添加可选的 PR 创建。
4. 为过时的归档工作区添加清理程序。

### Phase 5 - 可选的每子代理工作区

仅在 Phase 1-4 稳定后才考虑。

必需添加：

- 每个子代理一个分支
- 从 DAG 派生的分支合并顺序
- 通过 DB 而非仅 `.task_temp` 提升的交接制品
- 冲突解决策略
- Guardian/Arbiter 对合并差异的审查

这是一个单独的架构，而不是一个小的扩展。

---

## 12. 验证计划

### 单元测试

- `worktree-manager.test.ts`：分支名生成、注册表插入/更新、锁过期
- `db-manager` 架构测试：v18 表和索引存在
- `session` 插件测试：将工作区绑定写入 `session_map`
- `dispatch-db` 测试：具有相同代理类型的两个工作区不能消费彼此的队列行
- `read-audit` 测试：两个工作区中相同的相对路径通过 `worktree_id` 保持不同

### E2E 线束

使用临时 Git 仓库：

1. 使用 `develop` 初始化仓库
2. 添加 `.opencode/` 最小化夹具
3. 创建两个会话工作区
4. 在两个中调度相同的代理类型
5. 验证队列租用保持隔离
6. 验证阻止绑定工作区之外的写入
7. 验证关闭/归档更新数据库

### 自我测试/医生检查

添加框架检查：

- 工作区策略解析
- 注册表架构
- 活动注册表路径存在
- 分支/工作区唯一性
- 调度队列具有工作区作用域
- read_audit 具有工作区作用域
- 当强制执行启用时，当前会话绑定匹配 cwd

---

## 13. 推荐推出

不要一步到位全局启用。

推荐顺序：

1. 实现注册表和创建/状态工具，设置 `enabled=false`。
2. 从 `develop` 手动创建一个测试工作区。
3. 在该工作区内部运行框架自我测试和医生。
4. 为工作区守卫启用咨询模式。
5. 运行两个并行工作区并验证调度/读取/门禁隔离。
6. 为调度/读取表添加数据库作用域。
7. 为修改工具启用严格模式。
8. 只有那时才将每顶层会话的工作区作为默认入口路径。

---

## 14. 最终建议

继续这个想法，但这样实现：

```text
main worktree develop
top-level session -> dedicated branch + dedicated worktree
subagents -> inherit parent worktree
central DB -> worktree-scoped records
plugin guard -> block binding mismatches
wrapper/script -> create and launch sessions
```

不要尝试在第一个版本中使每个子代理会话成为单独的分支。那将需要一个更大的分支-合并编排层，并会与当前框架设计发生冲突。
