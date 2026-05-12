# 预约系统 - Angular 前端代码规范文档

## 文档信息

| 属性 | 值 |
| :--- | :--- |
| **文档版本** | 1.2.0（§1.2 新增 multi-slot-picker 分子组件说明） |
| **创建日期** | 2026-04-15 |
| **更新日期** | 2026-05-11 |
| **适用项目** | booking-frontend (Angular v21+) |
| **文档状态** | 已基线化 |
| **关联文档** | 系统架构设计文档(SAD)、接口设计规范文档、数据架构设计文档、安全架构设计文档、global-ui-spec.md v3.0.0 |
| **存放位置** | `.opencode/context/code_standards/frontend-coding-standard.md` |

---

## 1. 核心原则

### 1.1 关注点分离 (Separation of Concerns)

每个文件只负责一件事。组件逻辑、模板、样式必须物理分离。

| 文件类型 | 职责 | 命名规范 |
| :--- | :--- | :--- |
| `*.component.ts` | 组件逻辑、依赖注入、状态订阅 | `kebab-case.component.ts` |
| `*.component.html` | 组件模板、DOM 结构 | `kebab-case.component.html` |
| `*.component.scss` | 组件私有样式 | `kebab-case.component.scss` |
| `*.service.ts` | 业务逻辑、API 通信、状态管理 | `kebab-case.service.ts` |
| `*.store.ts` | NgRx SignalStore 状态定义 | `kebab-case.store.ts` |
| `*.dto.ts` | 数据传输对象、类型定义 | `kebab-case.dto.ts` |

**强制规则**：**禁止**在 `@Component` 装饰器中使用 `template` 或 `styles` 内联字符串。

```typescript
// 正确
@Component({
  templateUrl: './my-feature.component.html',
  styleUrls: ['./my-feature.component.scss']
})
```

### 1.2 原子设计分层 (Atomic Design)

组件必须按原子设计方法论组织，严格遵循层级依赖：

- **Atoms（原子）**：不可再分的基础组件（Button, Input, Modal），不依赖任何其他组件
- **Molecules（分子）**：可复用的功能组件（LoginForm, TimeSlotGrid, ~~MultiSlotPicker~~ [DEPRECATED]），只能依赖原子
- **Organisms（有机体）**：完整功能区块（BookingLeftPanel），可依赖分子和原子
- **Layouts（布局）**：页面布局骨架（AppLayout），可依赖有机体、分子、原子
- **Pages（页面）**：路由入口和数据获取，可依赖布局和有机体，**禁止**直接依赖分子和原子

> **注意**：原 Atomic Design 中的 "Templates" 在本项目中重命名为 "Layouts"，以避免与 Angular 模板概念混淆。

**新增共享组件（v1.2.0）**：
| 组件 | 层级 | 描述 |
|:---|:---|:---|
| `app-search-input` | 原子 | 带防抖（300ms）的搜索输入框，支持自动完成建议下拉 |
| `app-filter-bar` | 分子 | 筛选栏容器，含 ng-content 插槽，支持溢出可见（overflow:visible） |
| `app-table-wrapper` | 分子 | 表格容器，统一表格布局、加载态和空态 |
| `app-dropdown`（增强） | 原子 | 增强版下拉选择器，支持 `[ngModel]` 绑定和 `appendTo="body"` |
| `app-modal`（增强） | 原子 | 封装 PrimeNG `p-dialog` 的模态框组件，用于统一弹窗样式 |

**有机体归属规则**：
- 领域专属的 Organisms 保留在 `features/*/organisms/`
- 跨领域复用的 Organisms 放置在 `shared/organisms/`

---

## 2. 项目目录结构

