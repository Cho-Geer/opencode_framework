# 要件修改范围清单 (TASK-D1 输出)

## 文档信息

| 属性 | 值 |
|------|---|
| **文档版本** | 1.0.0 |
| **创建日期** | 2026-04-21 |
| **创建者** | @Architect (多智能体模式 TASK-D1) |
| **状态** | 已批准，等待执行（TASK-D2 ~ D4）|
| **设计依据** | piiEncryptionStrategy.md (TASK-D1) |

---

## 修改总览

| 编号 | 目标文件 | 修改类型 | 影响章节 | 执行任务 |
|------|---------|---------|---------|---------|
| M-1 | 安全架构设计文档.md | 升级 | § 5.1.2 敏感数据分类与加密策略 | TASK-D2 |
| M-2 | 安全架构设计文档.md | 修改 | § 2.1.1 JWT 令牌设计 | TASK-D2 |
| M-3 | 安全架构设计文档.md | 新增/确认 | bcrypt work factor | TASK-D2 |
| M-4 | 数据架构设计文档.md | 替换 | § 2.2.1 用户领域模型 (User Prisma Schema) | TASK-D3 |
| M-5 | 数据架构设计文档.md | 新增行 | § 敏感数据保护表（若存在）| TASK-D3 |
| M-6 | 接口设计规范文档.md | 新增节 | Auth 端点定义 | TASK-D4 |

---

## M-1：安全架构 § 5.1.2 邮箱加密级别升级

**文件路径**：`.qoder/context/requirements/安全架构设计文档.md`

**当前内容**（需删除）：
```
| **邮箱地址** | 中 | 应用层脱敏 | 明文存储 |
```

**修改为**：
```
| **邮箱地址** | 高 | AES-256-GCM 全字段加密 + SHA-256 哈希索引 | 三字段存储（脱敏展示/哈希索引/加密密文）|
```

**修改理由**：
- 邮箱作为注册和验证码登录的认证凭证，与手机号等价，应保持一致的高级别保护
- 符合 GDPR Art.4(1) 和 PIPL 第 4 条对个人信息的分类要求
- 防止数据库泄露时直接暴露用户身份

---

## M-2：安全架构 § 2.1.1 JWT Payload 移除 email

**文件路径**：`.qoder/context/requirements/安全架构设计文档.md`

**当前内容**（需修改）：
```typescript
interface AccessTokenPayload {
  sub: string;          // 用户ID (subject)
  email: string;        // 用户邮箱  ← 删除此行
  roles: string[];
  permissions: string[];
  iat: number;
  exp: number;
  jti: string;
}
```

**修改为**（删除 `email: string;` 行及其注释）：
```typescript
interface AccessTokenPayload {
  sub: string;           // 用户ID (subject)
  roles: string[];       // 用户角色数组
  permissions: string[]; // 细粒度权限
  iat: number;           // 签发时间
  exp: number;           // 过期时间
  jti: string;           // 令牌唯一标识
}
```

**修改理由**：
- JWT Payload 为 Base64 编码，非加密，任何持有令牌方可解码读取
- NIST SP 800-63B § 6.2 最小化原则：令牌仅携带认证必需断言
- GDPR Art.5(1)(c) 数据最小化原则

---

## M-3：安全架构 bcrypt Work Factor 确认

**文件路径**：`.qoder/context/requirements/安全架构设计文档.md`

**当前状态**（contract.yaml 已定义 rounds=12）：

| 位置 | 当前值 | 目标值 |
|-----|-------|-------|
| contract.yaml § security.data_protection.password_hashing | `bcrypt with salt rounds 12` | ✅ 已正确 |
| 安全架构设计文档.md（如有明确定义 rounds=10 的地方）| 10 | 12 |

**操作**：搜索 `rounds.*10` 或 `work.*factor.*10`，若存在则修改为 12；并在 § 5.1.2 表格中补充 bcrypt rounds 说明。

**修改理由**：
- OWASP Password Storage Cheat Sheet (2023)：bcrypt 最低 work factor 10，推荐 12
- rounds=12 约 250ms/hash，对单次登录可接受，并发场景需限流保护

---

## M-4：数据架构 § 2.2.1 User Schema 三字段替换

**文件路径**：`.qoder/context/requirements/数据架构设计文档.md`

**当前内容**（需替换）：
```prisma
model User {
  id           String        @id @default(uuid())
  name         String
  phone        String?       @unique  // ← 删除 @unique
  email        String?       @unique  // ← 删除 @unique
  ...
  @@index([phone])
  @@index([email])
}
```

