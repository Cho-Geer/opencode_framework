# Admin User Management Page (AdminUserManagementPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | User Management |
| **Route Path** | `/admin/users` |
| **Layout** | `AppLayoutComponent` (Admin sidebar) |
| **Lazy Loading** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **Component** | `UserManagementComponent` (`src/app/features/admin/pages/user-management/user-management.component.ts`) |
| **Design Basis** | contract.yaml `admin.users` CRUD |

## User Roles

- ADMIN (Read + Edit, but cannot create/delete ADMIN or above roles)
- SUPER_ADMIN (Full control)

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
| `AdminStore` | `vm`, `setLoading()`, `setUsers()`, `updateUserInList()`, `removeUserFromList()`, `setError()`, `users()`, `usersTotal()`, `usersPage()` |
| `AdminService` | `getUsers()`, `createUser()`, `updateUser()`, `deleteUser()` |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `userDialogVisible` | `boolean` | User create/edit dialog |
| `deleteDialogVisible` | `boolean` | Delete confirmation dialog |
| `selectedUser` | `AdminUser \| null` | Selected user in dialog |
| `userToDelete` | `AdminUser \| null` | User to be deleted |
| `isEdit` | `boolean` | Edit mode (otherwise create mode) |
| `submitted` | `boolean` | Whether form has been submitted |
| `searchQuery` | `string` | Search keyword |
| `selectedRoleFilter` | `string` | Role filter |
| `selectedStatusFilter` | `string` | Status filter |
| `formErrors` | `object` | Form validation errors |
| `formName`, `formEmail`, `formPhone`, `formRole`, `formStatus`, `formPassword` | `string` | Form field bindings |
| `totalUsers` | `number` (computed) | Total users |
| `activeUsers` | `number` (computed) | Active users count |
| `newThisWeek` | `number` (computed) | New this week count |

## API Contract Mapping

> **Response Envelope**: All successful API responses are wrapped by ResponseInterceptor in a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column below only describes the internal structure of the `data` field; the outer envelope is implicitly applicable.

