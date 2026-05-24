# Booking System - Angular Frontend Coding Standard

## Document Information

| Property | Value |
| :--- | :--- |
| **Document Version** | 1.2.0 (§1.2 adds multi-slot-picker molecule component description) |
| **Created Date** | 2026-04-15 |
| **Updated Date** | 2026-05-11 |
| **Applicable Project** | booking-frontend (Angular v21+) |
| **Document Status** | Baselined |
| **Related Documents** | system-architecture-design (SAD), api-design-specification, data-architecture, security-architecture, global-ui-spec.md v3.0.0 |
| **Location** | `.qoder/context/code_standards/frontend-coding-standard.md` |

---

## 1. Core Principles

### 1.1 Separation of Concerns

Each file is responsible for one thing only. Component logic, template, and styles must be physically separated.

| File Type | Responsibility | Naming Convention |
| :--- | :--- | :--- |
| `*.component.ts` | Component logic, dependency injection, state subscriptions | `kebab-case.component.ts` |
| `*.component.html` | Component template, DOM structure | `kebab-case.component.html` |
| `*.component.scss` | Component private styles | `kebab-case.component.scss` |
| `*.service.ts` | Business logic, API communication, state management | `kebab-case.service.ts` |
| `*.store.ts` | NgRx SignalStore state definition | `kebab-case.store.ts` |
| `*.dto.ts` | Data transfer objects, type definitions | `kebab-case.dto.ts` |

**Mandatory Rule**: Using `template` or `styles` inline strings in the `@Component` decorator is **forbidden**.

```typescript
// Correct
@Component({
  templateUrl: './my-feature.component.html',
  styleUrls: ['./my-feature.component.scss']
})
```

### 1.2 Atomic Design Layering

Components must be organized according to the Atomic Design methodology, with strict layer dependency enforcement:

- **Atoms**: Indivisible base components (Button, Input, Modal), no dependency on other components
- **Molecules**: Reusable functional components (LoginForm, TimeSlotGrid, ~~MultiSlotPicker~~ [DEPRECATED]), may only depend on atoms
- **Organisms**: Complete functional blocks (BookingLeftPanel), may depend on molecules and atoms
- **Layouts**: Page layout skeletons (AppLayout), may depend on organisms, molecules, and atoms
- **Pages**: Route entry points and data fetching, may depend on layouts and organisms; **forbidden** to directly depend on molecules and atoms

> **Note**: The "Templates" level in standard Atomic Design is renamed to "Layouts" in this project to avoid confusion with the Angular template concept.