```
src/
├── app/
│   ├── core/                           # 核心单例服务与全局配置
│   │   ├── guards/                      # 路由守卫 (auth.guard.ts)
│   │   ├── interceptors/                # HTTP 拦截器 (auth.interceptor.ts)
│   │   ├── services/                    # 全局服务 (api.service.ts)
│   │   └── config/                      # 环境配置 (app.config.ts)
│   ├── features/                        # 业务功能模块 (按领域划分)
│   │   ├── auth/                        # 认证领域
│   │   │   ├── pages/                   # 页面组件
│   │   │   ├── organisms/               # 有机体组件 (领域专属)
│   │   │   ├── molecules/               # 分子组件 (领域专属)
│   │   │   ├── stores/                  # NgRx SignalStores
│   │   │   ├── services/                # 领域内服务
│   │   │   ├── dto/                     # 数据传输对象
│   │   │   └── auth.routes.ts           # 懒加载路由配置
│   │   ├── booking/                     # 预约领域
│   │   ├── admin/                       # 管理后台领域
│   │   └── profile/                     # 个人资料领域
│   ├── shared/                          # 共享组件 (原子 + 跨领域分子/有机体)
│   │   ├── atoms/                       # 原子组件 (跨领域复用)
│   │   ├── molecules/                   # 跨领域复用的分子组件
│   │   ├── organisms/                   # 跨领域复用的有机体组件
│   │   ├── pipes/                       # 自定义管道
│   │   └── directives/                  # 自定义指令
│   ├── layouts/                         # 布局层
│   ├── app.component.ts
│   ├── app.config.ts                    # 应用配置 (providers、拦截器注册)
│   └── app.routes.ts
├── assets/
├── environments/
├── styles/
│   ├── _variables.scss                  # SCSS 变量 (@use 导入)
│   ├── _mixins.scss                     # SCSS Mixin (@use 导入)
│   ├── _reset.scss                      # 样式重置
│   ├── _animations.scss                 # 全局动画定义
│   └── styles.scss                      # 全局样式入口
├── index.html
└── main.ts
```

---

## 3. TypeScript 与命名规范

### 3.1 命名约定

| 类型 | 命名规则 | 示例 |
| :--- | :--- | :--- |
| **文件** | `kebab-case` | `booking-form.component.ts` |
| **类** | `PascalCase` | `BookingFormComponent` |
| **接口** | `PascalCase` (**无前缀**) | `Appointment`, `UserProfile` |
| **类型别名** | `PascalCase` | `AppointmentStatus`, `UserRole` |
| **枚举** | `PascalCase`，成员 `UPPER_SNAKE_CASE` | `enum AppointmentStatus { PENDING }` |
| **常量** | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| **变量/函数** | `camelCase` | `currentUser`, `getAvailableSlots()` |
| **私有成员** | `_` 前缀 + `camelCase` | `_http`, `_destroy$` |
| **Observable** | `$` 后缀 | `appointments$`, `loading$` |
| **Signal** | 无特殊后缀 | `isLoading`, `currentUser` |

> **接口命名不使用 `I` 前缀**，遵循现代 TypeScript 社区最佳实践。

### 3.2 类型安全

**强制规则**：禁止使用 `any`。所有函数参数、返回值、变量必须有明确类型。

### 3.3 组件类结构

成员必须按以下顺序排列：
1. 依赖注入 (`inject`)
2. 输入/输出属性 (`@Input`, `@Output`)
3. 响应式状态 (`signal`, `computed`)
4. 私有属性
5. 计算属性 (`getter`)
6. 生命周期钩子
7. 公共方法
8. 私有方法

### 3.4 Angular 版本兼容性

| 特性 | 最低版本 | 本规范要求 |
|------|---------|-----------|
| `signal()` / `computed()` | Angular 16 | 必须使用 |
| `inject()` 替代构造函数 DI | Angular 14 | 必须使用 |
| `@use` 替代 `@import` (Sass) | Sass 1.23.0 / Angular 17 | **必须使用 `@use`** |
| 控制流语法 `@if` / `@for` | Angular 17 | 推荐使用 |
| `@defer` 延迟视图 | Angular 17 | 推荐使用 |

