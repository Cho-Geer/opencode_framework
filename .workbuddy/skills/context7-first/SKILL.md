---
name: context7-first
description: P3 tech documentation lookup before technical decisions. Local context first, then external docs. Libraries and queries are read from project.yaml — no hardcoded library references.
agent_created: true
level: user
---

# context7-first

## Purpose

Force technology documentation lookup before making technical decisions. When a developer or agent is about to make a tech choice (framework API, configuration, pattern), this skill ensures the latest documentation is consulted first — starting with local project context, then falling back to external sources.

## Configuration

Read from `.workbuddy/project.yaml`:

- `context.path` — path to local context directory (default: `.workbuddy/context`)
- `context7.libraries` — list of library identifiers for external doc lookup
- `context7.queries` — pre-defined queries for common lookups per layer

## Workflow

### Step 1: Local Context Lookup (NEW)

Before any external lookup, search the local context directory:

1. Read `context.path` from project.yaml (default: `.workbuddy/context`)
2. Search relevant subdirectories based on the topic:
   - **Coding conventions** → `context/code_standards/` (backend, frontend, testing)
   - **Page/UI design** → `context/detailed_design/` (page specs, panorama)
   - **Architecture/requirements** → `context/requirements/` (security, data, API, deployment)
3. Use `Read` tool to open the relevant file(s)
4. If the answer is found locally, use it and log the lookup in `invocation-log.md`
5. If the answer is NOT found locally, proceed to Step 2

### Step 2: External Documentation Lookup

1. Read `context7.libraries` from project.yaml
2. If the relevant library is listed, perform an external documentation lookup
3. If the relevant library is NOT listed, emit a recommendation to add it
4. Use WebSearch or WebFetch to retrieve current documentation
5. Record the lookup in `invocation-log.md`

## Lookup Priority

```
Local Context (.workbuddy/context/)  →  External Docs (context7/WebSearch)
       (trusted, project-specific)        (latest, community-maintained)
```

- **Local context is always preferred** — it contains project-specific decisions and conventions
- **External docs supplement** — they provide latest API signatures, version changes, and best practices
- **When they conflict** — local context takes precedence (it represents deliberate project decisions)

## When to Use

- Before using a framework API for the first time in a session
- Before configuring a framework feature
- Before choosing between alternative approaches
- When uncertain about a library's current API or best practices
- When implementing code that must follow project-specific conventions

## Integration

Used by:
- `architect` agent — before designing technical specs
- `coder` agent — before implementing with unfamiliar APIs
- `devops` agent — before configuring infrastructure tools

## Usage

```text
/context7 lookup <topic>  — Look up documentation for a topic (local first, then external)
/context7 local <topic>   — Search only local context directory
/context7 external <topic> — Search only external documentation
/context7 libraries       — List configured libraries
/context7 check           — Verify all configured libraries have docs available
```
