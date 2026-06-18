# 框架存储实体全景图 — DB 迁移状态总览

**生成日期**: 2026-06-19  
**复核快照**: 2026-06-19 03:46 Asia/Tokyo，本地工作区当前状态  
**DB Schema**: v10，16 张 user tables + 1 张 SQLite 内部表 `sqlite_sequence`  
**DB 文件**: `.opencode/state/framework-state.db` 约 2.7 MB，WAL 约 4.8 MB，SHM 32 KB

---

## 一、当前结论

1. DB 迁移主干已推进到 v10：`read_audit` 表已存在并有 525 条唯一事件记录，`schema_version` 已包含 `FW-READ-AUDIT-DB`。
2. `read_audit` 当前不是“待迁移”，而是 **Phase 1 DB-first + JSONL fallback/dual-write**：`read-audit.ts` v2.0 的 `recordRead/verifyRead/getReadEventsForSession` 均已走 DB-first，`read_audit.jsonl` 仍保留并持续写入。
3. UC7KS attestation 已接入共享 read-audit API：`knowledge_cache_attest.ts` 使用 `getReadEventsForSession()` + `normalizeReadAuditPath()`，不再内置直读 JSONL 的 `readAuditLog()`。
4. `gate-state.json` / `gate-state.history/*.jsonl` 仍是 compactor 文件主路径 + DB shadow/双轨状态；这部分尚未完成 authoritative source 收敛。
5. 调度链路仍保留短生命周期文件：`.pending.json` 活跃；`.dispatch_ctx`、`.auto-dispatch`、`_dispatch_target.json` 当前可不存在，但代码仍会按需创建/消费。
6. `.transaction-log` 仍是 legacy bridge，不应视为当前 substate 常规写入路径，但 doctor/CI/合规检查仍有历史依赖。

---

## 二、已迁移到 DB 的存储实体

### 2.1 DB 表清单

以下计数来自当前 SQLite 快照，运行中会变化。

| # | DB 表名 | Schema | 当前行数 | 用途 | 来源/替代对象 |
|:--:|---------|:------:|:------:|------|---------------|
| 1 | `machine_meta` | v1 | 6 | 机器/框架元数据 KV | `machine.json` meta |
| 2 | `machine_contracts` | v1 | 1 | 契约文件路径列表 | `machine.json` contracts |
| 3 | `gate_sessions` | v1/v5 | 84 | 合规门会话状态 | `gate-state.json` sessions |
| 4 | `gate_drained_sessions` | v1 | 135 | 过期排空会话归档 | `gate-state.json` drained |
| 5 | `gate_session_index` | v1 | 84 | sessionID/status 简索引 | `gate-state.json` index |
| 6 | `gate_audit_history` | v1 | 70 | 合规门审计历史 DB 轨 | `gate-state.history/*.jsonl` |
| 7 | `gate_store_meta` | v1 | 3 | 合规门 store meta | `gate-state.json` meta |
| 8 | `audit_log` | v1 | 81 | 写审计日志 | 原 append audit |
| 9 | `audit_trail` | v1 | 0 | 审计追踪 | 原 audit trail |
| 10 | `session_log` | v6 | 122 | 子 Agent 会话生命周期 | `SESSION_ID.md` |
| 11 | `dispatch_failed_log` | v6 | 136 | 调度失败死信归档 | `.pending.json.failed` |
| 12 | `session_map` | v6/v8/v9 | 101 | sessionID → agent + dagTaskId + domainId | `.session_map.json` / `.dispatch_ctx` |
| 13 | `read_audit` | v10 | 525 | read 工具审计，READ-BEFORE-APPROVE + UC7KS 证明 | `read_audit.jsonl` |
| 14 | `substate_kv` | v2 | 12 | 12 个子状态 JSON blob | `*-state.json` |
| 15 | `file_baseline_kv` | v4 | 296 | 文件基线注册/TOCTOU 检测 | file baseline JSON |
| 16 | `schema_version` | v1 | 10 | DB schema migration 记录 | DB 内部元数据 |
| 17 | `sqlite_sequence` | SQLite | 5 | SQLite 自增序列 | 内部表，不算框架实体 |

### 2.2 `substate_kv` 中的 12 个子状态