---

## 4. 模板规范 (HTML)

### 4.1 属性顺序

1. 控制流 (`@if` / `@for` / `*ngIf` / `*ngFor`)
2. `class` / `ngClass`
3. `style` / `ngStyle`
4. 普通属性 (`id`, `type`, `placeholder`)
5. 输入绑定 `[property]`
6. 事件绑定 `(event)`
7. 双向绑定 `[(ngModel)]`

### 4.2 模板表达式

- **禁止**在模板中编写复杂逻辑表达式
- 复杂计算必须放在组件的 `getter` 或 `computed` Signal 中

### 4.3 模板尺寸

- 单个模板文件**不超过 200 行**
- 超过时必须拆分为更小的分子/有机体组件

### 4.4 延迟视图优化

非首屏内容必须使用 `@defer` 实现按需加载：

```html
@defer (on viewport) {
  <app-booking-calendar [date]="selectedDate()" />
} @placeholder {
  <app-spinner />
}
```

---

## 5. SCSS 样式规范

### 5.1 Sass `@use` 强制规范

**Angular 17+ 已弃用 `@import`，必须使用 `@use`。**

```scss
// 正确
@use 'src/styles/variables' as *;
@use 'src/styles/mixins' as m;

.booking-card {
  padding: $card-padding;
  @include m.responsive-padding();
}
```

### 5.2 Tailwind CSS 优先级

样式策略为 **Tailwind First**：
- **优先使用** Tailwind 工具类完成布局、间距、颜色、字体
- **仅当** Tailwind 无法满足时（复杂动画、伪元素），才编写 SCSS
- 全局 SCSS 文件仅用于 CSS 重置、字体引入、全局 CSS 变量定义

### 5.3 BEM 命名法

仅当必须写 SCSS 时使用 BEM：

```scss
.booking-card {
  &__header { }      // 元素
  &--highlighted { } // 修饰符
}
```

### 5.4 主题变量 (CSS 自定义属性)

> ⚠️ **v3.0.0 设计系统变更**：自 2026-05-04 起，项目已从「玻璃态双系统」统一迁移至「暗色优先 Sharp Design」。以下变量反映了当前 `booking-frontend/src/styles.scss` 中 `@theme` 块的实际设计令牌。

```scss
/* ========================================
   权威来源：booking-frontend/src/styles.scss (Tailwind @theme)
   设计规范：docs/design/global-ui-spec.md v3.0.0
   ======================================== */

// 暗色优先（Default Dark Theme）
:root {
  /* 背景层级 */
  --color-bg-primary: #0c1220;      // 页面主背景（深空蓝黑）
  --color-bg-secondary: #162032;     // 卡片、导航栏、侧边栏背景
  --color-bg-tertiary: #1e293b;     // 卡片悬停/次要背景

  /* 边框 */
  --color-border: #2a3a50;          // 边框、分割线
  --color-border-light: rgba(42, 58, 80, 0.3); // 浅边框

  /* 强调色主色 */
  --color-primary: #2ecc71;         // 主强调色（按钮、链接、选中态）
  --color-primary-start: #2ecc71;   // 渐变起点
  --color-primary-end: #27ae60;     // 渐变终点
  --color-primary-solid: #2ecc71;   // 纯色

  /* 功能色 */
  --color-accent-green: #2ecc71;    // 主强调色 / 成功正向指标
  --color-accent-green-dark: #27ae60;
  --color-accent-blue: #00c6ff;     // (旧强调色，已弃用) 辅助色
  --color-accent-red: #e74c3c;      // 危险/负向指标
  --color-accent-yellow: #f39c12;   // 警告/待处理
  --color-accent-purple: #9b59b6;   // 辅助色/收入
  --color-accent-teal: #1abc9c;     // 辅助色
  --color-accent-orange: #e67e22;   // 辅助色

  /* 语义色别名 */
  --color-success: #2ecc71;
  --color-warning: #f39c12;
  --color-danger: #e74c3c;
  --color-info: #2ecc71;

  /* 文字 */
  --color-text-primary: #e2e8f0;    // 主文字色（高对比度白）
  --color-text-secondary: #94a3b8;  // 次要文字色
  --color-text-disabled: #475569;   // 禁用文字

  /* 阴影 */
  --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
  --shadow-card-hover: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.25), 0 0 15px rgba(46, 204, 113, 0.2);
  --shadow-glow-green: 0 0 15px rgba(46, 204, 113, 0.3);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.2);
  --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.3);
}

/* 亮色主题覆盖（切换至亮色模式时通过 [data-theme="light"] 应用） */
[data-theme="light"] {
  --color-bg-primary: #f8fafc;
  --color-bg-secondary: #ffffff;
  --color-bg-tertiary: #f1f5f9;
  --color-border: #e2e8f0;
  --color-border-light: rgba(226, 232, 240, 0.5);
  --color-text-primary: #1e293b;
  --color-text-secondary: #64748b;
  --color-text-disabled: #94a3b8;
  --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-card-hover: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 15px rgba(46, 204, 113, 0.2);
  --shadow-glow-green: 0 0 15px rgba(46, 204, 113, 0.3);
}
```

