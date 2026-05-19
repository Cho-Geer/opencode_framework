---
trigger: always_on
alwaysApply: true
---
# 后端代码规范引用

> **参见**：[coding-standard-common.md](coding-standard-common.md) — 框架无关的通用编码规范（命名约定、类型安全、TDD、文件分离等）。

本文档引用 `.opencode/context/code_standards/backend-coding-standard.md` 中的全部规范。

## 适用范围

所有涉及后端项目的开发、测试、审查任务必须遵循该规范。本文档为项目技术栈的代码规范引用，各项目应根据自身技术栈（NestJS, Express, Spring Boot, Go, etc.）替换 `context/code_standards/backend-coding-standard.md` 中的内容。

## 强制触发 Agent

| Agent | 触发场景 |
|-------|---------|
| **@Coder-BE** | 任何后端 API 开发、服务编写、DTO 定义、Prisma 操作、后端测试编写 |
| **@Guardian** | 后端代码审查（命名、模块化、事务管理、安全规范） |
| **@Architect** | 后端架构设计、模块划分、接口契约定义 |

## 核心规范速查

1. **文件分离**：每个 NestJS artifact 独立文件（controller/service/dto/guard 分离）
2. **模块化**：按业务领域划分模块，禁止循环依赖
3. **命名约定**：接口无 `I` 前缀，文件使用 `kebab-case`
4. **事务管理**：使用 `prisma.$transaction()` 管理事务边界
5. **类型安全**：禁止 `any`，DTO 使用 class + class-validator
6. **认证授权**：JWT + Passport，`@Public()` 跳过认证，`@Roles()` 角色控制
7. **限流策略**：多层限流（用户/时间槽/IP/全局）
8. **错误处理**：统一使用 `GlobalExceptionFilter`，映射 Prisma 错误
9. **日志规范**：使用 NestJS Logger 类，LoggingInterceptor 自动记录请求
10. **Swagger**：所有端点必须有完整 OpenAPI 文档
11. **TDD**：RED → GREEN → REFACTOR，覆盖率 ≥70%
12. **缓存**：Redis Cache-Aside 模式，write-through 会话缓存

## 完整文档

完整规范请参阅：[后端代码规范文档](../context/code_standards/backend-coding-standard.md)
