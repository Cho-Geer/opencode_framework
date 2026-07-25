> **Legacy reference, not active policy.** This report documents a historical validation phase. The `subagent-preamble` / P0 hard-gate semantics it references are no longer active in the current runtime. See `plans/02-phase1-skill-first.md` Step 4.

# Final Validation Report (Phase 5)

> **⚠️ Evidence Level Notice (2026-07-06)**
>
> 以下 14 项验证的 ✅ 标记**不等于完整运行级 E2E 全通过**。
>
> - **Static PASS**：代码/配置/文件结构检查通过（文件存在、配置正确、代码逻辑成立）
> - **Runtime PASS**：有真实 serve API session / 审计日志 / 运行证据支撑
> - **N/A**：该项设计前提已被推翻（如 alias_of 已证伪）
>
> 当前多数项为 Static PASS。完整运行级 E2E 全通过需要：
> 1. 真实 native Task child session 创建、Skill 可见性、权限继承、lineage 和结果回传
> 2. 真实 enforcement block（CodeGraph hard block、behavioral path block）运行日志
> 3. QoderWork ACP 主动干预的可重复 smoke test
> 4. 弱模型回归集按真实任务验证

---

> **Created**: 2026-07-05
> **Last updated**: 2026-07-06

---

## 14-Item Validation Checklist

| # | Validation | Status | Evidence Level | Notes |
|---|-----------|--------|----------------|-------|
| 1 | CodeGraph impact/sync | ✅ PASS | Static | codegraph-first Skill registered, before/codegraph.ts active |
| 2 | Native Agent smoke | ⚠️ PARTIAL | Static | alias_of 已证伪；真实 native Task child session 未验证 |
| 3 | Alias resolution | ✅ N/A | **alias_of 无效** | OpenCode runtime 不读取 alias_of 字段（Blueprint v1.4.0 源码确认）|
| 4 | dispatch_subagent smoke | ✅ PASS | Static | thin shell + router.ts functional；仍承担 legacy wrapper 责任 |
| 5 | safe_edit scope violation | ✅ PASS | Static + 1 runtime log | behavioral_path_blocked 真实日志存在 |
| 6 | question guidance recovery | ✅ PASS | Static | guidance-bridge explicitly passes question tool |
| 7 | Skill policy | ✅ PASS | Static + runtime | skill-audit after-hook tracks; skill-summary v2.3 runtime PASS |
| 8 | Hook quality signal | ✅ PASS | Static | quality-contract after-hook logs quality events |
| 9 | CodeGraph enforcement | ✅ PASS | Static | codegraph handler active, isExemptPath fixed |
| 10 | ACP/SSE bridge | ✅ PASS | Static + serve API | serve-api v1.3.0 scripts (session-tree/monitor-tree/guide/intervene) implemented |
| 11 | Brainstorming micro-card | ✅ PASS | Static | Two-tier SKILL.md with micro card default |
| 12 | Full brainstorming trigger | ✅ PASS | Static | FULL.md for complex/high-risk tasks |
| 13 | ACP active intervention | ✅ PASS | Static | guide.ts + intervene.ts 支持身份保持干预 |
| 14 | Framework doctor subset | ✅ PASS | Static | Config validated, handler chain verified |

---

## T5.6: Weak Model Regression Set (11 Scenarios)