| # | Key | 原文件名 | 当前大小 | 状态 | 说明 |
|:--:|-----|---------|:------:|:----:|------|
| 1 | `knowledge_cache_state` | `knowledge-cache-state.json` | ~870 KB | DB-only | 最大 blob，UC7KS discovery/attestation 主要状态 |
| 2 | `write_audit_state` | `write-audit-state.json` | ~168 KB | DB-only | 写审计状态 |
| 3 | `compliance_records` | `compliance-records.json` | ~154 KB | DB-only | 合规记录 |
| 4 | `eslint_state` | `eslint-state.json` | ~53 KB | DB-only | ESLint 审计状态 |
| 5 | `dependency_state` | `dependency-state.json` | ~13 KB | DB-only | 依赖状态 |
| 6 | `keystone_hashes` | `keystone-hashes.json` | ~2.7 KB | DB-only | 契约 SHA-256 哈希 |
| 7 | `format_state` | `format-state.json` | 987 B | DB-only | 格式化状态 |
| 8 | `type_check_state` | `type-check-state.json` | 964 B | DB-only | 类型检查状态 |
| 9 | `knowledge_audit_state` | `knowledge-audit-state.json` | 552 B | DB-only | 知识审计状态 |
| 10 | `knowledge_state` | `knowledge-state.json` | 537 B | DB-only | 知识状态 |
| 11 | `transaction_state` | `transaction-state.json` | 191 B | DB-only | 事务状态 |
| 12 | `tdd_enforcement_state` | `tdd-enforcement-state.json` | 178 B | DB-only | TDD 强制阶段状态 |

`SUBSTATE_FILES` 映射仍保留在 `substate-manager.ts`，但当前 `readSubState/writeSubState/atomicWriteSubState` 经 `db-state-manager.ts` 操作 `substate_kv`。

---

## 三、仍保留为文件的存储实体

### 3.1 核心状态文件

| # | 文件路径 | 当前大小 | 用途 | 当前读写方 | 判断 |
|:--:|---------|:------:|------|-----------|------|
| 1 | `.opencode/state/machine.json` | 264 B | 机器 meta/contracts 快照 | machine meta 兼容层 | DB 已有主数据，文件更像兼容快照 |
| 2 | `.opencode/state/gate-state.json` | 733 B | compactor hot state | `state-compactor.ts` `readHotState/writeHotState` | JSON-primary + best-effort DB sync，仍需统一入口 |
| 3 | `.opencode/state/gate-state.index.json` | 162 KB | compactor v3 历史索引 | `state-compactor.ts` `readIndex/writeIndex` | 无等价 DB 表，不能简单等同 `gate_session_index` |
| 4 | `Task.DAG.json` | 92 KB | DAG 任务图 | Meta-Planner/Orchestrator/DAG 工具 | 结构复杂，保留文件合理 |
| 5 | `.opencode/state/read_audit.jsonl` | 154 KB / 561 行 | read 审计 Phase 1 fallback/dual-write 文件 | `read-audit.ts` Phase 1 JSONL path | DB 已是主路径；Phase 2 才能归档 |

### 3.2 调度/会话临时文件

| # | 文件路径 | 当前状态 | 读写方 | DB 替代/风险 |
|:--:|---------|---------|--------|--------------|
| 6 | `.task_temp/_dispatch/.pending.json` | 活跃，2.8 KB | dispatch-subagent 生成；`task-before/dispatch-after/self-test` 校验/清理 | 尚无 DB 队列；仍是 dispatch FIFO 关键路径 |
| 7 | `.task_temp/_dispatch/.dispatch_ctx` | 短生命周期，当前不存在 | `dispatch_subagent.ts` 写；`task-after.ts` 消费；resolver/gate fallback | `session_map` 是主路径，但该 shared file 仍有竞态遗留风险 |
| 8 | `.task_temp/_dispatch/.auto-dispatch` | 短生命周期，当前不存在 | `dispatch_subagent.ts` 写；`task-before.ts` 消费；`dispatch-auto.ts` 清理 | LLM-free bridge，不能迁移前随意删除 |
| 9 | `.task_temp/_dispatch_target.json` | 短生命周期，当前不存在 | dispatch/pre-execution/compliance-gate/agent-resolver fallback；`dispatch-after` 清理 | single shared file，已有 run_id/mtime stale check |
| 10 | `.task_temp/_dispatch/.pending.json.failed` | 遗留文件，31 KB / 561 行 | 当前失败写入已走 `dispatch_failed_log` | 可清理候选，清理前确认无诊断依赖 |
| 11 | `.task_temp/_dispatch/.session_map.json` | 遗留文件，5.4 KB | 当前主代码已走 `session_map` DB | 历史 artifact，可清理候选 |

