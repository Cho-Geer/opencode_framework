# 测试代码规范（Testing Coding Standard）

## 1. 核心原则

### 1.1 测试的唯一价值在于发现 Bug

**测试不是为了证明代码能工作，而是为了证明代码不会出错。** 任何不能发现潜在缺陷的测试都是在浪费 CI 时间和维护成本。

### 1.2 TDD 强制铁律

所有测试必须遵循 RED → GREEN → REFACTOR 循环：
1. **RED**: 先编写失败的测试用例，定义预期行为
2. **GREEN**: 仅编写最简代码使测试通过
3. **REFACTOR**: 在测试保护下优化代码结构

### 1.3 测试覆盖优先级

| 优先级 | 模块类型 | 覆盖率要求 | 测试策略 |
|--------|---------|-----------|---------|
| P0 | 核心业务逻辑（预约创建、支付、鉴权） | ≥90% | 单元 + 集成 + 变异测试 |
| P1 | 重要服务层（通知、缓存、限流） | ≥80% | 单元 + 集成 |
| P2 | 辅助工具类、DTO 验证 | ≥70% | 单元测试为主 |
| P3 | 配置类、入口文件 | 豁免 | 不纳入覆盖率统计 |

## 2. 测试禁令（AI Redlines）

### 2.1 严禁编写"假性测试"

以下测试模式将被 CI 质量门禁自动拦截并标记为违规：

#### 2.1.1 空断言测试
```typescript
// ❌ 违规：断言了 Nothing
it('should create a booking', async () => {
  await service.create(dto);
  // 没有断言任何结果
});

// ✅ 合规：验证返回结果和数据库状态
it('should create a booking and persist it', async () => {
  const result = await service.create(dto);
  expect(result.id).toBeDefined();
  expect(result.userId).toBe(dto.userId);

  const persisted = await prisma.appointment.findUnique({
    where: { id: result.id },
  });
  expect(persisted).not.toBeNull();
  expect(persisted?.userId).toBe(dto.userId);
});
```

#### 2.1.2 仅测试 Getter/Setter
```typescript
// ❌ 违规：测试无逻辑的属性访问
it('should set and get name', () => {
  const user = new User();
  user.name = 'test';
  expect(user.name).toBe('test');
});

// ✅ 合规：测试业务方法或跳过纯 Getter/Setter
// 纯 Getter/Setter 不纳入测试范围，覆盖率配置中排除
```

#### 2.1.3 过度 Mock 导致无实际验证
```typescript
// ❌ 违规：所有依赖都被 mock，测试无法发现集成问题
jest.spyOn(prisma, 'appointment').mockResolvedValue(mockAppointment);
jest.spyOn(emailService, 'send').mockResolvedValue(undefined);
jest.spyOn(cacheService, 'set').mockResolvedValue(undefined);

const result = await service.create(dto);
expect(result).toEqual(mockAppointment); // 仅验证 mock 返回值

// ✅ 合规：关键路径使用真实依赖，边界使用 mock
// 数据库：使用 Testcontainers（真实 PostgreSQL）
// 外部服务（邮件/SMS）：可 mock，但需验证调用参数
const emailSpy = jest.spyOn(emailService, 'send').mockResolvedValue(undefined);

const result = await service.create(dto);

expect(emailSpy).toHaveBeenCalledWith({
  to: dto.userEmail,
  subject: expect.stringContaining('预约确认'),
  bookingId: expect.any(String),
});
```

#### 2.1.4 Mock 不验证调用
```typescript
// ❌ 违规：创建了 mock 但未验证是否被调用
jest.spyOn(notificationService, 'notify');
await service.processBooking(dto);
// 未验证 notify 是否被调用

// ✅ 合规：验证 mock 调用次数和参数
const notifySpy = jest.spyOn(notificationService, 'notify');
await service.processBooking(dto);

expect(notifySpy).toHaveBeenCalledTimes(1);
expect(notifySpy).toHaveBeenCalledWith({
  userId: dto.userId,
  type: 'booking_confirmed',
  bookingId: expect.any(String),
});
```

