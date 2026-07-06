# ACP Active Intervention — Minimal Version (Phase 3)

> **Created**: 2026-07-05
> **Phase**: 3
> **Implementation**: QoderWork-side (no work-one framework code changes)

---

## Architecture

QoderWork monitors Agent behavior via SSE events and injects guidance when needed.

```
Agent → SSE events → QoderWork SSE daemon → Signal detection → Guidance injection
                                                                    ↓
                                              serve API prompt_async or DB guidance_text
```

## Detected Signals (Minimal)

### Signal 1: "目标未清就动手"
**Detection**: Agent calls write tool (safe_edit/write) without prior skill/brainstorming call in same session.
**Method**: Track tool call sequence via SSE events. If `safe_edit` appears before any `skill` or `brainstorming` call → trigger.
**Intervention**: `prompt_async` with short guidance: "Please clarify your goal before modifying code. Consider using brainstorming micro-card."

### Signal 2: "多次 tool failure"
**Detection**: Same session has 3+ consecutive `tool.failed` events.
**Method**: Count consecutive failures from SSE stream.
**Intervention**: `prompt_async` with failure context: "You have failed N times. Consider: 1) Re-read the error message, 2) Check if you need a different approach, 3) Call question to ask QoderWork."

## Implementation (QoderWork Side)

No work-one framework code changes needed. QoderWork implements:

1. **SSE consumer**: Continuously consume events from `GET /event`
2. **Signal detector**: Pattern-match on event sequences
3. **Intervention dispatcher**: Use `POST /session/{id}/prompt_async` or DB `guidance_text`

### serve API Endpoints Used
- `GET /event` — SSE event stream
- `POST /session/{id}/prompt_async` — inject guidance when agent is idle
- DB `guidance_text` write — inject guidance when agent is working

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始设计文档 |
