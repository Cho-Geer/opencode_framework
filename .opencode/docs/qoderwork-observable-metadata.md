# QoderWork 可观测 Dispatch Metadata (Phase 2)

> **Created**: 2026-07-05
> **Phase**: 2

---

## 可观测字段

QoderWork 通过 serve API 或 SSE 可观察以下 dispatch 元数据：

| 字段 | 来源 | 说明 |
|------|------|------|
| parent session | GET /session/{id} | 父 session ID |
| child session | GET /session/{id}/children | 子 session 列表 |
| selected native executor | session agent field | 当前执行器类型 |
| legacy alias | session_map agent field | 旧 Agent 名称 |
| loaded Skill list | session skills | 已加载 Skill |
| route suggestion | writeLog ROUTE-SUGGESTION | L0-L4 路由建议 |
| guidance status | tool_enforcement DB | guidance gate 状态 |
| dispatch cost/tokens | session.next.step.ended SSE | 资源消耗 |

## 观察方法

### 1. 活跃 session 列表
```bash
curl -s http://localhost:4096/session | jq '.[] | {id, agent, title, status}'
```

### 2. 子 session 关系
```bash
curl -s http://localhost:4096/session/{parentId}/children | jq '.[] | {id, agent, title}'
```

### 3. SSE 事件流
```bash
# SSE daemon 持续消费事件
curl -sN http://localhost:4096/event | jq -c '.'
```

### 4. Handler 日志
```bash
# dispatch 路由建议
grep 'ROUTE-SUGGESTION' .task_temp/_logs/$(date +%Y-%m-%d)/*.log
# Skill 加载审计
grep 'SKILL-LOADED' .task_temp/_logs/$(date +%Y-%m-%d)/*.log
```

### 5. DB 状态
```bash
# session_map: alias → executor 映射
bun -e "const{Database}=require('bun:sqlite');const db=new Database('.opencode/state/framework-state.db');console.log(JSON.stringify(db.query('SELECT * FROM session_map').all(),null,2));db.close()"
```

## QoderWork 主动干预信号

| 信号 | 检测方法 | 干预方式 |
|------|----------|----------|
| 目标未清就动手 | Agent 调用 write 但未调用 skill/brainstorming | prompt_async 注入 guidance |
| 多次 tool failure | 同一 session 连续 3 次 tool.failed | DB guidance_text 写入 |
| route mismatch | ROUTE-SUGGESTION 日志 | 观察，不干预（仅记录） |

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始 metadata 定义 |
