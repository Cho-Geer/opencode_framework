---
name: "page-verification"
description: "Qoder Page Verification Protocol (QPV) — a structured Browser subagent skill for visually and functionally verifying affected pages after code changes. Triggered when `qpv_required: true` is present in Coding subagent output. Covers layout/design, input/output, error handling, and performance threshold verification using Playwright MCP tools."
---

# Page Verification Protocol (QPV)

## Description

QPV is a mandatory post-implementation verification protocol executed by the Browser subagent. It validates that code changes (frontend, backend, or database) have not broken visual layout, functional behavior, error handling, or performance on affected pages. All verification thresholds and design tokens are loaded from `qpv-config.json` — nothing is hardcoded.

## Trigger Conditions

Invoked when `qpv_required: true` is present in Coding subagent output.
Applies to any `change_origin`: frontend, backend, or database.

## Prerequisites

Before executing QPV, the following conditions MUST be met:

- Application must be running (both backend API server AND frontend dev server)
- Affected page routes must be accessible in the browser
- `qpv-config.json` must exist at `.qoder/config/qpv-config.json`
- Playwright MCP tools must be available and connected

## Execution Flow

### Step 0 — Affected Page Resolution (APR)

> Applies to: backend and database changes only. Frontend changes skip to Category 1.

1. Read `.qoder/config/qpv-config.json` to load `endpoint_page_map` and `contract_file` path
2. Read the contract file to identify which endpoints are affected by changed files
3. Map endpoints to page routes using `endpoint_page_map`
4. For database changes: trace model → importing services → controller endpoints → pages
5. **Output**: list of `affected_pages` and `affected_endpoints` for the report

### Category 1 — Layout & Design Verification (LDV)

> Applies to: frontend changes only

1. Load design tokens from `qpv-config.json → design_system` (colors, border_radius, border_width, breakpoints)
2. Navigate to each affected page via `playwright_navigate`
3. Take full-page screenshots at each configured breakpoint:
   - Call `playwright_resize` to set viewport to breakpoint dimensions
   - Call `playwright_screenshot` to capture full-page screenshot
4. Execute CSS property checks via `playwright_evaluate`:
   - Verify background colors, border colors, accent colors, and text colors against configured design tokens
   - Verify component selectors match configured `border_radius` and `border_width`
5. Verify **no horizontal overflow** at any configured breakpoint:
   - Via `playwright_evaluate`: check `document.documentElement.scrollWidth <= document.documentElement.clientWidth`

### Category 2 — Input & Output Verification (IOV)

> Applies to: all change origins

1. Identify all form elements on affected pages via `playwright_get_visible_html`
2. For each form:
   - Fill with **valid data** using `playwright_fill` → `playwright_click` submit → verify success state via `playwright_get_visible_text`
   - Fill with **invalid data** using `playwright_fill` → `playwright_click` submit → verify inline error messages appear via `playwright_get_visible_text`
3. Verify data tables/lists display correct data via `playwright_get_visible_html`
4. For backend/database changes:
   - Call `playwright_get` on affected GET endpoints to verify API response shape matches contract
   - Call `playwright_post` on affected POST endpoints with valid payloads to verify response shape

### Category 3 — Error Verification (EV)

> Applies to: all change origins

1. Use `playwright_evaluate` to intercept fetch/XHR and mock error responses for each status code defined in `qpv-config.json → error_codes`
2. Verify correct error UI appears for each mocked status code via `playwright_get_visible_text`
3. Test form validation:
   - Submit empty forms → verify required field errors render
   - Submit forms with invalid data → verify validation messages render
4. Navigate to invalid routes via `playwright_navigate` → verify 404/not-found page renders
5. For backend changes: verify new validation rules are surfaced correctly in the UI
6. For database changes: verify constraint violations show user-friendly messages

### Category 4 — Threshold Verification (TV)

> Applies to: all change origins

1. Load thresholds from `qpv-config.json → thresholds` (initial_load_ms, navigation_ms, contrast_ratio)
2. Measure page load performance via `playwright_evaluate`:
   ```javascript
   JSON.stringify(performance.timing)
   ```
