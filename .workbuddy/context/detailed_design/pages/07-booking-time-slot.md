# Booking - Select Time Slot Page (TimeSlotPickerPage)

> **Version**: 1.1.0-fixed (cross-reference audit fix based on contract.yaml v1.7.2)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Booking Creation - Select Time Slot |
| **Route Path** | `/booking/slots` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Load** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **Component** | `TimeSlotPickerComponent` (`src/app/features/booking/time-slot-picker/time-slot-picker.component.ts`) |
| **Design Basis** | contract.yaml v1.7.2, Interface Specification 2.5.3 (optimistic UI, frontend preferSeq), Test Strategy (booking flow E2E), SAD 4.4 (high concurrency) |

## User Role

- CUSTOMER only

## Route Parameters

| Parameter | Type | Source | Description |
|---|---|---|---|
| `date` | `string` (optional) | Route params | Pre-selected date, used for filtering in `slotResolver` |

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → `/auth/login?returnUrl=/booking/slots` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |
| `canDeactivateBookingGuard` | Shows browser confirmation dialog when there are unsaved changes |

## Resolvers

| Resolver | Provides Data | Current Status |
|---|---|---|
| `slotResolver` | `slots: TimeSlot[]` | **Currently returns static Mock data** (6 sample time slots), TODO: replace with real API call. Reads `date` route param |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `BookingStore` | `availableSlots`, `isLoading`, `error`, `selectSlot()`, `loadSlots()`, `slots()` |
| `BookingService` | `reserveSlot(slot.id)` — high-concurrency slot preemption |
| `SocketService` | `subscribeToSlotUpdates()` — real-time slot updates via WebSocket |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `selectedDate` | `Date` | Currently selected date |
| `minDate` | `Date` | Minimum selectable date (today) |

## WebSocket Events

| Event | Type | Handler |
|---|---|---|
| `slot.booked` | `SlotBookedEvent` | `handleSlotBooked()` — when another user books a time slot, updates slot availability in BookingStore in real time |

## API Contract Mapping

> **Response envelope**: All successful API responses are wrapped by ResponseInterceptor into a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column in the table below only describes the internal structure of the `data` field; the envelope outer layer applies implicitly.

| Method | Endpoint | Request Parameters | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `GET` | `/v1/time-slots/available` | `?service_id*&date*` | `TimeSlot[]` (`{id, startTime, endTime, capacity, bookedCount, available}`) | Bearer | On date/service change (currently Mock) |
| `POST` | `/v1/appointments` | `CreateAppointmentDto` (`timeSlotId, serviceId, appointmentDate, preferredSequence, customerInfo?, notes?, overtimeMinutes?`) | `ReservationResponse` (`{id, userId, serviceId, timeSlotId, appointmentDate, status, slotSequence, durationMinutes, price, taxRate, taxIncludedAmount, createdAt}`) | Bearer | Select slot → submit booking |

**Note**: Frontend `BookingService.reserveSlot()` internally calls `POST /v1/appointments` via `api.createAppointment(dto)`, passing `preferredSequence` and `idempotencyKey`.

## Backend Mapping (High-Concurrency Critical)

| Controller | File | Function |
|---|---|---|
| `TimeSlotsController` | `src/modules/time-slots/time-slots.controller.ts` | `GET /v1/time-slots/available` — query available time slots |
| `AppointmentsController` | `src/modules/appointments/appointments.controller.ts` | `POST /v1/appointments` — create booking (with atomic slot locking, guaranteed by PostgreSQL partial unique index) |

### High-Concurrency Preemption Implementation (`AppointmentService.create`)

| Parameter | Value |
|---|---|
| Conflict detection | PostgreSQL partial unique index `appointment_slot_occupied` (WHERE status IN ('PENDING','CONFIRMED','COMPLETED')) |
| Sequence allocation | `TimeSlot.currentSequence` atomic increment (`UPDATE ... SET current_sequence = current_sequence + 1 RETURNING current_sequence`) |
| Transaction isolation | `READ COMMITTED` (maxWait: 5s, timeout: 10s) |
| Rate limiting | Redis 1 request/sec/user/time slot |
| Conflict response | Prisma error code `P2002` → HTTP 409 Conflict |
| Frontend hot sharding | `preferredSequence` (0-99 random value) distributes concurrent requests across different `slot_sequence` buckets |

**Implementation**: Booking creation is handled directly in `AppointmentService.create()` via `prisma.$transaction()` for atomic operations. No separate `SlotPreemptionService` is needed — the partial unique index provides the necessary atomicity at the database level. See `contract.yaml` §4 High-Concurrency Contracts and SAD §4.4 for detailed design.

## Interaction Flow

1. Navigate from service selection page to `/booking/slots` (automatically passes `selectedServiceId`)
2. Default shows today's date → calls `slotResolver` to load slots (currently Mock)
3. Calendar component (`p-datepicker`) selects date → reload
4. Each time slot displays: start time - end time, availability state (`available`), and booked count / total capacity (`booked_count`/`capacity`). Frontend calculates remaining availability via `capacity - booked_count`.
5. Click available slot → `BookingStore.selectSlot(slot)` → navigate to `/booking/confirmation`
6. WebSocket `slot.booked` event → real-time slot status update (handles multi-user concurrency)
7. **Optimistic UI**: Click slot → immediately navigate to confirmation page (no waiting for API confirmation)

## Data Model

| Field | Type | Description |
|---|---|---|
| `TimeSlot.id` | `string (UUID)` | Time slot ID |
| `TimeSlot.startTime` | `string (ISO datetime)` | Start time |
| `TimeSlot.endTime` | `string (ISO datetime)` | End time |
| `TimeSlot.capacity` | `number` | Maximum concurrent bookings |
| `TimeSlot.bookedCount` | `number` | Current booked count |
| `TimeSlot.available` | `boolean` | Whether there is still remaining capacity |
| `Appointment.durationMinutes` | `number` | Booking duration (minutes, including overtime) |
| `Appointment.price` | `number (decimal)` | Price snapshot (copied from Service.price) |
| `Appointment.taxRate` | `number (decimal)` | Tax rate snapshot (copied from Service.taxRate) |
| `Appointment.taxIncludedAmount` | `number (decimal)` | Tax-inclusive total (price * (1 + taxRate)) |

## Data Sources

- contract.yaml 1.7.2 (time-slots.available, appointments.create)
- SAD 4.4 (high-concurrency transaction design)
- Interface Design Specification 2.5.3 (optimistic UI, preferredSequence random hashing)
- Data Architecture Design Document 5.2 (Partial Unique Index concurrency locking)
