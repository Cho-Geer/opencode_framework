# 全局 UI / 样式 / 交互 统一规范
适用于：前端页面、组件风格、弹窗、表格、表单、颜色、字体、间距、图标、状态
版本：3.0.0（暗色优先设计系统，移除玻璃态）
更新日期：2026-05-04

> **v3.0.0 重大变更**：设计范式从「标准企业 + 玻璃态双系统」切换为「暗色优先（Dark-First）单系统」。
> 玻璃态（Glassmorphism）已整体废弃，详见 §14 Legacy 章节。新旧对照见附录 A。

==========================================================
# 0. 版本变更日志
==========================================================

## v3.0.0 — 2026-05-04
- **设计范式切换**：移除玻璃态双系统，统一为「暗色优先（Dark-First）」
- **新增**：暗色设计令牌表（§1.1.2）
- **新增**：Sharp 组件变体定义（sharp-card、sharp-button、sharp-input）
- **移除**：所有玻璃态相关规范（移至 §14 Legacy）
- **更新**：图表色板从渐变系 → 5 色暗色系
- **更新**：动画规范（移除弹簧动画、玻璃入场动画）

## v2.0.0 — 2026-04-30
- 新增玻璃态设计风格
- 双设计系统并行（Admin 标准企业 + Customer 玻璃态）

## v1.0.0 — 2026-04-15
- 初始版本：标准企业 UI 规范

==========================================================
# 1. 全局基础规范
==========================================================

## 1.1 设计理念
本项目采用统一的**暗色优先（Dark-First）设计系统**，基于 prototype/admin/dashboard.html：
- **暗色基底**：深空蓝黑背景 #0c1220，减少眼部疲劳
- **锐利边界**：sharp-card（8px 圆角 + 实色边框），杜绝弥散阴影和模糊
- **高对比度**：亮色数据指标在暗色背景上高度可见
- **统一一致**：Admin 和 Customer 使用同一套设计令牌

## 1.2 设计令牌（Design Tokens）

### 1.2.1 暗色调色板（核心）
| 令牌 | 色值 | 色块 | 用途 |
|------|------|------|------|
| `--bg-dark-bg` | `#0c1220` | █████ | 页面主背景 |
| `--bg-card-bg` | `#162032` | █████ | 卡片、导航栏、侧边栏 |
| `--bg-card-bg-light` | `#1e293b` | █████ | 卡片悬停、次要背景 |
| `--border-color` | `#2a3a50` | █████ | 边框、分割线 |
| `--text-primary` | `#e2e8f0` | █████ | 主文字色 |
| `--text-secondary` | `#94a3b8` | █████ | 次要/辅助文字 |

### 1.2.2 强调色（Accent Colors）
| 令牌 | 色值 | 色块 | 用途 |
|------|------|------|------|
| `--accent-green` | `#2ecc71` | █████ | **主强调色**（按钮、链接、选中态、图表系列1） |
| `--accent-green-dark` | `#27ae60` | █████ | 强调色深色变体（hover 状态） |
| `--accent-green` | `#2ecc71` | █████ | 成功/正向指标（图表系列2） |
| `--accent-purple` | `#9b59b6` | █████ | 辅助/收入指标（图表系列3） |
| `--accent-yellow` | `#f39c12` | █████ | 警告/待处理（图表系列4） |
| `--accent-red` | `#e74c3c` | █████ | 危险/负向指标（图表系列5） |
| `--accent-teal` | `#1abc9c` | █████ | 辅助色 |
| `--accent-orange` | `#e67e22` | █████ | 辅助色 |

### 1.2.3 圆角令牌
| 令牌 | 值 | 用途 |
|------|-----|------|
| `--radius-card` | `8px` | 卡片（sharp-card） |
| `--radius-button` | `6px` | 按钮（sharp-button） |
| `--radius-input` | `6px` | 输入框（sharp-input） |
| `--radius-modal` | `8px` | 弹窗 |
| `--radius-tag` | `4px` | 标签/Badge |

### 1.2.4 阴影令牌
| 令牌 | 值 | 用途 |
|------|-----|------|
| `--shadow-card` | `0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -1px rgba(0,0,0,0.2)` | 卡片默认 |
| `--shadow-card-hover` | `0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -2px rgba(0,0,0,0.25)` | 卡片悬停 |
| `--shadow-glow-green` | `0 0 15px rgba(46, 204, 113, 0.3)` | 主强调色发光 / 成功发光 |
| `--shadow-modal` | `0 20px 60px rgba(0, 0, 0, 0.5)` | 弹窗 |

