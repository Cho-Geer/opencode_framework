# Handler 分类: Active vs Legacy

> **更新日期**: 2026-07-05 19:55
> **来源**: project.config.json plugin_execution_order + plugin-handlers/ 目录

---

## Active Handlers (在 plugin_execution_order 中)

### Before Chain (7 handlers, 串行执行, first throw wins)

| 顺序 | Handler | 文件 | 职责 |
|------|---------|------|------|
| 1 | guidance-bridge | guidance-bridge.ts | anti-bypass + question-policy 委托 |
| 2 | permission-safety | permission-safety.ts | config-guard + git-guard 委托 |
| 3 | **behavioral-path-guard** | behavioral-path-guard.ts | 行为型路径守卫（不依赖 agent 身份） |
| 4 | scope | scope.ts | 写操作路径范围验证 |
| 5 | codegraph | codegraph.ts | 影响分析前置检查 |
| 6 | skill-policy | skill-policy.ts | Skill 治理（warn-only，不 throw） |
| 7 | dispatch-signal | dispatch-signal.ts | 派遣信号审计（不 throw） |

### After Chain (6 handlers, 串行执行, 全部 fire-and-forget)

| 顺序 | Handler | 文件 | 职责 |
|------|---------|------|------|
| 1 | unified-audit | unified-audit.ts | read-track + scope + codegraph 审计委托 |
| 2 | skill-audit | skill-audit.ts | Skill 加载事件记录 |
| 3 | quality-contract | quality-contract.ts | format + tdd 委托 |
| 4 | dispatch-trace | dispatch-trace.ts | 派遣追踪 + 清理 |
| 5 | db-health | db-health.ts | DB 写放大监控 |
| 6 | guidance-recovery | guidance-recovery.ts | anti-bypass after 逻辑委托 |

### System Chain (2 handlers)

| 顺序 | Handler | 文件 | 职责 |
|------|---------|------|------|
| 1 | anti-bypass | anti-bypass.ts | 两阶段指导指令注入 |
| 2 | skill-summary | skill-summary.ts | per-agent + 关键词匹配 Skill 推荐 |

---

## Legacy/Inactive Handlers (在磁盘上但不在 execution_order 中)

### Before (13 files)

| 文件 | 状态 | 说明 |
|------|------|------|
| anti-bypass.ts | **delegate** | 被 guidance-bridge 调用 |
| checklist.ts | LEGACY | 不在 active order |
| config-guard.ts | **delegate** | 被 permission-safety 调用 |
| dispatch.ts | LEGACY | 不在 active order |
| gate.ts | LEGACY | 不在 active order |
| git-guard.ts | **delegate** | 被 permission-safety 调用 |
| json-validate.ts | 未接线 | 存在但未注册 |
| phase0-enforce.ts | LEGACY | 不在 active order |
| question-policy.ts | **delegate** | 被 guidance-bridge 调用 |
| task.ts | 未接线 | 存在但未注册 |
| tdd.ts | 未接线 | 存在但未注册 |
| uc7ks.ts | audit_only | 不在 active order |
| types.ts | 共享 | 接口定义文件 |

### After (13 files)

| 文件 | 状态 | 说明 |
|------|------|------|
| anti-bypass.ts | **delegate** | 被 guidance-recovery 调用 |
| audit.ts | merged | 已合并到 unified-audit |
| cache.ts | 未接线 | 存在但未注册 |
| codegraph.ts | **delegate** | 被 unified-audit 调用 |
| dispatch.ts | **delegate** | 被 dispatch-trace 调用 |
| format.ts | **delegate** | 被 quality-contract 调用 |
| gate.ts | LEGACY | compliance gate stale drain |
| read-track.ts | **delegate** | 被 unified-audit 调用 |
| scope.ts | **delegate** | 被 unified-audit 调用 |
| task.ts | 未接线 | 存在但未注册 |
| tdd.ts | **delegate** | 被 quality-contract 调用 |
| uc7ks.ts | 未接线 | 存在但未注册 |
| types.ts | 共享 | 接口定义文件 |

---

## 统计

| 类别 | Before | After | System |
|------|--------|-------|--------|
| Active (in execution_order) | 7 | 6 | 2 |
| Delegate (被 active handler 调用) | 3 | 6 | — |
| Legacy (存在但不执行) | 7 | 3 | — |
| Unwired (存在但未注册) | 3 | 3 | — |
| 总文件数 | 20 | 19 | 2 |
