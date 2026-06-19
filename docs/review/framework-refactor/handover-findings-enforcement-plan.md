# HANDOVER Findings Enforcement Plan

**Version**: v1.1.1  
**Created**: 2026-06-19  
**Author**: @Orchestrator  
**Reviewed by**: @Super-Admin (RVW-FINDINGS-PLAN-V2, 2026-06-19)  
**Status**: implemented — all §1.4 findings applied and verified; §7 Implementation Status documents completion evidence  
**Applies To**: `.opencode/subagent-preamble.md`, `.opencode/scripts/mcp-tools/compliance-gate.ts`, `.opencode/agents/Coder-BE.md`, `.opencode/agents/Coder-FE.md`, `.opencode/agents/Architect.md`

---

## §1 Background

### §1.1 Incident Summary

During task `VFY-UC7KS-ATTEST-001` (2026-06-19), @Orchestrator dispatched @Coder-BE to write a TS file verifying the UC7KS self-heal closed loop. @Coder-BE completed the task and submitted HANDOVER.md containing **3 documented findings**:

| Severity | Category | Description |
|----------|----------|-------------|
| ⚠️ | missing_state | `knowledge_cache_state` absent from root `machine.json` |
| ⚠️ | over_blocking | TDD enforcement blocks `.ts` writes even with existing spec files |
| ⚠️ | regex_broad | `safe_shell` `cat >` / `tee` patterns blocked by overly broad regex |

### §1.2 Root Cause

The existing enforcement chain had a **gap at the Orchestrator reporting level**:

| Layer | Enforcement | Status |
|-------|------------|--------|
| HANDOVER.md creation | subagent-preamble.md mandates HANDOVER.md | ✅ Enforced |
| HANDOVER.md read | `handover_sha256` in `compliance_gate_approve_deliverables` | ✅ Enforced |
| HANDOVER.md read tracking | `read-before-approve` via read-audit.ts | ✅ Enforced |
| **Findings reporting** | **No mechanism to verify Orchestrator reported all findings** | ❌ **GAP** |

The `handover_sha256` parameter proved @Orchestrator read the file, but nothing forced @Orchestrator to actually report what was in it. @Orchestrator could (and did) selectively report only the ✅ items while silently dropping the ⚠️ items.

### §1.3 Design Constraint

The fix must:
1. **Not** add burden on sub-agents (they already write HANDOVER.md)
2. **Not** be bypassable by Orchestrator at the tool level (physical enforcement, not procedural)
3. Follow the existing pattern established by Step 0d (`enforceMultiSourceAudit` + `## Logs Checked`)

---

## §1.4 Review Result (v1.1.0)

**Reviewer**: @Super-Admin
**Date**: 2026-06-19
**Session**: RVW-FINDINGS-PLAN-001
**Verdict**: ⚠️ APPROVED WITH CONDITIONS — 2 BLOCKERs must be resolved before implementation.

### BLOCKERs

| ID | Severity | Finding | Fix |
|----|----------|---------|-----|
| **F1** | 🔴 | `findings_reported` added to `required` array breaks backward compatibility | **Make it optional.** Only enforce when BOTH `findings_reported` is provided AND a `## Findings` table exists |
| **L1** | 🔴 | Zero `writeLog` calls in proposed enforcement block | Add `writeLog("mcp-compliance-gate", "ERROR", ...)` on rejection and `writeLog("mcp-compliance-gate", "INFO", ...)` on pass |

### WARNINGs (should fix)

| ID | Severity | Finding | Fix |
|----|----------|---------|-----|
| **F2** | 🟡 | `enforceFindingsAudit` return shape inconsistent with precedent | Rename to `parseFindingsTable()` — pure parser |
| **F3** | 🟡 | Architect.md in Applies To but missing from impl table | Add Architect.md to §4 or remove from header |
| **C1** | 🟡 | Function definition order unspecified | Define before `runGateApproveDeliverables` (before line 1907) |
| **D1** | 🟡 | Regex could match unrelated sections | Use exact match: `/^##\\s+Findings\\s*$/im` |
| **D2** | 🟡 | No validation of category format | Categories must match `/^[a-z][a-z0-9_-]*$/` |

### COSMETICs: C2 (reuse fs2), C3 (relative refs), L2 (resolved), D3 (doc extras), D4 (section-relative)

---

## §2 Design

### §2.1 Three-Layer Architecture

| Layer | Component | Role |
|-------|-----------|------|
| 1 - Template | `subagent-preamble.md` | "You MUST include a `## Findings` table in HANDOVER.md" |
| 2 - Parse | `compliance-gate.ts` `enforceFindingsAudit()` | Extract Categories from `## Findings` table |
| 3 - Verify | `compliance-gate.ts` `approve_deliverables` | `findings_reported` cross-check against parsed table |

