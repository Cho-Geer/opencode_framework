# Booking Confirmation Page (BookingConfirmationPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Booking Creation - Confirm Submission |
| **Route Path** | `/booking/confirmation` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Loading** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **Component** | `BookingConfirmationComponent` (`src/app/features/booking/booking-confirmation/booking-confirmation.component.ts`) |
| **Design Basis** | API Specification 2.5.3 (Optimistic UI), Test Strategy (booking flow E2E) |

## User Roles

- CUSTOMER only

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → `/auth/login?returnUrl=/booking/confirmation` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |
| `canDeactivateBookingGuard` | Confirm unsaved changes dialog |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `BookingStore` | `hasSelection`, `selectedSlot`, `error`, `isLoading`, `selectedServiceId`, `services`, `bookSlot()`, `selectSlot()` |
| `AuthStore` | `user()`, `currentUser` — Get user ID for booking submission |
| `Router` | Booking success → `/booking/success`; Failure → `/booking` to re-select |

## Local State

| Signal/Variable | Type | Description |
|---|---|---|
| `acceptTerms` | `boolean` | Whether to accept terms of service |
| `selectedService` | `Service \| undefined` (computed) | Queried from BookingStore `services` |
| `selectedServiceName` | `string` (computed) | Service name |
| `serviceDuration` | `number` (computed) | Service duration (minutes) |
| `servicePrice` | `number` (computed) | Service price |
| `estTaxAmount` | `number` (computed) | Estimated tax amount (`servicePrice * taxRate`) |
| `estTaxIncludedTotal` | `number` (computed) | Tax-included total price (`servicePrice + estTaxAmount`) |

## API Contract Mapping

| Method | Endpoint | Request DTO | Response | Auth | Call Timing |
|---|---|---|---|---|---|---|
| `POST` | `/v1/appointments` | Header: `Idempotency-Key: SHA-256(...)`<br>Body: `CreateAppointmentDto` (`timeSlotId`, `serviceId`, `appointmentDate`, `preferredSequence`, `customerInfo?`, `notes?`, `overtimeMinutes?`) | `ReservationResponse` (`{id, userId, serviceId, timeSlotId, appointmentDate, status, slotSequence, durationMinutes, price, taxRate, taxIncludedAmount, createdAt}`) | Bearer | User clicks "Confirm Booking" |

## Backend Mapping

| Controller | File |
|---|---|
| `AppointmentsController` | `src/modules/appointments/appointments.controller.ts` — `POST /appointments` (`create()`) |
| `AppointmentsService` | `src/modules/appointments/appointments.service.ts` |

`create()` implementation notes:
- Atomic slot reservation: `Prisma.$transaction` + `ReadCommitted` isolation
- Optimistic lock retry (max 3, base 100ms exponential backoff)
- `updateMany` conditional update on `currentSequence`
- Generate `appointmentNumber` (`APT-{timestamp}-{random}`)
- Send confirmation email + notification

## Interaction Flow

1. Navigate to confirmation page after selecting a slot from `/booking/slots`
2. Display booking summary (service name, time, duration, price, tax rate, tax-included total)
   - Overtime setting: Show `overtimeMinutes` and adjusted total `durationMinutes`
   - Price details: `price` (original price) + `taxRate` (tax rate) = `taxIncludedAmount` (tax-included price)
3. User checks "I have read and accept the terms of service"
4. Click "Confirm Booking" → `BookingStore.bookSlot(slotId, userId)`
5. Inside `BookingService.reserveSlot()`:
   - Generate random `preferredSequence` (0-99)
   - Generate `Idempotency-Key` (SHA256)
   - Call `POST /v1/appointments`
6. **Optimistic UI**: Show non-closable "Processing..." modal on submission; navigate to success page after receiving `201 Created` response; if `409 Conflict` encountered, prompt that the time slot is occupied and return to slot selection page. The frontend **must not** assume the request succeeded before receiving API confirmation, otherwise atomic reservation failure may cause state inconsistency.
7. **Success** → Navigate to `/booking/success`
8. **Failure (409 slot occupied)** → Prompt "This time slot has been taken, please select again" → Return to `/booking/slots`

## Frontend High-Concurrency Strategy

| Mechanism | Implementation |
|---|---|
| `preferredSequence` | `Math.floor(Math.random() * 100)` 0-99 random hash for PostgreSQL Partial Unique Index sharding |
| `Idempotency-Key` | SHA-256(serviceId+slotId+userId+preferredSequence+timestamp) — Idempotency key in request header to prevent duplicate submissions (corresponds to contract.yaml 1.6.8 `headers.Idempotency-Key`) |
| Optimistic UI | Show non-closable Loading modal on submission; navigate to success page on 201 response; prompt return to slot selection page on 409 conflict |

## Data Sources

- contract.yaml 1.7.2 (appointments.create — including financial fields, overtimeMinutes)
- SAD 4.4 (high-concurrency transactions + optimistic locking)
- API Design Specification 2.5.3 (Optimistic UI + preferSeq)
- Data Architecture Design Document 2.2 (Appointment entity), 5.2 (Partial Unique Index)
