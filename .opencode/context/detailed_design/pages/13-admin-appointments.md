# 管理员-预约管理页（AdminAppointmentManagementPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 预约管理 |
| **路由路径** | `/admin/appointments` |
| **布局** | `AppLayoutComponent`（Admin 侧边栏） |
| **惰性加载** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **组件** | `AppointmentManagementComponent` (`src/app/features/admin/pages/appointment-management/appointment-management.component.ts`) |
| **设计依据** | contract.yaml `admin.appointments`（list/update/batch-cancel）, SAD 2.3.1（AdminBookingList） |

## 用户角色

- ADMIN, SUPER_ADMIN

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard`（父级） | 未认证 → 重定向 |
| `roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })`（父级） | CUSTOMER 禁止访问 |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `AdminStore` | `vm`, `setLoading()`, `setAppointments()`, `updateAppointmentStatusInList()`, `removeAppointmentsFromList()`, `setError()` |
| `AdminService` | `getAdminAppointments()`, `updateAppointmentStatus()`, `batchCancelAppointments()` |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `viewMode` | `'list' \| 'calendar'` | 视图切换（列表 / 日历） |
| `selectedAppointments` | `string[]` | 批量操作选中 ID 数组 |
| `statusDialogVisible` | `boolean` | 状态更新对话框 |
| `selectedAppointment` | `AdminAppointment \| null` | 当前操作预约 |
| `statusUpdateReason` | `string` | 状态变更原因 |
| `newStatus` | `AppointmentStatus` | 目标状态 |
| `filterStatus` | `string` | 状态筛选 |
| `filterStartDate` | `string` | 起始日期 |
| `filterEndDate` | `string` | 结束日期 |
| `filterSearch` | `string` | 搜索关键词 |
| `todayCount` | `number` (computed) | 今日预约数 |
| `pendingCount` | `number` (computed) | 待确认数 |
| `confirmedCount` | `number` (computed) | 已确认数 |
| `cancelledCount` | `number` (computed) | 已取消数 |
| `calendarEvents` | `CalendarEvent[]` (computed) | 日历视图事件 |
| `calendarWeeks` | `array` (computed) | 日历周数据结构 |

## API 契约对照

| 方法 | 端点 | 请求参数/正文 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/appointments` | `?page&limit&status&startDate&endDate&serviceId&userId` | `PaginatedResponse<AdminAppointmentDto>`（`{id, appointmentNumber, userId, userName, serviceId, serviceName, timeSlotId, appointmentDate, status, createdAt}`） | Bearer ADMIN/SUPER_ADMIN | 页面初始化、筛选、分页 |
| `PUT` | `/v1/admin/appointments/:id/status` | `{status*, reason?}` | `{id, status, updatedAt}` | Bearer ADMIN/SUPER_ADMIN | 单条状态更新 |
| `POST` | `/v1/admin/appointments/batch-cancel` | `{ids*, reason?}` | `{successCount, failedCount, failedIds}` | Bearer ADMIN/SUPER_ADMIN | 批量取消 |

## 后端映射

| 控制器 | 文件 |
|---|---|
| `AdminAppointmentsController` | `src/modules/admin/controllers/admin-appointments.controller.ts` — 路由前缀 `"admin/appointments"` |
| `AdminAppointmentsService` | `src/modules/admin/services/admin-appointments.service.ts` |

**预约状态机**（`VALID_TRANSITIONS`）：
| 当前状态 | 可转换到 |
|---|---|
| `PENDING` | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `COMPLETED`, `CANCELLED` |
| `COMPLETED` | `CANCELLED` |
| `CANCELLED` | （终态） |
| `EXPIRED` | （终态） |

取消操作要求必须填写 `reason`。

## 交互流程

1. 访问 `/admin/appointments`，父级守卫验证
2. `loadAppointments()` → `AdminService.getAdminAppointments(query)` → `AdminStore.setAppointments()`
3. **列表视图**：PrimeNG 表格（分页、排序、列筛选），每行显示：预约号、用户名、服务名、日期时间、状态
4. **日历视图**：以月历形式展示预约，按状态着色
5. 顶部统计卡片：今日预约数、待确认、已确认、已取消（computed 信号）
6. 筛选栏：状态下拉 + 日期范围选择 + 搜索框
7. 单条操作：点击「更新状态」→ `statusDialogVisible = true` → 选择目标状态 + 原因 → 提交 → `AdminStore.updateAppointmentStatusInList()`
8. 批量操作：复选框选中多条 → 点击「批量取消」→ 填写原因 → `batchCancel()` → `AdminStore.removeAppointmentsFromList()`
9. 状态变化后，后端通过 WebSocket `appointment_updated` 事件通知相关用户

## 数据来源

- contract.yaml 1.6.4（admin.appointments CRUD）
- SAD 2.3.1（AdminBookingList）
- 接口设计规范 2.8（管理端预约管理）
- 数据架构设计文档 2.2（Appointment 状态枚举 + AppointmentHistory）
- 接口设计规范 2.6（WebSocket 事件通知）
