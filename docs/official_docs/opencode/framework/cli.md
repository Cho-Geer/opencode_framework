# OpenCode CLI — 命令行参考
Source: https://opencode.ai/docs/cli/
Fetched: 2026-06-06
Tool: webfetch

OpenCode CLI options and commands.

The OpenCode CLI by default starts the TUI when run without any arguments.

```
opencode
```

But it also accepts commands as documented on this page. This allows you to interact with OpenCode programmatically.

```
opencode run "Explain how closures work in JavaScript"
```

---

### tui

Start the OpenCode terminal user interface.

```
opencode [project]
```

#### Flags

Flag | Short | Description
--- | --- | ---
`--continue` | `-c` | Continue the last session
`--session` | `-s` | Session ID to continue
`--fork` | | Fork the session when continuing (use with `--continue` or `--session`)
`--prompt` | | Prompt to use
`--model` | `-m` | Model to use in the form of provider/model
`--agent` | | Agent to use
`--port` | | Port to listen on
`--hostname` | | Hostname to listen on
`--mdns` | | Enable mDNS discovery
`--mdns-domain` | | Custom mDNS domain name
`--cors` | | Additional browser origin(s) to allow CORS

---

## Commands

The OpenCode CLI also has the following commands.

---

### agent

Manage agents for OpenCode.

```
opencode agent [command]
```

#### create

Create a new agent with custom configuration.

```
opencode agent create
```

This command will guide you through creating a new agent with a custom system prompt and permission configuration.

#### Flags

Flag | Short | Description
--- | --- | ---
`--path` | | Directory to write the agent file to
`--description` | | What the agent should do
`--mode` | | Agent mode: `all`, `primary`, or `subagent`
`--permissions` | | Comma-separated list of permissions to allow (default: all). Available: `bash`, `read`, `edit`, `glob`, `grep`, `webfetch`, `task`, `todowrite`, `websearch`, `lsp`, `skill`. Anything omitted is denied. Alias: `--tools`
`--model` | `-m` | Model to use, in `provider/model` format

#### list

List all available agents.

```
opencode agent list
```

---

### attach

Attach a terminal to an already running OpenCode backend server started via `serve` or `web` commands.

```
opencode attach [url]
```

#### Flags

Flag | Short | Description
--- | --- | ---
`--dir` | | Working directory to start TUI in
`--continue` | `-c` | Continue the last session
`--session` | `-s` | Session ID to continue
`--fork` | | Fork the session when continuing
`--password` | `-p` | Basic auth password (defaults to `OPENCODE_SERVER_PASSWORD`)
`--username` | `-u` | Basic auth username (defaults to `OPENCODE_SERVER_USERNAME` or `opencode`)

---

### auth

Command to manage credentials and login for providers.

```
opencode auth [command]
```

#### login

```
opencode auth login
```

##### Flags

Flag | Short | Description
--- | --- | ---
`--provider` | `-p` | Provider ID or name to log in to
`--method` | `-m` | Login method label to use, skipping method selection

#### list

```
opencode auth list
```

Or: `opencode auth ls`

#### logout

```
opencode auth logout
```

---

### github

Manage the GitHub agent for repository automation.

```
opencode github [command]
```

#### install

Install the GitHub agent in your repository.

```
opencode github install
```

#### run

Run the GitHub agent. This is typically used in GitHub Actions.

```
opencode github run
```

##### Flags

Flag | Description
--- | ---
`--event` | GitHub mock event to run the agent for
`--token` | GitHub personal access token

---

### mcp

Manage Model Context Protocol servers.

```
opencode mcp [command]
```

#### add

Add an MCP server to your configuration.

```
opencode mcp add
```

#### list

List all configured MCP servers and their connection status.

```
opencode mcp list
```

Or: `opencode mcp ls`

#### auth

Authenticate with an OAuth-enabled MCP server.

```
opencode mcp auth [name]
```

Also: `opencode mcp auth list` / `opencode mcp auth ls`

#### logout

Remove OAuth credentials for an MCP server.

```
opencode mcp logout [name]
```

#### debug

Debug OAuth connection issues for an MCP server.

```
opencode mcp debug <name>
```

---

### models

List all available models from configured providers.

```
opencode models [provider]
```

#### Flags

Flag | Description
--- | ---
`--refresh` | Refresh the models cache from models.dev
`--verbose` | Use more verbose model output (includes metadata like costs)

