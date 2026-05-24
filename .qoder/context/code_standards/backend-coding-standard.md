# NestJS Backend Coding Standard

## Document Information

| Property | Value |
| :--- | :--- |
| **Document Version** | 1.1.0 |
| **Created Date** | 2026-04-15 |
| **Applicable Project** | CRM Booking System Refactored (NestJS v11+) |
| **Document Status** | Baselined |
| **Related Documents** | system-architecture-design (SAD) v2.0, api-design-specification v2.0, data-architecture v2.0, security-architecture v2.1, testing-strategy v2.0, operations-deployment v2.0 |
| **Location** | `.qoder/context/code_standards/backend-coding-standard.md` |

---

## 1. Core Principles

### 1.1 Modularity and Separation of Concerns

Each module is responsible for a single business domain, with clear internal layered separation.

| File Type | Responsibility | Naming Convention | Example |
| :--- | :--- | :--- | :--- |
| `*.module.ts` | Module definition, dependency injection configuration | `kebab-case.module.ts` | `appointments.module.ts` |
| `*.controller.ts` | HTTP request handling, route definitions | `kebab-case.controller.ts` | `slot-preemption.controller.ts` |
| `*.service.ts` | Business logic implementation | `kebab-case.service.ts` | `appointment.service.ts` |
| `*.dto.ts` | Data transfer objects, input validation | `kebab-case.dto.ts` | `create-appointment.dto.ts` |
| `*.guard.ts` | Authentication/authorization guards | `kebab-case.guard.ts` | `jwt-auth.guard.ts` |
| `*.interceptor.ts` | Response interceptors | `kebab-case.interceptor.ts` | `logging.interceptor.ts` |
| `*.filter.ts` | Exception filters | `kebab-case.filter.ts` | `global-exception.filter.ts` |
| `*.pipe.ts` | Custom pipes | `kebab-case.pipe.ts` | `validation.pipe.ts` |
| `*.decorator.ts` | Custom decorators | `kebab-case.decorator.ts` | `current-user.decorator.ts` |
| `*.strategy.ts` | Passport authentication strategies | `kebab-case.strategy.ts` | `jwt.strategy.ts` |

### 1.2 Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Decorator Layer (@Public, @Roles, @RateLimit)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Guard Layer (JwtAuthGuard, RolesGuard)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Interceptor Layer (Logging, Transform)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Pipe Layer (ValidationPipe)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Controller Layer (Controller)                    │
│       Handles HTTP requests, parameter validation,           │
│       response formatting                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Service Layer (Service)                          │
│       Core business logic, transaction management,           │
│       domain rules                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Data Access Layer (PrismaService)                │
│              Prisma Client, database operations               │
└─────────────────────────────────────────────────────────────┘
```

**Layer Dependency Rules**:
- **Controller** may only call **Service**; direct database access is forbidden.
- **Service** may call **PrismaService** and other **Services**; responsible for transaction boundaries.
- **PrismaService** is the sole entry point for database interaction.

---

## 2. Project Directory Structure

```
booking-backend/
├── src/
│   ├── main.ts                         # Application entry (Express, Helmet, CORS, Swagger)
│   ├── app.module.ts                   # Root module (global guards/interceptors/filters config)
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
│   │   │   └── roles.decorator.ts       # Role annotation
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
│   ├── modules/                         # Business modules (organized by domain)
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
│   │   ├── services/                    # Services catalog module
│   │   ├── email/                       # Email module (BullMQ + Nodemailer)
│   │   ├── notifications/               # Notifications module (Socket.io WebSocket)
│   │   ├── cache/                       # Cache module (@Global Redis)
│   │   ├── rate-limiter/                # Rate limiter module (@nestjs/throttler)
│   │   ├── health/                      # Health check module
│   │   ├── stats/                       # Statistics/analytics module
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

### 3.1 Naming Rules

| Type | Naming Rule | Example |
| :--- | :--- | :--- |
| **File** | `kebab-case` | `appointment.service.ts` |
| **Class** | `PascalCase` | `AppointmentService`, `AuthController` |
| **Interface** | **No `I` prefix**, `PascalCase` | `Appointment`, `UserSession` |
| **Type Alias** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **Enum** | `PascalCase`, members `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING }` |
| **Constant** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `JWT_EXPIRES_IN` |
| **Variable/Function** | `camelCase` | `currentUser`, `findAvailableSlots()` |
| **Private Member** | `private readonly` modifier | `private readonly prisma: PrismaService` |

> **Note**: Interface naming is consistent with the frontend standard — the `I` prefix is **forbidden**.

### 3.2 Type Safety

**Mandatory Rule**: `any` is forbidden. All function parameters and return values must have explicit types.

