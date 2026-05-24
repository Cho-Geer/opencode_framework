# ESLint Audit Strict Enforcement Implementation Plan

> **Version**: 2.0.0  
> **Date**: 2026-05-14  
> **Author**: @Architect  
> **Approval**: @Arbiter  

---

## 1. Problem to Solve

`time-slots.service.spec.ts` mocked `PrismaService` (TIER1) — violating CAT1.1. Unit tests did not catch it (all dependencies were mocked), @Guardian review did not block it, and Playwright caught the symptom but it was misdiagnosed. Root cause: **constraint rules have documentation but no automated enforcement**. This plan eliminates that gap.

---

## 2. Architecture Principles

### 2.1 Single Source of Truth

```
contract.yaml ← sole constraint definition
      │
      ├──→ tier-rules.json (auto-generated, not hand-written)
      ├──→ machine.json    (runtime state)
      └──→ ESLint rules    (enforcer)
```

### 2.2 Mandatory Layered Defense

Not one layer doing everything, but three layers stacked — each independently covers the blind spots of the previous one:

```
Layer A: Agent proactive  → advisory (early detection, not mandatory)
Layer B: Gate mandatory   → P0 non-bypassable (the truly effective defense line)
Layer C: Hook fallback    → catches unexpected bypasses outside the gate
```

**Only Layer B is truly non-bypassable.** Layers A and C are auxiliary; we do not depend on them.

---

## 3. Role Responsibilities

| Role | Responsibility |
|------|------|
| @Architect | Maintain contract.yaml `x-eslint-policy`<br>Maintain ESLint plugin `.qoder/tools/eslint-plugin-opencode-mock-audit/`<br>Maintain MCP tool `.qoder/scripts/mcp-tools/eslint-audit.js`<br>Maintain machine.json schema |
| @Coder-BE/@Coder-FE | After write/edit, recommended to call eslint-audit (Layer A)<br>**Must call compliance_gate_complete at task end** (Layer B)<br>On violations: fix code OR request @Arbiter waiver |
| @Guardian | Read machine.json.eslint_state → violations=0 and no stale state → PASS<br>Audit waiver validity → reference TECH_DEBT_REGISTRY.md |
| @Arbiter | Approve waiver → append record to TECH_DEBT_REGISTRY.md |
| @Orchestrator | Read machine.json → refuse to schedule dirty modules |

---

## 4. ESLint Plugin

**Location**: `.qoder/tools/eslint-plugin-opencode-mock-audit/`

### Rules

| Rule | Level | Detection Target |
|------|:---:|------|
| `no-tier1-mock` | **error** | `jest.spyOn(prisma.*, '*').mock*`, direct `.mockResolvedValue`, `jest.mock('@prisma/client')` |
| `no-skipped-audit` | **error** | `eslint-disable` bypassing no-tier1-mock without referencing a valid waiver ID |
| `tier3-verify` | warn | TIER3 mock not verifying call parameters |

### Key Design

```
Rules do not hardcode TIER service lists
       ↓
Before each execution, auto-generate tier-rules.json from contract.yaml
       ↓
Rules read tier-rules.json to obtain TIER1_SERVICES
```

### Waiver Reference Format

```typescript
// eslint-disable-next-line booking/no-tier1-mock -- waiver: WAIVE-2026-001
```

The waiver ID must exist in `TECH_DEBT_REGISTRY.md` with status = "approved". Empty comment or non-existent ID → `no-skipped-audit` reports error.

---

## 5. MCP Tool

**Location**: `.qoder/scripts/mcp-tools/eslint-audit.js`

```
MCP Server: eslint-audit
Tool: run_audit

Input:
  { changed_file?: string }     // optional, single file scan
  { full_scan: true }           // full scan, used when compliance_gate calls

Output:
  {
    status: "pass" | "fail",
    module: string,
    violations: [{ file, line, rule, message }],
    machine_json_updated: boolean
  }

Side effects:
  Updates machine.json.eslint_state.{module}
```