---

### run

Run opencode in non-interactive mode by passing a prompt directly.

```
opencode run [message..]
```

#### Flags

Flag | Short | Description
--- | --- | ---
`--command` | | The command to run, use message for args
`--continue` | `-c` | Continue the last session
`--session` | `-s` | Session ID to continue
`--fork` | | Fork the session when continuing
`--share` | | Share the session
`--model` | `-m` | Model to use in the form of provider/model
`--agent` | | Agent to use
`--file` | `-f` | File(s) to attach to message
`--format` | | Format: default (formatted) or json (raw JSON events)
`--title` | | Title for the session
`--attach` | | Attach to a running opencode server
`--password` | `-p` | Basic auth password
`--username` | `-u` | Basic auth username
`--dir` | | Directory to run in
`--port` | | Port for the local server
`--variant` | | Model variant (provider-specific reasoning effort)
`--thinking` | | Show thinking blocks
`--dangerously-skip-permissions` | | Auto-approve permissions

---

### serve

Start a headless OpenCode server for API access.

```
opencode serve
```

#### Flags

Flag | Description
--- | ---
`--port` | Port to listen on
`--hostname` | Hostname to listen on
`--mdns` | Enable mDNS discovery
`--mdns-domain` | Custom mDNS domain name
`--cors` | Additional browser origin(s) to allow CORS

---

### session

Manage OpenCode sessions.

```
opencode session [command]
```

#### list

List all OpenCode sessions.

```
opencode session list
```

##### Flags

Flag | Short | Description
--- | --- | ---
`--max-count` | `-n` | Limit to N most recent sessions
`--format` | | Output format: table or json (table)

#### delete

Delete an OpenCode session.

```
opencode session delete <sessionID>
```

---

### stats

Show token usage and cost statistics for your OpenCode sessions.

```
opencode stats
```

#### Flags

Flag | Description
--- | ---
`--days` | Show stats for the last N days (all time)
`--tools` | Number of tools to show (all)
`--models` | Show model usage breakdown (hidden by default)
`--project` | Filter by project

---

### export

Export session data as JSON.

```
opencode export [sessionID]
```

#### Flags

Flag | Description
--- | ---
`--sanitize` | Redact sensitive transcript/file data

---

### import

Import session data from a JSON file or OpenCode share URL.

```
opencode import <file>
```

---

### web

Start a headless OpenCode server with a web interface.

```
opencode web
```

#### Flags

Flag | Description
--- | ---
`--port` | Port to listen on
`--hostname` | Hostname to listen on
`--mdns` | Enable mDNS discovery
`--mdns-domain` | Custom mDNS domain name
`--cors` | Additional browser origin(s) to allow CORS

---

### acp

Start an ACP (Agent Client Protocol) server.

```
opencode acp
```

#### Flags

Flag | Description
--- | ---
`--cwd` | Working directory
`--port` | Port to listen on
`--hostname` | Hostname to listen on
`--mdns` | Enable mDNS discovery
`--mdns-domain` | Custom mDNS domain name
`--cors` | Additional browser origin(s) to allow CORS

---

### plugin

Install a plugin and update your config.

```
opencode plugin <module>
```

Or: `opencode plug <module>`

#### Flags

Flag | Short | Description
--- | --- | ---
`--global` | `-g` | Install in global config
`--force` | `-f` | Replace existing plugin version

---

### pr

Fetch and checkout a GitHub PR branch, then run OpenCode.

```
opencode pr <number>
```

---

### db

Database tools.

```
opencode db [query]
```

#### Flags

Flag | Description
--- | ---
`--format` | Output format: `json` or `tsv`

#### path

Print the database path.

```
opencode db path
```

---

### debug

Debugging and troubleshooting tools.

```
opencode debug [command]
```

---

### uninstall

Uninstall OpenCode and remove all related files.

```
opencode uninstall
```

#### Flags

Flag | Short | Description
--- | --- | ---
`--keep-config` | `-c` | Keep configuration files
`--keep-data` | `-d` | Keep session data and snapshots
`--dry-run` | | Show what would be removed without removing
`--force` | `-f` | Skip confirmation prompts

---

### upgrade

Updates opencode to the latest version or a specific version.

```
opencode upgrade [target]
```

#### Flags

