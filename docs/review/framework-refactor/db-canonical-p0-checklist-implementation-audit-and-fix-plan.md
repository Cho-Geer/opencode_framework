# DB-Canonical P0 Checklist Implementation Re-Audit and Fix Plan

**Generated**: 2026-06-22
**Re-audited**: 2026-06-22 after latest framework code updates, second pass
**Phase G added**: 2026-06-22 — conservative dispatch-prompt refinement plan (8 sub-phases G1–G8), targets CI-CD-Agent wrapper 183 → ~113 lines with zero hard-constraint impact. Resolves P1-1 / Step 7 gap.
**Phase H added**: 2026-06-22 — session_map agent-identity pollution root-cause analysis and concurrent-safety fix plan (DB-canonical safe). Resolves P0-5 (M14 false-positive on sequential dispatch) and TOCTOU race in `dispatch_subagent.ts:735-739`. Covers auto-dispatch / `auto_plan=true` self-heal path (H4 smoke test).
**Phase I added**: 2026-06-22 — UC7-001 shell command parsing bypass plan (4 sub-phases I1–I4), hardens `tool-scope.ts` against command-chain / heredoc / missing-tool coverage. Resolves P0-6.
**Phase J added**: 2026-06-22 — DISPATCH_TOKEN hash verification regex bug in `task-before.ts:250-252` strips trailing newlines from the original `resolvedPrompt`, causing a permanent hash mismatch that blocks ALL `Task()` calls in strict/locked mode. Resolves P0-7.
**Phase K added**: 2026-06-22 — `checklist-before.ts` session_map bridge only applied to `Task()` (P0-4), leaving modify tools (safe_edit, write, etc.) to create a separate checklist run with `task_id=null`. Attested items on Run-A become invisible, causing false P0-CHECKLIST-BLOCKED on every modify call. Fix: extract `resolveChecklistTaskId` helper, apply to all tools. Resolves P0-8.
**Scope**: Cross-audit `docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md` against current `.opencode/`, `opencode.json`, and `.opencode/project.config.json`.  
**Result**: Still not complete. Several previous blockers were improved, and `framework-self-test.ts` now reports all checks passing. The runtime checklist flow is still not production-ready because the new dispatch checklist marking code is currently ineffective: `dispatch-subagent.ts` calls `checklistWirePassed(...)` without importing it, catches the resulting error, and continues without marking dispatch facts.  
**Review limitation**: `/compliance-gate` was not executable in the current shell and no `compliance_gate_check` MCP tool was exposed to this Codex runtime. The review was performed as a read-only code audit plus local self-test/minimal DB behavior checks.

---

## 1. Current Verdict

The DB-canonical P0 checklist implementation is **partially implemented, not complete**.

Progress since the previous audit:

- `createChecklistRun()` now pre-creates all phase items, not only `dispatch_payload`.
- `module_scope_declare.ts` now marks `module_scope_declared` on the normal success path.
- `checklist-before.ts` no longer requires `payload_complete` / `dispatch_token_created` before `dispatch_subagent`.
- `checklist-before.ts` no longer requires `gate_closed` before `compliance_gate_complete`.
- `dispatch_subagent.ts` now passes `OPENCODE_SESSION_ID` into the first `dispatch-subagent.ts` CLI invocation.
- `dispatch-subagent.ts` moved the task payload block before the P0 protocol block.
- `dispatch-subagent.ts` now contains intended checklist writes for `payload_complete`, `dispatch_token_created`, and `session_context_bound`.
- `.opencode/agents/*.md` now include `checklist_status` in tool declarations.
- `knowledge_cache_search.ts` now attempts direct `searchByDomain()` before tag fallback when domain keywords exist.
- `framework-self-test.ts` now passes all 64 checks in the current checkout.

Remaining blockers:

- `dispatch-subagent.ts:688` (primary vector — CLI subprocess) writes the *target* sub-agent's type (`agentType`) under the *caller's* `OPENCODE_SESSION_ID` on every dispatch. `dispatch_subagent.ts:735-739` (secondary vector — tool wrapper) reinforces this pollution with an `|| args.agent_type` fallback. This session_map identity pollution causes `dispatch-before.ts:46` (`resolveAgent(input.sessionID)`) to return the wrong caller for any subsequent dispatch in the same session, producing a false M14 block on the second dispatch (observed: CI-CD-Agent dispatched first, then Architect falsely rejected). The `auto_plan=true` self-heal path in `dispatch_subagent.ts:284-340` amplifies this: each self-heal invocation overwrites the caller's identity twice (first with @Meta-Planner, then with the final target). The same code has a TOCTOU race on parallel dispatches from the same session. The fix is **DB-canonical safe** — read existing agent and preserve, not delete the write. See **P0-5** and **Phase H** below.
- **UC7-001 shell command parsing is bypassed by command chains, heredocs, and missing tools**. `tool-scope.ts:17` `isModifyShell` and `tool-scope.ts:71` `parseShellWriteTargets` both anchor on `^(\S+)` (first token only), so `cd && python3 evil.py`, `pwd && sed -i 's/x/y/' .opencode/lib/x.ts`, `cp a b; python3 -c "..."` are all classified as non-modifying. `python3 << heredoc` bypasses the `-c` check at line 180 and is classified `read_only_shell`. The built-in `bash` tool is not in `isModifyTool` (line 8-9) so it entirely skips `scope-before.ts:48` and `checklist-before.ts:59`; current defense relies on `opencode.json` blanket `"bash": "deny"` which is a **permission layer**, not a knowledge layer. Same applies to `apply_patch` (environment-specific; not in current `opencode.json`). See **P0-6** and **Phase I** below.
- **`DISPATCH_TOKEN` hash verification in `task-before.ts:250-252` has a regex bug that strips trailing newlines from the original prompt, causing a permanent hash mismatch on EVERY `Task()` call in strict/locked mode**. `dispatch-subagent.ts:965` writes `tokenizedPrompt = resolvedPrompt + "\n//DISPATCH_TOKEN:" + sha256(resolvedPrompt)`. When `resolvedPrompt` ends with `\n` (which it always does — the prompt template terminates with `\n`), the file content is `resolvedPrompt\n//DISPATCH_TOKEN:<hash>`. `task-before.ts:250-252` then strips the token line with `replace(/\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "")` (leaving `resolvedPrompt\n`) and then strips ALL trailing newlines with `replace(/\n+$/, "")` — consuming both the template-literal `\n` AND `resolvedPrompt`'s own trailing `\n`. The resulting `cleanPrompt` is 1 char shorter than `resolvedPrompt`, so `sha256(cleanPrompt) ≠ dispatchToken`. Verified against live dispatch files: token `3679e61bb...` vs computed `dba93a8d0192...` (CI-CD-Agent), token `e1fb498b9...` vs computed `63a6db6500...` (Architect). The auto-dispatch bridge (`task-before.ts:157-166`) correctly loads the original file content — the failure is purely in the hash verification regex, not in prompt transmission. See **P0-7** and **Phase J** below.
- **`checklist-before.ts` session_map bridge (P0-4) only fires for `Task()` / `task`, leaving modify tools (safe_edit, write, etc.) without task_id resolution**. When a modify tool is called without explicit `task_id`, `resolveChecklistRun()` creates a new checklist run with `task_id=null` (Run-B), separate from the already-attested Run-A that has the correct `task_id`. Result: `config_read_attested` and `knowledge_attested` on Run-A are invisible to the modify tool's check, causing a false `P0-CHECKLIST-BLOCKED` on every modify call in the same session. The fix extracts a `resolveChecklistTaskId` helper that tries explicit args first, then falls back to `dbReadSessionMap(sessionID).dag_task_id`, and applies it to ALL checklist-managed tools. **Implemented as Phase K (P0-5 FIX) in `checklist-before.ts:138-168`**. See **P0-8** and **Phase K** below.
- `dispatch-subagent.ts` still does not effectively mark `payload_complete`, `dispatch_token_created`, or `session_context_bound`: the code calls `checklistWirePassed(...)` without importing it, and the catch block only logs "Checklist marking skipped".
- `dispatch_subagent.ts` invokes `dispatch-subagent.ts` twice. The first invocation passes `OPENCODE_SESSION_ID`; the second inline-prompt invocation does not, so after the import bug is fixed it could create checklist writes under an empty/wrong session.
- `Task()` still requires only `payload_complete` and `dispatch_token_created`, while the dispatch phase also defines `session_context_bound` as a blocker.
- `checklist-before.ts` returns before running its own dispatch role/event block for `dispatch_subagent`.
- `opencode.json` still does not grant `checklist_status` permissions to agents.
- Prompt generation is improved but not an exact implementation of the target order: it starts with a subagent header and scope section before the P0 block; the plan's target first top-level block is still `## Task Payload`.
- Gate checklist writes still use compliance gate `session_id`, while plugin enforcement resolves by OpenCode `sessionID`.
- `p0_checklist_policy` exists but is not consumed by `checklist-before.ts`.
- `knowledge_cache_search.ts` direct domain matching still only runs inside the `domainKeywords.length > 0` branch; domains with no semantic-map keywords still skip direct domain search.
- Todo integration is not implemented as a DB checklist projection layer. Existing `todowrite` permissions are limited to Orchestrator, Super-Admin, and Knowledge-Curator.
- `framework-self-test.ts` passes, but its checklist checks are still too shallow to catch the ineffective dispatch fact writes found in this audit.

---

## 2. Verification Performed

### 2.1 Compliance Gate Attempt

```bash
'/compliance-gate' '重新审核 DB-canonical P0 checklist 实装状态...'
```

Result:

```text
/bin/bash: line 1: /compliance-gate: No such file or directory
```

### 2.2 Isolated Checklist DB API Behavior

Command:

```bash
bun --no-cache -e '/* create run in temp DB, inspect dispatch blockers */'
```

Observed:

- New run created `items_created: 23`.
- Current phase was `dispatch_payload`.
- `getChecklistSummary()` still reported current phase `dispatch_payload` blocked on:
  - `dispatch_token_created`
  - `payload_complete`
  - `session_context_bound`
- `requireChecklistPassed()` returned `false` for all three dispatch facts.

Interpretation:

- The previous missing-item issue is improved.
- The dispatch phase is still blocked until a working dispatch writer marks those facts on the same run.

### 2.3 Dispatch CLI Checklist Marking Behavior

Command:

```bash
bun --no-cache -e '/* run dispatch-subagent.ts with FRAMEWORK_DB_PATH + OPENCODE_SESSION_ID, then query temp DB */'
```

Observed:

```json
{
  "runs": [],
  "items": []
}
```

Static explanation:

- `.opencode/scripts/command-tools/dispatch-subagent.ts` calls `checklistWirePassed(...)` at the dispatch success point.
- The file does not import or define `checklistWirePassed`.
- The failure is caught by `catch (e) { logWarn("Checklist marking skipped: " + e.message); }`, so dispatch continues and no checklist facts are marked.
- `.opencode/tools/dispatch_subagent.ts` now passes `OPENCODE_SESSION_ID` into its first CLI invocation, but the later inline-prompt CLI invocation does not pass that environment value.

Interpretation:

- The intended Phase A dispatch writer exists as code text, but it is not currently effective.
- This is why `framework-self-test.ts` can pass while the actual dispatch checklist handoff remains incomplete.

### 2.4 Framework Self-Test

Command:

```bash
bun --no-cache .opencode/scripts/framework-self-test.ts
```

Result:

```text
ALL 64 CHECKS PASSED
```

Notes:

- Check 33 is now green: `.pending.json — 2 pending entries`.
- Checks 64-66 still remain too shallow for the runtime checklist flow.
- The harness does not execute `dispatch-subagent.ts` and assert that `payload_complete`, `dispatch_token_created`, and `session_context_bound` are passed on the same OpenCode run.

---

## 3. Implementation Status Matrix

