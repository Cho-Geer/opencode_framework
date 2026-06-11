# TDD-Related Work Priorities

## Priority Index

| Level | Definition | Action Required | Timeframe |
|-------|------------|----------------|-----------|
| **P0** | **Blocker** — Missing tests for critical paths, no RED phase evidence, CI pipeline absent | Immediate work stoppage for affected path | 1-3 days |
| **P1** | **Important** — Coverage below threshold, missing integration tests, test quality concerns | Schedule within current sprint | 1-2 weeks |
| **P2** | **Recommended** — Refactoring tests, adding edge cases, extending test types | Schedule in next sprint or backlog | 2-4 weeks |

## P0 — Blockers

### P0-001: No CI/CD Pipeline to Enforce TDD

**Location**: `.github/workflows/` (does not exist)
**Files Affected**: All modules

**Evidence**:
- No `.github/` directory found in `booking_system_refactor/`
- testing-coding-standard.md §12 defines a 7-stage pipeline but it's not implemented
- No automated PR gates for test execution, coverage, or mock-audit

**Definition of Done**:
- [ ] GitHub Actions workflow: `ci-test-pipeline.yml` running Jest unit + integration tests
- [ ] GitHub Actions workflow: `lint-and-typecheck.yml` running ESLint + tsc
- [ ] GitHub Actions workflow: `e2e-tests.yml` running Playwright tests
- [ ] PR status checks enforce: tests pass, coverage ≥ thresholds, mock-audit = 0 violations
- [ ] Workflow should use Docker Compose + Testcontainers for test infrastructure

**References**:
- docs/official_docs/devops/docker/github-actions/ci-test-pipeline-integration.md
- docs/official_docs/devops/docker/github-actions/test-reporting-coverage.md
- testing-coding-standard.md §12

---

### P0-002: TIER1 Mock Violations — PrismaService Mocked in 15+ Modules

**Location**: All backend `*.service.spec.ts` files
**Files**:
- `appointments.service.spec.ts` (line 20-38: mockPrismaService with jest.fn())
- `auth.service.spec.ts` (line 14-30: mockPrismaService with jest.fn())
- `cache.service.spec.ts`, `email.service.spec.ts`, `notification.service.spec.ts`
- `rate-limiter.service.spec.ts`, `slot-preemption.service.spec.ts`, `verification.service.spec.ts`
- `admin-*.service.spec.ts` (7 files)
- `retention.service.spec.ts`, `services.service.spec.ts`, `users.service.spec.ts`
- `stats.service.spec.ts`, `translations.service.spec.ts`

**Violation**: Per testing-coding-standard.md §2.2, PrismaService is TIER1 (REAL-ONLY) and must use Testcontainers. All current specs mock it with `jest.fn()`, violating CAT1.1 rules.

**Definition of Done**:
- [ ] Implement `RealTestModule.forFeature()` and `RealTestModule.forIntegration()` base classes
- [ ] Implement `ContainerPool` with schema-per-worker isolation (ADR-003)
- [ ] Migrate P0 modules (appointments, time-slots, auth, users) to use real PrismaService via Testcontainers
- [ ] Migrate P1 modules to real PrismaService
- [ ] ESLint mock-audit CAT1.1 passes (zero TIER1 violations)
- [ ] test_report.json mock_audit.tier1_violations = 0

**References**:
- docs/official_docs/backend/nestjs/prisma-testing.md (Strategy 2: SQLite, Strategy 5: Testcontainers)
- testing-coding-standard.md §2 (Three-Tier Mock Strategy)
- testing-coding-standard.md §18 ADR-001, ADR-003

---

### P0-003: No E2E Tests — Critical User Journeys Not Validated

**Location**: `booking-frontend/` (no `e2e/` directory), `booking-backend/` (no `.e2e-spec.ts` files)

**Modules Affected**:
- Auth: Registration, login/verification, forgot-password flow
- Booking: Service selection → time slot picker → confirmation → success
- Admin: Dashboard, user management, service management

**Evidence**:
- No `playwright.config.ts` exists
- No `.e2e-spec.ts` or `.spec.e2e.ts` files exist
- No `e2e/` or `tests/` directories for Playwright
- testing-coding-standard.md §5-6 documents E2E requirements but they are unimplemented

