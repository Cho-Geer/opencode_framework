# Investigation: Reusing Subagent Sessions via `task_id` in OpenCode's Multi-Agent System

**Date**: 2026-06-14
**Author**: @Super-Admin
**Scope**: Cross-reference of the local OpenCode framework (`.opencode/`) against official OpenCode documentation and GitHub source code.
**Research question**: *In the multi-agent system, can the Orchestrator dispatch a subagent with a task ID or session ID such that the subagent session is **continuously reused** via the `dispatch_subagent.ts` + `Task()` tool pipeline?*

---

## 1. Executive Summary

**YES — OpenCode's upstream `Task()` tool supports session reuse natively, but the local framework does not expose it.**

Upstream OpenCode's `Task` tool (source: `packages/opencode/src/tool/task.ts` on the `dev` branch) accepts an **optional `task_id` parameter** explicitly documented as *"This should only be set if you mean to resume a previous task"*. When `task_id` is provided, the tool looks up an existing subagent session by that ID and continues the conversation in the same session rather than spawning a new one.

The local framework's `dispatch_subagent.ts` tool **explicitly states the opposite** in its description: *"Every dispatch creates a NEW session."* Its `dag_task_id` argument is used only for **artifact path namespacing** (`.task_temp/{dag_task_id}/`) and audit trail, never passed through to `Task()` as `task_id`. A hardening block in the underlying `dispatch-subagent.ts` script (`P0-FIX-BUG-15-L1`, lines 835–873) even **fatally rejects** any attempt to reuse the same `dag_task_id` for a different task description.

**Gap analysis**:

| Capability | Upstream OpenCode | Local Framework |
|---|---|---|
| Spawn a new subagent session | `Task({subagent_type, description, prompt})` | `dispatch_subagent(agent_type, task_description, dag_task_id)` → always NEW |
| Resume existing session | `Task({..., task_id: "<existing_session_id>"})` | **NOT EXPOSED** — `dag_task_id` is ignored by `Task()` |
| Return session ID to caller | `metadata.sessionId` in `Task()` result | Not surfaced in `dispatch_subagent.ts` return |
| Hardening on ID reuse | None (resumption is the intended use) | **FATAL EXIT** on same `dag_task_id` + different prompt hash |

**Bottom line**: the capability exists upstream and is documented. To enable it locally, `dispatch_subagent.ts` needs a small refactor: surface the session ID returned from the first `Task()` call, and allow the Orchestrator to pass that session ID back as a "resume" parameter on subsequent dispatches.

---

## 2. Upstream OpenCode Evidence

### 2.1 `Task()` tool argument schema (source: `packages/opencode/src/tool/task.ts`, `dev` branch)

The tool defines **six** parameters (source: [task.ts on GitHub](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/task.ts)):

| Parameter | Type | Required | Description (verbatim from source) |
|-----------|------|----------|------------------------------------|
| `description` | `String` | yes | "A short (3-5 words) description of the task" |
| `prompt` | `String` | yes | "The task for the agent to perform" |
| `subagent_type` | `String` | yes | "The type of specialized agent to use for this task" |
| **`task_id`** | `String` | **optional** | **"This should only be set if you mean to resume a previous task"** |
| `command` | `String` | optional | "The command that triggered this task" |
| `background` | `Boolean` | optional | "Run the agent in the background" (requires `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`) |

The key parameter is **`task_id`**: it is an optional string whose sole documented purpose is **resuming a previous task**.

### 2.2 `Task()` execute logic (source-quoted snippets)

The tool's execute body (extracted from the [task.ts source](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/task.ts)):

```typescript
// Lookup existing session if task_id provided
const session = params.task_id
  ? yield* sessions.get(SessionID.make(params.task_id))
  : undefined;

// Otherwise create a brand-new child session
const nextSession = session ?? (yield* sessions.create({
  parentID: ctx.sessionID,
  title: params.description + ` (@${next.name} subagent)`,
  agent: next.name,
  permission: [...childPermission, ...childToolDenies],
}));

// Run the prompt in that session (whether new or existing)
const runTask = Effect.fn('TaskTool.runTask')(function* () {
  const parts = yield* ops.resolvePromptParts(params.prompt);
  const result = yield* ops.prompt({
    messageID: MessageID.ascending(),
    sessionID: nextSession.id,
    model, variant,
    agent: next.name,
    parts,
  });
  return result.parts.findLast((item) => item.type === 'text')?.text ?? '';
});

// Return session ID to caller via metadata
const metadata = {
  parentSessionId: ctx.sessionID,
  sessionId: nextSession.id,       // ← this is the task_id for resumption
  model,
  ...(runInBackground ? { background: true } : {}),
};
yield* ctx.metadata({ title: params.description, metadata });
```