#### 2.1.5 测试耦合实现细节
```typescript
// ❌ 违规：测试耦合了内部实现，重构即破坏
it('should call prisma.update before prisma.create', async () => {
  const updateSpy = jest.spyOn(prisma.timeSlot, 'update');
  const createSpy = jest.spyOn(prisma.appointment, 'create');
  await service.create(dto);
  expect(updateSpy).toHaveBeenCalledBefore(createSpy); // 耦合实现顺序
});

// ✅ 合规：测试行为契约，不关心内部顺序
it('should increment slot sequence when creating booking', async () => {
  const slotBefore = await prisma.timeSlot.findUnique({
    where: { id: dto.timeSlotId },
  });

  await service.create(dto);

  const slotAfter = await prisma.timeSlot.findUnique({
    where: { id: dto.timeSlotId },
  });
  expect(slotAfter?.currentSequence).toBe(slotBefore!.currentSequence + 1);
});
```

### 2.2 AI 接受标准（代码生成自检）

生成的测试代码必须通过以下 5 项检查：

| 检查项 | 通过标准 | 验证方法 |
|--------|---------|---------|
| **有效性** | 至少 1 个有意义的断言（非 trivial） | 人工审查 + CI 规则 |
| **完整性** | 覆盖正常路径 + 异常路径 + 边界条件 | 覆盖率报告 |
| **可维护性** | 测试描述清晰，Given-When-Then 结构 | 人工审查 |
| **隔离性** | 测试间无状态依赖，可并行执行 | CI 随机顺序执行 |
| **文档性** | 复杂测试包含注释说明测试意图 | 人工审查 |

## 3. 测试分类与比例（测试金字塔模型）

### 3.1 测试分布（与[测试策略与计划](../requirements/测试策略与计划.md) 一致）

```
        ┌─────────────────┐
        │   端到端测试     │ (10%)
        │   (Playwright)  │
        └─────────────────┘
               │
        ┌─────────────────┐
        │   集成测试       │ (20%)
        │ (Testcontainers)│
        └─────────────────┘
               │
        ┌─────────────────┐
        │   单元测试       │ (70%)
        │     (Jest)      │
        └─────────────────┘
```

**说明**：采用经典测试金字塔模型，单元测试占主导（70%），确保快速反馈和TDD开发效率。集成测试（20%）覆盖模块交互边界，E2E测试（10%）验证完整业务流程。

### 3.2 各层级职责

| 测试类型 | 验证目标 | 执行速度 | 维护成本 | 典型场景 |
|---------|---------|---------|---------|---------|
| **单元测试** | 纯函数、算法、工具类、状态管理 | <100ms | 低 | 价格计算、时间格式化、SignalStore 逻辑 |
| **集成测试** | 模块交互、数据库、缓存、HTTP 调用 | 1-5s | 中 | API 端点、事务边界、Repository 操作 |
| **E2E 测试** | 完整用户流程、跨系统交互 | 10-30s | 高 | 用户注册→登录→预约→取消全流程 |

### 3.3 项目技术栈

| 测试层级 | 后端工具 | 前端工具 |
|---------|---------|---------|
| **单元测试** | Jest + ts-jest | Jest + Angular Testing Library |
| **集成测试** | Jest + Supertest + Testcontainers | 组件集成测试 + HttpTestingController |
| **E2E 测试** | - | Playwright |
| **性能测试** | k6 / Artillery | Lighthouse CI |
| **变异测试** | Stryker Mutator | - |

## 4. 后端测试规范（NestJS）

### 4.1 单元测试

#### 4.1.1 测试范围

**必须编写单元测试的场景**：
- 工具函数（纯函数，无外部依赖）
- 复杂业务逻辑（价格计算、时间槽冲突检测）
- Guards（权限判断逻辑）
- Interceptors（数据转换逻辑）
- Pipes（验证逻辑）

**不需要单元测试的场景**：
- 纯 Getter/Setter（DTO 属性）
- 仅转发调用的薄封装（直接走集成测试）
- 模块配置文件

#### 4.1.2 测试结构（Arrange-Act-Assert）

