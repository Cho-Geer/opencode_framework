---
trigger: manual
alwaysApply: false
---
# Booking System - API Design Specification (Angular + NestJS Refactored Edition)

## Document Information
- **Document Version**: 2.9.2
- **Created Date**: 2026-04-14
- **Last Updated**: 2026-05-15
- **Contract Version**: contract.yaml v1.7.8
- **Refactored Tech Stack**: Angular v21+ + NestJS v11+ + Prisma 7.x + PostgreSQL 16 + Redis 7.x + BullMQ
- **API Style**: RESTful API (OpenAPI 3.0 specification)
- **Authentication**: JWT Token + Passport strategy
- **Rate Limiting**: @nestjs/throttler module
- **Documentation Generation**: @nestjs/swagger + Swagger UI
- **Data Validation**: class-validator + class-transformer + Zod
- **Document Status**: Baselined
- **Author**: System Architecture Analysis Tool
- **Change Log**: v2.9.2(2026-05-15): Added percentage/decimal format descriptions to tax_rate Wire Format mapping table; v2.9.0(2026-05-11): Added Wire Format mappings for new Service/Appointment model fields; CreateAppointmentDto adds optional overtimeMinutes field; v2.8.0(2026-05-06): Removed staffId field from slot.booked WebSocket event payload — Staff model permanently removed, no corresponding data; v2.7.0(2026-05-06): Deprecated generic `/v1/auth/verification-codes/send` and `/v1/auth/verification-codes/verify`, replaced with purpose-separated endpoints (register/send-code, login/send-code, reset-password/send-code); v2.6.0(2026-05-06): Added reset password endpoints (RESET-PW-001~002) to §2 Auth endpoint definitions, with DTO, request/response examples and 2-step reset flow description; v2.5.0(2026-05-06): Removed §2.9 Schedule Management API (SCH-001~003), Staff model removed with no API support; v2.4.0(2026-05-05): Removed deprecated STAFF-003 and SVC-006 endpoint definitions; v2.3.0(2026-05-04): Added §2.8 Admin Dashboard statistics endpoints (DASH-001~004)

## 1. API Design Overview

### 1.1 Design Principles
- **RESTful Style**: Follow REST architectural constraints, use standard HTTP methods
- **Resource-Oriented**: Interfaces designed around business resources, not operations
- **Stateless**: Server does not store client state, supports horizontal scaling
- **Security**: All interfaces require authentication by default; sensitive operations require authorization
- **Consistency**: Unified response format, error handling, version management
- **Performance**: Supports high-concurrency booking scenarios, optimized response time
- **Documentation**: All interfaces automatically generate OpenAPI documentation

### 1.2 Tech Stack Alignment (Consistent with Architecture Document)
| Component | Technology | Version | Application in API Design |
|------|----------|------|----------------|
| **Frontend Framework** | Angular | v21+ | HttpClient, interceptors, Signals state management |
| **Backend Framework** | NestJS | v11+ | Controllers, guards, pipes, interceptors, filters |
| **ORM Tool** | Prisma | 7.6.0+ | Data access layer, supports partial unique index |
| **Database** | PostgreSQL | 16 | Atomic preemption, read-write separation, transaction management |
| **Cache System** | Redis | 7.x | Session storage, soft rate limiting, distributed locks |
| **Message Queue** | BullMQ | Latest | Async notifications, log processing, data sync |
| **Security Components** | helmet, @nestjs/throttler | Latest | Security headers, rate limiting, attack prevention |
| **State Management** | NgRx Signals (@ngrx/signals) | Latest | Frontend state management, optimistic UI updates |
| **Documentation Tool** | @nestjs/swagger | Latest | OpenAPI 3.0 documentation auto-generation |
| **Validation Tool** | class-validator, class-transformer, Zod | Latest | DTO validation, type conversion |

### 1.3 High-Concurrency Architecture Constraints (NFR Alignment)
| NFR-ID | Requirement Name | API Design Impact | Implementation Requirement |
|--------|----------|-------------|---------|
| **NFR-01** | Scheduled Task Mutual Exclusion | Distributed lock interfaces must support Redis SET NX EX | All scheduled task interfaces must validate distributed lock |
| **NFR-02** | Booking Concurrency Safety | Booking creation interface must use atomic preemption; timeout scenarios protected by application-layer overlap detection | Partial unique index constraint + currentSequence atomic increment |
| **NFR-03** | Stateless Service | Session stored in Redis, interfaces are stateless | JWT Token validation, no local session state |

## 2. API Design Specification

### 2.1 Basic Specification

#### 2.1.1 URL Design
- **Format**: `https://api.example.com/v1/{resource}/{id}/{sub-resource}`
- **Versioning**: All interfaces use `/v1/` prefix for future version iteration
- **Resource Naming**: Use plural nouns, lowercase letters, words separated by hyphens
- **Examples**:
  - `GET /v1/appointments` - Get appointment list
  - `GET /v1/appointments/{id}` - Get specific appointment
  - `POST /v1/appointments` - Create appointment
  - `PUT /v1/appointments/{id}` - Update appointment
  - `DELETE /v1/appointments/{id}` - Delete appointment

#### 2.1.2 HTTP Method Usage Specification
| Method | Idempotent | Safe | Purpose | Example |
|------|--------|--------|------|------|
| **GET** | Yes | Yes | Retrieve resource, no side effects | `GET /v1/users` |
| **POST** | No | No | Create new resource | `POST /v1/users` |
| **PUT** | Yes | No | Full update resource | `PUT /v1/users/{id}` |
| **PATCH** | No | No | Partial update resource | `PATCH /v1/users/{id}` |
| **DELETE** | Yes | No | Delete resource | `DELETE /v1/users/{id}` |
| **HEAD** | Yes | Yes | Get response headers | `HEAD /v1/users/{id}` |
| **OPTIONS** | Yes | Yes | Get methods supported by interface | `OPTIONS /v1/users` |

#### 2.1.3 Status Code Usage Specification
| Status Code | Meaning | Usage Scenario |
|--------|------|----------|
| **200 OK** | Request successful | GET, PUT, PATCH success response |
| **201 Created** | Resource created successfully | POST success response, includes Location header |
| **204 No Content** | Request successful, no response body | DELETE success, no return content |
| **400 Bad Request** | Request parameter error | Parameter validation failed, format error |
| **401 Unauthorized** | Not authenticated | Missing or invalid authentication token |
| **403 Forbidden** | Insufficient permission | Authenticated but no access to resource |
| **404 Not Found** | Resource does not exist | Requested resource not found |
| **409 Conflict** | Resource conflict | Conflict during creation or update |
| **422 Unprocessable Entity** | Semantic error | Business logic validation failed |
| **429 Too Many Requests** | Too many requests | Rate limit exceeded |
| **500 Internal Server Error** | Internal server error | Unhandled server exception |
| **503 Service Unavailable** | Service unavailable | Maintenance or overload, retryable |

#### 2.1.4 Request Header Specification
| Header | Required | Description | Example |
|--------|------|------|------|
| **Authorization** | Yes (except auth interfaces) | Bearer Token authentication | `Authorization: Bearer eyJhbG...` |
| **Content-Type** | Yes (when request body present) | Request body type | `Content-Type: application/json` |
| **Accept** | No | Expected response type | `Accept: application/json` |
| **X-Request-ID** | **Yes (frontend must generate)** | Request trace ID, globally unique | `X-Request-ID: req-123456` |
| **X-Client-Version** | No | Client version | `X-Client-Version: 2.1.0` |
| **X-Device-Id** | No | Device identifier | `X-Device-Id: device-abc123` |
| **X-Timezone** | No | IANA timezone identifier (e.g. `Asia/Shanghai`). Priority: browser Intl → user preference → environment default. Affects timestamp format (UTC Z vs ±HH:MM) and business date boundary calculation | `X-Timezone: Asia/Shanghai` |

> **X-Request-ID Mandatory Requirement**:
> - **Frontend**: Every HTTP request must generate a unique `X-Request-ID` in the Header (format: `req-${uuid.v4()}`)
> - **Backend**: Must read `X-Request-ID` from request header and return the same `requestId` in all response headers and response bodies
> - **Priority**: Frontend-provided `X-Request-ID` takes precedence; if not provided by frontend, backend must generate one
> - **Full-chain Tracing**: This ID will span frontend → backend → database → log system, used for troubleshooting and performance analysis
> - **Logging**: All log entries must include `requestId` to enable per-request log aggregation and tracing

#### 2.1.5 Response Header Specification
| Response Header | Description | Example |
|--------|------|------|
| **Content-Type** | Response body type | `Content-Type: application/json` |
| **X-Request-ID** | Request trace ID (matches request) | `X-Request-ID: req-123456` |
| **X-RateLimit-Limit** | Rate limit upper bound | `X-RateLimit-Limit: 100` |
| **X-RateLimit-Remaining** | Remaining request count | `X-RateLimit-Remaining: 95` |
| **X-RateLimit-Reset** | Reset timestamp | `X-RateLimit-Reset: 1672502400` |
| **Location** | New resource location (on 201 Created) | `Location: /v1/users/123` |

### 2.2 Data Format Specification

#### 2.2.1 Request Body Format
- **JSON Format**: All request bodies use `application/json` format
- **Field Naming**: Use lower camelCase (camelCase)
- **Date/Time**: Use ISO 8601 format `YYYY-MM-DDTHH:mm:ss.sssZ`
- **Null Handling**: Use `null` for null values, not empty strings or omitted fields

> **New Field Mappings (v2.9.0)**: The following are Wire Format ↔ DTO mappings for new Service/Appointment model fields:
> 
> | Wire Format (snake_case) | TypeScript DTO (camelCase) | Model | Type |
> |-------------------------|---------------------------|-------|---------|
> | `category` | `category` | Service | string |
> | `price_per_minute` | `pricePerMinute` | Service | Decimal |
> | `tax_rate` | `taxRate` | Service | Decimal | ⚠️ Wire=percentage (8=8%), DB=decimal (0.08). Mapper: ÷100 in, ×100 out |
> | `duration_minutes` | `durationMinutes` | Appointment | integer |
> | `price` (financial) | `price` | Appointment | Decimal |
> | `tax_rate` (snapshot) | `taxRate` | Appointment | Decimal | ⚠️ Wire=percentage; snapshot from Service.taxRate |
> | `tax_included_amount` | `taxIncludedAmount` | Appointment | Decimal |
> | `overtime_minutes` | `overtimeMinutes` | Appointment create req | integer |
> 
> > **Field Naming Convention: Wire Format vs TypeScript DTO** [v2.3.0]
> 
> This project uses different naming conventions at the HTTP transport layer and TypeScript code layer, with automatic conversion by Angular HTTP Interceptor:
> 
> | Layer | Naming Convention | Example |
> |------|----------|------|
> | **Wire Format (JSON over HTTP)** | `snake_case` | `created_at`, `time_slot_id`, `is_positive` |
> | **TypeScript DTO property name** | `camelCase` | `createdAt`, `timeSlotId`, `isPositive` |
> 
> - **Backend**: NestJS controllers receive/return JSON using `snake_case`, fully consistent with `contract.yaml`.
> - **Frontend**: Angular service layer defines TypeScript DTO interfaces using `camelCase` property names.
> - **Auto Conversion**: Angular HTTP Interceptor converts `camelCase` to `snake_case` before sending requests, and converts `snake_case` to `camelCase` after receiving responses. Frontend and backend developers do not need to handle the conversion logic manually.
> - **Basis**: `contract.yaml` is the authoritative data source; all wire format field names follow the contract.

**Example Request Body**:
```json
{
  "firstName": "Zhang",
  "lastName": "San",
  "email": "zhangsan@example.com",
  "phone": "13800138000",
  "birthDate": "1990-01-01T00:00:00.000Z",
  "preferences": {
    "notificationEnabled": true,
    "language": "zh-CN"
  }
}
```

#### 2.2.2 Response Body Format (Unified Wrapper)
All success responses use a unified format wrapper for consistent frontend processing.

**Success Response Format**:
```json
{
  "statusCode": 200,
  "message": "Operation successful",
  "data": {
    // Actual business data
  },
  "timestamp": "2026-04-22T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}
```

**Paginated Response Format**:
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": {
    "items": [
      // Data item array
    ],
    "meta": {
      "total": 150,
      "page": 1,
      "limit": 20,
      "totalPages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  },
  "timestamp": "2026-04-22T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}
```

**Error Response Format**:
```json
{
  "statusCode": 400,
  "message": "Request parameter validation failed",
  "error": "Bad Request",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format",
      "code": "INVALID_EMAIL_FORMAT"
    },
    {
      "field": "phone",
      "message": "Phone number cannot be empty",
      "code": "PHONE_REQUIRED"
    }
  ],
  "timestamp": "2026-04-22T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}
```

#### 2.2.3 Pagination Parameter Specification
| Parameter | Type | Default | Description | Example |
|--------|------|--------|------|------|
| **page** | integer | 1 | Page number (starting from 1) | `page=1` |
| **limit** | integer | 20 | Records per page | `limit=20` |
| **sort** | string | `createdAt:desc` | Sort field and direction | `sort=name:asc,createdAt:desc` |
| **fields** | string | All fields | Response field filter | `fields=id,name,email` |
| **q** | string | (empty) | Full-text search keyword | `q=keyword` |
| **filter** | object | (empty) | Complex filter conditions | `filter[status]=active&filter[createdAt][gte]=2026-01-01` |

**Query Example**:
```
GET /v1/users?page=2&limit=10&sort=createdAt:desc&fields=id,name,email&q=keyword&filter[status]=active
```

### 2.3 Security Specification

#### 2.3.1 Authentication Mechanism (JWT + Passport)
- **Authentication Method**: Bearer Token (JWT)
- **Token Format**: `Authorization: Bearer <token>`
- **Token Generation**: Uses HS256 algorithm, Access Token valid for 15 minutes, Refresh Token valid for 7 days
- **Token Refresh**: Supports refresh token mechanism to extend sessions
- **Security Enhancements**: Token blacklist, short-lived tokens, replay attack prevention

**NestJS Authentication Guard Example**:
```typescript
// auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    
    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      request.user = payload;
    } catch {
      throw new UnauthorizedException('Invalid authentication token');
    }
    
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers['authorization']?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

**Angular Authentication Interceptor Example**:
```typescript
// auth.interceptor.ts
import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, filter, take } from 'rxjs/operators';
import { AuthService } from './auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);

  constructor(private authService: AuthService) {}

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.authService.getAccessToken();
    
    if (token) {
      request = this.addTokenToRequest(request, token);
    }

    return next.handle(request).pipe(
      catchError(error => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          return this.handle401Error(request, next);
        }
        return throwError(() => error);
      })
    );
  }

  private addTokenToRequest(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      return this.authService.refreshToken().pipe(
        switchMap((token: string) => {
          this.isRefreshing = false;
          this.refreshTokenSubject.next(token);
          return next.handle(this.addTokenToRequest(request, token));
        }),
        catchError((error) => {
          this.isRefreshing = false;
          this.authService.logout();
          return throwError(() => error);
        })
      );
    } else {
      return this.refreshTokenSubject.pipe(
        filter(token => token !== null),
        take(1),
        switchMap(token => next.handle(this.addTokenToRequest(request, token!)))
      );
    }
  }
}
```

#### 2.3.2 Authorization Mechanism (RBAC)
- **Role Definitions**: Customer (CUSTOMER), Administrator (ADMIN), Super Administrator (SUPER_ADMIN)
- **Permission Granularity**: Resource-based permission control, supports fine-grained authorization
- **Implementation**: NestJS guards + custom decorators

**NestJS Roles Guard Example**:
```typescript
// roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user) {
      return false;
    }

    return requiredRoles.some(role => user.roles?.includes(role));
  }
}
```

**Roles Decorator Example**:
```typescript
// roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

**Controller Usage Example**:
```typescript
// appointment.controller.ts
@Controller('v1/appointments')
@UseGuards(AuthGuard, RolesGuard)
export class AppointmentController {
  @Post()
  @Roles('CUSTOMER')
  async create(@Body() createAppointmentDto: CreateAppointmentDto) {
    // Create appointment logic
  }

  @Get()
  @Roles('CUSTOMER')
  async findAll(@Query() query: PaginationQueryDto) {
    // Get current user's appointment list (CUSTOMER only; admins use GET /v1/admin/appointments)
  }
}
```

#### 2.3.3 Rate Limiting (@nestjs/throttler)
- **Global Limit**: 100 requests/minute/user
- **Key Endpoint Limit**: Appointment creation endpoint 10 requests/minute/user
- **IP Limit**: 1000 requests/minute/IP (anti-DDoS)
- **Sliding Window**: Uses Redis to store counters, supports distributed deployment

**NestJS Rate Limiting Configuration**:
```typescript
// throttler.config.ts
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests
      },
    ]),
  ],
})
export class AppModule {}
```

**Specific Endpoint Rate Limiting**:
```typescript
// appointment.controller.ts
@Controller('v1/appointments')
export class AppointmentController {
  @Post()
  @Throttle(10, 60) // 10 times/minute
  async create(@Body() createAppointmentDto: CreateAppointmentDto) {
    // Appointment creation logic
  }
}
```

##### Fine-Grained Rate Limiting Strategy

Implement more fine-grained rate limiting at the Redis soft-limit layer, providing additional protection for high-concurrency booking scenarios to prevent malicious spamming and resource abuse.

**Strict Rate Limiting for Same User + Same Time Slot**:
For repeated booking requests from the same user in the same time slot, implement stricter rate limiting:

```typescript
// redis-rate-limit.service.ts - Fine-grained rate limiting service
import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-modules/ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

@Injectable()
export class RedisRateLimitService {
  private readonly userTimeSlotLimiter: RateLimiterRedis;
  
  constructor(private redisService: RedisService) {
    // Same user + same time slot rate limit: 1 time/second
    this.userTimeSlotLimiter = new RateLimiterRedis({
      storeClient: this.redisService.getClient(),
      keyPrefix: 'user_timeslot_limit',
      points: 1, // 1 request
      duration: 1, // within 1 second
      blockDuration: 5, // block for 5 seconds after exceeding limit
    });
    
    // Same IP global rate limit: 10 times/minute
    this.ipGlobalLimiter = new RateLimiterRedis({
      storeClient: this.redisService.getClient(),
      keyPrefix: 'ip_global_limit',
      points: 10,
      duration: 60,
      blockDuration: 300,
    });
    
    // User daily appointment total rate limit: 20 times/day
    this.userDailyLimit = new RateLimiterRedis({
      storeClient: this.redisService.getClient(),
      keyPrefix: 'user_daily_appointments',
      points: 20,
      duration: 60 * 60 * 24, // 24 hours
      blockDuration: 60 * 60 * 6, // block for 6 hours after exceeding
    });
  }
  
