# NestJS 后端代码规范文档

## 文档信息

| 属性 | 值 |
| :--- | :--- |
| **文档版本** | 1.0.0 |
| **创建日期** | 2026-04-15 |
| **适用项目** | CRM 预约系统重构版 (NestJS v11+) |
| **文档状态** | 已基线化 |
| **关联文档** | 系统架构设计文档（SAD）v2.0、接口设计规范文档 v2.0、数据架构设计文档 v2.0、安全架构设计文档 v2.1、测试策略与计划 v2.0、运维与部署设计文档 v2.0 |
| **存放位置** | `.opencode/context/code_standards/backend-coding-standard.md` |

---

## 1. 核心原则

### 1.1 模块化与关注点分离

每个模块只负责一个业务领域，内部按层次清晰划分。

| 文件类型 | 职责 | 命名规范 | 示例 |
| :--- | :--- | :--- | :--- |
| `*.module.ts` | 模块定义，依赖注入配置 | `kebab-case.module.ts` | `appointments.module.ts` |
| `*.controller.ts` | HTTP 请求处理，路由定义 | `kebab-case.controller.ts` | `slot-preemption.controller.ts` |
| `*.service.ts` | 业务逻辑实现 | `kebab-case.service.ts` | `appointment.service.ts` |
| `*.dto.ts` | 数据传输对象，入参验证 | `kebab-case.dto.ts` | `create-appointment.dto.ts` |
| `*.guard.ts` | 认证/授权守卫 | `kebab-case.guard.ts` | `jwt-auth.guard.ts` |
| `*.interceptor.ts` | 响应拦截器 | `kebab-case.interceptor.ts` | `logging.interceptor.ts` |
| `*.filter.ts` | 异常过滤器 | `kebab-case.filter.ts` | `global-exception.filter.ts` |
| `*.pipe.ts` | 自定义管道 | `kebab-case.pipe.ts` | `validation.pipe.ts` |
| `*.decorator.ts` | 自定义装饰器 | `kebab-case.decorator.ts` | `current-user.decorator.ts` |
| `*.strategy.ts` | Passport 认证策略 | `kebab-case.strategy.ts` | `jwt.strategy.ts` |

