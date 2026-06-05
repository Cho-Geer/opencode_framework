# OpenCode Official Docs: Rules & Commands
Sources: https://opencode.ai/docs/rules/, https://opencode.ai/docs/commands/
Fetched: 2026-06-05

## Rules Key Points:
1. AGENTS.md for project rules (like Cursor rules)
2. /init command creates/updates AGENTS.md
3. Global: ~/.config/opencode/AGENTS.md
4. instructions field in opencode.json for external instruction files
5. Claude Code compatibility: CLAUDE.md, ~/.claude/CLAUDE.md

## Commands Key Points:
1. Markdown files in .opencode/commands/ or ~/.config/opencode/commands/
2. YAML frontmatter: description, agent, model, subtask
3. Template supports $ARGUMENTS, $1/$2/$3, !`command` for shell output, @file references
4. Built-in commands: /init, /undo, /redo, /share, /help
5. Custom commands can override built-in
