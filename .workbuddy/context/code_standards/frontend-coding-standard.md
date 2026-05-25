# Booking System - Angular Frontend Coding Standard Document

## Document Information

| Attribute | Value |
| :--- | :--- |
| **Document Version** | 1.2.0 (§1.2 Added multi-slot-picker molecule component description) |
| **Created Date** | 2026-04-15 |
| **Updated Date** | 2026-05-11 |
| **Applicable Project** | booking-frontend (Angular v21+) |
| **Document Status** | Baselined |
| **Related Documents** | System Architecture Design Document (SAD), Interface Design Specification, Data Architecture Design Document, Security Architecture Design Document, global-ui-spec.md v3.0.0 |
| **Storage Location** | `.opencode/context/code_standards/frontend-coding-standard.md` |

---

## 1. Core Principles

### 1.1 Separation of Concerns

Each file handles only one thing. Component logic, templates, and styles must be physically separated.

| File Type | Responsibility | Naming Convention |
| :--- | :--- | :--- |
| `*.component.ts` | Component logic, dependency injection, state subscriptions | `kebab-case.component.ts` |
| `*.component.html` | Component template, DOM structure | `kebab-case.component.html` |
| `*.component.scss` | Component private styles | `kebab-case.component.scss` |
| `*.service.ts` | Business logic, API communication, state management | `kebab-case.service.ts` |
| `*.store.ts` | NgRx SignalStore state definition | `kebab-case.store.ts` |
| `*.dto.ts` | Data transfer objects, type definitions | `kebab-case.dto.ts` |

**Mandatory rule**: Using inline `template` or `styles` strings in the `@Component` decorator is **prohibited**.

```typescript
// Correct
@Component({
  templateUrl: './my-feature.component.html',
  styleUrls: ['./my-feature.component.scss']
})
```

### 1.2 Atomic Design Layering

Components must be organized according to the Atomic Design methodology, strictly adhering to layer dependencies:

- **Atoms**: Indivisible basic components (Button, Input, Modal), do not depend on any other components
- **Molecules**: Reusable functional components (LoginForm, TimeSlotGrid, ~~MultiSlotPicker~~ [DEPRECATED]), can only depend on atoms
- **Organisms**: Complete functional blocks (BookingLeftPanel), can depend on molecules and atoms
- **Layouts**: Page layout skeleton (AppLayout), can depend on organisms, molecules, atoms
- **Pages**: Route entry points and data fetching, can depend on layouts and organisms, **prohibited** from directly depending on molecules and atoms

> **Note**: "Templates" from the original Atomic Design has been renamed to "Layouts" in this project to avoid confusion with Angular template concepts.

**New Shared Components (v1.2.0)**:
| Component | Layer | Description |
|:---|:---|:---|
| `app-search-input` | Atom | Search input with debounce (300ms), supports autocomplete suggestion dropdown |
| `app-filter-bar` | Molecule | Filter bar container with ng-content slots, supports overflow visible (overflow:visible) |
| `app-table-wrapper` | Molecule | Table container, unified table layout, loading state, and empty state |
| `app-dropdown` (Enhanced) | Atom | Enhanced dropdown selector, supports `[ngModel]` binding and `appendTo="body"` |
| `app-modal` (Enhanced) | Atom | Modal component wrapping PrimeNG `p-dialog` for unified dialog styling |

**Organism Ownership Rules**:
- Domain-specific Organisms remain in `features/*/organisms/`
- Cross-domain reusable Organisms are placed in `shared/organisms/`

---

## 2. Project Directory Structure

