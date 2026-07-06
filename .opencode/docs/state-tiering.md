# DB State Tiering (Phase 4)

> **Created**: 2026-07-05
> **Phase**: 4 (Minimal State)
> **Total tables**: 41 (schema v32)

---

## Tier Classification

### Critical (9 tables) — Hot-path read/write OK
Must keep. Required for core framework operation.

| Table | Rows | Purpose |
|-------|------|---------|
| audit_log | 1 | Security audit trail |
| backup_log | 0 | File backup tracking |
| dispatch_queue | 2 | Active dispatch queue |
| schema_version | 25 | Schema migration history |
| session_map | 7 | Agent/session identity mapping |
| soft_rejections | 7 | Per-tool soft rejection state |
| substate_kv | 7 | Sub-state key-value store |
| tool_enforcement | 8 | Enforcement counters |
| uc7ks_pipeline_state | 2 | Knowledge pipeline state |

### Observable (17 tables) — Append-only, non-blocking
Read freely. Writes are append-only and should not block tool execution.

| Table | Rows | Purpose |
|-------|------|---------|
| approval_read_context | 0 | Approval read tracking |
| audit_trail | 0 | Extended audit trail |
| dispatch_attempts | 0 | Dispatch attempt log |
| dispatch_failed_log | 0 | Failed dispatch log |
| dispatch_payload_integrity | 2 | Payload hash verification |
| dispatch_prompt_refs | 2 | Prompt reference tracking |
| file_baseline_kv | 0 | File baseline key-value |
| gate_audit_history | 0 | Gate audit history |
| gate_sessions | 17 | Gate session tracking |
| gate_store_meta | 3 | Gate metadata |
| machine_contracts | 0 | Machine state contracts |
| machine_meta | 0 | Machine metadata |
| notifications | 0 | Notification queue |
| read_audit | 104 | File read audit trail |
| session_log | 0 | Session event log |
| tsc_gate_events | 0 | TSC gate events |
| tsc_gate_locks | 0 | TSC gate locks |

### Optional (4 tables) — Only write for high-risk tasks
Skip writes for ordinary bugfix/feature tasks.

| Table | Rows | Purpose |
|-------|------|---------|
| execution_checklist_events | 35 | Checklist state changes |
| execution_checklist_items | 494 | Checklist item details |
| execution_checklist_runs | 19 | Checklist run records |
| notification_readers | 0 | Notification read tracking |

### Cold (6 tables) — Background maintenance only
Never write in hot-path. Background jobs only.

| Table | Rows | Purpose |
|-------|------|---------|
| gate_compactor_index | 0 | Gate compaction index |
| knowledge_entries | 0 | Knowledge base entries |
| knowledge_entry_tags | 0 | Knowledge tags |
| knowledge_files | 0 | Knowledge file index |
| knowledge_materialization_jobs | 0 | Knowledge materialization |
| knowledge_session_access_archive | 0 | Knowledge access archive |

### Deprecated (5 tables) — Shadow log then remove
Candidates for removal after 1-week shadow logging period.

| Table | Rows | Purpose |
|-------|------|---------|
| agent_registry_snapshot | 0 | Agent registry cache |
| gate_drained_sessions | 0 | Drained session log |
| gate_session_index | 17 | Gate session search index |
| permission_snapshot | 0 | Permission cache |
| template_resolution_snapshot | 0 | Template resolution cache |

---

## Hot-Path Reduction Strategy

### Phase 4 (current)
- Optional tables: skip writes when task is not high-risk
- Cold tables: ensure no hot-path writes exist
- Deprecated tables: begin shadow logging

### Phase 4+ (future)
- Observable tables: migrate append-only writes to JSONL
- Keep DB for read queries only
- Critical tables: remain in DB (need transactional guarantees)

### Target
- Hot-path DB touches per safe_edit: 3-5 → 1-2
- JSONL for: read_audit, dispatch_attempts, audit_trail, gate_audit_history
- DB for: session_map, dispatch_queue, tool_enforcement, substate_kv, schema_version

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始分级 (44 tables, schema v33) |


---

## Phase 0 更新 (2026-07-05 19:55)

表数从 41 修正为 **44**，schema 从 v32 修正为 **v33**。

新增的 3 个表（待分级）：
- `session_registry` — session 注册表（建议 Critical）
- `session_events` — session 事件日志（建议 Observable）
- `tool_guidance_state` — 工具指导状态（建议 Observable）
