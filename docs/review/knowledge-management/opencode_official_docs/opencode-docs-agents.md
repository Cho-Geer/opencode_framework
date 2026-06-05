# OpenCode Official Docs: Agents
Source: https://opencode.ai/docs/agents/
Fetched: 2026-06-05

## Key Points for UC7KS Cross-Reference

1. Agents are configured in opencode.json or .opencode/agents/*.md markdown files
2. Two types: primary agents and subagents
3. Subagents invoked by @mention or automatically by primary agents
4. Hidden subagents (hidden: true) can be invoked programmatically via Task tool
5. Permission system uses allow/ask/deny with glob patterns
6. Tools config is DEPRECATED, prefer permission field
7. Agent markdown files use YAML frontmatter with: name, description, mode, model, temperature, steps, color, permissions, etc.
8. task permission controls which subagents an agent can invoke via the Task tool
9. Built-in agents: Build (primary), Plan (primary), General (subagent), Explore (subagent), Scout (subagent)

## Scout Subagent (Relevant to UC7KS)
"A read-only agent for external docs and dependency research. Use this when you need to clone a dependency repository into OpenCode's managed cache, inspect library source, or cross-reference local code against upstream implementations without modifying your workspace."

This partially overlaps with the proposed @Knowledge-Curator, though @Knowledge-Curator adds write capability and structured knowledge management.