```typescript
// ❌ Forbidden
async create(data: any): Promise<any> { ... }

// ✅ Correct
async create(data: CreateAppointmentDto): Promise<Appointment> { ... }
```

### 3.3 Class Member Order

Class members must be arranged in the following order:

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

## 4. Module Standard

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

- Circular dependencies are **forbidden**. If detected, extract shared logic to `common/`.
- Cross-module calls must go through Services exposed via `exports`.

---

## 5. Controller Standard

### 5.1 Controller Responsibilities

- Handle HTTP requests and responses.
- Parameter validation (via DTO + ValidationPipe).
- Call the corresponding Service methods.
- **Must not** contain business logic.

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
  @ApiOperation({ summary: 'Create appointment' })
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

### 5.3 Routing Standard

| Rule | Description |
| :--- | :--- |
| **Global Prefix** | `/v1` (configured in main.ts) |
| **Resource Path** | Plural nouns: `/v1/appointments`, `/v1/users` |
| **Authentication** | JWT required by default; use `@Public()` to mark public routes |
| **Rate Limiting** | Auth endpoints `tier: 'auth'`, booking endpoints `tier: 'strict'`, others `tier: 'api'` |
| **Swagger** | All endpoints must have `@ApiOperation` and `@ApiResponse` |

---

## 6. Service Layer Standard

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
   * Relies on PostgreSQL partial unique index + slot_sequence atomic increment
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
          throw new ConflictException('This time slot is fully booked');
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
      maxWait: 5000,   // Maximum wait time before transaction starts
      timeout: 10000,  // Transaction timeout
    },
  );
}
```

---

## 7. DTO Standard

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

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Status filter' })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}
```

### 7.2 DTO Rules

- Use **class** instead of interface (preserves runtime type information for ValidationPipe).
- All fields must have `class-validator` decorators.
- All fields must have `@nestjs/swagger` decorators.
- Query parameters use `XxxDto` naming; request bodies use `CreateXxxDto`/`UpdateXxxDto` naming.

---

## 8. Authentication and Authorization

### 8.1 JWT Authentication Flow

1. User calls `POST /v1/auth/login` or `POST /v1/auth/register`.
2. AuthService validates credentials and generates JWT (Access Token 15 min + Refresh Token 7 days).
3. JwtStrategy extracts and validates the JWT Payload.
4. JwtAuthGuard checks the `@Public()` decorator and enforces authentication.

### 8.2 RBAC Permission Model

| Role | Permission Scope |
| :--- | :--- |
| `SUPER_ADMIN` | All operations (manage users, services, appointments, system settings, audit logs, admin accounts) |
| `ADMIN` | User CRUD, Service CRUD, appointment management, Dashboard statistics and trends |
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

## 9. Rate Limiting Standard

### 9.1 Multi-Layer Rate Limiting Strategy

| Layer | Strategy | Limit |
| :--- | :--- | :--- |
| User + Time Slot | Prevent concurrent preemption | 1 request/second |
| User Daily | Prevent malicious spam | 20 appointments/day |
| IP Global | Prevent crawlers/brute force | 10 requests/minute |
| Global User | System-level protection | 100 requests/minute |

### 9.2 Decorator Usage

```typescript
@RateLimit({ tier: 'auth', key: 'ip' })      // Auth endpoints
@RateLimit({ tier: 'strict', key: 'user' })   // Booking endpoints
@RateLimit({ tier: 'api', key: 'ip' })        // General endpoints
```

---

## 10. Cache Standard

### 10.1 Redis Cache Strategy

| Cache Item | TTL | Purpose |
| :--- | :--- | :--- |
| `session:{userId}` | 7 days | JWT session cache (write-through) |
| `slot:availability:{slotId}` | 30 minutes | Time slot availability |
| `slot:{slotId}:remaining` | Dynamic | Appointment quota counter (atomic decrement) |

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

The project uses `GlobalExceptionFilter` to handle exceptions uniformly, mapping Prisma errors to standard HTTP responses.

```typescript
// GlobalExceptionFilter automatically handles the following Prisma errors:
// P2002 → 409 Conflict (unique constraint violation)
// P2025 → 404 Not Found (record does not exist)
// P2003 → 400 Bad Request (foreign key constraint)
```

### 11.2 Error Response Format

```json
{
  "statusCode": 409,
  "message": "This time slot is fully booked",
  "error": "Conflict",
  "timestamp": "2026-04-15T10:30:00.000Z"
}
```

---

## 12. Logging Standard

### 12.1 Structured Logging

```typescript
// Using the NestJS Logger class
private readonly logger = new Logger(AppointmentService.name);

// Log level usage
this.logger.log('Appointment created successfully');     // INFO
this.logger.warn('Slot capacity approaching limit');     // WARNING
this.logger.error('Failed to create appointment', err);  // ERROR
this.logger.debug(`Processing slot: ${slotId}`);         // DEBUG
```

