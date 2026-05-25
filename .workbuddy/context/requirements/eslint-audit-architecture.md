# ESLint Audit Enforcement Implementation Plan

> **Version**: 2.0.0  
> **Date**: 2026-05-14  
> **Author**: @Architect  
> **Approval**: @Arbiter  

---

## 1. Problem to Solve

`time-slots.service.spec.ts` mocked `PrismaService` (TIER1) — violating CAT1.1. Unit tests did not catch it (all dependencies were mocked), @Guardian review did not intercept it, Playwright caught symptoms that were misdiagnosed. Root cause: **constraint rules were documented but had no automated enforcement**. This plan eliminates that gap.

---

## 2. Architecture Principles

### 2.1 Single Source of Truth

```
contract.yaml ← Sole constraint definition
      │
      ├──→ tier-rules.json (Auto-generated, not hand-written)
      ├──→ machine.json    (Runtime state)
      └──→ ESLint Rules    (Executor)
```

### 2.2 Enforced Layered Defense

Not one layer doing everything, but three layers stacked — each independently covering the gaps of the previous:

```
Layer A: Agent Proactive     → Advisory (early detection, non-mandatory)
Layer B: Gate Enforcement    → P0 non-bypassable (the truly effective defense)
Layer C: Hook Safety Net     → Catch accidents outside the gate
```

**Only Layer B is truly non-bypassable.** Layers A and C are supplementary — do not rely on them.

---

## 3. Role Responsibilities

| Role | Responsibility |
|------|------|
| @Architect | Maintain contract.yaml `x-eslint-policy`<br>Maintain ESLint plugin `.opencode/tools/eslint-plugin-opencode-mock-audit/`<br>Maintain MCP tool `.opencode/scripts/mcp-tools/eslint-audit.js`<br>Maintain machine.json schema |
| @Coder-BE/@Coder-FE | After write/edit, it is recommended to call eslint-audit (Layer A)<br>**Must call compliance_gate_complete at end of task** (Layer B)<br>On violation: fix code OR request @Arbiter waiver |
| @Guardian | Read machine.json.eslint_state → violations=0 and no stale status → PASS<br>Review waiver validity → reference TECH_DEBT_REGISTRY.md |
| @Arbiter | Approve waiver → Append record to TECH_DEBT_REGISTRY.md |
| @Orchestrator | Read machine.json → reject scheduling for dirty modules |

---

## 4. ESLint Plugin

**Location**: `.opencode/tools/eslint-plugin-opencode-mock-audit/`

### Rules

| Rule | Level | What It Detects |
|------|:---:|------|
| `no-tier1-mock` | **error** | `jest.spyOn(prisma.*, '*').mock*`, direct `.mockResolvedValue`, `jest.mock('@prisma/client')` |
| `no-skipped-audit` | **error** | `eslint-disable` bypasses `no-tier1-mock` but does not reference a valid waiver ID |
| `tier3-verify` | warn | TIER3 mock without call parameter verification |

### Key Design

```
Rules do not hardcode TIER service list
       ↓
Before each execution, auto-generate tier-rules.json from contract.yaml
       ↓
Rules read tier-rules.json to obtain TIER1_SERVICES
```

### Waiver Reference Format

```typescript
// eslint-disable-next-line booking/no-tier1-mock -- waiver: WAIVE-2026-001
```

waiver ID must exist in `TECH_DEBT_REGISTRY.md` with status = "approved". Empty comment or non-existent ID → `no-skipped-audit` reports error.

---

## 5. MCP Tool

**Location**: `.opencode/scripts/mcp-tools/eslint-audit.js`

```
MCP Server: eslint-audit
Tool: run_audit

Input:
  { changed_file?: string }     // Optional, single file scan
  { full_scan: true }           // Full scan, used when called by compliance_gate

Output:
  {
    status: "pass" | "fail",
    module: string,
    violations: [{ file, line, rule, message }],
    machine_json_updated: boolean
  }

Side Effect:
  Update machine.json.eslint_state.{module}
```

### Execution Flow

```
1. From contract.yaml → generate .opencode/generated/tier-rules.json
2. Determine scan scope (single file or full)
3. npx eslint --format json
4. Parse output → violations[]
5. Update machine.json.eslint_state:
   ├── status = violations > 0 ? "dirty" : "clean"
   ├── violations = [...]
   ├── last_check = now
   └── Recalculate aggregate counts
6. Return results
```