**修改为**（三字段模型）：
```prisma
model User {
  id               String        @id @default(uuid())
  name             String
  // Phone 三字段（PII 加密，方案 C v4）
  phone            String?       // 脱敏展示（如 138****5678）
  phoneHash        String?       @unique  // SHA-256(phone + pepper)
  phoneEncrypted   String?       // AES-256-GCM 密文
  // Email 三字段（PII 加密，方案 C v4）
  email            String?       // 脱敏展示（如 us***@example.com）
  emailHash        String?       @unique  // SHA-256(email + pepper)
  emailEncrypted   String?       // AES-256-GCM 密文
  // 密码
  passwordHash     String?       // bcrypt 哈希（rounds=12）
  ...
  @@index([phoneHash])
  @@index([emailHash])
  @@index([userType, status])
  @@index([createdAt])
  @@index([lastLoginAt], where: raw("\"status\" = 'ACTIVE'"))
}
```

**同时更新 ERD 图**（§ 2.1 User 实体字段说明）中的 phone/email 字段描述。

**修改理由**：
- 消除 `phone @unique` / `email @unique` 与加密存储的矛盾
- 明文列存储脱敏值，不具备唯一性语义
- hash 列具有确定性，适合唯一索引和精确查找

---

## M-5：数据架构 敏感数据保护表补充 email 行

**文件路径**：`.qoder/context/requirements/数据架构设计文档.md`

**操作**：在数据架构文档中查找敏感数据保护表，若存在 phone/手机号行，补充对应的 email/邮箱行：

| 字段 | 敏感级别 | 存储方式 | 索引方式 | 展示方式 |
|-----|---------|---------|---------|---------|
| phone | 高 | AES-256-GCM 加密 (phoneEncrypted) | SHA-256 哈希 (phoneHash @unique) | 脱敏 (phone) |
| email | **高** | **AES-256-GCM 加密 (emailEncrypted)** | **SHA-256 哈希 (emailHash @unique)** | **脱敏 (email)** |
| password | 最高 | bcrypt 哈希 (passwordHash, rounds=12) | 无 | 禁止展示 |

---

## M-6：接口设计规范 补充 Auth 端点

**文件路径**：`.qoder/context/requirements/接口设计规范文档.md`

**当前内容**（接口端点设计表）：
```
| 方法 | 路径 | 描述 | 认证 | 限流 |
| POST | /v1/auth/verification-codes/send  | 发送验证码 | 否 | 5次/分钟/邮箱 |
| POST | /v1/auth/verification-codes/verify | 验证验证码 | 否 | 10次/分钟/邮箱 |
```

**新增内容**（在上方表格后追加或新建 Auth 端点章节）：

### 注册端点

| 方法 | 路径 | 描述 | 认证 | 限流 |
|------|------|------|------|------|
| POST | `/v1/auth/register/send-code` | 注册第一步：发送验证码 | 否 | 5次/分钟/contact |
| POST | `/v1/auth/register/complete` | 注册第二步：提交验证码+密码 | 否 | 10次/分钟/IP |

### 登录端点

| 方法 | 路径 | 描述 | 认证 | 限流 |
|------|------|------|------|------|
| POST | `/v1/auth/login/send-code` | 验证码登录第一步：发送验证码 | 否 | 5次/分钟/contact |
| POST | `/v1/auth/login/verify-code` | 验证码登录第二步：验证并获取令牌 | 否 | 10次/分钟/contact |
| POST | `/v1/auth/login/password` | 密码登录 | 否 | 5次/分钟/contact |

**同时新增以下 DTO 定义**（参见 contract.yaml § pii_encryption_contract.auth_endpoints）：
- `RegisterSendCodeDto` 
- `RegisterCompleteDto`
- `LoginSendCodeDto`
- `LoginVerifyCodeDto`
- `LoginPasswordDto`

**修改理由**：
- 注册和登录是核心业务流程，接口设计规范文档中缺失这些端点定义
- 补充后，Coder-BE 可直接基于此规范实现，无需猜测接口设计

---

## 修改执行顺序（DAG）

```
TASK-D1（已完成）─────┬─► TASK-D2（安全架构）─────┐
                      │                          ├─► TASK-D4（接口规范）─► TASK-D5（审查）─► TASK-D6（锁定）
                      └─► TASK-D3（数据架构）─────┘
```

- **TASK-D2 与 TASK-D3 并行执行**（无相互依赖）
- **TASK-D4 在 D2+D3 完成后执行**（接口规范引用安全/数据架构定义）
- **TASK-D5** @Guardian 审查所有修改后的文档
- **TASK-D6** @Orchestrator 契约锁定，更新 contract.yaml 哈希

---

*本文档为 TASK-D1 最终输出之一，配合 piiEncryptionStrategy.md 和 contract.yaml 使用。*
