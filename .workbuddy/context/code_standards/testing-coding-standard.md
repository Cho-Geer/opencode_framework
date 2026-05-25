# Testing Coding Standard v2.0

> **Version**: 2.0.0
> **Effective Date**: 2026-05-14
> **Author**: @Architect
> **Approved by**: @Arbiter
> **Scope**: booking_system_refactor (backend + frontend + e2e)
> **Previous Version**: v1.0 (2026-04-16)

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [Three-Tier Mock Governance Strategy](#2-three-tier-mock-governance-strategy)
3. [TDD Dual-Speed Strategy](#3-tdd-dual-speed-strategy)
4. [Test Prohibitions (AI Redlines)](#4-test-prohibitions-ai-redlines)
5. [Test Classification and Ratios](#5-test-classification-and-ratios)
6. [Backend Testing Standards (NestJS)](#6-backend-testing-standards-nestjs)
7. [Frontend Testing Standards (Angular)](#7-frontend-testing-standards-angular)
8. [Test Infrastructure](#8-test-infrastructure)
9. [Test Data Management](#9-test-data-management)
10. [Coverage Threshold Matrix](#10-coverage-threshold-matrix)
11. [Advanced Testing Strategies](#11-advanced-testing-strategies)
12. [CI/CD Quality Gates](#12-cicd-quality-gates)
13. [Pre-Commit Hooks](#13-pre-commit-hooks)
14. [Evidence Chain Requirements](#14-evidence-chain-requirements)
15. [Test Review Checklist](#15-test-review-checklist)
16. [Defect Management](#16-defect-management)
17. [Architecture Constraint Rules](#17-architecture-constraint-rules)
18. [ADR: Architecture Decision Records](#18-adr-architecture-decision-records)
19. [Related Documents](#19-related-documents)

---

## 1. Core Principles

### 1.1 The Sole Value of Testing Is to Discover Bugs

Testing is not meant to prove that code works, but to prove that code won't fail. Any test that cannot discover potential defects is wasting CI time and maintenance costs.

### 1.2 TDD Mandatory Iron Rule

All tests must follow the RED → GREEN → REFACTOR cycle:
1. **RED**: Write a failing test case first, defining expected behavior
2. **GREEN**: Write only the minimal code needed to make the test pass
3. **REFACTOR**: Refactor code structure under test protection

### 1.3 Mock Minimization Principle

**"Better to test slower than to test falsely."** Excessive mocking is the number one killer of test quality. This specification adopts a three-tier mock governance strategy (see Section 2) to strictly limit the scope of mock usage.

### 1.4 Test Coverage Priority

| Priority | Module Type | Line Coverage | Branch Coverage | Function Coverage | Mutation Kill Rate | Test Strategy |
|--------|---------|:------:|:--------:|:--------:|:--------:|---------|
| P0 | Core Business Logic (Appointments, Auth, Time Slots, Users) | ≥95% | ≥90% | ≥95% | ≥85% | Unit + Integration + Property + Mutation |
| P1 | Important Service Layer (Notifications, Cache, Rate Limiting, Email, Verification, Translations) | ≥85% | ≥80% | ≥85% | ≥80% | Unit + Integration + Contract |
| P2 | Auxiliary Modules (Health Check, Stats, Service Management, Retention, Encryption, Common Utilities) | ≥75% | ≥70% | ≥75% | — | Primarily Unit Tests |
| P3 | Configuration Classes, Entry Files, DTO Definitions | Exempt | Exempt | Exempt | — | Excluded from Coverage Statistics |

---

## 2. Three-Tier Mock Governance Strategy

### 2.1 Strategy Overview

This strategy defines three-tier mock governance rules, declared by the `x-test-mock-policy` section of `contract.yaml`, enforced by the ESLint mock-audit rule, and subject to final review by @Guardian.

```
┌──────────────────────────────────────────────────────┐
│                 TIER1: REAL-ONLY                      │
│  PrismaService / RedisService / ConfigService         │
│  → Never disable Testcontainers real instances        │
│  → ESLint blocks jest.spyOn on these services         │
├──────────────────────────────────────────────────────┤
│                 TIER2: FAKE-OK                        │
│  JwtService / QueueService / NotificationGateway     │
│  RateLimiterService                                   │
│  → Prioritize test/fakes/ implementations             │
│  → Fake with realistic behavior, observable state,    │
│    no external dependencies                           │
├──────────────────────────────────────────────────────┤
│                 TIER3: BOUNDARY-MOCK                  │
│  EmailService / SMSService / PaymentGateway           │
│  → Mock allowed, but call parameters must be verified │
│  → Each mock must have expect().toHaveBeenCalledWith()│
└──────────────────────────────────────────────────────┘
```

### 2.2 TIER1 — Real Dependencies (Never Disable)

The following services **must** use real Testcontainers instances. `jest.spyOn` or `jest.mock` is **strictly prohibited**:

| Service | Module | Rationale | Test Strategy |
|------|------|------|---------|
| **PrismaService** | `@prisma/client` | Mock hides SQL errors, transaction bugs, constraint violations | Testcontainers PostgreSQL 16 + schema-per-worker isolation |
| **RedisService** | `src/modules/cache/` | Mock hides cache penetration, serialization errors, TTL errors | Testcontainers Redis 7 or ioredis-mock (local TDD phase) |
| **ConfigService** | `@nestjs/config` | Mock hides production failures caused by configuration errors | Real ConfigModule + .env.test |

**Violation Example**:
```typescript
// ❌ TIER1 violation: Never use jest.spyOn on PrismaService
jest.spyOn(prismaService.appointment, 'findUnique').mockResolvedValue(mockData);
```

### 2.3 TIER2 — Fake First

The following services **should** use Fake implementations from the `test/fakes/` directory:

| Service | Fake Implementation | Location |
|------|---------|------|
| **JwtService** | LocalJwtSigner (real signatures using Node.js crypto module) | `test/fakes/local-jwt-signer.ts` |
| **QueueService** | FakeMessageQueue (in-memory event queue) | `test/fakes/fake-message-queue.ts` |
| **NotificationGateway** | FakeEventBus (in-memory publish/subscribe) | `test/fakes/fake-event-bus.ts` |
| **RateLimiterService** | FakeRateLimiter (in-memory sliding window) | `test/fakes/fake-rate-limiter.ts` |

### 2.4 TIER3 — Boundary Mock (Must Verify Parameters)

The following external system boundary services may be mocked, but call parameters **must** be verified:

```typescript
// ✅ TIER3 compliant: Mocked but verified call parameters
const emailSpy = jest.spyOn(emailService, 'send').mockResolvedValue(undefined);
await service.create(dto);
expect(emailSpy).toHaveBeenCalledWith({
  to: dto.customerEmail,
  subject: expect.stringContaining('Appointment Confirmation'),
  bookingId: expect.any(String),
});
```

---

## 3. TDD Dual-Speed Strategy

### 3.1 Two-Tier Test Execution Mode

```
┌─────────────────────────────────────────────────────┐
│            TDD DUAL-SPEED STRATEGY                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  RED/GREEN Phase (Local, <5s cycle):                 │
│  ┌──────────────────────────────────────────────┐   │
│  │ npm run test -- --watch                       │   │
│  │   → jest.config.unit.js                       │   │
│  │   → RealTestModule.forUnit()                  │   │
│  │   → Fake mode (FakePrismaClient + Fakes)      │   │
│  │   → <5s test cycle                            │   │
│  │   → Write Test → RED → Write Code → GREEN     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  REFACTOR Phase (CI, 30-60s):                        │
│  ┌──────────────────────────────────────────────┐   │
│  │ npm run test:integration                       │   │
│  │   → jest.config.js (full)                      │   │
│  │   → RealTestModule.forIntegration()            │   │
│  │   → ContainerPool → PostgreSQL 16 + Redis 7    │   │
│  │   → Schema-per-worker isolation                │   │
│  │   → Verify zero test cross-contamination       │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 RealTestModule

`RealTestModule` is the test infrastructure base class that automatically detects Docker availability and selects execution mode:

- **Docker available** → Testcontainers (real PostgreSQL + Redis)
- **Docker unavailable** → Fake services (in-memory implementation)

```typescript
// Auto-detect mode
const module = await RealTestModule.forFeature({
  controllers: [AppointmentController],
  providers: [AppointmentService],
}).compile();

// Force real mode (CI usage)
const module = await RealTestModule.forIntegration({ ... }).compile();

// Force Fake mode (local RED/GREEN usage)
const module = await RealTestModule.forUnit({ ... }).compile();
```

### 3.3 ContainerPool

`ContainerPool` is a global singleton container manager that reuses Testcontainers instances across test files:

- **Start once**: jest globalSetup (per worker)
- **Schema isolation**: Independent PostgreSQL schema per test file
- **Auto-cleanup**: DROP SCHEMA CASCADE after test file completes
- **Performance improvement**: From 30s per start → 2s single startup + 0.5s schema creation per file

---

## 4. Test Prohibitions (AI Redlines)

### 4.1 Prohibition on Writing False Tests

The following test patterns will be automatically blocked and flagged as violations by CI quality gates:

#### 4.1.1 Empty Assertion Tests
```typescript
// ❌ Violation: Asserts nothing
it('should create a booking', async () => {
  await service.create(dto);
  // No result assertions
});
```

#### 4.1.2 Getter/Setter-Only Tests
```typescript
// ❌ Violation: Tests property access with no logic
it('should set and get name', () => {
  const user = new User();
  user.name = 'test';
  expect(user.name).toBe('test');
});
```

#### 4.1.3 TIER1 Service Mocking
```typescript
// ❌ Violation: Using spyOn on PrismaService/RedisService/ConfigService
jest.spyOn(prismaService.appointment, 'findUnique').mockResolvedValue(mockData);
jest.spyOn(redisService, 'get').mockResolvedValue(cachedData);
```

#### 4.1.4 Mock Without Call Verification
```typescript
// ❌ Violation: Mock created but call not verified (TIER3 services)
jest.spyOn(notificationService, 'notify');
await service.processBooking(dto);
// Did not verify whether notify was called
```

#### 4.1.5 Tests Coupled to Implementation Details
```typescript
// ❌ Violation: Test coupled to internal implementation — breaks on refactor
it('should call prisma.update before prisma.create', async () => {
  const updateSpy = jest.spyOn(prisma.timeSlot, 'update');
  const createSpy = jest.spyOn(prisma.appointment, 'create');
  await service.create(dto);
  expect(updateSpy).toHaveBeenCalledBefore(createSpy);
});
```

---

## 5. Test Classification and Ratios

### 5.1 Enhanced Testing Pyramid

```
              ┌───────────────────┐
              │   Visual Regression│ (Playwright screenshots)
              │       Tests       │
              ├───────────────────┤
              │   Chaos Tests     │ (Toxiproxy, weekly)
              ├───────────────────┤
              │   End-to-End      │ (10%, Playwright 3 browsers)
              │       Tests       │
              ├───────────────────┤
              │   Mutation Tests  │ (Core modules, Stryker)
              ├───────────────────┤
              │   Contract Tests  │ (Generated from contract.yaml)
              ├───────────────────┤
              │   Integration     │ (20%, Testcontainers)
              │       Tests       │
              ├───────────────────┤
              │   Property-Based  │ (fast-check, core business)
              │       Tests       │
              ├───────────────────┤
              │   Unit Tests      │ (70%, Jest + Fakes)
              └───────────────────┘
```

### 5.2 Responsibilities by Level

| Test Type | Verification Target | Execution Speed | Maintenance Cost | Execution Frequency |
|---------|---------|---------|---------|---------|
| **Unit Tests** | Pure functions, algorithms, utilities, state management | <100ms | Low | Per commit/PR |
| **Property-Based Tests** | Mathematical invariants, business rule consistency | <1s | Low | Per PR (P0 modules) |
| **Integration Tests** | Module interactions, database, cache, HTTP | 1-5s | Medium | Per PR |
| **Contract Tests** | API contract consistency, auto-generated | 1-3s | Low | Per PR |
| **Mutation Tests** | Test quality (mutant kill rate) | 5-15min | Medium | Per PR (core modules) |
| **E2E Tests** | Complete user flows | 10-30s | High | Per PR |
| **Visual Regression** | UI pixel-level change detection | 5-10s | Medium | Per PR |
| **Chaos Tests** | Infrastructure failure recovery | 1-5min | High | Weekly |
| **Fuzz Tests** | Malicious/random input handling | 1-5min | Medium | Daily/PR |

---

## 6. Backend Testing Standards (NestJS)

### 6.1 Unit Tests

#### 6.1.1 Test Scope

**Scenarios Requiring Unit Tests**:
- Utility functions (pure functions, no external dependencies)
- Complex business logic (price calculation, time slot conflict detection, time-out overlap detection)
- Guards (permission judgment logic)
- Interceptors (data transformation logic)
- Pipes (validation logic)

**Scenarios Not Requiring Unit Tests**:
- Pure Getter/Setter (DTO properties)
- Thin wrappers that only forward calls (covered by integration tests)
- Module configuration files

#### 6.1.2 Test Structure (Arrange-Act-Assert + Given-When-Then)

```typescript
describe('AppointmentService', () => {
  describe('create()', () => {
    it('should create appointment and persist to database', async () => {
      // Given: Valid appointment DTO and available time slot
      const dto = createValidAppointmentDto();
      const timeSlot = await prisma.timeSlot.create({ data: createAvailableTimeSlot() });

      // When: Call create method
      const result = await service.create({ ...dto, timeSlotId: timeSlot.id });

      // Then: Appointment created and persisted
      expect(result.id).toBeDefined();
      expect(result.status).toBe('confirmed');
      const persisted = await prisma.appointment.findUnique({ where: { id: result.id } });
      expect(persisted).not.toBeNull();
      expect(persisted?.userId).toBe(dto.userId);
    });

    it('should throw ConflictException when slot is full', async () => {
      // Given: Full time slot
      const timeSlot = await prisma.timeSlot.create({
        data: { ...createTimeSlot(), capacity: 1, currentSequence: 1 }
      });

      // When & Then: Creating appointment should throw conflict exception
      await expect(service.create({ ...dto, timeSlotId: timeSlot.id }))
        .rejects.toThrow(ConflictException);
    });
  });
});
```

#### 6.1.3 High Concurrency Transaction Tests

```typescript
describe('Concurrent Booking - Atomicity', () => {
  it('should allow exactly capacity bookings under concurrency', async () => {
    const capacity = 3;
    const timeSlot = await prisma.timeSlot.create({
      data: { ...createTimeSlot(), capacity, currentSequence: 0 }
    });

    // Simulate 10 concurrent requests
    const promises = Array.from({ length: 10 }, (_, i) =>
      service.create({ userId: `user-${i}`, timeSlotId: timeSlot.id, serviceId: 'svc-1' })
    );

    const results = await Promise.allSettled(promises);
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    expect(succeeded).toBe(capacity); // Only capacity succeed
    expect(failed).toBe(10 - capacity);

    const updated = await prisma.timeSlot.findUnique({ where: { id: timeSlot.id } });
    expect(updated?.currentSequence).toBe(capacity); // Precisely incremented by capacity
  });
});
```

### 6.2 Integration Tests (Testcontainers)

#### 6.2.1 Controller Integration Tests

```typescript
describe('AppointmentController (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleRef = await RealTestModule.forIntegration({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    authToken = await getTestUserToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/appointments - should return 201 on success', async () => {
    const timeSlot = await createTimeSlotInDb(app);
    const response = await request(app.getHttpServer())
      .post('/v1/appointments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ timeSlotId: timeSlot.id, serviceId: 'svc-1' })
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      status: 'confirmed',
    });
  });
});
```

---

## 7. Frontend Testing Standards (Angular)

### 7.1 Unit Tests

#### 7.1.1 Test Scope

**Scenarios Requiring Unit Tests**:
- Pure functions (formatting, calculation, validation)
- SignalStore state management logic
- Pipe (data transformation)
- Complex component interactions (form validation, dynamic rendering)

**Scenarios Not Requiring Unit Tests**:
- Pure presentation components (no logic, template binding only)
- Getter/Setter (no additional logic)

#### 7.1.2 Component Testing Patterns

```typescript
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

describe('AppointmentFormComponent', () => {
  it('should show validation error for invalid phone', async () => {
    await render(AppointmentFormComponent);

    const phoneInput = screen.getByLabelText(/Phone Number/i);
    await userEvent.type(phoneInput, '12345');
    await userEvent.tab();

    expect(screen.getByText(/Phone number format is incorrect/i)).toBeInTheDocument();
  });

  it('should emit formSubmitted when form is valid', async () => {
    const onSubmit = jest.fn();
    await render(AppointmentFormComponent, {
      componentOutputs: { formSubmitted: { emit: onSubmit } as any },
    });

    await userEvent.type(screen.getByLabelText(/Name/i), 'John Doe');
    await userEvent.type(screen.getByLabelText(/Phone Number/i), '13800138000');
    await userEvent.click(screen.getByRole('button', { name: /Submit/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'John Doe',
      phone: '13800138000',
    }));
  });
});
```

---

## 8. Test Infrastructure

### 8.1 RealTestModule

See Section 3.2. Located at `test/setup/real-test-module.ts`.

### 8.2 ContainerPool

See Section 3.3. Located at `test/setup/container-pool.ts`.

### 8.3 Fake Service Directory

Location: `test/fakes/`

| File | Description |
|------|------|
| `fake-event-bus.ts` | In-memory publish/subscribe (replaces NotificationGateway) |
| `fake-message-queue.ts` | In-memory message queue (replaces BullMQ/QueueService) |
| `local-jwt-signer.ts` | Node.js crypto JWT signing (replaces JwtService) |
| `fake-rate-limiter.ts` | In-memory sliding window rate limiting (replaces RateLimiterService) |
| `fake-prisma-client.ts` | In-memory Prisma-compatible client (optional, ultra-fast local TDD) |

Each Fake must have a corresponding `.spec.ts` self-test file.

### 8.4 Test Data Factory

Location: `test/factories/`

Used for quickly creating standard test data, avoiding repetitive data construction logic in test code.

---

## 9. Test Data Management

### 9.1 Data Isolation

Each test file uses an independent PostgreSQL schema (Schema-per-Worker isolation):
- Schema name format: `worker_{jestWorkerId}_suite_{hash}`
- Create schema and run migrations before test file starts
- DROP SCHEMA CASCADE after test file completes
- Ensures zero test cross-contamination

### 9.2 Data Cleanup

```typescript
// Delete in dependency order (child tables first)
afterEach(async () => {
  await prisma.appointment.deleteMany();
  await prisma.timeSlot.deleteMany();
  await prisma.service.deleteMany();
  await prisma.user.deleteMany();
});
```

---

## 10. Coverage Threshold Matrix

### 10.1 Formal Thresholds (Enforced by jest.config.js)

| Priority | Module | Lines | Branches | Functions | Statements | Mutation Kill |
|--------|------|:--:|:--:|:--:|:--:|:------:|
| **Global** | All | 85% | 80% | 85% | 85% | — |
| **P0** | appointments, auth, time-slots, users | 95% | 90% | 95% | 95% | 85% |
| **P1** | notifications, cache, rate-limiter, email, verification, translations | 85% | 80% | 85% | 85% | 80% |
| **P2** | health, stats, services, retention, encryption, common | 75% | 70% | 75% | 75% | — |

### 10.2 Coverage Exclusions

The following file types are **excluded** from coverage statistics:
- DTO definition files (`*.dto.ts`)
- Entity/Model files (`*.entity.ts`)
- Interface definitions (`*.interface.ts`)
- Module configurations (`*.module.ts`)
- Application entry point (`main.ts`)
- Pure constant definitions (`*.constants.ts`)

---

## 11. Advanced Testing Strategies

### 11.1 Property-Based Testing

Use `fast-check` to test mathematical invariants. Applicable to:
- Price calculation (commutativity, monotonicity)
- Time slot overlap detection (symmetry, transitivity)
- PII encryption (round-trip consistency, idempotency)

```typescript
import fc from 'fast-check';

it('should satisfy round-trip property for encryption', async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (plaintext) => {
      const encrypted = await encryptor.encrypt(plaintext);
      const decrypted = await encryptor.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    })
  );
});
```

### 11.2 Contract-Driven Testing

Auto-generate API tests from the `x-test-contract` section of `contract.yaml`:
- Positive tests (valid input → expected response)
- Negative auth tests (no token, wrong role, expired token)
- Negative validation tests (missing required fields, invalid types, out-of-range values)
- Rate limit tests (exceed limit → 429)
- Schema validation (response body format matches contract definition)

### 11.3 Fuzz Testing

Send random, malicious, or malformed input to all endpoints:
- SQL injection patterns → expected 400/422
- XSS patterns → expected 400/422
- Excessively long strings → expected 400 (not 500)
- Unicode boundary characters → expected not to crash

### 11.4 Chaos Testing

Verify infrastructure failure recovery capability (executed weekly):
- PostgreSQL disconnected → 503, no data corruption
- Redis disconnected → graceful degradation, fallback to DB
- Network latency injection → timeout triggered, no hanging connections
- Container restart → auto-reconnect

### 11.5 Visual Regression Testing

Playwright screenshot pixel-level comparison:
- Critical pages: Login, Dashboard, Appointment Form, Admin Panel
- Browser: Chromium + Firefox
- Viewport: Desktop (1280x720) + Mobile (375x667)

### 11.6 Negative Test Matrix

Each endpoint must cover the following dimensions:
- No token (401), Expired token (401), Wrong role (403), Insufficient permissions (403)
- Missing required fields (400), Invalid types (400), Out-of-range values (400)
- Rate limit exceeded (429), Duplicate idempotency keys, Concurrent race (409)
- Resource not found (404), Resource deleted (404/410)

---

## 12. CI/CD Quality Gates

### 12.1 Seven-Stage Pipeline (test-gates.yml)

```
Stage 1 [PARALLEL, ~3min]
├── Unit Tests (Real Deps, Testcontainers)
├── Lint (ESLint)
├── Typecheck (tsc --noEmit)
└── Mock-Audit (ESLint --rule mock-audit)
     │
Stage 2 [PARALLEL, ~5min]
├── Integration Tests (Testcontainers, schema-per-worker)
└── Contract Tests (generated from contract.yaml)
     │
Stage 3 [SERIAL, ~10min]
└── Mutation Tests (core modules, kill≥85%)
     │
Stage 4 [SERIAL, ~8min]
└── E2E Tests (Playwright 3 browsers)
     │
Stage 5 [SERIAL, ~3min]
└── Visual Regression (Playwright screenshot comparison)
     │
Stage 6 [SERIAL, ~5min]
└── Performance Tests (k6, P95<500ms)
     │
Stage 7 [SERIAL, ~2min]
└── Contract Verification (contract.yaml vs API response)
     │
     ▼ ALL PASS → MERGE ALLOWED
```

### 12.2 Flaky Test Auto-Detection

- Same test failing ≥3 times within 7 days → auto-quarantine (does not block merge)
- Auto-create GitHub Issue for tracking
- Generate Flaky Test report weekly

### 12.3 Must Satisfy Before Merge

- [x] All unit tests 100% passed
- [x] All integration tests 100% passed (excluding quarantined)
- [x] Coverage thresholds met (P0≥95/90/95, Global≥85/80)
- [x] Mutation kill rate met (P0≥85%, P1≥80%)
- [x] E2E tests 100% passed (3 browsers)
- [x] Visual regression shows no unexpected differences
- [x] API P95 latency <500ms
- [x] Contract verification 0 mismatches
- [x] Mock audit 0 violations
- [x] 0 Critical/High vulnerabilities

---

## 13. Pre-Commit Hooks

`.husky/pre-commit` runs quick checks before each commit (<10s):

```bash
1. tsc --noEmit           # TypeScript type checking (2-5s)
2. keystone:hash:verify   # Contract hash integrity (0.5s)
3. eslint mock-audit      # Mock policy enforcement (1-2s)
4. jest --onlyChanged --bail  # Changed file tests Fake mode (2-5s)
```

**All pass → Allow commit. Any failure → Block commit.**

---

## 14. Evidence Chain Requirements

### 14.1 test_report.json Schema

When each task transitions from Testing→Review status, `test_report.json` must include:

```json
{
  "execution_evidence": {
    "exit_code": 0,
    "output_summary": "Tests: 92 passed, 92 total"
  },
  "coverage": {
    "lines": 91.5,
    "branches": 85.2,
    "functions": 93.1,
    "statements": 91.8
  },
  "mock_audit": {
    "total_mocks_used": 3,
    "tier1_violations": 0,
    "tier2_replaced_with_fakes": 2,
    "tier3_args_verified": 3
  },
  "flaky_detection": {
    "total_flaky_tests": 0,
    "quarantined_tests": []
  }
}
```

### 14.2 Mandatory Evidence Fields

| Field | Required | Description |
|------|:--:|------|
| `execution_evidence` | ✅ | Test process exit code and output summary |
| `coverage` | ✅ | Coverage data |
| `mock_audit` | ✅ (New in v2.0) | Mock usage audit |
| `flaky_detection` | ✅ (New in v2.0) | Flaky test detection results |

---

## 15. Test Review Checklist

### 15.1 Pre-PR Self-Check

- [ ] Does each test have at least 1 non-trivial assertion?
- [ ] Are normal paths, exception paths, and boundary conditions covered?
- [ ] Is the Given-When-Then structure followed?
- [ ] Are TIER1 services using real dependencies?
- [ ] Are TIER2 services using Fakes (not Mocks)?
- [ ] Are TIER3 Mock call counts and parameters verified?
- [ ] Are tests independent of each other (schema-per-file isolation)?
- [ ] Does test_report.json include execution_evidence, mock_audit, flaky_detection?

### 15.2 @Guardian Review Checklist

- [ ] Mock audit 0 violations (CAT1.1-CAT1.3)
- [ ] machine.json.eslint_state all modules status="clean" or valid waiver (CAT1.0)
- [ ] compliance_gate_complete called and ESLint audit passed
- [ ] No skipped tests (CAT1.2)
- [ ] No console.log in production code (CAT2.1)
- [ ] Role escalation violations recorded as 0 (CAT4.1)
- [ ] Coverage thresholds met (CAT2.1-CAT2.4)
- [ ] TDD integrity (CAT3.1-CAT3.5)
- [ ] test_report.json includes eslint_audit field
- [ ] Test infrastructure complete (CAT4.1-CAT4.6)
- [ ] Contract integrity (CAT5.1-CAT5.5)
- [ ] Evidence chain complete (CAT6.1-CAT6.3)
- [ ] Performance met (CAT7.1-CAT7.3)
- [ ] Security compliance (CAT8.1-CAT8.3)

### 15.3 Blocking Rules (CAT Code Index)

| ID | Rule | Blocks |
|:--:|------|:---:|
| CAT1.0 | eslint-disable TIER1 mock bypass audit without valid waiver reference | ✅ |
| CAT1.1 | jest.spyOn/mock on PrismaService/RedisService/ConfigService | ✅ |
| CAT1.2 | Skipped tests: describe.skip / it.skip / xdescribe / xit | ✅ |
| CAT1.3 | TIER3 Mock without call parameter verification | ✅ |
| CAT2.1 | console.log/error/warn in production code | ✅ |
| CAT2.2-2.9 | (Reserved for future security rules) | — |
| CAT3.1 | TIER3 Mock without call parameter verification | ✅ |
| CAT3.2 | switch statement missing default branch | ⚠️ |
| CAT3.4 | test_report.json missing eslint_audit field | ✅ |
| CAT3.5 | machine.json.eslint_state.tier1_violations > 0 | ✅ |
| CAT3.6 | Business module missing integration tests | ✅ |
| CAT3.7 | machine.json.eslint_state contains dirty modules without valid waiver | ✅ |
| CAT4.1 | Role escalation: agent_write_scopes violation | ✅ |
| CAT6.1 | test_report.json schema incomplete | ✅ |

---

## 16. Defect Management

### 16.1 Defect Fix Flow

1. **Reproduce the defect**: Write a failing test case (RED)
2. **Fix the defect**: Write minimal code to make the test pass (GREEN)
3. **Verify the fix**: Confirm test passes, full regression tests pass
4. **Submit the fix**: Include defect fix code + new/modified test cases

### 16.2 Defect Non-Recurrence Guarantee

**Each defect fix must include at least 1 new test case** to ensure similar defects do not recur.

---

## 17. Architecture Constraint Rules

See `.opencode/context/code_standards/architecture-constraint-rules.md` (maintained by @Architect) for complete constraint rules. Below is a summary of key rules:

### Blocking-Level Rules (Violation = PR Rejected)

| ID | Rule |
|----|------|
| CAT1.1 | Prohibit jest.spyOn on PrismaService/RedisService/ConfigService |
| CAT1.3 | TIER3 Mock must verify call parameters |
| CAT2.1-2.4 | Coverage thresholds must be met |
| CAT3.4 | test_report.json must include execution_evidence |
| CAT3.5 | mock_audit.tier1_violations must be 0 |
| CAT5.4 | keystone hash must match |
| CAT6.1 | test_report.json schema must be complete |

---

## 18. ADR: Architecture Decision Records

### ADR-001: Adoption of Three-Tier Mock Governance Strategy

**Date**: 2026-05-14
**Status**: Adopted
**Decision**: Adopted TIER1(Real-Only) / TIER2(Fake-OK) / TIER3(Boundary-Mock) three-tier mock governance strategy.
**Rationale**: Excessive mocking is the number one killer of test quality. Completely banning mocks is too aggressive (Email/SMS/Payment must be mocked). The three-tier strategy balances realism and practicality.
**Consequences**: Need to maintain Fake implementations in `test/fakes/` directory; ESLint needs custom mock-audit rule; @Guardian needs additional review items.

### ADR-002: Adoption of TDD Dual-Speed Strategy

**Date**: 2026-05-14
**Status**: Adopted
**Decision**: Local TDD uses Fake mode (<5s cycle), CI verification uses Testcontainers real mode.
**Rationale**: Pure Testcontainers takes 30s to start once, unable to support TDD's fast feedback loop. Pure Fake mode cannot verify database constraints and transaction isolation. The dual-speed strategy balances speed and authenticity.
**Consequences**: RealTestModule needs auto-detection of Docker availability; ContainerPool needs schema-per-worker isolation; CI needs additional stages.

### ADR-003: Adoption of Schema-per-Worker Isolation Strategy

**Date**: 2026-05-14
**Status**: Adopted
**Decision**: Use PostgreSQL schema isolation (not database-per-worker or transaction-rollback).
**Rationale**: Schema creation/deletion is 10x+ faster than Database; single container, single connection pool, simple operations; more reliable than transaction rollback (NestJS async operations are not bound by transactions).
**Consequences**: Prisma migrations need to run on each schema; schema manager needed to manage schema lifecycle.

### ADR-004: Adoption of Contract-Driven Test Generation

**Date**: 2026-05-14
**Status**: Adopted
**Decision**: Auto-generate API tests from contract.yaml, rather than manually writing them.
**Rationale**: Manually written API tests easily fall out of sync with contracts; auto-generation ensures 100% endpoint coverage; contract.yaml is the single source of truth.
**Consequences**: contract.yaml needs x-test-contract extension section; contract-test-generator tool needs to be maintained.

### ADR-005: Seven-Stage CI Gate Pipeline

**Date**: 2026-05-14
**Status**: Adopted
**Decision**: Adopt 7-stage sequential pipeline with clear dependencies and failure handling per stage.
**Rationale**: Running all tests in parallel is fast but wastes resources (E2E is meaningless when unit tests fail). Staged execution allows fast early failure, saving CI resources.
**Consequences**: Maximum pipeline time approximately 36 minutes; complex GitHub Actions workflow files need maintenance; Flaky test detection needs to run after Stage1 and Stage2 failures.

---

## 19. Related Documents

| Document | Description |
|------|------|
| [contract.yaml](../../booking_system_refactor/contract.yaml) | API contract definition (includes x-test-mock-policy, x-test-contract, x-coverage-matrix) |
| [System Architecture Design Document](../requirements/SAD.md) | System architecture design |
| [Security Architecture Design Document](../requirements/Security-Architecture-Design.md) | Security testing requirements |
| [Test Strategy and Plan](../requirements/Test-Strategy-and-Plan.md) | Testing strategy overview |
| [Backend Coding Standards](./backend-coding-standard.md) | Backend development standards |
| [Frontend Coding Standards](./frontend-coding-standard.md) | Frontend development standards |
| [Architecture Constraint Rules (TEST-ARCH-V2)](../../.task_temp/TEST-ARCH-V2/architecture-constraint-rules.md) | @Guardian review rules |
| [TECH_DEBT_REGISTRY.md](../../booking_system_refactor/TECH_DEBT_REGISTRY.md) | Technical debt registry |

---

## Version History

| Version | Date | Changes | Author |
|------|------|---------|------|
| 2.0 | 2026-05-14 | Comprehensive upgrade: Three-tier mock governance strategy, TDD dual-speed strategy, RealTestModule, ContainerPool, 7-stage CI gate, property/contract/fuzz/chaos/visual regression testing, evidence chain enhancement (Flaky detection + Mock-Audit), ESLint mock rules, Pre-commit hooks, 5 ADRs | @Architect |
| 1.0 | 2026-04-16 | Initial version, integrating test strategy and AI test specifications | @Tester Agent |

---

*Architect Design | v2.0.0 | 2026-05-14 | Task: TEST-ARCH-V2*
