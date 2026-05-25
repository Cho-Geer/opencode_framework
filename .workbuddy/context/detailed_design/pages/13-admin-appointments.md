# Admin Appointment Management Page (AdminAppointmentManagementPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Appointment Management |
| **Route Path** | `/admin/appointments` |
| **Layout** | `AppLayoutComponent` (Admin sidebar) |
| **Lazy Loading** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **Component** | `AppointmentManagementComponent` (`src/app/features/admin/pages/appointment-management/appointment-management.component.ts`) |
| **Design Basis** | contract.yaml `admin.appointments` (create/list/update-status/batch-cancel), SAD 2.3.1 (AdminBookingList) |

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
| `AdminStore` | `vm`, `setLoading()`, `setAppointments()`, `updateAppointmentStatusInList()`, `removeAppointmentsFromList()`, `setError()` |
| `AdminService` | `getAdminAppointments()`, `updateAppointmentStatus()`, `batchCancelAppointments()` |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `viewMode` | `'list' \| 'calendar'` | View toggle (list / calendar) |
| `selectedAppointments` | `string[]` | Selected ID array for batch operations |
| `statusDialogVisible` | `boolean` | Status update dialog |
| `selectedAppointment` | `AdminAppointment \| null` | Current appointment |
| `statusUpdateReason` | `string` | Status change reason |
| `newStatus` | `AppointmentStatus` | Target status |
| `filterStatus` | `string` | Status filter |
| `filterStartDate` | `string` | Start date |
| `filterEndDate` | `string` | End date |
| `filterSearch` | `string` | Search keyword |
| `todayCount` | `number` (computed) | Today's count |
| `pendingCount` | `number` (computed) | Pending count |
| `confirmedCount` | `number` (computed) | Confirmed count |
| `cancelledCount` | `number` (computed) | Cancelled count |
| `calendarEvents` | `CalendarEvent[]` (computed) | Calendar view events |
| `calendarWeeks` | `array` (computed) | Calendar week data structure |

## API Contract Mapping

| Method | Endpoint | Request Parameters/Body | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `POST` | `/v1/admin/appointments` | `{userId*, serviceId*, timeSlotId*, appointmentDate*, notes?, overtimeMinutes?}` | `AdminAppointmentDto` (201) (`{id, userId, serviceId, timeSlotId, appointmentDate, status, durationMinutes, price, taxRate, taxIncludedAmount, createdAt}`) | Bearer ADMIN/SUPER_ADMIN | Quick Booking - Admin creates appointment for customer |
| `GET` | `/v1/admin/appointments` | `?page&limit&status&startDate&endDate&serviceId&userId` | `PaginatedResponse<AdminAppointmentDto>` (`{id, appointmentNumber, userId, userName, serviceId, serviceName, timeSlotId, appointmentDate, status, createdAt, durationMinutes, price, taxRate, taxIncludedAmount}`) | Bearer ADMIN/SUPER_ADMIN | Page init, filter, pagination |
| `PUT` | `/v1/admin/appointments/:id/status` | `{status*, reason?}` | `{id, status, updatedAt}` | Bearer ADMIN/SUPER_ADMIN | Single status update |
| `POST` | `/v1/admin/appointments/batch-cancel` | `{ids*, reason?}` | `{successCount, failedCount, failedIds}` | Bearer ADMIN/SUPER_ADMIN | Batch cancel |

## Backend Mapping

| Controller | File |
|---|---|
| `AdminAppointmentsController` | `src/modules/admin/controllers/admin-appointments.controller.ts` — Route prefix `"admin/appointments"` |
| `AdminAppointmentsService` | `src/modules/admin/services/admin-appointments.service.ts` |

**Appointment State Machine** (`VALID_TRANSITIONS`):
| Current State | Can Transition To |
|---|---|
| `PENDING` | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `COMPLETED`, `CANCELLED` |
| `COMPLETED` | `CANCELLED` |
| `CANCELLED` | (Terminal state) |
| `EXPIRED` | (Terminal state) |

Cancellation requires `reason` to be filled.

## Interaction Flow

1. Access `/admin/appointments`, parent guard validation
2. `loadAppointments()` → `AdminService.getAdminAppointments(query)` → `AdminStore.setAppointments()`
3. **List view**: PrimeNG table (paginated, sortable, column filter), each row displays: appointment number, user name, service name, date/time, status
4. **Calendar view**: Display appointments in monthly calendar, colored by status
5. Top stat cards: Today's count, Pending, Confirmed, Cancelled (computed signals)
6. Filter bar: Status dropdown + date range picker + search box
7. Single item operation: Click "Update Status" → `statusDialogVisible = true` → Select target status + reason → Submit → `AdminStore.updateAppointmentStatusInList()`
8. Batch operation: Checkboxes select multiple → Click "Batch Cancel" → Fill in reason → `batchCancel()` → `AdminStore.removeAppointmentsFromList()`
9. **Quick Booking** (Admin quickly creates appointment for customer):
   - Click "New Appointment" button → Popup dialog
   - Form fields: Select customer (search user list), Select service, Select date/time, Fill in notes
    - Supports overtime setting (`overtimeMinutes`), system auto-validates overtime does not overlap with adjacent slot bookings
   - Submit → `POST /v1/admin/appointments` → Refresh list on success
   - Underlying reuse of atomic slot reservation mechanism (PostgreSQL partial unique index)
10. After status change, backend notifies relevant users via WebSocket `appointment_updated` event

## Data Sources

- contract.yaml 1.7.1 (admin.appointments create/list/update-status/batch-cancel)
- SAD 2.3.1 (AdminBookingList)
- API Design Specification 2.8 (admin appointment management)
- Data Architecture Design Document 2.2 (Appointment status enum + AppointmentHistory)
- API Design Specification 2.6 (WebSocket event notification)
