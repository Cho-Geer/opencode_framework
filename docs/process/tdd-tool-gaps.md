# TDD Tool Gaps Analysis

## 1. Test Types: Implemented vs Missing

### 1.1 Current Test Distribution

| Test Type | Backend | Frontend | Integration/E2E |
|-----------|---------|----------|-----------------|
| **Unit Tests** | ✅ ~17 modules with specs | ✅ ~13 spec files across services/stores/components | — |
| **Integration Tests (DB)** | ⚠️ appointments (partial), time-slots (full) | ❌ | — |
| **E2E Tests (Playwright)** | ❌ | ❌ | ❌ Not found on disk |
| **Contract Tests** | ❌ | ❌ | ❌ Not implemented |
| **Mutation Tests** | ❌ | ❌ | ❌ Stryker not configured |
| **Property-Based Tests** | ❌ | ⚠️ 1 spec (shared/testing) | ❌ |
| **Performance Tests** | ❌ | ❌ | ❌ k6 scripts not created |
| **Visual Regression** | ❌ | ❌ | ❌ Not configured |

### 1.2 Planned vs Actual (from testing-coding-standard.md §5)

The testing-coding-standard.md v2.0 defines a comprehensive "enhanced test pyramid" including:
- Visual regression tests (Playwright screenshots)
- Chaos tests (Toxiproxy)
- Mutation tests (Stryker)
- Contract tests (from contract.yaml)
- Property tests (fast-check)
- Fuzz tests
- Flaky test detection

**Gap**: Only unit tests and partial integration tests (Testcontainers for 2 modules) are actually implemented. All advanced test types are documented but not operational.

## 2. Coverage Tooling Gaps

### 2.1 Required Thresholds (testing-coding-standard.md §10)

| Priority | Modules | Lines | Branches | Functions | Statement | Mutation Kill |
|----------|---------|:----:|:--------:|:--------:|:--------:|:------------:|
| Global | All | 85% | 80% | 85% | 85% | — |
| P0 | appointments, auth, time-slots, users | 95% | 90% | 95% | 95% | 85% |
| P1 | notifications, cache, rate-limiter, email, verification, translations | 85% | 80% | 85% | 85% | 80% |
| P2 | health, stats, services, retention, encryption, common | 75% | 70% | 75% | 75% | — |

### 2.2 Gap Analysis

- **Coverage reports**: Jest `--coverage` works but actual coverage data has not been gathered or tracked against these thresholds
- **CI enforcement**: No CI pipeline exists to block PRs when coverage falls below thresholds
- **Mutation coverage**: Stryker is required for P0 (85% kill rate) and P1 (80% kill rate) modules, but `stryker.config.json` does not exist
- **Branch coverage specifically**: The 80-90% branch coverage requirements are ambitious; current mock-heavy tests likely miss many conditional branches

## 3. Mocking Strategy Gaps

### 3.1 Current State vs. Three-Tier Model

The testing-coding-standard.md §2 defines a three-tier mock strategy:

| Tier | Required Approach | Current State | Gap |
|------|-------------------|---------------|-----|
| **TIER1** (PrismaService, RedisService, ConfigService) | Real Testcontainers, never jest.spyOn | ⚠️ All current service tests use `jest.fn()` mocks for PrismaService | **CRITICAL** — current mock approach violates TIER1 rule |
| **TIER2** (JwtService, QueueService, NotificationGateway, RateLimiterService) | Use `test/fakes/` implementations | ❌ No `test/fakes/` directory exists on disk | Fake implementations not created |
| **TIER3** (EmailService, PaymentGateway) | Allow jest.mock, must verify calls | ⚠️ Current tests do mock EmailService but argument verification is inconsistent | Some tests verify, some don't |

### 3.2 Specific Violations

All existing service specs (appointments, auth, time-slots, notifications, cache, rate-limiter, email, etc.) use `jest.fn()` mocks for `PrismaService`. This directly violates the TIER1 rule from testing-coding-standard.md §2.2 which states:

> "PrismaService must use Testcontainers real instances. jest.spyOn or jest.mock on PrismaService is strictly prohibited."

The `time-slots.service.spec.ts` has partial TIER1 compliance — it uses `createTestModule()` with a real Prisma connection to Testcontainers. However, this is the only module with integration mode. All others rely solely on mocked Prisma.

## 4. Test Data Isolation Gaps

### 4.1 Required State (testing-coding-standard.md §9)

- Schema-per-worker isolation: Each test file gets a unique PostgreSQL schema
- `testModule.resetDatabase()` after each test
- `test/factories/` directory for reusable test data creation

### 4.2 Current State

