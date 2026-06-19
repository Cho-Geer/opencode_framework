# OpenCode Plugins — Official Documentation

**Source**: https://opencode.ai/docs/plugins/
**Fetched**: 2026-06-19
**Tool**: webfetch

## Overview
Plugins allow you to extend OpenCode by hooking into various events and customizing behavior. You can create plugins to add new features, integrate with external services, or modify OpenCode's default behavior.

## Use a Plugin

### From Local Files
Place JavaScript or TypeScript files in the plugin directory:
- `.opencode/plugins/` — Project-level plugins
- `~/.config/opencode/plugins/` — Global plugins

Files in these directories are automatically loaded at startup.

### From npm
Specify npm packages in your config:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-helicone-session", "opencode-wakatime"]
}
```

### How Plugins Are Installed
- **npm plugins**: Installed automatically using Bun at startup. Cached in `~/.cache/opencode/node_modules/`.
- **Local plugins**: Loaded directly from plugin directory.

### Load Order
1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin directory (`~/.config/opencode/plugins/`)
4. Project plugin directory (`.opencode/plugins/`)

## Create a Plugin

### Basic Structure
```javascript
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  console.log("Plugin initialized!")
  return {
    // Hook implementations go here
  }
}
```

### TypeScript Support
```typescript
import type { Plugin } from "@opencode-ai/plugin"
export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return { /* Type-safe hook implementations */ }
}
```

## Events (Complete List)
- **Command**: `command.executed`
- **File**: `file.edited`, `file.watcher.updated`
- **Installation**: `installation.updated`
- **LSP**: `lsp.client.diagnostics`, `lsp.updated`
- **Message**: `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`
- **Permission**: `permission.asked`, `permission.replied`
- **Server**: `server.connected`
- **Session**: `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`
- **Todo**: `todo.updated`
- **Shell**: `shell.env`
- **Tool**: `tool.execute.after`, `tool.execute.before`
- **TUI**: `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`

## Key Documentation Points

### Throwing in tool.execute.before BLOCKS tool execution
```javascript
export const EnvProtection = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("Do not read .env files")
      }
    },
  }
}
```

### Custom Tools via Plugins
```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"
export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: { foo: tool.schema.string() },
        async execute(args, context) {
          return `Hello ${args.foo}`
        },
      }),
    },
  }
}
```

### Compaction Hooks
```typescript
export const CompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(`## Custom Context...`)
    },
  }
}
```
