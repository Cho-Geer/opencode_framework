# Admin Dashboard (AdminDashboardPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Admin Dashboard |
| **Route Path** | `/admin/dashboard` (`/admin` redirects here) |
| **Layout** | `AppLayoutComponent` (Admin sidebar) |
| **Lazy Loading** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **Component** | `DashboardComponent` (`src/app/features/admin/pages/dashboard/dashboard.component.ts`) |
| **Design Basis** | contract.yaml `admin.stats` (DASH-001~004, REC-001~003), SAD 2.2.1 (StatsModule), API Specification 2.8 |

## User Roles

- ADMIN, SUPER_ADMIN

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` (parent) | Unauthenticated → Redirect |
| `roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })` (parent) | CUSTOMER denied → Redirect |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `AdminStore` | `vm` (computed view model), `setLoading()`, `setStats()`, `setError()`, `setRecentUsers()`, `setRecentServices()` |
| `AdminService` | `getStats()`, `getUsers()`, `getAdminServices()` |

## Local Computed Properties

| Signal | Type | Description |
|---|---|---|
| `vm()` | `AdminViewModel` (computed) | Contains `stats`, `isLoading`, `error` |
| `timeRange` | `Signal<TimeRange>` | Currently selected time range (default 'last30d') |
| `recentUsers` | `Signal<AdminUser[]>` | Last 5 users from store |
| `recentServices` | `Signal<AdminServiceItem[]>` | Last 5 services from store |
| `recentUserRows` | `computed` | Maps recentUsers to table row data (with BadgeStatus) |
| `recentServiceRows` | `computed` | Maps recentServices to table row data (with BadgeStatus) |

## Component Methods

| Method | Return Type | Description |
|---|---|---|
| `onTimeRangeChange(timeRange: TimeRange)` | `void` | Handle time range change, calls `store.loadStats(timeRange)` |
| `loadRecentUsers()` | `void` | Calls `AdminService.getUsers({ limit: 5 })` → `AdminStore.setRecentUsers()` |
| `loadRecentServices()` | `void` | Calls `AdminService.getAdminServices({ limit: 5 })` → `AdminStore.setRecentServices()` |

## API Contract Mapping

> **Response Envelope**: All successful API responses are wrapped by ResponseInterceptor in a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column below only describes the internal structure of the `data` field; the outer envelope is implicitly applicable.

| Method | Endpoint | Request Parameters | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/stats` | `?timeRange&startDate&endDate` (driven by Time button dropdown in Booking Distribution Panel) | `AdminStatsDto` (see below) | Bearer ADMIN/SUPER_ADMIN | `loadStats()` in `ngOnInit()` |

**`AdminStatsDto`** full structure:

| Field | Type | Description |
|---|---|---|
| `totalBookings` | `StatCard` | Total bookings (`{value, changePercentage, isPositive, target, progressPercentage}`) |
| `todayBookings` | `StatCard` | Today's bookings |
| `pendingBookings` | `StatCard` | Pending confirmation bookings |
| `activeUsers` | `StatCard` | Active users |
| `totalRevenue` | `StatCard` | Total revenue |
| `bookingTrend` | `{date: string, count: number, revenue: number}[]` | Booking trend chart data |
| `servicePopularity` | `{serviceName, count, percentage}[]` | Service popularity distribution |
| `time_distribution` | `{hour: integer, count: integer}[]` | Time slot distribution (hour 0-23) |

## Backend Mapping

| Controller | File |
|---|---|
| `AdminStatsController` | `src/modules/admin/controllers/admin-stats.controller.ts` — `GET /admin/stats` |
| `AdminStatsService` | `src/modules/admin/services/admin-stats.service.ts` |
| `StatsController` | `src/modules/stats/stats.controller.ts` — underlying stats endpoints |
| `StatsService` | `src/modules/stats/stats.service.ts` — 5 parallel aggregation queries |

`AdminStatsService.getDashboard()` calls in parallel via `Promise.all`:
- `StatsService.getOverview()` — Overview data
- `StatsService.getRevenue()` — Revenue stats
- `StatsService.getUserStats()` — User stats
- `StatsService.getPopularServices()` — Popular services Top 10
- `StatsService.getDailyBookings()` — Last 30 days daily bookings

All stats are computed in real-time via Prisma aggregation queries (Materialized View refreshed every 5 min, or Redis cache TTL=300s).

## Dashboard Content

