# MCP Bootstrap & Setup Guide

> This document records the guided configuration process, known issues, and solutions for MCP (Model Context Protocol) tools under the `.opencode/` directory.
> Last updated: 2026-05-23

---

## 1. Overview

This project uses 4 MCP tool scripts under `.opencode/scripts/mcp-tools/`, built on `@modelcontextprotocol/sdk` (v1.29.0):

| MCP Tool Script | Purpose |
|-----------------|---------|
| `compliance-gate.js` | Compliance gate check/confirm/complete |
| `code-quality-gate.js` | Code quality gate (ESLint, tsc, depcruise, prettier) |
| `eslint-audit.js` | ESLint mock audit |
| `keystone-validate.js` | Keystone contract state hash validation |

## 2. Install Dependencies

```bash
cd .opencode
npm install
```

This will install the dependencies declared in `.opencode/package.json`:
- `@modelcontextprotocol/sdk@^1.8.0` → resolved to `1.29.0`

## 3. Known Issue: Root-Level require() Failure

### Problem

`require('@modelcontextprotocol/sdk')` (root-level import) with `@modelcontextprotocol/sdk@1.29.0` fails:

```
Error: Cannot find module '.../dist/cjs/index.js'
  code: 'MODULE_NOT_FOUND'
```

### Root Cause

The upstream npm package `@modelcontextprotocol/sdk@1.29.0` has a **packaging defect**:

- The `exports` field in `package.json` points to `dist/cjs/index.js` and `dist/esm/index.js`
- But the actual `dist/` directory does not contain an `index.js` entry file
- `dist/cjs/` contains subdirectories (`client/`, `server/`, `shared/`, etc.) and standalone files (`types.js`, `inMemory.js`, etc.), but no root-level barrel file

This is an **upstream npm registry issue** that consumers cannot fix locally.
See: [WAIVE-RVW2-MCP-DEPS.md](.task_temp/_global/WAIVE-RVW2-MCP-DEPS.md)

### Solution: Sub-Path Imports

**All MCP tool scripts must use sub-path imports**, not root-level `require('@modelcontextprotocol/sdk')`.

#### ✅ Correct Usage

```js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');
```

#### ❌ Incorrect Usage

```js
// The following patterns will fail!
const { Server } = require('@modelcontextprotocol/sdk').server;      // MODULE_NOT_FOUND
const mcp = require('@modelcontextprotocol/sdk');                    // MODULE_NOT_FOUND
import { Server } from '@modelcontextprotocol/sdk/server/index.js'; // ESM needs additional verification
```

#### Verification Commands

```bash
# Verify sub-path imports work correctly
node -e "require('@modelcontextprotocol/sdk/client')"   # Expected EXIT: 0
node -e "require('@modelcontextprotocol/sdk/server')"   # Expected EXIT: 0
node -e "require('@modelcontextprotocol/sdk/types.js')"  # Expected EXIT: 0

# Confirm root-level import fails (expected behavior, not a bug)
node -e "require('@modelcontextprotocol/sdk')"           # Expected EXIT: 1
```

## 4. Bootstrap Verification Steps

After completing `npm install`, verify the MCP tool stack is available:

```bash
# 1. Confirm dependencies are installed
ls .opencode/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js

# 2. Confirm 4 MCP tool scripts are syntactically correct (parse only, no execution)
node --check .opencode/scripts/mcp-tools/compliance-gate.js
node --check .opencode/scripts/mcp-tools/code-quality-gate.js
node --check .opencode/scripts/mcp-tools/eslint-audit.js
node --check .opencode/scripts/mcp-tools/keystone-validate.js

# 3. Confirm sub-path imports resolve correctly (require only, no MCP loop execution)
node -e "
  require('@modelcontextprotocol/sdk/server/index.js');
  require('@modelcontextprotocol/sdk/server/stdio.js');
  require('@modelcontextprotocol/sdk/types.js');
  console.log('All sub-path imports resolved successfully');
"
```

## 5. Future Fix Plan

| Condition | Action |
|-----------|--------|
| Upstream `@modelcontextprotocol/sdk` releases v1.30+ with barrel file fix | Upgrade version + restore root-level `require()` + update this document |
| Upstream not fixed by 2026-08-23 | Evaluate local barrel shim approach (`vendor/mcp-sdk-shim.js`) |

## 6. Tech Debt Tracking

| Waiver ID | Approval Date | Responsible | Status |
|-----------|---------------|-------------|--------|
| [WV-2026-006](.task_temp/_global/WAIVE-RVW2-MCP-DEPS.md) | 2026-05-23 | @Coder-BE / @CI-CD-Agent | **OPEN** |

---

**Maintainer**: @Arbiter / @CI-CD-Agent
**Signature**: `@Arbiter — 2026-05-23T06:38:00Z`
