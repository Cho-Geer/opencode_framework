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

### Tier 1 — 通用规范（Universal）

以下规范为框架无关的通用要求，所有后端项目必须遵守：

1. **文件分离**：每个 artifact 独立文件（controller/service/dto/guard 分离）
2. **模块化**：按业务领域划分模块，禁止循环依赖
3. **命名约定**：接口无 `I` 前缀，文件使用 `kebab-case`
4. **类型安全**：禁止 `any`，DTO 使用 class + class-validator
5. **TDD**：RED → GREEN → REFACTOR，覆盖率 ≥70%

### Tier 2 — 框架参数化规范（Framework-Parameterized）

以下规范根据项目技术栈参数化，占位符由 `project.config.json` 中的对应配置解析：

6. **事务管理**：使用 `{backend.orm.transaction}` 管理事务边界
7. **认证授权**：`{backend.auth}`
8. **限流策略**：`{backend.rate_limit}`
9. **错误处理**：`{backend.error_handler}`
10. **日志规范**：`{backend.logger}`
11. **API 文档**：`{backend.api_docs}`
12. **缓存**：`{backend.cache_pattern}`

## 占位符解析规则

占位符在项目初始化时由 `project.config.json` 解析为具体技术栈指令。各占位符的解析源映射如下：

| 占位符 | 配置路径 | 解析说明 |
|--------|---------|---------|
| `{backend.orm.transaction}` | `tech_stack.database.orm` | ORM 事务管理 API（如 `prisma.$transaction()`） |
| `{backend.auth}` | `tech_stack.auth` | 认证授权机制（机制 + 跳过/角色控制装饰器） |
| `{backend.rate_limit}` | `tech_stack.backend.framework` | 框架限流方案（多层限流：用户/时间槽/IP/全局） |
| `{backend.error_handler}` | `tech_stack.backend.framework` | 框架错误处理（全局异常过滤器 + ORM 错误映射） |
| `{backend.logger}` | `tech_stack.backend.framework` | 框架日志方案（Logger 类 + 请求拦截器） |
| `{backend.api_docs}` | `tech_stack.backend.framework` | API 文档规范（OpenAPI/Swagger 完整文档覆盖） |
| `{backend.cache_pattern}` | `tech_stack.cache` | 缓存策略（引擎 + 客户端 + 缓存模式） |

> **注意**：占位符的具体实例化值定义在 `.opencode/context/code_standards/backend-coding-standard.md` 中。本文件仅提供占位符引用框架，实际开发时应读取完整文档获取当前技术栈对应的规范细节。

## 完整文档

完整规范请参阅：[后端代码规范文档](../context/code_standards/backend-coding-standard.md)
