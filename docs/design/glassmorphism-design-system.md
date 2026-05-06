# 玻璃态设计系统（Glassmorphism Design System）
版本：1.0.0（DEPRECATED）
日期：2026-04-30
适用：Customer 前台所有页面与组件

> ⚠️ **DEPRECATED — 2026-05-04**
> 
> This design system has been superseded by the **dark-first design system** (see `admin-ui-spec.md` v2.0.0 and `global-ui-spec.md` v3.0.0). The glassmorphism paradigm is no longer used in this project. Key changes:
> - **Removed**: All `backdrop-filter`, `glass-level-1/2/3`, blur-based layering, gradient overlays
> - **Replaced with**: Sharp design system (`sharp-card`, `sharp-button`, `sharp-input`) using solid dark backgrounds (#0c1220, #162032) and clean borders (#2a3a50)
> - **Color palette**: `#667eea → #764ba2` gradients replaced by `#00c6ff` solid accent
> 
> **This file is retained for historical reference only.** Do not implement any patterns from this document in new code.
> 
> ---

==========================================================
# 1. 设计理念
==========================================================

## 1.1 什么是玻璃态
玻璃态（Glassmorphism）是一种现代 UI 设计风格，通过以下特征营造层次感和通透感：
- **半透明背景**：元素背景部分透明，透出下层内容
- **背景模糊**：backdrop-filter: blur() 创造磨砂玻璃效果
- **细腻边框**：半透明白色边框增强玻璃边缘感
- **柔和阴影**：大面积弥散阴影提升悬浮感
- **渐变色彩**：蓝紫渐变作为主色调，营造现代专业感

## 1.2 设计目标
- 打造轻盈、通透、现代的视觉体验
- 通过层级区分信息重要性
- 营造沉浸式交互体验
- 提升品牌专业感和科技感

## 1.3 与 Admin 后台的区别
| 特性 | Customer 前台（玻璃态） | Admin 后台（标准） |
|------|----------------------|------------------|
| 视觉风格 | 现代、通透、渐变 | 专业、简洁、纯色 |
| 主色调 | 蓝紫渐变 #667eea → #764ba2 | 纯蓝 #1677FF |
| 卡片 | 玻璃卡片（半透明+模糊） | 白底卡片（实色） |
| 圆角 | 大圆角（12-16px） | 标准圆角（6-10px） |
| 动画 | 丰富微交互动画 | 基础过渡动画 |
| 阴影 | 弥散大阴影 | 轻微实色阴影 |

==========================================================
# 2. 设计令牌（Design Tokens）
==========================================================

## 2.1 颜色令牌

### 主色调
```
--color-primary-start: #667eea       // 渐变起始（蓝色）
--color-primary-end: #764ba2         // 渐变结束（紫色）
--color-primary-solid: #667eea       // 纯色版本（用于图标、小元素）
--color-secondary: #764ba2           // 辅助紫色
```

### 功能色
```
--color-success: #00B42A             // 成功（保持）
--color-warning: #FF7D00             // 警告（保持）
--color-danger: #F53F3F              // 危险（保持）
--color-info: #1677FF                // 信息（蓝色）
```

### 玻璃态背景
```
--glass-bg-light: rgba(255, 255, 255, 0.85)     // 浅色玻璃（顶层）
--glass-bg-medium: rgba(255, 255, 255, 0.75)    // 中层玻璃
--glass-bg-dark: rgba(255, 255, 255, 0.65)      // 深色玻璃（底层）
--glass-bg-overlay: rgba(0, 0, 0, 0.4)          // 遮罩层
```

### 边框
```
--glass-border-light: rgba(255, 255, 255, 0.5)
--glass-border-medium: rgba(255, 255, 255, 0.3)
--glass-border-dark: rgba(255, 255, 255, 0.2)
```

### 文字色
```
--text-primary: #1D2129              // 主文字（深色背景上）
--text-secondary: #4E5969            // 次要文字
--text-muted: #86909C                // 辅助文字
--text-light: rgba(255, 255, 255, 0.9)   // 浅色文字（渐变背景上）
--text-light-muted: rgba(255, 255, 255, 0.6)
```

### 页面背景
```
--page-bg-gradient: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%)
--page-bg-solid: #f5f7fa
```

## 2.2 模糊令牌
```
--blur-sm: 8px                       // 小模糊（移动端性能）
--blur-md: 12px                      // 中模糊（标准）
--blur-lg: 20px                      // 大模糊（顶层元素）
--blur-xl: 32px                      // 超大模糊（背景装饰）
```

## 2.3 阴影令牌
```
--shadow-glass-sm: 0 4px 16px rgba(0, 0, 0, 0.08)
--shadow-glass-md: 0 8px 32px rgba(0, 0, 0, 0.1)
--shadow-glass-lg: 0 16px 48px rgba(0, 0, 0, 0.12)
--shadow-glass-xl: 0 24px 64px rgba(0, 0, 0, 0.15)
--shadow-glass-hover: 0 20px 60px rgba(102, 126, 234, 0.2)  // 渐变发光
```

## 2.4 圆角令牌
```
--radius-sm: 8px                     // 小元素
--radius-md: 12px                    // 标准
--radius-lg: 16px                    // 大卡片
--radius-xl: 24px                    // 超大（模态框）
--radius-full: 9999px                // 圆形
```

## 2.5 间距令牌
```
--space-xs: 4px
--space-sm: 8px
--space-md: 16px
--space-lg: 24px                     // 玻璃卡片内边距（比标准大）
--space-xl: 32px
--space-2xl: 48px
```

## 2.6 动画令牌
```
--duration-fast: 150ms               // 快速反馈
--duration-normal: 200ms             // 标准过渡
--duration-slow: 300ms               // 复杂动画
--duration-slower: 500ms             // 页面级动画

--ease-default: cubic-bezier(0.4, 0, 0.2, 1)      // 标准
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)       // 对称
--ease-out: cubic-bezier(0, 0, 0.2, 1)            // 减速
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)  // 弹性
```

==========================================================
# 3. 玻璃态层级系统
==========================================================

## 3.1 层级定义

### Level 0 - 页面背景
- 纯色或渐变背景
- 无模糊
- 最底层，所有元素的基础

### Level 1 - 基础玻璃（内容卡片）
```css
.glass-level-1 {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}
```
- 用途：内容卡片、列表项、信息面板

### Level 2 - 中层玻璃（悬浮元素）
```css
.glass-level-2 {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
}
```
- 用途：下拉菜单、浮动面板、侧边栏

### Level 3 - 顶层玻璃（模态框、导航）
```css
.glass-level-3 {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}
```
- 用途：模态框、顶部导航、底部操作栏

### Level 4 - 遮罩层（背景遮罩）
```css
.glass-overlay {
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}
```
- 用途：模态框背景、加载遮罩、侧边栏遮罩

## 3.2 层级叠加规则
- 同一页面最多叠加 3 层玻璃
- 避免玻璃元素上再叠加玻璃元素（性能问题）
- 重要内容使用 Level 3，次要内容使用 Level 1

==========================================================
# 4. 渐变应用规范
==========================================================

## 4.1 主渐变
```css
.gradient-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
```
- 用途：主按钮、选中状态、品牌标识、重要标签

## 4.2 悬停渐变
```css
.gradient-primary-hover {
  background: linear-gradient(135deg, #5a6fd6 0%, #6a4190 100%);
}
```
- 用途：按钮悬停、链接悬停

## 4.3 背景渐变
```css
.gradient-page-bg {
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
}
```
- 用途：页面背景、大卡片背景

## 4.4 边框渐变
```css
.gradient-border {
  border-image: linear-gradient(135deg, rgba(102,126,234,0.5), rgba(118,75,162,0.5)) 1;
}
```
- 用途：选中卡片边框、重要输入框边框

## 4.5 文字渐变
```css
.gradient-text {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```
- 用途：大标题、品牌文字、重要数字

==========================================================
# 5. 玻璃态组件规范
==========================================================

## 5.1 玻璃卡片（Glass Card）
```
基础样式：
- Level 1 玻璃
- padding: 24px
- border-radius: 16px

变体：
- 小卡片：padding: 16px, border-radius: 12px
- 大卡片：padding: 32px, border-radius: 20px
- 可交互卡片：hover → translateY(-4px) + shadow-glass-hover
- 选中卡片：border: 2px solid gradient-primary
```

## 5.2 玻璃按钮（Glass Button）
```
主按钮：
- background: gradient-primary
- color: white
- padding: 12px 24px
- border-radius: 12px
- hover: gradient-primary-hover + scale(1.02)
- active: scale(0.98)
- shadow: 0 4px 16px rgba(102, 126, 234, 0.3)

次按钮：
- background: transparent
- border: 1px solid rgba(102, 126, 234, 0.5)
- color: gradient-text
- hover: background: rgba(102, 126, 234, 0.1)

文字按钮：
- background: transparent
- color: #667eea
- hover: underline + background: rgba(102, 126, 234, 0.05)
```

## 5.3 玻璃输入框（Glass Input）
```
基础：
- background: rgba(255, 255, 255, 0.5)
- border: 1px solid rgba(255, 255, 255, 0.4)
- border-radius: 12px
- padding: 12px 16px
- color: #1D2129

聚焦：
- border: 1px solid gradient-primary
- box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15)

错误：
- border: 1px solid #F53F3F
- box-shadow: 0 0 0 3px rgba(245, 63, 63, 0.15)
```

## 5.4 玻璃模态框（Glass Modal）
```
遮罩：
- glass-overlay

弹窗：
- Level 3 玻璃
- border-radius: 20px
- max-width: 520px / 640px / 800px
- padding: 32px

动画：
- 入场：opacity 0→1 + scale(0.95)→scale(1), duration: 300ms
- 退场：opacity 1→0 + scale(1)→scale(0.95), duration: 200ms
```

## 5.5 玻璃状态标签（Glass Badge）
```
基础：
- padding: 4px 12px
- border-radius: 9999px
- font-size: 12px
- border: 1px solid

状态色：
- 待处理：bg: rgba(134,144,156,0.15), border: rgba(134,144,156,0.3), color: #86909C
- 处理中：bg: rgba(102,126,234,0.15), border: rgba(102,126,234,0.3), color: #667eea
- 已完成：bg: rgba(0,180,42,0.15), border: rgba(0,180,42,0.3), color: #00B42A
- 异常：bg: rgba(245,63,63,0.15), border: rgba(245,63,63,0.3), color: #F53F3F
- 已过期：bg: rgba(255,125,0,0.15), border: rgba(255,125,0,0.3), color: #FF7D00
```

## 5.6 玻璃下拉菜单（Glass Dropdown）
```
触发器：
- 类似玻璃输入框

下拉面板：
- Level 2 玻璃
- border-radius: 12px
- padding: 8px
- margin-top: 8px

选项：
- padding: 10px 16px
- border-radius: 8px
- hover: background: rgba(102, 126, 234, 0.1)
- selected: background: rgba(102, 126, 234, 0.15) + color: #667eea
```

## 5.7 玻璃导航栏（Glass Navbar）
```
顶部导航：
- Level 3 玻璃（滚动后）/ Level 2（顶部）
- height: 64px
- position: fixed
- top: 0
- z-index: 1000

滚动效果：
- 初始：透明背景
- 滚动后：backdrop-filter: blur(20px) + background: rgba(255,255,255,0.85)
- transition: all 300ms ease
```

## 5.8 玻璃日历（Glass Calendar）
```
日历面板：
- Level 2 玻璃
- border-radius: 16px
- padding: 24px

日期格子：
- size: 40px
- border-radius: 10px
- 默认：透明
- 今天：border: 1px solid gradient-primary
- 选中：background: gradient-primary + color: white
- 禁用：opacity: 0.3
- hover: background: rgba(102, 126, 234, 0.1)

月份切换按钮：
- 圆形玻璃按钮
- size: 32px
```

## 5.9 玻璃时间槽（Glass Time Slot）
```
时间按钮：
- padding: 12px 16px
- border-radius: 12px
- border: 1px solid rgba(255, 255, 255, 0.3)

可用：
- background: rgba(255, 255, 255, 0.5)
- hover: background: rgba(102, 126, 234, 0.1) + border: rgba(102, 126, 234, 0.5)

已预约：
- background: rgba(134, 144, 156, 0.2)
- color: #86909C
- cursor: not-allowed

选中：
- background: gradient-primary
- color: white
- border: none
- box-shadow: 0 4px 16px rgba(102, 126, 234, 0.3)
```

## 5.10 玻璃表格（Glass Table）- Admin 适配
```
表格容器：
- Level 1 玻璃
- border-radius: 16px
- overflow: hidden

表头：
- background: rgba(102, 126, 234, 0.1)
- color: #667eea
- font-weight: 600

行：
- hover: background: rgba(102, 126, 234, 0.05)
- 斑马纹：偶数行 background: rgba(255, 255, 255, 0.3)
```

==========================================================
# 6. 装饰元素
==========================================================

## 6.1 渐变球（Gradient Orbs）
用于页面背景装饰，营造氛围：
```css
.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.4;
  pointer-events: none;
}

.orb-1 {
  width: 400px;
  height: 400px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  top: -100px;
  right: -100px;
}

.orb-2 {
  width: 300px;
  height: 300px;
  background: linear-gradient(135deg, #764ba2, #667eea);
  bottom: -50px;
  left: -50px;
}
```

## 6.2 网格背景
```css
.grid-bg {
  background-image: 
    linear-gradient(rgba(102, 126, 234, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(102, 126, 234, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
}
```

## 6.3 光晕效果
```css
.glow {
  box-shadow: 0 0 40px rgba(102, 126, 234, 0.3);
}

.glow-strong {
  box-shadow: 0 0 60px rgba(102, 126, 234, 0.4);
}
```

==========================================================
# 7. Tailwind CSS 集成
==========================================================

## 7.1 自定义配置
```javascript
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        'primary-start': '#667eea',
        'primary-end': '#764ba2',
        'glass': {
          light: 'rgba(255, 255, 255, 0.85)',
          medium: 'rgba(255, 255, 255, 0.75)',
          dark: 'rgba(255, 255, 255, 0.65)',
        }
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glass': '0 8px 32px rgba(0, 0, 0, 0.1)',
        'glass-hover': '0 20px 60px rgba(102, 126, 234, 0.2)',
        'glass-lg': '0 20px 60px rgba(0, 0, 0, 0.15)',
      },
      borderRadius: {
        'glass': '16px',
        'glass-lg': '20px',
      },
      animation: {
        'glass-in': 'glassIn 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        'glass-out': 'glassOut 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        'shimmer': 'shimmer 2s infinite',
      },
      keyframes: {
        glassIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        glassOut: {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.95)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
```

## 7.2 工具类示例
```html
<!-- 基础玻璃卡片 -->
<div class="bg-glass-dark backdrop-blur-md border border-white/30 rounded-glass shadow-glass p-6">
  
<!-- 主按钮 -->
<button class="bg-gradient-to-r from-primary-start to-primary-end text-white px-6 py-3 rounded-xl 
               hover:from-primary-start/90 hover:to-primary-end/90 hover:scale-[1.02] 
               active:scale-[0.98] transition-all duration-150 shadow-glass">

<!-- 玻璃输入框 -->
<input class="bg-white/50 border border-white/40 rounded-xl px-4 py-3 
              focus:border-primary-start focus:ring-2 focus:ring-primary-start/20 
              transition-all duration-200">

<!-- 状态标签 -->
<span class="px-3 py-1 rounded-full text-xs font-medium 
             bg-primary-start/15 text-primary-start border border-primary-start/30">
```

==========================================================
# 8. 性能优化指南
==========================================================

## 8.1 backdrop-filter 最佳实践
1. **避免大面积使用**：不要对整个容器使用，仅对需要玻璃效果的元素
2. **控制层级数量**：同一视口最多 3 个 backdrop-filter 元素
3. **使用 GPU 加速**：配合 transform: translateZ(0) 或 will-change
4. **移动端降级**：
   ```css
   @media (max-width: 768px) {
     .glass-element {
       backdrop-filter: blur(8px); /* 降低模糊度 */
       background: rgba(255, 255, 255, 0.8); /* 提高不透明度 */
     }
   }
   ```

## 8.2 动画性能
1. 仅动画 transform 和 opacity
2. 使用 will-change 提前告知浏览器
3. 避免在动画中改变 backdrop-filter 值
4. 使用 CSS 动画而非 JS 动画

## 8.3 降级方案
```css
/* 不支持 backdrop-filter 的浏览器 */
@supports not (backdrop-filter: blur(10px)) {
  .glass-element {
    background: rgba(255, 255, 255, 0.95); /* 使用实色背景 */
  }
}

/* 用户偏好减少动画 */
@media (prefers-reduced-motion: reduce) {
  .glass-element {
    transition: none;
    animation: none;
  }
}
```

==========================================================
# 9. 浏览器兼容性
==========================================================

## 9.1 支持情况
- **Chrome/Edge**: ✅ 完整支持（v76+）
- **Firefox**: ✅ 完整支持（v103+，需开启 layout.css.backdrop-filter.enabled）
- **Safari**: ✅ 完整支持（v9+，需 -webkit- 前缀）
- **iOS Safari**: ✅ 完整支持
- **Chrome Android**: ✅ 完整支持

## 9.2 前缀要求
```css
.glass-element {
  /* 标准语法 */
  backdrop-filter: blur(10px);
  /* Safari */
  -webkit-backdrop-filter: blur(10px);
}
```

==========================================================
# 10. 使用示例
==========================================================

## 10.1 完整页面示例
```html
<div class="min-h-screen bg-gradient-to-br from-[#f5f7fa] to-[#e4e8ec] relative overflow-hidden">
  <!-- 装饰元素 -->
  <div class="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-primary-start/40 to-primary-end/40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
  <div class="absolute bottom-0 left-0 w-72 h-72 bg-gradient-to-br from-primary-end/40 to-primary-start/40 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
  
  <!-- 导航栏 -->
  <nav class="fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-xl border-b border-white/30 z-50">
    <!-- 导航内容 -->
  </nav>
  
  <!-- 主内容 -->
  <main class="pt-24 pb-12 px-6 max-w-6xl mx-auto">
    <div class="bg-white/70 backdrop-blur-lg border border-white/30 rounded-2xl shadow-glass p-8">
      <h1 class="text-2xl font-bold bg-gradient-to-r from-primary-start to-primary-end bg-clip-text text-transparent">
        预约服务
      </h1>
      <!-- 内容 -->
    </div>
  </main>
</div>
```

## 10.2 模态框示例
```html
<!-- 遮罩 -->
<div class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
  <!-- 弹窗 -->
  <div class="bg-white/85 backdrop-blur-xl border border-white/50 rounded-[20px] shadow-glass-lg p-8 max-w-lg w-full mx-4 animate-glass-in">
    <h2 class="text-xl font-bold text-gray-900 mb-4">确认预约</h2>
    <!-- 内容 -->
    <div class="flex justify-end gap-3 mt-6">
      <button class="px-4 py-2 rounded-xl border border-primary-start/30 text-primary-start hover:bg-primary-start/10 transition-colors">
        取消
      </button>
      <button class="px-4 py-2 rounded-xl bg-gradient-to-r from-primary-start to-primary-end text-white hover:opacity-90 transition-opacity shadow-glass">
        确认
      </button>
    </div>
  </div>
</div>
```

==========================================================
# 11. 质量检查清单
==========================================================

## 11.1 视觉检查
- [ ] 所有玻璃元素有正确的 backdrop-filter
- [ ] 渐变颜色正确（#667eea → #764ba2）
- [ ] 文字在玻璃背景上清晰可读
- [ ] 边框细腻可见
- [ ] 阴影柔和自然

## 11.2 交互检查
- [ ] 悬停效果平滑（200-300ms）
- [ ] 点击反馈明显（scale 0.98）
- [ ] 模态框动画流畅
- [ ] 表单验证有即时反馈

## 11.3 性能检查
- [ ] 页面滚动流畅（60fps）
- [ ] 移动端无卡顿
- [ ] 动画不触发重排
- [ ] 降级方案工作正常

## 11.4 可访问性检查
- [ ] 对比度 ≥ 4.5:1
- [ ] 支持键盘导航
- [ ] 屏幕阅读器友好
- [ ] 减少动画偏好支持

==========================================================
# 12. 参考资源
==========================================================

- [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [Glassmorphism 设计趋势](https://uxdesign.cc/glassmorphism-in-user-interfaces-1f39bb1308c9)
- [CSS 渐变生成器](https://cssgradient.io/)

==========================================================
# 附录：与全局 UI 规范的关系
==========================================================

本设计系统是对 `global-ui-spec.md` 的**扩展和补充**，而非替代：
- Admin 后台继续使用 `global-ui-spec.md` 中的标准规范
- Customer 前台使用本玻璃态设计系统
- 共享的基础规范（字体、间距单位、状态颜色）保持一致
- 仅在视觉表现层（背景、边框、阴影、动画）有所区别

**原则**：同一系统内，Admin = 专业简洁，Customer = 现代通透。