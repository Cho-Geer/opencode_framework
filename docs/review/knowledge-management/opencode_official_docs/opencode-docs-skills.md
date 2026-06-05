# OpenCode Official Docs: Agent Skills
Source: https://opencode.ai/docs/skills/
Fetched: 2026-06-05

## Key Points for UC7KS Cross-Reference

1. Skills are SKILL.md files in .opencode/skills/<name>/SKILL.md
2. YAML frontmatter required: name and description
3. Discovered from multiple locations: project .opencode/, global ~/.config/opencode/skills/, .claude/skills/, .agents/skills/
4. Name must be lowercase alphanumeric with single hyphen separators (1-64 chars)
5. Description 1-1024 chars
6. Permissions configurable with glob patterns: allow, deny, ask
7. Overridable per agent
8. Can be disabled per agent with tools: { skill: false }
