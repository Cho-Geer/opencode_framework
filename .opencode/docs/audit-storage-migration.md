# Audit Storage Migration: DB → JSONL (Phase 4)

> **Created**: 2026-07-05
> **Phase**: 4
> **Status**: Design document

---

## Migration Targets

| Event | Current Store | Target Store | Reason |
|-------|--------------|--------------|--------|
| Tool audit (read_audit) | DB | JSONL | Append-only, failure shouldn't block |
| Quality signals | DB | JSONL + sampled DB index | Ordinary quality signals don't need transactions |
| Skill usage | DB (Phase 1 skill-audit) | JSONL | Already JSONL via writeLog |
| Dispatch attempts | DB | JSONL | Append-only log |
| Guidance state | DB + JSONL | Keep DB + JSONL | Needs recovery and cross-session queries |
| Dispatch trace | DB + JSONL | Keep DB + JSONL | Needs resume and ACP observation |

## JSONL Format

File: `.task_temp/_logs/audit.jsonl`

```json
{"event":"READ","sessionId":"ses_xxx","agent":"Coder-BE","file":"src/foo.ts","timestamp":"2026-07-05T12:00:00Z"}
{"event":"DISPATCH","sessionId":"ses_xxx","target":"Architect","dagTaskId":"task-001","timestamp":"2026-07-05T12:01:00Z"}
```

## Migration Steps

1. **Add JSONL writer** to after/unified-audit.ts (write to audit.jsonl)
2. **Dual-write period**: Write to both DB and JSONL (1 week)
3. **Switch read paths**: Change any code that reads read_audit to read from JSONL
4. **Stop DB writes**: Remove read_audit INSERT from after/read-track
5. **Keep table**: Don't DROP read_audit table (backward compat)

## Rollback

If JSONL approach fails:
- Re-enable DB writes for read_audit
- JSONL data can be imported back to DB if needed

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始迁移设计 |