### 12.2 Logging Interceptor

`LoggingInterceptor` automatically records:
- Request method, path, user ID
- Response status code, elapsed time
- Request/response body (development environment)

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

## 14. Testing Standard

### 14.1 TDD Process

Strictly follow the **RED → GREEN → REFACTOR** cycle:
1. **RED**: Write the test first, execution fails
2. **GREEN**: Write the minimum code to pass the test
3. **REFACTOR**: Refactor code while keeping tests passing

### 14.2 Coverage Requirements

| Type | Minimum Coverage |
| :--- | :--- |
| Line Coverage | 70% |
| Branch Coverage | 70% |
| Function Coverage | 70% |
| Business Critical Paths | 90%+ |

### 14.3 Migration Notes (Financial Fields)

After adding financial fields to the Appointment model, run `npx prisma migrate dev` to generate migration files. The migration includes:

1. **Service table**: New columns `price_per_minute` (Decimal(10,2)), `tax_rate` (Decimal(5,4))
2. **Appointment table**: New columns `duration_minutes` (Int default 30), `price` (Decimal(10,2)), `tax_rate` (Decimal(5,4)), `tax_included_amount` (Decimal(10,2))

> **Note**: `price`, `taxRate`, and `taxIncludedAmount` are price snapshot fields, copied from Service at appointment creation time to prevent subsequent Service price changes from affecting existing appointment bills. In overtime scenarios, `price = service.price + (overtimeMinutes × service.pricePerMinute)`, calculated at the application layer during creation.

### 14.4 Testing Tools

- **Unit Tests**: Jest + ts-jest
- **Integration Tests**: Testcontainers (PostgreSQL + Redis)
- **E2E Tests**: Supertest
- **Contract Tests**: Contract-based testing

### 14.4 Test File Organization

```
test/
├── unit/           # Unit tests co-located with services
├── integration/    # Integration tests (real database)
├── e2e/           # End-to-end tests (full request flow)
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

## 15. Security Standard

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

main.ts is configured with Helmet, which automatically adds:
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

## 16. Core Standard Quick Reference

1. **File Separation**: Each NestJS artifact in its own file (controller/service/dto/guard separated)
2. **Modularity**: Organize modules by business domain; circular dependencies forbidden
3. **Naming Convention**: Interfaces without `I` prefix; files use `kebab-case`
4. **Transaction Management**: Use `prisma.$transaction()` to manage transaction boundaries
5. **Type Safety**: `any` forbidden; DTOs use class + class-validator
6. **Authentication/Authorization**: JWT + Passport; `@Public()` skips auth; `@Roles()` for role control
7. **Rate Limiting**: Multi-layer rate limiting (user/time-slot/IP/global)
8. **Error Handling**: Unified `GlobalExceptionFilter`; maps Prisma errors
9. **Logging**: Use NestJS Logger class; LoggingInterceptor auto-records requests
10. **Swagger**: All endpoints must have complete OpenAPI documentation
11. **TDD**: RED → GREEN → REFACTOR; coverage ≥70%
12. **Cache**: Redis Cache-Aside pattern; write-through session cache

---

## 17. Related Document References

| Document | Purpose |
| :--- | :--- |
| [system-architecture-design (SAD) v2.5.0](.qoder/context/requirements/system-architecture-design.md) | Overall architecture, high-concurrency design, module partitioning |
| [api-design-specification v2.9.0](.qoder/context/requirements/api-design-specification.md) | RESTful API standard, rate limiting strategy, error codes |
| [data-architecture v2.6.0](.qoder/context/requirements/data-architecture.md) | Data model, indexing strategy, cache architecture |
| [security-architecture v2.4.0](.qoder/context/requirements/security-architecture.md) | 5-layer security model, JWT authentication, RBAC |
| [testing-strategy v2.4.0](.qoder/context/requirements/testing-strategy.md) | TDD process, coverage requirements, testing tools |
| [operations-deployment v2.0](.qoder/context/requirements/operations-deployment.md) | Docker deployment, CI/CD, health checks |

---

## 18. Change Log

| Date | Version | Changes | Approved By |
|------|------|---------|--------|
| 2026-05-11 | 1.1.0 | Added §14.3 Migration Notes (financial fields): Service adds pricePerMinute/taxRate, Appointment adds durationMinutes/price/taxRate/taxIncludedAmount | @Architect |
| 2026-05-11 | 1.2.0 | Removed BookingGroup model and bookingGroupId field; changed to overtime-only extension; added overtime-overlap application-layer validation | @Architect |
| 2026-04-15 | 1.0.0 | Initial version | Architecture Review |
