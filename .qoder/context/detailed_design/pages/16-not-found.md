# 404 页面（NotFoundPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 404 未找到 |
| **路由路径** | `**`（通配符，最后一条路由规则） |
| **布局** | 无布局外壳（Standalone 页面） |
| **组件** | `NotFoundPageComponent` (`src/app/shared/pages/not-found-page/not-found-page.component.ts`) |
| **设计依据** | Angular 路由惯例（通配符路由） |

## 用户角色

- 公开访问

## 路由参数

- 无（通配符路由不传递参数）

## 路由守卫

- 无

## 组件参数

- 无 `@Input()` / `@Output()`

## 注入服务

| 服务 | 用途 |
|---|---|
| `Router` | `goHome()` → 导航至 `/booking` |

## API 契约对照

- 无 API 调用

## 交互流程

1. 用户访问不存在的路径 → 匹配 `**` 通配符
2. 显示 404 提示页面
3. 点击「返回首页」→ `goHome()` → `router.navigate(['/booking'])`

## 数据来源

- Angular 路由惯例
