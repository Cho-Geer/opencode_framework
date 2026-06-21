# Sub-Agent Question Propagation Limitation

**Version**: 1.1.1  
**Date**: 2026-06-21  
**Last reviewed**: 2026-06-21  
**Author**: @Super-Admin  
**Status**: OPEN - current-code audit completed; mitigation plan revised  
**Affected Components**: `Task()` subagent sessions, nested `Knowledge-Curator` dispatch, built-in `question` tool, dispatch prompt, permission policy, plugin hooks, HANDOVER workflow  
**Severity**: MEDIUM

---

## 1. Audit Verdict

The issue remains valid as a framework risk: subagents are configured with `question: allow`, current dispatch prompts expose `question` as an available tool, and archived runtime logs show `question` tool calls from subagent sessions such as `@Coder-BE`, `@Architect`, `@Guardian`, `@Knowledge-Curator`, and `@CI-CD-Agent`.

However, the previous version overstated some implementation details:

1. There is no local `.opencode/tools/question.ts` handler to patch. `question` is an OpenCode built-in tool controlled by the non-granular `question` permission key.
2. A local `tool.execute.before` plugin can block or mutate a `question` call before execution, but it cannot synthesize the built-in tool's final answer. Therefore the old "auto-select first option and return it" fallback is not implementable purely as a before-hook.
3. The "question renders in the child session but user never sees it" behavior is consistent with official child-session navigation docs and observed session isolation, but this repo does not contain upstream OpenCode TUI source proving the exact UI rendering path. Treat it as a supported operational diagnosis, not as locally proven source code fact.
4. The affected agent count was stale. Current `opencode.json` grants `question: allow` to all configured agents, including 8 `mode: subagent` agents, `Orchestrator` as primary, and `Super-Admin` as `mode: all`.
5. Nested dispatch scope is intentionally narrow. A subagent session can dispatch only `Knowledge-Curator` as a child-of-child session for UC7KS knowledge acquisition. Other subagents (`Architect`, `Coder-BE`, `Coder-FE`, `Guardian`, `Arbiter`, `CI-CD-Agent`, `Meta-Planner`) can exist as child sessions under a primary dispatcher, but are not valid nested targets from ordinary subagent sessions.

The remediation should therefore focus on a local, enforceable policy:

- Subagents must not use built-in `question`.
- Subagents record needed user input in `HANDOVER.md` and proceed only when the action is reversible and safe.
- Irreversible/destructive choices must stop and return an escalation result to the parent.
- A `tool.execute.before` guard should log and block subagent `question` attempts so the failure is visible and recoverable.

---

## 2. Current Evidence

| Evidence source | Finding |
| --- | --- |
| `docs/official_docs/opencode/framework/tools.md` | `question` is a built-in tool with permission key `"question"`. |
| `docs/official_docs/opencode/framework/permissions.md` | `question` is a non-granular shorthand permission. It supports allow/ask/deny, but not path- or option-level rules. |
| `docs/official_docs/opencode/framework/agents.md` | Subagents run as specialized agents invoked by primary agents; child sessions are accessible through session navigation. |
| `docs/official_docs/opencode/findings/06-multi-agent-system.md` | Subagent lifecycle: `Task()` creates a child session, runs in its own process/context, returns output to parent, and remains accessible via child session navigation. |
| `docs/official_docs/opencode/plugins/plugin-hook-reference.md` | `tool.execute.before` can block a tool by throwing; `tool.execute.after` cannot block because the tool has already run. |
| `docs/official_docs/framework/mistake_precautions/plugin-debugging-precautions.md` | `question` before-hook args shape is `{ questions: [...] }`. |
| `opencode.json` | Every configured agent currently has `permission.question = "allow"`. |
| `.opencode/agents/*.md` | Agent frontmatter lists `question` for all roles; `Knowledge-Curator` and `Super-Admin` explicitly instruct use of `question` in some flows. |
| `opencode.json` task permissions | Pure subagents have `task: {"*":"deny","Knowledge-Curator":"allow"}`; `Knowledge-Curator` has `task:"deny"`. |
| `.opencode/plugins/dispatch-before.ts` | M14 physically blocks non-Orchestrator/non-Super-Admin callers from dispatching any target except `Knowledge-Curator` in strict/locked mode. |
| `.opencode/tools/dispatch_subagent.ts` | Tool-level dispatch checks also restrict non-Orchestrator callers to `Knowledge-Curator` and restrict Super-Admin to `Knowledge-Curator` except privileged repair paths. |
| `.opencode/subagent-preamble.md` | No current instruction tells subagents that `question` should not be used from child sessions. |
| `.opencode/plugins/*.ts` | No current plugin implements subagent-specific `question` policy. Existing plugins log/skip `question` as a non-content/non-write tool. |
| `.task_temp/_logs/_archive/*/plugin-*-runtime.log` | Archived logs contain `tool=question` calls from subagent sessions; existing plugin chain logs entry but does not block or redirect. |

