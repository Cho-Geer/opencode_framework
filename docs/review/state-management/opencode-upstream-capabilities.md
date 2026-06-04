# OpenCode Upstream API — Research Findings for State Management

**Date**: 2026-06-04  
**Sources**: https://opencode.ai/docs/ (plugins, agents, SDK, permissions, custom-tools, skills)  
**Purpose**: Cross-reference upstream OpenCode capabilities against state-management-analysis.md proposals

---

## 1. Plugin System — EVENT HOOKS

OpenCode provides a native plugin hook system. The following events exist:

### Session Events (relevant to state management)

| Event | Direction | Relevance to State Mgmt |
|-------|-----------|------------------------|
| `session.created` | After creation | Could trigger gate-state hot file write for new sessions |
| `session.compacted` | After compaction | Analysis doc proposes using this for state archival |
| `session.deleted` | After deletion | Cleanup of gate-state entries |
| `session.error` | After error | Error state tracking |
| `session.idle` | After idle | Stale session detection (already used by FE) |
| `session.status` | Status change | Could trigger compaction on completion |
| `session.updated` | After update | Re-index gate-state |

### Tool Events

| Event | Relevance |
|-------|-----------|
| `tool.execute.before` | Already used for write-scope enforcement |
| `tool.execute.after` | Already used for audit logging |

### File Events

| Event | Relevance |
|-------|-----------|
| `file.edited` | Already used for tamper detection |
| `file.watcher.updated` | Could trigger state cache invalidation |

### Command Events

| Event | Relevance |
|-------|-----------|
| `command.executed` | Could trigger log rotation on safe_bash writes |

### Key Finding — NO `session.status` hook exists

The analysis doc (Section 4.1.1) correctly identifies `session.compacted` but assumes a `session.completed`-like hook that doesn't exist. The available session events are: `created`, `compacted`, `deleted`, `diff`, `error`, `idle`, `status`, `updated`. None of these directly fire on "task completed."

**Impact**: The proposed "auto-compaction on `compliance_gate_complete`" cannot be triggered by a native OpenCode event. The compaction must be called explicitly from within `compliance_gate_complete` tool implementation — which is what `state-compactor.ts` expects but is currently unwired.

---

## 2. Compaction Hooks

### `experimental.session.compacting`

- **Status**: Experimental (prefixed)
- **Fires**: BEFORE LLM generates continuation summary
- **`output.context.push(...)`**: Inject framework state context
- **`output.prompt = ...`**: Replace entire compaction prompt

**Analysis doc accuracy**: ✅ Correctly documented in Section 4.1.2. Integration with state injection is feasible.

### `session.compacted`

- **Status**: Stable
- **Fires**: AFTER session context is compacted
- **Payload**: Session ID + compaction summary

**Analysis doc accuracy**: ✅ Correctly documented in Section 4.1.1.

### Critical Distinction

Both hooks deal with **LLM context compaction** (summarizing conversation to save tokens), not **state file compaction** (moving old JSON data to archive). The analysis doc conflates these two concepts by proposing `session.compacted` as a trigger for **state file archival**. While the hook *can* be used this way (any plugin code can run in the handler), the naming creates confusion about what's actually being compacted.

---

## 3. SDK Session API

OpenCode's `@opencode-ai/sdk` provides session management:

| API Method | Relevance |
|-----------|-----------|
| `session.list()` | Could query existing sessions for dedup/cleanup |
| `session.get({ path })` | Read session metadata for gate-state sync |
| `session.create({ body })` | Not needed — gate-state is our own concept |
| `session.delete({ path })` | Cleanup orphaned gate-state entries |
| `session.summarize({ path, body })` | Programmatic compaction trigger |
| `session.prompt({ path, body })` | Framework could inject state context via `noReply: true` |

**Key Finding**: OpenCode's `session` concept is the **LLM conversation session**, not our framework's **compliance gate session**. These are distinct domains. The analysis doc correctly distinguishes this in Section 4.1.3 (compaction agent handles LLM context, StateCompactor handles framework state).

---

## 4. Built-in Agents

| Agent | Mode | Relevance |
|-------|------|-----------|
| Build | Primary | Default dev agent |
| Plan | Primary | Analysis without changes |
| General | Subagent | General-purpose task execution |
| Explore | Subagent | Read-only code exploration |
| Scout | Subagent | External docs/dependency research |
| **Compaction** | Primary (hidden) | LLM context compaction — system agent |
| Title | Primary (hidden) | Session title generation |
| Summary | Primary (hidden) | Session summary generation |

**Analysis doc accuracy**: ✅ Section 4.1.3 correctly identifies the Compaction agent. The analysis doc correctly states that our StateCompactor should "extend rather than replace" this built-in agent.

---

