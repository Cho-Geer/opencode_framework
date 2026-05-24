# 管理员-用户管理页（AdminUserManagementPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 用户管理 |
| **路由路径** | `/admin/users` |
| **布局** | `AppLayoutComponent`（Admin 侧边栏） |
| **惰性加载** | `features/admin/admin.routes.ts` → `ADMIN_ROUTES` (loadComponent) |
| **组件** | `UserManagementComponent` (`src/app/features/admin/pages/user-management/user-management.component.ts`) |
| **设计依据** | contract.yaml `admin.users` CRUD |

## 用户角色

- ADMIN（读 + 编辑，但不可创建/删除 ADMIN 以上角色）
- SUPER_ADMIN（完全控制）

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
| `AdminStore` | `vm`, `setLoading()`, `setUsers()`, `updateUserInList()`, `removeUserFromList()`, `setError()`, `users()`, `usersTotal()`, `usersPage()` |
| `AdminService` | `getUsers()`, `createUser()`, `updateUser()`, `deleteUser()` |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `userDialogVisible` | `boolean` | 用户创建/编辑对话框 |
| `deleteDialogVisible` | `boolean` | 删除确认对话框 |
| `selectedUser` | `AdminUser \| null` | 对话框中选择的用户 |
| `userToDelete` | `AdminUser \| null` | 待删除用户 |
| `isEdit` | `boolean` | 编辑模式（否则为新建模式） |
| `submitted` | `boolean` | 表单是否已提交 |
| `searchQuery` | `string` | 搜索关键词 |
| `selectedRoleFilter` | `string` | 角色筛选 |
| `selectedStatusFilter` | `string` | 状态筛选 |
| `formErrors` | `object` | 表单验证错误 |
| `formName`, `formEmail`, `formPhone`, `formRole`, `formStatus`, `formPassword` | `string` | 表单字段绑定 |
| `totalUsers` | `number` (computed) | 用户总数 |
| `activeUsers` | `number` (computed) | 活跃用户数 |
| `newThisWeek` | `number` (computed) | 本周新增数 |

## API 契约对照

> **响应信封**：所有成功的 API 响应由 ResponseInterceptor 包装为统一信封格式 `{ statusCode, message, data, timestamp, requestId }`。下表中"响应"列仅描述 `data` 字段内部结构，信封外层隐式适用。

