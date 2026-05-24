# Login Page (LoginPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Login Page |
| **Route Path** | `/auth/login` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Loading** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` |
| **Component** | `LoginComponent` (`src/app/features/auth/login/login.component.ts`) |
| **Design Basis** | SAD 2.3.1, contract.yaml (auth endpoints), Interface 2.1.2 |

## User Roles

- Unauthenticated users (`guestGuard` enforced)

## Route Parameters

| Parameter | Type | Source | Description |
|---|---|---|---|
| `returnUrl` | `string` | Query params | Set by `authGuard` on redirect, navigates back to this address after successful login |

## Route Guards

| Guard | Path | Strategy |
|---|---|---|
| `guestGuard` | `auth/login` | Authenticated users denied access, redirected to role-specific home page |

## Component Parameters

- No `@Input()` / `@Output()` (standalone full-page component)

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `FormBuilder` | Create reactive forms (`passwordForm`, `codeLoginForm`) |
| `AuthStore` | Auth state management: `isLoading`, `error`, `loginSuccess()`, `setUserProfile()`, `setLoading()`, `setError()` |
| `ApiService` | HTTP API calls |
| `SocketService` | Establish WebSocket connection after successful login |
| `Router` | Post-login navigation |
| `RouteResolver` | Static method `getPostLoginRoute(profile.userType)` determines target route |

> **Note**: `ApiService` automatically attaches `X-Request-ID` to requests via interceptor. The `requestId` field in login response can be used for end-to-end tracing.

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `activeTab` | `'password' \| 'code'` | Password login / verification code login tab toggle |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | Contact method type |
| `acceptTerms` | `boolean` | Whether terms of service are accepted |
| `countdown` | `number` | Verification code send countdown (60 seconds) |
| `codeLoginStep` | `1 \| 2` | Verification code login step |
| `showAntiEnumMessage` | `boolean` | Anti-enumeration generic message |
| `passwordVisible` | `boolean` | Password visibility toggle (hidden by default) |

## API Contract Reference

| Method | Endpoint | Request DTO | Response DTO | Auth | Trigger |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/login/password` | `LoginPasswordDto` (`contact`, `contactType`, `password`) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | Password form submission |
| `POST` | `/v1/auth/login/send-code` | `LoginSendCodeDto` (`contact`, `contactType`) | `SendCodeResponseDto` (`expiresIn`) | No | Code login - send verification code |
| `POST` | `/v1/auth/login/verify-code` | `LoginVerifyCodeDto` (`contact`, `contactType`, `code`) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | Code login - verify code |
| `GET` | `/v1/users/profile` | — | `{id, name, email, phone, userType, createdAt}` | Bearer | Fetch user info after successful login |
| `POST` | `/v1/auth/refresh` | — (HttpOnly cookie) | `AuthResponseDto` | No | Token refresh |
| `POST` | `/v1/auth/logout` | — | `LogoutResponseDto` | Bearer | Logout |

> **Envelope format**: Response body follows `statusCode/message/data/timestamp/requestId` envelope format (contract.yaml §response_envelope).

## Auth Backend Mapping

| Controller | File |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

Key backend implementation:
- `loginSendCode()`: Anti-enumeration strategy (returns 200 regardless of whether user exists), only sends code for ACTIVE users
- `loginPassword()`: bcrypt password comparison, `constantTimeLoginDelay()` prevents timing attacks (250-350ms random delay)
- `loginVerifyCode()`: Redis verification code TTL=300s, updates `lastLoginAt`
- `refreshTokens()`: Token rotation + replay attack detection
- `logout()`: Session revocation + JWT blacklist (Redis)

## Form Validation

| Form | Field | Validation Rules |
|---|---|---|
| `passwordForm` | `contact` | `contactFormatValidator` (email regex / phone regex) |
| | `password` | `passwordStrengthValidator` (min 8 chars, uppercase, lowercase, digit, special char) |
| `codeLoginForm` | `contact` | Same as above |
| | `code` | 6-digit number |
| | `terms` | Must accept terms checkbox |

## Interaction Flow

1. User visits `/auth/login`, `guestGuard` checks not logged in and allows access
2. Default display: "Password Login" tab (`activeTab = 'password'`)
3. User enters contact and password, submits → calls `POST /v1/auth/login/password`
4. Success → `AuthStore.loginSuccess()` → `ApiService.getUserProfile()` → `SocketService.connect()` → navigate by role
5. If switching to "Code Login" tab, Step 1: send code → Step 2: verify code
6. After code sent: 60-second countdown, button disabled
7. Post-login routing: CUSTOMER → `/booking`, ADMIN/SUPER_ADMIN → `/admin/dashboard`
8. Password input provides visibility toggle button (`.password-toggle-btn`) on the right,
   clicking toggles `passwordVisible` signal via `togglePasswordVisibility()`,
   aria-label dynamically switches between "Show password" / "Hide password",
   button minimum size 44px × 44px meets WCAG touch-friendly standards

## Role Route Mapping

| User Role | Post-Login Route |
|---|---|
| `CUSTOMER` | `/booking` |
| `ADMIN` / `SUPER_ADMIN` | `/admin/dashboard` |

## Related API Rate Limiting

| Endpoint | Rate Limit Strategy |
|---|---|
| `POST /v1/auth/login/send-code` | 5 times/minute/contact |
| `POST /v1/auth/login/verify-code` | 10 times/minute/contact |
| `POST /v1/auth/login/password` | 5 times/minute/contact |

## Data Sources

- contract.yaml 1.7.1
- SAD 2.3.1 (Pages List)
- Interface Design Specification 2.1.2
- security-architecture 2.1 (JWT dual Token), 2.3.2 (anti-enumeration)
- piiEncryptionStrategy 6.2 (login flow)