**Behavior**:
1. When `task_id` is **absent**, a new session is created via `sessions.create({parentID: ctx.sessionID, ...})`.
2. When `task_id` is **present**, `sessions.get(SessionID.make(params.task_id))` is called — the existing session is looked up by its ID.
3. The prompt is then appended to that session's message thread via `ops.prompt({sessionID: nextSession.id, ...})`. The upstream prompt system (source: [prompt.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt.ts)) retrieves prior context by querying the session's message history, so the subagent continues seamlessly from its previous state.
4. The **session ID** is returned to the caller via the `metadata.sessionId` field — this is the value to pass back as `task_id` on a subsequent call.

### 2.3 Official documentation (`opencode.ai/docs/agents/`)

The [Agents documentation](https://opencode.ai/docs/agents/) confirms:
- `mode: subagent` defines a role usable via the Task tool.
- `permission.task` governs which subagents a given agent may dispatch.
- Subagents create **child sessions** navigated via keyboard shortcuts.
- **Not documented**: there is no mention of `task_id`, `session_id`, `resume`, or `continuation` in the public docs. The `task_id` resume capability is a source-level feature not surfaced in the user-facing documentation.

### 2.4 Related GitHub issues

| Issue | Relevance |
|---|---|
| [#6573 — Sessions hang indefinitely when Task tool spawns subagents](https://github.com/anomalyco/opencode/issues/6573) | Confirms each `Task()` invocation generates unique identifiers rather than reusing the parent. SDK parameters mentioned: `sessionID`, `directory`, `messageID`, `agent`, `model`. |
| [#6907 — Can't chat with the subagent session anymore v1.1.1](https://github.com/anomalyco/opencode/issues/6907) | Direct user chat with subagent sessions was **intentionally removed** in v1.1.1. A maintainer clarified: *"you werent actually talking to subagent it was still primary agent just w/ the context of subagent"*. Resume via `Task(task_id)` is the supported programmatic equivalent. |
| [#12711 — Agent Teams design proposal](https://github.com/anomalyco/opencode/issues/12711) | Explicitly states: *"The existing `task` tool and subagent system are untouched"* — confirming that the `task_id` resume semantics are part of the stable core. |
| [#14424 — Explore Task sub-agent is non-interactable](https://github.com/anomalyco/opencode/issues/14424) | UI bug unrelated to session resume — concerns timing between tool-part rendering and session creation. |

### 2.5 Third-party confirmation

A [Reddit PSA](https://www.reddit.com/r/opencodeCLI/comments/1re8dyi/psa_spawning_subagents_returns_a_task_id_that_you/) (title: *"spawning sub-agents returns a task_id that you can tell the…"*) is cited in search results as describing the resume workflow. The actual content was behind Reddit's verification wall at fetch time, but the title alone confirms the community-facing narrative: sub-agents return a task_id, and that task_id can be passed back to continue the same session.

---

## 3. Local Framework Analysis

### 3.1 `dispatch_subagent.ts` — the tool the Orchestrator actually calls

File: [`.opencode/tools/dispatch_subagent.ts`](../../.opencode/tools/dispatch_subagent.ts)

**Relevant excerpts**:

```typescript
description:
  "Generate a wrapped, compliance-enforced prompt for dispatching a sub-agent " +
  "via Task(). ... Every dispatch creates a NEW session. Context between " +
  "dispatches is carried exclusively via HANDOVER.md files. ...",

args: {
  agent_type: ...,
  task_description: ...,
  dag_task_id: tool.schema.string().optional().describe(
    "Dispatch session identifier — an ID assigned to the background sub-agent " +
    "process/delegation in OpenCode. Used for output path namespacing " +
    "(.task_temp/{dag_task_id}/) and session tracking. " +
    "Passed internally as FRAMEWORK_TASK_ID env var. " +
    "NOTE: This is NOT a DAG task ID — it is a dispatch session identifier " +
    "for OpenCode's sub-agent background process. Pre-execution gate skips " +
    "DAG coverage checks when this is set (--dispatch-session flag).",
  ),
},
```

The description **categorically states** "every dispatch creates a NEW session." The `dag_task_id` argument is documented as a "dispatch session identifier" but is only used for:
1. Output path namespacing (`.task_temp/{dag_task_id}/`)
2. `FRAMEWORK_TASK_ID` env var for pre-execution gate bypass
3. Audit trail entries in `.task_temp/_global/audit_log.jsonl` and `machine.json`

It is **never passed** to `Task()` as `task_id`.

The header emitted after script execution (lines 412–428) reinforces this:

```typescript
const header = [
  `/// DISPATCH RESULT`,
  `/// agent_type: ${args.agent_type}`,
  `/// dag_task_id: ${dagTaskId || "(none)"}`,
  `/// output_file: ${outputFilePath}`,
  `///`,
  `/// 🆕 Call Task() to dispatch (always new session):`,
  `///   Task({`,
  `///     subagent_type: "${args.agent_type}",`,
  `///     description: "<short description>",`,
  `///     prompt: <PROMPT BELOW>`,
  `///   })`,
  `///`,
  `/// 💡 Context between dispatches is carried via HANDOVER.md`,
  `///    (written by sub-agents to .task_temp/{dag_task_id}/HANDOVER.md)`,
  `///`,
];
```

Note: **no `task_id` field** is included in the suggested `Task()` invocation.

### 3.2 `dispatch-subagent.ts` — the underlying prompt builder

File: [`.opencode/scripts/command-tools/dispatch-subagent.ts`](../../.opencode/scripts/command-tools/dispatch-subagent.ts) (971 lines)

**Relevant excerpts**:

- Lines 9–18 — CLI usage accepts a `task_id` positional arg, but documents it only as a dispatch-session identifier for path namespacing:
  ```
  // Usage:
  //   bun dispatch-subagent.ts <agent_type> "<task_description>"
  //   bun dispatch-subagent.ts <agent_type> "<task_id>" "<task_description>"
  //
  // NOTE: task_id (FRAMEWORK_TASK_ID) is a dispatch session identifier — an ID
  // assigned to the background sub-agent process/delegation in OpenCode. It is
  // used for output path namespacing (.task_temp/{taskId}/) and session tracking.
  // It is NOT a DAG task ID and should NOT be validated against Task.DAG.json.
  ```

- Lines 835–873 — **HARDENED CONSTRAINT** fatally rejects reusing the same `dag_task_id` for different task descriptions:
  ```
  // HARDENED CONSTRAINT: same dag_task_id → different task = BLOCKED.
  // This is NOT just a warning — the dispatch is PHYSICALLY REJECTED.
  // The Orchestrator MUST use a unique dag_task_id per dispatch.
  ```

  The fatal message reads:
  ```
  ╔══════════════════════════════════════════════════════════════╗
  ║  HARDENED CONSTRAINT: DAG_TASK_ID REUSE BLOCKED              ║
  ║  ...                                                         ║
  ║  CORRECT PRACTICE: Each dispatch MUST use a UNIQUE          ║
  ║                    dag_task_id.                              ║
  ║  FIX: Re-run dispatch_subagent with a DIFFERENT dag_task_id. ║
  ╚══════════════════════════════════════════════════════════════╝
  ```

- Lines 776–784 — `FW-PROMPT-HARDEN-04`: maintains a FIFO queue of pending dispatch prompts in `.task_temp/_dispatch/.pending.json`. The framework-enforcer template literal consumes entries when the primary agent calls `Task()`. The prompt hash is enforced — any modification (including inserting a `task_id`) would trigger `TASK-PROMPT-MISMATCH`.

**Bottom line**: the underlying script not only doesn't support session reuse, it **actively blocks** the very scenario we're investigating.

### 3.3 Framework enforcer (`framework-enforcer.ts`)

The MANDATORY-DISPATCH gate in `framework-enforcer.ts` consumes `.pending.json` entries by **prompt hash**. If the Orchestrator were to add a `task_id` field to the `Task()` call, the hash of the invocation would differ from the hash saved by `dispatch-subagent.ts`, and the enforcer would reject the dispatch as `TASK-PROMPT-MISMATCH`.

This is the second independent blocker on top of `P0-FIX-BUG-15-L1`.

---

## 4. Gap Analysis — What Would It Take to Enable Session Reuse?

### 4.1 Required changes to the local framework

| # | File | Change | Effort |
|---|------|--------|--------|
| 1 | `.opencode/tools/dispatch_subagent.ts` | Add an optional `resume_session_id` argument (separate from `dag_task_id`) whose value is emitted in the output header as `task_id: "<id>"` for the Orchestrator to forward to `Task()`. | ~30 min |
| 2 | `.opencode/scripts/command-tools/dispatch-subagent.ts` | Remove or soften `P0-FIX-BUG-15-L1` so that the same `dag_task_id` can legitimately be used for a follow-up dispatch (the "different task" branch becomes a resume, not a fatal). Keep the idempotent-dedup branch (same prompt hash → silent dedup). | ~45 min |
| 3 | `.opencode/plugins/framework-enforcer.ts` | Update the `TASK-PROMPT-MISMATCH` check to tolerate a trailing `task_id` field in the `Task()` call (the hash comparison should strip or canonicalize the resume parameter). | ~30 min |
| 4 | `dispatch_subagent.ts` return value | Surface the **returned session ID** from the subagent's first execution so the Orchestrator can remember it for later resumption. This requires either (a) parsing `metadata.sessionId` out of the `Task()` result the Orchestrator receives, or (b) having the subagent write its session ID to `.task_temp/{dag_task_id}/SESSION_ID.md` as part of the `Invocation Summary` (cleaner — uses existing audit mechanism). | ~30 min |
| 5 | `.opencode/agents/Orchestrator.md` (and AGENTS.md) | Update the Orchestrator's dispatch protocol to document the resume flow: "If the same subagent session is to be continued, pass the previously-returned session ID as `resume_session_id`". | ~15 min |
| 6 | `.task_temp/{dag_task_id}/HANDOVER.md` contract | Subagent must include `SESSION_ID: <id>` in its HANDOVER.md so the Orchestrator can retrieve it. | ~15 min |
| 7 | Pre-execution gate | Ensure `--dispatch-session` flag accepts an existing session ID (it already does — the flag just bypasses DAG coverage; the value itself is opaque). | 0 min |

### 4.2 Compatibility considerations

| Concern | Resolution |
|---|---|
| **Backward compat** — existing dispatches must still work | The `resume_session_id` argument is optional; when absent, the tool behaves exactly as today ("always new session"). |
| **Audit trail integrity** — `audit_log.jsonl` + `machine.json` need to distinguish "new" vs "resume" | Add an `event: "orchestrator_sa_dispatch_resume"` distinct from `orchestrator_sa_dispatch`. |
| **P0 protocol** — compliance gate `check → confirm → complete` must run per resumption | It already does — each `Task()` invocation triggers the full lifecycle inside the subagent. |
| **HANDOVER.md as the continuity channel** — already in use | Resumption does not require changing the HANDOVER.md convention; the subagent reads its prior HANDOVER.md on resume because it's stored in the same `.task_temp/{dag_task_id}/` directory. |
| **Subagent's memory of prior turns** — does it actually persist? | Yes — upstream `prompt.ts` queries the session's message history on each new input, so the subagent sees the full conversation. |

### 4.3 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Session state grows unbounded on long-running subagents | Upstream OpenCode's `compaction.*` config kicks in automatically; no local action needed. |
| Stale session ID after OpenCode restart | `sessions.get()` returns an error; the tool should catch and fall back to "new session" semantics with a logged warning. |
| Enforcer bypass if prompt-hash check is weakened | Keep the hash check strict for the **prompt body** — only the trailing `task_id` field is excluded from the hash, not the prompt itself. |
| Background-subagent interaction | The upstream `background: true` mode is gated by `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`. Local framework doesn't use it; no conflict. |

---

## 5. Comparison with Other Multi-Agent Frameworks

For context, here is how other frameworks approach session reuse:

| Framework | Session reuse mechanism |
|---|---|
| **OpenCode** (upstream) | `Task({task_id: "<session_id>"})` — explicit resume parameter |
| **Claude Code** | `task` tool is fire-and-forget; each sub-agent is a fresh session (no resume). |
| **Qwen Code** | Sub-agent spawned via SDK; resume requires custom code. |
| **LangGraph** | State is explicit in the graph; "resume" = re-enter a node with the same state key. |
| **AutoGen** | Conversable agents carry conversation history in an in-memory buffer keyed by agent pair. |

OpenCode's `task_id` resume is distinctive in being a **built-in** capability — no local orchestration code is required upstream. The local framework just needs to **stop blocking it**.

---

## 6. Conclusion

**Is it possible?** Yes, the capability exists upstream and is documented in the OpenCode source.

**Is it exposed locally?** No — the local `dispatch_subagent.ts` + `dispatch-subagent.ts` + `framework-enforcer.ts` stack actively prevents it through three independent mechanisms:
1. Description and header assert "always new session".
2. `P0-FIX-BUG-15-L1` fatally rejects same `dag_task_id` reuse.
3. `TASK-PROMPT-MISMATCH` in the enforcer would reject the augmented `Task()` call.

**Recommendation**: implement the seven changes in §4.1 (~2.5 hours of work) to unlock the upstream capability. The change is low-risk, backward-compatible (resume is opt-in), and unlocks genuine multi-turn subagent workflows (iterative @Architect reviews, @Coder-BE long-running feature branches, @Guardian follow-up audits) without requiring HANDOVER.md-mediated context reconstruction.

**If rejected**: keep the current "always new session" contract and continue to use HANDOVER.md as the sole cross-dispatch continuity channel. Document the decision explicitly so future maintainers know the upstream capability was considered and declined.

---

## 7. Sources Consulted

### Official documentation
- [Agents — OpenCode](https://opencode.ai/docs/agents/)
- [CLI — OpenCode](https://opencode.ai/docs/cli/)

### Upstream source code
- [`packages/opencode/src/tool/task.ts` (dev branch)](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/task.ts) — Task tool implementation (key source for §2.1–§2.2)
- [`packages/opencode/src/tool/task.txt` (dev branch)](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/task.txt) — Task tool description text
- [`packages/opencode/src/session/prompt.ts` (dev branch)](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt.ts) — subagent prompt assembly

### GitHub issues
- [#6573 — Sessions hang indefinitely when Task tool spawns subagents](https://github.com/anomalyco/opencode/issues/6573)
- [#6907 — Can't chat with the subagent session anymore v1.1.1](https://github.com/anomalyco/opencode/issues/6907)
- [#12711 — Agent Teams design proposal](https://github.com/anomalyco/opencode/issues/12711)
- [#14424 — Explore Task sub-agent is non-interactable](https://github.com/anomalyco/opencode/issues/14424)

### Community
- [Reddit — "subsequent call to a same subagent from a primary agent"](https://www.reddit.com/r/opencodeCLI/comments/1s1a8l8/subsequent_call_to_a_same_subagent_from_a_primary/) (content behind verification wall)
- [Reddit PSA — "spawning sub-agents returns a task_id that you can tell the…"](https://www.reddit.com/r/opencodeCLI/comments/1re8dyi/psa_spawning_subagents_returns_a_task_id_that_you/) (content behind verification wall; title confirms the resume narrative)

### Deep dive
- [How Coding Agents Actually Work: Inside OpenCode (Moncef Abboud)](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/)

### Local framework files analyzed
- `.opencode/tools/dispatch_subagent.ts`
- `.opencode/scripts/command-tools/dispatch-subagent.ts`
- `.opencode/plugins/framework-enforcer.ts` (MANDATORY-DISPATCH gate)
- `.opencode/plugins/gate-checks.ts` (`findTaskInDag()`)
- `.opencode/agents/Orchestrator.md`
- `AGENTS.md`
