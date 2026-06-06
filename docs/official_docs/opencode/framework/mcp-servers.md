# OpenCode MCP Servers Documentation (Full)
Source: https://opencode.ai/docs/mcp-servers/
Fetched: 2026-06-05
Tool: webfetch

Note: This replaces the previous partial cache at docs/official_docs/opencode/mcp/mcp-servers-docs.md

## Overview
Add external tools to OpenCode using the Model Context Protocol (MCP). Supports both local and remote servers. Once added, MCP tools are automatically available to the LLM alongside built-in tools.

Caveats: MCP servers add to context. Can add up quickly with many tools. Some MCP servers (like GitHub) add a lot of tokens.

## Enable
Define MCP servers in OpenCode Config under `mcp`:
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "name-of-mcp-server": {
      // ...
      "enabled": true,
    },
  },
}
```

## Overriding Remote Defaults
Organizations can provide default MCP servers via `.well-known/opencode` endpoint. Local config values override remote defaults.

## Local MCP Server
```jsonc
{
  "mcp": {
    "my-local-mcp-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": true,
      "environment": { "MY_ENV_VAR": "my_env_var_value" },
    },
  },
}
```

### Local Options
| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | String | Y | Must be `"local"` |
| `command` | Array | Y | Command and args to start server |
| `environment` | Object | | Environment variables |
| `enabled` | Boolean | | Enable/disable on startup |
| `timeout` | Number | | Tool fetch timeout in ms (default 5000) |

## Remote MCP Server
```json
{
  "mcp": {
    "my-remote-mcp": {
      "type": "remote",
      "url": "https://my-mcp-server.com",
      "enabled": true,
      "headers": { "Authorization": "Bearer MY_API_KEY" }
    }
  }
}
```

### Remote Options
| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | String | Y | Must be `"remote"` |
| `url` | String | Y | URL of the remote MCP server |
| `enabled` | Boolean | | Enable/disable on startup |
| `headers` | Object | | Headers to send with the request |
| `oauth` | Object | | OAuth authentication config |
| `timeout` | Number | | Tool fetch timeout in ms (default 5000) |

## OAuth
OpenCode automatically handles OAuth auth for remote MCP servers:
1. Detects 401 response and initiates OAuth flow
2. Uses Dynamic Client Registration (RFC 7591) if supported
3. Stores tokens securely for future requests

### Pre-registered OAuth
```json
{
  "oauth": {
    "clientId": "{env:MY_MCP_CLIENT_ID}",
    "clientSecret": "{env:MY_MCP_CLIENT_SECRET}",
    "scope": "tools:read tools:execute"
  }
}
```

### Authentication Commands
- `opencode mcp auth <server-name>` — authenticate
- `opencode mcp list` — list servers and status
- `opencode mcp logout <server-name>` — remove credentials
- `opencode mcp debug <server-name>` — debug connection/OAuth flow

### Disabling OAuth
Set `"oauth": false` for API-key based servers.

## Manage MCP Tools

### Global Enable/Disable
```json
{
  "tools": { "my-mcp-foo": false }
}
```

With glob pattern:
```json
{
  "tools": { "my-mcp*": false }
}
```

### Per-Agent Enable/Disable
Disable globally, enable per agent:
```json
{
  "tools": { "my-mcp*": false },
  "agent": {
    "my-agent": { "tools": { "my-mcp*": true } }
  }
}
```

### Tool Naming Convention
MCP tools follow pattern: `<server-name>_<tool-name>`
(e.g., `context7_resolve-library-id`)

### Glob Patterns
- `*` matches zero or more characters
- `?` matches exactly one character
- `"mymcpservername_*": false` disables all tools for a server

## Examples
- Sentry MCP server
- Context7 MCP server (with API key support)
- Grep by Vercel MCP server
