# Testing Coding Standard v2.0

> **Version**: 2.0.0  
> **Effective Date**: 2026-05-14  
> **Author**: @Architect  
> **Approved By**: @Arbiter  
> **Scope**: booking_system_refactor (backend + frontend + e2e)  
> **Previous Version**: v1.0 (2026-04-16)

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [Three-Tier Mock Governance Strategy](#2-three-tier-mock-governance-strategy)
3. [TDD Dual-Speed Strategy](#3-tdd-dual-speed-strategy)
4. [Testing Prohibitions (AI Redlines)](#4-testing-prohibitions-ai-redlines)
5. [Test Categories and Ratios](#5-test-categories-and-ratios)
6. [Backend Testing Standard (NestJS)](#6-backend-testing-standard-nestjs)
7. [Frontend Testing Standard (Angular)](#7-frontend-testing-standard-angular)
8. [Testing Infrastructure](#8-testing-infrastructure)
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

### 1.1 The Sole Value of Tests Is Finding Bugs

**Tests exist not to prove code works, but to prove code won't fail.** Any test that cannot discover potential defects is wasting CI time and maintenance costs.

### 1.2 TDD Mandatory Iron Rule

All tests must follow the RED → GREEN → REFACTOR cycle:
1. **RED**: Write a failing test case first, defining expected behavior
2. **GREEN**: Write only the minimum code to make the test pass
3. **REFACTOR**: Optimize code structure under test protection

### 1.3 Mock Minimization Principle

**"Better a slow test than a fake test."** Over-mocking is the #1 killer of test quality. This standard adopts a three-tier mock governance strategy (see Section 2), strictly limiting mock usage scope.

### 1.4 Test Coverage Priority

| Priority | Module Type | Line Coverage | Branch Coverage | Function Coverage | Mutation Kill Rate | Test Strategy |
|--------|---------|:------:|:--------:|:--------:|:--------:|---------|
| P0 | Core business logic (appointments, auth, time-slots, users) | ≥95% | ≥90% | ≥95% | ≥85% | Unit + Integration + Property + Mutation |
| P1 | Important service layer (notifications, cache, rate-limiter, email, verification, translations) | ≥85% | ≥80% | ≥85% | ≥80% | Unit + Integration + Contract |
| P2 | Auxiliary modules (health check, stats, service management, retention, encryption, common utils) | ≥75% | ≥70% | ≥75% | — | Primarily unit |
| P3 | Configuration, entry files, DTO definitions | Exempt | Exempt | Exempt | — | Not included in coverage statistics |

---

## 2. Three-Tier Mock Governance Strategy

### 2.1 Strategy Overview

This strategy defines three tiers of mock governance rules, declared in the `x-test-mock-policy` section of `contract.yaml`, enforced by ESLint mock-audit rules, and finally reviewed by @Guardian.

```
┌──────────────────────────────────────────────────────┐
│                 TIER1: REAL-ONLY                      │
│  PrismaService / RedisService / ConfigService         │
│  → Never mock; Testcontainers real instances only     │
│  → ESLint intercepts jest.spyOn on these services    │
├──────────────────────────────────────────────────────┤
│                 TIER2: FAKE-OK                        │
│  JwtService / QueueService / NotificationGateway     │
│  RateLimiterService                                   │
│  → Prefer test/fakes/ implementations                │
│  → Fakes are behaviorally real, state-observable,    │
│    no external dependencies                           │
├──────────────────────────────────────────────────────┤
│                 TIER3: BOUNDARY-MOCK                  │
│  EmailService / SMSService / PaymentGateway           │
│  → Mocking allowed, but call arguments must be       │
│    verified                                           │
│  → Every mock must have expect().toHaveBeenCalledWith() │
└──────────────────────────────────────────────────────┘
```

### 2.2 TIER1 — Real Dependencies (Never Mock)

The following services **must** use Testcontainers real instances; `jest.spyOn` or `jest.mock` are **strictly forbidden**:

| Service | Module | Reason | Test Strategy |
|------|------|------|---------|
| **PrismaService** | `@prisma/client` | Mocks hide SQL errors, transaction bugs, constraint violations | Testcontainers PostgreSQL 16 + schema-per-worker isolation |
| **RedisService** | `src/modules/cache/` | Mocks hide cache penetration, serialization errors, TTL errors | Testcontainers Redis 7 or ioredis-mock (local TDD phase) |
| **ConfigService** | `@nestjs/config` | Mocks hide config errors causing production incidents | Real ConfigModule + .env.test |

**Violation Example**:
```typescript
// ❌ TIER1 violation: Never use jest.spyOn on PrismaService
jest.spyOn(prismaService.appointment, 'findUnique').mockResolvedValue(mockData);
```

### 2.3 TIER2 — Fake-First

The following services **should** use Fake implementations from the `test/fakes/` directory:

| Service | Fake Implementation | Location |
|------|---------|------|
| **JwtService** | LocalJwtSigner (Node.js crypto module real signing) | `test/fakes/local-jwt-signer.ts` |
| **QueueService** | FakeMessageQueue (in-memory event queue) | `test/fakes/fake-message-queue.ts` |
| **NotificationGateway** | FakeEventBus (in-memory pub/sub) | `test/fakes/fake-event-bus.ts` |
| **RateLimiterService** | FakeRateLimiter (in-memory sliding window) | `test/fakes/fake-rate-limiter.ts` |

### 2.4 TIER3 — Boundary Mock (Arguments Must Be Verified)

The following external system boundary services may be mocked, but call arguments **must** be verified:

```typescript
// ✅ TIER3 compliant: Mock with verified call arguments
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

### 3.1 Two-Layer Test Execution Modes

```
┌─────────────────────────────────────────────────────┐
│            TDD DUAL-SPEED STRATEGY                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  RED/GREEN Phase (local, <5s cycle):                 │
│  ┌──────────────────────────────────────────────┐   │
│  │ npm run test -- --watch                       │   │
│  │   → jest.config.unit.js                       │   │
│  │   → RealTestModule.forUnit()                  │   │
│  │   → Fake mode (FakePrismaClient + Fakes)      │   │
│  │   → <5s test cycle                            │   │
│  │   → Write test → RED → Write code → GREEN     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  REFACTOR Phase (CI, 30-60s):                        │
│  ┌──────────────────────────────────────────────┐   │
│  │ npm run test:integration                       │   │
│  │   → jest.config.js (full)                      │   │
│  │   → RealTestModule.forIntegration()            │   │
│  │   → ContainerPool → PostgreSQL 16 + Redis 7    │   │
│  │   → Schema-per-worker isolation                │   │
│  │   → Verify no test cross-contamination         │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 RealTestModule

`RealTestModule` is the test infrastructure base class that automatically detects Docker availability and selects execution mode:

- **Docker available** → Testcontainers (real PostgreSQL + Redis)
- **Docker unavailable** → Fake services (in-memory implementations)

```typescript
// Auto-detect mode
const module = await RealTestModule.forFeature({
  controllers: [AppointmentController],
  providers: [AppointmentService],
}).compile();

// Force real mode (for CI)
const module = await RealTestModule.forIntegration({ ... }).compile();

// Force Fake mode (for local RED/GREEN)
const module = await RealTestModule.forUnit({ ... }).compile();
```

### 3.3 ContainerPool

`ContainerPool` is a global singleton container manager that reuses Testcontainers instances across test files:

- **Start once**: jest globalSetup (per worker)
- **Schema isolation**: Each test file gets an independent PostgreSQL schema
- **Auto cleanup**: DROP SCHEMA CASCADE after test file completes
- **Performance gain**: From 30s per startup → start once 2s + schema creation 0.5s/file

---

## 4. Testing Prohibitions (AI Redlines)

### 4.1 Writing "False Tests" Is Strictly Forbidden

The following test patterns will be automatically intercepted by CI quality gates and flagged as violations:

#### 4.1.1 Empty Assertion Tests
```typescript
// ❌ Violation: Asserts nothing
it('should create a booking', async () => {
  await service.create(dto);
  // No assertions on any result
});
```

#### 4.1.2 Testing Only Getter/Setter
```typescript
// ❌ Violation: Testing logic-free property access
it('should set and get name', () => {
  const user = new User();
  user.name = 'test';
  expect(user.name).toBe('test');
});
```

#### 4.1.3 TIER1 Service Mock
```typescript
// ❌ Violation: Using spyOn on PrismaService/RedisService/ConfigService
jest.spyOn(prismaService.appointment, 'findUnique').mockResolvedValue(mockData);
jest.spyOn(redisService, 'get').mockResolvedValue(cachedData);
```

#### 4.1.4 Mock Without Call Verification
```typescript
// ❌ Violation: Created a mock but never verified if it was called (TIER3 service)
jest.spyOn(notificationService, 'notify');
await service.processBooking(dto);
// Never verified whether notify was called
```

#### 4.1.5 Tests Coupled to Implementation Details
```typescript
// ❌ Violation: Test is coupled to internal implementation; refactoring breaks it
it('should call prisma.update before prisma.create', async () => {
  const updateSpy = jest.spyOn(prisma.timeSlot, 'update');
  const createSpy = jest.spyOn(prisma.appointment, 'create');
  await service.create(dto);
  expect(updateSpy).toHaveBeenCalledBefore(createSpy);
});
```

---

## 5. Test Categories and Ratios

### 5.1 Enhanced Test Pyramid

```
              ┌───────────────────┐
              │  Visual Regression │ (Playwright screenshots)
              ├───────────────────┤
              │  Chaos Testing     │ (Toxiproxy, weekly)
              ├───────────────────┤
              │  E2E Testing       │ (10%, Playwright 3 browsers)
              ├───────────────────┤
              │  Mutation Testing  │ (core modules, Stryker)
              ├───────────────────┤
              │  Contract Testing  │ (generated from contract.yaml)
              ├───────────────────┤
              │  Integration Tests │ (20%, Testcontainers)
              ├───────────────────┤
              │  Property Testing  │ (fast-check, core business)
              ├───────────────────┤
              │  Unit Tests        │ (70%, Jest + Fakes)
              └───────────────────┘
```

### 5.2 Responsibilities Per Layer

| Test Type | Verification Target | Execution Speed | Maintenance Cost | Execution Frequency |
|---------|---------|---------|---------|---------|
| **Unit Tests** | Pure functions, algorithms, utilities, state management | <100ms | Low | Every commit/PR |
| **Property Tests** | Mathematical invariants, business rules that always hold | <1s | Low | Every PR (P0 modules) |
| **Integration Tests** | Module interactions, database, cache, HTTP | 1-5s | Medium | Every PR |
| **Contract Tests** | API contract consistency, auto-generated | 1-3s | Low | Every PR |
| **Mutation Tests** | Test quality (mutant kill rate) | 5-15min | Medium | Every PR (core modules) |
| **E2E Tests** | Complete user flows | 10-30s | High | Every PR |
| **Visual Regression** | Pixel-level UI change detection | 5-10s | Medium | Every PR |
| **Chaos Testing** | Infrastructure failure recovery | 1-5min | High | Weekly |
| **Fuzz Testing** | Malicious/random input handling | 1-5min | Medium | Daily/PR |

---

## 6. Backend Testing Standard (NestJS)

### 6.1 Unit Tests

#### 6.1.1 Test Scope

**Scenarios requiring unit tests**:
- Utility functions (pure functions, no external dependencies)
- Complex business logic (price calculation, time slot conflict detection, overtime overlap detection)
- Guards (permission decision logic)
- Interceptors (data transformation logic)
- Pipes (validation logic)

**Scenarios not requiring unit tests**:
- Pure Getter/Setter (DTO properties)
- Thin wrappers that only forward calls (covered by integration tests instead)
- Module configuration files

#### 6.1.2 Test Structure (Arrange-Act-Assert + Given-When-Then)

```typescript
describe('AppointmentService', () => {
  describe('create()', () => {
    it('should create appointment and persist to database', async () => {
      // Given: Valid appointment DTO and available time slot
      const dto = createValidAppointmentDto();
      const timeSlot = await prisma.timeSlot.create({ data: createAvailableTimeSlot() });

      // When: Call the create method
      const result = await service.create({ ...dto, timeSlotId: timeSlot.id });

      // Then: Appointment is created and persisted
      expect(result.id).toBeDefined();
      expect(result.status).toBe('confirmed');
      const persisted = await prisma.appointment.findUnique({ where: { id: result.id } });
      expect(persisted).not.toBeNull();
      expect(persisted?.userId).toBe(dto.userId);
    });

    it('should throw ConflictException when slot is full', async () => {
      // Given: A fully booked time slot
      const timeSlot = await prisma.timeSlot.create({
        data: { ...createTimeSlot(), capacity: 1, currentSequence: 1 }
      });

      // When & Then: Creating an appointment should throw conflict exception
      await expect(service.create({ ...dto, timeSlotId: timeSlot.id }))
        .rejects.toThrow(ConflictException);
    });
  });
});
```

#### 6.1.3 High-Concurrency Transaction Tests

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
    expect(updated?.currentSequence).toBe(capacity); // Incremented exactly capacity times
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

## 7. Frontend Testing Standard (Angular)

### 7.1 Unit Tests

#### 7.1.1 Test Scope

**Scenarios requiring unit tests**:
- Pure functions (formatting, calculation, validation)
- SignalStore state management logic
- Pipes (data transformation)
- Complex component interactions (form validation, dynamic rendering)

**Scenarios not requiring unit tests**:
- Pure display components (no logic, only template binding)
- Getter/Setter (no additional logic)

#### 7.1.2 Component Test Pattern

```typescript
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

describe('AppointmentFormComponent', () => {
  it('should show validation error for invalid phone', async () => {
    await render(AppointmentFormComponent);

    const phoneInput = screen.getByLabelText(/phone/i);
    await userEvent.type(phoneInput, '12345');
    await userEvent.tab();

    expect(screen.getByText(/invalid phone format/i)).toBeInTheDocument();
  });

  it('should emit formSubmitted when form is valid', async () => {
    const onSubmit = jest.fn();
    await render(AppointmentFormComponent, {
      componentOutputs: { formSubmitted: { emit: onSubmit } as any },
    });

    await userEvent.type(screen.getByLabelText(/name/i), 'John Doe');
    await userEvent.type(screen.getByLabelText(/phone/i), '13800138000');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'John Doe',
      phone: '13800138000',
    }));
  });
});
```

---

## 8. Testing Infrastructure

### 8.1 RealTestModule

See Section 3.2. Located at `test/setup/real-test-module.ts`.

### 8.2 ContainerPool

See Section 3.3. Located at `test/setup/container-pool.ts`.

### 8.3 Fake Service Directory

Location: `test/fakes/`

| File | Description |
|------|------|
| `fake-event-bus.ts` | In-memory pub/sub (replaces NotificationGateway) |
| `fake-message-queue.ts` | In-memory message queue (replaces BullMQ/QueueService) |
| `local-jwt-signer.ts` | Node.js crypto JWT signing (replaces JwtService) |
| `fake-rate-limiter.ts` | In-memory sliding window rate limiter (replaces RateLimiterService) |
| `fake-prisma-client.ts` | In-memory Prisma-compatible client (optional, ultra-fast local TDD) |

Each Fake must have a corresponding `.spec.ts` self-test file.

### 8.4 Test Data Factories

Location: `test/factories/`

Used for quickly creating standard test data, avoiding repetitive data construction logic in test code.

---

## 9. Test Data Management

### 9.1 Data Isolation

Each test file uses an independent PostgreSQL schema (Schema-per-Worker isolation):
- Schema name format: `worker_{jestWorkerId}_suite_{hash}`
- Schema is created and migrations are run before the test file starts
- DROP SCHEMA CASCADE after the test file ends
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

### 10.1 Official Thresholds (enforced by jest.config.js)

| Priority | Module | Line | Branch | Function | Statement | Mutation Kill |
|--------|------|:--:|:--:|:--:|:--:|:------:|
| **Global** | All | 85% | 80% | 85% | 85% | — |
| **P0** | appointments, auth, time-slots, users | 95% | 90% | 95% | 95% | 85% |
| **P1** | notifications, cache, rate-limiter, email, verification, translations | 85% | 80% | 85% | 85% | 80% |
| **P2** | health, stats, services, retention, encryption, common | 75% | 70% | 75% | 75% | — |

### 10.2 Coverage Exclusions

The following file types are **not included** in coverage statistics:
- DTO definition files (`*.dto.ts`)
- Entity/model files (`*.entity.ts`)
- Interface definitions (`*.interface.ts`)
- Module configuration (`*.module.ts`)
- Application entry (`main.ts`)
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
- Rate limit tests (exceeding limit → 429)
- Schema validation (response body format matches contract definition)

### 11.3 Fuzz Testing

Send random, malicious, or malformed input to all endpoints:
- SQL injection patterns → expect 400/422
- XSS patterns → expect 400/422
- Excessively long strings → expect 400 (not 500)
- Unicode boundary characters → expect no crash

### 11.4 Chaos Testing

Verify infrastructure failure recovery capability (weekly execution):
- PostgreSQL disconnect → 503, no data corruption
- Redis disconnect → graceful degradation, fallback to DB
- Network latency injection → timeout triggers, no hanging connections
- Container restart → automatic reconnection

### 11.5 Visual Regression Testing

Playwright screenshot pixel-level comparison:
- Key pages: login, dashboard, booking form, admin panel
- Browsers: Chromium + Firefox
- Viewports: Desktop (1280x720) + Mobile (375x667)

### 11.6 Negative Test Matrix

Each endpoint must cover the following dimensions:
- No token (401), expired token (401), wrong role (403), insufficient permissions (403)
- Missing required fields (400), invalid types (400), out-of-range values (400)
- Rate limit exceeded (429), duplicate idempotency key, concurrent race (409)
- Resource not found (404), resource deleted (404/410)

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

- Same test fails ≥3 times within 7 days → automatically quarantined (does not block merge)
- Automatically creates GitHub Issue for tracking
- Weekly Flaky Test report generated

### 12.3 Pre-Merge Requirements

- [x] All unit tests 100% pass
- [x] All integration tests 100% pass (excluding quarantined tests)
- [x] Coverage thresholds met (P0≥95/90/95, Global≥85/80)
- [x] Mutation kill rate met (P0≥85%, P1≥80%)
- [x] E2E tests 100% pass (3 browsers)
- [x] Visual regression: no unexpected differences
- [x] API P95 latency <500ms
- [x] Contract verification: 0 mismatches
- [x] Mock audit: 0 violations
- [x] 0 Critical/High vulnerabilities

---

## 13. Pre-Commit Hooks

`.husky/pre-commit` runs quick checks before each commit (<10s):

```bash
1. tsc --noEmit           # TypeScript type check (2-5s)
2. keystone:hash:verify   # Contract hash integrity (0.5s)
3. eslint mock-audit      # Mock policy enforcement (1-2s)
4. jest --onlyChanged --bail  # Changed file tests in Fake mode (2-5s)
```

**All pass → commit allowed. Any failure → commit blocked.**

---

## 14. Evidence Chain Requirements

### 14.1 test_report.json Schema

When transitioning a task from Testing → Review status, `test_report.json` must contain:

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
| `mock_audit` | ✅ (new in v2.0) | Mock usage audit |
| `flaky_detection` | ✅ (new in v2.0) | Flaky test detection results |

---

## 15. Test Review Checklist

### 15.1 Self-Check Before Submitting PR

- [ ] Does each test have at least 1 non-trivial assertion?
- [ ] Are normal paths, exception paths, and boundary conditions covered?
- [ ] Does it follow Given-When-Then structure?
- [ ] Are TIER1 services using real dependencies?
- [ ] Are TIER2 services using Fakes (not Mocks)?
- [ ] Do TIER3 Mocks verify call count and arguments?
- [ ] Are tests independent of each other (schema-per-file isolation)?
- [ ] Does test_report.json contain execution_evidence, mock_audit, and flaky_detection?

### 15.2 @Guardian Review Checklist

- [ ] Mock audit 0 violations (CAT1.1-CAT1.3)
- [ ] machine.json.eslint_state all modules status="clean" or valid waiver (CAT1.0)
- [ ] compliance_gate_complete has been called and ESLint audit passed
- [ ] No skipped tests (CAT1.2)
- [ ] No console.log in production code (CAT2.1)
- [ ] Role violations count is 0 (CAT4.1)
- [ ] Coverage thresholds met (CAT2.1-CAT2.4)
- [ ] TDD completeness (CAT3.1-CAT3.5)
- [ ] test_report.json contains eslint_audit field
- [ ] Test infrastructure complete (CAT4.1-CAT4.6)
- [ ] Contract integrity (CAT5.1-CAT5.5)
- [ ] Evidence chain complete (CAT6.1-CAT6.3)
- [ ] Performance targets met (CAT7.1-CAT7.3)
- [ ] Security compliance (CAT8.1-CAT8.3)

### 15.3 Blocking Rules (CAT Code Index)

| ID | Rule | Blocks |
|:--:|------|:---:|
| CAT1.0 | eslint-disable TIER1 mock bypass audit not referencing valid waiver | ✅ |
| CAT1.1 | jest.spyOn/mock on PrismaService/RedisService/ConfigService | ✅ |
| CAT1.2 | Skipped tests: describe.skip / it.skip / xdescribe / xit | ✅ |
| CAT1.3 | TIER3 Mock without verifying call arguments | ✅ |
| CAT2.1 | console.log/error/warn in production code | ✅ |
| CAT2.2-2.9 | (Reserved for future security rules) | — |
| CAT3.1 | TIER3 Mock without verifying call arguments | ✅ |
| CAT3.2 | switch statement missing default branch | ⚠️ |
| CAT3.4 | test_report.json missing eslint_audit field | ✅ |
| CAT3.5 | machine.json.eslint_state.tier1_violations > 0 | ✅ |
| CAT3.6 | Business module missing integration tests | ✅ |
| CAT3.7 | machine.json.eslint_state contains dirty module without valid waiver | ✅ |
| CAT4.1 | Role violation: agent_write_scopes breach | ✅ |
| CAT6.1 | test_report.json schema incomplete | ✅ |

---

## 16. Defect Management

### 16.1 Defect Fix Process

1. **Reproduce the defect**: Write a failing test case (RED)
2. **Fix the defect**: Write the minimum code to make the test pass (GREEN)
3. **Verify the fix**: Confirm test passes, full regression test suite passes
4. **Commit the fix**: Include defect fix code + new/modified test cases

### 16.2 Defect Non-Recurrence Guarantee

**Every defect fix must include at least 1 new test case** to ensure the same class of defect does not recur.

---

## 17. Architecture Constraint Rules

Complete constraint rules are in `.qoder/context/code_standards/architecture-constraint-rules.md` (maintained by @Architect). Key rules summary below:

### Blocking Rules (Violation Rejects PR)

| ID | Rule |
|----|------|
| CAT1.1 | jest.spyOn on PrismaService/RedisService/ConfigService is forbidden |
| CAT1.3 | TIER3 Mock must verify call arguments |
| CAT2.1-2.4 | Coverage thresholds must be met |
| CAT3.4 | test_report.json must contain execution_evidence |
| CAT3.5 | mock_audit.tier1_violations must be 0 |
| CAT5.4 | keystone hash must match |
| CAT6.1 | test_report.json schema must be complete |

---

## 18. ADR: Architecture Decision Records

### ADR-001: Adopt Three-Tier Mock Governance Strategy

**Date**: 2026-05-14  
**Status**: Adopted  
**Decision**: Adopt TIER1(Real-Only) / TIER2(Fake-OK) / TIER3(Boundary-Mock) three-tier mock governance strategy.  
**Rationale**: Over-mocking is the #1 killer of test quality. Completely forbidding mocks is too aggressive (email/SMS/Payment must be mocked). The three-tier strategy strikes a balance between authenticity and practicality.  
**Consequences**: Fake implementations must be maintained in test/fakes/ directory; ESLint requires custom mock-audit rules; @Guardian requires additional review items.

### ADR-002: Adopt TDD Dual-Speed Strategy

**Date**: 2026-05-14  
**Status**: Adopted  
**Decision**: Use Fake mode for local TDD (<5s cycle), Testcontainers real mode for CI verification.  
**Rationale**: Pure Testcontainers takes 30s per startup, which cannot support TDD's rapid feedback loop. Pure Fake mode cannot verify database constraints and transaction isolation. The dual-speed strategy balances speed and authenticity.  
**Consequences**: RealTestModule needs automatic Docker availability detection; ContainerPool needs schema-per-worker isolation; CI requires additional stages.

### ADR-003: Adopt Schema-per-Worker Isolation Strategy

**Date**: 2026-05-14  
**Status**: Adopted  
**Decision**: Use PostgreSQL schema isolation (instead of database-per-worker or transaction-rollback).  
**Rationale**: Schema creation/deletion is 10x faster than Database; single container single connection pool for simple operations; more reliable than transaction rollback (NestJS async operations are not bound by transactions).  
**Consequences**: Prisma migrations need to run on each schema; a schema manager is needed to manage schema lifecycle.

### ADR-004: Adopt Contract-Driven Test Generation

**Date**: 2026-05-14  
**Status**: Adopted  
**Decision**: Auto-generate API tests from contract.yaml instead of writing them manually.  
**Rationale**: Manually written API tests easily drift from the contract; auto-generation ensures 100% endpoint coverage; contract.yaml is the single source of truth.  
**Consequences**: contract.yaml needs x-test-contract extension section; a contract-test-generator tool must be maintained.

### ADR-005: Seven-Stage CI Gate Pipeline

**Date**: 2026-05-14  
**Status**: Adopted  
**Decision**: Adopt a 7-stage sequential pipeline with clear dependencies and failure handling per stage.  
**Rationale**: Running all tests in parallel is faster but wastes resources (E2E is meaningless when unit tests fail). Staged execution enables fast failure early, saving CI resources.  
**Consequences**: Maximum pipeline time is approximately 36 minutes; complex GitHub Actions workflow file must be maintained; Flaky test detection needs to run after Stage 1 and Stage 2 failures.

---

## 19. Related Documents

| Document | Description |
|------|------|
| [contract.yaml](booking_system_refactor/contract.yaml) | API contract definition (includes x-test-mock-policy, x-test-contract, x-coverage-matrix) |
| [System Architecture Design](.qoder/context/requirements/system-architecture-design.md) | System architecture design |
| [Security Architecture Design](.qoder/context/requirements/security-architecture.md) | Security testing requirements |
| [Testing Strategy and Plan](.qoder/context/requirements/testing-strategy.md) | Testing strategy overview |
| [Backend Coding Standard](./backend-coding-standard.md) | Backend development standard |
| [Frontend Coding Standard](./frontend-coding-standard.md) | Frontend development standard |
| [Architecture Constraint Rules (TEST-ARCH-V2)](.task_temp/TEST-ARCH-V2/architecture-constraint-rules.md) | @Guardian review rules |
| [TECH_DEBT_REGISTRY.md](booking_system_refactor/TECH_DEBT_REGISTRY.md) | Technical debt registry |

---

## Version History

| Version | Date | Changes | Author |
|------|------|---------|------|
| 2.0 | 2026-05-14 | Full upgrade: Three-tier mock governance strategy, TDD dual-speed strategy, RealTestModule, ContainerPool, 7-stage CI gates, property/contract/fuzz/chaos/visual regression testing, evidence chain enhancement (Flaky detection + Mock-Audit), ESLint mock rules, Pre-commit hooks, 5 ADRs | @Architect |
| 1.0 | 2026-04-16 | Initial version, integrating testing strategy and AI testing standards | @Tester Agent |

---

*Architect Design | v2.0.0 | 2026-05-14 | Task: TEST-ARCH-V2*
