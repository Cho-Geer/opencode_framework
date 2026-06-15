# Fix Plan — OpenCode TUI "Unexpected {interrupt}" Corruption (work-one)

**Date:** 2026-06-14
**Author:** @Super-Admin (framework repair)
**Scope:** `.opencode/` local framework only — no upstream OpenCode patches
**Incident reference:** `screenshots/image copy.png` (2026-06-14 ~03:11 UTC)
**Symptom:** TUI rendered literal `Unexpected {interrupt}` string + stack trace mentioning
`safe-bash-core.ts:778:1` and `ToolRegistry.state / SessionTools.resolve`; subsequent
tool invocations showed stale scope until restart.

---

## 1. Background (from official sources)

| Source | URL | Takeaway relevant to fix |
| --- | --- | --- |
| OpenCode Docs — Plugins | https://opencode.ai/docs/plugins/ | Hook surface includes `session.error`, `session.compacted`, `session.idle`, `tool.execute.before/after`. **No interrupt hook** — plugins must trap cooperative interrupts themselves. |
| OpenCode Docs — Config | https://opencode.ai/docs/config/ | No `interrupt.*` or `debug.*` config keys. `compaction.*` and `snapshot` are the only state-preservation primitives. |
| OpenCode Docs — Custom Tools | https://opencode.ai/docs/custom-tools/ | Custom tools live in `.opencode/tools/`, use `tool()` helper, Zod args, `execute(args, context)`. Throwing in `execute` surfaces as a tool error to the TUI. |
| Source (anomalyco/opencode) | https://github.com/anomalyco/opencode | Go TUI ↔ Bun JS backend over HTTP+SSE. Interrupt is a **cooperative** cancel signal forwarded to child processes. |
| Deep dive (Boud) | https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/ | Tools = description + Zod schema + `execute`. Registry aggregates them. Cancellation tokens forwarded to spawned processes. |
| Releases (v1.17.6) | https://github.com/anomalyco/opencode/releases | User is on the latest stable. Recent fixes include: TUI duplicate-renderable-ID fix, MCP clean-fail, content-filter error surfacing. |
| Issue #20095 | https://github.com/anomalyco/opencode/issues/20095 | Session cancel races solved upstream via Effect/Stream/Runner + `Fiber.interrupt`. Local plugins must still cooperate. |
| Issue #27451 | https://github.com/anomalyco/opencode/issues/27451 | TUI frozen when tool registry hits `Object.entries(null)`. Fix: tolerate plugin tool defs with missing args. **Ruled out** locally (all 12 tools register cleanly). |
| Issue #27434 | https://github.com/anomalyco/opencode/issues/27434 | Subagent task click kills TUI worker. Root cause: return-in-catch skips cleanup. **Relevant pattern** for our local tools. |
| Issue #21176 | https://github.com/anomalyco/opencode/issues/21176 | Cooperative abort does NOT interrupt blocking LLM calls. Out of scope here. |
| Issue #13887 | https://github.com/anomalyco/opencode/issues/13887 | `zod` install race on first start. Out of scope (deps already warm). |

## 2. Root Cause

1. `safe-bash-core.ts:778` is just the closing brace of the file — a call-site boundary, not the source.
2. The Bun backend's interrupt handler emitted an error message using a string template containing the literal `{interrupt}` placeholder. The placeholder was never interpolated before being handed to the Go TUI, so the user saw `Unexpected {interrupt}` verbatim.
3. No local plugin subscribes to `session.error`, so the error propagated unobserved and left `ToolRegistry`-derived state (session → agent map, gate lock) in a stale state. Subsequent tool calls kept reading the stale scope until the user restarted.
4. None of the 12 local tools (`safe_shell`, `safe_edit`, `safe_delete`, `safe_mkdir`, `safe_test`, `safe_diff`, `safe_restore`, `dispatch_subagent`, `module_scope_declare`, `rule_registry_repair`, `knowledge_cache_search`, `knowledge_gap_report`) currently trap the cooperative interrupt signal, and the `execSync` / `spawn` calls in `safe-bash-core.ts` do not bind an `AbortSignal`.

## 3. Fix Strategy

All fixes live under `.opencode/` — **no patches to the Go TUI binary, Bun runtime, `opencode.json`, or `project.config.json`.**

