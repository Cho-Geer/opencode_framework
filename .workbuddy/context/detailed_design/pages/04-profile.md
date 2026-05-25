# Profile Page (ProfilePage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Profile Page |
| **Route Path** | `/profile` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Load** | `features/profile/profile.routes.ts` → `PROFILE_ROUTES` |
| **Component** | `ProfileComponent` (`src/app/features/profile/profile.component.ts`) |
| **Design Basis** | contract.yaml `users.get_profile` / `update_profile` |

## User Role

- CUSTOMER, ADMIN, SUPER_ADMIN (protected by `authGuard`)

## Route Parameters

- No route parameters
- No query parameters

## Route Guards

| Guard | Strategy |
|---|---|
| `authGuard` | Unauthenticated → redirect `/auth/login?returnUrl=/profile` |

## Component Parameters

- No `@Input()` / `@Output()`

## Injected Services & State Management

| Service/Store | Purpose |
|---|---|
| `AuthStore` | `currentUser()`, `isLoading`, `error`, `setUserProfile()` |
| `ApiService` | `updateProfile()` |

## Local Signals

| Signal | Type | Description |
|---|---|---|
| `isEditing` | `boolean` | Edit mode toggle |
| `editName` | `string` | Name input being edited |
| `saveError` | `string \| null` | Save failure error message |
| `isSaving` | `boolean` | Saving state |
| `passwordDialogVisible` | `boolean` | Change password dialog display state |
| `avatarInitials` | `string` (computed) | Avatar letter initials generated from user name |

## API Contract Mapping

| Method | Endpoint | Request | Response | Auth | Call Timing |
|---|---|---|---|---|---|
| `GET` | `/v1/users/profile` | — | `{id, name, email(masked), phone?(masked), userType, status, createdAt}` | Bearer | Page initialization (data already available via AuthStore) |
| `PUT` | `/v1/users/profile` | `{name?: string}` | `{ user: { id, name, email, phone, userType, status, createdAt } }` | Bearer | Save edits |
| `PUT` | `/v1/users/profile/password` | `{currentPassword*, newPassword*}` | `{message}` | Bearer | Change password dialog submission |

**Note**: `PUT /v1/users/profile` → `UsersController.updateProfile()`, includes ownership validation, only allows users to modify their own profile. Request body only allows the `name` field; email/phone cannot be modified via this endpoint. Backend `ProfileResponseDto` includes masked email/phone.
**Change Password**: `PUT /v1/users/profile/password` → `UsersController.updatePassword()`, requires old password verification, only allows changing own password.

## Local Store Signals (AuthStore)

| Signal | Type | Description |
|---|---|---|
| `user` | `User \| null` | Current user (PII masked) |
| `isAuthenticated` | `boolean` (computed) | Authentication state |
| `currentUser` | `User \| null` (computed) | Alias for `user` |

## Interaction Flow

1. Visit `/profile`; `authGuard` checks authentication
2. Page displays current user info (name, masked email, masked phone, registration time)
3. Non-edit mode: info display only, avatar shows name initials
4. Click "Edit" → `isEditing = true`, name becomes editable input field
5. Modify name → click "Save" → `api.updateProfile({ name })` → update `AuthStore`
6. Click "Change Password" → `passwordDialogVisible = true` (dialog component)
7. API maps to backend `UsersController.updatePassword()` (includes ownership validation)

## Data Masking

- `email` field returned by backend already masked (e.g., `us***@example.com`)
- `phone` field returned by backend already masked (e.g., `138****5678`)
- JWT payload does not contain PII (NIST SP 800-63B compliant)

## Data Sources

- contract.yaml 1.7.1 (users.get_profile, users.update_profile, users.update_password)
- Interface Design Specification 2.1 (data masking requirements)
- Security Architecture Design Document 2.1 (JWT payload specification)
- piiEncryptionStrategy 4 (PII three-field model)