```
src/
├── app/
│   ├── core/                           # Core singleton services and global configuration
│   │   ├── guards/                      # Route guards (auth.guard.ts)
│   │   ├── interceptors/                # HTTP interceptors (auth.interceptor.ts)
│   │   ├── services/                    # Global services (api.service.ts)
│   │   └── config/                      # Environment configuration (app.config.ts)
│   ├── features/                        # Business feature modules (divided by domain)
│   │   ├── auth/                        # Authentication domain
│   │   │   ├── pages/                   # Page components
│   │   │   ├── organisms/               # Organism components (domain-specific)
│   │   │   ├── molecules/               # Molecule components (domain-specific)
│   │   │   ├── stores/                  # NgRx SignalStores
│   │   │   ├── services/                # Domain-internal services
│   │   │   ├── dto/                     # Data transfer objects
│   │   │   └── auth.routes.ts           # Lazy loading route configuration
│   │   ├── booking/                     # Booking domain
│   │   ├── admin/                       # Admin domain
│   │   └── profile/                     # Profile domain
│   ├── shared/                          # Shared components (atoms + cross-domain molecules/organisms)
│   │   ├── atoms/                       # Atom components (cross-domain reusable)
│   │   ├── molecules/                   # Cross-domain reusable molecule components
│   │   ├── organisms/                   # Cross-domain reusable organism components
│   │   ├── pipes/                       # Custom pipes
│   │   └── directives/                  # Custom directives
│   ├── layouts/                         # Layout layer
│   ├── app.component.ts
│   ├── app.config.ts                    # Application configuration (providers, interceptor registration)
│   └── app.routes.ts
├── assets/
├── environments/
├── styles/
│   ├── _variables.scss                  # SCSS variables (@use import)
│   ├── _mixins.scss                     # SCSS Mixin (@use import)
│   ├── _reset.scss                      # Style reset
│   ├── _animations.scss                 # Global animation definitions
│   └── styles.scss                      # Global style entry point
├── index.html
└── main.ts
```

---

## 3. TypeScript and Naming Conventions

### 3.1 Naming Conventions

| Type | Naming Rule | Example |
| :--- | :--- | :--- |
| **File** | `kebab-case` | `booking-form.component.ts` |
| **Class** | `PascalCase` | `BookingFormComponent` |
| **Interface** | `PascalCase` (**No prefix**) | `Appointment`, `UserProfile` |
| **Type Alias** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **Enum** | `PascalCase`, Members `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING }` |
| **Constant** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| **Variable/Function** | `camelCase` | `currentUser`, `getAvailableSlots()` |
| **Private Member** | `_` Prefix + `camelCase` | `_http`, `_destroy$` |
| **Observable** | `$` Suffix | `appointments$`, `loading$` |
| **Signal** | No special suffix | `isLoading`, `currentUser` |

> **Interface naming does not use `I` prefix**, following modern TypeScript community best practices.

### 3.2 Type Safety

**Mandatory rule**: Using `any` is prohibited. All function parameters, return values, and variables must have explicit types.

### 3.3 Component Class Structure

Members must be arranged in the following order:
1. Dependency injection (`inject`)
2. Input/Output properties (`@Input`, `@Output`)
3. Reactive state (`signal`, `computed`)
4. Private properties
5. Computed properties (`getter`)
6. Lifecycle hooks
7. Public methods
8. Private methods

### 3.4 Angular Version Compatibility

| Feature | Minimum Version | Required by This Specification |
|------|---------|-----------|
| `signal()` / `computed()` | Angular 16 | Must use |
| `inject()` replacing constructor DI | Angular 14 | Must use |
| `@use` replacing `@import` (Sass) | Sass 1.23.0 / Angular 17 | **Must use `@use`** |
| Control flow syntax `@if` / `@for` | Angular 17 | Recommended |
| `@defer` deferred views | Angular 17 | Recommended |

---

## 4. Template Standards (HTML)

### 4.1 Attribute Order

1. Control flow (`@if` / `@for` / `*ngIf` / `*ngFor`)
2. `class` / `ngClass`
3. `style` / `ngStyle`
4. Common attributes (`id`, `type`, `placeholder`)
5. Input binding `[property]`
6. Event binding `(event)`
7. Two-way binding `[(ngModel)]`

### 4.2 Template Expressions

- **Prohibited** from writing complex logic expressions in templates
- Complex calculations must be placed in component `getter` or `computed` Signal

### 4.3 Template Size

- A single template file must **not exceed 200 lines**
- When exceeded, must be split into smaller molecule/organism components

### 4.4 Deferred View Optimization

Non-above-the-fold content must use `@defer` for on-demand loading:

```html
@defer (on viewport) {
  <app-booking-calendar [date]="selectedDate()" />
} @placeholder {
  <app-spinner />
}
```

---

## 5. SCSS Style Standards

### 5.1 Sass `@use` Mandatory Standard

**Angular 17+ has deprecated `@import` — `@use` is mandatory.**

```scss
// Correct
@use 'src/styles/variables' as *;
@use 'src/styles/mixins' as m;

.booking-card {
  padding: $card-padding;
  @include m.responsive-padding();
}
```

### 5.2 Tailwind CSS Priority

Style strategy is **Tailwind First**:
- **Prioritize** Tailwind utility classes for layout, spacing, colors, fonts
- **Only write SCSS** when Tailwind cannot satisfy requirements (complex animations, pseudo-elements)
- Global SCSS files are only used for CSS reset, font imports, and global CSS variable definitions

