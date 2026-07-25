---
trigger: always_on
alwaysApply: true
---

# Framework-Agnostic Common Coding Standard

本文档从项目的前端和后端代码规范中提取所有**框架无关**的通用编码规则，作为全项目统一的基线标准。
框架特定规则请参阅各自的标准文件。

## 关联文档

| 文档 | 用途 |
| :--- | :--- |
| [前端代码规范](frontend-coding-standard.md) | Angular 前端框架特定规范 |
| [后端代码规范](backend-coding-standard.md) | NestJS 后端框架特定规范 |
| [前端代码规范（详细）](../context/code_standards/frontend-coding-standard.md) | 前端完整的上下文规范 |
| [后端代码规范（详细）](../context/code_standards/backend-coding-standard.md) | 后端完整的上下文规范 |

---

## 1. 文件命名约定 (File Naming Conventions)

### 规则

| 类型 | 命名规则 | 示例 |
| :--- | :--- | :--- |
| **文件** | `kebab-case` | `booking-form.component.ts`, `appointment.service.ts` |
| **类** | `PascalCase` | `BookingFormComponent`, `AppointmentService`, `AuthController` |
| **接口** | `PascalCase`，**禁止 `I` 前缀** | `Appointment`, `UserSession`, `LoginResponse` |
| **类型别名** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **枚举** | `PascalCase`，成员 `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING, CONFIRMED }` |
| **常量** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `JWT_EXPIRES_IN` |
| **变量/函数** | `camelCase` | `currentUser`, `findAvailableSlots()` |
| **私有成员** | 前/后端各自约定（前端 `_` 前缀或框架约定，后端 `private readonly`） | `_http` (FE), `private readonly userRepository` (BE) |

### 理由

统一的命名约定降低认知负担，使开发者可以在前后端代码库之间无缝切换。

### 来源

- 前端代码规范 §3.1（`.opencode/context/code_standards/frontend-coding-standard.md`）
- 后端代码规范 §3.1（`.opencode/context/code_standards/backend-coding-standard.md`）

---

## 2. 文件分离原则 (File Separation)

### 规则

每个文件只负责**一个**概念（一个类、一个组件、一个服务、一个 DTO、一个守卫等）。

**禁止**将多个类、组件、或不同职责的逻辑混入同一文件。

### 理由

- 提高代码可读性和可维护性
- 降低合并冲突概率
- 使代码审查更聚焦

### 来源

- 前端代码规范 §1.1 关注点分离（`.opencode/context/code_standards/frontend-coding-standard.md`）
- 后端代码规范 §1.1 模块化与关注点分离（`.opencode/context/code_standards/backend-coding-standard.md`）

---

## 3. 禁止 `any` 类型 (No `any` Type)

### 规则

**强制禁止**使用 TypeScript `any` 类型。

所有函数参数、返回值、变量必须有明确的类型注解。对于确实无法确定类型的情况，使用 `unknown` 并进行类型守卫。

```typescript
// ❌ 禁止
async create(data: any): Promise<any> { ... }
const items: any[] = [];

// ✅ 正确
async create(data: CreateAppointmentDto): Promise<Appointment> { ... }
const items: Appointment[] = [];
```

### 理由

`any` 类型绕过了 TypeScript 的类型检查系统，使类型安全无效化，增加了运行时错误的风险。

### 来源

- 前端代码规范 §3.2 类型安全（`.opencode/context/code_standards/frontend-coding-standard.md`）
- 后端代码规范 §3.2 类型安全（`.opencode/context/code_standards/backend-coding-standard.md`）

---

## 4. 导入顺序约定 (Import Ordering)

### 规则

导入语句必须按以下顺序分组，组间用空行分隔：

1. **外部依赖**（第三方包，如 `express`、`react`、`lodash`、`class-validator`）
2. **内部模块**（项目内 `src/` 下的绝对路径导入，如 `../../common/database/database.service`）
3. **相对导入**（同级或子目录的相对路径，如 `./dto/create-appointment.dto`）

每组内按字母顺序排列。

```typescript
// 1. 外部依赖
import { Router, Request, Response } from 'express';
import { IsString, IsUUID } from 'class-validator';
import { debounce, cloneDeep } from 'lodash';

// 2. 内部模块
import { DatabaseService } from '../../common/database/database.service';
import { EmailService } from '../email/email.service';

// 3. 相对导入
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { Appointment } from './interfaces/appointment.interface';
```

