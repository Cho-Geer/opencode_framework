# Booking - Confirmation Page (BookingConfirmationPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Booking Creation - Confirmation |
| **Route Path** | `/booking/confirmation` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Loading** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **Component** | `BookingConfirmationComponent` (`src/app/features/booking/booking-confirmation/booking-confirmation.component.ts`) |
| **Design Basis** | Interface Spec 2.5.3 (Optimistic UI), Test Strategy (booking flow E2E) |

## User Roles

- CUSTOMER exclusive

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → `/auth/login?returnUrl=/booking/confirmation` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |
| `canDeactivateBookingGuard` | Unsaved changes confirmation dialog |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `BookingStore` | `hasSelection`, `selectedSlot`, `error`, `isLoading`, `selectedServiceId`, `services`, `bookSlot()`, `selectSlot()` |
| `AuthStore` | `user()`, `currentUser` — get user ID for booking submission |
| `Router` | Success → `/booking/success`; Failure → `/booking` reselect |

## Local State

| Signal/Variable | Type | Description |
|---|---|---|
| `acceptTerms` | `boolean` | Whether terms of service are accepted |
| `selectedService` | `Service \| undefined` (computed) | Queried from BookingStore `services` |
| `selectedServiceName` | `string` (computed) | Service name |
| `serviceDuration` | `number` (computed) | Service duration (minutes) |
| `servicePrice` | `number` (computed) | Service price |
| `estTaxAmount` | `number` (computed) | Estimated tax amount (`servicePrice * taxRate`) |
| `estTaxIncludedTotal` | `number` (computed) | Tax-included total (`servicePrice + estTaxAmount`) |

## API Contract Reference

| Method | Endpoint | Request DTO | Response | Auth | Trigger |
|---|---|---|---|---|---|---|
| `POST` | `/v1/appointments` | Header: `Idempotency-Key: SHA-256(...)`<br>Body: `CreateAppointmentDto` (`timeSlotId`, `serviceId`, `appointmentDate`, `preferredSequence`, `customerInfo?`, `notes?`, `overtimeMinutes?`) | `ReservationResponse` (`{id, userId, serviceId, timeSlotId, appointmentDate, status, slotSequence, durationMinutes, price, taxRate, taxIncludedAmount, createdAt}`) | Bearer | User clicks "Confirm Booking" |

## Backend Mapping

| Controller | File |
|---|---|
| `AppointmentsController` | `src/modules/appointments/appointments.controller.ts` — `POST /appointments` (`create()`) |
| `AppointmentsService` | `src/modules/appointments/appointments.service.ts` |

`create()` implementation highlights:
- Atomic slot preemption: `Prisma.$transaction` + `ReadCommitted` isolation
- Optimistic lock retry (max 3, base 100ms exponential backoff)
- `updateMany` conditional update `currentSequence`
- Generate `appointmentNumber` (`APT-{timestamp}-{random}`)
- Send confirmation email + notification

## Interaction Flow

1. Navigate from `/booking/slots` after selecting slot to confirmation page
2. Display booking summary (service name, time, duration, price, tax rate, tax-included total)
   - Overtime settings: display `overtimeMinutes` and adjusted total `durationMinutes`
   - Price breakdown: `price` (base) + `taxRate` (tax rate) = `taxIncludedAmount` (tax-included price)
3. User checks "I have read and accept the Terms of Service"
4. Click "Confirm Booking" → `BookingStore.bookSlot(slotId, userId)`
5. `BookingService.reserveSlot()` internally:
   - Generates random `preferredSequence` (0-99)
   - Generates `Idempotency-Key` (SHA256)
   - Calls `POST /v1/appointments`
6. **Optimistic UI**: Shows a non-dismissible "Processing..." modal on submit; jumps to success page upon `201 Created` response; if `409 Conflict` occurs, prompts that the time slot is taken and returns to slot selection page. Frontend **must not** assume request success before receiving API confirmation, otherwise atomic preemption failure may cause state inconsistency.
7. **Success** → navigate `/booking/success`
8. **Failure (409 slot taken)** → prompt "This time slot is already taken, please select another" → return to `/booking/slots`

## Frontend High-Concurrency Strategy

| Mechanism | Implementation |
|---|---|
| `preferredSequence` | `Math.floor(Math.random() * 100)` 0-99 random hash for PostgreSQL Partial Unique Index sharding |
| `Idempotency-Key` | SHA-256(serviceId+slotId+userId+preferredSequence+timestamp) — request header idempotency key, prevents duplicate submission (corresponds to contract.yaml 1.6.8 `headers.Idempotency-Key`) |
| Optimistic UI | Shows non-dismissible loading modal on submit; jumps to success page upon 201 response; 409 conflict prompts return to slot selection page |

## Data Sources

- contract.yaml 1.7.2 (appointments.create — includes financial fields, overtimeMinutes)
- SAD 4.4 (high-concurrency transactions + optimistic locking)
- Interface Design Specification 2.5.3 (optimistic UI + preferSeq)
- data-architecture 2.2 (Appointment entity), 5.2 (Partial Unique Index)
