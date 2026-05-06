# 预约-成功页（BookingSuccessPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 预约创建 - 成功确认 |
| **路由路径** | `/booking/success` |
| **布局** | `AppLayoutComponent` |
| **惰性加载** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **组件** | `BookingSuccessComponent` (`src/app/features/booking/booking-success/booking-success.component.ts`) |
| **设计依据** | 接口规范 2.5.3（乐观 UI 成功分支） |

## 用户角色

- CUSTOMER 专属

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard` | 未认证 → `/auth/login?returnUrl=/booking/success` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `Router` | 导航至 `/my-bookings`（查看预约列表）或 `/booking`（重新预约） |
| `BookingStore` | `selectedSlot`（显示已选的预约槽位信息） |
| `AuthStore` | `currentUser`（显示用户信息） |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `bookingReference` | `string` | 预约参考号（绑定 `BookingStore.lastAppointment?.appointmentNumber`） |

## API 契约对照

本页为纯展示页面，无 API 调用。

## 交互流程

1. 预约成功提后自动导航至 `/booking/success`
2. 页面展示成功图标 + 祝贺文案
3. 显示预约参考号（`bookingReference`）
4. 显示预约摘要（服务名称、日期时间、用户信息）
5. 提供两个操作按钮：
   - 「查看我的预约」→ 导航至 `/my-bookings`
   - 「继续预约」→ 导航至 `/booking`（重新开始选择服务）

## 数据来源

- contract.yaml 1.6.4（预约创建成功分支）
- 接口设计规范 2.5.3（乐观 UI）
