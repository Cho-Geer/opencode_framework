# Admin 后台 UI 规范
版本：2.3.0
日期：2026-05-06
适用：ADMIN / SUPER_ADMIN 角色
设计风格：暗色数据Dashboard（Dark-First Data Dashboard）
基于原型：prototype/admin/dashboard.html

==========================================================
# 0. 版本变更日志（Changelog）
==========================================================

## v2.3.0 — 2026-05-06
### 🗑️ 移除
- §13.1 角色权限矩阵：移除「排班管理」行（排班模块已于 v2.2.0 移除，残留行未清理）

## v2.2.0 — 2026-05-06
### 🗑️ 移除
- §2.1 页面清单：移除「排班管理」(/admin/schedule) 页面行（Staff 模型已移除，SCH-001 端点已移除，无 API 支撑）
- §3.2 侧边栏：移除 📋 Schedule 菜单项
- §16.2 实现检查清单：移除 Schedule 页面项
- 页面总数：8 页 → 7 页

## v2.1.0 — 2026-05-05
### ✨ 新增
- §4.2 扩展Dashboard卡片：新增「System Status（System Status）」卡片定义，覆盖 SYS-001 映射契约，补齐 prototype Dashboard布局（STAFF-003 和 SVC-006 已在 v2.1.1 中移除）

## v2.0.0 — 2026-05-04
### 🔄 重大变更（Breaking Changes）
- **设计范式切换**：从「标准企业 + 玻璃态点缀」切换为「暗色数据Dashboard（Dark-First）」
- **色彩体系全面替换**：
  - 旧：#FFFFFF 背景 / #F2F3F5 背景 / #1677FF 主色 / #667eea→#764ba2 渐变
   - 新：#0c1220 主背景 / #162032 卡片背景 / #00c6ff 强调蓝 / 无渐变
- **移除所有玻璃态（Glassmorphism）引用**：glass-level-1/2/3、backdrop-filter、glass-effect 等全部移除
- **新设计语言**：sharp-card（8px 圆角实色边框）、sharp-button（6px 圆角实色边框）、sharp-input
- **路由扩展**：6页 → 7页（新增 Dashboard、Analytics、History、Settings；移除 Reports、合并为 Analytics；移除 Schedule）

### ✨ 新增
- §4：Dashboard组件（Dashboard Components）章节
  - 统计卡片（Stat Cards）：dark sharp-card + 渐变指示条
  - 预约趋势图（Booking Trends Chart）：折线图 + 暗色图表
  - 服务分布图（Service Distribution）：环形图 + 暗色图表
  - 时间分布图（Time Distribution Heatmap）：时间段热度分析
- 图表色板：`#00c6ff`（蓝）、`#2ecc71`（绿）、`#9b59b6`（紫）、`#f39c12`（橙）、`#e74c3c`（红）
- 数据表格样式：`.data-table` 暗色主题（纯 CSS，不依赖玻璃态）
- 输入框/按钮样式：`sharp-input`、`sharp-button`、`bg-dark-bg` 暗色背景

### 🗑️ 移除
- 所有 `glass-level-1/2/3` 类引用
- 所有 `backdrop-filter` / `-webkit-backdrop-filter` 引用
- 旧颜色调色板：#1677FF、#667eea、#764ba2、#0958D9
- Glass Modal / Glass Card / Glass Form / Glass Table 等玻璃态组件定义
- 渐变主按钮（替换为纯色 sharp-button）

==========================================================
# 1. 设计理念
==========================================================

## 1.1 设计定位
Admin 后台是面向管理员的专业数据工具界面，设计原则：
- **暗色优先（Dark-First）**：减少眼部疲劳，适合长时间数据Actions
- **数据高可见**：通过高对比度色彩突出关键数据指标
- **清晰层级**：卡片式布局 + 锐利边框区分信息区
- **效率优先**：信息密度高，Actions路径短
- **专业沉稳**：深色基底 + 锐利边角（8px sharp-card），杜绝弥散阴影和模糊效果

## 1.2 与 Customer 前台的关系
| 维度 | Admin 后台 | Customer 前台 |
|------|-----------|--------------|
| 主要风格 | 暗色数据Dashboard（Dark Data Dashboard） | 暗色主题（Sharp Design v2.0.0） |
| 卡片样式 | sharp-card（8px 实色边框） | sharp-card（统一） |
| 色彩 | #2ecc71 纯色强调绿 | #2ecc71（统一强调色） |
| 信息密度 | 高（表格、数据、图表） | 中（卡片、引导） |
| 背景 | #0c1220（深空蓝黑） | #0c1220（统一） |
| 卡片背景 | #162032（深蓝灰） | #162032（统一） |
| 动画 | 简洁实用（hover 上浮 + 边框高亮） | 简洁实用 |
| 布局 | 紧凑 | 流畅 |

