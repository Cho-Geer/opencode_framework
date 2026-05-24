---
trigger: manual
alwaysApply: false
---
# Testing Strategy and Plan

## 1. Overview

### 1.1 Document Purpose
This document defines the testing strategy, test types, test plans, and quality standards for the Booking system (Angular + NestJS refactored edition), ensuring the system meets requirements in terms of functionality, performance, security, and user experience. This testing strategy strictly follows the RED/GREEN TDD (Test-Driven Development) workflow to ensure code quality and architectural decision consistency.

### 1.2 Test Scope
- **Backend API**: booking-backend (NestJS application)
- **Frontend Application**: booking-frontend (Angular application)
- **End-to-End Flows**: Complete business flows including user authentication, booking management, service management, email notifications, etc.
- **Non-functional Requirements**: Performance, security, compatibility, accessibility
- **TDD Workflow**: RED/GREEN cycle for unit tests, integration tests, and end-to-end tests

## 2. RED/GREEN TDD Test-Driven Design

### 2.1 TDD Core Principles
Follow the "Red-Green-Refactor" cycle to ensure all features have test coverage:
1. **RED**: Write failing test cases first to define expected behavior
2. **GREEN**: Write minimal code to make tests pass
3. **REFACTOR**: Optimize code structure while keeping tests passing

### 2.2 TDD Workflow
```
Develop new feature → Write unit test (RED) → Implement feature (GREEN) → Refactor
         ↓
Write integration test (RED) → Integration implementation (GREEN) → Refactor
         ↓
Write E2E test (RED) → End-to-end verification (GREEN) → Deliver
```

### 2.3 TDD Quality Gates
- **Test-first**: Any new feature development must have tests written first
- **Test pass rate**: 100% tests passing before code can be committed
- **Refactoring safety net**: All refactoring must be performed under test protection
- **Continuous feedback**: Fix test failures immediately; keep the codebase healthy

## 3. Test Pyramid Strategy

### 3.1 Test Layer Structure
```
        ┌─────────────────┐
        │   End-to-End Tests   │ (10%)
        │   (E2E Tests)        │
        └─────────────────┘
               │
        ┌─────────────────┐
        │   Integration Tests  │ (20%)
        │   (API Tests)        │
        └─────────────────┘
               │
        ┌─────────────────┐
        │   Unit Tests         │ (70%)
        │   (Component/Service)│
        └─────────────────┘
```

### 3.2 Test Objectives per Layer and TDD Integration
1. **Unit Tests**: Verify correctness of individual functions, components, and services; developed using TDD
2. **Integration Tests**: Verify interface and data flow correctness between modules; built on top of unit tests
3. **End-to-End Tests**: Verify complete business flows and user experience; serve as the final acceptance standard