---

## 6. Three-Layer Triggers

### Layer A: Agent Proactive (Advisory)

```
@Coder executes write/edit
       │
       ▼
(Optional) eslint-audit.run_audit({ changed_file })
       │
       ├── PASS → Continue
       └── FAIL → Fix early, don't wait for gate
```

**Not a mandatory step. Agent can skip it.** Value is immediate feedback, reducing rework at gate time.

### Layer B: compliance_gate_complete (P0 Non-Bypassable)

```
@Coder completes development → compliance_gate_complete(session_id, summary)
                        │
                        ├── keystone_validate()           (Existing)
                        ├── eslint_audit.run_audit({       (New)
                        │       full_scan: true
                        │   })
                        │      │
                        │      ├── PASS → Continue
                        │      └── FAIL
                        │         ├── machine.json marked dirty
                        │         └── complete returns failed
                        │            Agent must fix and re-complete
                        │
                        └── machine.json.contract_compliance = "passed"
```

**Why depend on complete instead of check**: AGENTS.md already requires all tasks to start with `compliance_gate_check`. Similarly, `compliance_gate_complete` must be upgraded to a P0 mandatory end step — Agent not calling complete = task incomplete = @Orchestrator rejects scheduling next task.

**AGENTS.md needs addition**:
```markdown
### 🚨 P0 Mandatory Rule (Supplement)

All tasks must call compliance_gate_complete on completion. Tasks without complete
are considered incomplete, @Orchestrator rejects scheduling the Agent's next task.
```

### Layer C: pre-commit hook (Safety Net)

```bash
# .git/hooks/pre-commit
npx eslint --rule 'booking/no-tier1-mock: error' $(git diff --cached --name-only | grep '\.spec\.ts$')
# FAIL → commit rejected
```

Catches edge cases where Agent skips gate and commits directly. Can be bypassed via `--no-verify`, but Layer B has already intercepted.

---

## 7. contract.yaml Additions

```yaml
x-eslint-policy:
  version: "2.0.0"

  tier_definition:
    tier1_real_only:
      services: [PrismaService, RedisService, ConfigService]
      mock_policy: "forbidden"
      error_level: "error"
    tier2_fake_ok:
      services: [JwtService, QueueService, NotificationGateway, RateLimiterService]
      mock_policy: "warn"
      error_level: "warn"
    tier3_boundary_mock:
      services: [EmailService, SMSService]
      mock_policy: "require_param_verification"
      error_level: "warn"

  integration_test_requirement:
    mode: "per_module"
    modules:
      - appointments
      - auth
      - cache
      - email
      - health
      - notifications
      - rate-limiter
      - services
      - stats
      - time-slots
      - users
      - verification
```

---

## 8. machine.json Additions

```jsonc
{
  "x-keystone-state-hash": "<sha256>",

  "eslint_state": {
    "last_full_scan": "2026-05-14T13:00:00Z",
    "modules": {
      "time-slots": {
        "status": "clean",         // "clean" | "dirty" | "waived"
        "violations": [],
        "last_check": null,
        "waivers_applied": []
      }
    },
    "aggregate": {
      "total_violations": 0,
      "dirty_modules": [],
      "waived_modules": []
    }
  },

  "contract_compliance": {
    "eslint_audit": "passed",      // Written by compliance_gate_complete
    "checked_at": null
  },

  "waivers_consumed": []
}
```

---

## 9. @Guardian Review Flow (Machine Judgment)

```
@Guardian Review:

1. Read machine.json.eslint_state

2. aggregate.total_violations > 0 ?
   ├── NO  → Continue to step 3
   └── YES → Check waivers one by one
       ├── violation.waiver is not null
       │   └── TECH_DEBT_REGISTRY.md exists and approved and not expired
       │       ├── YES → This violation is waived
       │       └── NO  → FAIL (CAT1.0: Invalid waiver)
       └── violation.waiver is null
           └── FAIL (CAT1.1: TIER1 mock without waiver)

3. integration_test_coverage check
   ├── contract.yaml x-eslint-policy.integration_test_requirement.modules
   ├── Scan test/integration/
   ├── Missing modules = [] → PASS
   └── Missing modules ≠ [] → FAIL (CAT3.6)
       → @Meta-Planner DAG auto-inserts test completion task

4. Write machine.json.contract_compliance
```

