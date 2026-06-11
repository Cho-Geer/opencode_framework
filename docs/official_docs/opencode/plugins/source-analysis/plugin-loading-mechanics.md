# OpenCode Plugin Loading Mechanics — Source Code Analysis

**Date**: 2026-06-07
**Source**: anomalyco/opencode GitHub repository (dev branch)
**Files Analyzed**:
- `packages/opencode/src/plugin/loader.ts` — Plugin loader pipeline
- `packages/opencode/src/plugin/shared.ts` — Plugin entry resolution & directory scanning
- `packages/core/src/plugin.ts` — Plugin hook dispatch (trigger/triggerFor)
- `packages/opencode/src/session/tools.ts` — Tool execution pipeline with hook triggers
- `packages/plugin/src/index.ts` — Plugin type definitions (Hooks interface)
- Local: `.opencode/plugins/framework-enforcer/index.ts` & `hooks/tool-execute.ts`

---

## Q1: How does the plugin loader handle directory-based plugins?

**Answer**: The loader does NOT load ALL .ts/.js files. It follows a specific resolution chain:

### Resolution Flow (from `packages/opencode/src/plugin/shared.ts`)

1. **`resolvePluginTarget()`** (lines ~168-179): Determines the plugin target path
   - For file plugins (`./path`, `file://`, absolute paths): calls `resolvePathPluginTarget()`

2. **`resolvePathPluginTarget()`** (lines ~157-176):
   ```
   If target is a directory:
     ├── Check for package.json in directory
     │   └── If found → return directory URL (for further resolution)
     └── If NOT found → try resolveDirectoryIndex()
         └── Scans INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]
               └── First match wins → return file URL
               └── No match → throw "missing package.json or index file"
   ```

3. **`resolvePluginEntrypoint()`** (lines ~130-155):
   ```
   If package.json found:
     ├── Try exports["./server"] or exports["./tui"] → prioritized
     ├── Try package.main field → fallback
     └── If directory and exports exist but no match for kind → return undefined
   If no package resolution works AND target is directory:
     └── Try resolveDirectoryIndex() for INDEX_FILES
   ```

### Does it respect package.json `main` field?

**YES** — via `packageMain()` (lines ~100-105) and `resolvePackageEntrypoint()` (lines ~115-127):
```typescript
function packageMain(pkg: PluginPackage) {
  const value = pkg.json.main
  if (typeof value !== "string") return
  // ...
}
```
- `exports["./server"]` or `exports["./tui"]` takes priority over `main`
- Falls back to `package.main` if no exports match the plugin kind

### Does it skip files with `_` prefix?

**NO** — there is NO `_` prefix skipping logic anywhere in the loader. The loader does not scan for arbitrary .ts/.js files at all — it only looks at:
- Explicit `package.json` exports/main fields
- Fixed `INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]`

### Key code (shared.ts, lines ~89-91):
```typescript
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]

async function resolveDirectoryIndex(dir: string) {
  for (const name of INDEX_FILES) {
    const file = path.join(dir, name)
    if (await Filesystem.exists(file)) return file
  }
}
```

---

## Q2: When two plugins register the same hook event (e.g., `tool.execute.after`), does OpenCode chain multiple handlers or last-writer-win?

**Answer**: **CHAINS multiple handlers** — ALL registered plugins' hooks are iterated and called in registration order.

### Evidence from `packages/core/src/plugin.ts`

The `triggerFor` method (lines ~117-130 of the Service implementation):

```typescript
triggerFor: Effect.fn("Plugin.triggerFor")(function* (id, name, input, output) {
    // ... setup ...
    for (const item of hooks) {                    // ← Iterates ALL registered plugins
      if (id !== ID.make("*") && item.id !== id) continue
      const match = item.hooks[name]               // ← Finds hook by name
      if (!match) continue                         // ← Skip if this plugin doesn't have the hook
      yield* match(event as any).pipe(...)          // ← CALLS each matching hook
    }
    // ... finishDraft ...
}),
```

The `hooks` array stores ALL registered plugins independently:
```typescript
let hooks: { id: ID; hooks: HookFunctions; scope: Scope.Closeable }[] = []
```

When `trigger("tool.execute.before", ...)` is called, it delegates to:
```typescript
trigger: Effect.fn("Plugin.trigger")(function* (name, input, output) {
    return yield* svc.triggerFor(ID.make("*"), name, input, output)
    // ID.make("*") = match ALL plugin IDs
}),
```