| Plan step | Current status | Notes |
| --- | --- | --- |
| Step 1: DB schema v18 | Pass | Tables and version record exist. |
| Step 2: checklist DB API | Partial pass | All phase items are now created up front. Still no policy snapshot, no DB-derived todo projection, and no robust run identity binding. |
| Step 3: dispatch payload integrity gate | Fail | Validation exists and prompt order improved. Dispatch fact marking code was added, but it is currently ineffective because `checklistWirePassed` is not imported/defined and the error is swallowed. The second CLI invocation also lacks explicit `OPENCODE_SESSION_ID`. |
| Step 4: `checklist_status` tool | Partial fail | Tool exists and agent md files declare it. `opencode.json` still does not grant it; no `suggested_todos` projection exists. |
| Step 5: existing tool facts write checklist | Partial pass | `module_scope_declared` normal path fixed. Gate facts still likely write to gate-session runs, not OpenCode-session runs. Failure paths mostly do not call `markChecklistFailed()`. |
| Step 6: `checklist-before.ts` enforcement | Partial fail | Dispatch self-block was removed, but `dispatch_subagent` role/event code is still unreachable due early return. Modify tools still ignore path policy. Complete handling may over-block exempt direct close flows. |
| Step 7: preamble and prompt slimming | Partial pass | Preamble is slim (39 lines) and `### Task Payload` now appears before `### P0 Protocol`. Top-level order still deviates: Scope Line is misplaced before P0, Context7 injects business stacks into framework-only tasks, and 4 wrapper sections (Execution Order, Permissions, Conflict Resolution, Audit Trail) are informational redundancy. **Conservative 8-sub-phase plan added as Phase G below** — targets 183 → ~113 lines (-38%) with zero hard-constraint impact. |
| Step 8: harness/self-test | Partial fail | Self-test now passes all 64 checks, but it still misses the runtime dispatch marking failure found by temp-DB verification. |
| Step 9: multi-agent dispatch checklist | Partial fail | Some events exist, but `dispatch_subagent` branch in `checklist-before.ts` is skipped before event/role code. Child run `parent_session_id` is not consistently bound. |
| Step 10: write target policy | Fail | `p0_checklist_policy` exists but is not read/snapshotted by checklist enforcement. |
| Step 11: logging integration | Partial fail | Some logs exist. Required event names and fields are not consistently implemented. |
| Todo projection integration | Not implemented | Official `todowrite`/`todo.updated` can be used, but no DB-derived projection or drift correction exists yet. |
| Agent identity / session_map concurrent safety | Fail | `dispatch_subagent.ts:738` falls back to `args.agent_type` when no prior session_map entry exists, writing the target sub-agent type under the caller's session ID. Sequential dispatches from the same session produce a false M14 block on the second dispatch. TOCTOU race exists on parallel dispatches. See **P0-5** and **Phase H**. |
| UC7-001 shell command parsing | Fail | `tool-scope.ts:17` `isModifyShell` and `tool-scope.ts:71` `parseShellWriteTargets` both anchor on `^(\S+)`. Command chains (`cd && python3`, `cp a; sed -i ...`), heredocs (`python3 <<EOF`), and non-listed shell tools (`bash`, `apply_patch`) bypass the knowledge layer entirely. Current defense for `bash` is `opencode.json: "deny"` (permission layer, not knowledge layer). See **P0-6** and **Phase I**. |
| DISPATCH_TOKEN hash verification | Fail | `task-before.ts:250-252` regex `replace(/\n+$/, "")` strips ALL trailing newlines from `cleanPrompt`, including the original `resolvedPrompt`'s own trailing `\n`. Since `dispatch-subagent.ts:965` appends `\n//DISPATCH_TOKEN:` after `resolvedPrompt`, the correct strip is `\n` + token line, not "all trailing newlines after token line". Result: `sha256(cleanPrompt)` is permanently ≠ `dispatchToken` whenever `resolvedPrompt` ends with `\n` (always true). Verified on 3 live dispatch files (CI-CD-Agent, Architect, fresh test) — zero pass. See **P0-7** and **Phase J**. |
| session_map bridge scope (checklist run resolution) | **Fixed (Phase K)** | `checklist-before.ts` P0-4 bridge was Task-only (`if (!taskId && (toolName === "Task" \|\| toolName === "task"))`). Modify tools without explicit `task_id` created `task_id=null` Run-B, missing attested Run-A. **Fixed**: extracted `resolveChecklistTaskId()` helper (lines 138-159), resolved early (line 168) for ALL tools. Self-test check added (check 64e). See **P0-8** and **Phase K**. |

---

## 4. Findings

### P0-1: `Task()` can still block because dispatch fact marking is ineffective

Evidence:

- `.opencode/plugins/checklist-before.ts` requires `payload_complete` and `dispatch_token_created` for `Task()`.
- `.opencode/lib/execution-checklist.ts` also defines `session_context_bound` as a dispatch-phase blocker.
- `.opencode/scripts/command-tools/dispatch-subagent.ts` now contains intended calls to:
  - `checklistWirePassed(..., "payload_complete", ...)`
  - `checklistWirePassed(..., "dispatch_token_created", ...)`
  - `checklistWirePassed(..., "session_context_bound", ...)`
- The file does not import or define `checklistWirePassed`.
- The resulting runtime error is swallowed by the local `catch` block, producing only a warning.
- Temp-DB verification ran `dispatch-subagent.ts` with `FRAMEWORK_DB_PATH` and `OPENCODE_SESSION_ID`, then queried `execution_checklist_runs` and `execution_checklist_items`; both were empty.
- `Task()` currently requires only two of the three dispatch facts (`payload_complete`, `dispatch_token_created`), so `session_context_bound` is not enforced consistently even after it is written.
- `.opencode/tools/dispatch_subagent.ts` invokes the CLI twice; only the first invocation passes `OPENCODE_SESSION_ID`.

Impact:

- The direct self-block on `dispatch_subagent` was removed, but the next `Task()` call can still be blocked.
- The framework can appear healthy because dispatch proceeds and self-test passes, while DB checklist facts remain unmarked.
- After importing `checklistWirePassed`, the second CLI invocation can still create wrong-session writes unless it also receives the same session/task context or is removed.

Fix:

- Import `checklistWirePassed` in `dispatch-subagent.ts`, or call a typed helper from `execution-checklist.ts` directly.
- Treat checklist marking failure as fatal in strict/locked mode, not as a swallowed warning.
- Avoid running `dispatch-subagent.ts` twice. If the second invocation remains, pass the same `FRAMEWORK_DB_PATH`, `OPENCODE_ROOT`, `OPENCODE_SESSION_ID`, task id, and parent-session context.
- In `dispatch_subagent.ts` or `dispatch-subagent.ts`, resolve/create the parent checklist run and mark:
  - `payload_complete` after `validateDispatchPayload()` passes and `dispatch_payload_integrity` is written.
  - `dispatch_token_created` after `DISPATCH_TOKEN` is generated and prompt is saved.
  - `session_context_bound` after child slot / dispatch context is verified.
- `Task()` should require all three dispatch facts.

### P0-2: `dispatch_subagent` branch in `checklist-before.ts` is unreachable

Evidence:

- `getRequiredItems("dispatch_subagent")` returns `null`.
- `toolExecuteBefore()` returns immediately when `required` is null.
- The later dispatch role/event block includes `toolName === "dispatch_subagent"`, but is never reached for this tool.

Impact:

- `SUBSESSION-DISPATCH-REQUESTED` is not recorded by this plugin for `dispatch_subagent`.
- The claimed Step 9 checklist enforcement layer is incomplete.
- Other dispatch layers may still enforce roles, but this plan specifically requires the checklist layer to participate.

Fix:

- Split role/event handling from checklist item checks.
- Run dispatch role/event logic before the `if (!required) return`.
- Keep `dispatch_subagent` exempt from dispatch item prerequisites, but not from role/event auditing.

### P0-3: Gate checklist writes still use gate session identity

Evidence:

- `compliance-gate.ts` calls `checklistWirePassed(sessionId, ...)`, where `sessionId` is the compliance gate id.
- `checklist-before.ts` resolves checklist runs with OpenCode `input.sessionID`.
- Approval read context now maps `gate_session_id` to `opencode_session_id` for read verification, but checklist writes still do not consistently use that mapping.

Impact:

- Gate facts can still be written to a different run than the one before-hooks check.
- `compliance_gate_submit_deliverables`, approve, or complete may remain blocked despite successful gate actions.

Fix:

- Introduce `checklistWirePassedForGateSession(gateSessionId, ...)` that resolves the active OpenCode run through `approval_read_context`, gate session metadata, or an explicit `gate_session_id -> opencode_session_id` table/column.
- Store gate session id as `evidence_ref` or metadata on the OpenCode checklist run.
- Keep one execution run per OpenCode task/session; do not create independent gate-only runs for enforcement facts.

### P0-4: `checklist_status` is not granted in `opencode.json`

Evidence:

- `.opencode/agents/*.md` now include `checklist_status`.
- `rg '"checklist_status"\\s*:' opencode.json` returns no matches.

Impact:

- Agents may be instructed to call a tool that runtime permission policy does not allow.
- The plan requires both `opencode.json` and agent md wiring.

Fix:

- Add `"checklist_status": "allow"` to every agent permission block that must call it.
- Add self-test coverage that checks both agent md declarations and `opencode.json` runtime permissions.

### P0-5: `session_map` agent-identity pollution blocks sequential dispatch (M14 false-positive)

**Observed symptom**: Orchestrator dispatches CI-CD-Agent (success), then dispatches Architect — the second dispatch is rejected with `[FW-ENFORCE][M14] Sub-agents may only dispatch to @Knowledge-Curator. Caller "@CI-CD-Agent" attempted to target "Architect".`

**Initial hypothesis (incorrect)**: "Session context switches to the sub-agent after the first dispatch, causing the second dispatch to execute inside the sub-agent's session."

**Actual root cause (log-verified 2026-06-22)**: Two pollution vectors exist; the primary one is in the **CLI subprocess** (`dispatch-subagent.ts`), which runs before the tool wrapper:

**Vector 1 — PRIMARY (CLI subprocess, `dispatch-subagent.ts:688`)**:
```typescript
// dispatch-subagent.ts (CLI) lines 677-688 — P2-FIX R2: PRIMARY POLLUTION
// Comment: "Pre-write session_map BEFORE generating prompt to eliminate race condition"
const sessionId = process.env.OPENCODE_SESSION_ID || "";  // ← Orchestrator's session ID
if (sessionId) {
  dbWriteSessionMap(sessionId, agentType, taskId);
  //                 ↑ Orch sid  ↑ "CI-CD-Agent"  ← overwrites caller's agent identity!
}
```

