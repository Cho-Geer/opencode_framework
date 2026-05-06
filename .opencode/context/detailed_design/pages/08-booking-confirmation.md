# 预约-确认提交页（BookingConfirmationPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 预约创建 - 确认提交 |
| **路由路径** | `/booking/confirmation` |
| **布局** | `AppLayoutComponent` |
| **惰性加载** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **组件** | `BookingConfirmationComponent` (`src/app/features/booking/booking-confirmation/booking-confirmation.component.ts`) |
| **设计依据** | 接口规范 2.5.3（乐观 UI）, 测试策略（预约流程 E2E） |

## 用户角色

- CUSTOMER 专属

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard` | 未认证 → `/auth/login?returnUrl=/booking/confirmation` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |
| `canDeactivateBookingGuard` | 未保存变更弹窗确认 |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `BookingStore` | `hasSelection`, `selectedSlot`, `error`, `isLoading`, `selectedServiceId`, `services`, `bookSlot()`, `selectSlot()` |
| `AuthStore` | `user()`, `currentUser` — 获取用户 ID 用于预约提交 |
| `Router` | 预约成功 → `/booking/success`；失败 → `/booking` 重新选择 |

## 本地状态

| 信号/变量 | 类型 | 说明 |
|---|---|---|
| `acceptTerms` | `boolean` | 是否接受服务条款 |
| `selectedService` | `Service \| undefined` (computed) | 从 BookingStore `services` 查询 |
| `selectedServiceName` | `string` (computed) | 服务名称 |
| `serviceDuration` | `number` (computed) | 服务时长（分钟） |
| `servicePrice` | `number` (computed) | 服务价格 |

## API 契约对照

| 方法 | 端点 | 请求 DTO | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `POST` | `/v1/appointments` | Header: `Idempotency-Key: SHA-256(...)`<br>Body: `CreateAppointmentDto` (`timeSlotId`, `serviceId`, `appointmentDate`, `preferredSequence`, `customerInfo?`, `notes?`) | `ReservationResponse` (`{id, userId, serviceId, timeSlotId, appointmentDate, status, slotSequence, createdAt}`) | Bearer | 用户点击「确认预约」 |

## 后端映射

| 控制器 | 文件 |
|---|---|
| `AppointmentsController` | `src/modules/appointments/appointments.controller.ts` — `POST /appointments` (`create()`) |
| `AppointmentsService` | `src/modules/appointments/appointments.service.ts` |

`create()` 实现要点：
- 原子槽位抢占：`Prisma.$transaction` + `ReadCommitted` 隔离
- 乐观锁重试（max 3, base 100ms 指数退避）
- `updateMany` 条件更新 `currentSequence`
- 生成 `appointmentNumber`（`APT-{timestamp}-{random}`）
- 发送确认邮件 + 通知

## 交互流程

1. 从 `/booking/slots` 选择槽位后导航至确认页
2. 展示预约摘要（服务名称、时间、时长、价格）
3. 用户勾选「已阅读并接受服务条款」
4. 点击「确认预约」→ `BookingStore.bookSlot(slotId, userId)`
5. `BookingService.reserveSlot()` 内部：
   - 生成随机 `preferredSequence`（0-99）
   - 生成 `Idempotency-Key`（SHA256）
   - 调用 `POST /v1/appointments`
6. **乐观 UI**：提交时显示不可关闭的「处理中...」模态框
7. **成功** → 导航 `/booking/success`
8. **失败（409 槽位被占）** → 提示「该时间段已被占用，请重新选择」→ 返回 `/booking/slots`

## 前端高并发策略

| 机制 | 实现 |
|---|---|
| `preferredSequence` | `Math.floor(Math.random() * 100)` 0-99 随机散列，用于 PostgreSQL Partial Unique Index 分片 |
| `Idempotency-Key` | SHA-256(serviceId+slotId+userId+preferredSequence+timestamp) — 请求头幂等键，防重复提交（对应 contract.yaml 1.6.8 `headers.Idempotency-Key`） |
| 乐观 UI | 不等待 API 响应即跳转确认，减少用户感知延迟 |

## 数据来源

- contract.yaml 1.6.4（appointments.create）
- SAD 4.4（高并发事务 + 乐观锁）
- 接口设计规范 2.5.3（乐观 UI + preferSeq）
- 数据架构设计文档 2.2（Appointment 实体）, 5.2（Partial Unique Index）
