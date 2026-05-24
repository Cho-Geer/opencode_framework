# PII Encryption Strategy Design Document (Scheme C v4)

## Document Information

| Attribute | Value |
|-----------|-------|
| **Document Version** | 1.0.0 |
| **Created** | 2026-04-21 |
| **Last Updated** | 2026-04-21 |
| **Status** | Baseline established |
| **Author** | @Architect (Multi-agent mode TASK-D1) |
| **Related Task** | TASK-D1: PII Encryption Strategy Design + Prerequisite for Requirements Modification |

---

## 1. Background and Objectives

This document serves as the Architecture Decision Record (ADR) for **Scheme C v4** (PII field-level encryption), providing the sole technical basis for subsequent modifications to six requirements documents.

### 1.1 Driving Requirements

The business constraints for registration/login flow are:

- **Registration**: Must first receive a verification code via phone or email (mandatory), then set a password (mandatory)
- **Login**: Supports two methods — (A) verification code login, (B) password login, choose one

These constraints imply:
1. `phone` or `email` must support **exact lookup** (verification code delivery target)
2. Simultaneously require **uniqueness guarantee** (prevent duplicate registration)
3. Simultaneously require **confidentiality** (storage must not expose plaintext PII)

The above three constraints are mutually contradictory and must be resolved through the **three-field model**.

---

## 2. Three-Field Model Design

### 2.1 Field Definition

Each PII field (phone, email) is split into three physical columns:

| Logical Concept | Physical Column | Stored Content | Purpose |
|----------------|-----------------|---------------|---------|
| Masked display | `phone` / `email` | Middle-segment masked string | Frontend display (e.g., `138****5678`) |
| Uniqueness hash | `phoneHash` / `emailHash` | SHA-256(original + pepper) | Unique index + exact lookup |
| Encrypted ciphertext | `phoneEncrypted` / `emailEncrypted` | AES-256-GCM ciphertext | Decrypt to restore original (when compliance requires) |

### 2.2 Lookup Flow

```
User inputs original phone/email
  │
  ├─► SHA-256(input + PEPPER) → hash
  │     └─► WHERE phoneHash = hash   (exact match, O(1) index query)
  │
  └─► Record found, decrypt phoneEncrypted → original (authorized scenarios only)
```

### 2.3 Uniqueness Constraint

```prisma
// Scheme: Remove @unique constraint (plaintext column lacks uniqueness semantics)
// Instead, create unique index on hash columns
phoneHash       String?  @unique  // SHA-256(phone + pepper)
emailHash       String?  @unique  // SHA-256(email + pepper)
```

**Rationale**: Plaintext columns store masked strings, unsuitable for @unique; hash columns are deterministic with negligible collision probability (2^256), suitable for unique indexes.

---

## 3. Email Encryption Level Upgrade Decision

### 3.1 Current State (Deviation)

```
Security Architecture Design § 5.1.2 Current definition:
  Email address | Medium | Application-layer masking | Plaintext storage
```

### 3.2 Upgrade Rationale

| Consideration | Analysis |
|--------------|----------|
| **Business Function** | Email is used for verification code login, serves as authentication credential, equally important as phone number |
| **GDPR/PIPL** | Email addresses are explicitly classified as personal information under GDPR Art.4(1) and PIPL Article 4 |
| **Data Breach Risk** | Plaintext-stored emails, if database is breached, can directly lead to user identification and phishing attacks |
| **Symmetry Principle** | Phone is already defined as "High/AES-256-GCM", email as equivalent authentication method should be consistent |
| **OWASP TOP 10** | A02:2021 Cryptographic Failures requires encryption protection for PII |

### 3.3 Upgrade Conclusion

**Email Sensitivity Level: Medium → High**
**Encryption Strategy: Application-layer masking → AES-256-GCM full-field encryption (consistent with phone)**

---

## 4. JWT Payload Design

### 4.1 Current State (Deviation)

```typescript
// Security Architecture Design § 2.1.1 Current definition
interface AccessTokenPayload {
  sub: string;     // User ID
  email: string;   // ← Problem: JWT is not encrypted by default, email exposed in plaintext
  roles: string[];
  ...
}
```

### 4.2 Rationale for Removing Email Field

| Basis | Explanation |
|-------|-------------|
| **JWT Not Encrypted** | JWT is only signed (HMAC-SHA256), Payload is Base64-encoded, any token holder can decode and read it |
| **Minimization Principle** | NIST SP 800-63B § 6.2: "Tokens should contain only the minimum assertions needed to complete the operation" |
| **GDPR Data Minimization** | GDPR Art.5(1)(c): "Personal data processing should be limited to what is necessary for the processing purpose" |
| **Functional Redundancy** | If business layer needs email, it can query database via `sub` (userId), no need to carry it in token |

