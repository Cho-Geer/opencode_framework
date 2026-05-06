# 管理员仪表盘（AdminDashboardPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 管理员仪表盘 |
| **路由路径** | `/admin/dashboard`（`/admin` 重定向至此） |
| **布局** | `AppLayoutComponent`（Admin 侧边栏） |
| **惰性加载** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **组件** | `DashboardComponent` (`src/app/features/admin/pages/dashboard/dashboard.component.ts`) |
| **设计依据** | contract.yaml `admin.stats` (DASH-001~004), SAD 2.2.1（StatsModule）, 接口规范 2.8 |

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
| `AdminStore` | `vm` (computed view model), `setLoading()`, `setStats()`, `setError()` |
| `AdminService` | `getStats()` |

## 本地计算属性

| 信号 | 类型 | 说明 |
|---|---|---|
| `vm()` | `AdminViewModel` (computed) | 包含 `stats`, `isLoading`, `error` |

## API 契约对照

| 方法 | 端点 | 请求参数 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/stats` | `?timeRange&startDate&endDate` | `AdminStatsDto`（见下方） | Bearer ADMIN/SUPER_ADMIN | `ngOnInit()` 的 `loadStats()` |

**`AdminStatsDto`** 完整结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| `totalBookings` | `StatCard` | 总预约数（`{value, changePercentage, isPositive, target, progressPercentage}`） |
| `todayBookings` | `StatCard` | 今日预约数 |
| `pendingBookings` | `StatCard` | 待确认预约数 |
| `activeUsers` | `StatCard` | 活跃用户数 |
| `totalRevenue` | `StatCard` | 总收入 |
| `bookingTrend` | `{labels: string[], bookingsData: number[], revenueData: number[]}` | 预约趋势图表数据 |
| `servicePopularity` | `{serviceName, count, percentage}[]` | 服务热度分布 |
| `timeDistribution` | `{hour, count}[]` | 时段分布 |

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
| **4 个统计卡片** | `vm().stats` | 今日预约、待确认、客户总数、总收入 |
| **预约趋势折线图** | `vm().stats?.bookingTrend` | 通过 `AppChartComponent` 渲染 |
| **服务热度饼图** | `vm().stats?.servicePopularity` | 环形图（doughnut） |
| **时段分布柱状图** | `vm().stats?.timeDistribution` | 24 小时分布 |
| **近期预约表** | `GET /v1/admin/appointments?limit=5` | 最近预约列表（复用 admin appointments 列表端点，非专属仪表盘 API） |
| **系统状态** | `GET /v1/admin/system/health` (SYS-001) — 响应字段: `server`, `database`, `api`, `lastBackup`, `uptime` | 系统健康状态（实时） |

## 交互流程

1. 访问 `/admin/dashboard`，父级守卫验证角色
2. `ngOnInit()` → `loadStats()` → `AdminService.getStats()` → `AdminStore.setStats()`
3. 展示 4 个核心统计卡片（含变化百分比和进度条）
4. 预约趋势图 ← `vm().stats.bookingTrend`（TBD：时间范围选择器——周/月/年切换）
5. 服务分布图 ← `vm().stats.servicePopularity`（TBD：时间段筛选）
6. 时段分布柱状图 ← `vm().stats.timeDistribution`
7. 底部近期预约 + 系统状态

## 数据来源

- contract.yaml 1.6.4（admin.stats）
- SAD 2.2.1（StatsModule）
- 接口设计规范 2.8（DASH-001~004 仪表盘指标定义）
- 数据架构设计文档 11.1.1（统计数据实时计算 + Materialized View）
