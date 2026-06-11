# Arbiter Approval — UC7KS Hardening Remediations

**Arbiter**: @Arbiter  
**Review Date**: 2026-06-06  
**Session**: cg_ses_1780733446619  
**Review Scope**: 3 of 4 @Architect Critical Items (MOD-7, CRIT-3, CRIT-2)  
**Documents Reviewed**:
- `ARCHITECT_REVIEW.md` v1.0.0 (2026-06-06)
- `IMPLEMENTATION_PLAN.md` v1.0.0 (2026-06-06)

---

## Verdicts

### Remediation 1: MOD-7 — Cache Sufficiency Logic Bug

**File**: `.opencode/plugins/uc7ks-enforcer/uc7ks-enforcer.ts` L351–377  
**Architect's Finding**: The check `if (sufficiencyStatus !== "insufficient")` blocks agents that correctly declared `"sufficient"`. The architect recommended blocking only on `"undeclared"`:
```typescript
if (sufficiencyStatus !== "sufficient" && sufficiencyStatus !== "insufficient") {
```

**Evidence from File Read**:
```
360:         if (sufficiencyStatus !== "insufficient") {
361:           const errorMsg = buildUC7KSError(
362:             agent, tool, mode, true,
363:             "UC7-001b VIOLATION: ...Agent must declare specific missing topics...",
364:           );
...
370:           throw new Error(errorMsg);
```

The code at line 360 uses the **exact condition the architect flagged as buggy**: `sufficiencyStatus !== "insufficient"`. This means:
- `"sufficient"` → **BLOCKED** (false positive — agent found cache adequate)
- `"undeclared"` → **BLOCKED** (correct)
- `undefined`/`null` → **BLOCKED** (correct)

An agent that correctly reads the cache, finds everything it needs, and declares sufficiency as `"sufficient"` will be **erroneously blocked** from making any subsequent external query. This creates a false-positive enforcement that breaks legitimate agent workflows.

**Verdict**: ❌ **FAIL** — Logic bug not remediated.

---

### Remediation 2: CRIT-3 — Preamble Hardcoded Tech Stack Names

**File**: `.opencode/subagent-preamble.md` L17–28  
**Architect's Finding**: The preamble hardcodes Native stack technology names across 9 of 12 domains, violating the Templatization & Parameterization dimension (TP) of the 7-dimension architecture. The preamble is injected into **every sub-agent prompt** and must remain portable across all `COMPATIBILITY_PROFILE` conformance levels.

**Architect's Required Fix**:
| Domain | Current (hardcoded) | Required (stack-agnostic) |
|--------|---------------------|--------------------------|
| `backend_api` | NestJS controllers, endpoints, DTOs | API controllers, endpoints, DTOs, middleware |
| `persistence` | Prisma, migrations, schema | database ORM, schema, migrations, models |
| `frontend_ui` | Angular components, signals, stores | components, state management, styling, routing |
| `caching` | Redis, ioredis, cache patterns | cache engine, cache patterns, TTL management |
| `queue` | BullMQ, jobs, workers | job queues, workers, message scheduling |
| `testing` | Jest, Playwright, Supertest | test frameworks, integration testing, coverage |
| `auth_security` | JWT, Passport, guards, rate-limit | authentication, authorization, security guards |
| `framework_tools` | ESLint, Prettier, TypeScript, hooks | static analysis, formatting, type systems |
| `devops_ci` | Docker, GitHub Actions, pipelines | containerization, CI/CD platforms, pipelines |

**Evidence from File Read**:
```
17:    - `backend_api` (NestJS controllers, endpoints, DTOs)
18:    - `persistence` (Prisma, migrations, schema)
19:    - `frontend_ui` (Angular components, signals, stores)
20:    - `caching` (Redis, ioredis, cache patterns)
21:    - `queue` (BullMQ, jobs, workers)
22:    - `testing` (Jest, Playwright, Supertest)
23:    - `auth_security` (JWT, Passport, guards, rate-limit)
24:    - `framework_tools` (ESLint, Prettier, TypeScript, hooks)
25:    - `devops_ci` (Docker, GitHub Actions, pipelines)
26:    - `opencode_framework` (agent configs, rules, skills, plugins)
27:    - `infrastructure` (git, JSON Schema, Node.js, shell)
28:    - `state_management` (machine.json, gate-state.json, keystone, enforcement)
```

All 9 of the 12 domains that contain technology references **retain their Native-stack specific names**. The only observable change from the original plan is the addition of the 12th domain `state_management` (line 28), which is a T-H03 delivery, not a CRIT-3 fix.

**Impact**: A project using React + Express + SQLAlchemy (Compatible/Partial conformance) would inject misleading domain descriptions into every sub-agent prompt, causing confusion and potential implementation errors.

