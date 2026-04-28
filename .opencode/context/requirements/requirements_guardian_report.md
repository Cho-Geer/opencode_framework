# 要件修改跨文档一致性审查报告

## 审查信息
- **审查者**：@Guardian (TASK-D5)
- **审查日期**：2026-04-21
- **审查范围**：TASK-D2/D3/D4 修改的 3 个要件文档 + piiEncryptionStrategy.md + contract.yaml
- **初次审查结论**：FAIL（2 个问题）
- **修复后最终结论**：**PASS**

> **修复记录**：
> - 问题 1 修复：contract.yaml `api.authentication.endpoints` 旧端点标记 DEPRECATED，新增分步端点；`api.endpoints.auth.login` 和 `register` 标记 DEPRECATED 并提供替代路径
> - 问题 2 修复：`pii_encryption_contract.auth_endpoints` 补充 `refresh` 和 `logout` 定义

---

## 维度 A：跨文档一致性

| 检查项 | 安全架构 | 数据架构 | 接口规范 | contract.yaml | 结论 |
|-------|---------|---------|---------|--------------|------|
| A1 邮箱加密级别（高/AES-256-GCM） | ✅ §5.1.2 M-1 已升级 | ✅ §8.1 M-5 已升级 | ✅ Auth 端点 hash 查找 | ✅ email_fields 完整 | ✅ |
| A2 User Schema 三字段模型 | ✅ §5.1.2 表中定义 | ✅ §2.2.1 Prisma 完整 | ✅ N/A | ✅ user_pii_model 完整 | ✅ |
| A2 §8.1 敏感数据表与 §2.2.1 一致性 | N/A | ✅ phone/email 均为三字段格式 | N/A | ✅ 一致 | ✅ |
| A3 JWT Payload 移除 email | ✅ §2.1.1 M-2 已移除 | N/A | N/A | ✅ forbidden_fields: [email, phone] | ✅ |
| A4 bcrypt rounds=12 | ✅ §5.1.2 M-3 | ✅ §8.1 + §2.2.1 | N/A | ✅ data_protection + pii_encryption | ✅ |
| A5 Auth 端点路径一致性 | N/A | N/A | ✅ 7 个端点定义完整 | ✅ 旧端点已标记 DEPRECATED，新分步端点定义完整；pii_encryption_contract 补充 refresh+logout | ✅ |

---

## 维度 B：可追溯性

| 检查项 | 结果 | 详情 |
|-------|------|------|
| B1 版本标注 | ✅ | 安全架构 v2.2.0、数据架构 v2.1.0、接口规范 v2.1.0，均有明确版本号和修改日志 |
| B2 M-1 引用设计依据 | ✅ | 引用 piiEncryptionStrategy.md § 3（邮箱加密级别升级决策） |
| B2 M-2 引用设计依据 | ✅ | 引用 NIST SP 800-63B § 6.2、GDPR Art.5(1)(c) |
| B2 M-3 引用设计依据 | ✅ | 引用 OWASP Password Storage Cheat Sheet (2023) |
| B2 M-5 引用设计依据 | ✅ | 引用 piiEncryptionStrategy.md § 2（三字段模型设计） |
| B2 M-6 引用设计依据 | ✅ | 引用 piiEncryptionStrategy.md § 6（验证码流程规范）+ requirements-modification-scope.md M-6 |

---

## 维度 C：标准合规性

| 检查项 | 结果 | 详情 |
|-------|------|------|
| C1 三字段模型完整性 | ✅ | phone/phoneHash/phoneEncrypted + email/emailHash/emailEncrypted + passwordHash 全部完整 |
| C2 DTO 定义完整性 | ✅ | RegisterSendCodeDto/RegisterCompleteDto/LoginSendCodeDto/LoginVerifyCodeDto/LoginPasswordDto/AuthResponseDto 全部完整 |
| C3 限流策略完整性（接口规范） | ✅ | 7 个端点均有限流定义 |
| C3 限流策略一致性（接口规范 vs contract.yaml） | ✅ | 修复后 pii_encryption_contract.auth_endpoints 7 个端点完整 |

---

## 发现的问题与修复记录

### 问题 1：contract.yaml 顶层 API 契约与接口规范不一致（已修复）

**状态**：✅ 已修复

