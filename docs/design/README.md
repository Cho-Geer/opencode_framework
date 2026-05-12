# Booking System UI 设计文档索引
版本：3.0.0（暗色优先 Sharp Design 统一设计系统）
日期：2026-05-05
上一版本：2.2.0（2026-04-30，玻璃态双系统）

> ⚠️ **版本 3.0.0 弃用通知**：自 2026-05-04 起，本项目的设计范式已从「玻璃态双系统（Glassmorphism Dual-System）」切换为「暗色优先 Sharp Design（Dark-First）」统一系统。所有玻璃态（glassmorphism）相关规范已废弃，`glassmorphism-design-system.md` 不再作为主要参考。

==========================================================
# 文档总览
==========================================================

本次更新基于 prototype/admin/dashboard.html（暗色仪表盘原型），已建立完整的 **暗色优先 Sharp Design** 设计系统体系。

## 文档清单

| 文档 | 说明 | 状态 |
|------|------|------|
| global-ui-spec.md | 全局 UI 规范（v3.0.0，暗色优先 Sharp Design） | ✅ **权威来源** |
| customer-ui-spec.md | Customer 前台 UI 规范（v2.0.0） | ✅ 已创建（Sharp Design v2.0.0） |
| admin-ui-spec.md | Admin 后台 UI 规范（v2.0.0，暗色数据仪表盘） | ✅ 已创建 |
| interaction-patterns.md | 交互模式规范（v2.0.0，已迁移至 Sharp Design 术语） | ⚠️ 已弃用旧玻璃态术语 |
| ui-implementation-plan.md | UI 实现计划 | ✅ 已创建 |
| multi-agent-evaluation.md | 多智能体评估 | ✅ 已创建 |
| glassmorphism-design-system.md | 玻璃态设计系统（**已废弃**，仅保留作为历史参考） | 🗑️ Legacy |

=========================================================
# 设计决策摘要
=========================================================

## 1. 统一设计系统：暗色优先 Sharp Design

自 v3.0.0 起，项目采用**统一暗色优先 Sharp Design 系统**：

- **主色调**：
  - 背景：`#0c1220`（深空蓝黑）→ `#162032`（卡片背景）
  - 强调色：`#2ecc71`（纯色强调绿）→ `#27ae60`（深色变体）
  - 文字：`#e2e8f0`（主文字）/ `#94a3b8`（次要文字）
- **卡片样式**：sharp-card（8px 圆角 + 1px 实色边框 `#2a3a50`）
- **按钮样式**：sharp-button（6px 圆角 + 实色边框）
- **输入框样式**：sharp-input（6px 圆角）
- **杜绝**：弥散阴影、backdrop-filter 模糊、玻璃态半透明

## 2. 设计系统核心令牌

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--color-bg-primary` | `#0c1220` | 页面主背景 |
| `--color-bg-secondary` | `#162032` | 卡片/导航栏背景 |
| `--color-bg-tertiary` | `#1e293b` | 卡片悬停/次要背景 |
| `--color-border` | `#2a3a50` | 边框/分割线 |
| `--color-text-primary` | `#e2e8f0` | 主文字色 |
| `--color-text-secondary` | `#94a3b8` | 次要文字色 |
| `--color-accent-green` | `#2ecc71` | 主强调色（按钮/链接/选中态） |
| `--color-accent-green-dark` | `#27ae60` | 强调色深色变体 |
| `--color-accent-green` | `#2ecc71` | 成功/正向指标 |
| `--color-accent-red` | `#e74c3c` | 危险/负向指标 |
| `--color-accent-yellow` | `#f39c12` | 警告/待处理 |
| `--color-accent-purple` | `#9b59b6` | 辅助色/收入指标 |
| `--radius-sharp` | `8px` | 卡片圆角 |
| `--radius-button` | `6px` | 按钮圆角 |

### 废弃的旧设计（不再使用）

| 旧风格 | 旧色值 | 替代 |
|--------|--------|------|
| Customer 玻璃态 | `#667eea` → `#764ba2` 渐变 | `#00c6ff` 纯色强调蓝 |
| Admin 标准企业 | `#1677FF` 纯蓝 | `#00c6ff` 统一强调色 |
| 玻璃态层级 (Level 1-4) | backdrop-filter + 半透明 | sharp-card 实色边框 |
| 玻璃阴影 | 弥散彩色阴影 | 暗色实色阴影 |

### 动画系统
- 微交互：100-150ms（点击、悬停）
- 标准过渡：200-300ms（状态切换、模态）
- 页面级：300-500ms（页面切换）

### 响应式策略
- 桌面端：完整暗色 Sharp Design 体验
- 移动端：相同风格，缩小间距
- 触控优化：最小 44px 点击区域

## 3. 技术实现

### 前端技术栈
- Angular v21+（Standalone Components）
- Tailwind CSS v4（自定义配置，见 `styles.scss`）
- PrimeNG（组件库基础）
- NgRx Signals（状态管理）

