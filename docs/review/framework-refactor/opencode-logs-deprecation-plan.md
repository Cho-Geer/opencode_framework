# .opencode/logs 作废与日志统一方案

**版本**: v1.0.0
**日期**: 2026-06-25
**作者**: @Super-Admin
**状态**: 待实施

---

## 1. 背景与目标

### 1.1 问题

框架当前存在两套并存的日志系统：

| 系统         | 路径                           | 写入者                          | 用途                | DB-canonical |
| ------------ | ------------------------------ | ------------------------------- | ------------------- | :----------: |
| 旧文件日志   | `.opencode/logs/safe-bash.log` | `log-rotator.ts` 轮转           | safe_shell 命令审计 |      ❌      |
| 框架统一日志 | `.task_temp/_logs/`            | `writeLog()` → `log-manager.ts` | 所有框架事件        |      ✅      |

`.opencode/logs/` 违反框架 DB-only / DB-canonical 原则：

- `safe-bash.log` 是纯文件追加日志，没有走 DB
- `state-manager.ts:204` 硬编码路径 `".opencode/logs/safe-bash.log"`
- `log-rotator.ts:376` 直接做文件轮转
- 一条命令一次写入，没有 DB 表

### 1.2 关键发现

`safe-bash-core.ts:529` 的 `logAction()` **已经调用 `writeLog("safe-bash", "INFO", {...})`**。safe_shell 的审计事件已经通过 `writeLog()` 写入 `.task_temp/_logs/`。

`.opencode/logs/safe-bash.log` 是**残留的旧文件日志**，当前没有任何代码直接向它 append 内容——只有 `log-rotator.ts` 在轮转一个已经不再被写入的文件。

### 1.3 目标

1. 作废 `.opencode/logs/` 目录
2. 所有日志统一走 `writeLog()` → `.task_temp/_logs/`
3. 删除旧文件日志相关的代码、脚本、常量
4. 符合 12 个子系统规范

---

## 2. 受影响文件清单

| #   | 文件                                   | 行号      | 当前引用                                                                                      | 修改内容                          |
| --- | -------------------------------------- | --------- | --------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | `lib/state-manager.ts`                 | 204, 206  | `SAFE_BASH_LOG: ".opencode/logs/safe-bash.log"` / `LOG_ARCHIVE_DIR: ".opencode/logs/archive"` | 删除这两个常量                    |
| 2   | `lib/log-rotator.ts`                   | 374-377   | `rotateSafeBashLogIfNeeded()` 硬编码 `.opencode/logs/safe-bash.log`                           | 删除该函数                        |
| 3   | `lib/tool-scope.ts`                    | 432       | `rel.startsWith(".opencode/logs/")` 排除路径                                                  | 改为 `.task_temp/_logs/`          |
| 4   | `scripts/rotate-logs.ts`               | 全文      | 整个脚本轮转 `.opencode/logs/safe-bash.log`                                                   | 删除该脚本                        |
| 5   | `scripts/monitoring-status.ts`         | 8, 19     | 读取 `.opencode/logs/safe-bash.log` 大小                                                      | 改为读取 `.task_temp/_logs/` 统计 |
| 6   | `scripts/framework-self-test.ts`       | 5118-5119 | 检查 preamble 引用 `.opencode/logs/`                                                          | 改为检查 `.task_temp/_logs/`      |
| 7   | `scripts/mcp-tools/compliance-gate.ts` | 2222-2223 | `## Logs Checked` 路径列表含 `.opencode/logs/`                                                | 改为 `.task_temp/_logs/`          |
| 8   | `lib/__tests__/state-manager.test.ts`  | 247-248   | 测试 `SAFE_BASH_LOG` / `LOG_ARCHIVE_DIR` 存在                                                 | 删除这两个断言                    |

---

## 3. 子系统合规

| 子系统                       | 合规措施                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layout Architecture**      | 删除 `.opencode/logs/` 目录；所有日志统一在 `.task_temp/_logs/`（已在 `.gitignore`）                                                                |
| **DB-only / DB-canonical**   | `writeLog()` 已是唯一日志写入入口；删除旧文件日志后无文件直写残留                                                                                   |
| **Permission Matrix**        | `opencode.json` 不变；`tool-scope.ts` 路径排除从 `.opencode/logs/` 改为 `.task_temp/_logs/`                                                         |
| **Session Concurrency Safe** | `writeLog()` 已有 buffer + flush 机制（`log-manager.ts:127-128`），并发安全；旧 `appendFileSync` 轮转删除后无竞态                                   |
| **Hardened Enforcement**     | `logAction()` 已通过 `writeLog()` 记录所有 safe_shell 执行（含 blocked）；删除旧文件不影响审计完整性                                                |
| **Framework Harness**        | `framework-self-test.ts` 检查路径改为 `.task_temp/_logs/`；`monitoring-status.ts` 改为读取新路径                                                    |
| **Central State Management** | 不涉及 `machine.json` / `gate-state.json` 变更                                                                                                      |
| **Multi-Agent**              | `writeLog()` 已支持 `sessionID` / `agent` / `callID` 字段；旧文件日志无 session 隔离                                                                |
| **Log Central Management**   | 所有日志源统一走 `writeLog(source, category, fields)` → `.task_temp/_logs/{date}/plugin-{source}-runtime.log`；删除 `log-rotator.ts` 的独立轮转逻辑 |
| **DB-canonical Management**  | 不涉及 DB schema 变更；日志是诊断索引，DB 事件由 `audit_log` 表管理                                                                                 |
| **Templatization**           | `project.config.json.template_resolution.logs.*` 已有配置项（`logs.dir`、`logs.retention_days` 等）；`writeLog()` 已读取这些配置                    |
| **TypeScript + Bun**         | 纯 TS 修改，无运行时依赖变更                                                                                                                        |

