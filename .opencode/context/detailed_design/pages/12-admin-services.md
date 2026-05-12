# 管理员-服务管理页（AdminServiceManagementPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 服务管理 |
| **路由路径** | `/admin/services` |
| **布局** | `AppLayoutComponent`（Admin 侧边栏） |
| **惰性加载** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **组件** | `ServiceManagementComponent` (`src/app/features/admin/pages/service-management/service-management.component.ts`) |
| **设计依据** | contract.yaml `admin.services` CRUD |

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
| `AdminStore` | `vm`, `setLoading()`, `setServices()`, `updateServiceInList()`, `removeServiceFromList()`, `setError()`, `services()`, `servicesTotal()`, `servicesPage()` |
| `AdminService` | `getAdminServices()`, `createAdminService()`, `updateAdminService()`, `deleteAdminService()` |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `viewMode` | `'grid' \| 'list'` | 视图切换（网格/列表） |
| `serviceDialogVisible` | `boolean` | 服务编辑对话框 |
| `deleteDialogVisible` | `boolean` | 删除确认对话框 |
| `selectedService` | `AdminServiceItem \| null` | 选中服务 |
| `serviceToDelete` | `AdminServiceItem \| null` | 待删除服务 |
| `isEdit` | `boolean` | 编辑模式 |
| `submitted` | `boolean` | 表单已提交 |
| `searchQuery` | `string` | 搜索关键词 |
| `categoryFilter` | `string` | 分类筛选（绑定 `?category=` 查询参数） |
| `statusFilter` | `string` | 状态筛选 |
| `formErrors` | `{ name?; duration?; price? }` | 表单验证错误 |
| `formName`, `formDescription`, `formDuration`, `formPrice`, `formActive`, `formImageUrl`, `formTaxRate` | 各类型 | 表单字段绑定 |
| `computedPricePerMinute` | `number \| null` (computed) | 自动计算值：`formPrice / formDuration`；当 duration > 0 时实时计算，仅用于展示（非手动输入字段） |
| `totalServices` | `number` (computed) | 服务总数（来源：`GET /v1/admin/services` 响应 `total` 字段，跨分页系统级总数） |
| `activeServicesCount` | `number` (computed) | 激活服务数（从全量服务列表 `limit=999` 按 `active=true` 过滤计算） |
| `averagePrice` | `number` (computed) | 平均价格（从全量服务列表 `limit=999` 计算均值） |

> **注意**：`averagePrice` 当前通过 `limit=999` 全量查询后计算。`contract.yaml` v1.7.3 已为 `admin/services/summary` 端点定义 `averagePrice` 字段，后续可切换为专用 summary 端点。

## API 契约对照

> **响应信封**：所有成功的 API 响应由 ResponseInterceptor 包装为统一信封格式 `{ statusCode, message, data, timestamp, requestId }`。下表中"响应"列仅描述 `data` 字段内部结构，信封外层隐式适用。