**修复内容**：
- `api.authentication.endpoints`：旧端点 login/register 标记为 DEPRECATED，新增分步端点定义
- `api.endpoints.auth.login` → `login_DEPRECATED`（含 replacement 说明）
- `api.endpoints.auth.register` → `register_DEPRECATED`（含 replacement 说明）

### 问题 2：pii_encryption_contract.auth_endpoints 缺少 refresh 和 logout（已修复）

**状态**：✅ 已修复

**修复内容**：在 `pii_encryption_contract.auth_endpoints` 中补充 `refresh` 和 `logout` 定义，确保契约节自包含。

---

## 总结

**最终审查结论：PASS**

### 通过项（10/10）
- ✅ 邮箱加密级别三文档 + contract.yaml 完全一致（高/AES-256-GCM）
- ✅ User Schema 三字段模型在数据架构和 contract.yaml 中一致
- ✅ JWT Payload email 移除在安全架构和 contract.yaml 中一致
- ✅ bcrypt rounds=12 在所有文档和 contract.yaml 中一致
- ✅ 版本标注完整（v2.2.0/v2.1.0），修改日志清晰
- ✅ 设计依据引用完整（piiEncryptionStrategy.md 各章节 + NIST/GDPR/OWASP）
- ✅ 三字段模型完整性达标
- ✅ DTO 定义完整（5 个请求 DTO + 1 个响应 DTO）
- ✅ contract.yaml 旧端点已废弃，新分步端点定义完整
- ✅ pii_encryption_contract.auth_endpoints 补充 refresh + logout，自包含

**已批准**：可推进到 TASK-D6 契约锁定阶段。

---

*审查人：@Guardian*
*审查时间：2026-04-21*
*任务编号：TASK-D5*
*最终版本：修复后 PASS*

## 审查信息
- **审查者**：@Guardian (TASK-D5)
- **审查日期**：2026-04-21
- **审查范围**：TASK-D2/D3/D4 修改的 3 个要件文档 + piiEncryptionStrategy.md + contract.yaml
- **审查结论**：FAIL

---

## 维度 A：跨文档一致性

| 检查项 | 安全架构 | 数据架构 | 接口规范 | contract.yaml | 结论 |
|-------|---------|---------|---------|--------------|------|
| A1 邮箱加密级别（高/AES-256-GCM） | ✅ §5.1.2 M-1 已升级 | ✅ §8.1 M-5 已升级 | ✅ Auth 端点 hash 查找 | ✅ email_fields 完整 | ✅ |
| A2 User Schema 三字段模型 | ✅ §5.1.2 表中定义 | ✅ §2.2.1 Prisma 完整 | ✅ N/A | ✅ user_pii_model 完整 | ✅ |
| A2 §8.1 敏感数据表与 §2.2.1 一致性 | N/A | ✅ phone/email 均为三字段格式 | N/A | ✅ 一致 | ✅ |
| A3 JWT Payload 移除 email | ✅ §2.1.1 M-2 已移除 | N/A | N/A | ✅ forbidden_fields: [email, phone] | ✅ |
| A4 bcrypt rounds=12 | ✅ §5.1.2 M-3 | ✅ §8.1 + §2.2.1 | N/A | ✅ data_protection + pii_encryption | ✅ |
| A5 Auth 端点路径一致性 | N/A | N/A ✅ 7 个端点 | ✅ 7 个端点定义完整 | ⚠️ 旧 `/v1/auth/login` 和 `/v1/auth/register` 仍保留；`pii_encryption_contract.auth_endpoints` 缺少 refresh 和 logout | ❌ |

---

## 维度 B：可追溯性

| 检查项 | 结果 | 详情 |
|-------|------|------|
| B1 版本标注 | ✅ | 安全架构 v2.2.0、数据架构 v2.1.0、接口规范 v2.1.0，均有明确版本号和修改日志 |
| B2 M-1 引用设计依据 | ✅ | 引用 piiEncryptionStrategy.md § 3（邮箱加密级别升级决策） |
| B2 M-2 引用设计依据 | ✅ | 引用 NIST SP 800-63B § 6.2、GDPR Art.5(1)(c) |
| B2 M-3 引用设计依据 | ✅ | 引用 OWASP Password Storage Cheat Sheet (2023) |
| B2 M-5 引用设计依据 | ✅ | 引用 piiEncryptionStrategy.md § 2（三字段模型设计） |
| B2 M-6 引用设计依据 | ✅ | 引用 piiEncryptionStrategy.md § 6（验证码流程规范）+ requirements-modification-scope.md M-6 |