## 1.3 设计系统核心令牌
| 令牌 | 值 | 用途 |
|------|-----|------|
| `--bg-dark-bg` | `#0c1220` | 页面主背景 |
| `--bg-card-bg` | `#162032` | 卡片、导航栏、侧边栏背景 |
| `--bg-card-bg-light` | `#1e293b` | 卡片悬停/次要背景 |
| `--border-color` | `#2a3a50` | 边框、分割线 |
| `--text-primary` | `#e2e8f0` | 主文字色 |
| `--text-secondary` | `#94a3b8` | 次要/辅助文字 |
| `--accent-green` | `#2ecc71` | 主强调色（按钮、链接、选中态） |
| `--accent-green-dark` | `#27ae60` | 强调色深色变体 |
| `--accent-red` | `#e74c3c` | 危险/负向指标 |
| `--accent-yellow` | `#f39c12` | 警告/待处理 |
| `--accent-purple` | `#9b59b6` | 辅助色/收入指标 |
| `--accent-teal` | `#1abc9c` | 辅助色 |
| `--accent-orange` | `#e67e22` | 辅助色 |
| `--radius-sharp` | `8px` | 卡片圆角 |
| `--radius-button` | `6px` | 按钮圆角 |
| `--radius-input` | `6px` | 输入框圆角 |

==========================================================
# 2. 页面总览
==========================================================

## 2.1 页面清单（7 页）
| 页面 | 路由 | 优先级 | 说明 | API 依赖 |
|------|------|--------|------|---------|
| Dashboard | /admin/dashboard | P0 | 数据概览 | DASH-001~004, SYS-001, notifications, messages — 参见 §4 Dashboard组件完整端点清单 |
| Users | /admin/users | P0 | CRUD + 角色管理 | `/v1/admin/users` CRUD |
| Services | /admin/services | P0 | CRUD + 上下架 | `/v1/admin/services` CRUD |
| Appointments | /admin/appointments | P0 | 查看 + Status管理 + 筛选 | `/v1/admin/appointments` |
| Analytics | /admin/analytics | P1 | 图表分析 + 报表导出 | `/v1/admin/analytics/overview` (AN-001), `/v1/admin/analytics/filtered` (AN-002) |
| History | /admin/history | P2 | Actions日志 + 审计追踪 | `GET /v1/admin/history (HIST-001)` |
| Settings | /admin/settings | P1 | 全局配置 | `/v1/admin/settings` |

**API 依赖Status**：
- `contract.yaml` v1.6.3 已包含 DASH-001~004, SYS-001~003 等 Admin API 端点
- 前端开发可直接基于契约定义进行 API 对接

## 2.2 页面结构
```
┌─────────────────────────────────────────┐
│  Admin Header (Fixed, 64px, bg-card-bg)  │
├──────────┬──────────────────────────────┤
│          │                              │
│  Admin   │      Main Content Area       │
│ Sidebar  │      (fluid width)           │
│ (240px)  │      padding: 24px           │
│ bg-card  │      bg-dark-bg + 网格背景    │
│          │                              │
├──────────┴──────────────────────────────┤
│  Footer (Optional, minimal)             │
└─────────────────────────────────────────┘
```

==========================================================
# 3. 全局布局
==========================================================

## 3.1 顶部导航栏（Admin Header）
**样式**：
- 背景：`#162032`（bg-card-bg，实色，不使用模糊）
- 高度：64px
- 底部边框：1px solid #2a3a50
- 阴影：0 2px 8px rgba(0, 0, 0, 0.3)
- position: sticky; top: 0; z-index: 40

**内容**：
- 左侧：折叠按钮 + Logo + 面包屑导航
- 右侧：【Admin 路由下隐藏】搜索框 + 主题切换 + 通知铃铛 + 消息 + 设置 + 用户菜单
- **搜索框可见性**：`showSearchInHeader = computed(() => !isAdminRoute())` — 仅在非 Admin 路由（Customer 前台）显示搜索框。Admin 后台 Header 不显示搜索框，以保持 Header 简洁，专注于数据监控。搜索框通过 `@if (showSearch())` 条件渲染，Admin 路由下完全从 DOM 中移除。

## 3.2 侧边栏（Admin Sidebar）
**样式**：
- 宽度：240px（可折叠至 64px）
- 背景：#162032（bg-card-bg，实色）
- 右侧边框：1px solid #2a3a50
- 阴影：2px 0 8px rgba(0, 0, 0, 0.3)

**菜单项（7 项）**：
```
📊 Dashboard
👥 Users
🛎️ Services
📅 Appointments
📈 Analytics
🕐 History
⚙️ Settings
```

**菜单样式**：
- 图标：20px，线性
- 文字：14px
- 默认：color #94a3b8（text-secondary）
- 悬停：background #1e293b（card-bg-light），color #e2e8f0
- 激活：
  - 左侧边框：3px solid #2ecc71
  - 背景：rgba(46, 204, 113, 0.1)
  - 文字：#2ecc71
  - 图标：#2ecc71

**折叠Status**：
- 仅显示图标（20px）
- 悬停显示 Tooltip（暗色背景 + 白色文字）

## 3.3 内容区域
- 背景：#0c1220（dark-bg）+ 可选网格背景（bg-grid）
- 内边距：24px
- 最大宽度：无限制（Admin 需要宽屏）
- 移动端：24px → 16px

## 3.4 面包屑
- 位置：Header 下方 / 内容区顶部
- 样式：14px，#94a3b8
- 分隔符：" / "
- 当前页：#e2e8f0（不加粗）

==========================================================
# 4. Dashboard页面（Dashboard）
==========================================================