### 理由

统一的导入顺序使依赖关系一目了然，便于快速识别外部依赖和内部模块依赖。

### 来源

- 前端代码规范 §3.3 组件类结构（隐含的导入组织要求）
- 后端代码规范 §3.3 类成员顺序（隐含的导入组织要求）

---

## 5. 错误处理模式 (Error Handling)

### 规则

#### 后端

| 异常类型 | 使用场景 | HTTP 状态码 |
| :--- | :--- | :--- |
| 资源不存在 (404) | 请求的资源未找到 | 404 |
| 业务冲突 (409) | 预约冲突、重复操作 | 409 |
| 参数校验失败 (400) | 请求参数不符合规则 | 400 |
| 认证失败 (401) | 未提供有效身份凭证 | 401 |
| 权限不足 (403) | 身份已验证但权限不够 | 403 |

使用统一的"全局异常处理层"进行错误捕获，并将数据库/ORM 错误映射为上述标准 HTTP 错误响应。

#### 前端

- Store 方法中必须使用 `try-catch` 捕获异步操作错误
- 错误信息必须写入 Store 的 `error` 状态字段
- UI 层通过 `vm.error` 展示用户友好的错误信息

```typescript
// 后端示例
if (timeSlot.currentSequence > timeSlot.capacity) {
  throw new Error('该时段预约名额已满'); // 实际项目中应使用框架对应的业务异常类型
}

// 前端示例 (Store)
async loadAppointments(date: string): Promise<void> {
  patchState(store, { isLoading: true, error: null });
  try {
    const appointments = await bookingService.getByDate(date);
    patchState(store, { appointments, isLoading: false });
  } catch (error) {
    patchState(store, {
      error: error instanceof Error ? error.message : 'Unknown error',
      isLoading: false,
    });
  }
}
```

### 理由

统一的错误处理确保用户获得一致的错误反馈，同时便于运维团队监控和定位问题。

### 来源

- 后端代码规范 §6.3 异常处理、§11 错误处理（`.opencode/context/code_standards/backend-coding-standard.md`）
- 前端代码规范 §6 Store 结构中的错误处理模式（`.opencode/context/code_standards/frontend-coding-standard.md`）

---

## 6. 日志标准 (Logging Standards)

### 规则

所有服务和关键业务逻辑必须包含结构化日志。

#### 后端

使用项目的日志框架（如 NestJS Logger、Winston、Pino 等）：

```typescript
// 选择适合项目技术栈的日志方案，以下为通用日志级别模式
logger.info('Appointment created successfully');     // INFO — 正常业务流程
logger.warn('Slot capacity approaching limit');     // WARNING — 需要关注
logger.error('Failed to create appointment', err);  // ERROR — 需要修复
logger.debug(`Processing slot: ${slotId}`);         // DEBUG — 仅开发环境
```

"请求日志中间件"（或通用的日志拦截机制）应自动记录每个请求的关键信息（方法、路径、用户标识、状态码、耗时）。

#### 前端

- 使用前端框架的控制台方法时应保持克制，优先通过状态管理的 `error` 状态传递错误
- 关键 API 调用失败应在开发环境输出详细错误日志
- 生产环境禁止输出 `console.log`

### 理由

结构化日志是可观测性的基础，便于故障排查、性能分析和安全审计。

### 来源

- 后端代码规范 §12 日志规范（`.opencode/context/code_standards/backend-coding-standard.md`）

---

## 7. TDD 要求 (Test-Driven Development)

### 规则

所有代码实现严格遵循 **RED → GREEN → REFACTOR** 循环：

1. **RED**：先编写测试用例，执行必须**失败**
2. **GREEN**：编写**最简**代码使测试通过
3. **REFACTOR**：在测试全量通过的前提下重构代码

**禁止**编写任何没有对应测试用例的业务实现代码。

### 覆盖率要求

| 类型 | 最低覆盖率 |
| :--- | :--- |
| 行覆盖率 (Lines) | 70% |
| 分支覆盖率 (Branches) | 70% |
| 函数覆盖率 (Functions) | 70% |
| 业务关键路径 (Core Business) | 90%+ |

