---
trigger: always_on
alwaysApply: true
---
# 前端代码规范引用

> **参见**：[coding-standard-common.md](coding-standard-common.md) — 框架无关的通用编码规范（命名约定、类型安全、TDD、文件分离等）。

本文档引用 `.opencode/context/code_standards/frontend-coding-standard.md` 中的全部规范。

## 适用范围

所有涉及前端项目的开发、测试、审查任务必须遵循该规范。本文档为项目技术栈的代码规范引用，各项目应根据自身技术栈（Angular, React, Vue, etc.）替换 `context/code_standards/frontend-coding-standard.md` 中的内容。

## 核心规范速查

1. **文件分离**：禁止内联 `template`/`styles`
2. **原子设计**：Atoms → Molecules → Organisms → Layouts → Pages
3. **命名约定**：接口无 `I` 前缀，Observable 带 `$` 后缀
4. **Sass 导入**：必须使用 `@use`，禁止 `@import`
5. **样式策略**：Tailwind First，SCSS 仅作补充
6. **类型安全**：禁止 `any`
7. **模板尺寸**：单文件不超过 200 行
8. **Store 隔离**：页面注入 Store，子组件通过 `@Input()` 接收
9. **API 封装**：组件禁止直接使用 `HttpClient`
10. **延迟视图**：非首屏内容使用 `@defer`

## 完整文档

完整规范请参阅：[前端代码规范文档](../context/code_standards/frontend-coding-standard.md)
