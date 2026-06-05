# @Knowledge-Curator Permission Mapping v1.0

**Date**: 2026-06-05
**Phase**: UC7KS Phase 1 — Foundation (Task UC7-P1-T07)
**Source**: `uc7ks-design-analysis-v1.6.md` §5, §6.1; OpenCode Official Docs (Permissions)
**Status**: Design Document

---

## 1. Purpose

This document defines the mapping between the project's **custom permission system** (`agent_write_scopes`, `agent_tools_blacklist`, `agent_tools_whitelist`) and OpenCode's **native permission system** (`permission` block with `allow/ask/deny`). This ensures the @Knowledge-Curator agent config uses the correct native syntax while maintaining compatibility with the custom framework enforcer.

## 2. Terminology Map

| Custom Term | OpenCode Native Equivalent | Notes |
|-------------|---------------------------|-------|
| `agent_tools_blacklist` | `permission.<key>: deny` | Project-specific frontmatter field; maps to deny rules |
| `agent_tools_whitelist` | `permission.<key>: allow` | Project-specific frontmatter field; maps to allow rules |
| `agent_write_scopes` | `permission.edit` (path globs) + `permission.external_directory` | Custom field; maps to write permission on paths |
| `tools: [list]` | **DEPRECATED** in OpenCode v1.1.1 | Use `permission` block instead |

## 3. @Knowledge-Curator Native Permission Config

```yaml
permission:
  # Core restrictions
  edit: deny                         # Prevent direct edits (must use safe_edit)
  bash: deny                         # No shell access
  write: deny                        # No direct file writes
  
  # Read access
  read: allow                        # Read cached docs + index.json
  glob: allow                        # Search docs/official_docs/
  grep: allow                        # Search content in cached docs
  
  # External query tools (UC7-002: user confirmation required before use)
  webfetch: allow                    # Fallback source
  websearch: allow                   # Tertiary fallback (needs OpenCode provider or OPENCODE_ENABLE_EXA=1)
  
  # Subagent dispatch (UC7-008: cannot self-dispatch or dispatch arbitrary agents)
  task:
    "*": deny                        # Cannot dispatch arbitrary subagents
    "scout": allow                   # CAN dispatch Scout for Layer 3 source analysis
  
  # Interactive tools
  skill: allow                       # Load context7-first skill
  question: allow                    # UC7-002: present libraries for user confirmation
  todowrite: allow                   # Progress tracking (disabled for subagents by default)
  
  # Project-specific custom tools (for docs/official_docs/ operations)
  safe_edit: allow
  safe_shell: allow
  safe_mkdir: allow
  safe_delete: allow
  
  # External directory access
  external_directory: allow          # docs/official_docs/ may be outside default workspace

# Project-specific custom fields (non-OpenCode-native)
agent_write_scopes:
  allowed:
    - "docs/official_docs/**"
    - "docs/official_docs/.metadata/**"
  denied:
    - "booking_system_refactor/**"
    - ".opencode/**"
    - "contract.yaml"
    - "project.config.json"
    - "Task.DAG.json"
```

## 4. UC7 Rule → Permission Mapping

| UC7 Rule | Custom Enforcement | OpenCode Native Enforcement |
|----------|-------------------|---------------------------|
| UC7-001 (Local-First) | `framework-enforcer.ts` pre-execution check | Not directly mappable (policy-level rule) |
| UC7-002 (User Confirmation) | `question` tool integration | `permission.question: allow` |
| UC7-003 (Save-or-Fail) | `tool.execute.after` plugin hook | `permission.safe_edit: allow` + post-write hook |
| UC7-004 (No Direct Context7) | `agent_tools_blacklist` | `permission.task: { "context7": "deny" }` for non-KC agents |
| UC7-005 (Size Cap) | `code-quality-gate` write-check | `code-quality-gate` plugin |
| UC7-006 (TTL Enforcement) | `machine.json` + @CI-CD-Agent cron | Not directly mappable |
| UC7-007 (Index Sync) | File-lock in @Knowledge-Curator | `permission.safe_edit: allow` (atomic writes) |
| UC7-008 (Scope Isolation) | `agent_write_scopes` | `permission.edit: deny` + `permission.external_directory: allow` for docs |
| UC7-009 (Super-Admin Equality) | `framework-enforcer.ts` | Not directly mappable (policy-level rule) |

## 5. Precedence Rules

1. **OpenCode native `permission`** is the authoritative source at runtime
2. **Custom `agent_*` fields** are read by the project's `framework-enforcer.ts` for policy enforcement
3. When both exist, OpenCode native takes precedence for tool availability; custom fields provide additional policy context
4. **`agent_write_scopes`** serves as a declarative contract for scope validation by `code-quality-gate` and pre-commit hooks

## 6. Deprecation Notes

- OpenCode deprecated the `tools` boolean config in **v1.1.1**
- All new agent configs MUST use the `permission` block syntax
- Legacy `agent_tools_blacklist`/`agent_tools_whitelist` custom fields are maintained for backward compatibility with `framework-enforcer.ts`
- Future versions should migrate custom enforcement to OpenCode's native `permission` system where possible

---

*Document Version: 1.0.0*
*References: `uc7ks-design-analysis-v1.6.md` §5.2, §6.1; `opencode-docs-permissions.md`*
