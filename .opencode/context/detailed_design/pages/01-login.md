# 登录页（LoginPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 登录页 |
| **路由路径** | `/auth/login` |
| **布局** | 无布局外壳（Standalone 页面） |
| **惰性加载** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` |
| **组件** | `LoginComponent` (`src/app/features/auth/login/login.component.ts`) |
| **设计依据** | SAD 2.3.1, contract.yaml (auth endpoints), Interface 2.1.2 |

## 用户角色

- 未登录用户（`guestGuard` 强制）

## 路由参数

| 参数 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `returnUrl` | `string` | Query params | `authGuard` 重定向时设置，登录成功后导航回该地址 |

## 路由守卫

| 守卫 | 路径 | 策略 |
|---|---|---|
| `guestGuard` | `auth/login` | 已认证用户禁止访问，重定向到角色专属首页 |

## 组件参数

- 无 `@Input()` / `@Output()`（独立全页面组件）

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `FormBuilder` | 创建响应式表单（`passwordForm`, `codeLoginForm`） |
| `AuthStore` | 认证状态管理：`isLoading`, `error`, `loginSuccess()`, `setUserProfile()`, `setLoading()`, `setError()` |
| `ApiService` | HTTP API 调用 |
| `SocketService` | 登录成功后建立 WebSocket 连接 |
| `Router` | 登录后导航 |
| `RouteResolver` | 静态方法 `getPostLoginRoute(profile.userType)` 决定目标路由 |

> **注意**：`ApiService` 通过拦截器自动为请求附加 `X-Request-ID`，登录响应中 `requestId` 字段可用于全链路追踪。

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `activeTab` | `'password' \| 'code'` | 密码登录 / 验证码登录 Tab 切换 |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | 联系方式类型 |
| `acceptTerms` | `boolean` | 是否接受服务条款 |
| `countdown` | `number` | 验证码发送倒计时（60秒） |
| `codeLoginStep` | `1 \| 2` | 验证码登录步骤 |
| `showAntiEnumMessage` | `boolean` | 反枚举通用提示 |

## API 契约对照

| 方法 | 端点 | 请求 DTO | 响应 DTO | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/login/password` | `LoginPasswordDto` (`contact`, `contactType`, `password`) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | 密码表单提交 |
| `POST` | `/v1/auth/login/send-code` | `LoginSendCodeDto` (`contact`, `contactType`) | `SendCodeResponseDto` (`expiresIn`) | No | 验证码登录-发送验证码 |
| `POST` | `/v1/auth/login/verify-code` | `LoginVerifyCodeDto` (`contact`, `contactType`, `code`) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | 验证码登录-验证验证码 |
| `GET` | `/v1/users/profile` | — | `{id, name, email, phone, userType, createdAt}` | Bearer | 登录成功后获取用户信息 |
| `POST` | `/v1/auth/refresh` | —（HttpOnly cookie） | `AuthResponseDto` | No | Token 刷新 |
| `POST` | `/v1/auth/logout` | — | `LogoutResponseDto` | Bearer | 退出登录 |

> **信封格式**：响应体遵循 `statusCode/message/data/timestamp/requestId` 信封格式（contract.yaml §response_envelope）。

## 认证后端映射

| 控制器 | 文件 |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

关键后端实现：
- `loginSendCode()`: 反枚举策略（不论用户是否存在均返回 200），仅 ACTIVE 用户才真正发码
- `loginPassword()`: bcrypt 密码比对，`constantTimeLoginDelay()` 防时序攻击（250-350ms 随机延迟）
- `loginVerifyCode()`: Redis 验证码 TTL=300s，更新 `lastLoginAt`
- `refreshTokens()`: Token 轮换 + 防重放攻击检测
- `logout()`: 撤销会话 + JWT 黑名单（Redis）

## 表单验证

| 表单 | 字段 | 验证规则 |
|---|---|---|
| `passwordForm` | `contact` | `contactFormatValidator`（邮箱 regex / 手机号 regex） |
| | `password` | `passwordStrengthValidator`（min 8 字符, 大写, 小写, 数字, 特殊字符） |
| `codeLoginForm` | `contact` | 同上 |
| | `code` | 6 位数字 |
| | `terms` | 必须勾选接受条款 |

## 交互流程

1. 用户访问 `/auth/login`，`guestGuard` 检查未登录则放行
2. 默认显示「密码登录」Tab（`activeTab = 'password'`）
3. 用户输入联系方式和密码，提交 → 调用 `POST /v1/auth/login/password`
4. 成功 → `AuthStore.loginSuccess()` → `ApiService.getUserProfile()` → `SocketService.connect()` → 根据角色导航
5. 如切换到「验证码登录」Tab，步骤 1：发送验证码 → 步骤 2：验证验证码
6. 验证码发送后：60 秒倒计时，按钮置灰
7. 登录成功后的路由：CUSTOMER → `/booking`, ADMIN/SUPER_ADMIN → `/admin/dashboard`

## 角色路由映射

| 用户角色 | 登录后路由 |
|---|---|
| `CUSTOMER` | `/booking` |
| `ADMIN` / `SUPER_ADMIN` | `/admin/dashboard` |

## 相关 API 限流

| 端点 | 限流策略 |
|---|---|
| `POST /v1/auth/login/send-code` | 5 次/分钟/联系方式 |
| `POST /v1/auth/login/verify-code` | 10 次/分钟/联系方式 |
| `POST /v1/auth/login/password` | 5 次/分钟/联系方式 |

## 数据来源

- contract.yaml 1.7.1
- SAD 2.3.1 (Pages 列表)
- 接口设计规范 2.1.2
- 安全架构设计文档 2.1 (JWT 双 Token), 2.3.2 (防枚举)
- piiEncryptionStrategy 6.2 (登录流程)