  /**
   * Check user + time slot rate limit
   * @param userId User ID
   * @param timeSlotId Time slot ID
   * @returns Whether access is allowed
   */
  async checkUserTimeSlotLimit(userId: string, timeSlotId: string): Promise<boolean> {
    const key = `user:${userId}:timeslot:${timeSlotId}`;
    
    try {
      await this.userTimeSlotLimiter.consume(key);
      return true;
    } catch (rejRes) {
      if (rejRes instanceof Error) {
        throw rejRes;
      }
      
      console.warn(`User ${userId} is requesting time slot ${timeSlotId} too frequently`);
      return false;
    }
  }
  
  /**
   * Check user daily appointment total
   * @param userId User ID
   * @returns Whether access is allowed
   */
  async checkUserDailyLimit(userId: string): Promise<boolean> {
    const key = `user:${userId}:daily`;
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    try {
      await this.userDailyLimit.consume(`${key}:${date}`);
      return true;
    } catch (rejRes) {
      if (rejRes instanceof Error) {
        throw rejRes;
      }
      
      console.warn(`User ${userId}'s daily appointment quota has been reached`);
      return false;
    }
  }
  
  /**
   * Check IP global rate limit
   * @param ipAddress IP address
   * @returns Whether access is allowed
   */
  async checkIpGlobalLimit(ipAddress: string): Promise<boolean> {
    try {
      await this.ipGlobalLimiter.consume(ipAddress);
      return true;
    } catch (rejRes) {
      if (rejRes instanceof Error) {
        throw rejRes;
      }
      
      console.warn(`IP ${ipAddress} is making requests too frequently`);
      return false;
    }
  }
}
```

**Enhanced Rate Limiting for Appointment Creation Endpoint**:
```typescript
// appointment.controller.ts - Enhanced rate limiting version
import { Controller, Post, Body, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RedisRateLimitService } from './redis-rate-limit.service';

@Controller('v1/appointments')
export class AppointmentController {
  constructor(private redisRateLimitService: RedisRateLimitService) {}