## 1.3 字体
- 中文：思源黑体 / 微软雅黑（系统回退）
- 英文/数字：Inter（系统回退 system-ui）
- 字号层级：
  - 大标题：24 / 28 px
  - 标题：16 / 18 / 20 px
  - 正文：14 px
  - 小字：12 px
  - 辅助文字：11 px
- 代码：monospace（Fira Code / Cascadia Code）

## 1.4 间距
- 模块间距：20px
- 卡片内边距：20px（sharp-card）
- 表单间距：12px
- 按钮高度：28（sm）/ 36（md）/ 44（lg）
- 输入框高度：36px

==========================================================
# 2. Sharp 组件变体定义
==========================================================

## 2.1 Sharp Card（锐利卡片）
```css
.sharp-card {
  background: #162032;
  border: 1px solid rgba(42, 58, 80, 0.5);
  border-radius: 8px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
  transition: all 0.3s ease;
}

.sharp-card:hover {
  border-color: rgba(46, 204, 113, 0.5);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.25), 0 0 15px rgba(46, 204, 113, 0.2);
  transform: translateY(-3px);
}
```
- 用途：所有内容卡片、统计卡片、图表容器、信息面板

## 2.2 Sharp Button（锐利按钮）
```css
.sharp-button {
  border-radius: 6px;
  border: 1px solid rgba(46, 204, 113, 0.3);
  transition: all 0.3s ease;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
}

.sharp-button:hover {
  border-color: rgba(46, 204, 113, 0.6);
  box-shadow: 0 8px 15px -3px rgba(0, 0, 0, 0.4), 0 0 10px rgba(46, 204, 113, 0.4);
  transform: translateY(-2px);
}

.sharp-button:active {
  transform: translateY(0);
}
```
- 主按钮：bg `#2ecc71` + 粗体白色/深色文字
- 次按钮：bg transparent + border `#2a3a50` + color `#94a3b8`
- 危险按钮：bg `#e74c3c` + white 文字
- 文字按钮：bg transparent + color `#2ecc71` + no border

## 2.3 Sharp Input（锐利输入框）
```css
.sharp-input {
  background: #0c1220;
  border: 1px solid #2a3a50;
  border-radius: 6px;
  padding: 0 12px;
  height: 36px;
  color: #e2e8f0;
  font-size: 14px;
  transition: border-color 200ms ease;
  width: 100%;
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

==========================================================
# 3. 页面结构规范
==========================================================

## 3.1 布局
- 顶部导航栏：固定（sticky），bg `#162032`，高 64px
- 左侧菜单：固定，bg `#162032`，宽 240px
- 内容区域：bg `#0c1220`，内边距 24px
- 移动端：自适应、单列

## 3.2 卡片（Sharp Card）
- 背景：`#162032`（card-bg）
- 边框：1px solid rgba(42, 58, 80, 0.5)
- border-radius：8px
- 阴影：--shadow-card
- 标题左对齐、加粗（16-18px，color #e2e8f0）
- 底部操作按钮右对齐
- hover：translateY(-3px) + border-color → rgba(46, 204, 113, 0.5) + 阴影增强

## 3.3 表格（Data Table）
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
  color: #94a3b8;
  background: rgba(42, 58, 80, 0.3);
  border-bottom: 1px solid #2a3a50;
}

.data-table td {
  padding: 0.75rem 1rem;
  color: #e2e8f0;
  border-bottom: 1px solid rgba(42, 58, 80, 0.5);
}

.data-table tbody tr:hover {
  background: rgba(42, 58, 80, 0.2);
}

