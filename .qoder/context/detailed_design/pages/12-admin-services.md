# Admin - Service Management Page (AdminServiceManagementPage)

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
| `authGuard` (parent) | Unauthenticated → redirect |
| `roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })` (parent) | CUSTOMER denied access |

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
| `categoryFilter` | `string` | Category filter (binds to `?category=` query param) |
| `statusFilter` | `string` | Status filter |
| `formErrors` | `{ name?; duration?; price? }` | Form validation errors |
| `formName`, `formDescription`, `formDuration`, `formPrice`, `formActive`, `formImageUrl`, `formTaxRate` | various types | Form field bindings |
| `computedPricePerMinute` | `number \| null` (computed) | Auto-calculated value: `formPrice / formDuration`; computed in real-time when duration > 0, display only (not a manual input field) |
| `totalServices` | `number` (computed) | Total service count (source: `GET /v1/admin/services` response `total` field, cross-pagination system-level total) |
| `activeServicesCount` | `number` (computed) | Active service count (from full service list `limit=999` filtered by `active=true`) |
| `averagePrice` | `number` (computed) | Average price (computed from full service list `limit=999`) |

> **Note**: `averagePrice` is currently computed via `limit=999` full query. `contract.yaml` v1.7.3 has defined an `averagePrice` field for `admin/services/summary` endpoint; can switch to dedicated summary endpoint in the future.

## API Contract Reference

> **Response envelope**: All successful API responses are wrapped by ResponseInterceptor in a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column below describes only the `data` field internal structure; the outer envelope implicitly applies.

