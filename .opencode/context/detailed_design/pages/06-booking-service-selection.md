# 预约-选择服务页（ServiceSelectionPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 预约创建 - 选择服务 |
| **路由路径** | `/booking` |
| **布局** | `AppLayoutComponent` |
| **惰性加载** | `features/booking/booking.routes.ts` → `BOOKING_ROUTES` |
| **组件** | `ServiceSelectionComponent` (`src/app/features/booking/service-selection/service-selection.component.ts`) |
| **设计依据** | 接口规范 2.5.3（乐观 UI）, SAD 4.4（高并发核心流程） |

## 用户角色

- CUSTOMER 专属

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard` | 未认证 → `/auth/login?returnUrl=/booking` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | ADMIN/SUPER_ADMIN → `/admin/dashboard` |

## 解析器

| 解析器 | 提供数据 | 当前状态 |
|---|---|---|
| `serviceResolver` | `services: Service[]` | **当前返回静态 Mock 数据**（5 个示例服务），TODO: 替换为真实 API 调用 |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `BookingStore` | `setSelectedServiceId()`, `loadSlots([])` |
| `ApiService` | `getServices()` |
| `Router` | 选择服务后导航至 `/booking/slots` |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `services` | `Service[]` | 从 API 加载的服务列表 |
| `selectedServiceId` | `string \| null` | 当前选中的服务 ID |
| `isLoading` | `boolean` | 加载状态 |
| `searchQuery` | `string` | 搜索关键词 |
| `activeCategory` | `string` | 分类筛选 |
| `categories` | `string[]` (computed) | 由服务名称推导的分类列表 |
| `filteredServices` | `Service[]` (computed) | 按搜索词和分类筛选后的服务 |

## API 契约对照

| 方法 | 端点 | 请求参数 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/services` | — | `Service[]` (`{id, name, description, duration, price, active}`) | Bearer | `ngOnInit()` 的 `loadServices()` |

**后端映射**：

| 控制器 | 端点 | 详情 |
|---|---|---|
| `ServicesController` | `GET /services` | `findAll()` 分页 + 可选 `isActive` 过滤（类级别 `@RateLimit({ tier: "public", key: "ip" })`) |

## 交互流程

1. 访问 `/booking`，守卫 + 解析器运行
2. 解析器 `serviceResolver` 加载服务列表（当前为 Mock，TODO 替换 API）
3. 页面展示服务卡片列表（包含名称、描述、时长、价格）
4. 顶部搜索框 → 输入过滤服务
5. 分类 Tab 栏 → 点击按类别筛选
6. 点击某个服务 → `selectedServiceId = service.id` → `BookingStore.setSelectedServiceId(serviceId)`
7. 自动导航至 `/booking/slots`
8. **高并发优化**：`preferredSequence`（0-99 随机散列）将在预约确认提交时生成并发送，用于高并发场景下的竞态控制

## 数据模型

| 字段 | 类型 | 说明 |
|---|---|---|
| `Service.id` | `string (UUID)` | 服务 ID |
| `Service.name` | `string` | 服务名称 |
| `Service.description` | `string` | 服务描述 |
| `Service.duration` | `number` | 时长（分钟） |
| `Service.price` | `number (decimal)` | 价格 |
| `Service.active` | `boolean` | 是否激活 |

## 数据来源

- contract.yaml 1.6.4（services.list）
- SAD 2.2.1（ServicesModule）
- 接口设计规范 2.5.3（高并发乐观 UI）
- 数据架构设计文档 2.2（Service 实体, ServiceCategory 实体）
