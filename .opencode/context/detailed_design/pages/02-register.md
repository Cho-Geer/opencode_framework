# 注册页（RegisterPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 注册页 |
| **路由路径** | `/auth/register` |
| **布局** | 无布局外壳（Standalone 页面） |
| **惰性加载** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` |
| **组件** | `RegisterComponent` (`src/app/features/auth/register/register.component.ts`) |
| **设计依据** | SAD 2.3.1, contract.yaml (auth endpoints), 测试策略（E2E 注册场景）, piiEncryptionStrategy 6.1 |

## 用户角色

- 未登录用户（`guestGuard` 强制）

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

| 守卫 | 路径 | 策略 |
|---|---|---|
| `guestGuard` | `auth/register` | 已认证用户禁止访问，重定向到角色专属首页 |

## 组件参数

- 无 `@Input()` / `@Output()`（独立全页面组件）

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `FormBuilder` | 创建步骤响应式表单（`step1Form` 联系方式, `step2Form` 验证码+密码+姓名） |
| `AuthStore` | `isLoading`, `error`, `loginSuccess()`, `setUserProfile()`, `setLoading()`, `setError()` |
| `ApiService` | `registerSendCode()`, `registerComplete()`, `getUserProfile()` |
| `SocketService` | 注册成功后建立 WebSocket 连接 |
| `Router` | 注册后导航 |
| `RouteResolver` | 静态方法 `getPostLoginRoute(profile.userType)` |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `currentStep` | `1 \| 2` | Step 1: 发送验证码（联系方式输入）, Step 2: 完成注册（验证码+密码+姓名） |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | 联系方式类型 |
| `acceptTerms` | `boolean` | 是否接受服务条款 |
| `countdown` | `number` | 验证码发送倒计时（60秒） |

## API 契约对照

> **响应信封**：所有成功的 API 响应由 ResponseInterceptor 包装为统一信封格式 `{ statusCode, message, data, timestamp, requestId }`。下表中"响应"列仅描述 `data` 字段内部结构，信封外层隐式适用。

| 方法 | 端点 | 请求 DTO | 响应 DTO | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/register/send-code` | `RegisterSendCodeDto` (`contact`*, `contactType`*) | `SendCodeResponseDto` (`maskedContact`, `expiresIn`) | No | Step 1 发送验证码 |
| `POST` | `/v1/auth/register/complete` | `RegisterCompleteDto` (`contact`*, `contactType`*, `code`*, `password`*, `name`*) | `AuthResponseDto` (`accessToken`, `expiresIn`, `tokenType`) | No | Step 2 完成注册 |
| `GET` | `/v1/users/profile` | — | `{id, name, email, phone, userType, createdAt}` | Bearer | 注册成功后获取用户信息 |

> **信封格式**：`POST /v1/auth/register/complete` 响应体遵循 `statusCode/data/timestamp/requestId` 信封格式。

## 认证后端映射

| 控制器 | 文件 |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

关键后端实现：
- `registerSendCode()`: 哈希联系方式+pepper 查重，生成 6 位验证码存 Redis (`VERIFICATION_CODE_TTL=300s`)，通过邮件服务发送
- `registerComplete()`: 验证 Redis 验证码，重新查重，AES-256-GCM 加密 PII，SHA-256 哈希索引，bcrypt(rounds=12) 加密密码，创建用户（三字段存储模型）

## 表单验证

| 步骤 | 字段 | 验证规则 |
|---|---|---|
| Step 1 | `contact` | `contactFormatValidator`（邮箱 regex / 手机号 regex） |
| Step 2 | `code` | 6 位数字 |
| | `password` | `passwordStrengthValidator`（min 8 字符, 大写, 小写, 数字, 特殊字符） |
| | `confirmPassword` | `passwordMatchValidator`（跨字段验证与 password 一致） |
| | `name` | 非空字符串 |

## 交互流程

1. 用户访问 `/auth/register`，`guestGuard` 检查
2. **Step 1**（`currentStep = 1`）：输入联系方式（手机/邮箱），选择联系类型，勾选接受条款 → 点击「发送验证码」
3. 调用 `send-code` 端点 → 成功显示 `maskedContact`，验证码输入框出现，按钮进入 60 秒倒计时
4. **Step 2**（`currentStep = 2`）：输入验证码 + 密码 + 确认密码 + 姓名 → 提交
5. 调用 `register-complete` 端点 → 返回 JWT
6. `AuthStore.loginSuccess()` → `getUserProfile()`（使用注册接口返回的 `accessToken`，已通过 `AuthInterceptor` 自动附加，调用 `/v1/users/profile`）→ `SocketService.connect()` → 导航至角色专属首页
7. 注册后默认角色：`CUSTOMER`

## 相关 API 限流

| 端点 | 限流策略 |
|---|---|
| `POST /v1/auth/register/send-code` | 5 次/分钟/联系方式 |
| `POST /v1/auth/register/complete` | 10 次/分钟/IP |

## 错误处理

| 场景 | HTTP 状态码 | 前端行为 |
|---|---|---|
| 验证码过期/无效 | 400 | 提示重新发送验证码 |
| 联系方式已注册 | 409 | 提示已有账户，引导至登录页 |
| 并发注册(同一联系方式) | 409 | 提示已有账户 |
| 限流 | 429 | 提示操作过于频繁，请稍后再试 |

## 数据来源

- contract.yaml 1.7.1
- SAD 2.3.1
- piiEncryptionStrategy 6.1 (注册流程)
- 测试策略（E2E 注册场景）
- 数据架构设计文档 2.2.1 (User 三字段存储模型)