### 3.3 Testing Tools and Tech Stack Alignment
| Test Layer | Frontend Tool | Backend Tool | Tech Stack Reference |
|---------|---------|---------|----------|
| **Unit Tests** | Jest + Angular Testing Library | Jest + ts-jest | [Tech Stack Recommendation §3.4](tech-stack-recommendation.md#34-development-tools-and-quality) |
| **Integration Tests** | Component integration tests | Jest + Supertest + Testcontainers | [System Architecture Design §4.3](system-architecture-design.md#43-data-access-layer) |
| **End-to-End Tests** | Playwright | - | [Tech Stack Recommendation §3.4](tech-stack-recommendation.md#34-development-tools-and-quality) |

## 4. Test Environment Configuration

### 4.1 Test Environment Matrix
| Environment Type | Backend | Frontend | Database | Cache | Purpose |
|---------|------|------|--------|------|------|
| **Unit Tests** | Mocked | Mocked | In-memory DB | Mocked | Fast logic verification, TDD development |
| **Integration Tests** | Real instance | Real instance | Testcontainers | Testcontainers | Interface verification, module integration |
| **End-to-End Tests** | Real instance | Real instance | Testcontainers | Testcontainers | Full flow verification, user acceptance |
| **CI/CD Tests** | Real instance | Real instance | Testcontainers | Testcontainers | Automated verification, deployment gate |

### 4.2 Test Data Management
1. **Test Data Isolation**: Each test case uses independent data to avoid interference
2. **Data Cleanup**: Test data is automatically cleaned up after tests complete
3. **Data Factory**: Use factory pattern to generate test data, supporting fast TDD iteration. Test data factories are stored in the `test/factories/` directory, such as `user.factory.ts`, `appointment.factory.ts`, `service.factory.ts`, etc.
4. **Concurrent Test Data**: Special test data design for high-concurrency booking scenarios, aligned with [Data Architecture Design §11.2](data-architecture.md#112-concurrent-conflict-handling-scenario)

## 5. Backend Testing Strategy (NestJS)

### 5.1 Unit Tests (TDD Core Layer)
#### 5.1.1 Test Framework
- **Framework**: Jest + ts-jest
- **Assertion Library**: Jest built-in assertions
- **Mocking Library**: Jest Mock

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
1. **Service Layer Tests**: Business logic validation, including booking conflict handling logic (based on [Data Architecture Design §4.2](data-architecture.md#42-high-concurrency-optimization-strategy))
2. **Controller Tests**: Request handling validation, aligned with [API Design Specification §2.1](api-design-specification.md#21-restful-api-design-specification)
3. **Middleware Tests**: Authentication, authorization, and validation middleware, aligned with [Security Architecture Design §3.1](security-architecture.md#31-authentication-system)
4. **Utility Function Tests**: Utility classes and helper functions
5. **Script Tests**: Data retention scripts, etc.

#### 5.1.4 Exclusions
```javascript
collectCoverageFrom: [
  'src/**/*.(t|j)s',
  '!src/main.ts',          // Entry file
  '!src/**/*.module.ts',   // Module files
  '!src/**/*.dto.ts',      // DTO definitions
  '!src/**/*.entity.ts',   // Entity definitions
]
```

### 5.2 Integration Tests (E2E Tests)
#### 5.2.1 Test Framework
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
| **Auth Tests** | `auth.e2e-spec.ts` | User registration, login, token refresh, logout | Integration GREEN |
| **Email Verification Tests** | `email-verification.e2e-spec.ts` | Send code, verify code, rate limiting, type isolation | Integration GREEN |
| **User Management Tests** | `users.e2e-spec.ts` | User info query, update, delete | Integration GREEN |
| **Booking Management Tests** | `bookings.e2e-spec.ts` | Booking create, query, update, cancel | Integration GREEN |
| **Concurrent Booking Tests** | `booking-concurrency.e2e-spec.ts` | Concurrent booking conflict handling, validate atomic preemption mechanism | Integration GREEN |
| **Service Management Tests** | `services-admin.e2e-spec.ts` | Service create, update, delete, query | Integration GREEN |
| **Email Notification Tests** | `email.e2e-spec.ts` | Booking confirmation and reminder email sending | Integration GREEN |
| **Data Retention Tests** | `retention.e2e-spec.ts` | Automatic cleanup of expired data | Integration GREEN |
| **Reset Password Tests** | `reset-password.e2e-spec.ts` | Send code, verify code, reset password, rate limiting | Integration GREEN |

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

Email verification code feature tests follow the TDD development flow to ensure correct behavior of Redis storage, rate limiting, type isolation, and other security mechanisms.

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
    it('RED: should generate a 6-digit numeric code and store it in Redis', async () => {
      // GIVEN: valid email and verification code type
      const email = 'test@example.com';
      const type = VerificationCodeType.REGISTER;
  
      // WHEN: send verification code
      await service.sendCode(email, type);
  
      // THEN: verify Redis store call
      expect(redisService.setex).toHaveBeenCalledWith(
        `verification:email:${email}:${type}`,
        300, // TTL: 5 minutes
        expect.stringMatching(/^\d{6}$/), // 6-digit number
      );
    });
  
    it('GREEN: should call email service to send the code', async () => {
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
    it('RED: should return true and delete the code from Redis when verification code matches', async () => {
      // GIVEN: stored verification code
      const storedCode = '123456';
      redisService.get.mockResolvedValue(storedCode);
  
      // WHEN: verify correct code
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
  
    it('RED: should throw exception when verification code is wrong', async () => {
      // GIVEN: stored verification code
      redisService.get.mockResolvedValue('123456');
  
      // WHEN & THEN: verify wrong code
      await expect(
        service.verifyCode(
          'test@example.com',
          '654321', // wrong code
          VerificationCodeType.REGISTER,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  
    it('GREEN: should throw exception when verification code is expired', async () => {
      // GIVEN: no code stored in Redis
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
    it('RED: sending registration code should return 200', async () => {
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
  
    it('RED: invalid email format should return 400', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register/send-code')
        .send({
          contact: 'invalid-email',
          contactType: 'email',
        })
        .expect(400);
    });

    it('GREEN: exceeding rate limit should return 429', async () => {
      // Send code 6 times (limit is 5 per minute)
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
    it('RED: correct code should verify successfully', async () => {
      // 1. Send verification code
      await request(app.getHttpServer())
        .post('/v1/auth/register/send-code')
        .send({
          contact: 'verify@example.com',
          contactType: 'email',
        });
  
      // 2. Get code from Redis (test environment)
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

    it('GREEN: verification code should be deleted after verification (one-time use)', async () => {
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

      // Complete login verification (code is one-time use)
      await request(app.getHttpServer())
        .post('/v1/auth/login/verify-code')
        .send({
          contact: 'once@example.com',
          contactType: 'email',
          code: code,
        });

      // Code should be deleted
      const deletedCode = await redisContainer.getClient().get(
        'verify:login:{contactHash}',
      );
      expect(deletedCode).toBeNull();
    });
  });
});
```

##### Test Coverage Matrix
| Test Scenario | Unit Test | Integration Test | E2E Test |
|---------|---------|---------|---------|
| Code Generation | ✅ | ✅ | - |
| Redis Storage | ✅ | ✅ | ✅ |
| TTL Expiry | ✅ | ✅ | ✅ |
| Code Match | ✅ | ✅ | ✅ |
| Wrong Code | ✅ | ✅ | ✅ |
| Rate Limiting | - | ✅ | ✅ |
| Type Isolation | ✅ | ✅ | ✅ |
| One-time Use | ✅ | ✅ | ✅ |
| Email Format Validation | - | ✅ | ✅ |

#### 5.2.6 Financial Fields and Timeout Test Scenarios [v2.4.0]

> **Addition Note**: The Service model added pricePerMinute/taxRate; the Appointment model added durationMinutes/price/taxRate/taxIncludedAmount. Corresponding integration test coverage is required.

##### Test Case List

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **FIN-001** | When creating a booking, verify that price/taxRate are correctly snapshotted from Service, including overtimeMinutes scenarios | Integration | Appointment.price == Service.price, Appointment.taxRate == Service.taxRate, overtime fields persisted correctly |
| **FIN-002** | Verify taxIncludedAmount = price * (1 + taxRate) | Integration | Calculated value is correct |
| **FIN-003** | Service price changes should not affect snapshots of existing bookings | Integration | After updating Service.price, existing Appointment.price remains unchanged |
| **OVERTIME-001** | Overtime booking: overtime_minutes field is correctly persisted to Appointment.durationMinutes | Integration | durationMinutes = original duration + overtime_minutes |
| **TAX-001** | When taxRate is null, taxIncludedAmount equals price | Integration | Null tax rate scenario handled correctly |

##### Backend Integration Test Example (FIN-001)

```typescript
// financial-fields.e2e-spec.ts
describe('Financial Fields (e2e)', () => {
  describe('POST /v1/appointments — price/taxRate snapshot', () => {
    it('FIN-001: price and taxRate should be snapshotted from Service when creating a booking', async () => {
      // 1. Create a Service with pricePerMinute and taxRate
      const service = await createTestService({
        price: 100.00,
        pricePerMinute: 10.00,
        taxRate: 0.0800,
      });

      // 2. Create a booking for that Service
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

> **Addition Note**: Admin Dashboard statistics feature requires coverage at both integration test (backend) and component test (frontend) levels, ensuring data correctness for statistics cards, trend charts, service distribution, and time distribution dimensions.

##### Test Case List

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **DASH-001** | Verify core statistics cards return correct nested `StatCardDto` structure | Integration (Backend) | HTTP 200, response contains `todayBookings`/`pendingBookings`/`activeUsers`/`totalRevenue` four `StatCardDto` objects, each with `value`/`changePercentage`/`isPositive`/`target`/`progressPercentage` |
| **DASH-002** | Verify booking trends return a `{date, count, revenue}[]` array with all fields present | Integration (Backend) | HTTP 200, `data` is an array with length > 0, each item contains `date`/`count`/`revenue` fields |
| **DASH-003** | Verify service distribution returns `serviceName`/`count`/`percentage` fields and percentage sums to 100 | Integration (Backend) | HTTP 200, sum of all `percentage` values ≈ 100 (floating-point tolerance) |
| **DASH-004** | Verify time distribution returns `hour` (0-23) / `count` fields | Integration (Backend) | HTTP 200, each item contains `hour` and `count` properties |

##### Component Tests (Frontend)

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **DASH-FE-001** | Verify Dashboard component renders statistics cards with correct values and progress bars | Component Test (Frontend) | Cards render 4 statistical values; progress bar width matches `progressPercentage` |
| **DASH-FE-002** | Verify Chart.js trend chart binds `data: {date, count, revenue}[]` object array correctly | Component Test (Frontend) | Chart.js instance receives correct dataset; each item in `data` array has `date`/`count`/`revenue` fields |
| **DASH-FE-003** | Verify service distribution donut chart data binding is correct | Component Test (Frontend) | Donut chart segments match number of services; labels show `serviceName` + `percentage` |

##### Coverage Requirements

- **Backend**: Admin Stats Service all methods coverage ≥70% (lines/branches/functions/statements)
- **Frontend**: Dashboard-related components coverage ≥70%
- **Test Level**: Integration Tests (Backend) + Component Tests (Frontend)

##### Backend Integration Test Example (DASH-001)

```typescript
// admin-stats.e2e-spec.ts
describe('Admin Dashboard Stats (e2e)', () => {
  describe('GET /v1/admin/stats', () => {
    it('DASH-001: should return correct StatCardDto nested structure', async () => {
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

    it('DASH-002: booking trends should return an array with all fields complete', async () => {
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

    it('DASH-003: service distribution percentage sum should be close to 100', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/stats/service-distribution?timeRange=last30d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const totalPercentage = response.body.data.reduce(
        (sum: number, item: any) => sum + item.percentage, 0
      );
      expect(totalPercentage).toBeCloseTo(100, 0); // Allow ±0.5 floating-point error
    });

    it('DASH-004: time distribution should contain hour and count fields', async () => {
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

> **Addition Note**: contract.yaml v1.6.5 added RESET-PW-001 (POST /v1/auth/reset-password/send-code) and RESET-PW-002 (POST /v1/auth/reset-password/verify) endpoints. Corresponding integration and E2E tests are required.

##### Test Case List

| Case ID | Description | Test Level | Expected Result |
|---------|------|----------|----------|
| **RESET-PW-001-A** | Send reset password code: valid registered contact should return 200 | Integration (Backend) | HTTP 200, `data.expiresIn === 300` |
| **RESET-PW-001-B** | Send reset password code: unregistered contact should silently return 200 (prevent user enumeration) | Integration (Backend) | HTTP 200, does not reveal whether user exists |
| **RESET-PW-001-C** | Send reset password code: exceeding rate limit (6/minute) should return 429 | Integration (Backend) | First 5 return 200, 6th returns 429 |
| **RESET-PW-001-D** | Send reset password code: invalid contact format should return 400 | Integration (Backend) | HTTP 400, error code VALIDATION_ERROR |
| **RESET-PW-002-A** | Verify and reset password: correct code + compliant new password should return 200 | Integration (Backend) | HTTP 200, `message === "Password reset successful"`, able to login with new password |
| **RESET-PW-002-B** | Verify and reset password: wrong code should return 400 | Integration (Backend) | HTTP 400, message "Invalid verification code" |
| **RESET-PW-002-C** | Verify and reset password: expired code should return 400 | Integration (Backend) | After Redis TTL expires, HTTP 400 |
| **RESET-PW-002-D** | Verify and reset password: new password below strength requirement (< 8 chars) should return 400 | Integration (Backend) | HTTP 400, VALIDATION_ERROR |
| **RESET-PW-002-E** | Verify and reset password: using old password after reset should return 401 | Integration (Backend) | Old password invalidated, HTTP 401 |

##### Backend Integration Test Example

```typescript
// reset-password.e2e-spec.ts
describe('Reset Password (e2e)', () => {

  describe('POST /v1/auth/reset-password/send-code', () => {
    it('RESET-PW-001-A: registered email should send code and return 200', async () => {
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

    it('RESET-PW-001-B: unregistered email should silently return 200 (prevent enumeration)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/reset-password/send-code')
        .send({
          contact: 'nonexistent@example.com',
          contactType: 'email',
        })
        .expect(200);

      // Response should not reveal whether user exists
      expect(response.body.data).toBeDefined();
      expect(response.body.data.expiresIn).toBe(300);
    });

    it('RESET-PW-001-C: exceeding rate limit should return 429', async () => {
      // Rate limit: 5/minute/contact
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
    it('RESET-PW-002-A: correct code should reset password successfully', async () => {
      // 1. Send verification code
      await request(app.getHttpServer())
        .post('/v1/auth/reset-password/send-code')
        .send({ contact: 'reset-test@example.com', contactType: 'email' });

      // 2. Get code from Redis
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

    it('RESET-PW-002-D: new password less than 8 characters should return 400', async () => {
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

    it('RESET-PW-002-E: old password should be invalidated after reset', async () => {
      // Login with new password succeeds
      const loginRes = await request(app.getHttpServer())
        .post('/v1/auth/login/password')
        .send({
          contact: 'reset-test@example.com',
          contactType: 'email',
          password: 'NewSecureP@ss123',
        })
        .expect(200);

      expect(loginRes.body.data.accessToken).toBeDefined();

      // Old password login should fail
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

| Test Scenario | Unit Test | Integration Test | E2E Test |
|---------|---------|---------|---------|
| Send code (registered user) | ✅ | ✅ | ✅ |
| Send code (unregistered user, prevent enumeration) | ✅ | ✅ | - |
| Send code rate limiting (5/minute) | - | ✅ | ✅ |
| Code match | ✅ | ✅ | ✅ |
| Wrong code message | ✅ | ✅ | ✅ |
| Expired code handling | ✅ | ✅ | - |
| New password strength check | ✅ | ✅ | ✅ |
| New password persistence (login verification) | - | ✅ | ✅ |
| Old password invalidation | - | ✅ | - |

##### E2E Test Scenario Extension

Added to E2E test scenario coverage in §6.2.4:
- **Forgot Password Flow**: Click "Forgot Password" link on login page → enter contact → send verification code → enter code + new password → reset successful → redirected to login page, use new password to login

```typescript
// e2e/forgot-password.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Forgot Password Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login');
  });

  test('clicking forgot password link should navigate to forgot password page', async ({ page }) => {
    await page.click('button:has-text("Forgot Password")');
    await expect(page).toHaveURL('/auth/forgot-password');
  });

  test('send code button should work correctly', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Send Code")');
    await expect(page.locator('.toast-success')).toContainText('Verification code sent');
  });

  test('complete forgot password flow', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    
    // Step 1: Enter email and send code
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Send Code")');
    await expect(page.locator('input[placeholder*="code"]')).toBeVisible();

    // Step 2: Enter code and new password
    await page.fill('input[placeholder*="code"]', '123456');
    await page.fill('input[type="password"]', 'NewSecureP@ss123');
    await page.click('button:has-text("Reset Password")');

    // Verify success message
    await expect(page.locator('.toast-success')).toContainText('Password reset successful');
    
    // Should redirect to login page
    await expect(page).toHaveURL('/auth/login');
  });

  test('wrong code should show error message', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Send Code")');
    await page.fill('input[placeholder*="code"]', '000000');
    await page.fill('input[type="password"]', 'NewSecureP@ss123');
    await page.click('button:has-text("Reset Password")');
    await expect(page.locator('.toast-error')).toContainText('Invalid verification code');
  });
});
```

### 5.3 Performance Testing
#### 5.3.1 Test Scenarios
1. **API Response Time**: Key API endpoint P95 response time < 500ms (aligned with [Tech Stack Recommendation §1.2](tech-stack-recommendation.md#12-non-functional-requirements))
2. **Concurrent Handling**: Support 100+ concurrent users booking simultaneously; validate atomic preemption mechanism
3. **Database Performance**: Complex query execution time < 100ms

#### 5.3.2 Testing Tools
- **Load Testing**: k6, Artillery
- **Performance Monitoring**: Node.js performance monitoring, database query analysis
- **Performance Test Script Location**: All performance test scripts are stored in the `test/performance/` directory, triggered periodically by CI

#### 5.3.3 k6 Load Test Example
The following is a simplified k6 test script for testing concurrent performance of the booking creation API:

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
    { duration: '30s', target: 50 },   // Ramp up to 50 virtual users in 30s
    { duration: '1m', target: 100 },   // Hold at 100 virtual users for 1 minute
    { duration: '30s', target: 0 },    // Ramp down to 0 in 30s
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // 95% of request response times under 500ms
    'booking_success_rate': ['rate>0.95'], // Success rate above 95%
    'http_req_failed': ['rate<0.05'],   // Failure rate below 5%
  },
};

// Initialization function (optional)
export function setup() {
  // Get test token or other initialization actions
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
  
  sleep(1); // Each virtual user waits 1 second between requests
}

// Cleanup function (optional)
export function teardown(data) {
  // Clean up test data or other cleanup actions
  console.log('Performance test complete');
}
```

**Execution Command**:
```bash
# Run performance tests locally
k6 run test/performance/booking-create-load-test.js

# Specify virtual user count and duration
k6 run --vus 100 --duration 30s test/performance/booking-create-load-test.js

# Run performance tests in CI/CD
npm run test:performance
```

## 6. Frontend Testing Strategy (Angular)

### 6.1 Unit Tests (TDD Core Layer)
#### 6.1.1 Test Framework
- **Framework**: Jest + Angular Testing Library
- **DOM Testing**: @testing-library/dom
- **Angular Testing**: @testing-library/angular
- **User Interaction**: @testing-library/user-event

#### 6.1.2 Test Scope
1. **Component Tests**: UI component rendering and interaction, including PrimeNG component integration tests
2. **Service Tests**: Angular service tests, including HTTP client tests
3. **NgRx Signals Tests**: State management logic tests (based on NgRx Signals solution from [Tech Stack Recommendation §3.1](tech-stack-recommendation.md#31-core-framework))
4. **Utility Function Tests**: Utility classes and formatting functions
5. **Form Tests**: Reactive form validation and submission

#### 6.1.3 NgRx Signals Test Patterns
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

### 6.2 End-to-End Tests (E2E)
#### 6.2.1 Test Framework
- **Framework**: Playwright
- **Browsers**: Chromium (default), Firefox, WebKit
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
2. **Email Verification Code Flow**: Send code, enter code, success/failure feedback
3. **Login Flow**: User login, remember me feature
4. **Booking Flow**: Select service, select time, fill in details, confirm booking
5. **Booking Management**: View booking list, cancel booking, rebook
6. **Service Management** (Admin): Service creation, editing, deletion
7. **User Management** (Admin): User lookup, status management

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
    // Enter email address
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code button
    await page.click('button:has-text("Send Verification Code")');

    // Verify success notification
    await expect(page.locator('.toast-success')).toContainText('Verification Code Sent');
  });

  test('Verification code input should be visible after sending', async ({ page }) => {
    // Enter email address
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code
    await page.click('button:has-text("Send Verification Code")');

    // Verification code input should be visible
    await expect(page.locator('input[placeholder*="Verification Code"]')).toBeVisible();
  });

  test('Invalid verification code should show error message', async ({ page }) => {
    // Enter email address
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code
    await page.click('button:has-text("Send Verification Code")');

    // Enter incorrect verification code
    await page.fill('input[placeholder*="Verification Code"]', '000000');

    // Click verify
    await page.click('button:has-text("Verify")');

    // Error message should be displayed
    await expect(page.locator('.toast-error')).toContainText('Verification Code Error');
  });

  test('60-second countdown should display correctly', async ({ page }) => {
    // Enter email address
    await page.fill('input[type="email"]', 'test@example.com');

    // Click send verification code
    await page.click('button:has-text("Send Verification Code")');

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
- **Screen Readers**: Compatible with mainstream screen readers
- **Color Contrast**: Text-to-background contrast ratio ≥ 4.5:1

#### 6.3.2 Testing Tools
- **Automated Testing**: axe-core, pa11y
- **Manual Testing**: Keyboard navigation testing, screen reader testing
- **PrimeNG Accessibility**: Built-in accessibility support testing for PrimeNG component library

## 7. Security Testing

### 7.1 Security Test Types
| Test Type | Test Method | Test Tool | Security Architecture Reference |
|---------|---------|---------|------------|
| **Authentication Testing** | Password policy, session management, token security | OWASP ZAP, Burp Suite | [Security Architecture Design §3.1](security-architecture.md#31-authentication-system) |
| **Email Verification Code Security Testing** | Rate limiting, type isolation, one-time verification | Automated scripts, load testing tools | [Security Architecture Design §2.3.3](security-architecture.md#233-email-verification-code-storage-security-policy) |
| **Authorization Testing** | Role permissions, feature access control | Manual testing, automated scripts | [Security Architecture Design §3.2](security-architecture.md#32-authorization-system) |
| **Input Validation Testing** | SQL injection, XSS, CSRF protection | SQLMap, XSS detection tools | [Security Architecture Design §5.2](security-architecture.md#52-input-validation-and-data-masking) |
| **API Security Testing** | Endpoint protection, rate limiting, data exposure | Postman, automated tests | [API Design Specification §2.3](api-design-specification.md#23-security-specification) |
| **Angular Security Testing** | XSS protection, CSP policy, security headers | Angular security scanning | [Security Architecture Design §5.3](security-architecture.md#53-application-security-design) |

### 7.2 Email Verification Code Security Test Cases
| Test Scenario | Test Method | Expected Result | Severity |
|---------|---------|---------|---------|
| Verification code brute-force enumeration | Rapidly submit multiple incorrect codes | Should return 429 rate-limit error | Critical |
| Verification code replay attack | Use expired verification code | Should return "Verification code expired" error | Critical |
| Verification code type confusion | Use REGISTER code to verify LOGIN operation | Should return verification failure | Critical |
| Rate limiting bypass | Rapidly switch types for same email | Should be subject to rate limiting | Moderate |
| Redis key injection | Email field contains special characters | Should be properly escaped or rejected | Critical |

### 7.3 Security Test Plan
1. **Static Code Analysis**: Use ESLint security rules, integrated into CI/CD pipeline
2. **Dependency Vulnerability Scanning**: Regular npm audit scans, automated fix strategy
3. **Dynamic Security Testing**: OWASP Top 10 vulnerability testing, executed monthly
4. **Penetration Testing**: Regular security assessments, executed quarterly
5. **Key Security Testing**: Verify key management complies with [Security Architecture Design §4.1](security-architecture.md#41-key-lifecycle-management)

## 8. Test Automation and CI/CD

### 8.1 CI/CD Integration Testing
#### 8.1.1 GitHub Actions Workflow
| Workflow | Trigger | Test Type | TDD Phase |
|-------|---------|---------|--------|
| **Backend Image Build** | PR/push to main/develop | Unit tests, integration tests | RED/GREEN validation |
| **Frontend Image Build** | PR/push to main/develop | Unit tests, build validation | RED/GREEN validation |
| **Deployment Validation** | PR/push to main/develop | Image validation, deployment tests | Pre-deployment validation |
| **E2E Tests** | Scheduled/manual trigger | Full end-to-end tests | Final acceptance |

#### 8.1.2 Test Execution Strategy
1. **PR Validation**: Run quick test suite when PR is created to ensure TDD process integrity
2. **Main Branch Merge**: Run full test suite before merge, including performance and security tests
3. **Scheduled Testing**: Run end-to-end tests daily to ensure system stability
4. **Pre-release Testing**: Run all tests before version release, including regression tests

### 8.2 Test Data Management
#### 8.2.1 Test Data Strategy
1. **Isolated Test Database**: Each test run uses an isolated database instance to avoid data contamination
2. **Test Data Factory**: Use factory pattern to generate test data, supporting rapid TDD iteration. Test data factories are stored uniformly in `test/factories/` directory, e.g. `user.factory.ts`, `appointment.factory.ts`, `service.factory.ts`, etc.
3. **Data Cleanup**: Automatically clean up test data after tests complete, keeping the environment clean
4. **Concurrent Test Data**: Special data generation for high-concurrency scenarios, validating atomic preemption mechanism

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
| Test Phase | Schedule | Test Focus | TDD Phase | Participants |
|---------|---------|---------|--------|----------|
| **Unit Tests** | During development | Code logic correctness | RED/GREEN cycle | Developers |
| **Integration Tests** | After feature development | Interface and data flow | Integration GREEN | Developers, testers |
| **System Tests** | Before version release | Complete system functionality | System acceptance | Testers |
| **Acceptance Tests** | Before release | User requirements satisfaction | User acceptance | Product manager, user representatives |
| **Regression Tests** | After each release | Existing feature stability | Regression validation | Testers |

### 9.2 Test Resource Plan
#### 9.2.1 Human Resources
- **Test Lead**: 1 person
- **Automation Test Engineers**: 1-2 people
- **Developer Self-testing**: All developers (responsible for TDD unit tests)
- **User Representatives**: Product manager, business staff

#### 9.2.2 Environment Resources
- **Test Servers**: 2 units (development testing, pre-release testing)
- **Test Database**: PostgreSQL instance
- **Test Cache**: Redis instance
- **Test Tools**: Jest, Playwright, Testcontainers licenses

## 10. Defect Management

### 10.1 Defect Classification
| Severity | Definition | Resolution Deadline | TDD Handling |
|---------|------|---------|--------|
| **Critical** | System crash, data loss, security vulnerability | Within 24 hours | Immediately write test (RED), fix (GREEN) |
| **Major** | Core feature unavailable | Within 3 business days | Write regression test (RED), fix (GREEN) |
| **Minor** | Secondary feature issues, UI problems | 1-2 iteration cycles | Write test (RED), plan fix |
| **Trivial** | UI details, text errors | Fix in future version | Record for fix |

### 10.2 Defect Tracking
- **Tracking Tool**: GitHub Issues
- **Workflow**: New → Triaged → In Progress → Resolved → Closed
- **Metrics**: Defect density, resolution rate, reopen rate
- **TDD Integration**: Every defect must be accompanied by a test case to ensure non-recurrence

## 11. Test Quality Metrics

### 11.1 Test Coverage Metrics
| Metric | Target | Measurement | TDD Requirement |
|------|-------|---------|--------|
| **Unit Test Coverage** | ≥70% | Jest coverage report | Mandatory for TDD development |
| **Integration Test Coverage** | ≥80% | Test case statistics | Integration test GREEN requirement |
| **End-to-End Test Coverage** | ≥90% | Business process coverage | Final acceptance standard |
| **Code Line Coverage** | ≥70% | Comprehensive coverage report | Quality gate |

### 11.2 Defect Quality Metrics
| Metric | Target | Measurement Period | TDD Impact |
|------|-------|---------|--------|
| **Defect Leakage Rate** | <5% | Per release | TDD reduces leakage rate |
| **Defect Reopen Rate** | <10% | Monthly statistics | Test coverage reduces reopen rate |
| **Mean Time to Repair** | <3 days | Monthly statistics | TDD accelerates repair |
| **User Satisfaction** | ≥90% | After each release | Quality improves satisfaction |

### 11.3 Performance Metrics
| Metric | Target | Measurement | Architecture Reference |
|------|-------|---------|----------|
| **API Response Time (P95)** | <500ms | Performance testing | [Tech Stack Recommendation §1.2](tech-stack-recommendation.md#12-non-functional-requirements) |
| **Page Load Time** | <3s | Frontend performance testing | User experience requirements |
| **Concurrent Users** | ≥100 | Load testing | High-concurrency requirements |
| **System Availability** | ≥99.5% | Monitoring data | SLA requirements |

## 12. Risks and Mitigation

### 12.1 Test Risk Identification
| Risk Type | Likelihood | Impact | Mitigation Measures | TDD Mitigation |
|---------|--------|---------|---------|--------|
| **Unstable Test Environment** | Medium | High | Environment monitoring, rapid recovery mechanism | Unit tests independent of environment |
| **Test Data Contamination** | Medium | Medium | Data isolation, regular cleanup | Test data factory |
| **High Automation Test Maintenance Cost** | High | Medium | Modular design, regular refactoring | TDD reduces maintenance cost |
| **Insufficient Performance Test Resources** | Low | High | Elastic cloud resource scaling | Early performance testing |
| **Insufficient Security Test Depth** | Medium | High | Third-party security assessment | Security testing TDD integration |

### 12.2 Contingency Plan
1. **Test Environment Failure**: Backup environment switchover process, keeping TDD development continuing
2. **Test Data Loss**: Data backup and recovery process, test data factory rebuild
3. **Test Tool Failure**: Backup test plan, prioritize local testing
4. **Team Member Changes**: Knowledge base and documentation management, TDD process standardization

## 13. Appendix

### 13.1 Testing Tools List
| Tool Type | Tool Name | Version | Purpose | Tech Stack Reference |
|---------|---------|------|------|----------|
| **Unit Test Framework** | Jest | 29.7.0+ | JavaScript testing | [Tech Stack Recommendation §3.4](tech-stack-recommendation.md#34-development-tools-and-quality) |
| **Angular Testing Library** | Angular Testing Library | Latest | Angular component testing | Angular official recommendation |
| **End-to-End Test Framework** | Playwright | Latest | Browser automation | [Tech Stack Recommendation §3.4](tech-stack-recommendation.md#34-development-tools-and-quality) |
| **API Testing Tool** | Supertest | 6.3.4+ | HTTP API testing | NestJS ecosystem standard |
| **Test Containers** | Testcontainers | 11.6.0+ | Database and cache testing | Integration test standard |
| **Code Coverage** | Istanbul | Built-in | Coverage statistics | Jest integration |
| **Performance Testing** | k6 | Latest | Load testing | Performance test standard |

### 13.2 Related Documents
1. [Tech Stack Recommendation](tech-stack-recommendation.md) - Test tool selection basis
2. [System Architecture Design Document (SAD)](system-architecture-design.md) - Test layered architecture basis
3. [API Design Specification](api-design-specification.md) - API test specification basis
4. [Data Architecture Design Document](data-architecture.md) - Database test strategy basis
5. [Security Architecture Design Document](security-architecture.md) - Security test strategy basis

### 13.3 TDD Checklist
- [ ] Was a failing test written before developing a new feature (RED)?
- [ ] Does the implementation code make all tests pass (GREEN)?
- [ ] Is refactoring performed under test protection?
- [ ] Has test coverage reached the target threshold?
- [ ] Does defect fixing include regression tests?

### 13.4 Testing Team Contacts
- **Test Lead**: [Name]
- **Automation Test Engineer**: [Name]
- **Performance Test Expert**: [Name]
- **Security Test Expert**: [Name]

---
*Document Version: 2.4.0 (Angular+NestJS Refactored Edition)*
*Last Updated: 2026-05-11*
*Maintenance Team: Quality Assurance Team*
*TDD Compliance: Compliant with RED/GREEN test-driven design specification*

### Changelog

| Version | Date | Author | Changes |
|------|------|-------|----------|
| 2.4.0 | 2026-05-11 | @Architect | Added §5.2.6 multi-slot booking and financial field test scenarios (FIN-001~003, MULTI-001~003, OVERTIME-001, TAX-001) |
| 2.3.0 | 2026-05-06 | @Architect | Deprecated generic `/v1/auth/verification-codes/*` test interface, replaced with purpose-separated endpoints (register/send-code + register/complete, login/send-code + login/verify-code) |
| 2.2.0 | 2026-05-06 | @Architect | Added §5.2.7 reset password test scenarios (RESET-PW-001 send-code rate limit validation + RESET-PW-002 verify password reset validation), E2E scenario extensions |
| 2.1.0 | 2026-05-04 | @Architect (Phase 5) | Added §5.2.6 Admin Dashboard integration test cases (DASH-001~004 backend + DASH-FE-001~003 frontend), coverage target ≥ 70% |
| 2.0.0 | 2026-04-14 | System Architecture Analysis Tool | Initial baseline version |