**New Shared Components (v1.2.0)**:
| Component | Layer | Description |
|:---|:---|:---|
| `app-search-input` | Atom | Debounced (300ms) search input with autocomplete suggestion dropdown |
| `app-filter-bar` | Molecule | Filter bar container with ng-content slot, supports overflow:visible |
| `app-table-wrapper` | Molecule | Table container with unified table layout, loading state, and empty state |
| `app-dropdown` (enhanced) | Atom | Enhanced dropdown selector with `[ngModel]` binding and `appendTo="body"` support |
| `app-modal` (enhanced) | Atom | Modal component wrapping PrimeNG `p-dialog` for unified popup styling |

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
│   ├── features/                        # Business feature modules (organized by domain)
│   │   ├── auth/                        # Authentication domain
│   │   │   ├── pages/                   # Page components
│   │   │   ├── organisms/               # Organism components (domain-specific)
│   │   │   ├── molecules/               # Molecule components (domain-specific)
│   │   │   ├── stores/                  # NgRx SignalStores
│   │   │   ├── services/                # Domain services
│   │   │   ├── dto/                     # Data transfer objects
│   │   │   └── auth.routes.ts           # Lazy-loaded route configuration
│   │   ├── booking/                     # Booking domain
│   │   ├── admin/                       # Admin panel domain
│   │   └── profile/                     # User profile domain
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
│   ├── _mixins.scss                     # SCSS Mixins (@use import)
│   ├── _reset.scss                      # Style reset
│   ├── _animations.scss                 # Global animation definitions
│   └── styles.scss                      # Global styles entry point
├── index.html
└── main.ts
```

---

## 3. TypeScript and Naming Conventions

### 3.1 Naming Rules

| Type | Naming Rule | Example |
| :--- | :--- | :--- |
| **File** | `kebab-case` | `booking-form.component.ts` |
| **Class** | `PascalCase` | `BookingFormComponent` |
| **Interface** | `PascalCase` (**no prefix**) | `Appointment`, `UserProfile` |
| **Type Alias** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **Enum** | `PascalCase`, members `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING }` |
| **Constant** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| **Variable/Function** | `camelCase` | `currentUser`, `getAvailableSlots()` |
| **Private Member** | `_` prefix + `camelCase` | `_http`, `_destroy$` |
| **Observable** | `$` suffix | `appointments$`, `loading$` |
| **Signal** | No special suffix | `isLoading`, `currentUser` |

> **Interfaces do not use the `I` prefix**, following modern TypeScript community best practices.

### 3.2 Type Safety

**Mandatory Rule**: `any` is forbidden. All function parameters, return values, and variables must have explicit types.

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

| Feature | Minimum Version | This Standard Requires |
|------|---------|-----------|
| `signal()` / `computed()` | Angular 16 | Must use |
| `inject()` replacing constructor DI | Angular 14 | Must use |
| `@use` replacing `@import` (Sass) | Sass 1.23.0 / Angular 17 | **Must use `@use`** |
| Control flow syntax `@if` / `@for` | Angular 17 | Recommended |
| `@defer` deferred views | Angular 17 | Recommended |

---

## 4. Template Standard (HTML)

### 4.1 Attribute Order

1. Control flow (`@if` / `@for` / `*ngIf` / `*ngFor`)
2. `class` / `ngClass`
3. `style` / `ngStyle`
4. Plain attributes (`id`, `type`, `placeholder`)
5. Input bindings `[property]`
6. Event bindings `(event)`
7. Two-way bindings `[(ngModel)]`

### 4.2 Template Expressions

- Complex logic expressions in templates are **forbidden**
- Complex computations must be placed in component `getter` or `computed` Signals

### 4.3 Template Size

- A single template file must **not exceed 200 lines**
- When exceeded, it must be split into smaller molecule/organism components

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

## 5. SCSS Style Standard

### 5.1 Sass `@use` Mandatory Standard

**Angular 17+ has deprecated `@import`; `@use` is mandatory.**

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

The styling strategy is **Tailwind First**:
- **Prefer** Tailwind utility classes for layout, spacing, color, and typography
- **Only** write SCSS when Tailwind cannot satisfy requirements (complex animations, pseudo-elements)
- Global SCSS files are only used for CSS resets, font imports, and global CSS variable definitions

### 5.3 BEM Naming Convention

Use BEM only when SCSS must be written:

```scss
.booking-card {
  &__header { }      // Element
  &--highlighted { } // Modifier
}
```

### 5.4 Theme Variables (CSS Custom Properties)

> ⚠️ **v3.0.0 Design System Change**: Since 2026-05-04, the project has migrated from the "Glassmorphism Dual System" to "Dark-First Sharp Design". The following variables reflect the current design tokens in the `@theme` block of `booking-frontend/src/styles.scss`.

```scss
/* ========================================
   Authoritative Source: booking-frontend/src/styles.scss (Tailwind @theme)
   Design Spec: docs/design/global-ui-spec.md v3.0.0
   ======================================== */

