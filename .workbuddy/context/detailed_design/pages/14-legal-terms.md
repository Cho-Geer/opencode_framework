# Terms of Service Page (TermsPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Terms of Service |
| **Route Path** | `/legal/terms` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Loading** | `features/legal/legal.routes.ts` → `LEGAL_ROUTES` |
| **Component** | `TermsComponent` (`src/app/features/legal/terms.component.ts`) |
| **Design Basis** | SAD 2.3.1 (legal pages), reference target for registration page "Accept Terms of Service" |

## User Roles

- Public access (no authentication required)

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

- None

## Component Parameters

- No `@Input()` / `@Output()`
- No service injection (only imports `RouterModule` for in-template links)

## API Contract Mapping

- No API calls (purely static page)

## Interaction Flow

1. User directly accesses `/legal/terms` or clicks "Terms of Service" link from registration page
2. Page displays terms of service content

## Data Sources

- SAD 2.3.1 (Pages list — inferred legal pages)
