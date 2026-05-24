# Requirements Modification Scope List (TASK-D1 Output)

## Document Information

| Attribute | Value |
|------|---|
| **Document Version** | 1.0.0 |
| **Creation Date** | 2026-04-21 |
| **Author** | @Architect (Multi-Agent Mode TASK-D1) |
| **Status** | Approved, awaiting execution (TASK-D2 ~ D4) |
| **Design Basis** | piiEncryptionStrategy.md (TASK-D1) |

---

## Modification Overview

| ID | Target File | Modification Type | Affected Section | Execution Task |
|------|---------|---------|---------|---------|
| M-1 | security-architecture.md | Upgrade | § 5.1.2 Sensitive Data Classification and Encryption Strategy | TASK-D2 |
| M-2 | security-architecture.md | Modify | § 2.1.1 JWT Token Design | TASK-D2 |
| M-3 | security-architecture.md | Add/Confirm | bcrypt work factor | TASK-D2 |
| M-4 | data-architecture.md | Replace | § 2.2.1 User Domain Model (User Prisma Schema) | TASK-D3 |
| M-5 | data-architecture.md | Add row | § Sensitive Data Protection Table (if exists) | TASK-D3 |
| M-6 | api-design-specification.md | Add section | Auth Endpoint Definitions | TASK-D4 |

---

## M-1: Security Architecture § 5.1.2 Email Encryption Level Upgrade

**File Path**: `.qoder/context/requirements/security-architecture.md`

**Current Content** (to be removed):
```
| **Email Address** | Medium | Application-layer masking | Plaintext storage |
```

**Replace with**:
```
| **Email Address** | High | AES-256-GCM full-field encryption + SHA-256 hash index | Three-field storage (masked display/hash index/encrypted ciphertext) |
```

**Modification Rationale**:
- Email serves as an authentication credential for registration and verification code login, equivalent to phone number, and should maintain the same high-level protection
- Compliant with GDPR Art.4(1) and PIPL Article 4 classification requirements for personal information
- Prevents direct exposure of user identity in case of database breach

---

## M-2: Security Architecture § 2.1.1 JWT Payload Remove email

**File Path**: `.qoder/context/requirements/security-architecture.md`

**Current Content** (to be modified):
```typescript
interface AccessTokenPayload {
  sub: string;          // User ID (subject)
  email: string;        // User email  ← remove this line
  roles: string[];
  permissions: string[];
  iat: number;
  exp: number;
  jti: string;
}
```

**Replace with** (remove `email: string;` line and its comment):
```typescript
interface AccessTokenPayload {
  sub: string;           // User ID (subject)
  roles: string[];       // User roles array
  permissions: string[]; // Fine-grained permissions
  iat: number;           // Issued at
  exp: number;           // Expiration time
  jti: string;           // Token unique identifier
}
```

**Modification Rationale**:
- JWT Payload is Base64 encoded, not encrypted; any party holding the token can decode and read it
- NIST SP 800-63B § 6.2 minimization principle: tokens should carry only assertions required for authentication
- GDPR Art.5(1)(c) data minimization principle

---

## M-3: Security Architecture bcrypt Work Factor Confirmation

**File Path**: `.qoder/context/requirements/security-architecture.md`

**Current Status** (contract.yaml already defines rounds=12):

| Location | Current Value | Target Value |
|-----|-------|-------|
| contract.yaml § security.data_protection.password_hashing | `bcrypt with salt rounds 12` | ✅ Already correct |
| security-architecture.md (if explicitly defines rounds=10) | 10 | 12 |

**Action**: Search for `rounds.*10` or `work.*factor.*10`; if found, change to 12; also supplement bcrypt rounds description in the § 5.1.2 table.

**Modification Rationale**:
- OWASP Password Storage Cheat Sheet (2023): bcrypt minimum work factor 10, recommended 12
- rounds=12 ≈ 250ms/hash, acceptable for single login; concurrent scenarios require rate limiting protection

---

## M-4: Data Architecture § 2.2.1 User Schema Three-Field Replacement

**File Path**: `.qoder/context/requirements/data-architecture.md`

**Current Content** (to be replaced):
```prisma
model User {
  id           String        @id @default(uuid())
  name         String
  phone        String?       @unique  // ← remove @unique
  email        String?       @unique  // ← remove @unique
  ...
  @@index([phone])
  @@index([email])
}
```