### Execution Flow

```
1. From contract.yaml → generate .qoder/generated/tier-rules.json
2. Determine scan scope (single file or full)
3. npx eslint --format json
4. Parse output → violations[]
5. Update machine.json.eslint_state:
   ├── status = violations > 0 ? "dirty" : "clean"
   ├── violations = [...]
   ├── last_check = now
   └── aggregate counts recalculated
6. Return result
```

---

## 6. Three-Layer Triggering

### Layer A: Agent Proactive (Advisory)

```
@Coder performs write/edit
       │
       ▼
(optional) eslint-audit.run_audit({ changed_file })
       │
       ├── PASS → continue
       └── FAIL → fix early, don't wait for gate
```

**Not a mandatory step. Agent may skip.** Value is immediate feedback, reducing rework at gate time.

### Layer B: compliance_gate_complete (P0 Non-Bypassable)

```
@Coder completes development → compliance_gate_complete(session_id, summary)
                        │
                        ├── keystone_validate()           (existing)
                        ├── eslint_audit.run_audit({       (new)
                        │       full_scan: true
                        │   })
                        │      │
                        │      ├── PASS → continue
                        │      └── FAIL
                        │         ├── machine.json marked dirty
                        │         └── complete returns failed
                        │            Agent must fix then re-complete
                        │
                        └── machine.json.contract_compliance = "passed"
```

**Why depend on complete rather than check**: AGENTS.md already mandates that all tasks start with `compliance_gate_check`. Likewise, `compliance_gate_complete` must be elevated to a P0 mandatory end step — Agent not calling complete = task incomplete = @Orchestrator refuses to schedule the next task.

**AGENTS.md addition required**:
```markdown
### 🚨 P0 Mandatory Rule (Supplement)

All tasks must call compliance_gate_complete at end. Tasks without complete called
are considered incomplete; @Orchestrator refuses to schedule that Agent's next task.
```

### Layer C: pre-commit hook (Fallback)

```bash
# .git/hooks/pre-commit
npx eslint --rule 'booking/no-tier1-mock: error' $(git diff --cached --name-only | grep '\.spec\.ts$')
# FAIL → commit rejected
```

Catches the edge case where Agent bypasses gate and commits directly. Can be bypassed with `--no-verify`, but Layer B has already intercepted first.

---

## 7. contract.yaml Addition

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

## 8. machine.json Addition

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

## 9. @Guardian Audit Flow (Machine Judgment)

```
@Guardian audit:

1. Read machine.json.eslint_state

2. aggregate.total_violations > 0 ?
   ├── NO  → proceed to step 3
   └── YES → check each waiver
       ├── violation.waiver is not null
       │   └── Exists in TECH_DEBT_REGISTRY.md and approved and not expired
       │       ├── YES → this violation is waived
       │       └── NO  → FAIL (CAT1.0: invalid waiver)
       └── violation.waiver is null
           └── FAIL (CAT1.1: TIER1 mock without waiver)

3. integration_test_coverage check
   ├── contract.yaml x-eslint-policy.integration_test_requirement.modules
   ├── Scan test/integration/
   ├── Missing modules = [] → PASS
   └── Missing modules ≠ [] → FAIL (CAT3.6)
       → @Meta-Planner DAG auto-inserts test backfill task

4. Write to machine.json.contract_compliance
```

---

## 10. Waiver Mechanism

```
@Coder → @Arbiter: "/waiver TIER1 time-slots time-slots.service.spec.ts:466"

@Arbiter approves → append to TECH_DEBT_REGISTRY.md:
  | WAIVE-2026-001 | TIER1 | time-slots | jest.spyOn(prisma.timeSlot) |
    Awaiting Testcontainers migration | 2026-06-14 | approved |

@Coder in code:
  // eslint-disable-next-line booking/no-tier1-mock -- waiver: WAIVE-2026-001

machine.json:
  .eslint_state.modules.time-slots.violations[0].waiver = "WAIVE-2026-001"
  .waivers_consumed += "WAIVE-2026-001"

@Orchestrator checks:
  waiver.expires_at < now → expired → module re-marked dirty → scheduling refused
```