The CLI is invoked by the tool wrapper with `OPENCODE_SESSION_ID = context.sessionID` (the Orchestrator's session). It writes `agentType` (the target sub-agent: "CI-CD-Agent") under the **caller's** session ID — directly overwriting the Orchestrator's identity.

**Vector 2 — SECONDARY (tool wrapper, `dispatch_subagent.ts:738`)**:
```typescript
// dispatch_subagent.ts (tool) lines 733-739 — SECONDARY POLLUTION
const existing = dbReadSessionMap(context.sessionID);
dbWriteSessionMap(
  context.sessionID,
  existing?.agent || args.agent_type,  // ← after CLI pollution, existing.agent = "CI-CD-Agent"
  dagTaskId,
  inferredDomainId || undefined,
);
```

The wrapper runs after the CLI. Since the CLI already polluted the entry, `existing?.agent` reads back "CI-CD-Agent" — the wrapper then writes it back, cementing the pollution. Even if the CLI were fixed, the wrapper's fallback `|| args.agent_type` would still pollute when no prior entry exists.

**Log-verified timeline (2026-06-22 09:37, session `ses_11289bdaeffeewvWqD634Pvtjn`)**:

| Time | Event | session_map agent | Source |
|---|---|---|---|
| 09:36:43.878 | `chatMessageHook` writes `Orchestrator` | `Orchestrator` ✓ | `session.ts:122` |
| 09:37:04.384 | `resolveAgent()` for first dispatch (M14 pass) | `Orchestrator` ✓ | `dispatch-before.ts:46` |
| 09:37:04.5xx | CLI subprocess `dbWriteSessionMap(Orch_sid, "CI-CD-Agent", ...)` | **`CI-CD-Agent`** ❌ | `dispatch-subagent.ts:688` |
| 09:37:04.612 | `resolveAgent()` after CLI returns | `CI-CD-Agent` ❌ | `agent-resolver.ts:102` |
| 09:37:12.419 | Second dispatch M14 check | `CI-CD-Agent` ❌ → BLOCKED | `dispatch-before.ts:46` |

**Concurrent safety audit (3 defects)**:

| Defect | Description | Scope |
|---|---|---|
| Vector 1 (CLI pre-write) | CLI unconditionally writes target agent under caller's session ID — always pollutes on every dispatch | Every dispatch from any session |
| Vector 2 (wrapper fallback) | After CLI pollution, wrapper reads back polluted value and re-writes it; or falls back to `args.agent_type` when no entry exists | Every dispatch (reinforces Vector 1) |
| TOCTOU (same session parallel) | Two parallel dispatches both write their `agentType` under the same caller session ID — last-write-wins race | Same session, parallel dispatches |

**Why "dispatch in parallel" is the wrong fix**: The user's proposed fix (dispatch both agents in parallel in the same message) would trigger the TOCTOU race on top of the deterministic Vector 1 pollution, making the result non-deterministic rather than reliably blocked. The root cause is the session_map write logic, not dispatch ordering.

**Impact**:

- Every multi-dispatch session has its caller identity overwritten by the first dispatch's target agent type.
- M14 enforcement becomes unreliable for any session dispatching more than one sub-agent.
- The framework appears healthy for single-dispatch sessions while multi-dispatch flows are silently broken.

Fix (Phase H):

- **H1 (primary fix)**: `dispatch-subagent.ts:688` — stop writing `agentType` (the dispatch target) under the caller's `OPENCODE_SESSION_ID`. Read the existing `session_map.agent` first and pass it unchanged, preserving the caller's identity while still writing `dag_task_id` for DB-canonical state. (DB-canonical: `session_map.agent` is `TEXT NOT NULL`, and `dbWriteSessionMap` has no COALESCE path for agent, so the fix cannot be "delete the write" — it must be "read and preserve".)
- **H2 (secondary fix)**: `dispatch_subagent.ts:733-739` — never use `args.agent_type` as the agent for the caller's session. Only update `dag_task_id` and `domain_id` when `existing?.agent` is already present; skip otherwise (the wrapper has no DB-canonical need to write agent — its sole purpose is to bind `dag_task_id`/`domain_id` for the ongoing dispatch).
- **H3 (defense in depth)**: `session.ts:64` — when `input.agent` is empty, fall back to sentinel `"main"` instead of returning early, ensuring the main session always has a non-pollutable session_map entry before any dispatch.

### P0-6: UC7-001 shell command parsing has four distinct bypass vectors

Evidence:

- **Vector A — Missing tools in `isModifyTool`** (`tool-scope.ts:8-9`): The allowlist is hardcoded to `write|edit|safe_edit|safe_mkdir|safe_delete|safe_shell`. The OpenCode built-in `bash` tool (`settings.json:19`, `permission-isolation-core.ts:109 VALID_TOOLS`, `hook-config-guard.ts:71 shellTools`) is not in `isModifyTool`. `apply_patch` (environment-specific; not in current `opencode.json`) is similarly absent. `scope-before.ts:48` and `checklist-before.ts:59` both early-return on `!isModifyTool(tool)`, so UC7-001 knowledge attestation never runs for these tools. The only defense for `bash` is `opencode.json` blanket `"bash": "deny"` across all agents — but this is the **permission layer**, not the knowledge layer; granting `bash` to any agent (e.g. @Super-Admin for framework repair) immediately opens the UC7-001 bypass.
- **Vector B — Command-chain first-token anchoring** (`tool-scope.ts:17`): `isModifyShell` regex `/^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch)\b/` anchors on the first token only. Verified bypasses:
  - `cd && python3 evil.py` → first token `cd` not in list → `false` → `read_only_shell`.
  - `pwd && sed -i 's/x/y/' .opencode/lib/x.ts` → first token `pwd` → `false`.
  - `true && python3`, `echo && python3` → `false`.
- **Vector C — `parseShellWriteTargets` first-token anchoring** (`tool-scope.ts:71`): `const cmdMatch = trimmed.match(/^(\S+)/);` — same first-token gate. When `isModifyShell` returns true, the parser still ignores `;`, `|`, `&&`, `||` chains. Example: `cp a b; python3 -c "open('.opencode/lib/x.ts','w').write(...)"` is classified as a `cp` write with target `[b]`; the embedded `python3` write against a UC7-001-protected path is not parsed and not attested.
- **Vector D — Heredoc / stdin redirect** (`tool-scope.ts:180`): Only `-c` (python3) and `-e` (node/bun) are treated as unparseable modify. `python3 <<'EOF'\nopen('.opencode/lib/x.ts','w').write('...')\nEOF` falls into line 185-188 and is classified `read_only_shell`. Same for `python3 < script.py`, `node < script.js`, `python3 -` (dash-from-stdin).
- **Root-cause unification**: Vectors B/C/D share a single root cause — **no shell AST parsing**. The fix is not four independent patches; it is one shell-tokenizer upgrade that covers command chains, redirections, heredocs, and stdin.

Impact:

- Any agent with `safe_shell` permission can write to `.opencode/**`, `docs/review/**`, `contract.yaml`, `opencode.json` without prior `knowledge_cache_search` or `config_read_attested`, by prepending a non-listed lead command.
- Any agent granted `bash` (permission layer) completely bypasses the knowledge layer.
- `framework-enforcer.ts` and `hook-config-guard.ts` remain effective (they do not depend on `isModifyShell`), but they enforce different invariants (path policy / hook bypass) and do not substitute for UC7-001.
- MCP tools (`compliance_gate_*`, etc.) run in a separate subprocess and are not intercepted by `tool.execute.before` hooks at all; their write permissions are governed by their own in-process `framework-enforcer` API calls and `opencode.json` `safe_edit.write` scope on the invoking agent. This path is not covered by this audit.

Fix (Phase I):

- **I1 (tool coverage)**: Add `bash` and `apply_patch` (and any future shell-capable tool) to `isModifyTool` — or, safer, add a **parallel shell-tool allowlist** in `scope-before.ts` (mirror `hook-config-guard.ts:71 shellTools = ["safe_shell", "bash"]`) that forces UC7-001 checks regardless of `isModifyTool` result.
- **I2 (shell AST tokenization)**: Replace `^(\S+)` anchoring with a shell-aware tokenizer that splits on `;`, `&&`, `||`, `|`, `<`, `<<`, `>`, `>>` and evaluates **every sub-command** against `isModifyShell`/`parseShellWriteTargets`. Any sub-command whose lead token is in the modify list marks the whole command as `unparseable_modify_shell` (strict-mode block) unless all parsed write targets pass UC7-001.
- **I3 (heredoc / stdin detection)**: In `parseShellWriteTargets`, treat `<<` (heredoc), `< file` (stdin redirect), and `-` (dash-from-stdin) on `node`/`bun`/`python3`/`sh`/`bash` as `unparseable_modify_shell`, not `read_only_shell`.
- **I4 (MCP-tool write audit — out of scope for code fix, tracked separately)**: Catalog all MCP tools that write to the filesystem (`compliance_gate_complete` deliverables write, etc.) and confirm each tool's implementation invokes `framework-enforcer` APIs that enforce `config_read_attested` + `knowledge_attested` on their write targets. No code change in `tool-scope.ts`; this is a MCP-server audit task.

### P0-7: `task-before.ts:250-252` DISPATCH_TOKEN hash verification has a trailing-newline regex bug — blocks ALL `Task()` calls in strict/locked mode

Evidence:

- **Discovery context**: On 2026-06-22 at 11:40 UTC, two sequential `dispatch_subagent` calls succeeded from a single `@Orchestrator` session (`ses_11289bdaeffeewvWqD634Pvtjn`):
  - `dispatch_subagent(CI-CD-Agent, dag_task_id=E2E-FINAL-CICD-003)` at 11:40:12 UTC — `dispatch-before` logged `exit (pass)`.
  - `dispatch_subagent(Architect, dag_task_id=E2E-FINAL-ARCH-003)` at 11:40:21 UTC — `dispatch-before` logged `exit (pass)`.
  - Both calls produced dispatch files (6392 and 6082 chars respectively) and registered entries in `.auto-dispatch.json`.
- **Task() failure**: Both subsequent `Task()` calls were **blocked** by `DISPATCH-INTEGRITY-HASH-MISMATCH`:
  - `task-before-runtime.log:160`: `expected=dba93a8d01928397... | got=3679e61bb002da66...` (CI-CD-Agent)
  - `task-before-runtime.log:162`: `expected=63a6db650076da79... | got=e1fb498b9eb31f4e...` (Architect)
- **Auto-dispatch bridge succeeded**: `task-before-runtime.log:159` shows `AUTO-DISPATCH-CONSUMED | Loaded full prompt (6392 bytes) from ...dispatch-CI-CD-Agent-2026-06-22T11-40-12-338Z.md | match=exact (agentType+sessionId)`. The original dispatch file was loaded **verbatim** — the failure is purely in the hash verification step, not in prompt transmission.
- **Reproducibility**: A fresh dispatch generated at 11:54 UTC with a test description also produced a mismatch (`token=2211e1500139b315... | sha256=010bee04a56a549c...`). The bug is **100% reproducible** — every dispatch file on disk fails hash verification.

Root cause:

- `dispatch-subagent.ts:941` computes `resolvedPrompt` (the wrapped prompt after template resolution). The prompt template **always** ends with `\n` (the closing `---` block separator).
- `dispatch-subagent.ts:961-964` computes `dispatchToken = sha256(resolvedPrompt)` — hashes the prompt **including** its trailing `\n`.
- `dispatch-subagent.ts:965` writes `tokenizedPrompt = resolvedPrompt + "\n//DISPATCH_TOKEN:" + dispatchToken` to the output file. The file content is: `resolvedPrompt\n//DISPATCH_TOKEN:<hash>`.
- `task-before.ts:250-252` strips the token to recover `cleanPrompt`:
  ```typescript
  const cleanPrompt = prompt
    .replace(/\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "")  // step 1: strip token line
    .replace(/\n+$/, "");                                 // step 2: strip trailing newlines
  ```
  - **Step 1** removes `//DISPATCH_TOKEN:<hash>`, leaving `resolvedPrompt\n` (the `\n` from `"\n//DISPATCH_TOKEN:"`).
  - **Step 2** `/n+$/` strips **ALL** trailing newlines — both the template-literal `\n` AND `resolvedPrompt`'s own trailing `\n`.
  - Result: `cleanPrompt` = `resolvedPrompt` **minus its trailing `\n`** → 1 character shorter.
  - `sha256(cleanPrompt) ≠ sha256(resolvedPrompt) = dispatchToken` → **permanent hash mismatch**.

Minimal reproduction:

```typescript
const resolvedPrompt = "## Test\n\nContent\n\n---\n";  // ends with \n (always true)
const dispatchToken = sha256(resolvedPrompt);            // e.g., "8ce8afc1..."
const tokenizedPrompt = resolvedPrompt + "\n//DISPATCH_TOKEN:" + dispatchToken;

// task-before.ts current logic (BUGGY):
const cleanBuggy = tokenizedPrompt
  .replace(/\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "")
  .replace(/\n+$/, "");
// cleanBuggy = "## Test\n\nContent\n\n---" (36 chars, trailing \n stripped)
// sha256(cleanBuggy) ≠ dispatchToken  ← MISMATCH

// Fixed logic:
const cleanFixed = tokenizedPrompt
  .replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
// cleanFixed = "## Test\n\nContent\n\n---\n" (37 chars, original \n preserved)
// sha256(cleanFixed) === dispatchToken  ← MATCH
```

Impact:

- **ALL `Task()` calls in strict/locked mode are blocked** whenever `resolvedPrompt` ends with `\n` (which is always — the template structure guarantees it). This is a **complete dispatch chain breakage**, not an edge case.
- The bug was masked in advisory mode (logged `WARN`, allowed through). In strict/locked mode, it throws `[FW-ENFORCE][DISPATCH-INTEGRITY] Task() prompt tampered` and blocks execution.
- The auto-dispatch bridge correctly loads the original file content, so this is **not** a prompt transmission issue — the user's initial diagnosis ("手工编写 prompt 与 dispatch 输出内容不一致") was incorrect. Even a verbatim copy of the dispatch file content would fail hash verification.
- Phase H fix (session_map agent-identity preservation) is verified working — `dispatch-before` logs confirm `caller=@Orchestrator` for both dispatches. The Task() failure is **not** a Phase H regression.
- This bug has existed since `DISPATCH-INTEGRITY v2` was introduced (2026-06-18, BUG 1 FIX v2). It was not caught by `framework-self-test.ts` because the self-test does not exercise the `task-before.ts` hash verification path with prompts that end in `\n`.

Fix (Phase J):

- **J1**: `task-before.ts:250-252` — replace the two-step regex strip with a single-step regex that removes `\n//DISPATCH_TOKEN:<hash>` together, preserving `resolvedPrompt`'s original trailing newlines:
  ```typescript
  // BUGGY:
  const cleanPrompt = prompt
    .replace(/\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "")
    .replace(/\n+$/, "");

  // FIXED:
  const cleanPrompt = prompt
    .replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
  ```
- **J2**: `framework-self-test.ts` — add a round-trip hash test: generate a `resolvedPrompt` ending with `\n`, compute `dispatchToken = sha256(resolvedPrompt)`, build `tokenizedPrompt`, run the `task-before.ts` strip logic, and assert `sha256(cleanPrompt) === dispatchToken`.
- **J3**: Verify fix against all existing dispatch files on disk — the corrected regex should produce `MATCH: true` for every file that the current regex fails on.

### P0-8: `checklist-before.ts` session_map bridge only fires for `Task()`, leaving modify tools with `task_id=null` run

Evidence:

- `checklist-before.ts:172-178` (P0-4 FIX) only bridges session_map for `Task` / `task`:
  ```typescript
  if (!taskId && (toolName === "Task" || toolName === "task")) {
    try {
      const { dbReadSessionMap } = require("../lib/db-state-manager");
      const entry = dbReadSessionMap(input.sessionID);
      if (entry?.dag_task_id) taskId = entry.dag_task_id;
    } catch { /* non-fatal */ }
  }
  ```
- When `safe_edit` (or any modify tool) is called without explicit `task_id`, `resolveChecklistRun()` receives `taskId=undefined` and creates a new checklist run with `task_id=null` (Run-B).
- Run-A (created by an earlier `dispatch_subagent` or `Task()` call that DID have `task_id`) holds the `config_read_attested` and `knowledge_attested` items.
- Run-B does NOT have those items → `requireChecklistPassed()` returns `passed: false` → `P0-CHECKLIST-BLOCKED`.
- This means: even after completing the full attestation flow, the agent cannot modify files because the checklist check looks at the wrong run.

Root cause:

- The P0-4 session_map bridge was correctly designed but scoped too narrowly — it only applied to `Task()` calls, not to modify tools that also need `task_id` to find the right checklist run.

Impact:

- ALL modify tool calls in strict/locked mode are blocked after attestation, unless the caller passes explicit `task_id` or `dag_task_id` in tool args (which most agents don't do for `safe_edit`).
- The dispatch flow is effectively broken end-to-end: attest → dispatch → edit all require the same run, but edit creates a new run.

Fix (Phase K — **implemented**):

- **K1**: Extracted `resolveChecklistTaskId(input)` helper in `checklist-before.ts:138-159`:
  ```typescript
  function resolveChecklistTaskId(input: any): string | null {
    const explicit = input.args?.task_id || input.args?.dag_task_id || null;
    if (explicit) return explicit;
    try {
      const { dbReadSessionMap } = require("../lib/db-state-manager");
      return dbReadSessionMap(input.sessionID)?.dag_task_id || null;
    } catch { return null; }
  }
  ```
- **K2**: Resolved `taskId` early (line 168, before Step 9 role audit) so ALL tools — modify, Task, dispatch, gate — use the same bridge.
- **K3**: Replaced old P0-4 inline bridge (lines 167-178) with `const taskId = resolveChecklistTaskId(input)`.
- **K4**: Added `framework-self-test.ts` check 64e verifying `resolveChecklistTaskId` exists and Task-only bridge pattern is absent.

### P1-1: Prompt order is improved but not exactly the target structure

Evidence:

- `dispatch-subagent.ts` now builds:
  - `## SUBAGENT`
  - `### Task Payload`
  - `### Your Scope`
  - `### P0 Protocol`
  - deliverables
  - agent config
  - project context
- The plan target was stricter:
  1. `## Task Payload`
  2. `## P0 Checklist`
  3. Agent config pointer
  4. Project context summary
  5. Context7 requirements only when matched
  6. Scope line
- Latest CI-CD-Agent dispatch file (`.task_temp/_dispatch/dispatch-CI-CD-Agent-2026-06-22T09-37-04-504Z.md`) is 183 lines, of which only the 39-line preamble is slimmed (R1 SLIM, 2026-06-19); P0/deliverables/project context/Context7/audit trail are still inlined.
- Framework-only E2E dispatch still receives NestJS/Prisma/Redis/Angular Context7 block (lines 162-169) because `context7_task_mapping` keyword matching is too coarse.
- `### Execution Order` (lines 178-183) duplicates preamble `Steps` (lines 75-84).
- `## 🔑 Your Permissions` + `Conflict Resolution` (lines 125-137) repeats information already governed by `opencode.json` + `framework-authorities.json` at runtime.

Impact:

- The largest attention-order issue has been reduced because task content appears before the P0 protocol.
- It is still not an exact implementation of the agreed shape, and the scope block still appears before the P0 checklist block.
- Business-stack Context7 injection adds noise to framework-only tasks, diluting agent attention.

Fix:

- Apply the **conservative 7-phase plan (Phase G below)**:
  1. `## Task Payload`
  2. `## P0 Checklist`
  3. Agent config pointer
  4. Project context summary
  5. Context7 requirements, only when matched **and not framework-exempt**
  6. Scope line (moved to end)
- Include `payload_sha256` and `payload_ref` in both DB and prompt.
- Expected result: CI-CD-Agent dispatch 183 → ~115 lines (-37%), zero hard-constraint impact (all hard constraints are enforced by code, not prompt text).

### P1-2: `knowledge_cache_search` domain-first is only partially implemented

Evidence:

- Direct `searchByDomain(args.domain)` now exists.
- It is inside the `domainKeywords.length > 0` branch.
- If a valid domain lacks semantic keywords, direct domain search is skipped.

Impact:

- The stated requirement is "domain field first", independent of semantic keyword availability.
- Domain-only supplemental documents can still be missed if semantic map coverage is incomplete.

Fix:

- Run `searchByDomain(args.domain)` whenever `args.domain` exists.
- Then run semantic/tag fallback only if domain keywords exist.
- Deduplicate results.

### P1-3: `p0_checklist_policy` still is not consumed

Evidence:

- `.opencode/project.config.json` contains `p0_checklist_policy`.
- `checklist-before.ts` does not read it and does not call path-scope helpers for monitored/excluded targets.
- Modify tools always require `config_read_attested` and `knowledge_attested`.

Impact:

- Excluded paths can be over-blocked.
- Monitored target semantics are not DB-canonical.
- The plan's "policy snapshot" requirement remains unmet.

Fix:

- Snapshot `p0_checklist_policy` into the checklist run.
- Exclusion must be evaluated before inclusion.
- Modify-tool blockers should be selected by target path:
  - excluded path: no checklist blocker.
  - monitored path: require `knowledge_search_completed` + `knowledge_attested`.
  - framework/config-sensitive path: also require `config_read_attested`.

### P1-4: `compliance_gate_complete` prerequisite may over-block exempt direct completion

Evidence:

- `checklist-before.ts` now requires `deliverables_approved` before `compliance_gate_complete`.
- Existing gate design allows exempt agents and some combined flows to complete directly.

Impact:

- The previous `gate_closed` deadlock is fixed, but this replacement may be too broad.
- Orchestrator, Super-Admin, Knowledge-Curator combined flows, or other exempt flows may be blocked unless they synthesize `deliverables_approved`.

Fix:

- Resolve target gate session and inspect `approval_required`.
- If `approval_required=false`, do not require `deliverables_approved`.
- If approval is required, require `read_before_approve_verified` and `deliverables_approved`.

### P1-5: Self-test does not catch the runtime checklist failures

Evidence:

- Checks 64-66 pass.
- Check 65 validates `validateDispatchPayload()` directly but does not verify dispatch marks checklist facts.
- Check 66 still does not exercise the real `knowledge_cache_search()` edge case for domain-without-keywords.
- Current self-test reports `ALL 64 CHECKS PASSED`, but the temp-DB dispatch CLI verification still found no checklist run/item writes.

Impact:

- Harness can still report checklist infrastructure OK while the runtime flow is incomplete.

Fix:

- Add temporary-DB behavior checks:
  - run creation creates all items,
  - dispatch marks all dispatch facts,
  - `Task()` blocks before dispatch facts and passes after them,
  - gate facts are written to the same OpenCode run that before-hooks inspect,
  - path policy exclusions are honored,
  - domain-first search works without semantic keywords.

## 5. Todo Integration Recommendation

### 5.1 Should Todo Be Integrated?

Yes, but only as a **DB checklist projection layer**, not as a source of truth.

Official OpenCode facts from local official docs:

- `todowrite` manages todo lists during coding sessions and is disabled for subagents by default unless enabled manually.
- The permission key is `todowrite`.
- The permission gates both `todowrite` and `todoread`, but is not granular.
- OpenCode exposes the `todo.updated` plugin event.

Current project state:

- `todowrite` is explicitly allowed in `opencode.json` only for Orchestrator, Super-Admin, and Knowledge-Curator.
- Several subagent configs now mention `checklist_status`, but most subagents do not have `todowrite` runtime permission.
- No DB-derived todo projection, `suggested_todos`, or `TODO-DB-DRIFT` mechanism exists.

### 5.2 Design Principle

```text
execution_checklist_items = authority
todowrite/todoread = UI and short-term work queue projection
todo.updated = audit/drift signal
todo completed != checklist passed
```

Todo must not mark checklist items passed. Only the relevant tool, MCP gate, or plugin verifier can write authoritative `passed` / `failed` status to DB.

### 5.3 Proposed Todo Projection Layer

Add a non-authoritative projection layer:

1. `checklist_status` returns `suggested_todos`.
2. Orchestrator/Super-Admin/Knowledge-Curator may call `todowrite` to mirror those todos.
3. Todo statuses are derived from DB:
   - DB `passed` -> todo `completed`
   - current phase first blocker -> todo `in_progress`
   - DB `pending` / `failed` -> todo `pending`
4. `todo.updated` hook records todo changes and compares them to DB checklist state.
5. If todo is marked completed while DB item is not passed:
   - write `TODO-DB-DRIFT`,
   - re-project from DB on next `checklist_status` or before-hook,
   - do not unblock any tool.

### 5.4 Integration Sequence

Do not integrate todo before fixing P0 checklist flow. Recommended order:

1. Fix dispatch facts and `Task()` unblock path.
2. Fix gate/OpenCode run identity binding.
3. Fix path policy enforcement.
4. Add `checklist_status.suggested_todos`.
5. Add `todo.updated` drift audit.
6. Keep `todowrite` enabled only for Orchestrator, Super-Admin, and Knowledge-Curator during rollout.
7. After stable behavior tests pass, decide whether to enable `todowrite` for Coder/Guardian roles.

### 5.5 Expected Gains

- Agents see a compact current work queue instead of the full P0 protocol.
- Orchestrator can observe progress without querying raw DB tables.
- Handoffs can include a final todo projection snapshot.
- Drift between model-declared progress and DB-verified progress becomes auditable.

### 5.6 Non-Goals

- Todo is not a gate.
- Todo does not grant permissions.
- Todo does not write `execution_checklist_items.status`.
- Todo does not replace `checklist_status`.

---

## 6. Recommended Fix Sequence

### Phase A: Finish dispatch handoff

1. Keep `dispatch_subagent` exempt from requiring dispatch facts before it runs.
2. Move dispatch role/event handling before the `required === null` return in `checklist-before.ts`.
3. Import or directly implement the checklist writer used by `dispatch-subagent.ts`; `checklistWirePassed` must not be an undefined global.
4. Mark `payload_complete`, `dispatch_token_created`, and `session_context_bound` from dispatch after the corresponding facts are actually created.
5. Make checklist marking failure fatal in strict/locked mode.
6. Remove the duplicate CLI invocation in `dispatch_subagent.ts`, or pass the identical execution context to both invocations.
7. Ensure `Task()` requires those three dispatch facts.

Acceptance:

- `dispatch_subagent` succeeds in strict mode.
- `Task()` fails without dispatch facts.
- `Task()` passes after dispatch creates and marks all dispatch facts.
- Temp-DB dispatch CLI test shows the expected run and three `passed` dispatch items under the OpenCode session id.

### Phase B: Bind gate facts to the same execution run

1. Map gate session id to OpenCode session id.
2. Update gate checklist wiring to write to the OpenCode execution run.
3. Handle exempt and non-exempt completion flows separately.

Acceptance:

- `compliance_gate_confirm`, submit, approve, and complete update the same run checked by before-hooks.
- Exempt direct complete does not require `deliverables_approved`.

### Phase C: Implement policy-driven write enforcement

1. Snapshot `p0_checklist_policy` into each run.
2. Use monitored/excluded target matching in `checklist-before.ts`.
3. Add behavior tests for excluded and monitored targets.

Acceptance:

- `.task_temp/**` and other excluded targets are not over-blocked.
- Monitored targets require the appropriate knowledge/config items.

### Phase D: Finish tool exposure

1. Add `checklist_status` permission to `opencode.json` for all relevant agents.
2. Add a self-test that checks both runtime permission and agent md declaration.

Acceptance:

- Every relevant agent can actually call `checklist_status`.

### Phase E: Add todo projection after P0 flow is stable

1. Add `suggested_todos` to `checklist_status`.
2. Add a todo projection helper.
3. Add `todo.updated` drift logging.
4. Keep todo non-authoritative.

Acceptance:

- Todo panel reflects DB checklist status after projection.
- Todo/DB mismatch is logged and corrected, not trusted.

### Phase F: Strengthen self-test

1. Add a temporary DB checklist runtime test.
2. Add a dispatch fact E2E test.
3. Add a gate identity E2E test.
4. Add domain-first-without-keywords test.
5. Keep Check 33 queue health green.

Acceptance:

- Current known failures would fail the harness.
- Harness passes only when the checklist flow is actually usable.

### Phase G: Conservative dispatch-prompt refinement (resolves P1-1)

**Design intent**: Reduce the wrapper from 183 → ~115 lines (-37%) without weakening any of the 12 hard constraints listed in the table below. The preamble (39 lines) stays **fully inlined** as the safety margin — agent receives P0 rules immediately, independent of any `read` call.

**Why conservative, not aggressive**: Aggressive plan (preamble/deliverables/project-context → file references, target ~55 lines) saves an additional ~60 lines but introduces 3 hidden costs: (1) preamble attestation gap in `config_read_attest`, (2) net token loss when agent must `read` the preamble every dispatch, (3) new failure surface when `read` fails. The conservative plan captures ~70% of the aggressive token savings at zero hidden cost.

**Hard-constraint audit** (verified against live code on 2026-06-22):

| Hard constraint | Enforced by | Prompt-dependent |
|---|---|---|
| P0 checklist phase block | `checklist-before.ts` (`withPluginLifecycle` + `tool.execute.before`) | No |
| `config_read_attest` 3-file read | `config_read_attest.ts` + `scope-before.ts` | No |
| Knowledge pipeline 4-step | 4 tools in series + `scope-before.ts` | No |
| Empty `files_read` rejection | `knowledge_cache_attest.ts:302-320` | No |
| compliance gate check/confirm/submit/complete | `compliance-gate.ts` state machine | No |
| `declared_deliverables` mandatory | `compliance_gate_confirm` arg validation | No |
| HANDOVER `## Logs Checked` + `## Findings` | Gate approval reads artifact | No |
| `question: deny` for subagents | `question-policy-before.ts` hook | No |
| Write-permission scope | `opencode.json` + `framework-authorities.json` | No |
| Scope routing (@Orchestrator / @Super-Admin) | `framework-enforcer.ts` + `route_rules` | No |
| Dispatch payload integrity | `validateDispatchPayload()` + `checklist-before.ts` | No |
| `checklist_status` must-call | `checklist-before.ts` blocks writes | No |

All 12 constraints are code-enforced. All deletions in Phase G are **informational redundancy only**.

#### G1 — Context7 framework-task short-circuit (target: -8 lines)

File: `.opencode/scripts/command-tools/dispatch-subagent.ts:306-360` (relevantStacks computation).

```typescript
// Phase G1: framework / checklist / DB / self-test tasks must not trigger
// business-stack Context7 injection.
const FRAMEWORK_TASK_KEYWORDS = [
  "framework-self-test", "checklist", "db-canonical", "p0-checklist",
  "dispatch-subagent", "subagent-preamble", "scope-before",
  "checklist-before", "execution-checklist", "framework-doctor",
  "e2e-final", "e2e-test", "framework-state.db",
];
const isFrameworkTask = FRAMEWORK_TASK_KEYWORDS.some((k) =>
  taskDescription.toLowerCase().includes(k),
);
const relevantStacks = isFrameworkTask
  ? []
  : computeRelevantStacks(taskDescription, taskMapping);
```

Acceptance: CI-CD-Agent E2E-checklist dispatch no longer contains the NestJS/Prisma/Redis/Angular block (currently lines 162-169).

> **Configuration alternative (preferred)**: Move the keyword list to `project.config.json` as a new `context7_task_mapping` sibling field `context7_exempt_task_keywords: [...]`, so the script stays declarative. Either form is acceptable; the config form is preferred for long-term maintainability.

#### G2 — Remove wrapper redundancy (target: -34 lines)

File: `dispatch-subagent.ts:862-941` (`wrappedPrompt` template). Delete:

| Section | Lines | Reason |
|---|---|---|
| `### Execution Order` | 6 | Duplicates preamble `Steps` (lines 75-84) |
| `R1 SLIM` inline explanation | 3 | Covered by preamble Step 0e |
| `## 🔑 Your Permissions` block | 14 | Governed by `opencode.json` at runtime |
| `### Conflict Resolution` | 8 | Governed by `framework-authorities.json` at runtime |
| KC `M17 — [INSUFFICIENT] attest handling` paragraph | 3 | Remediation already in `knowledge_cache_attest` return |

Acceptance: Wrapper template shrinks by ≥30 lines; no agent behavior change in live dispatch smoke test.

#### G3 — Deliverables template collapse (target: -15 lines)

File: `.opencode/lib/deliverables-templates.ts` (`deliverablesTemplateMarkdown()`).

- **Keep**: file name + `artifact_path` + `required` flag (aligned with `optimization-plan §Step 7 L371`).
- **Delete**: `HANDOVER.md Optional Sections` detail block (Questions for User / Assumptions / Blocked Actions).
- **Replace** with one line: `HANDOVER.md optional sections (Questions/Assumptions/Blocked) — format returned by compliance_gate_submit_deliverables remediation.`

Acceptance: CI-CD-Agent dispatch lines 104-113 disappear; gate still enforces full structure at submit time.

#### G4 — Project context field filter (target: -7 lines)

File: `dispatch-subagent.ts:540-600` (projectContext construction).

```typescript
// Phase G4: only inject fields relevant to the current agent's work surface.
const PROJECT_CONTEXT_FIELDS_BY_AGENT = {
  "CI-CD-Agent": ["project", "project_root", "ci_cd", "container"],
  "Coder-BE":    ["project", "project_root", "backend", "database", "cache", "queue", "auth", "testing"],
  "Coder-FE":    ["project", "project_root", "frontend", "testing"],
  Architect:      ["project", "project_root", "contracts"],
  // default: include all fields
};
```

Acceptance: CI-CD-Agent project-context block shrinks from 9 tech_stack fields to 2.

#### G5 — Dedupe preamble task_id injection (target: -2 lines)

File: `dispatch-subagent.ts:661-665`. Remove the preamble-suffixed `> **Your dispatch-assigned task_id**:` line; Task Payload already has `- **task_id**: ...` as the canonical field.

Acceptance: Task id appears exactly once in the dispatch output, in Task Payload.

#### G6 — Merge Mandatory Audit Trail into Task Payload (target: -4 lines)

File: `dispatch-subagent.ts:930-933`. Replace 4-line `### 📊 Mandatory Audit Trail` section with one Task Payload bullet:

```
- **Invocation Summary**: append `## 📊 Invocation Summary` to output and `.task_temp/_dispatch/INVOCATION_SUMMARY.md`
```

Acceptance: Audit trail requirement is still visible (now in Task Payload), agent behavior unchanged.

#### G7 — Move Scope Line to end (target: 0 lines, alignment fix)

File: `dispatch-subagent.ts:871-872`. Relocate `${scopeLine(agentType)}` block from between Task Payload and P0 Protocol to **after Project Context** (immediately before the new Execution Order placeholder).

Acceptance: Prompt order becomes exactly the plan target: Task Payload → P0 Checklist → Agent Config → Project Context → Context7 (when matched) → Scope Line. User's real task content is no longer interrupted by the scope block between payload and P0.

#### G8 — Preserve one-line Conflict Resolution hint in scopeLine (target: +~20 chars)

To compensate for the `Conflict Resolution` section deletion in G2, append ` | opencode.json 权威` to each `scopeLine()` entry so the agent retains a planning-time hint:

```typescript
"CI-CD-Agent":
  "Write: .github/, Dockerfile*, docker-compose* | Deny: business code (src/), .opencode/agents/ | Route: @Orchestrator | opencode.json 权威",
```

Acceptance: Agent can still predict `opencode.json` authority before hitting the runtime block; no behavioral regression.

#### Phase G cumulative impact

| Sub-phase | Δ lines | Cumulative dispatch lines |
|---|---|---|
| Baseline (2026-06-22 CI-CD-Agent) | — | 183 |
| G1 Context7 framework short-circuit | -8 | 175 |
| G2 Wrapper redundancy removal | -34 | 141 |
| G3 Deliverables collapse | -15 | 126 |
| G4 Project context filter | -7 | 119 |
| G5 task_id dedupe | -2 | 117 |
| G6 Audit Trail merge | -4 | 113 |
| G7 Scope Line reorder | 0 | 113 |
| G8 scopeLine hint append | +0.3 (chars only) | ~113 |
| **Total** | **~-70** | **~113 (-38%)** |

#### Phase G non-goals (explicitly out of scope)

- **No file-reference conversion** for preamble, deliverables, or project context. Aggressive plan is deferred to a follow-up phase pending Phase J (preamble attestation expansion) and Phase K (`preamble_read_completed` blocker) as prerequisites.
- **No change to preamble content** (39 lines, already slim).
- **No change to hard-constraint enforcement** (all 12 constraints remain code-enforced).
- **No new `checklist_status` projection layer** — that is Phase E.

#### Phase G acceptance (overall)

- CI-CD-Agent dispatch for framework-only E2E task: ≤ 120 lines.
- Framework-only task dispatch contains no business-stack Context7 block.
- Preamble (39 lines) remains fully inlined at top of wrapper (after Task Payload).
- `framework-self-test.ts` Check 34 / Check 47 / Check 63 still green (short preamble markers retained).
- Zero behavioral regression in live dispatch smoke test across CI-CD-Agent, Coder-BE, Coder-FE, Architect, Orchestrator.
- All 12 hard constraints from the audit table above remain code-enforced; no prompt-text dependency introduced.

### Phase H: Fix session_map agent-identity pollution and TOCTOU race (resolves P0-5)

**Design intent**: Eliminate the root cause of the M14 false-positive on sequential multi-dispatch sessions and the TOCTOU race on parallel dispatches. The fix is surgical — three targeted changes, no architectural redesign.

**Root-cause summary** (see P0-5 for full log-verified evidence chain): Two pollution vectors exist. The **primary** vector is `dispatch-subagent.ts:688` (CLI subprocess), which unconditionally writes the target `agentType` under the caller's `OPENCODE_SESSION_ID` on every dispatch — this was introduced as "P2-FIX R2" to prevent `DISPATCH_TASKID_TAMPER` but the implementation targets the wrong session_map key. The **secondary** vector is `dispatch_subagent.ts:738` (tool wrapper), whose `|| args.agent_type` fallback reinforces the CLI's pollution and would independently pollute when no prior session_map entry exists. Together they cause `resolveAgent(caller_sid)` in `dispatch-before.ts:46` to return the first dispatch's target agent type for any subsequent dispatch in the same session.

**Auto-dispatch / `auto_plan=true` interaction**: The self-healing `auto_plan` path (`dispatch_subagent.ts:284-340`) is itself a pollution vector. When @Orchestrator calls `dispatch_subagent(agent_type="CI-CD-Agent", auto_plan=true)` on an unplanned task, the wrapper first dispatches @Meta-Planner (which invokes the CLI subprocess and writes `agent="Meta-Planner"` under the caller's session ID via the bug in `dispatch-subagent.ts:688`). After @Meta-Planner finishes, the wrapper re-runs the original dispatch and again writes `agent="CI-CD-Agent"` under the same caller session ID. In a multi-dispatch session the caller's identity can be overwritten twice — first to `Meta-Planner`, then to the final target — and any subsequent dispatch in that session reads polluted identity from `session_map` and false-triggers M14. The auto-dispatch queue in `.auto-dispatch.json` (consumed by `task-before.ts:86-186`) is **not** itself a pollution vector: it only reads the marker file and injects the prompt; it does not write `session_map`. The `auto-dispatch-oldest` fallback at `task-before.ts:129` is also read-only with respect to `session_map`. Therefore Phase H (fixing the two write vectors) covers auto-dispatch flows completely, and the auto-plan path must be explicitly included in the Phase H smoke test (H4 below).

#### H1 — Fix CLI subprocess session_map write to preserve caller agent (primary fix)

File: `.opencode/scripts/command-tools/dispatch-subagent.ts:677-703`

**DB-canonical constraint**: `session_map.agent` is `TEXT NOT NULL` and `dbWriteSessionMap` has no SQL path that COALESCE-preserves the agent field (all 4 paths overwrite it from the parameter). Therefore the fix is **not** to delete the write (which would lose `dag_task_id` from DB-canonical state), but to **read the existing agent first and pass it unchanged**.

**Before (bug — P2-FIX R2):**
```typescript
// P2-FIX R2: Pre-write session_map BEFORE generating prompt
const sessionId = process.env.OPENCODE_SESSION_ID || "";
if (sessionId) {
  dbWriteSessionMap(sessionId, agentType, taskId);
  //                ↑ caller sid  ↑ "CI-CD-Agent" — POLLUTES caller identity
}
```

**After (fix — FW-FIX-H1, DB-canonical safe):**
```typescript
// FW-FIX-H1: Read existing agent from DB-canonical session_map, preserve it.
// session_map.agent is TEXT NOT NULL — every write must supply the correct value.
// The caller's agent is the one already stored, NOT the dispatched target agentType.
const sessionId = process.env.OPENCODE_SESSION_ID || "";
if (sessionId) {
  const existing = dbReadSessionMap(sessionId);
  const callerAgent = existing?.agent || agentType; // fallback only for brand-new sessions
  dbWriteSessionMap(sessionId, callerAgent, taskId);
}
```

**Why not delete the write entirely**: In the DB-canonical model, `session_map` is the authoritative source for `dag_task_id`. Downstream enforcement (`DISPATCH_TASKID_TAMPER` check in `scope-before.ts`, `resolveTaskId()` in `agent-resolver.ts`) reads `dag_task_id` from `session_map`. Deleting the CLI write would leave `dag_task_id` as NULL until the wrapper's write at line 736, creating a window where DB-canonical state is incomplete. The per-dispatch `ctx/` files (lines 708-723) are a secondary fallback, not the primary authority.

**Fallback semantics for `existing?.agent || agentType`**: This fallback only fires when `chatMessageHook` has not yet created the session_map row (brand-new session, first-ever dispatch). In that edge case, `agentType` (the dispatched target) is the only available identity — but this is acceptable because:
1. The session has no prior identity to preserve (no pollution possible).
2. `chatMessageHook` will overwrite it with the correct agent on the next `chat.message` event.
3. H3 (session.ts fallback) eliminates this edge case entirely by ensuring the main session always has an entry.

Acceptance: After `dispatch_subagent(CI-CD-Agent)`, `dbReadSessionMap(caller_sid).agent` still equals the caller's actual identity (Orchestrator/Super-Admin), and `dag_task_id` is written to DB-canonical state.

#### H2 — Remove agent-field fallback in tool wrapper (secondary fix)

File: `.opencode/tools/dispatch_subagent.ts:733-739`

**Before (bug):**
```typescript
if (dagTaskId && context.sessionID) {
  const existing = dbReadSessionMap(context.sessionID);
  dbWriteSessionMap(
    context.sessionID,
    existing?.agent || args.agent_type,  // ← fallback pollutes when no prior entry
    dagTaskId,
    inferredDomainId || undefined,
  );
}
```

**After (fix):**
```typescript
if (dagTaskId && context.sessionID) {
  // FW-FIX-H2: Only update dag_task_id/domain_id; never touch the agent field.
  // The agent field's sole legitimate writers are chatMessageHook (session.ts)
  // and the agent's own session startup. dispatch_subagent must not write it.
  const existing = dbReadSessionMap(context.sessionID);
  if (existing?.agent) {
    dbWriteSessionMap(
      context.sessionID,
      existing.agent,  // preserve — never substitute with args.agent_type
      dagTaskId,
      inferredDomainId || undefined,
    );
  }
  // If no existing agent: skip entirely — chatMessageHook will write it.
}
```

Acceptance: Even if the CLI fix (H1) is reverted, the wrapper alone no longer introduces pollution. Sequential dispatches remain safe.

#### H3 — Harden chatMessageHook empty-agent fallback (session.ts)

File: `.opencode/plugins/session.ts:52-144`

**Before** (line 64): `if (!sid || !agent) return;` — skips write entirely when `input.agent` is empty, leaving session_map without an entry for the main session.

**After**: When `agent` is empty, attempt to resolve the agent from the session's agent config or fall back to a sentinel value:

```typescript
// FW-FIX-H3: When input.agent is empty (main session without explicit agent),
// derive agent from session agent config or sessionID pattern.
// This ensures session_map always has an entry before the first dispatch_subagent call.
let resolvedAgent = agent;
if (!resolvedAgent && sid) {
  // Attempt: read .opencode/agents/ directory for the session's configured agent.
  // Fallback: use "main" sentinel — any value that is not a known sub-agent type
  // prevents dispatch_subagent.ts from overwriting with args.agent_type.
  resolvedAgent = "main";
}
if (!sid || !resolvedAgent) { /* log warn, return */ return; }
```

Acceptance: Main session (user's primary session) always has a session_map entry before any dispatch_subagent call. `resolveAgent(caller_sid)` returns "main" (not a sub-agent type) → M14 treats it as a non-sub-agent → privileged dispatch allowed.

#### H4 — Auto-dispatch / `auto_plan=true` smoke test

File under test: `.opencode/tools/dispatch_subagent.ts:284-340` (auto_plan flow) + `.opencode/plugins/task-before.ts:86-186` (auto-dispatch marker consumer).

**Smoke-test scenario**: From a single @Orchestrator session, issue two dispatches in sequence:
1. `dispatch_subagent(agent_type="CI-CD-Agent", auto_plan=true)` on an unplanned task (no DAG entry). This triggers the self-heal path: dispatches @Meta-Planner first, then re-runs the original dispatch.
2. `dispatch_subagent(agent_type="Architect", dag_task_id="...")` on a planned task.

**Assertions**:
- After step 1 (self-heal path): `dbReadSessionMap(caller_sid).agent` still equals `Orchestrator`, not `Meta-Planner` and not `CI-CD-Agent`. The auto-plan internal dispatch and the re-run both go through `dispatch-subagent.ts:688`, which must preserve the existing agent per H1.
- After step 2: `dbReadSessionMap(caller_sid).agent` still equals `Orchestrator`. Step 2 must not be M14-blocked.
- `.auto-dispatch.json` queue: entries are consumed by `task-before.ts` without writing `session_map`; no drift introduced.
- `dag_task_id` in `session_map` is correctly updated on both dispatches (DB-canonical invariant preserved).

Acceptance: The auto-plan self-heal path is not a hidden pollution vector. Both manual-dispatch and auto-plan-dispatch flows preserve caller identity in `session_map`.

#### Phase H concurrent safety summary

| Scenario | Before Phase H | After Phase H |
|---|---|---|
| Sequential dispatch, same session, chatMessageHook fired | Safe (agent preserved) | Safe (agent preserved) |
| Sequential dispatch, same session, chatMessageHook NOT fired | **BUG: target pollutes caller** | Safe (H1 preserves existing agent; H3 provides fallback) |
| Parallel dispatch, same session | **TOCTOU: last-write-wins race** | Safe (H2 atomic conditional update) |
| Parallel dispatch, different sessions | Safe (separate DB keys) | Safe (separate DB keys) |
| `_dispatch_target.json` fallback | Known race condition (Priority 2) | Unchanged (still Priority 2, H1+H3 reduce miss rate) |
| `auto_plan=true` self-heal dispatch of @Meta-Planner | **BUG: CLI subprocess pollutes caller identity with @Meta-Planner**, can false-trigger M14 on the subsequent real dispatch | Safe (H1 preserves caller agent; auto-plan dispatch becomes a no-op for the agent field) |
| Auto-dispatch `.auto-dispatch.json` queue consumed by `task-before.ts` | Unaffected (marker consumption does not write session_map) | Unaffected (no session_map interaction in queue path) |
| Auto-dispatch agent-mismatch fallback (`task-before.ts:129` oldest-entry strategy) | Caller identity can be stale from a prior polluted session_map read | Safe (H1 prevents pollution at source; fallback only reads, never writes) |

#### Phase H acceptance (overall)

- `dispatch_subagent(CI-CD-Agent)` then `dispatch_subagent(Architect)` in the same session: both succeed, no M14 false-positive.
- `dbReadSessionMap(caller_sid).agent` after dispatches returns the caller's actual identity, not the target sub-agent type.
- Parallel dispatches from the same session: no agent-field race.
- `chatMessageHook` always writes an entry for the main session, even when `input.agent` is empty.
- `dispatch_subagent(auto_plan=true)` self-heal path (dispatches @Meta-Planner, then re-runs): caller identity preserved across both CLI invocations.
- `framework-self-test.ts` adds a check: dispatch two agents sequentially from a test session, verify `resolveAgent()` returns the test session's identity after both; also dispatch one via `auto_plan=true` to cover the self-heal path.

### Phase I: Harden UC7-001 shell command parsing (resolves P0-6)

**Design intent**: Close the four UC7-001 bypass vectors (missing tool coverage, command-chain anchoring, parseShellWriteTargets anchoring, heredoc/stdin) with one unified shell-tokenizer upgrade plus a parallel shell-tool allowlist in `scope-before.ts`. No behavioral change for legitimate single-command shell usage; only chained / heredoc / non-listed-tool usage becomes `unparseable_modify_shell` (blocked in strict/locked mode).

**Scope boundaries**:
- **In scope**: `tool-scope.ts`, `scope-before.ts`, `framework-self-test.ts`.
- **Out of scope (tracked as I4 audit task)**: MCP-server write audit (compliance_gate_* deliverables, etc.). MCP tools bypass `tool.execute.before` hooks by architecture; their write-side enforcement is an MCP-server implementation concern, not a `tool-scope.ts` concern.

#### I1 — Expand shell-tool coverage in `scope-before.ts` (defense in depth)

File: `.opencode/plugins/scope-before.ts`

**Before**: `if (!isModifyTool(input.tool)) { return; }` — `bash` and `apply_patch` silently bypass.

**After**: Introduce a parallel `SHELL_LIKE_TOOLS` allowlist that triggers the same UC7-001 check pipeline as `safe_shell`, regardless of `isModifyTool`:

```typescript
// FW-FIX-I1: Shell-capable tools that must go through UC7-001 path parsing
// even if not in isModifyTool. Mirrors hook-config-guard.ts:71 shellTools.
const SHELL_LIKE_TOOLS = ["safe_shell", "bash", "apply_patch"];

// Only enforce scope for modify tools OR shell-like tools
if (!isModifyTool(input.tool) && !SHELL_LIKE_TOOLS.includes(input.tool)) {
  // ... existing pass-through logging ...
  return;
}

// For shell-like tools, treat args.command as the shell command string
const isShellLike = SHELL_LIKE_TOOLS.includes(input.tool);
const filePath = isShellLike
  ? (output.args?.command || "")
  : getModifyPath(output.args || {});
```

**Why not just add `bash`/`apply_patch` to `isModifyTool`**: `isModifyTool` is used in multiple places (`checklist-before.ts:59`, `tool-scope.ts:216`) with assumptions that non-shell modify tools expose `args.filePath` or `args.dirPath`. Adding a shell tool directly would break those assumptions and require touching every call site. A parallel `SHELL_LIKE_TOOLS` allowlist localizes the change and preserves existing `isModifyTool` semantics.

Acceptance: `bash "python3 evil.py"` invoked from an agent that has `bash` permission now triggers UC7-001 (knowledge_attested + config_read_attested required in `checklist-before.ts`).

#### I2 — Shell-aware tokenizer for command chains

File: `.opencode/lib/tool-scope.ts`

**Before**: `isModifyShell` at line 17 uses `/^(cp|mv|...)\b/` (first token only). `parseShellWriteTargets` at line 71 uses `^(\S+)` (first token only).

**After**: Add a `splitShellCommand(command: string): string[]` helper that splits on shell control operators while respecting quotes and escapes:

```typescript
// FW-FIX-I2: Split a shell command into sub-commands on control operators.
// Handles: ;, &&, ||, |, <, <<, >, >>, newlines (outside quotes).
// Quote-aware: splits only when not inside '...' or "...".
// Does NOT build a full AST — only tokenizes at the command boundary level.
export function splitShellCommand(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === "\\") { current += ch; escaped = true; continue; }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === "\"") { quote = ch as any; current += ch; continue; }
    // Control operators (outside quotes)
    if (ch === ";" || ch === "|" || ch === "&" || ch === "<" || ch === ">" || ch === "\n") {
      if (current.trim()) result.push(current.trim());
      // Skip the operator (and the second char of &&, ||, <<, >>)
      if ((ch === "&" || ch === "|" || ch === "<" || ch === ">") &&
          command[i + 1] === ch) i++;
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
```

Update `isModifyShell` to iterate every sub-command:

```typescript
export function isModifyShell(args: Record<string, unknown>): boolean {
  const cmd = (args?.command || "") as string;
  if (!cmd) return false;
  const subCmds = splitShellCommand(cmd);
  const modifyRe = /^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch)\b/;
  return subCmds.some((s) => modifyRe.test(s));
}
```

Update `parseShellWriteTargets` to aggregate write targets from **all** sub-commands (not just the first):

```typescript
export function parseShellWriteTargets(command: string): ScopePathResult {
  // ... existing guards ...
  const subCmds = splitShellCommand(command);
  const allPaths: string[] = [];
  let anyUnparseable = false;
  for (const sub of subCmds) {
    const subResult = parseSingleCommand(sub);  // extract existing per-cmd logic
    if (subResult.reason === "unparseable_modify_shell") anyUnparseable = true;
    if (subResult.applies) allPaths.push(...subResult.paths);
  }
  if (anyUnparseable) return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  if (allPaths.length === 0) return { applies: false, paths: [], reason: "read_only_shell" };
  return { applies: true, paths: allPaths, reason: "parsed" };
}
```

Acceptance:
- `cd && python3 evil.py` → `isModifyShell` → `true` (second sub-command `python3`).
- `cp a b; python3 -c "..."` → `parseShellWriteTargets` returns `unparseable_modify_shell` (second sub-command `python3 -c` → unparseable).
- `pwd && sed -i 's/x/y/' file.ts` → `isModifyShell` → `true`; `parseShellWriteTargets` → `["file.ts"]`.

#### I3 — Heredoc / stdin redirect detection

File: `.opencode/lib/tool-scope.ts:180-198`

**Before**: Only `-c` (python3) and `-e` (node/bun) produce `unparseable_modify_shell`. `python3 <<'EOF'`, `python3 < script.py`, `python3 -`, `node < script.js` all fall through to `read_only_shell` at line 185-188.

**After**: Add a heredoc/stdin pre-check before the per-cmd branch:

```typescript
// FW-FIX-I3: Heredoc (<<), stdin redirect (<), and dash-from-stdin (-)
// are all opaque input forms that can carry arbitrary writes.
const stdinOrHeredocRe = /(<<\s*['"]?\w+['"]?|<<\s*\\?\w+|\s<\s+\S+|\s-\s*$|\s-\s)/;
if (stdinOrHeredocRe.test(trimmed)) {
  if (cmd === "node" || cmd === "bun" || cmd === "python3" || cmd === "sh" || cmd === "bash") {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }
}
```

Acceptance:
- `python3 <<'EOF'\nopen('.opencode/lib/x.ts','w').write('...')\nEOF` → `unparseable_modify_shell` → strict/locked blocks with `[FW-ENFORCE][UC7-001]`.
- `node < script.js`, `bun -`, `python3 -` → same.

#### I4 — MCP-server write audit (tracked, no code change here)

**Scope**: MCP tools (`compliance_gate_complete` deliverables write, `dispatch_subagent` token creation, `module_scope_declare` checklist write) execute in their own subprocess and bypass `tool.execute.before` by architecture.

**Action**: Catalog each MCP tool that writes to the filesystem or to DB-canonical state (`session_map`, `execution_checklist_*`, `knowledge_cache_*`). For each:
1. Verify its implementation calls `framework-enforcer.requireConfigAttested(path)` and `requireKnowledgeAttested(domainId)` before the write.
2. If not, file a follow-up plan under the MCP-server audit category.

Acceptance: Audit complete; all write-side MCP tools have either in-process `framework-enforcer` enforcement or are documented as gaps.

#### Phase I concurrent safety summary

| Vector | Before Phase I | After Phase I |
|---|---|---|
| `bash` tool with permission granted | **BUG: bypasses UC7-001 entirely** (permission layer only) | Safe (I1 `SHELL_LIKE_TOOLS` triggers UC7-001 path parsing) |
| `apply_patch` (if enabled in environment) | **BUG: bypasses UC7-001 entirely** | Safe (I1 same) |
| `cd && python3 evil.py` chain | **BUG: classified `read_only_shell`** | Safe (I2 tokenizer detects `python3` as second sub-command) |
| `cp a b; python3 -c "..."` chain | **BUG: only `b` is attested; python3 write ignored** | Safe (I2 aggregates sub-commands → `unparseable_modify_shell`) |
| `pwd && sed -i 's/x/y/' file.ts` chain | **BUG: classified `read_only_shell`** | Safe (I2 detects `sed` sub-command, I2 extracts `file.ts`) |
| `python3 <<'EOF'` heredoc | **BUG: classified `read_only_shell`** | Safe (I3 → `unparseable_modify_shell`) |
| `python3 < script.py` / `node -` stdin | **BUG: classified `read_only_shell`** | Safe (I3 → `unparseable_modify_shell`) |
| MCP tool writing to filesystem | Out of scope (MCP subprocess) | Out of scope; tracked under I4 audit |

#### Phase I acceptance (overall)

- `bash "python3 .opencode/scripts/install-hooks.ts"` on an agent that has `bash` permission: triggers UC7-001, requires `config_read_attested` + `knowledge_attested` before execution.
- `cd && python3 evil.py` from `safe_shell`: blocked in strict/locked mode with `[FW-ENFORCE][UC7-001] safe_shell write command could not be parsed for write target paths`.
- `cp a b; python3 -c "open('.opencode/lib/x.ts','w').write(...)"`: blocked with same message.
- `python3 <<'EOF'`: blocked with same message.
- Legitimate single-command shell usage (`cp src dst`, `sed -i 's/x/y/' file.ts`, `node script.ts`) unchanged.
- `framework-self-test.ts` adds checks: (a) `splitShellCommand("cd && python3 x")` returns `["cd", "python3 x"]`; (b) `isModifyShell({command: "cd && python3 x"})` returns `true`; (c) `parseShellWriteTargets("cp a b; python3 -c '...'")` returns `unparseable_modify_shell`; (d) `parseShellWriteTargets("python3 <<'EOF'")` returns `unparseable_modify_shell`.

---

### Phase J: Fix DISPATCH_TOKEN hash verification trailing-newline regex bug (resolves P0-7)

**Root cause**: `task-before.ts:250-252` uses a two-step regex to strip the `//DISPATCH_TOKEN:<hash>` line from the prompt before re-hashing. The second step `replace(/\n+$/, "")` strips ALL trailing newlines, including the original `resolvedPrompt`'s own trailing `\n` (which `dispatch-subagent.ts:965` preserved by appending `\n//DISPATCH_TOKEN:` *after* it). This makes `cleanPrompt` 1 char shorter than `resolvedPrompt`, so `sha256(cleanPrompt) ≠ sha256(resolvedPrompt) = dispatchToken`.

**Severity**: **Complete dispatch chain breakage** in strict/locked mode. Every `Task()` call after a `dispatch_subagent` is blocked with `DISPATCH-INTEGRITY-HASH-MISMATCH`. The bug is 100% reproducible on every dispatch because the prompt template always ends with `\n`.

**Discovery**: Observed during live Phase H regression testing. Two sequential dispatches from `@Orchestrator` (CI-CD-Agent at 11:40:12 UTC, Architect at 11:40:21 UTC) both succeeded at the dispatch layer but both `Task()` calls were blocked. Initial diagnosis attributed the failure to manual prompt editing; code audit revealed the regex is the sole cause — even a verbatim copy of the dispatch file fails verification.

#### J1: Fix the regex in `task-before.ts:250-252`

**File**: `.opencode/plugins/task-before.ts`
**Lines**: 250-252

```typescript
// ── BUGGY (current) ──────────────────────────────────────────
const cleanPrompt = prompt
  .replace(/\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "")
  .replace(/\n+$/, "");
// Problem: step 2 strips ALL trailing \n, including resolvedPrompt's own \n

// ── FIXED ────────────────────────────────────────────────────
const cleanPrompt = prompt
  .replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
// Fix: remove \n + token line in one step, preserving resolvedPrompt's trailing \n
```

**Why this works**: `dispatch-subagent.ts:965` writes `tokenizedPrompt = resolvedPrompt + "\n//DISPATCH_TOKEN:" + hash`. The `\n` immediately before `//DISPATCH_TOKEN` is the separator added by the template literal — it is NOT part of `resolvedPrompt`. The fixed regex `\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$` removes exactly this `\n` together with the token line, leaving `resolvedPrompt` intact (including its own trailing `\n`, if any).

**Edge case — resolvedPrompt does NOT end with \n**: If the prompt template is ever changed to not end with `\n`, the `\n` before `//DISPATCH_TOKEN` is still the separator from `"\n//DISPATCH_TOKEN:"`. The regex `\n\/\/DISPATCH_TOKEN:...` still matches and removes only the separator `\n`, not any content from `resolvedPrompt`. So the fix is safe for both cases.

**Backward compatibility**: The `.pending.json` integrity hash (`dispatch-subagent.ts:1006-1009`) computes `sha256(tokenizedPrompt)` (the FULL text including the token line). This is a separate integrity check from the DISPATCH_TOKEN hash and is not affected by this fix.

#### J2: Add round-trip hash test to `framework-self-test.ts`

**File**: `.opencode/scripts/framework-self-test.ts`

Add a test that exercises the exact `task-before.ts` hash verification logic:

```typescript
// J2: DISPATCH_TOKEN hash round-trip test
(function testDispatchTokenHashRoundTrip() {
  const crypto = require("crypto");
  // Simulate a resolvedPrompt that ends with \n (as the real template does)
  const resolvedPrompt = "## 🔒 SUBAGENT: Test\n\n### Task Payload\n\n- **Agent**: Test\n\n---\n";
  const dispatchToken = crypto.createHash("sha256").update(resolvedPrompt, "utf8").digest("hex");
  const tokenizedPrompt = resolvedPrompt + "\n//DISPATCH_TOKEN:" + dispatchToken;

  // Replicate the FIXED task-before.ts logic
  const cleanPrompt = tokenizedPrompt
    .replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
  const expectedHash = crypto.createHash("sha256").update(cleanPrompt, "utf8").digest("hex");

  assert(
    expectedHash === dispatchToken,
    "J2: DISPATCH_TOKEN hash round-trip must match when resolvedPrompt ends with \\n"
  );

  // Also test with resolvedPrompt that does NOT end with \n
  const resolvedNoNewline = "## Test\n\nContent";
  const token2 = crypto.createHash("sha256").update(resolvedNoNewline, "utf8").digest("hex");
  const tokenized2 = resolvedNoNewline + "\n//DISPATCH_TOKEN:" + token2;
  const clean2 = tokenized2.replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "");
  const hash2 = crypto.createHash("sha256").update(clean2, "utf8").digest("hex");
  assert(
    hash2 === token2,
    "J2: DISPATCH_TOKEN hash round-trip must match when resolvedPrompt does NOT end with \\n"
  );
})();
```

#### J3: Verify fix against existing dispatch files on disk

After applying J1, run the following verification against all dispatch files in `.task_temp/_dispatch/`:

```bash
node -e "
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const dir = '.task_temp/_dispatch';
const files = fs.readdirSync(dir).filter(f => f.startsWith('dispatch-') && f.endsWith('.md'));
let pass = 0, fail = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = text.match(/\/\/DISPATCH_TOKEN:([a-f0-9]{64})/);
  if (!m) continue;
  const token = m[1];
  const clean = text.replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, '');
  const hash = crypto.createHash('sha256').update(clean, 'utf8').digest('hex');
  if (hash === token) { pass++; } else { fail++; console.log('FAIL:', f); }
}
console.log('Pass:', pass, 'Fail:', fail);
"
```

Expected output after fix: `Pass: N  Fail: 0` (where N = number of dispatch files with tokens).

#### Phase J acceptance (overall)

- `dispatch_subagent(CI-CD-Agent)` followed by `Task()` in strict mode: `DISPATCH-INTEGRITY hash verified` logged, Task() proceeds.
- `dispatch_subagent(Architect)` followed by `Task()` in strict mode: same.
- All existing dispatch files on disk pass hash verification with the corrected regex.
- `framework-self-test.ts` J2 test passes for both `\n`-terminated and non-`\n`-terminated prompts.
- No regression in advisory mode (hash verification still logs WARN on mismatch, allows through).

---

### Phase K: Fix session_map bridge scope for all checklist-managed tools (resolves P0-8)

**Status**: Implemented (2026-06-22).

P0-8 root cause: `checklist-before.ts` P0-4 session_map bridge was gated on `toolName === "Task" || toolName === "task"`, so modify tools (safe_edit, write, etc.) without explicit `task_id` created a separate checklist run with `task_id=null`, missing attested items on Run-A.

#### K1: Extract `resolveChecklistTaskId` helper ✅

`checklist-before.ts:138-159` — new helper that tries explicit args first, then falls back to `dbReadSessionMap(sessionID).dag_task_id`:

```typescript
function resolveChecklistTaskId(input: any): string | null {
  const explicit = input.args?.task_id || input.args?.dag_task_id || null;
  if (explicit) return explicit;
  try {
    const { dbReadSessionMap } = require("../lib/db-state-manager");
    return dbReadSessionMap(input.sessionID)?.dag_task_id || null;
  } catch { return null; }
}
```

#### K2: Resolve `taskId` early for ALL tools ✅

`checklist-before.ts:166-168` — `const taskId = resolveChecklistTaskId(input)` placed before Step 9 role audit, used by role audit, dispatch event recording, and `resolveChecklistRun`.

#### K3: Remove old P0-4 inline bridge ✅

Replaced `let taskId = ... ; if (!taskId && (toolName === "Task" ...)) { ... }` with `const taskId = resolveChecklistTaskId(input)` — single resolution point, all tools covered.

#### K4: Self-test check added ✅

`framework-self-test.ts` check 64e verifies:
- `resolveChecklistTaskId` function exists in `checklist-before.ts`
- Task-only session_map bridge pattern is absent (regression guard)

#### Phase K acceptance

- Modify tool (`safe_edit`) without explicit `task_id` in a session with `session_map.dag_task_id` set → resolves to same run as `Task()` call with explicit `task_id`.
- `config_read_attested` + `knowledge_attested` on Run-A visible to modify tool check → no `P0-CHECKLIST-BLOCKED`.
- `framework-self-test.ts` check 64e passes.
- No regression: tools with explicit `task_id` still use it directly (priority 1 path unchanged).
- Advisory mode: same behavior (bridge works, no false blocks).

---

## 7. Minimum Patch Checklist

- [ ] `dispatch-subagent.ts` / `dispatch_subagent.ts`: mark `payload_complete`.
- [ ] `dispatch-subagent.ts` / `dispatch_subagent.ts`: mark `dispatch_token_created`.
- [ ] `dispatch-subagent.ts` / `dispatch_subagent.ts`: mark `session_context_bound`.
- [ ] `dispatch-subagent.ts`: import or replace the currently undefined `checklistWirePassed`.
- [ ] `dispatch_subagent.ts`: remove duplicate CLI execution or pass identical `OPENCODE_SESSION_ID` / task context to both invocations.
- [ ] `checklist-before.ts`: run dispatch role/event audit before returning for `dispatch_subagent`.
- [ ] `checklist-before.ts`: handle exempt vs non-exempt `compliance_gate_complete`.
- [ ] `compliance-gate.ts`: write checklist facts to the OpenCode execution run, not a gate-only run.
- [ ] `dispatch-subagent.ts`: either accept current task-payload-before-P0 structure or reorder to strict `## Task Payload` first.
- [ ] `opencode.json`: add `checklist_status: allow` for all relevant agents.
- [ ] `knowledge_cache_search.ts`: run `searchByDomain(args.domain)` even when no semantic keywords exist.
- [ ] `checklist-before.ts`: consume `p0_checklist_policy` and path-scope decisions.
- [ ] `framework-self-test.ts`: add runtime checklist behavior checks.
- [ ] Todo projection: add `checklist_status.suggested_todos`.
- [ ] Todo drift: add `todo.updated` -> `TODO-DB-DRIFT` audit.
- [ ] Phase G1: `dispatch-subagent.ts:306-360` — add `FRAMEWORK_TASK_KEYWORDS` short-circuit in `relevantStacks` computation (or move keyword list to `project.config.json:context7_exempt_task_keywords`).
- [ ] Phase G2: `dispatch-subagent.ts:862-941` — delete `### Execution Order`, `R1 SLIM` inline explanation, `## 🔑 Your Permissions` block, `### Conflict Resolution`, KC `M17` paragraph.
- [ ] Phase G3: `.opencode/lib/deliverables-templates.ts` — collapse `deliverablesTemplateMarkdown()`: keep name + `artifact_path` + `required`; delete `HANDOVER.md Optional Sections` detail block.
- [ ] Phase G4: `dispatch-subagent.ts:540-600` — add `PROJECT_CONTEXT_FIELDS_BY_AGENT` per-agent filter map.
- [ ] Phase G5: `dispatch-subagent.ts:661-665` — remove preamble-suffixed `Your dispatch-assigned task_id` injection.
- [ ] Phase G6: `dispatch-subagent.ts:930-933` — merge `### 📊 Mandatory Audit Trail` 4-line block into one Task Payload bullet.
- [ ] Phase G7: `dispatch-subagent.ts:871-872` — move `${scopeLine(agentType)}` block from between Task Payload and P0 Protocol to after Project Context.
- [ ] Phase G8: `dispatch-subagent.ts` scopeLine map — append ` | opencode.json 权威` to each agent's scope line.
- [ ] Phase G regression: run live dispatch smoke test for CI-CD-Agent, Coder-BE, Coder-FE, Architect, Orchestrator; confirm all 12 hard constraints still code-enforced.
- [ ] Phase H1: `dispatch-subagent.ts:677-703` (CLI subprocess) — replace `dbWriteSessionMap(sessionId, agentType, taskId)` with a read-preserve pattern: `const existing = dbReadSessionMap(sessionId); dbWriteSessionMap(sessionId, existing?.agent || agentType, taskId);` so the caller's `session_map.agent` is preserved (DB-canonical safe; keeps `dag_task_id` authoritative in DB).
- [ ] Phase H2: `dispatch_subagent.ts:733-739` (tool wrapper) — replace `existing?.agent || args.agent_type` with `existing?.agent` guarded by `if (existing?.agent)`, never write target agent under caller's session ID.
- [ ] Phase H3: `session.ts:64` — replace `if (!agent) return` with empty-agent fallback (resolve from config or sentinel `"main"`), ensuring main session always has a session_map entry.
- [ ] Phase H4 (auto-dispatch smoke test): from a single @Orchestrator session, issue `dispatch_subagent(auto_plan=true)` on an unplanned task followed by `dispatch_subagent(dag_task_id=...)` on a planned task; verify `dbReadSessionMap(caller_sid).agent` remains `Orchestrator` after both and no M14 false-positive triggers.
- [ ] Phase H regression: sequential `dispatch_subagent(CI-CD-Agent)` + `dispatch_subagent(Architect)` in the same session — verify both succeed, no M14 false-positive.
- [ ] Phase H self-test: add `framework-self-test.ts` check that dispatches two agents from a test session and verifies `resolveAgent()` returns the test session's identity after both; extend with an `auto_plan=true` variant.
- [ ] Phase I1: `scope-before.ts:48` — introduce `SHELL_LIKE_TOOLS = ["safe_shell", "bash", "apply_patch"]` allowlist that triggers UC7-001 path parsing regardless of `isModifyTool` result. Mirror `hook-config-guard.ts:71 shellTools`.
- [ ] Phase I2: `tool-scope.ts:17, 71` — replace `^(\S+)` anchoring with quote-aware `splitShellCommand()` helper; iterate every sub-command in `isModifyShell` and aggregate write targets in `parseShellWriteTargets`.
- [ ] Phase I3: `tool-scope.ts:180-198` — add heredoc (`<<`), stdin redirect (`< file`), and dash-from-stdin (`-`) detection for `node`/`bun`/`python3`/`sh`/`bash`; classify as `unparseable_modify_shell`.
- [ ] Phase I4 (MCP audit): catalog all MCP tools that write to filesystem or DB-canonical state; verify each tool calls `framework-enforcer.requireConfigAttested(path)` + `requireKnowledgeAttested(domainId)` before the write; file follow-ups for gaps.
- [ ] Phase I regression: single-command shell usage (`cp src dst`, `sed -i 's/x/y/' file.ts`, `node script.ts`) unchanged — `parseShellWriteTargets` returns the same parsed paths as before Phase I.
- [ ] Phase I self-test: add `framework-self-test.ts` checks for `splitShellCommand`, `isModifyShell` with chained commands, `parseShellWriteTargets` with `;`-chained and heredoc inputs.
- [ ] Phase J1: `task-before.ts:250-252` — replace two-step regex strip (`.replace(/\/\/DISPATCH_TOKEN:.../, "").replace(/\n+$/, "")`) with single-step `.replace(/\n\/\/DISPATCH_TOKEN:[a-f0-9]{64}\s*$/, "")` that removes `\n` + token line together, preserving `resolvedPrompt`'s original trailing newlines.
- [ ] Phase J2: `framework-self-test.ts` — add `testDispatchTokenHashRoundTrip` that verifies `sha256(cleanPrompt) === dispatchToken` for both `\n`-terminated and non-`\n`-terminated `resolvedPrompt` inputs.
- [ ] Phase J3: verify fix against all existing dispatch files in `.task_temp/_dispatch/` — corrected regex must produce `MATCH: true` for every file (currently all fail).
- [ ] Phase J regression: live `dispatch_subagent(CI-CD-Agent)` + `Task()` in strict mode — confirm `DISPATCH-INTEGRITY hash verified` log, Task() proceeds without `DISPATCH-INTEGRITY-HASH-MISMATCH` block.
- [x] Phase K1: `checklist-before.ts` — extract `resolveChecklistTaskId(input)` helper (explicit args → session_map fallback), apply to ALL tools not just Task(). **Done 2026-06-22**.
- [x] Phase K2: `checklist-before.ts` — resolve `taskId` early (before Step 9 role audit) so role audit and dispatch event recording use the same bridged value. **Done 2026-06-22**.
- [x] Phase K3: `checklist-before.ts` — remove old P0-4 inline session_map bridge (Task-only gate). **Done 2026-06-22**.
- [x] Phase K4: `framework-self-test.ts` — add check 64e verifying `resolveChecklistTaskId` exists and Task-only bridge pattern absent. **Done 2026-06-22**.
- [ ] Phase K regression: live `safe_edit` without explicit `task_id` in a session with `session_map.dag_task_id` set — confirm no `P0-CHECKLIST-BLOCKED`, attested items visible on same run.

---

## 8. Current Risk Assessment

Do not claim the DB-canonical P0 checklist optimization as complete.

Accurate status:

> The framework has a stronger checklist skeleton than the previous audit: all phase items are now created, the prompt now places task payload before the P0 protocol, `dispatch_subagent.ts` passes `OPENCODE_SESSION_ID` to its first CLI invocation, and the self-test baseline is green. It is still not production-ready because the dispatch checklist writer is currently ineffective (`checklistWirePassed` is undefined and swallowed), gate facts are not clearly bound to the same OpenCode execution run, path policy is not enforced from a DB snapshot, **the session_map writer in `dispatch-subagent.ts:688` (primary vector — CLI subprocess) and `dispatch_subagent.ts:738` (secondary vector — tool wrapper) overwrites the caller's agent identity with the target sub-agent type, causing false M14 blocks on sequential dispatches (including the `auto_plan=true` self-heal path which dispatches @Meta-Planner then re-runs the target, polluting twice), with a TOCTOU race on parallel dispatches**, **the UC7-001 shell command parser in `tool-scope.ts` is bypassed by command chains (`cd && python3`, `cp a; sed -i ...`), heredocs (`python3 <<EOF`), and non-listed shell tools (`bash`, `apply_patch`) — current `bash` defense is `opencode.json: "deny"` which is a permission layer, not a knowledge layer, so any agent granted `bash` immediately bypasses UC7-001**, **`task-before.ts:250-252` has a trailing-newline regex bug (`replace(/\n+$/, "")` strips ALL trailing newlines including `resolvedPrompt`'s own `\n`) that causes `sha256(cleanPrompt) ≠ dispatchToken` on EVERY `Task()` call in strict/locked mode — this is a complete dispatch chain breakage, 100% reproducible on all dispatch files on disk, and was the actual cause of the 2026-06-22 11:40 UTC Task() failures (not manual prompt editing as initially diagnosed)**, **`checklist-before.ts` session_map bridge was Task-only (P0-4), leaving modify tools to create `task_id=null` Run-B — FIXED by Phase K (2026-06-22): `resolveChecklistTaskId` helper now bridges all tools via session_map**, and the self-test harness does not exercise the failing runtime handoff. Todo integration should remain a DB-derived projection and drift-audit layer only.