### 关键配置文件
- **设计令牌**：`booking-frontend/src/styles.scss`（`@theme` 块中的 CSS 自定义属性）
  - **图表色板**：`#2ecc71`（绿）、`#1abc9c`（青）、`#9b59b6`（紫）、`#f39c12`（橙）、`#e74c3c`（红）
- **阴影**：`shadow-card`、`shadow-card-hover`、`shadow-glow-green`

=========================================================
# 与已有文档的关系
=========================================================

## 继承关系
```
global-ui-spec.md v3.0.0（基础，暗色优先）
    ├── admin-ui-spec.md v2.0.0（应用：暗色数据仪表盘）
    ├── customer-ui-spec.md（应用：Sharp Design v2.0.0）
    └── interaction-patterns.md v2.0.0（补充：Sharp Design 术语）

ui-implementation-plan.md（执行）
    ├── 引用所有设计文档
    └── multi-agent-evaluation.md（协作）

booking-frontend/src/styles.scss（实现：Tailwind @theme 设计令牌）
```

## 兼容性
- ✅ 与 `contract.yaml` API 契约一致
- ✅ 与 `AGENTS.md` 多智能体规范一致
- ✅ 与 `frontend-coding-standard.md` 编码规范一致
- ✅ 与 `testing-coding-standard.md` 测试规范一致

=========================================================
# 使用指南
=========================================================

## 前端开发者
1. 首先阅读 `global-ui-spec.md` v3.0.0 了解基础规范和设计令牌
2. 根据开发页面阅读对应规范：
   - Admin 页面 → `admin-ui-spec.md` v2.0.0
   - Customer 页面 → `customer-ui-spec.md`（v2.0.0，Sharp Design）
3. 实现组件时参考 `booking-frontend/src/styles.scss` 中的 Tailwind `@theme` 设计令牌
4. 添加交互时遵循 `interaction-patterns.md` v2.0.0（已迁移至 Sharp Design 术语）
5. 按 `ui-implementation-plan.md` 执行任务

## 设计师
1. `global-ui-spec.md` v3.0.0 是设计令牌总览
2. `admin-ui-spec.md` v2.0.0 是 Admin 后台页面规范
3. `interaction-patterns.md` v2.0.0 是交互规范
4. `styles.scss` 是实际实现的权威令牌来源

## 项目经理
1. `ui-implementation-plan.md` 是执行蓝图
2. `multi-agent-evaluation.md` 是协作指南
3. 按阶段规划跟踪进度

=========================================================
# 后续维护
=========================================================

## 更新记录
| 日期 | 版本 | 更新内容 |
|------|------|---------|
| 2026-05-05 | 3.0.0 | **设计范式统一**：从「玻璃态双系统」切换为「暗色优先 Sharp Design」，移除所有玻璃态引用，统一颜色令牌为 `#00c6ff` / `#0c1220`，glassmorphism-design-system.md 降级为 Legacy 文档 |
| 2026-04-30 | 2.2.0 | 最终修复轮（21 个问题） |
| 2026-04-30 | 2.0.0 | 新增玻璃态设计系统（现已废弃） |
| 2026-04-16 | 1.0.0 | 初始全局 UI 规范 |

## 维护责任
- 设计文档由 Architect 和前端负责人维护
- 每次设计变更需更新相关文档
- 文档变更需同步更新实现代码

=========================================================
# 附录：快速参考
=========================================================

## 颜色速查（统一 Sharp Design）
| 用途 | 色值 | 说明 |
|------|------|------|
| 主色/强调色 | #2ecc71 | 按钮、链接、选中态 |
| 主色深色变体 | #27ae60 | 渐变终点、hover 状态 |
| 成功/正向 | #2ecc71 | 趋势上升、成功状态 |
| 警告 | #f39c12 | 待处理、警告状态 |
| 危险/负向 | #e74c3c | 趋势下降、错误状态 |
| 主背景 | #0c1220 | 页面基底 |
| 卡片背景 | #162032 | 卡片、导航栏、侧边栏 |
| 卡片悬停 | #1e293b | 次要背景 |
| 边框 | #2a3a50 | 分割线、边框 |
| 主文字 | #e2e8f0 | 高对比度白色 |
| 次要文字 | #94a3b8 | 辅助说明文字 |

## 圆角速查（统一 Sharp Design）
| 元素 | 圆角 | 
|------|------|
| 卡片 (sharp-card) | 8px |
| 按钮 (sharp-button) | 6px |
| 输入框 (sharp-input) | 6px |

## 动画速查
| 类型 | 时长 | 缓动 |
|------|------|------|
| 点击反馈 | 100ms | ease |
| 悬停效果 | 200ms | ease |
| 模态框 | 300ms | cubic-bezier(0.4, 0, 0.2, 1) |
| 页面切换 | 400ms | ease |

---
**注意**：已废弃的 `glassmorphism-design-system.md` 仅作为历史参考保留，所有新开发必须以 `global-ui-spec.md` v3.0.0 和 `styles.scss` 为准。

---

**文档维护者**：前端团队  
**最后更新**：2026-05-05  
**下次评审**：2026-06-01