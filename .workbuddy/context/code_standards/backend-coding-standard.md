# NestJS Backend Coding Standards

## Document Information

| Attribute | Value |
| :--- | :--- |
| **Document Version** | 1.1.0 |
| **Created Date** | 2026-04-15 |
| **Applicable Project** | CRM Appointment System Refactored (NestJS v11+) |
| **Document Status** | Baselined |
| **Related Documents** | System Architecture Design Document (SAD) v2.0, Interface Design Specification v2.0, Data Architecture Design Document v2.0, Security Architecture Design Document v2.1, Testing Strategy and Plan v2.0, Operations and Deployment Design Document v2.0 |
| **Storage Location** | `.opencode/context/code_standards/backend-coding-standard.md` |

---

## 1. Core Principles

### 1.1 Modularization and Separation of Concerns

Each module is responsible for only one business domain, with internal layers clearly separated.

| File Type | Responsibility | Naming Convention | Example |
| :--- | :--- | :--- | :--- |
| `*.module.ts` | Module definition, dependency injection configuration | `kebab-case.module.ts` | `appointments.module.ts` |
| `*.controller.ts` | HTTP request handling, route definition | `kebab-case.controller.ts` | `slot-preemption.controller.ts` |
| `*.service.ts` | Business logic implementation | `kebab-case.service.ts` | `appointment.service.ts` |
| `*.dto.ts` | Data transfer object, input validation | `kebab-case.dto.ts` | `create-appointment.dto.ts` |
| `*.guard.ts` | Authentication/authorization guard | `kebab-case.guard.ts` | `jwt-auth.guard.ts` |
| `*.interceptor.ts` | Response interceptor | `kebab-case.interceptor.ts` | `logging.interceptor.ts` |
| `*.filter.ts` | Exception filter | `kebab-case.filter.ts` | `global-exception.filter.ts` |
| `*.pipe.ts` | Custom pipe | `kebab-case.pipe.ts` | `validation.pipe.ts` |
| `*.decorator.ts` | Custom decorator | `kebab-case.decorator.ts` | `current-user.decorator.ts` |
| `*.strategy.ts` | Passport authentication strategy | `kebab-case.strategy.ts` | `jwt.strategy.ts` |