| 方法 | 端点 | 请求参数/正文 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/admin/users` | `?page&limit&search&role&status` | `PaginatedResponse<AdminUserDto>`（`{id, name, email(masked), phone?(masked), role, status, createdAt}`） | Bearer ADMIN/SUPER_ADMIN | 页面初始化、筛选变化、分页变化 |
| `POST` | `/v1/admin/users` | `{name*, email*, phone?, role?, password*}` | `AdminUserDto` (201) | Bearer **SUPER_ADMIN only** | 保存新建用户 |
| `PUT` | `/v1/admin/users/:id` | `{name?, role?, status?}` | `AdminUserDto` | Bearer ADMIN/SUPER_ADMIN | 保存编辑用户 |
| `DELETE` | `/v1/admin/users/:id` | path: `id` | `void` (204) | Bearer **SUPER_ADMIN only** | 删除确认 |

## 后端映射

| 控制器 | 文件 |
|---|---|
| `AdminUsersController` | `src/modules/admin/controllers/admin-users.controller.ts` — 路由前缀 `"admin/users"` |
| `AdminUsersService` | `src/modules/admin/services/admin-users.service.ts` — 委托 `UsersService` |

权限控制：
| 端点 | 最低角色 |
|---|---|
| `GET /admin/users` | ADMIN |
| `POST /admin/users` | **SUPER_ADMIN** |
| `PUT /admin/users/:id` | ADMIN |
| `DELETE /admin/users/:id` | **SUPER_ADMIN** |

## 表单选项

| 字段 | 选项 |
|---|---|
| `role` | `CUSTOMER`, `ADMIN`, `SUPER_ADMIN` |
| `status` | `ACTIVE`, `INACTIVE`, `BLOCKED` |

## 交互流程

1. 访问 `/admin/users`，父级守卫验证
2. `loadUsers()` → `AdminService.getUsers({ page, search, role, status })` → `AdminStore.setUsers()`
3. PrimeNG 表格展示用户列表（分页、排序）
4. 顶部：搜索框 + 角色下拉筛选 + 状态下拉筛选
5. 点击「新建用户」→ 对话框（`userDialogVisible = true`），`isEdit = false`，表单清空
6. 点击某用户「编辑」→ 对话框，`isEdit = true`，表单回填
7. 新建模式：输入姓名、邮箱、手机（可选）、角色、密码 → 提交
8. 编辑模式：可修改姓名、角色、状态 → 提交
9. 删除操作：仅 **SUPER_ADMIN** 可见「删除」按钮 → `deleteDialogVisible = true` → 确认 → `AdminService.deleteUser(id)` → `AdminStore.removeUserFromList()`

## 表格列

| 列 | 组件 | 说明 |
|---|---|---|
| **Name** | `Avatar + text` | 用户头像（首字母圆形背景）+ 名称 |
| **Email** | `text` | 邮箱地址 |
| **Role** | `<app-badge>` | 角色映射：`CUSTOMER→completed(蓝色)`，`ADMIN→processing(浅蓝)`，`SUPER_ADMIN→confirmed(绿色)`。标签通过 `customLabel="user.role"` 直接使用后端存储的大写值显示（`CUSTOMER` / `ADMIN` / `SUPER_ADMIN`）。 |
| **Status** | `<app-badge>` | 状态映射：`ACTIVE→confirmed(绿色)`，`INACTIVE→pending(黄色)`，`BLOCKED→cancelled(红色)`，通过 `mapStatusToBadge()` 转换为 BadgeStatus |
| **Created** | `date:'short'` | 创建时间 |
| **Actions** | `<app-button>` | 编辑（ghost+pencil）+ 删除（danger+trash）

## Dashboard 消耗

| 仪表盘面板 | 消耗端点 | 参数 |
|-----------|---------|------|
| Recent Users | `GET /v1/admin/users` | `limit=5`, `page=1`, `orderBy=createdAt:desc` |

Dashboard 面板复用此端点获取最近用户列表用于概览展示，与用户管理页的完整分页列表共享同一端点。

## 统计卡片数据来源

| 卡片 | 数据来源 | 系统级真实值? | 刷新机制 |
|---|---|---|---|
| **Total Users** | `GET /v1/admin/users` 响应中的 `total` 字段 | ✅ 系统级真实总数（跨分页） | `ngOnInit` + 筛选/CRUD 操作后重新加载 |
| **Active Users** | 从 `GET /v1/admin/users` 加载全量用户列表（limit=999）后按 `status='ACTIVE'` 过滤计算 | ✅ 系统级真实值 | `ngOnInit` + 筛选/CRUD 操作后重新加载 |
| **New This Week** | 从全量用户列表按 `createdAt >= 一周前` 过滤计算 | ✅ 系统级真实值 | `ngOnInit` + 筛选/CRUD 操作后重新加载 |

> **注意**：统计卡片使用独立的全量数据请求（与分页表格分开），确保 Active Users 和 New This Week 反映系统总览而非当前分页数据。Total Users 直接使用 API 响应的 `total` 字段。
>
> **文档缺口**：`admin.users` 当前缺少专用的 summary 统计端点（对比 `admin.services.summary`）。Active Users 和 New This Week 通过 `limit=999` 全量查询前端计算获得，仅适用于用户规模较小的场景。如需支持大规模用户管理，建议新增 `GET /v1/admin/users/summary` 统计端点，返回 `{ totalUsers, activeUsers, newThisWeek }` 三个聚合值。

## 数据刷新

| 事件 | 刷新行为 |
|---|---|
| 页面初始化 (`ngOnInit`) | 同时发起两个请求：1️⃣ `getUsers({limit:10})` 填充表格；2️⃣ `getUsers({limit:999})` 填充统计卡片 |
| 筛选变化 (`applyFilter`) | 重新加载分页表格 + 统计卡片 |
| 搜索/清空 (`clearFilters`) | 同上 |
| 创建/编辑/删除用户 | 本地更新 store + 重新加载统计卡片 |
| WebSocket 自动刷新 | ❌ 未实现（无用户变更 WebSocket 事件） |

## 数据来源

- contract.yaml 1.7.1（admin.users CRUD）
- 安全架构设计文档 2.2.1（角色权限矩阵：SUPER_ADMIN 独占 create 和 delete ADMIN 用户）
- 数据架构设计文档 2.2（User 实体状态枚举）
