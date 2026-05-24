# Admin - Appointment Management Page (AdminAppointmentManagementPage)

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
| `authGuard` (parent) | Unauthenticated → redirect |
| `roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })` (parent) | CUSTOMER denied access |

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
| `selectedAppointments` | `string[]` | Batch operation selected ID array |
| `statusDialogVisible` | `boolean` | Status update dialog |
| `selectedAppointment` | `AdminAppointment \| null` | Currently operated appointment |
| `statusUpdateReason` | `string` | Status change reason |
| `newStatus` | `AppointmentStatus` | Target status |
| `filterStatus` | `string` | Status filter |
| `filterStartDate` | `string` | Start date |
| `filterEndDate` | `string` | End date |
| `filterSearch` | `string` | Search keyword |
| `todayCount` | `number` (computed) | Today's appointment count |
| `pendingCount` | `number` (computed) | Pending count |
| `confirmedCount` | `number` (computed) | Confirmed count |
| `cancelledCount` | `number` (computed) | Cancelled count |
| `calendarEvents` | `CalendarEvent[]` (computed) | Calendar view events |
| `calendarWeeks` | `array` (computed) | Calendar week data structure |

## API Contract Reference

| Method | Endpoint | Request Params/Body | Response | Auth | Trigger |
|---|---|---|---|---|---|---|
| `POST` | `/v1/admin/appointments` | `{userId*, serviceId*, timeSlotId*, appointmentDate*, notes?, overtimeMinutes?}` | `AdminAppointmentDto` (201) (`{id, userId, serviceId, timeSlotId, appointmentDate, status, durationMinutes, price, taxRate, taxIncludedAmount, createdAt}`) | Bearer ADMIN/SUPER_ADMIN | Quick Booking - admin creates booking for customer |
| `GET` | `/v1/admin/appointments` | `?page&limit&status&startDate&endDate&serviceId&userId` | `PaginatedResponse<AdminAppointmentDto>` (`{id, appointmentNumber, userId, userName, serviceId, serviceName, timeSlotId, appointmentDate, status, createdAt, durationMinutes, price, taxRate, taxIncludedAmount}`) | Bearer ADMIN/SUPER_ADMIN | Page initialization, filter, pagination |
| `PUT` | `/v1/admin/appointments/:id/status` | `{status*, reason?}` | `{id, status, updatedAt}` | Bearer ADMIN/SUPER_ADMIN | Single status update |
| `POST` | `/v1/admin/appointments/batch-cancel` | `{ids*, reason?}` | `{successCount, failedCount, failedIds}` | Bearer ADMIN/SUPER_ADMIN | Batch cancel |

## Backend Mapping

| Controller | File |
|---|---|
| `AdminAppointmentsController` | `src/modules/admin/controllers/admin-appointments.controller.ts` — route prefix `"admin/appointments"` |
| `AdminAppointmentsService` | `src/modules/admin/services/admin-appointments.service.ts` |

**Appointment State Machine** (`VALID_TRANSITIONS`):
| Current Status | Can Transition To |
|---|---|
| `PENDING` | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `COMPLETED`, `CANCELLED` |
| `COMPLETED` | `CANCELLED` |
| `CANCELLED` | (terminal state) |
| `EXPIRED` | (terminal state) |

Cancel operations require a `reason` to be filled.

## Interaction Flow

1. Visit `/admin/appointments`, parent guard verifies
2. `loadAppointments()` → `AdminService.getAdminAppointments(query)` → `AdminStore.setAppointments()`
3. **List view**: PrimeNG table (pagination, sorting, column filters), each row shows: appointment number, user name, service name, date/time, status
4. **Calendar view**: Displays appointments in monthly calendar format, colored by status
5. Top stat cards: today's appointments, pending, confirmed, cancelled (computed signals)
6. Filter bar: status dropdown + date range picker + search box
7. Single operation: click "Update Status" → `statusDialogVisible = true` → select target status + reason → submit → `AdminStore.updateAppointmentStatusInList()`
8. Batch operation: checkbox select multiple → click "Batch Cancel" → fill reason → `batchCancel()` → `AdminStore.removeAppointmentsFromList()`
9. **Quick Booking** (admin quickly creates booking for customer):
   - Click "New Booking" button → popup dialog
   - Form fields: select customer (search user list), select service, select date/time, fill notes
    - Supports overtime settings (`overtimeMinutes`), system auto-validates overtime doesn't overlap with adjacent time slot bookings
   - Submit → `POST /v1/admin/appointments` → refresh list on success
   - Underlying reuses atomic slot preemption mechanism (PostgreSQL partial unique index)
10. After status change, backend notifies relevant users via WebSocket `appointment_updated` event

## Data Sources

- contract.yaml 1.7.1 (admin.appointments create/list/update-status/batch-cancel)
- SAD 2.3.1 (AdminBookingList)
- Interface Design Specification 2.8 (admin appointment management)
- data-architecture 2.2 (Appointment status enum + AppointmentHistory)
- Interface Design Specification 2.6 (WebSocket event notifications)