> **权威来源**：设计令牌的完整定义和最新值以 `booking-frontend/src/styles.scss` 和 `docs/design/global-ui-spec.md` v3.0.0 为准。本节提供编码规范上下文中的快速参考。

### 5.5 样式封装策略

- 默认使用 `ViewEncapsulation.Emulated`
- 仅在需要全局覆盖第三方组件样式时使用 `ViewEncapsulation.None`
- 组件专属动画放组件 SCSS，通用动画放全局 `styles/_animations.scss`

---

## 6. 状态管理规范 (NgRx SignalStore)

### 6.1 Store 结构

每个功能领域拥有独立的 Store：

```typescript
import { signalStore, withState, withMethods, withComputed } from '@ngrx/signals';
import { patchState } from '@ngrx/signals';
import { inject } from '@angular/core';
import { BookingService } from './booking.service';

interface BookingState {
  appointments: Appointment[];
  selectedDate: string;
  isLoading: boolean;
  error: string | null;
}

const initialState: BookingState = {
  appointments: [],
  selectedDate: new Date().toISOString().split('T')[0],
  isLoading: false,
  error: null,
};

export const BookingStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ appointments, isLoading, error }) => ({
    hasAppointments: computed(() => appointments().length > 0),
    pendingCount: computed(() => 
      appointments().filter(a => a.status === 'PENDING').length
    ),
    vm: computed(() => ({
      appointments: appointments(),
      isLoading: isLoading(),
      error: error(),
    })),
  })),
  withMethods((store, bookingService = inject(BookingService)) => ({
    async loadAppointments(date: string): Promise<void> {
      patchState(store, { isLoading: true, error: null });
      try {
        const appointments = await bookingService.getByDate(date);
        patchState(store, { appointments, isLoading: false });
      } catch (error) {
        patchState(store, { 
          error: error instanceof Error ? error.message : 'Unknown error',
          isLoading: false 
        });
      }
    },
    setSelectedDate(date: string): void {
      patchState(store, { selectedDate: date });
    },
  }))
);
```

### 6.2 Store 使用规范

- **页面组件** 可以注入 Store，订阅 `vm` (ViewModel) Signal
- **分子/原子组件** **禁止**直接注入 Store，必须通过 `@Input()` 接收数据

```typescript
// 正确：页面组件注入 Store
@Component({ ... })
export class BookingPageComponent {
  private readonly store = inject(BookingStore);
  readonly vm = this.store.vm;
}

// 正确：分子组件通过 Input 接收数据
@Component({ ... })
export class TimeSlotGridComponent {
  @Input() slots: TimeSlot[] = [];
  @Input() selectedSlotId: string | null = null;
  @Output() slotSelected = new EventEmitter<string>();
}
```

