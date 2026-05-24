# PII Encryption Strategy Design Document (Plan C v4)

## Document Information

| Attribute | Value |
|------|---|
| **Document Version** | 1.0.0 |
| **Creation Date** | 2026-04-21 |
| **Last Updated** | 2026-04-21 |
| **Document Status** | Baselined |
| **Author** | @Architect (Multi-Agent Mode TASK-D1) |
| **Related Task** | TASK-D1: PII Encryption Strategy Design + Prerequisites for Requirements Modification |

---

## 1. Background and Objectives

This document is the Architecture Decision Record (ADR) for **Plan C v4** (PII field-level encryption), serving as the sole technical basis for the subsequent six requirements document modifications.

### 1.1 Driving Requirements

The business constraints for the registration/login flow are as follows:

- **Registration**: Must first receive a verification code via phone or email (mandatory), then set a password (mandatory)
- **Login**: Supports two methods — (A) verification code login, (B) password login, choose one

These constraints imply:
1. `phone` or `email` must be usable for **exact lookup** (verification code delivery target)
2. **Uniqueness guarantee** is required simultaneously (prevent duplicate registration)
3. **Confidentiality** is required simultaneously (storage must not expose plaintext PII)

The above three constraints are mutually contradictory and must be resolved through the **three-field model**.

---

## 2. Three-Field Model Design

### 2.1 Field Definitions

Each PII field (phone, email) is split into three physical columns:

| Logical Concept | Physical Column Name | Stored Content | Purpose |
|---------|---------|---------|------|
| Masked plaintext display | `phone` / `email` | Middle-segment masked string | Frontend display (e.g. `138****5678`) |
| Uniqueness hash | `phoneHash` / `emailHash` | SHA-256(original + pepper) | Unique index + exact lookup |
| Encrypted ciphertext | `phoneEncrypted` / `emailEncrypted` | AES-256-GCM ciphertext | Decrypt to recover original (for compliance needs) |

### 2.2 Lookup Flow

```
User inputs original phone number/email
  │
  ├─► SHA-256(input + PEPPER) → hash
  │     └─► WHERE phoneHash = hash   (exact match, O(1) index query)
  │
  └─► After finding the record, decrypt phoneEncrypted → original (authorized scenarios only)
```

### 2.3 Uniqueness Constraint

```prisma
// Approach: Remove @unique constraint (plaintext column has no uniqueness semantics)
// Instead, create unique index on hash column
phoneHash       String?  @unique  // SHA-256(phone + pepper)
emailHash       String?  @unique  // SHA-256(email + pepper)
```

**Rationale**: The plaintext column stores masked strings and is not suitable for @unique; the hash column is deterministic with extremely low collision probability (2^256) and is suitable for unique indexes.

---

## 3. Email Encryption Level Upgrade Decision

### 3.1 Current State (Deviation)

```
Security Architecture Design Document § 5.1.2 current definition:
  Email Address | Medium | Application-layer masking | Plaintext storage
```

### 3.2 Upgrade Rationale

| Consideration | Analysis |
|---------|------|
| **Business Function** | Email is used to send verification codes for login, serving as an authentication credential equivalent in importance to phone number |
| **GDPR/PIPL** | Email address is explicitly classified as personal information under GDPR Art.4(1) and PIPL Article 4 |
| **Data Breach Risk** | Plaintext-stored email in a database breach can directly lead to user identification and phishing attacks |
| **Symmetry Principle** | Phone number is already defined as "High/AES-256-GCM"; email as an equivalent authentication method should maintain consistency |
| **OWASP TOP 10** | A02:2021 Cryptographic Failures requires cryptographic protection for PII |

### 3.3 Upgrade Conclusion

**Email sensitivity level: Medium → High**
**Encryption strategy: Application-layer masking → AES-256-GCM full-field encryption (consistent with phone number)**

---

## 4. JWT Payload Design

### 4.1 Current State (Deviation)

```typescript
// Security Architecture Design Document § 2.1.1 current definition
interface AccessTokenPayload {
  sub: string;     // User ID
  email: string;   // ← Problem: JWT is not encrypted by default, email exposed in plaintext
  roles: string[];
  ...
}
```

### 4.2 Rationale for Removing the email Field

| Basis | Explanation |
|------|------|
| **JWT is not encrypted** | JWT is only signed (HMAC-SHA256); the Payload is Base64 encoded, any party holding the token can decode and read it |
| **Minimization principle** | NIST SP 800-63B § 6.2: "Tokens should contain only the minimum assertions needed to complete the operation" |
| **GDPR data minimization** | GDPR Art.5(1)(c): "Processing of personal data shall be limited to what is necessary for the purposes of processing" |
| **Functional redundancy** | If the business layer needs email, it can query the database via `sub` (userId) without carrying it in the token |