```typescript
describe('AppointmentService', () => {
  let service: AppointmentService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AppointmentService,
        {
          provide: PrismaService,
          useValue: createMock<PrismaService>(),
        },
      ],
    }).compile();

    service = moduleRef.get(AppointmentService);
    prisma = moduleRef.get(PrismaService);
  });

  it('should throw ConflictException when slot is full', async () => {
    // Arrange
    const dto: CreateAppointmentDto = {
      userId: 'user-1',
      timeSlotId: 'slot-1',
    };

    jest.spyOn(prisma.timeSlot, 'update').mockResolvedValue({
      ...mockTimeSlot,
      currentSequence: 11, // 超过容量
      capacity: 10,
    });

    // Act & Assert
    await expect(service.create(dto)).rejects.toThrow(ConflictException);
    await expect(service.create(dto)).rejects.toThrow('该时段预约名额已满');
  });
});
```

#### 4.1.3 高并发事务测试

```typescript
describe('AppointmentService - High Concurrency', () => {
  it('should handle concurrent booking requests atomically', async () => {
    // Arrange: 创建仅剩 1 个名额的时段
    const timeSlot = await prisma.timeSlot.create({
      data: {
        date: new Date('2026-04-20'),
        startTime: '10:00',
        endTime: '11:00',
        capacity: 1,
        currentSequence: 0,
      },
    });

    // Act: 模拟 2 个并发请求
    const bookingPromises = [
      service.create({ userId: 'user-1', timeSlotId: timeSlot.id }),
      service.create({ userId: 'user-2', timeSlotId: timeSlot.id }),
    ];

    const results = await Promise.allSettled(bookingPromises);

    // Assert: 仅 1 个成功，1 个失败
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    // 验证 slot_sequence 仅增加 1 次
    const updatedSlot = await prisma.timeSlot.findUnique({
      where: { id: timeSlot.id },
    });
    expect(updatedSlot?.currentSequence).toBe(1);
  });
});
```

### 4.2 集成测试（Testcontainers）

#### 4.2.1 测试容器配置

```typescript
// test/setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

let postgresContainer: any;
let redisContainer: any;

beforeAll(async () => {
  // 启动真实 PostgreSQL
  postgresContainer = await new PostgreSqlContainer()
    .withDatabase('booking_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  // 启动真实 Redis
  redisContainer = await new RedisContainer().start();

  // 设置环境变量供 NestJS 应用使用
  process.env.DATABASE_URL = postgresContainer.getConnectionUri();
  process.env.REDIS_URL = redisContainer.getConnectionUrl();
});

afterAll(async () => {
  await postgresContainer?.stop();
  await redisContainer?.stop();
});
```

#### 4.2.2 Controller 集成测试

```typescript
// src/appointment/appointment.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('AppointmentController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);

    // 准备测试用户并获取 token
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ phone: '13800138000', password: 'test123' });

    authToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // 每个测试前清理数据
    await prisma.appointment.deleteMany();
  });

  it('POST /api/appointments - should create appointment and return 201', async () => {
    // Arrange: 创建可用时段
    const timeSlot = await prisma.timeSlot.create({
      data: {
        date: new Date('2026-04-20'),
        startTime: '10:00',
        endTime: '11:00',
        capacity: 5,
        currentSequence: 0,
      },
    });

    // Act
    const response = await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        timeSlotId: timeSlot.id,
        customerName: '张三',
        customerPhone: '13800138001',
      })
      .expect(201);

    // Assert
    expect(response.body).toMatchObject({
      id: expect.any(String),
      userId: expect.any(String),
      timeSlotId: timeSlot.id,
      status: 'confirmed',
    });

    // 验证数据库持久化
    const appointment = await prisma.appointment.findUnique({
      where: { id: response.body.id },
    });
    expect(appointment).not.toBeNull();
  });

  it('POST /api/appointments - should return 409 when slot is full', async () => {
    // Arrange: 创建已满时段
    const timeSlot = await prisma.timeSlot.create({
      data: {
        date: new Date('2026-04-20'),
        startTime: '14:00',
        endTime: '15:00',
        capacity: 1,
        currentSequence: 1, // 已满
      },
    });

    // Act & Assert
    await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        timeSlotId: timeSlot.id,
        customerName: '李四',
        customerPhone: '13800138002',
      })
      .expect(409)
      .expect({
        statusCode: 409,
        message: '该时段预约名额已满',
        error: 'Conflict',
      });
  });
});
```

#### 4.2.3 认证 Guard 测试

