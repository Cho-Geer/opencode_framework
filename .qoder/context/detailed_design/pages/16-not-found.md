# 404 Page (NotFoundPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | 404 Not Found |
| **Route Path** | `**` (wildcard, last route rule) |
| **Layout** | No layout shell (Standalone page) |
| **Component** | `NotFoundPageComponent` (`src/app/shared/pages/not-found-page/not-found-page.component.ts`) |
| **Design Basis** | Angular routing convention (wildcard route) |

## User Roles

- Public access

## Route Parameters

- None (wildcard route does not pass parameters)

## Route Guards

- None

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services

| Service | Purpose |
|---|---|
| `Router` | `goHome()` → navigate to `/booking` |

## API Contract Reference

- No API calls

## Interaction Flow

1. User visits a non-existent path → matches `**` wildcard
2. Displays 404 prompt page
3. Click "Back to Home" → `goHome()` → `router.navigate(['/booking'])`

## Data Sources

- Angular routing convention
