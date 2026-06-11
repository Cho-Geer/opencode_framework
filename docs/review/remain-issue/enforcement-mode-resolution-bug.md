# Enforcement Mode Resolution Bug — Root Cause Analysis & Fix Plan

**Date**: 2026-06-11  
**Author**: @Super-Admin  
**Task ID**: SA-ROOTCAUSE-001  
**Status**: Fix plan approved, pending implementation  

---

## 1. Problem Statement

`compliance_gate_check` returns `enforcement_mode: "advisory"` despite `project.config.json` being configured with:

```json
"develop_enforcement_mode": "strict",
"runtime_enforcement_mode": "strict"
```

### Evidence

| Source | Value | Expected |
|--------|-------|----------|
| `project.config.json` L68-69 | `"strict"` / `"strict"` | `strict` |
| `ENFORCEMENT_MODE` env var | *(empty)* | N/A |
| `gate-state.json` session | `enforcement_mode: "advisory"` | `strict` |
| `compliance_gate_check` return | `advisory` | `strict` |

---

## 2. Architecture — Enforcement Mode Resolution

There are **3 independent resolution paths**, all converging on `project.config.json`:

```
                    ┌──────────────────────────────────┐
                    │   project.config.json             │
                    │   template_resolution:            │
                    │     develop_enforcement_mode      │
                    │     runtime_enforcement_mode       │
                    └──────────┬───────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
    ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐
    │ Path A:        │  │ Path B:       │  │ Path C:           │
    │ gate-core.ts   │  │ compliance-   │  │ gate-before.ts    │
    │ getEnforce-    │  │ gate.ts       │  │ plugin            │
    │ mentMode()     │  │ inline        │  │ import from       │
    │ (imported)     │  │ fallback      │  │ ../lib/gate-core  │
    └───────┬───────┘  └──────┬───────┘  └────────┬─────────┘
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │
                               ▼
                    All read: develop_enforcement_mode
                    || runtime_enforcement_mode
                    || "advisory" (default)
```

**Code audit result**: All three code paths correctly read `develop_enforcement_mode` from `project.config.json`. The code logic is not the direct cause.

---

## 3. Root Cause Analysis

### Primary Cause: CJS→ESM Cross-Module-System Bridge Fragility

`compliance-gate.ts` (MCP tool) uses CommonJS `require()` to load `gate-core.ts` (ESM `import`).

```javascript
// compliance-gate.ts L5-17 — THE PROBLEM
let _gateCore = null;
try {
  const gateCorePath = require("path").join(
    process.env.OPENCODE_ROOT ||
      require("path").resolve(__dirname, "..", "..", ".."),
    ".opencode", "lib", "gate-core",
  );
  _gateCore = require(gateCorePath);  // CJS require() of ESM module
} catch (_e) {
  // SILENTLY falls back to inline implementation
}
```

In Bun, `require()` of an ESM module requires transpilation interop. If this bridge fails:

1. `_gateCore` stays `null`  
2. All `_gateCore?.xxx` calls fall to inline fallbacks  
3. The inline `getEnforcementMode()` has IDENTICAL logic — BUT it runs in a different execution context  
4. The `OPENCODE_ROOT` resolution differs: `compliance-gate.ts` uses `__dirname`-based fallback, while `gate-core.ts` uses `process.cwd()`-based fallback  

### Secondary Cause: MCP Server Process Isolation

The `compliance-gate` MCP server runs as a **child process** launched by OpenCode:

```jsonc
// opencode.json
"compliance-gate": {
  "command": ["bun", "./.opencode/scripts/mcp-tools/compliance-gate.ts"]
}
```

OpenCode injects environment variables (confirmed by `FRAMEWORK_AGENT` env var usage in `resolveDispatchTargetAgentDirect()` at L1590). If `ENFORCEMENT_MODE` is unset in the child process, the code falls back to reading `project.config.json` — which should still return `"strict"`, but the CJS→ESM bridge failure means the inline fallback's path resolution may differ.

### Module System Fragmentation Overview

```
┌──────────────────────────────────────────────────────────┐
│              CURRENT STATE: 3 MODULE SYSTEMS              │
├──────────────┬──────────┬──────────┬─────────────────────┤
│ Category     │ Files    │ System   │ Status              │
├──────────────┼──────────┼──────────┼─────────────────────┤
│ MCP Tools    │ 6 files  │ require()│ 🔴 Pure CJS         │
│ Plugins      │ 16 files │ import   │ 🟢 Pure ESM         │
│ Shared Lib   │ 21 files │ MIXED    │ 🟡 19 ESM + 2 CJS   │
│ Scripts      │ 34 files │ require()│ 🔴 Pure CJS         │
│ Compiled JS  │ 5 files  │ dist/    │ 🔴 Stale, partial   │
└──────────────┴──────────┴──────────┴─────────────────────┘
```