---

## 3. Current Agent Exposure

| Agent | Mode | Current `question` permission | Nested dispatch permission | Risk |
| --- | --- | --- | --- | --- |
| `Meta-Planner` | subagent | allow | `Knowledge-Curator` only | Medium - may need requirement clarification; if nested dispatch is needed, only KC is valid. |
| `Architect` | subagent | allow | `Knowledge-Curator` only | Medium - may ask design questions during architecture work; cannot dispatch other design/build agents from its child session. |
| `Coder-BE` | subagent | allow | `Knowledge-Curator` only | High - may ask implementation or test-order questions; nested dispatch is limited to knowledge acquisition. |
| `Coder-FE` | subagent | allow | `Knowledge-Curator` only | High - may ask UI/UX decision questions; nested dispatch is limited to knowledge acquisition. |
| `Guardian` | subagent | allow | `Knowledge-Curator` only | Medium - may ask review/escalation questions; cannot dispatch Arbiter directly from child session. |
| `Arbiter` | subagent | allow | `Knowledge-Curator` only | Low/Medium - may ask waiver/ruling questions; nested dispatch is limited to knowledge acquisition. |
| `CI-CD-Agent` | subagent | allow | `Knowledge-Curator` only | Medium - may ask deployment or git-operation questions; cannot dispatch other operational agents from child session. |
| `Knowledge-Curator` | subagent | allow | none (`task:"deny"`) | Medium - current agent instructions explicitly mention `question`; KC cannot create a deeper child session. |
| `Super-Admin` | all | allow | context-dependent / privileged | Context-dependent - valid for primary human repair sessions, risky when dispatched as a subagent. |
| `Orchestrator` | primary | allow | full dispatcher | Expected - this is the correct user-facing relay point. |

### 3.1 Nested Dispatch Boundary

The framework currently has a two-tier operational boundary:

| Session level | Allowed subagent targets | Enforcement source |
| --- | --- | --- |
| Primary `Orchestrator` session | General dispatch according to DAG/route/permission policy | `opencode.json`, `dispatch-before.ts`, `dispatch_subagent.ts`, `task-before.ts` |
| Dispatched ordinary subagent session | `Knowledge-Curator` only | `opencode.json` task permission matrix + `dispatch-before.ts` M14 |
| `Knowledge-Curator` session | No child dispatch | `opencode.json` `task:"deny"` |
| Other non-KC subagents as nested targets | Not allowed from ordinary subagent sessions | `{"*":"deny","Knowledge-Curator":"allow"}` + M14 strict/locked block |

Implication for this issue:

- Most affected agents exist only as child sessions under a primary dispatcher.
- The only legitimate child-of-child session is `Knowledge-Curator`.
- Therefore the `question` propagation risk has two shapes:
  1. ordinary subagent child session calls `question`;
  2. nested `Knowledge-Curator` child-of-child session calls `question`.
- The mitigation must explicitly cover KC because KC is the only nested dispatch target and its current prompt mentions `question`.

---

## 4. Root Cause Analysis

### 4.1 Confirmed Local Causes

1. **Permission mismatch**  
   `opencode.json` grants `question: allow` to every agent, including subagents. The official permission model treats `question` as a non-granular permission, so the config cannot express "allow only when this agent is running as a primary session".

2. **Dispatch prompt mismatch**  
   `.opencode/scripts/command-tools/dispatch-subagent.ts` injects a permissions section that tells agents to read their config and `opencode.json`; those sources currently expose `question` as allowed. The generated prompt does not warn subagents that `question` is not an acceptable interaction path.