### 4.3 Modified Payload Design

```typescript
// Modified: Remove email, retain authentication-essential fields
interface AccessTokenPayload {
  sub: string;           // User ID (unique identifier)
  roles: string[];       // User role array
  permissions: string[]; // Fine-grained permissions (optional, retained as needed)
  iat: number;           // Issued at
  exp: number;           // Expiration time
  jti: string;           // Token unique identifier (supports blacklist)
}
```

---

## 5. Password Hash Parameters

### 5.1 bcrypt Work Factor

| Parameter | Current | Target | Basis |
|-----------|---------|--------|-------|
| `bcrypt rounds` | 10 | **12** | OWASP Password Storage Cheat Sheet (2023) § bcrypt: "minimum work factor of 10, recommend 12" |

### 5.2 Impact Analysis

| Metric | rounds=10 | rounds=12 | Notes |
|--------|-----------|-----------|-------|
| Hash time | ~65ms | ~250ms | Acceptable range, single login acceptable |
| Brute-force cost | Baseline | 4× | 2^2 times computation increase |
| Server CPU | Baseline | 4× | Concurrent login scenarios require load testing |

**Conclusion**: rounds=12 is the optimal balance between security and performance, complying with OWASP 2023 best practices.

---

## 6. Verification Code Flow Specification

### 6.1 Registration Flow (Two-Step Mandatory)

```
Step 1: Send verification code
  POST /v1/auth/register/send-code
  Body: { contact: string, contactType: 'phone' | 'email' }
  → Redis storage: key=verify:{contactHash}, value={code, type:'REGISTER', expireAt}, TTL=5min

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
  → Verify code → Return JWT dual tokens

Method B - Password login:
  POST /v1/auth/login/password
  Body: { contact, contactType, password }
  → Find user (via hash) → bcrypt.compare → Return JWT dual tokens
```

---

## 7. Encryption Key Management

### 7.1 Key System

| Key Name | Purpose | Storage Location | Rotation Period |
|----------|---------|-----------------|----------------|
| `PII_ENCRYPTION_KEY` | AES-256-GCM encrypt/decrypt PII fields | Environment variable / K8s Secret | Annually |
| `PII_HASH_PEPPER` | SHA-256 hash pepper value | Environment variable / K8s Secret | Permanent (immutable once set) |
| `JWT_ACCESS_SECRET` | Access Token signing | Environment variable / K8s Secret | Every 90 days |
| `JWT_REFRESH_SECRET` | Refresh Token signing | Environment variable / K8s Secret | Every 90 days |

### 7.2 Hash Pepper Immutability

`PII_HASH_PEPPER` **cannot be rotated**. Reason: Once changed, all stored hash values become invalid, and users will be unable to log in. If a change is required, a full migration must be performed (decrypt all `*Encrypted` fields → recalculate hashes).

---

## 8. Migration Compatibility Notes

If the existing database already contains plaintext phone/email data, migration steps:

1. Add `phoneHash`, `phoneEncrypted`, `emailHash`, `emailEncrypted`, `passwordHash` columns to User table
2. Bulk read existing phone/email → calculate hash + encrypt → write to new columns
3. Change `phone` / `email` columns to store masked values (or leave empty)
4. Remove `phone @unique` / `email @unique` → add `phoneHash @unique` / `emailHash @unique`

---

## 9. Requirements Modification Scope Summary

This design serves as the basis for the following six modifications:

| Modification ID | Target File | Modification Summary |
|----------------|-------------|---------------------|
| M-1 | Security Architecture Design.md § 5.1.2 | Email sensitivity level Medium→High, strategy upgrade to AES-256-GCM |
| M-2 | Security Architecture Design.md § 2.1.1 | AccessTokenPayload remove email field |
| M-3 | Data Architecture Design.md § 2.2.1 | User Schema replace with three-field model (+5 new columns, +passwordHash) |
| M-4 | Data Architecture Design.md § 8.1 | Sensitive data protection table add email row |
| M-5 | API Interface Specification.md § Auth endpoints | Add 4 Auth endpoints (2 for registration + 2 for login) |
| M-6 | Security Architecture Design.md (bcrypt) | bcrypt rounds 10 → 12 |

---

*This document is the sole technical basis for requirements modifications. All modifications must remain consistent with this design.*
