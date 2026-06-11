# OpenCode Intro — 文档导航与最佳实践入口
Source: https://opencode.ai/docs/
Fetched: 2026-06-06
Tool: webfetch

Get started with OpenCode.

**OpenCode** is an open source AI coding agent. It's available as a terminal-based interface, desktop app, or IDE extension.

Let's get started.

---

#### Prerequisites

To use OpenCode in your terminal, you'll need:

1.  A modern terminal emulator like:
    -   [WezTerm](https://wezterm.org), cross-platform
    -   [Alacritty](https://alacritty.org), cross-platform
    -   [Ghostty](https://ghostty.org), Linux and macOS
    -   [Kitty](https://sw.kovidgoyal.net/kitty/), Linux and macOS
2.  API keys for the LLM providers you want to use.

---

## Install

The easiest way to install OpenCode is through the install script.

```
curl -fsSL https://opencode.ai/install | bash
```

You can also install it with the following commands:

-   **Using Node.js**: `npm install -g opencode-ai`
-   **Using Bun**: `bun install -g opencode-ai`
-   **Using pnpm**: `pnpm install -g opencode-ai`
-   **Using Yarn**: `yarn global add opencode-ai`
-   **Using Homebrew**: `brew install anomalyco/tap/opencode`
-   **Arch Linux**: `sudo pacman -S opencode` or `paru -S opencode-bin`
-   **Using Chocolatey**: `choco install opencode`
-   **Using Scoop**: `scoop install opencode`
-   **Using Mise**: `mise use -g github:anomalyco/opencode`
-   **Using Docker**: `docker run -it --rm ghcr.io/anomalyco/opencode`

#### Windows

For the best experience on Windows, we recommend using Windows Subsystem for Linux (WSL).

---

## Configure

With OpenCode you can use any LLM provider by configuring their API keys.

If you are new to using LLM providers, we recommend using OpenCode Zen. It's a curated list of models that have been tested and verified by the OpenCode team.

1.  Run the `/connect` command in the TUI, select opencode, and head to opencode.ai/auth.
    ```
    /connect
    ```
2.  Sign in, add your billing details, and copy your API key.
3.  Paste your API key.

Alternatively, you can select one of the other providers.

---

## Initialize

Navigate to a project that you want to work on.

```
cd /path/to/project
```

And run OpenCode.

```
opencode
```

Next, initialize OpenCode for the project by running the following command.

```
/init
```

This will get OpenCode to analyze your project and create an `AGENTS.md` file in the project root.

Tip: You should commit your project's `AGENTS.md` file to Git.

---

## Usage

You are now ready to use OpenCode to work on your project.

### Ask questions

You can ask OpenCode to explain the codebase to you.

Tip: Use the `@` key to fuzzy search for files in the project.

```
How is authentication handled in @packages/functions/src/api/index.ts
```

### Add features

1.  **Create a plan** — Switch to Plan mode using the **Tab** key.
2.  **Iterate on the plan** — Give it feedback or add more details.
3.  **Build the feature** — Switch back to Build mode and ask it to make changes.

### Make changes

For more straightforward changes:

```
We need to add authentication to the /settings route.
```

### Undo changes

Use `/undo` to revert changes and `/redo` to redo.

---

## Share

The conversations that you have with OpenCode can be shared with your team.

```
/share
```

This will create a link to the current conversation and copy it to your clipboard.

Note: Conversations are not shared by default.

---

## Customize

To make it your own, we recommend picking a theme, customizing the keybinds, configuring code formatters, creating custom commands, or playing around with the OpenCode config.