```typescript
describe('JwtAuthGuard (e2e)', () => {
  it('should return 401 when no token is provided', async () => {
    await request(app.getHttpServer())
      .get('/api/appointments')
      .expect(401);
  });

  it('should return 401 when token is invalid', async () => {
    await request(app.getHttpServer())
      .get('/api/appointments')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('should return 200 when valid token is provided', async () => {
    await request(app.getHttpServer())
      .get('/api/appointments')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('should allow access to @Public() endpoints without token', async () => {
    await request(app.getHttpServer())
      .get('/auth/login')
      .send({ phone: '13800138000', password: 'test123' })
      .expect(200);
  });
});
```

#### 4.2.4 限流策略测试

```typescript
describe('Rate Limiting (e2e)', () => {
  it('should allow requests within rate limit', async () => {
    // 发送 10 次请求（低于限制）
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ /* ... */ });
    }
    // 应该都成功
  });

  it('should return 429 when exceeding rate limit', async () => {
    // 快速发送 101 次请求（超过 100/min 限制）
    const requests = Array.from({ length: 101 }, () =>
      request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ /* ... */ }),
    );

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);

    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

### 4.3 变异测试（Mutation Testing）

#### 4.3.1 Stryker 配置

```json
// stryker.conf.json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "mutator": {
    "plugins": []
  },
  "testRunner": "jest",
  "coverageAnalysis": "perTest",
  "thresholds": {
    "high": 90,
    "low": 80,
    "break": 80
  },
  "reporters": ["html", "clear-text", "progress"],
  "mutate": [
    "src/appointment/**/*.ts",
    "src/auth/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.e2e-spec.ts",
    "!src/**/*.module.ts"
  ]
}
```

#### 4.3.2 变异测试要求

| 模块 | 变异杀除率要求 | 说明 |
|------|--------------|------|
| 预约核心逻辑 | ≥80% | 必须杀除大部分变异体 |
| 认证/授权 | ≥80% | 安全相关代码高要求 |
| 工具函数 | ≥70% | 纯函数容易测试 |

#### 4.3.3 变异测试执行频率

> **重要说明**：变异测试因需要生成和验证大量变异体，执行时间较长（通常 5-15 分钟），**不作为常规 PR 门禁**。

| 触发场景 | 执行频率 | 阻塞合并 | 说明 |
|---------|---------|---------|------|
| **每日定时任务** | 每天凌晨 | 否（仅报告） | 全量变异测试，生成质量报告 |
| **核心模块 PR** | 按需触发 | 是 | 仅针对 `src/appointment/**` 和 `src/auth/**` |
| **main 分支合并** | 每次合并 | 否（记录趋势） | 跟踪变异杀除率变化趋势 |
| **常规 PR** | 不执行 | - | 避免影响开发效率 |

**CI 配置策略**：
- 常规 PR 仅运行单元测试 + 集成测试（快速反馈）
- 变异测试失败不阻塞合并，但会在 PR 评论中显示质量报告
- 核心模块（预约、支付、鉴权）的 PR 可选择性启用变异测试验证

## 5. 前端测试规范（Angular）

### 5.1 单元测试

#### 5.1.1 测试范围

**必须编写单元测试的场景**：
- 纯函数（格式化、计算、验证）
- SignalStore 状态管理逻辑
- Pipe（数据转换）
- 复杂组件交互（表单验证、动态渲染）

**不需要单元测试的场景**：
- 纯展示组件（无逻辑，仅模板绑定）
- Getter/Setter（无额外逻辑）

#### 5.1.2 Component 测试模式

```typescript
import { render, screen, fireEvent } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { AppointmentFormComponent } from './appointment-form.component';

describe('AppointmentFormComponent', () => {
  it('should render form with all fields', async () => {
    await render(AppointmentFormComponent);

    expect(screen.getByLabelText(/姓名/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/手机号/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/预约时间/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交预约/i })).toBeInTheDocument();
  });

  it('should show validation error when phone is invalid', async () => {
    await render(AppointmentFormComponent);

    const phoneInput = screen.getByLabelText(/手机号/i);
    await userEvent.type(phoneInput, '12345'); // 无效手机号
    await userEvent.tab(); // 触发 blur

    expect(screen.getByText(/手机号格式不正确/i)).toBeInTheDocument();
  });

  it('should emit formSubmitted when form is valid', async () => {
    const onSubmit = jest.fn();
    await render(AppointmentFormComponent, {
      outputs: { formSubmitted: onSubmit },
    });

    await userEvent.type(screen.getByLabelText(/姓名/i), '张三');
    await userEvent.type(screen.getByLabelText(/手机号/i), '13800138000');
    await userEvent.click(screen.getByRole('button', { name: /提交预约/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: '张三',
      phone: '13800138000',
      // ...
    });
  });
});
```

#### 5.1.3 SignalStore 测试

```typescript
import { AppointmentStore } from './appointment.store';

describe('AppointmentStore', () => {
  it('should load appointments and update state', async () => {
    const mockAppointments = [
      { id: '1', customerName: '张三', status: 'confirmed' },
      { id: '2', customerName: '李四', status: 'pending' },
    ];

    const appointmentService = {
      findAll: jest.fn().mockResolvedValue(mockAppointments),
    };

    const store = new AppointmentStore(appointmentService as any);

    expect(store.appointments()).toEqual([]);
    expect(store.loading()).toBe(false);

    await store.loadAppointments();

    expect(appointmentService.findAll).toHaveBeenCalled();
    expect(store.appointments()).toHaveLength(2);
    expect(store.appointments()[0].customerName).toBe('张三');
    expect(store.loading()).toBe(false);
  });

  it('should handle load error gracefully', async () => {
    const appointmentService = {
      findAll: jest.fn().mockRejectedValue(new Error('Network error')),
    };

    const store = new AppointmentStore(appointmentService as any);

    await store.loadAppointments();

    expect(store.error()).toBe('加载预约失败，请稍后重试');
    expect(store.loading()).toBe(false);
  });
});
```

#### 5.1.4 Pipe 测试

```typescript
import { TimeFormatPipe } from './time-format.pipe';

describe('TimeFormatPipe', () => {
  const pipe = new TimeFormatPipe();

  it('should format time to 12-hour format', () => {
    expect(pipe.transform('14:00')).toBe('2:00 PM');
    expect(pipe.transform('00:30')).toBe('12:30 AM');
    expect(pipe.transform('12:00')).toBe('12:00 PM');
  });

  it('should handle invalid time input', () => {
    expect(pipe.transform('invalid')).toBe('invalid');
    expect(pipe.transform('')).toBe('');
  });
});
```

### 5.2 E2E 测试（Playwright）

#### 5.2.1 测试用例结构

```typescript
// tests/e2e/appointment-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Appointment Booking Flow', () => {
  test('should complete full booking flow from login to confirmation', async ({ page }) => {
    // 1. Navigate to login
    await page.goto('/login');

    // 2. Login
    await page.getByLabel('手机号').fill('13800138000');
    await page.getByLabel('密码').fill('test123');
    await page.getByRole('button', { name: '登录' }).click();

    // 3. Verify redirect to dashboard
    await expect(page).toHaveURL('/dashboard');

    // 4. Navigate to booking page
    await page.getByRole('link', { name: '预约服务' }).click();
    await expect(page).toHaveURL('/appointments');

    // 5. Select a time slot
    await page.getByRole('button', { name: /2026-04-20.*10:00/ }).click();

    // 6. Fill form
    await page.getByLabel('姓名').fill('张三');
    await page.getByLabel('手机号').fill('13800138001');

    // 7. Submit
    await page.getByRole('button', { name: '提交预约' }).click();

    // 8. Verify confirmation
    await expect(page.getByText('预约成功')).toBeVisible();
    await expect(page.getByText(/预约编号/i)).toBeVisible();
  });

  test('should show validation errors for invalid form', async ({ page }) => {
    await page.goto('/appointments/new');

    // Try submitting with empty form
    await page.getByRole('button', { name: '提交预约' }).click();

    // Verify validation messages
    await expect(page.getByText('请输入姓名')).toBeVisible();
    await expect(page.getByText('请输入手机号')).toBeVisible();
  });

  // ⚠️ 关键 E2E 用例：验证前后端全链路原子化抢占机制
  // 这是本系统最重要的 E2E 测试，确保高并发场景下不会出现超约
  // 任何对此测试的修改必须经过架构师（@Architect）审查
  test('should prevent double booking same slot [CRITICAL E2E]', async ({ browser }) => {
    // Create two browser contexts for concurrent booking
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Login both users
    await login(page1, 'user1@test.com', 'password');
    await login(page2, 'user2@test.com', 'password');

    // Navigate to same slot
    await page1.goto('/appointments/new');
    await page2.goto('/appointments/new');

    // Select same time slot
    await page1.getByRole('button', { name: /10:00/ }).click();
    await page2.getByRole('button', { name: /10:00/ }).click();

    // Submit both
    await fillAndSubmit(page1, '张三', '13800138001');
    await fillAndSubmit(page2, '李四', '13800138002');

    // One should succeed, one should fail
    const success1 = await page1.getByText('预约成功').isVisible();
    const success2 = await page2.getByText('预约成功').isVisible();

    expect(success1 || success2).toBe(true);
    expect(success1 && success2).toBe(false); // Only one can succeed

    await context1.close();
    await context2.close();
  });
});
```

#### 5.2.2 可访问性测试

```typescript
// tests/e2e/accessibility.spec.ts
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

test.describe('Accessibility', () => {
  test('should meet WCAG 2.1 AA standards', async ({ page }) => {
    await page.goto('/appointments');
    await injectAxe(page);
    const violations = await checkA11y(page);
    expect(violations.length).toBe(0);
  });

  test('should be fully keyboard navigable', async ({ page }) => {
    await page.goto('/appointments');

    // Navigate using Tab key
    await page.keyboard.press('Tab');
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBe('BUTTON');

    // Activate with Enter
    await page.keyboard.press('Enter');
    await expect(page.getByText('预约表单')).toBeVisible();
  });
});
```

## 6. 测试数据管理

### 6.1 测试数据工厂

```typescript
// test/factories/appointment.factory.ts
import { Prisma } from '@prisma/client';

export function createAppointmentFactory(overrides: Partial<Prisma.AppointmentCreateInput> = {}) {
  return {
    userId: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timeSlot: {
      create: {
        date: new Date('2026-04-20'),
        startTime: '10:00',
        endTime: '11:00',
        capacity: 5,
        currentSequence: 0,
      },
    },
    status: 'confirmed',
    customerName: '测试用户',
    customerPhone: '13800138000',
    ...overrides,
  };
}

export function createFullTimeSlot() {
  return {
    date: new Date('2026-04-20'),
    startTime: '14:00',
    endTime: '15:00',
    capacity: 1,
    currentSequence: 1, // 已满
  };
}

export function createAvailableTimeSlot() {
  return {
    date: new Date('2026-04-20'),
    startTime: '10:00',
    endTime: '11:00',
    capacity: 5,
    currentSequence: 0,
  };
}
```

### 6.2 数据清理策略

```typescript
// test/teardown.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function teardown() {
  // 按依赖顺序删除数据（子表先删）
  await prisma.appointment.deleteMany();
  await prisma.timeSlot.deleteMany();
  await prisma.service.deleteMany();
  await prisma.user.deleteMany();

  await prisma.$disconnect();
}
```

### 6.3 数据隔离

```typescript
// 每个测试使用独立数据库 schema
// test/setup.ts
beforeEach(async () => {
  // 使用事务包裹，测试后回滚
  const transaction = await prisma.$transaction(async (tx) => {
    // 测试逻辑
  });

  return async () => {
    // 清理：删除测试创建的所有数据
    await prisma.appointment.deleteMany({
      where: { userId: { startsWith: 'test-' } },
    });
  };
});
```

## 7. 测试覆盖率配置

### 7.1 Jest 覆盖率阈值

```javascript
// jest.config.js
module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',           // 入口文件排除
    '!src/**/*.module.ts',    // 模块配置排除
    '!src/**/*.dto.ts',       // DTO 定义排除
    '!src/**/*.entity.ts',    // 实体定义排除
    '!src/**/*.interface.ts', // 接口定义排除
  ],
  coverageThreshold: {
    global: {
      branches: 70,     // 分支覆盖率 ≥70%
      functions: 70,    // 函数覆盖率 ≥70%
      lines: 70,        // 行覆盖率 ≥70%
      statements: 70,   // 语句覆盖率 ≥70%
    },
    'src/appointment/**': {
      branches: 85,     // 核心业务模块要求更高
      functions: 90,
      lines: 90,
      statements: 90,
    },
    'src/auth/**': {
      branches: 85,     // 安全模块高要求
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
```

### 7.2 覆盖率排除项

以下文件类型**不纳入**覆盖率统计：
- DTO 定义文件（`*.dto.ts`）
- 实体/模型文件（`*.entity.ts`）
- 接口定义（`*.interface.ts`）
- 模块配置（`*.module.ts`）
- 应用入口（`main.ts`）
- 纯常量定义（`*.constants.ts`）

## 8. CI/CD 质量门禁

### 8.1 CI 检查项

| 检查项 | 通过标准 | 执行时机 |
|--------|---------|---------|
| **单元测试** | 100% 通过 | 每次 push/PR |
| **集成测试** | 100% 通过 | 每次 push/PR |
| **覆盖率门禁** | 达到阈值（70%/90%） | 每次 push/PR |
| **变异测试** | 杀除率 ≥80%（核心模块） | 每日定时/PR（可选） |
| **E2E 测试** | 100% 通过 | 每日定时/合并前 |
| **性能测试** | P95 <500ms | 每周定时 |
| **安全扫描** | 0 Critical/High 漏洞 | 每次 push/PR |
| **依赖审计** | 0 已知高危漏洞 | 每次 push/PR |

### 8.2 GitHub Actions 工作流

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v4

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: booking_test
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' || github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e

  mutation-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule' || github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run test:mutation
```

### 8.3 质量门禁拦截规则

```yaml
# 合并前必须满足的条件
merge_requirements:
  - all_unit_tests_pass: true
  - all_integration_tests_pass: true
  - coverage_threshold_met: true
  - no_critical_vulnerabilities: true
  - code_review_approved: true
  - e2e_tests_pass: true  # 仅 main/develop 分支
```

## 9. 测试审查清单

### 9.1 测试代码审查

提交 PR 前，作者必须自检：

- [ ] 每个测试是否有至少 1 个非 trivial 断言？
- [ ] 是否覆盖了正常路径、异常路径、边界条件？
- [ ] 测试描述是否清晰描述了测试意图？
- [ ] 是否使用了 Given-When-Then 结构？
- [ ] 是否避免了过度 mock？
- [ ] Mock 是否验证调用次数和参数？
- [ ] 测试之间是否相互独立（无状态依赖）？
- [ ] 是否排除了纯 Getter/Setter 测试？

### 9.2 AI 生成测试审查

使用 AI 生成测试时，额外检查：

- [ ] AI 生成的断言是否有实际业务意义？
- [ ] 是否覆盖了项目特定场景（高并发预约、事务冲突）？
- [ ] 测试数据是否符合实际业务约束？
- [ ] 是否使用了项目约定的测试框架和工具？
- [ ] 是否引用了正确的 DTO 类型和服务接口？

### 9.3 测试覆盖率审查

- [ ] 核心业务模块覆盖率 ≥90%？
- [ ] 整体覆盖率 ≥70%？
- [ ] 覆盖率报告是否已上传 CI？
- [ ] 未覆盖的代码行是否有合理说明？

## 10. 缺陷管理

### 10.1 缺陷修复流程

1. **复现缺陷**：编写失败的测试用例（RED）
2. **修复缺陷**：编写最简代码使测试通过（GREEN）
3. **验证修复**：确认测试通过，回归测试全量通过
4. **提交修复**：包含缺陷修复代码 + 新增/修改的测试用例

### 10.2 回归测试要求

| 缺陷严重级别 | 回归测试范围 | 修复时限 |
|------------|-------------|---------|
| **致命** | 全量测试 + 性能测试 + 安全测试 | 24 小时内 |
| **严重** | 相关模块全量测试 + 集成测试 | 3 个工作日内 |
| **一般** | 相关模块单元测试 + 集成测试 | 1-2 个迭代 |
| **轻微** | 相关单元测试 | 后续版本 |

### 10.3 缺陷不复发保证

**每个缺陷修复必须附带至少 1 个新测试用例**，确保同类缺陷不再复发。测试用例应：
- 精确复现缺陷场景
- 验证修复后的正确行为
- 覆盖边界条件（如果适用）

## 11. 项目特定测试场景

### 11.1 高并发预约抢占

```typescript
describe('Concurrent Appointment - Slot Preemption', () => {
  it('should ensure atomic slot increment under concurrency', async () => {
    const slot = await prisma.timeSlot.create({
      data: {
        date: new Date('2026-04-20'),
        startTime: '10:00',
        capacity: 3,
        currentSequence: 0,
      },
    });

    // 模拟 10 个并发请求
    const promises = Array.from({ length: 10 }, (_, i) =>
      service.create({
        userId: `user-${i}`,
        timeSlotId: slot.id,
      }),
    );

    const results = await Promise.allSettled(promises);
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    expect(succeeded).toBe(3); // 仅 3 个成功
    expect(failed).toBe(7);    // 7 个失败

    const updatedSlot = await prisma.timeSlot.findUnique({
      where: { id: slot.id },
    });
    expect(updatedSlot?.currentSequence).toBe(3); // 精确增加 3 次
  });
});
```

### 11.2 WebSocket 通知测试

```typescript
describe('WebSocket Notifications', () => {
  it('should emit booking confirmation event to user', async () => {
    const gateway = moduleRef.get(AppointmentGateway);
    const emitSpy = jest.spyOn(gateway.server, 'to').mockReturnValue({
      emit: jest.fn(),
    } as any);

    await service.confirmBooking(bookingId);

    expect(gateway.server.to).toHaveBeenCalledWith(userId);
    expect(gateway.server.to().emit).toHaveBeenCalledWith(
      'booking:confirmed',
      expect.objectContaining({ bookingId, status: 'confirmed' }),
    );
  });
});
```

### 11.3 RBAC 权限测试

```typescript
describe('RBAC Authorization', () => {
  const roles = ['admin', 'staff', 'user'];

  it.each([
    { role: 'admin', endpoint: '/api/users', method: 'DELETE', expected: 200 },
    { role: 'staff', endpoint: '/api/users', method: 'DELETE', expected: 403 },
    { role: 'user', endpoint: '/api/users', method: 'DELETE', expected: 403 },
  ])(
    '$role should get $expected when $method $endpoint',
    async ({ role, endpoint, method, expected }) => {
      const token = generateTokenForRole(role);

      await request(app.getHttpServer())
        [method.toLowerCase()](endpoint)
        .set('Authorization', `Bearer ${token}`)
        .expect(expected);
    },
  );
});
```

## 12. 性能测试

### 12.1 API 响应时间要求

| API 类型 | P50 | P95 | P99 | 测试工具 |
|---------|-----|-----|-----|---------|
| 简单查询 | <50ms | <100ms | <200ms | k6 |
| 复杂查询 | <100ms | <300ms | <500ms | k6 |
| 创建操作 | <100ms | <200ms | <500ms | k6 |
| 批量操作 | <500ms | <1000ms | <2000ms | k6 |

### 12.2 k6 负载测试配置

```javascript
// test/performance/booking-load-test.js
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // 预热
    { duration: '1m', target: 100 },   // 正常负载
    { duration: '30s', target: 150 },  // 峰值负载
    { duration: '30s', target: 0 },    // 冷却
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],
    'http_req_failed': ['rate<0.05'],
    'booking_success_rate': ['rate>0.95'],
  },
};
```

## 13. 相关文档

| 文档 | 说明 |
|------|------|
| [测试策略与计划](../requirements/测试策略与计划.md) | 测试策略总纲 |
| [后端代码规范](./backend-coding-standard.md) | 后端开发规范（测试相关要求） |
| [前端代码规范](./frontend-coding-standard.md) | 前端开发规范（测试相关要求） |
| [系统架构设计文档](../requirements/系统架构设计文档（SAD）.md) | 系统架构设计 |
| [安全架构设计文档](../requirements/安全架构设计文档.md) | 安全测试要求 |

## 14. 测试文档维护

### 14.1 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 | 2026-04-16 | 初始版本，整合测试策略与 AI 测试规范 |

### 14.2 维护团队

- 质量保障团队
- @Tester Agent
- @Guardian Agent（审查合规性）
