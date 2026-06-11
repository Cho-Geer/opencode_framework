# Compliance Gate Recovery Architecture Design — Final

**Date**: 2026-06-11  
**Author**: @Super-Admin  
**Status**: Awaiting Approval

---

## §1 Executive Summary

Two problems drive this design:

| # | Problem | Root Cause |
|---|---------|------------|
| P1 | `task_id` optional → directory mismatch → gate complete fails repeatedly | `compliance_gate_check` has no `task_id` parameter; sub-agents can't pass one |
| P2 | Gate complete failure = permanent → requires full check→confirm→complete restart | State machine is one-shot; no "transient error → fix → retry" path |

Solution: **env var `FRAMEWORK_TASK_ID`** (already in place) + **`task_id` param on `check`** + **`recoverable` gate state** + **hard mutual exclusion**.

---

## §2 Data Flow: Where `task_id` Comes From

```
@Orchestrator
  │
  ├─ reads Task.DAG.json → gets task_id "T-014"
  │
  ├─ dispatch_subagent("Coder-BE", dag_task_id="T-014", ...)
  │     │
  │     └─ process.env.FRAMEWORK_TASK_ID = "T-014"  ← env var, per-process isolated
  │
  └─ Task() launches sub-agent
       │
       └─ sub-agent preamble:
            │
            ├─ compliance_gate_check("implement feature", task_id="T-014")
            │     │  ← NEW: task_id param accepted
            │     │  ← reads process.env.FRAMEWORK_TASK_ID if not passed
            │     │
            │     ├─ scan active sessions for task_id="T-014"
            │     │    ├─ found + status=recoverable → REJECT (must retry existing gate)
            │     │    └─ none → create new session with task_id="T-014"
            │     │
            │     └─ return session_id
            │
            ├─ compliance_gate_confirm(session_id, plan, task_id="T-014")
            │     └─ session.task_id = "T-014"
            │
            ├─ ... execute task ...
            │
            └─ compliance_gate_complete(session_id, summary)
                  │
                  ├─ artifacts OK → completed
                  │
                  └─ artifacts missing → recoverable (retry_count++)
                       │
                       ├─ retry_count < 3 → sub-agent fixes artifacts → loop back to complete()
                       └─ retry_count = 3 → failed → sub-agent exits → parent handles escalation
```

---

## §3 State Machine

```
compliance_gate_check(task_id)
  │
  │  IF active session with same task_id + status in {armed, recoverable}
  │    → REJECT: "Task T-014 has active gate cg_ses_XXX (recoverable, retry 2/3).
  │               Complete existing gate or drain it."
  │
  │  ELSE → create new checked session
  │
  ▼
compliance_gate_confirm
  │
  ▼  armed
  │
compliance_gate_complete
  │
  ├─ artifacts OK ──────────► completed (terminal, audit-only)
  │
  ├─ artifacts missing ─────► recoverable
  │     │                      gate stays armed
  │     │                      removed from active_sessions?
  │     │                      NO — stays active so check() REJECT prevents new sessions
  │     │
  │     ├─ sub-agent internal retry loop:
  │     │     fix artifacts → complete(same sessionId)
  │     │     retry_count < 3 → loop
  │     │     retry_count = 3 → gate_status = "failed" (terminal)
  │     │                      → sub-agent exits → parent receives failure
  │     │
  │     └─ parent escalation:
  │           └─ parent calls retry_confirm(sessionId, plan, task_id)
  │                → re-arms the failed gate
  │                → parent calls complete(sessionId)
  │                → succeeds or escalates to @Arbiter
  │
  └─ irrecoverable error ───► failed (terminal)
        (contract hash, TDD violation, ESLint dirty)
```

### State Transitions

| From | To | Trigger |
|------|----|---------|
| `checked` | `armed` | `confirm` |
| `armed` | `completed` | `complete` with artifacts present |
| `armed` | `failed` | `complete` with irrecoverable error |
| `armed` | `recoverable` | `complete` with missing artifacts only |
| `recoverable` | `completed` | `complete` with artifacts now present |
| `recoverable` | `failed` | `complete` with missing artifacts AND retry_count >= max |
| `failed` | `armed` | `retry_confirm` by supervisory agent |
| `armed` | `expired` | 24h timeout (auto-drain) |
| `recoverable` | `expired` | 24h timeout (auto-drain) |

---

