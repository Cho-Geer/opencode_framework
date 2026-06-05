# UC7KS Design Analysis — Cross-Reference Findings v1.0

**Date**: 2026-06-05
**Author**: Super-Admin Agent
**Sources Cross-Referenced**:
- OpenCode Official Docs (https://opencode.ai/docs/): Agents, Skills, Tools, Permissions, Config, MCP Servers, Plugins, Rules, Commands, Intro
- Project framework: `.opencode/agents/*.md`, `.opencode/plugins/framework-enforcer/`, `.opencode/project.config.json`, `.opencode/scripts/command-tools/dispatch-subagent.js`
- Target document: `uc7ks-design-analysis-v1.0.md` (v1.3.0)
**Status**: Comprehensive audit — 22 findings identified (3 HIGH, 8 MEDIUM, 11 LOW)

---

## Finding Summary

| # | Severity | Category | Finding | Section |
|---|----------|----------|---------|---------|
| F1 | 🔴 HIGH | Factual Error | Incorrect GitHub URL for OpenCode | §8.3 |
| F2 | 🔴 HIGH | Structural | Internal subsection numbering mismatch (Sections 9-12) | §9-§12 |
| F3 | 🔴 HIGH | Design Gap | websearch tool availability constraint not documented | §6.1, §11.2 |
| F4 | 🟡 MEDIUM | Redundancy | Duplicate directory paths: `opencode/` and `framework/opencode/` | §2.2 |
| F5 | 🟡 MEDIUM | Missing Reference | OpenCode built-in Scout subagent overlaps with @Knowledge-Curator | §6.1 |
| F6 | 🟡 MEDIUM | Terminology | `agent_tools_blacklist` vs OpenCode's `permission.deny` | §3.1, §6.2 |
| F7 | 🟡 MEDIUM | Terminology | `agent_tools_whitelist` vs OpenCode's deprecated `tools`/new `permission` | §6.2 |
| F8 | 🟡 MEDIUM | Clarity | `safe_*` tools are project-specific, not standard OpenCode | §6.1 |
| F9 | 🟡 MEDIUM | Clarity | `dispatch_subagent` is project-custom, not OpenCode native | §4.2, §6.2 |
| F10 | 🟡 MEDIUM | TDD Logic | Pre-commit hook cannot check 'unstaged docs' (UC7-003) | §3.1 |
| F11 | 🟡 MEDIUM | Missing Opportunity | OpenCode plugins hook system not leveraged for UC7KS enforcement | §4.1 |
| F12 | 🟢 LOW | Missing Tool | `todowrite` not in @Knowledge-Curator's MCP tools | §6.1 |
| F13 | 🟢 LOW | Best Practice | OpenCode `instructions` field could simplify rule distribution | §6.3 |
| F14 | 🟢 LOW | Naming | MCP tool naming convention inconsistency (`mcp_context7_*` vs actual) | §6.1 |
| F15 | 🟢 LOW | Missing Command | `opencode agent create` CLI command not referenced | §13 |
| F16 | 🟢 LOW | Table Alignment | §8.5 table: @Guardian role description misaligned | §8.5 |
| F17 | 🟢 LOW | Deprecation | `tools` config deprecated in favor of `permission` in OpenCode v1.1.1+ | §6.1 |
| F18 | 🟢 LOW | Clarity | `framework-enforcer.ts` is a custom plugin, not OpenCode built-in | §4.1 |
| F19 | 🟢 LOW | Scope Gap | No discussion of `external_directory` permission for @Knowledge-Curator | §5.2 |
| F20 | 🟢 LOW | Missing Feature | OpenCode `subtask` command config could simplify @Knowledge-Curator invocation | §6.2 |
| F21 | 🟢 LOW | Version Awareness | OpenCode version-specific features (experimental LSP tool) not noted | §6.1 |
| F22 | 🟢 LOW | Missing Source | OpenCode blog URL listed but blog not verified to contain relevant tech content | §8.3 |

---

## Detailed Findings

### F1 🔴 HIGH — Incorrect GitHub URL for OpenCode (Section 8.3)

**Finding**: Section 8.3 lists `https://github.com/opencode` as the OpenCode source code repository. The correct URL is `https://github.com/anomalyco/opencode`.

**Evidence**: 
- OpenCode landing page (https://opencode.ai/) links to `https://github.com/anomalyco/opencode`
- The GitHub organization is `anomalyco`, not `opencode`
- The repository has 160K+ stars and 900+ contributors under the `anomalyco` org

**Fix**: Replace all instances of `https://github.com/opencode` with `https://github.com/anomalyco/opencode` in Section 8.3 and any other references.

---

### F2 🔴 HIGH — Internal Subsection Numbering Mismatch (Sections 9-12)

**Finding**: After Section 8, internal subsection numbers do not match the main section numbers:

| Main Section | Current Subsection Numbers | Correct Subsection Numbers |
|---|---|---|
| §9 Central State Management | 8.1, 8.2, 8.3 | Should be 9.1, 9.2, 9.3 |
| §10 Templatization | 9.2, 9.3 | Should be 10.1, 10.2 |
| §11 Knowledge Management | 10.1 through 10.5 | Should be 11.1 through 11.5 |
| §12 Workflow Diagrams | 11.1, 11.2, 11.3 | Should be 12.1, 12.2, 12.3 |

This is a systematic off-by-one error starting at Section 9. All internal subsections from §9 onward need renumbering.

**Fix**: Renumber all internal subsections §9-§12 to match their parent section numbers. Also update any cross-references within the document.

---

### F3 🔴 HIGH — websearch Tool Availability Constraint Not Documented

**Finding**: The UC7KS design treats `websearch` as a generally available fallback tool. However, OpenCode's official documentation states:

> "This tool is only available when using the OpenCode provider or when the `OPENCODE_ENABLE_EXA` environment variable is set to any truthy value (e.g., `true` or `1`)."

**Impact**: The fallback chain (Context7 → webfetch → websearch) in §11.2 may fail if neither condition is met. The design assumes websearch is always available.

**Fix**: Add a constraint note in §6.1 and §11.2 that `websearch` requires either:
1. The OpenCode provider (Zen), OR
2. `OPENCODE_ENABLE_EXA=1` environment variable
And document the fallback degradation to `webfetch`-only if neither is available.

---

### F4 🟡 MEDIUM — Duplicate Directory Paths (Section 2.2)

**Finding**: The directory structure in §2.2 creates ambiguity with two overlapping paths:

```
opencode/                   # Line 122 — OpenCode official knowledge
framework/                  # Line 128
  +-- opencode/             # Line 129 — OpenCode framework internals
```

Both `opencode/agents/` and `framework/opencode/` serve the same conceptual purpose (OpenCode framework documentation). The `framework/opencode/` path under `framework/` duplicates the dedicated `opencode/` top-level domain.

**Fix**: Consolidate into a single location. Recommendation: Keep `opencode/` as the top-level domain and remove `framework/opencode/`. The `framework/` domain should only contain non-OpenCode framework tools (eslint, typescript, git, etc.).

---

### F5 🟡 MEDIUM — Missing Reference to OpenCode Built-in Scout Subagent

**Finding**: OpenCode has a built-in `scout` subagent described as:

> "A read-only agent for external docs and dependency research. Use this when you need to clone a dependency repository into OpenCode's managed cache, inspect library source, or cross-reference local code against upstream implementations without modifying your workspace."

This partially overlaps with the proposed `@Knowledge-Curator` functionality, specifically:
- External documentation research (both agents)
- Dependency research (both agents)
- Repository inspection (scout via git clone, @Knowledge-Curator via webfetch)

**Impact**: The UC7KS design should acknowledge OpenCode's existing capabilities and explain why a dedicated `@Knowledge-Curator` is needed beyond what `scout` provides (structured knowledge management, local caching, user confirmation workflow).

**Fix**: Add a comparison section or note in §6.1 explaining how `@Knowledge-Curator` extends beyond `scout`'s capabilities.

---

### F6 🟡 MEDIUM — Terminology: `agent_tools_blacklist` vs OpenCode `permission.deny`

**Finding**: Rule UC7-004 states enforcement via `agent_tools_blacklist` update. However:
1. OpenCode's native mechanism is the `permission` system with `allow/ask/deny`
2. `agent_tools_blacklist` appears to be a project-specific concept from the custom framework
3. OpenCode deprecated the `tools` boolean config in v1.1.1 in favor of `permission`

The doc should clarify whether `agent_tools_blacklist` is:
- A concept in the project's custom `project.config.json` (likely)
- A mapping to OpenCode's `permission.deny` on the `task` key
- Both

**Fix**: Add a clarifying note mapping `agent_tools_blacklist` to OpenCode's native `permission` system. Update UC7-004's "Enforcement Mechanism" column to reference both.

---

### F7 🟡 MEDIUM — Terminology: `agent_tools_whitelist` vs OpenCode `permission`

**Finding**: Section 6.2 references `agent_tools_whitelist` for `@Orchestrator`. Similar to F6, this should be mapped to OpenCode's `permission` system.

**Evidence**: The actual `Orchestrator.md` config uses `agent_tools_whitelist` and `agent_tools_blacklist` as custom frontmatter fields, while also having a separate `permission` block. OpenCode's native agent config uses `permission` with `allow/ask/deny`.

**Fix**: Clarify the relationship between custom `agent_tools_whitelist`/`agent_tools_blacklist` and OpenCode's `permission` system. Note that `tools` config is deprecated in OpenCode.

---

### F8 🟡 MEDIUM — `safe_*` Tools Are Project-Specific, Not Standard OpenCode

**Finding**: The UC7KS design lists `safe_edit`, `safe_shell`, `safe_mkdir`, `safe_delete`, `safe_diff` as MCP tools for `@Knowledge-Curator` (Section 6.1). These are **not** standard OpenCode built-in tools — they are custom tools specific to this project's framework.

OpenCode's built-in tools for file operations are: `edit`, `write`, `read`, `apply_patch`, `bash`.

**Impact**: The `@Knowledge-Curator` agent config would need to explicitly include these custom tools. The design should clarify:
- Which tools are OpenCode built-ins (edit, write, read, bash, glob, grep, webfetch, websearch, question, skill, todowrite, task)
- Which tools are project-specific custom tools (safe_edit, safe_shell, etc.)
- How both types coexist in the agent's permission config

**Fix**: Add a note distinguishing OpenCode built-in tools from project-specific custom tools in the @Knowledge-Curator tool list.

---

### F9 🟡 MEDIUM — `dispatch_subagent` Is Project-Custom, Not OpenCode Native

**Finding**: The UC7KS relies heavily on `dispatch_subagent` for the dispatch mechanism (§4.2, §6.2). This is a **project-specific custom tool** (`.opencode/scripts/command-tools/dispatch-subagent.js`), not a standard OpenCode feature.

OpenCode's native subagent dispatch mechanism is the `task` tool, which:
- Takes `subagent_type` parameter
- Can be controlled via `permission.task` with glob patterns
- Supports hidden subagents for programmatic-only invocation

**Impact**: The design should explain how `dispatch_subagent` builds on top of OpenCode's `task` tool, what additional functionality it provides (template resolution, preamble injection, compliance gate integration), and how `@Orchestrator` would use both.

**Fix**: Add a section explaining the relationship between `dispatch_subagent` (custom) and `task` (native), and what additional features the custom wrapper provides.

---

### F10 🟡 MEDIUM — Pre-Commit Hook Cannot Check 'Unstaged Docs' (UC7-003)

**Finding**: UC7-003 states: "Git pre-commit hook checks for unstaged docs." This is technically incorrect — Git pre-commit hooks can only check **staged files** (files that have been `git add`-ed). Unstaged changes are explicitly not part of the commit and cannot be verified by pre-commit hooks.

**Impact**: The enforcement mechanism for UC7-003 needs revision. Options:
1. Check staged files for doc presence (correct)
2. Use a pre-push hook instead
3. Use a plugin hook (`tool.execute.after`) to verify saves immediately after write

**Fix**: Reword UC7-003 to say "checks for docs presence in staged changes" or change the enforcement mechanism to a `tool.execute.after` plugin hook that fires immediately after `@Knowledge-Curator` writes doc files.

---

### F11 🟡 MEDIUM — OpenCode Plugin Hook System Not Leveraged

**Finding**: OpenCode's plugin system provides hooks that could be used for UC7KS enforcement:
- `tool.execute.before` — Intercept Context7/webfetch/websearch calls before execution
- `tool.execute.after` — Verify docs were saved after write operations
- `session.compacted` — Inject knowledge context during compaction
- `permission.asked` — Add custom permission dialogs for external queries

The UC7KS design proposes enforcement through custom framework scripts (`framework-enforcer.ts`, pre-commit hooks, pre-execution hooks) but doesn't discuss leveraging OpenCode's native plugin hook system as a complementary mechanism.

**Fix**: Add a section or note in §4 discussing how OpenCode's plugin hook system could complement the custom enforcement mechanisms, particularly for real-time interception of external queries.

---

### F12 🟢 LOW — `todowrite` Not in @Knowledge-Curator's Tools

**Finding**: OpenCode's `todowrite` tool for managing task lists is not listed among @Knowledge-Curator's MCP tools in §6.1. Note that `todowrite` is disabled for subagents by default in OpenCode.

Given @Knowledge-Curator's multi-step workflow (identify → confirm → query → save → index), `todowrite` would be useful for tracking progress.

**Fix**: Consider adding `todowrite` to @Knowledge-Curator's tool list, with explicit `todowrite: allow` permission.

---

### F13 🟢 LOW — OpenCode `instructions` Field Could Simplify Rule Distribution

**Finding**: OpenCode's `instructions` field in `opencode.json` allows specifying glob patterns for instruction files that are automatically loaded into agent context:

```json
{
  "instructions": ["docs/official_docs/index.json"]
}
```

This could simplify how the local-first-search checklist is distributed to all agents in §6.3, bypassing the need to update every agent config individually.

**Fix**: Add a note in §6.3 or §13 about using `instructions` field to automate rule injection.

---

### F14 🟢 LOW — MCP Tool Naming Convention Inconsistency

**Finding**: The UC7KS references `mcp_context7_*` tools (Section 2.1 diagram). In OpenCode's MCP integration, tool names follow the pattern `<mcp-server-name>_<tool-name>`. The actual Context7 tools are `context7_resolve-library-id` and `context7_query-docs`.

The exact naming depends on how the MCP server is named in `opencode.json`. If named `context7`, the tools would be `context7_resolve-library-id` and `context7_query-docs`.

**Fix**: Add a note clarifying the naming convention.

---

### F15 🟢 LOW — `opencode agent create` CLI Command Not Referenced

**Finding**: OpenCode has a built-in `opencode agent create` CLI command that interactively guides agent creation (select location, write description, generate prompt, select permissions, create markdown file).

This could simplify Phase 1 of the implementation roadmap.

**Fix**: Reference `opencode agent create` in Phase 1 of §13.

---

### F16 🟢 LOW — §8.5 Table: @Guardian Role Description Misaligned

**Finding**: In Section 8.5, the @Guardian row lists "coding standards, security rules, test requirements" as typical queries for OpenCode knowledge. However, @Guardian primarily needs coding standards and security architecture docs, not necessarily OpenCode framework internals. The alignment between agent use cases and typical queries could be more precise.

**Fix**: Review and refine the table for accuracy. @Guardian's typical queries for OpenCode knowledge should focus on framework-specific quality rules rather than general coding standards (which come from `.opencode/context/code_standards/`).

---

### F17 🟢 LOW — `tools` Config Deprecated in OpenCode v1.1.1+

**Finding**: The UC7KS design uses `tools` boolean-style configuration (e.g., `agent_tools_blacklist`, `agent_tools_whitelist`). OpenCode deprecated the `tools` boolean config in v1.1.1 and merged it into `permission`.

When implementing the @Knowledge-Curator agent config, the preferred approach is:
```yaml
permission:
  edit: deny
  bash: deny
  webfetch: allow
  websearch: allow
  task: deny
```

**Fix**: Update §6.1 @Knowledge-Curator config to use `permission` syntax in addition to or instead of the custom `agent_tools_*` concepts.

---

### F18 🟢 LOW — `framework-enforcer.ts` Is a Custom Plugin

**Finding**: The UC7KS references `framework-enforcer.ts` as the enforcement mechanism for rules UC7-001 through UC7-009. This file is a **custom OpenCode plugin** (`.opencode/plugins/framework-enforcer/`), not a built-in OpenCode component.

While this is fine within the project context, the design document should clarify that `framework-enforcer.ts` is a project-specific plugin that hooks into OpenCode's plugin system.

**Fix**: Add a clarifying note in §4.1 that `framework-enforcer.ts` is a project-specific OpenCode plugin.

---

### F19 🟢 LOW — Missing `external_directory` Permission Discussion

**Finding**: OpenCode has an `external_directory` permission that controls access to paths outside the working directory. When `@Knowledge-Curator` writes to `docs/official_docs/` (which may be outside some agent scopes), the `external_directory` permission could be relevant.

The UC7KS's `agent_write_scopes` in §5 covers this conceptually but doesn't map to OpenCode's `external_directory` permission.

**Fix**: Add a note about OpenCode's `external_directory` permission and how it relates to the custom `agent_write_scopes`.

---

### F20 🟢 LOW — OpenCode `subtask` Command Config

**Finding**: OpenCode's command system supports a `subtask: true` flag that forces subagent invocation. This could provide an alternative mechanism for @Knowledge-Curator dispatch:

```json
{
  "command": {
    "knowledge": {
      "template": "Fetch technical documentation about $ARGUMENTS",
      "agent": "knowledge-curator",
      "subtask": true
    }
  }
}
```

**Fix**: Consider noting this alternative invocation pattern in §6.2 or §13.

---

### F21 🟢 LOW — OpenCode Experimental LSP Tool

**Finding**: OpenCode has an experimental LSP tool (`lsp`) that requires `OPENCODE_EXPERIMENTAL_LSP_TOOL=true`. If @Knowledge-Curator needed LSP access for code analysis, this would need to be enabled.

Not critical for the current design but worth noting for future extensibility.

**Fix**: No immediate fix needed; note for future reference.

---

### F22 🟢 LOW — OpenCode Blog URL Unverified

**Finding**: Section 8.3 lists `https://opencode.ai/blog` as a secondary knowledge source. The actual content and update frequency of this blog for technical documentation purposes is unverified. The blog may primarily contain product announcements rather than technical reference material.

**Fix**: Either verify the blog's technical content value or mark it as "unverified" in the knowledge sources table.

---

## Cross-Reference Verification Passes

The following claims in the UC7KS document were verified against actual OpenCode docs and found to be **correct**:

| Claim | Section | Verification |
|-------|---------|-------------|
| Agent markdown files in `.opencode/agents/` with YAML frontmatter | §6.1 | ✅ Confirmed — OpenCode supports `.opencode/agents/*.md` |
| `hidden: true` for subagent-only agents | §6.1 | ✅ Confirmed — OpenCode supports `hidden: true` |
| `question` tool for user confirmation | §3.1, §6.1 | ✅ Confirmed — OpenCode built-in tool |
| `webfetch` for fallback | §6.1, §11.2 | ✅ Confirmed — OpenCode built-in tool |
| `compliance_gate_check` / `confirm` / `complete` workflow | §13 | ✅ Confirmed — project-specific MCP tools |
| Context7 MCP server integration | §2.1 | ✅ Confirmed — standard MCP server at `mcp.context7.com` |
| Skill files in `.opencode/skills/<name>/SKILL.md` | §6.1 | ✅ Confirmed — OpenCode standard |
| Agent `mode: subagent` | §6.1 | ✅ Confirmed — OpenCode agent mode |
| `temperature`, `color`, `model` config options | §6.1 | ✅ Confirmed — OpenCode agent config options |
| Permission system with allow/ask/deny | §5.2 (conceptual) | ✅ Confirmed — OpenCode permission system |

---

## Recommended Priority Fixes

### Must-Fix (Before Implementation)
1. **F1**: Correct GitHub URL to `https://github.com/anomalyco/opencode`
2. **F2**: Renumber all subsections §9-§12
3. **F3**: Document `websearch` availability constraint

### Should-Fix (During Implementation Planning)
4. **F10**: Fix UC7-003 enforcement mechanism (pre-commit → tool.execute.after or staged-check)
5. **F4**: Consolidate duplicate `opencode/` and `framework/opencode/` paths
6. **F5**: Acknowledge OpenCode Scout subagent and differentiate from @Knowledge-Curator
7. **F8**: Distinguish standard OpenCode tools from project-specific custom tools
8. **F9**: Explain dispatch_subagent vs task tool relationship

### Nice-to-Fix (Documentation Quality)
9. **F11**: Discuss OpenCode plugin hooks for UC7KS enforcement
10. **F6-F7**: Clarify terminology mapping between custom and OpenCode-native systems
11. **F12-F22**: Various minor improvements

---

*End of Cross-Reference Findings*
