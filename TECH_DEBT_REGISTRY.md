# Technical Debt Registry

> 本文件由 @Arbiter 维护，记录所有已批准的技术债豁免。  
> @Meta-Planner 在新版本规划时必须扫描此文件，将临近偿还日的技术债转化为新任务。

## 格式

```yaml
- id: "TECH-001"
  description: "技术债描述"
  impact: "中/高/低"
  approved_by: "@Arbiter"
  approved_date: "YYYY-MM-DD"
  repayment_deadline: "YYYY-MM-DD"
  status: "pending | OPEN | approved | in_progress | repaid | waived"
  linked_task_id: "TXXX"
```

---

*当前未偿还技术债如下。*

| ID | 描述 | 影响 | 批准人 | 批准日期 | 截止日期 | 状态 | 关联任务 |
|----|------|------|--------|----------|----------|------|---------|
| TECH-001 | chart-js-token-map.md 调色板已于 2026-05-18 同步 Sharp Design (#2ecc71) — ✅ @Coder-FE 修复 dashboard-chart-factories.ts（teal #1abc9c + blue #00c6ff），@Architect 更新 docs/design/chart-js-token-map.md；26/26 测试通过 | 低 | @Arbiter | 2026-05-13 | 2026-05-20 | **repaid** ✅ | T-TECHDEBT-001 |
| TECH-002 | Backend `price` 字段返回类型为 `string` 而非 `number` (contract.yaml § Service/Appointment data_models 标注 TICKET-001)；计划 v2.0.0 修复，前端需继续做 parseFloat 兼容 | 中 | @Arbiter | 2026-05-13 | 2026-06-30 | **approved** | — |
| TECH-003 | i18n 字典参数化架构 (Phases 2-5) 尚未实现；约 7-8 工作日工作量，当前所有 UI 文本为硬编码，fallback keys `{{domain.key}}` 可见 | 低 | @Arbiter | 2026-05-13 | — | **waived** | — |

---

## 裁决记录

### 2026-05-13 — @Arbiter 全量审查

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
| TECH-001 | **Repaid** ✅ | chart-js-token-map.md 已同步 Sharp Design 调色板。@Coder-FE 修复 dashboard-chart-factories.ts：index 2 重复绿色 (#2ecc71) → 蓝绿色 (#1abc9c)，index 5 添加蓝色 (#00c6ff)。@Architect 更新 docs/design/chart-js-token-map.md §2.3/§8/§9 添加 blue token。26/26 测试通过，调色板与原型一致。偿还于 2026-05-18。|


---

**最后更新**: 2026-05-14  
**维护者**: @Arbiter  
**签名**: `@Arbiter — 2026-05-14T00:00:00Z`  
**位置**: 项目根目录

---

## 豁免登记表 (Waiver Registry)

| Waiver ID | Approval Date | Responsible | Reason for Waiver | Planned Repayment Date | Status |
|-----------|---------------|-------------|-------------------|------------------------|--------|
| WV-2026-001 | 2026-05-13 | @Coder-FE / @Coder-BE | i18n fallback keys `{{domain.key}}` are expected intermediate state of un-implemented Phases 2-5; not a defect | Auto-resolved when Phases 2-5 implemented | OPEN |
| WV-2026-002 | 2026-05-14 | @Coder-BE / @CI-CD-Agent | Stryker mutation testing not yet integrated in CI — mutation_kill_rate in x-coverage-matrix requires Stryker; jest.config.js alone cannot enforce this threshold (TD-2026-004) | 2026-06-14 | OPEN |
| WV-2026-003 | 2026-05-14 | @Coder-BE | Deprecation of existing `testing:` section in contract.yaml — must be marked `deprecated: true` (not deleted) for backward compatibility (ARB-002) | During TEST-ARCH-V2 implementation | OPEN |
| WV-2026-004 | 2026-05-14 | @Coder-BE / @Guardian | CI mock-audit ESLint enforcement gated on fake file existence validation — fake files must exist and pass their own tests before TIER2 rules are enforced (ARB-003) | During TEST-ARCH-V2 implementation | OPEN |

| TD-2026-005-DEPR | Deprecate `salesforce-dx-expert` — draft placeholder skill, never developed since 2026-04-23; SKILL.md is 19-line boilerplate ("此技能待完善"). No agent refs, not in available_skills. | 低 | @Arbiter | 2026-05-18 | — | **deprecated** | UNIV-013 |
| TD-2026-006-DEPR | Deprecate `playwright-mcp-expert` — draft placeholder skill, never developed; native Playwright MCP tools (`playwright_browser_*`) already available in system prompt. | 低 | @Arbiter | 2026-05-18 | — | **deprecated** | UNIV-013 |
| TD-2026-007-DEPR | Deprecate `devops-architect` — draft placeholder skill, superseded by active `devops-ci-cd-guardrails` (P1, in available_skills). | 低 | @Arbiter | 2026-05-18 | — | **deprecated** | UNIV-013 |

---

## 裁决记录

### 2026-05-18 — @Arbiter UNIV-013 Dormant Skill Audit

| Item | Decision | Rationale |
|------|----------|-----------|
| TD-2026-005-DEPR (`salesforce-dx-expert`) | **Deprecated** | Draft placeholder (19-line stub). Never developed since 2026-04-23. No agent references, no assets, not in available_skills. DEPRECATED.md created in `.task_temp/UNIV-013/`. |
| TD-2026-006-DEPR (`playwright-mcp-expert`) | **Deprecated** | Draft placeholder (19-line stub). Native Playwright browser tools already available. Redundant. DEPRECATED.md created in `.task_temp/UNIV-013/`. |
| TD-2026-007-DEPR (`devops-architect`) | **Deprecated** | Draft placeholder (19-line stub). Functionally superseded by active `devops-ci-cd-guardrails` (P1). DEPRECATED.md created in `.task_temp/UNIV-013/`. |
| `learning-mode-executor` | **Active — No Action** | Comprehensive 134-line SKILL.md with well-structured 3-phase pipeline. Not in available_skills but content is production-quality. Stale backup (`SKILL.md.backup`) handled by UNIV-014. |
| `auto-commit` | **Active — No Action** | Comprehensive 219-line SKILL.md with supporting `assets/commit-template.md`. Not in available_skills but content is production-quality. No update needed. |
| Registry inconsistency | **Flagged** | `skill-invocation-standard.md` §3.1 lists `salesforce-dx-expert`, `playwright-mcp-expert`, `devops-architect` as "✅ 活跃" — they are actually `draft` placeholders. @Architect must correct status to "❌ 废弃". |
| Scope limitation | **Delegated to @Architect** | @Arbiter write scope excludes `.opencode/skills/`. DEPRECATED.md files (×3) placed in `.task_temp/UNIV-013/` for @Architect to deploy to target directories. |

---

## 豁免登记表 (Waiver Registry)

| Waiver ID | Approval Date | Responsible | Reason for Waiver | Planned Repayment Date | Status |
|-----------|---------------|-------------|-------------------|------------------------|--------|
| WV-2026-001 | 2026-05-13 | @Coder-FE / @Coder-BE | i18n fallback keys `{{domain.key}}` are expected intermediate state of un-implemented Phases 2-5; not a defect | Auto-resolved when Phases 2-5 implemented | OPEN |
| WV-2026-002 | 2026-05-14 | @Coder-BE / @CI-CD-Agent | Stryker mutation testing not yet integrated in CI — mutation_kill_rate in x-coverage-matrix requires Stryker; jest.config.js alone cannot enforce this threshold (TD-2026-004) | 2026-06-14 | OPEN |
| WV-2026-003 | 2026-05-14 | @Coder-BE | Deprecation of existing `testing:` section in contract.yaml — must be marked `deprecated: true` (not deleted) for backward compatibility (ARB-002) | During TEST-ARCH-V2 implementation | OPEN |
| WV-2026-004 | 2026-05-14 | @Coder-BE / @Guardian | CI mock-audit ESLint enforcement gated on fake file existence validation — fake files must exist and pass their own tests before TIER2 rules are enforced (ARB-003) | During TEST-ARCH-V2 implementation | OPEN |
| WV-2026-005 | 2026-05-18 | @Architect | Scope limitation: @Arbiter cannot write to `.opencode/skills/`. @Architect must place DEPRECATED.md files (×3) from `.task_temp/UNIV-013/` into target skill directories and update `skill-invocation-standard.md` references. | 2026-05-25 | OPEN |

---

**最后更新**: 2026-05-18  
**维护者**: @Arbiter  
**签名**: `@Arbiter — 2026-05-18T03:42:00Z`  
**位置**: 项目根目录
