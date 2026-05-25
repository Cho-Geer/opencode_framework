# Login Page (LoginPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Login Page |
| **Route Path** | `/auth/login` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Load** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` |
| **Component** | `LoginComponent` (`src/app/features/auth/login/login.component.ts`) |
| **Design Basis** | SAD 2.3.1, contract.yaml (auth endpoints), Interface 2.1.2 |

## User Role

- Unauthenticated users (enforced by `guestGuard`)

## Route Parameters

| Parameter | Type | Source | Description |
|---|---|---|---|
| `returnUrl` | `string` | Query params | Set by `authGuard` on redirect; navigate back to this address after successful login |

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
| `Router` | Navigate after login |
| `RouteResolver` | Static method `getPostLoginRoute(profile.userType)` determines target route |

> **Note**: `ApiService` automatically attaches `X-Request-ID` to requests via interceptor; the `requestId` field in login response can be used for full-trace tracking.

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `activeTab` | `'password' \| 'code'` | Password login / Verification code login tab toggle |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | Contact method type |
| `acceptTerms` | `boolean` | Whether terms of service are accepted |
| `countdown` | `number` | Verification code send countdown (60 seconds) |
| `codeLoginStep` | `1 \| 2` | Verification code login steps |
| `showAntiEnumMessage` | `boolean` | Generic anti-enumeration message |
| `passwordVisible` | `boolean` | Password visibility toggle (hidden by default) |

## API Contract Mapping

| Method | Endpoint | Request DTO | Response DTO | Auth | Call Timing |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/login/password` | `LoginPasswordDto` (`contact`, `contactType`, `password`) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | Password form submission |
| `POST` | `/v1/auth/login/send-code` | `LoginSendCodeDto` (`contact`, `contactType`) | `SendCodeResponseDto` (`expiresIn`) | No | Verification code login - send code |
| `POST` | `/v1/auth/login/verify-code` | `LoginVerifyCodeDto` (`contact`, `contactType`, `code`) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | Verification code login - verify code |
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
- `loginSendCode()`: Anti-enumeration strategy (always returns 200 regardless of whether user exists); only sends code to ACTIVE users
- `loginPassword()`: bcrypt password comparison; `constantTimeLoginDelay()` for timing attack protection (250-350ms random delay)
- `loginVerifyCode()`: Redis verification code TTL=300s; updates `lastLoginAt`
- `refreshTokens()`: Token rotation + replay attack detection
- `logout()`: Revoke session + JWT blacklist (Redis)

## Form Validation

| Form | Field | Validation Rules |
|---|---|---|
| `passwordForm` | `contact` | `contactFormatValidator` (email regex / phone regex) |
| | `password` | `passwordStrengthValidator` (min 8 chars, uppercase, lowercase, digit, special char) |
| `codeLoginForm` | `contact` | Same as above |
| | `code` | 6-digit number |
| | `terms` | Must check acceptance of terms |

## Interaction Flow

1. User visits `/auth/login`; `guestGuard` checks authentication and grants access if not logged in
2. Default display: "Password Login" tab (`activeTab = 'password'`)
3. User enters contact info and password, submits → calls `POST /v1/auth/login/password`
4. Success → `AuthStore.loginSuccess()` → `ApiService.getUserProfile()` → `SocketService.connect()` → navigate based on role
5. If switching to "Verification Code Login" tab: Step 1: send code → Step 2: verify code
6. After code sent: 60-second countdown, button disabled
7. Post-login routes: CUSTOMER → `/booking`, ADMIN/SUPER_ADMIN → `/admin/dashboard`
8. Password input field has visibility toggle button on the right (`.password-toggle-btn`),
   clicking triggers `togglePasswordVisibility()` to toggle `passwordVisible` signal,
   aria-label dynamically switches between "Show password" / "Hide password",
   button minimum size 44px × 44px meets WCAG touch-friendly standard

## Role Route Mapping

| User Role | Post-Login Route |
|---|---|
| `CUSTOMER` | `/booking` |
| `ADMIN` / `SUPER_ADMIN` | `/admin/dashboard` |

## Related API Rate Limiting

| Endpoint | Rate Limit Policy |
|---|---|
| `POST /v1/auth/login/send-code` | 5 requests/min/contact |
| `POST /v1/auth/login/verify-code` | 10 requests/min/contact |
| `POST /v1/auth/login/password` | 5 requests/min/contact |

## Data Sources

- contract.yaml 1.7.1
- SAD 2.3.1 (Pages list)
- Interface Design Specification 2.1.2
- Security Architecture Design Document 2.1 (JWT dual token), 2.3.2 (anti-enumeration)
- piiEncryptionStrategy 6.2 (login flow)
