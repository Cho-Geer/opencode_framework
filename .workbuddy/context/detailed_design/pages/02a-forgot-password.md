# Forgot Password Page (ForgotPasswordPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Forgot Password Page |
| **Route Path** | `/auth/forgot-password` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Load** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` (loadComponent) |
| **Component** | `ForgotPasswordComponent` (`src/app/features/auth/forgot-password/forgot-password.component.ts`) |
| **Design Basis** | contract.yaml v1.6.5 (RESET-PW-001, RESET-PW-002), pii_encryption_contract.auth_endpoints |

## User Role

- Unauthenticated users (enforced by `guestGuard`)

## Route Parameters

| Parameter | Type | Source | Description |
|---|---|---|---|
| `returnUrl` | `string` | Query params | Navigate back to login page after successful reset, with return address |

## Route Guards

| Guard | Path | Strategy |
|---|---|---|
| `guestGuard` | `auth/forgot-password` | Authenticated users denied access, redirected to role-specific home page |

## Component Parameters

- No `@Input()` / `@Output()` (standalone full-page component)

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `FormBuilder` | Create reactive forms (`sendCodeForm`, `resetPasswordForm`) |
| `AuthStore` | Auth state management: `isLoading`, `error`, `setLoading()`, `setError()` |
| `ApiService` | HTTP API calls (`sendResetPasswordCode()`, `verifyAndResetPassword()`) |
| `Router` | Navigate back to `/auth/login` after successful reset |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `step` | `1 \| 2` | Step 1: Send verification code, Step 2: Verify code and reset password |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | Contact method type |
| `contact` | `string` | Contact info entered by user |
| `countdown` | `number` | Verification code send countdown (60 seconds) |
| `showAntiEnumMessage` | `boolean` | Generic anti-enumeration message (always returns 200 even if user does not exist) |
| `resetSuccess` | `boolean` | Password reset success status (shows success message + button to navigate to login page) |

## API Contract Mapping

| Method | Endpoint | Request DTO | Response DTO | Auth | Call Timing |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/reset-password/send-code` | `ResetPasswordSendCodeDto` (`contact`, `contactType`) | `SendCodeResponseDto` (`expiresIn`) | No | Step 1: Send verification code |
| `POST` | `/v1/auth/reset-password/verify` | `ResetPasswordVerifyDto` (`contact`, `contactType`, `code`, `newPassword`) | `{message}` | No | Step 2: Verify code and reset password |

## Auth Backend Mapping

| Controller | File |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

Key backend implementation:
- `resetPasswordSendCode()`: Anti-enumeration strategy (always returns 200 regardless of whether user exists); only sends code to ACTIVE users
- `resetPasswordVerify()`: Redis verification code TTL=300s; after verification, updates `passwordHash` (bcrypt rounds=12) and revokes all Refresh Tokens (forces re-login)

## Form Validation

| Form | Field | Validation Rules |
|---|---|---|
| `sendCodeForm` | `contact` | `contactFormatValidator` (email regex / phone regex) |
| `resetPasswordForm` | `code` | 6-digit number |
| | `newPassword` | `passwordStrengthValidator` (min 8 chars, uppercase, lowercase, digit, special char) |
| | `confirmPassword` | Must match `newPassword` |

## Interaction Flow

1. User visits `/auth/forgot-password`; `guestGuard` checks authentication and grants access if not logged in
2. **Step 1**: User enters contact info (email or phone), selects `contactType`
3. Click "Send Code" → calls `POST /v1/auth/reset-password/send-code`
4. Backend anti-enumeration: always returns 200 regardless of whether user exists (prevents user enumeration attacks)
5. After code sent: 60-second countdown, button disabled
6. **Step 2**: User enters received 6-digit code, new password, confirm password
7. Click "Reset Password" → calls `POST /v1/auth/reset-password/verify`
8. **Success** → `resetSuccess = true`, show success message + "Back to Login" button → navigate to `/auth/login`
9. **Failure** → show error message (code expired / user does not exist)

## Security Notes

| Mechanism | Description |
|---|---|
| Anti user enumeration | `send-code` endpoint always returns 200 regardless of whether user exists, preventing attackers from determining user existence via API responses |
| Verification code TTL | Stored in Redis, 300-second expiry, one-time use |
| Token revocation | After successful password reset, backend revokes all Refresh Tokens for that user, forcing re-login on all devices |
| Rate limiting | `send-code`: 5 requests/min/contact; `verify`: 10 requests/min/contact |

## Related API Rate Limiting

| Endpoint | Rate Limit Policy |
|---|---|
| `POST /v1/auth/reset-password/send-code` | 5 requests/min/contact |
| `POST /v1/auth/reset-password/verify` | 10 requests/min/contact |

## Data Sources

- contract.yaml 1.7.1 (RESET-PW-001, RESET-PW-002)
- pii_encryption_contract.auth_endpoints (reset_password_send_code, reset_password_verify)
- Security Architecture Design Document 2.3.2 (anti-enumeration strategy)
- piiEncryptionStrategy 6.x (password reset flow)
