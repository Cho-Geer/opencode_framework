# 交互模式规范（Interaction Patterns）
版本：2.0.0（Sharp Design 术语体系，已从玻璃态迁移）
日期：2026-05-05（更新日期）
原版：1.0.0（2026-04-30，玻璃态设计）
适用：Customer 前台 + Admin 后台

> 📋 **历史说明（Migration History）**
> 
> 本文档 v1.0.0 编写时采用玻璃态（Glassmorphism）设计范式。自 global-ui-spec.md v3.0.0（2026-05-04）起，项目已统一迁移至**暗色优先 Sharp Design（Dark-First）**系统。本文档 v2.0.0 为当前权威 Sharp Design 交互规范，已完全替代旧玻璃态内容。
> 
> **v2.0.0 更新**：本文档已将所有玻璃态术语替换为 Sharp Design 等价术语：
> - `Glass Modal` → `Sharp Modal`（.sharp-card 容器 + 实色边框）
> - `Glass Drawer` → `Sharp Drawer`（.sharp-card 抽屉）
> - `Glass Tooltip` → `Sharp Tooltip`（暗色实色背景）
> - `glass-overlay` → `sharp-overlay`（半透明遮罩）
> - `.glass-level-1/2/3` → `.sharp-card`（统一 8px 圆角 + 实色边框）
> - 旧色 `#667eea` / `#764ba2` / `#1677FF` → 新色 `#00c6ff` / `#0072ff`
> 
> **迁移指南**：所有 CSS 类名、颜色色值、组件名称已在本文件中更新。若代码中存在旧的 `.glass-*` 类名，请全局搜索替换。
> 
> **权威文档**：以 `docs/design/global-ui-spec.md` v3.0.0 和 `booking-frontend/src/styles.scss` 中的设计令牌为准。

==========================================================
# 1. 模态流（Modal Flow）
==========================================================

## 1.1 设计原则
Customer 前台采用**模态优先**设计，Admin 后台采用**页面+模态混合**设计。所有模态统一使用 `.sharp-card` 样式（8px 圆角 + 实色边框）。

## 1.2 模态类型

### 确认模态（Confirmation Modal）
**用途**：二次确认重要操作
**触发**：删除、取消、禁用等
**流程**：
```
用户点击删除
    ↓
显示确认模态（Sharp Modal）
    ↓
用户点击确认
    ↓
显示 Loading
    ↓
关闭模态 + 显示成功提示
    ↓
刷新父页面数据
```

**样式**：
- 图标：红色或黄色警告图标（渐变背景）
- 标题：操作名称（"确认删除？"）
- 描述：影响说明（"此操作不可撤销"）
- 操作：取消（左）+ 确认（右，危险按钮）

### 表单模态（Form Modal）
**用途**：创建/编辑数据
**触发**：新增、编辑按钮
**流程**：
```
用户点击新增
    ↓
显示表单模态（Sharp Modal 640px）
    ↓
用户填写表单
    ↓
实时验证反馈
    ↓
用户点击保存
    ↓
验证通过 → 提交 API
    ↓
显示 Loading
    ↓
关闭模态 + 成功提示 + 刷新列表
```

**样式**：
- 标题："新增用户" / "编辑用户"
- 内容：表单字段
- 底部：取消 + 保存

### 详情模态（Detail Modal）
**用途**：查看详细信息
**触发**：表格/列表中的查看按钮
**流程**：
```
用户点击查看
    ↓
显示详情模态（Sharp Modal 640-800px）
    ↓
用户查看信息
    ↓
可执行操作（编辑、删除等）
    ↓
关闭模态
```

**样式**：
- 只读信息展示
- 分段显示（基本信息、扩展信息）
- 操作按钮区

### 抽屉模态（Drawer Modal）
**用途**：侧边详情/筛选
**触发**：筛选按钮、详情按钮
**流程**：
```
用户点击筛选
    ↓
从右侧滑出抽屉（Sharp Drawer）
    ↓
用户设置筛选条件
    ↓
点击应用
    ↓
关闭抽屉 + 刷新数据
```

