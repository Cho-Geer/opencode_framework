# OpenCode Custom Tools Documentation
Source: https://opencode.ai/docs/custom-tools/
Fetched: 2026-06-05
Tool: webfetch

## Overview
Custom tools are functions you create that the LLM can call during conversations. They work alongside OpenCode's built-in tools (`read`, `write`, `bash`, etc.).

## Creating a Tool
Tools are defined as TypeScript or JavaScript files. The tool definition can invoke scripts written in **any language**.

### Location
- Locally: `.opencode/tools/` directory of your project
- Globally: `~/.config/opencode/tools/`

### Structure (Single Tool Per File)
The easiest way is using the `tool()` helper:
```typescript
import { tool } from "@opencode-ai/plugin"
export default tool({
  description: "Query the project database",
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
  },
  async execute(args) {
    return `Executed query: ${args.query}`
  },
})
```
The **filename** becomes the **tool name**.

### Multiple Tools Per File
Each export becomes a separate tool with name `<filename>_<exportname>`:
```typescript
import { tool } from "@opencode-ai/plugin"
export const add = tool({
  description: "Add two numbers",
  args: { a: tool.schema.number().describe("First number"), b: tool.schema.number().describe("Second number") },
  async execute(args) { return (args.a + args.b).toString() },
})
export const multiply = tool({ /* ... */ })
```
Creates: `math_add` and `math_multiply`.

### Name Collisions
Custom tools are keyed by tool name. If same name as built-in, custom tool takes precedence.
```typescript
export default tool({
  description: "Restricted bash wrapper",
  args: { command: tool.schema.string() },
  async execute(args) { return `blocked: ${args.command}` },
})
```
Prefer unique names unless intentionally replacing a built-in.

### Arguments (Zod Schema)
```typescript
args: {
  query: tool.schema.string().describe("SQL query to execute")
}
```
`tool.schema` is just Zod. Can also import Zod directly.

### Context
Tools receive context about the current session:
```typescript
async execute(args, context) {
  const { agent, sessionID, messageID, directory, worktree } = context
  return `Agent: ${agent}, Session: ${sessionID}, Message: ${messageID}`
}
```

### Write a Tool in Python
Can invoke any language:
```typescript
import { tool } from "@opencode-ai/plugin"
import path from "path"
export default tool({
  description: "Add two numbers using Python",
  args: { a: tool.schema.number(), b: tool.schema.number() },
  async execute(args, context) {
    const script = path.join(context.worktree, ".opencode/tools/add.py")
    const result = await Bun.$`python3 ${script} ${args.a} ${args.b}`.text()
    return result.trim()
  },
})
```
