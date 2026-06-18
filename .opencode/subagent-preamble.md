---
trigger: always_on
alwaysApply: true
---

---

## 🔒 P0 PROTOCOL — MANDATORY PREEXECUTION SEQUENCE

> **Enforcement note**: Steps 0 (Knowledge Pipeline), 2 (Compliance Gate), and 4 (Submit Deliverables)
> are **physically enforced by TypeScript plugins and MCP tools**
> (`uc7ks-before.ts`, `gate-before.ts`, `compliance_gate_submit_deliverables`,
> `compliance_gate_approve_deliverables`). Steps 1, 3 are procedural guidance.

### Step 0: Knowledge Pipeline — P0 Mandatory (plugin-enforced)

> **UC7-001c HARDEN**: Three evidence fields are REQUIRED for valid
> sufficiency determination. Missing `reason`, `files_read`, or `content_summary`
> → treated as `"insufficient"`.

**0a.** Call `resolve_domain_id()` to get dispatch-assigned domain, then call `module_scope_declare(module, task_id)` with the resolved domain.
```
// **强制**: 先自查 dispatch 分配的 domain_id (FW-UC7KS-DOMAIN-001, M6 HARDEN)
const dispatchDomain = resolveDomainId(sessionID);
module_scope_declare(module=dispatchDomain, task_id=taskId)  // 使用 dispatch 分配的 domain 声明
```
**0b.** Call `knowledge_cache_search(domain, task_id)`.
**0c.** If `status === "insufficient"` → request @Knowledge-Curator dispatch, re-search.
**0c+.** Call `knowledge_cache_attest(domain, task_id, reason, files_read, content_summary, cache_sufficient, insufficiency_reason)` — **MANDATORY attestation step** (FW-UC7KS-DOMAIN-001-v3, M2).
   - `cache_sufficient`: `true` if you judge the cached docs are enough for the task, `false` otherwise.
   - `insufficiency_reason`: required when `cache_sufficient=false` (min 10 chars).
   - Write-block is enforced by `checkUC7KSWrite()` Path C (M3) + file-level domain check (M11).
   - When `cache_sufficient=false` → all writes are BLOCKED until re-attested with `cache_sufficient=true`.

    - When `cache_sufficient=false` → all writes are BLOCKED until re-attested with `cache_sufficient=true`.

### Step 0e: Config Read Attestation — MANDATORY (R3 scope-before enforced)

> **R3 (2026-06-19)**: The `config_read_attest` tool verifies that you have read the
> 3 mandatory config files BEFORE you are allowed to write. Without completing
> this step, `scope-before.ts` will BLOCK all writes in strict/locked mode.

**0e.** Read the 3 config files then call `config_read_attest(task_id)`:
```
// Step 0e-1: Read your agent config file (e.g., .opencode/agents/{Type}.md)
//   → auto-logged to read_audit SQLite by read-track-after.ts
// Step 0e-2: Read opencode.json (runtime permissions — authoritative source)
// Step 0e-3: Read .opencode/project.config.json (framework policies)
// Step 0e-4: Call config_read_attest(task_id) to verify reads and unlock writes
const configResult = config_read_attest({ task_id: taskId });
if (!configResult.verified) {
  // Read the unread_files listed in configResult, then re-run config_read_attest
}
```

> **Why 3 files?** (1) Agent config tells you your skills/tools. (2) opencode.json is the
> authoritative permissions source (P2-D). (3) project.config.json defines framework
> policies. Reading all 3 replaces the ~30 inline permission lines in dispatch prompts
> with a lightweight 3-line read() instruction — saving ~194 lines per dispatch (70% reduction).

### Step 0d: Multi-Source Investigation Mandate — plugin-enforced — plugin-enforced

If your task involves any keyword listed below, you are executing an
**investigation-type task** and the multi-source mandate applies:

**English trigger words**:
`investigation`, `audit`, `analysis`, `diagnosis`, `diagnose`, `debug`,
`troubleshoot`, `root-cause`, `trace`, `tracing`, `forensic`

**中文触发词**:
`调查`, `排查`, `调试`, `诊断`, `根因`, `审计`, `追溯`, `排错`, `定位`

> ⚠️ `verify` / `examine` / `inspect` are intentionally excluded —
> these are too broad and would falsely trigger on TDD verification
> and deployment health checks.

**MANDATORY**: You MUST search BOTH source code AND at least 2 of the
following runtime log/audit sources. Evidence of log review MUST appear
in your HANDOVER.md as a section titled `## Logs Checked`.

#### Text logs (readable via `read` / `grep` / `safe_shell`)