**Definition of Done**:
- [ ] Scaffold Playwright with `npx playwright init`
- [ ] `playwright.config.ts` with Chromium + Firefox targets, baseURL, CI mode
- [ ] E2E test: User registration → email verification → login flow
- [ ] E2E test: Full booking flow (select service → pick slot → confirm → view booking)
- [ ] E2E test: Admin dashboard loads with stats
- [ ] E2E spec for concurrent booking race condition (P0 per test strategy docs)
- [ ] Page Object Model for auth, booking, and admin pages

**References**:
- docs/official_docs/devops/testing/playwright-e2e-testing.md
- .opencode/context/requirements/测试策略与计划.md §6.2.4

---

### P0-004: Empty test-tdd Module

**Location**: `booking-backend/src/modules/test-tdd/` (empty directory)

**Evidence**: The `test-tdd` directory exists but contains zero files. This module appears to be a placeholder for TDD-specific work that was never started.

**Definition of Done**:
- [ ] Determine the intended purpose of this module
- [ ] Either remove if abandoned, or implement the intended TDD infrastructure/demos

---

## P1 — Important

### P1-001: Backend Integration Tests Missing for 15/17 Modules

**Location**: All backend `*.service.spec.ts` files except `appointments` and `time-slots`

**Current Status**:
| Module | Unit Tests | Integration Tests (Real DB) |
|--------|:----------:|:--------------------------:|
| appointments | ✅ | ✅ (isIntegrationMode block) |
| time-slots | ✅ | ✅ (full integration via createTestModule) |
| Auth | ✅ | ❌ |
| Slot Preemption | ✅ | ❌ |
| Services | ✅ | ❌ |
| Users | ✅ | ❌ |
| Notifications | ✅ | ❌ |
| Cache | ✅ | ❌ |
| Email | ✅ | ❌ |
| Rate Limiter | ✅ | ❌ |
| Stats | ✅ | ❌ |
| Retention | ✅ | ❌ |
| Translations | ✅ | ❌ |
| Verification | ✅ | ❌ |
| Admin (7 sub-modules) | ✅ | ❌ |

**Definition of Done (P0 modules first)**:
- [ ] Auth service integration tests: register, login, refresh token, password change
- [ ] Slot preemption integration tests: concurrent reservation, version conflict handling
- [ ] Rate limiter integration tests: sliding window enforcement across requests
- [ ] Notification integration tests: WebSocket delivery
- [ ] All integration tests use isIntegrationMode() guard pattern

**References**:
- docs/official_docs/devops/testing/nestjs-testing.md (E2E testing with Supertest)
- docs/official_docs/backend/nestjs/nestjs-controller-service-testing.md (Module testing with DB)

---

### P1-002: Frontend Feature Coverage Gaps

**Location**: `booking-frontend/src/app/features/auth/`, `booking-frontend/src/app/features/admin/`, `booking-frontend/src/app/features/booking/components/`

**Current Status**:
| Feature Area | Spec Files | Coverage Gap |
|-------------|:----------:|-------------|
| Auth: login component | ❌ 0 specs | Covers the primary authentication UI |
| Auth: register component | ❌ 0 specs | Covers user registration with verification code |
| Auth: forgot-password component | ❌ 0 specs | Covers password reset flow |
| Admin: all pages/organisms/molecules | ❌ 0 specs | Admin dashboard is the operations center |
| Booking: service-selection | ❌ 0 specs | Core booking flow step 1 |
| Booking: time-slot-picker | ❌ 0 specs | Core booking flow step 2 |
| Booking: booking-confirmation | ❌ 0 specs | Core booking flow step 3 |
| Booking: booking-success | ❌ 0 specs | Core booking flow step 4 |

**Definition of Done**:
- [ ] Auth login component: renders form, validates email/phone, shows errors, submits successfully
- [ ] Auth register component: renders verification code input, handles countdown timer, form validation
- [ ] Booking components (selection → picker → confirmation → success): full flow component specs
- [ ] Admin dashboard: stat cards render, charts bind correctly, data loads from service
- [ ] Each component spec follows Angular Testing Library patterns

