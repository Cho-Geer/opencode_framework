# How OpenCode Passes Agent Information to Plugins at Runtime

**Source**: anomalyco/opencode GitHub repository (dev branch) + local project analysis
**Date**: 2026-06-07
**Author**: @Knowledge-Curator
**Source Type**: Source code analysis (GitHub MCP + local filesystem)

## Files Analyzed

| File | Repository | Lines |
|------|-----------|-------|
| `packages/plugin/src/index.ts` | anomalyco/opencode (upstream) | Full (9053 bytes) |
| `packages/core/src/plugin.ts` | anomalyco/opencode (upstream) | Full (5745 bytes) |
| `packages/opencode/src/session/tools.ts` | anomalyco/opencode (upstream) | Full (7840 bytes) |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | Local project | 710 lines |
| `.opencode/plugins/framework-enforcer/fw-core.ts` | Local project | 55 lines |

---

## Q1: FRAMEWORK_AGENT env var

**Source**: `dispatch-subagent.ts` (line 102)
**Type**: **PROJECT-SPECIFIC** — not from upstream OpenCode

```typescript
// .opencode/scripts/command-tools/dispatch-subagent.ts, line 101-102
const agentType = process.argv[2];
process.env.FRAMEWORK_AGENT = '@' + agentType;
```

**Propagation**: Via `execSync` env spread (line 152):
```typescript
env: { ...process.env, OPENCODE_ROOT }
```

**Impact**: This was added as part of BUG-5894 fix. Without it, the framework-enforcer plugin would see `process.env.FRAMEWORK_AGENT` as undefined, causing agent-specific checks (write-scope enforcement, TDD validation, DAG coverage) to silently fail for subagents.

**Upstream OpenCode**: Does NOT have `FRAMEWORK_AGENT` in its source code at all.

---

## Q2: Agent-related data in tool.execute.before/after hooks

### Official Type Definition (Upstream OpenCode)

**File**: `packages/plugin/src/index.ts`

```typescript
"tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
) => Promise<void>

"tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      metadata: any
    },
) => Promise<void>
```

**NO agent identity field** in `tool.execute.before` or `tool.execute.after` hook input.

### Internal HookSpec (Confirmation)

**File**: `packages/core/src/plugin.ts`

The internal `HookSpec` type definition confirms the same — no agent identity for tool hooks.

### Where agent IS available in hooks

Only `chat.message` and `chat.params` hooks natively receive agent identity:
```typescript
"chat.message"?: (
    input: { sessionID: string; agent?: string; ... },
    ...
) => Promise<void>
```

---

## Q3: Plugin system agent identity

### Plugin Initialization Context

**File**: `packages/plugin/src/index.ts`

```typescript
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  experimental_workspace: { ... }
  serverUrl: URL
  $: BunShell
}
```

**No agent identity** in the plugin init context.

### Tool.execute() callback (the ONLY place with agent identity)

**File**: `packages/opencode/src/session/tools.ts`

The `context()` function creates a `Tool.Context` that includes agent identity:
```typescript
const context = (args, options): Tool.Context => ({
    sessionID: input.session.id,
    ...
    agent: input.agent.name,  // ← THIS is where agent identity goes
    ...
})
```

This `Tool.Context` is passed to the tool's `execute(args, ctx)` callback, but **NOT to plugin hooks**. Plugin hooks (`tool.execute.before/after`) fire asynchronously around the tool execution but don't receive the context object.

---

## Q4: AGENT=1 env var meaning

**Value**: `AGENT=1` (confirmed from runtime env dump)
**Source**: OpenCode TUI/runtime (present in all spawned agent processes)
**Meaning**: **Boolean flag** — indicates "this process is running as an agent"

**It is NOT an index** into any agent config array. The value is literally the string `"1"`.

### Other runtime env vars

| Env Var | Value | Meaning |
|---------|-------|---------|
| `AGENT` | `1` | Boolean: process is an agent |
| `OPENCODE` | `1` | Boolean: OpenCode environment |
| `OPENCODE_PID` | `529910` | Process ID |
| `OPENCODE_PROCESS_ROLE` | `worker` | Worker process role |
| `OPENCODE_RUN_ID` | UUID | Session run identifier |

---

## Summary Table

| Mechanism | Available in Plugin Hooks? | Source |
|-----------|---------------------------|--------|
| `FRAMEWORK_AGENT=@AgentType` | ✅ Yes (process.env) | Local project (dispatch-subagent.ts:102) |
| `AGENT=1` | ✅ Yes (process.env) | Upstream OpenCode Runtime |
| `context.agent` | ❌ No | Upstream OpenCode (tools.ts) — only in execute() |
| Hook input `agent` field | ❌ Not in Hooks interface | Upstream OpenCode (plugin/src/index.ts) |