.data-table tbody tr:nth-child(even) {
  background: rgba(42, 58, 80, 0.1);
}
```

==========================================================
# 4. 表单规范
==========================================================

## 4.1 输入框（Sharp Input）
- 高度：36px
- 内边距：0 12px
- 背景：#0c1220（dark-bg）
- 边框：1px solid #2a3a50
- 聚焦：border-color #2ecc71 + box-shadow 0 0 0 3px rgba(46, 204, 113, 0.15)
- placeholder：color #64748b
- 错误：border-color #e74c3c + 红色阴影

## 4.2 按钮（Sharp Button）
- 主按钮：bg #2ecc71 + bold 深色文字 + border rgba(46,204,113,0.3)
- 次按钮：bg transparent + border #2a3a50 + color #94a3b8
- 文字按钮：bg transparent + color #2ecc71 + no border
- 危险按钮：bg #e74c3c + white 文字
- 禁用：opacity 0.5 + cursor not-allowed

## 4.3 下拉选择
- 选项高度：32px
- hover 背景：#1e293b（card-bg-light）
- Panel：bg #162032 + border #2a3a50 + border-radius 8px

==========================================================
# 5. 弹窗 / 抽屉 / 提示
==========================================================

## 5.1 弹窗（Sharp Modal）
- 遮罩：rgba(0, 0, 0, 0.6)
- 弹窗：bg #162032 + border 1px solid #2a3a50 + border-radius 8px
- 宽度：400px / 520px / 640px / 800px
- 内边距：24px（标准）/ 32px（大型）
- 标题：18px bold，#e2e8f0
- 底部按钮：右对齐（取消左 + 确认右）
- 动画：fadeIn + scale(0.95→1)，300ms ease

## 5.2 提示信息（Toast）
- 成功：bg #162032 + border-left 4px #2ecc71 + 绿色图标
- 警告：bg #162032 + border-left 4px #f39c12 + 橙色图标
- 错误：bg #162032 + border-left 4px #e74c3c + 红色图标
- 加载：bg #162032 + 蓝色 spinner
- 位置：右上角，自动消失 3s

==========================================================
# 6. 状态展示规范
==========================================================

## 6.1 状态标签
- 待确认（PENDING）：text #94a3b8 + bg rgba(148, 163, 184, 0.1)
- 处理中（CONFIRMED）：text #2ecc71 + bg rgba(46, 204, 113, 0.1)
- 已完成（COMPLETED）：text #2ecc71 + bg rgba(46, 204, 113, 0.1)
- 已过期（EXPIRED）：text #f39c12 + bg rgba(243, 156, 18, 0.1)
- 已取消（CANCELLED）：text #e74c3c + bg rgba(231, 76, 60, 0.1)

## 6.2 空状态
- 居中图标 + 简短提示（color #94a3b8）
- 底部操作按钮

==========================================================
# 7. 交互体验规则
==========================================================
- 可点击区域出现手型光标（cursor: pointer）
- 加载必须显示 Loading（spinner 或骨架屏）
- 提交按钮点击后禁用防重复
- 表单实时校验，错误红色提示
- 列表无数据显示空状态
- 所有操作必须有成功/失败反馈

==========================================================
# 8. 移动端适配规则
==========================================================
- 小屏自动单列
- 按钮自动占满宽度
- 弹窗全屏展示
- 表格横向可滚动（overflow-x: auto）
- 字体不小于 12px
- 点击区域最小 44x44px

==========================================================
# 9. 图标与图标风格
==========================================================
- 线性图标（Font Awesome / Prime Icons）
- 20px-24px 统一大小
- 颜色跟随文字主色（#e2e8f0）或当前强调色
- 简洁、现代、统一

==========================================================
# 10. 动画与过渡（简洁实用）
==========================================================

## 10.1 标准过渡
- 弹窗：fadeIn + scale(0.95→1)，300ms ease
- 开关/切换：200ms ease
- 按钮 hover：translateY(-2px) + 阴影增强，200ms
- 卡片 hover：translateY(-3px) + border-color 高亮 + 阴影增强，300ms
- 页面切换：fadeIn 300ms

## 10.2 微交互
- 点击反馈：active 状态 translateY(0)，100ms
- 输入框聚焦：border-color → #2ecc71 + box-shadow glow，200ms
- 加载骨架屏：shimmer 动画，1.5s infinite

==========================================================
# 11. 图表色板
==========================================================

## 11.1 5 色系统
| 系列 | 颜色 | 色值 | CSS 变量 |
|------|------|------|---------|
| 系列 1（主） | 绿 | #2ecc71 | --accent-green |
| 系列 2（正） | 绿 | #2ecc71 | --accent-green |
| 系列 3（辅） | 紫 | #9b59b6 | --accent-purple |
| 系列 4（警） | 橙 | #f39c12 | --accent-yellow |
| 系列 5（危） | 红 | #e74c3c | --accent-red |

## 11.2 图表暗色主题
- 网格线：rgba(42, 58, 80, 0.5)
- 标签：color #94a3b8
- 工具提示：bg #1e293b + border #2a3a50 + color #e2e8f0
- 填充区域透明度：0.1
- 数据点：圆形 5px，白色填充 + 系列色边框

==========================================================
# 12. 性能与可访问性
==========================================================

## 12.1 性能优化
- 动画仅使用 transform 和 opacity（GPU 加速）
- 使用 will-change 提示浏览器（谨慎使用）
- 减少重绘重排
- 图片懒加载

## 12.2 可访问性（WCAG 2.1 AA）
- 暗色背景文字对比度 ≥ 4.5:1
- 支持 prefers-reduced-motion（禁用动画）
- 所有交互元素支持键盘导航
- ARIA 标签完整

==========================================================
# 13. 前端开发交付总结
==========================================================

所有页面必须遵守：
统一颜色令牌 → 统一字体 → 统一间距 → 统一圆角 → 统一按钮 → 统一弹窗
统一表格 → 统一表单 → 统一状态 → 统一空状态 → 统一加载 → 统一反馈

**Sharp Design 关键类**：
- `.sharp-card` — 所有内容卡片
- `.sharp-button` — 所有按钮
- `.sharp-input` — 所有输入框
- `.data-table` — 所有表格
- `.sharp-modal` — 所有弹窗

==========================================================
# 14. Legacy: 玻璃态设计系统（已废弃）
==========================================================

> ⚠️ **以下内容仅供历史参考，不再用于新代码。**

玻璃态（Glassmorphism）在 v2.0.0 中作为 Customer 前台的设计风格引入，特征包括：
- 半透明背景：rgba(255, 255, 255, 0.65–0.85)
- 背景模糊：backdrop-filter: blur(10px–20px)
- 渐变主色：#667eea → #764ba2
- 大圆角：12px–16px
- 弥散阴影：大面积扩散阴影
- 层级系统：Level 1/2/3（基础/中层/顶层玻璃）

**废弃原因**：
1. 性能问题：backdrop-filter 在低端设备和移动端引起明显卡顿
2. 可访问性：半透明背景导致文字对比度不足
3. 设计一致性：双系统（Admin 标准 + Customer 玻璃）增加维护成本
4. 视觉疲劳：浅色玻璃背景不适合长时间数据操作场景

**迁移指南**：
| 旧（玻璃态） | 新（Sharp） |
|-------------|------------|
| `.glass-level-1/2/3` | `.sharp-card` |
| `.glass-card` | `.sharp-card` |
| `.glass-btn-primary` | `.sharp-button`（primary） |
| `.glass-input` | `.sharp-input` |
| `.glass-modal` | `.sharp-modal` |
| `backdrop-filter: blur(...)` | 移除（使用实色背景） |
| `#667eea → #764ba2` | `#00c6ff` (旧) |
| `rgba(255, 255, 255, 0.x)` | `#162032` |

