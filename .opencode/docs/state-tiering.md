# DB State Tiering (Phase 4)

> **Updated**: 2026-07-11 (baseline re-freeze)
> **Phase**: 4 (Minimal State) — 7-tier model
> **Authoritative DB**: `.opencode/state/framework-state.db`
> **Schema**: v37 | **Tables**: 49 business / 50 total (incl. `sqlite_sequence`)

---

## 权威源与基准确认

- 运行时代码只读写 `.opencode/state/framework-state.db`（初始化见 `lib/db-manager.ts`；`.trash-db/` 为历史归档，统计脚本已排除；`.opencode/state.db` 等惰性副本在 policy 中 blocked）。
- 表清单来自 `lib/db-manager.ts` 的 `CREATE TABLE IF NOT EXISTS` 源（**证据等级：static/code**）。早期迁移中有 4 张表被 `DROP TABLE` 移除，运行时不复存在；live 普查 = **49 business / 50 total（v37）**。
- 本文档旧版（v32/v33、41–44 表、4-tier 模型：Critical/Observable/Optional/Cold/Deprecated）已于 2026-07-11 作废。

---

## 7-Tier 状态分层（规范来源：plan 04 §2）

| Tier | 状态 | 存储 | 写入时机 |
|---|---|---|---|
| **Critical** | backup / dispatch privilege / framework maintenance plan / guidance / gate call context | DB（事务保证） | 安全关键，必须写 |
| **Bridge** | session lineage / dispatch prompt refs / gate sessions / question-guidance | DB + JSONL mirror | 桥接恢复 |
| **Observable** | skill usage / quality signal / route suggestion / tool audit | JSONL + sampled DB index | append-only，不阻断 |
| **Ephemeral** | TodoWrite active state | native session/tool state + JSONL | 不入 DB |
| **High-risk only** | execution_checklist tables | DB | 仅高风险任务 |
| **Cold** | knowledge materialization / snapshots / compactor | background DB | 仅后台作业 |
| **Deprecated** | old snapshot/index/drained tables | stop-write → shadow-read → delete | 退役中 |

---

## 当前表归属（v37，源 = `lib/db-manager.ts`）

### Critical（DB，事务保证）
- `schema_version`（迁移历史，meta）
- `backup_log`
- `dispatch_privilege_grants`
- `framework_maintenance_plans`
- `gate_call_context`
- `tool_guidance_state`（guidance 状态）
- `substate_kv`（框架子状态热路径）
- `tool_enforcement`（enforcement 计数器）
- `soft_rejections`（per-tool 软拒绝）
- `dispatch_queue`（active dispatch）
- `repo_operation_grants`（repo 安全授权）

### Bridge（DB + JSONL mirror）
- `session_registry`
- `session_events`
- `session_map`（agent/session 身份映射）
- `dispatch_prompt_refs`
- `gate_sessions`

### Observable（JSONL + sampled DB index，append-only 不阻断）
- `audit_log`
- `audit_trail`
- `dispatch_attempts`
- `dispatch_failed_log`
- `dispatch_payload_integrity`
- `dispatch_context`
- `read_audit`
- `file_baseline_kv`
- `notifications` / `notification_readers`
- `machine_contracts` / `machine_meta`
- `session_log`
- `tsc_gate_events` / `tsc_gate_locks`
- `approval_read_context`
- `gate_audit_history` / `gate_store_meta`
- `repo_operation_events`

### High-risk only（DB，仅高风险任务）
- `execution_checklist_runs`
- `execution_checklist_items`
- `execution_checklist_events`

### Cold（background DB，热路径禁写）
- `knowledge_entries` / `knowledge_files` / `knowledge_entry_tags`
- `knowledge_session_access` / `knowledge_session_access_archive`
- `knowledge_discovery` / `knowledge_attestation`
- `knowledge_materialization_jobs`
- `uc7ks_pipeline_state`
- `gate_compactor_index`

### Deprecated（stop-write → shadow-read → delete；仍有 legacy writer 待移除）
- `gate_drained_sessions`（drained）
- `gate_session_index`（index）
- `agent_registry_snapshot`（snapshot，仍被 `scripts/knowledge/capture-config-snapshot.ts` 写入）
- `permission_snapshot`（snapshot，同上）
- `template_resolution_snapshot`（snapshot，同上）

> 注：上述 5 张 Deprecated 表在 §2 规范中属退役层；其中 3 张 snapshot 当前仍由 `capture-config-snapshot.ts` 写入，迁移期保留，后续随 Deprecated 流程停写。

---

## Hot-Path 降噪策略（当前）

- **JSONL audit**（`.task_temp/_logs/`）：`audit.jsonl` / `quality.jsonl` / `skill.jsonl` / `guidance.jsonl`。
  - Critical DB 写失败 → 阻断；Observable JSONL 写失败 → runtime warning，不阻断普通任务；High-risk checklist 写失败 → 阻断对应高风险任务。
- **普通质量信号**进入 JSONL，不写为 hard block。
- **Ephemeral** TodoWrite 只做工作记忆 + soft-governance，不写 `execution_checklist_*`。
- **Hot-path DB touch**（runtime smoke T7 已证）：普通 read-only / `safe_edit` / `TodoWrite` 不写 `dispatch_queue` / `execution_checklist`；framework maintenance 只触碰 grant/plan/audit/backup 必要状态。

---

## 与 Phase 4 完成门槛对应

- [x] DB 权威源仅 `.opencode/state/framework-state.db`（`.trash-db/` 已归档，惰性副本在 policy 中 blocked）。
- [x] 7-tier 分层（Critical/Bridge/Observable/Ephemeral/High-risk only/Cold/Deprecated）已写入本文档。

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始分级（44 表, schema v33, 4-tier 模型） |
| 2026-07-11 | 作废旧 v32/v33 快照；按 plan 04 §2 重写为 v37 7-tier 模型（49 business / 50 total） |