### 5.3 BEM Naming Convention

Use BEM only when SCSS is necessary:

```scss
.booking-card {
  &__header { }      // Element
  &--highlighted { } // Modifier
}
```

### 5.4 Theme Variables (CSS Custom Properties)

> ⚠️ **v3.0.0 Design System Change**: Since 2026-05-04, the project has been uniformly migrated from "Glassy Dual-System" to "Dark-First Sharp Design". The following variables reflect the actual design tokens in the `@theme` block of the current `booking-frontend/src/styles.scss`.

```scss
/* ========================================
   Authoritative Source: booking-frontend/src/styles.scss (Tailwind @theme)
   Design Specification: docs/design/global-ui-spec.md v3.0.0
   ======================================== */

// Dark-First (Default Dark Theme)
:root {
  /* Background Levels */
  --color-bg-primary: #0c1220;      // Page main background (deep space blue-black)
  --color-bg-secondary: #162032;     // Card, navigation bar, sidebar background
  --color-bg-tertiary: #1e293b;     // Card hover/secondary background

  /* Borders */
  --color-border: #2a3a50;          // Border, divider
  --color-border-light: rgba(42, 58, 80, 0.3); // Light border

  /* Accent Main Colors */
  --color-primary: #2ecc71;         // Primary accent (buttons, links, selected state)
  --color-primary-start: #2ecc71;   // Gradient start
  --color-primary-end: #27ae60;     // Gradient end
  --color-primary-solid: #2ecc71;   // Solid color

  /* Functional Colors */
  --color-accent-green: #2ecc71;    // Primary accent / Success positive indicator
  --color-accent-green-dark: #27ae60;
  --color-accent-blue: #00c6ff;     // (Old accent, deprecated) Auxiliary color
  --color-accent-red: #e74c3c;      // Danger/negative indicator
  --color-accent-yellow: #f39c12;   // Warning/pending
  --color-accent-purple: #9b59b6;   // Auxiliary/revenue
  --color-accent-teal: #1abc9c;     // Auxiliary
  --color-accent-orange: #e67e22;   // Auxiliary

  /* Semantic Color Aliases */
  --color-success: #2ecc71;
  --color-warning: #f39c12;
  --color-danger: #e74c3c;
  --color-info: #2ecc71;

  /* Text */
  --color-text-primary: #e2e8f0;    // Primary text color (high contrast white)
  --color-text-secondary: #94a3b8;  // Secondary text color
  --color-text-disabled: #475569;   // Disabled text

  /* Shadows */
  --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
  --shadow-card-hover: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.25), 0 0 15px rgba(46, 204, 113, 0.2);
  --shadow-glow-green: 0 0 15px rgba(46, 204, 113, 0.3);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.2);
  --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.3);
}

/* Light Theme Override (applied via [data-theme="light"] when switching to light mode) */
[data-theme="light"] {
  --color-bg-primary: #f8fafc;
  --color-bg-secondary: #ffffff;
  --color-bg-tertiary: #f1f5f9;
  --color-border: #e2e8f0;
  --color-border-light: rgba(226, 232, 240, 0.5);
  --color-text-primary: #1e293b;
  --color-text-secondary: #64748b;
  --color-text-disabled: #94a3b8;
  --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-card-hover: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 15px rgba(46, 204, 113, 0.2);
  --shadow-glow-green: 0 0 15px rgba(46, 204, 113, 0.3);
}
```

> **Authoritative Source**: The complete definitions and latest values of design tokens are based on `booking-frontend/src/styles.scss` and `docs/design/global-ui-spec.md` v3.0.0. This section provides a quick reference within the coding standard context.

### 5.5 Style Encapsulation Strategy

- Default to `ViewEncapsulation.Emulated`
- Only use `ViewEncapsulation.None` when global override of third-party component styles is needed
- Component-specific animations in component SCSS, common animations in global `styles/_animations.scss`

---

## 6. State Management Standards (NgRx SignalStore)

### 6.1 Store Structure

Each functional domain has its own independent Store:

