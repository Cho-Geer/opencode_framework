# 测试代码规范（Testing Coding Standard）v2.0

> **版本**: 2.0.0
> **生效日期**: 2026-05-14
> **作者**: @Architect
> **审批**: @Arbiter
> **适用范围**: booking_system_refactor (backend + frontend + e2e)
> **上一版本**: v1.0 (2026-04-16)

---

## 目录

1. [核心原则](#1-核心原则)
2. [三层Mock治理策略](#2-三层mock治理策略)
3. [TDD双速策略](#3-tdd双速策略)
4. [测试禁令（AI Redlines）](#4-测试禁令ai-redlines)
5. [测试分类与比例](#5-测试分类与比例)
6. [后端测试规范](#6-后端测试规范nestjs)
7. [前端测试规范](#7-前端测试规范angular)
8. [测试基础设施](#8-测试基础设施)
9. [测试数据管理](#9-测试数据管理)
10. [覆盖率阈值矩阵](#10-覆盖率阈值矩阵)
11. [高级测试策略](#11-高级测试策略)
12. [CI/CD质量门禁](#12-cicd质量门禁)
13. [Pre-Commit钩子](#13-pre-commit钩子)
14. [证据链要求](#14-证据链要求)
15. [测试审查清单](#15-测试审查清单)
16. [缺陷管理](#16-缺陷管理)
17. [架构约束规则](#17-架构约束规则)
18. [ADR：架构决策记录](#18-adr架构决策记录)
19. [相关文档](#19-相关文档)

---

## 1. 核心原则

### 1.1 测试的唯一价值在于发现 Bug

**测试不是为了证明代码能工作，而是为了证明代码不会出错。** 任何不能发现潜在缺陷的测试都是在浪费 CI 时间和维护成本。

### 1.2 TDD 强制铁律

所有测试必须遵循 RED → GREEN → REFACTOR 循环：
1. **RED**: 先编写失败的测试用例，定义预期行为
2. **GREEN**: 仅编写最简代码使测试通过
3. **REFACTOR**: 在测试保护下优化代码结构

### 1.3 Mock最小化原则

**"宁可测试慢一点，也不要测试假一点"**。过度Mock是测试质量的头号杀手。本规范采用三层Mock治理策略（见第2节），严格限制Mock使用范围。

### 1.4 测试覆盖优先级

| 优先级 | 模块类型 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 | 变异杀除率 | 测试策略 |
|--------|---------|:------:|:--------:|:--------:|:--------:|---------|
| P0 | 核心业务逻辑（预约、认证、时段、用户） | ≥95% | ≥90% | ≥95% | ≥85% | 单元 + 集成 + 属性 + 变异 |
| P1 | 重要服务层（通知、缓存、限流、邮件、验证、翻译） | ≥85% | ≥80% | ≥85% | ≥80% | 单元 + 集成 + 契约 |
| P2 | 辅助模块（健康检查、统计、服务管理、留存、加密、公共工具） | ≥75% | ≥70% | ≥75% | — | 单元为主 |
| P3 | 配置类、入口文件、DTO定义 | 豁免 | 豁免 | 豁免 | — | 不纳入覆盖率统计 |

---

## 2. 三层Mock治理策略

### 2.1 策略总览

本策略定义了三层Mock治理规则，由 `contract.yaml` 的 `x-test-mock-policy` 段声明，由 ESLint mock-audit 规则强制执行，由 @Guardian 最终审查。

```
┌──────────────────────────────────────────────────────┐
│                 TIER1: REAL-ONLY                      │
│  PrismaService / RedisService / ConfigService         │
│  → 永不禁用 Testcontainers 真实实例                   │
│  → ESLint 拦截 jest.spyOn 这些服务                   │
├──────────────────────────────────────────────────────┤
│                 TIER2: FAKE-OK                        │
│  JwtService / QueueService / NotificationGateway     │
│  RateLimiterService                                   │
│  → 优先使用 test/fakes/ 实现                          │
│  → Fake 行为真实、状态可观测、无外部依赖               │
├──────────────────────────────────────────────────────┤
│                 TIER3: BOUNDARY-MOCK                  │
│  EmailService / SMSService / PaymentGateway           │
│  → 允许Mock，但必须验证调用参数                        │
│  → 每个Mock必须有 expect().toHaveBeenCalledWith()     │
└──────────────────────────────────────────────────────┘
```

### 2.2 TIER1 — 真实依赖（永不禁用）

以下服务**必须**使用 Testcontainers 真实实例，**严禁** `jest.spyOn` 或 `jest.mock`：

| 服务 | 模块 | 理由 | 测试策略 |
|------|------|------|---------|
| **PrismaService** | `@prisma/client` | Mock隐藏SQL错误、事务Bug、约束违反 | Testcontainers PostgreSQL 16 + schema-per-worker隔离 |
| **RedisService** | `src/modules/cache/` | Mock隐藏缓存穿透、序列化错误、TTL错误 | Testcontainers Redis 7 或 ioredis-mock（本地TDD阶段） |
| **ConfigService** | `@nestjs/config` | Mock隐藏配置错误导致的线上故障 | 真实 ConfigModule + .env.test |

**违规示例**：
```typescript
// ❌ TIER1违规：永远不要在 PrismaService 上使用 jest.spyOn
jest.spyOn(prismaService.appointment, 'findUnique').mockResolvedValue(mockData);
```

### 2.3 TIER2 — Fake优先

以下服务**应**使用 `test/fakes/` 目录中的Fake实现：

| 服务 | Fake实现 | 位置 |
|------|---------|------|
| **JwtService** | LocalJwtSigner（Node.js crypto模块真实签名） | `test/fakes/local-jwt-signer.ts` |
| **QueueService** | FakeMessageQueue（内存事件队列） | `test/fakes/fake-message-queue.ts` |
| **NotificationGateway** | FakeEventBus（内存发布/订阅） | `test/fakes/fake-event-bus.ts` |
| **RateLimiterService** | FakeRateLimiter（内存滑动窗口） | `test/fakes/fake-rate-limiter.ts` |

### 2.4 TIER3 — 边界Mock（必须验证参数）

以下外部系统边界服务可以Mock，但**必须**验证调用参数：

```typescript
// ✅ TIER3合规：Mock但验证了调用参数
const emailSpy = jest.spyOn(emailService, 'send').mockResolvedValue(undefined);
await service.create(dto);
expect(emailSpy).toHaveBeenCalledWith({
  to: dto.customerEmail,
  subject: expect.stringContaining('预约确认'),
  bookingId: expect.any(String),
});
```

---

## 3. TDD双速策略

### 3.1 两层测试执行模式

```
┌─────────────────────────────────────────────────────┐
│            TDD DUAL-SPEED STRATEGY                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  RED/GREEN 阶段 (本地, <5s周期):                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ npm run test -- --watch                       │   │
│  │   → jest.config.unit.js                       │   │
│  │   → RealTestModule.forUnit()                  │   │
│  │   → Fake 模式 (FakePrismaClient + Fakes)      │   │
│  │   → <5s 测试周期                              │   │
│  │   → 编写测试 → RED → 编写代码 → GREEN         │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  REFACTOR 阶段 (CI, 30-60s):                         │
│  ┌──────────────────────────────────────────────┐   │
│  │ npm run test:integration                       │   │
│  │   → jest.config.js (full)                      │   │
│  │   → RealTestModule.forIntegration()            │   │
│  │   → ContainerPool → PostgreSQL 16 + Redis 7    │   │
│  │   → Schema-per-worker 隔离                     │   │
│  │   → 验证无测试交叉污染                          │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 RealTestModule

`RealTestModule` 是测试基础设施基类，自动检测Docker可用性并选择执行模式：

- **Docker可用** → Testcontainers（真实PostgreSQL + Redis）
- **Docker不可用** → Fake服务（内存实现）

```typescript
// 自动检测模式
const module = await RealTestModule.forFeature({
  controllers: [AppointmentController],
  providers: [AppointmentService],
}).compile();

// 强制真实模式（CI使用）
const module = await RealTestModule.forIntegration({ ... }).compile();

// 强制Fake模式（本地RED/GREEN使用）
const module = await RealTestModule.forUnit({ ... }).compile();
```

### 3.3 ContainerPool

`ContainerPool` 是全局单例容器管理器，跨测试文件复用Testcontainers实例：

- **启动一次**：jest globalSetup（per worker）
- **Schema隔离**：每个测试文件独立PostgreSQL schema
- **自动清理**：测试文件结束后DROP SCHEMA CASCADE
- **性能提升**：从每次启动30s → 启动一次2s + schema创建0.5s/文件

---

## 4. 测试禁令（AI Redlines）

### 4.1 严禁编写"假性测试"

以下测试模式将被 CI 质量门禁自动拦截并标记为违规：

#### 4.1.1 空断言测试
```typescript
// ❌ 违规：断言了 Nothing
it('should create a booking', async () => {
  await service.create(dto);
  // 没有断言任何结果
});
```

#### 4.1.2 仅测试 Getter/Setter
```typescript
// ❌ 违规：测试无逻辑的属性访问
it('should set and get name', () => {
  const user = new User();
  user.name = 'test';
  expect(user.name).toBe('test');
});
```

#### 4.1.3 TIER1服务Mock
```typescript
// ❌ 违规：在PrismaService/RedisService/ConfigService上使用 spyOn
jest.spyOn(prismaService.appointment, 'findUnique').mockResolvedValue(mockData);
jest.spyOn(redisService, 'get').mockResolvedValue(cachedData);
```

#### 4.1.4 Mock不验证调用
```typescript
// ❌ 违规：创建了mock但未验证是否被调用（TIER3服务）
jest.spyOn(notificationService, 'notify');
await service.processBooking(dto);
// 未验证 notify 是否被调用
```

#### 4.1.5 测试耦合实现细节
```typescript
// ❌ 违规：测试耦合了内部实现，重构即破坏
it('should call prisma.update before prisma.create', async () => {
  const updateSpy = jest.spyOn(prisma.timeSlot, 'update');
  const createSpy = jest.spyOn(prisma.appointment, 'create');
  await service.create(dto);
  expect(updateSpy).toHaveBeenCalledBefore(createSpy);
});
```

---

## 5. 测试分类与比例

### 5.1 增强测试金字塔

```
              ┌───────────────────┐
              │   视觉回归测试     │ (Playwright screenshots)
              ├───────────────────┤
              │   混沌测试         │ (Toxiproxy, 每周)
              ├───────────────────┤
              │   端到端测试       │ (10%, Playwright 3浏览器)
              ├───────────────────┤
              │   变异测试         │ (核心模块, Stryker)
              ├───────────────────┤
              │   契约测试         │ (从contract.yaml生成)
              ├───────────────────┤
              │   集成测试         │ (20%, Testcontainers)
              ├───────────────────┤
              │   属性测试         │ (fast-check, 核心业务)
              ├───────────────────┤
              │   单元测试         │ (70%, Jest + Fakes)
              └───────────────────┘
```

### 5.2 各层级职责

| 测试类型 | 验证目标 | 执行速度 | 维护成本 | 执行频率 |
|---------|---------|---------|---------|---------|
| **单元测试** | 纯函数、算法、工具类、状态管理 | <100ms | 低 | 每次commit/PR |
| **属性测试** | 数学不变量、业务规则恒成立 | <1s | 低 | 每次PR（P0模块） |
| **集成测试** | 模块交互、数据库、缓存、HTTP | 1-5s | 中 | 每次PR |
| **契约测试** | API契约一致性、自动生成 | 1-3s | 低 | 每次PR |
| **变异测试** | 测试质量（杀除变异体） | 5-15min | 中 | 每次PR（核心模块） |
| **E2E测试** | 完整用户流程 | 10-30s | 高 | 每次PR |
| **视觉回归** | UI像素级变化检测 | 5-10s | 中 | 每次PR |
| **混沌测试** | 基础设施故障恢复 | 1-5min | 高 | 每周 |
| **模糊测试** | 恶意/随机输入处理 | 1-5min | 中 | 每日/PR |

---

## 6. 后端测试规范（NestJS）

### 6.1 单元测试

#### 6.1.1 测试范围

**必须编写单元测试的场景**：
- 工具函数（纯函数，无外部依赖）
- 复杂业务逻辑（价格计算、时间槽冲突检测、超时重叠检测）
- Guards（权限判断逻辑）
- Interceptors（数据转换逻辑）
- Pipes（验证逻辑）

**不需要单元测试的场景**：
- 纯 Getter/Setter（DTO 属性）
- 仅转发调用的薄封装（直接走集成测试）
- 模块配置文件

#### 6.1.2 测试结构（Arrange-Act-Assert + Given-When-Then）

```typescript
describe('AppointmentService', () => {
  describe('create()', () => {
    it('should create appointment and persist to database', async () => {
      // Given: 有效的预约DTO和可用时段
      const dto = createValidAppointmentDto();
      const timeSlot = await prisma.timeSlot.create({ data: createAvailableTimeSlot() });

      // When: 调用创建方法
      const result = await service.create({ ...dto, timeSlotId: timeSlot.id });

      // Then: 预约被创建并持久化
      expect(result.id).toBeDefined();
      expect(result.status).toBe('confirmed');
      const persisted = await prisma.appointment.findUnique({ where: { id: result.id } });
      expect(persisted).not.toBeNull();
      expect(persisted?.userId).toBe(dto.userId);
    });

    it('should throw ConflictException when slot is full', async () => {
      // Given: 已满的时段
      const timeSlot = await prisma.timeSlot.create({
        data: { ...createTimeSlot(), capacity: 1, currentSequence: 1 }
      });

      // When & Then: 创建预约应抛出冲突异常
      await expect(service.create({ ...dto, timeSlotId: timeSlot.id }))
        .rejects.toThrow(ConflictException);
    });
  });
});
```

#### 6.1.3 高并发事务测试

```typescript
describe('Concurrent Booking - Atomicity', () => {
  it('should allow exactly capacity bookings under concurrency', async () => {
    const capacity = 3;
    const timeSlot = await prisma.timeSlot.create({
      data: { ...createTimeSlot(), capacity, currentSequence: 0 }
    });

    // 模拟 10 个并发请求
    const promises = Array.from({ length: 10 }, (_, i) =>
      service.create({ userId: `user-${i}`, timeSlotId: timeSlot.id, serviceId: 'svc-1' })
    );

    const results = await Promise.allSettled(promises);
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    expect(succeeded).toBe(capacity); // 仅 capacity 个成功
    expect(failed).toBe(10 - capacity);

    const updated = await prisma.timeSlot.findUnique({ where: { id: timeSlot.id } });
    expect(updated?.currentSequence).toBe(capacity); // 精确增加 capacity 次
  });
});
```

### 6.2 集成测试（Testcontainers）

#### 6.2.1 Controller 集成测试

```typescript
describe('AppointmentController (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleRef = await RealTestModule.forIntegration({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    authToken = await getTestUserToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/appointments - should return 201 on success', async () => {
    const timeSlot = await createTimeSlotInDb(app);
    const response = await request(app.getHttpServer())
      .post('/v1/appointments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ timeSlotId: timeSlot.id, serviceId: 'svc-1' })
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      status: 'confirmed',
    });
  });
});
```

---

## 7. 前端测试规范（Angular）

### 7.1 单元测试

#### 7.1.1 测试范围

**必须编写单元测试的场景**：
- 纯函数（格式化、计算、验证）
- SignalStore 状态管理逻辑
- Pipe（数据转换）
- 复杂组件交互（表单验证、动态渲染）

**不需要单元测试的场景**：
- 纯展示组件（无逻辑，仅模板绑定）
- Getter/Setter（无额外逻辑）

#### 7.1.2 Component 测试模式

```typescript
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

describe('AppointmentFormComponent', () => {
  it('should show validation error for invalid phone', async () => {
    await render(AppointmentFormComponent);

    const phoneInput = screen.getByLabelText(/手机号/i);
    await userEvent.type(phoneInput, '12345');
    await userEvent.tab();

    expect(screen.getByText(/手机号格式不正确/i)).toBeInTheDocument();
  });

  it('should emit formSubmitted when form is valid', async () => {
    const onSubmit = jest.fn();
    await render(AppointmentFormComponent, {
      componentOutputs: { formSubmitted: { emit: onSubmit } as any },
    });

    await userEvent.type(screen.getByLabelText(/姓名/i), '张三');
    await userEvent.type(screen.getByLabelText(/手机号/i), '13800138000');
    await userEvent.click(screen.getByRole('button', { name: /提交/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: '张三',
      phone: '13800138000',
    }));
  });
});
```

---

## 8. 测试基础设施

### 8.1 RealTestModule

详见第3.2节。位于 `test/setup/real-test-module.ts`。

### 8.2 ContainerPool

详见第3.3节。位于 `test/setup/container-pool.ts`。

### 8.3 Fake服务目录

位置：`test/fakes/`

| 文件 | 说明 |
|------|------|
| `fake-event-bus.ts` | 内存发布/订阅（替代NotificationGateway） |
| `fake-message-queue.ts` | 内存消息队列（替代BullMQ/QueueService） |
| `local-jwt-signer.ts` | Node.js crypto JWT签名（替代JwtService） |
| `fake-rate-limiter.ts` | 内存滑动窗口限流（替代RateLimiterService） |
| `fake-prisma-client.ts` | 内存Prisma兼容客户端（可选，超快速本地TDD） |

每个Fake必须有对应的 `.spec.ts` 自测文件。

### 8.4 测试数据工厂

位置：`test/factories/`

用于快速创建标准测试数据，避免测试代码中重复的数据构造逻辑。

---

## 9. 测试数据管理

### 9.1 数据隔离

每个测试文件使用独立的 PostgreSQL schema（Schema-per-Worker隔离）：
- Schema名格式：`worker_{jestWorkerId}_suite_{hash}`
- 测试文件开始前创建schema并运行迁移
- 测试文件结束后 DROP SCHEMA CASCADE
- 确保零测试交叉污染

### 9.2 数据清理

```typescript
// 按依赖顺序删除（子表先删）
afterEach(async () => {
  await prisma.appointment.deleteMany();
  await prisma.timeSlot.deleteMany();
  await prisma.service.deleteMany();
  await prisma.user.deleteMany();
});
```

---

## 10. 覆盖率阈值矩阵

### 10.1 正式阈值（jest.config.js 强制执行）

| 优先级 | 模块 | 行 | 分支 | 函数 | 语句 | 变异杀除 |
|--------|------|:--:|:--:|:--:|:--:|:------:|
| **全局** | 所有 | 85% | 80% | 85% | 85% | — |
| **P0** | appointments, auth, time-slots, users | 95% | 90% | 95% | 95% | 85% |
| **P1** | notifications, cache, rate-limiter, email, verification, translations | 85% | 80% | 85% | 85% | 80% |
| **P2** | health, stats, services, retention, encryption, common | 75% | 70% | 75% | 75% | — |

### 10.2 覆盖率排除项

以下文件类型**不纳入**覆盖率统计：
- DTO 定义文件（`*.dto.ts`）
- 实体/模型文件（`*.entity.ts`）
- 接口定义（`*.interface.ts`）
- 模块配置（`*.module.ts`）
- 应用入口（`main.ts`）
- 纯常量定义（`*.constants.ts`）

---

## 11. 高级测试策略

### 11.1 属性测试（Property-Based Testing）

使用 `fast-check` 测试数学不变量。适用于：
- 价格计算（交换性、单调性）
- 时间槽重叠检测（对称性、传递性）
- PII加密（往返一致性、幂等性）

```typescript
import fc from 'fast-check';

it('should satisfy round-trip property for encryption', async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (plaintext) => {
      const encrypted = await encryptor.encrypt(plaintext);
      const decrypted = await encryptor.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    })
  );
});
```

### 11.2 契约测试（Contract-Driven Testing）

从 `contract.yaml` 的 `x-test-contract` 段自动生成API测试：
- 正向测试（有效输入 → 预期响应）
- 负向认证测试（无token、错误角色、过期token）
- 负向验证测试（缺少必填字段、无效类型、越界值）
- 限流测试（超出限制 → 429）
- Schema验证（响应体格式匹配契约定义）

### 11.3 模糊测试（Fuzz Testing）

向所有端点发送随机、恶意或畸形输入：
- SQL注入模式 → 预期 400/422
- XSS模式 → 预期 400/422
- 超长字符串 → 预期 400（非500）
- Unicode边界字符 → 预期不崩溃

### 11.4 混沌测试（Chaos Testing）

验证基础设施故障恢复能力（每周执行）：
- PostgreSQL断开 → 503，无数据损坏
- Redis断开 → 优雅降级，回退到DB
- 网络延迟注入 → 超时触发，无挂起连接
- 容器重启 → 自动重连

### 11.5 视觉回归测试（Visual Regression）

Playwright截图像素级对比：
- 关键页面：登录、仪表盘、预约表单、管理面板
- 浏览器：Chromium + Firefox
- 视口：Desktop (1280x720) + Mobile (375x667)

### 11.6 负向测试矩阵

每个端点必须覆盖以下维度：
- 无token（401）、过期token（401）、错误角色（403）、权限不足（403）
- 缺少必填字段（400）、无效类型（400）、越界值（400）
- 超出限流（429）、重复幂等键、并发竞争（409）
- 资源不存在（404）、资源已删除（404/410）

---

## 12. CI/CD质量门禁

### 12.1 七阶段流水线（test-gates.yml）

```
Stage 1 [PARALLEL, ~3min]
├── Unit Tests (Real Deps, Testcontainers)
├── Lint (ESLint)
├── Typecheck (tsc --noEmit)
└── Mock-Audit (ESLint --rule mock-audit)
     │
Stage 2 [PARALLEL, ~5min]
├── Integration Tests (Testcontainers, schema-per-worker)
└── Contract Tests (从contract.yaml生成)
     │
Stage 3 [SERIAL, ~10min]
└── Mutation Tests (核心模块, kill≥85%)
     │
Stage 4 [SERIAL, ~8min]
└── E2E Tests (Playwright 3浏览器)
     │
Stage 5 [SERIAL, ~3min]
└── Visual Regression (Playwright截图对比)
     │
Stage 6 [SERIAL, ~5min]
└── Performance Tests (k6, P95<500ms)
     │
Stage 7 [SERIAL, ~2min]
└── Contract Verification (contract.yaml vs API响应)
     │
     ▼ ALL PASS → MERGE ALLOWED
```

### 12.2 Flaky Test自动检测

- 同一测试在7天内失败 ≥3 次 → 自动隔离（不阻塞合并）
- 自动创建GitHub Issue追踪
- 每周生成Flaky Test报告

### 12.3 合并前必须满足

- [x] 所有单元测试100%通过
- [x] 所有集成测试100%通过（排除隔离测试）
- [x] 覆盖率阈值达标（P0≥95/90/95, Global≥85/80）
- [x] 变异杀除率达标（P0≥85%, P1≥80%）
- [x] E2E测试100%通过（3浏览器）
- [x] 视觉回归无意外差异
- [x] API P95延迟 <500ms
- [x] 契约验证0不匹配
- [x] Mock审计0违规
- [x] 0 Critical/High漏洞

---

## 13. Pre-Commit钩子

`.husky/pre-commit` 在每次提交前运行快速检查（<10s）：

```bash
1. tsc --noEmit           # TypeScript类型检查 (2-5s)
2. keystone:hash:verify   # 契约哈希完整性 (0.5s)
3. eslint mock-audit      # Mock策略强制执行 (1-2s)
4. jest --onlyChanged --bail  # 变更文件测试Fake模式 (2-5s)
```

**全部通过 → 允许提交。任一失败 → 阻止提交。**

---

## 14. 证据链要求

### 14.1 test_report.json Schema

每个任务从Testing→Review状态转换时，`test_report.json` 必须包含：

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
    "total_mocks_used": 3,
    "tier1_violations": 0,
    "tier2_replaced_with_fakes": 2,
    "tier3_args_verified": 3
  },
  "flaky_detection": {
    "total_flaky_tests": 0,
    "quarantined_tests": []
  }
}
```

### 14.2 强制证据字段

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `execution_evidence` | ✅ | 测试进程退出码和输出摘要 |
| `coverage` | ✅ | 覆盖率数据 |
| `mock_audit` | ✅ (v2.0新增) | Mock使用审计 |
| `flaky_detection` | ✅ (v2.0新增) | Flaky test检测结果 |

---

## 15. 测试审查清单

### 15.1 提交PR前自检

- [ ] 每个测试是否有至少 1 个非 trivial 断言？
- [ ] 是否覆盖了正常路径、异常路径、边界条件？
- [ ] 是否遵循了Given-When-Then结构？
- [ ] TIER1服务是否使用了真实依赖？
- [ ] TIER2服务是否使用了Fake（而非Mock）？
- [ ] TIER3 Mock是否验证了调用次数和参数？
- [ ] 测试之间是否相互独立（schema-per-file隔离）？
- [ ] test_report.json是否包含execution_evidence、mock_audit、flaky_detection？

### 15.2 @Guardian审查清单

- [ ] Mock审计0违规（CAT1.1-CAT1.3）
- [ ] machine.json.eslint_state 所有模块 status="clean" 或有效 waiver（CAT1.0）
- [ ] compliance_gate_complete 已调用且 ESLint audit 通过
- [ ] 无跳过测试（CAT1.2）
- [ ] 生产代码无 console.log（CAT2.1）
- [ ] 角色越权记录为 0（CAT4.1）
- [ ] 覆盖率达标（CAT2.1-CAT2.4）
- [ ] TDD完整性（CAT3.1-CAT3.5）
- [ ] test_report.json 包含 eslint_audit 字段
- [ ] 测试基础设施齐全（CAT4.1-CAT4.6）
- [ ] 契约完整性（CAT5.1-CAT5.5）
- [ ] 证据链完整（CAT6.1-CAT6.3）
- [ ] 性能达标（CAT7.1-CAT7.3）
- [ ] 安全合规（CAT8.1-CAT8.3）

### 15.3 阻断规则（CAT 代码索引）

| ID | 规则 | 阻断 |
|:--:|------|:---:|
| CAT1.0 | eslint-disable TIER1 mock 绕过审计未引用有效 waiver | ✅ |
| CAT1.1 | jest.spyOn/mock 在 PrismaService/RedisService/ConfigService | ✅ |
| CAT1.2 | 跳过测试: describe.skip / it.skip / xdescribe / xit | ✅ |
| CAT1.3 | TIER3 Mock 未验证调用参数 | ✅ |
| CAT2.1 | console.log/error/warn in production code | ✅ |
| CAT2.2-2.9 | (保留给未来安全规则) | — |
| CAT3.1 | TIER3 Mock 未验证调用参数 | ✅ |
| CAT3.2 | switch 语句缺少 default 分支 | ⚠️ |
| CAT3.4 | test_report.json 不含 eslint_audit 字段 | ✅ |
| CAT3.5 | machine.json.eslint_state.tier1_violations > 0 | ✅ |
| CAT3.6 | 业务模块缺少集成测试 | ✅ |
| CAT3.7 | machine.json.eslint_state 含 dirty 模块且无有效 waiver | ✅ |
| CAT4.1 | 角色越权: agent_write_scopes 违规 | ✅ |
| CAT6.1 | test_report.json schema 不完整 | ✅ |

---

## 16. 缺陷管理

### 16.1 缺陷修复流程

1. **复现缺陷**：编写失败的测试用例（RED）
2. **修复缺陷**：编写最简代码使测试通过（GREEN）
3. **验证修复**：确认测试通过，回归测试全量通过
4. **提交修复**：包含缺陷修复代码 + 新增/修改的测试用例

### 16.2 缺陷不复发保证

**每个缺陷修复必须附带至少 1 个新测试用例**，确保同类缺陷不再复发。

---

## 17. 架构约束规则

完整约束规则见 `.opencode/context/code_standards/architecture-constraint-rules.md`（由 @Architect 维护）。以下为关键规则摘要：

### 阻断级规则（违反即拒绝PR）

| ID | 规则 |
|----|------|
| CAT1.1 | 禁止jest.spyOn在PrismaService/RedisService/ConfigService |
| CAT1.3 | TIER3 Mock必须验证调用参数 |
| CAT2.1-2.4 | 覆盖率阈值必须达标 |
| CAT3.4 | test_report.json必须含execution_evidence |
| CAT3.5 | mock_audit.tier1_violations必须为0 |
| CAT5.4 | keystone哈希必须匹配 |
| CAT6.1 | test_report.json schema必须完整 |

---

## 18. ADR：架构决策记录

### ADR-001: 采用三层Mock治理策略

**日期**: 2026-05-14
**状态**: 已采纳
**决策**: 采用TIER1(Real-Only) / TIER2(Fake-OK) / TIER3(Boundary-Mock)三层mock治理策略。
**理由**: 过度Mock是测试质量的头号杀手。完全禁止Mock过于激进（邮件/短信/Payment必须Mock）。三层策略在真实性和实用性间取得平衡。
**后果**: 需要在test/fakes/目录维护Fake实现；ESLint需要自定义mock-audit规则；@Guardian需要额外审查项。

### ADR-002: 采用TDD双速策略

**日期**: 2026-05-14
**状态**: 已采纳
**决策**: 本地TDD使用Fake模式（<5s周期），CI验证使用Testcontainers真实模式。
**理由**: 纯Testcontainers启动一次30s，无法支撑TDD的快速反馈循环。纯Fake模式无法验证数据库约束和事务隔离。双速策略兼顾速度和真实性。
**后果**: RealTestModule需要自动检测Docker可用性；ContainerPool需要schema-per-worker隔离；CI需要额外阶段。

### ADR-003: 采用Schema-per-Worker隔离策略

**日期**: 2026-05-14
**状态**: 已采纳
**决策**: 使用PostgreSQL schema隔离（而非database-per-worker或transaction-rollback）。
**理由**: Schema创建/删除比Database快10倍以上；单容器单连接池，运维简单；比transaction rollback更可靠（NestJS异步操作不受事务约束）。
**后果**: Prisma迁移需要在每个schema上运行；需要schema manager管理schema生命周期。

### ADR-004: 采用契约驱动测试生成

**日期**: 2026-05-14
**状态**: 已采纳
**决策**: 从contract.yaml自动生成API测试，而非手工编写。
**理由**: 手工编写的API测试容易与契约脱节；自动生成确保100%端点覆盖；contract.yaml是单一事实来源。
**后果**: contract.yaml需要x-test-contract扩展段；需要维护contract-test-generator工具。

### ADR-005: 七阶段CI门禁流水线

**日期**: 2026-05-14
**状态**: 已采纳
**决策**: 采用7阶段顺序流水线，每阶段有明确的依赖关系和失败处理。
**理由**: 并行运行所有测试虽然快，但浪费资源（E2E在单元测试失败时无意义）。分阶段运行可以在早期快速失败，节省CI资源。
**后果**: 最长流水线时间约36分钟；需要维护复杂的GitHub Actions workflow文件；Flaky test检测需要在Stage1和Stage2失败后运行。

---

## 19. 相关文档

| 文档 | 说明 |
|------|------|
| [contract.yaml](../../booking_system_refactor/contract.yaml) | API契约定义（含x-test-mock-policy, x-test-contract, x-coverage-matrix） |
| [系统架构设计文档](../requirements/系统架构设计文档（SAD）.md) | 系统架构设计 |
| [安全架构设计文档](../requirements/安全架构设计文档.md) | 安全测试要求 |
| [测试策略与计划](../requirements/测试策略与计划.md) | 测试策略总纲 |
| [后端代码规范](./backend-coding-standard.md) | 后端开发规范 |
| [前端代码规范](./frontend-coding-standard.md) | 前端开发规范 |
| [架构约束规则 (TEST-ARCH-V2)](../../.task_temp/TEST-ARCH-V2/architecture-constraint-rules.md) | @Guardian审查规则 |
| [TECH_DEBT_REGISTRY.md](../../booking_system_refactor/TECH_DEBT_REGISTRY.md) | 技术债注册表 |

---

## 版本历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| 2.0 | 2026-05-14 | 全面升级：三层Mock治理策略、TDD双速策略、RealTestModule、ContainerPool、7阶段CI门禁、属性/契约/模糊/混沌/视觉回归测试、证据链增强(Flaky detection + Mock-Audit)、ESLint mock规则、Pre-commit hooks、5项ADR | @Architect |
| 1.0 | 2026-04-16 | 初始版本，整合测试策略与 AI 测试规范 | @Tester Agent |

---

*Architect Design | v2.0.0 | 2026-05-14 | Task: TEST-ARCH-V2*