---

## 维度 C：标准合规性

| 检查项 | 结果 | 详情 |
|-------|------|------|
| C1 三字段模型完整性 | ✅ | phone/phoneHash/phoneEncrypted + email/emailHash/emailEncrypted + passwordHash 全部完整 |
| C2 DTO 定义完整性 | ✅ | RegisterSendCodeDto/RegisterCompleteDto/LoginSendCodeDto/LoginVerifyCodeDto/LoginPasswordDto/AuthResponseDto 全部完整 |
| C3 限流策略完整性（接口规范） | ✅ | 7 个端点均有限流定义 |
| C3 限流策略一致性（接口规范 vs contract.yaml） | ⚠️ | register/send-code、register/complete、login/send-code、login/verify-code、login/password 一致；refresh 和 logout 未在 pii_encryption_contract.auth_endpoints 中定义 |

---

## 发现的问题

### 问题 1：contract.yaml 顶层 API 契约与接口规范不一致（严重）

**位置**：`contract.yaml` §2 `api.authentication.endpoints`

**详情**：
contract.yaml 顶层 `api.authentication.endpoints` 仍保留旧式端点定义：
```yaml
endpoints:
  login: "POST /v1/auth/login"        # ← 旧格式
  register: "POST /v1/auth/register"  # ← 旧格式
  refresh: "POST /v1/auth/refresh"
  logout: "POST /v1/auth/logout"
```

接口规范 [M-6] 已将注册和登录拆分为分步端点：
- `POST /v1/auth/register/send-code` + `POST /v1/auth/register/complete`
- `POST /v1/auth/login/send-code` + `POST /v1/auth/login/verify-code` + `POST /v1/auth/login/password`

旧端点 `/v1/auth/login` 和 `/v1/auth/register` 已不再使用，但未从 contract.yaml 中移除或标记为 deprecated。

**修复建议**：
1. 将 `api.authentication.endpoints.login` 和 `api.authentication.endpoints.register` 标记为 `deprecated: true`，或直接替换为分步端点定义
2. 在 `pii_encryption_contract.auth_endpoints` 中补充 `refresh` 和 `logout` 端点定义，保持完整

### 问题 2：pii_encryption_contract.auth_endpoints 缺少 refresh 和 logout（中等）

**位置**：`contract.yaml` §11 `pii_encryption_contract.auth_endpoints`

**详情**：
接口规范定义了 7 个 Auth 端点，但 `pii_encryption_contract.auth_endpoints` 仅定义了 5 个（缺少 refresh 和 logout）。虽然这两个端点在 contract.yaml 顶层已有定义，但从契约完整性角度，应在 pii_encryption_contract 中也补充定义以确保自包含。

**修复建议**：
在 `pii_encryption_contract.auth_endpoints` 中补充：
```yaml
refresh:
  method: POST
  path: "/v1/auth/refresh"
  auth_required: false
  rate_limit: "10次/分钟/IP"

logout:
  method: POST
  path: "/v1/auth/logout"
  auth_required: true
  rate_limit: "无"
```

---

## 总结

**审查结论：FAIL**

### 通过项（8/10）
- ✅ 邮箱加密级别三文档 + contract.yaml 完全一致（高/AES-256-GCM）
- ✅ User Schema 三字段模型在数据架构和 contract.yaml 中一致
- ✅ JWT Payload email 移除在安全架构和 contract.yaml 中一致
- ✅ bcrypt rounds=12 在所有文档和 contract.yaml 中一致
- ✅ 版本标注完整（v2.2.0/v2.1.0），修改日志清晰
- ✅ 设计依据引用完整（piiEncryptionStrategy.md 各章节 + NIST/GDPR/OWASP）
- ✅ 三字段模型完整性达标
- ✅ DTO 定义完整（5 个请求 DTO + 1 个响应 DTO）

### 失败项（2/10）
- ❌ contract.yaml 顶层旧端点 `/v1/auth/login` 和 `/v1/auth/register` 未更新/废弃，与接口规范分步端点不一致
- ⚠️ pii_encryption_contract.auth_endpoints 缺少 refresh 和 logout 端点定义

**阻塞说明**：问题 1 为契约不一致，可能导致前后端实现偏差，必须修复后方可推进到开发阶段。

---

*审查人：@Guardian*
*审查时间：2026-04-21*
*任务编号：TASK-D5*
