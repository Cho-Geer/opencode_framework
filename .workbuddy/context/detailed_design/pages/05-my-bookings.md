# My Bookings List Page (MyBookingsPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | My Bookings List |
| **Route Path** | `/my-bookings` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Load** | `features/my-bookings/my-bookings.routes.ts` → `MY_BOOKINGS_ROUTES` |
| **Component** | `MyBookingsComponent` (`src/app/features/my-bookings/my-bookings.component.ts`) |
| **Design Basis** | contract.yaml `appointments.list`, SAD 2.3.1 (/appointments page) |

## User Role

- CUSTOMER only

## Route Parameters

- No route parameters
- No query parameters (API query parameters passed via local signals, not route-bound)

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → `/auth/login?returnUrl=/my-bookings` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `ApiService` | `getMyAppointments()`, `cancelBooking()` |
| `AuthStore` | `isLoading` (loading state) |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `appointments` | `AppointmentListItem[]` | Booking list data |
| `activeFilter` | `'all' \| 'PENDING' \| 'CONFIRMED' \| 'COMPLETED' \| 'EXPIRED' \| 'CANCELLED'` | Status filter |
| `isLoading` | `boolean` | Loading state |
| `loadError` | `string \| null` | Loading error message |
| `pullToRefreshState` | `'idle' \| 'pulling' \| 'refreshing'` | Pull-to-refresh state |
| `pullProgress` | `number` | Touch offset (px) |
| `showCancelDialog` | `boolean` | Cancel confirmation dialog |
| `cancellingId` | `string \| null` | Booking ID being cancelled |
| `isCancelling` | `boolean` | Cancel operation in progress |

## API Contract Mapping

| Method | Endpoint | Request Parameters | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `GET` | `/v1/appointments` | `?startDate&endDate&status` | `PaginatedResponse<BookingListItem>` per item: `{id, appointmentNumber, timeSlotId, appointmentDate, status, serviceName, timeSlotStart, timeSlotEnd, durationMinutes, price, taxRate, taxIncludedAmount}` | Bearer | Page init, filter switch, pull-to-refresh |
| `POST` | `/v1/appointments/:id/cancel` | path: `id` | `void` | Bearer | Cancel booking confirmation |

**Note**: Frontend `ApiService.cancelBooking(id)` uses `POST` method, mapping to backend path `POST /appointments/:id/cancel` (`AppointmentsController.cancel()`). CUSTOMER cancels bookings using this endpoint; ADMIN role not required.

**Actual backend calls**:

| Controller | Endpoint | Method |
|---|---|---|
| `AppointmentsController` | `GET /appointments` (via `getMyAppointments()` delegates to `findAll` with user filter) | `findAll()` |
| `AppointmentsController` | `POST /appointments/:id/cancel` | `cancel()` |

## Backend Mapping

| File | Description |
|---|---|
| `src/modules/appointments/appointments.controller.ts` | Route prefix `"appointments"`, `JwtAuthGuard` at class level |
| `src/modules/appointments/appointments.service.ts` | `findAll()` pagination + user filter, `cancel()` status validation + transactional update |

Backend `cancel()` implementation:
- Appointment state machine check: `PENDING/CONFIRMED` can be cancelled
- Prisma transaction: update `Appointment` + create `AppointmentHistory`
- Queue sends cancellation email + notification

## Interaction Flow

1. Visit `/my-bookings`; guards check auth + role
2. `ngOnInit()` → calls `api.getMyAppointments()` to load list
3. Default display: all (`activeFilter = 'all'`)
4. Filter bar (6 options): All / Pending / Confirmed / Completed / Expired / Cancelled
5. Click filter → `activeFilter` changes → `triggerRefresh()` → reload
6. Click "Cancel Booking" → `showCancelDialog = true` → confirm → `confirmCancel()` → `api.cancelBooking(id)`
7. Pull-to-refresh (`@HostListener touchstart/touchmove/touchend`):
   - Touch offset reaches threshold → refresh state → reload list
8. List items include: service name, booking date, time slot, status label

## Data Sources

- contract.yaml 1.7.2 (appointments.list)
- SAD 2.3.1
- Data Architecture Design Document 2.2 (Appointment entity)
- Interface Design Specification 2.5.3 (optimistic UI design principles)
