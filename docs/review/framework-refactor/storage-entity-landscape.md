# 框架存储实体全景图 — DB 迁移状态总览

**生成日期**: 2026-06-18  
**复核快照**: 2026-06-18 23:43 Asia/Tokyo，本地工作区当前状态  
**DB Schema**: v9，15 张 user tables + 1 张 SQLite 内部表 `sqlite_sequence`  
**DB 文件**: `.opencode/state/framework-state.db` 约 2.7 MB，WAL 约 4.7 MB，SHM 32 KB

---

## 一、当前结论

1. P2-A DB 迁移主干已经成立：12 个 substate 全部走 `substate_kv`，合规门主状态走 `gate_sessions` 等 DB 表，调度失败/会话日志/session map 也已迁入 DB。
2. 当前最高优先级仍是 `read_audit.jsonl`：它现在同时支撑 READ-BEFORE-APPROVE 和 UC7KS `knowledge_cache_attest` 的读证据交叉验证，仍是 append-only 文件，尚未纳入 DB 事务和索引体系。
3. `gate-state.json` 的问题不再是“完全独立双写”那么简单：`state-compactor.ts` 仍以 JSON hot file 为主源，但新增了 best-effort DB shadow sync；`gate-core.ts` 主路径是 DB-only。两者仍然不是同一个强一致写入口。
4. 调度链路仍保留多个短生命周期文件：`.pending.json`、`.dispatch_ctx`、`.auto-dispatch`、`_dispatch_target.json`。其中 `.pending.json.failed` 和 `.session_map.json` 已被 DB 替代，但磁盘上仍有遗留文件。
5. `.transaction-log` 是 legacy bridge，不应再被描述成 substate 常规写入路径；新代码注释明确要求使用 `atomicWriteSubState()` 或 DB 事务，但 doctor/CI/合规检查仍引用它，退役前需要单独验证。

---

## 二、已迁移到 DB 的存储实体

### 2.1 DB 表清单

以下计数来自当前 SQLite 快照，运行中会变化。

| # | DB 表名 | Schema | 当前行数 | 用途 | 来源/替代对象 |
|:--:|---------|:------:|:------:|------|---------------|
| 1 | `machine_meta` | v1 | 6 | 机器/框架元数据 KV | `machine.json` meta |
| 2 | `machine_contracts` | v1 | 1 | 契约文件路径列表 | `machine.json` contracts |
| 3 | `gate_sessions` | v1/v5 | 53 | 合规门会话状态 | `gate-state.json` sessions |
| 4 | `gate_drained_sessions` | v1 | 128 | 过期排空会话归档 | `gate-state.json` drained |
| 5 | `gate_session_index` | v1 | 53 | sessionID/status 简索引 | `gate-state.json` index |
| 6 | `gate_audit_history` | v1 | 51 | 合规门审计历史 | `gate-state.history/*.jsonl` 的 DB 轨 |
| 7 | `gate_store_meta` | v1 | 3 | 合规门 store meta | `gate-state.json` meta |
| 8 | `audit_log` | v1 | 63 | 写审计日志 | 原 append audit |
| 9 | `audit_trail` | v1 | 0 | 审计追踪 | 原 audit trail |
| 10 | `session_log` | v6 | 99 | 子 Agent 会话生命周期 | `SESSION_ID.md` |
| 11 | `dispatch_failed_log` | v6 | 112 | 调度失败死信归档 | `.pending.json.failed` |
| 12 | `session_map` | v6/v8/v9 | 75 | sessionID → agent + dagTaskId + domainId | `.session_map.json` / `.dispatch_ctx` |
| 13 | `substate_kv` | v2 | 12 | 12 个子状态 JSON blob | `*-state.json` |
| 14 | `file_baseline_kv` | v4 | 240 | 文件基线注册/TOCTOU 检测 | file baseline JSON |
| 15 | `schema_version` | v1 | 9 | DB schema migration 记录 | DB 内部元数据 |
| 16 | `sqlite_sequence` | SQLite | 4 | SQLite 自增序列 | 内部表，不算框架实体 |