  @Post()
  @Throttle(10, 60) // NestJS base rate limit: 10 times/minute
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @Req() request: Request,
  ) {
    const userId = request.user.id;
    const timeSlotId = createAppointmentDto.timeSlotId;
    const ipAddress = request.ip;
    
    // 1. Check same user + same time slot rate limit (1 time/second)
    const userTimeSlotAllowed = await this.redisRateLimitService.checkUserTimeSlotLimit(
      userId,
      timeSlotId,
    );
    
    if (!userTimeSlotAllowed) {
      throw new HttpException(
        'Your requests for this time slot are too frequent, please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    
    // 2. Check user daily appointment total (20 times/day)
    const userDailyAllowed = await this.redisRateLimitService.checkUserDailyLimit(userId);
    if (!userDailyAllowed) {
      throw new HttpException(
        'You have reached your daily appointment limit',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    
    // 3. Check IP global rate limit (10 times/minute)
    const ipAllowed = await this.redisRateLimitService.checkIpGlobalLimit(ipAddress);
    if (!ipAllowed) {
      throw new HttpException(
        'Requests are too frequent, please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    
    // 4. Redis soft rate limit check (time slot capacity limit)
    const slotAvailable = await this.redisRateLimitService.checkSlotAvailability(timeSlotId);
    if (!slotAvailable) {
      throw new HttpException(
        'This time slot is fully booked',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    
    // All rate limit checks passed, execute business logic
    return this.appointmentService.create(createAppointmentDto);
  }
}
```

**Multi-Dimensional Rate Limiting Strategy**:
| Dimension | Limit Rule | Purpose | Storage Method |
|----------|----------|------|----------|
| **User + Time Slot** | 1 time/second | Prevent malicious spamming of same time slot | Redis key: `user:{userId}:timeslot:{timeSlotId}` |
| **User Daily Total** | 20 times/day | Prevent malicious resource occupation | Redis key: `user:{userId}:daily:{date}` |
| **IP Global** | 10 times/minute | Prevent IP-level attacks | Redis key: `ip:{ipAddress}` |
| **Slot Capacity** | Real-time remaining capacity | Prevent overselling | Redis key: `slot:{timeSlotId}:remaining` |
| **Global User** | 100 times/minute | Basic protection | NestJS Throttler |

**Rate Limiting Algorithm Selection**:
- **Sliding Window Algorithm**: For user + time slot limiting, precisely controls request count within 1 second
- **Token Bucket Algorithm**: For IP global limiting, supports burst traffic
- **Leaky Bucket Algorithm**: For time slot capacity limiting, smooths traffic
- **GCRA Algorithm**: For user daily totals, prevents bypass at calendar day boundaries

**Rate Limit Monitoring and Alerting**:
```typescript
// rate-limit-monitor.service.ts
@Injectable()
export class RateLimitMonitorService {
  private readonly logger = new Logger(RateLimitMonitorService.name);
  
  async recordRateLimitHit(dimension: string, key: string): Promise<void> {
    const metric = {
      dimension,
      key,
      timestamp: new Date().toISOString(),
      count: await this.incrementCounter(dimension, key),
    };
    
    this.logger.warn(`Rate limit triggered: ${dimension} - ${key}`);
    
    // Send to monitoring system
    this.metricsService.recordRateLimitHit(metric);
    
    // Trigger alert
    if (metric.count > this.getAlertThreshold(dimension)) {
      this.alertService.sendRateLimitAlert({
        dimension,
        key,
        count: metric.count,
        threshold: this.getAlertThreshold(dimension),
        timestamp: new Date().toISOString(),
      });
    }
  }
  
  private async incrementCounter(dimension: string, key: string): Promise<number> {
    const counterKey = `ratelimit:${dimension}:${key}:hits`;
    return this.redisService.incr(counterKey);
  }
}
```

**Rate Limiting Configuration Management**:
```yaml
# rate-limiting-config.yaml
rate_limits:
  user_timeslot:
    points: 1
    duration: 1
    block_duration: 5
    alert_threshold: 10  # Alert when triggered 10 times per hour
    
  user_daily:
    points: 20
    duration: 86400
    block_duration: 21600
    alert_threshold: 5   # Alert when triggered 5 times per day
    
  ip_global:
    points: 10
    duration: 60
    block_duration: 300
    alert_threshold: 50  # Alert when triggered 50 times per hour
    
  slot_capacity:
    points: 100  # Total time slot capacity
    duration: 3600
    block_duration: 0    # No blocking, directly return slot full
```

#### 2.3.4 Input Validation (class-validator + class-transformer)
- **DTO Validation**: All input parameters must be validated
- **Business Validation**: In addition to format validation, business logic validation is also required
- **Deep Validation**: Supports nested object validation
- **Custom Validation**: Supports custom validation rules

#### 2.3.5 Email Verification Code API Design

The email verification code API is used for user registration, login, and password reset scenarios. It uses Redis cache to store verification codes and supports multi-type verification code management.

##### Verification Code Type Enum
```typescript
// Verification code type enum
export enum VerificationCodeType {
  REGISTER = 'REGISTER',  // Registration verification code
  LOGIN = 'LOGIN',        // Login verification code
  RESET = 'RESET',        // Password reset verification code
}
```

##### Send Verification Code Endpoint DTO
```typescript
// send-verification-code.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

export class SendVerificationCodeDto {
  @ApiProperty({
    description: 'Email address',
    example: 'user@example.com',
    required: true,
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

  @ApiProperty({
    description: 'Verification code type',
    enum: VerificationCodeType,
    example: VerificationCodeType.REGISTER,
    required: true,
  })
  @IsEnum(VerificationCodeType, { message: 'Invalid verification code type' })
  @IsNotEmpty({ message: 'Verification code type cannot be empty' })
  type: VerificationCodeType;
}
```

##### Verify Verification Code Endpoint DTO
```typescript
// verify-verification-code.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyVerificationCodeDto {
  @ApiProperty({
    description: 'Email address',
    example: 'user@example.com',
    required: true,
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

  @ApiProperty({
    description: 'Verification code',
    example: '123456',
    required: true,
  })
  @IsString({ message: 'Verification code must be a string' })
  @Length(6, 6, { message: 'Verification code must be 6 digits' })
  @IsNotEmpty({ message: 'Verification code cannot be empty' })
  code: string;

  @ApiProperty({
    description: 'Verification code type',
    enum: VerificationCodeType,
    example: VerificationCodeType.REGISTER,
    required: true,
  })
  @IsEnum(VerificationCodeType, { message: 'Invalid verification code type' })
  @IsNotEmpty({ message: 'Verification code type cannot be empty' })
  type: VerificationCodeType;
}
```

##### Endpoint Response Format
```typescript
// Send verification code success response
{
  "statusCode": 200,
  "message": "Verification code sent to email",
  "data": {
    "email": "user@example.com",
    "type": "REGISTER",
    "expiresIn": 300  // Validity period (seconds)
  },
  "timestamp": "2026-04-22T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}

// Verify verification code success response
{
  "statusCode": 200,
  "message": "Verification code verified successfully",
  "data": {
    "verified": true,
    "email": "user@example.com",
    "type": "REGISTER"
  },
  "timestamp": "2026-04-22T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}
```

##### Endpoint Design
| Method | Path | Description | Auth | Rate Limit |
|------|------|------|------|------|
| POST | `/v1/auth/register/send-code` | Register - Send verification code | No | 5 times/min/contact |
| POST | `/v1/auth/login/send-code` | Login - Send verification code | No | 5 times/min/contact |
| POST | `/v1/auth/reset-password/send-code` | Reset password - Send verification code | No | 5 times/min/contact |

> **Deprecation Notice** [v2.7.0]: The original general-purpose `/v1/auth/verification-codes/send` and `/v1/auth/verification-codes/verify` endpoints have been deprecated, replaced by the purpose-separated endpoints above (register/send-code, login/send-code, reset-password/send-code). Verification code validation logic is embedded in the second-step endpoints (register/complete, login/verify-code, reset-password/verify).

---

#### [M-6 Added v2.1.0] Auth Endpoint Definitions (Scheme C v4 PII Encryption)

> **Modification Note**: Added complete registration and login endpoints, supporting both verification code and password login methods.
> Based on: piiEncryptionStrategy.md § 6 (verification code flow specification); requirements-modification-scope.md M-6.

##### Auth Endpoint Overview

| Method | Path | Description | Auth | Rate Limit |
|------|------|------|------|------|
| POST | `/v1/auth/register/send-code` | Registration step 1: Send verification code (mandatory) | No | 5 times/min/contact |
| POST | `/v1/auth/register/complete` | Registration step 2: Submit verification code + password (mandatory) | No | 10 times/min/IP |
| POST | `/v1/auth/login/send-code` | Verification code login step 1: Send verification code | No | 5 times/min/contact |
| POST | `/v1/auth/login/verify-code` | Verification code login step 2: Verify and obtain token | No | 10 times/min/contact |
| POST | `/v1/auth/login/password` | Password login | No | 5 times/min/contact |
| POST | `/v1/auth/refresh` | Refresh Access Token (token rotation) | No | 10 times/min/IP |
| POST | `/v1/auth/logout` | Logout (token blacklist) | Yes | None |
| POST | `/v1/auth/reset-password/send-code` | Forgot password step 1: Send verification code | No | 5 times/min/contact |
| POST | `/v1/auth/reset-password/verify` | Forgot password step 2: Verify and reset password | No | 10 times/min/contact |

##### Registration Endpoints

###### POST `/v1/auth/register/send-code`

**Description**: Registration flow step 1 (mandatory), sends a 6-digit numeric verification code to the specified phone number or email.

**Request Body (RegisterSendCodeDto)**:

```typescript
// register-send-code.dto.ts
import { IsString, IsEnum, IsNotEmpty } from 'class-validator';

export enum ContactType {
  PHONE = 'phone',
  EMAIL = 'email',
}

export class RegisterSendCodeDto {
  @IsString()
  @IsNotEmpty()
  contact: string;  // Phone number or email as plain text

  @IsEnum(ContactType)
  @IsNotEmpty()
  contactType: ContactType;
}
```

**Response Example**:
```json
// 200 OK - Verification code sent
{
  "statusCode": 200,
  "message": "Verification code sent, please complete verification within 5 minutes",
  "data": {
    "contactType": "email",
    "maskedContact": "us***@example.com",
    "expiresIn": 300
  },
  "timestamp": "2026-04-21T10:00:00.000Z"
}

// 409 Conflict - Already registered
{
  "statusCode": 409,
  "message": "This email is already registered",
  "error": "Conflict",
  "timestamp": "2026-04-21T10:00:00.000Z",
  "path": "/v1/auth/register/send-code"
}
```

**Redis Storage**: `verify:register:{contactHash}` → `{code, contactType, expireAt}`, TTL=300s

---

###### POST `/v1/auth/register/complete`

**Description**: Registration flow step 2 (mandatory), submits verification code + password, completes account creation, auto-login returns JWT.

**Request Body (RegisterCompleteDto)**:

```typescript
// register-complete.dto.ts
import { IsString, IsEnum, IsNotEmpty, Length, MinLength } from 'class-validator';

export class RegisterCompleteDto {
  @IsString()
  @IsNotEmpty()
  contact: string;  // Phone number or email as plain text

  @IsEnum(ContactType)
  @IsNotEmpty()
  contactType: ContactType;

  @IsString()
  @Length(6, 6, { message: 'Verification code must be 6 digits' })
  code: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;  // User full name
}
```

**Response Example**:
```json
// 201 Created - Registration successful
{
  "statusCode": 201,
  "message": "Registration successful",
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "expiresIn": 900,
    "tokenType": "Bearer"
  },
  "timestamp": "2026-04-21T10:00:00.000Z"
}
```

**Business Flow**:
1. Verify verification code in Redis (matched and not expired)
2. Calculate `contactHash`, check uniqueness
3. AES-256-GCM encrypt contact → `*Encrypted`; SHA-256 hash → `*Hash`; desensitize → `*` (plain text column)
4. bcrypt hash password (rounds=12) → `passwordHash`
5. Create User record (three-field model)
6. Delete Redis verification code key
7. Issue JWT dual tokens, return

---

##### Login Endpoints

###### POST `/v1/auth/login/send-code`

**Description**: Verification code login step 1, sends a verification code to a registered phone number or email.

**Request Body (LoginSendCodeDto)**:

```typescript
// login-send-code.dto.ts
export class LoginSendCodeDto {
  @IsString()
  @IsNotEmpty()
  contact: string;

  @IsEnum(ContactType)
  @IsNotEmpty()
  contactType: ContactType;
}
```

**Note**: To prevent user enumeration attacks, returns 200 (silent success) even when the user does not exist, without exposing registration status.

**Redis Storage**: `verify:login:{contactHash}` → `{code, userId, expireAt}`, TTL=300s

---

###### POST `/v1/auth/login/verify-code`

**Description**: Verification code login step 2, verify and return JWT dual tokens.

**Request Body (LoginVerifyCodeDto)**:

```typescript
// login-verify-code.dto.ts
export class LoginVerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  contact: string;

  @IsEnum(ContactType)
  @IsNotEmpty()
  contactType: ContactType;

  @IsString()
  @Length(6, 6)
  code: string;
}
```

**Response**: Returns `AuthResponse` on success (accessToken + refreshToken + expiresIn + tokenType).

---

###### POST `/v1/auth/login/password`

**Description**: Password login, authenticates via phone number/email + password.

**Request Body (LoginPasswordDto)**:

```typescript
// login-password.dto.ts
export class LoginPasswordDto {
  @IsString()
  @IsNotEmpty()
  contact: string;  // Phone number or email as plain text

  @IsEnum(ContactType)
  @IsNotEmpty()
  contactType: ContactType;

  @IsString()
  @MinLength(8)
  password: string;
}
```

**Business Flow**:
1. Calculate `contactHash` (SHA-256)
2. Find user by `phoneHash` or `emailHash`
3. `bcrypt.compare(inputPassword, user.passwordHash)`
4. Update `lastLoginAt`
5. Issue JWT dual tokens

**Response**: Returns `AuthResponse` on success (200 OK).

---

##### Common Auth Response Type (AuthResponse)

```typescript
// auth-response.dto.ts
export class AuthResponseDto {
  accessToken: string;    // JWT Access Token (valid 15 minutes)
  refreshToken: string;   // JWT Refresh Token (valid 7 days)
  expiresIn: number;      // Access Token validity in seconds (900)
  tokenType: 'Bearer';
}
```

---

##### Reset Password Endpoints [Added v2.6.0]

> **Addition Note**: contract.yaml v1.6.5 added RESET-PW-001/RESET-PW-002 endpoints, supporting a 2-step password reset flow.
> Flow: User enters contact → Send verification code → Verify code + set new password → Complete reset.

###### POST `/v1/auth/reset-password/send-code`

**Description**: Forgot password flow step 1, sends a 6-digit verification code to a registered phone number or email. To prevent user enumeration attacks, returns 200 even when user does not exist.

**Request Body (ResetPasswordSendCodeDto)**:

```typescript
// reset-password-send-code.dto.ts
import { IsString, IsEnum, IsNotEmpty } from 'class-validator';

export class ResetPasswordSendCodeDto {
  @IsString()
  @IsNotEmpty()
  contact: string;  // Phone number or email as plain text

  @IsEnum(ContactType)
  @IsNotEmpty()
  contactType: ContactType;
}
```

**Response Example**:
```json
// 200 OK - Verification code sent (user exists)
{
  "statusCode": 200,
  "message": "Password reset verification code sent, please complete verification within 5 minutes",
  "data": {
    "expiresIn": 300
  },
  "timestamp": "2026-05-06T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}

// 200 OK - User does not exist, silent success (anti-enumeration)
{
  "statusCode": 200,
  "message": "If this account is registered, a verification code will be sent to the corresponding contact",
  "data": {
    "expiresIn": 300
  },
  "timestamp": "2026-05-06T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}
```

**Redis Storage**: `verify:reset:{contactHash}` → `{code, userId, expireAt}`, TTL=300s

**Rate Limit**: 5 times/minute/contact

---

###### POST `/v1/auth/reset-password/verify`

**Description**: Forgot password flow step 2, verify the verification code and set a new password. After success, user can navigate to the login page to log in with the new password. **Does not return a JWT Token** (user must log in again).

**Request Body (ResetPasswordVerifyDto)**:

```typescript
// reset-password-verify.dto.ts
import { IsString, IsEnum, IsNotEmpty, Length, MinLength } from 'class-validator';

export class ResetPasswordVerifyDto {
  @IsString()
  @IsNotEmpty()
  contact: string;  // Phone number or email as plain text

  @IsEnum(ContactType)
  @IsNotEmpty()
  contactType: ContactType;

  @IsString()
  @Length(6, 6, { message: 'Verification code must be 6 digits' })
  code: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}
```

**Response Example**:
```json
// 200 OK - Password reset successful
{
  "statusCode": 200,
  "message": "Password reset successful",
  "data": {
    "message": "Password updated, please log in with your new password"
  },
  "timestamp": "2026-05-06T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}

// 400 Bad Request - Verification code invalid or expired
{
  "statusCode": 400,
  "message": "Verification code is invalid or has expired",
  "error": "Bad Request",
  "timestamp": "2026-05-06T10:00:00.000Z",
  "requestId": "req-12345678-1234-5678-1234-567812345678"
}
```

**Business Flow**:
1. Calculate `contactHash` (SHA-256), look up Redis key `verify:reset:{contactHash}`
2. Verify the verification code in Redis (matched and not expired, type must be `RESET`)
3. Find user (via `phoneHash` or `emailHash`)
4. bcrypt hash `newPassword` (rounds=12) → update `passwordHash`
5. Delete Redis verification code key
6. Return success (no JWT issued, user must log in manually)

**Password Strength Rules**:
- Minimum 8 characters
- Recommended to include at least 3 of: uppercase letters, lowercase letters, digits, special characters
- Cannot be the same as the username/email
- Cannot repeat last 3 historical passwords

**Rate Limit**: 10 times/minute/contact

---

**DTO Validation Example**:
```typescript
// create-appointment.dto.ts
import { IsString, IsUUID, IsDateString, IsEnum, IsJSON, IsOptional, Min, Max, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAppointmentDto {
  @IsUUID()
  @IsNotEmpty()
  timeSlotId: string;

  @IsUUID()
  @IsNotEmpty()
  serviceId: string;

  @IsDateString()
  @IsNotEmpty()
  appointmentDate: string;

  @IsJSON()
  @IsNotEmpty()
  @Transform(({ value }) => {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return value;
    }
  })
  customerInfo: Record<string, any>;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsInt()
  @Min(0)
  @Max(999)
  @IsOptional()
  preferredSequence?: number; // Frontend random hash, for hotspot sharding

  @IsOptional()
  @IsInt()
  @Min(0)
  overtimeMinutes?: number; // Overtime duration (minutes) — the only duration extension mechanism
}
```

**Global Validation Pipe Configuration**:
```typescript
// main.ts
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );
  
  await app.listen(3000);
}
bootstrap();
```

### 2.4 Error Handling Specification

#### 2.4.1 Error Classification
| Error Category | Status Code | Error Code Prefix | Description |
|----------|--------|------------|------|
| **Client Errors** | 400-499 | `CLIENT_` | Client request errors |
| **Server Errors** | 500-599 | `SERVER_` | Server internal errors |
| **Business Errors** | 422 | `BUSINESS_` | Business logic errors |

#### 2.4.2 Error Code Definitions
| Error Code | HTTP Status Code | Description |
|--------|------------|------|
| **VALIDATION_ERROR** | 400 | Parameter validation failed |
| **AUTH_REQUIRED** | 401 | Authentication required |
| **AUTH_INVALID** | 401 | Authentication invalid |
| **AUTH_EXPIRED** | 401 | Authentication expired |
| **PERMISSION_DENIED** | 403 | Insufficient permissions |
| **RESOURCE_NOT_FOUND** | 404 | Resource not found |
| **RESOURCE_CONFLICT** | 409 | Resource conflict |
| **BUSINESS_RULE_VIOLATION** | 422 | Business rule violation |
| **RATE_LIMIT_EXCEEDED** | 429 | Rate limit exceeded |
| **INTERNAL_ERROR** | 500 | Internal server error |
| **SERVICE_UNAVAILABLE** | 503 | Service unavailable |

#### 2.4.3 Global Exception Filter
```typescript
// http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers['x-request-id'] || `req-${crypto.randomUUID()}`;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any[] = [];
    let errorCode = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;
      
      message = exceptionResponse.message || exception.message;
      errors = exceptionResponse.errors || [];
      errorCode = exceptionResponse.code || this.getErrorCode(status);
    } else if (exception instanceof Error) {
      message = exception.message;
      errorCode = 'INTERNAL_ERROR';
    }

    // Log error (including requestId)
    this.logger.error({
      message: exception instanceof Error ? exception.message : 'Unknown error',
      stack: exception instanceof Error ? exception.stack : undefined,
      requestId,
      url: request.url,
      method: request.method,
      status,
      timestamp: new Date().toISOString(),
    });

    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status],
      errors,
      timestamp: new Date().toISOString(),
      requestId,
    });
  }

  private getErrorCode(status: number): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'AUTH_REQUIRED',
      403: 'PERMISSION_DENIED',
      404: 'RESOURCE_NOT_FOUND',
      409: 'RESOURCE_CONFLICT',
      422: 'BUSINESS_RULE_VIOLATION',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] || 'UNKNOWN_ERROR';
  }
}
```

#### 2.4.4 Business Exception Class
```typescript
// business.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  constructor(
    message: string,
    code: string = 'BUSINESS_RULE_VIOLATION',
    errors: any[] = [],
  ) {
    super(
      {
        message,
        code,
        errors,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

// Usage example
throw new BusinessException('Time slot is fully booked', 'TIME_SLOT_FULL', [
  { field: 'timeSlotId', message: 'No available slots in this time slot' }
]);
```

### 2.5 High-Concurrency Appointment API Design

#### 2.5.1 Atomic Preemption Mechanism API Design
Atomic preemption mechanism based on PostgreSQL partial unique index + `slot_sequence` field, ensuring no overselling in high-concurrency scenarios.

**Appointment Creation API Design**:
```typescript
// appointment.controller.ts - High-concurrency optimized version
@Controller('v1/appointments')
@UseGuards(AuthGuard, RolesGuard)
export class AppointmentController {
  constructor(
    private readonly appointmentService: AppointmentService,
    private readonly redisService: RedisService,
  ) {}

  @Post()
  @Roles('CUSTOMER')
  @Throttle(10, 60) // Key endpoint rate limiting
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @Req() request: Request,
  ) {
    const userId = request.user.id;
    
    // 1. Redis soft rate limit pre-check
    const timeSlotId = createAppointmentDto.timeSlotId;
    const limitKey = `slot:${timeSlotId}:remaining`;
    const remaining = await this.redisService.decr(limitKey);
    
    if (remaining < 0) {
      await this.redisService.incr(limitKey); // Restore counter
      throw new BusinessException('This time slot is fully booked', 'TIME_SLOT_FULL');
    }

    try {
      // 2. Atomic preemption core logic
      const appointment = await this.appointmentService.createWithAtomicLock({
        ...createAppointmentDto,
        userId,
        preferredSequence: createAppointmentDto.preferredSequence || 
                          Math.floor(Math.random() * 100), // Frontend random hash (0-99, hotspot sharding)
      });

      // 3. Async processing of non-critical paths
      await this.notificationService.queueAppointmentNotification(appointment.id);
      
      return {
        statusCode: 201,
        message: 'Appointment created successfully',
        data: appointment,
        timestamp: new Date().toISOString(),
        requestId,
      };
    } catch (error) {
      // 4. Conflict error handling
      if (error.code === 'P2002') { // Prisma unique constraint violation error
        await this.redisService.incr(limitKey); // Restore Redis counter
        throw new BusinessException('Appointment conflict, please retry', 'APPOINTMENT_CONFLICT', [
          { field: 'timeSlotId', message: 'This slot has been occupied by another user' }
        ]);
      }
      
      // Other errors
      await this.redisService.incr(limitKey); // Restore Redis counter
      throw error;
    }
  }
}
```

**Service Layer Atomic Preemption Implementation**:
```typescript
// appointment.service.ts
@Injectable()
export class AppointmentService {
  constructor(
    private prisma: PrismaService,
    private timeSlotService: TimeSlotService,
  ) {}

  async createWithAtomicLock(data: CreateAppointmentData) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Atomically increment currentSequence (database-level atomic operation)
      const timeSlot = await tx.timeSlot.update({
        where: { id: data.timeSlotId },
        data: {
          currentSequence: {
            increment: 1, // Use Prisma atomic operation, not findUnique+update
          },
        },
      });

      // 2. Attempt to insert appointment record (partial unique index auto-detects conflict)
      try {
        const appointment = await tx.appointment.create({
          data: {
            id: uuidv7(), // UUID v7, time-ordered, reduces index fragmentation
            userId: data.userId,
            timeSlotId: data.timeSlotId,
            serviceId: data.serviceId,
            appointmentDate: new Date(data.appointmentDate),
            slotSequence: timeSlot.currentSequence - 1, // Use sequence number before increment
            appointmentNumber: this.generateAppointmentNumber(),
            status: 'PENDING',
            customerInfo: data.customerInfo,
            remarks: data.remarks,
          },
          include: {
            timeSlot: true,
            service: true,
          },
        });

        return appointment;
      } catch (error) {
        // 3. If insertion fails, rollback currentSequence
        await tx.timeSlot.update({
          where: { id: data.timeSlotId },
          data: {
            currentSequence: {
              decrement: 1,
            },
          },
        });
        throw error;
      }
    }, {
      isolationLevel: 'ReadCommitted', // Use READ COMMITTED isolation level, avoids rollback storm
    });
  }

  private generateAppointmentNumber(): string {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `APT-${timestamp}-${random}`;
  }
}
```

#### 2.5.2 Concurrent Conflict Sequence Example
**Scenario**: Two users simultaneously attempt to book the last available slot in the same time slot (`slot_sequence=0`).

**Sequence Steps**:
1. **T0**: User A and User B initiate booking requests almost simultaneously
2. **T1**: User A's request passes Redis soft rate limit check (`remaining=1` → `remaining=0`)
3. **T2**: System atomically increments `TimeSlot.currentSequence` for User A (0 → 1)
4. **T3**: System attempts to insert appointment record for User A, partial unique index check passes, insertion succeeds
5. **T4**: User B's request passes Redis soft rate limit check (`remaining=0` → `remaining=-1`, immediately restored to 0 and returns error)
6. **T5**: User B receives "slot fully booked" prompt, frontend displays unavailable state

**Key Points**:
- Redis soft rate limiting intercepts most conflict requests upfront
- Database partial unique index guarantees eventual consistency
- Even if two requests reach the database simultaneously, the first successfully inserted record immediately occupies the unique index position, and subsequent insert attempts fail immediately (`P2002` error)

#### 2.5.3 Frontend Optimistic UI Update Strategy
```typescript
// appointment.component.ts - Angular component
@Component({
  selector: 'app-appointment',
  templateUrl: './appointment.component.html',
  styleUrls: ['./appointment.component.css'],
})
export class AppointmentComponent implements OnInit {
  @Input() timeSlot!: TimeSlot;
  @Output() appointmentCreated = new EventEmitter<Appointment>();
  
  isProcessing = signal(false);
  appointmentResult = signal<Appointment | null>(null);
  errorMessage = signal<string | null>(null);

  constructor(
    private appointmentService: AppointmentService,
    private notificationService: NotificationService,
  ) {}

  async createAppointment(): Promise<void> {
    if (this.isProcessing()) {
      return;
    }

    // 1. Immediately update UI state (optimistic update)
    this.isProcessing.set(true);
    this.errorMessage.set(null);
    
    // Display non-dismissible loading dialog
    this.notificationService.showLoading('Booking in progress...', true);

    // 2. Frontend random hash (hotspot sharding)
    const preferredSequence = Math.floor(Math.random() * this.timeSlot.capacity);
    
    try {
      // 3. Call appointment API
      const appointment = await this.appointmentService.create({
        timeSlotId: this.timeSlot.id,
        preferredSequence,
        // ...other parameters
      });

      // 4. Update success state
      this.appointmentResult.set(appointment);
      this.appointmentCreated.emit(appointment);
      
      this.notificationService.showSuccess('Booking successful!');
    } catch (error: any) {
      // 5. Error handling
      if (error.code === 'TIME_SLOT_FULL' || error.code === 'APPOINTMENT_CONFLICT') {
        this.errorMessage.set('This time slot has been booked by another user, please choose another slot');
        this.notificationService.showError('Booking failed, time slot has been taken');
      } else {
        this.errorMessage.set('Booking failed, please try again later');
        this.notificationService.showError('Booking failed, system error');
      }
      
      // 6. Record error metrics
      this.metricsService.trackError('appointment_create', error);
    } finally {
      // 7. Restore UI state
      this.isProcessing.set(false);
      this.notificationService.hideLoading();
    }
  }
}
```

### 2.6 Real-Time Communication API Design

#### 2.6.1 WebSocket Connection Management
- **Connection Endpoint**: `wss://api.example.com/v1/ws` (WSS mandatory in production)
- **Authentication Mechanism**: JWT Token for connection authentication
- **Heartbeat Mechanism**: 30-second heartbeat, auto-disconnect on timeout
- **Reconnect Strategy**: Exponential backoff reconnect mechanism

**NestJS WebSocket Gateway**:
```typescript
// appointment.gateway.ts
import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: 'appointments',
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
})
export class AppointmentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  
  private readonly logger = new Logger(AppointmentGateway.name);
  private readonly connectedClients = new Map<string, Socket>();

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      
      client.data.userId = payload.sub;
      this.connectedClients.set(payload.sub, client);
      
      this.logger.log(`Client connected: ${payload.sub}`);
      
      // Send connection success message
      client.emit('connected', { success: true });
    } catch (error) {
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      this.connectedClients.delete(userId);
      this.logger.log(`Client disconnected: ${userId}`);
    }
  }

  @SubscribeMessage('subscribe_appointments')
  handleSubscribeAppointments(client: Socket, data: any) {
    const userId = client.data.userId;
    client.join(`user:${userId}:appointments`);
    client.emit('subscribed', { channel: 'appointments' });
  }

  // Broadcast appointment status update
  notifyAppointmentUpdate(userId: string, appointment: any) {
    this.server.to(`user:${userId}:appointments`).emit('appointment_updated', appointment);
  }

  // Broadcast time slot capacity update
  notifyTimeSlotUpdate(timeSlotId: string, capacity: number, remaining: number) {
    this.server.emit('timeslot_updated', {
      timeSlotId,
      capacity,
      remaining,
      updatedAt: new Date().toISOString(),
    });
  }
}
```

**Angular WebSocket Service**:
```typescript
// websocket.service.ts
import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class WebsocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  isConnected = signal(false);
  appointmentUpdates = signal<any[]>([]);
  timeSlotUpdates = signal<any[]>([]);

  constructor(private authService: AuthService) {}

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    const token = this.authService.getAccessToken();
    if (!token) {
      console.warn('Not logged in, cannot establish WebSocket connection');
      return;
    }

    this.socket = io(`${environment.wsUrl}/appointments`, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
      });

      // Connection event listeners
      this.socket.on('connect', () => {
        this.isConnected.set(true);
        this.reconnectAttempts = 0;
        console.log('WebSocket connection established');
        
        // Auto-subscribe to user-specific channel
        this.socket?.emit('subscribe_appointments', {});
      });

      this.socket.on('disconnect', (reason) => {
        this.isConnected.set(false);
        console.log('WebSocket connection closed:', reason);
        
        if (reason === 'io server disconnect') {
          // Server actively disconnected, attempt to reconnect
          this.socket?.connect();
        }
      });

      this.socket.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      this.socket.on('appointment_updated', (appointment) => {
        this.appointmentUpdates.update(updates => [...updates, appointment]);
      });

      this.socket.on('timeslot_updated', (timeSlot) => {
        this.timeSlotUpdates.update(updates => [...updates, timeSlot]);
      });
    }

    disconnect(): void {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
        this.isConnected.set(false);
        this.appointmentUpdates.set([]);
        this.timeSlotUpdates.set([]);
      }
    }

    sendMessage(event: string, data: any): void {
      if (this.socket?.connected) {
        this.socket.emit(event, data);
      } else {
        console.warn('WebSocket not connected, cannot send message');
      }
    }

    subscribeToChannel(channel: string): void {
      this.sendMessage('subscribe', { channel });
    }
  }
```

#### 2.6.2 WebSocket Message Format Specification

All WebSocket messages use a unified JSON format to ensure consistency between frontend and backend communication.

**Base Message Format**:
```json
{
  "event": "appointment_updated",  // Event name
  "data": {
    // Event-specific data
  },
  "timestamp": "2026-04-14T10:30:00.000Z",  // Message timestamp
  "requestId": "ws-req-123456"  // Request ID (optional)
}
```

**Appointment Status Update Message**:
```json
{
  "event": "appointment_updated",
  "data": {
    "id": "apt_1234567890abcdef",
    "status": "CONFIRMED",
    "updatedAt": "2026-04-14T10:30:00.000Z",
    "timeSlotId": "ts_1234567890abcdef",
    "appointmentNumber": "APT-20260414-1234",
    "customerName": "Zhang San",
    "estimatedStartTime": "2026-04-15T14:30:00.000Z",
    "estimatedEndTime": "2026-04-15T15:00:00.000Z"
  },
  "timestamp": "2026-04-14T10:30:00.000Z"
}
```

**Time Slot Capacity Update Message**:
```json
{
  "event": "timeslot_updated",
  "data": {
    "timeSlotId": "ts_1234567890abcdef",
    "date": "2026-04-15",
    "startTime": "14:30:00",
    "endTime": "15:00:00",
    "totalCapacity": 10,
    "availableCapacity": 3,
    "reservedCount": 7,
    "updatedAt": "2026-04-14T10:30:00.000Z"
  },
  "timestamp": "2026-04-14T10:30:00.000Z"
}
```

**System Notification Message**:
```json
{
  "event": "system_notification",
  "data": {
    "type": "MAINTENANCE",  // MAINTENANCE, ALERT, INFO
    "title": "System Maintenance Notice",
    "message": "System maintenance upgrade scheduled from 23:00 to 01:00 tonight",
    "level": "INFO",  // INFO, WARNING, ERROR
    "startTime": "2026-04-14T23:00:00.000Z",
    "endTime": "2026-04-15T01:00:00.000Z",
    "actionUrl": "/announcements/maintenance-20260414"
  },
  "timestamp": "2026-04-14T10:30:00.000Z"
}
```

**Heartbeat Message**:
```json
{
  "event": "heartbeat",
  "data": {
    "serverTime": "2026-04-14T10:30:00.000Z",
    "connectionId": "conn_1234567890abcdef",
    "clientCount": 1523
  },
  "timestamp": "2026-04-14T10:30:00.000Z"
}
```

##### Dashboard WebSocket Event Definitions [v2.3.0]

The following WebSocket events are pushed from the server to the client for real-time data updates on the Admin Dashboard. All event directions are **Server → Client**.

| Event Name | Direction | Description | Payload Schema |
|--------|------|------|----------------|
| `slot.booked` | S→C | Pushed when a time slot is booked | `{ slotId: string, date: string, time: string, serviceId: string }` |
| `appointment.status_changed` | S→C | Pushed when appointment status changes | `{ appointmentId: string, oldStatus: string, newStatus: string, reason?: string }` |
| `notification.new` | S→C | Pushed when a new system notification arrives | `{ notificationId: string, type: string, title: string, body: string }` |
| `stats.updated` | S→C | Pushed when Dashboard statistics are updated | `{ statType: string, value: number, timestamp: string }` |
| `system.health.updated` | S→C | Pushed when system health status changes | `{ server: string, database: string, api: string, redis: string, lastBackup: string, uptime: string }` |

**Event Payload Examples**:

`slot.booked`:
```json
{
  "event": "slot.booked",
  "data": {
    "slotId": "ts_1234567890abcdef",
    "date": "2026-05-04",
    "time": "10:00",
    "serviceId": "svc_haircut_001"
  },
  "timestamp": "2026-05-04T10:30:00.000Z"
}
```

`appointment.status_changed`:
```json
{
  "event": "appointment.status_changed",
  "data": {
    "appointmentId": "apt_1234567890abcdef",
    "oldStatus": "PENDING",
    "newStatus": "CONFIRMED",
    "reason": "Administrator manually confirmed"
  },
  "timestamp": "2026-05-04T10:30:00.000Z"
}
```

`notification.new`:
```json
{
  "event": "notification.new",
  "data": {
    "notificationId": "notif_1234567890abcdef",
    "type": "warning",
    "title": "Appointment Reminder",
    "body": "You have an appointment at 10:00 tomorrow"
  },
  "timestamp": "2026-05-04T10:30:00.000Z"
}
```

`stats.updated`:
```json
{
  "event": "stats.updated",
  "data": {
    "statType": "today_bookings",
    "value": 25,
    "timestamp": "2026-05-04T10:30:00.000Z"
  },
  "timestamp": "2026-05-04T10:30:00.000Z"
}
```

`system.health.updated`:
```json
{
  "event": "system.health.updated",
  "data": {
    "server": "Online",
    "database": "Online",
    "api": "Online",
    "redis": "Online",
    "lastBackup": "2026-05-07T02:00:00Z",
    "uptime": "99.9%"
  },
  "timestamp": "2026-05-07T13:30:00.000Z"
}
```

##### Message Acknowledgment Mechanism

To ensure reliability of real-time communication, the system implements a Socket.IO-based message acknowledgment mechanism. After receiving important business messages (such as `appointment_updated`, `timeslot_updated`), the client must send an acknowledgment (ACK) message to the server. If the server does not receive acknowledgment, a degradation strategy will be triggered.

**Acknowledgment Message Format**:
```json
{
  "event": "ack",
  "data": {
    "originalEvent": "appointment_updated",
    "originalMessageId": "msg_1234567890abcdef",
    "receivedAt": "2026-04-14T10:30:00.000Z",
    "status": "PROCESSED"  // PROCESSED, IGNORED, ERROR
  },
  "timestamp": "2026-04-14T10:30:00.500Z"
}
```

**Client Acknowledgment Implementation** (Angular):
```typescript
// websocket.service.ts - Extended with message acknowledgment
export class WebsocketService {
  // ... existing code
  
  private setupAcknowledgment(): void {
    this.socket?.on('appointment_updated', (appointment) => {
      // Process appointment update
      this.appointmentUpdates.update(updates => [...updates, appointment]);
      
      // Send acknowledgment message
      this.sendAcknowledgment('appointment_updated', appointment.id);
    });
    
    this.socket?.on('timeslot_updated', (timeSlot) => {
      // Process time slot update
      this.timeSlotUpdates.update(updates => [...updates, timeSlot]);
      
      // Send acknowledgment message
      this.sendAcknowledgment('timeslot_updated', timeSlot.timeSlotId);
    });
  }
  
  private sendAcknowledgment(eventType: string, messageId: string): void {
    const ackMessage = {
      event: 'ack',
      data: {
        originalEvent: eventType,
        originalMessageId: messageId,
        receivedAt: new Date().toISOString(),
        status: 'PROCESSED'
      },
      timestamp: new Date().toISOString()
    };
    
    this.socket?.emit('acknowledgment', ackMessage);
  }
}
```

**Server-Side Acknowledgment Handling** (NestJS):
```typescript
// websocket.gateway.ts - Acknowledgment message handling
@WebSocketGateway({
  namespace: 'appointments',
  transports: ['websocket', 'polling'],
})
export class AppointmentGateway {
  private readonly pendingAcks = new Map<string, NodeJS.Timeout>();
  private readonly ackTimeout = 10000; // 10-second acknowledgment timeout
  
  @SubscribeMessage('appointment_updated')
  async handleAppointmentUpdated(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const messageId = data.id;
    
    // Send appointment update message
    client.emit('appointment_updated', data);
    
    // Set acknowledgment timeout timer
    const timeoutId = setTimeout(() => {
      this.handleAckTimeout(messageId, client);
    }, this.ackTimeout);
    
    this.pendingAcks.set(messageId, timeoutId);
  }
  
  @SubscribeMessage('acknowledgment')
  handleAcknowledgment(
    @MessageBody() ack: any,
    @ConnectedSocket() client: Socket,
  ) {
    const { originalMessageId, status } = ack.data;
    
    // Clear timeout timer
    const timeoutId = this.pendingAcks.get(originalMessageId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pendingAcks.delete(originalMessageId);
      console.log(`Message ${originalMessageId} acknowledged, status: ${status}`);
    }
  }
  
  private handleAckTimeout(messageId: string, client: Socket): void {
    console.warn(`Message ${messageId} not acknowledged, triggering fallback strategy`);
    
    // 1. Retry sending (max 3 times)
    this.retryMessage(messageId, client);
    
    // 2. Fallback to polling notification
    this.fallbackToPolling(messageId);
    
    // 3. Emergency SMS alert
    this.sendSmsAlert(messageId);
    
    this.pendingAcks.delete(messageId);
  }
  
  private retryMessage(messageId: string, client: Socket): void {
    // Implement message retry logic
    // Use exponential backoff: 1s, 2s, 4s
  }
  
  private fallbackToPolling(messageId: string): void {
    // Add message to polling queue, client retrieves on next poll
    console.log(`Message ${messageId} degraded to polling notification`);
  }
  
  private sendSmsAlert(messageId: string): void {
    // Send SMS alert in emergency situations (e.g., unacknowledged payment success notification)
    console.log(`Message ${messageId} triggered SMS alert`);
  }
}
```

**Fallback Strategy**:
| Scenario | Ack Timeout | Fallback Strategy | Trigger Condition |
|------|-------------|----------|----------|
| **General Business Messages** | 10 seconds | Retry 3 times, then degrade to polling | Unstable network, client offline |
| **Critical Business Messages** | 5 seconds | Retry 2 times, then send SMS alert | Payment success, appointment confirmation and other key operations |
| **System Notification Messages** | 30 seconds | Log only, no retry | Maintenance notices, announcements and other non-critical info |

**Acknowledgment Configuration**:
```typescript
// Socket.IO client acknowledgment configuration
const socket = io(`${environment.wsUrl}/appointments`, {
  auth: { token },
  transports: ['websocket', 'polling'],
  retries: 3,                    // Max retry count
  ackTimeout: 10000,            // Acknowledgment timeout (10 seconds)
  timeout: 5000,                // Connection timeout
});
```

#### 2.6.3 WebSocket Error Handling and Reconnect Strategy

**Error Types and Handling**:
| Error Type | Cause | Handling Strategy |
|----------|------|----------|
| **Authentication Error** | JWT Token invalid or expired | Disconnect, trigger frontend re-login flow |
| **Connection Timeout** | Unstable network, server unresponsive | Exponential backoff reconnect, max 5 retries |
| **Server Error** | Server-side internal exception | Disconnect, show friendly message, scheduled reconnect |
| **Protocol Error** | Message format does not meet specification | Discard error message, log, no impact on connection |

**Exponential Backoff Reconnect Algorithm**:
```typescript
// Reconnect strategy implementation example
class ReconnectionStrategy {
  private attempts = 0;
  private maxAttempts = 5;
  private baseDelay = 1000; // 1 second
  private maxDelay = 30000; // 30 seconds
  
  async reconnect(): Promise<boolean> {
    if (this.attempts >= this.maxAttempts) {
      return false;
    }
    
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.attempts), // Exponential growth
      this.maxDelay
    );
    
    this.attempts++;
    console.log(`Reconnect attempt ${this.attempts}/${this.maxAttempts}, waiting ${delay}ms`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return true;
  }
  
  reset(): void {
    this.attempts = 0;
  }
}
```

**Frontend Reconnect Implementation**:
```typescript
// Angular WebSocket reconnect service
@Injectable({ providedIn: 'root' })
export class WebsocketReconnectService {
  private reconnectStrategy = new ReconnectionStrategy();
  private reconnectTimer: any = null;
  
  constructor(
    private websocketService: WebsocketService,
    private authService: AuthService,
  ) {
    this.websocketService.connectionStatus$.subscribe(status => {
      if (status === 'disconnected') {
        this.handleDisconnection();
      } else if (status === 'connected') {
        this.reconnectStrategy.reset();
      }
    });
  }
  
  private async handleDisconnection(): Promise<void> {
    // Check if re-authentication is needed
    if (!this.authService.isAuthenticated()) {
      console.warn('User not authenticated, not attempting reconnect');
      return;
    }
    
    clearTimeout(this.reconnectTimer);
    
    const canRetry = await this.reconnectStrategy.reconnect();
    if (canRetry) {
      this.websocketService.connect();
    } else {
      this.notifyMaxRetriesExceeded();
    }
  }
  
  private notifyMaxRetriesExceeded(): void {
    // Show user-friendly message
    console.error('WebSocket reconnect failed, maximum retry count reached');
    // Can trigger frontend notification or degrade to polling mode
  }
}
```

**Connection Health Check**:
```typescript
// WebSocket connection health check
@Injectable({ providedIn: 'root' })
export class WebsocketHealthCheckService {
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly RESPONSE_TIMEOUT = 5000; // 5 seconds
  private heartbeatTimer: any = null;
  private lastHeartbeatResponse: number = 0;
  
  constructor(private websocketService: WebsocketService) {}
  
  startHealthCheck(): void {
    this.websocketService.socket?.on('heartbeat', () => {
      this.lastHeartbeatResponse = Date.now();
    });
    
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
      this.checkResponseTimeout();
    }, this.HEARTBEAT_INTERVAL);
  }
  
  private sendHeartbeat(): void {
    this.websocketService.sendMessage('heartbeat', {
      clientTime: new Date().toISOString(),
    });
  }
  
  private checkResponseTimeout(): void {
    const timeSinceLastResponse = Date.now() - this.lastHeartbeatResponse;
    if (timeSinceLastResponse > this.RESPONSE_TIMEOUT * 2) {
      console.warn('WebSocket heartbeat not responding, connection may be dropped');
      this.websocketService.disconnect();
    }
  }
  
  stopHealthCheck(): void {
    clearInterval(this.heartbeatTimer);
  }
}
```

## 3. API Documentation Generation and Maintenance

### 2.7 RequestId Tracing Specification

RequestId is the core identifier for full-chain request tracing, used for log aggregation, performance analysis, troubleshooting and auditing.

#### 2.7.1 requestId Format

- **Format**: `req-${uuid.v4()}`
- **Example**: `req-550e8400-e29b-41d4-a716-446655440000`
- **Length**: Fixed 40 characters (`req-` prefix + 36-character UUID v4)
- **Uniqueness**: Globally unique guaranteed by UUID v4

#### 2.7.2 Generation Priority

| Priority | Source | Description |
|--------|------|------|
| **1 (Highest)** | Frontend-provided `X-Request-ID` request header | Frontend must generate unique ID for each HTTP request |
| **2 (Fallback)** | Backend auto-generated | If frontend does not provide one, backend must generate |

**Frontend Generation Example** (Angular Interceptor):
```typescript
// request-id.interceptor.ts
import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const requestId = `req-${uuidv4()}`;
    const clonedRequest = request.clone({
      setHeaders: {
        'X-Request-ID': requestId,
      },
    });
    return next.handle(clonedRequest);
  }
}
```

**Backend Processing Example** (NestJS Middleware):
```typescript
// request-id.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Priority: frontend-provided > backend-generated
    const requestId = req.headers['x-request-id'] as string || `req-${uuidv4()}`;
    
    // Attach to request context
    req['requestId'] = requestId;
    
    // Pass back in response header
    res.setHeader('X-Request-ID', requestId);
    
    next();
  }
}
```

#### 2.7.3 Response Body Passback

All API response bodies must include the `requestId` field, consistent with the `X-Request-ID` response header.

**Success Response Example**:
```json
{
  "statusCode": 200,
  "message": "Operation successful",
  "data": { ... },
  "timestamp": "2026-04-22T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Response Example**:
```json
{
  "statusCode": 400,
  "message": "Request parameter validation failed",
  "error": "Bad Request",
  "errors": [ ... ],
  "timestamp": "2026-04-22T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

#### 2.7.4 Logging Requirements

All log entries must include `requestId` for log aggregation and tracing by request dimension.

**Log Format Example**:
```json
{
  "level": "info",
  "message": "Appointment created successfully",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "endpoint": "POST /v1/appointments",
  "statusCode": 201,
  "duration": 45,
  "timestamp": "2026-04-22T10:00:00.000Z"
}
```

**NestJS Logger Example**:
```typescript
// logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const requestId = request['requestId'];
    const { method, url } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const statusCode = response.statusCode;
        const duration = Date.now() - now;

        this.logger.log({
          message: `${method} ${url}`,
          requestId,
          statusCode,
          duration: `${duration}ms`,
        });
      }),
    );
  }
}
```

#### 2.7.5 Full-Chain Tracing

`requestId` should span the following system components:

```
Frontend (Angular) → X-Request-ID Header → Backend (NestJS) → Database Query Logs
     ↓                                          ↓                    ↓
  Browser Console                       App Logs (Winston)      PostgreSQL log_statement
     ↓                                          ↓                    ↓
  Sentry/RUM                              ELK/Loki               Audit Logs
```

**Tracing Scenarios**:
1. **Frontend Performance Analysis**: Associate frontend RUM data with backend response times via `requestId`
2. **Troubleshooting**: When users report issues, quickly locate complete request chain logs via `requestId`
3. **Audit Compliance**: All data change operations can be traced back to specific requests via `requestId`
4. **Distributed Tracing**: In microservice architecture, `requestId` can serve as a supplementary identifier to traceId

### 2.8 Admin Dashboard Statistics API Design

> **Modification Note** [v2.3.0]: Added Admin Dashboard statistics API endpoints covering four dimensions: core stat cards, booking trends, service distribution, and time distribution.
> Design basis: contract.yaml v1.5.0 api.admin.stats section and dedicated sub-endpoints; prototype mapping report DASH-001~004.
> Notes: Frontend DTO uses camelCase, backend wire format uses snake_case, auto-converted via HttpInterceptor.

#### 2.8.1 DASH-001: Core Stat Cards

**Endpoint**: `GET /v1/admin/stats`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns the 4 core stat cards at the top of the admin dashboard (today's bookings, pending confirmations, active users, total revenue).

**Query Parameters**:
| Parameter | Type | Required | Description | Example |
|--------|------|------|------|------|
| **timeRange** | string | No | Time range filter, enum: `last24h`, `last7d`, `last30d`, `thisMonth`, `lastMonth`, `custom` | `timeRange=last7d` |
| **startDate** | string (ISO 8601) | No | Custom start date (available when `timeRange=custom`) | `startDate=2026-04-01` |
| **endDate** | string (ISO 8601) | No | Custom end date (available when `timeRange=custom`) | `endDate=2026-04-30` |

> **Frontend Implementation Note**: The `timeRange` parameter is driven by the "Time" button dropdown menu in the dashboard Booking Distribution Panel, not the global header date picker. After selection, the frontend calls `loadTimeDistribution(timeRange)` to update only the time slot distribution bar chart data. If `timeRange=custom`, `startDate` and `endDate` must also be provided, triggered by the Booking Distribution Panel's Custom Range → date picker panel → Apply button.

**DTO Definitions** (TypeScript style):
```typescript
// admin-stats-response.dto.ts
export interface AdminStatsResponseDto {
  todayBookings: StatCardDto;      // Today's booking count
  pendingBookings: StatCardDto;    // Pending confirmation bookings
  activeUsers: StatCardDto;        // Active user count
  totalRevenue: StatCardDto;       // Total revenue
  bookingTrend: BookingTrendDto;   // DASH-002 booking trends
  servicePopularity: ServiceDistributionItemDto[]; // DASH-003 service distribution
  timeDistribution: TimeDistributionItemDto[];     // DASH-004 time distribution
}

export interface StatCardDto {
  value: number;                    // Current value (integer or monetary amount)
  changePercentage: number;         // Change percentage (e.g., 12.5 means +12.5%)
  isPositive: boolean;              // Whether change direction is positive (true=growth, false=decline)
  target: number;                   // Target value
  progressPercentage: number;       // Completion progress percentage (0-100)
}
```

**Example Request**:
```
GET /v1/admin/stats?timeRange=last7d
Authorization: Bearer eyJhbGci...
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": {
    "todayBookings": {
      "value": 24,
      "changePercentage": 15.3,
      "isPositive": true,
      "target": 50,
      "progressPercentage": 48.0
    },
    "pendingBookings": {
      "value": 8,
      "changePercentage": -5.2,
      "isPositive": false,
      "target": 10,
      "progressPercentage": 80.0
    },
    "activeUsers": {
      "value": 1254,
      "changePercentage": 8.7,
      "isPositive": true,
      "target": 2000,
      "progressPercentage": 62.7
    },
    "totalRevenue": {
      "value": 15800.50,
      "changePercentage": 22.1,
      "isPositive": true,
      "target": 30000.00,
      "progressPercentage": 52.7
    }
  },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.8.2 DASH-002: Booking Trend Chart (Booking Trends)

**Endpoint**: `GET /v1/admin/stats/booking-trends`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns booking trend line chart data, supports weekly/monthly/yearly switching, rendered with Chart.js on the frontend.

**Query Parameters**:
| Parameter | Type | Required | Default | Description |
|--------|------|------|--------|------|
| **range** | string | No | `weekly` | Time range granularity, enum: `weekly`, `monthly`, `yearly` |
| **granularity** | string | No | `day` | Data aggregation granularity, enum: `day`, `week`, `month` |
| **timeRange** | string | No | — | Global time range filter (same as DASH-001) |
| **startDate** | string (ISO 8601) | No | — | Custom start date |
| **endDate** | string (ISO 8601) | No | — | Custom end date |

**DTO Definitions** (TypeScript style):
```typescript
// booking-trend.dto.ts
export interface BookingTrendItem {
  date: string;              // Date (YYYY-MM-DD)
  count: number;             // Booking count for the day
  revenue: number;           // Revenue amount for the day
}

// bookingTrend field type in DASH-001: BookingTrendItem[]
// Response body type in DASH-002: BookingTrendItem[]

export interface BookingTrendQueryDto {
  range?: 'weekly' | 'monthly' | 'yearly';
  granularity?: 'day' | 'week' | 'month';
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;  // ISO 8601
  endDate?: string;    // ISO 8601
}
```

**Example Request**:
```
GET /v1/admin/stats/booking-trends?range=weekly&granularity=day
Authorization: Bearer eyJhbGci...
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": [
    { "date": "2026-04-28", "count": 18, "revenue": 5400 },
    { "date": "2026-04-29", "count": 22, "revenue": 6600 },
    { "date": "2026-04-30", "count": 15, "revenue": 4500 },
    { "date": "2026-05-01", "count": 28, "revenue": 8400 },
    { "date": "2026-05-02", "count": 35, "revenue": 10500 },
    { "date": "2026-05-03", "count": 42, "revenue": 12600 },
    { "date": "2026-05-04", "count": 30, "revenue": 9000 }
  ],
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.8.3 DASH-003: Service Distribution Chart (Service Distribution)

**Endpoint**: `GET /v1/admin/stats/service-distribution`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns service booking distribution data (donut/pie chart), showing the booking count and share of each service.

**Query Parameters**:
| Parameter | Type | Required | Description |
|--------|------|------|------|
| **timeRange** | string | No | Time range filter (same as DASH-001) |
| **startDate** | string (ISO 8601) | No | Custom start date |
| **endDate** | string (ISO 8601) | No | Custom end date |

**DTO Definitions** (TypeScript style):
```typescript
// service-distribution.dto.ts
export interface ServiceDistributionItemDto {
  serviceName: string;   // Service name, e.g., "Haircut", "Massage"
  count: number;         // Booking count for this service
  percentage: number;    // Share percentage (0-100), sum of all items is 100
}

export interface ServiceDistributionQueryDto {
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;  // ISO 8601
  endDate?: string;    // ISO 8601
}
```

**Example Request**:
```
GET /v1/admin/stats/service-distribution?timeRange=last30d
Authorization: Bearer eyJhbGci...
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": [
    { "serviceName": "Haircut", "count": 120, "percentage": 32.4 },
    { "serviceName": "Massage", "count": 95, "percentage": 25.7 },
    { "serviceName": "Manicure", "count": 68, "percentage": 18.4 },
    { "serviceName": "Facial", "count": 52, "percentage": 14.1 },
    { "serviceName": "Pediatric", "count": 35, "percentage": 9.5 }
  ],
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.8.4 DASH-004: Time Distribution Chart (Time Distribution)

**Endpoint**: `GET /v1/admin/stats/time-distribution`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns hourly booking distribution data (bar chart), showing booking heat for each time slot (e.g., 9-10, 10-11).

**Query Parameters**:
| Parameter | Type | Required | Description |
|--------|------|------|------|
| **timeRange** | string | No | Time range filter (same as DASH-001) |
| **startDate** | string (ISO 8601) | No | Custom start date |
| **endDate** | string (ISO 8601) | No | Custom end date |

> **Frontend Implementation Note**: The `timeRange` parameter is driven by the "Time" button dropdown menu in the dashboard Booking Distribution Panel, not the global header date picker. After selection, the frontend calls `loadTimeDistribution(timeRange)` to update only the time slot distribution bar chart data. If `timeRange=custom`, `startDate` and `endDate` must also be provided, triggered by the Booking Distribution Panel's Custom Range → date picker panel → Apply button.

**DTO Definitions** (TypeScript style):
```typescript
// time-distribution.dto.ts
export interface TimeDistributionItemDto {
  hour: number;      // Hour (0-23), e.g., 9 represents the 09:00-10:00 slot
  count: number;     // Booking count for this hour
}

export interface TimeDistributionQueryDto {
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;  // ISO 8601
  endDate?: string;    // ISO 8601
}
```

**Example Request**:
```
GET /v1/admin/stats/time-distribution?timeRange=last7d
Authorization: Bearer eyJhbGci...
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": [
    { "hour": 9, "count": 15 },
    { "hour": 10, "count": 28 },
    { "hour": 11, "count": 22 },
    { "hour": 13, "count": 18 },
    { "hour": 14, "count": 32 },
    { "hour": 15, "count": 25 },
    { "hour": 16, "count": 20 },
    { "hour": 17, "count": 12 }
  ],
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.8.5 Business Implementation Notes

Dashboard statistics are not stored separately but are calculated in real-time using the following methods:

| Data Dimension | Data Source | Calculation Method |
|----------|----------|----------|
| **Core Stat Cards** | Appointment, User tables | Prisma aggregate: `_count` + `_sum`, filtered by status/time |
| **Booking Trends** | Appointment table | Prisma groupBy: aggregate `appointmentDate` + `status` by time granularity |
| **Service Distribution** | Appointment + Service tables | Prisma groupBy: group by `serviceId` and count `_count` |
| **Time Distribution** | Appointment table | Prisma groupBy: extract hour field from `appointmentDate` and group count |

> **Performance Optimization**: For high-frequency access scenarios, consider creating PostgreSQL Materialized Views with periodic refresh, or use Redis to cache statistics results (TTL=5 minutes) to reduce repeated computation overhead.

---

### 2.9 Analytics Report API (AN)

> **Design Basis**: contract.yaml v1.6.0; prototype mapping report AN-001~002.
> **Module Description**: The analytics report module provides aggregate-level data analysis, including statistical chart data for appointment volume, service popularity, user growth, and revenue trends. All endpoints are planned for future phases.

#### Endpoint Overview

| Endpoint ID | Method | Path | Description | Auth | Rate Limit | Status |
|---------|------|------|------|------|------|------|
| AN-001 | GET | `/v1/admin/analytics/overview` | Aggregated analytics overview | ADMIN / SUPER_ADMIN | IP: 30/min | ⏳ Future Phase |
| AN-002 | GET | `/v1/admin/analytics/filtered` | Filtered analytics | ADMIN / SUPER_ADMIN | IP: 30/min | ⏳ Future Phase |

---

#### 2.9.1 AN-001: Aggregated Analytics Overview (Analytics Overview)

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned API specification.

**Endpoint**: `GET /v1/admin/analytics/overview`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns aggregated analytics data across dimensions, including summary information for appointment volume, service popularity, user acquisition, and revenue trends.

**Query Parameters**:
| Parameter | Type | Required | Description | Example |
|--------|------|------|------|------|
| **timeRange** | string | No | Time range: `last24h`, `last7d`, `last30d`, `thisMonth`, `lastMonth`, `custom` | `timeRange=last30d` |
| **startDate** | string (ISO 8601) | No | Custom start date | `startDate=2026-04-01` |
| **endDate** | string (ISO 8601) | No | Custom end date | `endDate=2026-04-30` |
| **serviceId** | string (UUID) | No | Filter by service (optional) | `serviceId=770e8400-...` |

**DTO Definitions** (TypeScript style):
```typescript
// analytics-overview.dto.ts
export interface AnalyticsOverviewDto {
  bookingVolume: {
    total: number;               // Total booking volume
    trend: number;               // Trend percentage (positive=growth, negative=decline)
    dataPoints: { date: string; count: number }[];
  };
  servicePopularity: {
    serviceName: string;
    count: number;
    percentage: number;
  }[];
  userAcquisition: {
    newUsers: number;
    returningUsers: number;
    churnRate: number;
  };
  revenueTrend: {
    total: number;
    trend: number;
    dataPoints: { date: string; amount: number }[];
  };
}

export interface AnalyticsOverviewQueryDto {
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;    // ISO 8601
  endDate?: string;      // ISO 8601
  serviceId?: string;    // UUID
}
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": {
    "bookingVolume": {
      "total": 2456,
      "trend": 12.5,
      "dataPoints": [
        { "date": "2026-04-01", "count": 82 },
        { "date": "2026-04-15", "count": 95 },
        { "date": "2026-04-30", "count": 110 }
      ]
    },
    "servicePopularity": [
      { "serviceName": "Haircut", "count": 720, "percentage": 29.3 },
      { "serviceName": "Massage", "count": 580, "percentage": 23.6 },
      { "serviceName": "Facial", "count": 420, "percentage": 17.1 }
    ],
    "userAcquisition": {
      "newUsers": 156,
      "returningUsers": 1098,
      "churnRate": 0.05
    },
    "revenueTrend": {
      "total": 123400.00,
      "trend": 8.3,
      "dataPoints": [
        { "date": "2026-04-01", "amount": 4100.00 },
        { "date": "2026-04-15", "amount": 4750.00 },
        { "date": "2026-04-30", "amount": 5500.00 }
      ]
    }
  },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.9.2 AN-002: Filtered Analytics

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned API specification.

**Endpoint**: `GET /v1/admin/analytics/filtered`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Supports multi-dimensional filtered analytics data queries by service type, user type, and time range.

**Query Parameters**:
| Parameter | Type | Required | Description | Example |
|--------|------|------|------|------|
| **serviceId** | string (UUID) | No | Filter by service | `serviceId=770e8400-...` |
| **userType** | string | No | Filter by user type: `CUSTOMER`, `ADMIN` | `userType=CUSTOMER` |
| **timeRange** | string | No | Time range (same as above) | `timeRange=last7d` |
| **startDate** | string (ISO 8601) | No | Custom start date | `startDate=2026-04-01` |
| **endDate** | string (ISO 8601) | No | Custom end date | `endDate=2026-04-30` |

**DTO Definitions** (TypeScript style):
```typescript
// filtered-analytics.dto.ts
export interface FilteredAnalyticsQueryDto {
  serviceId?: string;         // UUID
  userType?: 'CUSTOMER' | 'ADMIN';
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;         // ISO 8601
  endDate?: string;           // ISO 8601
}

// Response structure is the same as AnalyticsOverviewDto, but data aggregated by filter conditions
```

**Example Request**:
```
GET /v1/admin/analytics/filtered?serviceId=770e8400-...&userType=CUSTOMER&timeRange=last7d
Authorization: Bearer eyJhbGci...
```

---

### 2.10 History API (HIST)

> **Design Basis**: contract.yaml v1.6.0; prototype mapping report HIST-001~003.
> **Module Overview**: The history module provides system operation audit tracking, including booking change records, user activity logs, and system event queries. All endpoints are planned for future phases.

#### Endpoint Overview

| Endpoint ID | Method | Path | Description | Auth | Rate Limit | Status |
|---------|------|------|------|------|------|------|
| HIST-001 | GET | `/v1/admin/history` | Paginated history record list | ADMIN / SUPER_ADMIN | IP: 60/min | ⏳ Future Phase |
| HIST-002 | GET | `/v1/admin/history/bookings` | Booking change history | ADMIN / SUPER_ADMIN | IP: 60/min | ⏳ Future Phase |
| HIST-003 | GET | `/v1/admin/history/user-activity` | User activity log | ADMIN / SUPER_ADMIN | IP: 60/min | ⏳ Future Phase |

---

#### 2.11.1 HIST-001: History List

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned interface specification.

**Endpoint**: `GET /v1/admin/history`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns a paginated general history record list covering booking changes, user operations, and system events.

**Query Parameters**:
| Parameter | Type | Required | Default | Description |
|--------|------|------|--------|------|
| **page** | integer | No | 1 | Page number |
| **limit** | integer | No | 20 | Records per page |
| **timeRange** | string | No | — | Time range filter |
| **startDate** | string (ISO 8601) | No | — | Custom start date |
| **endDate** | string (ISO 8601) | No | — | Custom end date |

**DTO Definition** (TypeScript style):
```typescript
// history-list.dto.ts
export interface HistoryItemDto {
  id: string;                // UUID
  type: string;              // Record type: "booking_change", "user_action", "system_event"
  action: string;            // Operation description, e.g. "created", "updated", "cancelled"
  userId: string;            // Operator user ID
  userName: string;          // Operator user name
  timestamp: string;         // ISO 8601 datetime
  details: Record<string, unknown>;  // Detail JSON
}

export interface HistoryListResponseDto {
  items: HistoryItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface HistoryQueryDto {
  page?: number;
  limit?: number;
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;       // ISO 8601
  endDate?: string;         // ISO 8601
}
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": {
    "items": [
      {
        "id": "hist-001",
        "type": "booking_change",
        "action": "cancelled",
        "userId": "user-abc",
        "userName": "Zhang Wei",
        "timestamp": "2026-05-04T09:30:00.000Z",
        "details": { "bookingId": "bk-001", "previousStatus": "CONFIRMED", "newStatus": "CANCELLED" }
      },
      {
        "id": "hist-002",
        "type": "user_action",
        "action": "login",
        "userId": "user-def",
        "userName": "Li Na",
        "timestamp": "2026-05-04T09:15:00.000Z",
        "details": { "ip": "192.168.1.1", "device": "Chrome/125" }
      }
    ],
    "total": 156,
    "page": 1,
    "limit": 20
  },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.11.2 HIST-002: Booking Change History

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned interface specification.

**Endpoint**: `GET /v1/admin/history/bookings`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns filtered booking-related history records, supporting filtering by status, service, and customer dimensions.

**Query Parameters**:
| Parameter | Type | Required | Description |
|--------|------|------|------|
| **page** | integer | No | Page number, default 1 |
| **limit** | integer | No | Records per page, default 20 |
| **bookingStatus** | string | No | Filter status: `PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED`, `EXPIRED` |
| **serviceId** | string (UUID) | No | Filter by service |
| **customerId** | string (UUID) | No | Filter by customer |
| **timeRange** | string | No | Time range filter |
| **startDate** | string (ISO 8601) | No | Custom start date |
| **endDate** | string (ISO 8601) | No | Custom end date |

**DTO Definition** (TypeScript style):
```typescript
// booking-history.dto.ts
export interface BookingHistoryQueryDto {
  page?: number;
  limit?: number;
  bookingStatus?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'EXPIRED';
  serviceId?: string;       // UUID
  customerId?: string;      // UUID
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;       // ISO 8601
  endDate?: string;         // ISO 8601
}
// Response structure is the same as HIST-001's HistoryItemDto[]
```

**Example Request**:
```
GET /v1/admin/history/bookings?bookingStatus=CANCELLED&timeRange=last30d&page=1&limit=20
Authorization: Bearer eyJhbGci...
```

---

#### 2.11.3 HIST-003: User Activity Log

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned interface specification.

**Endpoint**: `GET /v1/admin/history/user-activity`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns operation activity logs for a specific user or all users, supporting filtering by user, action type, and time range.

**Query Parameters**:
| Parameter | Type | Required | Description |
|--------|------|------|------|
| **userId** | string (UUID) | No | Filter by user |
| **actionType** | string | No | Action type: `login`, `logout`, `create_booking`, `cancel_booking`, `update_profile` |
| **timeRange** | string | No | Time range filter |
| **startDate** | string (ISO 8601) | No | Custom start date |
| **endDate** | string (ISO 8601) | No | Custom end date |

**DTO Definition** (TypeScript style):
```typescript
// user-activity.dto.ts
export interface UserActivityQueryDto {
  userId?: string;          // UUID
  actionType?: 'login' | 'logout' | 'create_booking' | 'cancel_booking' | 'update_profile';
  timeRange?: 'last24h' | 'last7d' | 'last30d' | 'thisMonth' | 'lastMonth' | 'custom';
  startDate?: string;       // ISO 8601
  endDate?: string;         // ISO 8601
}
// Response structure is the same as HIST-001's HistoryItemDto[]
```

**Example Request**:
```
GET /v1/admin/history/user-activity?userId=user-abc&actionType=create_booking&timeRange=last7d
Authorization: Bearer eyJhbGci...
```

---

### 2.11 System Health and Notifications API (SYS)

> **Design Basis**: contract.yaml v1.6.0 and prototype/admin/ mapping report SYS-001~004.
> **Module Overview**: The system management module provides system health status, notification management (bell icon), and system configuration functions. SYS-002 and SYS-003 are formally defined in contract.yaml v1.6.0 and can be referenced directly; SYS-001 is implemented, SYS-004 is planned for future phase.

#### Endpoint Overview

| Endpoint ID | Method | Path | Description | Auth | Rate Limit | Status |
|---------|------|------|------|------|------|------|
| SYS-001 | GET | `/v1/admin/system/health` | System health status | ADMIN / SUPER_ADMIN | IP: 60/min | ✅ Implemented |
| SYS-002 | GET | `/v1/admin/notifications` | Notification list (paginated) | ADMIN / SUPER_ADMIN | IP: 60/min | ✅ Implemented |
| SYS-003 | POST | `/v1/admin/notifications/:id/read` | Mark single notification as read | ADMIN / SUPER_ADMIN | IP: 60/min | ✅ Implemented |
| SYS-004 | GET | `/v1/admin/settings` | System configuration | ADMIN / SUPER_ADMIN | IP: 30/min | ⏳ Future Phase |

---

#### 2.12.1 SYS-001: System Health Status

**Endpoint**: `GET /v1/admin/system/health`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns the real-time health status of each system component, including server, database, API gateway, last backup time, and uptime.

**No query parameters required**.

**DTO Definition** (TypeScript style):
```typescript
// system-health.dto.ts
export interface SystemHealthDto {
  server: string;          // Server status: "Online", "Degraded", "Offline"
  database: string;        // Database status: "Online", "Degraded", "Offline"
  api: string;             // API gateway status: "Online", "Degraded", "Offline"
  lastBackup: string;      // Last backup time ISO 8601 datetime
  uptime: string;          // Uptime, format e.g. "15d 4h 32m"
}
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "System running normally",
  "data": {
    "server": "Online",
    "database": "Online",
    "api": "Online",
    "lastBackup": "2026-05-03T02:00:00.000Z",
    "uptime": "32d 8h 15m"
  },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.12.2 SYS-002: Notification List

> **Contract Reference**: This endpoint is formally defined in `contract.yaml` v1.6.0. For the specific specification, refer to the `api.admin.notifications.list` section of contract.yaml. The following is a functional overview.

**Endpoint**: `GET /v1/admin/notifications`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns a paginated notification list, supporting a filter to show only unread notifications. This endpoint corresponds to the dropdown content of the notification bell icon in the top navigation bar.

**contract.yaml Reference**:
- Path: `GET /v1/admin/notifications`
- Query parameters: `page` (integer, default 1), `limit` (integer, default 20), `unread_only` (boolean)
- Response body: pagination format `{ items: NotificationItem[], total, page, limit }`
- Notification fields: `id`, `type` (info/warning/error/success), `title`, `body`, `read` (boolean), `created_at`

> For the complete specification, refer to `booking_system_refactor/contract.yaml` in the project root.

---

#### 2.12.3 SYS-003: Mark Notification as Read

> **Contract Reference**: This endpoint is formally defined in `contract.yaml` v1.6.0. For the specific specification, refer to the `api.admin.notifications.mark_read` section of contract.yaml. The following is a functional overview.

**Endpoint**: `POST /v1/admin/notifications/:id/read`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Marks a single notification as read, controlling the display of the red unread dot on the notification bell icon.

**contract.yaml Reference**:
- Path: `POST /v1/admin/notifications/:id/read`
- Path parameter: `id` (string, notification ID)
- Success response: HTTP 200

> For the complete specification, refer to `booking_system_refactor/contract.yaml` in the project root.

---

#### 2.12.4 SYS-004: System Configuration

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned interface specification.

**Endpoint**: `GET /v1/admin/settings`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns global system configuration options and current setting values, including business hours, booking rules, notification preferences, and more.

**DTO Definition** (TypeScript style):
```typescript
// system-settings.dto.ts
export interface SystemSettingsDto {
  businessHours: {
    openTime: string;       // HH:mm
    closeTime: string;      // HH:mm
    workingDays: number[];  // 0=Sunday, 6=Saturday
  };
  bookingRules: {
    maxAdvanceDays: number;   // Maximum advance booking days
    minAdvanceHours: number;  // Minimum advance booking hours
    maxPerSlot: number;       // Maximum bookings per time slot
    cancellationDeadlineHours: number;  // Cancellation deadline hours
  };
  notifications: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
  };
  maintenance: {
    mode: 'normal' | 'maintenance' | 'readonly';
    message?: string;
  };
}
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": {
    "businessHours": {
      "openTime": "09:00",
      "closeTime": "18:00",
      "workingDays": [1, 2, 3, 4, 5]
    },
    "bookingRules": {
      "maxAdvanceDays": 30,
      "minAdvanceHours": 2,
      "maxPerSlot": 3,
      "cancellationDeadlineHours": 24
    },
    "notifications": {
      "emailEnabled": true,
      "smsEnabled": false,
      "pushEnabled": true
    },
    "maintenance": {
      "mode": "normal",
      "message": null
    }
  },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.12.5 appointment.status_changed WebSocket Event (Dashboard Real-Time Refresh)