## §4 Hard Constraints

### §4.1 task_id-Based Mutual Exclusion

`compliance_gate_check` scans ALL sessions in gate-state.json. If any session matches both conditions:

1. `session.task_id === requested task_id`
2. `session.gate_status` is `armed` OR `recoverable`

Then **REJECT** the new check. The agent MUST use the existing gate.

This physically prevents sub-agents from spawning duplicate sessions. No preamble text can override it.

### §4.2 Retry Limit

| Mode | Max Retry | After Exhausted |
|------|:---:|------|
| `strict` | 3 | Gate → `failed`; sub-agent exits; parent escalates |
| `locked` | 1 | Same (single chance) |

Tracked in `session.retry_count` and `session.fail_history[]`.

### §4.3 Irrecoverable vs. Transient

**Transient** (→ `recoverable`): Only missing artifacts (HANDOVER.md, TASK_LOG.md). These are fixable without re-doing the entire task.

**Irrecoverable** (→ `failed`): Everything else — contract hash mismatch, TDD order violation, ESLint dirty_modules, plugin integrity failure. These mean the task execution itself was invalid.

---

## §5 API Changes

### §5.1 `compliance_gate_check` — ADD `task_id`

```
Params: task_description (required), task_id (optional, NEW)
Behavior:
  1. If task_id provided, scan gate-state.json for active session with same task_id
  2. If found + status is armed/recoverable → REJECT with guidance
  3. Otherwise → create new session, store task_id
```

### §5.2 `compliance_gate_complete` — CHANGE failure behavior

```
Current:  missing artifacts + strict → "failed" (terminal)
New:      missing artifacts + strict → "recoverable" (retryable)
          irrecoverable errors + strict → "failed" (unchanged)
```

### §5.3 `compliance_gate_confirm` — ADD harden check

```
Current:  task_id optional
New:      If mode is strict/locked AND session.task_id is null → REJECT
            "task_id required. Call compliance_gate_check(task_description, task_id='...') first."
```

### §5.4 NEW: `compliance_gate_retry_confirm`

```
Params: session_id (required), plan_summary (required), task_id (required)
Permission: @Super-Admin, @Orchestrator only
Behavior:
  - Verify session.gate_status === "failed"
  - Verify session.fail_reason is "missing artifacts" (transient only)
  - Reset: status → "armed", retry_count = 0, fail_history preserved
  - Returns armed — ready for complete()
```

### §5.5 Error Message — ALREADY FIXED

`complete` failure now shows actual expected path:
```
"Create HANDOVER.md under .task_temp/T-014/ (resolvedId=T-014, task_id=T-014)"
```

---

## §6 Sub-Agent Internal Recovery Pattern

In the sub-agent preamble (or as agent instruction), after every `compliance_gate_complete`:

```
for retry in 0..max_retries:
    result = compliance_gate_complete(session_id, summary)
    
    if result.status == "completed":
        break  // success
    
    if result.status == "recoverable":
        // Fix missing artifacts
        for artifact in result.missing_artifacts:
            create file at .task_temp/{task_id}/{artifact}
        continue  // retry loop
    
    if result.status == "failed":
        return failure to parent  // irrecoverable or retries exhausted
```

This is a **hard constraint via gate-state.json**, not a "please follow this pattern". The sub-agent CANNOT create a new session for the same task_id (blocked by §4.1), so the retry loop is the only viable path.

---

## §7 Parent Agent Escalation Path

When sub-agent returns failure (3 retries exhausted):

```
@Orchestrator receives failure
  │
  ├─ option A: User confirms → call retry_confirm → complete (parent session)
  │
  ├─ option B: Dispatch @Arbiter to analyze root cause
  │
  └─ option C: Drain the stuck gate → re-dispatch sub-agent with fresh Task()
```

---

## §8 Cleanup: Remove Dead Code

| File | What | Why |
|------|------|-----|
| `agent-resolver.ts:34-45` | `_dispatch_target.json` reader | Never written to; write side never ported |
| `compliance-gate.ts:863-883` | `resolveDispatchTargetAgent()` | Reads dead file; session_map covers agent identity |
| `pre-execution-gate.ts:267-276` | `_dispatch_target.json` reader | Same — dead code path |

Not required for the main fix, but removes confusion.

---

## §9 Files to Modify

