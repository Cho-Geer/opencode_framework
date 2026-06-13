---
description: UC7KS knowledge pipeline — decompose task, search cache per domain, dispatch Knowledge-Curator if needed. Usage: /search-knowledge "<task_description>"
subtask: false
---

Before you read or write any code, follow these steps.

> **UC7-001c HARDEN** (2026-06-11): Three evidence fields are REQUIRED for valid
> sufficiency determination. Any of `reason`, `files_read`, or `content_summary`
> missing or empty → treated as `"insufficient"` across all enforcement layers
> (`uc7ks-before.ts`, `compliance-gate.ts`, `pre-execution-hook.sh`).

## Step 1: Decompose the Task into Knowledge Points

Break `$ARGUMENTS` into concrete knowledge points — technologies, frameworks, APIs, or patterns you need to understand. Example:

```
Knowledge Points:
1. Redis cache patterns → caching
2. ioredis client API → caching
3. Appointment module → backend_api
```

## Step 2: Map to Domains

Read the live domain list — `project.config.json → knowledge_semantic_map.domains`.

## Step 3: Pipeline Per Domain

For each domain:
1. `module_scope_declare(module, task_id)` — use the same `task_id` across all calls
2. `knowledge_cache_search(domain, task_id)`
3. Note all evidence fields for each domain:
   - `cache_sufficiency.status` — sufficient or insufficient
   - `cache_sufficiency.reason` — WHY sufficient/insufficient
   - `cache_sufficiency.files_read` — which cache files were matched
   - `cache_sufficiency.content_summary` — brief summary of findings

## Step 4: Fetch Missing

If any domain is insufficient:
1. `knowledge_gap_report()`
2. Formulate a combined query for @Knowledge-Curator
3. `dispatch_subagent(agent_type: "Knowledge-Curator", dag_task_id: "<unique-id>", task_description: "<query>")`
4. `Task({ subagent_type: "Knowledge-Curator", dag_task_id: "<same-unique-id>" })`

## Step 5: Report Evidence

After completing the pipeline (re-running `knowledge_cache_search` for insufficient domains), **output a structured report** for each domain searched:

### Evidence Report Format

For each domain, output the following table:

```markdown
### Domain: {domain_name}

| Field | Value |
|-------|-------|
| **状态 (Status)** | `sufficient` or `insufficient` |
| **理由 (Reason)** | `{cache_sufficiency.reason}` |
| **读取的文件名 (Files Read)** | `{cache_sufficiency.files_read}` (array of file paths) |
| **读取的内容概要 (Content Summary)** | `{cache_sufficiency.content_summary}` |
```

**Example Output:**

```markdown
### Domain: opencode_framework

| Field | Value |
|-------|-------|
| **状态 (Status)** | `sufficient` |
| **理由 (Reason)** | Found 22 matching cache entries for domain "opencode_framework" |
| **读取的文件名 (Files Read)** | `["opencode/mcp-typescript-bun/findings-summary.md", "opencode/framework/plugins.md", ...]` |
| **读取的内容概要 (Content Summary)** | 22 entries covering 22 files: TypeScript MCP tools | Bun CJS/ESM patterns... |
```

This ensures the UC7-001c hardened evidence fields are explicitly reported and visible in the agent's response.

## Step 6: Execute

Proceed with: **$ARGUMENTS**