### 2.2 `substate_kv` 中的 12 个子状态

| # | Key | 原文件名 | 当前大小 | 状态 | 说明 |
|:--:|-----|---------|:------:|:----:|------|
| 1 | `knowledge_cache_state` | `knowledge-cache-state.json` | ~840 KB | DB-only | 最大 blob，UC7KS discovery/attestation 主要状态 |
| 2 | `write_audit_state` | `write-audit-state.json` | ~162 KB | DB-only | 写审计状态 |
| 3 | `compliance_records` | `compliance-records.json` | ~154 KB | DB-only | 合规记录 |
| 4 | `eslint_state` | `eslint-state.json` | ~53 KB | DB-only | ESLint 审计状态 |
| 5 | `dependency_state` | `dependency-state.json` | ~13 KB | DB-only | 依赖状态 |
| 6 | `keystone_hashes` | `keystone-hashes.json` | ~2.7 KB | DB-only | 契约 SHA-256 哈希 |
| 7 | `knowledge_audit_state` | `knowledge-audit-state.json` | 552 B | DB-only | 知识审计状态 |
| 8 | `knowledge_state` | `knowledge-state.json` | 537 B | DB-only | 知识状态 |
| 9 | `transaction_state` | `transaction-state.json` | 191 B | DB-only | 事务状态 |
| 10 | `tdd_enforcement_state` | `tdd-enforcement-state.json` | 178 B | DB-only | TDD 强制阶段状态 |
| 11 | `format_state` | `format-state.json` | 107 B | DB-only | 格式化状态 |
| 12 | `type_check_state` | `type-check-state.json` | 82 B | DB-only | 类型检查状态 |

`SUBSTATE_FILES` 映射仍保留在 `substate-manager.ts`，但当前 `readSubState/writeSubState/atomicWriteSubState` 经 `db-state-manager.ts` 操作 `substate_kv`，不是读写这些旧 JSON 文件。

---

## 三、仍保留为文件的存储实体

### 3.1 核心状态文件

| # | 文件路径 | 当前大小 | 用途 | 当前读写方 | 判断 |
|:--:|---------|:------:|------|-----------|------|
| 1 | `.opencode/state/machine.json` | 264 B | 机器 meta/contracts 快照 | machine meta 兼容层 | DB 已有主数据，文件更像兼容快照 |
| 2 | `.opencode/state/gate-state.json` | 733 B | compactor hot state | `state-compactor.ts` `readHotState/writeHotState` | JSON-primary + best-effort DB sync，仍需统一入口 |
| 3 | `.opencode/state/gate-state.index.json` | 161 KB | compactor v3 历史索引 | `state-compactor.ts` `readIndex/writeIndex` | 无等价 DB 表，不能简单等同 `gate_session_index` |
| 4 | `Task.DAG.json` | 78 KB | DAG 任务图 | Meta-Planner/Orchestrator/DAG 工具 | 结构复杂，保留文件合理 |
| 5 | `.opencode/state/read_audit.jsonl` | 47 KB / 170 行 | read 工具审计 | `read-audit.ts`、`knowledge_cache_attest.ts` | P0 待迁移，当前仍是文件 source |

### 3.2 调度/会话临时文件