> **Design Basis**: contract.yaml v1.7.5 WebSocket Events section; D-4 real-time dashboard update requirements.
> **Event Description**: When an appointment status changes, the server pushes this event via WebSocket, triggering the Admin Dashboard to automatically refresh stat card data and the recent appointments list for real-time updates.

**Event Definition**:

| Property | Value |
|------|-----|
| **Event Name** | `appointment.status_changed` |
| **Direction** | Server → Client |
| **Trigger Condition** | When an administrator changes appointment status via `PUT /v1/admin/appointments/:id/status` |
| **Trigger Effect** | Dashboard automatically updates stat cards (totalBookings, todayBookings, pendingBookings) and the recent appointments list |
| **Fallback Strategy** | If WebSocket is unavailable, use 60-second HTTP polling refresh (`GET /v1/admin/stats` + `GET /v1/admin/appointments?limit=5`) |

**Payload Schema**:
```typescript
interface AppointmentStatusChangedPayload {
  appointmentId: string;               // Appointment ID
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'EXPIRED';  // New status
  previousStatus: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'EXPIRED';  // Previous status
  timestamp: string;                   // ISO 8601 timestamp
}
```

**JSON Example**:
```json
{
  "event": "appointment.status_changed",
  "data": {
    "appointmentId": "apt_1234567890abcdef",
    "status": "CONFIRMED",
    "previousStatus": "PENDING",
    "timestamp": "2026-05-08T10:30:00.000Z"
  }
}
```