### 3.3 日志/审计文件

| # | 文件路径 | 当前大小 | 用途 | 判断 |
|:--:|---------|:------:|------|------|
| 12 | `.opencode/logs/safe-bash.log` | 979 KB | shell 命令 allow/block 审计 | 高频追加，保留文件合理 |
| 13 | `.opencode/logs/safe-bash.log.1~4` | ~408 KB | 轮转日志 | 归档文件 |
| 14 | `.opencode/logs/safe-bash.log.*.gz` | ~38 KB | 压缩轮转日志 | 归档文件 |
| 15 | `.task_temp/_logs/` | 64 MB | 插件结构化日志目录树 | 高频追加 + 分日期目录，保留文件合理 |
| 16 | `.task_temp/_logs/_archive/` | 11 MB | 插件日志归档 | 归档文件 |
| 17 | `.opencode/state/.transaction-log` | 15 KB / 70 行 | legacy state transaction WAL | 不再应视为常规 substate 写入路径；仍被 doctor/CI/合规检查引用 |
| 18 | `.opencode/state/gate-state.history/*.jsonl` | 26 个日文件，目录约 1.1 MB | compactor 历史 JSONL | 与 `gate_audit_history` DB 双轨并存 |

### 3.4 配置、Schema、脚本、归档

| 类别 | 路径/数量 | 判断 |
|------|-----------|------|
| 项目配置 | `.opencode/project.config.json`, `.opencode/settings.json`, `.opencode/config/eslint-red-exemptions.json`, `.opencode/generated/tier-rules.json` | 配置数据，不属于 DB 迁移目标 |
| 根部 Schema | `.opencode/state/*.schema.json` 6 个 | 校验定义，保留文件合理 |
| 子状态 Schema | `.opencode/state/schemas/*.schema.json` 17 个 | 校验定义，保留文件合理 |
| read_audit 迁移脚本 | `.opencode/scripts/migrate-read-audit.ts` 5.0 KB | v10 导入/幂等迁移脚本，不是运行时状态 |
| knowledge cache schema 文案 | `.opencode/state/schemas/knowledge-cache-state.schema.json` | 仍有 “verified against read_audit.jsonl” 描述，Phase 2 前需改为 read-audit DB/API |
| history migrated backup | `.opencode/state/gate-state.history/migrated-*.bak` 1 个，约 446 KB | 可清理候选 |
| machine backup | `.opencode/state/machine.json.backup.*` 1 个，约 1.1 MB | 可清理候选 |
| 状态备份 | `.opencode/state/.backups/` 约 2.2 MB，`.opencode/state/.opencode_backups/` 约 2.1 MB | 备份目录 |
| 插件备份 | `.opencode/_plugins_backups/` 约 189 MB | 最大可清理候选 |
| dispatch 历史产物 | `.task_temp/_dispatch/` 约 21 MB | 多数是历史 prompt/report，清理需保留当前 pending 文件 |

---

## 四、迁移状态汇总

| 状态 | 实体 | 当前判断 |
|------|------|----------|
| 完全 DB 主路径 | `substate_kv` 12 key、`audit_log`、`audit_trail`、`session_log`、`dispatch_failed_log`、`session_map`、machine/gate 主表、`file_baseline_kv` | 主迁移完成 |
| Phase 1 DB-first + JSONL fallback | `read_audit` + `.opencode/state/read_audit.jsonl` | v10 已实施；DB 525 unique rows，JSONL 561 physical lines；Phase 2 尚未归档 JSONL |
| DB + 文件快照 | `machine.json` | 低风险兼容快照 |
| DB + 文件双轨 | `gate-state.json`、`gate-state.history/*.jsonl` | compactor 仍操作文件，DB 只是主路径或 shadow sync，需继续收敛 |
| 文件主路径 | `gate-state.index.json`、`.pending.json`、`.auto-dispatch`、`_dispatch_target.json`、`Task.DAG.json`、日志目录 | 部分合理，部分需迁移 |
| DB 已替代但文件遗留 | `.pending.json.failed`、`.task_temp/_dispatch/.session_map.json` | 可清理，但先确认诊断/回放依赖 |
| Legacy bridge | `.transaction-log`、`state-transaction.ts` | 不宜直接删除，需先移除 doctor/CI/合规检查依赖 |