### 测试文件位置

- 测试文件与源文件同目录，使用 `.spec.ts` 后缀
- 测试报告统一输出到 `.task_temp/{taskId}/test_report.json`，必须包含 `execution_evidence` 字段

### 理由

TDD 确保代码的可测试性，减少回归缺陷，覆盖率要求提供质量基线。

### 来源

- 前端代码规范 §10 测试规范（`.opencode/context/code_standards/frontend-coding-standard.md`）
- 后端代码规范 §14 测试规范（`.opencode/context/code_standards/backend-coding-standard.md`）

---

## 8. 文件长度限制 (Maximum File Length)

### 规则

- 单个文件**不应超过 400 行**（含注释和空行）
- 超过时必须拆分为更小的模块/组件/服务
- 前端模板文件（`.component.html`）**不超过 200 行**
- 超过限制时优先考虑提取子组件或辅助函数

### 理由

长文件难以阅读、理解和维护，增加代码审查负担和合并冲突风险。

### 来源

- 前端代码规范 §4.3 模板尺寸（`.opencode/context/code_standards/frontend-coding-standard.md`）

---

## 9. 注释与文档标准 (Comments & Documentation)

### 规则

#### JSDoc 注释

所有公共方法、类、接口必须有 JSDoc 注释，说明用途、参数和返回值：

```typescript
/**
 * 创建预约 - 高并发原子化抢占
 * 依赖 PostgreSQL 部分唯一索引 + slot_sequence 原子递增
 * @param dto - 创建预约数据传输对象
 * @returns 新创建的预约记录
 * @throws ConflictException - 当预约名额已满时抛出
 */
async create(dto: CreateAppointmentDto): Promise<Appointment> { ... }
```

#### API 文档

- 后端所有端点必须有完整的 API 文档装饰器（如 NestJS/Swagger 的 `@ApiOperation`、`@ApiResponse`，或 OpenAPI 注解）
- 所有 DTO 字段必须有对应的文档描述装饰器

#### 内联注释

- 复杂逻辑必须用行内注释解释**为什么**这么做，而非**做了什么**
- 避免冗余注释（如 `// 创建一个用户` 紧跟在 `createUser()` 之后）

### 理由

良好的文档减少知识孤岛，加速新成员上手，降低长期维护成本。

### 来源

- 后端代码规范 §13 Swagger/OpenAPI 文档（`.opencode/context/code_standards/backend-coding-standard.md`）
- 前端代码规范 §11 DTO 命名对齐中的注释规范（`.opencode/context/code_standards/frontend-coding-standard.md`）

---

## 10. Git 提交消息格式 (Git Commit Message Format)

### 规则

提交消息必须遵循以下格式：

```
<type>[scope]: <description>

[optional body]
```

#### TDD 阶段标签（强制）

根据 TDD 阶段，提交消息必须包含对应的标签：

| TDD 阶段 | 标签 | 示例 |
| :--- | :--- | :--- |
| RED（测试先行） | `[Red] {task_id}` | `test(booking): add appointment creation unit tests [Red] T-014` |
| GREEN（实现通过） | `[Green] {task_id}` | `feat(booking): implement appointment creation [Green] T-014` |
| REFACTOR（重构） | `[Refactor] {task_id}` | `refactor(booking): extract slot preemption logic [Refactor] T-014` |

#### Type 前缀

| Type | 用途 |
| :--- | :--- |
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 代码重构（无功能变更） |
| `test` | 添加或修改测试 |
| `docs` | 文档变更 |
| `style` | 格式调整（不影响逻辑） |
| `chore` | 构建/工具/依赖变更 |

### 理由

标准化的提交消息使 Git 历史可读、可检索，TDD 标签支持自动化质量门禁验证。

### 来源

- 前端代码规范 §10 测试流程（隐含的 TDD 阶段提交要求）
- 后端代码规范 §14.1 TDD 流程（隐含的 TDD 阶段提交要求）

---

## 变更记录

| 日期 | 版本 | 变更内容 | 批准人 |
| :--- | :--- | :--- | :--- |
| 2026-05-18 | 1.0.0 | 初始版本，从前端和后端代码规范中提取框架无关规则 | @Architect |