---

### 2.12 Messages API (MSG)

> **Design Basis**: contract.yaml v1.6.0; prototype mapping report MSG-001~004.
> **Module Overview**: The messages module provides a message inbox for the admin console, corresponding to the envelope icon in the top navigation bar. MSG-004 is formally defined in contract.yaml v1.6.0 and can be referenced directly; MSG-001~003 are planned for future phases.

#### Endpoint Overview

| Endpoint ID | Method | Path | Description | Auth | Rate Limit | Status |
|---------|------|------|------|------|------|------|
| MSG-001 | GET | `/v1/admin/messages` | Paginated message inbox list | ADMIN / SUPER_ADMIN | IP: 60/min | ⏳ Future Phase |
| MSG-002 | POST | `/v1/admin/messages/:id/read` | Mark single message as read | ADMIN / SUPER_ADMIN | IP: 60/min | ⏳ Future Phase |
| MSG-003 | POST | `/v1/admin/messages/read-all` | Mark all as read | ADMIN / SUPER_ADMIN | IP: 10/min | ⏳ Future Phase |
| MSG-004 | GET | `/v1/admin/messages/unread-count` | Unread count | ADMIN / SUPER_ADMIN | IP: 120/min | ✅ Implemented |

---

#### 2.13.1 MSG-001: Message Inbox

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned interface specification.