## 5. Plugin SDK (`@opencode-ai/plugin`)

### Plugin Signature

```typescript
export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return { /* hooks */ };
};
```

### Custom Tool Creation

```typescript
import { tool } from "@opencode-ai/plugin";
tool({ description, args, execute })
```

### Structured Logging

```typescript
await client.app.log({
  body: { service, level, message, extra }
});
```

**Analysis doc accuracy**: ✅ Section 4.2 and Section 9 fully document these. All code examples in the analysis doc follow the correct OpenCode convention (deconstructed parameters, `client.app.log()`).

---

## 6. Permissions System

### Key Permission Types

| Permission | Granularity |
|-----------|------------|
| `read`, `edit`, `glob`, `grep` | File path patterns |
| `bash` | Shell command patterns |
| `task` | Subagent type patterns |
| `skill` | Skill name patterns |
| `external_directory` | Path patterns outside worktree |
| `webfetch` | URL patterns |

### Agent-Level Overrides

Permissions can be set globally and overridden per agent. Pattern syntax uses wildcard matching (`*`, `?`).

**Analysis doc accuracy**: The analysis doc's permission matrix (Section 6.1) is **NOT aligned** with how OpenCode permissions actually work. OpenCode permissions control tool access (`read`, `edit`, `bash`, etc.), not file tier access (hot/warm/cold storage). The analysis doc's three-tier permission model (Hot/Warm/Cold) is a framework-layer concept that must be enforced by `framework-enforcer.ts`, not by OpenCode's native permission system.

---

## 7. Custom Tools

Tools defined in `.opencode/tools/` auto-register by filename. The `tool()` helper provides Zod schema validation for arguments.

**Relevance**: The framework's `compliance_gate_*` tools and `dispatch_subagent` tool are custom tools built this way. The compaction tools (`nightly-compaction.mjs`) could also be exposed as a custom tool for @CI-CD-Agent to invoke.

---

## 8. Skills

Skills are `SKILL.md` files in `.opencode/skills/<name>/`. They are loaded on-demand via the native `skill` tool. Skills can be permission-controlled per agent.

**Relevance**: The framework's 19 skills are already structured this way. Not directly relevant to state management, but confirms the framework's skill loading pattern matches upstream conventions.

---

## 9. Critical Gaps Between Analysis Doc and Upstream Reality

### G1: No "Task Completed" Event

The analysis doc assumes compaction can be triggered by a `session.compacted` event when a compliance gate session completes. But `session.compacted` fires for **LLM context compaction**, not framework task completion. The correct approach (which is partially implemented) is:

1. `compliance_gate_complete` tool implementation **explicitly calls** `StateCompactor.onGateComplete()`
2. `session.compacted` can serve as a **secondary** trigger (opportunistic archival when LLM context is compacted)

### G2: No Native State File Management

OpenCode has zero built-in support for framework state files (`machine.json`, `gate-state.json`, etc.). All state management is purely the framework's responsibility. The analysis doc correctly handles this by implementing all state logic in `state-compactor.ts` and `state-manager.ts`.

### G3: `tool.execute.after` for Compaction Trigger

The `tool.execute.after` event could be used to detect when `compliance_gate_complete` was called and trigger compaction from within the plugin, without modifying the tool implementation. However, the plugin event fires for ALL tool executions, not just compliance gate tools, so filtering would be needed.

### G4: Bun Shell API (`$`)

Plugins receive Bun's `$` shell API. This could be used for file operations (e.g., `$`mv`, `$`gzip`) in compaction scripts, but the analysis doc correctly prefers Node.js `fs` for performance.

---

## 10. Summary

| Analysis Doc Claim | Upstream Reality | Verdict |
|--------------------|------------------|:------:|
| `session.compacted` can trigger state archival | ✅ Yes, as secondary trigger | Accurate |
| `experimental.session.compacting` can inject framework context | ✅ Yes | Accurate |
| Built-in compaction agent exists | ✅ Yes, hidden system agent | Accurate |
| `@opencode-ai/plugin` SDK for type-safe plugins | ✅ Yes | Accurate |
| Three-tier permission model (Hot/Warm/Cold) | ⚠️ Framework-layer only, not OpenCode native | Partially accurate |
| `session.compacted` = "task completed" trigger | ❌ No — compaction = LLM context, not task | Inaccurate conflation |
| OpenCode has state file management APIs | ❌ No native state file support | Framework assumption correct |

**Bottom Line**: The analysis doc's integration with OpenCode upstream is mostly correct and well-researched. The primary issue is **conflating LLM context compaction with state file compaction** — the `session.compacted` hook is a useful secondary trigger but must NOT be the primary mechanism for triggering state archival. The primary trigger must be explicit calls from `compliance_gate_complete`.
