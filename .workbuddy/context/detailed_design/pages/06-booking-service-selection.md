# Booking - Service Selection Page (ServiceSelectionPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Booking Creation - Select Service |
| **Route Path** | `/booking` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Load** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **Component** | `ServiceSelectionComponent` (`src/app/features/booking/service-selection/service-selection.component.ts`) |
| **Design Basis** | Interface Specification 2.5.3 (optimistic UI), SAD 4.4 (high-concurrency core flow) |

## User Role

- CUSTOMER only

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → `/auth/login?returnUrl=/booking` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |

## Resolvers

| Resolver | Provides Data | Current Status |
|---|---|---|
| `serviceResolver` | `services: Service[]` | **Currently returns static Mock data** (5 sample services), TODO: replace with real API call |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `BookingStore` | `setSelectedServiceId()`, `loadSlots([])` |
| `ApiService` | `getServices()` |
| `Router` | Navigate to `/booking/slots` after service selection |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `services` | `Service[]` | Service list loaded from API |
| `selectedServiceId` | `string \| null` | Currently selected service ID |
| `isLoading` | `boolean` | Loading state |
| `searchQuery` | `string` | Search keyword |
| `activeCategory` | `string` | Category filter |
| `categories` | `string[]` (computed) | Category list derived from service names |
| `filteredServices` | `Service[]` (computed) | Services filtered by search keyword and category |

## API Contract Mapping

| Method | Endpoint | Request Parameters | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `GET` | `/v1/services` | — | `Service[]` (`{id, name, description, duration, price, active, pricePerMinute?, taxRate?}`) | Bearer | `loadServices()` in `ngOnInit()` |

**Backend mapping**:

| Controller | Endpoint | Details |
|---|---|---|
| `ServicesController` | `GET /services` | `findAll()` paginated + optional `isActive` filter (class-level `@RateLimit({ tier: "public", key: "ip" })`) |

## Interaction Flow

1. Visit `/booking`; guards + resolver run
2. Resolver `serviceResolver` loads service list (currently Mock, TODO replace with API)
3. Page displays service card list (name, description, duration, price)
4. Top search box → input filters services
5. Category tab bar → click to filter by category
6. Click a service → `selectedServiceId = service.id` → `BookingStore.setSelectedServiceId(serviceId)`
7. Auto-navigate to `/booking/slots`
8. `preferredSequence` is generated during confirmation submission (see 08-booking-confirmation.md)

## Data Model

| Field | Type | Description |
|---|---|---|
| `Service.id` | `string (UUID)` | Service ID |
| `Service.name` | `string` | Service name |
| `Service.description` | `string` | Service description |
| `Service.duration` | `number` | Duration (minutes) |
| `Service.price` | `number (decimal)` | Price |
| `Service.pricePerMinute` | `number (decimal)` | Per-minute unit price (for overtime billing: `overtimeMinutes × pricePerMinute`) |
| `Service.taxRate` | `number (decimal)` | Default tax rate (e.g., 0.0800 = 8%) |
| `Service.active` | `boolean` | Whether active |

> **v1.7.0 new fields**: `pricePerMinute` and `taxRate` are snapshotted to Appointment at booking creation time; subsequent Service price changes do not affect existing booking bills.

## Data Sources

- contract.yaml 1.7.2 (services.list — includes pricePerMinute, taxRate)
- SAD 2.2.1 (ServicesModule)
- Interface Design Specification 2.5.3 (high-concurrency optimistic UI)
- Data Architecture Design Document 2.2 (Service entity, ServiceCategory entity)
