---
name: "context7-first"
description: "Forces the model to use the UC7KS knowledge acquisition pipeline (local-first → @Knowledge-Curator) before any investigation, design, coding, debugging, or architecture tasks. Invoke when user asks about technology stack usage, code development, debugging, architecture design, or dependency management."
---

# context7-first Skill v2 (UC7KS-Enhanced)

## Description
Forces the agent to use the **Universal Context7-First Knowledge System (UC7KS)** pipeline before executing any investigation, design, coding, debugging, or architecture tasks. This ensures outputs are based on the latest versions of libraries and frameworks, not outdated training data.

**Key change from v1**: Agents no longer call Context7 MCP tools directly (UC7-004). All external queries route through the @Knowledge-Curator subagent via @Orchestrator.

## Trigger Conditions
Applies to any tasks involving technology stack usage, including but not limited to:
- Code development and debugging
- Architecture design and evaluation
- Technical documentation writing
- Dependency management and version control
- Framework repair and governance modification

## UC7KS Execution Flow

### 1. Local Cache First (UC7-001 — MANDATORY)
```
BEFORE any external query:
1. Search docs/official_docs/index.json for relevant cached documentation
2. If found, read cached docs via the read tool
3. If sufficient, proceed with task — no external query needed
```

### 2. Identify Target Libraries (Autonomous NLP Extraction)
```
Parse your task description for technology mentions:
- Framework names: NestJS, Express, Angular, React, Vue, etc.
- Libraries: Prisma, TypeORM, Jest, Playwright, ioredis, etc.
- Tools: ESLint, Prettier, Docker, GitHub Actions, etc.
- Match against knowledge_semantic_map in project.config.json
```

### 3. Route Through @Knowledge-Curator (UC7-004)
```
If local cache is insufficient:
1. Request @Orchestrator to dispatch @Knowledge-Curator
2. Provide: task context, identified technology mentions, query intent
3. @Knowledge-Curator handles the entire acquisition pipeline:
   - User confirmation (UC7-002)
   - Context7 MCP → webfetch → websearch (Layers 1-2)
   - Scout source-code analysis (Layer 3, when docs insufficient)
   - Save to docs/official_docs/ (UC7-003)
   - Update index.json (UC7-007)
4. Receive artifact paths from @Knowledge-Curator
```

### 4. Apply Acquired Knowledge
```
Read the returned documentation from docs/official_docs/
Apply the latest information to your task
Cite documentation sources in your output
```

## What NOT to Do
- ❌ Do NOT call `context7_resolve-library-id` or `context7_query-docs` directly (UC7-004)
- ❌ Do NOT query external sources without checking local cache first (UC7-001)
- ❌ Do NOT skip user confirmation for external queries (UC7-002)
- ❌ Do NOT rely on training data when cached docs exist

## Super-Admin Note (UC7-009)
@Super-Admin MUST follow the same UC7KS workflow as all other agents. When executing framework repairs, governance modifications, or agent config changes, @Super-Admin must:
1. Search `docs/official_docs/framework/` and `docs/official_docs/opencode/` for relevant cached docs
2. Route through @Orchestrator → @Knowledge-Curator for any external documentation needs
3. Never rely solely on training data for framework modification decisions

## Applicable Scenarios
- New project initialization and technology selection
- Technology upgrade and migration of existing projects
- Diagnosis and resolution of technical problems
- Design and evaluation of technical solutions
- Framework repair and governance modifications (Super-Admin)