| Area | Data Source | Description |
|---|---|---|
| **Welcome Banner** | `today = new Date()` | `<app-welcome-card>` — Page top welcome message + current date + View Bookings button (placeholder) |
| **4 Stat Cards** | `vm().stats` | Today's Bookings, Pending, Total Customers, Total Revenue |
| **Booking Trend Line Chart** | `vm().stats?.bookingTrend` | Line chart, `#2ecc71` line + gradient fill (`rgba(46,204,113,0.05→0.35)`), rendered via `AppChartComponent` |
| **Service Distribution Doughnut Chart** | `vm().stats?.servicePopularity` | Doughnut chart (cutout 70%), center displays "Total / Bookings" text, 5-color palette |
| **Time Distribution Bar Chart** | `vm().stats?.time_distribution` | Bar chart, flat `rgba(46,204,113,0.7)` color, value labels displayed above bars. Supports time range selection via Booking Distribution Panel's Time button dropdown (last24h/last7d/last30d/thisMonth/lastMonth/custom); re-requests `GET /v1/admin/stats/time-distribution` with timeRange / startDate / endDate parameters on selection |
| **Recent Bookings Table** | `GET /v1/admin/appointments?limit=5` | Recent booking list (reuses admin appointments list endpoint, not a dedicated dashboard API). limit=5 is a frontend request parameter, not formally declared in the contract |
| **Recent Users Table** | `GET /v1/admin/users?limit=5` | Last 5 registered users, including name, role (badge, displaying uppercase values such as `CUSTOMER`/`ADMIN`), status (badge), creation time (reuses admin users list endpoint) |
| **Recent Services Table** | `GET /v1/admin/services?limit=5` | Last 5 created services, including service name, duration, price, active status (badge) (reuses admin services list endpoint, not a dedicated dashboard API) |
| **System Status** | `GET /v1/admin/system/health` (SYS-001) — Response fields: `server`, `database`, `api`, `redis`, `lastBackup`, `uptime` | System health status (real-time), supports WebSocket `system.health.updated` push or 60-second polling refresh |
| **Stat Cards + Booking List** | WebSocket event `appointment.status_changed` | When appointment status changes, auto-refresh stat cards (totalBookings, todayBookings, pendingBookings, etc.) and recent booking list via WebSocket `appointment.status_changed` event; no manual page refresh needed |
| **System Status Details** | `GET /v1/admin/system/metrics` (SYS-002) — Response fields: `cpuUsage`, `memoryUsage`, `diskUsage` | Detailed metrics after expanding (CPU, Memory, Disk usage) |

## Interaction Flow

1. Access `/admin/dashboard`, parent guard validates role
2. `ngOnInit()` → `loadStats()` → `AdminService.getStats()` → `AdminStore.setStats()`
3. Top displays welcome banner card (`<app-welcome-card>`): Username + current date + View Bookings button
4. Display 4 core stat cards (with change percentage and progress bar)
4. Chart area (2-column grid layout):
   - Left column: Booking trend line chart ← `vm().stats.bookingTrend`
   - Right column: Booking Distribution Panel (single panel containing service distribution doughnut chart + time distribution bar chart)
5. **Time Range Filter**:
   - User clicks Time button in Booking Distribution Panel → Displays dropdown menu with 6 options
   - Select a preset range (e.g., Last 7 Days) → Triggers `store.loadTimeDistribution(timeRange)` → Only time distribution bar chart updates per selected range (data source: `time_distribution` field)
   - Select Custom Range → Displays date picker panel → Select start and end dates → Click Apply → Triggers `store.loadTimeDistribution('custom', startDate, endDate)` → Only time distribution bar chart updates
6. Bottom three-column recent panels (`grid grid-cols-1 lg:grid-cols-3`):
   - Recent Bookings
   - Recent Users
   - Recent Services
7. System status collapsible panel

## Refresh Matrix

| Area | Initial Load | WebSocket Auto-Refresh | Polling | User Action Triggered Refresh |
|---|---|---|---|---|
| 4 Stat Cards | `ngOnInit` → `getStats()` | ✅ `appointment.status_changed` event → re-`loadStats()` | ❌ | Time range change |
| Booking Trend Chart | `ngOnInit` → `loadBookingTrend()` | ❌ | ❌ | Period (Weekly/Monthly/Yearly) switch |
| Service Distribution + Time Distribution | `ngOnInit` → `vm().stats` | ❌ | ❌ | Time range dropdown selection |
| Recent Bookings Table | `ngOnInit` → `getAdminAppointments({limit:5})` | ✅ `appointment.status_changed` event → reload | ❌ | — |
| **Recent Users Table** | `ngOnInit` → `getUsers({limit:5})` | ❌ | ❌ | — |
| **Recent Services Table** | `ngOnInit` → `getAdminServices({limit:5})` | ❌ | ❌ | — |
| System Status | `ngOnInit` → `getSystemStatus()` | ✅ `system.health.updated` WebSocket | ✅ 60s interval | Click to expand details |

> **Recent Users / Recent Services** panels only load once on `ngOnInit`, no auto-refresh. For real-time updates, need to introduce WebSocket user/service change events or add polling mechanism.

## Data Sources

- contract.yaml 1.7.1 (admin.stats — including time_distribution single field, removed redundant staffWorkload)
- SAD 2.2.1 (StatsModule)
- API Design Specification 2.8 (DASH-001~004 dashboard metric definitions)
- Data Architecture Design Document 11.1.1 (real-time stats computation + Materialized View)
- admin.users CRUD (REC-002 recent users panel)
- admin.services CRUD (REC-003 recent services panel)