---

## 7. API 通信规范

### 7.1 Service 层职责

所有 HTTP 请求必须封装在 `*Service` 类中，组件**禁止**直接使用 `HttpClient`。

```typescript
@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiBaseUrl;

  getAll(): Promise<Appointment[]> {
    return firstValueFrom(
      this.http.get<Appointment[]>(`${this.apiUrl}/v1/appointments`)
    );
  }

  getById(id: string): Promise<Appointment> {
    return firstValueFrom(
      this.http.get<Appointment>(`${this.apiUrl}/v1/appointments/${id}`)
    );
  }

  create(dto: CreateBookingDto): Promise<Appointment> {
    return firstValueFrom(
      this.http.post<Appointment>(`${this.apiUrl}/v1/appointments`, dto)
    );
  }
}
```

### 7.2 DTO 定义

DTO 文件独立定义在 `features/*/dto/` 目录下，与后端 API 响应格式严格对齐。

```typescript
// auth.dto.ts
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  email: string;  // email/phone 为脱敏掩码展示字段，原始 PII 存储在 emailEncrypted/phoneEncrypted（AES-256-GCM），前端永不接收
  phone: string;  // email/phone 为脱敏掩码展示字段，原始 PII 存储在 emailEncrypted/phoneEncrypted（AES-256-GCM），前端永不接收
  firstName: string;
  lastName: string;
  role: 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';
}
// 注意：email 和 phone 为脱敏掩码展示字段。
// 原始 PII 存储在 emailEncrypted/phoneEncrypted（AES-256-GCM），前端永不接收。
// 唯一索引使用 emailHash/phoneHash（SHA-256），前端永不接收。
```

> **DTO 命名对齐**：前端 DTO 接口名必须与后端 API 响应字段名完全一致，确保类型安全。

---

## 8. 路由与懒加载

### 8.1 路由配置

每个 feature 模块拥有独立的路由配置文件：

```typescript
// features/auth/auth.routes.ts
import { Routes } from '@angular/router';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component')
      .then(m => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component')
      .then(m => m.RegisterComponent),
  },
];
```

### 8.2 懒加载

根路由通过 `loadChildren` 懒加载 feature 模块：

```typescript
// app.routes.ts
export const APP_ROUTES: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes')
      .then(m => m.AUTH_ROUTES),
  },
  {
    path: 'booking',
    loadChildren: () => import('./features/booking/booking.routes')
      .then(m => m.BOOKING_ROUTES),
  },
];
```

---

## 9. 安全规范

### 9.1 认证 Guard

路由守卫必须集成在 `core/guards/` 目录下：

```typescript
// core/guards/auth.guard.ts
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/auth/login'], {
      queryParams: { returnUrl: state.url }
    });
  }
  return true;
};
```

### 9.2 角色 Guard

基于角色的路由访问控制，确保不同角色只能访问其授权的页面：

```typescript
// core/guards/role.guard.ts
export function roleGuard(config: {
  allow?: string[];
  deny?: string[];
  redirectTo?: string;
}): CanActivateFn {
  return () => {
    const authStore = inject(AuthStore);
    const router = inject(Router);
    const user = authStore.currentUser();

    if (!user) {
      router.navigate(['/auth/login']);
      return false;
    }

    if (config.deny && config.deny.includes(user.role)) {
      router.navigate([config.redirectTo || '/']);
      return false;
    }

    if (config.allow && !config.allow.includes(user.role)) {
      router.navigate([config.redirectTo || '/']);
      return false;
    }

    return true;
  };
}
```

**角色路由规则**：

| 路由 | CUSTOMER | ADMIN | SUPER_ADMIN |
|------|:---:|:---:|:---:|
| `/booking/*` | ✅ | ❌ | ❌ |
| `/my-bookings` | ✅ | ❌ | ❌ |
| `/profile` | ✅ | ✅ | ✅ |
| `/admin/*` | ❌ | ✅ | ✅ |

