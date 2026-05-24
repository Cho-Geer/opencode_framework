# .qoder/ — Qoder Platform Integration Layer

This directory contains the Qoder-platform-specific translation of the three-layer eight-role governance framework.

## Structure

```
.qoder/
├── config/
│   └── qpv-config.json          # Project-specific QPV configuration
├── scripts/
│   ├── command-tools/
│   │   └── dispatch-subagent.js # Sub-agent dispatcher with --platform qoder support
│   └── dag-to-qoder-tasks.js    # Task.DAG.json → Qoder Task board bridge
├── skills/
│   ├── execution-preflight-check/skill.md
│   ├── new-asset-integrator/skill.md
│   ├── multi-agent-orchestration/skill.md
│   └── page-verification/skill.md
├── rules/
│   └── rule_detail/
│       └── page-verification-standard.md
├── AGENTS-QODER-EXTENSION.md    # Qoder platform addendum to AGENTS.md
├── subagent-preamble.md         # P0 protocol for all Qoder sub-agents
├── mcp-server.js                # Unified MCP server (bridges to .qoder/scripts/mcp-tools/)
├── package.json                 # MCP server dependencies
└── settings.json                # Permission configuration
```

## Relationship to .opencode/

The `.qoder/` framework is fully self-contained and operationally independent from `.opencode/`.
It includes its own scripts, state, skills, and configuration for the Qoder platform.

## MCP Server Setup

Register in Qoder settings:
```json
{
  "mcpServers": {
    "qoder-framework": {
      "command": "node",
      "args": [".qoder/mcp-server.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

## QPV Configuration

Edit `.qoder/config/qpv-config.json` to adapt the Page Verification Protocol to your project:
- `source_paths`: which directories trigger QPV
- `design_system`: your project's design tokens
- `endpoint_page_map`: backend endpoints → frontend pages
- `thresholds`: performance and contrast thresholds
