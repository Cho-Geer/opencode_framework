---
trigger: always_on
alwaysApply: true
---

## 🚨 P0 EVIDENCE REQUIREMENT: Every conclusion MUST be backed by evidence

Before stating ANY conclusion, the agent MUST:

1. Cite the specific source (file path + line number, or tool output)
2. Quote the relevant content directly
3. If no evidence exists, state "I do not have sufficient evidence to conclude"

**Prohibited**: speculative statements without evidence, fabricating causes, guessing.

Before stating any conclusion, the agent MUST read code, search logs, and verify data thoroughly. Do not assert global conclusions based on partial information or single observations.

## 🔒 P0 CHECKLIST — DB-ENFORCED

> Execution is governed by the DB-canonical P0 checklist state machine.
> Plugin hooks physically block writes when checklist items are not completed.

1. Call `checklist_status(task_id)` first — learn your current phase and pending blockers.
2. Complete pending blocking items in the returned order.
3. Do NOT write before all blocking items for the target tool/path are passed.
4. If blocked, perform the exact remediation returned by the tool.
5. **Phase advancement**: If `checklist_status` shows all current-phase items passed but the phase has not automatically advanced, call `advance_checklist_phase(task_id)` to move to the next phase. The auto-advance in `checklist-before.ts` only triggers on modify/Task/gate tool calls — calling `checklist_status` alone will not advance the phase.

## Required Milestones

- **Step 0**: `checklist_status` → check phase + blockers.
- **Step 0d: Investigation evidence**. Investigation keywords: investigation, audit, analysis, diagnose, debug, troubleshoot, root-cause, trace, tracing, forensic, 调查, 排查, 调试, 诊断, 根因, 审计, 追溯, 排错, 定位. Must search code + ≥2 log sources (`.opencode/logs/`, `gate-state.json`, `.task_temp/_logs/`) and produce `## Logs Checked` in HANDOVER.md.
- **Step 0e: Config Read Attestation**. Read `.opencode/agents/{Type}.md`, `opencode.json`, `.opencode/project.config.json` via `read` tool, then call `config_read_attest(task_id)`.
- **Knowledge pipeline**: `resolve_domain_id()` → `module_scope_declare()` → `knowledge_cache_search()` → `knowledge_cache_attest()`. Insufficient cache → dispatch @Knowledge-Curator.
- **Subagent Interaction Protocol**: Do NOT call the built-in `question`. Record non-blocking questions in HANDOVER.md under `## Questions for User`, assumptions under `## Assumptions`, destructive actions under `## Blocked Actions Requiring User Approval`.
- **Compliance gate**: `compliance_gate_check` + `compliance_gate_confirm` before execution. `compliance_gate_submit_deliverables` before close. Non-exempt agents require `declared_deliverables`.
- **HANDOVER.md** requires `## Logs Checked` (≥2 sources) and `## Findings` tables. `handover_sha256` required for approval.

## Steps

0. Knowledge pipeline (resolve_domain_id → module_scope_declare → knowledge_cache_search → knowledge_cache_attest)
   0d. Investigation: multi-source (code + ≥2 logs) → `## Logs Checked` in HANDOVER.md
   0e. Config read attest (3 files → config_read_attest)
1. Invoke skills (P0 first: execution-preflight-check, context7-first)
2. Compliance gate (check → confirm with declared_deliverables)
3. Execute — write TASK_LOG.md and HANDOVER.md
4. Submit deliverables → compliance_gate_submit_deliverables
5. Close gate (exempt: complete direct. non-exempt: Orchestrator approval)

## Runtime Authority

DB checklist + OpenCode plugins/tools enforce execution gates.
