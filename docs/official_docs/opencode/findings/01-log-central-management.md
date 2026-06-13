# OpenCode Log Central Management — Implementation Guide

**Date**: 2026-06-11
**Source**: Official OpenCode docs (opencode.ai) + Source code analysis
**Cache sources**: plugins.md, findings-summary.md, plugin-debugging-precautions.md, plugin-programming-conventions.md

---

## Overview

OpenCode supports **three distinct logging mechanisms**, each designed for a specific subsystem. The choice depends on whether you are writing an MCP tool, a plugin, a custom tool, or an agent.

---

## 1. MCP Tool Logging

### Recommended: `process.stderr.write()`

MCP servers communicate with the host via **stdout for JSON-RPC** and **stderr for diagnostics**. The MCP SDK's `StdioServerTransport` uses stdin/stdout for the protocol. Therefore:

```typescript
// ✅ CORRECT for MCP tools — writes to stderr, visible in OpenCode debug logs
process.stderr.write("[my-mcp-server] started (SDK)\n");
process.stderr.write(`Processing request: ${requestId}\n`);

// ❌ WRONG for MCP tools — pollutes stdout, breaks JSON-RPC protocol
console.log("This will CORRUPT the MCP protocol!");
```

### Pattern from canonical reference (compliance-gate.ts)

```typescript
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[compliance-gate] started (SDK)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
```

### CJS vs ESM Considerations

| Aspect | CJS (`require()`) | ESM (`import`) |
|--------|-------------------|----------------|
| `console.log` | Pollutes stdout ❌ | Pollutes stdout ❌ |
| `process.stderr.write()` | ✅ Works | ✅ Works |
| `module.exports` for testability | ✅ Supported | ❌ Not available |
| Recommendation | **Preferred** for MCP servers | Only if required by other deps |

**Key constraint**: Do NOT set `"type": "module"` in package.json for MCP server scope — it breaks `require()`.

---

## 2. Plugin Logging

### Recommended: `client.app.log()` (Structured Logging)

The OpenCode SDK provides a structured logging API for plugins:

```typescript
export const MyPlugin = async ({ client }) => {
  await client.app.log({
    body: {
      service: "my-plugin",   // ← Plugin/service identifier
      level: "info",           // ← debug | info | warn | error
      message: "Plugin initialized",  // ← Human-readable message
      extra: { foo: "bar" },   // ← Arbitrary structured data
    },
  });
};
```

### Why NOT console.log for plugins

Plugins run **inside the OpenCode process** where stdout is redirected or captured by the framework. `console.log` output is invisible:

```typescript
// ❌ INVISIBLE in plugin context — stdout is captured by OpenCode
console.log("Plugin debug message");

// ✅ VISIBLE — use the SDK logging API
await client.app.log({
  body: { service: "my-plugin", level: "info", message: "Plugin debug" },
});
```

### Available Log Levels

| Level | Usage |
|-------|-------|
| `debug` | Detailed diagnostic information |
| `info` | Normal operational messages |
| `warn` | Warning conditions |
| `error` | Error conditions requiring attention |

---

## 3. Plugin Debug Logging (Diagnostic)

### File-based Logging (for development/debugging)

When `client.app.log()` is insufficient for debugging (e.g., plugin fails to load), use file-based logging:

```typescript
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

function logDebug(message: string, data?: any) {
  const logDir = join(process.cwd(), '.task_temp/_logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}\n`;
  appendFileSync(join(logDir, 'plugin-debug.log'), logLine);
}

// Usage:
export const MyPlugin = async () => {
  logDebug('Plugin initializing');
  return {
    'tool.execute.before': async (input, output) => {
      logDebug('before hook fired', { tool: input.tool });
    },
  };
};
```

### Best Practice: Log Directory

Use `.task_temp/_logs/` as the standard log directory. This path is gitignored and does not pollute the project.

---

## 4. Agent Hook Debugging with File Logs

For `tool.execute.before/after` hook debugging, use call-tracking to detect duplicate invocations:

```typescript
let hookCallCount = 0;

'tool.execute.before': async (input, output) => {
  hookCallCount++;
  appendFileSync('.task_temp/_logs/hook-trace.log',
    `[${new Date().toISOString()}] hook-#${hookCallCount} | ` +
    `tool=${input.tool} | session=${input.sessionID} | call=${input.callID}\n`
  );
}
```

---

## 5. Recommended Logging Architecture

| Subsystem | Method | Purpose |
|-----------|--------|---------|
| **MCP Tools** | `process.stderr.write()` | Protocol-safe diagnostics |
| **Plugins** | `client.app.log()` | Structured operational logging |
| **Plugin Debug** | `appendFileSync()` to `.task_temp/_logs/` | Development troubleshooting |
| **Custom Tools** | Return value from `execute()` | Result to LLM |
| **Agent Context** | Hook-trace in `.task_temp/_logs/` | Duplicate detection |

### Decision Flow

```
Are you writing an MCP server?
  → YES → process.stderr.write()
  → Are you writing a plugin?
    → YES → client.app.log() for production, file-log for debug
    → Are you writing a custom tool?
      → YES → return value from execute(), no side-channel logging
      → Agent hook debugging?
        → YES → file-based logging with callID tracking
```

---

## 6. Key Takeaways

1. **MCP tools**: Always use `process.stderr.write()` — never `console.log()`
2. **Plugins**: Use `client.app.log({ body: { service, level, message, extra } })` — never `console.log()`
3. **Debugging**: File-based logging with `appendFileSync` to `.task_temp/_logs/`
4. **CJS preferred** for MCP servers: `require()` + `module.exports` guard pattern
5. **No `"type": "module"`** in MCP server package.json — keeps CJS semantics
6. **Hook tracing**: Use callID-based dedup for `tool.execute.before/after` debugging
