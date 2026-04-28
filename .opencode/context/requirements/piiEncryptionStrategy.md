# PII 加密策略设计文档 (方案 C v4)

## 文档信息

| 属性 | 值 |
|------|---|
| **文档版本** | 1.0.0 |
| **创建日期** | 2026-04-21 |
| **最后更新** | 2026-04-21 |
| **文档状态** | 已基线化 |
| **作者** | @Architect (多智能体模式 TASK-D1) |
| **关联任务** | TASK-D1：PII 加密策略设计 + 要件修改前置依据 |

---

## 1. 背景与目标

本文档为**方案 C v4**（PII 字段级加密）的架构设计决策记录（ADR），作为后续六项要件文档修改的唯一技术依据。

### 1.1 驱动需求

注册/登录流程的业务约束如下：

- **注册**：必须先通过手机或邮箱接收验证码（强制），再设置密码（强制）
- **登录**：支持两种方式——（A）验证码登录、（B）密码登录，二选一

上述约束意味着：
1. `phone` 或 `email` 必须可用于**精确查找**（验证码发送目标）
2. 同时需要**唯一性保证**（防止重复注册）
3. 同时需要**保密性**（存储不得暴露明文 PII）

以上三个约束相互矛盾，必须通过**三字段模型**解决。

---

## 2. 三字段模型设计

### 2.1 字段定义

每个 PII 字段（phone、email）拆分为三个物理列：

| 逻辑概念 | 物理列名 | 存储内容 | 用途 |
|---------|---------|---------|------|
| 明文脱敏展示 | `phone` / `email` | 中间段掩码字符串 | 前端展示（如 `138****5678`）|
| 唯一性哈希 | `phoneHash` / `emailHash` | SHA-256(原文 + pepper) | 唯一索引 + 精确查找 |
| 加密密文 | `phoneEncrypted` / `emailEncrypted` | AES-256-GCM 密文 | 解密还原原文（合规需要时）|

### 2.2 查找流程

```
用户输入原始手机号/邮箱
  │
  ├─► SHA-256(输入 + PEPPER) → hash
  │     └─► WHERE phoneHash = hash   （精确匹配，O(1) 索引查询）
  │
  └─► 找到记录后，解密 phoneEncrypted → 原文（仅授权场景使用）
```

### 2.3 唯一性约束

```prisma
// 方案：移除 @unique 约束（明文列不具备唯一性语义）
// 改为对 hash 列建立唯一索引
phoneHash       String?  @unique  // SHA-256(phone + pepper)
emailHash       String?  @unique  // SHA-256(email + pepper)
```

**理由**：明文列存储的是掩码字符串，不适合 @unique；hash 列具有确定性、碰撞概率极低（2^256），适合唯一索引。

---

## 3. 邮箱加密级别升级决策

### 3.1 当前状态（偏差）

```
安全架构设计文档 § 5.1.2 当前定义：
  邮箱地址 | 中 | 应用层脱敏 | 明文存储
```

### 3.2 升级理由

| 考量维度 | 分析 |
|---------|------|
| **业务功能** | 邮箱用于发送验证码登录，属于认证凭证，与手机号同等重要 |
| **GDPR/PIPL** | 邮箱地址在 GDPR Art.4(1) 和 PIPL 第 4 条中均明确属于个人信息 |
| **数据泄露风险** | 明文存储的邮箱若数据库泄露，可直接导致用户识别和钓鱼攻击 |
| **对称性原则** | 手机号已定义为"高/AES-256-GCM"，邮箱作为等价认证手段应保持一致 |
| **OWASP TOP 10** | A02:2021 Cryptographic Failures 要求对 PII 进行加密保护 |

### 3.3 升级结论

**邮箱敏感级别：中 → 高**
**加密策略：应用层脱敏 → AES-256-GCM 全字段加密（与手机号一致）**

---

## 4. JWT Payload 设计

### 4.1 当前状态（偏差）

```typescript
// 安全架构设计文档 § 2.1.1 当前定义
interface AccessTokenPayload {
  sub: string;     // 用户ID
  email: string;   // ← 问题：JWT 默认不加密，email 明文暴露
  roles: string[];
  ...
}
```

### 4.2 移除 email 字段的理由

| 依据 | 说明 |
|------|------|
| **JWT 非加密** | JWT 仅签名（HMAC-SHA256），Payload 为 Base64 编码，任何持有令牌方均可解码读取 |
| **最小化原则** | NIST SP 800-63B § 6.2："令牌中仅包含完成操作所需的最少断言" |
| **GDPR 数据最小化** | GDPR Art.5(1)(c)："个人数据的处理应限于实现处理目的所必要的范围" |
| **功能冗余** | 业务层如需 email，可通过 `sub`（userId）查询数据库，无需在令牌中携带 |

### 4.3 修改后的 Payload 设计