**References**:
- docs/official_docs/frontend/angular/angular-component-testing.md
- docs/official_docs/frontend/angular/angular-http-testing.md
- docs/official_docs/frontend/angular/angular-signal-store-testing.md

---

### P1-003: Missing `test/fakes/` Implementations

**Location**: `booking-backend/test/fakes/` (directory does not exist)

**Required Fakes** (per testing-coding-standard.md §8.3):
- `fake-event-bus.ts` — In-memory pub/sub for NotificationGateway
- `fake-message-queue.ts` — In-memory queue for BullMQ/QueueService
- `local-jwt-signer.ts` — Node.js crypto real JWT signing
- `fake-rate-limiter.ts` — In-memory sliding window rate limiter
- `fake-prisma-client.ts` — Fast in-memory Prisma client for local TDD

**Definition of Done**:
- [ ] `test/fakes/fake-event-bus.ts` with publish/subscribe/unsubscribe API
- [ ] `test/fakes/fake-rate-limiter.ts` with configurable window + limit
- [ ] `test/fakes/local-jwt-signer.ts` with real crypto signing/verification
- [ ] Each fake has its own `.spec.ts` self-test
- [ ] Fakes can be injected via `useClass` or `useFactory` in Test.createTestingModule

---

### P1-004: Coverage Baseline and Tracking

**Location**: All modules (no current coverage measurement)

**Evidence**: No `--coverage` reports have been generated or tracked. Jest config may have coverage thresholds defined, but they cannot block because CI doesn't exist.

**Definition of Done**:
- [ ] Run `npx jest --coverage` on backend and frontend
- [ ] Baseline current coverage percentages for each module
- [ ] Configure `jest.config.ts` with coverageThreshold matching testing-coding-standard.md §10
- [ ] Add coverage reporting to CI pipeline (non-blocking initially, then blocking after baseline improves)
- [ ] Track coverage in `TECH_DEBT_REGISTRY.md`

---

### P1-005: Contract Test Auto-Generation

**Location**: `booking-backend/test/contract-based/` (exists but contents unknown)

**Evidence**: `test/contract-based/` directory exists. `contract.yaml` with `x-test-contract` sections is referenced in testing-coding-standard.md ADR-004. Contract tests are not yet auto-generating from the contract.

**Definition of Done**:
- [ ] Audit existing contract-based/ directory contents
- [ ] Implement or configure contract-test-generator tool
- [ ] Auto-generate endpoint tests from contract.yaml x-test-contract sections
- [ ] Tests cover: positive cases, negative auth cases, negative validation cases
- [ ] Contract tests run in CI Stage 2

---

## P2 — Recommended

### P2-001: Mutation Testing for P0 Modules

**Location**: P0 modules (appointments, auth, time-slots, users)

**Required**: Stryker configuration with ≥85% kill rate for P0, ≥80% for P1

**Definition of Done**:
- [ ] `stryker.config.json` for backend with P0 modules targeted
- [ ] Run mutation testing on appointments module: kill rate ≥85%
- [ ] Run mutation testing on time-slots module: kill rate ≥85%
- [ ] Track results in CI Stage 3

---

### P2-002: Property-Based Testing (fast-check)

**Location**: `shared/testing/property-based.spec.ts` (exists), needs expansion

**Suitable Properties**:
- Encryption round-trip: `decrypt(encrypt(x)) === x`
- Price calculation commutativity
- Time-slot overlap detection symmetry
- Appointment number generation uniqueness

**Definition of Done**:
- [ ] `fast-check` dependency added
- [ ] EncryptionService round-trip property test
- [ ] Time-slot overlap detection symmetric property test
- [ ] Price calculation with tax: `taxIncludedAmount === price * (1 + taxRate)`

---

### P2-003: Frontend Component-Level Tests for Booking Sub-Components

**Location**: `booking-frontend/src/app/features/booking/service-selection/`, `time-slot-picker/`, `booking-confirmation/`, `booking-success/`

**Definition of Done**:
- [ ] service-selection component: renders service list, filters, handles selection
- [ ] time-slot-picker component: renders time slots, handles date change, shows availability
- [ ] booking-confirmation component: displays booking summary, handles confirm/cancel
- [ ] booking-success component: displays success message, booking number, next steps