### 1.2 Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Decorator Layer (@Public, @Roles, @RateLimit)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Guard Layer (JwtAuthGuard, RolesGuard)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Interceptor Layer (Logging, Transform)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Pipe Layer (ValidationPipe)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Controller Layer                        │
│           Handle HTTP requests, parameter validation, response formatting                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Service Layer                             │
│              Core business logic, transaction management, domain rules                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Data Access Layer (PrismaService)                   │
│                  Prisma Client, database operations                    │
└─────────────────────────────────────────────────────────────┘
```

**Layer Dependency Rules**:
- **Controller** can only call **Service** and must not access the database directly.
- **Service** can call **PrismaService** and other **Service**s, and is responsible for transaction boundaries.
- **PrismaService** is the sole entry point for database interaction.

---

## 2. Project Directory Structure

```
booking-backend/
├── src/
│   ├── main.ts                         # Application entry point (Express, Helmet, CORS, Swagger)
│   ├── app.module.ts                   # Root module (global guard/interceptor/filter configuration)
│   │
│   ├── common/                          # Common infrastructure (globally reusable)
│   │   ├── database/                    # Database module (@Global)
│   │   │   ├── database.module.ts
│   │   │   └── prisma.service.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts        # JWT authentication guard (with @Public exemption)
│   │   │   ├── roles.guard.ts           # Role guard
│   │   │   └── permissions.guard.ts     # Permission guard
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts  # Global exception filter (Prisma error mapping)
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts   # Request/response logging
│   │   ├── decorators/
│   │   │   ├── public.decorator.ts      # Skip JWT authentication
│   │   │   └── roles.decorator.ts       # Role marker
│   │   ├── constants/
│   │   │   └── permissions.constants.ts # RBAC permission constants
│   │   ├── dto/
│   │   │   └── base.dto.ts              # Shared DTO base class
│   │   └── utils/
│   │       └── password.util.ts         # bcrypt password hashing utility
│   │
│   ├── config/                          # Configuration module
│   │   └── redis.config.ts              # Redis configuration factory
│   │
│   ├── modules/                         # Business modules (divided by domain)
│   │   ├── auth/                        # Authentication module
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── login.dto.ts
│   │   │   │   └── token.dto.ts
│   │   │   └── strategies/
│   │   │       └── jwt.strategy.ts
│   │   │
│   │   ├── appointments/                # Appointments module (core)
│   │   │   ├── appointments.module.ts
│   │   │   ├── appointments.controller.ts
│   │   │   └── appointments.service.ts
│   │   │
│   │   ├── time-slots/                  # Time slots module (high concurrency)
│   │   │   ├── time-slots.module.ts
│   │   │   ├── time-slots.controller.ts
│   │   │   ├── slot-preemption.controller.ts
│   │   │   ├── time-slots.service.ts
│   │   │   └── slot-preemption.service.ts
│   │   │
│   │   ├── users/                       # Users module
│   │   ├── services/                    # Service catalog module
│   │   ├── email/                       # Email module (BullMQ + Nodemailer)
│   │   ├── notifications/               # Notifications module (Socket.io WebSocket)
│   │   ├── cache/                       # Cache module (@Global Redis)
│   │   ├── rate-limiter/                # Rate limiter module (@nestjs/throttler)
│   │   ├── health/                      # Health check module
│   │   ├── stats/                       # Statistics analysis module
│   │   └── audit/                       # Audit log module
│   │
│   └── types/                           # Global type definitions
│       ├── express.d.ts
│       └── enums.ts
│
├── prisma/
│   ├── schema.prisma                    # Data model definition (11 core entities)
│   ├── migrations/                      # Versioned migration files
│   └── seed.ts                          # Seed data
│
├── test/
│   ├── e2e/                             # End-to-end tests
│   ├── integration/                     # Integration tests (Testcontainers)
│   ├── factories/                       # Test data factories
│   ├── fixtures/                        # Test fixture data
│   └── setup/                           # Test environment configuration
│
└── docs/
    ├── auth-design.md                   # Authentication architecture design
    ├── high-concurrency-design.md       # High concurrency design document
    └── permission-matrix.json           # RBAC permission matrix
```

---

## 3. TypeScript and Naming Conventions

### 3.1 Naming Conventions

| Type | Naming Rule | Example |
| :--- | :--- | :--- |
| **File** | `kebab-case` | `appointment.service.ts` |
| **Class** | `PascalCase` | `AppointmentService`, `AuthController` |
| **Interface** | **No `I` prefix**, `PascalCase` | `Appointment`, `UserSession` |
| **Type Alias** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **Enum** | `PascalCase`, members `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING }` |
| **Constants** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `JWT_EXPIRES_IN` |
| **Variables/Functions** | `camelCase` | `currentUser`, `findAvailableSlots()` |
| **Private members** | `private readonly` modifier | `private readonly prisma: PrismaService` |

> **Note**: Interface naming must be consistent with frontend conventions; **the `I` prefix is prohibited**.

### 3.2 Type Safety

**Mandatory Rule**: The use of `any` is prohibited. All function parameters and return values must have explicit types.

```typescript
// ❌ Prohibited
async create(data: any): Promise<any> { ... }

// ✅ Correct
async create(data: CreateAppointmentDto): Promise<Appointment> { ... }
```

### 3.3 Class Member Order

Class members must be ordered as follows:

```typescript
@Injectable()
export class AppointmentService implements OnModuleInit {
  // 1. static readonly constants
  private static readonly ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'];

  // 2. Dependency injection (constructor)
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  // 3. Public properties
  public readonly maxCapacity = 10;

  // 4. Private properties
  private readonly logger = new Logger(AppointmentService.name);

