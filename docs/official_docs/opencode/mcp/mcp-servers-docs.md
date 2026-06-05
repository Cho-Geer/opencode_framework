# OpenCode MCP Servers Documentation
Source: https://opencode.ai/docs/mcp-servers/
Fetched: 2026-06-05

## Custom MCP Tool Construction

### Local MCP Server
```json
{
  "mcp": {
    "my-mcp-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": true,
      "environment": { "MY_ENV_VAR": "value" },
      "timeout": 5000
    }
  }
}
```
- `type`: Must be "local"
- `command`: Array of command + args to start the MCP server
- `environment`: Optional env vars
- `timeout`: Tool fetch timeout in ms (default 5000)

### Remote MCP Server
```json
{
  "mcp": {
    "my-remote-mcp": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "enabled": true,
      "headers": { "Authorization": "Bearer API_KEY" },
      "oauth": {
        "clientId": "{env:CLIENT_ID}",
        "clientSecret": "{env:CLIENT_SECRET}",
        "scope": "tools:read"
      }
    }
  }
}
```

### Per-Agent Enable/Disable
```json
{
  "tools": { "my-mcp*": false },
  "agent": {
    "my-agent": { "tools": { "my-mcp*": true } }
  }
}
```
Glob patterns: `*` matches any chars, `?` matches one char.

### Tool Naming
MCP tools follow pattern: `<server-name>_<tool-name>` (e.g., `context7_resolve-library-id`)
