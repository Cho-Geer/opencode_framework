# OpenCode Multi-Agent System — Agent Modes, Dispatch & Identity

**Date**: 2026-06-11
**Source**: Official OpenCode docs (opencode.ai) + Source code analysis (anomalyco/opencode)
**Cache sources**: agent-mode-values.md, agents.md, agent-identity-plugin-hooks.md, dispatch-subagent.js analysis

---

## 1. Agent Mode Values

The `mode` property on an agent determines how it can be used. Three valid values:

| Mode | Type | Description |
|------|------|-------------|
| `"primary"` | Main conversation agent | Cycles via Tab. Can be `default_agent`. ❌ NOT invocable via `Task()` tool. |
| `"subagent"` | Delegated task agent | Invocable via `@mention` and `Task()` tool. ❌ Cannot be `default_agent`. Can use `hidden: true`. |
| `"all"` | **Dual-purpose (default)** | Behaves as BOTH primary AND subagent. ✅ Can be `default_agent`. ✅ Invocable via `Task()` tool. |

### Mode Behavior Matrix

| Capability | `"all"` | `"subagent"` | `"primary"` |
|------------|:-------:|:------------:|:-----------:|
| Can be default agent | ✅ | ❌ | ✅ |
| Tab cycling (primary UI) | ✅ | ❌ | ✅ |
| Invocable via `Task()` tool | ✅ | ✅ | ❌ (filtered) |
| Invocable via `@mention` | ✅ | ✅ | ✅ |
| Can be `hidden: true` | ❌ | ✅ | ✅ (system) |
| Default for custom agents | ✅ (default) | ❌ | ❌ |

### Source Code Confirmation

From `packages/opencode/src/agent/agent.ts`:
```typescript
// Default mode for custom agents
if (!item) item = { name: key, mode: "all", ... }
```

From `packages/opencode/src/tool/registry.ts` (Task tool filtering):
```typescript
const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
// mode: "all" → passes filter (all !== primary) → IS invocable via Task
// mode: "subagent" → passes filter → IS invocable via Task
// mode: "primary" → FAILS filter → NOT invocable via Task
```

---

## 2. Built-in Agents

| Agent | Mode | Description |
|-------|------|-------------|
| **Build** | `primary` | Default primary agent. All tools enabled. Full dev work. |
| **Plan** | `primary` | Restricted agent for planning/analysis. Writes/patches/edits and bash set to `ask`. |
| **General** | `subagent` | General-purpose. Full tool access (except todo). Multi-step tasks. |
| **Explore** | `subagent` | Fast, read-only. Cannot modify files. Codebase exploration. |
| **Scout** | `subagent` | Read-only. External docs/dependency research. Can clone repos into managed cache. |
| **Compaction** | `primary` (hidden) | System agent. Compacts long context. Runs automatically. |
| **Title** | `primary` (hidden) | Generates short session titles. Runs automatically. |
| **Summary** | `primary` (hidden) | Creates session summaries. Runs automatically. |

---

## 3. Dispatch Protocol

### How Subagents Are Invoked

1. **Primary agent** calls the `Task()` tool with a description and subagent type
2. **OpenCode runtime** creates a new subagent session
3. **dispatch-subagent.js** wraps the prompt with P0 protocol, DISPATCH_TOKEN, and compliance gate instructions
4. **Subagent executes** the wrapped prompt

### Task Tool Permission Flow

```
describeTask() in registry.ts:
  1. List all agents where mode !== "primary"
  2. Filter by permission.task rules (glob matching on agent name)
  3. Return filtered list to the Task() tool description
```

### Permission Pattern Examples

```json
{
  "permission": {
    "task": {
      "*": "deny",
      "orchestrator-*": "allow",
      "code-reviewer": "ask"
    }
  }
}
```

When set to `"deny"`, the subagent is **removed from the Task tool description entirely**, so the model won't attempt to invoke it.

### Task Permissions Notes

- `"allow"` → agent appears in Task tool
- `"deny"` → agent is hidden from Task tool
- `"ask"` → agent appears but requires user confirmation
- Users can always invoke subagents directly via `@` autocomplete regardless of task permissions

---

## 4. Agent Identity — FRAMEWORK_AGENT Env Var

### Source

**Project-specific** (not upstream OpenCode). Set by `dispatch-subagent.ts`:

```typescript
// .opencode/scripts/command-tools/dispatch-subagent.ts, line 101-102
const agentType = process.argv[2];
process.env.FRAMEWORK_AGENT = '@' + agentType;
```

### Propagation