  // 5. Lifecycle hooks
  async onModuleInit(): Promise<void> { ... }

  // 6. Public methods
  async createAppointment(dto: CreateAppointmentDto): Promise<Appointment> { ... }

  // 7. Private methods
  private generateAppointmentNumber(): string { ... }
}
```

---

## 4. Module Specifications

### 4.1 Module Definition

Each business module must clearly declare `imports`, `controllers`, `providers`, and `exports`.

```typescript
// appointments.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentService } from './appointment.service';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    NotificationsModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {}
```

### 4.2 Global Modules (@Global)

The following modules must be marked as `@Global()` for project-wide injection:

| Global Module | Exported Content | Purpose |
| :--- | :--- | :--- |
| `DatabaseModule` | `PrismaService` | Database access entry point |
| `CacheModule` | `CacheService`, `REDIS_CLIENT_TOKEN` | Redis cache entry point |

```typescript
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

### 4.3 Inter-Module Dependencies

- Circular dependencies are **prohibited**. If they arise, extract shared logic to `common/`.
- Cross-module calls must go through Services exported via `exports`.

---

## 5. Controller Specifications

### 5.1 Controller Responsibilities

- Handle HTTP requests and responses.
- Parameter validation (via DTO + ValidationPipe).
- Call the corresponding Service method.
- Must **not** contain business logic.

### 5.2 Controller Template

```typescript
import {
  Controller, Post, Get, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
} from '@nestjs/swagger';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { Appointment } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../modules/rate-limiter/decorators/rate-limit.decorator';

@ApiTags('Appointment Management')
@ApiBearerAuth('JWT-auth')
@Controller('v1/appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ tier: 'strict', key: 'user' })
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Create Appointment' })
  @ApiResponse({ status: 201, description: 'Appointment created successfully' })
  @ApiResponse({ status: 409, description: 'Appointment conflict' })
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
  ): Promise<Appointment> {
    return this.appointmentService.create(createAppointmentDto);
  }

  @Get('available')
  @Public()
  @ApiOperation({ summary: 'Query available time slots' })
  async getAvailableSlots(
    @Query() query: ListSlotsDto,
  ): Promise<TimeSlot[]> {
    return this.appointmentService.getAvailableSlots(query);
  }
}
```

### 5.3 Route Specifications

| Rule | Description |
| :--- | :--- |
| **Global prefix** | `/v1` (configured in main.ts) |
| **Resource path** | Plural noun: `/v1/appointments`, `/v1/users` |
| **Authentication requirement** | JWT required by default; use `@Public()` to mark public routes |
| **Rate limiting strategy** | Auth endpoints `tier: 'auth'`, appointment endpoints `tier: 'strict'`, others `tier: 'api'` |
| **Swagger** | All endpoints must have `@ApiOperation` and `@ApiResponse` |

---

## 6. Service Layer Specifications

### 6.1 Service Responsibilities

- Encapsulate core business logic.
- Manage transaction boundaries.
- Call PrismaService and other Services.
- Handle business exceptions.

### 6.2 High-Concurrency Appointment Creation (Atomic Transaction)

```typescript
import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { Appointment, Prisma } from '@prisma/client';

@Injectable()
export class AppointmentService {
  private readonly logger = new Logger(AppointmentService.name);
  private static readonly ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Create appointment - high-concurrency atomic preemption
   * Relies on PostgreSQL partial unique index + atomic slot_sequence increment
   * Isolation level: READ COMMITTED
   */
  async create(dto: CreateAppointmentDto): Promise<Appointment> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1. Atomically increment timeSlot.currentSequence
        const timeSlot = await tx.timeSlot.update({
          where: { id: dto.timeSlotId },
          data: { currentSequence: { increment: 1 } },
        });

        if (timeSlot.currentSequence > timeSlot.capacity) {
          throw new ConflictException('Appointment slots for this time period are fully booked');
        }

        // 2. Create appointment record (relies on partial unique constraint to prevent concurrent conflicts)
        const appointment = await tx.appointment.create({
          data: {
            userId: dto.userId,
            timeSlotId: dto.timeSlotId,
            serviceId: dto.serviceId,
            appointmentDate: dto.appointmentDate,
            slotSequence: timeSlot.currentSequence,
            status: 'PENDING',
          },
        });

        return appointment;
      },
      {
        maxWait: 5000,
        timeout: 10000,
      },
    );
  }
}
```

