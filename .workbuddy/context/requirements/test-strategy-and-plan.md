---
trigger: manual
alwaysApply: false
---
# Test Strategy and Plan

## 1. Overview

### 1.1 Document Purpose
This document defines the test strategy, test types, test plan, and quality standards for the Booking system (Angular + NestJS rebuilt version), ensuring the system meets requirements in functionality, performance, security, and user experience. This test strategy strictly follows the RED/GREEN TDD (Test-Driven Development) process to ensure consistency between code quality and architectural decisions.

### 1.2 Test Scope
- **Backend API**: booking-backend (NestJS application)
- **Frontend Application**: booking-frontend (Angular application)
- **End-to-End Flows**: User authentication, booking management, service management, email notification, and other complete business flows
- **Non-Functional Requirements**: Performance, security, compatibility, accessibility
- **TDD Process**: RED/GREEN cycle for unit tests, integration tests, and end-to-end tests

## 2. RED/GREEN TDD Test-Driven Design

### 2.1 TDD Core Principles
Follow the "Red-Green-Refactor" cycle to ensure test coverage for all functionality:
1. **RED**: Write failing test cases first, defining expected behavior
2. **GREEN**: Write minimal code to pass the tests
3. **REFACTOR**: Optimize code structure while keeping tests passing

### 2.2 TDD Workflow
```
New Feature Development → Write Unit Tests (RED) → Implement Feature (GREEN) → Refactor
         ↓
Write Integration Tests (RED) → Integration Implementation (GREEN) → Refactor
         ↓
Write E2E Tests (RED) → End-to-End Validation (GREEN) → Deliver
```

### 2.3 TDD Quality Gates
- **Test-First**: Any new feature development must begin with writing tests
- **Test Pass Rate**: 100% test pass rate required before code submission
- **Refactoring Safety Net**: All refactoring must be performed under test protection
- **Continuous Feedback**: Fix test failures immediately to maintain codebase health

## 3. Test Pyramid Strategy

### 3.1 Test Layer Division
```
        ┌─────────────────┐
        │  End-to-End Tests│ (10%)
        │   (E2E Tests)    │
        └─────────────────┘
               │
        ┌─────────────────┐
        │ Integration Tests│ (20%)
        │   (API Tests)    │
        └─────────────────┘
               │
        ┌─────────────────┐
        │   Unit Tests     │ (70%)
        │(Component/Service│
        │     Tests)       │
        └─────────────────┘
```

### 3.2 Test Objectives by Layer and TDD Integration
1. **Unit Tests**: Verify correctness of individual functions, components, and services using TDD development mode
2. **Integration Tests**: Verify correctness of inter-module interfaces and data flow, built upon unit tests
3. **End-to-End Tests**: Verify complete business flows and user experience, serving as final acceptance criteria