```typescript
import { signalStore, withState, withMethods, withComputed } from '@ngrx/signals';
import { patchState } from '@ngrx/signals';
import { inject } from '@angular/core';
import { BookingService } from './booking.service';

interface BookingState {
  appointments: Appointment[];
  selectedDate: string;
  isLoading: boolean;
  error: string | null;
}

const initialState: BookingState = {
  appointments: [],
  selectedDate: new Date().toISOString().split('T')[0],
  isLoading: false,
  error: null,
};

export const BookingStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ appointments, isLoading, error }) => ({
    hasAppointments: computed(() => appointments().length > 0),
    pendingCount: computed(() =>
      appointments().filter(a => a.status === 'PENDING').length
    ),
    vm: computed(() => ({
      appointments: appointments(),
      isLoading: isLoading(),
      error: error(),
    })),
  })),
  withMethods((store, bookingService = inject(BookingService)) => ({
    async loadAppointments(date: string): Promise<void> {
      patchState(store, { isLoading: true, error: null });
      try {
        const appointments = await bookingService.getByDate(date);
        patchState(store, { appointments, isLoading: false });
      } catch (error) {
        patchState(store, {
          error: error instanceof Error ? error.message : 'Unknown error',
          isLoading: false
        });
      }
    },
    setSelectedDate(date: string): void {
      patchState(store, { selectedDate: date });
    },
  }))
);
```

### 6.2 Store Usage Standards

- **Page components** can inject Store, subscribe to `vm` (ViewModel) Signal
- **Molecule/atom components** are **prohibited** from directly injecting Store, must receive data via `@Input()`

```typescript
// Correct: Page component injects Store
@Component({ ... })
export class BookingPageComponent {
  private readonly store = inject(BookingStore);
  readonly vm = this.store.vm;
}

// Correct: Molecule component receives data via Input
@Component({ ... })
export class TimeSlotGridComponent {
  @Input() slots: TimeSlot[] = [];
  @Input() selectedSlotId: string | null = null;
  @Output() slotSelected = new EventEmitter<string>();
}
```

---

## 7. API Communication Standards

### 7.1 Service Layer Responsibilities

All HTTP requests must be encapsulated in `*Service` classes. Components are **prohibited** from directly using `HttpClient`.

```typescript
@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiBaseUrl;

  getAll(): Promise<Appointment[]> {
    return firstValueFrom(
      this.http.get<Appointment[]>(`${this.apiUrl}/v1/appointments`)
    );
  }

  getById(id: string): Promise<Appointment> {
    return firstValueFrom(
      this.http.get<Appointment>(`${this.apiUrl}/v1/appointments/${id}`)
    );
  }

  create(dto: CreateBookingDto): Promise<Appointment> {
    return firstValueFrom(
      this.http.post<Appointment>(`${this.apiUrl}/v1/appointments`, dto)
    );
  }
}
```

### 7.2 DTO Definitions

DTO files are independently defined under `features/*/dto/` directory, strictly aligned with backend API response format.

```typescript
// auth.dto.ts
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  email: string;  // email/phone are masked display fields, original PII is stored in emailEncrypted/phoneEncrypted (AES-256-GCM), never received by frontend
  phone: string;  // email/phone are masked display fields, original PII is stored in emailEncrypted/phoneEncrypted (AES-256-GCM), never received by frontend
  firstName: string;
  lastName: string;
  role: 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';
}
// Note: email and phone are masked display fields.
// Original PII is stored in emailEncrypted/phoneEncrypted (AES-256-GCM), never received by frontend.
// Unique indexes use emailHash/phoneHash (SHA-256), never received by frontend.
```

> **DTO Naming Alignment**: Frontend DTO interface names must exactly match backend API response field names to ensure type safety.

---

## 8. Routing and Lazy Loading

### 8.1 Route Configuration

Each feature module has its own route configuration file:

```typescript
// features/auth/auth.routes.ts
import { Routes } from '@angular/router';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component')
      .then(m => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component')
      .then(m => m.RegisterComponent),
  },
];
```

### 8.2 Lazy Loading

Root routes lazy-load feature modules via `loadChildren`:

```typescript
// app.routes.ts
export const APP_ROUTES: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes')
      .then(m => m.AUTH_ROUTES),
  },
  {
    path: 'booking',
    loadChildren: () => import('./features/booking/booking.routes')
      .then(m => m.BOOKING_ROUTES),
  },
];
```

---

## 9. Security Standards

### 9.1 Auth Guard

Route guards must be integrated under the `core/guards/` directory:

```typescript
// core/guards/auth.guard.ts
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/auth/login'], {
      queryParams: { returnUrl: state.url }
    });
  }
  return true;
};
```

### 9.2 Role Guard

Role-based route access control, ensuring different roles can only access their authorized pages:

