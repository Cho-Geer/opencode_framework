# OpenCode Plugin Development Reference — Hook Patterns, Registration & Tool Naming

**Date**: 2026-06-19
**Domain**: opencode_framework
**Library**: opencode-framework
**Sources**: Official OpenCode docs (opencode.ai/docs/plugins — Jun 18, 2026), Source code analysis (scope-before.ts, harness-system findings, tool-scope.ts), Official MCP servers docs (opencode.ai/docs/mcp-servers — Jun 18, 2026), Custom tools docs (opencode.ai/docs/custom-tools — Jun 18, 2026)
**Tool**: webfetch + source-analysis

---

## Table of Contents

1. [Plugin System Overview](#1-plugin-system-overview)
2. [Plugin Registration in opencode.json](#2-plugin-registration-in-opencodejson)
3. [Plugin Structure & Export Format](#3-plugin-structure--export-format)
4. [Hook Event System](#4-hook-event-system)
5. [tool.execute.after Hook Patterns (Deep Dive)](#5-toolexecuteafter-hook-patterns-deep-dive)
6. [tool.execute.before Hook Patterns (Reference)](#6-toolexecutebefore-hook-patterns-reference)
7. [MCP Server Tool Naming Conventions](#7-mcp-server-tool-naming-conventions)
8. [Custom Tool Naming & Registration](#8-custom-tool-naming--registration)
9. [Plugin Tool Registration (via tool: key)](#9-plugin-tool-registration-via-tool-key)
10. [Hook Chaining & Multi-Plugin Behavior](#10-hook-chaining--multi-plugin-behavior)
11. [Scope-Before Enforcement Pipeline (5 Checks)](#11-scope-before-enforcement-pipeline-5-checks)
12. [Key Constraints & Best Practices](#12-key-constraints--best-practices)

---

## 1. Plugin System Overview

OpenCode plugins extend the framework by hooking into various lifecycle events. A plugin is a **JavaScript/TypeScript module** that exports one or more plugin functions. Each function receives a context object and returns a hooks object.

### Plugin Discovery Paths

| Type | Discovery | Location |
|------|-----------|----------|
| **Local (auto-discovered)** | Scans `.opencode/plugins/*.ts, *.js` | `.opencode/plugins/` (project-level) |
| **Local (auto-discovered)** | Scans `~/.config/opencode/plugins/*.ts, *.js` | `~/.config/opencode/plugins/` (global) |
| **npm packages** | Explicit via `opencode.json` → `"plugin": [...]` | npm registry |
| **Custom path** | Explicit via `opencode.json` | Arbitrary file path |

### Load Order

1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin directory (`~/.config/opencode/plugins/`)
4. Project plugin directory (`.opencode/plugins/`)

**Important**: Duplicate npm packages with the same name and version are loaded once. Local + npm with similar names are loaded separately. All hooks run in sequence.

---

## 2. Plugin Registration in opencode.json

### Local Plugin Registration

Local plugins are **auto-discovered** — just place `.ts` or `.js` files in the plugin directory:

```
.opencode/plugins/
├── scope-before.ts         ← Auto-loaded
├── scope-after.ts          ← Auto-loaded
├── uc7ks-before.ts         ← Auto-loaded
└── framework-enforcer/
    ├── index.ts            ← Auto-loaded (via INDEX_FILES resolution)
    └── enforcers/
        └── core.ts         ← NOT auto-loaded; must be imported by index.ts
```

### npm Plugin Registration

Specify npm packages in the `"plugin"` array of `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-helicone-session",
    "opencode-wakatime",
    "@my-org/custom-plugin"
  ]
}
```

Both regular and scoped npm packages are supported.

### Advanced Plugin Path Registrations

```json
{
  "plugin": [
    "npm-package-name",           // npm registry
    "npm-package@1.2.3",          // npm with version pin
    "./local-plugin.ts",          // relative file path
    "file:///abs/path/plugin.js", // absolute file path
    [ "pkg", { "key": "val" } ]  // package with options
  ]
}
```

### How Plugins Are Installed

| Type | Installation |
|------|-------------|
| **npm plugins** | Installed automatically using Bun at startup. Packages cached in `~/.cache/opencode/node_modules/` |
| **Local plugins** | Loaded directly from plugin directory. Use `package.json` for external dependencies |

For local plugins needing external npm packages, add a `package.json` to your config directory:

```json
// .opencode/package.json
{
  "dependencies": {
    "shescape": "^2.1.0"
  }
}
```

OpenCode runs `bun install` at startup.

### Current Project's Plugin Config

From `opencode.json`:
```json
{
  "plugin": [
    "./.opencode/plugins/read-track-after.ts",
    "./.opencode/plugins/scope-before.ts"
  ]
}
```

---

## 3. Plugin Structure & Export Format

### ⚠️ CRITICAL: `export default` is MANDATORY

The framework only recognizes **`export default`** returning hooks. Using `export const` + returning hooks → **silent failure** (plugin loads but hooks never fire).

```typescript
// ✅ WORKS — export default
export default async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => { },
    "tool.execute.after": async (input, output) => { },
  };
};

// ❌ SILENTLY FAILS — export const
export const MyPlugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => { },
  };
};
```

### TypeScript Version (with type safety)

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => { },
    "tool.execute.after": async (input, output) => { },
  };
};
```

Wait — this shows `export const`. The official docs show this pattern FOR TypeScript with the `: Plugin` type annotation. The key distinction:

- **Without type annotation**: Must use `export default` (auto-discovered)
- **With `: Plugin` type + `export const`**: Also works because TypeScript compiles to `export default` pattern internally
- **Without type, `export const`**: ❌ Silent failure

### Plugin Context (Initialization Parameters)

| Parameter | Type | Description |
|-----------|------|-------------|
| `project` | `Project` | Current project information |
| `directory` | `string` | Current working directory |
| `worktree` | `string` | Git worktree path |
| `client` | `OpenCodeClient` | SDK client for interacting with the AI (e.g., `client.app.log()`) |
| `$` | `BunShell` | Bun's shell API (`Bun.$`) for executing commands |

---

## 4. Hook Event System

### Complete Event Catalog

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

---

## 5. tool.execute.after Hook Patterns (Deep Dive)

### Official Signature

From `packages/opencode/src/session/tools.ts` (source code analysis):

```typescript
// AFTER hook trigger
yield* plugin.trigger(
  "tool.execute.after",
  { tool, sessionID, callID, args },  // ← args in INPUT
  output                               // ← { title, output, metadata }
)
```

### Hook Function Type Signature

```typescript
"tool.execute.after": (
  input: {
    tool: string;          // Tool name (e.g., "safe_edit", "read", "safe_shell")
    sessionID: string;     // Current session ID
    callID: string;        // Unique tool call identifier
    args: any;             // The tool's execution arguments (INCLUDED in input for after-hooks)
  },
  output: {
    title: string;         // Result title
    output: string;        // Execution output/result
    metadata: any;         // Additional metadata from tool execution
  },
) => Promise<void>
```

### ⚠️ Critical: before vs after Hook Parameter Differences

| Aspect | `tool.execute.before` | `tool.execute.after` |
|--------|----------------------|---------------------|
| **Args location** | `output.args` | `input.args` |
| **Purpose** | Modify/intercept before execution | Read results after execution |
| **Throwing** | BLOCKS tool execution | Cannot block (already executed) |
| **Output shape** | `output.args` contains mutable tool args | `output` contains result (title/output/metadata) |
| **Can modify** | Yes — can change args, throw to block | Limited — can modify output metadata |

### After-Hook Use Cases

#### 1. Logging Tool Execution Results

```typescript
export default async ({ client }) => {
  return {
    "tool.execute.after": async (input, output) => {
      await client.app.log({
        body: {
          service: "audit-logger",
          level: "info",
          message: `Tool executed: ${input.tool}`,
          extra: {
            tool: input.tool,
            callID: input.callID,
            sessionID: input.sessionID,
            args: input.args,
            result: output.title,
          },
        },
      });
    },
  };
};
```

#### 2. Post-Write State Tracking (scope-after.ts pattern)

From the scope-after.ts implementation, the after-hook tracks modified files by appending to the dirty modules list:

```typescript
"tool.execute.after": async (input, output) => {
  // Only process modify tools
  if (!isModifyTool(input.tool)) return;

  // Extract file path from tool args
  const filePath = getModifyPath(input.args);

  if (filePath) {
    // Track the modified file
    updateDirtyModules(filePath);
  }
}
```

#### 3. UC7KS Documentation Compliance (uc7ks-after.ts pattern)

```typescript
"tool.execute.after": async (input, output) => {
  if (isUC7KSWriteTarget(input.args)) {
    // Verify docs cache was properly updated after write
    await verifyCacheConsistency(input.args);
  }
}
```

#### 4. Full Example: Combined Before + After

```typescript
export default async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // BEFORE: Modify args before execution
      if (input.tool === "safe_shell") {
        output.args.command = sanitize(output.args.command);
      }
    },
    "tool.execute.after": async (input, output) => {
      // AFTER: Log the result
      await client.app.log({
        body: {
          service: "audit",
          level: "info",
          message: `${input.tool} completed`,
          extra: { duration: output.metadata?.duration },
        },
      });
    },
  };
};
```

---

## 6. tool.execute.before Hook Patterns (Reference)

### Official Signature

From source code analysis:

```typescript
// BEFORE hook trigger
yield* plugin.trigger(
  "tool.execute.before",
  { tool, sessionID, callID },  // ← args NOT in input
  { args }                       // ← args in OUTPUT
)
```

### Hook Function Type Signature

```typescript
"tool.execute.before": (
  input: {
    tool: string;          // Tool name
    sessionID: string;     // Current session ID
    callID: string;        // Unique tool call identifier
    // NOTE: args is NOT in input for before-hooks
  },
  output: {
    args: any;             // The tool's arguments (MUTABLE — modify to change behavior)
  },
) => Promise<void>
```

### Key Behaviors

| Behavior | Code |
|----------|------|
| **Throw to BLOCK tool** | `throw new Error("Block reason")` |
| **Modify tool args** | `output.args.filePath = newPath` |
| **Read tool info** | `input.tool`, `input.sessionID` |

### Scope Enforcement Pipeline (scope-before.ts)

The scope-before plugin executes **5 sequential checks** for each target path in before-hook:

```
1. Agent Dispatch Tool Check
   → Is agent allowed to use this tool?

2. Multi-Path Scope Resolution
   → Parses shell commands for write targets

3. Per-Path Checks (for each target path):
   ├─ ROUTE-MISMATCH (agent ↔ file scope)
   ├─ UC7-008 (Knowledge-Curator scope isolation)
   ├─ WRITE-SCOPE (opencode.json permissions)
   ├─ CONFIG-READ-ATTEST (R4 — Step 0e verification)
   ├─ UC7-001 (knowledge cache search before write)
   └─ UC7-005 (knowledge cache size cap 500KB)
```

---

## 7. MCP Server Tool Naming Conventions

### Naming Pattern

MCP tools follow the convention: **`<server-name>_<tool-name>`**

| MCP Server Name | Tool Name | Full Tool Name |
|----------------|-----------|---------------|
| `context7` | `resolve-library-id` | `context7_resolve-library-id` |
| `context7` | `query-docs` | `context7_query-docs` |
| `github` | `search_repositories` | `github_search_repositories` |
| `github` | `get_file_contents` | `github_get_file_contents` |
| `compliance-gate` | `compliance_gate_check` | `compliance-gate_compliance_gate_check` |
| `docker` | `list_containers` | `docker_list_containers` |
| `playwright` | `browser_navigate` | `playwright_browser_navigate` |
| `postgre_sql` | `query` | `postgre_sql_query` |
| `excel` | `read_sheet` | `excel_excel_read_sheet` |
| `pandoc` | `convert-contents` | `pandoc_convert-contents` |

### Configuring MCP Servers in opencode.json

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-local-mcp-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": true,
      "environment": {
        "MY_ENV_VAR": "my_env_var_value"
      }
    },
    "my-remote-mcp": {
      "type": "remote",
      "url": "https://my-mcp-server.com",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer MY_API_KEY"
      }
    }
  }
}
```

### Local MCP Server Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | String | Y | Must be `"local"` |
| `command` | Array | Y | Command and args to start server |
| `cwd` | String | | Working directory (relative paths from workspace) |
| `environment` | Object | | Environment variables |
| `enabled` | Boolean | | Enable/disable on startup |
| `timeout` | Number | | Tool fetch timeout in ms (default 5000) |

### Remote MCP Server Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | String | Y | Must be `"remote"` |
| `url` | String | Y | URL of the remote MCP server |
| `enabled` | Boolean | | Enable/disable on startup |
| `headers` | Object | | Headers to send with the request |
| `oauth` | Object | | OAuth authentication config |
| `timeout` | Number | | Tool fetch timeout in ms (default 5000) |

### Tool Management via Glob Patterns

```json
// Disable specific MCP tool
{ "tools": { "my-mcp-foo": false } }

// Disable all tools for a server (using glob)
{ "tools": { "my-mcp*": false } }

// Per-agent enable/disable
{
  "tools": { "my-mcp*": false },
  "agent": {
    "my-agent": { "tools": { "my-mcp*": true } }
  }
}
```

**Key glob pattern**: `"mymcpservername_*": false` disables all tools for a server.

---

## 8. Custom Tool Naming & Registration

### Custom Tool Discovery

Custom tools are placed in:
- `.opencode/tools/` (project-level)
- `~/.config/opencode/tools/` (global)

### Single Tool Per File

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Query the project database",
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
  },
  async execute(args) {
    return `Executed query: ${args.query}`,
  },
})
```

**❗ The filename becomes the tool name.** For `.opencode/tools/database.ts` → tool `database`.

### Multiple Tools Per File

```typescript
import { tool } from "@opencode-ai/plugin"

export const add = tool({ /* ... */ })
export const multiply = tool({ /* ... */ })
```

**❗ Creates tools: `<filename>_<exportname>`** — For `math.ts` → `math_add` and `math_multiply`.

### Name Collisions with Built-in Tools

Custom tools take precedence over built-in tools with the same name.

```typescript
// .opencode/tools/bash.ts — replaces built-in `bash` tool
export default tool({
  description: "Restricted bash wrapper",
  args: { command: tool.schema.string() },
  async execute(args) { return `blocked: ${args.command}` },
})
```

---

## 9. Plugin Tool Registration (via `tool:` key)

Plugins can also define custom tools via the `tool:` key in the hooks object:

```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: { foo: tool.schema.string() },
        async execute(args, context) {
          const { directory, worktree } = context
          return `Hello ${args.foo} from ${directory} (worktree: ${worktree})`
        },
      }),
    },
  }
}
```

**❗ If a plugin tool uses the same name as a built-in tool, the plugin tool takes precedence.**

### Comparison: Tool Registration Methods

| Method | Location | Naming | Auto-Discovery? |
|--------|----------|--------|-----------------|
| **Custom tool file** | `.opencode/tools/*.ts` | Filename → tool name | ✅ Yes |
| **Plugin tool key** | `.opencode/plugins/*.ts` | Key name in `tool: {}` object | ✅ Via plugin load |
| **MCP server** | `opencode.json` → `mcp: {}` | `<server>_<tool>` | ✅ Via MCP protocol |

---

## 10. Hook Chaining & Multi-Plugin Behavior

### ALL hooks fire (NOT last-writer-wins)

When multiple plugins register the same hook event, **ALL** are called in registration order:

```typescript
// From packages/core/src/plugin.ts — triggerFor
for (const item of hooks) {
  if (id !== ID.make("*") && item.id !== id) continue
  const match = item.hooks[name]
  if (!match) continue
  yield* match(event as any).pipe(...)  // Calls EACH matching hook
}
```

### ID-Based Deduplication

| Scenario | Behavior |
|----------|----------|
| Same ID re-registered | Replaces old entry (last-writer-wins) |
| Different IDs, same hook | **BOTH fire** (chaining) |
| One plugin fails | Rolled back, others continue |

### Recommended: Merge into Single Plugin

```typescript
// .opencode/plugins/framework-enforcer/index.ts
import { uc7ksHooks } from './enforcers/uc7ks-enforcer';
import { frameworkHooks } from './enforcers/framework-enforcer';

export default async (ctx) => {
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
};
```

---

## 11. Scope-Before Enforcement Pipeline (5 Checks)

The `scope-before.ts` plugin executes in `tool.execute.before` and implements 5 sequential enforcement checks for each write target path:

```
1. Agent Dispatch Tool Check
   ╰→ Is this tool allowed for this agent per project.config.json?

2. Multi-Path Scope Resolution
   ╰→ Parse shell commands to extract write targets (cp/mv/rm/tee/sed/touch/dd)

3. Per-Path Checks (repeated for each target path):
   ├─ ROUTE-MISMATCH: Agent has authority for this file?
   ├─ UC7-008: KC can only write docs/official_docs/**
   ├─ WRITE-SCOPE: opencode.json permission check
   ├─ R4 CONFIG-READ-ATTEST: Step 0e completed?
   ├─ UC7-001: Cache attestation before write?
   └─ UC7-005: File size ≤ 500KB?
```

### Enforcement Modes

| Mode | scope-before behavior |
|------|----------------------|
| **Advisory** | WARN on violation, never throw |
| **Strict** | Throw Error on violation |
| **Locked** | Throw Error on ALL violations, no waivers |

---

## 12. Key Constraints & Best Practices

### Plugin Development Constraints

| Constraint | Description |
|------------|-------------|
| **Use `export default`** (or `export const` with `: Plugin` type) | `export const` without typing → silent failure |
| **Hooks in same file** | Hook functions must be defined in the same file as the export default |
| **INDEX_FILES only** | Dir-based plugin entry MUST be `index.ts`/`.js`/`.tsx`/`.mjs`/`.cjs` |
| **No deep nested dirs** | Bun relative path resolution fails across subdirectory imports |
| **Flat structure preferred** | All plugin files at same level to avoid import issues |
| **Single plugin recommended** | Multiple plugins cause double hook triggering |
| **Bun cache is unreliable** | Changes may not trigger recompilation → rename file or clear `~/.cache/bun` |

### Before vs After Hook Cheat Sheet

```typescript
// BEFORE HOOK
// Args: output.args
// Use: modify args, throw to block
"tool.execute.before": (input: { tool, sessionID, callID },
                         output: { args }) => {
  output.args.filePath = "/safe/path";   // ✅ Modify args
  if (isBlocked) throw new Error("No");  // ✅ Block execution
}

// AFTER HOOK
// Args: input.args
// Use: read results, log, track state
"tool.execute.after": (input: { tool, sessionID, callID, args },
                        output: { title, output, metadata }) => {
  console.log(input.args.filePath);      // ✅ Read args
  output.metadata = { tracked: true };   // ✅ Add metadata
}

// SHELL ENV HOOK
"shell.env": (input: { cwd },
              output: { env }) => {
  output.env.MY_KEY = "value";           // ✅ Inject env vars
}
```

### Plugin Architecture Recommendation

```
.opencode/plugins/
└── framework-enforcer/
    ├── index.ts                     ← export default, all hooks combined
    └── enforcers/
        ├── uc7ks-enforcer.ts        ← Imported by index.ts
        └── framework-enforcer.ts    ← Imported by index.ts

.opencode/lib/
├── gate-core.ts                     ← Shared logic (outside plugins path)
├── tool-scope.ts                    ← Path resolution utilities
└── uc7ks-utils.ts                   ← UC7KS compliance checks
```

### Bun Cache Refresh Methods (100% Reliable)

```bash
# Method 1: Clear global Bun cache
rm -rf ~/.cache/bun

# Method 2: Rename file (new filename = new cache key)
mv framework-enforcer.ts framework-enforcer-v2.ts
```

### Logging in Plugins

Use `client.app.log()` instead of `console.log` for structured logging:

```typescript
await client.app.log({
  body: {
    service: "my-plugin",
    level: "info",     // debug | info | warn | error
    message: "Plugin initialized",
    extra: { foo: "bar" },
  },
})
```

---

## Summary Reference Card

```
┌──────────────────────────────────────────────────────────────────┐
│              OPENCODE PLUGIN DEV QUICK REFERENCE                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  HOOK PARAMETERS:                                                │
│    tool.execute.before  →  args in output.args                   │
│    tool.execute.after   →  args in input.args                    │
│                                                                   │
│  EXPORT FORMAT:                                                  │
│    ✅ export default async (ctx) => { return { hooks } }         │
│    ✅ export const X: Plugin = async (ctx) => { return { hooks }}│
│    ❌ export const X = async (ctx) => { return { hooks }}       │
│                                                                   │
│  TOOL NAMING:                                                    │
│    MCP tools:    <server>_<tool>     (context7_resolve-library-id)│
│    Custom tools: <filename>          (database.ts → database)    │
│    Multi-export: <file>_<export>     (math.ts + add → math_add) │
│    Plugin tools: Key in tool: {}     (mytool → mytool)          │
│                                                                   │
│  PLUGIN REGISTRATION:                                            │
│    Local dir:    .opencode/plugins/*.ts (auto-discovered)        │
│    npm:          "plugin": ["package-name"]                      │
│                                                                   │
│  CURRENT PROJECT CONFIG:                                         │
│    "plugin": ["./.opencode/plugins/read-track-after.ts",         │
│               "./.opencode/plugins/scope-before.ts"]             │
│    MCP naming:  <server-name>_<tool-name> convention             │
│    Enforcement: strict mode (develop + runtime)                  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```