| Source | Path | Typical Use |
|--------|------|-------------|
| Plugin runtime logs | `.task_temp/_logs/{date}/plugin-{name}-runtime.log` | log-manager.ts 插件运行时事件 (权限检查/合规门禁/派遣等) |
| MCP Gate logs | `.opencode/logs/mcp-compliance-gate/` | compliance_gate call audit |
| Shell audit log | `.opencode/logs/safe-bash.log` | safe_shell 命令审计 (allow/block/执行结果) |
| Transaction log | `.opencode/state/.transaction-log` | State change transactions |
| Dispatch output | `.task_temp/_dispatch/dispatch-*.md` | Each dispatch prompt |
| Dispatch queue | `.task_temp/_dispatch/.pending.json` | Pending dispatch entries |
| Dispatch failed | `.task_temp/_dispatch/.pending.json.failed` | Failed dispatch records |
| Invocation summary | `.task_temp/_dispatch/INVOCATION_SUMMARY.md` | Cross-session summary (append) |
| Pre-commit hook log | `.task_temp/_logs/hook-*.log` | pre-commit hook 各层校验结果 |
| Dispatch audit log | `.task_temp/_dispatch/dispatch.log` | 所有派遣操作详细记录 |
| Archived logs | `.task_temp/_logs/_archive/` | 历史日志归档 (按日期) |

#### DB/JSON logs (require SQL query or `read`)

| Source | Path | Typical Use |
|--------|------|-------------|
| Session DB | `.opencode/state/session_log/` (SQLite) | session_map, audit trails |
| Gate state (JSON) | `.opencode/state/gate-state.json` | Session lifecycle history |
| Gate history | `.opencode/state/gate-state.history/` | Historical session records |
| Gate archive | `.opencode/state/gate-state.archive.json` | Archived session records |
| Machine state | `.opencode/state/machine.json` | Agent state, keystone hashes |

#### HANDOVER.md required section:

```markdown
## Logs Checked

| # | Source | Path | Key Finding |
|---|--------|------|-------------|
| 1 | Runtime logs | `.task_temp/_logs/{date}/plugin-{name}-runtime.log` | ... |
| 2 | Gate state | `.opencode/state/gate-state.json` | ... |
```

**Violation**: If your HANDOVER.md lacks a `## Logs Checked` section
with at least 2 entries, the compliance gate will REJECT your
submission with `step_0d_log_evidence_missing`.

### Step 1: Invoke Skills (no plugin enforcement)

Invoke all skills listed in your agent config in order. P0 skills (`execution-preflight-check`, `context7-first`) MUST be called first.

### Step 2: Compliance Gate Check + Confirm (plugin + hard constraint)

**2a.** Call `compliance_gate_check(task_description, task_id)` — creates session.

**2b.** Call `compliance_gate_confirm(session_id, plan_summary, declared_deliverables)`.
- **`declared_deliverables`** is **MANDATORY** for non-exempt agents.
- Declare each concrete output you will produce as a JSON array:
  `[{"name":"HANDOVER.md","description":"Handover summary","artifact_path":".task_temp/{taskId}/HANDOVER.md","required":true}]`
- **Exempt agents** (@Orchestrator, @Super-Admin): may omit `declared_deliverables`.

### Step 3: Execute

Proceed with task. Write all declared deliverables and artifacts to their specified paths.

### Step 4: Submit Deliverables — MCP-ENFORCED HARD CONSTRAINT

**4a.** Write HANDOVER.md, TASK_LOG.md, and all other declared deliverables.

**4b.** Call `compliance_gate_submit_deliverables(session_id, deliverables_evidence)`:
- `deliverables_evidence`: JSON array of `{"name":"HANDOVER.md","artifact_path":"...","content_summary":"..."}`
- **MUST be called BEFORE compliance_gate_complete** — otherwise complete will REJECT.
- This step transitions session from `armed` to `delivered`.

### Step 5: Close Gate (requires Orchestrator approval)

- **Exempt agents** (@Orchestrator, @Super-Admin): Call `compliance_gate_complete(session_id, execution_summary)` directly.
- **Non-exempt agents**: Your session ends after `submit_deliverables`. The Orchestrator will review your deliverables and call `compliance_gate_approve_deliverables(session_id, "approve", note, execution_summary)` to close the gate on your behalf.

> ⚠️ **ORDERING**: Write artifacts FIRST, then `submit_deliverables`. Calling submit before writing will cause `recoverable` state.

### Domain Reference (knowledge_semantic_map)

| Domain | Scope |
|--------|-------|
| `backend_api` | API controllers, endpoints, DTOs, middleware |
| `persistence` | Database ORM, schema, migrations, models |
| `frontend_ui` | Components, state management, styling, routing |
| `caching` | Cache engine, cache patterns, TTL management |
| `queue` | Job queues, workers, message scheduling |
| `testing` | Test frameworks, integration testing, coverage |
| `auth_security` | Authentication, authorization, security guards |
| `framework_tools` | Static analysis, formatting, type systems |
| `devops_ci` | Containerization, CI/CD platforms, pipelines |
| `opencode_framework` | Agent configs, rules, skills, plugins |
| `infrastructure` | Git, JSON Schema, Node.js, shell |
| `state_management` | machine.json, gate-state.json, keystone, enforcement |
