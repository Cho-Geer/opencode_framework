# Admin Service Management Page (AdminServiceManagementPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Service Management |
| **Route Path** | `/admin/services` |
| **Layout** | `AppLayoutComponent` (Admin sidebar) |
| **Lazy Loading** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **Component** | `ServiceManagementComponent` (`src/app/features/admin/pages/service-management/service-management.component.ts`) |
| **Design Basis** | contract.yaml `admin.services` CRUD |

## User Roles

- ADMIN, SUPER_ADMIN

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` (parent) | Unauthenticated → Redirect |
| `roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })` (parent) | CUSTOMER denied |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `AdminStore` | `vm`, `setLoading()`, `setServices()`, `updateServiceInList()`, `removeServiceFromList()`, `setError()`, `services()`, `servicesTotal()`, `servicesPage()` |
| `AdminService` | `getAdminServices()`, `createAdminService()`, `updateAdminService()`, `deleteAdminService()` |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `viewMode` | `'grid' \| 'list'` | View toggle (grid/list) |
| `serviceDialogVisible` | `boolean` | Service edit dialog |
| `deleteDialogVisible` | `boolean` | Delete confirmation dialog |
| `selectedService` | `AdminServiceItem \| null` | Selected service |
| `serviceToDelete` | `AdminServiceItem \| null` | Service to be deleted |
| `isEdit` | `boolean` | Edit mode |
| `submitted` | `boolean` | Form submitted |
| `searchQuery` | `string` | Search keyword |
| `categoryFilter` | `string` | Category filter (bound to `?category=` query param) |
| `statusFilter` | `string` | Status filter |
| `formErrors` | `{ name?; duration?; price? }` | Form validation errors |
| `formName`, `formDescription`, `formDuration`, `formPrice`, `formActive`, `formImageUrl`, `formTaxRate` | Various types | Form field bindings |
| `computedPricePerMinute` | `number \| null` (computed) | Auto-calculated value: `formPrice / formDuration`; real-time calculation when duration > 0, display only (not a manual input field) |
| `totalServices` | `number` (computed) | Total services (source: `total` field from `GET /v1/admin/services` response, system-level total across pagination) |
| `activeServicesCount` | `number` (computed) | Active services count (calculated by filtering `active=true` from full service list `limit=999`) |
| `averagePrice` | `number` (computed) | Average price (calculated mean from full service list `limit=999`) |

> **Note**: `averagePrice` is currently calculated via `limit=999` full query. `contract.yaml` v1.7.3 has defined the `averagePrice` field for the `admin/services/summary` endpoint; can switch to dedicated summary endpoint later.

## API Contract Mapping

> **Response Envelope**: All successful API responses are wrapped by ResponseInterceptor in a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column below only describes the internal structure of the `data` field; the outer envelope is implicitly applicable.

| Method | Endpoint | Request Parameters/Body | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/services` | `?page&limit&search&active&category` | `PaginatedResponse<AdminServiceDto>` (`{id, name, description, duration, price, active, category, imageUrl?, createdAt, pricePerMinute?, taxRate?}`) | Bearer ADMIN/SUPER_ADMIN | Page init, filter, pagination |
> ⚠️ **Known Contract Deviation**
> ⚠️ **Field Type Note**: The `price` field returned by the backend is of **string** type (e.g., `"800"`), rather than `number`. The frontend converts it to numeric via `Number(s.price)` at the `loadAllServicesForStats()` data entry point, ensuring `averagePrice` calculation uses numeric addition rather than string concatenation. Paginated table display delegates to `currency` Pipe for auto formatting and is unaffected.
> **Fix Plan**: This is known technical debt (corresponding ADR to be created). The backend needs to correct `AdminServiceDto.price` return type to `number`, aligning with `{ type: "number", format: "decimal" }` defined in contract.yaml. The current workaround should not be long-term.
> **Note**: Stat cards use independent full-data requests (limit=999, separate from paginated table), not relying on dedicated summary endpoint. Active Services Count and Average Price are calculated from full data.
| `POST` | `/v1/admin/services` | `{name*, description?, duration*, price?, active?, imageUrl?, pricePerMinute?, taxRate?}` | `AdminServiceDto` (201) | Bearer ADMIN/SUPER_ADMIN | Create save |
| `PUT` | `/v1/admin/services/:id` | `{name?, description?, duration?, price?, active?, imageUrl?, pricePerMinute?, taxRate?}` | `AdminServiceDto` | Bearer ADMIN/SUPER_ADMIN | Edit save |
> **auto-calc**: `pricePerMinute` is auto-calculated as `price / duration` at the backend (when both are provided). The frontend no longer provides a manual `pricePerMinute` input field; instead displays the value calculated in real-time by the `computedPricePerMinute` signal. If the frontend explicitly passes `pricePerMinute`, the backend prioritizes the passed value; otherwise auto-calculates.
| `DELETE` | `/v1/admin/services/:id` | path: `id` | `void` (204) | Bearer ADMIN/SUPER_ADMIN | Delete confirmation |

## Backend Mapping

| Controller | File |
|---|---|
| `AdminServicesController` | `src/modules/admin/controllers/admin-services.controller.ts` — Route prefix `"admin/services"` |
| `AdminServicesService` | `src/modules/admin/services/admin-services.service.ts` — Delegates to `ServicesService` |