### 3.3 Test Tools and Technology Stack Alignment
| Test Level | Frontend Tool | Backend Tool | Technology Stack Basis |
|---------|---------|---------|----------|
| **Unit Testing** | Jest + Angular Testing Library | Jest + ts-jest | [Technology Stack Recommendation §3.4](技术栈推荐方案.md#34-开发工具与质量) |
| **Integration Testing** | Component Integration Testing | Jest + Supertest + Testcontainers | [System Architecture Design Document §4.3](系统架构设计文档（SAD）.md#43-数据访问层) |
| **End-to-End Testing** | Playwright | - | [Technology Stack Recommendation §3.4](技术栈推荐方案.md#34-开发工具与质量) |

## 4. Test Environment Configuration

### 4.1 Test Environment Matrix
| Environment Type | Backend | Frontend | Database | Cache | Purpose |
|---------|------|------|--------|------|------|
| **Unit Testing** | Mock | Mock | In-Memory Database | Mock | Fast logic validation, TDD development |
| **Integration Testing** | Real Instance | Real Instance | Testcontainers | Testcontainers | Interface validation, module integration |
| **End-to-End Testing** | Real Instance | Real Instance | Testcontainers | Testcontainers | Complete flow validation, user acceptance |
| **CI/CD Testing** | Real Instance | Real Instance | Testcontainers | Testcontainers | Automated validation, deployment gate |

### 4.2 Test Data Management
1. **Test Data Isolation**: Each test case uses independent data to avoid mutual interference
2. **Data Cleanup**: Automatically clean up test data after test completion
3. **Data Factory**: Use factory pattern to generate test data, supporting rapid TDD iteration. Test data factories are uniformly stored in the `test/factories/` directory, such as `user.factory.ts`, `appointment.factory.ts`, `service.factory.ts`, etc.
4. **Concurrent Test Data**: Special test data design for high-concurrency booking scenarios, aligned with the concurrency scenarios in [Data Architecture Design Document §11.2](数据架构设计文档.md#112-并发冲突处理场景)

## 5. Backend Test Strategy (NestJS)

### 5.1 Unit Testing (TDD Core Layer)
#### 5.1.1 Testing Framework
- **Framework**: Jest + ts-jest
- **Assertion Library**: Jest built-in assertions
- **Mock Library**: Jest Mock functionality

#### 5.1.2 Coverage Requirements
```javascript
// Coverage thresholds in jest.config.js
coverageThreshold: {
  global: {
    branches: 70,    // Branch coverage ≥70%
    functions: 70,   // Function coverage ≥70%
    lines: 70,       // Line coverage ≥70%
    statements: 70,  // Statement coverage ≥70%
  },
}
```

#### 5.1.3 TDD Test Scope
1. **Service Layer Tests**: Business logic validation, including booking conflict handling logic (based on [Data Architecture Design Document §4.2](数据架构设计文档.md#42-高并发优化策略))
2. **Controller Tests**: Request handling validation, aligned with [API Design Specification Document §2.1](接口设计规范文档.md#21-restful-api设计规范)
3. **Middleware Tests**: Authentication, authorization, validation middleware, aligned with [Security Architecture Design Document §3.1](安全架构设计文档.md#31-认证体系)
4. **Utility Function Tests**: Utility classes, helper functions
5. **Script Tests**: Data retention scripts, etc.

#### 5.1.4 Excluded Items
```javascript
collectCoverageFrom: [
  'src/**/*.(t|j)s',
  '!src/main.ts',          // Entry file
  '!src/**/*.module.ts',   // Module files
  '!src/**/*.dto.ts',      // DTO definitions
  '!src/**/*.entity.ts',   // Entity definitions
]
```

### 5.2 Integration Testing (E2E Testing)
#### 5.2.1 Testing Framework
- **Framework**: Jest + Supertest + Testcontainers
- **Database**: PostgreSQL Testcontainers
- **Cache**: Redis Testcontainers

#### 5.2.2 Test Configuration
```json
// test/jest-e2e.json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "setupFilesAfterEnv": ["./test/setup.ts"],
  "globalTeardown": "./test/teardown.ts",
  "testTimeout": 30000
}
```

#### 5.2.3 Test Case Coverage
| Test Suite | Test File | Main Test Scenarios | TDD Phase |
|---------|---------|------------|--------|
| **Auth Tests** | `auth.e2e-spec.ts` | User registration, login, token refresh, logout | Integration Test GREEN |
| **Email Verification Code Tests** | `email-verification.e2e-spec.ts` | Send verification code, verify code, rate limiting, type isolation | Integration Test GREEN |
| **User Management Tests** | `users.e2e-spec.ts` | User information query, update, delete | Integration Test GREEN |
| **Booking Management Tests** | `bookings.e2e-spec.ts` | Booking creation, query, update, cancellation | Integration Test GREEN |
| **Concurrent Booking Tests** | `booking-concurrency.e2e-spec.ts` | Concurrent booking conflict handling, atomic preemption mechanism validation | Integration Test GREEN |
| **Service Management Tests** | `services-admin.e2e-spec.ts` | Service creation, update, delete, query | Integration Test GREEN |
| **Email Notification Tests** | `email.e2e-spec.ts` | Booking confirmation, reminder email sending | Integration Test GREEN |
| **Data Retention Tests** | `retention.e2e-spec.ts` | Automatic cleanup of expired data | Integration Test GREEN |
| **Reset Password Tests** | `reset-password.e2e-spec.ts` | Send verification code, verify code, reset password, rate limiting | Integration Test GREEN |

#### 5.2.4 Test Data Management
```typescript
// test/setup.ts example
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  prisma = app.get(PrismaService);
  // Clean up test data
  await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
});

afterAll(async () => {
  await app.close();
});
```

#### 5.2.5 Email Verification Code Test Cases

Email verification code feature testing follows the TDD development process, ensuring correctness of security mechanisms such as Redis storage, rate limiting, and type isolation.

##### Backend Unit Tests (RED/GREEN)
```typescript
// email-verification.service.spec.ts
describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let redisService: jest.Mocked<RedisService>;
  let emailService: jest.Mocked<EmailService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        {
          provide: RedisService,
          useValue: {
            setex: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendVerificationCode: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
    redisService = module.get(RedisService);
    emailService = module.get(EmailService);
  });

  describe('sendCode', () => {
    it('RED: Should generate a 6-digit verification code and store it in Redis', async () => {
      // GIVEN: Valid email and verification code type
      const email = 'test@example.com';
      const type = VerificationCodeType.REGISTER;

      // WHEN: Send verification code
      await service.sendCode(email, type);

      // THEN: Verify Redis storage call
      expect(redisService.setex).toHaveBeenCalledWith(
        `verification:email:${email}:${type}`,
        300, // TTL: 5 minutes
        expect.stringMatching(/^\d{6}$/), // 6-digit number
      );
    });

    it('GREEN: Should call email service to send verification code', async () => {
      // GIVEN
      const email = 'test@example.com';
      const type = VerificationCodeType.REGISTER;

      // WHEN
      await service.sendCode(email, type);

      // THEN
      expect(emailService.sendVerificationCode).toHaveBeenCalledWith(
        email,
        expect.any(String),
        type,
      );
    });
  });

  describe('verifyCode', () => {
    it('RED: Should return true and delete verification code from Redis when code matches', async () => {
      // GIVEN: Stored verification code
      const storedCode = '123456';
      redisService.get.mockResolvedValue(storedCode);

      // WHEN: Verify correct code
      const result = await service.verifyCode(
        'test@example.com',
        storedCode,
        VerificationCodeType.REGISTER,
      );

      // THEN
      expect(result).toBe(true);
      expect(redisService.del).toHaveBeenCalledWith(
        'verification:email:test@example.com:REGISTER',
      );
    });

    it('RED: Should throw exception when verification code is incorrect', async () => {
      // GIVEN: Stored verification code
      redisService.get.mockResolvedValue('123456');

      // WHEN & THEN: Verify incorrect code
      await expect(
        service.verifyCode(
          'test@example.com',
          '654321', // Incorrect code
          VerificationCodeType.REGISTER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('GREEN: Should throw exception when verification code has expired', async () => {
      // GIVEN: No stored verification code in Redis
      redisService.get.mockResolvedValue(null);

      // WHEN & THEN
      await expect(
        service.verifyCode(
          'test@example.com',
          '123456',
          VerificationCodeType.REGISTER,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
```

##### Backend Integration Tests (RED/GREEN)
```typescript
// email-verification.e2e-spec.ts
describe('Email Verification (e2e)', () => {
  const app = new INestApplication();
  const redisContainer = new RedisContainer().start();

  beforeAll(async () => {
    await app.init();
  });

  afterAll(async () => {
    await redisContainer.stop();
    await app.close();
  });

  describe('POST /v1/auth/register/send-code', () => {
    it('RED: Sending registration verification code should return 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/register/send-code')
        .send({
          contact: 'newuser@example.com',
          contactType: 'email',
        })
        .expect(200);

      expect(response.body.message).toContain('Verification code sent');
      expect(response.body.data.expiresIn).toBe(300);
    });

    it('RED: Invalid email format should return 400', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register/send-code')
        .send({
          contact: 'invalid-email',
          contactType: 'email',
        })
        .expect(400);
    });

    it('GREEN: Exceeding rate limit should return 429', async () => {
      // Send 6 verification codes (limit is 5/minute)
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/v1/auth/register/send-code')
          .send({
            contact: 'rate-limit@example.com',
            contactType: 'email',
          });
      }

      // 6th attempt should be rate-limited
      await request(app.getHttpServer())
        .post('/v1/auth/register/send-code')
        .send({
          contact: 'rate-limit@example.com',
          contactType: 'email',
        })
        .expect(429);
    });
  });

  describe('POST /v1/auth/register/complete', () => {
    it('RED: Correct verification code should verify successfully', async () => {
      // 1. Send verification code
      await request(app.getHttpServer())
        .post('/v1/auth/register/send-code')
        .send({
          contact: 'verify@example.com',
          contactType: 'email',
        });

      // 2. Retrieve verification code from Redis (test environment)
      const code = await redisContainer.getClient().get(
        'verify:register:{contactHash}',
      );

      // 3. Verify code and complete registration
      const verifyResponse = await request(app.getHttpServer())
        .post('/v1/auth/register/complete')
        .send({
          contact: 'verify@example.com',
          contactType: 'email',
          code: code,
          password: 'TestPass123',
          name: 'Test User',
        })
        .expect(201);

      expect(verifyResponse.body.data.accessToken).toBeDefined();
    });

    it('GREEN: Verification code should be deleted after verification (one-time use)', async () => {
      // Send verification code
      await request(app.getHttpServer())
        .post('/v1/auth/login/send-code')
        .send({
          contact: 'once@example.com',
          contactType: 'email',
        });

      const code = await redisContainer.getClient().get(
        'verify:login:{contactHash}',
      );

      // Complete login verification (one-time use code)
      await request(app.getHttpServer())
        .post('/v1/auth/login/verify-code')
        .send({
          contact: 'once@example.com',
          contactType: 'email',
          code: code,
        });

      // Verification code should have been deleted
      const deletedCode = await redisContainer.getClient().get(
        'verify:login:{contactHash}',
      );
      expect(deletedCode).toBeNull();
    });
  });
});
```

##### Test Coverage Matrix
| Test Scenario | Unit Tests | Integration Tests | E2E Tests |
|---------|---------|---------|---------|
| Verification code generation | ✅ | ✅ | - |
| Redis storage | ✅ | ✅ | ✅ |
| TTL expiration | ✅ | ✅ | ✅ |
| Verification code matching | ✅ | ✅ | ✅ |
| Verification code error | ✅ | ✅ | ✅ |
| Rate limiting | - | ✅ | ✅ |
| Type isolation | ✅ | ✅ | ✅ |
| One-time use | ✅ | ✅ | ✅ |
| Email format validation | - | ✅ | ✅ |

#### 5.2.6 Financial Fields and Overtime Test Scenarios [v2.4.0]

> **New Description**: The Service model adds pricePerMinute/taxRate, and the Appointment model adds durationMinutes/price/taxRate/taxIncludedAmount, requiring corresponding integration test coverage.

##### Test Case Checklist

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **FIN-001** | Verify price/taxRate are correctly snapshotted from Service when creating booking, including overtimeMinutes scenario | Integration Test | Appointment.price == Service.price, Appointment.taxRate == Service.taxRate, overtime fields correctly persisted |
| **FIN-002** | Verify taxIncludedAmount = price * (1 + taxRate) | Integration Test | Calculated value is correct |
| **FIN-003** | Service price changes do not affect existing booking snapshot values | Integration Test | After updating Service.price, existing Appointment.price is unchanged |
| **OVERTIME-001** | Overtime booking: overtime_minutes field correctly persisted to Appointment.durationMinutes | Integration Test | durationMinutes = original duration + overtime_minutes |
| **TAX-001** | taxIncludedAmount equals price when taxRate is null | Integration Test | Null tax rate scenario handled correctly |

##### Backend Integration Test Example (FIN-001)

```typescript
// financial-fields.e2e-spec.ts
describe('Financial Fields (e2e)', () => {
  describe('POST /v1/appointments — price/taxRate snapshot', () => {
    it('FIN-001: price and taxRate should be snapshotted from Service when creating booking', async () => {
      // 1. Create Service with pricePerMinute and taxRate
      const service = await createTestService({
        price: 100.00,
        pricePerMinute: 10.00,
        taxRate: 0.0800,
      });

      // 2. Create booking for this Service
      const response = await request(app.getHttpServer())
        .post('/v1/appointments')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          timeSlotId: testSlot.id,
          serviceId: service.id,
          appointmentDate: '2026-05-15T10:00:00.000Z',
          preferredSequence: 1,
          customerInfo: {},
        })
        .expect(201);

      // 3. Verify snapshot values
      expect(response.body.data.booking.price).toBe(100.00);
      expect(response.body.data.booking.taxRate).toBe(0.0800);
      expect(response.body.data.booking.taxIncludedAmount).toBe(108.00);
    });
  });
});
```

#### 5.2.8 Admin Dashboard Integration Tests [v2.1.0]

> **New Description**: Admin Dashboard backend statistics functionality requires coverage at both integration test (backend) and component test (frontend) levels, ensuring data correctness across four dimensions: statistics cards, trend charts, service distribution, and time distribution.

##### Test Case Checklist

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **DASH-001** | Verify core statistics cards return correct nested `StatCardDto` structure | Integration Test (Backend) | HTTP 200, response contains `todayBookings`/`pendingBookings`/`activeUsers`/`totalRevenue` four `StatCardDto` objects, each with `value`/`changePercentage`/`isPositive`/`target`/`progressPercentage` |
| **DASH-002** | Verify booking trends return `{date, count, revenue}[]` array with complete fields per item | Integration Test (Backend) | HTTP 200, `data` is an array with length > 0, each item contains `date`/`count`/`revenue` fields |
| **DASH-003** | Verify service distribution returns `serviceName`/`count`/`percentage` fields with percentage sum = 100 | Integration Test (Backend) | HTTP 200, sum of all `percentage` values ≈ 100 (allowing floating point error) |
| **DASH-004** | Verify time distribution returns `hour` (0-23) / `count` fields | Integration Test (Backend) | HTTP 200, each item contains `hour` and `count` properties |

##### Component Tests (Frontend)

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **DASH-FE-001** | Verify Dashboard component renders statistics cards displaying values and progress bars correctly | Component Test (Frontend) | Cards render 4 statistics values, progress bar width matches `progressPercentage` |
| **DASH-FE-002** | Verify Chart.js trend chart binds `data: {date, count, revenue}[]` object array correctly | Component Test (Frontend) | Chart.js instance receives correct dataset, `data` array items each contain `date`/`count`/`revenue` fields |
| **DASH-FE-003** | Verify service distribution doughnut chart data binding is correct | Component Test (Frontend) | Doughnut chart segment count matches service count, labels show `serviceName` + `percentage` |

##### Coverage Requirements

- **Backend**: All Admin Stats Service method coverage ≥ 70% (lines/branches/functions/statements)
- **Frontend**: Dashboard related component coverage ≥ 70%
- **Test Level**: Integration Tests (Backend) + Component Tests (Frontend)

##### Backend Integration Test Example (DASH-001)

```typescript
// admin-stats.e2e-spec.ts
describe('Admin Dashboard Stats (e2e)', () => {
  describe('GET /v1/admin/stats', () => {
    it('DASH-001: Should return correct nested StatCardDto structure', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/stats?timeRange=last7d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { data } = response.body;
      
      // Verify structure of four core statistics cards
      const cardFields = ['todayBookings', 'pendingBookings', 'activeUsers', 'totalRevenue'];
      for (const field of cardFields) {
        expect(data[field]).toMatchObject({
          value: expect.any(Number),
          changePercentage: expect.any(Number),
          isPositive: expect.any(Boolean),
          target: expect.any(Number),
          progressPercentage: expect.any(Number),
        });
      }
    });

    it('DASH-002: Booking trends should return array with complete fields per item', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/stats/booking-trends?range=weekly&granularity=day')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const data = response.body.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      for (const item of data) {
        expect(item).toHaveProperty('date');
        expect(item).toHaveProperty('count');
        expect(item).toHaveProperty('revenue');
        expect(typeof item.date).toBe('string');
        expect(typeof item.count).toBe('number');
        expect(typeof item.revenue).toBe('number');
      }
    });

    it('DASH-003: Service distribution percentage sum should be close to 100', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/stats/service-distribution?timeRange=last30d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const totalPercentage = response.body.data.reduce(
        (sum: number, item: any) => sum + item.percentage, 0
      );
      expect(totalPercentage).toBeCloseTo(100, 0); // Allow ±0.5 floating point error
    });

    it('DASH-004: Time distribution should contain hour and count fields', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/stats/time-distribution?timeRange=last7d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      for (const item of response.body.data) {
        expect(item).toHaveProperty('hour');
        expect(item).toHaveProperty('count');
        expect(item.hour).toBeGreaterThanOrEqual(0);
        expect(item.hour).toBeLessThanOrEqual(23);
        expect(item.count).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
```

#### 5.2.7 Reset Password Test Scenarios [v2.2.0]

> **New Description**: contract.yaml v1.6.5 adds RESET-PW-001 (POST /v1/auth/reset-password/send-code) and RESET-PW-002 (POST /v1/auth/reset-password/verify) endpoints, requiring corresponding integration test and E2E test coverage.

##### Test Case Checklist

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **RESET-PW-001-A** | Send reset password verification code: valid registered contact should return 200 | Integration Test (Backend) | HTTP 200, `data.expiresIn === 300` |
| **RESET-PW-001-B** | Send reset password verification code: unregistered contact should silently return 200 (anti-user enumeration) | Integration Test (Backend) | HTTP 200, does not leak user existence |
| **RESET-PW-001-C** | Send reset password verification code: exceeding rate limit (6/min) should return 429 | Integration Test (Backend) | First 5 return 200, 6th returns 429 |
| **RESET-PW-001-D** | Send reset password verification code: invalid contact format should return 400 | Integration Test (Backend) | HTTP 400, error code VALIDATION_ERROR |
| **RESET-PW-002-A** | Verify and reset password: correct code + compliant new password should return 200 | Integration Test (Backend) | HTTP 200, `message === "Password reset successful"`, can login with new password |
| **RESET-PW-002-B** | Verify and reset password: incorrect code should return 400 | Integration Test (Backend) | HTTP 400, indicates "Invalid verification code" |
| **RESET-PW-002-C** | Verify and reset password: expired code should return 400 | Integration Test (Backend) | After waiting for Redis TTL expiry, HTTP 400 |
| **RESET-PW-002-D** | Verify and reset password: new password does not meet strength rules (< 8 characters) should return 400 | Integration Test (Backend) | HTTP 400, VALIDATION_ERROR |
| **RESET-PW-002-E** | Verify and reset password: login with old password after reset should return 401 | Integration Test (Backend) | Old password invalidated, HTTP 401 |

##### Backend Integration Test Example

```typescript
// reset-password.e2e-spec.ts
describe('Reset Password (e2e)', () => {

  describe('POST /v1/auth/reset-password/send-code', () => {
    it('RESET-PW-001-A: Registered email should send verification code and return 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/reset-password/send-code')
        .send({
          contact: 'registered@example.com',
          contactType: 'email',
        })
        .expect(200);

      expect(response.body.data.expiresIn).toBe(300);
      expect(response.body.message).toContain('Verification code sent');
    });

    it('RESET-PW-001-B: Unregistered email should silently return 200 (anti-enumeration)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/reset-password/send-code')
        .send({
          contact: 'nonexistent@example.com',
          contactType: 'email',
        })
        .expect(200);

      // Response should not leak whether user exists
      expect(response.body.data).toBeDefined();
      expect(response.body.data.expiresIn).toBe(300);
    });

    it('RESET-PW-001-C: Exceeding rate limit should return 429', async () => {
      // 5/minute/contact rate limit
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/v1/auth/reset-password/send-code')
          .send({ contact: 'ratelimit@example.com', contactType: 'email' })
          .expect(200);
      }

      // 6th attempt should be rate-limited
      await request(app.getHttpServer())
        .post('/v1/auth/reset-password/send-code')
        .send({ contact: 'ratelimit@example.com', contactType: 'email' })
        .expect(429);
    });
  });

  describe('POST /v1/auth/reset-password/verify', () => {
    it('RESET-PW-002-A: Correct verification code should reset password successfully', async () => {
      // 1. Send verification code
      await request(app.getHttpServer())
        .post('/v1/auth/reset-password/send-code')
        .send({ contact: 'reset-test@example.com', contactType: 'email' });

      // 2. Get verification code from Redis
      const code = await redisClient.get('verify:reset:{contactHash}');

      // 3. Verify and reset password
      const response = await request(app.getHttpServer())
        .post('/v1/auth/reset-password/verify')
        .send({
          contact: 'reset-test@example.com',
          contactType: 'email',
          code: code,
          newPassword: 'NewSecureP@ss123',
        })
        .expect(200);

      expect(response.body.message).toBe('Password reset successful');
    });

    it('RESET-PW-002-D: New password less than 8 characters should return 400', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/reset-password/send-code')
        .send({ contact: 'shortpwd@example.com', contactType: 'email' });

      const code = await redisClient.get('verify:reset:{contactHash}');

      await request(app.getHttpServer())
        .post('/v1/auth/reset-password/verify')
        .send({
          contact: 'shortpwd@example.com',
          contactType: 'email',
          code: code,
          newPassword: 'short', // < 8 characters
        })
        .expect(400);
    });

    it('RESET-PW-002-E: Old password should be invalid after reset', async () => {
      // Login with new password should succeed
      const loginRes = await request(app.getHttpServer())
        .post('/v1/auth/login/password')
        .send({
          contact: 'reset-test@example.com',
          contactType: 'email',
          password: 'NewSecureP@ss123',
        })
        .expect(200);

      expect(loginRes.body.data.accessToken).toBeDefined();

      // Login with old password should fail
      await request(app.getHttpServer())
        .post('/v1/auth/login/password')
        .send({
          contact: 'reset-test@example.com',
          contactType: 'email',
          password: 'OldPassword123',
        })
        .expect(401);
    });
  });
});
```

##### Test Coverage Matrix (Reset Password)

| Test Scenario | Unit Tests | Integration Tests | E2E Tests |
|---------|---------|---------|---------|
| Send verification code (registered user) | ✅ | ✅ | ✅ |
| Send verification code (unregistered user, anti-enumeration) | ✅ | ✅ | - |
| Send verification code rate limiting (5/min) | - | ✅ | ✅ |
| Verification code matching | ✅ | ✅ | ✅ |
| Verification code error prompt | ✅ | ✅ | ✅ |
| Verification code expiration handling | ✅ | ✅ | - |
| New password strength validation | ✅ | ✅ | ✅ |
| New password persistence (login verification) | - | ✅ | ✅ |
| Old password invalidation verification | - | ✅ | - |

##### E2E Test Scenario Extensions

Newly added to E2E test scenario coverage in §6.2.4:
- **Forgot Password Flow**: Click "Forgot Password" link on login page → enter contact → send verification code → enter code + new password → reset successful → redirect to login page and login with new password

```typescript
// e2e/forgot-password.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Forgot Password Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login');
  });

  test('Clicking forgot password link should navigate to forgot password page', async ({ page }) => {
    await page.click('button:has-text("Forgot Password")');
    await expect(page).toHaveURL('/auth/forgot-password');
  });

  test('Send verification code button should work correctly', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Send Code")');
    await expect(page.locator('.toast-success')).toContainText('Verification code sent');
  });

  test('Complete forgot password flow', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    
    // Step 1: Enter email and send verification code
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Send Code")');
    await expect(page.locator('input[placeholder*="Verification Code"]')).toBeVisible();

    // Step 2: Enter verification code and new password
    await page.fill('input[placeholder*="Verification Code"]', '123456');
    await page.fill('input[type="password"]', 'NewSecureP@ss123');
    await page.click('button:has-text("Reset Password")');

    // Verify success prompt
    await expect(page.locator('.toast-success')).toContainText('Password reset successful');
    
    // Should navigate to login page
    await expect(page).toHaveURL('/auth/login');
  });

  test('Incorrect verification code should display error prompt', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Send Code")');
    await page.fill('input[placeholder*="Verification Code"]', '000000');
    await page.fill('input[type="password"]', 'NewSecureP@ss123');
    await page.click('button:has-text("Reset Password")');
    await expect(page.locator('.toast-error')).toContainText('Invalid verification code');
  });
});
```

### 5.3 Performance Testing
#### 5.3.1 Test Scenarios
1. **API Response Time**: P95 response time for critical API endpoints < 500ms (aligned with [Technology Stack Recommendation §1.2](技术栈推荐方案.md#12-非功能需求))
2. **Concurrent Processing**: Support 100+ concurrent users making bookings simultaneously, verifying atomic preemption mechanism
3. **Database Performance**: Complex query execution time < 100ms

#### 5.3.2 Test Tools
- **Load Testing**: k6, Artillery
- **Performance Monitoring**: Node.js performance monitoring, database query analysis
- **Performance Test Script Location**: All performance test scripts are uniformly stored in the `test/performance/` directory, triggered periodically by CI

#### 5.3.3 k6 Load Test Example
The following is a simplified k6 test script example for testing concurrent performance of the booking creation API:

```javascript
// test/performance/booking-create-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Custom metrics
const bookingSuccessRate = new Rate('booking_success_rate');
const bookingDuration = new Trend('booking_duration');
const bookingErrors = new Counter('booking_errors');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Gradually increase to 50 VUs in 30s
    { duration: '1m', target: 100 },   // Hold at 100 VUs for 1 minute
    { duration: '30s', target: 0 },    // Gradually decrease to 0 in 30s
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // 95% of request response times < 500ms
    'booking_success_rate': ['rate>0.95'], // Success rate > 95%
    'http_req_failed': ['rate<0.05'],   // Failure rate < 5%
  },
};

// Setup function (optional)
export function setup() {
  // Get test token or other initialization operations
  const loginRes = http.post('http://localhost:3000/auth/login', {
    phone: 'test-user',
    password: 'test-password',
  });
  
  return { authToken: loginRes.json('token') };
}

// Main test function
export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.authToken}`,
  };
  
  const payload = JSON.stringify({
    serviceId: 'test-service-id',
    slotId: 'test-slot-id',
    customerName: 'Test User',
    customerPhone: '13800138000',
    notes: 'Performance test booking',
  });
  
  const startTime = Date.now();
  const response = http.post(
    'http://localhost:3000/api/bookings',
    payload,
    { headers }
  );
  const endTime = Date.now();
  
  // Verify response
  const success = check(response, {
    'status is 201': (r) => r.status === 201,
    'response has bookingId': (r) => r.json('bookingId') !== undefined,
  });
  
  // Record metrics
  bookingSuccessRate.add(success);
  bookingDuration.add(endTime - startTime);
  
  if (!success) {
    bookingErrors.add(1);
    console.error(`Request failed: ${response.status} - ${response.body}`);
  }
  
  sleep(1); // 1 second interval between each VU request
}

// Teardown function (optional)
export function teardown(data) {
  // Clean up test data or other cleanup operations
  console.log('Performance test completed');
}
```

**Execution Command**:
```bash
# Run performance tests locally
k6 run test/performance/booking-create-load-test.js

# Specify VUs and duration
k6 run --vus 100 --duration 30s test/performance/booking-create-load-test.js

# Run performance tests in CI/CD
npm run test:performance
```

## 6. Frontend Test Strategy (Angular)

### 6.1 Unit Testing (TDD Core Layer)
#### 6.1.1 Testing Framework
- **Framework**: Jest + Angular Testing Library
- **DOM Testing**: @testing-library/dom
- **Angular Testing**: @testing-library/angular
- **User Interaction**: @testing-library/user-event

#### 6.1.2 Test Scope
1. **Component Tests**: UI component rendering and interaction, including PrimeNG component integration tests
2. **Service Tests**: Angular service tests, including HTTP client tests
3. **NgRx Signals Tests**: State management logic tests (based on the NgRx Signals solution from [Technology Stack Recommendation §3.1](技术栈推荐方案.md#31-核心框架))
4. **Utility Function Tests**: Utility classes, formatting functions
5. **Form Tests**: Reactive form validation and submission

#### 6.1.3 NgRx Signals Test Pattern
```typescript
// NgRx Signals state management test example
describe('BookingStore', () => {
  let store: BookingStore;
  
  beforeEach(() => {
    store = new BookingStore();
  });
  
  it('should initialize with empty bookings', () => {
    expect(store.bookings()).toEqual([]);
  });
  
  it('should add booking to store', () => {
    const booking = createTestBooking();
    store.addBooking(booking);
    
    expect(store.bookings()).toContain(booking);
    expect(store.bookingsCount()).toBe(1);
  });
});
```

#### 6.1.4 Test Configuration
```javascript
// Angular configuration in jest.config.js
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/dist/'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      stringifyContentPathRegex: '\\.(html|svg)$',
    },
  },
  moduleNameMapper: {
    '@app/(.*)': '<rootDir>/src/app/$1',
    '@core/(.*)': '<rootDir>/src/app/core/$1',
    '@shared/(.*)': '<rootDir>/src/app/shared/$1',
  },
};
```

### 6.2 End-to-End Testing (E2E Testing)
#### 6.2.1 Testing Framework
- **Framework**: Playwright
- **Browser**: Chromium (default), Firefox, WebKit
- **Test Modes**: Headless mode, headed mode, UI mode

#### 6.2.2 Test Scripts
```bash
# Run E2E tests
npm run test:e2e           # Headless mode
npm run test:e2e:headed    # Headed mode
npm run test:e2e:ui        # UI mode
npm run test:e2e:debug     # Debug mode
```

#### 6.2.3 Test Environment Requirements
1. **Backend Service**: Running backend API service
2. **Database**: PostgreSQL database
3. **Cache**: Redis cache
4. **Email Service**: Test email service or mock

#### 6.2.4 Test Scenario Coverage
1. **User Registration Flow**: New user registration, verification code validation
2. **Email Verification Code Flow**: Send verification code, enter verification code, verification success/failure feedback
3. **Login Flow**: User login, remember me feature
4. **Booking Flow**: Select service, select time, fill information, confirm booking
5. **Booking Management**: View booking list, cancel booking, rebook
6. **Service Management** (Admin): Service creation, editing, deletion
7. **User Management** (Admin): User query, status management

#### 6.2.5 Email Verification Code Frontend E2E Test Cases

```typescript
// e2e/email-verification.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Email Verification Code Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to registration page
    await page.goto('/register');
  });

  test('Send verification code button should work correctly', async ({ page }) => {
    // Fill in email
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code button
    await page.click('button:has-text("Send Code")');

    // Verify success prompt
    await expect(page.locator('.toast-success')).toContainText('Verification code sent');
  });

  test('Verification code input should display after sending', async ({ page }) => {
    // Fill in email
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code
    await page.click('button:has-text("Send Code")');

    // Verification code input should be visible
    await expect(page.locator('input[placeholder*="Verification Code"]')).toBeVisible();
  });

  test('Incorrect verification code should display error prompt', async ({ page }) => {
    // Fill in email
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code
    await page.click('button:has-text("Send Code")');

    // Enter incorrect verification code
    await page.fill('input[placeholder*="Verification Code"]', '000000');

    // Click verify
    await page.click('button:has-text("Verify")');

    // Should display error prompt
    await expect(page.locator('.toast-error')).toContainText('Incorrect verification code');
  });

  test('60-second countdown should display correctly', async ({ page }) => {
    // Fill in email
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code
    await page.click('button:has-text("Send Code")');

    // Button should display countdown
    const button = page.locator('button:has-text("Resend")');
    await expect(button).toBeVisible();
    await expect(button).toContainText('60');
  });
});
```

### 6.3 Accessibility Testing
#### 6.3.1 Testing Standards
- **WCAG 2.1 AA**: Web Content Accessibility Guidelines
- **Keyboard Navigation**: All features accessible via keyboard
- **Screen Reader**: Compatible with mainstream screen readers
- **Color Contrast**: Text-to-background contrast ratio ≥ 4.5:1

#### 6.3.2 Test Tools
- **Automated Testing**: axe-core, pa11y
- **Manual Testing**: Keyboard navigation testing, screen reader testing
- **PrimeNG Accessibility**: PrimeNG component library built-in accessibility support testing

## 7. Security Testing

### 7.1 Security Test Types
| Test Type | Test Method | Test Tool | Security Architecture Basis |
|---------|---------|---------|------------|
| **Authentication Testing** | Password policy, session management, token security | OWASP ZAP, Burp Suite | [Security Architecture Design Document §3.1](安全架构设计文档.md#31-认证体系) |
| **Email Verification Code Security Testing** | Rate limiting, type isolation, one-time verification | Automation scripts, stress testing tools | [Security Architecture Design Document §2.3.3](安全架构设计文档.md#233-邮箱验证码存储安全策略) |
| **Authorization Testing** | Role permissions, functional access control | Manual testing, automation scripts | [Security Architecture Design Document §3.2](安全架构设计文档.md#32-授权体系) |
| **Input Validation Testing** | SQL injection, XSS, CSRF protection | SQLMap, XSS detection tools | [Security Architecture Design Document §5.2](安全架构设计文档.md#52-输入验证与数据脱敏) |
| **API Security Testing** | Endpoint protection, rate limiting, data exposure | Postman, automation tests | [API Design Specification Document §2.3](接口设计规范文档.md#23-安全规范) |
| **Angular Security Testing** | XSS protection, CSP policy, security headers | Angular security scanning | [Security Architecture Design Document §5.3](安全架构设计文档.md#53-应用安全设计) |

### 7.2 Email Verification Code Security Test Cases
| Test Scenario | Test Method | Expected Result | Severity Level |
|---------|---------|---------|---------|
| Verification code brute force enumeration | Rapidly submit multiple incorrect codes | Should return 429 rate limit error | Critical |
| Verification code replay attack | Use expired verification code | Should return "Verification code expired" error | Critical |
| Verification code type confusion | Use REGISTER code to verify LOGIN operation | Should return verification failure | Critical |
| Rate limit bypass | Same email rapidly switching types for sending | Should be constrained by rate limits | Medium |
| Redis key injection | Email field containing special characters | Should be properly escaped or rejected | Critical |

### 7.3 Security Test Plan
1. **Static Code Analysis**: Use ESLint security rules, integrated into CI/CD pipeline
2. **Dependency Vulnerability Scanning**: npm audit periodic scanning, auto-fix strategy
3. **Dynamic Security Testing**: OWASP Top 10 vulnerability testing, executed monthly
4. **Penetration Testing**: Periodic security assessment, executed quarterly
5. **Key Security Testing**: Verify key management compliance with [Security Architecture Design Document §4.1](安全架构设计文档.md#41-密钥生命周期管理)

## 8. Test Automation and CI/CD

### 8.1 CI/CD Integration Testing
#### 8.1.1 GitHub Actions Workflows
| Workflow | Trigger | Test Type | TDD Phase |
|-------|---------|---------|--------|
| **Backend Image Build** | PR/push to main/develop | Unit tests, integration tests | RED/GREEN validation |
| **Frontend Image Build** | PR/push to main/develop | Unit tests, build validation | RED/GREEN validation |
| **Deployment Verification** | PR/push to main/develop | Image verification, deployment testing | Pre-deployment validation |
| **E2E Tests** | Scheduled/manual trigger | Complete end-to-end tests | Final acceptance |

#### 8.1.2 Test Execution Strategy
1. **PR Verification**: Run fast test suite on PR creation, ensuring TDD process integrity
2. **Main Branch Merge**: Run complete test suite before merge, including performance and security tests
3. **Scheduled Tests**: Run end-to-end tests daily, ensuring system stability
4. **Pre-Release Tests**: Run all tests before version release, including regression tests

### 8.2 Test Data Management
#### 8.2.1 Test Data Strategy
1. **Independent Test Database**: Each test run uses independent database instance, avoiding data contamination
2. **Test Data Factory**: Use factory pattern to generate test data, supporting rapid TDD iteration. Test data factories are uniformly stored in the `test/factories/` directory, such as `user.factory.ts`, `appointment.factory.ts`, `service.factory.ts`, etc.
3. **Data Cleanup**: Automatically clean up test data after completion, maintaining environment cleanliness
4. **Concurrent Test Data**: Special data generation for high-concurrency scenarios, verifying atomic preemption mechanism

#### 8.2.2 Environment Variable Management
```yaml
# Environment variables in GitHub Actions
env:
  NODE_ENV: test
  DATABASE_URL: postgresql://postgres:test@localhost:5432/booking_test
  REDIS_URL: redis://localhost:6379
  JWT_SECRET: test-jwt-secret
  JWT_REFRESH_SECRET: test-refresh-secret
  # Key management test environment variables
  VAULT_ADDR: http://localhost:8200
  VAULT_TOKEN: test-token
```

## 9. Test Execution Plan

### 9.1 Test Phase Division and TDD Integration
| Test Phase | Timeline | Test Focus | TDD Phase | Participants |
|---------|---------|---------|--------|---------|
| **Unit Testing** | During development | Code logic correctness | RED/GREEN cycle | Developers |
| **Integration Testing** | After feature development | Interfaces and data flow | Integration GREEN | Developers, testers |
| **System Testing** | Before version release | Complete system functionality | System acceptance | Testers |
| **Acceptance Testing** | Before release | User requirement satisfaction | User acceptance | Product managers, user representatives |
| **Regression Testing** | After each release | Existing feature stability | Regression verification | Testers |

### 9.2 Test Resource Plan
#### 9.2.1 Human Resources
- **Test Lead**: 1 person
- **Automation Test Engineer**: 1-2 persons
- **Developer Self-Testing**: All developers (responsible for TDD unit tests)
- **User Representatives**: Product managers, business personnel

#### 9.2.2 Environment Resources
- **Test Servers**: 2 machines (development testing, pre-release testing)
- **Test Database**: PostgreSQL instance
- **Test Cache**: Redis instance
- **Test Tools**: Jest, Playwright, Testcontainers licenses

## 10. Defect Management

### 10.1 Defect Classification
| Severity Level | Definition | Resolution Deadline | TDD Handling |
|---------|------|---------|--------|
| **Critical** | System crash, data loss, security vulnerability | Within 24 hours | Immediately write test (RED), fix (GREEN) |
| **Major** | Core functionality unavailable | Within 3 working days | Write regression test (RED), fix (GREEN) |
| **Minor** | Secondary feature issues, UI issues | 1-2 iteration cycles | Write test (RED), planned fix |
| **Trivial** | UI details, text errors | Fixed in subsequent version | Record for later fix |

### 10.2 Defect Tracking
- **Tracking Tool**: GitHub Issues
- **Workflow**: New → Triaged → In Progress → Resolved → Closed
- **Statistical Metrics**: Defect density, resolution rate, reopen rate
- **TDD Integration**: Each defect must include a test case to ensure no recurrence

## 11. Test Quality Metrics

### 11.1 Test Coverage Metrics
| Metric | Target Value | Measurement Method | TDD Requirement |
|------|-------|---------|--------|
| **Unit Test Coverage** | ≥70% | Jest coverage report | TDD development mandatory |
| **Integration Test Coverage** | ≥80% | Test case statistics | Integration test GREEN requirement |
| **End-to-End Test Coverage** | ≥90% | Business process coverage | Final acceptance criteria |
| **Code Line Coverage** | ≥70% | Comprehensive coverage report | Quality gate |

### 11.2 Defect Quality Metrics
| Metric | Target Value | Measurement Cycle | TDD Impact |
|------|-------|---------|--------|
| **Defect Leakage Rate** | <5% | Each release | TDD reduces leakage rate |
| **Defect Reopen Rate** | <10% | Monthly statistics | Test coverage reduces reopen rate |
| **Mean Time to Repair** | <3 days | Monthly statistics | TDD accelerates repair |
| **User Satisfaction** | ≥90% | After each release | Quality improves satisfaction |

### 11.3 Performance Metrics
| Metric | Target Value | Measurement Method | Architecture Basis |
|------|-------|---------|----------|
| **API Response Time (P95)** | <500ms | Performance testing | [Technology Stack Recommendation §1.2](技术栈推荐方案.md#12-非功能需求) |
| **Page Load Time** | <3 seconds | Frontend performance testing | User experience requirement |
| **Concurrent Users** | ≥100 | Load testing | High concurrency requirement |
| **System Availability** | ≥99.5% | Monitoring data | SLA requirement |

## 12. Risks and Mitigation

### 12.1 Test Risk Identification
| Risk Type | Likelihood | Impact | Mitigation Measure | TDD Mitigation |
|---------|--------|---------|---------|--------|
| **Unstable Test Environment** | Medium | High | Environment monitoring, rapid recovery mechanism | Unit tests are environment-independent |
| **Test Data Contamination** | Medium | Medium | Data isolation, periodic cleanup | Test data factory |
| **Automation Test Maintenance Cost** | High | Medium | Modular design, periodic refactoring | TDD reduces maintenance cost |
| **Insufficient Performance Test Resources** | Low | High | Cloud resource elastic scaling | Early performance testing |
| **Insufficient Security Test Depth** | Medium | High | Third-party security assessment | Security testing TDD integration |

### 12.2 Contingency Plans
1. **Test Environment Failure**: Backup environment switchover process, keeping TDD development ongoing
2. **Test Data Loss**: Data backup and recovery process, test data factory rebuild
3. **Test Tool Failure**: Backup test plan, local testing priority
4. **Tester Turnover**: Knowledge base and documentation management, TDD process standardization

## 13. Appendix

### 13.1 Test Tool Checklist
| Tool Type | Tool Name | Version | Purpose | Technology Stack Basis |
|---------|---------|------|------|----------|
| **Unit Testing Framework** | Jest | 29.7.0+ | JavaScript testing | [Technology Stack Recommendation §3.4](技术栈推荐方案.md#34-开发工具与质量) |
| **Angular Testing Library** | Angular Testing Library | Latest | Angular component testing | Angular official recommendation |
| **End-to-End Testing Framework** | Playwright | Latest | Browser automation | [Technology Stack Recommendation §3.4](技术栈推荐方案.md#34-开发工具与质量) |
| **API Testing Tool** | Supertest | 6.3.4+ | HTTP API testing | NestJS ecosystem standard |
| **Test Containers** | Testcontainers | 11.6.0+ | Database and cache testing | Integration testing standard |
| **Code Coverage** | Istanbul | Built-in | Coverage statistics | Jest integration |
| **Performance Testing** | k6 | Latest | Load testing | Performance testing standard |

### 13.2 Related Documents
1. [Technology Stack Recommendation](技术栈推荐方案.md) - Test tool selection basis
2. [System Architecture Design Document (SAD)](系统架构设计文档（SAD）.md) - Test layer architecture basis
3. [API Design Specification Document](接口设计规范文档.md) - API test specification basis
4. [Data Architecture Design Document](数据架构设计文档.md) - Database test strategy basis
5. [Security Architecture Design Document](安全架构设计文档.md) - Security test strategy basis

### 13.3 TDD Checklist
- [ ] Were failing tests written before new feature development (RED)?
- [ ] Does the implementation code make all tests pass (GREEN)?
- [ ] Is refactoring performed under test protection?
- [ ] Does test coverage meet target thresholds?
- [ ] Does the defect fix include regression tests?

### 13.4 Test Team Contacts
- **Test Lead**: [Name]
- **Automation Test Engineer**: [Name]
- **Performance Test Expert**: [Name]
- **Security Test Expert**: [Name]

---
*Document Version: 2.4.0 (Angular+NestJS Rebuilt Version)*
*Last Updated: 2026-05-11*
*Maintenance Team: Quality Assurance Team*
*TDD Compliance: Compliant with RED/GREEN Test-Driven Design Specification*

### Change Log

| Version | Date | Author | Changes |
|------|------|-------|---------|
| 2.4.0 | 2026-05-11 | @Architect | Added §5.2.6 Multi-slot booking and financial fields test scenarios (FIN-001~003, MULTI-001~003, OVERTIME-001, TAX-001) |
| 2.3.0 | 2026-05-06 | @Architect | Deprecated generic `/v1/auth/verification-codes/*` test endpoints, replaced with purpose-separated endpoints (register/send-code + register/complete, login/send-code + login/verify-code) |
| 2.2.0 | 2026-05-06 | @Architect | Added §5.2.7 Reset password test scenarios (RESET-PW-001 send-code rate limit verification + RESET-PW-002 verify password reset verification), E2E scenario extensions |
| 2.1.0 | 2026-05-04 | @Architect (Phase 5) | Added §5.2.6 Admin Dashboard integration test cases (DASH-001~004 backend + DASH-FE-001~003 frontend), coverage target ≥ 70% |
| 2.0.0 | 2026-04-14 | System Architecture Analysis Tool | Initial baseline version |
