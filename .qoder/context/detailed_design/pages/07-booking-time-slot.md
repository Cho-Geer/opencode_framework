# Booking - Time Slot Selection Page (TimeSlotPickerPage)

> **Version**: 1.1.0-fixed (cross-reference audit fix based on contract.yaml v1.7.2)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Booking Creation - Select Time Slot |
| **Route Path** | `/booking/slots` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Loading** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **Component** | `TimeSlotPickerComponent` (`src/app/features/booking/time-slot-picker/time-slot-picker.component.ts`) |
| **Design Basis** | contract.yaml v1.7.2, Interface Spec 2.5.3 (Optimistic UI, frontend preferSeq), Test Strategy (booking flow E2E), SAD 4.4 (high-concurrency) |

## User Roles

- CUSTOMER exclusive

## Route Parameters

| Parameter | Type | Source | Description |
|---|---|---|---|
| `date` | `string` (optional) | Route params | Pre-selected date, used for filtering in `slotResolver` |

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → `/auth/login?returnUrl=/booking/slots` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |
| `canDeactivateBookingGuard` | Shows browser confirmation dialog when unsaved changes exist |

## Resolvers

| Resolver | Provided Data | Current State |
|---|---|---|
| `slotResolver` | `slots: TimeSlot[]` | **Currently returns static mock data** (6 sample time slots), TODO: replace with real API call. Reads `date` route param |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `BookingStore` | `availableSlots`, `isLoading`, `error`, `selectSlot()`, `loadSlots()`, `slots()` |
| `BookingService` | `reserveSlot(slot.id)` — high-concurrency slot preemption |
| `SocketService` | `subscribeToSlotUpdates()` — real-time slot update WebSocket |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `selectedDate` | `Date` | Currently selected date |
| `minDate` | `Date` | Minimum selectable date (today) |

## WebSocket Events

| Event | Type | Handler |
|---|---|---|
| `slot.booked` | `SlotBookedEvent` | `handleSlotBooked()` — When another user books a time slot, updates slot availability in BookingStore in real-time |

## API Contract Reference

> **Response envelope**: All successful API responses are wrapped by ResponseInterceptor in a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column below describes only the `data` field internal structure; the outer envelope implicitly applies.

| Method | Endpoint | Request Params | Response | Auth | Trigger |
|---|---|---|---|---|---|
| `GET` | `/v1/time-slots/available` | `?service_id*&date*` | `TimeSlot[]` (`{id, startTime, endTime, capacity, bookedCount, available}`) | Bearer | When date/service changes (currently mock) |
| `POST` | `/v1/appointments` | `CreateAppointmentDto` (`timeSlotId, serviceId, appointmentDate, preferredSequence, customerInfo?, notes?, overtimeMinutes?`) | `ReservationResponse` (`{id, userId, serviceId, timeSlotId, appointmentDate, status, slotSequence, durationMinutes, price, taxRate, taxIncludedAmount, createdAt}`) | Bearer | Select slot → submit booking |

**Note**: Frontend `BookingService.reserveSlot()` internally calls `api.createAppointment(dto)` via `POST /v1/appointments`, passing `preferredSequence` and `idempotencyKey`.

## Backend Mapping (High-Concurrency Critical)

| Controller | File | Function |
|---|---|---|
| `TimeSlotsController` | `src/modules/time-slots/time-slots.controller.ts` | `GET /v1/time-slots/available` — query available time slots |
| `AppointmentsController` | `src/modules/appointments/appointments.controller.ts` | `POST /v1/appointments` — create booking (with atomic slot locking, guaranteed by PostgreSQL partial unique index) |

### High-Concurrency Preemption Implementation (`AppointmentService.create`)

| Parameter | Value |
|---|---|
| Conflict detection | PostgreSQL partial unique index `appointment_slot_occupied` (WHERE status IN ('PENDING','CONFIRMED','COMPLETED')) |
| Sequence assignment | `TimeSlot.currentSequence` atomic increment (`UPDATE ... SET current_sequence = current_sequence + 1 RETURNING current_sequence`) |
| Transaction isolation | `READ COMMITTED` (maxWait: 5s, timeout: 10s) |
| Rate limiting | Redis 1 request/second/user/time slot |
| Conflict response | Prisma error code `P2002` → HTTP 409 Conflict |
| Frontend hot-sharding | `preferredSequence` (0-99 random value) distributes concurrent requests to different `slot_sequence` buckets |

**Implementation**: Booking creation is handled directly in `AppointmentService.create()` via `prisma.$transaction()` for atomic operations. No separate `SlotPreemptionService` needed — the partial unique index provides necessary atomicity at the database layer. See `contract.yaml` §4 high-concurrency contract and SAD §4.4 for detailed design.

## Interaction Flow

1. Navigate from service selection page to `/booking/slots` (auto-passes `selectedServiceId`)
2. Default shows today's date → calls `slotResolver` to load slots (currently mock)
3. Calendar component (`p-datepicker`) selects date → reload
4. Each time slot displays: start time-end time, availability status (`available`), and booked/total capacity (`booked_count`/`capacity`). Frontend calculates remaining availability via `capacity - booked_count`.
5. Click available slot → `BookingStore.selectSlot(slot)` → navigate to `/booking/confirmation`
6. WebSocket `slot.booked` event → real-time slot status update (resolves multi-user concurrency)
7. **Optimistic UI**: Click slot → immediately jump to confirmation page (without waiting for API confirmation)

## Data Model

| Field | Type | Description |
|---|---|---|
| `TimeSlot.id` | `string (UUID)` | Time slot ID |
| `TimeSlot.startTime` | `string (ISO datetime)` | Start time |
| `TimeSlot.endTime` | `string (ISO datetime)` | End time |
| `TimeSlot.capacity` | `number` | Maximum concurrent bookings |
| `TimeSlot.bookedCount` | `number` | Current booked count |
| `TimeSlot.available` | `boolean` | Whether remaining capacity exists |
| `Appointment.durationMinutes` | `number` | Booking duration (minutes, including overtime) |
| `Appointment.price` | `number (decimal)` | Price snapshot (copied from Service.price) |
| `Appointment.taxRate` | `number (decimal)` | Tax rate snapshot (copied from Service.taxRate) |
| `Appointment.taxIncludedAmount` | `number (decimal)` | Tax-included total (price * (1 + taxRate)) |

## Data Sources

- contract.yaml 1.7.2 (time-slots.available, appointments.create)
- SAD 4.4 (high-concurrency transaction design)
- Interface Design Specification 2.5.3 (optimistic UI, preferredSequence random hash)
- data-architecture 5.2 (Partial Unique Index concurrency locking)