### 1.2 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                  装饰器层 (@Public, @Roles, @RateLimit)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  守卫层 (JwtAuthGuard, RolesGuard)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  拦截器层 (Logging, Transform)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  管道层 (ValidationPipe)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  控制器层 (Controller)                        │
│           处理 HTTP 请求，参数验证，响应格式化                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  服务层 (Service)                             │
│              核心业务逻辑，事务管理，领域规则                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  数据访问层 (PrismaService)                   │
│                  Prisma Client，数据库操作                    │
└─────────────────────────────────────────────────────────────┘
```

**层级依赖规则**：
- **Controller** 只能调用 **Service**，不得直接访问数据库。
- **Service** 可以调用 **PrismaService** 和其他 **Service**，负责事务边界。
- **PrismaService** 是唯一与数据库交互的入口。

---

## 2. 项目目录结构

```
booking-backend/
├── src/
│   ├── main.ts                         # 应用入口（Express, Helmet, CORS, Swagger）
│   ├── app.module.ts                   # 根模块（全局守卫/拦截器/过滤器配置）
│   │
│   ├── common/                          # 公共基础设施（全局复用）
│   │   ├── database/                    # 数据库模块（@Global）
│   │   │   ├── database.module.ts
│   │   │   └── prisma.service.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts        # JWT 认证守卫（含 @Public 豁免）
│   │   │   ├── roles.guard.ts           # 角色守卫
│   │   │   └── permissions.guard.ts     # 权限守卫
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts  # 全局异常过滤器（Prisma 错误映射）
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts   # 请求/响应日志
│   │   ├── decorators/
│   │   │   ├── public.decorator.ts      # 跳过 JWT 认证
│   │   │   └── roles.decorator.ts       # 角色标记
│   │   ├── constants/
│   │   │   └── permissions.constants.ts # RBAC 权限常量
│   │   ├── dto/
│   │   │   └── base.dto.ts              # 共享 DTO 基类
│   │   └── utils/
│   │       └── password.util.ts         # bcrypt 密码哈希工具
│   │
│   ├── config/                          # 配置模块
│   │   └── redis.config.ts              # Redis 配置工厂
│   │
│   ├── modules/                         # 业务模块（按领域划分）
│   │   ├── auth/                        # 认证模块
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── login.dto.ts
│   │   │   │   └── token.dto.ts
│   │   │   └── strategies/
│   │   │       └── jwt.strategy.ts
│   │   │
│   │   ├── appointments/                # 预约模块（核心）
│   │   │   ├── appointments.module.ts
│   │   │   ├── appointments.controller.ts
│   │   │   └── appointments.service.ts
│   │   │
│   │   ├── time-slots/                  # 时间槽模块（高并发）
│   │   │   ├── time-slots.module.ts
│   │   │   ├── time-slots.controller.ts
│   │   │   ├── slot-preemption.controller.ts
│   │   │   ├── time-slots.service.ts
│   │   │   └── slot-preemption.service.ts
│   │   │
│   │   ├── users/                       # 用户模块
│   │   ├── services/                    # 服务目录模块
│   │   ├── email/                       # 邮件模块（BullMQ + Nodemailer）
│   │   ├── notifications/               # 通知模块（Socket.io WebSocket）
│   │   ├── cache/                       # 缓存模块（@Global Redis）
│   │   ├── rate-limiter/                # 限流模块（@nestjs/throttler）
│   │   ├── health/                      # 健康检查模块
│   │   ├── stats/                       # 统计分析模块
│   │   └── audit/                       # 审计日志模块
│   │
│   └── types/                           # 全局类型定义
│       ├── express.d.ts
│       └── enums.ts
│
├── prisma/
│   ├── schema.prisma                    # 数据模型定义（11 核心实体）
│   ├── migrations/                      # 版本化迁移文件
│   └── seed.ts                          # 种子数据
│
├── test/
│   ├── e2e/                             # 端到端测试
│   ├── integration/                     # 集成测试（Testcontainers）
│   ├── factories/                       # 测试数据工厂
│   ├── fixtures/                        # 测试固件数据
│   └── setup/                           # 测试环境配置
│
└── docs/
    ├── auth-design.md                   # 认证架构设计
    ├── high-concurrency-design.md       # 高并发设计文档
    └── permission-matrix.json           # RBAC 权限矩阵
```

---

## 3. TypeScript 与命名规范

### 3.1 命名约定

| 类型 | 命名规则 | 示例 |
| :--- | :--- | :--- |
| **文件** | `kebab-case` | `appointment.service.ts` |
| **类** | `PascalCase` | `AppointmentService`, `AuthController` |
| **接口** | **无 `I` 前缀**，`PascalCase` | `Appointment`, `UserSession` |
| **类型别名** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **枚举** | `PascalCase`，成员 `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING }` |
| **常量** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `JWT_EXPIRES_IN` |
| **变量/函数** | `camelCase` | `currentUser`, `findAvailableSlots()` |
| **私有成员** | `private readonly` 修饰符 | `private readonly prisma: PrismaService` |

> **注意**：接口命名与前端规范保持一致，**禁止使用 `I` 前缀**。

### 3.2 类型安全

**强制规则**：禁止使用 `any`。所有函数参数、返回值必须有明确类型。

```typescript
// ❌ 禁止
async create(data: any): Promise<any> { ... }

// ✅ 正确
async create(data: CreateAppointmentDto): Promise<Appointment> { ... }
```

### 3.3 类成员顺序

类成员必须按以下顺序排列：

```typescript
@Injectable()
export class AppointmentService implements OnModuleInit {
  // 1. static readonly 常量
  private static readonly ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'];

  // 2. 依赖注入（constructor）
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  // 3. 公共属性
  public readonly maxCapacity = 10;

  // 4. 私有属性
  private readonly logger = new Logger(AppointmentService.name);

  // 5. 生命周期钩子
  async onModuleInit(): Promise<void> { ... }

  // 6. 公共方法
  async createAppointment(dto: CreateAppointmentDto): Promise<Appointment> { ... }