### 6.3 Exception Handling

| Exception Type | Use Case | HTTP Status Code |
| :--- | :--- | :--- |
| `NotFoundException` | Resource not found | 404 |
| `ConflictException` | Appointment conflict, duplicate operation | 409 |
| `BadRequestException` | Parameter validation failure (cases not handled by pipe) | 400 |
| `UnauthorizedException` | Authentication failure | 401 |
| `ForbiddenException` | Insufficient permissions | 403 |

### 6.4 Transaction Management

```typescript
// Standard transaction template
async performTransaction(dto: SomeDto): Promise<SomeEntity> {
  return this.prisma.$transaction(
    async (tx) => {
      // All database operations execute on tx
      const result1 = await tx.model1.create({ ... });
      const result2 = await tx.model2.update({ ... });
      return result2;
    },
    {
      maxWait: 5000,   // Maximum wait time for transaction to start
      timeout: 10000,  // Transaction timeout
    },
  );
}
```

---

## 7. DTO Specifications

### 7.1 DTO Definition

```typescript
import { IsString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';

export class CreateAppointmentDto {
  @ApiProperty({ description: 'User ID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Time slot ID' })
  @IsUUID()
  timeSlotId: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListAppointmentsDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Status filter' })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}
```

### 7.2 DTO Rules

- Use **class** instead of interface (retains type information at runtime for use by ValidationPipe).
- All fields must have `class-validator` decorators.
- All fields must have `@nestjs/swagger` decorators.
- Query parameters use `XxxDto` naming; request bodies use `CreateXxxDto`/`UpdateXxxDto` naming.

---

## 8. Authentication and Authorization

### 8.1 JWT Authentication Flow

1. User calls `POST /v1/auth/login` or `POST /v1/auth/register`.
2. AuthService validates credentials and generates JWT (Access Token 15 min + Refresh Token 7 days).
3. JwtStrategy extracts and validates the JWT payload.
4. JwtAuthGuard checks the `@Public()` decorator and enforces authentication.

### 8.2 RBAC Permission Model

| Role | Permission Scope |
| :--- | :--- |
| `SUPER_ADMIN` | All operations (manage users, services, appointments, system settings, audit logs, admin accounts) |
| `ADMIN` | Manage user CRUD, service CRUD, appointment management, Dashboard statistics and trends |
| `CUSTOMER` | View personal profile, create/cancel personal appointments, view personal appointment history |

### 8.3 Permission Decorators

```typescript
// Role decorator usage
@Roles('ADMIN', 'SUPER_ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
async deleteUser(@Param('id') id: string): Promise<void> { ... }

// Public route decorator
@Public()
async getAvailableSlots(@Query() query: ListSlotsDto): Promise<TimeSlot[]> { ... }
```

---

## 9. Rate Limiting Specifications

### 9.1 Multi-Layer Rate Limiting Strategy

| Layer | Strategy | Limit |
| :--- | :--- | :--- |
| User + Time Slot | Prevent concurrent preemption | 1 request/sec |
| User per day | Prevent malicious spamming | 20 appointments/day |
| IP global | Prevent crawling/brute force | 10 requests/min |
| Global user | System-level protection | 100 requests/min |

### 9.2 Decorator Usage

```typescript
@RateLimit({ tier: 'auth', key: 'ip' })      // Authentication endpoints
@RateLimit({ tier: 'strict', key: 'user' })   // Appointment endpoints
@RateLimit({ tier: 'api', key: 'ip' })        // Regular endpoints
```

---