3. **No runtime guard**  
   Existing plugins observe `tool.execute.before`, but none handles `input.tool === "question"` as a policy-sensitive event. As a result, subagent `question` calls proceed into the built-in OpenCode tool.

4. **No HANDOVER question contract**  
   `HANDOVER.md` is mandatory, but there is no required `## Questions for User` / `## Assumptions` section that gives subagents a safe non-interactive alternative.

5. **Agent instruction conflict**  
   `Knowledge-Curator.md` currently says to present findings to the user via the `question` tool. `Super-Admin.md` also requires `question` for destructive confirmation. These instructions are valid only in user-facing primary contexts, not in dispatched child sessions.

6. **Nested dispatch boundary narrows but does not remove the risk**  
   Ordinary subagents cannot dispatch arbitrary sub-subagents; they can only dispatch `Knowledge-Curator`. This reduces the blast radius, but it makes KC the required nested-session case for any mitigation. If KC keeps `question: allow` and prompt text that encourages `question`, the only legitimate nested session remains vulnerable to the same propagation limitation.

### 4.2 Supported But Not Locally Proven Upstream Cause

Official OpenCode docs state that subagents run in child sessions with separate context and that users navigate child sessions explicitly. They do not document any built-in upward propagation of `question` events from child session to parent session.

Therefore the most defensible statement is:

> The local framework should not assume subagent `question` calls reach the parent or the end user. Until upstream OpenCode documents or implements child-to-parent question propagation, subagent `question` usage must be treated as unsafe.

---

## 5. Impact Scope

| Workflow | Impact |
| --- | --- |
| Interactive TDD | Subagent may block waiting for user preference on test order or implementation path. |
| Ambiguous requirements | Clarification can be trapped inside the child session or require manual child-session navigation. |
| Implementation choices | Agent may ask instead of making a documented reversible assumption. |
| Error recovery | Retry/escalation choices may stall instead of returning to Orchestrator. |
| Destructive operations | Subagent confirmation is not acceptable as a safety boundary; parent/user confirmation must happen in the primary session. |
| Knowledge acquisition | `Knowledge-Curator` is the only ordinary subagent-dispatchable nested target and currently has explicit `question` instructions that can conflict with automated KC combined gate flow. |

Severity remains **MEDIUM**: no direct data loss, but high workflow disruption and potential deadlock/stall behavior.

---

## 6. Revised Solution Options

### Option A: Prompt + HANDOVER Protocol (Immediate, Low Effort)

Update `.opencode/subagent-preamble.md` and relevant agent prompts:

```markdown
## Subagent Interaction Protocol

You are running as a dispatched subagent. Do not call the built-in `question`
tool. It may not propagate to the parent/user session.

If user input is useful but not required:
1. Continue with the safest reversible assumption.
2. Record the question under `## Questions for User` in HANDOVER.md.
3. Record the assumption under `## Assumptions`.

If user input is required before a destructive, irreversible, or security-sensitive action:
1. Stop before the action.
2. Write the required question and options to HANDOVER.md.
3. Return an escalation result for Orchestrator to ask the user from the primary session.
```

Also update:

- `.opencode/agents/Knowledge-Curator.md`: replace direct user `question` instructions with HANDOVER/Orchestrator relay unless running in a primary/user-facing session.
- `.opencode/agents/Super-Admin.md`: clarify that destructive confirmation via `question` is allowed only in a primary human session; dispatched Super-Admin must escalate to Orchestrator/user.
- `.opencode/lib/deliverables-templates.ts`: add optional `Questions for User` / `Assumptions` guidance to generated deliverable hints.

Pros:

- Fastest and least risky.
- Fits existing mandatory HANDOVER flow.
- Avoids changing upstream OpenCode.

Cons:

- Relies on model compliance unless paired with Option B.
- Loses mid-execution interactivity for subagents.

### Option B: `question-policy-before.ts` Runtime Guard (Recommended P1)

Create a local plugin in `.opencode/plugins/question-policy-before.ts`:

- Hook: `tool.execute.before`.
- If `input.tool !== "question"`, return.
- Resolve agent/session via `resolveAgent(input.sessionID)`, `resolveTaskIdWithSource(input.sessionID)`, and session_map DB where available.
- Treat a session as subagent-scoped when it has a dispatch `dag_task_id`, resolves from `session_map`/`dispatch:child:*`, belongs to an agent whose `opencode.json` mode is `subagent`, or is the nested `Knowledge-Curator` session spawned from another subagent.
- For subagent-scoped calls:
  - Write Log Central event `SUBAGENT-QUESTION-BLOCKED`.
  - Append a durable record to `.task_temp/{taskId}/questions.jsonl` or a DB-backed audit table if one is introduced.
  - Throw an actionable error telling the subagent to write `## Questions for User` and `## Assumptions` in HANDOVER.md and continue/escalate according to safety.
