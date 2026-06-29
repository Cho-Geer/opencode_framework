# 框架内置DB查询指南

**版本**: 1.0.0  
**最后更新**: 2026-06-26  
**数据库**: `.opencode/state/framework-state.db` (SQLite, ~20MB)  
**驱动**: `bun:sqlite` (框架写入) / `node:sqlite` (Node 22+ 查询)

---

## 环境准备

```bash
node -e "var sqlite=require('node:sqlite');var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');..."
```

> ⚠️ 这是 SQLite，不是 PostgreSQL。`postgre_sql_query` 工具不能查询它。
> ⚠️ 只读 SELECT 完全安全，不影响框架运行。

## 表总览 (36张)

| 类别 | 表名 | 用途 |
|------|------|------|
| 核心状态 | machine_meta | 状态机元数据 |
| | machine_contracts | 契约 SHA-256 哈希 |
| | substate_kv | 子状态 KV 存储 (JSON blob) |
| 合规门禁 | gate_sessions | 门禁会话完整生命周期 (30列) |
| | gate_drained_sessions | 已排干会话 |
| | gate_session_index | 会话索引 |
| | gate_store_meta | 存储元数据 |
| | gate_audit_history | 审计历史 |
| 会话管理 | session_map | Session-Agent-Task 映射 |
| | session_log | 会话日志 (dag_task_id 索引) |
| 审计 | audit_log | 审计事件日志 |
| | audit_trail | 审计追踪 |
| | read_audit | 文件读取审计 |
| 分发 | dispatch_queue | FIFO 分发队列 |
| | dispatch_attempts | 分发尝试 |
| | dispatch_failed_log | 失败日志 |
| | dispatch_prompt_refs | 提示引用 |
| | dispatch_payload_integrity | 载荷完整性 |
| P0检查清单 | execution_checklist_runs | 运行记录 |
| | execution_checklist_items | 检查项 |
| | execution_checklist_events | 事件 |
| 知识管道 | knowledge_entries | UC7KS 知识条目 |
| | knowledge_entry_tags | 条目标签 |
| | knowledge_files | 文件清单 |
| | knowledge_materialization_jobs | 物化任务 |
| | knowledge_session_access_archive | 会话访问归档 |
| | uc7ks_pipeline_state | 管道状态 |
| 快照 | permission_snapshot | 权限快照 |
| | agent_registry_snapshot | Agent 快照 |
| | template_resolution_snapshot | 模板快照 |
| 其他 | schema_version | 迁移版本 |
| | approval_read_context | 批准上下文 |
| | backup_log | 备份日志 |
| | file_baseline_kv | 基线 KV |
| | gate_compactor_index | 压缩索引 |

## 表结构速查

### gate_sessions (30列)

```
session_id   TEXT PK   -- 会话ID
status       TEXT      -- checked/armed/delivered/completed/drained/failed
agent        TEXT      -- Agent类型
task_id      TEXT      -- DAG任务ID
plan_summary TEXT      -- 计划摘要
created_at   INTEGER   -- 创建时间 (Unix毫秒)
armed_at     INTEGER   -- 武装时间
completed_at INTEGER   -- 完成时间
drained_at   INTEGER   -- 排干时间
expires_at   INTEGER   -- 过期时间
enforcement_mode TEXT  -- 执行模式
last_check_passed INTEGER
fail_reason  TEXT      -- 失败原因
declared_deliverables  TEXT
submitted_deliverables TEXT
deliverables_approved_by TEXT
deliverables_approved_at INTEGER
approval_required INTEGER
opencode_session_id TEXT
```

### session_map

```
session_id  TEXT
agent       TEXT
dag_task_id TEXT -- 索引
domain_id   TEXT -- 索引
model_id    TEXT
created_at  INTEGER
updated_at  INTEGER
```

### session_log (索引: dag_task_id, session_id, agent_type)

```
id         INTEGER PK
session_id TEXT
dag_task_id TEXT
agent_type TEXT
run_id     TEXT
created_at INTEGER
```

### substate_kv

```
key        TEXT PK  -- 如 compliance_records, eslint_state
json       TEXT     -- 完整 JSON blob
updated_at INTEGER
```