// Dark-First (Default Dark Theme)
:root {
  /* Background Layers */
  --color-bg-primary: #0c1220;      // Page main background (deep space blue-black)
  --color-bg-secondary: #162032;     // Card, navbar, sidebar background
  --color-bg-tertiary: #1e293b;     // Card hover/secondary background

  /* Borders */
  --color-border: #2a3a50;          // Borders, dividers
  --color-border-light: rgba(42, 58, 80, 0.3); // Light border

  /* Primary Accent Color */
  --color-primary: #2ecc71;         // Primary accent (buttons, links, selected state)
  --color-primary-start: #2ecc71;   // Gradient start
  --color-primary-end: #27ae60;     // Gradient end
  --color-primary-solid: #2ecc71;   // Solid color

  /* Functional Colors */
  --color-accent-green: #2ecc71;    // Primary accent / success positive indicator
  --color-accent-green-dark: #27ae60;
  --color-accent-blue: #00c6ff;     // (Old accent, deprecated) Secondary color
  --color-accent-red: #e74c3c;      // Danger/negative indicator
  --color-accent-yellow: #f39c12;   // Warning/pending
  --color-accent-purple: #9b59b6;   // Secondary/revenue
  --color-accent-teal: #1abc9c;     // Secondary
  --color-accent-orange: #e67e22;   // Secondary

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

> **Authoritative Source**: The complete definition and latest values of design tokens are authoritative in `booking-frontend/src/styles.scss` and `docs/design/global-ui-spec.md` v3.0.0. This section provides a quick reference within the coding standard context.

### 5.5 Style Encapsulation Strategy

- Default to `ViewEncapsulation.Emulated`
- Use `ViewEncapsulation.None` only when global override of third-party component styles is needed
- Component-specific animations go in component SCSS; shared animations go in global `styles/_animations.scss`

---

## 6. State Management Standard (NgRx SignalStore)

### 6.1 Store Structure

Each feature domain has its own independent Store:

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

### 6.2 Store Usage Rules

- **Page components** may inject the Store and subscribe to the `vm` (ViewModel) Signal
- **Molecule/Atom components** are **forbidden** from directly injecting the Store; they must receive data via `@Input()`

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

## 7. API Communication Standard

### 7.1 Service Layer Responsibilities

All HTTP requests must be encapsulated in `*Service` classes; components are **forbidden** from using `HttpClient` directly.

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

### 7.2 DTO Definition

DTO files are independently defined in `features/*/dto/` directories, strictly aligned with backend API response formats.

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
  email: string;  // email/phone are masked display fields; raw PII is stored in emailEncrypted/phoneEncrypted (AES-256-GCM); frontend never receives them
  phone: string;  // email/phone are masked display fields; raw PII is stored in emailEncrypted/phoneEncrypted (AES-256-GCM); frontend never receives them
  firstName: string;
  lastName: string;
  role: 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';
}
// Note: email and phone are masked display fields.
// Raw PII is stored in emailEncrypted/phoneEncrypted (AES-256-GCM); frontend never receives them.
// Unique indexes use emailHash/phoneHash (SHA-256); frontend never receives them.
```

> **DTO Naming Alignment**: Frontend DTO interface names must be exactly consistent with backend API response field names to ensure type safety.

---

## 8. Routing and Lazy Loading

### 8.1 Route Configuration

Each feature module has its own independent route configuration file:

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

## 9. Security Standard

### 9.1 Authentication Guard

Route guards must be located in the `core/guards/` directory:

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

Role-based route access control ensuring different roles can only access their authorized pages:

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

**Role Routing Rules**:

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

The authentication interceptor automatically attaches the JWT Token:

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
- Refresh Token is managed via the Service layer, supporting automatic rotation
- Storing Token in `localStorage` is forbidden (XSS risk)

---

## 10. Testing Standard

### 10.1 Test File Location

Test files are co-located with source files, using the `.spec.ts` suffix:

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

Store tests must cover State initialization, Methods execution, and Computed calculations:

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

| Aligned Document | Alignment Content |
|---------|---------|
| **system-architecture-design (SAD)** | Frontend/backend responsibility boundaries, communication protocols (REST + WebSocket), component layers |
| **api-design-specification** | DTO naming, API response format, error handling format, HTTP method usage |
| **data-architecture** | SignalStore State mapping to backend Prisma Schema fields, user session management |
| **security-architecture** | Auth Guard implementation, Token storage strategy, XSS/CSRF protection |

### DTO Naming Alignment Check

Frontend `*.dto.ts` interface names must be consistent with backend API response fields:

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

## Change Log

| Date | Version | Changes | Approved By |
|------|------|---------|--------|
| 2026-05-11 | 1.3.0 | Added shared components (app-search-input, app-filter-bar, app-table-wrapper, enhanced app-dropdown, enhanced app-modal); system accent color migrated from blue #00c6ff to green #2ecc71 | Architecture Review |
| 2026-05-11 | 1.2.0 | **[DEPRECATED]** Original MultiSlotPicker molecule component description marked as deprecated | Architecture Review |
| 2026-04-15 | 1.0.0 | Initial version, refined based on evaluation report | Architecture Review |
