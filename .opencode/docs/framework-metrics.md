> **Legacy reference, not active policy.** This metrics snapshot references legacy agent roles / P0 protocol semantics that are no longer active in the current runtime. See `plans/02-phase1-skill-first.md` Step 4.

# OpenCode Framework Metrics — Live Baseline

**Last updated**: 2026-07-06 (post-E2E audit + serve-api v1.3.0 sync)
**Authoritative source**: This file + live metric commands below

> **⚠️ 注意**：此文件中的数值均为最后一次更新时的 live 快照，每次重构前后应用下方命令重新采样。

---

## Code Scale

| Metric | Value | Command |
|--------|-------|---------|
| TS files (excl. node_modules/.trash/.bak) | 322 | `find .opencode -name '*.ts' -not -path '*/node_modules/*' -not -path '*/.trash*' -not -name '*.bak*' | wc -l` |
| TS lines | 67,892 | `find .opencode -name '*.ts' ... -exec cat {} + | wc -l` |
| Active agent .md files | 2 (`Orchestrator.md` + `build.md` stub) | `ls .opencode/agents/*.md` |
| Active agent total lines | 90 (Orchestrator 87 + build 3) | `wc -l .opencode/agents/*.md` |
| Legacy agent profiles | 9 (in `.opencode/legacy/agent-profiles/`) | `ls .opencode/legacy/agent-profiles/*.md | wc -l` |
| Skill SKILL.md count | 18 | `ls .opencode/skills/*/SKILL.md | wc -l` |

### Code Scale 变化记录

| 日期 | TS files | TS lines | Active agents | Skills | 备注 |
|------|----------|----------|---------------|--------|------|
| 2026-07-05 | 317 | 65,619 | 10 (all custom) | 17 | Phase 0-5 首次基线 |
| 2026-07-05 19:55 | — | — | — | — | behavioral-path-guard 新增 |
| 2026-07-06 | 322 | 67,892 | 2 (Orchestrator + build stub) | 18 | 9 旧角色迁移到 legacy；skill-summary v2.3；serve-api v1.3.0 |

---

## Handler Chain

| Metric | Value | Source |
|--------|-------|--------|
| Before handler files | 20 | `ls .opencode/plugin-handlers/before/*.ts` |
| After handler files | 19 | `ls .opencode/plugin-handlers/after/*.ts` |
| System handler files | 2 (anti-bypass + skill-summary) | `ls .opencode/plugin-handlers/system/*.ts` |
| **Active before** (execution_order) | **7** | `project.config.json → plugin_execution_order.before` |
| **Active after** (execution_order) | **6** | `project.config.json → plugin_execution_order.after` |
| **Active system** (execution_order) | **2** | `project.config.json → plugin_execution_order.system` |

> handler files ≠ active order。以 `plugin_execution_order` 为准，legacy handler 文件存在但不在 active chain 中。

### Active Before Chain (7)
1. `guidance-bridge` (delegates → anti-bypass)
2. `permission-safety` (delegates → config-guard + git-guard)
3. `behavioral-path-guard` (protected path / safe_shell bypass 保护)
4. `scope`
5. `codegraph`
6. `skill-policy`
7. `dispatch-signal`

### Active After Chain (6)
1. `unified-audit` (delegates → read-track + scope + codegraph)
2. `skill-audit`
3. `quality-contract` (delegates → format + tdd)
4. `dispatch-trace` (delegates → dispatch)
5. `db-health`
6. `guidance-recovery` (delegates → anti-bypass)

### System Chain (2)
1. `anti-bypass` (guidance gate + threshold STOP)
2. `skill-summary` (per-task keyword matching + per-Agent recommendation; v2.2 bridge + v2.3 cold-start DB fallback)

---

## Database

| Metric | Value |
|--------|-------|
| Authoritative DB | `.opencode/state/framework-state.db` |
| Schema version | v33 |
| Total tables (non-sqlite built-in) | **44** |
| Phase 4 new tables | session_registry, session_events, tool_guidance_state |
| tool_enforcement new columns (v33) | failure_count, last_failure, guidance_required, tool_rejections |
| Inert 0-byte DB files | `opencode.db`, `framework_state.db`, `substate_kv.db` (待清理) |

