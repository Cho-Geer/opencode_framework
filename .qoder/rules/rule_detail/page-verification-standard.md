---
type: glob
description: Only when source files match
glob: src/**
---

# Page Verification Standard (QPV) v1.0

**制定时间**: 2026-05-24  
**版本**: v1.0.0  
**适用范围**: All tasks producing code changes that match `source_paths` patterns in `qpv-config.json`

---

## 一、适用范围 (Applicability)

### 1.1 Triggering Condition

QPV is **mandatory** for any task where at least one modified file matches a glob pattern defined in `qpv-config.json → source_paths`.

### 1.2 Exemptions

Tasks where **ALL** modified files match patterns defined in `qpv-config.json → exempt_paths` are exempt from QPV. No report is required for exempt tasks.

### 1.3 Change Origin Classification

| Change Origin | Determination Rule |
|---------------|-------------------|
| `frontend` | Modified files are under frontend source directories (as defined in `source_paths`) |
| `backend` | Modified files are under backend source directories (controllers, services, DTOs, modules) |
| `database` | Modified files include schema/model/migration files |

---

## 二、Affected Page Resolution (APR) Requirement

### 2.1 Mandatory Fields for Backend/Database Changes

For `change_origin: "backend"` or `change_origin: "database"`, the `page_verification_report.json` **MUST** include:

| Field | Requirement |
|-------|-------------|
| `affected_endpoints` | Non-empty array of endpoint paths affected by the change |
| `resolution_method` | One of: `"qpv-config.json endpoint_page_map"` or `"model→endpoint→page"` |
| `verified_pages` | Non-empty array of page routes derived from APR |

### 2.2 APR Validation Rules

- **Completeness**: Every changed backend file must map to at least one endpoint; every endpoint must map to at least one page
- **Traceability**: The `resolution_method` must accurately describe how pages were derived
- **No Orphans**: If an endpoint cannot be mapped to a page via `endpoint_page_map`, the agent must document why (e.g., internal-only endpoint) or escalate

### 2.3 Frontend Changes

For `change_origin: "frontend"`, APR is implicit — the `verified_pages` field contains the routes of pages whose component files were modified. `affected_endpoints` may be empty. `resolution_method` must be `"direct"`.

---

## 三、Pass Criteria per Category

### 3.1 Category 1 — Layout & Design Verification (LDV)

| Criterion | Pass Condition | Measurement Method |
|-----------|---------------|-------------------|
| Token Compliance | Zero mismatches between actual CSS values and configured design tokens in `qpv-config.json → design_system` | `playwright_evaluate` CSS property extraction |
| Horizontal Overflow | `scrollWidth <= clientWidth` at ALL configured breakpoints | `playwright_evaluate` DOM measurement |
| Screenshot Evidence | Full-page screenshots captured at every configured breakpoint for every verified page | `playwright_screenshot` output paths in `evidence.screenshot_paths` |
| Border Values | `border-radius` and `border-width` match configured values on all targeted selectors | `playwright_evaluate` computed style check |

**FAIL if**: Any token mismatch detected, OR horizontal overflow at any breakpoint, OR screenshots missing.

### 3.2 Category 2 — Input & Output Verification (IOV)

| Criterion | Pass Condition | Measurement Method |
|-----------|---------------|-------------------|
| Valid Input Flow | All identified forms accept valid data and display success state | `playwright_fill` + `playwright_click` + `playwright_get_visible_text` |
| Invalid Input Flow | All identified forms reject invalid data and display inline error messages | `playwright_fill` + `playwright_click` + `playwright_get_visible_text` |
| Data Binding | Data tables/lists on API-connected views display data matching API response shape | `playwright_get_visible_html` + `playwright_get` response comparison |
| API Shape | For backend/DB changes: affected endpoint responses match contract schema | `playwright_get` / `playwright_post` response validation |

**FAIL if**: Any form not tested with both valid AND invalid input, OR data binding mismatch detected, OR API response shape diverges from contract.

### 3.3 Category 3 — Error Verification (EV)

| Criterion | Pass Condition | Measurement Method |
|-----------|---------------|-------------------|
| Error Code Coverage | All status codes defined in `qpv-config.json → error_codes` trigger correct error UI | `playwright_evaluate` fetch interception + `playwright_get_visible_text` |
| Form Validation Errors | Empty/invalid form submissions render field-level error messages | `playwright_fill` + `playwright_click` + `playwright_get_visible_text` |
| 404 Handling | Navigation to invalid routes renders the not-found page | `playwright_navigate` to invalid path + `playwright_get_visible_text` |
| Empty States | Views with no data display appropriate empty-state UI (not blank/broken) | `playwright_get_visible_text` |
| Backend Validation | New backend validation rules surface user-friendly messages in UI | End-to-end form submission triggering backend validation |
| DB Constraints | Constraint violations (unique, FK, not-null) show user-friendly messages, not raw errors | Trigger constraint violation + verify UI message |

**FAIL if**: Any configured error code not tested, OR form validation errors not rendering, OR 404 page broken, OR raw error messages exposed to user.

### 3.4 Category 4 — Threshold Verification (TV)

| Criterion | Pass Condition | Measurement Method |
|-----------|---------------|-------------------|
| Initial Load | `loadEventEnd - navigationStart` < `qpv-config.json → thresholds.initial_load_ms` | `playwright_evaluate` Performance Timing API |
| Navigation | `domContentLoadedEventEnd - navigationStart` < `qpv-config.json → thresholds.navigation_ms` | `playwright_evaluate` Performance Timing API |
| Contrast Ratio | Text contrast ratio >= `qpv-config.json → thresholds.contrast_ratio` on key text elements | `playwright_evaluate` luminance computation |
| Responsive Integrity | No layout collapse at any configured breakpoint | `playwright_resize` + `playwright_screenshot` visual inspection |

**FAIL if**: Any threshold exceeded, OR contrast below configured minimum, OR layout collapses at any breakpoint.

---

## 四、Overall Pass Determination

### 4.1 Rule

```
overall = "PASS" if and only if ALL applicable categories have status === "PASS"
```

### 4.2 Category Applicability

A category is `"SKIPPED"` (not counted toward overall) only when the Scope Determination table in the QPV skill explicitly excludes it for the given `change_origin` + `change_type` combination.

### 4.3 Partial Results

If any applicable category is `"FAIL"`, `overall` MUST be `"FAIL"` regardless of other category results.

---

## 五、Failure Protocol

### 5.1 Blocking Behavior

QPV failure (`overall: "FAIL"`) **blocks** `compliance_gate_complete`. The task cannot be marked as complete until QPV passes.

### 5.2 Remediation Cycle

1. QPV returns `FAIL` → Coding subagent receives failure report with specific `failures` array
2. Coding subagent fixes the identified issues
3. Coding subagent re-triggers QPV (Browser subagent re-executes applicable categories)
4. Cycle repeats until `overall: "PASS"` or circuit-breaker triggers

### 5.3 Circuit-Breaker (Arbiter Intervention)

**3 consecutive QPV failures** on the same task trigger @Arbiter circuit-breaker:

- @Arbiter reviews failure patterns and root cause
- @Arbiter may grant a WAIVE for specific categories (documented in `WAIVE.md`)
- @Arbiter may escalate to @Architect for contract/design review
- @Arbiter may reassign the task or request human intervention

---

## 六、Evidence Requirements

### 6.1 Mandatory Report File

`page_verification_report.json` MUST exist at `.task_temp/{taskId}/` upon QPV completion.

### 6.2 Required Fields

| Field | Requirement | Validation |
|-------|-------------|-----------|
| `task_id` | Must match the current task ID | Exact string match |
| `change_origin` | Must be one of: `"frontend"`, `"backend"`, `"database"` | Enum validation |
| `changed_files` | Non-empty array of file paths that were modified | Array length > 0 |
| `affected_endpoints` | Required non-empty for backend/database changes | Conditional: non-empty when `change_origin !== "frontend"` |
| `verified_pages` | Non-empty array of page routes verified | Array length > 0 |
| `resolution_method` | Must be one of: `"direct"`, `"qpv-config.json endpoint_page_map"`, `"model→endpoint→page"` | Enum validation |
| `categories` | Object with applicable category results | Each applicable category must have `status` field |
| `overall` | Must be `"PASS"` or `"FAIL"` | Enum validation |
| `evidence.screenshot_paths` | Non-empty array when LDV is applicable | At least one screenshot per page per breakpoint |
| `evidence.console_logs` | Array of relevant console output captured during verification | Present (may be empty if no console errors) |
| `evidence.api_responses` | Required non-empty for backend/database IOV checks | Conditional: non-empty when IOV applied to backend/DB changes |

### 6.3 @Guardian Audit

@Guardian MUST verify:

1. `page_verification_report.json` exists and is valid JSON
2. `overall === "PASS"`
3. All applicable categories based on `change_origin` are present and `"PASS"`
4. `affected_endpoints` is populated for non-frontend changes
5. `evidence.screenshot_paths` reference actual files (if LDV was applicable)
6. No `"SKIPPED"` status on categories that should be applicable per Scope Determination

---

## 七、Exemptions

### 7.1 Path-Based Exemption

Tasks where **ALL** modified files match `qpv-config.json → exempt_paths` glob patterns are fully exempt. No QPV execution or report is required.

### 7.2 @Arbiter WAIVE Exemption

@Arbiter may grant a WAIVE for specific QPV categories under documented circumstances:

- WAIVE must be recorded in `WAIVE.md` with rationale
- WAIVE applies only to the specific task and categories named
- WAIVE must reference the @Arbiter decision ID
- WAIVEd categories appear as `"SKIPPED"` in the report with a `waive_reference` field

### 7.3 Backend No-Page-Impact Exemption

Backend changes that **provably cannot affect any page** may be exempted with:

1. Documented rationale in `WAIVE.md` explaining why no page is affected
2. Evidence that the changed endpoint has no entry in `endpoint_page_map`
3. Evidence that no frontend code imports/references the changed module
4. @Arbiter approval of the exemption

---

## 八、与其他规范的引用关系

| 规范文档 | 引用关系 |
|---------|---------|
| `AGENTS.md` | QPV integrates into the TDD/compliance flow at step 7 (post-GREEN) |
| `.qoder/skills/page-verification/skill.md` | This standard defines pass/fail criteria for that skill's execution |
| `.qoder/config/qpv-config.json` | Single source of truth for all thresholds, tokens, paths, and mappings |
| `state-machine-standard.md` | QPV report is evidence required for task lifecycle transitions |
| `dag-generation-standard.md` | QPV tasks may be auto-generated when page-affecting changes are detected |
| `common-project.md` | QPV is referenced as a quality gate in the execution framework |

---

## 九、违规处理

| 违规类型 | 违反规则 | 处理方式 |
|---------|---------|---------|
| Report missing | 六.1 | Task cannot complete; `compliance_gate_complete` rejects |
| Required field missing | 六.2 | @Guardian returns FAIL; Coding subagent must regenerate report |
| Applicable category SKIPPED without WAIVE | 四.2, 六.3 | @Guardian returns FAIL; all applicable categories must execute |
| APR incomplete for backend/DB | 二.1 | @Guardian returns FAIL; resolution must be documented |
| 3 consecutive failures | 五.3 | @Arbiter circuit-breaker; task suspended pending review |
| Threshold hardcoded instead of config-driven | 三.4 | @Guardian returns FAIL; values must reference qpv-config.json |
| Exempt task produces QPV report | 七.1 | Warning only; report is ignored |

---

_本文档将根据 QPV 协议演进持续更新。_
