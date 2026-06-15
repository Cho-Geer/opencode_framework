# Bun Overview and Installation

**Source**: https://bun.sh/docs  
**Domain**: infrastructure  
**Retrieved**: 2026-06-14  
**TTL**: 90 days

---

## What is Bun?

Bun is an **all-in-one JavaScript runtime & toolkit** designed for speed. It replaces or complements Node.js by providing:

| Component | Description | Replaces |
|-----------|-------------|----------|
| **Runtime** | JavaScript/TypeScript execution engine using JavaScriptCore (WebKit) | Node.js |
| **Bundler** | Native bundler for JavaScript and TypeScript | Webpack, esbuild, Rollup |
| **Test Runner** | Jest-compatible test runner with native TypeScript support | Jest, Vitest |
| **Package Manager** | Drop-in replacement for npm/yarn/pnpm, significantly faster | npm, yarn, pnpm |
| **Transpiler** | Built-in TypeScript and JSX transpilation | tsc, babel |

### Key Features

- **Speed**: Built in Zig, using JavaScriptCore (Safari's engine) instead of V8. Package installs are 25× faster than npm in benchmarks.
- **TypeScript first-class**: Runs `.ts` and `.tsx` files natively without a separate build step.
- **Node.js compatibility**: Implements the Node.js module resolution algorithm (`node_modules`) and most core Node.js APIs (`fs`, `path`, `http`, etc.).
- **Unified toolchain**: One binary (`bun`) replaces 10+ tools in the JavaScript ecosystem.
- **Web APIs**: Implements standard Web APIs like `fetch`, `WebSocket`, `ReadableStream`, `Request`, `Response`, `Headers`, `URL`, `crypto`, etc.

## Installation

### Linux and macOS

```bash
# Install Bun (recommended)
curl -fsSL https://bun.sh/install | bash

# Or via npm
npm install -g bun

# Or via Homebrew (macOS/Linux)
brew tap oven-sh/bun
brew install bun
```

### Windows

Bun requires Windows Subsystem for Linux (WSL 2):

```bash
# Inside WSL 2
curl -fsSL https://bun.sh/install | bash
```

### Verify Installation

```bash
bun --version
# Example output: 1.2.0
```

## Quick Start

```bash
# Create a new project
bun init

# Run a TypeScript file directly
bun run index.ts

# Install dependencies (faster than npm)
bun install

# Run scripts from package.json
bun run dev

# Run tests
bun test
```

## Bun vs Node.js

| Feature | Bun | Node.js |
|---------|-----|---------|
| Engine | JavaScriptCore | V8 |
| TypeScript | Native (no config needed) | Requires ts-node or build step |
| Bundler | Built-in | External (webpack, esbuild) |
| Test Runner | Built-in (Jest-compatible) | External (Jest, Vitest) |
| Package Manager | Built-in (npm-compatible) | npm (built-in) |
| JSX/TSX | Native support | Requires build step |
| File Watching | Built-in (`--watch`) | `--watch` (Node 18+) |
| .env loading | Automatic | Manual (dotenv) |

## Bun Configuration

Bun can be configured via `bunfig.toml` in the project root:

```toml
[install]
# Package manager configuration
registry = "https://registry.npmjs.org/"
exact = false

[test]
# Test runner configuration
coverage = true
preload = ["./test-setup.ts"]
```

## Limitations

- **Not a complete drop-in for Node.js**: Some Node.js built-in modules and C++ addons are not supported.
- **Windows support**: Production-ready on Linux and macOS; Windows requires WSL 2.
- **Ecosystem**: Some npm packages that depend on Node.js internals may have compatibility issues.

## Use Cases

- **Development**: Faster installs, native TypeScript, built-in test runner
- **CLI tools**: Build standalone binaries with `bun build --compile`
- **Server-side applications**: `Bun.serve()` for high-performance HTTP servers
- **Scripting**: Replace shell scripts with TypeScript/JavaScript