---

## 4. Impact Analysis

| System | Impact |
|--------|--------|
| **Hardened Enforcement** | **CRITICAL**: All blocking checks become warnings in advisory mode, defeating the purpose of strict enforcement |
| **Layout Architecture** | CJS→ESM bridge creates hidden divergence between plugin and MCP tool code paths |
| **Harness System** | Bun module resolution for `require()` of ESM files is fragile and silently fails |
| **Central State Management** | `compliance_gate_complete` skips ESLint dirty_modules checks in advisory (L1168) |
| **Multi-Agent System** | Agents that should be blocked in strict mode are allowed to proceed |
| **Log Management** | Advisory mode produces `[ADVISORY]` logs instead of `[STRICT]` |
| **Templatization** | The dual-key design (`develop_enforcement_mode`/`runtime_enforcement_mode`) is bypassed |

---

## 5. Fix Plan — 4 Phases

### Phase 1: Convert MCP Tool to Unified TypeScript `import`

**File**: `.opencode/scripts/mcp-tools/compliance-gate.ts`

| Step | Change |
|:----:|--------|
| 1a | Replace `#!/usr/bin/env node` + `"use strict"` + `require()` bridge (L1-17) with TypeScript `import` from `../../lib/gate-core` |
| 1b | Replace all `require("@modelcontextprotocol/sdk/...")` with ESM `import` |
| 1c | Remove inline `getEnforcementMode()` fallback (L386-422) — use gate-core's version directly |
| 1d | Add diagnostic `console.error()` logging to call site |

### Phase 2: Config-Driven Enforcement Mode

**File**: `opencode.json` L809-817

Add `"environment": { "ENFORCEMENT_MODE": "strict" }` to the `compliance-gate` MCP server config — official OpenCode pattern.

### Phase 3: Diagnostic Logging + V3 State Fix

**File**: `.opencode/lib/gate-core.ts`
- Add diagnostic `console.error()` logging in `getEnforcementMode()`
- Add `// BUN-CACHE-VERSION` comment for cache invalidation

**File**: `.opencode/scripts/mcp-tools/compliance-gate.ts`
- Fix V3 format bridge: preserve `enforcement_mode` in `loadStore()` and `saveStore()`

### Phase 4: Validation + Cache Clear

- `rm -rf ~/.cache/bun` — Bun cache invalidation
- Add enforcement mode self-test to `framework-self-test.ts`

---

## 6. Files Modified

| # | File | Phase | Scope |
|:--:|------|:-----:|-------|
| 1 | `.opencode/scripts/mcp-tools/compliance-gate.ts` | P1, P3 | ~50 lines |
| 2 | `opencode.json` | P2 | +1 line |
| 3 | `.opencode/lib/gate-core.ts` | P3 | +10 lines |
| 4 | Shell | P4 | `rm -rf ~/.cache/bun` |

---

## 7. Official OpenCode Documentation Compliance

Per official docs review:

| Concern | Finding |
|---------|---------|
| Does OpenCode require `require()` for MCP tools? | **No** — OpenCode is agnostic about MCP server implementation |
| Does OpenCode favor `import` for tools? | **Yes** — custom tools API uses `import` exclusively |
| Is `import` consistent with OpenCode ecosystem? | **Yes** — all 16 plugins use `import` |
| MCP `environment` field? | **Official** — per [mcp-servers.md](https://opencode.ai/docs/mcp-servers/) |

---

## 8. 9-System Alignment Verification

| System | Alignment |
|--------|-----------|
| **Layout Architecture** | `.opencode/lib/gate-core.ts` remains shared code. MCP tool imports via relative path — same pattern as plugins |
| **Permission Matrix** | No permission changes. `opencode.json` edit governed by @Super-Admin write scope |
| **Concurrent Session/Dispatch** | `import` resolves at parse time — no silent fallback, no execution path divergence |
| **Hardened Enforcement** | Single `getEnforcementMode()` code path for ALL consumers |
| **Harness** | Bun handles `import` natively. Cache clearing ensures fresh transpilation |
| **Central State Management** | V3 bridge fix preserves `enforcement_mode`. `opencode.json` is config-driven source of truth |
| **Multi-Agent** | All agents share identical `import { getEnforcementMode }` from `../lib/gate-core` |
| **Log Management** | `console.error()` to stderr — consistent with framework convention |
| **Templatization** | Config-driven: `project.config.json` → `opencode.json environment` → MCP process. No custom env vars |

---

*This document is the single source of truth for the enforcement mode resolution bug investigation and fix plan. All subsequent implementation should reference this document.*
