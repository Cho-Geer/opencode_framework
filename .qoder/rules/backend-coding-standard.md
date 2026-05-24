---
type: model_decision
description: When working on backend code
---
# Backend Coding Standard Reference

> **See also**: [coding-standard-common.md](.qoder/rules/coding-standard-common.md) — Framework-agnostic common coding standards (naming conventions, type safety, TDD, file separation, etc.).

This document references all standards defined in `.qoder/context/code_standards/backend-coding-standard.md`.

## Applicable Scope

All tasks involving backend project development, testing, and review must comply with this standard. This document provides the coding standard reference for the project's tech stack. Each project should replace the content in `context/code_standards/backend-coding-standard.md` according to its own tech stack (NestJS, Express, Spring Boot, Go, etc.).

## Mandatory Triggering Agents

| Agent | Trigger Scenario |
|-------|---------|
| **@Coder-BE** | Any backend API development, service implementation, DTO definition, Prisma operations, backend test writing |
| **@Guardian** | Backend code review (naming, modularization, transaction management, security standards) |
| **@Architect** | Backend architecture design, module partitioning, interface contract definition |

## Core Standards Quick Reference

### Tier 1 — Universal Standards

The following standards are framework-agnostic universal requirements that all backend projects must follow:

1. **File Separation**: Each artifact in its own file (controller/service/dto/guard separated)
2. **Modularization**: Partition modules by business domain; circular dependencies are prohibited
3. **Naming Conventions**: No `I` prefix for interfaces; files use `kebab-case`
4. **Type Safety**: `any` is prohibited; DTOs use class + class-validator
5. **TDD**: RED → GREEN → REFACTOR; coverage ≥70%

### Tier 2 — Framework-Parameterized Standards

The following standards are parameterized based on the project's tech stack. Placeholders are resolved from the corresponding configuration in `project.config.json`:

6. **Transaction Management**: Use `{backend.orm.transaction}` to manage transaction boundaries
7. **Authentication & Authorization**: `{backend.auth}`
8. **Rate Limiting Strategy**: `{backend.rate_limit}`
9. **Error Handling**: `{backend.error_handler}`
10. **Logging Standards**: `{backend.logger}`
11. **API Documentation**: `{backend.api_docs}`
12. **Caching**: `{backend.cache_pattern}`

## Placeholder Resolution Rules

Placeholders are resolved to specific tech stack directives from `project.config.json` during project initialization. The resolution source mapping for each placeholder is as follows:

| Placeholder | Config Path | Resolution Description |
|--------|---------|---------|
| `{backend.orm.transaction}` | `tech_stack.database.orm` | ORM transaction management API (e.g., `prisma.$transaction()`) |
| `{backend.auth}` | `tech_stack.auth` | Authentication & authorization mechanism (mechanism + skip/role-control decorators) |
| `{backend.rate_limit}` | `tech_stack.backend.framework` | Framework rate limiting solution (multi-layer: user/time-slot/IP/global) |
| `{backend.error_handler}` | `tech_stack.backend.framework` | Framework error handling (global exception filter + ORM error mapping) |
| `{backend.logger}` | `tech_stack.backend.framework` | Framework logging solution (Logger class + request interceptor) |
| `{backend.api_docs}` | `tech_stack.backend.framework` | API documentation standard (full OpenAPI/Swagger documentation coverage) |
| `{backend.cache_pattern}` | `tech_stack.cache` | Caching strategy (engine + client + cache pattern) |

> **Note**: The specific instantiated values for placeholders are defined in `.qoder/context/code_standards/backend-coding-standard.md`. This file only provides the placeholder reference framework. During actual development, read the full document for the standard details corresponding to the current tech stack.

## Full Documentation

For the complete specification, see: [Backend Coding Standard Document](.qoder/context/code_standards/backend-coding-standard.md)