| Component | Status | Details |
|-----------|--------|---------|
| **Schema-per-worker isolation** | ❌ | Not implemented. No container-pool.ts or schema management found. |
| **ContainerPool** | ❌ | Documented in ADR-003 but `test/setup/container-pool.ts` does not exist. |
| **RealTestModule** | ❌ | Documented in testing-coding-standard.md §3.2 but `test/setup/real-test-module.ts` does not exist. |
| **test/factories/** | ✅ | Factory helpers found in `test/fixtures/database.fixture.ts` (createTestUser, createTestService, createTestTimeSlot, createTestAppointment) |
| **test/fakes/** | ❌ | Entirely missing. FakePrismaClient, FakeRateLimiter, FakeEventBus, LocalJwtSigner, FakeMessageQueue are documented but none exist on disk. |

## 5. E2E Test Environment Gaps

### 5.1 Required (testing-coding-standard.md §6.2)

- Playwright with Chromium, Firefox, WebKit
- Page Object Model pattern
- Backend + PostgreSQL + Redis services running
- E2E specs in `e2e/` directory

### 5.2 Current State

| Component | Status |
|-----------|--------|
| **Playwright configuration** | ❌ No `playwright.config.ts` exists anywhere |
| **E2E spec files** | ❌ No `.e2e-spec.ts` files found |
| **Page Object Models** | ❌ Not created |
| **Playwright test scripts** | ❌ `package.json` scripts not verified but likely absent |
| **E2E test environment compose** | ❌ No Docker Compose for E2E test infrastructure |

## 6. CI/CD Reporting Gaps

### 6.1 Required (from docs/official_docs/devops/docker/github-actions/test-reporting-coverage.md)

- JUnit XML test reports
- Jest coverage artifacts
- Playwright HTML reports
- PR comments with test summaries
- Flaky test detection

### 6.2 Current State

| Component | Status |
|-----------|--------|
| **GitHub Actions workflows** | ❌ No `.github/workflows/` directory exists |
| **Jest JUnit reporter** | ❌ Not configured (no `jest-junit` dependency specified) |
| **Coverage artifact upload** | ❌ No CI to upload artifacts |
| **PR comment bot** | ❌ Not configured |
| **Flaky test quarantine** | ❌ Not implemented |

## 7. Gap Prioritization & Recommendations

### P0 — Blocking Gaps

| # | Gap | Impact | Recommendation |
|---|-----|--------|---------------|
| **GAP-1** | No CI/CD pipeline (no `.github/workflows/`) | Cannot run tests automatically on PR. No gate enforcement. | Create GitHub Actions workflows per testing-coding-standard.md §12: unit → integration → mutation → E2E |
| **GAP-2** | PrismaService mocked everywhere (TIER1 violation) | Tests miss SQL errors, constraint violations, transaction bugs | Replace Prisma mocks with Testcontainers real instances, starting with P0 modules |
| **GAP-3** | No `test/fakes/` implementations | TIER2 services (Jwt, Queue, NotificationGateway, RateLimiter) are mocked inconsistently | Implement FakeEventBus, FakeRateLimiter, LocalJwtSigner per ADR-001 |
| **GAP-4** | No E2E tests at all | Critical user journeys (booking flow, auth flow) are not validated in realistic environments | Scaffold Playwright + Page Object Model for top 3 flows: registration, booking, admin |

### P1 — Important Gaps

| # | Gap | Impact | Recommendation |
|---|-----|--------|---------------|
| **GAP-5** | Frontend auth feature (login/register/forgot-password) has zero tests | Core security surface of the app is untested | Add Angular TestBed specs for login, register, and forgot-password components |
| **GAP-6** | Frontend admin feature has zero tests | Admin dashboard, user management, and settings are untested | Add component + store tests for admin panel |
| **GAP-7** | No integration tests for 15/17 backend modules | Only time-slots and appointments have real-database integration tests | Add integration test mode (isIntegrationMode path) to all P0 and P1 modules |
| **GAP-8** | No coverage tracking or enforcement | Coverage thresholds are aspirational but unmeasured | Run `jest --coverage`, baseline current coverage, add to CI as non-blocking gate |
| **GAP-9** | No contract tests | API responses may drift from contract.yaml without detection | Implement contract-test-generator per ADR-004; autogenerate endpoint tests from contract.yaml x-test-contract |

### P2 — Recommended Gaps

| # | Gap | Impact | Recommendation |
|---|-----|--------|---------------|
| **GAP-10** | No mutation testing (Stryker) | Test quality is unmeasured; false-positive tests may exist | Add `stryker.config.json` for P0 modules (appointments, auth, time-slots) |
| **GAP-11** | No property-based testing (fast-check) | Mathematical invariants (pricing, time overlaps) tested only by example | Add fast-check for encryption round-trip, price calculation, time-slot overlap detection |
| **GAP-12** | Frontend booking components untested | service-selection, time-slot-picker, booking-confirmation, booking-success have no specs | Add component specs for booking sub-components |
| **GAP-13** | No RealTestModule or ContainerPool | Integration test infrastructure is ad-hoc per module | Implement RealTestModule.forUnit() and RealTestModule.forIntegration() base classes |
| **GAP-14** | `test/performance/` directory empty | Load testing cannot be executed | Create k6 load test scripts per testing-coding-standard.md §5.3 |

## 8. Summary Count

| Severity | Count | Key Areas |
|----------|:-----:|-----------|
| **P0 (Blockers)** | 4 | CI/CD pipeline, TIER1 mock violations, fakes missing, no E2E |
| **P1 (Important)** | 5 | Frontend auth/admin test gaps, integration test coverage, coverage tracking, contract tests |
| **P2 (Recommended)** | 5 | Mutation testing, property-based testing, frontend component gaps, test infrastructure, perf testing |

Total: **14 identified gaps** between documented TDD requirements and current implementation.
