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

## 数据来源

- contract.yaml 1.6.4（admin.users CRUD）
- 安全架构设计文档 2.2.1（角色权限矩阵：SUPER_ADMIN 独占 create 和 delete ADMIN 用户）
- 数据架构设计文档 2.2（User 实体状态枚举）
