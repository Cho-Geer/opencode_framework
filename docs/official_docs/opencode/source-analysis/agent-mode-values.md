# OpenCode Agent Mode Values — Complete Behavior Analysis

**Source**: OpenCode official docs + GitHub source code
**Fetched**: 2026-06-11
**Source URLs**:
- Official docs: https://opencode.ai/docs/agents/
- Source: https://github.com/anomalyco/opencode
  - `packages/opencode/src/agent/agent.ts` (mode schema + agent defaults)
  - `packages/opencode/src/tool/task.ts` (Task tool dispatch)
  - `packages/opencode/src/tool/registry.ts` (describeTask filtering)
  - `packages/opencode/src/agent/subagent-permissions.ts` (subagent session setup)

---

## 1. Mode Values Overview

The `mode` property on an agent determines how the agent can be used. Three valid values:

| Mode | Description |
|------|-------------|
| `"primary"` | Full primary (main conversation) agent. Cycles via Tab. Cannot be invoked via `Task()` tool. Can be set as `default_agent`. |
| `"subagent"` | Specialized agent for delegated tasks. Can be invoked via `Task()` tool. Shows in `@` autocomplete (unless `hidden: true`). Cannot be `default_agent`. |
| `"all"` | **Default**. Dual-purpose: behaves as both a primary agent AND a subagent. |

---

## 2. Question 1: Does mode:"all" allow an agent to be invoked via the Task() tool?

**YES.** Confirmed by the source code.

In `registry.ts` (the tool registry), the `describeTask()` function controls which agents are listed as available to the `Task()` tool:

```typescript
// registry.ts - describeTask()
const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
```

This filter keeps agents where `mode !== "primary"`. Since:
- `"all" !== "primary"` → **true** → agent IS included
- `"subagent" !== "primary"` → **true** → agent IS included
- `"primary" !== "primary"` → **false** → agent is filtered OUT

Therefore, agents with `mode: "all"` are fully invocable via the `Task()` tool as subagents.

---

## 3. Question 2: What is the exact difference between mode:"all" and mode:"subagent"?

### Key Difference #1: Default Agent Eligibility

In `agent.ts`, the `defaultInfo()` function selects the default agent:

```typescript
const defaultInfo = Effect.fnUntraced(function* () {
  // ...
  const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
  // ...
})
```

| Mode | `mode !== "subagent"` | Can be `default_agent`? |
|------|----------------------|------------------------|
| `"all"` | **true** (it's `"all"`, not `"subagent"`) | ✅ YES |
| `"subagent"` | **false** | ❌ NO |
| `"primary"` | **true** | ✅ YES |

### Key Difference #2: Tab Cycling (Primary UI)

- **`mode: "all"`**: Appears in primary agent Tab cycling. Can be the main conversation agent.
- **`mode: "subagent"`**: Does NOT appear in primary agent Tab cycling. Is only invocable via `@mention` or `Task()` tool.

### Key Difference #3: Default Behavior

In `agent.ts`, when a custom agent is defined without explicit `mode`:

```typescript
// agent.ts - custom agent creation
if (!item)
  item = agents[key] = {
    name: key,
    mode: "all",  // <-- DEFAULT for custom agents
    permission: Permission.merge(defaults, user),
    options: {},
    native: false,
  }
```

Then:
```typescript
item.mode = value.mode ?? item.mode  // User-provided mode overrides default
```

So if you define an agent in `opencode.json` without specifying `mode`, it defaults to `"all"`.

### Summary Table

| Capability | `mode: "all"` | `mode: "subagent"` | `mode: "primary"` |
|------------|:-------------:|:------------------:|:-----------------:|
| Can be default agent | ✅ | ❌ (throws error) | ✅ |
| Tab cycling (primary) | ✅ | ❌ | ✅ |
| Invocable via `Task()` tool | ✅ | ✅ | ❌ (filtered out) |
| Invocable via `@mention` | ✅ | ✅ | ✅ |
| Can be `hidden: true` | ❌ (`hidden` only works for subagent mode) | ✅ | ✅ (system agents) |
| Default for custom agents | ✅ (default) | ❌ | ❌ |

---

## 4. Question 3: Can mode:"all" agents be listed as subagents in task.permission allowlists?

**YES.** The `permission.task` system in `opencode.json` matches agents by name (using glob patterns), not by mode.

Example from the official docs:
```json
{
  "agent": {
    "orchestrator": {
      "mode": "primary",
      "permission": {
        "task": {
          "*": "deny",
          "orchestrator-*": "allow",
          "code-reviewer": "ask"
        }
      }
    }
  }
}
```

The `describeTask()` function in `registry.ts` first filters by mode, then applies permission filtering:

```typescript
const filtered = items.filter(
  (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
)
```

Since `mode: "all"` agents pass the initial mode filter (`mode !== "primary"`), they appear in the candidate list and are then subject to `permission.task` allowlist/denylist rules.

### Task Permission Rules for mode:"all" Agents

1. **In the `describeTask()` output**: The `Task()` tool's description includes all agents where mode is NOT "primary". Since `mode: "all"` passes this check, it IS listed as a subagent option.
2. **Permission evaluation**: If `permission.task` has a matching allow pattern for the agent name, the agent is available. If the pattern evaluates to `deny`, the agent is removed from the Task tool description entirely.
3. **No mode-based discrimination**: The permission system treats `"all"` and `"subagent"` modes identically — only the agent's name is matched against the glob patterns.

---

## 5. Summary of Findings

### The `mode: "all"` value means:

> **"This agent can serve as both a primary agent (main conversation, Tab cycling, default_agent eligible) AND as a subagent (invocable via Task() tool with appropriate permissions)."**

It is the **most flexible** mode and the **default** for all custom agents defined in `opencode.json` configs. Use `mode: "all"` when:
- You want an agent to be both a primary conversation agent AND available for Task delegation
- You don't want to restrict the agent's usage pattern
- You want the default behavior

Use `mode: "subagent"` when:
- The agent should never be the main conversation agent
- You want to enforce the agent as a specialized task worker only
- You want to use `hidden: true` (only works for subagent mode)

Use `mode: "primary"` when:
- The agent should only appear in Tab cycling / main conversation
- It should NOT be invocable by other agents via Task tool
- You want to restrict it to direct user interaction only