**Endpoint**: `GET /v1/admin/messages`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns a paginated message inbox list, corresponding to the dropdown panel shown when the envelope icon in the top navigation bar is clicked.

**Query Parameters**:
| Parameter | Type | Required | Default | Description |
|--------|------|------|--------|------|
| **page** | integer | No | 1 | Page number |
| **limit** | integer | No | 20 | Records per page |

**DTO Definition** (TypeScript style):
```typescript
// message-inbox.dto.ts
export interface MessageItemDto {
  id: string;            // UUID
  sender: string;        // Sender name
  subject: string;       // Message subject
  body: string;          // Message body
  read: boolean;         // Whether read
  createdAt: string;     // ISO 8601 datetime
}

export interface MessageListResponseDto {
  items: MessageItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface MessageQueryDto {
  page?: number;
  limit?: number;
}
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Query successful",
  "data": {
    "items": [
      {
        "id": "msg-001",
        "sender": "System Admin",
        "subject": "System maintenance notice",
        "body": "Routine maintenance scheduled for May 5 at 02:00, estimated 30 minutes.",
        "read": false,
        "createdAt": "2026-05-04T08:00:00.000Z"
      },
      {
        "id": "msg-002",
        "sender": "Zhang Wei",
        "subject": "Leave request",
        "body": "Requesting one day of leave on May 10.",
        "read": true,
        "createdAt": "2026-05-03T14:30:00.000Z"
      }
    ],
    "total": 12,
    "page": 1,
    "limit": 20
  },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.13.2 MSG-002: Mark Single Message as Read

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned interface specification.

**Endpoint**: `POST /v1/admin/messages/:id/read`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Marks a single internal message as read.

**Path Parameters**:
| Parameter | Type | Required | Description |
|--------|------|------|------|
| **id** | string (UUID) | Yes | Message ID |

**Example Request**:
```
POST /v1/admin/messages/msg-001/read
Authorization: Bearer eyJhbGci...
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "Marked as read",
  "data": { "id": "msg-001", "read": true },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.13.3 MSG-003: Mark All as Read

> ⚠️ **Future Phase (FUTURE-PHASE)** — This endpoint has not yet been implemented in the prototype or backend. The following is the planned interface specification.

**Endpoint**: `POST /v1/admin/messages/read-all`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Marks all unread internal messages for the current user as read at once.

**Example Request**:
```
POST /v1/admin/messages/read-all
Authorization: Bearer eyJhbGci...
```

**Example Response** (JSON):
```json
{
  "statusCode": 200,
  "message": "All messages marked as read",
  "data": { "updatedCount": 8 },
  "timestamp": "2026-05-04T10:00:00.000Z",
  "requestId": "req-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### 2.13.4 MSG-004: Unread Message Count

> **Contract Reference**: This endpoint is formally defined in `contract.yaml` v1.6.0. For the specific specification, refer to the `api.admin.unread_message_count` section of contract.yaml. The following is a functional overview.

**Endpoint**: `GET /v1/admin/messages/unread-count`
**Auth**: ADMIN / SUPER_ADMIN role required
**Description**: Returns the number of unread internal messages for the current user, used to control the blue unread dot display on the envelope icon in the top navigation bar.

**contract.yaml Reference**:
- Path: `GET /v1/admin/messages/unread-count`
- No query parameters required
- Response body: `{ count: integer }`

> For the complete specification, refer to `booking_system_refactor/contract.yaml` in the project root.

---

### 3. API Documentation Generation and Maintenance

### 3.1 OpenAPI 3.0 Specification Integration

The system uses `@nestjs/swagger` to automatically generate OpenAPI 3.0 specification API documentation, ensuring documentation stays in sync with the code.

**NestJS Swagger Configuration**:
```typescript
// swagger.config.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Booking System API')
    .setDescription('Booking system API documentation rebuilt on Angular + NestJS')
    .setVersion('1.0.0')
    .setContact('Technical Support', 'https://support.example.com', 'support@example.com')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT Token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Auth', 'User authentication endpoints')
    .addTag('Appointments', 'Appointment management endpoints')
    .addTag('Time Slots', 'Time slot management endpoints')
    .addTag('Services', 'Service item endpoints')
    .addTag('Users', 'User management endpoints')
    .addServer('https://api.example.com', 'Production')
    .addServer('https://staging-api.example.com', 'Staging')
    .addServer('http://localhost:3000', 'Development')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
    customSiteTitle: 'Booking System API Documentation',
    customfavIcon: '/favicon.ico',
    customCss: '.swagger-ui .topbar { display: none }',
  });
}
```

**Controller Documentation Decorator Example**:
```typescript
// appointment.controller.ts
import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { Appointment } from './entities/appointment.entity';
import { PaginationQueryDto } from './dto/pagination-query.dto';

@ApiTags('Appointments')
@ApiBearerAuth('JWT-auth')
@Controller('v1/appointments')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @ApiOperation({ 
    summary: 'Create appointment',
    description: 'Creates a new appointment record using atomic preemption mechanism to prevent overselling in high-concurrency scenarios.',
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Appointment created successfully',
    type: Appointment,
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Request parameter validation failed',
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthenticated or invalid token',
  })
  @ApiResponse({ 
    status: 409, 
    description: 'Appointment conflict, time slot already taken',
  })
  @ApiResponse({ 
    status: 422, 
    description: 'Business rule validation failed (e.g. slot is full)',
  })
  @ApiResponse({ 
    status: 429, 
    description: 'Rate limit exceeded',
  })
  async create(@Body() createAppointmentDto: CreateAppointmentDto) {
    return this.appointmentService.create(createAppointmentDto);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get appointment list',
    description: 'Get appointment list with support for pagination, sorting, filtering, and search.',
  })
  @ApiQuery({ 
    name: 'page', 
    required: false, 
    type: Number, 
    description: 'Page number (starting from 1)',
    example: 1,
  })
  @ApiQuery({ 
    name: 'limit', 
    required: false, 
    type: Number, 
    description: 'Records per page',
    example: 20,
  })
  @ApiQuery({ 
    name: 'sort', 
    required: false, 
    type: String, 
    description: 'Sort field and direction (format: field:direction)',
    example: 'createdAt:desc',
  })
  @ApiQuery({ 
    name: 'status', 
    required: false, 
    type: String, 
    description: 'Filter by status',
    example: 'PENDING',
  })
  @ApiQuery({ 
    name: 'q', 
    required: false, 
    type: String, 
    description: 'Search keyword (supports appointment number, customer name)',
    example: 'Zhang San',
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Query successful',
    type: [Appointment],
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthenticated or invalid token',
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Insufficient permissions',
  })
  async findAll(@Query() query: PaginationQueryDto) {
    return this.appointmentService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get appointment details',
    description: 'Get appointment details by ID.',
  })
  @ApiParam({ 
    name: 'id', 
    type: String, 
    description: 'Appointment ID',
    example: 'apt_1234567890abcdef',
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Query successful',
    type: Appointment,
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthenticated or invalid token',
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Appointment not found',
  })
  async findOne(@Param('id') id: string) {
    return this.appointmentService.findOne(id);
  }
}
```

**DTO Documentation Decorator Example**:
```typescript
// create-appointment.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsDateString, IsJSON, IsOptional, Min, Max, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAppointmentDto {
  @ApiProperty({
    description: 'Time slot ID',
    example: 'ts_1234567890abcdef',
    required: true,
  })
  @IsUUID()
  @IsNotEmpty()
  timeSlotId: string;

  @ApiProperty({
    description: 'Service item ID',
    example: 'svc_1234567890abcdef',
    required: true,
  })
  @IsUUID()
  @IsNotEmpty()
  serviceId: string;

  @ApiProperty({
    description: 'Appointment date and time (ISO 8601 format)',
    example: '2026-04-15T14:30:00.000Z',
    required: true,
  })
  @IsDateString()
  @IsNotEmpty()
  appointmentDate: string;

  @ApiProperty({
    description: 'Customer information (JSON format)',
    example: {
      name: 'Zhang San',
      phone: '13800138000',
      email: 'zhangsan@example.com',
      identification: {
        type: 'ID_CARD',
        number: '110101199001011234',
      },
    },
    required: true,
  })
  @IsJSON()
  @IsNotEmpty()
  @Transform(({ value }) => {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return value;
    }
  })
  customerInfo: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Remarks',
    example: 'Please arrange a window seat',
    required: false,
  })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiPropertyOptional({
    description: 'Preferred sequence number (0-999), used for hotspot sharding',
    example: 42,
    minimum: 0,
    maximum: 999,
    required: false,
  })
  @IsOptional()
  @Min(0)
  @Max(999)
  preferredSequence?: number;
}
```

### 3.2 Documentation Deployment and Access

**Documentation Access URLs**:
- Development: `http://localhost:3000/api/docs`
- Staging: `https://staging-api.example.com/api/docs`
- Production: `https://api.example.com/api/docs`

**Documentation Deployment Process**:
1. **Auto-generation**: CI/CD pipeline automatically generates the latest API documentation during build
2. **Static hosting**: Documentation is deployed as static assets to CDN for fast access
3. **Version management**: Each API version has a corresponding independent documentation page
4. **Access control**: Production documentation requires authentication (Basic Auth or IP whitelist)

**CI/CD Integration Example** (GitHub Actions):
```yaml
# .github/workflows/deploy-docs.yml
name: Deploy API Documentation

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20.x'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Generate API Documentation
      run: |
        npm run build
        npm run swagger:generate -- --output docs/openapi.json
    
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./docs
        destination_dir: ./api-docs
        keep_files: false
```

### 3.3 Documentation Quality Assurance

**Documentation Completeness Checklist**:
| Check Item | Standard | Tool/Method |
|--------|------|----------|
| **Endpoint Coverage** | All controller endpoints must generate documentation | Custom script checks `@ApiOperation` decorator |
| **Parameter Documentation** | All DTO fields must have `@ApiProperty` decorator | NestJS Swagger plugin |
| **Response Documentation** | All endpoints must define response status codes and types | ESLint rule check |
| **Example Data** | All `@ApiProperty` must provide example values | Code review |
| **Error Handling** | All possible error states must be documented | Automated test verification |

**Documentation Validation Script**:
```typescript
// scripts/validate-swagger.ts
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import * as fs from 'fs';

async function validateSwagger() {
  const app = await NestFactory.create(AppModule, { logger: false });
  
  // Generate Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Booking System API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  
  // Validate documentation completeness
  let missingDocs = [];
  
  // Check all paths have documentation
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, endpoint] of Object.entries(methods)) {
      if (!endpoint.summary || !endpoint.description) {
        missingDocs.push(`${method.toUpperCase()} ${path}`);
      }
      
      // Check response documentation
      if (!endpoint.responses || Object.keys(endpoint.responses).length === 0) {
        missingDocs.push(`${method.toUpperCase()} ${path} - missing response definition`);
      }
    }
  }
  
  if (missingDocs.length > 0) {
    console.error('❌ Documentation completeness check failed:');
    missingDocs.forEach(item => console.error(`  - ${item}`));
    process.exit(1);
  } else {
    console.log('✅ All endpoint documentation is complete');
    
    // Save documentation file
    fs.writeFileSync('openapi.json', JSON.stringify(document, null, 2));
    console.log('📄 API documentation saved to openapi.json');
  }
  
  await app.close();
}

validateSwagger().catch(console.error);
```

