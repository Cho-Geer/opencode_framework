# Dispatch Context 全量审计

**版本**: v1.0.0  
**调查日期**: 2026-06-23  
**调查 Agent**: @Super-Admin  
**状态**: 调查完成  
**范围**: `.opencode/` 框架全部 TS 文件  
**来源**: `parameter-name-confusion-audit.md` §7 — 4 种写法

---

## §1 写法全景（8 种，远超原先 4 种）

### 1.1 env var 层（6 种）

| #   | env var                      | 用途                             | 写入者                 | 读取者                        |
| --- | ---------------------------- | -------------------------------- | ---------------------- | ----------------------------- |
| 1   | `FRAMEWORK_DISPATCH_CONTEXT` | 标记当前进程处于 dispatch 上下文 | `dispatch_subagent.ts` | hook 层                       |
| 2   | `DISPATCH_TASK_DESC`         | 传递 task_description            | `dispatch_subagent.ts` | `dispatch-subagent.ts` 子进程 |
| 3   | `DISPATCH_NAMESPACE`         | 传递 session namespace（新）     | `dispatch_subagent.ts` | `dispatch-subagent.ts` 子进程 |
| 4   | `DISPATCH_DAG_TASK_ID`       | 传递 DAG task_id（新）           | `dispatch_subagent.ts` | `dispatch-subagent.ts` 子进程 |
| 5   | `DISPATCH_RESUME_SESSION_ID` | session 恢复 ID                  | `dispatch_subagent.ts` | `dispatch-subagent.ts` 子进程 |
| 6   | `DISPATCH_TOKEN`             | 完整性校验 token                 | `dispatch-subagent.ts` | `task-before.ts`              |

### 1.2 文件层（3 种）

| #   | 文件                    | 类型                 | 状态               |
| --- | ----------------------- | -------------------- | ------------------ |
| 7   | `.dispatch_ctx`         | 共享单例（legacy）   | ⚠️ Phase 2 淘汰中  |
| 8   | `ctx/{dagTaskId}.json`  | per-dispatch 隔离    | ✅ 当前标准        |
| 9   | `_dispatch_target.json` | agent 身份（legacy） | ⚠️ Priority 2 回退 |

### 1.3 DB 层（2 种）

| #   | 表                 | 用途                                        |
| --- | ------------------ | ------------------------------------------- |
| 10  | `dispatch_context` | per-dispatch session 上下文（DB-canonical） |
| 11  | `session_map`      | session→agent+dagTask+domain 映射           |

---

## §2 三层 Dispatch Context 架构

```
┌─────────────────────────────────────────────────────────┐
│  LAYER A: Identity                                      │
│  _dispatch_target.json  →  session_map.agent (Priority 1)│
│  (legacy singleton)         (per-session DB)            │
├─────────────────────────────────────────────────────────┤
│  LAYER B: Task/Metadata                                 │
│  .dispatch_ctx           →  ctx/{dagTaskId}.json        │
│  (legacy singleton)         (per-dispatch, race-free)   │
│         ↓                          ↓                    │
│  dispatch_context table (DB-canonical, future)          │
├─────────────────────────────────────────────────────────┤
│  LAYER C: Integrity                                     │
│  DISPATCH_TOKEN           →  dispatch_payload_integrity │
│  (cryptographic hash)        (DB audit record)          │
└─────────────────────────────────────────────────────────┘
```

---

## §3 详细使用点

### 3.1 写入点

| 文件                                                  | 写入内容                                      | 说明                          |
| ----------------------------------------------------- | --------------------------------------------- | ----------------------------- |
| `tools/dispatch_subagent.ts` L273                     | `FRAMEWORK_DISPATCH_CONTEXT = "orchestrated"` | 标记 dispatch 上下文          |
| `tools/dispatch_subagent.ts` L702                     | `.dispatch_ctx` 文件                          | 共享单例 dual-write（legacy） |
| `tools/dispatch_subagent.ts` L718                     | `ctx/{dagTaskId}.json`                        | per-dispatch 隔离文件         |
| `scripts/command-tools/dispatch-subagent.ts` L161     | `FRAMEWORK_DISPATCH_CONTEXT = "orchestrated"` | 子进程也设置                  |
| `scripts/command-tools/dispatch-subagent.ts` L748-755 | `writeDispatchCtx(dagTaskId, ...)`            | per-dispatch 文件             |
| `plugins/dispatch-after.ts` L37                       | 删除 `_dispatch_target.json`                  | Task() 完成后清理             |

### 3.2 读取点

| 文件                                                  | 读取内容                              | 优先级                 |
| ----------------------------------------------------- | ------------------------------------- | ---------------------- |
| `lib/agent-resolver.ts` L117-126                      | `session_map.agent`                   | Priority 1             |
| `lib/agent-resolver.ts` L129-177                      | `_dispatch_target.json`               | Priority 2（fallback） |
| `lib/agent-resolver.ts` L434-449                      | `.dispatch_ctx` dagTaskId             | Priority 3             |
| `lib/agent-resolver.ts` L454-465                      | `_dispatch_target.json` task_id       | Priority 4             |
| `lib/agent-resolver.ts` L505-516                      | `session_map.domain_id`               | Priority 1             |
| `lib/agent-resolver.ts` L549-638                      | `ctx/*.json` + `.dispatch_ctx` domain | Priority 2/3           |
| `plugins/task-before.ts` L54-274                      | `DISPATCH_TOKEN`                      | 完整性校验             |
| `plugins/task-after.ts` L184-188                      | `.dispatch_ctx` → dagTaskId           | Task() 完成后          |
| `scripts/pre-execution-gate.ts` L720-742              | `DISPATCH_TOKEN` (KC dispatch)        | 知识管道完整性         |
| `scripts/command-tools/dispatch-subagent.ts` L143-153 | `.dispatch_ctx` taskId                | 子进程 fallback        |

