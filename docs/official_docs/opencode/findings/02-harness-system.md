# OpenCode Harness System — Plugin Hooks, Loading & Bun Cache

**Date**: 2026-06-11
**Source**: Official OpenCode docs (opencode.ai) + Source code analysis (anomalyco/opencode)
**Cache sources**: plugins.md, plugin-loading-mechanics.md, plugin-debugging-precautions.md, opencode-plugin-loading-bun-cache.md, plugin-programming-conventions.md, double-hook-trigger-prevention.md

---

## 1. Plugin System Overview

OpenCode plugins allow extending the framework by hooking into various events. Plugins are **JavaScript/TypeScript modules** that export one or more functions returning hook implementations.

### Plugin Types

| Type | Discovery | Location |
|------|-----------|----------|
| **Local (auto-discovered)** | Scans `.opencode/plugins/*.ts, *.js` | `.opencode/plugins/` (project) |
| **Local (auto-discovered)** | Scans `~/.config/opencode/plugins/*.ts, *.js` | `~/.config/opencode/plugins/` (global) |
| **npm packages** | Explicit via `opencode.json` → `"plugin": [...]` | npm registry |
| **Custom path** | Explicit via `opencode.json` | File path |

### Load Order

1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin directory (`~/.config/opencode/plugins/`)
4. Project plugin directory (`.opencode/plugins/`)

**Important**: Duplicate npm packages loaded once. Local + npm with similar names loaded separately.

---

## 2. Plugin File Loading Mechanics

### Resolution Flow (from `packages/opencode/src/plugin/shared.ts`)

```
For a directory-based plugin:
  ├── Check for package.json in the directory
  │   └── If found → read exports["./server"] or exports["./tui"] (priority)
  │                → fallback to package.main field
  └── If NOT found → try resolveDirectoryIndex()
      └── Scans INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]
          └── First match wins → return file URL
          └── No match → throw "missing package.json or index file"
```

### Critical Rule: Only INDEX_FILES Are Loaded

The framework does NOT scan arbitrary `.ts`/`.js` files in subdirectories:

```
.opencode/plugins/my-plugin/
├── index.ts              ← ✅ LOADED (matches INDEX_FILES)
├── main.ts               ← ❌ NOT loaded (not an index file)
├── hooks/tool-execute.ts ← ❌ NOT scanned (subdirectory, not index)
└── utils.ts              ← ❌ NOT scanned
```

Subdirectory files ARE loaded ONLY if imported by the `index.ts` entry point.

### OpenCode.json Configuration

```json
{
  "plugin": [
    "npm-package-name",
    "npm-package@1.2.3",
    "./local-plugin.ts",
    "file:///abs/path/plugin.js",
    [ "pkg", { "key": "val" } ]
  ]
}
```

---

## 3. Plugin Export Format

### ✅ Correct: `export default` (MANDATORY)

```typescript
// ✅ WORKS
export default (async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => { },
    "tool.execute.after": async (input, output) => { },
  };
});
```

### ❌ Wrong: `export const` returning hooks

```typescript
// ❌ SILENTLY FAILS
export const MyPlugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => { },
  };
};
```

### Plugin Initialization Context

| Parameter | Type | Description |
|-----------|------|-------------|
| `project` | `Project` | Current project information |
| `directory` | `string` | Current working directory |
| `worktree` | `string` | Git worktree path |
| `client` | `OpenCodeClient` | SDK client for interacting with the AI |
| `$` | `BunShell` | Bun's shell API for executing commands |

---

## 4. Hook Event System

### Available Hooks (Complete List)

| Category | Events |
|----------|--------|
| **Tool** | `tool.execute.before`, `tool.execute.after` |
| **Chat** | `chat.message` (has agent field) |
| **Session** | `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated` |
| **Message** | `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated` |
| **File** | `file.edited`, `file.watcher.updated` |
| **Shell** | `shell.env` |
| **Permission** | `permission.asked`, `permission.replied` |
| **TUI** | `tui.prompt.append`, `tui.command.execute`, `tui.toast.show` |
| **Command** | `command.executed` |
| **Todo** | `todo.updated` |
| **LSP** | `lsp.client.diagnostics`, `lsp.updated` |
| **Installation** | `installation.updated` |
| **Server** | `server.connected` |
| **Compaction** | `experimental.session.compacting` |

### Hook Function Signatures

```typescript
// BEFORE hook: args in output
"tool.execute.before": (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
) => Promise<void>

// AFTER hook: args in input
"tool.execute.after": (
  input: { tool: string; sessionID: string; callID: string; args: any },
  output: { title: string; output: string; metadata: any },
) => Promise<void>

// Chat message hook (HAS agent identity)
"chat.message": (
  input: { sessionID: string; agent?: string; model?: string; messageID?: string; variant?: string },
  output: { message: any; parts: any[] },
) => Promise<void>
```