---

## 11. Constraint Strength Verification

### Original Bug Under New Architecture

```
@Coder-BE writes: jest.spyOn(prisma.timeSlot, 'findMany').mockResolvedValue(...)

Layer A (proactive):  Agent may skip                      → not detected  ← allowed, not mandatory

Layer B (gate):  compliance_gate_complete()
                    └→ eslint-audit.run_audit({ full_scan: true })
                    └→ 'no-tier1-mock' → error
                    └→ machine.json.time-slots.status = "dirty"
                    └→ complete returns FAIL              ← intercepted ✓
                    
                  Agent doesn't call complete?
                    └→ Task incomplete
                    └→ @Orchestrator won't schedule next   ← intercepted ✓

Layer C (hook):  git commit → pre-commit hook → ESLint → FAIL  ← intercepted ✓

Even if all three layers miss:
  @Guardian reads machine.json → "dirty" → FAIL            ← intercepted ✓
```

### All Attack Vectors

| Attack | Result | Mechanism |
|------|:---:|------|
| Write violating code, call complete | **Intercepted** | Full scan inside complete → FAIL |
| Write violating code, don't call complete | **Intercepted** | Task incomplete, @Orchestrator refuses to schedule |
| git commit --no-verify | **Intercepted** | Gate already intercepted at complete time |
| eslint-disable without waiver | **Intercepted** | no-skipped-audit rule → error |
| eslint-disable + fake waiver ID | **Intercepted** | @Guardian verifies TECH_DEBT_REGISTRY |
| eslint-disable + expired waiver | **Intercepted** | @Orchestrator checks expiration → refuses to schedule |
| @Guardian misjudgment | **Intercepted** | machine.json status field is machine-written, no human judgment required |

---

## 12. MCP Tool Registration

The `eslint-audit` MCP server needs to be registered in the opencode client configuration to be discoverable and callable by Agents. Add the following entry in `~/.config/opencode/opencode.json` or equivalent client configuration:

```json
{
  "mcpServers": {
    "eslint-audit": {
      "command": "node",
      "args": [".qoder/scripts/mcp-tools/eslint-audit.js"],
      "env": {},
      "disabled": false,
      "autoApprove": null
    }
  }
}
```

After registration, all Agents will be able to invoke this MCP tool via `eslint_audit.run_audit()`.

## 13. Implementation Steps

| # | Role | Content | Output |
|:--:|------|------|------|
| 1 | @Architect | Create ESLint plugin | `.qoder/tools/eslint-plugin-opencode-mock-audit/` |
| 2 | @Architect | Create MCP tool server | `.qoder/scripts/mcp-tools/eslint-audit.js` |
| 3 | @Architect | Update contract.yaml | Add `x-eslint-policy` section |
| 4 | @Architect | Update machine.json schema | Add `eslint_state` |
| 5 | @Architect | Update compliance_gate_complete | Add eslint_audit check |
| 6 | @Architect | Update AGENTS.md | Elevate complete to P0 mandatory |
| 7 | @Architect | Update @Guardian audit checklist | Add eslint_state judgment |
| 8 | @Architect | Create pre-commit hook | ESLint fallback check |
| 9 | @Coder-BE | Fix `time-slots.service.spec.ts` | Switch to Testcontainers |
| 10 | @Coder-BE | Add `time-slots.integration.spec.ts` | Testcontainers with real PostgreSQL |
| 11 | @Guardian | Full verification | All modules eslint_state = clean |
| 12 | @Arbiter | Approve remaining waivers | TECH_DEBT_REGISTRY.md |