---

## 五、待处理优先级

| 优先级 | 实体/主题 | 原因 | 建议动作 |
|:------:|-----------|------|----------|
| **P0** | `read_audit` Phase 1 一致性确认 | DB 已有 525 unique rows，JSONL 有 561 physical lines；差异可能来自重复/迁移历史，但 Phase 2 前必须确认 | 对比 JSONL event_key 与 DB event_key，确认无 DB 缺失事件；运行/修复 self-test Check 40-43 |
| **P1** | `read_audit.jsonl` Phase 2 归档 | DB-first 已实现，JSONL 仍在双写增加维护成本和双源差异 | 满足审批 + UC7KS attestation + self-test + DB integrity 后，归档 JSONL 并移除 fallback |
| **P1** | `knowledge-cache-state.schema.json` 文案收敛 | Schema 描述仍写 “verified against read_audit.jsonl”，但实现已是 read-audit DB/API | 改为 “verified through read-audit DB/API”，避免误导实施者 |
| **P1** | `gate-state.json` compactor 收敛 | `state-compactor.ts` JSON-primary，`gate-core.ts` DB-only，当前只有 best-effort DB shadow sync | 明确 authoritative source；优先让 compactor 从 DB load/save，JSON hot file 降为导出缓存或退役 |
| **P1** | `gate-state.history/*.jsonl` 双轨退役 | compactor 仍 append JSONL，同时 DB 有 `gate_audit_history` | 设计 DB → archive/index 的重建路径，再决定 JSONL 只归档不新增或停止写入 |
| P1 | `.pending.json` 队列 DB 化 | dispatch FIFO 仍依赖共享 JSON 文件；self-test 已把它视为关键路径 | 新增 dispatch queue 表或继续保留 hardening rollout；不要和 `.pending.json.failed` 混为一类 |
| P2 | `.dispatch_ctx` 降级路径 | `session_map` 已有 per-session 字段，但 `.dispatch_ctx` 仍被 task-after 消费并被 resolver/gate fallback | 先保证 `session_log/session_map` 覆盖 task-after 所需信息，再移除 fallback |
| P2 | `_dispatch_target.json` 降级路径 | single shared file，已有 stale check 但仍可造成并发身份误判 | 评估 pre-execution/compliance-gate 是否可完全改为 `session_map` 或 OpenCode context |
| P2 | `.transaction-log` legacy bridge | 新代码已转 DB/atomicWriteSubState，但 doctor/CI/合规检查仍验证 WAL | 做依赖清单，先降级为历史兼容检查，再删除写入/恢复逻辑 |
| P2 | `gate-state.index.json` | 复杂索引与 `gate_session_index` 不等价，损坏后无法从当前 DB 完整重建 | 要么建立 DB 等价表，要么文档化为 compactor 专属文件并加重建/校验工具 |
| P3 | 遗留文件清理 | `.pending.json.failed`、`.session_map.json`、`machine.json.backup.*`、`migrated-*.bak`、`_plugins_backups/` | 先出清理脚本 dry-run，再执行删除 |
| P4 | 日志入 DB | `safe-bash.log`、`.task_temp/_logs/` 高频追加 | 不建议迁移，保留轮转/压缩/索引即可 |
| P4 | `Task.DAG.json` 入 DB | DAG 是人工/Agent 可读协作产物 | 不建议迁移；若需要一致性，做版本校验而不是 DB 化 |

---

## 六、关键混淆点修正

### 6.1 `read_audit`: 已进入 v10 Phase 1，不再是待迁移文件

