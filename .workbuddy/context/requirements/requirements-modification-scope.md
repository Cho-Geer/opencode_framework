# Requirements Modification Scope Checklist (TASK-D1 Output)

## Document Information

| Attribute | Value |
|-----------|-------|
| **Document Version** | 1.0.0 |
| **Created** | 2026-04-21 |
| **Creator** | @Architect (Multi-agent mode TASK-D1) |
| **Status** | Approved, awaiting execution (TASK-D2 ~ D4) |
| **Design Basis** | piiEncryptionStrategy.md (TASK-D1) |

---

## Modification Overview

| ID | Target File | Modification Type | Affected Section | Execution Task |
|----|------------|-------------------|-----------------|----------------|
| M-1 | Security Architecture Design.md | Upgrade | § 5.1.2 Sensitive Data Classification and Encryption Strategy | TASK-D2 |
| M-2 | Security Architecture Design.md | Modify | § 2.1.1 JWT Token Design | TASK-D2 |
| M-3 | Security Architecture Design.md | Add/Confirm | bcrypt work factor | TASK-D2 |
| M-4 | Data Architecture Design.md | Replace | § 2.2.1 User Domain Model (User Prisma Schema) | TASK-D3 |
| M-5 | Data Architecture Design.md | Add row | § Sensitive Data Protection Table (if exists) | TASK-D3 |
| M-6 | API Interface Specification.md | Add section | Auth endpoint definitions | TASK-D4 |

---

## M-1: Security Architecture § 5.1.2 Email Encryption Level Upgrade

**File Path**: `.opencode/context/requirements/Security Architecture Design.md`

**Current Content** (to be removed):
```
| **Email address** | Medium | Application-layer masking | Plaintext storage |
```

**Replace with**:
```
| **Email address** | High | AES-256-GCM full-field encryption + SHA-256 hash index | Three-field storage (masked display / hash index / encrypted ciphertext) |
```

**Modification Rationale**:
- Email as authentication credential for registration and verification code login is equivalent to phone number and should maintain consistent high-level protection
- Complies with GDPR Art.4(1) and PIPL Article 4 classification requirements for personal information
- Prevents direct exposure of user identity in the event of database breach

---

## M-2: Security Architecture § 2.1.1 JWT Payload Remove Email

**File Path**: `.opencode/context/requirements/Security Architecture Design.md`

**Current Content** (to be modified):
```typescript
interface AccessTokenPayload {
  sub: string;          // User ID (subject)
  email: string;        // User email  ← Delete this line
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
  roles: string[];       // User role array
  permissions: string[]; // Fine-grained permissions
  iat: number;           // Issued at
  exp: number;           // Expiration time
  jti: string;           // Token unique identifier
}
```

**Modification Rationale**:
- JWT Payload is Base64-encoded, not encrypted; any token holder can decode and read it
- NIST SP 800-63B § 6.2 Minimization Principle: Tokens should carry only authentication-essential assertions
- GDPR Art.5(1)(c) Data Minimization Principle

---

## M-3: Security Architecture bcrypt Work Factor Confirmation

**File Path**: `.opencode/context/requirements/Security Architecture Design.md`

**Current Status** (contract.yaml already defines rounds=12):

| Location | Current | Target |
|----------|---------|--------|
| contract.yaml § security.data_protection.password_hashing | `bcrypt with salt rounds 12` | ✅ Correct |
| Security Architecture Design.md (if explicitly defining rounds=10) | 10 | 12 |

**Operation**: Search for `rounds.*10` or `work.*factor.*10`, if found change to 12; and add bcrypt rounds explanation in § 5.1.2 table.

**Modification Rationale**:
- OWASP Password Storage Cheat Sheet (2023): bcrypt minimum work factor 10, recommend 12
- rounds=12 approximately 250ms/hash, acceptable for single login, concurrent scenarios require rate limiting protection

---

## M-4: Data Architecture § 2.2.1 User Schema Three-Field Replacement

**File Path**: `.opencode/context/requirements/Data Architecture Design.md`

