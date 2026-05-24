# 我的预约列表页（MyBookingsPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 我的预约列表 |
| **路由路径** | `/my-bookings` |
| **布局** | `AppLayoutComponent` |
| **惰性加载** | `features/my-bookings/my-bookings.routes.ts` → `MY_BOOKINGS_ROUTES` |
| **组件** | `MyBookingsComponent` (`src/app/features/my-bookings/my-bookings.component.ts`) |
| **设计依据** | contract.yaml `appointments.list`, SAD 2.3.1（/appointments 页面） |

## 用户角色

- CUSTOMER 专属

## 路由参数

- 无路由参数
- 无查询参数（API 查询参数通过本地信号传递，非路由绑定）

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard` | 未认证 → `/auth/login?returnUrl=/my-bookings` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `ApiService` | `getMyAppointments()`, `cancelBooking()` |
| `AuthStore` | `isLoading`（加载状态） |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `appointments` | `AppointmentListItem[]` | 预约列表数据 |
| `activeFilter` | `'all' \| 'PENDING' \| 'CONFIRMED' \| 'COMPLETED' \| 'EXPIRED' \| 'CANCELLED'` | 状态筛选 |
| `isLoading` | `boolean` | 加载状态 |
| `loadError` | `string \| null` | 加载错误信息 |
| `pullToRefreshState` | `'idle' \| 'pulling' \| 'refreshing'` | 下拉刷新状态 |
| `pullProgress` | `number` | 触摸偏移量(px) |
| `showCancelDialog` | `boolean` | 取消确认对话框 |
| `cancellingId` | `string \| null` | 正在取消的预约 ID |
| `isCancelling` | `boolean` | 取消操作中状态 |

## API 契约对照

| 方法 | 端点 | 请求参数 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/appointments` | `?startDate&endDate&status` | `PaginatedResponse<BookingListItem>` 每项：`{id, appointmentNumber, timeSlotId, appointmentDate, status, serviceName, timeSlotStart, timeSlotEnd, durationMinutes, price, taxRate, taxIncludedAmount}` | Bearer | 页面初始化、筛选切换、下拉刷新 |
| `POST` | `/v1/appointments/:id/cancel` | path: `id` | `void` | Bearer | 取消预约确认 |

**注意**：前端 `ApiService.cancelBooking(id)` 使用 `POST` 方法，对应后端路径 `POST /appointments/:id/cancel`（`AppointmentsController.cancel()`）。CUSTOMER 取消预约使用此端点，无需 ADMIN 角色。

**实际调用后端**：

| 控制器 | 端点 | 方法 |
|---|---|---|
| `AppointmentsController` | `GET /appointments` (通过 `getMyAppointments()` 委托给 `findAll` 加 user 过滤) | `findAll()` |
| `AppointmentsController` | `POST /appointments/:id/cancel` | `cancel()` |

## 后端映射

| 文件 | 说明 |
|---|---|
| `src/modules/appointments/appointments.controller.ts` | 路由前缀 `"appointments"`, `JwtAuthGuard` 类级别 |
| `src/modules/appointments/appointments.service.ts` | `findAll()` 分页 + 用户过滤, `cancel()` 状态校验 + 事务更新 |

后端 `cancel()` 实现：
- 预约状态机检查：`PENDING/CONFIRMED` 可取消
- Prisma 事务更新 `Appointment` + 创建 `AppointmentHistory`
- 队列发送取消邮件 + 通知

## 交互流程

1. 访问 `/my-bookings`，守卫检查认证 + 角色
2. `ngOnInit()` → 调用 `api.getMyAppointments()` 加载列表
3. 默认显示全部（`activeFilter = 'all'`）
4. 筛选栏（6 个）：全部 / 待确认 / 已确认 / 已完成 / 已过期 / 已取消
5. 点击筛选 → `activeFilter` 变化 → `triggerRefresh()` → 重新加载
6. 点击「取消预约」→ `showCancelDialog = true` → 确认 → `confirmCancel()` → `api.cancelBooking(id)`
7. 下拉刷新（`@HostListener touchstart/touchmove/touchend`）：
   - 触摸偏移达阈值 → 刷新状态 → 重新加载列表
8. 列表项包含：服务名称、预约日期、时间段、状态标签

## 数据来源

- contract.yaml 1.7.2（appointments.list）
- SAD 2.3.1
- 数据架构设计文档 2.2（Appointment 实体）
- 接口设计规范 2.5.3（乐观 UI 设计原则）