## 4.1 页面布局
```
┌─────────────────────────────────────────────────────────┐
│  Dashboard                                              │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐    │
│  │  Welcome back, Admin!             [View Bookings]│    │
│  │  Friday, May 8, 2026                            │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Today's Bookings  │ │ Pending    │ │ Active Users  │ │ Total Revenue    │   │
│  │ 24  ↑12% │ │ 5   ↓3%  │ │ 1,254 ↑8%│ │ $3,245↑15%│  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
├─────────────────────────────────────────────────────────┤
│  ┌────────────────────────┐ ┌────────────────────────┐  │
│  │  预约趋势图 (折线图)    │ │  Booking Distribution  │  │
│  │                        │ │  ┌────────┐┌─────────┐ │  │
│  │  [渐变填充区域]         │ │  │ 环形图  ││ 柱状图   │ │  │
│  │  #2ecc71 线条           │ │  │(服务分布)││(时段分布)│ │  │
│  │                        │ │  └────────┘└─────────┘ │  │
│  └────────────────────────┘ └────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐ │
│  │  最近预约列表（.data-table）                         │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

> **注**：时间范围筛选已集成至 Booking Distribution Chart 的 Time 按钮下拉菜单中，不再使用全局头部日期选择器。

### 欢迎横幅（Welcome Banner）
Dashboard顶部显示欢迎横幅卡片，作为页面入口问候：

| 属性 | 规格 |
|------|------|
| 组件 | `<app-welcome-card>` (`organisms/welcome-card/`) |
| 背景 | 圆角卡片（`rounded-lg p-6`），无边框设计 |
| 内容 | 左侧：`<h1>Welcome back, Admin!</h1>` + 当前日期（`fullDate` 格式） |
| Actions | 右侧：`<app-button label="View Bookings" variant="primary" icon="pi pi-calendar" />`（当前无 `(onClick)` 处理 — 占位） |
| 数据绑定 | `[today]="today"` — 接收 `Date` 类型输入 |

**实现位置**：`dashboard.component.html:2` — 作为第一个元素渲染，位于所有内容之前。

## 4.2 统计卡片（Stat Cards）
**sharp-card 设计**：
```
┌─────────────────────────────┐
│  ┌──────┐                   │
│  │ 图标  │  Today's Bookings          │  ← label: #94a3b8, 14px
│  │(accent│  24              │  ← value: #e2e8f0, 28px bold
│  │ blue) │  ↑ 12% 较昨日     │  ← trend: #2ecc71
│  └──────┘                    │
│  ┌──────────────────────┐   │
│  │ ██████████████░░░░░░ │   │  ← progress-bar
│  │ 目标 32 · 75%         │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

**样式**：
- 背景：#162032（card-bg）
- 边框：1px solid #2a3a50（border-color）
- border-radius：8px（sharp-card）
- padding：20px
- 阴影：0 4px 6px -1px rgba(0, 0, 0, 0.3)
- hover：border-color → rgba(46, 204, 113, 0.5) + 阴影增强 + translateY(-3px)

**内容**：
- 图标容器：40px x 40px，sharp（8px 圆角），对应强调色半透明背景
- 标签：14px，#94a3b8（text-secondary）
- 数值：28px bold，#e2e8f0（text-primary）
- 趋势指示器：
  - 上升：color #2ecc71（accent-green）+ ↑ 箭头
  - 下降：color #e74c3c（accent-red）+ ↓ 箭头
- 进度条：4px 高，背景 rgba(42, 58, 80, 0.5)，填充色按卡片主题

**统计项**（API `GET /v1/admin/stats` (DASH-001)）：
| 卡片（代码实际标签） | 图标色 | 进度条色 | API 字段 |
|------|--------|---------|----------|
| "Today's Bookings"（Today's Bookings） | accent-green | accent-green | today_bookings |
| "Pending Confirmation"（Pending） | accent-yellow | accent-yellow | pending_count |
| "Total Customers"（Active Users / 客户总数） | accent-green | accent-green | active_users |
| "Total Revenue"（Total Revenue） | accent-purple | accent-purple | total_revenue |

**注**：代码使用英文标签（"Today's Bookings", "Pending Confirmation", "Total Customers", "Total Revenue"）。"Total Customers" 对应 API 的 `active_users` 字段，代码显示为客户总数而非Active Users数。

### 扩展Dashboard卡片（System Status）[v2.1.0]

除上述 4 张核心统计卡片外，Dashboard还包含以下 1 张扩展卡片，覆盖系统运维维度。

**布局**：扩展卡片位于核心卡片下方，采用 1 列或 3 列网格布局（桌面端），与上方的 4 张 stat cards 形成 4+1 的卡片网格。

#### System Status卡片（System Status Card）
**映射契约**：SYS-001（system health metrics）
**API 端点**：`GET /v1/admin/system/health`

| 属性 | 规格 |
|------|------|
| 卡片类型 | sharp-card |
| 背景色 | #162032 |
| 图标色 | 动态（绿色=正常，黄色=警告，红色=异常） |
| 标题 | "System Status"（font-size: 16px） |
| 内容 | 6 行Status指示器：Server / Database / API / Redis / Last Backup / Uptime |
| 每行内容 | Status圆点 (●) + 标签 + Status文字（"Online" / "Degraded" / "Offline"） + 响应时间/负载 |
| Uptime 显示 | 第 6 行指示器："Uptime: 99.9%" |
| 最后备份 | 第 5 行指示器："Last Backup: 2026-05-05 02:00 UTC" |
| 刷新间隔 | 每 60 秒自动刷新（或通过 WebSocket `system.health.updated` 推送刷新System Status，或通过 WebSocket `appointment.status_changed` 推送刷新统计卡片与预约列表，回退到每 60 秒 HTTP 轮询） |
| 展开功能 | 点击可展开详细指标（CPU、内存、磁盘使用率） |

