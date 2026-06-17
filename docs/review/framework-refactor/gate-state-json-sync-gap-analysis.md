# gate-state.json Post-Step-8 同步断裂分析报告

**日期**: 2026-06-17
**状态**: ✅ 修复完成
**影响范围**: 4 HIGH + 2 MEDIUM 严重级运行时功能缺陷（已全部修复）
**验证结果**: framework-self-test 39/40 PASS（仅 Check 33 预先存在的 .pending.json 过期条目失败，与 DB 迁移无关）

---

## 一、根因

P2-A Step 8 完成 DB-only 迁移后，`gate-core.saveGateStore()` 仅写 DB（注释明确："JSON dual-write removed"）。但以下组件仍直接读磁盘 `gate-state.json`（v3.0 格式 `active_sessions`）：

| 写入路径 | 目标 | 状态 |
|---------|------|:----:|
| `compliance_gate_confirm` → `armSession()` → `dbSaveGateStore()` | DB | ✅ 正常 |
| `saveGateStore()` (gate-core) | DB-only | ✅ 已迁移 |
| `state-compactor.ts` `writeHotState()` | JSON | ⚠️ 仅在 complete/nightly/drain 时触发 |
| **pre-execution-gate.ts** | **直接读 JSON** | ❌ **永远读到过期数据** |

**核心断裂**：DB 已武装 → JSON 未同步 → pre-execution-gate 找不到 session → `process.exit(1)` 阻断派遣。

---

## 二、影响分析

### 2.1 直接读 JSON 的文件清单

| 文件 | 读取方式 | V3 兼容 | 写 JSON | 严重级 |
|------|---------|:------:|:------:|:-----:|
| `scripts/pre-execution-gate.ts` | `readJSON(GATE_STATE_FILE)` | ❌ 前版有 bug | 否 | **HIGH** |
| `hooks/lib/hook-layers.ts:69` | `readFileSync` → `JSON.parse` | ❌ 前版有 bug | 否 | **HIGH** |
| `lib/gate-checks.ts:182-216` | `readJsonFile` | ❌ 前版有 bug | **是** (line 216) | **HIGH** |
| `scripts/gate-lifecycle-audit.ts` | `readJsonFile` | ❌ 前版有 bug | **是** (line 177) | **HIGH** |
| `scripts/state-reconciliation.ts:672` | `readJson` | ❌ 前版有 bug | 潜在 | **HIGH** |
| `scripts/framework-compliance-check.ts:72` | `readJsonFile` | ❌ 前版有 bug | 否 | MEDIUM |
| `scripts/state-integrity-scan.ts:66` | `readJsonFile` | ❌ 前版有 bug | 否 | MEDIUM |
| `scripts/framework-self-test.ts` | 仅检查文件存在 | ✅ N/A | 否 | LOW |
| `scripts/monitoring-status.ts` | 仅读文件大小 | ✅ N/A | 否 | LOW |

### 2.2 已正确使用 DB API 的文件（无问题）

| 文件 | API |
|------|-----|
| `plugins/audit-after.ts` | `atomicWriteSubState("write_audit_state")` |
| `plugins/cache-after.ts` | `atomicWriteSubState("knowledge_cache_state")` |
| `plugins/scope-after.ts` | `atomicWriteSubState("eslint_state")` |
| `plugins/uc7ks-after.ts` | `atomicWriteSubState("knowledge_cache_state")` |
| `scripts/mcp-tools/code-quality-gate.ts` | `readSubState()`, `readMachineMeta()` |
| `lib/gate-core.ts` (main path) | `loadGateStore()` (DB-first) |
| `scripts/pre-execution-gate.ts` | `dbLoadGateStore()` (本次已修复) |

### 2.3 设计正确的 fallback 路径（无需修改）

| 文件 | 角色 |
|------|------|
| `gate-core.ts` `loadGateStoreJson()` | DB 不可用时的意向性 fallback |
| `compliance-gate.ts` `loadStore()` fallback | gate-core 导入失败时的兼容 shim |

---

