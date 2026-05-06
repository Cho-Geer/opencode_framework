# UI 设计实现计划（UI Implementation Plan）
版本：2.0.0
日期：2026-05-04
项目：Booking System Angular + NestJS Refactor
状态：规划中（已更新为暗色 Sharp 设计系统）

> **v2.0.0 变更**：设计系统从「标准企业 + 玻璃态」切换为「暗色 Sharp Design」。
> 详见 `global-ui-spec.md` v3.0.0、`admin-ui-spec.md` v2.0.0。

==========================================================
# 0. 版本变更日志
==========================================================

## v2.0.0 — 2026-05-04
- **设计范式切换**：移除所有 glassmorphism 引用，统一为 dark-first sharp design
- **色彩更新**：旧 #1677FF / #667eea / #764ba2 → 新 #00c6ff
- **组件重命名**：glass-* 类 → sharp-* 类
- **移除**：backdrop-filter、glass-level-1/2/3、玻璃态层级系统
- **Tailwind 配置**：更新为暗色令牌（#0c1220, #162032, #00c6ff 等）

==========================================================
# 1. 项目概览
==========================================================

## 1.1 目标
基于更新的暗色 Sharp 设计规范（`global-ui-spec.md` v3.0.0），实现完整的 Customer 前台和 Admin 后台 UI。

## 1.2 范围
- **Customer 前台**：登录、注册、服务选择、时间槽选择、预约确认、预约成功、我的预约、个人资料
- **Admin 后台**：仪表盘、用户管理、服务管理、预约管理、统计报表、系统设置

## 1.3 设计系统
- Customer：暗色 Sharp Design（详见 `customer-ui-spec.md` v2.0.0）
- Admin：暗色数据仪表盘（详见 `admin-ui-spec.md` v2.0.0）
- 共享基础：`global-ui-spec.md` v3.0.0（暗色优先）
- 废弃参考：`glassmorphism-design-system.md`（已标记 DEPRECATED，仅历史保留）

## 1.4 技术栈
- Angular v21+（Standalone Components）
- Tailwind CSS v4
- PrimeNG（组件库）
- NgRx Signals（状态管理）
- RxJS（响应式编程）

==========================================================
# 2. 阶段规划
==========================================================

## 阶段 1：设计系统与基础架构（Week 1）
**目标**：建立可复用的设计系统和应用骨架
**负责人**：1 人（核心开发者）
**并行度**：串行（高依赖）

### 任务清单

#### 2.1.1 Tailwind 配置更新（2 天）
**文件**：`booking-frontend/tailwind.config.ts`
**内容**：
- 颜色系统扩展（暗色令牌）：
  - `dark-bg`: '#0c1220'
  - `card-bg`: '#162032'
  - `card-bg-light`: '#1e293b'
  - `border-color`: '#2a3a50'
  - `text-primary`: '#e2e8f0'
  - `text-secondary`: '#94a3b8'
  - `accent-blue`: '#00c6ff'
  - `accent-blue-dark`: '#0072ff'
  - `accent-green`: '#2ecc71'
  - `accent-red`: '#e74c3c'
  - `accent-yellow`: '#f39c12'
  - `accent-purple`: '#9b59b6'
- 阴影扩展：
  - `shadow-card`（实色暗影）
  - `shadow-card-hover`
  - `shadow-glow-blue` / `shadow-glow-green`
- 圆角扩展：
  - `radius-sharp`: '8px'（卡片）
  - `radius-button`: '6px'
- 动画扩展：
  - `fade-in`
  - `slide-in`
  - `shimmer`
  - `pulse-slow`

#### 2.1.2 全局样式建立（2 天）
**文件**：`booking-frontend/src/styles.scss`
**内容**：
- Tailwind 基础导入
- CSS 变量定义（暗色设计令牌）
- Sharp 基础类（.sharp-card / .sharp-button / .sharp-input）
- 暗色数据表格（.data-table）
- 页面背景（#0c1220 + 网格背景）
- 字体导入（Inter + system-ui）
- 全局滚动条样式（暗色）
- 选择文本颜色

