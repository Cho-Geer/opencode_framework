# 管理员仪表盘（AdminDashboardPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 管理员仪表盘 |
| **路由路径** | `/admin/dashboard`（`/admin` 重定向至此） |
| **布局** | `AppLayoutComponent`（Admin 侧边栏） |
| **惰性加载** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **组件** | `DashboardComponent` (`src/app/features/admin/pages/dashboard/dashboard.component.ts`) |
| **设计依据** | contract.yaml `admin.stats` (DASH-001~004, REC-001~003), SAD 2.2.1（StatsModule）, 接口规范 2.8 |

## 用户角色

- ADMIN, SUPER_ADMIN

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard`（父级） | 未认证 → 重定向 |
| `roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })`（父级） | CUSTOMER 禁止访问 → 重定向 |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `AdminStore` | `vm` (computed view model), `setLoading()`, `setStats()`, `setError()`, `setRecentUsers()`, `setRecentServices()` |
| `AdminService` | `getStats()`, `getUsers()`, `getAdminServices()` |

## 本地计算属性

| 信号 | 类型 | 说明 |
|---|---|---|
| `vm()` | `AdminViewModel` (computed) | 包含 `stats`, `isLoading`, `error` |
| `timeRange` | `Signal<TimeRange>` | 当前选中的时间范围（默认 'last30d'） |
| `recentUsers` | `Signal<AdminUser[]>` | 从 store 获取的最近 5 个用户 |
| `recentServices` | `Signal<AdminServiceItem[]>` | 从 store 获取的最近 5 个服务 |
| `recentUserRows` | `computed` | 将 recentUsers 映射为表格行数据（含 BadgeStatus） |
| `recentServiceRows` | `computed` | 将 recentServices 映射为表格行数据（含 BadgeStatus） |

## 组件方法

| 方法 | 返回类型 | 说明 |
|---|---|---|
| `onTimeRangeChange(timeRange: TimeRange)` | `void` | 处理时间范围变更，调用 `store.loadStats(timeRange)` |
| `loadRecentUsers()` | `void` | 调用 `AdminService.getUsers({ limit: 5 })` → `AdminStore.setRecentUsers()` |
| `loadRecentServices()` | `void` | 调用 `AdminService.getAdminServices({ limit: 5 })` → `AdminStore.setRecentServices()` |

## API 契约对照

> **响应信封**：所有成功的 API 响应由 ResponseInterceptor 包装为统一信封格式 `{ statusCode, message, data, timestamp, requestId }`。下表中"响应"列仅描述 `data` 字段内部结构，信封外层隐式适用。

| 方法 | 端点 | 请求参数 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/stats` | `?timeRange&startDate&endDate`（由 Booking Distribution Panel 的 Time 按钮下拉菜单驱动） | `AdminStatsDto`（见下方） | Bearer ADMIN/SUPER_ADMIN | `ngOnInit()` 的 `loadStats()` |

**`AdminStatsDto`** 完整结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| `totalBookings` | `StatCard` | 总预约数（`{value, changePercentage, isPositive, target, progressPercentage}`） |
| `todayBookings` | `StatCard` | 今日预约数 |
| `pendingBookings` | `StatCard` | 待确认预约数 |
| `activeUsers` | `StatCard` | 活跃用户数 |
| `totalRevenue` | `StatCard` | 总收入 |
| `bookingTrend` | `{date: string, count: number, revenue: number}[]` | 预约趋势图表数据 |
| `servicePopularity` | `{serviceName, count, percentage}[]` | 服务热度分布 |
| `time_distribution` | `{hour: integer, count: integer}[]` | 时段分布（hour 0-23） |

## 后端映射

| 控制器 | 文件 |
|---|---|
| `AdminStatsController` | `src/modules/admin/controllers/admin-stats.controller.ts` — `GET /admin/stats` |
| `AdminStatsService` | `src/modules/admin/services/admin-stats.service.ts` |
| `StatsController` | `src/modules/stats/stats.controller.ts` — 底层统计接口 |
| `StatsService` | `src/modules/stats/stats.service.ts` — 5 个并行聚合查询 |

`AdminStatsService.getDashboard()` 通过 `Promise.all` 并行调用：
- `StatsService.getOverview()` — 总览数据
- `StatsService.getRevenue()` — 收入统计
- `StatsService.getUserStats()` — 用户统计
- `StatsService.getPopularServices()` — 热门服务 Top 10
- `StatsService.getDailyBookings()` — 近 30 天每日预约

所有统计通过 Prisma 聚合查询实时计算（Materialized View 每 5min 刷新，或 Redis 缓存 TTL=300s）。

## 仪表盘内容