| Method | Endpoint | Request Params/Body | Response | Auth | Trigger |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/services` | `?page&limit&search&active&category` | `PaginatedResponse<AdminServiceDto>` (`{id, name, description, duration, price, active, category, imageUrl?, createdAt, pricePerMinute?, taxRate?}`) | Bearer ADMIN/SUPER_ADMIN | Page initialization, filter, pagination |
> ⚠️ **Known contract deviation**
> ⚠️ **Field type note**: Backend returns `price` field as **string** type (e.g., `"800"`), not `number`. Frontend converts via `Number(s.price)` at the `loadAllServicesForStats()` data entry point, ensuring `averagePrice` calculation uses numeric addition rather than string concatenation. Paginated table display delegates to `currency` Pipe for auto-formatting, unaffected.
> **Fix plan**: This is a known tech debt (corresponding ADR pending creation). Backend needs to correct `AdminServiceDto.price` return type to `number`, aligning with contract.yaml definition `{ type: "number", format: "decimal" }`. Current workaround should not be retained long-term.
> **Note**: Stat cards use a separate full data request (limit=999, independent from paginated table), not depending on a dedicated summary endpoint. Active Services Count and Average Price are computed from full data.
| `POST` | `/v1/admin/services` | `{name*, description?, duration*, price?, active?, imageUrl?, pricePerMinute?, taxRate?}` | `AdminServiceDto` (201) | Bearer ADMIN/SUPER_ADMIN | Create save |
| `PUT` | `/v1/admin/services/:id` | `{name?, description?, duration?, price?, active?, imageUrl?, pricePerMinute?, taxRate?}` | `AdminServiceDto` | Bearer ADMIN/SUPER_ADMIN | Edit save |
> **auto-calc**: `pricePerMinute` is auto-calculated on backend as `price / duration` (when both are provided). Frontend no longer provides a `pricePerMinute` manual input field, instead displays the value computed in real-time by `computedPricePerMinute` signal. If frontend explicitly passes `pricePerMinute`, backend prioritizes the passed value; otherwise auto-calculates.
| `DELETE` | `/v1/admin/services/:id` | path: `id` | `void` (204) | Bearer ADMIN/SUPER_ADMIN | Delete confirmation |

## Backend Mapping

| Controller | File |
|---|---|
| `AdminServicesController` | `src/modules/admin/controllers/admin-services.controller.ts` — route prefix `"admin/services"` |
| `AdminServicesService` | `src/modules/admin/services/admin-services.service.ts` — delegates to `ServicesService` |

Permission control:
| Endpoint | Minimum Role |
|---|---|
| `GET /admin/services` | ADMIN |
| `POST /admin/services` | ADMIN |
| `PUT /admin/services/:id` | ADMIN |
| `DELETE /admin/services/:id` | ADMIN |

## Interaction Flow

1. Visit `/admin/services`, parent guard verifies
2. `loadServices()` → `AdminService.getAdminServices({ page, search, active })` → `AdminStore.setServices()`
3. View toggle: grid view (card style) / list view (table style)
4. Search box + category filter + status filter
5. Click "Create" → `serviceDialogVisible = true`, `isEdit = false`
6. Click service "Edit" → dialog pre-filled, `isEdit = true`
7. Form: name (required *), description, duration (minutes), price (required *), image URL, active toggle
7a. **Price validation**: Price field is required, must be a positive number (> 0). If price is `null`, empty, or ≤ 0 on submit, frontend displays validation error and form rejects submission.
8. **`pricePerMinute` auto-calculation**: After user enters `duration` and `price`, frontend auto-computes and displays `price / duration` result via `computedPricePerMinute` signal (display only, not an input field). Template uses `@if (isViewMode())` guard to control display, ensuring edit mode always recalculates and shows latest unit price, avoiding template condition errors causing `$0.00` display. On save, frontend does not send `pricePerMinute`; backend computes in `AdminServicesService`: `pricePerMinute = dto.price / dto.duration`. This design avoids manual calculation errors and ensures data consistency.
> **Architecture decision**: `pricePerMinute = price / duration` calculation uses a **dual frontend-backend computation strategy**. Frontend `computed()` signal provides instant UI feedback (zero-delay unit price display during user input); backend recalculates on database write ensuring data integrity (regardless of API call source). This approach provides real-time preview without network round-trips, while preventing inconsistent data (e.g., price:100, duration:60, pricePerMinute:999) from being persisted. This is the most idiomatic Angular Signals pattern.
9. Active status Toggle Switch: can be toggled directly in list
9. Delete operation: confirm → `AdminService.deleteAdminService(id)` → `AdminStore.removeServiceFromList()`

## Table Columns

| Column | Component | Description |
|---|---|---|
| **Name** | `Avatar/Icon + text` | Service icon + name + description |
| **Duration** | `text` | Duration (minutes) |
| **Price** | `currency:'USD'` | Price |
| **Status** | `<app-badge>` | Active status: `active=true→confirmed(green)`, displays `ACTIVE`; `active=false→expired(gray)`, displays `INACTIVE`. Label uses uppercase value via `customLabel`. |
| **Actions** | `<app-button>` | Edit (ghost+pencil) + Delete (danger+trash) |

## Dashboard Consumption

| Dashboard Panel | Consumed Endpoint | Parameters |
|-----------|---------|------|
| Recent Services | `GET /v1/admin/services` | `limit=5`, `page=1`, `orderBy=createdAt:desc` |

Dashboard panel reuses this endpoint to fetch recent services list for overview display, sharing the same endpoint as the service management page's full paginated list.

## Data Sources

- contract.yaml 1.7.1 (admin.services CRUD — includes pricePerMinute, taxRate)
- SAD 2.2.1 (ServicesModule)
- data-architecture 2.2 (Service entity, ServiceCategory entity)

## Stat Card Data Sources

| Card | Data Source | System-Level True Value? | Refresh Mechanism |
|---|---|---|---|
| **Total Services** | `GET /v1/admin/services` response `total` field | ✅ System-level true total (cross-pagination) | `ngOnInit` + filter/CRUD operation then reload |
| **Active Services** | From `GET /v1/admin/services` full service list load (limit=999) filtered by `active=true` | ✅ System-level true value | `ngOnInit` + filter/CRUD operation then reload |
| **Average Price** | From full service list (limit=999) computed price average | ✅ System-level true value | `ngOnInit` + filter/CRUD operation then reload + **60s polling** |

> **Note**: Stat cards use a separate full data request (independent from paginated table), ensuring Active Services and Average Price reflect system overview rather than current page data. Total Services directly uses the API response's `total` field. Average Price adds 60-second polling auto-refresh (`RxJS interval(60000)`), consistent with Dashboard system status polling pattern. `averagePrice` calculation converts backend's string-type price to number via `Number(s.price)`, avoiding `reduce` `+` operator performing string concatenation.

## Data Refresh

| Event | Refresh Behavior |
|---|---|
| Page initialization (`ngOnInit`) | Fires two requests simultaneously: 1️⃣ `getAdminServices({limit:10})` for table; 2️⃣ `getAdminServices({limit:999})` for stat cards |
| Filter change (`applyFilter`) | Reload paginated table + stat cards |
| Search/clear (`clearFilters`) | Same as above |
| Create/edit/delete service | Local store update + reload stat cards |
| WebSocket auto-refresh | ❌ Not implemented (no service change WebSocket event) |
| **Polling auto-refresh** | ✅ **60s interval → loadAllServicesForStats()** (only updates stat cards, does not affect paginated table) |

## Category Derivation Note

- `category` field is derived from backend `ServiceCategory` association. If a service is associated with a `ServiceCategory`, the category name is populated into `AdminServiceDto.category` via JOIN query; if no category is associated, returns `null`.
- `GET /v1/admin/services/summary` `categories` array categorizes services with `category=null` under "Uncategorized" statistics.