| 方法 | 端点 | 请求参数/正文 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/services` | `?page&limit&search&active&category` | `PaginatedResponse<AdminServiceDto>`（`{id, name, description, duration, price, active, category, imageUrl?, createdAt, pricePerMinute?, taxRate?}`） | Bearer ADMIN/SUPER_ADMIN | 页面初始化、筛选、分页 |
> ⚠️ **已知契约偏差**
> ⚠️ **字段类型注意**：后端返回的 `price` 字段为 **string** 类型（如 `"800"`），而非 `number`。前端在 `loadAllServicesForStats()` 数据入口处通过 `Number(s.price)` 将其转为数值，确保 `averagePrice` 计算使用数值加法而非字符串拼接。分页表格展示已委托 `currency` Pipe 自动格式化，不受影响。
> **修复计划**：此为已知技术债（对应 ADR 待创建）。后端需修正 `AdminServiceDto.price` 返回类型为 `number`，与 contract.yaml 定义的 `{ type: "number", format: "decimal" }` 对齐。当前变通方案不应长期保留。
> **注意**：统计卡片使用独立的全量数据请求（limit=999，与分页表格分开），不依赖专用 summary 端点。Active Services Count 和 Average Price 从全量数据计算。
| `POST` | `/v1/admin/services` | `{name*, description?, duration*, price?, active?, imageUrl?, pricePerMinute?, taxRate?}` | `AdminServiceDto` (201) | Bearer ADMIN/SUPER_ADMIN | 新建保存 |
| `PUT` | `/v1/admin/services/:id` | `{name?, description?, duration?, price?, active?, imageUrl?, pricePerMinute?, taxRate?}` | `AdminServiceDto` | Bearer ADMIN/SUPER_ADMIN | 编辑保存 |
> **auto-calc**：`pricePerMinute` 在后端自动计算为 `price / duration`（当两者均提供时）。前端不再提供 `pricePerMinute` 手动输入字段，改为显示由 `computedPricePerMinute` 信号实时计算的值。若前端显式传递 `pricePerMinute`，后端优先使用传递值；否则自动计算。
| `DELETE` | `/v1/admin/services/:id` | path: `id` | `void` (204) | Bearer ADMIN/SUPER_ADMIN | 删除确认 |

## 后端映射

| 控制器 | 文件 |
|---|---|
| `AdminServicesController` | `src/modules/admin/controllers/admin-services.controller.ts` — 路由前缀 `"admin/services"` |
| `AdminServicesService` | `src/modules/admin/services/admin-services.service.ts` — 委托 `ServicesService` |

权限控制：
| 端点 | 最低角色 |
|---|---|
| `GET /admin/services` | ADMIN |
| `POST /admin/services` | ADMIN |
| `PUT /admin/services/:id` | ADMIN |
| `DELETE /admin/services/:id` | ADMIN |

## 交互流程

1. 访问 `/admin/services`，父级守卫验证
2. `loadServices()` → `AdminService.getAdminServices({ page, search, active })` → `AdminStore.setServices()`
3. 视图切换：网格视图（卡片式） / 列表视图（表格式）
4. 搜索框 + 分类筛选 + 状态筛选
5. 点击「新建」→ `serviceDialogVisible = true`，`isEdit = false`
6. 点击服务「编辑」→ 对话框回填，`isEdit = true`
7. 表单：名称（必填 *）、描述、时长（分钟）、价格（必填 *）、图片 URL、激活开关
7a. **价格验证**：Price 字段为必填项，必须输入正数（> 0）。若提交时 price 为 `null`、空值或 ≤ 0，前端显示验证错误信息，表单拒绝提交。
8. **`pricePerMinute` 自动计算**：当用户输入 `duration` 和 `price` 后，前端通过 `computedPricePerMinute` 信号自动计算并展示 `price / duration` 结果（仅显示，非输入字段）。模板中使用 `@if (isViewMode())` 守卫控制显示，确保编辑模式下始终重新计算并展示最新单价，避免模板条件判断错误导致显示 `$0.00`。保存时前端不发送 `pricePerMinute`，由后端在 `AdminServicesService` 中计算：`pricePerMinute = dto.price / dto.duration`。此设计避免手动计算错误并保证数据一致性。
> **架构决策**：`pricePerMinute = price / duration` 计算逻辑采用**前后端双计算策略**。前端 `computed()` 信号提供即时 UI 反馈（用户输入时零延迟显示单价）；后端在写入数据库时重新计算确保数据完整性（不论 API 调用来源）。此方案无需网络往返即可提供实时预览，同时杜绝不一致数据（如 price:100, duration:60, pricePerMinute:999）被持久化。属于 Angular Signals 最惯用模式。
9. 激活状态 Toggle Switch：可在列表中直接切换
9. 删除操作：确认 → `AdminService.deleteAdminService(id)` → `AdminStore.removeServiceFromList()`

## 表格列

| 列 | 组件 | 说明 |
|---|---|---|
| **Name** | `Avatar/Icon + text` | 服务图标 + 名称 + 描述 |
| **Duration** | `text` | 时长（分钟） |
| **Price** | `currency:'USD'` | 价格 |
| **Status** | `<app-badge>` | 激活状态：`active=true→confirmed(绿色)`，显示 `ACTIVE`；`active=false→expired(灰色)`，显示 `INACTIVE`。标签通过 `customLabel` 使用全大写值。 |
| **Actions** | `<app-button>` | 编辑（ghost+pencil）+ 删除（danger+trash） |

## Dashboard 消耗

| 仪表盘面板 | 消耗端点 | 参数 |
|-----------|---------|------|
| Recent Services | `GET /v1/admin/services` | `limit=5`, `page=1`, `orderBy=createdAt:desc` |

Dashboard 面板复用此端点获取最近服务列表用于概览展示，与服务管理页的完整分页列表共享同一端点。

## 数据来源

- contract.yaml 1.7.1（admin.services CRUD — 含 pricePerMinute、taxRate）
- SAD 2.2.1（ServicesModule）
- 数据架构设计文档 2.2（Service 实体, ServiceCategory 实体）

## 统计卡片数据来源

| 卡片 | 数据来源 | 系统级真实值? | 刷新机制 |
|---|---|---|---|
| **Total Services** | `GET /v1/admin/services` 响应中的 `total` 字段 | ✅ 系统级真实总数（跨分页） | `ngOnInit` + 筛选/CRUD 操作后重新加载 |
| **Active Services** | 从 `GET /v1/admin/services` 加载全量服务列表（limit=999）后按 `active=true` 过滤计算 | ✅ 系统级真实值 | `ngOnInit` + 筛选/CRUD 操作后重新加载 |
| **Average Price** | 从全量服务列表（limit=999）计算价格均值 | ✅ 系统级真实值 | `ngOnInit` + 筛选/CRUD 操作后重新加载 + **60s 轮询** |

> **注意**：统计卡片使用独立的全量数据请求（与分页表格分开），确保 Active Services 和 Average Price 反映系统总览而非当前分页数据。Total Services 直接使用 API 响应的 `total` 字段。Average Price 额外增加 60 秒轮询自动刷新（`RxJS interval(60000)`），与 Dashboard 系统状态轮询模式一致。`averagePrice` 计算中通过 `Number(s.price)` 将后端返回的 string 类型 price 转为数值，避免 `reduce` 中 `+` 运算符发生字符串拼接。

## 数据刷新

| 事件 | 刷新行为 |
|---|---|
| 页面初始化 (`ngOnInit`) | 同时发起两个请求：1️⃣ `getAdminServices({limit:10})` 填充表格；2️⃣ `getAdminServices({limit:999})` 填充统计卡片 |
| 筛选变化 (`applyFilter`) | 重新加载分页表格 + 统计卡片 |
| 搜索/清空 (`clearFilters`) | 同上 |
| 创建/编辑/删除服务 | 本地更新 store + 重新加载统计卡片 |
| WebSocket 自动刷新 | ❌ 未实现（无服务变更 WebSocket 事件） |
| **轮询自动刷新** | ✅ **60s interval → loadAllServicesForStats()**（仅更新统计卡片，不影响分页表格） |

## 分类派生说明

- `category` 字段由后端 `ServiceCategory` 关联派生。若服务关联了 `ServiceCategory`，则该分类名称通过 JOIN 查询填充至 `AdminServiceDto.category`；若未关联分类，则返回 `null`。
- `GET /v1/admin/services/summary` 中的 `categories` 数组对 `category=null` 的服务归入「未分类」统计。
