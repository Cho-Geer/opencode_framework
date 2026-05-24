Based on the provided architecture design documents, interface specifications, contract files, route source code, and test plans, the entire booking system (Angular + NestJS refactored version) has been reviewed and organized. Below is a summary of all frontend pages (route views) in the system. Pages are categorized by user role and functional module, with references to their design documentation basis.

---

### **System Pages Overview**

| Page Name | Frontend Route (Actual) | Module | User Role | Description & Core Functionality | Design Basis |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Login Page** | `/auth/login` | Auth Module | Unauthenticated Users | Supports two login methods:<br>1. Password login (phone/email + password)<br>2. Verification code login (step-by-step send & verify) | SAD 2.3.1 (Pages List), contract.yaml (auth endpoints), auth.routes.ts |
| **Registration Page** | `/auth/register` | Auth Module | Unauthenticated Users | Two-step registration flow (mandatory):<br>1. Send verification code to phone/email<br>2. Submit verification code + password + name | SAD 2.3.1, contract.yaml (auth endpoints), auth.routes.ts, Test Strategy (E2E registration scenarios) |
| **Forgot Password Page** | `/auth/forgot-password` | Auth Module | Unauthenticated Users | ✅ **Implemented** — Two-step reset flow: send reset verification code → verify and set new password. Corresponds to RESET-PW-001 and RESET-PW-002 endpoints. Full design in `02a-forgot-password.md`. | contract.yaml v1.6.5 (RESET-PW-001~002), customer-ui-spec, Test Strategy (password reset E2E scenarios) |
| **Home/Dashboard** | `/` | Global | All Users | **Not a standalone page**: `/` within the auth layout redirects to `/booking` (CUSTOMER), or via role guard redirects to `/admin/dashboard` (ADMIN). Not a standalone feature page. | app.routes.ts (redirectTo: 'booking'), roleGuard redirect logic |
| **Profile Page** | `/profile` | User Module | CUSTOMER | View and edit personal information (name, etc.), masked display of email/phone | contract.yaml `users.get_profile` / `update_profile`, profile.routes.ts |
| **My Bookings List** | `/my-bookings` | Booking Module | CUSTOMER | Displays current user's booking history in list form, supports filtering by time/status, allows booking cancellation | contract.yaml `appointments.list`, SAD 2.3.1, app.routes.ts (my-bookings lazy loading) |
| **Booking Creation Flow** | `/booking` → `/booking/slots` → `/booking/confirmation` → `/booking/success` | Booking Module | CUSTOMER | **High-concurrency core flow**, four-step wizard experience:<br>1. Select service (`/booking`, resolver prefetch)<br>2. Select date and time slot (`/booking/slots`)<br>3. Fill additional info and confirm (`/booking/confirmation`)<br>4. Booking success (`/booking/success`)<br>Includes canDeactivate guard and optimistic UI updates throughout | booking.routes.ts (4 child routes), Interface Spec 2.5.3 (Optimistic UI), Test Strategy (booking flow E2E), contract.yaml `appointments.create` |
| **Booking Success** | `/booking/success` | Booking Module | CUSTOMER | Confirmation result page after successful booking creation, displays booking details and next steps | booking.routes.ts (BookingSuccessComponent) |
| **Admin Dashboard** | `/admin/dashboard` | Admin Stats Module | ADMIN / SUPER_ADMIN | Displays core stat cards (Today's Bookings DASH-001, Pending DASH-002, Active Users DASH-003, Total Revenue DASH-004), extended cards: System Status (SYS-001), plus booking trend chart, service distribution chart, and time distribution heatmap. Bottom three-column layout shows Recent Bookings (REC-001), Recent Users (REC-002), and Recent Services (REC-003) panels. Top navigation bar references notification (SYS-002) and message (MSG-004) unread counts. Stat cards and recent bookings table auto-refresh via WebSocket `appointment.status_changed` event; Recent Users/Recent Services load only once on init, no auto-refresh. | contract.yaml `admin.stats` (DASH-001~004), `admin.system.health` (SYS-001), `admin.notifications` (SYS-002), `admin.messages.unread-count` (MSG-004), SAD 2.2.1 (StatsModule), admin-ui-spec §2.1 & §4.2 |
| **User Management** | `/admin/users` | Admin Users Module | ADMIN / SUPER_ADMIN | Paginated view of all users, supports create/edit/delete users (masked display), filter by role/status. Top 3 stat cards (Total Users/Active Users/New This Week): Total Users comes from API `total` field (system-level total), Active Users and New This Week are computed from full data request (limit=999), not current page data. | contract.yaml `admin.users` CRUD, admin.routes.ts |
| **Service Management** | `/admin/services` | Admin Services Module | ADMIN / SUPER_ADMIN | Manage service items, supports create, edit, delete services, configure price, duration, activation status, etc. Top 3 stat cards (Total Services/Active Services/Average Price): Total Services comes from API `total` field, Active Services and Average Price are computed from full data request (limit=999). | contract.yaml `admin.services` CRUD, admin.routes.ts |
| **Appointment Management** | `/admin/appointments` | Admin Appointments Module | ADMIN / SUPER_ADMIN | View all users' booking list, supports filtering by status/time, supports single status update and batch cancel operations. Top 4 stat cards (Today/Pending/Confirmed/Cancelled) are computed from full appointment data request (limit=999), not current page data. Added Quick Booking feature: admins can quickly create bookings for customers via dialog (select customer, service, date/time, notes), calling `POST /v1/admin/appointments` backend endpoint. | contract.yaml `admin.appointments` (list/update/batch-cancel/create), admin.routes.ts, SAD 2.3.1 (AdminBookingList) |
| **Analytics** | `/admin/analytics` | Admin Analytics Module | ADMIN / SUPER_ADMIN | (**P1 Future Phase**) Aggregated analytics overview (AN-001) and conditional filtered analytics (AN-002), including booking volume/service popularity/user growth/revenue trend charts and report exports. Replaces deprecated `admin.reports.summary` endpoint (marked deprecated since contract.yaml v1.6.1). | Interface Spec §2.9 (AN-001~002), admin-ui-spec §2.1, contract.yaml (admin.reports.summary deprecated) |
| **Operation History** | `/admin/history` | Admin History Module | ADMIN / SUPER_ADMIN | (**P2 Future Phase**) Operation logs and audit trail (HIST-001), including booking change history (HIST-002) and user activity logs (HIST-003). | Interface Spec §2.10 (HIST-001~003), admin-ui-spec §2.1 |
| **System Settings** | `/admin/settings` | Admin System Module | ADMIN / SUPER_ADMIN | (**P1 Future Phase**) Global system configuration (SYS-004), including business hours, booking rules, notification preferences, etc. | Interface Spec §2.11.4 (SYS-004), admin-ui-spec §2.1 |
| **Terms of Service** | `/legal/terms` | Legal Module | Public | View terms of service page, no login required. | legal.routes.ts, app.routes.ts (legal lazy loading) |
| **Privacy Policy** | `/legal/privacy` | Legal Module | Public | View privacy policy page, no login required. | legal.routes.ts, app.routes.ts (legal lazy loading) |
| **404 Page** | `**` (wildcard) | Global | All Users | Fallback page for not-found routes (NotFoundPageComponent), rendered outside layouts, without Header/Sidebar. | app.routes.ts (wildcard route `**`, NotFoundPageComponent) |

---

### **Additional Notes**

1. **Page Interaction Patterns**  
   - **Authentication pages** (Login/Register/Forgot Password) are all standalone full-page forms with validation and countdown logic, intercepted by guestGuard for already-authenticated users.
   - **CUSTOMER booking creation flow** is designed as a four-step wizard experience (`/booking` → `/booking/slots` → `/booking/confirmation` → `/booking/success`). Data documents and interface specifications mention "frontend random hash (preferredSequence)", "optimistic UI updates", and other high-concurrency optimizations. The frontend likely uses NgRx Signals for state flow management, with canDeactivateBookingGuard to prevent accidental exit.
   - **Admin pages** adopt a standard data management list + form dialog/sidebar pattern, with PrimeNG component library providing ready-to-use Table, Dialog, Chart controls. The dashboard follows a Dark-First Data Dashboard style, based on `#0c1220` / `#162032` / `#2ecc71` color scheme (primary accent color is green).

2. **Route Architecture Mapping**  
   The Angular project uses lazy-loaded feature modules corresponding to the route plan:
   - `auth` module → `/auth/login`, `/auth/register`, `/auth/forgot-password`
   - `legal` module → `/legal/terms`, `/legal/privacy` (public routes, no auth guard)
   - `booking` module → `/booking`, `/booking/slots`, `/booking/confirmation`, `/booking/success`
   - `my-bookings` module → `/my-bookings`
   - `profile` module → `/profile`
    - `admin` module → `/admin` with 7 child pages (dashboard, users, services, appointments, analytics, history, settings)
   - `**` wildcard → 404 page (global, rendered outside layouts)

3. **Real-time Notifications & WebSocket**  
   Although not listed as a standalone "page", the system pushes real-time notifications for booking status updates, time slot capacity changes, etc. through a global WebSocket connection in the navigation bar or message center, affecting data refresh across multiple pages (e.g., booking list, admin dashboard). Dashboard notification bell (SYS-002) and message envelope (MSG-004) rely on WebSocket push for unread counts.

4. **Document Consistency**  
   The above page categorization is fully aligned with API endpoints defined in `contract.yaml` (v1.7.2), module organization in `SAD`, role permissions in `Interface Design Specification`, and the page list in `admin-ui-spec.md` (v2.3.0), ensuring clear frontend-backend contracts.

Summary: This project contains **18 clearly defined core pages** (of which 4 are planned for future phases: Forgot Password Page, Analytics P1, Operation History P2, System Settings P1), covering the complete chain from visitor registration, customer booking, to admin backend management.
