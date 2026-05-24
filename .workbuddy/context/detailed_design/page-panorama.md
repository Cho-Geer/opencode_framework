Based on the provided architecture design documents, interface specifications, contract files, route source code, and test plans, I have organized the entire booking system (Angular + NestJS refactored version) and summarized all frontend pages (route views) included in the system. Pages are categorized by user role and functional module, with references to their design document sources.

---

### **System Page Panorama**

| Page Name | Frontend Route (Actual) | Module | User Role | Page Description & Core Features | Design Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Login Page** | `/auth/login` | Auth Module | Unauthenticated Users | Supports two login methods:<br>1. Password login (phone/email + password)<br>2. Verification code login (step-by-step sending and verification) | SAD 2.3.1 (Pages list), contract.yaml (auth endpoints), auth.routes.ts |
| **Register Page** | `/auth/register` | Auth Module | Unauthenticated Users | Two-step mandatory registration flow:<br>1. Send verification code to phone/email<br>2. Submit verification code + password + name | SAD 2.3.1, contract.yaml (auth endpoints), auth.routes.ts, Test Strategy (E2E registration scenario) |
| **Forgot Password Page** | `/auth/forgot-password` | Auth Module | Unauthenticated Users | Implemented — Two-step reset flow: send reset verification code → verify and set new password. Corresponds to RESET-PW-001 and RESET-PW-002 endpoints. Full design see `02a-forgot-password.md`. | contract.yaml v1.6.5 (RESET-PW-001~002), customer-ui-spec, Test Strategy (reset password E2E scenario) |
| **Home/Dashboard** | `/` | Global | All Users | **Not a standalone page**: `/` redirects to `/booking` (CUSTOMER) within the auth layout, or redirects to `/admin/dashboard` (ADMIN) via role guard. Not an independent functional page. | app.routes.ts (redirectTo: 'booking'), roleGuard redirect logic |
| **Profile Page** | `/profile` | User Module | CUSTOMER | View and edit personal basic information (name, etc.), with masked email/phone display | contract.yaml `users.get_profile` / `update_profile`, profile.routes.ts |
| **My Bookings List** | `/my-bookings` | Booking Module | CUSTOMER | Display current user's booking history in list format, support filtering by time and status, allow booking cancellation | contract.yaml `appointments.list`, SAD 2.3.1, app.routes.ts (my-bookings lazy-loaded) |
| **Booking Creation Flow** | `/booking` → `/booking/slots` → `/booking/confirmation` → `/booking/success` | Booking Module | CUSTOMER | **High-concurrency core flow**, four-step wizard experience:<br>1. Select service (`/booking`, resolver pre-fetch)<br>2. Select date and time slot (`/booking/slots`)<br>3. Supplementary info and confirmation (`/booking/confirmation`)<br>4. Booking success (`/booking/success`)<br>Includes canDeactivate guard and optimistic UI updates throughout | booking.routes.ts (4 child routes), Interface Spec 2.5.3 (optimistic UI), Test Strategy (booking flow E2E), contract.yaml `appointments.create` |
| **Booking Success** | `/booking/success` | Booking Module | CUSTOMER | Confirmation result page after successful booking creation, displays booking details and next steps | booking.routes.ts (BookingSuccessComponent) |
| **Admin Dashboard** | `/admin/dashboard` | Admin Stats Module | ADMIN / SUPER_ADMIN | Displays core statistics cards (Today's Bookings DASH-001, Pending DASH-002, Active Users DASH-003, Total Revenue DASH-004), extended cards: System Status (SYS-001), and booking trend chart, service distribution chart, time distribution heatmap. Bottom three-column layout displays recent bookings (REC-001), recent users (REC-002), recent services (REC-003) panels. Top navigation bar references notifications (SYS-002) and messages (MSG-004) unread counts. Statistics cards and recent bookings table auto-refresh via WebSocket `appointment.status_changed` events; recent users/services only load once on initialization without auto-refresh. | contract.yaml `admin.stats` (DASH-001~004), `admin.system.health` (SYS-001), `admin.notifications` (SYS-002), `admin.messages.unread-count` (MSG-004), SAD 2.2.1 (StatsModule), admin-ui-spec §2.1 & §4.2 |
| **User Management** | `/admin/users` | Admin User Module | ADMIN / SUPER_ADMIN | Paginated view of all users, support create/edit/delete users (masked display), filter by role/status. Top 3 statistics cards (Total Users/Active Users/New This Week) — Total Users from API `total` field (system-level total), Active Users and New This Week calculated from full data request (limit=999), not current page data. | contract.yaml `admin.users` CRUD, admin.routes.ts |
| **Service Management** | `/admin/services` | Admin Service Module | ADMIN / SUPER_ADMIN | Manage service items, support creating, editing, deleting services, configure price, duration, activation status, etc. Top 3 statistics cards (Total Services/Active Services/Average Price) — Total Services from API `total` field, Active Services and Average Price calculated from full data request (limit=999). | contract.yaml `admin.services` CRUD, admin.routes.ts |
| **Appointment Management** | `/admin/appointments` | Admin Appointment Module | ADMIN / SUPER_ADMIN | View all users' appointment list, filter by status/time, support single status update and batch cancel operations. Top 4 statistics cards (Today/Pending/Confirmed/Cancelled) calculated from full appointment data request (limit=999), not current page data. Added Quick Booking feature: admins can quickly create appointments for customers via dialog (select customer, service, date/time, notes), calling `POST /v1/admin/appointments` backend endpoint to complete creation. | contract.yaml `admin.appointments` (list/update/batch-cancel/create), admin.routes.ts, SAD 2.3.1 (AdminBookingList) |
| **Data Analytics** | `/admin/analytics` | Admin Analytics Module | ADMIN / SUPER_ADMIN | (**P1 Future Phase**) Aggregated analytics overview (AN-001) and conditional filtering analysis (AN-002), including booking volume/service popularity/user growth/revenue trends charts and report export. Replaces deprecated `admin.reports.summary` endpoint (marked deprecated since contract.yaml v1.6.1). | Interface Spec §2.9 (AN-001~002), admin-ui-spec §2.1, contract.yaml (admin.reports.summary deprecated) |
| **Operation History** | `/admin/history` | Admin History Module | ADMIN / SUPER_ADMIN | (**P2 Future Phase**) Operation logs and audit trail (HIST-001), including booking change history (HIST-002) and user activity logs (HIST-003). | Interface Spec §2.10 (HIST-001~003), admin-ui-spec §2.1 |
| **System Settings** | `/admin/settings` | Admin System Module | ADMIN / SUPER_ADMIN | (**P1 Future Phase**) Global system configuration (SYS-004), including business hours, booking rules, notification preferences, etc. | Interface Spec §2.11.4 (SYS-004), admin-ui-spec §2.1 |
| **Terms of Service** | `/legal/terms` | Legal Module | Public | View terms of service page, no login required. | legal.routes.ts, app.routes.ts (legal lazy-loaded) |
| **Privacy Policy** | `/legal/privacy` | Legal Module | Public | View privacy policy page, no login required. | legal.routes.ts, app.routes.ts (legal lazy-loaded) |
| **404 Page** | `**` (Wildcard) | Global | All Users | Fallback display page for not-found routes (NotFoundPageComponent), outside layout, no Header/Sidebar. | app.routes.ts (wildcard route `**`, NotFoundPageComponent) |

---

### **Supplementary Notes**

1. **Page Interaction Patterns**  
   - **Authentication-related pages** (login/register/forgot password) are all standalone single pages with form validation and verification code countdown logic, intercepted by guestGuard for authenticated users.
   - **CUSTOMER booking creation flow** is designed as a four-step wizard experience (`/booking` → `/booking/slots` → `/booking/confirmation` → `/booking/success`). The data documents and interface specifications mention "frontend random hash (preferredSequence)", "optimistic UI updates" and other high-concurrency optimization techniques. The frontend likely uses NgRx Signals for state flow, with canDeactivateBookingGuard to prevent accidental exit.
   - **Admin pages** all adopt a standard data management list + form dialog/sidebar pattern. The PrimeNG component library provides out-of-the-box controls such as Table, Dialog, Chart, etc. The dashboard uses a dark-first data dashboard style, based on `#0c1220` / `#162032` / `#2ecc71` color scheme (primary accent color is green).

2. **Mapping to Route Architecture**  
   The Angular project uses lazy-loaded Feature Modules, corresponding to route planning:
   - `auth` module → `/auth/login`, `/auth/register`, `/auth/forgot-password`
   - `legal` module → `/legal/terms`, `/legal/privacy` (public routes, no auth guard)
   - `booking` module → `/booking`, `/booking/slots`, `/booking/confirmation`, `/booking/success`
   - `my-bookings` module → `/my-bookings`
   - `profile` module → `/profile`
   - `admin` module → `/admin` with 7 child pages (dashboard, users, services, appointments, analytics, history, settings)
   - `**` wildcard → 404 page (global, outside layout)

3. **Real-time Notifications & WebSocket**  
   Although not separately listed as a "page", the system pushes booking status updates, time slot capacity changes, and other real-time notifications through a global WebSocket connection in the navigation bar or message center, affecting data refresh on multiple pages (e.g., booking list, admin dashboard). The dashboard notification bell (SYS-002) and message envelope (MSG-004) rely on WebSocket push for unread counts.

4. **Document Consistency**  
   The above page classification is fully aligned with the API endpoints defined in `contract.yaml` (v1.7.2), the module organization in `SAD`, the role permissions in the `Interface Design Specification`, and the page list in `admin-ui-spec.md` (v2.3.0), ensuring clear frontend-backend contracts.

Summary: The project includes **18 clearly defined core pages** (4 of which are planned for future phases: Forgot Password page, Data Analytics P1, Operation History P2, System Settings P1), covering the full functional chain from visitor registration, customer booking, to admin backend management.
