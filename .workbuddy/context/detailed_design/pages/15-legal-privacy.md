# Privacy Policy Page (PrivacyPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Privacy Policy |
| **Route Path** | `/legal/privacy` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Loading** | `features/legal/legal.routes.ts` → `LEGAL_ROUTES` |
| **Component** | `PrivacyComponent` (`src/app/features/legal/privacy.component.ts`) |
| **Design Basis** | SAD 2.3.1, Security Architecture Design Document 9 (GDPR/PIPL compliance) |

## User Roles

- Public access (no authentication required)

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

- None

## Component Parameters

- No `@Input()` / `@Output()`
- No service injection

## API Contract Mapping

- No API calls (purely static page)

## Interaction Flow

1. User directly accesses `/legal/privacy` or clicks "Privacy Policy" link from registration page
2. Page displays privacy policy content

## Compliance Associations

| Compliance Requirement | Description |
|---|---|
| GDPR | Data minimization (JWT without PII), right to access/correct/delete data |
| PIPL | PII classification encryption (three-field storage model) |
| Security Architecture 9 | Privacy policy compliance statement |

## Data Sources

- SAD 2.3.1
- Security Architecture Design Document 9 (GDPR/PIPL compliance strategy)
- piiEncryptionStrategy (PII encryption strategy overview)