| 维度 | 当前事实 |
|------|----------|
| DB schema | `read_audit` 表，`event_key` UNIQUE，索引：lookup/session_agent/task/created |
| 写入 | `recordRead()` 先写 DB，再始终写 JSONL fallback |
| 查询 | `verifyRead()` DB-first；DB miss 或 DB error 时查 JSONL |
| UC7KS | `knowledge_cache_attest.ts` 调共享 `getReadEventsForSession()`，不再内置 JSONL 扫描 |
| 待处理 | Phase 2 前需确认 DB/JSONL event_key 对账，并更新 schema 文案 |

### 6.2 `gate-state.json`: JSON-primary compactor + DB shadow sync

| 维度 | `gate-core.ts` | `state-compactor.ts` |
|------|----------------|----------------------|
| 主读写 | `loadGateStore/saveGateStore` 走 DB | `readHotState/writeHotState` 走 JSON 文件 |
| DB 同步 | authoritative DB path | `dbSyncCompactorHot/dbMarkSessionArchived/dbMarkSessionDrained` best-effort |
| 风险 | 不读 JSON hot file | DB sync 失败时 JSON 仍是 compactor primary |

修复目标不是简单“把双写删掉”，而是统一 authoritative source：要么 compactor 改为 DB-first，要么明确 JSON hot file 只是可重建缓存。

### 6.3 `.dispatch_ctx`: 当前可不存在，但路径仍活跃

| 用途 | 代码路径 | 当前风险 |
|------|----------|----------|
| dispatch 写入任务上下文 | `dispatch_subagent.ts` 写入 `{ dagTaskId, domainId, createdAt }` | shared file，天然有并发覆盖风险 |
| task-after 消费 | `task-after.ts` 读取后删除，用于 `dbAppendSessionLog()` | DB session_log 仍依赖它补齐 sub-agent session |
| resolver/gate fallback | `agent-resolver.ts`、`gate-core.ts` 读取 | fallback 触发时可能恢复旧竞态 |

因此它不能和 `.session_map.json` 一样直接标成死代码。退役前必须先替换 task-after 的会话关联来源。

### 6.4 `.pending.json.failed`: 已被 DB 替代，但 `.pending.json` 没有

`task-after.ts` 和 `dispatch-after.ts` 的失败/陈旧记录已写入 `dispatch_failed_log`。但 `.pending.json` 本身仍由 dispatch hardening 和 self-test 使用，不能因为 failed dead-letter 已迁移就把整个 pending queue 判为 DB 已替代。

### 6.5 `.session_map.json`: 遗留文件存在但主路径已是 DB

遗留文件位置是 `.task_temp/_dispatch/.session_map.json`。当前 `session.ts` 写 `session_map` DB，`agent-resolver.ts` 通过 `dbReadSessionMap()` 读 DB；遗留 JSON 可清理，但清理前需确认没有诊断脚本仍依赖历史内容。

---

## 七、关键数据指标

| 指标 | 当前值 |
|------|--------|
| DB 表数量 | 16 user tables + `sqlite_sequence` 内部表 |
| DB schema version | v10 |
| DB 主文件 | ~2.7 MB |
| DB WAL | ~4.8 MB |
| `read_audit` DB 行数 | 525 unique rows |
| `read_audit.jsonl` | 154 KB / 561 行 |
| `substate_kv` 行数 | 12 |
| 最大 substate blob | `knowledge_cache_state` ~870 KB |
| `gate-state.index.json` | 162 KB |
| `gate-state.history/` | 26 个 JSONL 日文件，约 1.1 MB |
| `.task_temp/_logs/` | 64 MB |
| `.task_temp/_dispatch/` | 21 MB |
| `.opencode/_plugins_backups/` | 189 MB |

---

*本报告基于 `.opencode/state/`、`.task_temp/_dispatch/`、`.opencode/logs/` 当前磁盘快照，以及 `db-manager.ts`、`db-state-manager.ts`、`substate-manager.ts`、`state-compactor.ts`、`agent-resolver.ts`、`dispatch_subagent.ts`、`task-before.ts`、`task-after.ts`、`dispatch-after.ts`、`read-audit.ts`、`knowledge_cache_attest.ts`、`migrate-read-audit.ts`、`framework-self-test.ts`、`state-transaction.ts` 交叉审计。*