**Replace with** (three-field model):
```prisma
model User {
  id               String        @id @default(uuid())
  name             String
  // Phone three-field (PII encryption, Plan C v4)
  phone            String?       // Masked display (e.g. 138****5678)
  phoneHash        String?       @unique  // SHA-256(phone + pepper)
  phoneEncrypted   String?       // AES-256-GCM ciphertext
  // Email three-field (PII encryption, Plan C v4)
  email            String?       // Masked display (e.g. us***@example.com)
  emailHash        String?       @unique  // SHA-256(email + pepper)
  emailEncrypted   String?       // AES-256-GCM ciphertext
  // Password
  passwordHash     String?       // bcrypt hash (rounds=12)
  ...
  @@index([phoneHash])
  @@index([emailHash])
  @@index([userType, status])
  @@index([createdAt])
  @@index([lastLoginAt], where: raw("\"status\" = 'ACTIVE'"))
}
```

**Also update the ERD diagram** (§ 2.1 User entity field descriptions) phone/email field descriptions.

**Modification Rationale**:
- Eliminates the contradiction between `phone @unique` / `email @unique` and encrypted storage
- Plaintext column stores masked values and does not have uniqueness semantics
- Hash column is deterministic and suitable for unique indexes and exact lookups

---

## M-5: Data Architecture Sensitive Data Protection Table — Add email Row

**File Path**: `.qoder/context/requirements/data-architecture.md`

**Action**: Find the sensitive data protection table in the data architecture document; if a phone row exists, add the corresponding email row:

| Field | Sensitivity Level | Storage Method | Index Method | Display Method |
|-----|---------|---------|---------|---------|
| phone | High | AES-256-GCM encryption (phoneEncrypted) | SHA-256 hash (phoneHash @unique) | Masked (phone) |
| email | **High** | **AES-256-GCM encryption (emailEncrypted)** | **SHA-256 hash (emailHash @unique)** | **Masked (email)** |
| password | Highest | bcrypt hash (passwordHash, rounds=12) | None | Display prohibited |

---

## M-6: API Design Specification — Add Auth Endpoints

**File Path**: `.qoder/context/requirements/api-design-specification.md`

**Current Content** (endpoint design table):
```
| Method | Path | Description | Auth | Rate Limit |
| POST | /v1/auth/verification-codes/send  | Send verification code | No | 5/min/email |
| POST | /v1/auth/verification-codes/verify | Verify verification code | No | 10/min/email |
```

**New Content** (append after above table or create new Auth Endpoints section):

### Registration Endpoints

| Method | Path | Description | Auth | Rate Limit |
|------|------|------|------|------|
| POST | `/v1/auth/register/send-code` | Registration step 1: Send verification code | No | 5/min/contact |
| POST | `/v1/auth/register/complete` | Registration step 2: Submit verification code + password | No | 10/min/IP |

### Login Endpoints

| Method | Path | Description | Auth | Rate Limit |
|------|------|------|------|------|
| POST | `/v1/auth/login/send-code` | Verification code login step 1: Send code | No | 5/min/contact |
| POST | `/v1/auth/login/verify-code` | Verification code login step 2: Verify and obtain tokens | No | 10/min/contact |
| POST | `/v1/auth/login/password` | Password login | No | 5/min/contact |

**Also add the following DTO definitions** (refer to contract.yaml § pii_encryption_contract.auth_endpoints):
- `RegisterSendCodeDto` 
- `RegisterCompleteDto`
- `LoginSendCodeDto`
- `LoginVerifyCodeDto`
- `LoginPasswordDto`

**Modification Rationale**:
- Registration and login are core business flows; the API design specification document is missing these endpoint definitions
- Once supplemented, Coder-BE can implement directly based on this specification without guessing the API design

---

## Modification Execution Order (DAG)

```
TASK-D1 (completed) ────┬─► TASK-D2 (Security Architecture) ────┐
                         │                                        ├─► TASK-D4 (API Specification) ─► TASK-D5 (Audit) ─► TASK-D6 (Lock)
                         └─► TASK-D3 (Data Architecture) ─────────┘
```

- **TASK-D2 and TASK-D3 execute in parallel** (no mutual dependencies)
- **TASK-D4 executes after D2+D3 completion** (API specification references security/data architecture definitions)
- **TASK-D5**: @Guardian audits all modified documents
- **TASK-D6**: @Orchestrator contract lock, updates contract.yaml hash

---

*This document is one of the final outputs of TASK-D1, to be used together with piiEncryptionStrategy.md and contract.yaml.*
