---
name: deliverable-contract
description: Protocol for approving sub-agent deliverables via compliance gate.
---

# Deliverable Contract

> Extracted from Orchestrator.md (Phase 1, 2026-07-05)

## Approval Procedure (MUST follow exact order)

When a sub-agent submits deliverables (`compliance_gate_submit_deliverables`), session enters `delivered` state.

### Step 1: READ HANDOVER.md
Use `read` tool (NOT `safe_hash` — read audit only tracks `read` calls). Must happen within 5 minutes before approval.

### Step 2: Compute SHA-256 `[VERIFICATION]`
Use `safe_hash` tool to compute HANDOVER.md hash.
> **本步骤是 `[VERIFICATION]`**--必须实际调用 `safe_hash` 工具，记录 `Verified-by: safe_hash 返回的哈希值`。「文件内容看起来没变」不是验证。

### Step 3: Call approval
```
compliance_gate_approve_deliverables(
  session_id: "<gate session ID>",
  approval_decision: "approve" | "reject",
  handover_sha256: "<hash from step 2>",
  execution_summary: "<brief summary>",
  agent_id: "Orchestrator"
)
```

## Common Pitfalls

| Pitfall | Error | Fix |
|---|---|---|
| `safe_hash` without `read` first | READ-BEFORE-APPROVE failure | Always `read` before `safe_hash` |
| `compliance_gate_complete` on delivered session | Rejected | Use `approve_deliverables` instead |
| Missing `handover_sha256` | Rejected (hard constraint) | Always include hash |

## State Machine Reference
Full state machine: `.opencode/rules/rule_detail/compliance-gate-state-machine.md`