Via `execSync` env spread:
```typescript
env: { ...process.env, OPENCODE_ROOT }
```

### Impact

Without `FRAMEWORK_AGENT`, agent-specific enforcement checks (write-scope, TDD, DAG coverage) would **silently fail** for subagents because the framework-enforcer plugin couldn't identify which agent is running.

### Other Runtime Env Vars

| Env Var | Value | Meaning | Source |
|---------|-------|---------|--------|
| `AGENT` | `1` | Boolean: process is an agent | Upstream OpenCode |
| `OPENCODE` | `1` | Boolean: OpenCode environment | Upstream OpenCode |
| `FRAMEWORK_AGENT` | `@AgentType` | Current agent identity (e.g., `@Coder-BE`) | **Project-specific** (dispatch-subagent.ts) |
| `OPENCODE_ROOT` | `/path/to/project` | Project root path | Project-specific |
| `OPENCODE_PID` | `529910` | Process ID | Upstream OpenCode |
| `OPENCODE_PROCESS_ROLE` | `worker` | Worker process role | Upstream OpenCode |
| `OPENCODE_RUN_ID` | UUID | Session run identifier | Upstream OpenCode |

---

## 5. Agent Identity in Plugin Hooks

### Plugin Hook Input (tool.execute.before/after)

```typescript
// Official type definition — NO agent identity field
"tool.execute.before": (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
) => Promise<void>
```

**NO agent identity** in tool hook inputs. Only `chat.message` hook natively receives agent identity.

### Workaround: Process.env.FRAMEWORK_AGENT

Since the upstream hooks don't carry agent identity, the project's framework-enforcer plugin reads `process.env.FRAMEWORK_AGENT` to determine the current agent:

```typescript
function getCurrentAgent(): string {
  return process.env.FRAMEWORK_AGENT || 'unknown';
}
```

### Where Agent IS Available Natively

Only the tool `execute()` callback (not hooks) receives agent identity via the context object:

```typescript
// In session/tools.ts — context() function
const context = (args, options): Tool.Context => ({
  sessionID: input.session.id,
  agent: input.agent.name,  // ← Agent identity here
  ...
})
```

---

## 6. Agent Configuration Format (Markdown YAML Frontmatter)

### Available Frontmatter Options

| Option | Type | Description |
|--------|------|-------------|
| `description` | string | **Required** — what the agent does |
| `mode` | string | `primary`, `subagent`, or `all` (default) |
| `model` | string | Override model for this agent |
| `temperature` | number | 0.0–1.0 (lower = more focused) |
| `steps` | number | Max agentic iterations |
| `permission` | object | Per-agent permission overrides |
| `hidden` | boolean | Hide from `@` autocomplete (subagent only) |
| `task.permission` | object | Control which subagents this agent can invoke |
| `disable` | boolean | Set to true to disable |
| `color` | string | Hex color or theme color for UI |
| `top_p` | number | 0.0–1.0 alternative to temperature |
| `prompt` | string | Custom system prompt file (`{file:./path}`) |

### Example

```markdown
---
description: Code review without edits
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
permission:
  edit: deny
  bash:
    "*": ask
    "grep *": allow
  webfetch: deny
---
You are in code review mode. Focus on code quality...
```

---

## 7. Agent Session Management

### Navigation

- **Tab** — cycle between primary agents
- **@mention** — manually invoke a subagent in the conversation
- **`session_child_first`** (<Leader>+Down) — enter first child session
- **Right/Left** — cycle between child sessions
- **Up** — return to parent session

### Subagent Lifecycle

1. Created when `Task()` tool is called or `@mentioned`
2. Runs in its own process with its own context
3. Outputs result back to the parent
4. Session remains accessible via child session navigation

---

## 8. Key Takeaways

1. **Three modes**: `primary`, `subagent`, `all` (default is `all`)
2. **`mode: "all"`** is the most flexible — acts as both primary AND subagent
3. **`mode: "primary"`** is excluded from `Task()` tool
4. **Dispatch protocol**: Task() → dispatch-subagent.js → wrapped prompt → subagent
5. **`FRAMEWORK_AGENT`** env var is project-specific (set by dispatch-subagent.ts)
6. **Plugin hooks lack agent identity** — workaround via `process.env.FRAMEWORK_AGENT`
7. **`AGENT=1`** is a boolean flag from upstream — NOT agent type
8. **Task permissions** use glob matching on agent name, last matching rule wins
9. **Hidden subagents** still invocable via Task tool if permissions allow
10. **8 built-in agents**: 5 visible (Build, Plan, General, Explore, Scout) + 3 hidden system agents