### State Tiering
| Tier | Tables | Strategy |
|------|--------|----------|
| Critical | session_registry, session_map, tool_enforcement, tool_guidance_state, backup_log, dispatch_queue | Keep in DB |
| Bridge | notifications, session_events, dispatch_prompt_refs, dispatch_payload_integrity | DB + JSONL mirror |
| Observable | read_audit, audit_trail, gate_audit_history | Default JSONL, DB sample/index |
| Ephemeral | TodoWrite active state | 原生会话/tool 状态 + JSONL audit |
| Optional | execution_checklist_*, notification_readers | High-risk only (checklist_mode: optional) |
| Cold | Knowledge tables, compactor, snapshots | Background maintenance |

---

## MCP

| Metric | Value |
|--------|-------|
| MCP servers (enabled) | 12 |
| Framework/local custom | ~6 |

---

## JSONL Audit Landing (Phase 4)

| Channel | File | Writer |
|---------|------|--------|
| audit | `.task_temp/_logs/audit.jsonl` | unified-audit.ts |
| quality | `.task_temp/_logs/quality.jsonl` | quality-contract.ts + skill-policy.ts |
| skill | `.task_temp/_logs/skill.jsonl` | skill-audit.ts |
| dispatch | `.task_temp/_logs/dispatch.jsonl` | before/after-dispatcher.ts |
| guidance | (via tool_enforcement DB) | guidance-bridge.ts |

---

## E2E Validation Status (2026-07-06 复核)

> **⚠️ 重要**：以下 ✅ PASS 分为两种级别：
> - **Static PASS**：代码/配置结构检查通过（文件存在、配置正确）
> - **Runtime PASS**：有真实运行日志/审计证据支撑
>
> 当前多数项为 Static PASS，完整运行级 E2E 全通过仍待补。

| # | Test | Status | Level |
|---|------|--------|-------|
| 1 | CodeGraph impact/sync | ✅ PASS | Static |
| 2 | Native Agent smoke | ⚠️ PARTIAL | Static — 真实 native Task child session/lineage 未验证 |
| 3 | alias smoke | ✅ N/A | **alias_of 已证伪**（OpenCode runtime 不读取）|
| 4 | dispatch_subagent smoke | ✅ PASS | Static — thin shell + router.ts |
| 5 | safe_edit scope violation | ✅ PASS | Static + 1 runtime log (behavioral_path_blocked) |
| 6 | question guidance recovery | ✅ PASS | Static — guidance-bridge 显式放行 |
| 7 | Skill policy | ✅ PASS | Static + skill-audit after-hook |
| 8 | Hook quality signal | ✅ PASS | Static |
| 9 | CodeGraph enforcement | ✅ PASS | Static + isExemptPath fallback 修复 |
| 10 | ACP/SSE bridge | ✅ PASS | Static + serve API verified |
| 11 | brainstorming micro-card | ✅ PASS | Static — SKILL.md 已含两级 |
| 12 | full brainstorming | ✅ PASS | Static — FULL.md 已含触发条件 |
| 13 | ACP intervention | ✅ PASS | Static — serve-api v1.3.0 scripts implemented |
| 14 | framework doctor | ✅ PASS | Static — CodeGraph state exemption added |

### skill-summary 运行级证据 (v2.3, 2026-07-06)

- `keywordGroups` 非空：`source-edit, architecture, database` 等组合已命中
- `research_escalation_suggested` 已出现
- `coldStartDbFallback(sessionID)` 已修复 Orchestrator 首轮 bridge 为空问题
- S1-001/S1-002/S5-002/S5-004/S5-005 已提升为 Runtime PASS

---

## Remaining Items

| Priority | Task | Status |
|----------|------|--------|
| **P0** | 重写 `preflight-lite/FULL.md` | 旧硬门禁文本仍存在 |
| **P0** | 完成 `subagent-preamble` legacy 隔离 | active prompt 已不注入；legacy 叙事待清理 |
| **P0** | 原生 `Task` 默认派遣 E2E smoke | 真实 child session/lineage 未验证 |
| **P0** | `context7-first` 知识新鲜度策略边界 | 运行级证明待补 |
| **P0** | rule-disposition 迁移 + mode 残留清理 | compat strict/旧测试/旧规则仍引用 ENFORCEMENT_MODE |
| **P0** | 隔离 legacy handler 与 active order | legacy 文件存在，需防误启用 |
| P1 | TodoWrite 重塑为轻量执行状态机 | 旧文案仍等同于强制 checklist |
| P1 | Explore / research 升级路径验证 | 缺最终 smoke 和 prompt 收口证明 |
| P1 | QoderWork ACP 主动干预 smoke test | 缺可重复测试结果 |
| P1 | DB 热路径实测 | 普通任务 DB touch 统计待补 |
| P1 | enforcement mode removal (30+ refs) | rule-disposition.ts 已存在，mode 残留待清 |
