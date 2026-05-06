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
| `formErrors` | `object` | 表单验证错误 |
| `formName`, `formDescription`, `formDuration`, `formPrice`, `formActive`, `formImageUrl` | 各类型 | 表单字段绑定 |
| `totalServices` | `number` (computed) | 服务总数（来源：`GET /v1/admin/services/summary` → `totalServices`） |
| `activeServicesCount` | `number` (computed) | 激活服务数（来源：`GET /v1/admin/services/summary` → `activeServicesCount`） |
| `averagePrice` | `number` (computed) | 平均价格（来源：`GET /v1/admin/services/summary` → `averagePrice`） |

## API 契约对照

| 方法 | 端点 | 请求参数/正文 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/services` | `?page&limit&search&active&category` | `PaginatedResponse<AdminServiceDto>`（`{id, name, description, duration, price, active, category, imageUrl?, createdAt}`） | Bearer ADMIN/SUPER_ADMIN | 页面初始化、筛选、分页 |
| `GET` | `/v1/admin/services/summary` | — | `{totalServices, activeServicesCount, inactiveServicesCount, averagePrice, categories[]}` | Bearer ADMIN/SUPER_ADMIN | 页面初始化（computed signals 数据源） |
| `POST` | `/v1/admin/services` | `{name*, description?, duration*, price?, active?, imageUrl?}` | `AdminServiceDto` (201) | Bearer ADMIN/SUPER_ADMIN | 新建保存 |
| `PUT` | `/v1/admin/services/:id` | `{name?, description?, duration?, price?, active?, imageUrl?}` | `AdminServiceDto` | Bearer ADMIN/SUPER_ADMIN | 编辑保存 |
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
7. 表单：名称、描述、时长（分钟）、价格、图片 URL、激活开关
8. 激活状态 Toggle Switch：可在列表中直接切换
9. 删除操作：确认 → `AdminService.deleteAdminService(id)` → `AdminStore.removeServiceFromList()`

## 数据来源

- contract.yaml 1.6.8（admin.services CRUD）
- SAD 2.2.1（ServicesModule）
- 数据架构设计文档 2.2（Service 实体, ServiceCategory 实体）

## 分类派生说明

- `category` 字段由后端 `ServiceCategory` 关联派生。若服务关联了 `ServiceCategory`，则该分类名称通过 JOIN 查询填充至 `AdminServiceDto.category`；若未关联分类，则返回 `null`。
- `GET /v1/admin/services/summary` 中的 `categories` 数组对 `category=null` 的服务归入「未分类」统计。