---

## 10. Waiver Mechanism

```
@Coder → @Arbiter: "/waiver TIER1 time-slots time-slots.service.spec.ts:466"

@Arbiter Approves → Append to TECH_DEBT_REGISTRY.md:
  | WAIVE-2026-001 | TIER1 | time-slots | jest.spyOn(prisma.timeSlot) |
    Awaiting Testcontainers migration | 2026-06-14 | approved |

@Coder in code:
  // eslint-disable-next-line booking/no-tier1-mock -- waiver: WAIVE-2026-001

machine.json:
  .eslint_state.modules.time-slots.violations[0].waiver = "WAIVE-2026-001"
  .waivers_consumed += "WAIVE-2026-001"

@Orchestrator Check:
  waiver.expires_at < now → expired → remark module as dirty → reject scheduling
```

---

## 11. Constraint Strength Verification

### Original Bug Under the New Architecture

```
@Coder-BE writes: jest.spyOn(prisma.timeSlot, 'findMany').mockResolvedValue(...)

Layer A (Proactive):  Agent may skip                    → Not found  ← Allowed, not mandatory

Layer B (Gate):  compliance_gate_complete()
                    └→ eslint-audit.run_audit({ full_scan: true })
                    └→ 'no-tier1-mock' → error
                    └→ machine.json.time-slots.status = "dirty"
                    └→ complete returns FAIL             ← Blocked ✓
                    
                  Agent doesn't call complete?
                    └→ Task incomplete
                    └→ @Orchestrator does not schedule next  ← Blocked ✓

Layer C (Hook):  git commit → pre-commit hook → ESLint → FAIL  ← Blocked ✓

Even if all three layers fail:
  @Guardian reads machine.json → "dirty" → FAIL          ← Blocked ✓
```

### All Attack Vectors

| Attack | Result | Mechanism |
|------|:---:|------|
| Write violation code, call complete | **Blocked** | complete internal full scan → FAIL |
| Write violation code, don't call complete | **Blocked** | Task incomplete, @Orchestrator rejects scheduling |
| git commit --no-verify | **Blocked** | gate already intercepted at complete time |
| eslint-disable without waiver | **Blocked** | no-skipped-audit rule → error |
| eslint-disable + fake waiver ID | **Blocked** | @Guardian verifies TECH_DEBT_REGISTRY |
| eslint-disable + expired waiver | **Blocked** | @Orchestrator checks expiry → reject scheduling |
| @Guardian misses it | **Blocked** | machine.json status field is machine-written, no human judgment needed |

---

## 12. MCP Tool Registration

The `eslint-audit` MCP server needs to be registered in the opencode client configuration for Agents to discover and call it. Add the following entry to `~/.config/opencode/opencode.json` or equivalent client configuration:

```json
{
  "mcpServers": {
    "eslint-audit": {
      "command": "node",
      "args": [".opencode/scripts/mcp-tools/eslint-audit.js"],
      "env": {},
      "disabled": false,
      "autoApprove": null
    }
  }
}
```

Once registered, all Agents can call this MCP tool via `eslint_audit.run_audit()`.

---

## 13. Implementation Steps

| # | Role | Content | Output |
|:--:|------|------|------|
| 1 | @Architect | Create ESLint plugin | `.opencode/tools/eslint-plugin-opencode-mock-audit/` |
| 2 | @Architect | Create MCP tool server | `.opencode/scripts/mcp-tools/eslint-audit.js` |
| 3 | @Architect | Update contract.yaml | Add `x-eslint-policy` section |
| 4 | @Architect | Update machine.json schema | Add `eslint_state` |
| 5 | @Architect | Update compliance_gate_complete | Add eslint_audit check |
| 6 | @Architect | Update AGENTS.md | Upgrade complete to P0 mandatory |
| 7 | @Architect | Update @Guardian review checklist | Add eslint_state judgment |
| 8 | @Architect | Create pre-commit hook | ESLint safety net check |
| 9 | @Coder-BE | Fix `time-slots.service.spec.ts` | Switch to Testcontainers |
| 10 | @Coder-BE | Add `time-slots.integration.spec.ts` | Testcontainers real PostgreSQL |
| 11 | @Guardian | Full validation | All modules eslint_state = clean |
| 12 | @Arbiter | Approve legacy waivers | TECH_DEBT_REGISTRY.md |