#### 2.1.3 原子组件库（3 天）
**目录**：`booking-frontend/src/app/shared/components/atoms/`
**组件清单**：

| 组件 | 类型 | 样式 | 优先级 |
|------|------|------|--------|
| app-button | 原子 | 主/次/文字/危险（Sharp） | P0 |
| app-card | 原子 | Sharp Card（暗色） | P0 |
| app-input | 原子 | Sharp Input（暗色） | P0 |
| app-modal | 原子 | Sharp Modal（暗色） | P0 |
| app-badge | 原子 | 状态标签（暗色） | P0 |
| app-toast | 原子 | 通知提示（暗色） | P0 |
| app-spinner | 原子 | 加载动画（accent-blue） | P0 |
| app-empty-state | 原子 | 空状态 | P0 |
| app-calendar | 原子 | 日历（PrimeNG 暗色增强） | P0 |
| app-time-slot | 原子 | 时间槽按钮（Sharp） | P0 |
| app-dropdown | 原子 | 下拉选择（暗色） | P1 |
| app-toggle | 原子 | 开关（accent-blue 轨道） | P1 |
| app-avatar | 原子 | 头像（首字母 + 暗色背景） | P1 |
| app-progress | 原子 | 进度条（accent 渐变填充） | P1 |

**每个组件包含**：
- TypeScript 组件
- HTML 模板
- SCSS 样式
- 单元测试（TDD）
- Storybook 文档（可选）

#### 2.1.4 布局组件（2 天）
**目录**：`booking-frontend/src/app/shared/components/layouts/`
**组件清单**：

| 组件 | 类型 | 说明 | 优先级 |
|------|------|------|--------|
| app-layout | 布局 | 页面骨架 | P0 |
| app-header | 布局 | 顶部导航 | P0 |
| app-sidebar | 布局 | 侧边栏 | P0 |
| app-footer | 布局 | 页脚 | P2 |
| app-breadcrumb | 布局 | 面包屑 | P1 |

#### 2.1.5 核心服务（3 天）
**目录**：`booking-frontend/src/app/core/services/`
**服务清单**：

| 服务 | 功能 | 优先级 |
|------|------|--------|
| notification.service.ts | Toast 管理 | P0 |
| modal.service.ts | 模态框管理 | P0 |
| loading.service.ts | 加载状态 | P0 |
| websocket.service.ts | WebSocket 连接管理 | P0 |
| csrf.service.ts | CSRF Token 获取与注入 | P0 |
| theme.service.ts | 主题切换 | P2 |

#### 2.1.6 HTTP 拦截器（1 天）
**目录**：`booking-frontend/src/app/core/interceptors/`
**拦截器清单**：

| 拦截器 | 功能 | 优先级 |
|--------|------|--------|
| auth.interceptor.ts | JWT Token 附加 + 自动刷新 | P0 |
| request-id.interceptor.ts | X-Request-ID 生成与附加 | P0 |
| csrf.interceptor.ts | CSRF Token 附加（POST/PUT/DELETE/PATCH） | P0 |
| error.interceptor.ts | 全局错误处理（401/403/429/500） | P0 |
| loading.interceptor.ts | 全局 Loading 状态 | P1 |

#### 2.1.6 状态管理（2 天）
**目录**：`booking-frontend/src/app/stores/`
**Store 清单**：

| Store | 状态 | 优先级 |
|-------|------|--------|
| auth.store.ts | 用户认证 | P0 |
| booking.store.ts | 预约流程 | P0 |
| notification.store.ts | 通知消息 | P0 |
| admin.store.ts | Admin 数据 | P1 |
| ui.store.ts | UI 状态（侧边栏等） | P1 |

### 阶段 1 交付物
- [ ] 更新的 Tailwind 配置
- [ ] 全局样式文件
- [ ] 15+ 原子组件（含测试）
- [ ] 5 布局组件
- [ ] 4 核心服务
- [ ] 5 个 Store

---

## 阶段 2：Customer 前台页面（Week 2-3）
**目标**：实现完整的客户预约流程
**负责人**：1-2 人
**并行度**：中（页面间部分依赖）

### 任务清单

