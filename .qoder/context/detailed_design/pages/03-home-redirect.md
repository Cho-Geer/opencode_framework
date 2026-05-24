# Home/Redirect Page (HomeRedirectPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Home (Root Path Redirect) |
| **Route Path** | `/` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Loading** | `app.routes.ts` top-level route |
| **Component** | None (`redirectTo: 'booking'`) |
| **Design Basis** | Architectural convention inference (SAD does not separately define a home page) |

## User Roles

- CUSTOMER (ADMIN/SUPER_ADMIN will not reach this path)

## Route Parameters

- None

## Route Guards

| Guard | Path | Strategy |
|---|---|---|
| `authGuard` | Parent AppLayout path | Unauthenticated → redirect `/auth/login?returnUrl=/` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | Child route | ADMIN/SUPER_ADMIN → redirect `/admin/dashboard` |

## Behavior Description

- Defined in `app.routes.ts` as `{ path: '', redirectTo: 'booking', pathMatch: 'full' }`
- Visiting `/` automatically redirects to `/booking`
- Equivalent to entering the "Select Service" step of the booking creation flow
- Rendered within the `AppLayout` shell

## Key Features

| Item | Description |
|---|---|
| Core Function | Serves as root path entry point, redirects to CUSTOMER's core feature page (booking list → create booking) |
| Navigation Method | `redirectTo` Angular route redirect, not HTTP 302 |

## Data Sources

- SAD 2.3.1 (Pages list implies root route behavior)
- Angular routing convention (`path: ''` → `redirectTo`)