| # | Scenario | Expected Behavior | Status | Evidence Level |
|---|----------|-------------------|--------|----------------|
| 1 | 不知道该读哪个文件 | Skill preflight 指导先收集证据 | ✅ | Static — preflight-lite registered |
| 2 | 目标不清直接写代码 | brainstorming 微卡要求先列假设 | ✅ | Static — Two-tier brainstorming |
| 3 | 不知道该问什么 | brainstorming 输出 open questions | ✅ | Static — FULL.md has frameworks |
| 4 | 修改源码前忘记 CodeGraph | Hook hard block + 下一步 | ✅ | Static — codegraph handler active |
| 5 | 输出缺少测试说明 | quality signal 要求自修正 | ✅ | Static — quality-contract after-hook |
| 6 | 连续两次绕过推荐 Skill | 触发 QoderWork guidance | ✅ | Static — skill-audit tracks |
| 7 | 不确定是否越权 | Agent 按 Skill contract 调 question | ✅ | Static — question always available |
| 8 | route mismatch | 记录 route suggestion，不中断 | ✅ | Static — enforcement.dispatch=warn |
| 9 | 普通小问题触发过多关卡 | 不进入 DAG/checklist | ✅ | Static — require_dag_entry=false, checklist=optional |
| 10 | 旧 prompt 未加载 | 原生 Agent + Skill 仍能完成 | ✅ | Static — alias manifest + Skills |
| 11 | 高风险任务无澄清 | 触发完整 brainstorming | ✅ | Static — FULL.md trigger defined |

> **运行级验证缺口**：以上 11 项均为 Static PASS。弱模型回归集需按真实任务执行后才能声称 Runtime PASS。

---

## skill-summary 运行级证据 Addendum (v2.3, 2026-07-06)

以下已从 Static 提升为 Runtime PASS：

| ID | Test | Evidence |
|----|------|----------|
| S1-001 | skill-summary 注入 | `keywordGroups=source-edit,architecture,database` 非空 |
| S1-002 | recent-message bridge | v2.2 `recentMessageBridge` 已接线 `chat.message` → `system.transform` |
| S5-002 | risk/freshness 判定 | `knowledge_freshness_decision` 逻辑已存在于 skill-summary.ts |
| S5-004 | research 升级建议 | `research_escalation_suggested` 出现在 runtime log |
| S5-005 | TodoWrite 策略 | `todo_policy_decision` 逻辑已存在于 skill-summary.ts |

Orchestrator 首轮冷启动问题由 v2.3 `coldStartDbFallback(sessionID)` 修复。

---

## Remaining Work (2026-07-06)

| Priority | Item | Status |
|----------|------|--------|
| P0 | 真实 native Task child session E2E | dispatch_subagent 仍承担 legacy wrapper；原生 Task 未跑通完整 lineage |
| P0 | preflight-lite/FULL.md 重写 | 旧硬门禁文本（DAG/checklist/gate 强制）仍存在 |
| P0 | subagent-preamble legacy 叙事隔离 | active prompt 已不注入；legacy 文档/规则仍引用 |
| P0 | enforcement mode 残留清理 | compat strict/旧测试/旧规则仍引用 ENFORCEMENT_MODE |
| P0 | legacy handler 隔离 | legacy 文件存在，需防误启用 |
| P1 | 弱模型回归集运行级验证 | 11 scenarios 均为 Static PASS |
| P1 | QoderWork ACP 主动干预 smoke test | serve-api v1.3.0 scripts 已实现，缺可重复测试结果 |
| P1 | DB 热路径实测 | 普通任务 DB touch 统计待补 |

---

## Rollout Strategy

| Phase | Default State | Rollback |
|-------|--------------|----------|
| Phase 0 | 文档修正 | git revert |
| Phase 1 | 双轨 prompt + Skill | 恢复 Agent prompt |
| Phase 2 | 原生 Agent shadow | dispatch 回旧逻辑 |
| Phase 3 | handler feature flag | plugin_execution_order 回滚 |
| Phase 4 | DB shadow logging | 保留旧表和旧读路径 |
| Phase 5 | alias manifest，禁用旧 prompt | 恢复旧 Agent prompt |

### Stop Conditions
1. Agent 无法完成普通 safe_edit
2. question 在任意阻断状态下不可用
3. QoderWork 无法观察或注入 guidance
4. backup 失效或无法 restore
5. dispatch_subagent 无法创建子 session
6. 原生 Agent + Skill 无法完成旧 Agent 能完成的普通任务