#### 2.2.1 认证页面（3 天）
**页面**：
- `/auth/login` - 登录页
- `/auth/register` - 注册页

**组件**：
- `login-form.component.ts`
- `register-form.component.ts`
- `auth-layout.component.ts`（分屏布局）

**功能**：
- 表单验证（邮箱、密码、验证码）
- 分步注册（发送验证码 → 填写信息）
- 记住我
- 忘记密码链接
- 社交登录（预留）

**设计要点**：
- 分屏布局：左侧品牌展示（暗色背景 + 装饰），右侧 Sharp Card 表单
- 卡片：Sharp Card（bg #162032 + border #2a3a50 + radius 8px），padding 48px
- 输入框：Sharp Input，聚焦 border-color #00c6ff + glow
- 按钮：Sharp 主按钮（bg #00c6ff），全宽

#### 2.2.2 服务选择页面（3 天）
**页面**：`/booking/services`

**组件**：
- `service-selection.component.ts`
- `service-card.component.ts`
- `service-search.component.ts`
- `service-filter.component.ts`

**功能**：
- 服务列表展示（卡片网格）
- 搜索（实时防抖）
- 分类筛选
- 排序（价格、评分）
- 空状态
- 加载骨架屏

**设计要点**：
- 页面背景：dark-bg (#0c1220) + 可选网格背景
- 服务卡片：Sharp Card，hover 上浮 + 阴影增强 + border-color → #00c6ff
- 搜索框：Sharp Input，聚焦 glow
- 筛选标签：Sharp 标签，选中 bg rgba(0,198,255,0.15) + border #00c6ff + color #00c6ff

#### 2.2.3 时间槽选择页面（3 天）
**页面**：`/booking/time-slots`

**组件**：
- `time-slot-selection.component.ts`
- `calendar.component.ts`（PrimeNG 增强）
- `time-grid.component.ts`
- `booking-summary.component.ts`

**功能**：
- 月历视图（日期选择）
- 可用时间段展示
- 时间段选择
- 已预约状态
- 选中摘要（底部固定栏）
- 确认预约按钮

**设计要点**：
- 日历：Sharp Card 面板，选中日期 bg #00c6ff + white 文字
- 时间槽：Sharp 按钮网格
  - 可用：bg #0c1220 + border #2a3a50 + color #e2e8f0
  - 已预约：bg rgba(148, 163, 184, 0.1) + color #94a3b8 + cursor not-allowed
  - 选中：bg #00c6ff + white 文字 + box-shadow glow
- 摘要栏：Sharp Card，sticky bottom

#### 2.2.4 预约确认弹窗（2 天）
**组件**：
- `booking-confirm-modal.component.ts`

**功能**：
- 预约信息展示
- 备注输入
- 确认/取消操作
- 加载状态
- 错误处理

**设计要点**：
- Sharp Modal（520px）
- 详情卡片：Sharp Card，信息列表
- 备注输入：Sharp Input（textarea 变体）
- 按钮：取消（次）+ 确认预约（主，显示价格）

#### 2.2.5 预约成功页面（2 天）
**页面**：`/booking/success`

**组件**：
- `booking-success.component.ts`
- `success-animation.component.ts`

**功能**：
- 成功状态展示
- 预约详情
- 操作按钮（查看预约、继续预约）
- 添加到日历

**设计要点**：
- 成功动画：圆形 bg #2ecc71 + 对勾绘制动画（白色）
- 详情卡片：Sharp Card
- 按钮组：主 + 次

#### 2.2.6 我的预约页面（3 天）
**页面**：`/my-bookings`

**组件**：
- `my-bookings.component.ts`
- `booking-card.component.ts`
- `booking-filter.component.ts`
- `booking-detail-modal.component.ts`

**功能**：
- 预约列表（卡片式）
- 状态筛选（全部、待确认、已确认、已完成、已取消）
- 分页
- 取消预约
- 查看详情
- 空状态

**设计要点**：
- 筛选标签：Sharp 标签，选中 bg rgba(0,198,255,0.15) + border #00c6ff
- 预约卡片：Sharp Card，状态标签颜色区分
- 操作按钮：查看详情（文字）+ 取消（次按钮）
- 详情弹窗：Sharp Modal（640px）

#### 2.2.7 个人资料页面（2 天）
**页面**：`/profile`

**组件**：
- `profile.component.ts`
- `profile-form.component.ts`
- `avatar-upload.component.ts`
- `password-change-modal.component.ts`

**功能**：
- 信息展示（只读）
- 编辑模式
- 头像上传
- 修改密码
- 表单验证

**设计要点**：
- 头像区域：Sharp Card，border #00c6ff（可选强调边框）
- 信息卡片：Sharp Card，字段列表
- 编辑表单：Sharp Input
- 密码弹窗：Sharp Modal（520px）

### 阶段 2 交付物
- [ ] 7 个完整页面
- [ ] 15+ 组件
- [ ] 完整的预约流程（创建 → 查看 → 取消）
- [ ] 响应式布局

---

## 阶段 3：Admin 后台页面（Week 4-5）
**目标**：实现管理员功能界面
**负责人**：1-2 人
**并行度**：高（页面间低依赖）
**前提**：阶段 1 完成 + Admin API 就绪（或 Mock）

### 任务清单

#### 2.3.1 Admin 布局（2 天）
**组件**：
- `admin-layout.component.ts`
- `admin-sidebar.component.ts`
- `admin-header.component.ts`

**功能**：
- 扩展侧边栏（Admin 菜单）
- 面包屑导航
- 权限控制（菜单显示）

#### 2.3.2 仪表盘（3 天）
**页面**：`/admin/dashboard`

**组件**：
- `dashboard.component.ts`
- `stats-card.component.ts`
- `chart-widget.component.ts`
- `recent-bookings.component.ts`

**功能**：
- 统计卡片（4 个关键指标）
- 预约趋势图（折线图）
- 服务分布图（环形图）
- 最近预约列表

**设计要点**：
- 统计卡片：Sharp Card + 顶部强调色指示条 + 进度条
- 图表：PrimeNG Charts，暗色 5 色系统配色
- 表格：.data-table 暗色主题

#### 2.3.3 用户管理（3 天）
**页面**：`/admin/users`

**组件**：
- `user-management.component.ts`
- `user-table.component.ts`
- `user-form-modal.component.ts`
- `user-detail-modal.component.ts`

**功能**：
- 用户列表（表格）
- 搜索、筛选、排序
- 新增/编辑用户（弹窗）
- 禁用/启用
- 删除（二次确认）
- 分页

**设计要点**：
- 表格：.data-table 暗色主题 + sticky 表头
- 弹窗：Sharp Modal（640px）
- 操作：文字按钮组

#### 2.3.4 服务管理（3 天）
**页面**：`/admin/services`

**组件**：
- `service-management.component.ts`
- `service-table.component.ts`
- `service-form-modal.component.ts`
- `image-upload.component.ts`

**功能**：
- 服务列表（表格）
- 新增/编辑服务（含图片上传）
- 上架/下架（开关）
- 删除
- 分页

**设计要点**：
- 图片上传：暗色拖拽区域（bg #0c1220 + border 2px dashed #2a3a50）
- 开关：accent-blue 轨道（Sharp 风格）

#### 2.3.5 预约管理（3 天）
**页面**：`/admin/appointments`

**组件**：
- `appointment-management.component.ts`
- `appointment-table.component.ts`
- `appointment-detail-modal.component.ts`
- `batch-action-bar.component.ts`

**功能**：
- 预约列表（表格）
- 高级筛选（状态、日期范围、服务）
- 查看详情
- 取消预约
- 批量操作（确认、取消、导出）
- 分页

**设计要点**：
- 筛选标签：Sharp 标签（暗色主题）
- 日期选择：PrimeNG 日期范围（暗色主题）
- 批量操作：顶部浮动栏（Sharp Card）

### 阶段 3 交付物
- [ ] Admin 布局
- [ ] 4 个管理页面
- [ ] 10+ 组件
- [ ] 完整的 CRUD 操作

---

## 阶段 4：API 对接与数据流（Week 5-6）
**目标**：连接后端 API，实现完整数据流
**负责人**：1-2 人
**并行度**：高（各模块独立）

### 任务清单

#### 2.4.1 API 服务层（3 天）
**目录**：`booking-frontend/src/app/core/services/api/`
**服务清单**：

| 服务 | 功能 | API 端点 |
|------|------|---------|
| auth-api.service.ts | 认证 | POST /auth/login/password 等 |
| user-api.service.ts | 用户 | GET /users, PUT /users/:id 等 |
| service-api.service.ts | 服务 | GET /services, POST /services 等 |
| appointment-api.service.ts | 预约 | GET /appointments, POST /appointments 等 |
| time-slot-api.service.ts | 时间槽 | GET /time-slots/available |
| admin-api.service.ts | Admin | GET /admin/stats 等 |

**每个服务包含**：
- HTTP 方法封装
- 错误处理
- 请求/响应拦截
- 类型定义

#### 2.4.2 Store 与 API 集成（3 天）
**更新 Store**：
- AuthStore：登录状态、用户信息
- BookingStore：服务列表、时间槽、当前预约
- AdminStore：用户列表、服务列表、预约列表、统计数据

**实现模式**：
```typescript
// Signal Store with API integration
export const BookingStore = signalStore(
  withState(initialState),
  withComputed((state) => ({
    availableTimeSlots: computed(() => 
      state.timeSlots().filter(slot => slot.isAvailable)
    )
  })),
  withMethods((store, api = inject(AppointmentApiService)) => ({
    async loadServices() {
      patchState(store, { loading: true });
      try {
        const services = await api.getServices();
        patchState(store, { services, loading: false });
      } catch (error) {
        patchState(store, { error, loading: false });
      }
    },
    // ...
  }))
);
```

#### 2.4.3 错误处理与加载状态（2 天）
**全局错误处理**：
- HTTP 错误拦截器
- 401：跳转登录
- 403：显示无权限
- 500：显示错误页面

**加载状态管理**：
- 全局 Loading Store
- 按钮级 Loading
- 骨架屏触发

#### 2.4.4 缓存策略（1 天）
- 服务列表：缓存 5 分钟
- 用户信息：缓存 15 分钟
- 预约列表：实时刷新

### 阶段 4 交付物
- [ ] 6 个 API 服务
- [ ] Store 与 API 集成
- [ ] 全局错误处理
- [ ] 加载状态管理
- [ ] 缓存策略

---

## 阶段 5：响应式与移动端（Week 6）
**目标**：适配移动端，优化触控体验
**负责人**：1 人
**并行度**：中

### 任务清单

#### 2.5.1 响应式布局（3 天）
**断点定义**：
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

**布局调整**：
- 导航栏：汉堡菜单（Mobile）
- 侧边栏：抽屉（Mobile）
- 卡片网格：1 列（Mobile）/ 2 列（Tablet）/ 3 列（Desktop）
- 表格：横向滚动 或 卡片视图（Mobile）
- 按钮：全宽（Mobile）

#### 2.5.2 触控优化（2 天）
- 点击区域 ≥ 44x44px
- 滑动操作（列表项）
- 下拉刷新
- 底部固定操作栏
- 模态框全屏（Mobile）

#### 2.5.3 移动端暗色调整（1 天）
- 降低阴影强度（性能）
- 简化卡片层级
- 全宽布局

### 阶段 5 交付物
- [ ] 响应式布局
- [ ] 触控优化
- [ ] 移动端暗色调整

---

## 阶段 6：动画与交互优化（Week 6-7）
**目标**：实现流畅的动画和交互
**负责人**：1 人
**并行度**：中

### 任务清单

#### 2.6.1 页面过渡动画（1 天）
- 路由切换动画
- 页面入场动画

#### 2.6.2 组件动画（2 天）
- 模态框动画
- Toast 动画
- 列表项入场动画
- 卡片悬停动画

#### 2.6.3 微交互（2 天）
- 按钮点击反馈
- 输入框聚焦效果
- 开关切换动画
- 标签切换动画

#### 2.6.4 加载动画（1 天）
- 骨架屏 shimmer
- 按钮 loading spinner
- 页面加载进度条

### 阶段 6 交付物
- [ ] 页面过渡动画
- [ ] 组件动画
- [ ] 微交互
- [ ] 加载动画

---

## 阶段 7：测试与优化（Week 7）
**目标**：确保质量，修复问题
**负责人**：1 人 + Guardian
**并行度**：中

### 任务清单

#### 2.7.1 单元测试（3 天）
- 组件测试（Karma + Jasmine）
- 服务测试
- Store 测试
- 管道测试

#### 2.7.2 E2E 测试（2 天）
- Playwright 测试
- 关键流程测试
  - 登录 → 预约 → 查看
  - Admin CRUD 操作

#### 2.7.3 性能优化（2 天）
- 代码分割（懒加载）
- 图片优化（懒加载、WebP）
- 动画性能（will-change）
- 减少重绘重排

#### 2.7.4 可访问性检查（1 天）
- 键盘导航
- ARIA 标签
- 对比度检查
- 屏幕阅读器测试

### 阶段 7 交付物
- [ ] 单元测试覆盖率 ≥ 70%
- [ ] E2E 测试通过
- [ ] 性能优化完成
- [ ] 可访问性合规

==========================================================
# 3. 文件结构规划
==========================================================

## 3.1 设计文档
```
docs/design/
├── global-ui-spec.md                  # 全局 UI 规范 v3.0.0（暗色优先）
├── glassmorphism-design-system.md     # 玻璃态设计系统（已废弃，历史保留）
├── customer-ui-spec.md               # Customer 前台规范 v2.0.0
├── admin-ui-spec.md                  # Admin 后台规范 v2.0.0
├── interaction-patterns.md           # 交互模式规范
├── ui-implementation-plan.md         # 本文件（实现计划 v2.0.0）
└── multi-agent-evaluation.md         # 多智能体评估
```

## 3.2 前端代码结构
```
booking-frontend/src/app/
├── core/
│   ├── guards/                        # 路由守卫
│   ├── interceptors/                 # HTTP 拦截器
│   ├── services/
│   │   ├── api/                      # API 服务
│   │   ├── notification.service.ts   # 通知
│   │   ├── modal.service.ts          # 模态框
│   │   └── loading.service.ts        # 加载
│   └── models/                        # 类型定义
│
├── features/
│   ├── auth/                          # 认证模块
│   │   ├── login/
│   │   ├── register/
│   │   └── auth-layout/
│   ├── booking/                       # 预约流程
│   │   ├── service-selection/
│   │   ├── time-slot-selection/
│   │   ├── booking-confirm/
│   │   └── booking-success/
│   ├── my-bookings/                   # 我的预约
│   ├── profile/                       # 个人资料
│   └── admin/                         # Admin 后台
│       ├── dashboard/
│       ├── user-management/
│       ├── service-management/
│       └── appointment-management/
│
├── shared/
│   ├── components/
│   │   ├── atoms/                     # 原子组件
│   │   │   ├── button/
│   │   │   ├── card/
│   │   │   ├── input/
│   │   │   ├── modal/
│   │   │   ├── badge/
│   │   │   ├── toast/
│   │   │   ├── spinner/
│   │   │   ├── empty-state/
│   │   │   ├── calendar/
│   │   │   └── time-slot/
│   │   ├── molecules/                 # 分子组件
│   │   │   ├── search-bar/
│   │   │   ├── filter-tabs/
│   │   │   └── form-field/
│   │   └── layouts/                   # 布局组件
│   │       ├── app-layout/
│   │       ├── app-header/
│   │       └── app-sidebar/
│   ├── directives/                    # 指令
│   └── pipes/                         # 管道
│
├── stores/                            # NgRx Signals
│   ├── auth.store.ts
│   ├── booking.store.ts
│   ├── notification.store.ts
│   ├── admin.store.ts
│   └── ui.store.ts
│
├── app.component.ts
├── app.config.ts
├── app.routes.ts
└── styles.scss
```

==========================================================
# 4. 依赖清单
==========================================================

## 4.1 现有依赖（已安装）
- Angular v21+
- Tailwind CSS v4
- PrimeNG
- NgRx Signals
- RxJS

## 4.2 需要安装的依赖
| 依赖 | 版本 | 用途 |
|------|------|------|
| @angular/animations | ^21.0.0 | 动画支持 |
| @angular/cdk | ^21.0.0 | CDK 组件 |
| chart.js | ^4.4.0 | 图表（PrimeNG Charts） |
| date-fns | ^3.0.0 | 日期处理 |
| lodash-es | ^4.17.0 | 工具函数 |
| @types/lodash-es | ^4.17.0 | 类型定义 |

## 4.3 开发依赖
| 依赖 | 版本 | 用途 |
|------|------|------|
| @playwright/test | ^1.40.0 | E2E 测试 |
| jest | ^29.0.0 | 单元测试 |
| @angular-builders/jest | ^17.0.0 | Angular Jest |

==========================================================
# 4.5 API 字段映射策略（snake_case → camelCase）
==========================================================

## 4.5.1 问题说明
`contract.yaml` 使用 snake_case（`user_id`, `time_slot_id`），但前端编码规范要求 camelCase（`userId`, `timeSlotId`）。

## 4.5.2 映射方案
**方案：拦截器自动转换 + DTO 类型定义**

```typescript
// api-transform.interceptor.ts
// 请求：camelCase → snake_case
// 响应：snake_case → camelCase

import { camelCase, snakeCase } from 'lodash-es';

export const apiTransformInterceptor: HttpInterceptorFn = (req, next) => {
  // 请求转换：camelCase → snake_case
  const transformedReq = req.clone({
    body: req.body ? convertKeys(req.body, snakeCase) : req.body
  });
  
  return next(transformedReq).pipe(
    map(response => {
      // 响应转换：snake_case → camelCase
      if (response.body) {
        response = response.clone({
          body: convertKeys(response.body, camelCase)
        });
      }
      return response;
    })
  );
};
```

**例外**：PII 相关字段（`emailHash`, `phoneHash`, `emailEncrypted`）禁止暴露给前端，无需映射。

## 4.5.3 DTO 类型定义
所有 API DTO 使用 camelCase：
```typescript
interface AppointmentDto {
  id: string;
  userId: string;
  timeSlotId: string;
  serviceId: string;
  appointmentDate: string;
  status: AppointmentStatus;
  slotSequence: number;
  customerInfo?: Record<string, unknown>;
  remarks?: string;
  createdAt: string;
}
```

==========================================================
# 5. API 契约
==========================================================

## 5.1 已有 API（Contract v1.2.0）
- Auth：登录、注册、刷新、登出
- Users：获取用户信息
- Services：获取服务列表
- Appointments：创建、查询预约
- Time Slots：获取可用时间槽

## 5.2 需要扩展的 API（Admin）
| 端点 | 方法 | 功能 | 当前状态 |
|------|------|------|---------|
| /admin/stats | GET | 仪表盘统计 | ❌ 未定义 |
| /admin/users | GET/POST/PUT/DELETE | 用户管理 | ❌ 未定义 |
| /admin/services | GET/POST/PUT/DELETE | 服务管理 | ❌ 未定义（仅 GET /v1/services） |
| /admin/appointments | GET/PUT/DELETE | 预约管理 | ❌ 未定义（仅 POST/GET /v1/appointments） |
| /admin/reports | GET | 统计报表 | ❌ 未定义 |

**✅ 契约状态**：`contract.yaml` v1.3.0 已包含所有 Admin API 端点。前端可直接基于契约定义对接。

**Mock 数据策略**（后端未就绪时备选）：
- 使用 MSW（Mock Service Worker）或 json-server
- Mock 数据结构与契约 API 响应保持一致
- 便于后续切换真实 API

## 5.3 预约创建 API 字段补充
**contract.yaml 当前字段**（3个）：
- `time_slot_id`（required）
- `appointment_date`（required）
- `notes`（optional）

**数据模型要求补充字段**（见 `数据架构设计文档.md`）：
- `service_id`（required）— 从服务选择页传递
- `customer_info`（optional, JSON）— 客户补充信息
- `preferred_sequence`（required）— 前端生成随机值（0-99），用于热点分片

**请求体示例**：
```json
{
  "timeSlotId": "uuid",
  "serviceId": "uuid",
  "appointmentDate": "2026-05-15T10:00:00Z",
  "preferredSequence": 42,
  "customerInfo": {
    "specialRequests": "对染发剂过敏"
  },
  "notes": "备注信息"
}
```

**字段映射说明**：
- `notes`（contract）↔ `remarks`（Prisma model）— 自动映射
- `preferredSequence` — 前端生成，用于高并发热点分片（SAD §4.4.4）

==========================================================
# 6. 风险与应对
==========================================================

| 风险 | 影响 | 应对策略 |
|------|------|---------|
| Admin API 延迟 | 高 | 使用 Mock 数据并行开发 |
| 暗色主题可访问性 | 中 | 严格对比度检查（≥4.5:1），提供亮色切换 |
| 设计不一致 | 中 | 严格遵循设计文档，代码审查 |
| 测试覆盖不足 | 中 | TDD 强制，覆盖率门禁 |
| 第三方库兼容性 | 低 | 使用稳定版本，预留降级 |

==========================================================
# 7. 验收标准
==========================================================

## 7.1 功能验收
- [ ] 完整的预约流程可正常使用
- [ ] Admin CRUD 操作完整
- [ ] 权限控制正确

## 7.2 设计验收
- [ ] Customer 页面符合暗色 Sharp Design 规范
- [ ] Admin 页面符合暗色数据仪表盘规范
- [ ] 动画流畅（60fps）

## 7.3 质量验收
- [ ] 单元测试覆盖率 ≥ 70%
- [ ] E2E 测试全部通过
- [ ] 无严重 Bug
- [ ] 移动端可用

## 7.4 性能验收
- [ ] 首屏加载 < 3s
- [ ] 页面切换 < 500ms
- [ ] 动画流畅无卡顿

==========================================================
# 8. 交付时间表
==========================================================

| 周次 | 阶段 | 主要任务 | 交付物 |
|------|------|---------|--------|
| Week 1 | 阶段 1 | 设计系统 + 基础架构 | 原子组件库、布局、Store |
| Week 2 | 阶段 2 | Customer 页面（上） | 认证、服务选择、时间槽 |
| Week 3 | 阶段 2 | Customer 页面（下） | 预约流程、我的预约、资料 |
| Week 4 | 阶段 3 | Admin 页面（上） | 仪表盘、用户管理 |
| Week 5 | 阶段 3 | Admin 页面（下） | 服务管理、预约管理 |
| Week 6 | 阶段 4+5 | API 对接 + 响应式 | 数据流、移动端适配 |
| Week 7 | 阶段 6+7 | 动画 + 测试 | 完整测试通过 |

**总计：7 周**

==========================================================
# 9. 团队配置建议
==========================================================

## 9.1 单人开发
- 按阶段顺序执行
- 总时长：7 周
- 适合：熟悉项目的小团队

## 9.2 多人协作（推荐）
- **核心开发者**（1 人）：阶段 1（设计系统）
- **前端开发者 A**（1 人）：阶段 2（Customer）
- **前端开发者 B**（1 人）：阶段 3（Admin）
- **全栈开发者**（1 人）：阶段 4（API 对接）
- **QA**（1 人）：阶段 7（测试）

**并行方案**：
- Week 1：核心开发者完成阶段 1
- Week 2-3：A 和 B 并行开发 Customer 和 Admin（基于阶段 1 成果）
- Week 4-5：全栈开发者接入 API，A 和 B 继续完善
- Week 6-7：全员测试优化

**总时长：5-6 周（并行压缩）**

==========================================================
# 10. 附录
==========================================================

## 10.1 参考文档
- `global-ui-spec.md`
- `glassmorphism-design-system.md`
- `customer-ui-spec.md`
- `admin-ui-spec.md`
- `interaction-patterns.md`
- `multi-agent-evaluation.md`

## 10.2 相关文件
- `contract.yaml` - API 契约
- `AGENTS.md` - 多智能体规范
- `booking-frontend/` - 前端代码