| File | Changes | Impact |
|------|---------|:---:|
| `compliance-gate.ts` | `runGateCheck` + task_id param + mutual exclusion scan; `runGateComplete` recoverable state; `runGateConfirm` task_id harden; new `retry_confirm`; register MCP tool | ~100 lines |
| `gate-core.ts` | `validateTaskArtifacts` may need signature update | ~5 lines |
| `dispatch_subagent.ts` | Ensure `FRAMEWORK_TASK_ID` propagated with Task() call | verify only |
| `project.config.json` | Optional: `gate.max_retries_strict`, `gate.max_retries_locked` | ~5 lines |

### No Changes Required

- All 13 plugins — unchanged
- All other libs — unchanged
- `agent-resolver.ts` — `resolveTaskId()` already reads `FRAMEWORK_TASK_ID`
- `session.ts` / `session_map.json` — unchanged, covers agent identity only

---

## §10 Why `FRAMEWORK_TASK_ID` env var (not file, not prompt)

| Alternative | Problem |
|------------|---------|
| `_dispatch_target.json` file | Dead write side; concurrent overwrite with multiple sub-agents |
| `session_map.json` `_dispatch` key | Same concurrent overwrite problem |
| Wrap prompt text | Agent may not read it — not a hard constraint |
| `callID` | Per-tool-call, not per-task — wrong scope |
| `chat.message` hook input | No `task_id` field in the hook signature |

**env var remains the least bad option**: per-process isolation prevents concurrent overwrite, available at any call depth, invisible to the agent.

---

## §11 Approval Checklist

- [ ] State machine design (§3): recoverable state + retry_count + fail_history
- [ ] Hard constraint (§4): task_id mutual exclusion in check()
- [ ] API changes (§5): check + confirm + complete + retry_confirm
- [ ] Sub-agent recovery loop (§6): preamble / agent instruction pattern
- [ ] Parent escalation (§7): retry_confirm → Arbiter → drain
- [ ] Dead code cleanup (§8): _dispatch_target.json readers
- [ ] Env var decision (§10): FRAMEWORK_TASK_ID justified

---

## §12 Permission Matrix

### §12.1 Tool Permissions

| Agent | `check` | `confirm` | `complete` | `retry_confirm` | `dispatch` | Reason |
|-------|:---:|:---:|:---:|:---:|:---:|---|
| @Super-Admin | ✅ | ✅ | ✅ | ✅ | ✅ | `*` wildcard |
| @Orchestrator | ✅ | ✅ | ✅ | **➕ ADD** | ✅ | Parent escalation |
| @Architect | ✅ | ✅ | ✅ | — | ✅ | Sub-agent, no escalation |
| @Meta-Planner | ✅ | ✅ | ✅ | — | ✅ | FALLBACK |
| @Coder-BE | ✅ | ✅ | ✅ | — | ✅ | FALLBACK + preamble retry |
| @Coder-FE | ✅ | ✅ | ✅ | — | ✅ | FALLBACK + preamble retry |
| @Guardian | ✅ | ✅ | ✅ | — | ✅ | FALLBACK + preamble retry |
| @Arbiter | ✅ | ✅ | ✅ | — | ✅ | FALLBACK |
| @CI-CD-Agent | ✅ | ✅ | ✅ | — | ✅ | FALLBACK |

**唯一修改**：`@Orchestrator` 的 `agent_dispatch_allowed_tools` 加 `"compliance_gate_retry_confirm"`。

### §12.2 Write Scopes

All agents already have `.task_temp/**` in `agent_write_scopes.allowed`. No changes needed.

### §12.3 Configuration Consistency

> **🚨 硬约束**：任何权限修改必须在以下三个文件中保持同步。不一致将导致 runtime BLOCKED 错误或 silent bypass：

| 文件 | 角色 | 需同步的字段 |
|------|------|------------|
| `.opencode/agents/<agent>.md` | Agent 自述能力（声明式） | `mcp_tools` frontmatter |
| `opencode.json` | Runtime 物理拦截（权威） | `permissions` 节 |
| `.opencode/project.config.json` | Dispatch gate 拦截（调度层） | `agent_dispatch_allowed_tools` |

**验证方法**：

```bash
# 检查三文件一致性
grep -l compliance_gate_retry_confirm \
  .opencode/agents/Orchestrator.md \
  opencode.json \
  .opencode/project.config.json
# 三项都必须包含此工具名
```