- Allow `Orchestrator` primary questions.
- Allow `Super-Admin` only when not dispatched with a task/session mapping that indicates child-session execution.

Why a before-hook:

- Official plugin docs say before-hooks can block by throwing.
- After-hooks cannot prevent a stalled question because the tool already ran.
- A before-hook cannot auto-answer, so this option is a guard and logger, not an automatic fallback answer provider.

Pros:

- Converts silent stalls into visible, logged policy violations.
- Correctly integrates with Log Central.
- Does not require upstream code changes.

Cons:

- A blocked tool call may still interrupt the subagent's flow once; prompt guidance must teach it how to recover.
- Requires careful subagent detection to avoid blocking legitimate primary `Super-Admin` or `Orchestrator` questions.

### Option C: Permission Tightening (Recommended P1, With Caution)

Update `opencode.json`:

- Set `question: "deny"` for agents with `mode: "subagent"` after Option A is in place.
- Keep `question: "allow"` for `Orchestrator`.
- Keep `Super-Admin` as allow only if the runtime guard can distinguish primary vs dispatched execution; otherwise rely on Option B for Super-Admin.

Rationale:

- Official permissions support `question` as allow/ask/deny only.
- Because `question` is non-granular, permission-only control is too blunt for `Super-Admin` mode `all`.
- Permission tightening should not be the only mitigation.

### Option D: Upstream Propagation (Long-Term)

Advocate upstream OpenCode support for child-session question propagation:

1. Child session emits a question event with session metadata.
2. Parent session/TUI renders the prompt in the user-visible context.
3. User response is routed back to the child tool invocation.
4. Permission and audit logs preserve the child agent/session identity.

This is the only way to preserve full interactivity, but it depends on upstream OpenCode runtime/TUI changes.

---

## 7. Recommended Implementation Plan

### Phase 0: Documentation and Prompt Safety

1. Update `.opencode/subagent-preamble.md` with the Subagent Interaction Protocol.
2. Update `Knowledge-Curator.md` and `Super-Admin.md` to remove unconditional subagent `question` use.
3. Update deliverable guidance so every HANDOVER can contain:
   - `## Questions for User`
   - `## Assumptions`
   - `## Blocked Actions Requiring User Approval`

### Phase 1: Runtime Guard and Logging

1. Add `.opencode/plugins/question-policy-before.ts`.
2. Use existing framework helpers:
   - `withPluginLifecycle()`
   - `writeLog()`
   - `resolveAgent()`
   - `resolveTaskIdWithSource()`
   - `dbReadSessionMap()` / session_map DB helpers where appropriate
3. Emit structured Log Central events:
   - `SUBAGENT-QUESTION-BLOCKED`
   - `SUBAGENT-QUESTION-RECORDED`
   - `PRIMARY-QUESTION-ALLOWED`
   - `QUESTION-POLICY-DETECTION-WARN`
4. Persist question payloads with `output.args.questions` shape.

### Phase 2: Permission Cleanup

1. Change `opencode.json` for pure subagents to `question: "deny"`.
2. Keep `Orchestrator` allowed.
3. Decide `Super-Admin` separately because it is `mode: "all"` and has legitimate primary-session confirmation needs.
4. Add tests or harness checks for the permission matrix.

### Phase 3: Harness and Regression Tests

Add tests that prove:

| Test | Expected |
| --- | --- |
| `@Coder-BE` subagent calls `question` | Plugin blocks, writes Log Central event, records question payload, error instructs HANDOVER protocol. |
| `@Knowledge-Curator` subagent calls `question` as child of Orchestrator | Plugin blocks, writes Log Central event, records question payload, error instructs HANDOVER protocol. |
| `@Knowledge-Curator` subagent calls `question` as child-of-child from another subagent | Same block; KC instruction no longer encourages the call. |
| `@Orchestrator` primary calls `question` | Allowed. |
| `@Super-Admin` primary calls `question` | Allowed for destructive confirmation. |
| Dispatched `@Super-Admin` calls `question` | Blocked/escalated to parent unless an explicit primary-session indicator exists. |
| Ordinary subagent attempts to dispatch non-KC target | Blocked by existing M14 / task permission policy; not treated as a valid question-propagation path. |
| Subagent HANDOVER includes `## Questions for User` | Orchestrator approval flow can read and relay the questions. |

---

## 8. Decision Matrix

| Criterion | Option A: Prompt/HANDOVER | Option B: Runtime Guard | Option C: Permission Tightening | Option D: Upstream |
| --- | --- | --- | --- | --- |
| Effort | Low | Medium | Low/Medium | High |
| Prevents silent stall | Partial | Strong | Strong for pure subagents | Complete |
| Preserves interactivity | No | No | No | Yes |
| Fits official plugin model | Yes | Yes | Yes | Requires upstream |
| Log Central integration | Indirect | Strong | Indirect | Depends on upstream |
| Risk | Low | Medium | Medium for `Super-Admin` | High/unknown |

Recommended sequence: **A -> B -> C**, with D tracked as an upstream enhancement.

---

## 9. Updated Findings

| Severity | Category | Description |
| --- | --- | --- |
| MEDIUM | `subagent_question_unsafe` | Subagents currently have `question: allow`, but the framework should not assume child-session questions reach the parent/user session. |
| MEDIUM | `question_policy_missing` | No current `tool.execute.before` plugin blocks or redirects subagent `question` calls. Existing plugins only log/skip them as non-content/non-write tools. |
| MEDIUM | `agent_instruction_conflict` | `Knowledge-Curator.md` and `Super-Admin.md` contain instructions that can encourage `question` use in contexts where it is unsafe. |
| LOW | `nested_scope_constrained` | Nested subagent dispatch is intentionally constrained to `Knowledge-Curator`; mitigation must cover KC but does not need to model arbitrary nested subagents. |
| LOW | `handover_contract_gap` | Mandatory HANDOVER flow exists, but it does not yet standardize `Questions for User`, `Assumptions`, or blocked approval sections. |
| INFO | `upstream_uncertainty` | Official docs describe child-session navigation and question permission, but do not document child-to-parent question propagation. Local mitigation should be conservative. |

---

## 10. Acceptance Criteria

1. Generated dispatch prompts explicitly tell subagents not to call built-in `question`.
2. Pure subagent configs no longer present `question` as an expected normal tool, or a runtime guard blocks it before execution.
3. `Knowledge-Curator` and dispatched `Super-Admin` instructions no longer require direct `question` use in child sessions.
4. Subagent `question` attempts are visible in Log Central and do not create indefinite silent waits.
5. HANDOVER artifacts can carry deferred user questions in a predictable section.
6. Orchestrator remains the user-facing question relay.
7. Ordinary subagent sessions can still dispatch `Knowledge-Curator` for UC7KS; attempts to dispatch any other subagent from a child session remain blocked.
8. Any future upstream propagation support is treated as a replacement for the local guard only after verified with an E2E harness.

---

## 11. References

- `docs/official_docs/opencode/framework/tools.md`
- `docs/official_docs/opencode/framework/permissions.md`
- `docs/official_docs/opencode/framework/agents.md`
- `docs/official_docs/opencode/findings/06-multi-agent-system.md`
- `docs/official_docs/opencode/plugins/plugin-hook-reference.md`
- `docs/official_docs/framework/mistake_precautions/plugin-debugging-precautions.md`
- `opencode.json`
- `.opencode/subagent-preamble.md`
- `.opencode/scripts/command-tools/dispatch-subagent.ts`
- `.opencode/tools/dispatch_subagent.ts`
- `.opencode/plugins/task-before.ts`
- `.opencode/plugins/task-after.ts`
- `.opencode/plugins/session.ts`