### 3.3 所有引用 `.dispatch_ctx` 的文件（12 个）

| 文件                                         | 角色                               |
| -------------------------------------------- | ---------------------------------- |
| `tools/dispatch_subagent.ts`                 | 写入（dual-write legacy）          |
| `scripts/command-tools/dispatch-subagent.ts` | 读取 + 写入                        |
| `plugins/task-after.ts`                      | 读取 + 删除                        |
| `lib/agent-resolver.ts`                      | 读取（taskId + domainId fallback） |
| `lib/gate-core.ts`                           | 读取（dispatch context 完整性）    |
| `scripts/mcp-tools/compliance-gate.ts`       | 读取（dispatch context 完整性）    |
| `tools/resolve_domain_id.ts`                 | 读取（domain fallback）            |
| `scripts/framework-self-test.ts`             | 校验（legacy 共存检查）            |
| `plugins/session.ts`                         | 注释引用                           |
| `lib/db-manager.ts`                          | 注释（migration context）          |
| `lib/dispatch-db.ts`                         | 注释（DB-canonical transition）    |
| `lib/__tests__/gate-core.test.ts`            | 清理                               |

---

## §4 `.dispatch_ctx` 淘汰路线图

```
Phase 0 (current): Dual-write
  ├─ .dispatch_ctx       ← legacy singleton (TOCTOU 风险)
  └─ ctx/{dagTaskId}.json ← per-dispatch（race-free）

Phase 1 (planned): Stop writing .dispatch_ctx
  └─ 仅写 ctx/{dagTaskId}.json

Phase 2 (future): Migrate readers to DB
  ├─ reader: agent-resolver → session_map DB
  ├─ reader: gate-core     → session_map DB
  └─ reader: compliance-gate → dispatch_context table

Phase 3 (final): Remove .dispatch_ctx entirely
  └─ 删除所有 .dispatch_ctx 读/写代码
```

---

## §5 混淆点

### I1: `.dispatch_ctx` 在 12 个文件中被引用（HIGH）

12 个文件引用同一个共享文件名，任何修改需同步 12 处。已在 Phase 1 dual-write 中通过 `ctx/*.json` 减轻。

### I2: `DISPATCH_TASK_DESC` vs `DISPATCH_NAMESPACE` 语义重叠（MED）

两者都传递 dispatch 信息到子进程：

- `DISPATCH_TASK_DESC` → task_description（业务语义）
- `DISPATCH_NAMESPACE` → session namespace（路径语义）

应合并为一个 `DISPATCH_CONTEXT` JSON blob env var。

### I3: `_dispatch_target.json` 仍然存在于 Priority 2（LOW）

虽然 `session_map` 已是 Priority 1，但 `_dispatch_target.json` 仍作为 Priority 2 fallback 活跃。注释标注了 TOCTOU 风险但未移除。

### I4: `DISPATCH_TOKEN` 与 `//DISPATCH_TOKEN:` 格式紧耦合（LOW）

token 格式 `//DISPATCH_TOKEN:{sha256}` 在 `dispatch-subagent.ts`（生成）和 `task-before.ts`（校验）之间构成隐式契约，修改格式需两处同步。

### I5: `dispatchContext` vs `dispatchCtx` vs `dispatch_ctx` 命名混乱（LOW）

同一概念三种写法：`dispatchContext`（DB 表）、`dispatchCtx`（变量名）、`dispatch_ctx`（文件名）。

---

## §6 统计

| 指标                                     | 值                                      |
| ---------------------------------------- | --------------------------------------- |
| env var 总数                             | 6                                       |
| 文件型 context 文件                      | 3                                       |
| DB 表                                    | 2                                       |
| 引用 `.dispatch_ctx` 的文件              | 12                                      |
| 写入 `FRAMEWORK_DISPATCH_CONTEXT` 的文件 | 2                                       |
| `DISPATCH_TOKEN` 校验点                  | 1（task-before.ts）+ 1（pre-exec-gate） |

---

## §7 建议

### 短期

1. **统一 env var 命名**: `DISPATCH_NAMESPACE` / `DISPATCH_DAG_TASK_ID` 已就绪，保持不变
2. **消除 `_dispatch_target.json` fallback**: 当 session_map 覆盖率达 100% 时移除

### 中期

3. **Phase 2 迁移**: 所有 `.dispatch_ctx` 读取者迁移到 `dispatch_context` DB 表
4. **合并 env var**: `DISPATCH_TASK_DESC` + `DISPATCH_NAMESPACE` + `DISPATCH_DAG_TASK_ID` → `DISPATCH_CONTEXT` JSON

### 长期

5. **移除 `.dispatch_ctx` 文件和 `_dispatch_target.json`**: 最终仅保留 DB-canonical

---

## §8 相关文档

| 文档                                    | 关系                            |
| --------------------------------------- | ------------------------------- |
| `parameter-name-confusion-audit.md`     | 参数名混淆全量（§7 为本文来源） |
| `agent-identity-complete-audit.md`      | Agent 解析路径（Priority 1/2）  |
| `task-id-duality-complete-audit.md`     | dag_task_id 传递                |
| `dispatch-session-map-race-fix-plan.md` | session_map race condition 修复 |

---

_本文档将在 dispatch context 重构中持续更新。_
