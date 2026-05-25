# Register Page (RegisterPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Register Page |
| **Route Path** | `/auth/register` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Load** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` |
| **Component** | `RegisterComponent` (`src/app/features/auth/register/register.component.ts`) |
| **Design Basis** | SAD 2.3.1, contract.yaml (auth endpoints), Test Strategy (E2E registration scenario), piiEncryptionStrategy 6.1 |

## User Role

- Unauthenticated users (enforced by `guestGuard`)

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
| `FormBuilder` | Create step-based reactive forms (`step1Form` contact info, `step2Form` code+password+name) |
| `AuthStore` | `isLoading`, `error`, `loginSuccess()`, `setUserProfile()`, `setLoading()`, `setError()` |
| `ApiService` | `registerSendCode()`, `registerComplete()`, `getUserProfile()` |
| `SocketService` | Establish WebSocket connection after successful registration |
| `Router` | Navigate after registration |
| `RouteResolver` | Static method `getPostLoginRoute(profile.userType)` |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `currentStep` | `1 \| 2` | Step 1: Send verification code (contact input), Step 2: Complete registration (code+password+name) |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | Contact method type |
| `acceptTerms` | `boolean` | Whether terms of service are accepted |
| `countdown` | `number` | Verification code send countdown (60 seconds) |

## API Contract Mapping

> **Response envelope**: All successful API responses are wrapped by ResponseInterceptor into a unified envelope format `{ statusCode, message, data, timestamp, requestId }`. The "Response" column in the table below only describes the internal structure of the `data` field; the envelope outer layer applies implicitly.

| Method | Endpoint | Request DTO | Response DTO | Auth | Call Timing |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/register/send-code` | `RegisterSendCodeDto` (`contact`*, `contactType`*) | `SendCodeResponseDto` (`maskedContact`, `expiresIn`) | No | Step 1: Send verification code |
| `POST` | `/v1/auth/register/complete` | `RegisterCompleteDto` (`contact`*, `contactType`*, `code`*, `password`*, `name`*) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | Step 2: Complete registration |
| `GET` | `/v1/users/profile` | — | `{id, name, email, phone, userType, createdAt}` | Bearer | Fetch user info after successful registration |

> **Envelope format**: `POST /v1/auth/register/complete` response body follows `statusCode/data/timestamp/requestId` envelope format.

## Auth Backend Mapping

| Controller | File |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

Key backend implementation:
- `registerSendCode()`: Hash contact + pepper for deduplication, generate 6-digit code stored in Redis (`VERIFICATION_CODE_TTL=300s`), send via email service
- `registerComplete()`: Verify Redis code, re-check deduplication, AES-256-GCM encrypt PII, SHA-256 hash index, bcrypt(rounds=12) encrypt password, create user (three-field storage model)

## Form Validation

| Step | Field | Validation Rules |
|---|---|---|
| Step 1 | `contact` | `contactFormatValidator` (email regex / phone regex) |
| Step 2 | `code` | 6-digit number |
| | `password` | `passwordStrengthValidator` (min 8 chars, uppercase, lowercase, digit, special char) |
| | `confirmPassword` | `passwordMatchValidator` (cross-field validation matching `password`) |
| | `name` | Non-empty string |

## Interaction Flow

1. User visits `/auth/register`; `guestGuard` checks
2. **Step 1** (`currentStep = 1`): Enter contact info (phone/email), select contact type, check accept terms → click "Send Code"
3. Call `send-code` endpoint → on success display `maskedContact`, verification code input appears, button enters 60-second countdown
4. **Step 2** (`currentStep = 2`): Enter verification code + password + confirm password + name → submit
5. Call `register-complete` endpoint → returns JWT
6. `AuthStore.loginSuccess()` → `getUserProfile()` (using `accessToken` returned by register endpoint, automatically attached by `AuthInterceptor`, calling `/v1/users/profile`) → `SocketService.connect()` → navigate to role-specific home page
7. Default post-registration role: `CUSTOMER`

## Related API Rate Limiting

| Endpoint | Rate Limit Policy |
|---|---|
| `POST /v1/auth/register/send-code` | 5 requests/min/contact |
| `POST /v1/auth/register/complete` | 10 requests/min/IP |

## Error Handling

| Scenario | HTTP Status Code | Frontend Behavior |
|---|---|---|
| Code expired/invalid | 400 | Prompt to resend verification code |
| Contact already registered | 409 | Prompt that account exists, guide to login page |
| Concurrent registration (same contact) | 409 | Prompt that account exists |
| Rate limited | 429 | Prompt that operation is too frequent, try again later |

## Data Sources

- contract.yaml 1.7.1
- SAD 2.3.1
- piiEncryptionStrategy 6.1 (registration flow)
- Test Strategy (E2E registration scenario)
- Data Architecture Design Document 2.2.1 (User three-field storage model)