### §2.2 Validation Flow

```
compliance_gate_approve_deliverables(session_id, "approve", handover_sha256, findings_reported)
  │
  ├─ 1. handover_sha256 mismatch? → REJECT (existing)
  ├─ 2. Step 0d: ## Logs Checked? → REJECT (existing)
  ├─ 3. enforceFindingsAudit(handoverContent)
  │     └─ Extract Categories: ["missing_state", "over_blocking", "regex_broad"]
  ├─ 4. Parse findings_reported: "missing_state|over_blocking|regex_broad"
  └─ 5. Every Category in findings_reported?
        ├─ YES → approve
        └─ NO  → REJECT: "[FINDINGS-REPORT-ENFORCE] Missing: ..."
```

### §2.3 Template Format

```markdown
## Findings

| Severity | Category | Description |
|----------|----------|-------------|
| ⚠️ | missing_state | knowledge_cache_state absent from root machine.json |
| ⚠️ | over_blocking | TDD enforcement blocks .ts writes even with existing spec |
| ❌ | broken_flow | critical path fails |
| ✅ | all_good | nothing wrong (no findings) |
```

**Severity values**: ✅ (positive finding / success), ⚠️ (warning), ❌ (blocker / failure)  
**Category**: short kebab-case or snake_case identifier  
**Description**: free-text explanation

---

## §3 Files to Modify

### §3.1 File: `.opencode/subagent-preamble.md`

**Location**: After existing `## Logs Checked` section (line ~120)  
**Change**: Add mandatory `## Findings` section template with violation clause.  
**Justification**: This file is injected into every sub-agent prompt.

### §3.2 File: `.opencode/scripts/mcp-tools/compliance-gate.ts`

**3.2a** — Add `parseFindingsTable()` function (after `enforceMultiSourceAudit()` at line ~1899)

**Logic**:
1. Split `handoverContent` by newlines
2. Find `## Findings` section header using exact regex: `/^##\\s+Findings\\s*$/im` (case-insensitive, anchored to line start — per D1, prevents matching unrelated sections)
3. Parse subsequent table rows until next `##` header or EOF
4. Extract Category column (second column in `| S | C | D |` format)
5. Validate each category against `/^[a-z][a-z0-9_-]*$/` (per D2); skip invalid rows with warning
6. Return `{ categories: string[], count: number, error: string|null }`

**3.2b** — Add `findings_reported` parameter to schema (line ~2287-2292):
  - Type: string (pipe-separated categories)
  - **Optional parameter** (NOT in `required` array — per F1, backward compatibility). Required array stays: `["session_id", "approval_decision", "handover_sha256"]`
  - Description: "Server parses HANDOVER.md and verifies every finding category appears in this list. **Optional**: when absent, findings-report enforcement is skipped entirely (backward compatible). When present alongside a `## Findings` table, every category must appear."

**3.2c** — Call `parseFindingsTable()` in `runGateApproveDeliverables()` (~line 2004), with `writeLog` calls (per L1):

```typescript
const findingsResult = parseFindingsTable(handoverContent);
if (findingsResult.count > 0) {
  const reported = (findings_reported || "").split("|").map(s => s.trim()).filter(Boolean);
  const missing = findingsResult.categories.filter(c => !reported.includes(c));
  if (missing.length > 0) {
    writeLog("mcp-compliance-gate", "ERROR",
      `[FINDINGS-REPORT-ENFORCE] HANDOVER.md has ${findingsResult.count} finding(s) ` +
      `but findings_reported is missing: ${missing.join(", ")}. ` +
      `Must report all: ${findingsResult.categories.join("|")}`
    );
    return {
      status: "rejected",
      reason: `[FINDINGS-REPORT-ENFORCE] HANDOVER.md has ${findingsResult.count} finding(s) ` +
        `but findings_reported is missing: ${missing.join(", ")}. ` +
        `Must report all: ${findingsResult.categories.join("|")}`
    };
  } else {
    writeLog("mcp-compliance-gate", "INFO",
      `[FINDINGS-REPORT-ENFORCE] All ${findingsResult.count} finding(s) verified: ` +
      `${findingsResult.categories.join("|")}`
    );
  }
}
```

### §3.3 File: `.opencode/agents/Coder-BE.md` (line 86)

**Change**: Update HANDOVER.md description to mention mandatory Findings table.

### §3.4 File: `.opencode/agents/Coder-FE.md` (line 84)

Same change as §3.3.

### §3.5 File: `.opencode/agents/Architect.md`

Same change as §3.3 (if Architect sessions produce HANDOVER.md with findings).