**Documentation Maintenance Strategy**:
1. **Docs as Code**: Documentation is committed to version control together with the source code
2. **PR Check**: Every Pull Request must pass documentation completeness checks
3. **Periodic Review**: Monthly documentation accuracy review
4. **User Feedback**: Collect user feedback on documentation for continuous improvement
5. **Version Archiving**: Each API version has a corresponding independent documentation snapshot

## 4. API Performance Optimization Strategy

### 4.1 High-Concurrency Scenario Optimization

**Atomic Preemption Mechanism** (aligned with data architecture design document):
```sql
-- PostgreSQL partial unique index definition
CREATE UNIQUE INDEX idx_appointment_time_slot_sequence 
ON appointments (time_slot_id, slot_sequence) 
WHERE status IN ('PENDING', 'CONFIRMED');

-- Atomically increment currentSequence
UPDATE time_slots 
SET current_sequence = current_sequence + 1 
WHERE id = :timeSlotId 
RETURNING current_sequence;
```

**Redis Soft Rate Limiting Implementation**:
```typescript
// redis-ratelimit.service.ts
@Injectable()
export class RedisRateLimitService {
  constructor(private redisService: RedisService) {}

  async checkSlotAvailability(timeSlotId: string, capacity: number): Promise<boolean> {
    const key = `slot:${timeSlotId}:remaining`;
    
    // Use Lua script to ensure atomicity
    const luaScript = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      
      local current = redis.call('GET', key)
      if not current then
        redis.call('SET', key, capacity)
        current = capacity
      end
      
      if tonumber(current) <= 0 then
        return -1
      end
      
      local newVal = redis.call('DECR', key)
      return newVal
    `;
    
    const result = await this.redisService.eval(
      luaScript,
      1, // number of keys
      key,
      capacity.toString(),
    );
    
    return result >= 0;
  }

  async releaseSlot(timeSlotId: string): Promise<void> {
    const key = `slot:${timeSlotId}:remaining`;
    await this.redisService.incr(key);
  }
}
```

**Connection Pool Optimization**:
```typescript
// database.config.ts
import { Pool } from 'pg';

export const databasePool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 100, // Maximum connections
  idleTimeoutMillis: 30000, // Idle connection timeout
  connectionTimeoutMillis: 5000, // Connection timeout
  // Connection pool stats
  application_name: 'booking-api',
  // Connection validation
  maxUses: 10000, // Force rebuild after max uses per connection
});
```

### 4.2 Cache Strategy Optimization

**Multi-Level Cache Architecture**:
| Cache Level | Technology | Usage | TTL | Update Strategy |
|----------|------|------|-----|----------|
| **L1 Cache** | In-memory cache (Node.js) | Hot data, configuration | 60s | Active invalidation |
| **L2 Cache** | Redis cluster | Sessions, rate limit counters, high-frequency queries | 5min | Update on write |
| **L3 Cache** | CDN static cache | Static assets, API responses | 1hr | Version number control |
| **Database Cache** | PostgreSQL Query Cache | Complex query results | 15min | Auto invalidation |

**Cache Penetration Protection**:
```typescript
// cache.service.ts - Bloom filter for cache penetration protection
@Injectable()
export class CacheService {
  private bloomFilter = new BloomFilter(1000000, 0.01); // 1M capacity, 1% false positive rate
  
  async getWithBloomFilter(key: string, fetchFn: () => Promise<any>, ttl = 300): Promise<any> {
    // 1. Check bloom filter
    if (!this.bloomFilter.has(key)) {
      // Key definitely does not exist, return null directly to avoid DB query
      return null;
    }
    
    // 2. Try to get from cache
    const cached = await this.redisService.get(key);
    if (cached !== null) {
      return JSON.parse(cached);
    }
    
    // 3. Cache miss, check mutex lock to prevent cache breakdown
    const lockKey = `lock:${key}`;
    const lockAcquired = await this.redisService.setnx(lockKey, '1', 10); // 10-second lock
    
    if (lockAcquired) {
      try {
        // 4. Query database
        const data = await fetchFn();
        if (data) {
          // 5. Update cache and bloom filter
          await this.redisService.setex(key, ttl, JSON.stringify(data));
          this.bloomFilter.add(key);
        } else {
          // 6. Not in DB either, cache null value (short time)
          await this.redisService.setex(key, 60, JSON.stringify(null)); // Cache null value for 60 seconds
        }
        return data;
      } finally {
        // 7. Release lock
        await this.redisService.del(lockKey);
      }
    } else {
      // 8. Wait for other thread to build cache
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
      return this.getWithBloomFilter(key, fetchFn, ttl); // Retry
    }
  }
}
```

### 4.3 Database Query Optimization

**Query Optimization Strategies**:
1. **Index Optimization**: 
   - Composite index: `(time_slot_id, status, created_at)`
   - Covering index: `INCLUDE (customer_name, appointment_number)`
   - Partial index: `WHERE status = 'ACTIVE'`

2. **Query Splitting**:
   ```typescript
   // Split complex query into multiple simple queries
   async getAppointmentDashboard(userId: string) {
     const [
       upcoming,
       completed,
       cancelled,
       statistics,
     ] = await Promise.all([
       this.getUpcomingAppointments(userId),
       this.getCompletedAppointments(userId),
       this.getCancelledAppointments(userId),
       this.getAppointmentStatistics(userId),
     ]);
     
     return { upcoming, completed, cancelled, statistics };
   }
   ```

3. **Pagination Optimization**:
   ```typescript
   // Use cursor pagination instead of offset pagination
   async getAppointmentsCursor(cursor: string | null, limit: number) {
     const query = this.prisma.appointment.findMany({
       take: limit,
       where: cursor ? { id: { gt: cursor } } : undefined,
       orderBy: { id: 'asc' }, // Ensure cursor field has index
       include: { timeSlot: true, service: true },
     });
     
     const appointments = await query;
     const nextCursor = appointments.length > 0 
       ? appointments[appointments.length - 1].id 
       : null;
     
     return { appointments, nextCursor };
   }
   ```

**Slow Query Monitoring**:
```typescript
// query-monitor.service.ts
@Injectable()
export class QueryMonitorService {
  private readonly logger = new Logger(QueryMonitorService.name);
  private slowQueryThreshold = 100; // 100ms

  async monitorQuery<T>(name: string, queryFn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await queryFn();
      const duration = Date.now() - startTime;
      
      if (duration > this.slowQueryThreshold) {
        this.logger.warn(`Slow query detected: ${name} took ${duration}ms`);
        this.metricsService.recordSlowQuery(name, duration);
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Query failed: ${name} took ${duration}ms`, error);
      throw error;
    }
  }
}
```

### 4.4 Response Compression and Transmission Optimization

**Response Compression Configuration**:
```typescript
// compression.config.ts
import compression from 'compression';
import { Request, Response } from 'express';

export const compressionMiddleware = compression({
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    
    // Only compress specific response types
    const contentType = res.getHeader('Content-Type');
    if (typeof contentType === 'string') {
      return /text|javascript|json|css|xml/i.test(contentType);
    }
    
    return compression.filter(req, res);
  },
  threshold: 1024, // Only compress above 1KB
  level: 6, // Compression level (0-9)
});
```

**JSON Serialization Optimization**:
```typescript
// fast-json-transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { transform, TransformOptions } from 'json-transformer-node';

@Injectable()
export class FastJsonTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => {
        // Remove empty fields to reduce response size
        return this.removeEmptyFields(data);
      }),
    );
  }

  private removeEmptyFields(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.removeEmptyFields(item));
    }
    
    if (obj !== null && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined && value !== '') {
          result[key] = this.removeEmptyFields(value);
        }
      }
      return result;
    }
    
    return obj;
  }
}
```

### 4.5 Async Processing and Queue Optimization

**BullMQ Queue Configuration**:
```typescript
// bullmq.config.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Notification queue
export const notificationQueue = new Queue('notifications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 1000, // Keep most recent 1000 completed jobs
    removeOnFail: 5000, // Keep most recent 5000 failed jobs
  },
});

// Worker process
export const notificationWorker = new Worker('notifications', async job => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'EMAIL':
      await this.emailService.sendAppointmentConfirmation(data);
      break;
    case 'SMS':
      await this.smsService.sendAppointmentReminder(data);
      break;
    case 'PUSH':
      await this.pushService.sendAppointmentNotification(data);
      break;
  }
}, { 
  connection,
  concurrency: 10, // Concurrent processing count
  limiter: {
    max: 100,
    duration: 1000, // Maximum 100 jobs per second
  },
});
```

**Queue Monitoring Dashboard**:
```typescript
// queue-monitor.service.ts
@Injectable()
export class QueueMonitorService {
  constructor(
    private notificationQueue: Queue,
    private queueEvents: QueueEvents,
  ) {
    this.setupMonitoring();
  }

  private setupMonitoring(): void {
    // Monitor queue events
    this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
      this.metricsService.recordQueueJobCompleted('notifications', jobId);
    });
    
    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      this.metricsService.recordQueueJobFailed('notifications', jobId, failedReason);
      this.alertService.sendQueueFailureAlert('notifications', jobId, failedReason);
    });
    
    this.queueEvents.on('stalled', ({ jobId }) => {
      this.logger.warn(`Queue job stalled: notifications/${jobId}`);
      this.metricsService.recordQueueJobStalled('notifications', jobId);
    });
  }

  async getQueueStats(): Promise<any> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.notificationQueue.getWaitingCount(),
      this.notificationQueue.getActiveCount(),
      this.notificationQueue.getCompletedCount(),
      this.notificationQueue.getFailedCount(),
      this.notificationQueue.getDelayedCount(),
    ]);
    
    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 4.6 Performance Monitoring and Alerting

**Performance Metrics Collection**:
```typescript
// performance-metrics.service.ts
@Injectable()
export class PerformanceMetricsService {
  private readonly metrics = new Map<string, number[]>();
  
  recordApiResponseTime(endpoint: string, duration: number): void {
    const key = `api.response_time.${endpoint}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    
    const values = this.metrics.get(key)!;
    values.push(duration);
    
    // Keep most recent 1000 samples
    if (values.length > 1000) {
      values.shift();
    }
    
    // Export to monitoring system
    this.exportToMonitoringSystem(key, this.calculatePercentiles(values));
  }
  
  private calculatePercentiles(values: number[]): any {
    const sorted = [...values].sort((a, b) => a - b);
    
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      max: sorted[sorted.length - 1],
      min: sorted[0],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
    };
  }
  
  private exportToMonitoringSystem(metric: string, data: any): void {
    // Export to Prometheus, DataDog, New Relic, and other monitoring systems
    console.log(`[METRIC] ${metric}:`, data);
  }
}
```

**Performance Alert Rules**:
```yaml
# alert-rules.yaml
api_performance_alerts:
  rules:
    - alert: HighApiResponseTime
      expr: api_response_time_p95{endpoint="POST:/v1/appointments"} > 1000
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "Appointment creation endpoint response time too high"
        description: "POST /v1/appointments P95 response time exceeds 1 second, current value {{ $value }}ms"
        
    - alert: HighErrorRate
      expr: rate(api_errors_total{status=~"5.."}[5m]) > 0.05
      for: 2m
      labels:
        severity: critical
      annotations:
        summary: "API error rate too high"
        description: "API 5xx error rate exceeds 5%, current value {{ $value }}"
        
    - alert: QueueBacklog
      expr: queue_backlog{queue="notifications"} > 1000
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "Notification queue backlog"
        description: "Notification queue backlog exceeds 1000 jobs, current value {{ $value }}"
```

## 5. Version Management and Compatibility Strategy

### 5.1 API Version Management

**Semantic Versioning**:
The system adopts Semantic Versioning (SemVer) specification. The version number format is `MAJOR.MINOR.PATCH`:
- **MAJOR version**: Incompatible API changes
- **MINOR version**: Backward-compatible feature additions
- **PATCH version**: Backward-compatible bug fixes

**Version Release Cycle**:
| Version Type | Release Cycle | Support Period | Upgrade Strategy |
|----------|----------|----------|----------|
| **Major version (v2.0.0)** | 12-18 months | 24 months | Requires migration plan, upgrade guide provided |
| **Minor version (v1.1.0)** | 3-6 months | 12 months | Backward compatible, smooth upgrade |
| **Patch version (v1.0.1)** | On demand | 6 months | Emergency fixes, upgrade ASAP recommended |

**URL Version Strategy**:
- **Path versioning**: `https://api.example.com/v1/{resource}` (recommended)
- **Query parameter versioning**: `https://api.example.com/{resource}?version=1.0` (fallback)
- **Request header versioning**: `Accept: application/vnd.example.v1+json` (advanced scenarios)

### 5.2 Backward Compatibility Guarantee

**Compatibility Change Types**:
| Change Type | Compatibility | Example | Handling Strategy |
|----------|--------|------|----------|
| **Add field** | Backward compatible | DTO adds `preferredLanguage` | New field optional, default value handling |
| **Deprecate field** | Warning compatible | Mark `phoneNumber` as deprecated | Continue supporting, document notice, monitor usage |
| **Change field type** | Incompatible | `age: string` → `age: number` | Handle in new version, conversion layer in old version |
| **Remove endpoint** | Incompatible | Remove `/v1/legacy-endpoint` | Provide migration path, 90-day deprecation period |

**NestJS Version Compatibility Middleware**:
```typescript
// version-compatibility.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class VersionCompatibilityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestedVersion = this.extractVersionFromRequest(req);
    const currentVersion = '1.0.0';
    
    // Set version info in request context
    req['apiVersion'] = requestedVersion;
    req['compatibilityMode'] = this.determineCompatibilityMode(requestedVersion, currentVersion);
    
    // Add version headers to response
    res.setHeader('X-API-Version', currentVersion);
    res.setHeader('X-API-Min-Version', '1.0.0');
    res.setHeader('X-API-Max-Version', '2.0.0');
    
    next();
  }
  
  private extractVersionFromRequest(req: Request): string {
    // 1. Check path version (v1, v2)
    const pathMatch = req.path.match(/^\/(v\d+)\//);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    // 2. Check query parameter version
    if (req.query.version) {
      return req.query.version as string;
    }
    
    // 3. Check Accept header version
    const acceptHeader = req.headers['accept'];
    if (acceptHeader && acceptHeader.includes('vnd.example.')) {
      const versionMatch = acceptHeader.match(/vnd\.example\.(v\d+)/);
      if (versionMatch) {
        return versionMatch[1];
      }
    }
    
    // 4. Default version
    return 'v1';
  }
  
  private determineCompatibilityMode(requestedVersion: string, currentVersion: string): string {
    const requestedMajor = parseInt(requestedVersion.replace('v', '').split('.')[0]);
    const currentMajor = parseInt(currentVersion.split('.')[0]);
    
    if (requestedMajor < currentMajor) {
      return 'deprecated'; // Old version, deprecated
    } else if (requestedMajor > currentMajor) {
      return 'future'; // Future version, not yet supported
    } else {
      return 'compatible'; // Compatible version
    }
  }
}
```

**DTO Version Compatibility Transformation**:
```typescript
// version-transformer.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class VersionTransformerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const requestedVersion = request['apiVersion'];
    const compatibilityMode = request['compatibilityMode'];
    
    return next.handle().pipe(
      map(data => {
        if (!data || compatibilityMode !== 'deprecated') {
          return data;
        }
        
        // Legacy version compatibility transformation
        return this.transformForLegacyVersion(data, requestedVersion);
      }),
    );
  }
  
  private transformForLegacyVersion(data: any, version: string): any {
    if (version === 'v1') {
      // v1 version compatibility transformation
      return this.transformToV1(data);
    }
    
    return data;
  }
  
  private transformToV1(data: any): any {
    // Example: transform new field structure to old field structure
    if (data && data.customerInfo) {
      const { customerInfo, ...rest } = data;
      
      return {
        ...rest,
        customerName: customerInfo?.name,
        customerPhone: customerInfo?.phone,
        customerEmail: customerInfo?.email,
        // Remove fields added in new version
        preferredLanguage: undefined,
        notificationPreferences: undefined,
      };
    }
    
    return data;
  }
}
```

### 5.3 Deprecation Strategy and Migration Path

**Deprecation Process**:
1. **Announcement period (30 days)**: Mark endpoint as `@deprecated` in API documentation, send email notifications
2. **Warning period (60 days)**: Add `Deprecation: true` and `Sunset: <date>` to response headers, log warnings
3. **Restriction period (30 days)**: Limit access rate, return 410 Gone status code
4. **Removal period**: Completely remove endpoint, return 404 Not Found

**Deprecation Response Header Example**:
```
HTTP/1.1 200 OK
Content-Type: application/json
Deprecation: true
Sunset: Mon, 14 Jul 2026 00:00:00 GMT
Link: </v2/appointments>; rel="successor-version"
Warning: 299 - "Deprecated API. Please migrate to v2 by 2026-07-14."
```

**Migration Guide Generation**:
```typescript
// migration-guide.generator.ts
@Injectable()
export class MigrationGuideGenerator {
  generateMigrationGuide(fromVersion: string, toVersion: string): MigrationGuide {
    const breakingChanges = this.detectBreakingChanges(fromVersion, toVersion);
    const deprecatedEndpoints = this.getDeprecatedEndpoints(fromVersion);
    const newFeatures = this.getNewFeatures(fromVersion, toVersion);
    
    return {
      fromVersion,
      toVersion,
      breakingChanges,
      deprecatedEndpoints,
      newFeatures,
      migrationSteps: this.generateMigrationSteps(breakingChanges),
      estimatedEffort: this.estimateMigrationEffort(breakingChanges),
      automatedTools: this.listAutomatedMigrationTools(),
      supportContact: 'api-support@example.com',
      documentationUrl: `https://docs.example.com/migrate/${fromVersion}-to-${toVersion}`,
    };
  }
  
  private detectBreakingChanges(fromVersion: string, toVersion: string): BreakingChange[] {
    // Analyze API differences, detect breaking changes
    return [
      {
        type: 'ENDPOINT_REMOVED',
        endpoint: '/v1/legacy-appointments',
        description: 'Legacy appointment endpoint has been removed',
        impact: 'HIGH',
        migrationPath: 'Use /v2/appointments endpoint instead',
        codeExample: {
          old: 'GET /v1/legacy-appointments',
          new: 'GET /v2/appointments?legacy=true',
        },
      },
      {
        type: 'FIELD_TYPE_CHANGED',
        endpoint: '/v1/appointments/{id}',
        field: 'appointmentDate',
        oldType: 'string',
        newType: 'ISO8601DateTime',
        description: 'Date field format changed',
        impact: 'MEDIUM',
        migrationPath: 'Use ISO 8601 format date strings',
        codeExample: {
          old: '"appointmentDate": "2026-04-15 14:30"',
          new: '"appointmentDate": "2026-04-15T14:30:00.000Z"',
        },
      },
    ];
  }
}
```

### 5.4 Multi-Version Parallel Support

**Version Routing Configuration**:
```typescript
// app.module.ts - multi-version routing configuration
@Module({
  imports: [
    // v1 version module
    V1Module,
    
    // v2 version module
    V2Module,
  ],
  controllers: [
    // Version health check endpoint
    VersionHealthController,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(VersionCompatibilityMiddleware)
      .forRoutes('*');
    
    // Version routing configuration
    consumer
      .apply(RouterModule)
      .forRoutes('*');
  }
}

// Version router module
@Module({})
export class RouterModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((req: Request, res: Response, next: NextFunction) => {
        const version = req['apiVersion'] || 'v1';
        
        // Rewrite route based on version
        if (version === 'v1') {
          req.url = req.url.replace(/^\/v2/, '/v1');
        } else if (version === 'v2') {
          req.url = req.url.replace(/^\/v1/, '/v2');
        }
        
        next();
      })
      .forRoutes('*');
  }
}
```

**Version Health Check**:
```typescript
// version-health.controller.ts
@Controller('version')
export class VersionHealthController {
  @Get('health')
  @ApiOperation({ summary: 'Version health check' })
  @ApiResponse({ status: 200, description: 'Health status of all versions' })
  async getVersionHealth(): Promise<any> {
    const versions = ['v1', 'v2'];
    const healthStatus = await Promise.all(
      versions.map(async version => ({
        version,
        status: await this.checkVersionHealth(version),
        endpoints: await this.getVersionEndpoints(version),
        uptime: await this.getVersionUptime(version),
        lastDeploy: await this.getLastDeployTime(version),
      }))
    );
    
    return {
      timestamp: new Date().toISOString(),
      versions: healthStatus,
      summary: {
        healthy: healthStatus.filter(v => v.status === 'HEALTHY').length,
        total: healthStatus.length,
        deprecated: healthStatus.filter(v => v.version === 'v1').length,
      },
    };
  }
  
