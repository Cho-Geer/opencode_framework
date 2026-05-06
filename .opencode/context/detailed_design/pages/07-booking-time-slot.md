# 预约-选择时间页（TimeSlotPickerPage）

> **版本**: 1.0.0-fixed (根据 contract.yaml v1.6.7 交叉引用审计修复)

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 预约创建 - 选择时间槽 |
| **路由路径** | `/booking/slots` |
| **布局** | `AppLayoutComponent` |
| **惰性加载** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **组件** | `TimeSlotPickerComponent` (`src/app/features/booking/time-slot-picker/time-slot-picker.component.ts`) |
| **设计依据** | 接口规范 2.5.3（乐观 UI、前端 preferSeq）, 测试策略（预约流程 E2E）, SAD 4.4（高并发） |

## 用户角色

- CUSTOMER 专属

## 路由参数

| 参数 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `date` | `string` (可选) | Route params | 预选日期，在 `slotResolver` 中用于过滤 |

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard` | 未认证 → `/auth/login?returnUrl=/booking/slots` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |
| `canDeactivateBookingGuard` | 有未保存变更时弹出浏览器确认对话框 |

## 解析器

| 解析器 | 提供数据 | 当前状态 |
|---|---|---|
| `slotResolver` | `slots: TimeSlot[]` | **当前返回静态 Mock 数据**（6 个示例时间段），TODO: 替换为真实 API 调用。读取 `date` route param |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `BookingStore` | `availableSlots`, `isLoading`, `error`, `selectSlot()`, `loadSlots()`, `slots()` |
| `BookingService` | `reserveSlot(slot.id)` — 高并发槽位抢占 |
| `SocketService` | `subscribeToSlotUpdates()` — 实时槽位更新 WebSocket |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `selectedDate` | `Date` | 当前选择的日期 |
| `minDate` | `Date` | 最小可选日期（今天） |

## WebSocket 事件

| 事件 | 类型 | 处理函数 |
|---|---|---|
| `slot.booked` | `SlotBookedEvent` | `handleSlotBooked()` — 当另一个用户预订时间段时，实时更新 BookingStore 中的槽位可用性 |

## API 契约对照

| 方法 | 端点 | 请求参数 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/time-slots/available` | `?service_id*&date*` | `TimeSlot[]` (`{id, startTime, endTime, capacity, bookedCount, available}`) | Bearer | 日期/服务变化时（当前 Mock） |
| `POST` | `/v1/appointments` | `CreateAppointmentDto` (`timeSlotId, serviceId, appointmentDate, preferredSequence, customerInfo?, notes?`) | `ReservationResponse` (`{id, status, slotSequence, createdAt}`) | Bearer | 选择槽位 → 提交预约 |

**注意**：前端 `BookingService.reserveSlot()` 内部通过 `api.createAppointment(dto)` 调用 `POST /v1/appointments`，传递 `preferredSequence` 和 `idempotencyKey`。

## 后端映射（高并发关键）

| 控制器 | 文件 | 功能 |
|---|---|---|
| `TimeSlotsController` | `src/modules/time-slots/time-slots.controller.ts` | `GET /v1/time-slots/available` — 查询可用时间段 |
| `AppointmentsController` | `src/modules/appointments/appointments.controller.ts` | `POST /v1/appointments` — 创建预约（含原子槽位锁定，由 PostgreSQL 部分唯一索引保障） |

### 高并发抢占实现（`AppointmentService.create`）

| 参数 | 值 |
|---|---|
| 冲突检测 | PostgreSQL 部分唯一索引 `appointment_slot_occupied`（WHERE status IN ('PENDING','CONFIRMED','COMPLETED')） |
| 序列分配 | `TimeSlot.currentSequence` 原子递增（`UPDATE ... SET current_sequence = current_sequence + 1 RETURNING current_sequence`） |
| 事务隔离 | `READ COMMITTED`（maxWait: 5s, timeout: 10s） |
| 限流 | Redis 1 请求/秒/用户/时间段 |
| 冲突响应 | Prisma 错误码 `P2002` → HTTP 409 Conflict |
| 前端热分片 | `preferredSequence`（0-99 随机值）分布并发请求至不同 `slot_sequence` 桶 |

**实现**：预约创建直接在 `AppointmentService.create()` 中处理，通过 `prisma.$transaction()` 执行原子操作。无需单独的 `SlotPreemptionService` —— 部分唯一索引在数据库层提供必要的原子性。详细设计参见 `contract.yaml` §4 高并发合约和 SAD §4.4。

## 交互流程

1. 从服务选择页导航至 `/booking/slots`（自动传入 `selectedServiceId`）
2. 默认显示今天日期 → 调用 `slotResolver` 加载槽位（当前 Mock）
3. 日历组件（`p-datepicker`）选择日期 → 重新加载
4. 每个时间段展示：开始时间-结束时间、剩余容量显示
5. 点击可用槽位 → `BookingStore.selectSlot(slot)` → 导航至 `/booking/confirmation`
6. WebSocket `slot.booked` 事件 → 实时更新槽位状态（解决多用户并发）
7. **乐观 UI**：点击槽位 → 立即跳转确认页（不等待 API 确认）

## 数据模型

| 字段 | 类型 | 说明 |
|---|---|---|
| `TimeSlot.id` | `string (UUID)` | 时间槽 ID |
| `TimeSlot.startTime` | `string (ISO datetime)` | 开始时间 |
| `TimeSlot.endTime` | `string (ISO datetime)` | 结束时间 |
| `TimeSlot.capacity` | `number` | 最大并发预约数 |
| `TimeSlot.bookedCount` | `number` | 当前已预约数 |
| `TimeSlot.available` | `boolean` | 是否仍有剩余容量 |

## 数据来源

- contract.yaml 1.6.4（time-slots.available, appointments.create）
- SAD 4.4（高并发事务设计）
- 接口设计规范 2.5.3（乐观 UI、preferredSequence 随机散列）
- 数据架构设计文档 5.2（Partial Unique Index 并发锁定）