| Method | Endpoint | Request Parameters/Body | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/users` | `?page&limit&search&role&status` | `PaginatedResponse<AdminUserDto>` (`{id, name, email(masked), phone?(masked), role, status, createdAt}`) | Bearer ADMIN/SUPER_ADMIN | Page init, filter change, pagination change |
| `POST` | `/v1/admin/users` | `{name*, email*, phone?, role?, password*}` | `AdminUserDto` (201) | Bearer **SUPER_ADMIN only** | Save new user |
| `PUT` | `/v1/admin/users/:id` | `{name?, role?, status?}` | `AdminUserDto` | Bearer ADMIN/SUPER_ADMIN | Save edited user |
| `DELETE` | `/v1/admin/users/:id` | path: `id` | `void` (204) | Bearer **SUPER_ADMIN only** | Delete confirmation |

## Backend Mapping

| Controller | File |
|---|---|
| `AdminUsersController` | `src/modules/admin/controllers/admin-users.controller.ts` — Route prefix `"admin/users"` |
| `AdminUsersService` | `src/modules/admin/services/admin-users.service.ts` — Delegates to `UsersService` |

Permission control:
| Endpoint | Minimum Role |
|---|---|
| `GET /admin/users` | ADMIN |
| `POST /admin/users` | **SUPER_ADMIN** |
| `PUT /admin/users/:id` | ADMIN |
| `DELETE /admin/users/:id` | **SUPER_ADMIN** |

## Form Options

| Field | Options |
|---|---|
| `role` | `CUSTOMER`, `ADMIN`, `SUPER_ADMIN` |
| `status` | `ACTIVE`, `INACTIVE`, `BLOCKED` |

## Interaction Flow

1. Access `/admin/users`, parent guard validation
2. `loadUsers()` → `AdminService.getUsers({ page, search, role, status })` → `AdminStore.setUsers()`
3. PrimeNG table displays user list (paginated, sortable)
4. Top: Search box + role dropdown filter + status dropdown filter
5. Click "New User" → Dialog (`userDialogVisible = true`), `isEdit = false`, form cleared
6. Click user "Edit" → Dialog, `isEdit = true`, form pre-filled
7. Create mode: Enter name, email, phone (optional), role, password → Submit
8. Edit mode: Can modify name, role, status → Submit
9. Delete operation: Only **SUPER_ADMIN** sees "Delete" button → `deleteDialogVisible = true` → Confirm → `AdminService.deleteUser(id)` → `AdminStore.removeUserFromList()`

## Table Columns

| Column | Component | Description |
|---|---|---|
| **Name** | `Avatar + text` | User avatar (initial circle background) + name |
| **Email** | `text` | Email address |
| **Role** | `<app-badge>` | Role mapping: `CUSTOMER→completed(blue)`, `ADMIN→processing(light blue)`, `SUPER_ADMIN→confirmed(green)`. Label displays uppercase value from backend directly via `customLabel="user.role"` (`CUSTOMER` / `ADMIN` / `SUPER_ADMIN`). |
| **Status** | `<app-badge>` | Status mapping: `ACTIVE→confirmed(green)`, `INACTIVE→pending(yellow)`, `BLOCKED→cancelled(red)`, converted via `mapStatusToBadge()` to BadgeStatus |
| **Created** | `date:'short'` | Creation time |
| **Actions** | `<app-button>` | Edit (ghost+pencil) + Delete (danger+trash)

## Dashboard Consumption

| Dashboard Panel | Consumed Endpoint | Parameters |
|-----------|---------|------|
| Recent Users | `GET /v1/admin/users` | `limit=5`, `page=1`, `orderBy=createdAt:desc` |

Dashboard panel reuses this endpoint to fetch recent user list for overview display, sharing the same endpoint with the user management page's full paginated list.

## Stat Card Data Sources

| Card | Data Source | System-Level Actual Value? | Refresh Mechanism |
|---|---|---|---|
| **Total Users** | `total` field from `GET /v1/admin/users` response | ✅ System-level actual total (across pagination) | `ngOnInit` + reload after filter/CRUD operations |
| **Active Users** | Load full user list (limit=999) from `GET /v1/admin/users` and filter by `status='ACTIVE'` | ✅ System-level actual value | `ngOnInit` + reload after filter/CRUD operations |
| **New This Week** | Filter full user list by `createdAt >= one week ago` | ✅ System-level actual value | `ngOnInit` + reload after filter/CRUD operations |

> **Note**: Stat cards use independent full-data requests (separate from paginated table), ensuring Active Users and New This Week reflect system overview rather than current page data. Total Users directly uses the API response's `total` field.
>
> **Documentation gap**: `admin.users` currently lacks a dedicated summary stats endpoint (compared to `admin.services.summary`). Active Users and New This Week are obtained via `limit=999` full query frontend computation, suitable only for small-scale user scenarios. To support large-scale user management, recommend adding `GET /v1/admin/users/summary` stats endpoint returning three aggregate values: `{ totalUsers, activeUsers, newThisWeek }`.

## Data Refresh

| Event | Refresh Behavior |
|---|---|
| Page init (`ngOnInit`) | Simultaneously initiate two requests: 1️⃣ `getUsers({limit:10})` populate table; 2️⃣ `getUsers({limit:999})` populate stat cards |
| Filter change (`applyFilter`) | Reload paginated table + stat cards |
| Search/Clear (`clearFilters`) | Same as above |
| Create/Edit/Delete user | Local store update + reload stat cards |
| WebSocket auto-refresh | ❌ Not implemented (no user change WebSocket event) |

## Data Sources

- contract.yaml 1.7.1 (admin.users CRUD)
- Security Architecture Design Document 2.2.1 (role permission matrix: SUPER_ADMIN exclusive create and delete ADMIN users)
- Data Architecture Design Document 2.2 (User entity status enum)
