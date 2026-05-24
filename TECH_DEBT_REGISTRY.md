# Technical Debt Registry

> This file is maintained by @Arbiter and records all approved tech debt waivers.
> @Meta-Planner must scan this file when planning new versions, converting tech debt approaching repayment deadlines into new tasks.

## Format

```yaml
- id: "TECH-001"
  description: "Tech debt description"
  impact: "Medium/High/Low"
  approved_by: "@Arbiter"
  approved_date: "YYYY-MM-DD"
  repayment_deadline: "YYYY-MM-DD"
  status: "pending | OPEN | approved | in_progress | repaid | waived"
  linked_task_id: "TXXX"
```

---

*Current outstanding tech debt is listed below.*

| ID | Description | Impact | Approved By | Approval Date | Deadline | Status | Linked Task |
|----|-------------|--------|-------------|---------------|----------|--------|-------------|
| TECH-001 | chart-js-token-map.md palette synced to Sharp Design (#2ecc71) on 2026-05-18 — ✅ @Coder-FE fixed dashboard-chart-factories.ts (teal #1abc9c + blue #00c6ff), @Architect updated docs/design/chart-js-token-map.md; 26/26 tests passed | Low | @Arbiter | 2026-05-13 | 2026-05-20 | **repaid** ✅ | T-TECHDEBT-001 |
| TECH-002 | Backend `price` field return type is `string` instead of `number` (contract.yaml § Service/Appointment data_models marked TICKET-001); planned fix in v2.0.0, frontend continues using parseFloat workaround | Medium | @Arbiter | 2026-05-13 | 2026-06-30 | **approved** | — |
| TECH-003 | i18n dictionary parameterized architecture (Phases 2-5) not yet implemented; estimated 7-8 working days of effort, all UI text currently hardcoded, fallback keys `{{domain.key}}` visible | Low | @Arbiter | 2026-05-13 | — | **waived** | — |

---

## Arbitration Records

### 2026-05-13 — @Arbiter Full Review

| Item | Decision | Rationale |
|------|----------|-----------|
| TECH-001 | **Approved** | Cosmetic tech debt; already linked to PHASE1-THEME-REDESIGN; deadline 2026-05-20 is achievable within the theme redesign phase. |
| TECH-002 | **Approved** | Type mismatch is a contract breach (contract.yaml). Frontend parseFloat workaround is fragile. V2.0.0 repayment target (2026-06-30) is appropriate. Must be prioritized before any production release. |
| TECH-003 | **Waived** | Fallback keys are the *expected* intermediate state of a partially-implemented i18n architecture. Not a defect — Phases 2-5 not yet executed. Waiver removes false urgency; will be resolved when Phases 2-5 are implemented. See WAIVE.md for full justification. |

### 2026-05-14 — @Arbiter TEST-ARCH-V2 Review

| Item | Decision | Rationale |
|------|----------|-----------|
| x-test-mock-policy | **Approved** | Three-tier mock governance is well-designed: TIER1 Real-Only (Prisma/Redis/Config), TIER2 Fake-OK (JWT/Queue/Notification/RateLimiter), TIER3 Boundary-Mock (Email/SMS/Payment with mandatory arg verification). Enforced by ESLint + @Guardian. |
| x-test-contract | **Approved** | Contract-driven test generation follows single-source-of-truth principle. Six test types (positive, negative_auth, negative_validation, negative_rate_limit, schema_validation, idempotency) cover comprehensive API test matrix. |
| x-coverage-matrix | **Approved** (with conditions) | P0 95% / P1 85% / Global 85% thresholds are aggressive but achievable. mutation_kill_rate requires Stryker integration → tech debt TD-2026-004. Existing testing section must be deprecated not deleted → ARB-002. |
| ARB-001 | **Registered as TD-2026-004** | mutation_kill_rate field in x-coverage-matrix requires Stryker CI integration; not enforceable by jest.config.js alone. |
| ARB-002 | **Condition** | Existing `testing:` section must be marked `deprecated: true` (not deleted) for backward compatibility. |
| ARB-003 | **Condition** | CI mock-audit ESLint enforcement must be gated on fake file existence validation. |

### 2026-05-18 — @Arbiter TECH-001 Repayment Review

| Item | Decision | Rationale |
|------|----------|-----------|
| TECH-001 | **Repaid** ✅ | chart-js-token-map.md palette synced to Sharp Design. @Coder-FE fixed dashboard-chart-factories.ts: index 2 duplicate green (#2ecc71) → teal (#1abc9c), index 5 added blue (#00c6ff). @Architect updated docs/design/chart-js-token-map.md §2.3/§8/§9 adding blue token. 26/26 tests passed, palette matches prototype. Repaid on 2026-05-18. |


---

**Last Updated**: 2026-05-14
**Maintainer**: @Arbiter
**Signature**: `@Arbiter — 2026-05-14T00:00:00Z`
**Location**: Project root directory

---

## Waiver Registry

| Waiver ID | Approval Date | Responsible | Reason for Waiver | Planned Repayment Date | Status |
|-----------|---------------|-------------|-------------------|------------------------|--------|
| WV-2026-001 | 2026-05-13 | @Coder-FE / @Coder-BE | i18n fallback keys `{{domain.key}}` are expected intermediate state of un-implemented Phases 2-5; not a defect | Auto-resolved when Phases 2-5 implemented | OPEN |
| WV-2026-002 | 2026-05-14 | @Coder-BE / @CI-CD-Agent | Stryker mutation testing not yet integrated in CI — mutation_kill_rate in x-coverage-matrix requires Stryker; jest.config.js alone cannot enforce this threshold (TD-2026-004) | 2026-06-14 | OPEN |
| WV-2026-003 | 2026-05-14 | @Coder-BE | Deprecation of existing `testing:` section in contract.yaml — must be marked `deprecated: true` (not deleted) for backward compatibility (ARB-002) | During TEST-ARCH-V2 implementation | OPEN |
| WV-2026-004 | 2026-05-14 | @Coder-BE / @Guardian | CI mock-audit ESLint enforcement gated on fake file existence validation — fake files must exist and pass their own tests before TIER2 rules are enforced (ARB-003) | During TEST-ARCH-V2 implementation | OPEN |

| TD-2026-005-DEPR | Deprecate `salesforce-dx-expert` — draft placeholder skill, never developed since 2026-04-23; SKILL.md is 19-line boilerplate ("This skill is pending completion"). No agent refs, not in available_skills. | Low | @Arbiter | 2026-05-18 | — | **deprecated** | UNIV-013 |
| TD-2026-006-DEPR | Deprecate `playwright-mcp-expert` — draft placeholder skill, never developed; native Playwright MCP tools (`playwright_browser_*`) already available in system prompt. | Low | @Arbiter | 2026-05-18 | — | **deprecated** | UNIV-013 |
| TD-2026-007-DEPR | Deprecate `devops-architect` — draft placeholder skill, superseded by active `devops-ci-cd-guardrails` (P1, in available_skills). | Low | @Arbiter | 2026-05-18 | — | **deprecated** | UNIV-013 |
| TD-2026-008 | Framework Agent Config Parameterization | High | @Architect | 2026-05-21 | 2026-06-15 | **active** | UNIV-P6-O | UNIVERSALITY |
| TD-2026-009 | Rule File Template Resolution | High | @Architect | 2026-05-21 | 2026-06-15 | **active** | UNIV-P6-O | UNIVERSALITY |
| TD-2026-010 | Skill Registry Stale References | Medium | @Architect | 2026-05-21 | 2026-05-30 | **repaid** ✅ | UNIV-P6-O | SKILL |
| TD-2026-011 | Deprecated Skill Cleanup | Medium | @Architect | 2026-05-21 | 2026-06-01 | **active** | UNIV-P6-O | SKILL |

---

### 2026-05-21 — @Architect UNIV-P6-O Framework Universality Post-Mortem

| Item | Decision | Rationale |
|------|----------|-----------|
| TD-2026-008 | **Registered** | Agent configs (coder-be.md, coder-fe.md) now use `{placeholder}` patterns. Every new project must resolve these before use. Repayment: configure `project.config.json` and verify zero unresolved placeholders via `framework-self-test.js`. |
| TD-2026-009 | **Registered** | Backend + frontend coding standards are now tiered templates with `{placeholder}`s. New projects must configure `template_resolution` in `project.config.json` or the rules will render with visible fallback placeholders. |
| TD-2026-010 | **Registered** | `skill-invocation-standard.md` §3.1 still lists deprecated skills (`salesforce-dx-expert`, `playwright-mcp-expert`, `devops-architect`) — though their status was already corrected to `❌ Deprecated`, the remaining references in category descriptions (§2.1) and quick checklists (§5.3) need audit. |
| TD-2026-011 | **Registered** | `nextjs-router-guardrails` deprecated and `prisma-seed-cicd` renamed to `cicd-database-seeding`. Old skill files remain as reference. Full cleanup including DEPRECATED.md deployment to target directories is tracked by WV-2026-005. |

---

## Arbitration Records

### 2026-05-18 — @Arbiter UNIV-013 Dormant Skill Audit

| Item | Decision | Rationale |
|------|----------|-----------|
| TD-2026-005-DEPR (`salesforce-dx-expert`) | **Deprecated** | Draft placeholder (19-line stub). Never developed since 2026-04-23. No agent references, no assets, not in available_skills. DEPRECATED.md created in `.task_temp/UNIV-013/`. |
| TD-2026-006-DEPR (`playwright-mcp-expert`) | **Deprecated** | Draft placeholder (19-line stub). Native Playwright browser tools already available. Redundant. DEPRECATED.md created in `.task_temp/UNIV-013/`. |
| TD-2026-007-DEPR (`devops-architect`) | **Deprecated** | Draft placeholder (19-line stub). Functionally superseded by active `devops-ci-cd-guardrails` (P1). DEPRECATED.md created in `.task_temp/UNIV-013/`. |
| `learning-mode-executor` | **Active — No Action** | Comprehensive 134-line SKILL.md with well-structured 3-phase pipeline. Not in available_skills but content is production-quality. Stale backup (`SKILL.md.backup`) handled by UNIV-014. |
| `auto-commit` | **Active — No Action** | Comprehensive 219-line SKILL.md with supporting `assets/commit-template.md`. Not in available_skills but content is production-quality. No update needed. |
| Registry inconsistency | **Flagged** | `skill-invocation-standard.md` §3.1 lists `salesforce-dx-expert`, `playwright-mcp-expert`, `devops-architect` as "✅ Active" — they are actually `draft` placeholders. @Architect must correct status to "❌ Deprecated". |
| Scope limitation | **Delegated to @Architect** | @Arbiter write scope excludes `.opencode/skills/`. DEPRECATED.md files (×3) placed in `.task_temp/UNIV-013/` for @Architect to deploy to target directories. |

---

## Waiver Registry

| Waiver ID | Approval Date | Responsible | Reason for Waiver | Planned Repayment Date | Status |
|-----------|---------------|-------------|-------------------|------------------------|--------|
| WV-2026-001 | 2026-05-13 | @Coder-FE / @Coder-BE | i18n fallback keys `{{domain.key}}` are expected intermediate state of un-implemented Phases 2-5; not a defect | Auto-resolved when Phases 2-5 implemented | OPEN |
| WV-2026-002 | 2026-05-14 | @Coder-BE / @CI-CD-Agent | Stryker mutation testing not yet integrated in CI — mutation_kill_rate in x-coverage-matrix requires Stryker; jest.config.js alone cannot enforce this threshold (TD-2026-004) | 2026-06-14 | OPEN |
| WV-2026-003 | 2026-05-14 | @Coder-BE | Deprecation of existing `testing:` section in contract.yaml — must be marked `deprecated: true` (not deleted) for backward compatibility (ARB-002) | During TEST-ARCH-V2 implementation | OPEN |
| WV-2026-004 | 2026-05-14 | @Coder-BE / @Guardian | CI mock-audit ESLint enforcement gated on fake file existence validation — fake files must exist and pass their own tests before TIER2 rules are enforced (ARB-003) | During TEST-ARCH-V2 implementation | OPEN |
| WV-2026-005 | 2026-05-18 | @Architect | Scope limitation: @Arbiter cannot write to `.opencode/skills/`. @Architect must place DEPRECATED.md files (×3) from `.task_temp/UNIV-013/` into target skill directories and update `skill-invocation-standard.md` references. | 2026-05-25 | **CLOSED (Fulfilled)** |

---

### 2026-05-23 — @Architect TD-2026-010 Repayment

| Item | Decision | Rationale |
|------|----------|-----------|
| TD-2026-010 | **Repaid** ✅ | `skill-invocation-standard.md` §3.1 all three deprecated skills (`salesforce-dx-expert`, `playwright-mcp-expert`, `devops-architect`) already marked `❌ Deprecated` with `replaced_by` fields in §4 metadata. §2.1 category descriptions and §5.3 quick checklists already audited — deprecated references struck through with alternatives. DEPRECATED.md ×3 already deployed to target directories. WV-2026-005 already closed. Only remaining action was updating TECH_DEBT_REGISTRY.md status from `active` → `repaid`. Repaid 2026-05-23. |

---

**Last Updated**: 2026-05-23
**Maintainer**: @Arbiter
**Signature**: `@Architect — 2026-05-23T06:26:00Z`
**Location**: Project root directory

### 2026-05-23 — @Arbiter WV-2026-006 (MCP SDK Upstream Packaging Defect)

| Item | Decision | Rationale |
|------|----------|-----------|
| WV-2026-006 | **Approved** ✅ | Upstream `@modelcontextprotocol/sdk@1.29.0` missing `dist/cjs/index.js` barrel file — unresolvable external packaging defect. Sub-path imports work correctly (verified across 4 MCP tool scripts, 12 import statements). Zero functional impact. Waiver ID: WV-2026-006. |
| TD-2026-012 | **Registered** | MCP SDK root-level `require()` non-functional due to upstream packaging defect. Sub-path imports used as workaround. Requires monitoring: re-test root require when SDK v1.30+ ships, or create local barrel shim by 2026-08-23. |

| Waiver ID | Approval Date | Responsible | Reason for Waiver | Planned Repayment Date | Status |
|-----------|---------------|-------------|-------------------|------------------------|--------|
| WV-2026-006 | 2026-05-23 | @CI-CD-Agent / @Coder-BE | Upstream `@modelcontextprotocol/sdk@1.29.0` missing barrel `index.js` — sub-path imports work as alternative | 2026-08-23 | OPEN |

**Last Updated**: 2026-05-23
**Maintainer**: @Arbiter
**Signature**: `@Arbiter — 2026-05-23T06:40:00Z`
**Location**: Project root directory

---

### 2026-05-23 — @Arbiter RVW-REVIEW-01-TXNFIX Layer A Waiver (WV-2026-007/008/009)

| Item | Decision | Rationale |
|------|----------|-----------|
| WV-2026-007 (type_check_state) | **Waived** ✅ | 7 Angular frontend `.ts` files in `booking_system_refactor/booking-frontend/` have pre-existing TypeScript errors. Written by @Architect during FW-REPAIR-01, not caused by or related to the eslint-audit.js transaction envelope fix. Registered as TD-2026-013. |
| WV-2026-008 (format_state) | **Waived** ✅ | `contract.yaml` formatting issue is pre-existing and cosmetic. auto_fix resolved 24 other files but could not auto-fix this one. Not related to eslint-audit.js. Registered as TD-2026-014. |
| WV-2026-009 (tdd_enforcement_state) | **Waived** ✅ | 7 historical CAT5.2 violations (2026-05-21/22) from earlier FW-REPAIR-01 sessions on framework tool files. The eslint-audit.js fix ITSELF followed proper TDD (RED 5/5 FAIL → GREEN 5/5 PASS). Close relationship with current fix warrants aggressive repayment deadline. Registered as TD-2026-015. |

## Waiver Registry

| Waiver ID | Approval Date | Responsible | Reason for Waiver | Planned Repayment Date | Status |
|-----------|---------------|-------------|-------------------|------------------------|--------|
| WV-2026-007 | 2026-05-23 | @Coder-FE | 7 Angular frontend `.ts` files have pre-existing TypeScript errors in `booking_system_refactor/booking-frontend/` — separate codebase, unrelated to eslint-audit.js fix (TD-2026-013) | 2026-06-15 | OPEN |
| WV-2026-008 | 2026-05-23 | @Architect | `contract.yaml` formatting issue — pre-existing cosmetic issue, unrelated to eslint-audit.js fix (TD-2026-014) | 2026-06-15 | OPEN |
| WV-2026-009 | 2026-05-23 | @Coder-BE / @Architect | 7 historical CAT5.2 TDD violations from FW-REPAIR-01 sessions (2026-05-21/22) — predate current fix; the eslint-audit.js fix itself followed proper TDD (RED→GREEN) (TD-2026-015) | 2026-06-01 | OPEN |

## Tech Debt Registry

| ID | Description | Impact | Approved By | Approval Date | Deadline | Status | Linked Task |
|----|-------------|--------|-------------|---------------|----------|--------|-------------|
| TD-2026-013 | 7 Angular frontend `.ts` files have pre-existing TypeScript errors (booking_system_refactor/booking-frontend/) — @Coder-FE needs to fix these compilation errors | Medium | @Arbiter | 2026-05-23 | 2026-06-15 | **OPEN** | WV-2026-007 |
| TD-2026-014 | `contract.yaml` formatting issue — pre-existing; auto_fix cannot auto-fix this file | Low | @Arbiter | 2026-05-23 | 2026-06-15 | **OPEN** | WV-2026-008 |
| TD-2026-015 | 7 historical CAT5.2 TDD violations (code-quality-gate.js, state-transaction.js, compliance-gate.js, framework-self-test.js) — from FW-REPAIR-01 (2026-05-21/22); need supplementary tests or formal acceptance by @Meta-Planner as framework repair debt | Medium | @Arbiter | 2026-05-23 | 2026-06-01 | **OPEN** | WV-2026-009 |

**Last Updated**: 2026-05-23
**Maintainer**: @Arbiter
**Signature**: `@Arbiter — 2026-05-23T11:40:00Z`
**Location**: Project root directory