---

### P2-004: Test Infrastructure: RealTestModule + ContainerPool

**Location**: `test/helpers/` (create-test-module.ts exists) needs to be promoted to `test/setup/real-test-module.ts`

**Definition of Done**:
- [ ] `test/setup/real-test-module.ts` implementing RealTestModule.forUnit() and .forIntegration()
- [ ] `test/setup/container-pool.ts` implementing global container pool with schema-per-worker
- [ ] Auto-detect Docker availability and switch between Fake and Real modes
- [ ] Integration tests use schema-per-worker isolation (ADR-003)

---

### P2-005: Performance Test Scripts

**Location**: `test/performance/` (directory does not exist)

**Definition of Done**:
- [ ] k6 load test for booking creation (100 concurrent users)
- [ ] k6 load test for available slots query (high-read scenario)
- [ ] Performance thresholds documented in CI config

---

### P2-006: Flaky Test Detection and Quarantine

**Definition of Done**:
- [ ] Flaky test auto-detection: same test fails ≥3 times in 7 days → auto-quarantine
- [ ] GitHub Issue auto-creation for quarantined tests
- [ ] Weekly flaky test report generation
- [ ] Quarantined tests do not block CI merges

---

## Priority-to-Module Mapping

| Module | P0 Issues | P1 Issues | P2 Issues |
|--------|:---------:|:---------:|:---------:|
| **CI/CD Pipeline** | P0-001 | — | — |
| **Appointments** | P0-002 | P1-001, P1-004 | P2-001, P2-002 |
| **Time-Slots (+ Preemption)** | P0-002 | P1-001, P1-004 | P2-001, P2-002 |
| **Auth (Backend)** | P0-002 | P1-001, P1-004 | P2-001 |
| **Users** | P0-002 | P1-001, P1-004 | P2-001 |
| **Auth (Frontend)** | — | P1-002, P1-004 | — |
| **Admin (Frontend)** | — | P1-002 | — |
| **Booking (Frontend)** | — | P1-002 | P2-003 |
| **Notifications** | P0-002 | P1-001, P1-003 | — |
| **Cache** | P0-002 | P1-001, P1-004 | — |
| **Email** | P0-002 | P1-001, P1-003 | — |
| **Rate Limiter** | P0-002 | P1-001, P1-003 | — |
| **Admin (Backend)** | P0-002 | P1-001, P1-004 | — |
| **Stats** | P0-002 | P1-001, P1-004 | — |
| **Retention** | P0-002 | P1-001 | — |
| **Translations** | P0-002 | P1-001 | — |
| **Verification** | P0-002 | P1-001, P1-003 | — |
| **Encryption** | — | — | P2-002 |
| **All (Infrastructure)** | P0-004 | P1-003, P1-004, P1-005 | P2-004, P2-005, P2-006 |

## Definition of Done for TDD Tasks

Every TDD-related task must satisfy:

### RED Phase Completeness
- [ ] Spec file written BEFORE implementation
- [ ] Test execution fails with expected error (verified exit code)
- [ ] Commit message tagged `[Red] {task_id}`

### GREEN Phase Completeness
- [ ] Minimum implementation to pass test
- [ ] All existing tests still pass (no regressions)
- [ ] Commit message tagged `[Green] {task_id}`

### Evidence Requirements
- [ ] `test_report.json` generated with:
  - `execution_evidence.exit_code === 0`
  - `coverage.*` meeting module thresholds (testing-coding-standard.md §10)
  - `mock_audit.tier1_violations === 0`
  - `mock_audit.tier3_args_verified` matching mock count
- [ ] `compliance_gate_complete` called (triggers ESLint full scan)

### PR / Merge Requirements
- [ ] All tests pass: unit + integration + E2E (as applicable)
- [ ] Coverage thresholds met (≥95% lines for P0, ≥85% for P1, ≥75% for P2)
- [ ] ESLint mock-audit: 0 violations (CAT1.1, CAT1.2, CAT1.3)
- [ ] Pre-commit hooks pass: tsc, keystone hash, eslint mock-audit
- [ ] @Guardian review with testing-coding-standard.md §15 checklist
