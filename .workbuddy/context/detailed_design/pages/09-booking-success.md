# Booking Success Page (BookingSuccessPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Booking Creation - Success Confirmation |
| **Route Path** | `/booking/success` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Loading** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **Component** | `BookingSuccessComponent` (`src/app/features/booking/booking-success/booking-success.component.ts`) |
| **Design Basis** | API Specification 2.5.3 (Optimistic UI success branch) |

## User Roles

- CUSTOMER only

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → `/auth/login?returnUrl=/booking/success` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `Router` | Navigate to `/my-bookings` (view booking list) or `/booking` (re-book) |
| `BookingStore` | `selectedSlot` (display selected booking slot info) |
| `AuthStore` | `currentUser` (display user info) |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `bookingReference` | `string` | Booking reference number (bound to `BookingStore.lastAppointment?.appointmentNumber`) |
| `bookingAmount` | `number` (computed) | Booking amount (`BookingStore.lastAppointment?.taxIncludedAmount`) |
| `bookingDuration` | `number` (computed) | Booking duration (`BookingStore.lastAppointment?.durationMinutes`) |


## API Contract Mapping

This is a display-only page with no API calls.

## Interaction Flow

1. Automatically navigate to `/booking/success` after successful booking submission
2. Page displays success icon + congratulatory message
3. Display booking reference number (`bookingReference`)
4. Display booking summary (service name, date/time, user info)
5. **Financial summary**: Display price (`bookingAmount`), tax-included total (`taxIncludedAmount`), duration (`bookingDuration` minutes)
6. Provide two action buttons:
   - "View My Bookings" → Navigate to `/my-bookings`
   - "Continue Booking" → Navigate to `/booking` (restart service selection)

## Data Sources

- contract.yaml 1.7.2 (booking creation success response — including financial fields)
- API Design Specification 2.5.3 (Optimistic UI)