**Status指示器样式**：
```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot.online { background: #2ecc71; box-shadow: 0 0 6px rgba(46, 204, 113, 0.5); }
.status-dot.degraded { background: #f39c12; box-shadow: 0 0 6px rgba(243, 156, 18, 0.5); }
.status-dot.offline { background: #e74c3c; box-shadow: 0 0 6px rgba(231, 76, 60, 0.5); }
```

**映射说明**：以上卡片与 prototype/admin/dashboard.html 中的布局一致。API 映射对应 `contract.yaml` 中的 SYS-001 端点。若相关 API 尚未实现，前端可使用 Mock 数据先行开发。

## 4.3 图表区域
**图表卡片（Chart Sharp Card）**：
- 背景：#162032
- 边框：1px solid #2a3a50
- border-radius：8px
- padding：24px
- 标题：16px bold，#e2e8f0
- 副标题：14px，#94a3b8

### 预约趋势图（Booking Trends Chart）
- 类型：折线图（Line Chart）
- 颜色：
  - 线条：#2ecc71（accent-green），2px width，tension 0.4
  - 填充区域：渐变 `rgba(46, 204, 113, 0.05)` → `rgba(46, 204, 113, 0.35)`（自上而下）
  - 网格线：rgba(42, 58, 80, 0.2)
- 数据点：圆形，3px（hover 5px），白色填充 + #2ecc71 边框
- 工具提示：暗色背景（rgba(22, 32, 50, 0.9)）+ 白色文字 + 锐利边框
- 双轴：左侧 Bookings，右侧 Revenue ($) — #2ecc71 线条

### Booking Distribution Panel（合并面板）
**布局**：单面板内部分为左右两列（`sm:grid-cols-2`）

#### 服务分布图（Service Distribution — Doughnut）
- 类型：环形图（Doughnut Chart）
- 内半径：70%
- 中心文字："Total" / 总预约数 / "Bookings"（白色 #e2e8f0，24px bold）— 通过 `centerTextPlugin` 渲染
- 颜色：#2ecc71, #9b59b6, #2ecc71, #f39c12, #e74c3c
- 图例：底部横向排列，10px，#94a3b8

#### 时段分布图（Time Distribution — Bar Chart）
- 类型：柱状图（Bar Chart）
- X轴：时段标签（如 "9-10", "10-11" 等）
- Y轴：预约数量
- 柱体颜色：flat `rgba(46, 204, 113, 0.7)`，边框 `#2ecc71`
- 柱体宽度：12px，无圆角（borderRadius: 0）
- 数值标签：柱体上方显示数值（通过 `barDataLabelsPlugin`）

#### 时间范围筛选（Time Range Filter）
**位置**：Booking Distribution Panel 的 "Time" 按钮（secondary variant）
**交互**：
- 点击 "Time" 按钮 → 下拉菜单平滑展开（200ms opacity + scale 动画，ease-out）
- 选项：Last 24h / Last 7 Days / Last 30 Days / This Month / Last Month / Custom Range
- 悬停：背景色变化（选中项 hover:bg-accent-green/20，未选中项 hover:bg-card-bg-light）
- 选中：text-accent-green + bg-accent-green/10 + border-l-accent-green 左侧边框高亮
- 点击页面其他区域：菜单自动关闭
- 选择后：按钮文本更新为所选选项，触发 `timeRangeChange` 事件 → 父组件调用 API 重新加载时段分布数据

#### 自定义日期范围 (Custom Range)
**触发**：选择 "Custom Range" 选项
**行为**：
- 下拉菜单关闭（200ms fade out）
- 日期范围面板在相同位置滑入（opacity + scale 200ms 动画）
- 面板内容：
  - 标题栏："Select Date Range" + 关闭按钮（pi-times）
  - From 日期选择器（`p-datepicker`，`[(ngModel)]` 绑定 signal，`dateFormat="yy-mm-dd"`，`[showIcon]`）
  - To 日期选择器（`p-datepicker`，`[(ngModel)]` 绑定 signal，`[minDate]` 绑定 From 日期）
  - 底部Actions栏：Cancel（ghost variant，关闭面板）/ Apply（primary variant，禁用直至两个日期均有效）
- 选择 Apply 后：面板关闭，按钮标签更新为格式化日期范围（如 "Apr 1 – Apr 30"），触发 `timeRangeChange` 事件携带 `{timeRange: 'custom', startDate, endDate}`

### 图表空Status（Chart Empty State）
当 API 返回空数据或无数据时（`data` 数组长度为 0 或 `null`），图表区域显示空Status占位，遵循 §12.4 空Status设计风格：

