# Scout Integration Contract v1.0

**Date**: 2026-06-05
**Phase**: UC7KS Phase 1 — Foundation (Task UC7-P1-T08)
**Source**: `uc7ks-design-analysis-v1.6.md` §11.6, OpenCode Official Docs (Agents, Scout)
**Status**: Design Document

---

## 1. Overview

This document defines the **integration contract** between @Knowledge-Curator and OpenCode's built-in **Scout subagent**. Scout serves as Layer 3 of the UC7KS knowledge acquisition pipeline — it is invoked **only when documentation-tier sources (Context7, webfetch, websearch) are insufficient** for implementation-level questions.

## 2. Scout Subagent Profile (OpenCode Built-in)

| Attribute | Value |
|-----------|-------|
| **Name** | `scout` |
| **Type** | Built-in subagent (OpenCode native) |
| **Description** | "A read-only agent for external docs and dependency research. Use this when you need to clone a dependency repository into OpenCode's managed cache, inspect library source, or cross-reference local code against upstream implementations without modifying your workspace." |
| **Permissions** | Read-only (cannot modify workspace) |
| **Capabilities** | Clone repositories, inspect source code, cross-reference against upstream |

## 3. When to Escalate to Scout

@Knowledge-Curator escalates to Scout when **documentation-tier sources are insufficient** for the current task. This is determined by:

### 3.1 Trigger Keywords

| Trigger Pattern | Example Query | Why Docs Are Insufficient |
|-----------------|---------------|--------------------------|
| "internally", "under the hood" | "How does NestJS guard execution order work internally?" | Docs describe API, not execution pipeline |
| "why does X behave", "unexpected" | "Why does express-rate-limit behave differently in v7?" | Docs may not reflect implementation bugs |
| "edge case", "undocumented" | "What edge cases does Prisma transaction not handle?" | Undocumented behavior not in docs |
| "source code", "implementation" | "Is this ESLint rule checking what the docs claim?" | Docs describe intent; source reveals logic |
| "type narrowing", "generic" | "How does TypeScript narrow this generic internally?" | Type system internals are implementation-defined |

### 3.2 Decision Flow

```
Documentation-tier results received
  │
  ├── Sufficient for task? → YES → Return docs to agent
  │
  └── Insufficient? → Check trigger keywords
       │
       ├── Trigger matched → Offer Scout escalation to user
       │
       └── No trigger → Return best-effort docs with caveat
```

## 4. Scout Invocation Protocol

### 4.1 @Knowledge-Curator Side

```
1. Determine docs are insufficient
2. Present Scout escalation to user (UC7-002):
   "Documentation sources are insufficient for [reason].
    Dispatch Scout to inspect [repo] source code? [Yes/No]"
3. If user confirms:
   a. Dispatch Scout via task({ subagent_type: "scout", prompt: "..." })
   b. Scout clones repo, inspects source, returns findings
4. Extract findings to structured .md
5. Save to docs/official_docs/{domain}/{library}/source-analysis/{topic}.md
6. Update index.json with source: "scout", ttl_days: 14
7. Return Scout findings path to requesting agent
```

### 4.2 Scout Dispatch Prompt Template

```
Inspect the source code of [repository URL] to answer:
"[implementation-level question]"

Focus on:
- [specific file paths or modules to examine]
- [specific functions, classes, or patterns of interest]

Return:
- Relevant code snippets with file paths and line numbers
- Your analysis of how the implementation works
- Any edge cases or undocumented behavior you discover
```

### 4.3 Permission Configuration

@Knowledge-Curator's `permission.task`:
```yaml
task:
  "*": deny       # Cannot dispatch arbitrary subagents
  "scout": allow  # CAN dispatch Scout for Layer 3 analysis
```

## 5. Scout Findings Extraction

### 5.1 Output Format

Scout returns unstructured analysis. @Knowledge-Curator extracts it to:

