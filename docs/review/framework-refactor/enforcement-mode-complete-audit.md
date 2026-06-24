# Enforcement Mode 全量审计

**版本**: v1.0.0  
**调查日期**: 2026-06-23  
**调查 Agent**: @Super-Admin  
**状态**: 调查完成  
**范围**: `.opencode/` 框架全部 TS 文件  
**来源**: `parameter-name-confusion-audit.md` §5 — 5 种写法

---

## §1 5 种写法的完整视图

审计确认 **6 种变体**（原先估计 5 种）：

| #   | 写法                       | 用途                                   | 示例                                                                     |
| --- | -------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| 1   | `ENFORCEMENT_MODE`         | env var（运行时覆盖，最高优先级）      | `process.env.ENFORCEMENT_MODE`                                           |
| 2   | `develop_enforcement_mode` | `project.config.json`（本地开发）      | `template_resolution.develop_enforcement_mode`                           |
| 3   | `runtime_enforcement_mode` | `project.config.json`（CI/生产）       | `template_resolution.runtime_enforcement_mode`                           |
| 4   | `enforcement_mode`         | DB 列 / legacy config key / 日志 label | `gate_sessions.enforcement_mode`, `template_resolution.enforcement_mode` |
| 5   | `enforcementMode`          | camelCase 局部变量 / 函数参数          | `const enforcementMode = getEnforcementMode()`                           |
| 6   | `mode`                     | 局部变量简写（最常见）                 | `const mode = getEnforcementMode()`                                      |

## §2 解析路径

### 2.1 权威函数：`getEnforcementMode(root?)`

**文件**: `lib/gate-core.ts` L332

```
Priority 1:  process.env.ENFORCEMENT_MODE    (env var override)
Priority 2:  develop_enforcement_mode         (project.config.json — primary)
Priority 3:  runtime_enforcement_mode         (project.config.json — fallback)
Priority 4:  "advisory"                       (default)

Locked 保护: configMode === "locked" → env var 无法覆盖
```

**调用者**: **22 个模块**（15 plugins + 3 MCP tools + 2 hooks + 2 scripts）

### 2.2 duped 副本函数

| 文件                                        | 函数                   | 说明                                            |
| ------------------------------------------- | ---------------------- | ----------------------------------------------- |
| `lib/gate-core.ts` L332                     | `getEnforcementMode()` | **权威实现**                                    |
| `scripts/pre-execution-gate.ts` L177        | `getEnforcementMode()` | **独立副本**（独立进程，不能 import gate-core） |
| `scripts/mcp-tools/compliance-gate.ts` L419 | `getEnforcementMode()` | **独立副本**（MCP server 独立进程）             |
| `lib/dag-policy.ts` L169                    | `isLockedMode()`       | 简化的 singleton 查询                           |

**4 个地方分别实现了相同的逻辑**，`compliance-gate.ts` 的副本会尝试 lazyload gate-core。

### 2.3 直接读取（绕过 getEnforcementMode）

| 文件                                         | 说明                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `tools/dispatch_subagent.ts` L463            | 直接读 `c?.template_resolution?.develop_enforcement_mode`               |
| `scripts/framework-doctor.ts` L1258          | 直接读 `tr.develop_enforcement_mode`                                    |
| `scripts/framework-compliance-check.ts` L256 | 直接读 `tr.runtime / develop / enforcement_mode`                        |
| `scripts/ci-semantic-validator.ts` L297      | 直接读 `develop` + `runtime` 双键                                       |
| `plugins/json-validate.ts` L34               | 直接引用键名 `["develop_enforcement_mode", "runtime_enforcement_mode"]` |

## §3 使用模式分类

### 3.1 模式感知的阻断/警告（最常见）

**模式**: `if (mode === "strict" || mode === "locked")` → 阻断  
**模式**: `if (mode === "advisory")` → 仅警告

出现频次极高的模式：

```typescript
const mode = getEnforcementMode();
if (mode !== "advisory") {
  throw new Error("[FW-ENFORCE] ..."); // 阻断
}
// else: 仅记录日志
```

此模式在 **18 个文件**中重复出现：

| 文件                                         | 使用次数 |
| -------------------------------------------- | -------- |
| `hooks/lib/hook-layers.ts`                   | 14       |
| `hooks/lib/hook-commit-msg.ts`               | 5        |
| `scripts/mcp-tools/compliance-gate.ts`       | 20+      |
| `scripts/pre-execution-gate.ts`              | 10+      |
| `plugins/gate-before.ts`                     | 2        |
| `plugins/scope-before.ts`                    | 4        |
| `plugins/task-before.ts`                     | 2        |
| `plugins/dispatch-before.ts`                 | 1        |
| `plugins/question-policy-before.ts`          | 1        |
| `plugins/uc7ks-before.ts`                    | 1        |
| `plugins/checklist-before.ts`                | 1        |
| `plugins/hook-config-guard.ts`               | 1        |
| `plugins/tdd-before.ts`                      | 1        |
| `plugins/git-guard-before.ts`                | 1        |
| `plugins/uc7ks-after.ts`                     | 2        |
| `tools/dispatch_subagent.ts`                 | 2        |
| `scripts/command-tools/dispatch-subagent.ts` | 1        |
| `lib/uc7ks-utils.ts`                         | 8        |

### 3.2 `enforcement_mode` 作为 DB 字段

`gate_sessions.enforcement_mode` — 每个 gate session 记录创建时的 enforcement mode。

