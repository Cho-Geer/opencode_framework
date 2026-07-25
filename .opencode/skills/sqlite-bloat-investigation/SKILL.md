---
name: sqlite-bloat-investigation
description: Investigate SQLite database bloat — locate which tables consume the most space, trace write patterns, and identify O(n²) load-save feedback loops. Use when a SQLite file has grown far beyond expected size, when disk I/O is saturated by database writes, or when diagnosing append-only tables with no effective cleanup. Covers WSL + bun:sqlite and standard sqlite3/python3 environments.
version: 1.0.0
---

# sqlite-bloat-investigation

Investigate SQLite database bloat — locate which tables consume the most space, trace write patterns, and identify O(n²)

**触发条件**: description: Investigate SQLite database bloat — locate which tables consume the most space, trace w

> 完整文档: 使用 read 工具读取 .opencode/skills/sqlite-bloat-investigation/FULL.md
