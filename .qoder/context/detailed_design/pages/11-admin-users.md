# Admin - User Management Page (AdminUserManagementPage)

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

- ADMIN (read + edit, but cannot create/delete ADMIN or higher roles)
- SUPER_ADMIN (full control)

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
| `AdminStore` | `vm`, `setLoading()`, `setUsers()`, `updateUserInList()`, `removeUserFromList()`, `setError()`, `users()`, `usersTotal()`, `usersPage()` |
| `AdminService` | `getUsers()`, `createUser()`, `updateUser()`, `deleteUser()` |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `userDialogVisible` | `boolean` | User create/edit dialog |
| `deleteDialogVisible` | `boolean` | Delete confirmation dialog |
| `selectedUser` | `AdminUser \| null` | User selected in dialog |
| `userToDelete` | `AdminUser \| null` | User to be deleted |
| `isEdit` | `boolean` | Edit mode (otherwise create mode) |
| `submitted` | `boolean` | Whether form has been submitted |
| `searchQuery` | `string` | Search keyword |
| `selectedRoleFilter` | `string` | Role filter |
| `selectedStatusFilter` | `string` | Status filter |
| `formErrors` | `object` | Form validation errors |
| `formName`, `formEmail`, `formPhone`, `formRole`, `formStatus`, `formPassword` | `string` | Form field bindings |
| `totalUsers` | `number` (computed) | Total user count |
| `activeUsers` | `number` (computed) | Active user count |
| `newThisWeek` | `number` (computed) | New users this week |

## API Contract Reference

> **Response envelope**: All successful API responses are wrapped by ResponseInterceptor in a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column below describes only the `data` field internal structure; the outer envelope implicitly applies.

| Method | Endpoint | Request Params/Body | Response | Auth | Trigger |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/users` | `?page&limit&search&role&status` | `PaginatedResponse<AdminUserDto>` (`{id, name, email(masked), phone?(masked), role, status, createdAt}`) | Bearer ADMIN/SUPER_ADMIN | Page initialization, filter change, pagination change |
| `POST` | `/v1/admin/users` | `{name*, email*, phone?, role?, password*}` | `AdminUserDto` (201) | Bearer **SUPER_ADMIN only** | Save new user |
| `PUT` | `/v1/admin/users/:id` | `{name?, role?, status?}` | `AdminUserDto` | Bearer ADMIN/SUPER_ADMIN | Save edited user |
| `DELETE` | `/v1/admin/users/:id` | path: `id` | `void` (204) | Bearer **SUPER_ADMIN only** | Delete confirmation |

## Backend Mapping

| Controller | File |
|---|---|
| `AdminUsersController` | `src/modules/admin/controllers/admin-users.controller.ts` — route prefix `"admin/users"` |
| `AdminUsersService` | `src/modules/admin/services/admin-users.service.ts` — delegates to `UsersService` |

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

1. Visit `/admin/users`, parent guard verifies
2. `loadUsers()` → `AdminService.getUsers({ page, search, role, status })` → `AdminStore.setUsers()`
3. PrimeNG table displays user list (pagination, sorting)
4. Top: search box + role dropdown filter + status dropdown filter
5. Click "Create User" → dialog (`userDialogVisible = true`), `isEdit = false`, form cleared
6. Click user "Edit" → dialog, `isEdit = true`, form pre-filled
7. Create mode: enter name, email, phone (optional), role, password → submit
8. Edit mode: can modify name, role, status → submit
9. Delete operation: only **SUPER_ADMIN** sees "Delete" button → `deleteDialogVisible = true` → confirm → `AdminService.deleteUser(id)` → `AdminStore.removeUserFromList()`

## Table Columns

| Column | Component | Description |
|---|---|---|
| **Name** | `Avatar + text` | User avatar (initial letter circle background) + name |
| **Email** | `text` | Email address |
| **Role** | `<app-badge>` | Role mapping: `CUSTOMER→completed(blue)`, `ADMIN→processing(light blue)`, `SUPER_ADMIN→confirmed(green)`. Label uses backend-stored uppercase value directly via `customLabel="user.role"` (`CUSTOMER` / `ADMIN` / `SUPER_ADMIN`). |
| **Status** | `<app-badge>` | Status mapping: `ACTIVE→confirmed(green)`, `INACTIVE→pending(yellow)`, `BLOCKED→cancelled(red)`, converted via `mapStatusToBadge()` to BadgeStatus |
| **Created** | `date:'short'` | Creation time |
| **Actions** | `<app-button>` | Edit (ghost+pencil) + Delete (danger+trash)

## Dashboard Consumption

| Dashboard Panel | Consumed Endpoint | Parameters |
|-----------|---------|------|
| Recent Users | `GET /v1/admin/users` | `limit=5`, `page=1`, `orderBy=createdAt:desc` |

Dashboard panel reuses this endpoint to fetch recent users list for overview display, sharing the same endpoint as the user management page's full paginated list.

## Stat Card Data Sources

| Card | Data Source | System-Level True Value? | Refresh Mechanism |
|---|---|---|---|
| **Total Users** | `GET /v1/admin/users` response `total` field | ✅ System-level true total (cross-pagination) | `ngOnInit` + filter/CRUD operation then reload |
| **Active Users** | From `GET /v1/admin/users` full user list load (limit=999) filtered by `status='ACTIVE'` | ✅ System-level true value | `ngOnInit` + filter/CRUD operation then reload |
| **New This Week** | From full user list filtered by `createdAt >= one week ago` | ✅ System-level true value | `ngOnInit` + filter/CRUD operation then reload |

> **Note**: Stat cards use a separate full data request (independent from paginated table), ensuring Active Users and New This Week reflect system overview rather than current page data. Total Users directly uses the API response's `total` field.
>
> **Documentation gap**: `admin.users` currently lacks a dedicated summary statistics endpoint (compared to `admin.services.summary`). Active Users and New This Week are obtained via `limit=999` full query with frontend computation, only suitable for small-scale user scenarios. For large-scale user management, a new `GET /v1/admin/users/summary` endpoint returning `{ totalUsers, activeUsers, newThisWeek }` aggregate values is recommended.

## Data Refresh

| Event | Refresh Behavior |
|---|---|
| Page initialization (`ngOnInit`) | Fires two requests simultaneously: 1️⃣ `getUsers({limit:10})` for table; 2️⃣ `getUsers({limit:999})` for stat cards |
| Filter change (`applyFilter`) | Reload paginated table + stat cards |
| Search/clear (`clearFilters`) | Same as above |
| Create/edit/delete user | Local store update + reload stat cards |
| WebSocket auto-refresh | ❌ Not implemented (no user change WebSocket event) |

## Data Sources

- contract.yaml 1.7.1 (admin.users CRUD)
- security-architecture 2.2.1 (role permission matrix: SUPER_ADMIN exclusive create and delete ADMIN users)
- data-architecture 2.2 (User entity status enum)