| 属性 | 规格 |
|------|------|
| 占位元素 | 折线图标（48px，`#2a3a50`）+ 标题"暂无趋势数据"（`#94a3b8`，14px） |
| 容器 | 图表卡片保持原有尺寸（sharp-card，不可折叠），占位居中显示 |
| 描述文案 | "所选时间范围内没有预约记录" |
| Actions按钮 | "清除筛选"（sharp-btn-text，仅在有筛选条件时显示） |
| 交互 | 点击"清除筛选" → 重置 timeRange 为 last7d → 触发 `loadStats()` 重新加载 |
| 骨架屏过渡 | API 加载中显示图表骨架屏（`#1e293b` shimmer 动画），加载完成后若数据为空则平滑切换为空Status占位（fadeIn 200ms） |
| 空Status恢复 | 后续 WebSocket 推送或轮询发现新数据时自动从空Status切换回正常图表（fadeIn 300ms） |

**空Status占位布局**：
```
┌─────────────────────────────────────┐
│  [折线图图标 (48px, #2a3a50)]        │
│  暂无趋势数据                         │
│  所选时间范围内没有预约记录            │
│  [清除筛选]  (可选)                   │
└─────────────────────────────────────┘
```

## 4.4 图表色板
| 序号 | 颜色 | 色值 | 用途 |
|------|------|------|------|
| 1 | 强调绿 | #2ecc71 | 主要数据系列 |
| 2 | 强调绿 | #2ecc71 | 正向指标/第二系列 |
| 3 | 强调紫 | #9b59b6 | 第三系列/收入 |
| 4 | 强调橙 | #f39c12 | 第四系列/警告 |
| 5 | 强调红 | #e74c3c | 第五系列/异常 |

## 4.5 最近预约列表
**表格卡片**：
- sharp-card 容器
- padding：0（表格撑满）
- 标题栏：padding 16px 24px + 底部边框

**表格**：使用 `.data-table` 暗色主题（详见 §7）

==========================================================
# 5. Users页面
==========================================================

## 5.1 页面布局
```
┌─────────────────────────────────────────────────────────┐
│  Users            [搜索] [角色筛选] [Status筛选] [+ 新增]  │
├─────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐ │
│  │  筛选标签：[全部] [Admin] [Super Admin] [Customer]  │ │
│  └────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐ │
│  │  .data-table (用户表格)                            │ │
│  │  ID | User | Email | Role | Status | Created | ...  │ │
│  └────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  Showing 1-10 of 123                    [分页器]        │
└─────────────────────────────────────────────────────────┘
```

## 5.2 搜索与筛选
**搜索框（sharp-input）**：
- 背景：#0c1220（dark-bg）
- 边框：1px solid #2a3a50
- border-radius：6px
- placeholder："Search by name, email..."
- 聚焦：border-color #2ecc71 + box-shadow 0 0 0 3px rgba(46, 204, 113, 0.15)

**筛选标签**：
- 默认：背景 transparent + border 1px solid #2a3a50 + color #94a3b8
- 悬停：border-color #2ecc71 + color #e2e8f0
- 选中：背景 rgba(46, 204, 113, 0.15) + border-color #2ecc71 + color #2ecc71

**Actions按钮（sharp-button）**：
- 导出：次按钮（透明 + #2a3a50 边框 + #94a3b8 文字）
- Add User：主按钮（#2ecc71 背景 + 白色文字）

## 5.3 用户表格
**列定义**：
| 列名 | 宽度 | 内容 |
|------|------|------|
| ID | 80px | UUID 缩写 |
| User Name | 150px | 头像（首字母缩写） + 名称 |
| 邮箱 | 200px | 脱敏显示（us***@example.com） |
| 角色 | 120px | 角色标签（见下方） |
| Status | 100px | 启用/禁用 Toggle |
| Created | 150px | 相对时间 / 绝对时间 |
| Actions | 120px | 编辑 / 禁用 / 删除（文字按钮） |

**角色标签**：
- CUSTOMER：text #94a3b8，bg rgba(148, 163, 184, 0.1)
- ADMIN：text #2ecc71，bg rgba(46, 204, 113, 0.1)
- SUPER_ADMIN：text #9b59b6，bg rgba(155, 89, 182, 0.1)

**Status Toggle**：
- 使用 PrimeNG ToggleSwitch 暗色主题
- 开启：轨道 #2ecc71 + 滑块白色
- 关闭：轨道 #2a3a50 + 滑块 #94a3b8

## 5.4 用户Actions弹窗
**Modal（sharp-card 风格）**：
- 遮罩：rgba(0, 0, 0, 0.6)
- 弹窗：bg #162032 + border 1px solid #2a3a50 + border-radius 8px
- 宽度：640px
- 标题：18px bold，#e2e8f0
- 表单字段（见 §8）

## 5.5 分页器
**样式**：
- 左："Showing 1-10 of 123"，#94a3b8，14px
- 右：分页按钮组
- 按钮（sharp）：32px x 32px，bg transparent + border #2a3a50 + color #94a3b8
- 选中：bg #2ecc71 + color white + border #2ecc71
- 禁用：opacity 0.4

==========================================================
# 6. Services页面
==========================================================

## 6.1 页面布局
类似Users，表格列不同。

## 6.2 服务表格
| 列名 | 宽度 | 内容 |
|------|------|------|
| ID | 80px | UUID 缩写 |
| Service Name | 200px | 缩略图（48px, 8px圆角） + 名称 |
| Duration | 100px | "60 分钟" |
| Price | 120px | "¥128" |
| Price/Min | 100px | "¥2.13/分钟"（自动计算：price / duration） |
| Tax Rate | 80px | "8%" |
| Status | 100px | 上架/下架 Toggle |
| Created | 150px | 日期 |
| Actions | 150px | 编辑 / 上下架 / 删除 |