| # | 文件路径 | 当前状态 | 读写方 | DB 替代/风险 |
|:--:|---------|---------|--------|--------------|
| 6 | `.task_temp/_dispatch/.pending.json` | 活跃，945 B | dispatch-subagent 生成；`task-before/dispatch-after/self-test` 校验/清理 | 尚无 DB 队列；仍是 dispatch FIFO 关键路径 |
| 7 | `.task_temp/_dispatch/.dispatch_ctx` | 活跃，97 B | `dispatch_subagent.ts` 写；`task-after.ts` 消费；`agent-resolver.ts/gate-core.ts` fallback 读 | `session_map` 是主路径，但该 shared file 仍有竞态遗留风险 |
| 8 | `.task_temp/_dispatch/.auto-dispatch` | 短生命周期，当前可不存在 | `dispatch_subagent.ts` 写；`task-before.ts` 消费；`dispatch-auto.ts` 清理 | LLM-free bridge，不能迁移前随意删除 |
| 9 | `.task_temp/_dispatch_target.json` | 短生命周期，当前不存在 | `dispatch-before/pre-execution/compliance-gate/agent-resolver` fallback；`dispatch-after` 清理 | single shared file，已有 run_id/mtime stale check |
| 10 | `.task_temp/_dispatch/.pending.json.failed` | 遗留文件，31 KB / 561 行 | 当前失败写入已走 `dispatch_failed_log` | 可清理候选，清理前确认无诊断依赖 |
| 11 | `.task_temp/_dispatch/.session_map.json` | 遗留文件，5.4 KB | 当前主代码已走 `session_map` DB | 不是项目根文件；磁盘仍存在但应视为历史 artifact |

### 3.3 日志/审计文件

| # | 文件路径 | 当前大小 | 用途 | 判断 |
|:--:|---------|:------:|------|------|
| 12 | `.opencode/logs/safe-bash.log` | 979 KB | shell 命令 allow/block 审计 | 高频追加，保留文件合理 |
| 13 | `.opencode/logs/safe-bash.log.1~4` | ~408 KB | 轮转日志 | 归档文件 |
| 14 | `.opencode/logs/safe-bash.log.*.gz` | ~38 KB | 压缩轮转日志 | 归档文件 |
| 15 | `.task_temp/_logs/` | 58 MB | 插件结构化日志目录树 | 高频追加 + 分日期目录，保留文件合理 |
| 16 | `.opencode/state/.transaction-log` | 15 KB / 70 行 | legacy state transaction WAL | 不再应视为常规 substate 写入路径；仍被 doctor/CI/合规检查引用 |
| 17 | `.opencode/state/gate-state.history/*.jsonl` | 26 个日文件，目录约 1.1 MB | compactor 历史 JSONL | 与 `gate_audit_history` DB 双轨并存 |

### 3.4 配置、Schema、归档

| 类别 | 路径/数量 | 判断 |
|------|-----------|------|
| 项目配置 | `.opencode/project.config.json`, `.opencode/settings.json`, `.opencode/config/eslint-red-exemptions.json`, `.opencode/generated/tier-rules.json` | 配置数据，不属于 DB 迁移目标 |
| 根部 Schema | `.opencode/state/*.schema.json` 6 个 | 校验定义，保留文件合理 |
| 子状态 Schema | `.opencode/state/schemas/*.schema.json` 17 个 | 校验定义，保留文件合理 |
| history migrated backup | `.opencode/state/gate-state.history/migrated-*.bak` 1 个，约 446 KB | 可清理候选 |
| machine backup | `.opencode/state/machine.json.backup.*` 1 个，约 1.1 MB | 可清理候选 |
| 插件备份 | `.opencode/_plugins_backups/` 约 189 MB | 最大可清理候选 |
| dispatch 历史产物 | `.task_temp/_dispatch/` 约 21 MB | 多数是历史 prompt/report，清理需保留当前 pending/ctx 文件 |
| 空 artifact | `.opencode/state/substate_kv.db` 0 B | 当前未见代码使用，可列入清理审计 |

---

## 四、迁移状态汇总

