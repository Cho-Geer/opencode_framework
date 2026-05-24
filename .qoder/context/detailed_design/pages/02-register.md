# Registration Page (RegisterPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Registration Page |
| **Route Path** | `/auth/register` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Loading** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` |
| **Component** | `RegisterComponent` (`src/app/features/auth/register/register.component.ts`) |
| **Design Basis** | SAD 2.3.1, contract.yaml (auth endpoints), Test Strategy (E2E registration scenarios), piiEncryptionStrategy 6.1 |

## User Roles

- Unauthenticated users (`guestGuard` enforced)

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Path | Strategy |
|---|---|---|
| `guestGuard` | `auth/register` | Authenticated users denied access, redirected to role-specific home page |

## Component Parameters

- No `@Input()` / `@Output()` (standalone full-page component)

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `FormBuilder` | Create step-based reactive forms (`step1Form` contact, `step2Form` code+password+name) |
| `AuthStore` | `isLoading`, `error`, `loginSuccess()`, `setUserProfile()`, `setLoading()`, `setError()` |
| `ApiService` | `registerSendCode()`, `registerComplete()`, `getUserProfile()` |
| `SocketService` | Establish WebSocket connection after successful registration |
| `Router` | Post-registration navigation |
| `RouteResolver` | Static method `getPostLoginRoute(profile.userType)` |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `currentStep` | `1 \| 2` | Step 1: Send verification code (contact input), Step 2: Complete registration (code+password+name) |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | Contact method type |
| `acceptTerms` | `boolean` | Whether terms of service are accepted |
| `countdown` | `number` | Verification code send countdown (60 seconds) |

## API Contract Reference

> **Response envelope**: All successful API responses are wrapped by ResponseInterceptor in a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column below describes only the `data` field internal structure; the outer envelope implicitly applies.

| Method | Endpoint | Request DTO | Response DTO | Auth | Trigger |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/register/send-code` | `RegisterSendCodeDto` (`contact`*, `contactType`*) | `SendCodeResponseDto` (`maskedContact`, `expiresIn`) | No | Step 1 send verification code |
| `POST` | `/v1/auth/register/complete` | `RegisterCompleteDto` (`contact`*, `contactType`*, `code`*, `password`*, `name`*) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | Step 2 complete registration |
| `GET` | `/v1/users/profile` | — | `{id, name, email, phone, userType, createdAt}` | Bearer | Fetch user info after successful registration |

> **Envelope format**: `POST /v1/auth/register/complete` response body follows `statusCode/data/timestamp/requestId` envelope format.

## Auth Backend Mapping

| Controller | File |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

Key backend implementation:
- `registerSendCode()`: Hashes contact+pepper for duplicate check, generates 6-digit code stored in Redis (`VERIFICATION_CODE_TTL=300s`), sends via email service
- `registerComplete()`: Verifies Redis code, rechecks for duplicates, AES-256-GCM encrypts PII, SHA-256 hash index, bcrypt(rounds=12) encrypts password, creates user (three-field storage model)

## Form Validation

| Step | Field | Validation Rules |
|---|---|---|
| Step 1 | `contact` | `contactFormatValidator` (email regex / phone regex) |
| Step 2 | `code` | 6-digit number |
| | `password` | `passwordStrengthValidator` (min 8 chars, uppercase, lowercase, digit, special char) |
| | `confirmPassword` | `passwordMatchValidator` (cross-field validation matching password) |
| | `name` | Non-empty string |

## Interaction Flow

1. User visits `/auth/register`, `guestGuard` checks
2. **Step 1** (`currentStep = 1`): Enter contact (phone/email), select contact type, accept terms → click "Send Code"
3. Call `send-code` endpoint → success shows `maskedContact`, code input appears, button enters 60-second countdown
4. **Step 2** (`currentStep = 2`): Enter verification code + password + confirm password + name → submit
5. Call `register-complete` endpoint → returns JWT
6. `AuthStore.loginSuccess()` → `getUserProfile()` (uses `accessToken` returned from registration endpoint, auto-attached via `AuthInterceptor`, calls `/v1/users/profile`) → `SocketService.connect()` → navigate to role-specific home page
7. Default role after registration: `CUSTOMER`

## Related API Rate Limiting

| Endpoint | Rate Limit Strategy |
|---|---|
| `POST /v1/auth/register/send-code` | 5 times/minute/contact |
| `POST /v1/auth/register/complete` | 10 times/minute/IP |

## Error Handling

| Scenario | HTTP Status Code | Frontend Behavior |
|---|---|---|
| Code expired/invalid | 400 | Prompt to resend verification code |
| Contact already registered | 409 | Prompt existing account, guide to login page |
| Concurrent registration (same contact) | 409 | Prompt existing account |
| Rate limited | 429 | Prompt "too many requests, please try again later" |

## Data Sources

- contract.yaml 1.7.1
- SAD 2.3.1
- piiEncryptionStrategy 6.1 (registration flow)
- Test Strategy (E2E registration scenarios)
- data-architecture 2.2.1 (User three-field storage model)