**Current Content** (to be replaced):
```prisma
model User {
  id           String        @id @default(uuid())
  name         String
  phone        String?       @unique  // ← Remove @unique
  email        String?       @unique  // ← Remove @unique
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
  // Phone three-field (PII encryption, Scheme C v4)
  phone            String?       // Masked display (e.g., 138****5678)
  phoneHash        String?       @unique  // SHA-256(phone + pepper)
  phoneEncrypted   String?       // AES-256-GCM ciphertext
  // Email three-field (PII encryption, Scheme C v4)
  email            String?       // Masked display (e.g., us***@example.com)
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

**Also update ERD diagram** (§ 2.1 User entity field description) phone/email field descriptions.

**Modification Rationale**:
- Eliminates contradiction between `phone @unique` / `email @unique` and encrypted storage
- Plaintext columns store masked values, lacking uniqueness semantics
- Hash columns are deterministic, suitable for unique indexes and exact lookup

---

## M-5: Data Architecture Sensitive Data Protection Table Add Email Row

**File Path**: `.opencode/context/requirements/Data Architecture Design.md`

**Operation**: In the data architecture document, find the sensitive data protection table, if a phone row exists, add a corresponding email row:

| Field | Sensitivity Level | Storage Method | Index Method | Display Method |
|-------|------------------|----------------|--------------|----------------|
| phone | High | AES-256-GCM encryption (phoneEncrypted) | SHA-256 hash (phoneHash @unique) | Masked (phone) |
| email | **High** | **AES-256-GCM encryption (emailEncrypted)** | **SHA-256 hash (emailHash @unique)** | **Masked (email)** |
| password | Highest | bcrypt hash (passwordHash, rounds=12) | None | Display prohibited |

---

## M-6: API Interface Specification Add Auth Endpoints

**File Path**: `.opencode/context/requirements/API Interface Specification.md`

**Current Content** (interface endpoint design table):
```
| Method | Path | Description | Auth | Rate Limit |
| POST | /v1/auth/verification-codes/send  | Send verification code | No | 5/min/email |
| POST | /v1/auth/verification-codes/verify | Verify verification code | No | 10/min/email |
```

**New Content** (append after above table or create new Auth endpoint section):

### Registration Endpoints

| Method | Path | Description | Auth | Rate Limit |
|--------|------|-------------|------|------------|
| POST | `/v1/auth/register/send-code` | Registration step 1: Send verification code | No | 5/min/contact |
| POST | `/v1/auth/register/complete` | Registration step 2: Submit code + password | No | 10/min/IP |

### Login Endpoints

| Method | Path | Description | Auth | Rate Limit |
|--------|------|-------------|------|------------|
| POST | `/v1/auth/login/send-code` | Verification code login step 1: Send verification code | No | 5/min/contact |
| POST | `/v1/auth/login/verify-code` | Verification code login step 2: Verify and get token | No | 10/min/contact |
| POST | `/v1/auth/login/password` | Password login | No | 5/min/contact |

**Also add the following DTO definitions** (see contract.yaml § pii_encryption_contract.auth_endpoints):
- `RegisterSendCodeDto`
- `RegisterCompleteDto`
- `LoginSendCodeDto`
- `LoginVerifyCodeDto`
- `LoginPasswordDto`

**Modification Rationale**:
- Registration and login are core business flows; API specification is missing these endpoint definitions
- Once added, Coder-BE can implement directly based on this specification without guessing interface design

---

## Modification Execution Order (DAG)

```
TASK-D1 (completed) ───┬─► TASK-D2 (Security Architecture) ───┐
                        │                                      ├─► TASK-D4 (API Specification) ─► TASK-D5 (Review) ─► TASK-D6 (Lock)
                        └─► TASK-D3 (Data Architecture) ───────┘
```

- **TASK-D2 and TASK-D3 execute in parallel** (no mutual dependency)
- **TASK-D4 executes after D2+D3 complete** (API specification references security/data architecture definitions)
- **TASK-D5**: @Guardian reviews all modified documents
- **TASK-D6**: @Orchestrator contract lock, update contract.yaml hashes

---

*This document is one of the TASK-D1 final outputs, used together with piiEncryptionStrategy.md and contract.yaml.*