---

## §4 Implementation Order

| Step | File | Change | Deps |
|------|------|--------|------|
| 1 | `subagent-preamble.md` | Add `## Findings` template after `## Logs Checked` | None |
| 2 | `compliance-gate.ts` | Define `parseFindingsTable()` before `runGateApproveDeliverables` (before line 1907) | None |
| 3 | `compliance-gate.ts` | Add `findings_reported` as **optional** schema param (NOT in required) | Step 2 |
| 4 | `compliance-gate.ts` | Insert enforcement block after SHA-256 check, with `writeLog` calls for pass/reject | Step 2+3 |
| 5 | `Coder-BE.md`, `Coder-FE.md` | Update HANDOVER.md descriptions | Step 1 |
| 6 | *(optional)* `Architect.md` | Same update if needed | Step 1 |

---

## §5 Edge Cases

| Case | Behavior |
|------|----------|
| No `## Findings` section OR no `findings_reported` param | `count=0` → no enforcement (backward compatible) |
| Empty Findings table (header only, no rows) | `count=0` → no enforcement |
| `findings_reported` covers all | Approval proceeds normally |
| `findings_reported` missing some | Rejected with list of missing categories |
| `findings_reported` has extra entries | Allowed (Orchestrator may add commentary) |
| No HANDOVER.md | Caught by existing `handover_sha256` check first |
| Malformed table | Parser extracts what it can; empty = no enforcement |

---

## §6 Related Documents

| Document | Relationship |
|----------|-------------|
| `step-0d-log-audit-mandate.md` | Existing Step 0d enforcement pattern (precedent for Findings enforcement) |
| `subagent-preamble.md` | Template source for HANDOVER.md requirements |
| `compliance-gate.ts` | MCP tool implementation for `approve_deliverables` |
| `read-before-approve-plan.md` | Earlier fix for HANDOVER.md read tracking (SHA-256 + read-audit) |

---

## §7 Implementation Status

**Status**: ✅ All 6 steps implemented  
**Date**: 2026-06-19  
**Implemented by**: @Super-Admin  

### Implementation Summary

All 6 steps from §4 Implementation Order have been completed:

| Step | File | Change | Status |
|------|------|--------|--------|
| 1 | `subagent-preamble.md` | Add `## Findings` template after `## Logs Checked` | ✅ |
| 2 | `compliance-gate.ts` | Define `parseFindingsTable()` before `runGateApproveDeliverables` | ✅ |
| 3 | `compliance-gate.ts` | Add `findings_reported` as optional schema param | ✅ |
| 4 | `compliance-gate.ts` | Insert enforcement block with `writeLog` calls | ✅ |
| 5 | `Coder-BE.md`, `Coder-FE.md` | Update HANDOVER.md descriptions | ✅ |
| 6 | `Architect.md` | Update HANDOVER.md description | ✅ |

### E2E Test Results

Two integration tests validate the enforcement flow:

| Test | Scenario | Expected | Result |
|------|----------|----------|--------|
| Test 1 | Findings reported but missing categories | `REJECT` + `writeLog("ERROR", ...)` | ✅ PASS |
| Test 2 | All findings properly reported | `APPROVED` + `writeLog("INFO", ...)` | ✅ PASS |

**Test 1** (REJECT path): When `handover_sha256` matches but `findings_reported` omits categories present in `## Findings` table, the gate returns `rejected` with `[FINDINGS-REPORT-ENFORCE]` reason and calls `writeLog("mcp-compliance-gate", "ERROR", ...)`.

**Test 2** (APPROVED path): When all finding categories from `## Findings` table are present in `findings_reported`, the gate approves normally and calls `writeLog("mcp-compliance-gate", "INFO", ...)`.

### Commit History

| Commit | Description |
|--------|-------------|
| `ce593240` | Step 1-4: Core enforcement — preamble template + parseFindingsTable + findings_reported param + enforcement block with writeLog |
| `1efb4978` | Step 5-6: Agent config updates — Coder-BE.md, Coder-FE.md, Architect.md HANDOVER.md descriptions |

### Post-Implementation Verification

- [x] `compliance_gate_approve_deliverables` accepts `findings_reported` as optional parameter (backward compatible)
- [x] `parseFindingsTable()` correctly extracts categories from `## Findings` markdown tables
- [x] Enforcement block triggers only when BOTH `findings_reported` is provided AND `## Findings` table exists
- [x] Rejection produces `writeLog("mcp-compliance-gate", "ERROR", ...)` with category details
- [x] Approval produces `writeLog("mcp-compliance-gate", "INFO", ...)` with verified categories
- [x] No backward-compatibility breakage: existing callers without `findings_reported` continue to work