  // 7. 私有方法
  private generateAppointmentNumber(): string { ... }
}
```

---

## 4. 模块规范

### 4.1 模块定义

每个业务模块必须清晰声明 `imports`、`controllers`、`providers`、`exports`。

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

### 4.2 全局模块（@Global）

以下模块必须标记为 `@Global()`，供全项目注入：

| 全局模块 | 导出内容 | 用途 |
| :--- | :--- | :--- |
| `DatabaseModule` | `PrismaService` | 数据库访问入口 |
| `CacheModule` | `CacheService`, `REDIS_CLIENT_TOKEN` | Redis 缓存入口 |

```typescript
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

### 4.3 模块间依赖

- **禁止**循环依赖。若出现，提取共享逻辑到 `common/`。
- 跨模块调用必须通过 `exports` 导出的 Service。

---

## 5. 控制器规范（Controller）

### 5.1 控制器职责

- 处理 HTTP 请求与响应。
- 参数验证（通过 DTO + ValidationPipe）。
- 调用对应的 Service 方法。
- **不得**包含业务逻辑。

### 5.2 控制器模板

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

@ApiTags('预约管理')
@ApiBearerAuth('JWT-auth')
@Controller('v1/appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ tier: 'strict', key: 'user' })
  @Roles('CUSTOMER')
  @ApiOperation({ summary: '创建预约' })
  @ApiResponse({ status: 201, description: '预约创建成功' })
  @ApiResponse({ status: 409, description: '预约冲突' })
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
  ): Promise<Appointment> {
    return this.appointmentService.create(createAppointmentDto);
  }

  @Get('available')
  @Public()
  @ApiOperation({ summary: '查询可用时间槽' })
  async getAvailableSlots(
    @Query() query: ListSlotsDto,
  ): Promise<TimeSlot[]> {
    return this.appointmentService.getAvailableSlots(query);
  }
}
```

### 5.3 路由规范

| 规则 | 说明 |
| :--- | :--- |
| **全局前缀** | `/v1`（main.ts 配置） |
| **资源路径** | 复数名词：`/v1/appointments`, `/v1/users` |
| **认证要求** | 默认需要 JWT，使用 `@Public()` 标记公开路由 |
| **限流策略** | 认证接口 `tier: 'auth'`，预约接口 `tier: 'strict'`，其余 `tier: 'api'` |
| **Swagger** | 所有端点必须有 `@ApiOperation` 和 `@ApiResponse` |

---

## 6. 服务层规范（Service）

### 6.1 服务职责

- 封装核心业务逻辑。
- 管理事务边界。
- 调用 PrismaService 和其他 Service。
- 处理业务异常。

### 6.2 高并发预约创建（原子化事务）

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
   * 创建预约 - 高并发原子化抢占
   * 依赖 PostgreSQL 部分唯一索引 + slot_sequence 原子递增
   * 隔离级别：READ COMMITTED
   */
  async create(dto: CreateAppointmentDto): Promise<Appointment> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1. 原子递增 timeSlot.currentSequence
        const timeSlot = await tx.timeSlot.update({
          where: { id: dto.timeSlotId },
          data: { currentSequence: { increment: 1 } },
        });

        if (timeSlot.currentSequence > timeSlot.capacity) {
          throw new ConflictException('该时段预约名额已满');
        }

        // 2. 创建预约记录（依赖部分唯一约束防止并发冲突）
        const appointment = await tx.appointment.create({
          data: {
            userId: dto.userId,
            timeSlotId: dto.timeSlotId,
            appointmentDate: timeSlot.slotTime,
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

### 6.3 异常处理

| 异常类型 | 使用场景 | HTTP 状态码 |
| :--- | :--- | :--- |
| `NotFoundException` | 资源不存在 | 404 |
| `ConflictException` | 预约冲突、重复操作 | 409 |
| `BadRequestException` | 参数校验失败（管道未处理的情况） | 400 |
| `UnauthorizedException` | 认证失败 | 401 |
| `ForbiddenException` | 权限不足 | 403 |

### 6.4 事务管理

```typescript
// 标准事务模板
async performTransaction(dto: SomeDto): Promise<SomeEntity> {
  return this.prisma.$transaction(
    async (tx) => {
      // 所有数据库操作在 tx 上执行
      const result1 = await tx.model1.create({ ... });
      const result2 = await tx.model2.update({ ... });
      return result2;
    },
    {
      maxWait: 5000,   // 等待事务开始的最大时间
      timeout: 10000,  // 事务超时时间
    },
  );
}
```

---

## 7. DTO 规范

### 7.1 DTO 定义

```typescript
import { IsString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';

export class CreateAppointmentDto {
  @ApiProperty({ description: '用户 ID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: '时间槽 ID' })
  @IsUUID()
  timeSlotId: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListAppointmentsDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ description: '状态过滤' })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}
```

### 7.2 DTO 规则

- 使用 **class** 而非 interface（运行时保留类型信息供 ValidationPipe 使用）。
- 所有字段必须有 `class-validator` 装饰器。
- 所有字段必须有 `@nestjs/swagger` 装饰器。
- 查询参数使用 `XxxDto` 命名，请求体使用 `CreateXxxDto`/`UpdateXxxDto` 命名。

---

## 8. 认证与授权

### 8.1 JWT 认证流程

1. 用户调用 `POST /v1/auth/login` 或 `POST /v1/auth/register`。
2. AuthService 验证凭证并生成 JWT（Access Token 15 分钟 + Refresh Token 7 天）。
3. JwtStrategy 提取并验证 JWT Payload。
4. JwtAuthGuard 检查 `@Public()` 装饰器并强制执行认证。

### 8.2 RBAC 权限模型

| 角色 | 权限范围 |
| :--- | :--- |
| `SUPER_ADMIN` | 所有操作 |
| `ADMIN` | 管理用户、服务目录、系统设置 |
| `STAFF` | 查看预约、管理服务时间 |
| `CUSTOMER` | 创建/取消自己的预约 |
| `GUEST` | 仅公开查询 |

### 8.3 权限装饰器

```typescript
// 角色装饰器使用
@Roles('ADMIN', 'SUPER_ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
async deleteUser(@Param('id') id: string): Promise<void> { ... }

// 公开路由装饰器
@Public()
async getAvailableSlots(@Query() query: ListSlotsDto): Promise<TimeSlot[]> { ... }
```

---

## 9. 限流规范

### 9.1 多层限流策略

| 层级 | 策略 | 限制 |
| :--- | :--- | :--- |
| 用户+时间槽 | 防止并发抢占 | 1 请求/秒 |
| 用户每日 | 防止恶意刷单 | 20 预约/天 |
| IP 全局 | 防止爬虫/暴力 | 10 请求/分钟 |
| 全局用户 | 系统级保护 | 100 请求/分钟 |

### 9.2 装饰器使用

```typescript
@RateLimit({ tier: 'auth', key: 'ip' })      // 认证接口
@RateLimit({ tier: 'strict', key: 'user' })   // 预约接口
@RateLimit({ tier: 'api', key: 'ip' })        // 普通接口
```

---

## 10. 缓存规范

### 10.1 Redis 缓存策略

| 缓存项 | TTL | 用途 |
| :--- | :--- | :--- |
| `session:{userId}` | 7 天 | JWT 会话缓存（write-through） |
| `slot:availability:{slotId}` | 30 分钟 | 时间槽可用性 |
| `slot:{slotId}:remaining` | 动态 | 预约名额计数器（原子递减） |

### 10.2 缓存使用模式

```typescript
// Cache-Aside 模式
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

## 11. 错误处理

### 11.1 全局异常过滤器

项目使用 `GlobalExceptionFilter` 统一处理异常，映射 Prisma 错误到标准 HTTP 响应。

```typescript
// GlobalExceptionFilter 自动处理以下 Prisma 错误：
// P2002 → 409 Conflict（唯一约束冲突）
// P2025 → 404 Not Found（记录不存在）
// P2003 → 400 Bad Request（外键约束）
```

### 11.2 错误响应格式

```json
{
  "statusCode": 409,
  "message": "该时段预约名额已满",
  "error": "Conflict",
  "timestamp": "2026-04-15T10:30:00.000Z"
}
```

---

## 12. 日志规范

### 12.1 结构化日志

```typescript
// 使用 NestJS Logger 类
private readonly logger = new Logger(AppointmentService.name);

// 日志级别使用
this.logger.log('Appointment created successfully');     // INFO
this.logger.warn('Slot capacity approaching limit');     // WARNING
this.logger.error('Failed to create appointment', err);  // ERROR
this.logger.debug(`Processing slot: ${slotId}`);         // DEBUG
```

### 12.2 日志拦截器

`LoggingInterceptor` 自动记录：
- 请求方法、路径、用户 ID
- 响应状态码、耗时
- 请求/响应体（开发环境）

---

## 13. Swagger/OpenAPI 文档

### 13.1 必备装饰器

| 装饰器 | 用途 |
| :--- | :--- |
| `@ApiTags()` | API 分组 |
| `@ApiBearerAuth()` | JWT 认证标记 |
| `@ApiOperation()` | 端点描述 |
| `@ApiResponse()` | 响应描述（至少 200 + 错误码） |
| `@ApiProperty()` | DTO 字段描述 |

### 13.2 文档访问

- Swagger UI: `/api/docs`
- OpenAPI JSON: `/api-json`

---

## 14. 测试规范

### 14.1 TDD 流程

严格遵循 **RED → GREEN → REFACTOR** 循环：
1. **RED**：先写测试，执行失败
2. **GREEN**：编写最简代码通过测试
3. **REFACTOR**：重构代码，保持测试通过

### 14.2 覆盖率要求

| 类型 | 最低覆盖率 |
| :--- | :--- |
| 行覆盖率 | 70% |
| 分支覆盖率 | 70% |
| 函数覆盖率 | 70% |
| 业务关键路径 | 90%+ |

### 14.3 测试工具

- **单元测试**：Jest + ts-jest
- **集成测试**：Testcontainers（PostgreSQL + Redis）
- **E2E 测试**：Supertest
- **契约测试**：Contract-based testing

### 14.4 测试文件组织

```
test/
├── unit/           # 与服务同目录的单元测试
├── integration/    # 集成测试（真实数据库）
├── e2e/           # 端到端测试（完整请求流）
├── factories/     # 测试数据工厂
├── fixtures/      # 测试固件数据
└── setup/         # 测试环境配置
```

### 14.5 单元测试模板

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

## 15. 安全规范

### 15.1 密码处理

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

### 15.2 安全头部（Helmet）

main.ts 已配置 Helmet，自动添加：
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`

### 15.3 CORS 配置

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
});
```

---

## 16. 核心规范速查

1. **文件分离**：每个 NestJS  artifact 独立文件（controller/service/dto/guard 分离）
2. **模块化**：按业务领域划分模块，禁止循环依赖
3. **命名约定**：接口无 `I` 前缀，文件使用 `kebab-case`
4. **事务管理**：使用 `prisma.$transaction()` 管理事务边界
5. **类型安全**：禁止 `any`，DTO 使用 class + class-validator
6. **认证授权**：JWT + Passport，`@Public()` 跳过认证，`@Roles()` 角色控制
7. **限流策略**：多层限流（用户/时间槽/IP/全局）
8. **错误处理**：统一使用 `GlobalExceptionFilter`，映射 Prisma 错误
9. **日志规范**：使用 NestJS Logger 类，LoggingInterceptor 自动记录请求
10. **Swagger**：所有端点必须有完整 OpenAPI 文档
11. **TDD**：RED → GREEN → REFACTOR，覆盖率 ≥70%
12. **缓存**：Redis Cache-Aside 模式，write-through 会话缓存

---

## 17. 关联文档引用

| 文档 | 用途 |
| :--- | :--- |
| [系统架构设计文档（SAD）v2.0](../requirements/系统架构设计文档（SAD）.md) | 整体架构、高并发设计、模块划分 |
| [接口设计规范文档 v2.0](../requirements/接口设计规范文档.md) | RESTful API 标准、限流策略、错误码 |
| [数据架构设计文档 v2.0](../requirements/数据架构设计文档.md) | 数据模型、索引策略、缓存架构 |
| [安全架构设计文档 v2.1](../requirements/安全架构设计文档.md) | 5 层安全模型、JWT 认证、RBAC |
| [测试策略与计划 v2.0](../requirements/测试策略与计划.md) | TDD 流程、覆盖率要求、测试工具 |
| [运维与部署设计文档 v2.0](../requirements/运维与部署设计文档.md) | Docker 部署、CI/CD、健康检查 |