```markdown
# [Topic] — Source Code Analysis

**Repository**: [repo URL]
**Branch/Tag**: [version]
**Date**: [ISO 8601]
**Source**: Scout (OpenCode built-in subagent)
**Triggered By**: [agent], [task_id]

## Question
[The implementation-level question that triggered Scout]

## Findings
[Structured extraction of Scout's source analysis]

## Relevant Files
- `[path/to/file.ts]:[line]` — [description]
- `[path/to/file.ts]:[line]` — [description]

## Key Insights
1. [Insight 1]
2. [Insight 2]

## Limitations
- Analysis based on source at [commit hash]
- May not reflect runtime behavior (JIT, optimizations, etc.)
```

### 5.2 Save Location

```
docs/official_docs/{domain}/{library}/source-analysis/{topic-slug}.md
```

Examples:
- `opencode/framework/source-analysis/dispatch-mechanism.md`
- `framework/eslint/source-analysis/plugin-api-internals.md`
- `backend/nestjs/source-analysis/guard-execution-order.md`

### 5.3 index.json Entry

```json
{
  "library_id": "scout-analysis",
  "query_topic": "nestjs guard execution order internals",
  "domain": "backend",
  "tags": ["nestjs", "guard", "execution-order", "source-code", "internals"],
  "files": [{
    "path": "backend/nestjs/source-analysis/guard-execution-order.md",
    "source": "scout",
    "sha256": "sha256:...",
    "size_bytes": 15234,
    "created_at": "2026-06-05T12:00:00Z",
    "ttl_days": 14,
    "access_count": 0,
    "last_accessed": null,
    "status": "active"
  }]
}
```

## 6. Responsibility Boundary

| Responsibility | @Knowledge-Curator | Scout |
|----------------|-------------------|-------|
| User confirmation (UC7-002) | ✅ Yes | ❌ No |
| Decide when to escalate | ✅ Yes (trigger detection) | ❌ No |
| Save to docs/official_docs/ | ✅ Yes | ❌ No (read-only) |
| Update index.json | ✅ Yes | ❌ No |
| Context7/webfetch/websearch | ✅ Yes (Layers 1-2) | ❌ No |
| Clone repositories | ❌ No | ✅ Yes |
| Read/inspect source code | ❌ No | ✅ Yes |
| Cross-reference against upstream | ❌ No | ✅ Yes |
| Extract findings to .md | ✅ Yes (post-processing) | ❌ No (returns raw analysis) |

## 7. TTL and Freshness

| Attribute | Value | Reason |
|-----------|-------|--------|
| Scout finding TTL | **14 days** | Source code changes with releases; shorter window than docs |
| Double-TTL deletion | **28 days** | Stale Scout findings auto-deleted by Janitor |
| Re-analysis trigger | TTL expiry OR new version release | Fresh clone on each re-analysis |

## 8. Super-Admin as Primary Beneficiary

@Super-Admin is the primary beneficiary of Scout integration because:

1. **Framework repairs** often need implementation-level understanding of OpenCode internals
2. **OpenCode is sparsely documented** — source inspection is often the only authoritative reference
3. **Plugin/hook behavior** can diverge from documented API between versions
4. **Agent dispatch mechanisms** are implementation-defined and not fully documented

Example Scout queries for @Super-Admin:
- "How does OpenCode's `task` tool resolve subagent dispatch internally?"
- "What is the execution order of OpenCode's plugin hooks?"
- "How does `framework-enforcer.ts` interact with OpenCode's plugin system?"
- "What edge cases does ESLint's mock-audit plugin not handle?"

## 9. Cost and Performance Considerations

- **Scout is expensive**: clones full repositories, reads many files
- **Not speculative**: only invoked when docs are demonstrably insufficient
- **User must consent**: UC7-002 applies to Scout escalation too
- **Cached per repo**: OpenCode manages `scout` clone cache internally
- **One Scout per topic**: deduplicated via SHA-256 of findings

---

*Document Version: 1.0.0*
*Source: `uc7ks-design-analysis-v1.6.md` §11.6; OpenCode Official Docs (Agents → Scout)*