### Critical: before vs after Hook Parameters

| Hook | Args Location | Example |
|------|--------------|---------|
| `tool.execute.before` | `output.args.filePath` | `output.args.filePath` |
| `tool.execute.after` | `input.args.filePath` | `input.args.filePath` |

**Source**: `packages/opencode/src/session/tools.ts`
```typescript
// before
yield* plugin.trigger("tool.execute.before", { tool, sessionID, callID }, { args })
// after
yield* plugin.trigger("tool.execute.after", { tool, sessionID, callID, args }, output)
```

---

## 5. Hook Chaining Behavior (Critical)

### Multiple Plugins → ALL trigger (NOT last-writer-wins)

When multiple plugins register the same hook event, **ALL** are called in registration order:

```typescript
// packages/core/src/plugin.ts — triggerFor
for (const item of hooks) {              // ← Iterates ALL registered plugins
  if (id !== ID.make("*") && item.id !== id) continue
  const match = item.hooks[name]
  if (!match) continue
  yield* match(event as any).pipe(...)    // ← Calls EACH matching hook
}
```

### ID-Based Behavior

| Scenario | Behavior |
|----------|----------|
| Same ID re-registered | Replaces old entry (last-writer-wins) |
| Different IDs, same hook | **BOTH fire** (chaining) |
| One plugin fails | Rolled back, others continue |

### Recommendation: Merge into Single Plugin

```typescript
// .opencode/plugins/framework-enforcer/index.ts
import { uc7ksHooks } from './enforcers/uc7ks-enforcer';
import { frameworkHooks } from './enforcers/framework-enforcer';

export default (async (ctx) => {
  return {
    'tool.execute.before': async (input, output) => {
      await uc7ksHooks.before(input, output);      // UC7KS first
      await frameworkHooks.before(input, output);   // Framework second
    },
    'tool.execute.after': async (input, output) => {
      await uc7ksHooks.after(input, output);
      await frameworkHooks.after(input, output);
    },
  };
});
```

---

## 6. Bun Cache Behavior

### Cache Strategy

| Stage | Behavior |
|-------|----------|
| First load | Bun compiles `.ts` → bytecode, cached by (file path, content hash) |
| Reload | Checks bytecode hash vs source file hash |
| Hash match | Uses cached bytecode (skips compilation) |
| Hash mismatch | SHOULD recompile, but NOT always reliable |

### Cache Invalidation Reliability

| Action | Triggers Recompile? |
|--------|-------------------|
| Small changes (comments, variable names) | ❌ Often does NOT trigger |
| Large changes (new functions, major edits) | ✅ Usually triggers |
| Modify `// BUN-CACHE-VERSION` comment | ❌ Not reliable |
| **Rename file** | ✅ **100% triggers** (new cache key) |
| `rm -rf ~/.cache/bun` | ✅ **100% triggers** |

### 100% Reliable Cache Refresh Methods

```bash
# Method 1: Clear global Bun cache
rm -rf ~/.cache/bun

# Method 2: Rename file (new filename = new cache key)
mv framework-enforcer.ts framework-enforcer-v2.ts
```

---

## 7. Key Constraints (Verified in Production)

| Constraint | Description |
|------------|-------------|
| **Use `export default`** | `export const` + returning hooks → silent failure |
| **Hooks in same module** | Hook functions must be defined in the same file as the export default |
| **INDEX_FILES only** | Plugin entry MUST be `index.ts`/`.js`/`.tsx`/`.mjs`/`.cjs` |
| **No deep nested dirs** | Bun relative path resolution fails across subdirectory imports |
| **Flat structure preferred** | All plugin files at same level to avoid import issues |
| **Single plugin recommended** | Multiple plugins cause double hook triggering |
| **Bun cache is unreliable** | Changes may not trigger recompilation — rename file or clear cache |

---

## 8. Recommended Plugin Architecture

```
.opencode/plugins/
└── framework-enforcer/
    ├── index.ts                  ← export default, all hooks combined
    └── enforcers/
        ├── uc7ks-enforcer.ts     ← Imported by index.ts (NOT auto-discovered)
        └── framework-enforcer.ts ← Imported by index.ts (NOT auto-discovered)

.opencode/lib/
├── gate-core.ts                  ← Shared logic (outside plugins path)
└── state-utils.ts
```

**Key Principles**:
- `plugins/` dir: only plugin entry files + subdirectories with supporting modules
- `lib/` dir: shared code NOT in plugin scan path
- Startup: always clear Bun cache or use `.bashrc` auto-cleanup