| 区域 | 数据来源 | 说明 |
|---|---|---|
| **欢迎横幅** | `today = new Date()` | `<app-welcome-card>` — 页面顶部欢迎语 + 当前日期 + View Bookings 按钮（占位） |
| **4 个统计卡片** | `vm().stats` | 今日预约、待确认、客户总数、总收入 |
| **预约趋势折线图** | `vm().stats?.bookingTrend` | 折线图，#2ecc71 线条 + 渐变填充（`rgba(46,204,113,0.05→0.35)`），通过 `AppChartComponent` 渲染 |
| **服务分布环形图** | `vm().stats?.servicePopularity` | 环形图（doughnut，cutout 70%），中心显示 "Total / Bookings" 文字，5 色 palette |
| **时段分布柱状图** | `vm().stats?.time_distribution` | 柱状图，flat `rgba(46,204,113,0.7)` 颜色，柱体上方显示数值标签。支持通过 Booking Distribution Panel 的 Time 按钮下拉菜单选择时间范围（last24h/last7d/last30d/thisMonth/lastMonth/custom），选择后重新请求 `GET /v1/admin/stats/time-distribution` 并传入 timeRange / startDate / endDate 参数 |
| **近期预约表** | `GET /v1/admin/appointments?limit=5` | 最近预约列表（复用 admin appointments 列表端点，非专属仪表盘 API）。limit=5 为前端请求参数，未在契约中正式声明 |
| **近期用户表** | `GET /v1/admin/users?limit=5` | 最近 5 个注册用户，含姓名、角色(badge，显示全大写值如 `CUSTOMER`/`ADMIN`)、状态(badge)、创建时间（复用 admin users 列表端点） |
| **近期服务表** | `GET /v1/admin/services?limit=5` | 最近 5 个创建服务，含服务名、时长、价格、激活状态(badge)（复用 admin services 列表端点，非专属仪表盘 API） |
| **系统状态** | `GET /v1/admin/system/health` (SYS-001) — 响应字段: `server`, `database`, `api`, `redis`, `lastBackup`, `uptime` | 系统健康状态（实时），支持 WebSocket `system.health.updated` 推送或每 60 秒轮询刷新 |
| **统计卡片 + 预约列表** | WebSocket 事件 `appointment.status_changed` | 预约状态变更时通过 WebSocket `appointment.status_changed` 事件自动刷新统计卡片（totalBookings、todayBookings、pendingBookings 等）和近期预约列表，无需手动刷新页面 |
| **系统状态详情** | `GET /v1/admin/system/metrics` (SYS-002) — 响应字段: `cpuUsage`, `memoryUsage`, `diskUsage` | 点击展开后的详细指标（CPU、内存、磁盘使用率） |

## 交互流程

1. 访问 `/admin/dashboard`，父级守卫验证角色
2. `ngOnInit()` → `loadStats()` → `AdminService.getStats()` → `AdminStore.setStats()`
3. 顶部展示欢迎横幅卡片（`<app-welcome-card>`）：用户名 + 当前日期 + View Bookings 按钮
4. 展示 4 个核心统计卡片（含变化百分比和进度条）
4. 图表区域（2 列网格布局）：
   - 左列：预约趋势折线图 ← `vm().stats.bookingTrend`
   - 右列：Booking Distribution Panel（单面板内含服务分布环形图 + 时段分布柱状图）
5. **时间范围筛选**：
   - 用户在 Booking Distribution Panel 点击 Time 按钮 → 显示 6 个选项的下拉菜单
   - 选择预设范围（如 Last 7 Days）→ 触发 `store.loadTimeDistribution(timeRange)` → 仅时段分布柱状图按所选范围更新（数据源：`time_distribution` 字段）
   - 选择 Custom Range → 显示日期选择面板 → 选择起止日期 → 点击 Apply → 触发 `store.loadTimeDistribution('custom', startDate, endDate)` → 仅时段分布柱状图更新
6. 底部三栏近期面板（`grid grid-cols-1 lg:grid-cols-3`）：
   - 近期预约（Recent Bookings）
   - 近期用户（Recent Users）
   - 近期服务（Recent Services）
7. 系统状态折叠面板

## 刷新矩阵

| 区域 | 初始化加载 | WebSocket 自动刷新 | 轮询 | 用户操作触发刷新 |
|---|---|---|---|---|
| 4 个统计卡片 | `ngOnInit` → `getStats()` | ✅ `appointment.status_changed` 事件 → 重新 `loadStats()` | ❌ | 时间范围变更 |
| 预约趋势图 | `ngOnInit` → `loadBookingTrend()` | ❌ | ❌ | 周期（Weekly/Monthly/Yearly）切换 |
| 服务分布 + 时段分布 | `ngOnInit` → `vm().stats` | ❌ | ❌ | 时间范围下拉选择 |
| 近期预约表 | `ngOnInit` → `getAdminAppointments({limit:5})` | ✅ `appointment.status_changed` 事件 → 重新加载 | ❌ | — |
| **近期用户表** | `ngOnInit` → `getUsers({limit:5})` | ❌ | ❌ | — |
| **近期服务表** | `ngOnInit` → `getAdminServices({limit:5})` | ❌ | ❌ | — |
| 系统状态 | `ngOnInit` → `getSystemStatus()` | ✅ `system.health.updated` WebSocket | ✅ 60s 间隔 | 点击展开详情 |

> **近期用户 / 近期服务** 面板仅在 `ngOnInit` 加载一次，无自动刷新。如需实时更新，需引入 WebSocket 用户/服务变更事件或添加轮询机制。

## 数据来源

- contract.yaml 1.7.1（admin.stats — 含 time_distribution 单一字段，移除冗余 staffWorkload）
- SAD 2.2.1（StatsModule）
- 接口设计规范 2.8（DASH-001~004 仪表盘指标定义）
- 数据架构设计文档 11.1.1（统计数据实时计算 + Materialized View）
- admin.users CRUD（REC-002 近期用户面板）
- admin.services CRUD（REC-003 近期服务面板）