- 写入: `session.enforcement_mode = enforcementMode`（gate-core.ts, compliance-gate.ts）
- 读取: 用于 gate lifecycle audit

### 3.3 `isLockedMode()` 专用查询

`lib/dag-policy.ts` L169 — 只检查是否为 locked 模式：

```typescript
function isLockedMode(): boolean {
  const mode =
    tr.develop_enforcement_mode ||
    tr.runtime_enforcement_mode ||
    tr.enforcement_mode;
  return mode === "locked";
}
```

**调用者**: `auto_plan_enabled` 强制设为 false 在 locked 模式下。

## §4 问题清单

### I1: `getEnforcementMode()` 在 4 个地方重复实现（HIGH）

| 位置                                   | 理由                    |
| -------------------------------------- | ----------------------- |
| `lib/gate-core.ts`                     | 权威实现                |
| `scripts/pre-execution-gate.ts`        | 独立进程副本            |
| `scripts/mcp-tools/compliance-gate.ts` | MCP server 副本         |
| `lib/dag-policy.ts`                    | 简化版 `isLockedMode()` |

`compliance-gate.ts` 和 `pre-execution-gate.ts` 的副本与 `gate-core.ts` 行为相同（包括 locked 保护、env var override），但如果在 gate-core 中修改逻辑，必须同步更新这两处。

### I2: 5 个文件绕过 `getEnforcementMode()` 直接读 config（MED）

直接读取 `develop_enforcement_mode` / `runtime_enforcement_mode` 而不是调用 `getEnforcementMode()`，意味着它们不尊重 `ENFORCEMENT_MODE` env var 覆盖。这是刻意设计（避免 env var 污染）还是遗漏，需要明确。

### I3: `mode` vs `enforcementMode` 变量名混用（LOW）

- 22 个模块用 `const mode = getEnforcementMode()`（简写）
- 3 个模块用 `const enforcementMode = getEnforcementMode()`（全名）

无一致性——同一语句在不同地方使用不同变量名。

### I4: `enforcement_mode` legacy key 仍存在于配置解析链（LOW）

`getEnforcementMode()` 中 `tr.develop_enforcement_mode || tr.runtime_enforcement_mode` 不再包含 legacy `tr.enforcement_mode`。但 2 个文件仍然回退到 legacy key：

- `framework-doctor.ts` L1260: `tr.enforcement_mode`
- `framework-compliance-check.ts` L258: `tr.enforcement_mode`

### I5: `"advisory"` 硬编码为 default（LOW）

`getEnforcementMode()` 默认返回 `"advisory"`，此默认值在 4 个地方重复定义。

## §5 统计

| 指标                                    | 值      |
| --------------------------------------- | ------- |
| 读写 enforcement mode 的模块            | **30+** |
| 调用 `getEnforcementMode()` 的位置      | **22**  |
| `getEnforcementMode()` 的重复实现       | **4**   |
| 绕过 `getEnforcementMode` 直接读 config | **5**   |
| `mode !== "advisory"` 阻断模式出现次数  | **80+** |
| 使用 `mode` 变量名的文件                | **18**  |
| 使用 `enforcementMode` 变量名的文件     | **3**   |

## §6 建议

### 短期

1. **统一变量名**: 所有 `const mode` → `const enfMode`（或保持 `mode` 但记录在规范中）
2. **文档化 `getEnforcementMode` 副本**: 在 `compliance-gate.ts` 和 `pre-execution-gate.ts` 中标注"必须与 gate-core.ts 保持同步"

### 中期

3. **移除 legacy `enforcement_mode` key 回退**: `framework-doctor.ts` 和 `framework-compliance-check.ts` 改用双键

### 长期

4. **提取为共享 npm-like 模块**: 使独立进程（pre-execution-gate, compliance-gate）能直接 import 而非复制

## §7 相关文档

| 文档                                | 关系                            |
| ----------------------------------- | ------------------------------- |
| `parameter-name-confusion-audit.md` | 参数名混淆全量（§5 为本文来源） |
| `enforcement-modes-standard.md`     | Enforcement mode 定义和行为矩阵 |

---

## §8 实施记录

| 操作                            | 文件                    | 说明                        |
| ------------------------------- | ----------------------- | --------------------------- |
| 移除 `\|\| tr.enforcement_mode` | `framework-doctor.ts`   | legacy 回退删除             |
| 移除 `\|\| tr.enforcement_mode` | `compliance-gate.ts`    | legacy 回退删除             |
| 移除 `\|\| tr.enforcement_mode` | `pre-execution-gate.ts` | legacy 回退删除             |
| 移除 `\|\| tr.enforcement_mode` | `dag-policy.ts`         | legacy 回退删除             |
| 更新注释                        | `gate-core.ts`          | 标注 legacy fallback 已移除 |

### 保留的 `enforcement_mode`

- DB 列 `gate_sessions.enforcement_mode` / `session_log.enforcement_mode` — 这是 DB schema，不是 config key，保留不变
- `framework-compliance-check.ts` `id: "enforcement_mode"` — checklist 项目 ID，保留不变

### 命名规则

| 语境                  | 命名                                                    |
| --------------------- | ------------------------------------------------------- |
| `project.config.json` | `develop_enforcement_mode` + `runtime_enforcement_mode` |
| env var               | `ENFORCEMENT_MODE`                                      |
| DB 列                 | `enforcement_mode`                                      |
| TypeScript 变量       | `mode` / `enforcementMode`                              |

---

_审计 v1.1.0 — 移除 legacy enforcement_mode 回退。_
