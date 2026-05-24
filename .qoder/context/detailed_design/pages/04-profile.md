# Profile Page (ProfilePage)

## Basic Information

| Field | Value |
|---|---|
| **Page Name** | Profile Page |
| **Route Path** | `/profile` |
| **Layout** | `AppLayoutComponent` |
| **Lazy Loading** | `features/profile/profile.routes.ts` → `PROFILE_ROUTES` |
| **Component** | `ProfileComponent` (`src/app/features/profile/profile.component.ts`) |
| **Design Basis** | contract.yaml `users.get_profile` / `update_profile` |

## User Roles

- CUSTOMER, ADMIN, SUPER_ADMIN (`authGuard` protected)

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
| `editName` | `string` | Name input during editing |
| `saveError` | `string \| null` | Save failure error message |
| `isSaving` | `boolean` | Saving state |
| `passwordDialogVisible` | `boolean` | Change password dialog visibility |
| `avatarInitials` | `string` (computed) | Avatar letter initials generated from user name |

## API Contract Reference

| Method | Endpoint | Request | Response | Auth | Trigger |
|---|---|---|---|---|---|
| `GET` | `/v1/users/profile` | — | `{id, name, email(masked), phone?(masked), userType, status, createdAt}` | Bearer | Page initialization (via existing AuthStore data) |
| `PUT` | `/v1/users/profile` | `{name?: string}` | `{ user: { id, name, email, phone, userType, status, createdAt } }` | Bearer | Save edit |
| `PUT` | `/v1/users/profile/password` | `{currentPassword*, newPassword*}` | `{message}` | Bearer | Change password dialog submission |

**Note**: `PUT /v1/users/profile` → `UsersController.updateProfile()`, includes ownership validation, only allows users to modify their own profile. Request body only allows name field; email/phone cannot be modified via this endpoint. Backend `ProfileResponseDto` contains masked email/phone.
**Change Password**: `PUT /v1/users/profile/password` → `UsersController.updatePassword()`, requires old password verification, only allows changing own password.

## Local Store Signals (AuthStore)

| Signal | Type | Description |
|---|---|---|
| `user` | `User \| null` | Current user (PII masked) |
| `isAuthenticated` | `boolean` (computed) | Authentication state |
| `currentUser` | `User \| null` (computed) | `user` alias |

## Interaction Flow

1. Visit `/profile`, `authGuard` checks authentication
2. Page displays current user information (name, masked email, masked phone, registration date)
3. Non-edit mode: display only, avatar shows name initials
4. Click "Edit" → `isEditing = true`, name becomes editable input field
5. Modify name → click "Save" → `api.updateProfile({ name })` → update `AuthStore`
6. Click "Change Password" → `passwordDialogVisible = true` (dialog component)
7. API maps to backend `UsersController.updatePassword()` (includes ownership validation)

## Data Masking

- `email` field is masked when returned from backend (e.g., `us***@example.com`)
- `phone` field is masked when returned from backend (e.g., `138****5678`)
- JWT payload does not contain PII (NIST SP 800-63B compliant)

## Data Sources

- contract.yaml 1.7.1 (users.get_profile, users.update_profile, users.update_password)
- Interface Design Specification 2.1 (data masking requirements)
- security-architecture 2.1 (JWT payload specification)
- piiEncryptionStrategy 4 (PII three-field model)
