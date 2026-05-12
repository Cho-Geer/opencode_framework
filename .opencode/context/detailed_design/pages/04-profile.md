# 个人信息页（ProfilePage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 个人信息页 |
| **路由路径** | `/profile` |
| **布局** | `AppLayoutComponent` |
| **惰性加载** | `features/profile/profile.routes.ts` → `PROFILE_ROUTES` |
| **组件** | `ProfileComponent` (`src/app/features/profile/profile.component.ts`) |
| **设计依据** | contract.yaml `users.get_profile` / `update_profile` |

## 用户角色

- CUSTOMER, ADMIN, SUPER_ADMIN（`authGuard` 保护）

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

| 守卫 | 策略 |
|---|---|
| `authGuard` | 未认证 → 重定向 `/auth/login?returnUrl=/profile` |

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `AuthStore` | `currentUser()`, `isLoading`, `error`, `setUserProfile()` |
| `ApiService` | `updateProfile()` |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `isEditing` | `boolean` | 编辑模式切换 |
| `editName` | `string` | 编辑中的姓名输入 |
| `saveError` | `string \| null` | 保存失败错误信息 |
| `isSaving` | `boolean` | 保存中状态 |
| `passwordDialogVisible` | `boolean` | 修改密码对话框显示状态 |
| `avatarInitials` | `string` (computed) | 由用户姓名生成的头像字母缩略 |

## API 契约对照

| 方法 | 端点 | 请求 | 响应 | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `GET` | `/v1/users/profile` | — | `{id, name, email(masked), phone?(masked), userType, status, createdAt}` | Bearer | 页面初始化（通过 AuthStore 已有数据） |
| `PUT` | `/v1/users/profile` | `{name?: string}` | `{ user: { id, name, email, phone, userType, status, createdAt } }` | Bearer | 保存编辑 |
| `PUT` | `/v1/users/profile/password` | `{currentPassword*, newPassword*}` | `{message}` | Bearer | 修改密码对话框提交 |

**注意**：`PUT /v1/users/profile` → `UsersController.updateProfile()`，含 ownership 校验，仅允许用户修改自己的资料。请求体仅允许 name 字段，email/phone 不可通过此端点修改。后端 `ProfileResponseDto` 包含脱敏邮箱/手机。
**修改密码**：`PUT /v1/users/profile/password` → `UsersController.updatePassword()`，需验证旧密码，仅允许修改自己的密码。

## 本地 store 信号（AuthStore）

| 信号 | 类型 | 说明 |
|---|---|---|
| `user` | `User \| null` | 当前用户（PII 脱敏） |
| `isAuthenticated` | `boolean` (computed) | 认证状态 |
| `currentUser` | `User \| null` (computed) | `user` 别名 |

## 交互流程

1. 访问 `/profile`，`authGuard` 检查认证
2. 页面展示当前用户信息（姓名、脱敏邮箱、脱敏手机、注册时间）
3. 非编辑模式：仅展示信息，头像显示姓名首字母
4. 点击「编辑」→ `isEditing = true`，姓名变为可编辑输入框
5. 修改姓名 → 点击「保存」→ `api.updateProfile({ name })` → 更新 `AuthStore`
6. 点击「修改密码」→ `passwordDialogVisible = true`（对话框组件）
7. API 对应后端 `UsersController.updatePassword()`（含 ownership 校验）

## 数据脱敏

- `email` 字段后端返回时已脱敏（如 `us***@example.com`）
- `phone` 字段后端返回时已脱敏（如 `138****5678`）
- JWT payload 中不含 PII（NIST SP 800-63B 合规）

## 数据来源

- contract.yaml 1.7.1（users.get_profile, users.update_profile, users.update_password）
- 接口设计规范 2.1（数据脱敏要求）
- 安全架构设计文档 2.1（JWT payload 规范）
- piiEncryptionStrategy 4（PII 三字段模型）