## 6.3 服务Status
- 上架：Toggle 开启（#2ecc71 轨道）
- 下架：Toggle 关闭（#2a3a50 轨道）

## 6.4 新增/编辑服务弹窗
**Modal（640px）**：
- 字段：Service Name、描述、Duration、Price、Price/Min（自动计算，只读展示）、Tax Rate(taxRate)、图片上传、Status
- **auto-calc**：`Price/Min` 非手动输入字段。前端在 `duration` 和 `price` 输入后自动计算 `price / duration` 并只读展示。保存时 `pricePerMinute` 由后端自动计算。
- 图片上传区：
  - 拖拽区域：bg #0c1220 + border 2px dashed #2a3a50 + border-radius 8px
  - 悬停：border-color #2ecc71 + bg rgba(46, 204, 113, 0.05)
  - 预览缩略图：80px x 80px，8px 圆角

## 6.5 Appointments表格
| 列名 | 宽度 | 内容 |
|------|------|------|
| Appointment # | 140px | "APT-20260506-xxx" |
| User Name | 150px | User Name称 |
| Service Name | 150px | 关联Service Name |
| Date & Time | 160px | 预约日期 + 时间段 |
| Duration | 80px | "60 分钟" |
| Price | 100px | "¥128" |
| Tax Rate | 80px | "8%" |
| Tax Incl. Amount | 100px | "¥138.24" |
| Status | 100px | Status标签（同Users样式） |
| Created | 150px | 日期 |
| Actions | 150px | 更新Status / 取消 |

==========================================================
# 7. 表格规范（.data-table 暗色主题）
==========================================================

## 7.1 暗色数据表格
```css
.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th {
  text-align: left;
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  background-color: rgba(42, 58, 80, 0.3);
  border-bottom: 1px solid #2a3a50;
  position: sticky;
  top: 0;
  z-index: 10;
}

.data-table td {
  padding: 0.75rem 1rem;
  font-size: 14px;
  color: #e2e8f0;
  border-bottom: 1px solid rgba(42, 58, 80, 0.5);
}

.data-table tbody tr:hover {
  background-color: rgba(42, 58, 80, 0.2);
}

.data-table tbody tr:nth-child(even) {
  background-color: rgba(42, 58, 80, 0.1);
}
```

## 7.2 表格Actions列
**按钮组（文字按钮）**：
- 查看 / 编辑：color #2ecc71，hover underline
- 删除：color #e74c3c，hover underline
- 更多：省略号图标 → 下拉菜单（sharp-card 风格）

**下拉菜单**：
- 背景：#162032 + border 1px solid #2a3a50 + border-radius 8px
- 选项：hover bg #1e293b

## 7.3 排序与筛选
**表头排序**：
- 点击表头切换排序
- 图标：↑ ↓，选中时 color #2ecc71

**列筛选**：
- 表头下方可选筛选行（搜索输入或下拉）

==========================================================
# 8. 表单规范（Sharp Form）
==========================================================

## 8.1 暗色输入框（Sharp Input）
```css
.sharp-input {
  height: 36px;
  padding: 0 12px;
  background: #0c1220;
  border: 1px solid #2a3a50;
  border-radius: 6px;
  font-size: 14px;
  color: #e2e8f0;
  width: 100%;
  transition: border-color 200ms ease;
}

.sharp-input::placeholder {
  color: #64748b;
}

.sharp-input:focus {
  outline: none;
  border-color: #2ecc71;
  box-shadow: 0 0 0 3px rgba(46, 204, 113, 0.15);
}

.sharp-input.error {
  border-color: #e74c3c;
  box-shadow: 0 0 0 3px rgba(231, 76, 60, 0.15);
}
```

## 8.2 表单标签
```css
.sharp-form-label {
  font-size: 14px;
  color: #e2e8f0;
  font-weight: 500;
  margin-bottom: 8px;
  display: block;
}

.sharp-form-label .required {
  color: #e74c3c;
  margin-left: 4px;
}

.sharp-form-error {
  font-size: 12px;
  color: #e74c3c;
  margin-top: 4px;
}
```

## 8.3 表单布局
- **单列**（标准）：标签在上，输入框在下，间距 8px + 4px error + 20px field
- **双列**（宽屏）：两列并排，间距 24px，移动端自动变单列
- **Actions栏**：底部右对齐，取消（次按钮左） + 保存（主按钮右）

==========================================================
# 9. 按钮规范（Sharp Button）
==========================================================

## 9.1 按钮类型

**主按钮（Primary）**：
```css
.sharp-btn-primary {
  background: #2ecc71;
  color: #0c1220;
  padding: 8px 20px;
  border-radius: 6px;
  border: 1px solid rgba(46, 204, 113, 0.3);
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  transition: all 200ms ease;
}
.sharp-btn-primary:hover {
  background: #27ae60;
  box-shadow: 0 8px 15px -3px rgba(0, 0, 0, 0.4), 0 0 10px rgba(46, 204, 113, 0.4);
  transform: translateY(-2px);
}
.sharp-btn-primary:active {
  transform: translateY(0);
}
.sharp-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
```