```typescript
// 修改后：移除 email，保留认证必需字段
interface AccessTokenPayload {
  sub: string;           // 用户ID（唯一标识）
  roles: string[];       // 用户角色数组
  permissions: string[]; // 细粒度权限（可选，按需保留）
  iat: number;           // 签发时间
  exp: number;           // 过期时间
  jti: string;           // 令牌唯一标识（支持黑名单）
}
```

---

## 5. 密码哈希参数

### 5.1 bcrypt Work Factor

| 参数 | 当前值 | 目标值 | 依据 |
|------|-------|-------|------|
| `bcrypt rounds` | 10 | **12** | OWASP Password Storage Cheat Sheet (2023) § bcrypt: "minimum work factor of 10, recommend 12" |

### 5.2 影响分析

| 指标 | rounds=10 | rounds=12 | 说明 |
|------|----------|----------|------|
| 哈希时间 | ~65ms | ~250ms | 合理范围，单次登录可接受 |
| 暴力破解成本 | 基准 | 4× | 2^2 倍算力提升 |
| 服务器 CPU | 基准 | 4× | 并发登录场景需压测 |

**结论**：rounds=12 是安全性与性能的最优平衡点，符合 OWASP 2023 最佳实践。

---

## 6. 验证码流程规范

### 6.1 注册流程（两步强制）

```
Step 1: 发送验证码
  POST /v1/auth/register/send-code
  Body: { contact: string, contactType: 'phone' | 'email' }
  → Redis 存储: key=verify:{contactHash}, value={code, type:'REGISTER', expireAt}, TTL=5min

Step 2: 完成注册
  POST /v1/auth/register/complete
  Body: { contact, contactType, code, password, name }
  → 验证 Redis 验证码 → 创建用户（三字段模型）→ 删除 Redis key → 返回 JWT
```

### 6.2 登录流程（二选一）

```
方式 A - 验证码登录:
  POST /v1/auth/login/send-code
  Body: { contact, contactType }
  → 查找用户（via hash）→ 发送验证码

  POST /v1/auth/login/verify-code
  Body: { contact, contactType, code }
  → 验证码校验 → 返回 JWT 双令牌

方式 B - 密码登录:
  POST /v1/auth/login/password
  Body: { contact, contactType, password }
  → 查找用户（via hash）→ bcrypt.compare → 返回 JWT 双令牌
```

---

## 7. 加密密钥管理

### 7.1 密钥体系

| 密钥名 | 用途 | 存储位置 | 轮换周期 |
|-------|------|---------|---------|
| `PII_ENCRYPTION_KEY` | AES-256-GCM 加密/解密 PII 字段 | 环境变量 / K8s Secret | 每年 |
| `PII_HASH_PEPPER` | SHA-256 哈希的 pepper 值 | 环境变量 / K8s Secret | 永久（一旦设置不可更改） |
| `JWT_ACCESS_SECRET` | Access Token 签名 | 环境变量 / K8s Secret | 每90天 |
| `JWT_REFRESH_SECRET` | Refresh Token 签名 | 环境变量 / K8s Secret | 每90天 |

### 7.2 哈希 Pepper 不可变性

`PII_HASH_PEPPER` **不可轮换**，原因：一旦修改，所有已存储的 hash 值失效，用户将无法登录。如需变更，必须全量迁移（解密全部 `*Encrypted` 字段 → 重新计算 hash）。

---

## 8. 迁移兼容性说明

若现有数据库中已有明文 phone/email 数据，迁移步骤：

1. 为 User 表添加 `phoneHash`, `phoneEncrypted`, `emailHash`, `emailEncrypted`, `passwordHash` 列
2. 全量读取现有 phone/email → 计算 hash + 加密 → 写入新列
3. 将 `phone` / `email` 列改为存储脱敏值（或保留为空）
4. 移除 `phone @unique` / `email @unique` → 添加 `phoneHash @unique` / `emailHash @unique`

---

## 9. 要件修改范围摘要

本设计作为以下六项修改的依据：

| 修改编号 | 目标文件 | 修改内容摘要 |
|---------|---------|------------|
| M-1 | 安全架构设计文档.md § 5.1.2 | 邮箱敏感级别中→高，策略升级为 AES-256-GCM |
| M-2 | 安全架构设计文档.md § 2.1.1 | AccessTokenPayload 移除 email 字段 |
| M-3 | 数据架构设计文档.md § 2.2.1 | User Schema 替换为三字段模型（+5 新列，+passwordHash）|
| M-4 | 数据架构设计文档.md § 8.1 | 敏感数据保护表补充 email 行 |
| M-5 | 接口设计规范文档.md § 认证端点 | 补充 4 个 Auth 端点（注册2个 + 登录2个）|
| M-6 | 安全架构设计文档.md (bcrypt) | bcrypt rounds 10 → 12 |

---

*本文档为要件修改的唯一技术依据，所有修改必须与本设计保持一致。*
