# context7-first Skill v2 Design v1.0

**Date**: 2026-06-05
**Phase**: UC7KS Phase 1 — Foundation (Task UC7-P1-T02)
**Source**: `uc7ks-design-analysis-v1.6.md` §2, §6.1, §11
**Status**: Design Document

---

## 1. Overview

The `context7-first` skill is being upgraded from a passive, manual skill to an **autonomous knowledge acquisition orchestrator**. v2.0 transforms it from "tell the agent to call Context7" to "guide the agent through the full UC7KS knowledge acquisition pipeline."

## 2. Existing Skill (v1.x) — What Changes

| Aspect | v1.x (Current) | v2.0 (Enhanced) |
|--------|---------------|-----------------|
| **Trigger** | Agent manually decides to call Context7 | Skill detects knowledge need from task description |
| **Library Identification** | Agent manually identifies libraries | NLP extraction from task + semantic map lookup |
| **User Confirmation** | Not required | UC7-002: mandatory user confirmation via `question` tool |
| **Local Cache Check** | Not mentioned | UC7-001: mandatory local-first search |
| **Fallback** | No fallback | Context7 → webfetch → websearch (graceful degradation) |
| **@Knowledge-Curator** | N/A (direct Context7 calls) | Route through @Orchestrator → @Knowledge-Curator |
| **Save Artifacts** | Not required | UC7-003: mandatory save to `docs/official_docs/` |
| **Post-Query** | Agent reads and discards | Indexed, deduplicated, searchable via `index.json` |

## 3. Skill File Structure

Target file: `.opencode/skills/context7-first/SKILL.md`

### 3.1 Skill Metadata

```yaml
name: context7-first
display_name: Context7-First (UC7KS v2)
version: 2.0.0
category: P1-领域专业类
priority: P1
```

### 3.2 Enhanced Skill Instructions

The v2 skill should guide agents through the following workflow:

```
1. PARSE task description for technology/library mentions
   → Extract: framework, library, tool, version keywords

2. CHECK local cache FIRST (UC7-001)
   → Search docs/official_docs/index.json for relevant entries
   → If cache hit → read cached docs → proceed with task

3. CACHE MISS → request @Orchestrator to dispatch @Knowledge-Curator
   → Provide: task context, extracted tech mentions, query intent
   → Do NOT call Context7 MCP tools directly (UC7-004)

4. WAIT for @Knowledge-Curator to return artifact paths
   → Read returned docs from docs/official_docs/
   → Apply knowledge to current task

5. PROCEED with implementation/investigation
   → Use acquired documentation as authoritative reference
```

### 3.3 Autonomous Library Identification Prompts

The skill should include NLP extraction prompts for the agent:

```markdown
## Technology Identification (Internal)
Before requesting @Knowledge-Curator, analyze the task:

1. **Identify technologies mentioned**:
   - Framework names: NestJS, Express, Angular, React, Vue
   - Libraries: Prisma, TypeORM, Jest, Playwright, ioredis
   - Tools: ESLint, Prettier, Docker, GitHub Actions
   - Versions: any version numbers mentioned

2. **Map to knowledge domains**:
   - Backend API → nestjs, express (backend domain)
   - Database → prisma, postgresql (database domain)
   - Frontend → angular, react, tailwindcss (frontend domain)
   - DevOps → docker, github-actions (devops domain)
   - Framework → eslint, typescript, git (framework domain)
   - OpenCode → opencode framework (opencode domain)

3. **Prioritize by relevance**:
   - Primary: directly mentioned in task (P0)
   - Secondary: commonly associated (P1)
   - Nice-to-have: optional context (P2)
```

### 3.4 User Confirmation Template

```markdown
## 📚 Knowledge Acquisition Plan

I identified these documentation needs for this task:

| # | Library | Domain | Source | Reason |
|---|---------|--------|--------|--------|
| 1 | @nestjs/core | Backend | Context7 | Implementing NestJS guard |
| 2 | @prisma/client | Database | Context7 | Database transaction patterns |

**Local Cache Status**: [X] entries found / [ ] cache miss

May I proceed with fetching the latest documentation?
```

## 4. Integration with UC7KS Pipeline

```
context7-first skill (v2)
  │
  ├── Detects knowledge need from task
  ├── Checks local cache (UC7-001)
  ├── Presents plan to user (UC7-002)
  ├── Routes through @Orchestrator → @Knowledge-Curator (UC7-004)
  │     └── @Knowledge-Curator executes acquisition pipeline
  │           ├── Context7 MCP
  │           ├── webfetch fallback
  │           ├── websearch fallback
  │           └── Scout escalation (Layer 3)
  ├── Receives artifact paths
  ├── Reads docs from docs/official_docs/
  └── Applies knowledge to task
```

## 5. Backward Compatibility

- v2.0 skill replaces v1.x entirely (breaking change)
- All agents that previously called Context7 directly will now route through UC7KS
- @Knowledge-Curator handles the actual MCP invocation
- The skill's trigger keywords remain: "开发, 代码, 实现, 技术栈, library, framework, 调试, 依赖管理"

---

*Document Version: 1.0.0*
*Source: `uc7ks-design-analysis-v1.6.md` §2, §6.1, §11, §12*