**次按钮（Secondary）**：
```css
.sharp-btn-secondary {
  background: transparent;
  color: #94a3b8;
  padding: 8px 20px;
  border-radius: 6px;
  border: 1px solid #2a3a50;
  font-size: 14px;
  transition: all 200ms ease;
}
.sharp-btn-secondary:hover {
  border-color: #2ecc71;
  color: #2ecc71;
}
```

**危险按钮（Danger）**：
```css
.sharp-btn-danger {
  background: #e74c3c;
  color: white;
  padding: 8px 20px;
  border-radius: 6px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  transition: all 200ms ease;
}
.sharp-btn-danger:hover {
  background: #c0392b;
  box-shadow: 0 8px 15px -3px rgba(0, 0, 0, 0.4), 0 0 8px rgba(231, 76, 60, 0.4);
}
```

**文字按钮（Text）**：
```css
.sharp-btn-text {
  background: transparent;
  color: #2ecc71;
  padding: 4px 8px;
  border: none;
  font-size: 14px;
  transition: all 150ms ease;
}
.sharp-btn-text:hover {
  text-decoration: underline;
  opacity: 0.8;
}
```

## 9.2 按钮尺寸
| 尺寸 | 高度 | 内边距 | 用途 |
|------|------|--------|------|
| sm | 28px | 4px 12px | 表格内Actions |
| md | 36px | 8px 20px | 标准 |
| lg | 44px | 12px 28px | 重要Actions |

==========================================================
# 10. 弹窗规范（Modal）
==========================================================

## 10.1 弹窗类型
| 类型 | 宽度 | 用途 |
|------|------|------|
| 小型 | 400px | 确认、提示 |
| 标准 | 520px | 表单（少量字段） |
| 大型 | 640px | 表单（多字段）、详情 |
| 全屏 | 100% | 复杂编辑 |

## 10.2 弹窗样式（Sharp Modal）
**遮罩层**：
- background：rgba(0, 0, 0, 0.6)
- z-index：50

**弹窗本体**：
- background：#162032（card-bg）
- border：1px solid #2a3a50
- border-radius：8px
- box-shadow：0 20px 60px rgba(0, 0, 0, 0.5)
- padding：24px（标准）/ 32px（大型）

## 10.3 确认弹窗
```
┌─────────────────────────────┐
│  ⚠️ 确认Delete User？            │  ← 标题 18px bold #e2e8f0
│                              │
│  确定要Delete User "张三" 吗？    │  ← 描述 14px #94a3b8
│  此Actions不可撤销。             │
│                              │
│  [取消]        [确认删除]     │  ← 次按钮 + 危险按钮
└─────────────────────────────┘
```

==========================================================
# 11. 图表规范（Admin Charts）
==========================================================

## 11.1 图表库
PrimeNG Charts（基于 Chart.js）

## 11.2 暗色图表主题配置
```javascript
Chart.defaults.color = '#94a3b8';       // 网格/标签色
Chart.defaults.borderColor = 'rgba(42, 58, 80, 0.5)'; // 网格线
```

## 11.3 色板（5 色系统）
| 系列 | 颜色 | CSS 变量 |
|------|------|---------|
| 系列 1（主） | #2ecc71 | --accent-green |
| 系列 2（正） | #1abc9c | --accent-teal |
| 系列 3（辅） | #9b59b6 | --accent-purple |
| 系列 4（警） | #f39c12 | --accent-yellow |
| 系列 5（危） | #e74c3c | --accent-red |

## 11.4 图表类型规范
**折线图**：
- 平滑曲线（tension: 0.3）
- 数据点：圆形 5px，白色填充 + 系列色边框
- 填充：系列色 + opacity 0.1
- 悬停：数据点放大至 8px

**柱状图**：
- 锐利顶部（无圆角）
- 间距：barPercentage 0.7
- 悬停：opacity 0.8

**环形图**：
- 内半径：60%
- 中心文字：#e2e8f0（总计数值）
- 边框：无（clean）

**热力图**：
- 颜色渐变：#162032 → #27ae60
- 单元间距：2px
- 圆角：2px

==========================================================
# 12. Status与反馈
==========================================================