**样式**：
- 宽度：400px（桌面）/ 100%（移动）
- 从右侧滑入
- 遮罩：sharp-overlay（半透明暗色遮罩）

## 1.3 模态动画

### 入场动画
```css
@keyframes modal-enter {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
/* duration: 300ms, easing: cubic-bezier(0.4, 0, 0.2, 1) */
```

### 退场动画
```css
@keyframes modal-exit {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}
/* duration: 200ms, easing: cubic-bezier(0.4, 0, 1, 1) */
```

### 移动端入场
```css
@keyframes modal-enter-mobile {
  from {
    opacity: 0;
    transform: translateY(100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/* 从底部滑入 */
```

## 1.4 模态堆叠
- 最多堆叠 2 层模态
- 第 2 层模态背景加深
- 关闭上层自动恢复下层

## 1.5 模态关闭方式
1. 点击遮罩层
2. 点击关闭按钮（X）
3. 按 ESC 键
4. 操作完成后自动关闭
5. （可选）表单有更改时确认关闭

==========================================================
# 2. 微交互（Micro-interactions）
==========================================================

## 2.1 悬停效果（Hover）

### 卡片悬停
**Customer**：
```css
.card-hover {
  transition: transform 200ms ease, box-shadow 200ms ease;
}
.card-hover:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 60px rgba(0, 198, 255, 0.15);
}
```

**Admin**：
```css
.card-hover-admin {
  transition: box-shadow 200ms ease;
}
.card-hover-admin:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
```

### 按钮悬停
**主按钮**：
```css
.btn-hover {
  transition: all 150ms ease;
}
.btn-hover:hover {
  transform: scale(1.02);
  filter: brightness(1.1);
}
```

**次按钮**：
```css
.btn-secondary-hover:hover {
  border-color: #00c6ff;
  color: #00c6ff;
}
```

### 表格行悬停
```css
.row-hover {
  transition: background-color 150ms ease;
}
.row-hover:hover {
  background-color: rgba(42, 58, 80, 0.2);
}
```

## 2.2 点击反馈（Click Feedback）

### 按钮点击
```css
.btn-active:active {
  transform: scale(0.98);
  transition: transform 100ms ease;
}
```

### 卡片点击
```css
.card-active:active {
  transform: scale(0.98);
  transition: transform 100ms ease;
}
```

### 时间槽点击
```css
.time-slot-active:active {
  transform: scale(0.95);
}
.time-slot-selected {
  transform: scale(1.05);
  transition: all 200ms ease;
}
```

## 2.3 焦点状态（Focus）

### 输入框聚焦
```css
.input-focus:focus {
  outline: none;
  border-color: #00c6ff;
  box-shadow: 0 0 0 3px rgba(0, 198, 255, 0.15);
}
```

### 按钮聚焦
```css
.btn-focus:focus-visible {
  outline: 2px solid #00c6ff;
  outline-offset: 2px;
}
```

## 2.4 加载状态（Loading）

### 按钮加载
```css
.btn-loading {
  position: relative;
  color: transparent;
}
.btn-loading::after {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
```

