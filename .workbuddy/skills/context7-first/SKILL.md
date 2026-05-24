---
name: context7-first
description: P3 tech documentation lookup before technical decisions. Libraries and queries are read from project.yaml — no hardcoded library references.
agent_created: true
level: user
---

# context7-first

## Purpose

Force technology documentation lookup before making technical decisions. When a developer or agent is about to make a tech choice (framework API, configuration, pattern), this skill ensures the latest documentation is consulted first.

## Configuration

Read from `.workbuddy/project.yaml`:

- `context7.libraries` — list of library identifiers for doc lookup
- `context7.queries` — pre-defined queries for common lookups per layer

## Workflow

1. Before making a technical decision, read `context7.libraries` from project.yaml
2. If the relevant library is listed, perform a documentation lookup
3. If the relevant library is NOT listed, emit a recommendation to add it
4. Use WebSearch or WebFetch to retrieve current documentation
5. Record the lookup in `invocation-log.md`

## When to Use

- Before using a framework API for the first time in a session
- Before configuring a framework feature
- Before choosing between alternative approaches
- When uncertain about a library's current API or best practices

## Integration

Used by:
- `architect` agent — before designing technical specs
- `coder` agent — before implementing with unfamiliar APIs
- `devops` agent — before configuring infrastructure tools

## Usage

```text
/context7 lookup <topic>  — Look up documentation for a topic
/context7 libraries       — List configured libraries
/context7 check           — Verify all configured libraries have docs available
```
