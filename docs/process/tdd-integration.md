# TDD Integration in Booking System

## 1. Overview

The booking_system_refactor project follows a strict RED → GREEN → REFACTOR TDD methodology, codified in the testing-coding-standard.md (v2.0). This document describes how TDD is woven into every layer: development workflow, commit protocol, compliance gates, and CI/CD pipeline.

## 2. TDD Phases and Commit Mapping

### 2.1 Three-Phase Cycle

| Phase | Action | Evidence | Commit Tag |
|-------|--------|----------|------------|
| **RED** | Write failing test that defines expected behavior | Test execution fails with expected error | `[Red] {task_id}` |
| **GREEN** | Write minimal code to pass the test | Test execution passes (exit 0) | `[Green] {task_id}` |
| **REFACTOR** | Improve code quality under test protection | All tests continue to pass | `[Refactor] {task_id}` |

Commit message format per coding-standard-common.md §10:
```
<type>[scope]: <description> [Phase] {task_id}

Example:
test(appointments): add create() conflict test [Red] T-014
feat(appointments): implement slot preemption logic [Green] T-014
refactor(appointments): extract transaction helper [Refactor] T-014
```

### 2.2 Dual-Speed TDD Strategy

The project implements ADR-002 from testing-coding-standard.md §18:

| Mode | Execution | Cycle Time | Database | Use Case |
|------|-----------|------------|----------|----------|
| **Local (Fast)** | `npm run test -- --watch` | <5s | Fakes/mocks | RED/GREEN iteration during development |
| **CI (Full)** | `npm run test:integration` | 30-60s | Testcontainers PostgreSQL 16 + Redis 7 | REFACTOR verification, pre-merge |

## 3. Backend TDD Workflow (NestJS)

### 3.1 Standard Workflow per Module

Each backend module follows a consistent three-file test pattern:

```
modules/{module}/
  ├── {module}.service.spec.ts     # Mock Prisma + services → test business logic
  ├── {module}.controller.spec.ts  # Mock service → test HTTP layer, guards
  └── {module}.module.spec.ts      # Compile module → verify DI resolution
```

### 3.2 Test Patterns Found in Codebase

**Service testing** (e.g., `appointments.service.spec.ts`):
- Creates `TestingModule` with `Test.createTestingModule()`
- Mocks `PrismaService` with `jest.fn()` delegates for each model (`appointment`, `timeSlot`, `activityLog`)
- Mocks `EmailService`, `NotificationService`, `NotificationsGateway`, `Logger`
- Tests follow Given-When-Then structure with clear describe/it nesting
- Tests cover: happy path, NotFoundException, ConflictException, transaction retry logic, optimistic locking, cascade failure (email fails → booking still succeeds)

Example pattern from `appointments.service.spec.ts`:
```typescript
beforeEach(async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AppointmentsService,
      { provide: PrismaService, useValue: mockPrismaService },
      { provide: EmailService, useValue: mockEmailService },
      // ...
    ],
  }).compile();
});
```

**Controller testing** (e.g., `appointments.controller.spec.ts`):
- Mocks service layer completely
- Overrides `JwtAuthGuard` with `.overrideGuard(JwtAuthGuard).useValue(mock)` to simulate authenticated requests
- Tests BUG-001: verifies body.userId is ignored in favor of JWT userId (security regression test)
- Tests propagation of service-layer exceptions (NotFoundException, ConflictException)

**Integration testing** (e.g., `appointments.service.spec.ts` §Integration, `time-slots.service.spec.ts`):
- Real database via `createTestModule()` helper that connects to Testcontainers PostgreSQL
- `isIntegrationMode()` guard to skip integration tests when Docker is unavailable
- Data cleanup via `testModule.resetDatabase()`
- Uses shared test fixtures: `createTestUser()`, `createTestService()`, `createTestTimeSlot()`, `createTestAppointment()`

### 3.3 Modules with Complete Test Coverage (+Spec Files Found)

| Module | Service Spec | Controller Spec | Integration | Unit Tests Found |
|--------|:-----------:|:---------------:|:-----------:|:----------------:|
| **appointments** | ✅ | ✅ | ✅ (isIntegrationMode) | 40+ tests (create, findAll, findOne, update, cancel, remove + concurrency) |
| **time-slots** | ✅ | ✅ | ✅ (full integration) | 20+ tests (CRUD + getAvailableSlots with timezone) |
| **slot-preemption** | ✅ | ✅ | ❌ (unit only) | 15 tests (reserveSlot, idempotency, rate limiting, retries) |
| **auth** | ✅ | ✅ | ❌ | 20+ tests (JWT config, registerComplete, login) |
| **services** | ✅ | ✅ | ❌ | CRUD tests |
| **users** | ✅ | ✅ | ❌ | CRUD tests |
| **notifications** | ✅ | ❌ (gateway spec only) | ❌ | NotificationService + gateway tests |
| **health** | ❌ | ✅ | ❌ | Controller spec only |
| **cache** | ✅ | ❌ | ❌ | Service + strategy specs |
| **email** | ✅ | ❌ | ❌ | Service + worker specs |
| **rate-limiter** | ✅ | ❌ | ❌ | Service + guard + decorator + interceptor specs |
| **stats** | ✅ | ✅ | ❌ | CRUD + calculation tests |
| **retention** | ✅ | ❌ | ❌ | Service spec |
| **encryption/masking** | ✅ (masking.util) | ❌ | ❌ | Util spec |
| **translations** | ✅ | ✅ | ❌ | Service + controller specs |
| **verification** | ✅ | ❌ | ❌ | Service spec |
| **admin (7 sub-modules)** | ✅ (all services) | ✅ (all controllers) | ❌ | Full CRUD per sub-module |