| 状态 | 实体 | 当前判断 |
|------|------|----------|
| 完全 DB 主路径 | `substate_kv` 12 key、`audit_log`、`audit_trail`、`session_log`、`dispatch_failed_log`、`session_map`、machine/gate 主表、`file_baseline_kv` | 主迁移完成 |
| DB + 文件快照 | `machine.json` | 低风险兼容快照 |
| DB + 文件双轨 | `gate-state.json`、`gate-state.history/*.jsonl` | compactor 仍操作文件，DB 只是主路径或 shadow sync，需继续收敛 |
| 文件主路径 | `read_audit.jsonl`、`gate-state.index.json`、`.pending.json`、`.auto-dispatch`、`_dispatch_target.json`、`Task.DAG.json`、日志目录 | 部分合理，部分需迁移 |
| DB 已替代但文件遗留 | `.pending.json.failed`、`.task_temp/_dispatch/.session_map.json` | 可清理，但先确认诊断/回放依赖 |
| Legacy bridge | `.transaction-log`、`state-transaction.ts` | 不宜直接删除，需先移除 doctor/CI/合规检查依赖 |

---

## 五、待处理优先级

| 优先级 | 实体/主题 | 原因 | 建议动作 |
|:------:|-----------|------|----------|
| P0 | `read_audit.jsonl` → DB | 现在同时支撑审批读证据和 UC7KS 读前写证明；文件扫描无法做 session/agent/path 索引，也缺少 DB 事务一致性 | 新增 `read_audit_log` 表与索引；`recordRead/verifyRead/getReadEventsForSession/knowledge_cache_attest` 全部改 DB-first，保留 JSONL 只读迁移或短期镜像 |
| P1 | `gate-state.json` compactor 收敛 | `state-compactor.ts` JSON-primary，`gate-core.ts` DB-only，当前只有 best-effort DB shadow sync | 明确一个 authoritative source；优先让 compactor 从 DB load/save，JSON hot file 降为导出缓存或完全退役 |
| P1 | `gate-state.history/*.jsonl` 双轨退役 | compactor 仍 append JSONL，同时 DB 有 `gate_audit_history` | 设计 DB → archive/index 的重建路径，再决定 JSONL 只归档不新增或彻底停止写入 |
| P1 | `.pending.json` 队列 DB 化 | dispatch FIFO 仍依赖共享 JSON 文件；self-test 已把它视为关键路径 | 新增 dispatch queue 表或把当前 hardening 继续保留为 rollout；不要和 `.pending.json.failed` 混为一类 |
| P2 | `.dispatch_ctx` 降级路径 | `session_map` 已有 per-session 字段，但 `.dispatch_ctx` 仍被 task-after 消费并被 resolver/gate fallback | 先保证 `session_log/session_map` 覆盖 task-after 所需信息，再移除 fallback |
| P2 | `_dispatch_target.json` 降级路径 | single shared file，已有 stale check 但仍可造成并发身份误判 | 评估 pre-execution/compliance-gate 是否可完全改为 `session_map` 或 OpenCode context |
| P2 | `.transaction-log` legacy bridge | 新代码已转 DB/atomicWriteSubState，但 doctor/CI/合规检查仍验证 WAL | 做依赖清单，先降级为历史兼容检查，再删除写入/恢复逻辑 |
| P2 | `gate-state.index.json` | 复杂索引与 `gate_session_index` 不等价，损坏后无法从当前 DB 完整重建 | 要么建立 DB 等价表，要么文档化为 compactor 专属文件并加重建/校验工具 |
| P3 | 遗留文件清理 | `.pending.json.failed`、`.session_map.json`、`machine.json.backup.*`、`migrated-*.bak`、`substate_kv.db` | 先出清理脚本 dry-run，再执行删除 |
| P4 | 日志入 DB | `safe-bash.log`、`.task_temp/_logs/` 高频追加 | 不建议迁移，保留轮转/压缩/索引即可 |
| P4 | `Task.DAG.json` 入 DB | DAG 是人工/Agent 可读协作产物 | 不建议迁移；若需要一致性，做版本校验而不是 DB 化 |

---

## 六、关键混淆点修正

### 6.1 `gate-state.json`: 从“独立双写”改判为“JSON-primary compactor + DB shadow sync”