  private async checkVersionHealth(version: string): Promise<string> {
    // Check version health status
    try {
      const response = await fetch(`http://localhost:3000/${version}/health`);
      return response.ok ? 'HEALTHY' : 'UNHEALTHY';
    } catch {
      return 'DOWN';
    }
  }
}
```

### 5.5 Client Compatibility Guidance

**Angular Client Version Adaptation**:
```typescript
// api-version.service.ts - Angular version management service
@Injectable({ providedIn: 'root' })
export class ApiVersionService {
  private readonly defaultVersion = 'v2';
  private currentVersion = signal<string>(this.defaultVersion);
  private supportedVersions = signal<string[]>(['v1', 'v2']);
  
  constructor(private http: HttpClient) {
    this.loadVersionFromStorage();
    this.checkServerVersions();
  }
  
  setVersion(version: string): void {
    if (!this.supportedVersions().includes(version)) {
      throw new Error(`Version ${version} is not supported`);
    }
    
    this.currentVersion.set(version);
    localStorage.setItem('api-version', version);
    
    // Send version change event
    this.notifyVersionChange(version);
  }
  
  getCurrentVersion(): string {
    return this.currentVersion();
  }
  
  getSupportedVersions(): string[] {
    return this.supportedVersions();
  }
  
  isDeprecated(version: string): boolean {
    // v1 version is deprecated
    return version === 'v1';
  }
  
  private async checkServerVersions(): Promise<void> {
    try {
      const response = await this.http.get<{ versions: string[] }>('/version/supported').toPromise();
      this.supportedVersions.set(response?.versions || []);
    } catch {
      // Use default version
    }
  }
  
  private loadVersionFromStorage(): void {
    const savedVersion = localStorage.getItem('api-version');
    if (savedVersion && this.supportedVersions().includes(savedVersion)) {
      this.currentVersion.set(savedVersion);
    }
  }
  
  private notifyVersionChange(version: string): void {
    // Notify other parts of the app about version change
    const event = new CustomEvent('api-version-changed', {
      detail: { version },
    });
    window.dispatchEvent(event);
  }
}
```

**Version Switch Interceptor**:
```typescript
// version-interceptor.ts - Angular HTTP interceptor
@Injectable()
export class VersionInterceptor implements HttpInterceptor {
  constructor(private versionService: ApiVersionService) {}
  
  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Get current version
    const version = this.versionService.getCurrentVersion();
    
    // Rewrite URL to add version prefix
    let url = request.url;
    if (!url.startsWith('http') && !url.startsWith('/v')) {
      url = `/${version}${url.startsWith('/') ? '' : '/'}${url}`;
    }
    
    // Add version headers
    const clonedRequest = request.clone({
      url,
      setHeaders: {
        'X-API-Version': version,
        'Accept': `application/vnd.example.${version}+json`,
      },
    });
    
    return next.handle(clonedRequest).pipe(
      catchError(error => {
        if (error.status === 410 || error.headers?.get('Deprecation') === 'true') {
          // Handle deprecated endpoint
          return this.handleDeprecatedApi(error, request, version);
        }
        
        return throwError(() => error);
      }),
    );
  }
  
  private handleDeprecatedApi(
    error: HttpErrorResponse,
    originalRequest: HttpRequest<any>,
    version: string,
  ): Observable<HttpEvent<any>> {
    if (version === 'v1') {
      // Suggest upgrading to v2
      this.showUpgradeNotification();
      
      // Try retrying with v2
      const v2Request = originalRequest.clone({
        url: originalRequest.url.replace('/v1/', '/v2/'),
      });
      
      return next.handle(v2Request);
    }
    
    return throwError(() => error);
  }
  
  private showUpgradeNotification(): void {
    // Show upgrade notification
    const notification = {
      title: 'API Version Upgrade Notice',
      message: 'You are using deprecated v1 API. Please upgrade to v2 as soon as possible for better performance and features.',
      type: 'warning',
      actions: [
        { label: 'Upgrade Now', handler: () => this.versionService.setVersion('v2') },
        { label: 'Learn More', handler: () => window.open('/docs/migration-guide') },
      ],
    };
    
    this.notificationService.show(notification);
  }
}
```

### 5.6 Version Monitoring and Audit

**Version Usage Statistics**:
```typescript
// version-usage-tracker.service.ts
@Injectable()
export class VersionUsageTrackerService {
  private readonly logger = new Logger(VersionUsageTrackerService.name);
  
  trackVersionUsage(request: Request, response: Response): void {
    const version = this.extractVersionFromRequest(request);
    const endpoint = request.path;
    const method = request.method;
    const statusCode = response.statusCode;
    const responseTime = Date.now() - request['startTime'];
    
    const usageRecord = {
      version,
      endpoint,
      method,
      statusCode,
      responseTime,
      timestamp: new Date().toISOString(),
      userId: request.user?.id,
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    };
    
    // Send to monitoring system
    this.metricsService.recordVersionUsage(usageRecord);
    
    // Log to logs
    this.logger.log(`Version usage record: ${JSON.stringify(usageRecord)}`);
    
    // Check version deprecation status
    if (this.isVersionDeprecated(version)) {
      this.logDeprecatedVersionUsage(usageRecord);
    }
  }
  
  private isVersionDeprecated(version: string): boolean {
    // v1 version is deprecated
    return version === 'v1';
  }
  
  private logDeprecatedVersionUsage(record: any): void {
    this.logger.warn(`Deprecated version usage warning: ${record.version} ${record.endpoint}`);
    
    // Send alert
    if (this.shouldSendDeprecationAlert(record)) {
      this.alertService.sendDeprecationAlert({
        version: record.version,
        endpoint: record.endpoint,
        userId: record.userId,
        count: this.getDeprecatedUsageCount(record.userId, record.version),
        lastUsed: new Date().toISOString(),
      });
    }
  }
  
  getVersionUsageReport(): VersionUsageReport {
    return {
      totalRequests: this.getTotalRequestCount(),
      versionDistribution: this.getVersionDistribution(),
      deprecatedUsage: this.getDeprecatedUsage(),
      migrationProgress: this.calculateMigrationProgress(),
      recommendations: this.generateMigrationRecommendations(),
    };
  }
}
```

**Version Deprecation Monitoring Dashboard**:
```typescript
// version-deprecation-dashboard.component.ts - Angular component
@Component({
  selector: 'app-version-deprecation-dashboard',
  templateUrl: './version-deprecation-dashboard.component.html',
  styleUrls: ['./version-deprecation-dashboard.component.css'],
})
export class VersionDeprecationDashboardComponent implements OnInit {
  versionUsageData = signal<any[]>([]);
  migrationProgress = signal<number>(0);
  deprecatedEndpoints = signal<any[]>([]);
  
  constructor(private versionService: VersionUsageService) {}
  
  async ngOnInit(): Promise<void> {
    await this.loadVersionData();
  }
  
  private async loadVersionData(): Promise<void> {
    const report = await this.versionService.getVersionUsageReport();
    
    this.versionUsageData.set(report.versionDistribution);
    this.migrationProgress.set(report.migrationProgress);
    this.deprecatedEndpoints.set(report.deprecatedUsage.endpoints);
  }
  
  getVersionChartData(): any {
    return {
      labels: this.versionUsageData().map(item => item.version),
      datasets: [
        {
          label: 'Request Count',
          data: this.versionUsageData().map(item => item.requestCount),
          backgroundColor: this.versionUsageData().map(item => 
            item.version === 'v1' ? '#ff6b6b' : '#4ecdc4'
          ),
        },
      ],
    };
  }
}
```

## 6. Summary & Implementation Guide

### 6.1 Document Consistency Verification

**Technology Stack Alignment Verification**:
| Verification Item | Tech Stack Recommendation | Data Architecture Design Document | System Architecture Design Document (SAD) | This API Design Specification |
|--------|----------------|------------------|-----------------------|-------------------|
| **Frontend Framework** | Angular v21+ | ✅ | ✅ | ✅ |
| **Backend Framework** | NestJS v11+ | ✅ | ✅ | ✅ |
| **Database** | PostgreSQL 16 | ✅ | ✅ | ✅ |
| **Cache System** | Redis 7.x | ✅ | ✅ | ✅ |
| **Message Queue** | BullMQ | ✅ | ✅ | ✅ |
| **ORM Tool** | Prisma 7.x | ✅ | ✅ | ✅ |
| **State Management** | NgRx Signals | ✅ | ✅ | ✅ |
| **Security Components** | helmet, @nestjs/throttler | ✅ | ✅ | ✅ |

**High-Concurrency Architecture Consistency**:
1. **Atomic Preemption Mechanism**: All four documents include PostgreSQL partial unique index + `slot_sequence` atomic preemption
2. **Redis Soft Rate Limiting**: All four documents include Redis counter pre-interception
3. **Transaction Isolation Level**: All four documents use READ COMMITTED to avoid rollback storms
4. **Hotspot Sharding**: All four documents include `preferredSequence` random hashing

**NFR Constraint Consistency**:
| NFR-ID | Tech Stack Recommendation | Data Architecture Design Document | SAD Document | This API Design Specification |
|--------|----------------|------------------|----------|-------------------|
| **NFR-01** Scheduled Task Mutual Exclusion | ✅ | ✅ | ✅ | ✅ |
| **NFR-02** Booking Concurrency Safety | ✅ | ✅ | ✅ | ✅ |
| **NFR-03** Stateless Service | ✅ | ✅ | ✅ | ✅ |

### 6.2 Implementation Priority Recommendations

**Phase 1 (1-2 weeks) - Core API Implementation**:
1. ✅ Authentication & Authorization APIs (JWT + Passport)
2. ✅ Basic Booking CRUD APIs
3. ✅ Unified Response Format & Error Handling
4. ✅ Basic Rate Limiting Configuration
5. ✅ OpenAPI Documentation Generation

**Phase 2 (2-3 weeks) - High-Concurrency Optimization**:
1. ✅ Atomic Preemption Mechanism Implementation
2. ✅ Redis Soft Rate Limiting Integration
3. ✅ Transaction Isolation Level Configuration
4. ✅ Async Notification Queue (BullMQ)
5. ✅ Database Connection Pool Optimization

**Phase 3 (1-2 weeks) - Advanced Features**:
1. ✅ WebSocket Real-Time Communication
2. ✅ Multi-Level Caching Strategy
3. ✅ Performance Monitoring & Alerting
4. ✅ Version Management Framework
5. ✅ Client Compatibility Adaptation

**Phase 4 (Ongoing) - Optimization & Maintenance**:
1. ✅ Performance Tuning & Load Testing
2. ✅ Security Hardening & Auditing
3. ✅ Documentation Maintenance & Updates
4. ✅ Version Upgrades & Migration
5. ✅ Monitoring & Alerting Enhancement

### 6.3 Quality Assurance Checklist

**API Quality Checklist**:
- [ ] All APIs have complete OpenAPI documentation
- [ ] All DTOs are validated with class-validator
- [ ] All errors follow the unified error response format
- [ ] All sensitive APIs have appropriate rate limiting
- [ ] All database operations have transaction protection
- [ ] All cache operations have invalidation strategies
- [ ] All async tasks have error handling and retry mechanisms
- [ ] All external calls have timeout and circuit breaker protection
- [ ] All logs include necessary tracing information
- [ ] All monitoring metrics are correctly reported

**Performance Checklist**:
- [ ] API response time P95 < 1 second
- [ ] Database query time P95 < 100ms
- [ ] Cache hit rate > 90%
- [ ] Error rate < 1%
- [ ] System availability > 99.9%
- [ ] Concurrency support > 1000 QPS
- [ ] Memory usage < 80%
- [ ] CPU usage < 70%

### 6.4 Risk Assessment & Mitigation

**Technical Risks**:
| Risk Item | Impact | Probability | Mitigation Measures |
|--------|------|------|----------|
| **Database Performance Bottleneck** | High | Medium | Read-write separation, database sharding, query optimization |
| **Redis Single Point of Failure** | High | Low | Redis Cluster, Sentinel mode, data persistence |
| **Message Queue Backlog** | Medium | Medium | Monitoring & alerting, auto-scaling, dead letter queue |
| **API Version Fragmentation** | Medium | High | Strict version management, automated migration tools |
| **Security Vulnerabilities** | High | Low | Regular security scanning, vulnerability patching process, WAF protection |

**Implementation Risks**:
| Risk Item | Impact | Probability | Mitigation Measures |
|--------|------|------|----------|
| **Development Schedule Delays** | Medium | Medium | Agile development, regular reviews, risk buffer |
| **Insufficient Team Skills** | Medium | Low | Training plans, code reviews, external expert support |
| **Third-Party Dependency Issues** | Low | Medium | Multi-version support, alternative solutions, vendor assessment |
| **Data Migration Failure** | High | Low | Incremental migration, rollback plan, thorough testing |

### 6.5 Follow-Up Action Plan

**Short-Term Actions (Within 1 Month)**:
1. Complete core API development and testing
2. Deploy to test environment for integration testing
3. Conduct performance load testing and tuning
4. Finalize monitoring and alerting configuration
5. Train the development team on new API specifications

**Mid-Term Actions (Within 3 Months)**:
1. Canary release to production environment
2. Collect user feedback and optimize
3. Establish API documentation maintenance workflow
4. Implement automated testing pipeline
5. Optimize performance monitoring system

**Long-Term Actions (Within 6 Months)**:
1. Implement complete version management framework
2. Establish API governance workflow
3. Optimize developer experience
4. Expand API ecosystem
5. Establish API marketplace strategy

---

## Document Information

- **Document Version**: 2.6.0
- **Last Updated**: 2026-05-06
- **Author**: System Architecture Analysis Tool
- **Review Status**: Baselined
- **Applicable Scope**: Angular + NestJS Refactored Booking System

### Change Log

| Version | Date | Modified By | Change Description |
|------|------|-------|---------|
| 2.5.0 | 2026-05-06 | @Architect | Removed §2.9 Schedule Management API (SCH-001~003); Staff model removed, no API support |
| 2.4.0 | 2026-05-05 | @Architect | Removed deprecated STAFF-003 (GET /v1/admin/staff/workload) and SVC-006 (GET /v1/admin/dashboard/service-popularity) endpoint definitions (removed in contract.yaml v1.6.3); verified §2.8 has no residual references |
| 2.3.0 | 2026-05-04 | @Architect (Phase 5) | Field naming convention: clarified wire format (snake_case) vs TypeScript DTO (camelCase) conversion mechanism, WebSocket event definitions (slot.booked / appointment.status_changed / notification.new / stats.updated), Admin Dashboard statistics APIs (Phase 3 completed) |
| 2.2.0 | 2026-04-22 | @Architect (P0-001) | Unified response format: `{success, code}` → `{statusCode, message, data/timestamp, requestId}`; updated X-Request-ID specification; added §2.7 RequestId Tracing Specification |
| 2.1.0 | 2026-04-21 | @Architect (TASK-D4) | M-6: Added Auth endpoint definitions (2 registration + 3 login + Token refresh + Logout), including complete DTOs, request/response examples, business flow descriptions |
| 2.0.0 | 2026-04-14 | System Architecture Analysis Tool | Initial baseline version |

---
*This document is the core API design specification for the Angular + NestJS refactored booking system. All API development must strictly follow this specification. If you have questions or need adjustments, please submit a change request and have it reviewed by the Architecture Review Board.*