# 首页/重定向页（HomeRedirectPage）

## 基本信息

| 字段 | 值 |
|---|---|
| **页面名称** | 首页（根路径重定向） |
| **路由路径** | `/` |
| **布局** | `AppLayoutComponent` |
| **惰性加载** | `app.routes.ts` 顶层路由 |
| **组件** | 无（`redirectTo: 'booking'`） |
| **设计依据** | 架构惯例推断（SAD 未单独定义首页） |

## 用户角色

- CUSTOMER（ADMIN/SUPER_ADMIN 不会访问到此路径）

## 路由参数

- 无

## 路由守卫

| 守卫 | 路径 | 策略 |
|---|---|---|
| `authGuard` | 父级 AppLayout 路径 | 未认证 → 重定向 `/auth/login?returnUrl=/` |
| `roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })` | 子路由 | ADMIN/SUPER_ADMIN → 重定向 `/admin/dashboard` |

## 行为说明

- `app.routes.ts` 中定义为 `{ path: '', redirectTo: 'booking', pathMatch: 'full' }`
- 访问 `/` 自动 302 重定向到 `/booking`
- 等价于进入预约创建流程的「选择服务」步骤
- 在 `AppLayout` 外壳中渲染

## 功能要点

| 项目 | 说明 |
|---|---|
| 核心职能 | 作为根路径入口，重定向到 CUSTOMER 的核心功能页（预约列表 → 新建预约） |
| 导航方式 | `redirectTo` Angular 路由重定向，非 HTTP 302 |

## 数据来源

- SAD 2.3.1（页面列表隐含根路由行为）
- Angular 路由惯例（`path: ''` → `redirectTo`）