| 维度 | `gate-core.ts` | `state-compactor.ts` |
|------|----------------|----------------------|
| 主读写 | `loadGateStore/saveGateStore` 走 DB | `readHotState/writeHotState` 走 JSON 文件 |
| DB 同步 | authoritative DB path | `dbSyncCompactorHot/dbMarkSessionArchived/dbMarkSessionDrained` best-effort |
| 风险 | 不读 JSON hot file | DB sync 失败时 JSON 仍是 compactor primary |

修复目标不是简单“把双写删掉”，而是统一 authoritative source：要么 compactor 改为 DB-first，要么明确 JSON hot file 只是可重建缓存。

### 6.2 `.dispatch_ctx`: 不是已退役文件

当前 `.dispatch_ctx` 仍有三类用途：

| 用途 | 代码路径 | 当前风险 |
|------|----------|----------|
| dispatch 写入任务上下文 | `dispatch_subagent.ts` 写入 `{ dagTaskId, domainId, createdAt }` | shared file，天然有并发覆盖风险 |
| task-after 消费 | `task-after.ts` 读取后删除，用于 `dbAppendSessionLog()` | DB session_log 仍依赖它补齐 sub-agent session |
| resolver/gate fallback | `agent-resolver.ts`、`gate-core.ts` 读取 | fallback 触发时可能恢复旧竞态 |

因此它不能和 `.session_map.json` 一样直接标成死代码。退役前必须先替换 task-after 的会话关联来源。

### 6.3 `.session_map.json`: 路径和状态需要准确

遗留文件位置是 `.task_temp/_dispatch/.session_map.json`，不是项目根目录 `.session_map.json`。当前 `session.ts` 写 `session_map` DB，`agent-resolver.ts` 通过 `dbReadSessionMap()` 读 DB；`getSessionMapPath()` 和 `SESSION_MAP_FILE` 是遗留 API。磁盘上仍有旧文件，不能写成“不存在”，但可以列为可清理候选。

### 6.4 `.pending.json.failed`: 已被 DB 替代，但 `.pending.json` 没有

`task-after.ts` 和 `dispatch-after.ts` 的失败/陈旧记录已写入 `dispatch_failed_log`。但 `.pending.json` 本身仍由 dispatch hardening 和 self-test 使用，不能因为 failed dead-letter 已迁移就把整个 pending queue 判为 DB 已替代。

### 6.5 `read_audit.jsonl`: 优先级上升

`read-audit.ts` 仍通过 `fs.appendFileSync` 记录 read 事件，并通过整文件扫描验证。`knowledge_cache_attest.ts` 还直接读取同一个 JSONL 来校验 agent/session 实际读过的 cache 文件。它已经从单一审批辅助日志变成写前知识证明的关键证据源，应优先 DB 化。

---

## 七、关键数据指标

| 指标 | 当前值 |
|------|--------|
| DB 表数量 | 15 user tables + `sqlite_sequence` 内部表 |
| DB schema version | v9 |
| DB 主文件 | ~2.7 MB |
| DB WAL | ~4.7 MB |
| `substate_kv` 行数 | 12 |
| 最大 substate blob | `knowledge_cache_state` ~840 KB |
| `read_audit.jsonl` | 47 KB / 170 行 |
| `gate-state.index.json` | 161 KB |
| `gate-state.history/` | 26 个 JSONL 日文件，约 1.1 MB |
| `.task_temp/_logs/` | 58 MB |
| `.task_temp/_dispatch/` | 21 MB |
| `.opencode/_plugins_backups/` | 189 MB |

---

*本报告基于 `.opencode/state/`、`.task_temp/_dispatch/`、`.opencode/logs/` 当前磁盘快照，以及 `db-manager.ts`、`db-state-manager.ts`、`substate-manager.ts`、`state-compactor.ts`、`agent-resolver.ts`、`dispatch_subagent.ts`、`task-before.ts`、`task-after.ts`、`dispatch-after.ts`、`read-audit.ts`、`knowledge_cache_attest.ts`、`state-transaction.ts` 交叉审计。*