## 4. Frontend TDD Workflow (Angular)

### 4.1 Standard Workflow

Angular TDD follows:
1. Write `.spec.ts` for component/service/store
2. Use Angular Testing Library patterns (per testing-coding-standard.md §7)
3. Run via Jest with `jest-preset-angular`

### 4.2 Test Patterns Found

**Store testing** (e.g., `auth.store.spec.ts`, `booking.store.spec.ts`):
- NgRx SignalStore isolation testing
- Test initial state, computed signals, and method mutations

**Service testing** (e.g., `booking.service.spec.ts`, `api.service.spec.ts`):
- HttpClientTestingModule + HttpTestingController for mocking HTTP
- Custom providers for service DI

**Component testing** (e.g., `my-bookings.component.spec.ts`, `profile.component.spec.ts`):
- ComponentFixture + TestBed setup
- Responsive design tests (`*.responsive.spec.ts`)
- PrimeNG component interaction tests

### 4.3 Test Coverage Status

| Area | Spec Files | Status |
|------|-----------|--------|
| **Stores** (auth, booking) | 2 specs | ✅ |
| **Core Services** (api, csrf, theme, socket, translation, route-resolver) | 6 specs | ✅ |
| **Feature: booking** (service) | 1 spec | ✅ (components untested) |
| **Feature: my-bookings** (component) | 2 specs (component + responsive) | ✅ |
| **Feature: profile** (component) | 2 specs (component + responsive) | ✅ |
| **Feature: auth** (login, register, forgot-password) | 0 specs | ❌ |
| **Feature: admin** (full hierarchy: pages/organisms/molecules/stores) | 0 specs | ❌ |
| **Shared Components** | 0 specs | ❌ |
| **Property-based testing** | 1 spec (shared/testing) | ⚠️ Minimal |

## 5. Compliance Gate Integration

### 5.1 Pre-Commit Hooks (testing-coding-standard.md §13)

```bash
# Must pass before any commit:
1. tsc --noEmit           # TypeScript type check (2-5s)
2. keystone:hash:verify   # Contract hash integrity (0.5s)
3. eslint mock-audit      # Mock strategy enforcement (1-2s)
4. jest --onlyChanged --bail  # Changed file tests (2-5s)
```

### 5.2 ESLint Mock-Audit Integration

The `eslint-audit` MCP tool enforces testing-coding-standard.md §4's test bans:
- **CAT1.1**: `jest.spyOn` / `jest.mock` on TIER1 services (PrismaService, RedisService, ConfigService) → BLOCKER
- **CAT1.3**: TIER3 Mock without argument verification (`expect().toHaveBeenCalledWith()`) → BLOCKER
- **CAT1.2**: `describe.skip` / `it.skip` / `xdescribe` / `xit` → BLOCKER

### 5.3 Code Quality Gate

The `code-quality-gate` MCP tool runs write-time checks after every file edit:
- Agent write scope validation
- Prettier formatting
- ESLint mock-audit (Layer A: single file)
- tsc type checking

### 5.4 Evidence Chain (test_report.json)

Every RED → GREEN transition requires a `test_report.json` with:
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
    "tier1_violations": 0,
    "tier3_args_verified": 3
  }
}
```

## 6. CI/CD Integration

### 6.1 Seven-Stage Pipeline (Planned per testing-coding-standard.md §12)

```
Stage 1 [~3min] → Unit Tests + Lint + Typecheck + Mock-Audit
Stage 2 [~5min] → Integration Tests (Testcontainers, schema-per-worker)
Stage 3 [~10min] → Mutation Tests (core modules, kill≥85%)
Stage 4 [~8min] → E2E Tests (Playwright 3 browsers)
Stage 5 [~3min] → Visual Regression (Playwright screenshots)
Stage 6 [~5min] → Performance Tests (k6, P95<500ms)
Stage 7 [~2min] → Contract Verification (contract.yaml vs API)
```

**⚠️ Critical Gap**: No `.github/workflows/` directory exists on disk. The CI/CD pipeline is documented in requirements but not implemented.

### 6.2 How contract.yaml Drives TDD

Per testing-coding-standard.md §11.2 (ADR-004), contract.yaml should drive automatic test generation:
- `x-test-mock-policy` section declares TIER1/TIER2/TIER3 classification for each service
- `x-test-contract` section enables auto-generation of API endpoint tests
- Contract hash (`keystone`) is verified in pre-commit hooks
- All spec files reference DTOs and enums from contract-driven code (`@prisma/client` enums, shared DTOs)

## 7. Key TDD Workflow Summary

```
1. Task assigned from Task.DAG.json
2. Write spec file first (RED phase)
   → Commit: [Red] {task_id}
   → Verify: test exits with failure code
3. Implement minimal code (GREEN phase)
   → Commit: [Green] {task_id}
   → Verify: all tests pass (exit 0)
4. Refactor under test protection
   → Commit: [Refactor] {task_id}
5. Generate test_report.json with execution_evidence
6. Run compliance_gate_complete → ESLint full scan
7. @Guardian reviews spec + implementation + evidence
8. Merge via PR
```
