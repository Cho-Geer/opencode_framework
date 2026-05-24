# 服务条款页（TermsPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 服务条款 |
| **路由路径** | `/legal/terms` |
| **布局** | 无布局外壳（Standalone 页面） |
| **惰性加载** | `features/legal/legal.routes.ts` → `LEGAL_ROUTES` |
| **组件** | `TermsComponent` (`src/app/features/legal/terms.component.ts`) |
| **设计依据** | SAD 2.3.1（法律页面），注册页"接受服务条款"的引用目标 |

## 用户角色

- 公开访问（无需认证）

## 路由参数

- 无路由参数
- 无查询参数

## 路由守卫

- 无

## 组件参数

- 无 `@Input()` / `@Output()`
- 无服务注入（仅导入 `RouterModule` 用于模板内链接）

## API 契约对照

- 无 API 调用（纯静态页面）

## 交互流程

1. 用户直接访问 `/legal/terms` 或在注册页点击「服务条款」链接跳转
2. 页面展示服务条款内容

## 数据来源

- SAD 2.3.1（Pages 列表 — 推断的法律页面）