The ID.make("*") means ALL plugins are matched — so every plugin that registered `tool.execute.before` gets called.

However, there's an important nuance: the `add` method replaces plugins with the SAME ID:
```typescript
const existing = hooks.find((item) => item.id === input.id)
if (existing) yield* Scope.close(existing.scope, Exit.void)
// ... replaces old entry ...
hooks = [...hooks.filter((item) => item.id !== input.id), newEntry]
```

So **different plugins with different IDs are chained**. Same plugin re-added replaces itself.

### Local Project Finding (Critical)

The local project had a P0 bug where `uc7ks-enforcer` plugin and `framework-enforcer` plugin both registered `tool.execute.before`/`tool.execute.after`. Due to the upstream chaining behavior, BOTH should fire. However, an investigation (ARC-DIAGNOSE-HOOK) found that the uc7ks-enforcer was overriding the framework-enforcer's hooks. The fix was to merge both into a single plugin (`framework-enforcer`), which now registers both sets of hooks from one plugin entry.

**Current state**: After FW-MERGE-UC7KS (2026-06-06), only one plugin `.opencode/plugins/framework-enforcer` is registered in `opencode.json` (line 711), and it registers all hooks via its `index.ts` entry point.

---

## Q3: Do `tool.execute.before` and `tool.execute.after` hooks fire for MCP custom tools, or only for built-in OpenCode tools?

**Answer**: **BOTH** — hooks fire for BOTH built-in tools AND MCP custom tools.

### Evidence from `packages/opencode/src/session/tools.ts`

The `resolve` function iterates through ALL tools from TWO sources and wraps EACH with hook triggers:

#### Built-in tools (from ToolRegistry) — lines 66-92:
```typescript
for (const item of yield* registry.tools({...})) {
    tools[item.id] = tool({
        // ...
        execute(args, options) {
            return run.promise(
                Effect.gen(function* () {
                    const ctx = context(args, options)
                    // ★ tool.execute.before for BUILT-IN tools
                    yield* plugin.trigger(
                        "tool.execute.before",
                        { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
                        { args },
                    )
                    const result = yield* item.execute(args, ctx)
                    // ... process result ...
                    // ★ tool.execute.after for BUILT-IN tools
                    yield* plugin.trigger(
                        "tool.execute.after",
                        { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
                        output,
                    )
                    return output
                }),
            )
        },
    })
}
```

#### MCP custom tools (from MCP.Service) — lines 96-164:
```typescript
for (const [key, item] of Object.entries(yield* mcp.tools())) {
    const execute = item.execute
    if (!execute) continue
    item.execute = (args, opts) =>
        run.promise(
            Effect.gen(function* () {
                const ctx = context(args, opts)
                // ★ tool.execute.before for MCP tools
                yield* plugin.trigger(
                    "tool.execute.before",
                    { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
                    { args },
                )
                // ... execute MCP tool ...
                // ★ tool.execute.after for MCP tools
                yield* plugin.trigger(
                    "tool.execute.after",
                    { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
                    result,
                )
                // ... process result ...
                return output
            }),
        )
    tools[key] = item
}
```

The hook trigger pattern is **identical** for both tool types: `plugin.trigger("tool.execute.before", ...)` is called, then the tool executes, then `plugin.trigger("tool.execute.after", ...)` is called. No distinction is made between built-in and MCP tools.

### Local Verification

Our project's `framework-enforcer` plugin (`hooks/tool-execute.ts`) intercepts `tool.execute.before` (line 131) and `tool.execute.after` (line 580) and handles ALL tool types — it checks `input.tool` (the tool name) to apply different enforcement rules (e.g., `write`/`edit`/`bash`/`safe_edit` checks vs `context7_*`/`webfetch`/`websearch` external query checks).

---

## Summary Table

| Question | Answer | Key Source File |
|----------|--------|----------------|
| Q1: Directory-based loading | Scans for package.json (exports > main), then falls back to INDEX_FILES. NO _-prefix skipping. | `packages/opencode/src/plugin/shared.ts` |
| Q2: Hook event chaining | **CHAINS** — iterates all plugins' hooks in registration order. Not last-writer-win. | `packages/core/src/plugin.ts` (triggerFor) |
| Q3: MCP vs built-in tool hooks | **BOTH** — hooks fire identically for all tool types (built-in + MCP). | `packages/opencode/src/session/tools.ts` |
