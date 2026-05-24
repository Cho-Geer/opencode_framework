# 隐私政策页（PrivacyPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 隐私政策 |
| **路由路径** | `/legal/privacy` |
| **布局** | 无布局外壳（Standalone 页面） |
| **惰性加载** | `features/legal/legal.routes.ts` → `LEGAL_ROUTES` |
| **组件** | `PrivacyComponent` (`src/app/features/legal/privacy.component.ts`) |
| **设计依据** | SAD 2.3.1, 安全架构设计文档 9（GDPR/PIPL 合规） |

## 用户角色

- 公开访问（无需认证）

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

- 无

## 组件参数

- 无 `@Input()` / `@Output()`
- 无服务注入

## API 契约对照

- 无 API 调用（纯静态页面）

## 交互流程

1. 用户直接访问 `/legal/privacy` 或在注册页点击「隐私政策」链接跳转
2. 页面展示隐私政策内容

## 合规关联

| 合规要求 | 说明 |
|---|---|
| GDPR | 数据最小化（JWT 不含 PII），数据可访问/更正/删除权 |
| PIPL | PII 分类加密（三字段存储模型） |
| 安全架构 9 | 隐私政策合规说明 |

## 数据来源

- SAD 2.3.1
- 安全架构设计文档 9（GDPR/PIPL 合规策略）
- piiEncryptionStrategy（PII 加密策略概述）