### audit_log (索引: session_id, event_type)

```
id         INTEGER PK
session_id TEXT
agent      TEXT
event_type TEXT
detail     TEXT
timestamp  INTEGER
```

## 实用查询示例

### 1. 查看最新门禁会话

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT session_id,status,agent,task_id,created_at FROM gate_sessions ORDER BY created_at DESC LIMIT 5').all();
console.log(JSON.stringify(r,null,2))
"
```

### 2. 查看 Session 映射

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT * FROM session_map ORDER BY created_at DESC LIMIT 10').all();
console.log(JSON.stringify(r,null,2))
"
```

### 3. 按 dag_task_id 模糊查询

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare(\"SELECT * FROM session_log WHERE dag_task_id LIKE '%E2E%' ORDER BY created_at DESC LIMIT 10\").all();
console.log(JSON.stringify(r,null,2))
"
```

### 4. 查看知识缓存条目

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT library_id,topic,status,ttl_days FROM knowledge_entries LIMIT 10').all();
console.log(JSON.stringify(r,null,2))
"
```

### 5. 查看审计日志

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT event_type,agent,substr(detail,1,80) as preview,timestamp FROM audit_log ORDER BY timestamp DESC LIMIT 5').all();
console.log(JSON.stringify(r,null,2))
"
```

### 6. 查看 substate_kv 所有 key

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT key,length(json) as bytes,updated_at FROM substate_kv').all();
console.log(JSON.stringify(r,null,2))
"
```

### 7. 统计各状态门禁会话数

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT status,count(*) as cnt FROM gate_sessions GROUP BY status ORDER BY cnt DESC').all();
console.log(JSON.stringify(r,null,2))
"
```

### 8. 按 Agent 统计会话数

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT agent,count(*) as cnt FROM gate_sessions GROUP BY agent ORDER BY cnt DESC').all();
console.log(JSON.stringify(r,null,2))
"
```

### 9. 分发失败日志

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var r=db.prepare('SELECT * FROM dispatch_failed_log ORDER BY failed_at DESC LIMIT 5').all();
console.log(JSON.stringify(r,null,2))
"
```

### 10. 跨表关联 (gate_sessions + session_map + session_log)

```bash
node -e "
var sqlite=require('node:sqlite');
var db=new sqlite.DatabaseSync('.opencode/state/framework-state.db');
var sql='SELECT g.session_id,g.status,g.agent,g.created_at,'+
' s.dag_task_id,sl.agent_type as slog_agent '+
' FROM gate_sessions g '+
' LEFT JOIN session_map s ON g.session_id=s.session_id '+
' LEFT JOIN session_log sl ON g.session_id=sl.session_id '+
' ORDER BY g.created_at DESC LIMIT 10';
var r=db.prepare(sql).all();
console.log(JSON.stringify(r,null,2))
"
```

## 查询技巧

1. **时间戳转换**: created_at 等是 Unix 毫秒整数, `new Date(val)` 转换
2. **JSON 字段**: substate_kv.json 用 `JSON.parse()` 解析
3. **模糊搜索**: `WHERE agent LIKE '%Coder%'` 或 `WHERE event_type LIKE 'dispatch%'`
4. **分页**: `LIMIT x OFFSET y`
5. **表关联**: 四张核心表通过 session_id 关联
6. **只读安全**: SELECT 不影响框架运行

## DB 文件位置

| 文件 | 大小 | 说明 |
|------|------|------|
| .opencode/state/framework-state.db | ~20MB | 主数据库 (36表) |
| .opencode/state/substate_kv.db | ~0B | 预留 KV |
| .opencode/state/framework-state.db-wal | 动态 | WAL 日志 |
| .opencode/state/framework-state.db-shm | 动态 | 共享内存 |

## 注意事项

- ⚠️ 框架用 bun:sqlite 写入, 查询用 node:sqlite (Node 22+)
- ✅ SELECT 只读安全
- ❌ 不要同时用其他客户端写入
- 📌 WAL 模式, 查询性能好
- 📌 datetime 字段是 Unix 毫秒整数, 非 ISO 字符串
