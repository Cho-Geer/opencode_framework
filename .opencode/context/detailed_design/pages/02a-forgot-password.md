# 忘记密码页（ForgotPasswordPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 忘记密码页 |
| **路由路径** | `/auth/forgot-password` |
| **布局** | 无布局外壳（Standalone 页面） |
| **惰性加载** | `features/auth/auth.routes.ts` → `AUTH_ROUTES` (loadComponent) |
| **组件** | `ForgotPasswordComponent` (`src/app/features/auth/forgot-password/forgot-password.component.ts`) |
| **设计依据** | contract.yaml v1.6.5 (RESET-PW-001, RESET-PW-002), pii_encryption_contract.auth_endpoints |

## 用户角色

- 未登录用户（`guestGuard` 强制）

## 路由参数

| 参数 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `returnUrl` | `string` | Query params | 重置成功后导航回登录页，附带返回地址 |

## 路由守卫

| 守卫 | 路径 | 策略 |
|---|---|---|
| `guestGuard` | `auth/forgot-password` | 已认证用户禁止访问，重定向到角色专属首页 |

## 组件参数

- 无 `@Input()` / `@Output()`（独立全页面组件）

## 注入服务与状态管理

| 服务/Store | 用途 |
|---|---|
| `FormBuilder` | 创建响应式表单（`sendCodeForm`, `resetPasswordForm`） |
| `AuthStore` | 认证状态管理：`isLoading`, `error`, `setLoading()`, `setError()` |
| `ApiService` | HTTP API 调用（`sendResetPasswordCode()`, `verifyAndResetPassword()`） |
| `Router` | 重置成功后导航回 `/auth/login` |

## 本地信号

| 信号 | 类型 | 说明 |
|---|---|---|
| `step` | `1 \| 2` | 步骤 1：发送验证码，步骤 2：验证验证码并重置密码 |
| `contactType` | `ContactType.EMAIL \| ContactType.PHONE` | 联系方式类型 |
| `contact` | `string` | 用户输入的联系方式 |
| `countdown` | `number` | 验证码发送倒计时（60秒） |
| `showAntiEnumMessage` | `boolean` | 反枚举通用提示（用户不存在时也返回 200） |
| `resetSuccess` | `boolean` | 密码重置成功状态（显示成功提示 + 跳转到登录页按钮） |

## API 契约对照

| 方法 | 端点 | 请求 DTO | 响应 DTO | 鉴权 | 调用时机 |
|---|---|---|---|---|---|
| `POST` | `/v1/auth/reset-password/send-code` | `ResetPasswordSendCodeDto` (`contact`, `contactType`) | `SendCodeResponseDto` (`expiresIn`) | No | 步骤 1：发送验证码 |
| `POST` | `/v1/auth/reset-password/verify` | `ResetPasswordVerifyDto` (`contact`, `contactType`, `code`, `newPassword`) | `{message}` | No | 步骤 2：验证验证码并重置密码 |

## 认证后端映射

| 控制器 | 文件 |
|---|---|
| `AuthController` | `src/modules/auth/auth.controller.ts` (route prefix: `"auth"`) |
| `AuthService` | `src/modules/auth/auth.service.ts` |

关键后端实现：
- `resetPasswordSendCode()`: 反枚举策略（不论用户是否存在均返回 200），仅 ACTIVE 用户才真正发码
- `resetPasswordVerify()`: Redis 验证码 TTL=300s，验证通过后更新 `passwordHash`（bcrypt rounds=12），同时吊销所有 Refresh Token（强制重新登录）

## 表单验证

| 表单 | 字段 | 验证规则 |
|---|---|---|
| `sendCodeForm` | `contact` | `contactFormatValidator`（邮箱 regex / 手机号 regex） |
| `resetPasswordForm` | `code` | 6 位数字 |
| | `newPassword` | `passwordStrengthValidator`（min 8 字符, 大写, 小写, 数字, 特殊字符） |
| | `confirmPassword` | 必须与 `newPassword` 匹配 |

## 交互流程

1. 用户访问 `/auth/forgot-password`，`guestGuard` 检查未登录则放行
2. **步骤 1**：用户输入联系方式（邮箱或手机号），选择 `contactType`
3. 点击「发送验证码」→ 调用 `POST /v1/auth/reset-password/send-code`
4. 后端反枚举：不论用户是否存在，均返回 200（防止用户枚举攻击）
5. 验证码发送后：60 秒倒计时，按钮置灰
6. **步骤 2**：用户输入收到的 6 位验证码、新密码、确认密码
7. 点击「重置密码」→ 调用 `POST /v1/auth/reset-password/verify`
8. **成功** → `resetSuccess = true`，显示成功提示 + 「返回登录」按钮 → 导航 `/auth/login`
9. **失败** → 显示错误信息（验证码过期 / 用户不存在）

## 安全性说明

| 机制 | 说明 |
|---|---|
| 反用户枚举 | `send-code` 端点不论用户是否存在均返回 200，防止攻击者通过 API 响应判断用户是否存在 |
| 验证码 TTL | Redis 存储，300 秒过期，一次性使用 |
| Token 吊销 | 密码重置成功后，后端吊销该用户所有 Refresh Token，强制所有设备重新登录 |
| 限流 | `send-code`: 5 次/分钟/联系方式；`verify`: 10 次/分钟/联系方式 |

## 相关 API 限流

| 端点 | 限流策略 |
|---|---|
| `POST /v1/auth/reset-password/send-code` | 5 次/分钟/联系方式 |
| `POST /v1/auth/reset-password/verify` | 10 次/分钟/联系方式 |

## 数据来源

- contract.yaml 1.7.1（RESET-PW-001, RESET-PW-002）
- pii_encryption_contract.auth_endpoints（reset_password_send_code, reset_password_verify）
- 安全架构设计文档 2.3.2（防枚举策略）
- piiEncryptionStrategy 6.x（密码重置流程）
