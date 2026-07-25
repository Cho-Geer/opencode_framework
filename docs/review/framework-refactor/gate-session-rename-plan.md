# Gate Session 重命名修复计划

**版本**: v1.0.0
**日期**: 2026-06-23
**作者**: @Super-Admin
**状态**: ✅ 完成

---

## 执行记录

| 文件                                   | 变更数                 | 状态                         |
| -------------------------------------- | ---------------------- | ---------------------------- |
| `lib/gate-core.ts`                     | ~18 patches            | ✅ 完成                      |
| `plugins/gate-before.ts`               | 4 patches              | ✅ 完成                      |
| `lib/__tests__/gate-core.test.ts`      | 2 patches              | ⚠️ 部分（需补充）            |
| `scripts/mcp-tools/compliance-gate.ts` | ~50 处                 | ❌ 未开始（3500 行独立副本） |
| `hooks/lib/hook-layers.ts`             | 2                      | ❌ 未开始                    |
| `hooks/lib/hook-commit-msg.ts`         | 1                      | ❌ 未开始                    |
| `plugins/task-after.ts`                | 1 (`findArmedSession`) | ⚠️ 返回值字段名变更          |
| `plugins/dispatch-before.ts`           | 1 (DB 查询)            | ❌ 未开始                    |

### gate-core.ts 已完成的变更

| 旧                             | 新                                 |
| ------------------------------ | ---------------------------------- |
| `GateSession.session_id`       | `GateSession.gate_session_id`      |
| `createSession()`              | `createGateSession()`              |
| `armSession()`                 | `armGateSession()`                 |
| `completeSession()`            | `completeGateSession()`            |
| `generateSessionId()`          | `generateGateSessionId()`          |
| `findArmedSession().sessionId` | `findArmedSession().gateSessionId` |
| 内部 `sessionId` 变量          | `gateSessionId`                    |
| `.session_id` 字段访问         | `.gate_session_id`（带回退兼容）   |

---

## 目标

```
OpenCode session → sessionID (代码) / session_id (DB)
Gate session     → gateSessionId (代码) / gate_session_id (DB)
```

---

## 变更映射

### gate-core.ts（底层库 —— 31+ 文件依赖）

| 旧名称                         | 新名称                             | 类型       |
| ------------------------------ | ---------------------------------- | ---------- |
| `GateSession.session_id`       | `GateSession.gate_session_id`      | 接口字段   |
| `createSession()`              | `createGateSession()`              | 导出函数   |
| `armSession()`                 | `armGateSession()`                 | 导出函数   |
| `completeSession()`            | `completeGateSession()`            | 导出函数   |
| `generateSessionId()`          | `generateGateSessionId()`          | 内部函数   |
| `findArmedSession().sessionId` | `findArmedSession().gateSessionId` | 返回值字段 |
| `sessionId`（局部变量）        | `gateSessionId`                    | 局部变量   |
| `GateCheckItem` 相关           | 不变                               |            |
| `GateConfirmResult.session_id` | `gate_session_id`                  | 接口字段   |

### gate-before.ts（4 个引用）

| 旧                                     | 新                                             |
| -------------------------------------- | ---------------------------------------------- |
| `import { createSession, armSession }` | `import { createGateSession, armGateSession }` |
| `createSession(...)`                   | `createGateSession(...)`                       |
| `armSession(...)`                      | `armGateSession(...)`                          |
| `session.session_id`                   | `session.gate_session_id`                      |

### compliance-gate.ts（约 50 个引用 —— 独立复制的代码）

| 旧                       | 新                      |
| ------------------------ | ----------------------- |
| `session_id` (变量)      | `gate_session_id`       |
| `createSession` 调用     | `createGateSession`     |
| `armSession` 调用        | `armGateSession`        |
| `completeSession` 调用   | `completeGateSession`   |
| `generateSessionId` 调用 | `generateGateSessionId` |
| `cg_ses_` 前缀           | 不变（运行时值）        |

### hook-layers.ts（2 个引用）

| 旧                             | 新                                 |
| ------------------------------ | ---------------------------------- |
| `import { findArmedSession }`  | 不变                               |
| `findArmedSession().sessionId` | `findArmedSession().gateSessionId` |

### hook-commit-msg.ts（1 个引用）

| 旧                             | 新                                 |
| ------------------------------ | ---------------------------------- |
| `import { findArmedSession }`  | 不变                               |
| `findArmedSession().sessionId` | `findArmedSession().gateSessionId` |

### dispatch-before.ts（1 个引用 —— DB 查询）

| 旧                                     | 新                                           |
| -------------------------------------- | -------------------------------------------- |
| `SELECT session_id FROM gate_sessions` | 不变（DB 列名可保留在有 `gate_` 前缀的表中） |

### pre-execution-gate.ts（3 个引用 —— 不变）

| 旧                      | 新   |
| ----------------------- | ---- |
| 已正确使用 gate session | 不变 |

---

## 执行顺序

1. ✅ `gate-core.ts` —— 底层类型和函数重命名
2. `gate-before.ts` —— 直接消费者
3. `compliance-gate.ts` —— 独立副本需逐一修改
4. `hook-layers.ts` / `hook-commit-msg.ts` —— 返回值字段
5. `db-state-manager.ts` —— DB 列名（可选，gate_sessions 表已有 gate 前缀）