3. Verify:
   - Page load time < `thresholds.initial_load_ms`
   - Navigation time < `thresholds.navigation_ms`
4. Resize viewport to each configured breakpoint via `playwright_resize`:
   - Verify no layout collapse or breakage via `playwright_screenshot` + visual check
5. Check text contrast ratio >= `thresholds.contrast_ratio` via `playwright_evaluate`:
   - Compute foreground/background color luminance ratio on key text elements

## Scope Determination

The Leader determines which categories apply based on `change_origin` + `change_type`:

| Change Origin | Change Type | Applicable Categories |
|---------------|-------------|----------------------|
| Frontend | New page | LDV + IOV + EV + TV |
| Frontend | Style change | LDV only |
| Frontend | Form change | IOV + EV |
| Backend | Controller/DTO | IOV + EV |
| Backend | Service logic | IOV only |
| Backend | Error handling | EV only |
| Backend | Performance | TV only |
| Database | Model fields | IOV + EV |
| Database | Constraints | EV only |
| Database | Relations | IOV + TV |

## Output

Write `page_verification_report.json` to `.task_temp/{taskId}/`:

```json
{
  "task_id": "T-XXX",
  "change_origin": "frontend|backend|database",
  "changed_files": ["path/to/changed/file1", "path/to/changed/file2"],
  "affected_endpoints": ["/api/v1/endpoint1", "/api/v1/endpoint2"],
  "verified_pages": ["/page1", "/page2"],
  "resolution_method": "direct|qpv-config.json endpoint_page_map|model→endpoint→page",
  "categories": {
    "layout_design": {
      "status": "PASS|FAIL|SKIPPED",
      "checks": [],
      "failures": []
    },
    "input_output": {
      "status": "PASS|FAIL|SKIPPED",
      "checks": [],
      "failures": []
    },
    "error_handling": {
      "status": "PASS|FAIL|SKIPPED",
      "checks": [],
      "failures": []
    },
    "threshold": {
      "status": "PASS|FAIL|SKIPPED",
      "measurements": {},
      "failures": []
    }
  },
  "overall": "PASS|FAIL",
  "evidence": {
    "screenshot_paths": ["path/to/screenshot1.png"],
    "console_logs": ["relevant console output"],
    "api_responses": [{"endpoint": "/api/v1/x", "status": 200, "body_shape": "..."}]
  }
}
```

## Playwright MCP Tools Reference

| Tool | Usage in QPV |
|------|-------------|
| `playwright_navigate` | Navigate to affected page routes |
| `playwright_screenshot` | Capture full-page evidence at each breakpoint |
| `playwright_evaluate` | Execute JS for CSS checks, performance timing, overflow detection, contrast checks, fetch interception |
| `playwright_fill` | Fill form inputs with valid/invalid test data |
| `playwright_click` | Click submit buttons and interactive elements |
| `playwright_get_visible_text` | Read page text to verify success/error states |
| `playwright_get_visible_html` | Inspect DOM structure for forms, tables, lists |
| `playwright_resize` | Set viewport to configured breakpoints |
| `playwright_get` | Call GET endpoints directly for API shape verification |
| `playwright_post` | Call POST endpoints directly for API shape verification |

## Failure Handling

- If any applicable category results in `FAIL`, set `overall: "FAIL"`
- QPV failure blocks `compliance_gate_complete`
- Coding subagent must fix the issue and re-trigger QPV
- 3 consecutive QPV failures trigger @Arbiter circuit-breaker intervention

## Configuration Dependency

All values are loaded from `.qoder/config/qpv-config.json`:

- `design_system.*` — color tokens, border values, breakpoints
- `endpoint_page_map` — backend endpoint → page route mapping
- `thresholds.*` — performance and accessibility limits
- `error_codes` — HTTP status codes to test
- `source_paths` — file patterns that trigger QPV
- `exempt_paths` — file patterns exempt from QPV
- `contract_file` — path to the contract YAML