---

## 4. 实施步骤

### Step 1: 删除旧常量

**文件**: `.opencode/lib/state-manager.ts`

删除 `STATE_PATHS` 中的两个常量：

```typescript
// 删除：
SAFE_BASH_LOG: ".opencode/logs/safe-bash.log",
LOG_ARCHIVE_DIR: ".opencode/logs/archive",
```

### Step 2: 删除旧轮转函数

**文件**: `.opencode/lib/log-rotator.ts`

删除 `rotateSafeBashLogIfNeeded()` 函数（lines 374-377）：

```typescript
// 删除整个函数：
export async function rotateSafeBashLogIfNeeded(): Promise<RotationResult> {
  const rotator = new LogRotator();
  return rotator.rotateIfNeeded(".opencode/logs/safe-bash.log");
}
```

### Step 3: 更新路径排除

**文件**: `.opencode/lib/tool-scope.ts:432`

```typescript
// 旧：
if (rel.startsWith(".opencode/logs/") || rel.startsWith("logs/")) return true;

// 新：
if (rel.startsWith(".task_temp/_logs/") || rel.startsWith("task_temp/_logs/"))
  return true;
```

### Step 4: 删除轮转脚本

**文件**: `.opencode/scripts/rotate-logs.ts`

删除整个文件。该脚本的唯一功能是轮转 `.opencode/logs/safe-bash.log`，作废后不再需要。

### Step 5: 更新监控脚本

**文件**: `.opencode/scripts/monitoring-status.ts`

```typescript
// 旧：
const LOGS = join(ROOT, '.opencode/logs');
// ...
logs: { safe_bash_size: sz(join(LOGS,'safe-bash.log')), ... }

// 新：
const LOGS = join(ROOT, '.task_temp/_logs');
// ...
logs: { log_dir_size: dirSize(LOGS), log_files: countFiles(LOGS) }
```

### Step 6: 更新自测检查

**文件**: `.opencode/scripts/framework-self-test.ts:5118-5119`

```typescript
// 旧：
if (!/.opencode\/logs/.test(preamble)) {
  issues.push(".opencode/logs/ not referenced");
}

// 新：
if (!/.task_temp\/_logs/.test(preamble)) {
  issues.push(".task_temp/_logs/ not referenced");
}
```

### Step 7: 更新合规门日志路径

**文件**: `.opencode/scripts/mcp-tools/compliance-gate.ts:2222-2223`

```typescript
// 旧：
const logPaths = [
  ".opencode/logs/",
  ".opencode/logs/mcp-compliance-gate/",
  ".opencode/state/gate-state.json",
  // ...

// 新：
const logPaths = [
  ".task_temp/_logs/",
  ".opencode/state/gate-state.json",
  // ...
```

### Step 8: 更新测试断言

**文件**: `.opencode/lib/__tests__/state-manager.test.ts:247-248`

删除以下两个断言：

```typescript
// 删除：
expect(STATE_PATHS).toHaveProperty("SAFE_BASH_LOG");
expect(STATE_PATHS).toHaveProperty("LOG_ARCHIVE_DIR");
```

### Step 9: 删除旧目录

手动删除 `.opencode/logs/` 目录：

```bash
rm -rf .opencode/logs/
```

### Step 10: 验证

```bash
bun --no-cache .opencode/scripts/framework-self-test.ts
```

---

## 5. 验收标准

| #   | 验收项                                                   | 预期   |
| --- | -------------------------------------------------------- | ------ |
| 1   | `.opencode/logs/` 目录不存在                             | ✅     |
| 2   | `grep -rn 'opencode/logs' .opencode/ --include='*.ts'`   | 0 结果 |
| 3   | `grep -rn 'SAFE_BASH_LOG' .opencode/ --include='*.ts'`   | 0 结果 |
| 4   | `grep -rn 'LOG_ARCHIVE_DIR' .opencode/ --include='*.ts'` | 0 结果 |
| 5   | `safe_shell` 执行后 `.task_temp/_logs/` 有新日志         | ✅     |
| 6   | `framework-self-test.ts` 全部通过                        | ✅     |
| 7   | `monitoring-status.ts` 输出 `.task_temp/_logs/` 统计     | ✅     |

---

## 6. 风险评估

| 风险                              | 概率 | 影响 | 缓解                                                                                                                   |
| --------------------------------- | ---- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| 旧日志文件中有未归档的审计数据    | 低   | 低   | `writeLog()` 已记录所有事件到 `.task_temp/_logs/`，旧文件是冗余的                                                      |
| `log-rotator.ts` 被其他模块引用   | 低   | 中   | grep 确认只有 `rotateSafeBashLogIfNeeded` 引用 `.opencode/logs/`；`LogRotator` 类本身保留，只是删除 safe-bash 专用函数 |
| `monitoring-status.ts` 依赖旧路径 | 中   | 低   | Step 5 已更新为新路径                                                                                                  |

---

## 7. 相关文档

| 文档                                             | 关系                                  |
| ------------------------------------------------ | ------------------------------------- |
| `backup-manager-implementation-plan-v2.md`       | §2.9 定义了 DB-only 日志规范          |
| `db-canonical-p0-checklist-optimization-plan.md` | §3.3 定义了 `writeLog()` 统一日志要求 |
