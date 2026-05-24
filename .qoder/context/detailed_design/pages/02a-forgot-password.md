# Forgot Password Page (ForgotPasswordPage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Forgot Password Page |
| **Route Path** | `/auth/forgot-password` |
| **Layout** | No layout shell (Standalone page) |
| **Lazy Loading** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` (loadComponent) |
| **Component** | `ForgotPasswordComponent` (`src/app/features/auth/forgot-password/forgot-password.component.ts`) |
| **Design Basis** | contract.yaml v1.6.5 (RESET-PW-001, RESET-PW-002), pii_encryption_contract.auth_endpoints |

## User Roles

- Unauthenticated users (`guestGuard` enforced)

## Route Parameters

| Parameter | Type | Source | Description |
|---|---|---|---|
| `returnUrl` | `string` | Query params | After successful reset, navigate back to login page with return address |

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
| `contact` | `string` | User-entered contact |
| `countdown` | `number` | Verification code send countdown (60 seconds) |
| `showAntiEnumMessage` | `boolean` | Anti-enumeration generic message (returns 200 even if user doesn't exist) |
| `resetSuccess` | `boolean` | Password reset success state (shows success message + navigate to login button) |

## API Contract Reference

| Method | Endpoint | Request DTO | Response DTO | Auth | Trigger |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/reset-password/send-code` | `ResetPasswordSendCodeDto` (`contact`, `contactType`) | `SendCodeResponseDto` (`expiresIn`) | No | Step 1: Send verification code |
| `POST` | `/v1/auth/reset-password/verify` | `ResetPasswordVerifyDto` (`contact`, `contactType`, `code`, `newPassword`) | `{message}` | No | Step 2: Verify code and reset password |

## Auth Backend Mapping

| Controller | File |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

Key backend implementation:
- `resetPasswordSendCode()`: Anti-enumeration strategy (returns 200 regardless of whether user exists), only sends code for ACTIVE users
- `resetPasswordVerify()`: Redis verification code TTL=300s, after verification updates `passwordHash` (bcrypt rounds=12), simultaneously revokes all Refresh Tokens (forces re-login on all devices)

## Form Validation

| Form | Field | Validation Rules |
|---|---|---|
| `sendCodeForm` | `contact` | `contactFormatValidator` (email regex / phone regex) |
| `resetPasswordForm` | `code` | 6-digit number |
| | `newPassword` | `passwordStrengthValidator` (min 8 chars, uppercase, lowercase, digit, special char) |
| | `confirmPassword` | Must match `newPassword` |

## Interaction Flow

1. User visits `/auth/forgot-password`, `guestGuard` checks not logged in and allows access
2. **Step 1**: User enters contact (email or phone), selects `contactType`
3. Click "Send Code" → calls `POST /v1/auth/reset-password/send-code`
4. Backend anti-enumeration: returns 200 regardless of whether user exists (prevents user enumeration attacks)
5. After code sent: 60-second countdown, button disabled
6. **Step 2**: User enters received 6-digit code, new password, confirm password
7. Click "Reset Password" → calls `POST /v1/auth/reset-password/verify`
8. **Success** → `resetSuccess = true`, shows success message + "Back to Login" button → navigate `/auth/login`
9. **Failure** → shows error message (code expired / user not found)

## Security Notes

| Mechanism | Description |
|---|---|
| Anti-user enumeration | `send-code` endpoint returns 200 regardless of whether user exists, prevents attackers from determining user existence via API response |
| Verification code TTL | Stored in Redis, expires in 300 seconds, single-use |
| Token revocation | After successful password reset, backend revokes all user's Refresh Tokens, forcing re-login on all devices |
| Rate limiting | `send-code`: 5 times/minute/contact; `verify`: 10 times/minute/contact |

## Related API Rate Limiting

| Endpoint | Rate Limit Strategy |
|---|---|
| `POST /v1/auth/reset-password/send-code` | 5 times/minute/contact |
| `POST /v1/auth/reset-password/verify` | 10 times/minute/contact |

## Data Sources

- contract.yaml 1.7.1 (RESET-PW-001, RESET-PW-002)
- pii_encryption_contract.auth_endpoints (reset_password_send_code, reset_password_verify)
- security-architecture 2.3.2 (anti-enumeration strategy)
- piiEncryptionStrategy 6.x (password reset flow)
