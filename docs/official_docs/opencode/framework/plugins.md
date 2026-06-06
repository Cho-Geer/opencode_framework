# OpenCode Plugins Documentation
Source: https://opencode.ai/docs/plugins/
Fetched: 2026-06-05
Tool: webfetch

## Overview
Plugins allow you to extend OpenCode by hooking into various events and customizing behavior. You can create plugins to add new features, integrate with external services, or modify OpenCode's default behavior.

## Use a Plugin

### From Local Files
Place JavaScript or TypeScript files in the plugin directory:
- `.opencode/plugins/` - Project-level plugins
- `~/.config/opencode/plugins/` - Global plugins

Files in these directories are automatically loaded at startup.

### From npm
Specify npm packages in your config:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-helicone-session", "opencode-wakatime", "@my-org/custom-plugin"]
}
```

Both regular and scoped npm packages are supported.

### How Plugins Are Installed
- **npm plugins**: Installed automatically using Bun at startup. Packages cached in `~/.cache/opencode/node_modules/`.
- **Local plugins**: Loaded directly from plugin directory. To use external packages, create `package.json` within config directory or publish to npm.

### Load Order
1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin directory (`~/.config/opencode/plugins/`)
4. Project plugin directory (`.opencode/plugins/`)

Duplicate npm packages loaded once. Local + npm with similar names loaded separately.

## Create a Plugin

A plugin is a JavaScript/TypeScript module that exports one or more plugin functions. Each function receives a context object and returns a hooks object.

### Dependencies
Local plugins can use external npm packages. Add a `package.json` to your config directory:
```json
{
  "dependencies": { "shescape": "^2.1.0" }
}
```
OpenCode runs `bun install` at startup.

### Basic Structure
```javascript
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  console.log("Plugin initialized!")
  return {
    // Hook implementations go here
  }
}
```

The plugin function receives:
- `project`: The current project information
- `directory`: The current working directory
- `worktree`: The git worktree path
- `client`: An OpenCode SDK client for interacting with the AI
- `$`: Bun's shell API for executing commands

### TypeScript Support
```typescript
import type { Plugin } from "@opencode-ai/plugin"
export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return { /* Type-safe hook implementations */ }
}
```

## Events (Complete List)

### Command Events
- `command.executed`

### File Events
- `file.edited`
- `file.watcher.updated`

### Installation Events
- `installation.updated`

### LSP Events
- `lsp.client.diagnostics`
- `lsp.updated`

### Message Events
- `message.part.removed`
- `message.part.updated`
- `message.removed`
- `message.updated`

### Permission Events
- `permission.asked`
- `permission.replied`

### Server Events
- `server.connected`

### Session Events
- `session.created`
- `session.compacted`
- `session.deleted`
- `session.diff`
- `session.error`
- `session.idle`
- `session.status`
- `session.updated`

### Todo Events
- `todo.updated`

### Shell Events
- `shell.env`

### Tool Events
- `tool.execute.after`
- `tool.execute.before`

### TUI Events
- `tui.prompt.append`
- `tui.command.execute`
- `tui.toast.show`

## Examples

### Send Notifications
```javascript
export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Session completed!" with title "opencode"'`
      }
    },
  }
}
```

### .env Protection (KEY: Throwing to BLOCK tool execution)
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
**CRITICAL FINDING**: Throwing an error in `tool.execute.before` BLOCKS tool execution entirely. The tool will not execute.

### Inject Environment Variables
```javascript
export const InjectEnvPlugin = async () => {
  return {
    "shell.env": async (input, output) => {
      output.env.MY_API_KEY = "secret"
      output.env.PROJECT_ROOT = input.cwd
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
          const { directory, worktree } = context
          return `Hello ${args.foo} from ${directory} (worktree: ${worktree})`
        },
      }),
    },
  }
}
```

If a plugin tool uses the same name as a built-in tool, the plugin tool takes precedence.

### Logging
```javascript
await client.app.log({
  body: {
    service: "my-plugin",
    level: "info",
    message: "Plugin initialized",
    extra: { foo: "bar" },
  },
})
```
Levels: `debug`, `info`, `warn`, `error`.

### Compaction Hooks
```typescript
export const CompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(`## Custom Context...`)
      // OR replace entirely:
      // output.prompt = `Custom compaction prompt...`
    },
  }
}
```
When `output.prompt` is set, it completely replaces the default compaction prompt.