## 10. Cache Specifications

### 10.1 Redis Cache Strategy

| Cache Item | TTL | Purpose |
| :--- | :--- | :--- |
| `session:{userId}` | 7 days | JWT session cache (write-through) |
| `slot:availability:{slotId}` | 30 min | Time slot availability |
| `slot:{slotId}:remaining` | Dynamic | Appointment slot counter (atomic decrement) |

### 10.2 Cache Usage Pattern

```typescript
// Cache-Aside pattern
async getCachedSlotAvailability(slotId: string): Promise<boolean> {
  const cacheKey = `slot:availability:${slotId}`;
  const cached = await this.cacheService.get(cacheKey);
  if (cached !== null) return JSON.parse(cached);

  const result = await this.prisma.timeSlot.findUnique({ ... });
  await this.cacheService.set(cacheKey, JSON.stringify(result), 1800);
  return result;
}
```

---

## 11. Error Handling

### 11.1 Global Exception Filter

The project uses `GlobalExceptionFilter` for unified exception handling, mapping Prisma errors to standard HTTP responses.

```typescript
// GlobalExceptionFilter automatically handles the following Prisma errors:
// P2002 → 409 Conflict (unique constraint violation)
// P2025 → 404 Not Found (record not found)
// P2003 → 400 Bad Request (foreign key constraint)
```

### 11.2 Error Response Format

```json
{
  "statusCode": 409,
  "message": "Appointment slots for this time period are fully booked",
  "error": "Conflict",
  "timestamp": "2026-04-15T10:30:00.000Z"
}
```

---

## 12. Logging Specifications

### 12.1 Structured Logging

```typescript
// Use NestJS Logger class
private readonly logger = new Logger(AppointmentService.name);

// Log level usage
this.logger.log('Appointment created successfully');     // INFO
this.logger.warn('Slot capacity approaching limit');     // WARNING
this.logger.error('Failed to create appointment', err);  // ERROR
this.logger.debug(`Processing slot: ${slotId}`);         // DEBUG
```

### 12.2 Logging Interceptor

`LoggingInterceptor` automatically logs:
- Request method, path, user ID
- Response status code, duration
- Request/response body (dev environment)

---

## 13. Swagger/OpenAPI Documentation

### 13.1 Required Decorators

| Decorator | Purpose |
| :--- | :--- |
| `@ApiTags()` | API grouping |
| `@ApiBearerAuth()` | JWT authentication marker |
| `@ApiOperation()` | Endpoint description |
| `@ApiResponse()` | Response description (at least 200 + error codes) |
| `@ApiProperty()` | DTO field description |

### 13.2 Documentation Access

- Swagger UI: `/api/docs`
- OpenAPI JSON: `/api-json`

---

## 14. Testing Specifications

### 14.1 TDD Workflow

Strictly follow the **RED → GREEN → REFACTOR** cycle:
1. **RED**: Write tests first, ensure they fail
2. **GREEN**: Write minimal code to pass tests
3. **REFACTOR**: Refactor code while keeping tests passing

### 14.2 Coverage Requirements

| Type | Minimum Coverage |
| :--- | :--- |
| Line coverage | 70% |
| Branch coverage | 70% |
| Function coverage | 70% |
| Business critical path | 90%+ |

### 14.3 Migration Notes (Financial Fields)

After adding Appointment financial fields, run `npx prisma migrate dev` to generate migration files. The migration includes:

1. **Service table**: Add `price_per_minute` (Decimal(10,2)), `tax_rate` (Decimal(5,4)) columns
2. **Appointment table**: Add `duration_minutes` (Int default 30), `price` (Decimal(10,2)), `tax_rate` (Decimal(5,4)), `tax_included_amount` (Decimal(10,2)) columns

> **Note**: `price`, `taxRate`, and `taxIncludedAmount` are price snapshot fields, copied from Service at appointment creation time to prevent subsequent Service price changes from affecting existing appointment bills. In overtime scenarios, `price = service.price + (overtimeMinutes × service.pricePerMinute)`, calculated by the application layer at creation time.