### 4.3 Modified Payload Design

```typescript
// Modified: Remove email, retain authentication-essential fields only
interface AccessTokenPayload {
  sub: string;           // User ID (unique identifier)
  roles: string[];       // User roles array
  permissions: string[]; // Fine-grained permissions (optional, retain as needed)
  iat: number;           // Issued at
  exp: number;           // Expiration time
  jti: string;           // Token unique identifier (supports blacklisting)
}
```

---

## 5. Password Hashing Parameters

### 5.1 bcrypt Work Factor

| Parameter | Current Value | Target Value | Basis |
|------|-------|-------|------|
| `bcrypt rounds` | 10 | **12** | OWASP Password Storage Cheat Sheet (2023) § bcrypt: "minimum work factor of 10, recommend 12" |

### 5.2 Impact Analysis

| Metric | rounds=10 | rounds=12 | Notes |
|------|----------|----------|------|
| Hash time | ~65ms | ~250ms | Reasonable range, acceptable for a single login |
| Brute force cost | Baseline | 4× | 2^2 times computational increase |
| Server CPU | Baseline | 4× | Concurrent login scenarios require load testing |

**Conclusion**: rounds=12 is the optimal balance between security and performance, conforming to OWASP 2023 best practices.

---

## 6. Verification Code Flow Specification

### 6.1 Registration Flow (Two-Step Mandatory)

```
Step 1: Send verification code
  POST /v1/auth/register/send-code
  Body: { contact: string, contactType: 'phone' | 'email' }
  → Redis store: key=verify:{contactHash}, value={code, type:'REGISTER', expireAt}, TTL=5min

Step 2: Complete registration
  POST /v1/auth/register/complete
  Body: { contact, contactType, code, password, name }
  → Verify Redis code → Create user (three-field model) → Delete Redis key → Return JWT
```

### 6.2 Login Flow (Choose One)

```
Method A - Verification code login:
  POST /v1/auth/login/send-code
  Body: { contact, contactType }
  → Find user (via hash) → Send verification code

  POST /v1/auth/login/verify-code
  Body: { contact, contactType, code }
  → Code verification → Return JWT dual tokens

Method B - Password login:
  POST /v1/auth/login/password
  Body: { contact, contactType, password }
  → Find user (via hash) → bcrypt.compare → Return JWT dual tokens
```

---

## 7. Encryption Key Management

### 7.1 Key System

| Key Name | Purpose | Storage Location | Rotation Cycle |
|-------|------|---------|---------|
| `PII_ENCRYPTION_KEY` | AES-256-GCM encrypt/decrypt PII fields | Environment variable / K8s Secret | Annually |
| `PII_HASH_PEPPER` | Pepper value for SHA-256 hashing | Environment variable / K8s Secret | Permanent (cannot be changed once set) |
| `JWT_ACCESS_SECRET` | Access Token signing | Environment variable / K8s Secret | Every 90 days |
| `JWT_REFRESH_SECRET` | Refresh Token signing | Environment variable / K8s Secret | Every 90 days |

### 7.2 Hash Pepper Immutability

`PII_HASH_PEPPER` **cannot be rotated**. Reason: once modified, all stored hash values become invalid and users will be unable to log in. If a change is needed, a full migration is required (decrypt all `*Encrypted` fields → recalculate hashes).

---

## 8. Migration Compatibility Notes

If plaintext phone/email data already exists in the database, migration steps:

1. Add `phoneHash`, `phoneEncrypted`, `emailHash`, `emailEncrypted`, `passwordHash` columns to the User table
2. Bulk read existing phone/email → compute hash + encrypt → write to new columns
3. Change `phone` / `email` columns to store masked values (or leave empty)
4. Remove `phone @unique` / `email @unique` → Add `phoneHash @unique` / `emailHash @unique`

---

## 9. Requirements Modification Scope Summary

This design serves as the basis for the following six modifications:

| Modification ID | Target File | Modification Summary |
|---------|---------|------------|
| M-1 | security-architecture.md § 5.1.2 | Email sensitivity level Medium→High, strategy upgraded to AES-256-GCM |
| M-2 | security-architecture.md § 2.1.1 | AccessTokenPayload remove email field |
| M-3 | data-architecture.md § 2.2.1 | User Schema replaced with three-field model (+5 new columns, +passwordHash) |
| M-4 | data-architecture.md § 8.1 | Sensitive data protection table supplement email row |
| M-5 | api-design-specification.md § Auth Endpoints | Supplement 4 Auth endpoints (2 registration + 2 login) |
| M-6 | security-architecture.md (bcrypt) | bcrypt rounds 10 → 12 |

---

*This document is the sole technical basis for requirements modifications; all modifications must remain consistent with this design.*
