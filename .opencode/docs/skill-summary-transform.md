# Skill Summary System Transform (Phase 3)

> **Created**: 2026-07-05
> **Phase**: 3
> **Status**: Design document (implementation after serve restart + verification)

---

## Design

Add `skill-summary` handler to system-dispatcher.ts:

```typescript
const HANDLER_MAP: Record<string, SystemFn> = {
  "anti-bypass": antiBypassSystem.handle,
  "skill-summary": skillSummarySystem.handle, // NEW
};
```

### Behavior
1. On session start, analyze session context (agent type, task description)
2. Match relevant Skills based on agent's registered skills + task keywords
3. Inject short Skill summary (100-300 tokens, NOT full content)
4. Log hit to writeLog("skill-summary", "INFO", { skill, reason, tokenEstimate })

### Constraints
- Maximum 3 Skill summaries per session start
- Each summary ≤ 300 tokens
- Total injection ≤ 800 tokens
- Only SKILL.md stub content, never FULL.md

### Configuration
```json
{
  "system_transform": {
    "skill_summary": {
      "enabled": true,
      "max_skills": 3,
      "max_tokens_per_skill": 300,
      "max_total_tokens": 800
    }
  }
}
```

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始设计文档 |