### 14.4 Testing Tools

- **Unit tests**: Jest + ts-jest
- **Integration tests**: Testcontainers (PostgreSQL + Redis)
- **E2E tests**: Supertest
- **Contract tests**: Contract-based testing

### 14.4 Test File Organization

```
test/
├── unit/           # Unit tests co-located with services
├── integration/    # Integration tests (real database)
├── e2e/           # End-to-end tests (complete request flow)
├── factories/     # Test data factories
├── fixtures/      # Test fixture data
└── setup/         # Test environment configuration
```

### 14.5 Unit Test Template

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentService } from './appointment.service';
import { PrismaService } from '../../common/database/prisma.service';

describe('AppointmentService', () => {
  let service: AppointmentService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AppointmentService>(AppointmentService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create appointment successfully', async () => {
    // Arrange
    const dto: CreateAppointmentDto = { ... };
    jest.spyOn(prisma, '$transaction').mockResolvedValue({ ... });

    // Act
    const result = await service.create(dto);

    // Assert
    expect(result).toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

---

## 15. Security Specifications

### 15.1 Password Handling

```typescript
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword);
}
```

### 15.2 Security Headers (Helmet)

Helmet is configured in main.ts, automatically adding:
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`

### 15.3 CORS Configuration

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
});
```

---

## 16. Core Standards Quick Reference

1. **File separation**: Each NestJS artifact in its own file (separate controller/service/dto/guard)
2. **Modularization**: Divide modules by business domain; circular dependencies are prohibited
3. **Naming conventions**: No `I` prefix for interfaces; files use `kebab-case`
4. **Transaction management**: Use `prisma.$transaction()` to manage transaction boundaries
5. **Type safety**: `any` is prohibited; DTOs use class + class-validator
6. **Authentication & authorization**: JWT + Passport, `@Public()` skips authentication, `@Roles()` for role control
7. **Rate limiting**: Multi-layer (user/time slot/IP/global)
8. **Error handling**: Unified `GlobalExceptionFilter`, mapping Prisma errors
9. **Logging**: Use NestJS Logger class; LoggingInterceptor automatically logs requests
10. **Swagger**: All endpoints must have complete OpenAPI documentation
11. **TDD**: RED → GREEN → REFACTOR, coverage ≥70%
12. **Caching**: Redis Cache-Aside pattern, write-through session cache

---

## 17. Related Document References

| Document | Purpose |
| :--- | :--- |
| [System Architecture Design Document (SAD) v2.5.0](../requirements/系统架构设计文档（SAD）.md) | Overall architecture, high-concurrency design, module division |
| [Interface Design Specification v2.9.0](../requirements/接口设计规范文档.md) | RESTful API standards, rate limiting strategy, error codes |
| [Data Architecture Design Document v2.6.0](../requirements/数据架构设计文档.md) | Data model, index strategy, cache architecture |
| [Security Architecture Design Document v2.4.0](../requirements/安全架构设计文档.md) | 5-layer security model, JWT authentication, RBAC |
| [Testing Strategy and Plan v2.4.0](../requirements/测试策略与计划.md) | TDD workflow, coverage requirements, testing tools |
| [Operations and Deployment Design Document v2.0](../requirements/运维与部署设计文档.md) | Docker deployment, CI/CD, health checks |

---

## 18. Change Log

| Date | Version | Change Description | Approved By |
|------|------|---------|--------|
| 2026-05-11 | 1.1.0 | Added §14.3 Migration Notes (Financial Fields), added pricePerMinute/taxRate to Service, added durationMinutes/price/taxRate/taxIncludedAmount to Appointment | @Architect |
| 2026-05-11 | 1.2.0 | Removed BookingGroup model and bookingGroupId field; changed to overtime-only extension; added overtime-overlap application-level validation | @Architect |
| 2026-04-15 | 1.0.0 | Initial version | Architecture review |
