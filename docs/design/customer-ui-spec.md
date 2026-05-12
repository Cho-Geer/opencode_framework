# Customer 前台 UI 规范
版本：2.0.1
日期：2026-05-06
适用：Customer 角色所有页面
设计风格：暗色 Sharp Design（Dark-First）

> **v2.0.0 重大变更**：设计风格从「玻璃态（Glassmorphism）」切换为「暗色 Sharp Design」。
> 移除所有 glass-level 类、backdrop-filter、渐变色彩 (#667eea/#764ba2)，统一使用 dark-first 设计令牌。
> 关键色值：#0c1220 (bg), #162032 (card), #2ecc71 (accent)。
> 完整对照见附录 C。

==========================================================
# 0. 版本变更日志
==========================================================

## v2.0.1 — 2026-05-06
- §1.1 页面清单：新增「Forgot Password」页面（Planned），注明 API 端点已在 contract.yaml v1.6.5 定义（RESET-PW-001/RESET-PW-002），UI 待实现
- §3.1 Login页：补充Forgot Password链接说明，端点已就绪可进入 UI 开发

## v2.0.0 — 2026-05-04
- **设计范式切换**：玻璃态 → 暗色 Sharp Design
- **色彩更新**：#667eea / #764ba2 渐变 → 旧强调色 #00c6ff → 当前强调色 #2ecc71
- **组件重命名**：glass-* → sharp-*（见附录 C 迁移表）
- **移除**：backdrop-filter、glass-level-1/2/3、gradient-orb、弥散阴影
- **新增**：Sharp 组件 CSS（§10），暗色 5 色系统

==========================================================
# 1. 页面总览
==========================================================

## 1.1 页面清单
| 页面 | 路由 | 优先级 | 类型 |
|------|------|--------|------|
| Service Selection | /booking/services | P0 | 列表页 |
| Time Slot Selection | /booking/time-slots | P0 | 选择页 |
| Booking Confirmation（弹窗） | modal | P0 | 弹窗 |
| Booking Success | /booking/success | P0 | 结果页 |
| My Bookings | /my-bookings | P0 | 列表页 |
| Profile | /profile | P0 | 表单页 |
| Login | /auth/login | P0 | 表单页 |
| Register | /auth/register | P0 | 表单页 |
| Forgot Password | /auth/forgot-password | P1 | 表单页（API 已就绪，contract.yaml v1.6.5） |

## 1.2 页面流程
```
Login/Register → Service Selection → Time Slot Selection → [Booking Confirmation弹窗] → Booking Success
                                    ↓
                              My Bookings ← 取消/查看
                                    ↓
                              Profile
```

==========================================================
# 2. 全局布局
==========================================================

## 2.1 页面结构
```
┌─────────────────────────────────────────┐
│  Sharp Header (Fixed, 64px, bg-card-bg)  │
├──────────┬──────────────────────────────┤
│          │                              │
│  Sidebar │      Main Content Area       │
│ (240px)  │      (max-width: 1200px)     │
│  Fixed   │      Centered                │
│          │                              │
├──────────┴──────────────────────────────┤
│  Footer (Optional)                      │
└─────────────────────────────────────────┘
```

## 2.2 导航栏（Sharp Header）
**样式**：
- 背景：#162032（bg-card-bg，实色）
- 底部边框：1px solid #2a3a50
- 阴影：0 2px 8px rgba(0,0,0,0.3)
- position: sticky; top: 0; z-index: 40

**内容**：
- 左侧：Logo（accent-green 文字）
- 中间：预约服务 / My Bookings / Profile
- 右侧：用户菜单（头像 + 下拉）

## 2.3 侧边栏（Sharp Sidebar）
**桌面端**（240px）：
- 背景：#162032 + 右边框 1px solid #2a3a50
- 激活状态：border-left 3px solid #2ecc71 + bg rgba(46,204,113,0.1)
- 悬停：bg #1e293b

**移动端**：抽屉式（280px），遮罩 rgba(0,0,0,0.6)

## 2.4 背景
- 页面背景：#0c1220（dark-bg）
- 可选网格背景：rgba(42, 58, 80, 0.1) 细微网格

==========================================================
# 3. Login/Register页面
==========================================================

## 3.1 Login页
**布局**：分屏（左侧品牌展示 + 右侧表单）

**表单卡片（Sharp Card）**：
- bg #162032，border 1px solid #2a3a50，border-radius 8px
- padding: 48px，max-width: 440px

**表单字段**：
- Login方式切换：Sharp 标签（Phone Number / Email）
- 账号：Sharp Input
- 密码：Sharp Input + 显示/隐藏
- 验证码Login：文字按钮
- Remember Me：Sharp Toggle
- Login按钮：Sharp 主按钮（bg #2ecc71，全宽）

**密码Login流程**（POST /v1/auth/login/password）：
```
用户输入 contact + contactType + password → 前端校验 → POST → 成功存储 token → 跳转
```

**Forgot Password链接**：
- Login表单底部放置「Forgot Password？」文字按钮（.sharp-btn-text）
- 点击跳转 `/auth/forgot-password` 页面（2 步流程：输入 contact → Send Code → 验证码 + 新密码 → 重置成功）
- **API 状态**：后端端点（RESET-PW-001/RESET-PW-002）已在 contract.yaml v1.6.5 定义完毕，前端可基于契约对接开发

## 3.2 Register页
**分步Register**（Step 1: Send Code / Step 2: 完成Register）
- 进度指示：Sharp 步骤条，当前步骤高亮
- Step 1：Sharp Input（contact）+ 主按钮（Send Code，60s 倒计时）
- Step 2：Sharp Input（code/name/password/confirmPassword）+ 强度指示器 + 主按钮

==========================================================
# 4. Service Selection页面
==========================================================

## 4.1 布局
标题 + 搜索框 + 筛选标签 + 服务卡片网格（3 列桌面 / 1 列移动）

## 4.2 搜索栏
Sharp Input：左侧搜索图标 + placeholder + 聚焦 border-color #2ecc71 + glow

## 4.3 筛选标签
Sharp 标签组：
- 默认：bg transparent + border #2a3a50 + color #94a3b8
- Selected：bg rgba(46,204,113,0.15) + border #2ecc71 + color #2ecc71

## 4.4 服务卡片（Sharp Card）
```
┌────────────────────────────┐
│  ┌──────────┐              │
│  │  服务图片  │  服务名称     │
│  │  (8px圆角)│  ★★★★☆      │
│  └──────────┘  价格：¥128   │
│               时长：60分钟   │
│  [描述文字...]              │
│  [Book Now] sharp-button    │
└────────────────────────────┘
```

**样式**：
- bg #162032，border 1px solid #2a3a50，border-radius 8px
- padding: 24px
- 图片：8px 圆角，aspect-ratio 16/9
- 名称：18px bold，#e2e8f0
- 价格：20px bold，#2ecc71
- 描述：14px，#94a3b8，2 行截断
- hover：translateY(-3px) + border-color #2ecc71 + 阴影增强
- active：scale(0.98)

## 4.5 空状态 / 加载
- 空：图标 + "No services found" + "Clear Filters"按钮
- 加载：3-6 个 Sharp Card 骨架屏（bg #1e293b + shimmer 动画）

==========================================================
# 5. Time Slot Selection页面
==========================================================

## 5.2 日历组件（PrimeNG 暗色增强）
**日历面板（Sharp Card）**：
- bg #162032，border 1px solid #2a3a50，border-radius 8px
- padding: 24px
- 月份导航：左右箭头 Sharp 按钮（32px）

**日期格子**（40px x 40px，8px 圆角）：
- 默认：transparent，color #94a3b8
- 今天：border 1px solid #2ecc71，color #2ecc71
- Selected：bg #2ecc71，color white
- 禁用（过去）：opacity 0.3，cursor not-allowed
- 有可用时段：底部圆点 4px，#2ecc71
- 悬停：bg rgba(46,204,113,0.1)

## 5.3 时间段网格
**时间按钮（Sharp Button 变体）**：
```
可用：bg #0c1220 + border #2a3a50 + color #e2e8f0
Full：bg rgba(148,163,184,0.1) + color #94a3b8 + cursor not-allowed
Processing：bg rgba(46,204,113,0.1) + color #2ecc71 + border dashed #2ecc71
Selected：bg #2ecc71 + color white + box-shadow glow
```

- 布局：5-6 列桌面 / 2-3 列移动，间距 12px
- 容量显示（多容量时段）：小字 "剩 2 个"，12px，#2ecc71

## 5.4 高并发预约（Optimistic UI）
```
单时段：点击时间槽 → 立即显示"Processing" → 生成 random preferredSequence (0-99)
→ POST /v1/appointments → 201 成功→跳转 / 409 冲突→刷新+提示相邻时段
单时段：点击时间槽 → 立即显示"Processing" → 生成 random preferredSequence (0-99)
→ POST /v1/appointments → 201 成功→跳转 / 409 冲突→刷新+提示相邻时段
```

## 5.5 Selected摘要栏
Sharp Card，sticky bottom，显示已选槽位数/总时长/总价 + "Confirm Booking" 主按钮。
- 单时段：显示日期/时间 + 价格

==========================================================
# 6. Booking Confirmation弹窗
==========================================================

**Sharp Modal（520px）**：
- 遮罩：rgba(0,0,0,0.6)
- 弹窗：bg #162032 + border 1px solid #2a3a50 + border-radius 8px
- 内容：服务详情 Sharp Card + 备注 Sharp Input（textarea）+ 取消/确认按钮

==========================================================
# 7. Booking Success页面
==========================================================

- 居中布局
- 成功图标：圆形 bg #2ecc71，白色对勾，scale 动画 600ms
- 详情：Sharp Card
- 按钮：查看My Bookings（主）+ Book Again（次）

==========================================================
# 8. My Bookings页面
==========================================================

## 8.1 筛选标签
Sharp 标签组（全部/待确认/已确认/已完成/已过期/已取消）
- Selected：bg rgba(46,204,113,0.15) + border #2ecc71

## 8.2 预约卡片（Sharp Card）
```
┌────────────────────────────────────────┐
│ ┌──────────┐                            │
│ │ 服务图片  │  高级理发                   │
│ │ (8px圆角)│  [已确认] badge              │
│ └──────────┘                            │
│  📅 5月15日 周四  🕐 10:00  💰 ¥128    │
│  [View Details]              [Cancel Booking]       │
└────────────────────────────────────────┘
```
- hover：translateY(-2px) + 阴影增强

## 8.3 状态标签色
| 状态 | 文字色 | 背景 |
|------|--------|------|
| PENDING | #94a3b8 | rgba(148,163,184,0.1) |
| CONFIRMED | #2ecc71 | rgba(46,204,113,0.1) |
| COMPLETED | #2ecc71 | rgba(46,204,113,0.1) |
| EXPIRED | #f39c12 | rgba(243,156,18,0.1) |
| CANCELLED | #e74c3c | rgba(231,76,60,0.1) |

## 8.4 空状态
图标 + "No bookings yet" + "Book Now" 主按钮

==========================================================
# 9. Profile页面
==========================================================

**头像区域（Sharp Card）**：
- 居中布局，padding 32px
- 头像：100px 圆形，首字母缩写 + #162032 背景
- 可选 border 4px solid #2ecc71

**信息卡片（Sharp Card）**：
- 标签：14px，#94a3b8
- 值：16px，#e2e8f0
- 只读字段：bg #0c1220 + border #2a3a50
- 可编辑字段：Sharp Input

**PII 数据**：前端仅显示脱敏字段（us***@example.com），Hash/Encrypted 禁止暴露。
修改联系方式需要完整验证流程。

**修改密码**：Sharp Modal（520px），当前密码 + 新密码 + 强度指示器

==========================================================
# 10. 公共组件 CSS 规范（Sharp Design）
==========================================================

## 10.1 Sharp Button（锐利按钮）
```css
.sharp-btn-primary {
  background: #2ecc71;
  color: #0c1220;
  padding: 12px 24px;
  border-radius: 6px;
  border: 1px solid rgba(46,204,113, 0.3);
  font-weight: 600;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  transition: all 200ms ease;
}
.sharp-btn-primary:hover {
  background: #27ae60;
  box-shadow: 0 8px 15px -3px rgba(0, 0, 0, 0.4), 0 0 10px rgba(46,204,113, 0.4);
  transform: translateY(-2px);
}
.sharp-btn-primary:active { transform: translateY(0); }
.sharp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.sharp-btn-secondary {
  background: transparent;
  color: #94a3b8;
  padding: 12px 24px;
  border-radius: 6px;
  border: 1px solid #2a3a50;
  transition: all 200ms ease;
}
.sharp-btn-secondary:hover { border-color: #2ecc71; color: #2ecc71; }

.sharp-btn-text {
  background: transparent;
  color: #2ecc71;
  padding: 8px 12px;
  border: none;
  transition: all 150ms ease;
}
.sharp-btn-text:hover { text-decoration: underline; opacity: 0.8; }
```

## 10.2 Sharp Input（锐利输入框）
```css
.sharp-input {
  background: #0c1220;
  border: 1px solid #2a3a50;
  border-radius: 6px;
  padding: 12px 16px;
  color: #e2e8f0;
  font-size: 14px;
  transition: all 200ms ease;
  width: 100%;
}
.sharp-input::placeholder { color: #64748b; }
.sharp-input:focus {
  outline: none;
  border-color: #2ecc71;
  box-shadow: 0 0 0 3px rgba(46,204,113, 0.15);
}
.sharp-input.error {
  border-color: #e74c3c;
  box-shadow: 0 0 0 3px rgba(231, 76, 60, 0.15);
}
.sharp-input:disabled {
  background: rgba(12, 18, 32, 0.5);
  cursor: not-allowed;
}
```

## 10.3 Sharp Card（锐利卡片）
```css
.sharp-card {
  background: #162032;
  border: 1px solid rgba(42, 58, 80, 0.5);
  border-radius: 8px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
  padding: 24px;
  transition: all 300ms ease;
}
.sharp-card:hover {
  border-color: rgba(46,204,113, 0.5);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.25), 0 0 15px rgba(46,204,113, 0.2);
  transform: translateY(-3px);
}
.sharp-card.selected {
  border: 2px solid #2ecc71;
}
```

## 10.4 Sharp Modal（锐利弹窗）
```css
.sharp-modal-overlay {
  background: rgba(0, 0, 0, 0.6);
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sharp-modal {
  background: #162032;
  border: 1px solid #2a3a50;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  max-width: 520px;
  width: 100%;
  margin: 16px;
  padding: 32px;
  animation: sharp-modal-in 300ms ease;
}

@keyframes sharp-modal-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
```

## 10.5 Sharp Badge（锐利标签）
```css
.sharp-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid;
}

.sharp-badge-pending { color: #94a3b8; background: rgba(148,163,184,0.1); border-color: rgba(148,163,184,0.3); }
.sharp-badge-confirmed { color: #2ecc71; background: rgba(46,204,113,0.1); border-color: rgba(46,204,113,0.3); }
.sharp-badge-completed { color: #2ecc71; background: rgba(46,204,113,0.1); border-color: rgba(46,204,113,0.3); }
.sharp-badge-cancelled { color: #e74c3c; background: rgba(231,76,60,0.1); border-color: rgba(231,76,60,0.3); }
```

## 10.6 Sharp Toast（锐利提示）
```css
.sharp-toast {
  background: #162032;
  border: 1px solid #2a3a50;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: sharp-toast-in 300ms ease;
}

@keyframes sharp-toast-in {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}
```

==========================================================
# 11. 移动端适配
==========================================================

## 11.1 布局调整
- 导航栏：汉堡菜单 + 简化
- 侧边栏：抽屉式（全屏覆盖）
- 卡片：单列，全宽
- 按钮：全宽
- 弹窗：全屏（底部滑入）

## 11.2 暗色调整
- 阴影减弱（移动端性能）
- 全宽布局（取消 max-width 限制）
- 时间槽：2-3 列网格

## 11.3 触控优化
- 点击区域 ≥ 44x44px
- 底部固定操作栏
- 底部安全区适配

==========================================================
# 12. 动画规范
==========================================================

## 12.1 标准动画
- 页面入场：fadeIn + translateY(10px→0)，300ms ease
- 列表项：staggered fadeIn + translateY(16px→0)，300ms
- 卡片 hover：translateY(-3px) + 阴影增强，300ms
- 按钮 active：translateY(0)，100ms
- 弹窗：fadeIn + scale(0.95→1)，300ms

## 12.2 骨架屏
```css
.skeleton {
  background: linear-gradient(90deg, #1e293b 25%, #2a3a50 50%, #1e293b 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

==========================================================
# 13. 状态与反馈
==========================================================

- 加载：骨架屏（Sharp Card 骨架 + shimmer）/ 按钮 spinner（border #2a3a50 + border-top #2ecc71）
- 空状态：居中图标（64px）+ 标题 + 操作按钮
- 错误：红色 Toast（border-left #e74c3c）+ 重试按钮
- 成功：绿色 Toast（border-left #2ecc71），自动消失 3s

==========================================================
# 14. 实现检查清单
==========================================================

## 14.1 基础
- [ ] Tailwind 配置扩展（暗色令牌）
- [ ] Sharp Design CSS 工具类（.sharp-card / .sharp-button / .sharp-input / .data-table）
- [ ] 全局暗色样式

## 14.2 布局
- [ ] Sharp Header + Sidebar
- [ ] Sharp Layout Shell

## 14.3 原子组件
- [ ] Sharp Button（主/次/文字）
- [ ] Sharp Input
- [ ] Sharp Card
- [ ] Sharp Modal
- [ ] Sharp Badge
- [ ] Sharp Toast
- [ ] Sharp Calendar
- [ ] Sharp Time Slot

## 14.4 页面
- [ ] Login/Register
- [ ] Service Selection
- [ ] Time Slot Selection + Booking Confirmation弹窗
- [ ] Booking Success
- [ ] My Bookings
- [ ] Profile

## 14.5 移动端 + 性能
- [ ] 响应式布局
- [ ] 触控优化
- [ ] 动画 GPU 加速
- [ ] 图片懒加载

==========================================================
# 附录 A：设计令牌速查
==========================================================

| 令牌 | 色值 | 用途 |
|------|------|------|
| dark-bg | #0c1220 | 页面背景 |
| card-bg | #162032 | 卡片/导航/侧边栏 |
| card-bg-light | #1e293b | 悬停/次要背景 |
| border-color | #2a3a50 | 边框/分割线 |
| text-primary | #e2e8f0 | 主文字 |
| text-secondary | #94a3b8 | 次要文字 |
| accent-green | #2ecc71 | 强调色 |
| accent-green-dark | #27ae60 | 深强调色 |
| accent-green | #2ecc71 | 成功/正向 |
| accent-red | #e74c3c | 危险/负向 |
| accent-yellow | #f39c12 | 警告 |
| accent-purple | #9b59b6 | 辅助色 |

==========================================================
# 附录 B：API 对接说明
==========================================================

- 数据流：页面加载 → Store → Loading → 成功/失败 → UI 更新
- 错误处理：网络错误 Toast + 重试；401→跳转Login；500→错误页
- 缓存：服务列表 5min / 用户信息 15min / 时间槽实时

==========================================================
# 附录 C：v1.0 → v2.0 迁移对照表
==========================================================

| 旧（v1.0 玻璃态） | 新（v2.0 Sharp） |
|-------------------|-----------------|
| `.glass-level-1/2/3` | `.sharp-card` |
| `.glass-card` | `.sharp-card` |
| `.glass-btn-primary` | `.sharp-btn-primary` |
| `.glass-input` | `.sharp-input` |
| `.glass-modal` | `.sharp-modal` |
| `.glass-badge` | `.sharp-badge` |
| `.glass-toast` | `.sharp-toast` |
| `#667eea / #764ba2` | `#00c6ff`（旧强调色）→ `#2ecc71`（当前强调色） |
| `backdrop-filter: blur(...)` | 移除（使用实色 #162032） |
| `rgba(255,255,255,0.7)` | `#162032` |
| `linear-gradient(135deg, #667eea, #764ba2)` | `#00c6ff`（旧强调色）→ `#2ecc71`（当前强调色）|
| `gradient-text` | `color: #00c6ff`（旧强调色）→ `#2ecc71`（当前强调色） |
| `shadow-glass` | `box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3)` |
| `radius: 12px/16px/20px` | `border-radius: 6px/8px` |