### 骨架屏加载
```css
.skeleton {
  background: linear-gradient(
    90deg,
    rgba(30, 41, 59, 0.5) 0%,
    rgba(42, 58, 80, 0.7) 50%,
    rgba(30, 41, 59, 0.5) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

### 页面加载进度
- 顶部进度条（NProgress 风格）
- 颜色：纯色（#00c6ff）
- 高度：3px

## 2.5 成功反馈（Success Feedback）

### Toast 提示
```css
.toast-success {
  animation: toast-in 300ms ease;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 成功图标动画
```css
.success-icon {
  animation: success-pop 600ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes success-pop {
  0% {
    transform: scale(0);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}
```

## 2.6 错误反馈（Error Feedback）

### 输入框错误
```css
.input-error {
  animation: shake 300ms ease;
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}
```

### 错误提示
- 红色边框
- 错误图标 + 文字
- 可选：抖动动画

==========================================================
# 3. 状态转换（State Transitions）
==========================================================

## 3.1 预约状态转换
```
待确认 → 已确认 → 已完成
   ↓        ↓
已取消   已取消
```

**状态转换动画**：
- 标签颜色渐变过渡：300ms
- 背景色渐变过渡：300ms

## 3.2 开关状态（Toggle）
```css
.toggle-switch {
  transition: background-color 200ms ease;
}
.toggle-switch.checked {
  background: linear-gradient(135deg, #00c6ff, #0072ff);
}
.toggle-switch .knob {
  transition: transform 200ms ease;
}
.toggle-switch.checked .knob {
  transform: translateX(100%);
}
```

## 3.3 标签切换（Tab Switch）
```css
.tab-item {
  position: relative;
  transition: color 200ms ease;
}
.tab-item.active::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #00c6ff, #0072ff);
  animation: tab-slide 200ms ease;
}
```

## 3.4 页面切换（Page Transition）
**Customer**：
```css
.page-enter {
  animation: page-fade-in 400ms ease;
}
@keyframes page-fade-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Admin**：
```css
.page-enter-admin {
  animation: fade-in 300ms ease;
}
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

==========================================================
# 4. 表单交互（Form Interactions）
==========================================================

## 4.1 实时验证
**触发**：输入框失去焦点（blur）或防抖输入（300ms）
**反馈**：
- 验证中：输入框右侧显示 spinner
- 成功：绿色对勾图标
- 错误：红色边框 + 错误文字

## 4.2 密码强度
**指示器**：
- 弱：红色（1-2 格）
- 中：黄色（3 格）
- 强：绿色（4-5 格）

**样式**：
```css
.password-strength {
  height: 4px;
  border-radius: 2px;
  background: rgba(42, 58, 80, 0.5);
  overflow: hidden;
}
.password-strength-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 300ms ease, background-color 300ms ease;
}
```

## 4.3 表单提交
**流程**：
```
用户点击提交
    ↓
验证所有字段
    ↓
有错误 → 显示错误提示 + 滚动到第一个错误
    ↓
无错误 → 按钮变为 Loading 状态
    ↓
调用 API
    ↓
成功 → 成功提示 + 跳转/关闭
    ↓
失败 → 显示错误 + 按钮恢复
```

## 4.4 自动保存
**触发**：输入停止 2 秒后
**反馈**：
- 保存中："保存中..." 文字
- 已保存："已保存" + 对勾图标（2 秒后消失）

==========================================================
# 5. 列表交互（List Interactions）
==========================================================

## 5.1 下拉刷新（Pull to Refresh）
**触发**：移动端列表顶部下拉
**动画**：
```css
.pull-refresh {
  transition: transform 200ms ease;
}
.pull-refresh.pulling {
  transform: translateY(60px);
}
.pull-refresh .spinner {
  animation: spin 0.8s linear infinite;
}
```

## 5.2 无限滚动（Infinite Scroll）
**触发**：滚动到底部
**反馈**：
- 加载中：底部 spinner
- 无更多："没有更多数据" 文字
- 错误："加载失败，点击重试"

## 5.3 列表项滑动（Swipe）
**移动端**：
- 左滑：显示操作按钮（编辑、删除）
- 右滑：标记为已读/完成
- 最大滑动距离：100px

## 5.4 列表项拖拽（Drag & Drop）
**Admin 表格**：
- 拖拽手柄：左侧图标
- 拖拽中：半透明 + 阴影
- 放置位置：指示线

==========================================================
# 6. 搜索与筛选交互
==========================================================

## 6.1 实时搜索
**触发**：输入后 300ms 防抖
**反馈**：
- 搜索中：输入框右侧 spinner
- 结果：下拉列表（Sharp Card 面板）
- 无结果："未找到相关结果"

## 6.2 筛选标签
**交互**：
- 点击切换选中状态
- 动画：背景色渐变 200ms
- 徽标：数字变化动画（计数器）

## 6.3 高级筛选抽屉
**流程**：
```
用户点击筛选按钮
    ↓
从右侧滑出筛选抽屉（Sharp Drawer）
    ↓
用户设置筛选条件
    ↓
实时预览筛选结果数量
    ↓
点击应用
    ↓
关闭抽屉 + 刷新数据 + 显示筛选标签
    ↓
点击重置 → 清除所有条件
```

==========================================================
# 7. 图表交互（Chart Interactions）
==========================================================

## 7.1 悬停提示
**触发**：鼠标悬停在数据点上
**样式**：
- Sharp Tooltip（暗色实色背景，#1e293b）
- 显示：数值、标签、时间
- 跟随鼠标或固定在数据点上方

## 7.2 点击选中
**触发**：点击数据点/图例
**反馈**：
- 高亮选中项
- 淡化其他项
- 显示详细数据面板

## 7.3 缩放与平移
**触发**：
- 鼠标滚轮：缩放
- 拖拽：平移
- 双指：缩放（移动端）

## 7.4 数据刷新
**触发**：
- 自动刷新（定时）
- 手动刷新按钮
- 数据更新动画（数值递增）

==========================================================
# 8. 通知交互（Notification Interactions）
==========================================================

## 8.1 Toast 通知
**位置**：
- Customer：顶部居中
- Admin：顶部右侧

**动画**：
```css
.toast-enter {
  animation: toast-slide-in 300ms ease;
}
@keyframes toast-slide-in {
  from {
    opacity: 0;
    transform: translateY(-100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.toast-exit {
  animation: toast-slide-out 200ms ease;
}
@keyframes toast-slide-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-100%);
  }
}
```

**行为**：
- 自动消失：3-5 秒
- 悬停暂停计时
- 点击关闭
- 最多显示 3 个，超出时堆叠

## 8.2 通知中心
**触发**：点击铃铛图标
**样式**：
- 下拉面板（Sharp Card 暗色实色）
- 未读标记：红色圆点
- 通知列表：时间倒序
- 操作：标记已读、查看详情、删除

## 8.3 系统公告
**样式**：
- 顶部横幅（Sharp Card 样式，重要性颜色区分）
- 重要级别：颜色区分
- 可关闭

==========================================================
# 8.5 JWT Token 安全交互
==========================================================

## 8.5.1 Token 存储策略
- **Access Token**：内存存储（Signal），禁止 localStorage
- **Refresh Token**：Service 层管理，随请求体发送
- **Token 刷新**：拦截器自动处理 401 响应

## 8.5.2 Token 刷新流程
```
API 请求返回 401（Token 过期）
    ↓
拦截器捕获 401
    ↓
调用 POST /v1/auth/refresh（携带 refreshToken）
    ↓
成功 → 获取新 accessToken + refreshToken
    ↓
重试原请求
    ↓
失败（401）→ 跳转登录页
```

## 8.5.3 登出流程
```
用户点击 "退出登录"
    ↓
调用 POST /v1/auth/logout
    ↓
后端将 Token 加入黑名单（Redis）
    ↓
前端清除内存 Token
    ↓
跳转登录页
```

## 8.5.4 多设备登录限制
- 最大 5 个并发会话
- 超出限制时：显示 "已在其他设备登录，是否踢出？"
- 选项：查看设备列表 / 全部踢出 / 取消

==========================================================
# 8.6 WebSocket 实时通信
==========================================================

## 8.6.1 连接管理
**连接端点**：`wss://api.example.com/v1/ws`（强制 WSS，不支持 WS）
**连接时机**：
- 登录成功后自动连接
- 断网后自动重连（指数退避：1s, 2s, 4s, 8s, max 30s）

## 8.6.2 消息类型
| 消息类型 | 方向 | 场景 |
|---------|------|------|
| `slot.booked` | Server → Client | 时间槽被预约（实时更新可用性） |
| `slot.released` | Server → Client | 时间槽释放（取消预约） |
| `appointment.status_changed` | Server → Client | 预约状态变更 |
| `notification` | Server → Client | 系统通知 |
| `heartbeat` | 双向 | 保活心跳（30s 间隔） |

## 8.6.3 时间槽实时更新 UX
```
用户正在浏览时间槽页面
    ↓
WebSocket 收到 slot.booked 消息
    ↓
前端更新对应时间槽状态：
  - 可用 → 已满
  - 显示 Toast："该时段刚刚被预约"
    ↓
如果用户已选中该时段：
  - 弹出确认弹窗："该时段已被占用，是否查看其他时段？"
```

## 8.6.4 Admin 仪表盘实时更新
```
WebSocket 收到 appointment.status_changed
    ↓
自动刷新统计卡片数据
    ↓
更新预约列表（如果当前页是预约管理）
    ↓
播放提示音（可选）
```

==========================================================
# 8.7 速率限制（429 Too Many Requests）
==========================================================

## 8.7.1 限流维度
| 维度 | 限制 | 触发场景 |
|------|------|---------|
| 用户+时段 | 1次/秒 | 对同一时间槽重复点击 |
| IP全局 | 10次/分钟 | IP 级别攻击 |
| 时段容量 | 实时剩余 | 防止超卖 |
| 全局用户 | 100次/分钟 | 基础防护 |

## 8.7.2 429 响应处理
**响应头**：
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1672502400
Retry-After: 60
```

**UX 处理**：
```
收到 429 响应
    ↓
读取 Retry-After 头
    ↓
显示 Toast：
  - 标题："操作过于频繁"
  - 内容："请等待 X 秒后重试"
  - 倒计时进度条
    ↓
禁用相关按钮（倒计时期间）
    ↓
倒计时结束后自动启用按钮
```

## 8.7.3 前端限流预防
- 时间槽选择按钮：点击后 1 秒内禁用
- 提交按钮：Loading 状态期间禁用
- 搜索输入：防抖 300ms

==========================================================
# 9. 手势交互（Gesture Interactions）
==========================================================

## 9.1 滑动手势
| 手势 | 场景 | 动作 |
|------|------|------|
| 左滑 | 列表项 | 显示操作菜单 |
| 右滑 | 列表项 | 标记完成/已读 |
| 下滑 | 页面顶部 | 下拉刷新 |
| 上滑 | 页面底部 | 加载更多 |
| 双指捏合 | 图片 | 缩放 |

## 9.2 长按手势
**触发**：长按 500ms
**场景**：
- 列表项：显示上下文菜单
- 卡片：显示预览

## 9.3 双击手势
**触发**：双击 300ms 内
**场景**：
- 图片：放大查看
- 表格单元格：进入编辑

==========================================================
# 10. 键盘交互（Keyboard Interactions）
==========================================================

## 10.1 快捷键
| 快捷键 | 功能 |
|--------|------|
| ESC | 关闭模态框/抽屉 |
| Enter | 提交表单/确认操作 |
| Ctrl + F | 聚焦搜索框 |
| Ctrl + S | 保存（表单） |
| Tab | 切换焦点 |
| Shift + Tab | 反向切换焦点 |

## 10.2 焦点管理
**模态框**：
- 打开时：聚焦第一个输入框
- 关闭时：返回触发按钮
- Tab 循环：在模态框内循环

**表格**：
- 方向键：切换单元格
- Enter：进入编辑
- Escape：取消编辑

## 10.3 无障碍
- 所有交互元素支持键盘操作
- 焦点可见（outline）
- ARIA 标签完整
- 屏幕阅读器友好

==========================================================
# 11. 动画性能规范
==========================================================

## 11.1 性能优化原则
1. **仅动画 transform 和 opacity**
2. **使用 will-change 提前优化**
3. **避免动画 backdrop-filter**（已废弃玻璃态）
4. **使用 CSS 动画替代 JS 动画**
5. **减少同时动画的元素数量**

## 11.2 will-change 使用
```css
.card-hover:hover {
  will-change: transform, box-shadow;
}
```

## 11.3 减少动画偏好
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 11.4 动画时长规范
| 类型 | 时长 | 用途 |
|------|------|------|
| 微交互 | 100-150ms | 点击、悬停 |
| 标准过渡 | 200-300ms | 状态切换、模态 |
| 页面级 | 300-500ms | 页面切换、大元素 |
| 复杂动画 | 500-800ms | 成功反馈、引导 |

==========================================================
# 12. 错误恢复交互
==========================================================

## 12.1 网络错误
**检测**：API 调用失败
**反馈**：
- Toast：红色，"网络错误，请检查网络连接"
- 操作：重试按钮
- 自动重试：3 次，间隔 2s

## 12.2 超时错误
**检测**：请求超过 30s
**反馈**：
- Toast："请求超时，请稍后重试"
- 操作：重试按钮

## 12.3 服务器错误
**检测**：5xx 状态码
**反馈**：
- Toast："服务器繁忙，请稍后重试"
- 操作：重试按钮 + 联系客服链接

## 12.4 表单错误
**检测**：API 返回字段级错误
**反馈**：
- 字段级：红色边框 + 错误文字
- 全局：表单顶部错误摘要
- 自动滚动：到第一个错误字段

==========================================================
# 13. 引导交互（Onboarding）
==========================================================

## 13.1 首次使用引导
**样式**：
- 遮罩层：高亮当前元素
- 提示框：Sharp Card 样式，箭头指向
- 步骤：进度指示器

**流程**：
```
步骤 1：高亮导航 → 介绍功能
    ↓
步骤 2：高亮内容区 → 介绍操作
    ↓
步骤 3：高亮操作按钮 → 介绍创建
    ↓
完成引导
```

## 13.2 新功能提示
**样式**：
- 小红点或徽标
- 点击展开提示气泡
- 可关闭

==========================================================
# 14. 实现检查清单
==========================================================

## 14.1 基础动画
- [ ] 模态框入场/退场动画
- [ ] 页面切换动画
- [ ] 列表项入场动画
- [ ] Toast 入场/退场动画

## 14.2 微交互
- [ ] 卡片悬停效果
- [ ] 按钮点击反馈
- [ ] 输入框聚焦效果
- [ ] 开关状态切换
- [ ] 标签切换动画

## 14.3 加载状态
- [ ] 按钮加载 spinner
- [ ] 骨架屏 shimmer
- [ ] 页面加载进度条
- [ ] 下拉刷新动画

## 14.4 手势支持
- [ ] 移动端滑动手势
- [ ] 下拉刷新
- [ ] 列表项左滑操作

## 14.5 键盘支持
- [ ] 快捷键映射
- [ ] 焦点管理
- [ ] 模态框焦点捕获

## 14.6 性能
- [ ] will-change 优化
- [ ] 减少动画偏好支持
- [ ] 动画时长规范

==========================================================
# 附录：动画速查表
==========================================================

| 动画名称 | 时长 | 缓动函数 | 用途 |
|---------|------|---------|------|
| modal-enter | 300ms | cubic-bezier(0.4, 0, 0.2, 1) | 模态框入场 |
| modal-exit | 200ms | cubic-bezier(0.4, 0, 1, 1) | 模态框退场 |
| page-enter | 400ms | ease | 页面切换 |
| list-item-enter | 300ms | ease | 列表项加载 |
| card-hover | 200ms | ease | 卡片悬停 |
| btn-click | 100ms | ease | 按钮点击 |
| toast-in | 300ms | ease | Toast 入场 |
| toast-out | 200ms | ease | Toast 退场 |
| shake | 300ms | ease | 错误抖动 |
| shimmer | 1.5s | linear | 骨架屏 |
| success-pop | 600ms | cubic-bezier(0.34, 1.56, 0.64, 1) | 成功图标 |
| tab-slide | 200ms | ease | 标签切换 |