### Phase 1 — Shared interrupt guard
- Add `.opencode/lib/interrupt-guard.ts` exporting `withInterruptGuard<T>(label, fn): Promise<T>`.
  - Detects: `AbortSignal` abort, `SIGINT`, `Error.name === "InterruptError"`, message containing the literal token `interrupt`.
  - On intercept: logs via `writeLog` channel, returns a structured string payload (`{interrupted:true, tool:label, reason}`, JSON-encoded) — never throws.
  - Does not change tool return types for the success path.

### Phase 2 — Wrap local tools
- Each tool's `async execute(...)` body is wrapped in `withInterruptGuard(toolName, async () => { … })`.
- Files touched (12):
  - `.opencode/tools/safe_shell.ts`
  - `.opencode/tools/safe_edit.ts`
  - `.opencode/tools/safe_delete.ts`
  - `.opencode/tools/safe_mkdir.ts`
  - `.opencode/tools/safe_test.ts`
  - `.opencode/tools/safe_diff.ts`
  - `.opencode/tools/safe_restore.ts`
  - `.opencode/tools/dispatch_subagent.ts`
  - `.opencode/tools/module_scope_declare.ts`
  - `.opencode/tools/rule_registry_repair.ts`
  - `.opencode/tools/knowledge_cache_search.ts`
  - `.opencode/tools/knowledge_gap_report.ts`

### Phase 3 — MCP server hardening
- `.opencode/scripts/mcp-tools/compliance-gate.ts` and `eslint-audit.ts`:
  - Register `process.on("SIGINT", …)` that releases `gate-state.json` locks and exits 0.
  - Wrap the MCP `server.setRequestHandler(...)` callbacks with `withInterruptGuard`.

### Phase 4 — Session error subscription
- Extend `.opencode/plugins/session.ts`:
  - Subscribe to `session.error` → write `SESSION-ERROR` log entry; if error matches interrupt signature, write sentinel `.opencode/state/.last-interrupt.json`.
  - Subscribe to `session.compacted` → reset in-memory `sessionID→agent` map.
  - Subscribe to `session.idle` → clear `.last-interrupt.json` sentinel if present.

### Phase 5 — AbortSignal propagation in safe-bash-core
- Refactor `safeBashTool` to accept an optional `signal?: AbortSignal` and pass it to `execSync` / `spawn`.
- When the signal fires, return `{ executed:true, exitCode:130, blockedReason:null, stderr:"<interrupted>" }` — no throw.

### Phase 6 — State reconciliation
- Add `.opencode/scripts/reset-interrupt-state.ts`:
  - Clears `.opencode/state/.last-interrupt.json`.
  - Releases any `gate-state.json` lock held at the time of the interrupt.
  - Triggered automatically from the `session.error` hook (Phase 4) so users never run it manually.

### Phase 7 — Validation (read-only / dry-run)
- Simulate Ctrl+C during a `safe_shell` `node -e 'setTimeout(()=>{},30000)'` invocation and assert:
  - TUI returns to the prompt cleanly.
  - No literal `Unexpected {interrupt}` appears.
  - `.task_temp/_logs/<date>/plugin-session-runtime.log` contains `SESSION-ERROR | kind=interrupt`.
  - `gate-state.json` is unlocked within 5 s.
- Re-run `framework-self-test.ts` and `framework-compliance-check.ts` — both must pass with `mode=strict` and zero CAT1 violations.

## 4. Out of scope (upstream)
- Do **not** modify the Go TUI binary or Bun runtime.
- Do **not** fork `@opencode-ai/plugin`.
- Do **not** implement a local force-kill for subagents (#21176).

## 5. Rollback
Delete the four new files (`.opencode/lib/interrupt-guard.ts`, the session.ts additions, the two MCP handler wrappers, `.opencode/scripts/reset-interrupt-state.ts`) and revert the 12 tool files via `git restore .opencode/tools/`.

## 6. Files changed (summary)
- New: `.opencode/lib/interrupt-guard.ts`, `.opencode/scripts/reset-interrupt-state.ts`, `.opencode/state/.last-interrupt.json` (runtime artifact, gitignored).
- Modified: 12 files under `.opencode/tools/`, 2 under `.opencode/scripts/mcp-tools/`, 1 under `.opencode/plugins/`, 1 under `.opencode/lib/` (`safe-bash-core.ts`).