Permission control:
| Endpoint | Minimum Role |
|---|---|
| `GET /admin/services` | ADMIN |
| `POST /admin/services` | ADMIN |
| `PUT /admin/services/:id` | ADMIN |
| `DELETE /admin/services/:id` | ADMIN |

## Interaction Flow

1. Access `/admin/services`, parent guard validation
2. `loadServices()` → `AdminService.getAdminServices({ page, search, active })` → `AdminStore.setServices()`
3. View toggle: Grid view (cards) / List view (table)
4. Search box + category filter + status filter
5. Click "New" → `serviceDialogVisible = true`, `isEdit = false`
6. Click service "Edit" → Dialog pre-filled, `isEdit = true`
7. Form: Name (required *), Description, Duration (minutes), Price (required *), Image URL, Active toggle
7a. **Price Validation**: Price field is required and must be a positive number (> 0). If price is `null`, empty, or ≤ 0 on submission, the frontend displays a validation error and the form refuses submission.
8. **`pricePerMinute` Auto-Calculation**: When the user enters `duration` and `price`, the frontend auto-calculates and displays the `price / duration` result via the `computedPricePerMinute` signal (display only, not an input field). The template uses `@if (isViewMode())` guard to control display, ensuring the latest unit price is always recalculated and displayed in edit mode, avoiding template condition errors causing `$0.00` display. The frontend does not send `pricePerMinute` on save; it is calculated by the backend in `AdminServicesService`: `pricePerMinute = dto.price / dto.duration`. This design avoids manual calculation errors and ensures data consistency.
> **Architecture Decision**: The `pricePerMinute = price / duration` calculation logic uses a **frontend-backend dual calculation strategy**. The frontend `computed()` signal provides instant UI feedback (zero-latency unit price display on user input); the backend recalculates on database write to ensure data integrity (regardless of API call origin). This approach provides real-time preview without network round-trips while preventing inconsistent data (e.g., price:100, duration:60, pricePerMinute:999) from being persisted. This is the most idiomatic Angular Signals pattern.
9. Active status Toggle Switch: Can be toggled directly in the list
9. Delete operation: Confirm → `AdminService.deleteAdminService(id)` → `AdminStore.removeServiceFromList()`

## Table Columns

| Column | Component | Description |
|---|---|---|
| **Name** | `Avatar/Icon + text` | Service icon + name + description |
| **Duration** | `text` | Duration (minutes) |
| **Price** | `currency:'USD'` | Price |
| **Status** | `<app-badge>` | Active status: `active=true→confirmed(green)`, displays `ACTIVE`; `active=false→expired(gray)`, displays `INACTIVE`. Label uses uppercase values via `customLabel`. |
| **Actions** | `<app-button>` | Edit (ghost+pencil) + Delete (danger+trash) |

## Dashboard Consumption

| Dashboard Panel | Consumed Endpoint | Parameters |
|-----------|---------|------|
| Recent Services | `GET /v1/admin/services` | `limit=5`, `page=1`, `orderBy=createdAt:desc` |

Dashboard panel reuses this endpoint to fetch recent service list for overview display, sharing the same endpoint with the service management page's full paginated list.

## Data Sources

- contract.yaml 1.7.1 (admin.services CRUD — including pricePerMinute, taxRate)
- SAD 2.2.1 (ServicesModule)
- Data Architecture Design Document 2.2 (Service entity, ServiceCategory entity)

## Stat Card Data Sources

| Card | Data Source | System-Level Actual Value? | Refresh Mechanism |
|---|---|---|---|
| **Total Services** | `total` field from `GET /v1/admin/services` response | ✅ System-level actual total (across pagination) | `ngOnInit` + reload after filter/CRUD operations |
| **Active Services** | Load full service list (limit=999) from `GET /v1/admin/services` and filter by `active=true` | ✅ System-level actual value | `ngOnInit` + reload after filter/CRUD operations |
| **Average Price** | Calculate price mean from full service list (limit=999) | ✅ System-level actual value | `ngOnInit` + reload after filter/CRUD operations + **60s polling** |

> **Note**: Stat cards use independent full-data requests (separate from paginated table), ensuring Active Services and Average Price reflect system overview rather than current page data. Total Services directly uses the API response's `total` field. Average Price additionally has 60-second polling auto-refresh (`RxJS interval(60000)`), consistent with the Dashboard system status polling pattern. `averagePrice` calculation converts the backend's string-type price to numeric via `Number(s.price)`, avoiding string concatenation from the `+` operator in `reduce`.

## Data Refresh

| Event | Refresh Behavior |
|---|---|
| Page init (`ngOnInit`) | Simultaneously initiate two requests: 1️⃣ `getAdminServices({limit:10})` populate table; 2️⃣ `getAdminServices({limit:999})` populate stat cards |
| Filter change (`applyFilter`) | Reload paginated table + stat cards |
| Search/Clear (`clearFilters`) | Same as above |
| Create/Edit/Delete service | Local store update + reload stat cards |
| WebSocket auto-refresh | ❌ Not implemented (no service change WebSocket event) |
| **Polling auto-refresh** | ✅ **60s interval → loadAllServicesForStats()** (only updates stat cards, not paginated table) |

## Category Derivation Notes

- The `category` field is derived from the backend `ServiceCategory` association. If a service is associated with a `ServiceCategory`, the category name is populated via JOIN query into `AdminServiceDto.category`; if not associated with a category, returns `null`.
- The `categories` array in `GET /v1/admin/services/summary` classifies services with `category=null` as "Uncategorized" stats.