**使用示例**：
```typescript
// booking.routes.ts — CUSTOMER only
const customerOnly = [authGuard, roleGuard({ deny: ['ADMIN', 'SUPER_ADMIN'] })];

// admin.routes.ts — ADMIN/SUPER_ADMIN only
canActivate: [authGuard, roleGuard({ allow: ['ADMIN', 'SUPER_ADMIN'] })],
```

### 9.3 HTTP 拦截器

认证拦截器自动附加 JWT Token：

```typescript
// core/interceptors/auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TokenStorage).getAccessToken();
  
  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }
  return next(req);
};
```

### 9.4 Token 存储

- Access Token 存储在内存中（`signal`）
- Refresh Token 通过 Service 层管理，支持自动轮换
- 禁止将 Token 存储在 `localStorage` 中（XSS 风险）

---

## 10. 测试规范

### 10.1 测试文件位置

测试文件与源文件同目录，使用 `.spec.ts` 后缀：

```
features/booking/
├── pages/
│   └── booking-page/
│       ├── booking-page.component.ts
│       ├── booking-page.component.html
│       ├── booking-page.component.scss
│       └── booking-page.component.spec.ts
└── stores/
    ├── booking.store.ts
    └── booking.store.spec.ts
```

### 10.2 Store 测试

Store 测试必须覆盖 State 初始化、Methods 执行和 Computed 计算：

```typescript
describe('BookingStore', () => {
  it('should initialize with default state', () => {
    const store = new BookingStore();
    expect(store.vm()).toEqual({
      appointments: [],
      isLoading: false,
      error: null,
    });
  });

  it('should load appointments successfully', async () => {
    const store = new BookingStore();
    await store.loadAppointments('2026-04-15');
    expect(store.isLoading()).toBe(false);
    expect(store.appointments().length).toBeGreaterThan(0);
  });
});
```

---

## 11. 与其他文档的对齐关系

| 对齐文档 | 对齐内容 |
|---------|---------|
| **系统架构设计文档(SAD)** | 前端/后端职责边界、通信协议（REST + WebSocket）、组件层级 |
| **接口设计规范文档** | DTO 命名、API 响应格式、错误处理格式、HTTP 方法使用 |
| **数据架构设计文档** | SignalStore State 与后端 Prisma Schema 字段映射、用户会话管理 |
| **安全架构设计文档** | Auth Guard 实现、Token 存储策略、XSS/CSRF 防护 |

### DTO 命名对齐检查

前端 `*.dto.ts` 中的接口名必须与后端 API 响应字段保持一致：

```typescript
// 前端: features/booking/dto/booking.dto.ts
export interface CreateBookingDto {
  timeSlotId: string;     // 对应后端 Appointment.timeSlotId
  serviceId: string;      // 对应后端 Appointment.serviceId  
  appointmentDate: string; // 对应后端 Appointment.appointmentDate
  customerInfo: CustomerInfo;
}

// 后端: Prisma Schema Appointment 模型
// timeSlotId: String @map("time_slot_id")
// serviceId: String @map("service_id")
// appointmentDate: DateTime @map("appointment_date")
```

---

## 更新记录

| 日期 | 版本 | 变更内容 | 批准人 |
|------|------|---------|--------|
| 2026-05-11 | 1.3.0 | 新增共享组件（app-search-input, app-filter-bar, app-table-wrapper, app-dropdown 增强, app-modal 增强）；系统色从蓝色 #00c6ff 迁移至绿色 #2ecc71 | 架构评审 |
| 2026-05-11 | 1.2.0 | **[DEPRECATED]** 原 MultiSlotPicker 分子组件说明已标记废弃 | 架构评审 |
| 2026-04-15 | 1.0.0 | 初始版本，基于评估报告完善 | 架构评审 |