Flag | Short | Description
--- | --- | ---
`--method` | `-m` | The installation method that was used; curl, npm, pnpm, bun, brew

---

## Global Flags

Flag | Short | Description
--- | --- | ---
`--help` | `-h` | Display help
`--version` | `-v` | Print version number
`--print-logs` | | Print logs to stderr
`--log-level` | | Log level (DEBUG, INFO, WARN, ERROR)
`--pure` | | Run without external plugins

---

## Environment variables

Variable | Type | Description
--- | --- | ---
`OPENCODE_AUTO_SHARE` | boolean | Automatically share sessions
`OPENCODE_GIT_BASH_PATH` | string | Path to Git Bash executable on Windows
`OPENCODE_CONFIG` | string | Path to config file
`OPENCODE_TUI_CONFIG` | string | Path to TUI config file
`OPENCODE_CONFIG_DIR` | string | Path to config directory
`OPENCODE_CONFIG_CONTENT` | string | Inline json config content
`OPENCODE_DISABLE_AUTOUPDATE` | boolean | Disable automatic update checks
`OPENCODE_DISABLE_PRUNE` | boolean | Disable pruning of old data
`OPENCODE_DISABLE_TERMINAL_TITLE` | boolean | Disable automatic terminal title updates
`OPENCODE_PERMISSION` | string | Inlined json permissions config
`OPENCODE_DISABLE_DEFAULT_PLUGINS` | boolean | Disable default plugins
`OPENCODE_DISABLE_LSP_DOWNLOAD` | boolean | Disable automatic LSP server downloads
`OPENCODE_ENABLE_EXPERIMENTAL_MODELS` | boolean | Enable experimental models
`OPENCODE_DISABLE_AUTOCOMPACT` | boolean | Disable automatic context compaction
`OPENCODE_DISABLE_CLAUDE_CODE` | boolean | Disable reading from `.claude`
`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` | boolean | Disable reading `~/.claude/CLAUDE.md`
`OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` | boolean | Disable loading `.claude/skills`
`OPENCODE_DISABLE_MODELS_FETCH` | boolean | Disable fetching models from remote sources
`OPENCODE_DISABLE_MOUSE` | boolean | Disable mouse capture in the TUI
`OPENCODE_FAKE_VCS` | string | Fake VCS provider for testing purposes
`OPENCODE_CLIENT` | string | Client identifier (defaults to `cli`)
`OPENCODE_ENABLE_EXA` | boolean | Enable Exa web search tools
`OPENCODE_SERVER_PASSWORD` | string | Enable basic auth for `serve`/`web`
`OPENCODE_SERVER_USERNAME` | string | Override basic auth username (default `opencode`)
`OPENCODE_MODELS_URL` | string | Custom URL for fetching models configuration

### Experimental

Variable | Type | Description
--- | --- | ---
`OPENCODE_EXPERIMENTAL` | boolean | Enable the experimental umbrella flag
`OPENCODE_EXPERIMENTAL_ICON_DISCOVERY` | boolean | Enable icon discovery
`OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT` | boolean | Disable copy on select in TUI
`OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | number | Default timeout for bash commands in ms
`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | number | Max output tokens for LLM responses
`OPENCODE_EXPERIMENTAL_FILEWATCHER` | boolean | Enable file watcher for entire dir
`OPENCODE_EXPERIMENTAL_OXFMT` | boolean | Enable oxfmt formatter
`OPENCODE_EXPERIMENTAL_LSP_TOOL` | boolean | Enable experimental LSP tool
`OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` | boolean | Disable file watcher
`OPENCODE_EXPERIMENTAL_EXA` | boolean | Enable experimental Exa features
`OPENCODE_EXPERIMENTAL_LSP_TY` | boolean | Enable TY LSP for python files
`OPENCODE_EXPERIMENTAL_PLAN_MODE` | boolean | Enable plan mode
`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` | boolean | Enable background subagent tasks
`OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` | boolean | Enable experimental event system
`OPENCODE_EXPERIMENTAL_NATIVE_LLM` | boolean | Enable native LLM request path
`OPENCODE_EXPERIMENTAL_PARALLEL` | boolean | Enable parallel web search execution
`OPENCODE_EXPERIMENTAL_SCOUT` | boolean | Enable Scout subagent
`OPENCODE_EXPERIMENTAL_WORKSPACES` | boolean | Enable workspace support