## 12.1 加载Status
**页面加载**：
- 骨架屏：暗色占位卡片（bg #1e293b + shimmer 动画）
- shimmer 渐变：linear-gradient(90deg, #1e293b 25%, #2a3a50 50%, #1e293b 75%)
- 顶部进度条：#2ecc71 线条（2px 高），NProgress 风格

**Actions加载**：
- 按钮：spinner（border #2a3a50 + border-top #2ecc71）+ 文字
- 表格行：行内暗色骨架

## 12.2 成功反馈
- Toast：bg #162032 + border-left 4px #2ecc71 + 绿色图标
- 自动消失：3 秒
- 位置：右上角

## 12.3 错误反馈
- Toast：bg #162032 + border-left 4px #e74c3c + 红色图标
- 手动关闭
- 内容：错误信息 + 重试按钮

## 12.4 空Status
**表格空Status**：
- 图标：空盒子（48px），color #2a3a50
- 标题："No data"，color #94a3b8
- 描述："没有找到符合条件的记录"
- 按钮："清除筛选"（有筛选时显示）

==========================================================
# 13. 权限控制
==========================================================

## 13.1 角色权限矩阵
| 功能 | ADMIN | SUPER_ADMIN |
|------|-------|------------|
| 查看Dashboard | ✅ | ✅ |
| 管理用户 | 查看/编辑 | 完整（含删除） |
| 管理服务 | 完整 | 完整 |
| 管理预约 | 查看/取消 | 完整 |
| Analytics | ✅ | ✅ |
| History | ❌ | ✅ |
| Settings | ❌ | ✅ |

## 13.2 UI 权限控制
- 无权限菜单项：隐藏
- 无权限按钮：禁用（opacity 0.4 + cursor not-allowed）
- 越权访问：跳转 403 页面

==========================================================
# 14. 移动端适配
==========================================================

## 14.1 布局调整
- 侧边栏：隐藏，汉堡菜单打开遮罩抽屉
- 表格：overflow-x auto（横向滚动）/ 卡片视图切换
- 筛选：折叠式 accordion
- 统计卡片：2 列网格

## 14.2 移动端表格
- 方案 1：横向滚动（overflow-x: auto）
- 方案 2：卡片视图（每行变为 sharp-card）

## 14.3 弹窗移动端
- 全屏 Modal
- 底部滑入动画
- 顶部关闭按钮

==========================================================
# 15. 动画规范
==========================================================

## 15.1 标准过渡
- 弹窗：fadeIn + scale(0.95→1)，300ms ease
- 开关：平滑过渡 200ms
- 按钮 hover：translateY(-2px) + 阴影增强，200ms
- 卡片 hover：translateY(-3px) + border-color 高亮 + 阴影增强，300ms
- 页面切换：fadeIn 300ms

## 15.2 关键帧
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

==========================================================
# 16. 实现检查清单
==========================================================

## 16.1 基础实现
- [ ] Admin Layout（Header + Sidebar[sharp-card] + Content[dark-bg + grid]）
- [ ] 路由配置（/admin/* 7 个路由）
- [ ] 权限守卫（AdminGuard / SuperAdminGuard）
- [ ] 面包屑组件

## 16.2 页面实现
- [ ] Dashboard（4 个 Stat Cards + 3 个图表 + 最近预约表格）
- [ ] Users（搜索 + 筛选标签 + .data-table + Modal）
- [ ] Services（搜索 + .data-table + Modal + 图片上传）
- [ ] Appointments（高级筛选 + .data-table + Modal + 批量Actions）
- [ ] Analytics（图表Dashboard + 报表导出）
- [ ] History（Actions日志 + 筛选）
- [ ] Settings（全局配置表单）

## 16.3 组件实现
- [ ] .data-table（暗色主题表格）
- [ ] .sharp-input（暗色输入框）
- [ ] .sharp-card（暗色卡片）
- [ ] .sharp-button（4 种类型）
- [ ] Stat Card（sharp-card + 图标 + 进度条）
- [ ] Chart Card（暗色图表容器）
- [ ] Sharp Modal
- [ ] Pagination
- [ ] Filter Tags
- [ ] Image Upload（暗色拖拽区）

## 16.4 移动端
- [ ] 响应式布局
- [ ] 表格横向滚动
- [ ] 侧边栏抽屉
- [ ] 底部Actions栏

==========================================================
# 附录 A：设计令牌速查表
==========================================================

| 令牌 | 色值 | 说明 |
|------|------|------|
| dark-bg | #0c1220 | 页面背景 |
| card-bg | #162032 | 卡片/导航/侧边栏背景 |
| card-bg-light | #1e293b | 悬停/次要背景 |
| border-color | #2a3a50 | 边框/分割线 |
| text-primary | #e2e8f0 | 主文字 |
| text-secondary | #94a3b8 | 次要文字 |
| accent-green | #2ecc71 | 强调色 |
| accent-green-dark | #27ae60 | 深强调色 |
| accent-green | #2ecc71 | 成功/正向 |
| accent-red | #e74c3c | 危险/负向 |
| accent-yellow | #f39c12 | 警告/待处理 |
| accent-purple | #9b59b6 | 辅助/收入 |
| accent-teal | #1abc9c | 辅助 |
| accent-orange | #e67e22 | 辅助 |
| radius-sharp | 8px | 卡片圆角 |
| radius-button | 6px | 按钮圆角 |
| radius-input | 6px | 输入框圆角 |

==========================================================
# 附录 B：与全局 UI 规范对照表
==========================================================

| 规范项 | 全局 UI 规范 v3.0 | Admin 规范 v2.3.0（本文件） |
|--------|-------------------|--------------------------|
| 设计风格 | 暗色优先（Dark-First） | 暗色数据Dashboard |
| 主色 | #2ecc71 | #2ecc71 |
| 背景 | #0c1220 | #0c1220 |
| 卡片背景 | #162032 | #162032 |
| 卡片样式 | sharp-card（8px 边框） | sharp-card（8px 边框） |
| 按钮样式 | sharp-button（6px） | sharp-button（6px） |
| 输入框样式 | sharp-input（6px） | sharp-input（6px） |
| 弹窗 | sharp modal（8px） | sharp modal（8px） |
| 表格 | .data-table 暗色 | .data-table 暗色 |
| 图表色板 | 5色系统 | 5色系统（同） |
| 阴影 | 实色阴影（无弥散） | 实色阴影 |
| 动画 | 基础过渡（无弹簧） | 基础过渡 |
| 字体 | Inter + 系统字体 | Inter + 系统字体 |

**结论**：Admin 后台与全局规范完全对齐，使用统一的暗色 sharp design 语言。无玻璃态、无渐变、无弥散阴影。
