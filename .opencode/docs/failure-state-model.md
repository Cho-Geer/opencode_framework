# Failure State Model (Phase 3)

> **Created**: 2026-07-05
> **Phase**: 3

---

## Current State (Phase 0-2)

4 counters in tool_enforcement:
| Counter | Purpose |
|---------|---------|
| consecutive_failures | Current session consecutive failures |
| soft_rejections | Per-tool soft rejection count |
| total_failures | Lifetime failure count |
| compliance_blocks | Lifetime block count |

## Simplified Model (Phase 3+)

| Field | Purpose | Replaces |
|-------|---------|----------|
| failure_count | Current session consecutive failures | consecutive_failures |
| last_failure | Last failure summary (string) | (new) |
| guidance_required | Whether question is mandatory | (new, derived) |
| tool_rejections | Per-tool rejection log (JSONL) | soft_rejections |

### Removed from runtime
- `total_failures` → moved to audit aggregation (JSONL)
- `compliance_blocks` → moved to audit aggregation (JSONL)

### Migration path
1. Add new fields alongside old (dual-write period)
2. Switch read paths to new fields
3. Stop writing old fields
4. Old fields remain in DB for historical queries

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始模型定义 |