## 三、HIGH 严重级详细分析

### 3.1 `hooks/lib/hook-layers.ts:69` — 预提交门禁

**风险**：Layer 0 从 JSON 读 `active_sessions` 判定是否允许 commit。DB 已武装但 JSON 未同步 → 误阻断合法提交。

**修复**：改用 `loadGateStore()` 或 `dbLoadGateStore()` 读取。

### 3.2 `lib/gate-checks.ts:182-216` — autoDrainStaleSessions

**风险**：**直接写 JSON**（line 216 `writeFileSync`），绕过 DB。可覆盖更新的 DB 状态，造成数据损坏。

**修复**：
- 读：改用 `dbLoadGateStore()`
- 写：改用 `dbSaveGateStore()` + `dbArchiveDrainedSession()`

### 3.3 `scripts/gate-lifecycle-audit.ts` — auto-drain 模式

**风险**：同上，auto-drain 模式直接写 JSON（line 177），数据丢失向量。

**修复**：同 3.2。

### 3.4 `scripts/state-reconciliation.ts:672` — 状态修复工具

**风险**：修复工具操作过期 JSON，可能基于过时数据做出错误修复决策。

**修复**：
- 读：改用 `loadGateStore()` / `readSubState()`
- 写：改用 `dbSaveGateStore()` / `dbWriteSubState()`

---

## 四、MEDIUM 严重级详细分析

### 4.1 `scripts/framework-compliance-check.ts:72`

**影响**：合规报告基于过期 JSON，可能产生 false-negative（漏报 armed session）或 false-positive（报告已 drained 的 session 为 active）。

**修复优先级**：中。诊断工具，不影响运行时功能。

### 4.2 `scripts/state-integrity-scan.ts:66`

**影响**：完整性扫描基于过期 JSON，结果误导性（报告"不一致"实为 DB 与 JSON 不同步）。

**修复优先级**：中。调试工具，不阻断执行。

---

## 五、修复策略

### 5.1 统一修复模式

所有直接读 `gate-state.json` 的代码替换为：

```typescript
// 旧：直接读磁盘 JSON（过期）
const gs = readJSON(GATE_STATE_FILE);
const sessions = gs.data.sessions || gs.data.active_sessions || {};

// 新：读 DB（单一数据源）
import { dbLoadGateStore } from "../lib/db-state-manager";
const store = dbLoadGateStore();
const sessions = store.sessions || {};
```

对于写操作：

```typescript
// 旧：直接写 JSON（绕过 DB）
fs.writeFileSync(gatePath, JSON.stringify(data));

// 新：写 DB
import { dbSaveGateStore, dbArchiveDrainedSession } from "../lib/db-state-manager";
dbSaveGateStore(store);
// 如需归档 drained session：
dbArchiveDrainedSession(sessionId, reason, data);
```

### 5.2 修复顺序（按严重级）

1. `hooks/lib/hook-layers.ts` — 阻断提交的预提交门禁
2. `lib/gate-checks.ts` — autoDrain 写 JSON 的数据损坏风险
3. `scripts/gate-lifecycle-audit.ts` — 同上
4. `scripts/state-reconciliation.ts` — 状态修复工具
5. `scripts/framework-compliance-check.ts` — 合规报告
6. `scripts/state-integrity-scan.ts` — 完整性扫描

### 5.3 验证方法

修复后运行：
1. `bun .opencode/scripts/framework-self-test.ts` — 确认 37/40+ PASS，零新增回归
2. `bun .opencode/scripts/framework-doctor.ts` — 确认 Check 6 PASS（无未提交变更）
3. 手动触发 `compliance_gate_confirm` + `dispatch_subagent` — 确认派遣不再被阻断

---

## 六、相关文件

- `database-migration-plan.md` — P2-A DB 迁移方案（Step 8 DB-only 策略）
- `framework-evaluation-report.md` — 框架评估报告（DB schema v7, 16 张表）
- `gate-stuck-fix-and-deliverables-plan.md` — 合规门卡死修复方案（含 deliverables 硬约束）