**Verdict**: ❌ **FAIL** — Tech stack names not replaced with stack-agnostic equivalents.

---

### Remediation 3: CRIT-2 — Pre-Execution Hook Path Leak + `require()` + Enforcement Mode

**File**: `.opencode/scripts/pre-execution-hook.sh` L36–47, L273–296  
**Architect's Finding**: Three sub-issues identified:

| # | Issue | Location in Plan | Required Fix |
|---|-------|-----------------|--------------|
| 2a | Absolute path leak `/home/zhaoge/.bun/bin/bun` | L40, L274 | Replace with `bun` (PATH-resolved) |
| 2b | JSON `require()` anti-pattern | L42, L274, L278, L296 | Replace with `JSON.parse(fs.readFileSync(..., 'utf8'))` |
| 2c | Enforcement mode reads deprecated single key | L43 | Use dual-key: `develop_enforcement_mode \|\| runtime_enforcement_mode` |

**Evidence from File Read**:

**2a — Path leak** (two locations):
- **Line 40** (enforcement mode resolution): `/home/zhaoge/.bun/bin/bun` — ❌ **NOT FIXED**
- **Line 273** (UC7KS gate): `bun` — ✅ **FIXED**

The path leak was fixed in the NEW code (UC7KS gate section, L273) but the OLD code (enforcement mode resolution, L40) still has the absolute path. This is an inconsistent partial fix.

**2b — `require()` anti-pattern** (four locations):
```bash
# Line 42: NOT FIXED
const cfg = require('${PROJECT_ROOT}/.opencode/project.config.json');

# Line 274: NOT FIXED
const idx = require('$INDEX_FILE');

# Line 278: NOT FIXED
console.log(require('$KNOWLEDGE_STATE').version)

# Line 296: NOT FIXED
const m = require('${MACHINE_FILE}');
```

All four uses of `require()` for JSON loading **remain unchanged**. While Bun supports `require()` for JSON, the architect correctly noted this pattern is fragile with path resolution and special characters in `PROJECT_ROOT`.

**2c — Enforcement mode** (line 43):
```javascript
const mode = cfg.template_resolution?.enforcement_mode;
```
Still uses the **deprecated single-key** `enforcement_mode`. Since FW-HARNESS-P6, the config uses a dual-key design. This code will read `undefined` when only the new keys exist, forcing fallback to `advisory` even when `strict` is configured.

**Verdict**: ❌ **FAIL** — Path leak fixed in only 1 of 2 locations; `require()` anti-pattern persists in all 4 locations; enforcement mode still uses deprecated single key.

---

## Overall Verdict

| Remediation | Architect Issue | Current State | Verdict |
|:------------|:----------------|:--------------|:--------|
| MOD-7 | Cache sufficiency blocks `"sufficient"` | `sufficiencyStatus !== "insufficient"` still present | ❌ FAIL |
| CRIT-3 | Preamble hardcodes Native tech stack | All 9 domains unchanged | ❌ FAIL |
| CRIT-2 | Hook: path leak + require() + enforcement mode | Partial path fix only; other 2 issues unresolved | ❌ FAIL |

### Overall: 🔴 **REJECTED**

All three remediations required by the @Architect's conditional approval remain **unresolved in the current codebase**. The implementation was carried out based on the original plan (IMPLEMENTATION_PLAN.md) without incorporating the architect's critical corrections.

## Required Actions Before Re-Submission

1. **MOD-7**: Change line 360 from `if (sufficiencyStatus !== "insufficient")` to `if (sufficiencyStatus !== "sufficient" && sufficiencyStatus !== "insufficient")`.
2. **CRIT-3**: Replace all Native-stack technology names in subagent-preamble.md L17-28 with stack-agnostic descriptions per the architect's recommendations.
3. **CRIT-2**:
   - Fix line 40: `/home/zhaoge/.bun/bin/bun` → `bun`
   - Fix lines 42, 274, 278, 296: `require()` → `JSON.parse(await Bun.file(path).text())` or `JSON.parse(fs.readFileSync(path, 'utf8'))`
   - Fix line 43: `cfg.template_resolution?.enforcement_mode` → `cfg.template_resolution?.develop_enforcement_mode || cfg.template_resolution?.runtime_enforcement_mode`

## Remaining Concerns

1. **CRIT-1** (schema duplication) and **CRIT-4** (context.directory path resolution) are outside this review scope but remain blocking per the architect.
2. **7 Moderate Concerns** (MOD-1 through MOD-7) from the architect review should also be addressed before Phase 4 validation.
3. **TDD Gap**: No RED-phase test tasks have been created for the implemented changes. This violates the DAG generation standard §G3.

---

*Arbiter Approval: v1.0.0 — 2026-06-06*  
*Review follows UC7KS pipeline: local cache searched → preamble Step 0b → compliance gate → evidence collection → verdict*