完整玻璃态设计文档参见 `glassmorphism-design-system.md`（已标记 DEPRECATED）。

==========================================================
# 14.2 历史颜色令牌（Historical Color Tokens）
==========================================================

> 以下颜色令牌已从当前设计系统移除，仅供历史参考。

| 令牌 | 色值 | 说明 |
|------|------|------|
| `--accent-blue` | `#00c6ff` | 旧主强调色（v2.0.0），v3.0.0 已替换为 `#2ecc71` |
| `#667eea → #764ba2` | 渐变 | 玻璃态系统主色（v2.0.0 Customer 端），v3.0.0 已废弃 |
| `#1677FF` | 蓝色 | 标准企业系统主色（v2.0.0 Admin 端），v3.0.0 已替换为 `#2ecc71` |

==========================================================
# 附录 A：v2 → v3 对照表
==========================================================

| 规范项 | v2.0.0（双系统） | v3.0.0（暗色单系统） |
|--------|-----------------|---------------------|
| 设计范式 | Admin 标准企业 + Customer 玻璃态 | 统一暗色优先（Dark-First） |
| Admin 主色 | #1677FF | #2ecc71 (当前强调色) |
| Customer 主色 | #667eea → #764ba2 渐变 | #2ecc71 (当前强调色) |
| Admin 背景 | #F2F3F5 / #FFFFFF | #0c1220 / #162032 |
| Customer 背景 | #f5f7fa → #e4e8ec 渐变 | #0c1220 / #162032 |
| 卡片 | 白色 / 玻璃半透明 | sharp-card（#162032 + 1px 边框） |
| 按钮圆角 | 6px / 12px | 6px（统一） |
| 输入框圆角 | 6px / 12px | 6px（统一） |
| 弹窗圆角 | 10px / 20px | 8px（统一） |
| 阴影 | 轻微 / 弥散 | 实色（无弥散） |
| 动画 | 基础 / 丰富（含弹簧） | 基础过渡（无弹簧） |
| backdrop-filter | Customer 全面使用 | 无（已移除） |
| 图表色板 | #1677FF, #00B42A, #FF7D00, #764ba2, #F53F3F | #2ecc71 (当前强调色), #2ecc71, #9b59b6, #f39c12, #e74c3c |