```typescript
// core/guards/role.guard.ts
export function roleGuard(config: {
  allow?: string[];
  deny?: string[];
  redirectTo?: string;
}): CanActivateFn {
  return () => {
    const authStore = inject(AuthStore);
    const router = inject(Router);
    const user = authStore.currentUser();

    if (!user) {
      router.navigate(['/auth/login']);
      return false;
    }

    if (config.deny && config.deny.includes(user.role)) {
      router.navigate([config.redirectTo || '/']);
      return false;
    }

    if (config.allow && !config.allow.includes(user.role)) {
      router.navigate([config.redirectTo || '/']);
      return false;
    }

    return true;
  };
}
```

**Role Route Rules**:

| Route | CUSTOMER | ADMIN | SUPER_ADMIN |
|------|:---:|:---:|:---:|
| `/booking/*` | ✅ | ❌ | ❌ |
| `/my-bookings` | ✅ | ❌ | ❌ |
| `/profile` | ✅ | ✅ | ✅ |
| `/admin/*` | ❌ | ✅ | ✅ |

**Usage Example**:
```typescript
// booking.routes.ts — CUSTOMER only
const customerOnly = [authGuard, roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })];

// admin.routes.ts — ADMIN/SUPER_ADMIN only
canActivate: [authGuard, roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })],
```

### 9.3 HTTP Interceptor

Auth interceptor automatically attaches JWT Token:

```typescript
// core/interceptors/auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TokenStorage).getAccessToken();

  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }
  return next(req);
};
```

### 9.4 Token Storage

- Access Token is stored in memory (`signal`)
- Refresh Token is managed through the Service layer, supports automatic rotation
- Prohibited from storing Token in `localStorage` (XSS risk)

---

## 10. Testing Standards

### 10.1 Test File Location

Test files are in the same directory as source files, with `.spec.ts` suffix:

```
features/booking/
├── pages/
│   └── booking-page/
│       ├── booking-page.component.ts
│       ├── booking-page.component.html
│       ├── booking-page.component.scss
│       └── booking-page.component.spec.ts
└── stores/
    ├── booking.store.ts
    └── booking.store.spec.ts
```

### 10.2 Store Testing

Store tests must cover State initialization, Methods execution, and Computed computation:

```typescript
describe('BookingStore', () => {
  it('should initialize with default state', () => {
    const store = new BookingStore();
    expect(store.vm()).toEqual({
      appointments: [],
      isLoading: false,
      error: null,
    });
  });

  it('should load appointments successfully', async () => {
    const store = new BookingStore();
    await store.loadAppointments('2026-04-15');
    expect(store.isLoading()).toBe(false);
    expect(store.appointments().length).toBeGreaterThan(0);
  });
});
```

---

## 11. Alignment with Other Documents

| Alignment Document | Alignment Content |
|---------|---------|
| **System Architecture Design Document (SAD)** | Frontend/backend responsibility boundaries, communication protocol (REST + WebSocket), component hierarchy |
| **Interface Design Specification** | DTO naming, API response format, error handling format, HTTP method usage |
| **Data Architecture Design Document** | SignalStore State to backend Prisma Schema field mapping, user session management |
| **Security Architecture Design Document** | Auth Guard implementation, Token storage strategy, XSS/CSRF protection |

### DTO Naming Alignment Check

Interface names in frontend `*.dto.ts` must be consistent with backend API response fields:

```typescript
// Frontend: features/booking/dto/booking.dto.ts
export interface CreateBookingDto {
  timeSlotId: string;     // Maps to backend Appointment.timeSlotId
  serviceId: string;      // Maps to backend Appointment.serviceId
  appointmentDate: string; // Maps to backend Appointment.appointmentDate
  customerInfo: CustomerInfo;
}

// Backend: Prisma Schema Appointment model
// timeSlotId: String @map("time_slot_id")
// serviceId: String @map("service_id")
// appointmentDate: DateTime @map("appointment_date")
```

---

## Update History

| Date | Version | Changes | Approved by |
|------|------|---------|--------|
| 2026-05-11 | 1.3.0 | Added shared components (app-search-input, app-filter-bar, app-table-wrapper, app-dropdown enhanced, app-modal enhanced); System color migrated from blue #00c6ff to green #2ecc71 | Architecture Review |
| 2026-05-11 | 1.2.0 | **[DEPRECATED]** Original MultiSlotPicker molecule component description has been marked deprecated | Architecture Review |
| 2026-04-15 | 1.0.0 | Initial version, refined based on evaluation report | Architecture Review |
