---
trigger: always_on
alwaysApply: true
---

# 前端代码规范 — 分层模板

> **参见**：[coding-standard-common.md](coding-standard-common.md) — 框架无关的通用编码规范（命名约定、类型安全、TDD、文件分离、导入顺序、文件长度限制、JSDoc、Git 提交格式等）。Tier 1 规则全文定义于该文件。

本文档为前端代码规范的分层模板：**Tier 1** 为所有前端项目不可变更的通用规则，**Tier 2** 为通过 `{frontend.*}` 占位符引用项目配置的框架参数化规则。各项目通过 `project.config.json` 和 `context/code_standards/frontend-coding-standard.md` 注入具体实现。

---

## Tier 1 — 通用规范 (Universal Rules)

以下规则适用于所有前端框架（Angular / React / Vue / Svelte 等），不可变更。完整定义及代码示例参见 [coding-standard-common.md](coding-standard-common.md)。

### 1. 文件分离 (File Separation)

**禁止**在 `@Component`（或等效装饰器）中使用内联 `template` 或 `styles` 字符串。组件逻辑、模板、样式必须物理分离为三个独立文件。

### 2. 禁止 `any` 类型 (No `any` Type)

所有函数参数、返回值、变量必须有明确的 TypeScript 类型注解。禁止使用 `any` 类型。确需动态类型时使用 `unknown` + 类型守卫。

### 3. Import 排序 (Import Ordering)

导入语句必须按以下顺序分组，组间空行分隔，组内按字母序排列：

1. 外部依赖（第三方包）
2. 内部模块（项目 `src/` 下的绝对路径导入）
3. 相对导入（同级或子目录相对路径）

### 4. TDD 强制 (RED → GREEN → REFACTOR)

- **RED**：先编写测试用例，执行必须失败
- **GREEN**：编写**最简**代码使测试通过
- **REFACTOR**：测试全量通过后重构
- **禁止**编写无对应测试用例的业务代码
- 最低覆盖率：行 / 分支 / 函数均 ≥ 70%，核心业务路径 ≥ 90%

### 5. 文件长度限制 (File Length Limits)

- 组件逻辑文件（`.component.ts`）不超过 400 行
- 模板文件（`.component.html`）不超过 200 行
- 超过时必须拆分为更小的子组件或辅助模块

### 6. JSDoc 文档注释 (JSDoc Documentation)

所有公共 API（组件 `@Input` / `@Output`、Service 公共方法、Store 方法）必须包含 JSDoc 注释，说明用途、参数和返回值。复杂逻辑必须用行内注释解释 **为什么** 而非 **做了什么**。

### 7. Git 提交格式 (Git Commit Format)

```text
<type>[scope]: <description>

[optional body]
```

TDD 阶段标签（强制）：
| 阶段 | 标签 | 示例 |
|:---|:---|:---|
| RED（测试先行） | `[Red] {task_id}` | `test(booking): add unit tests [Red] T-014` |
| GREEN（实现通过） | `[Green] {task_id}` | `feat(booking): implement creation [Green] T-014` |
| REFACTOR（重构） | `[Refactor] {task_id}` | `refactor(booking): extract logic [Refactor] T-014` |

---

## Tier 2 — 框架参数化规范 (Framework‑Parameterized Rules)

以下规范通过 `{frontend.*}` 占位符引用项目配置。各项目通过 `project.config.json` 和 `context/code_standards/frontend-coding-standard.md` 注入具体实现。

### 8. CSS 策略

**占位符**: `{frontend.css_strategy}`

优先使用项目配置的 CSS 方案完成样式编写。组件私有样式仅作补充。全局样式文件仅用于 CSS 重置、字体引入、全局变量定义。禁止使用已弃用的 CSS 特性（如 Sass `@import`）。

> **当前解析值及配置来源见下方 [解析映射表](#解析映射表-resolution-block)。**

### 9. 状态管理

**占位符**: `{frontend.state_pattern}`

遵循项目配置的状态管理模式：

- 页面组件可注入全局状态 Store
- 展示型子组件（原子 / 分子）**禁止**直接访问全局状态，必须通过 `@Input()` / Props 接收数据
- 每个功能领域拥有独立的 Store，Store 内分离 State、Computed、Methods

> **当前解析值及配置来源见下方 [解析映射表](#解析映射表-resolution-block)。**

### 10. 组件层级

**占位符**: `{frontend.component_hierarchy}`

组件必须按项目定义的层级架构组织，严格遵循层级依赖约束：上层可依赖下层，下层禁止依赖上层。跨领域复用的组件提升至共享目录。

> **当前解析值及配置来源见下方 [解析映射表](#解析映射表-resolution-block)。**

### 11. 懒加载

**占位符**: `{frontend.lazy_loading}`

非首屏路由和内容必须使用项目框架提供的懒加载机制实现按需加载，减少初始包体积。首屏关键路径不受限制。

> **当前解析值及配置来源见下方 [解析映射表](#解析映射表-resolution-block)。**

### 12. API 封装

**占位符**: `{frontend.api_pattern}`

所有 HTTP 请求必须通过 Service 层封装，组件**禁止**直接调用 HTTP 客户端。DTO（数据传输对象）定义在独立文件中，与后端 API 响应格式严格对齐（字段名、类型、嵌套结构完全一致）。Service 方法返回 Promise（或框架等效异步原语）。

> **当前解析值及配置来源见下方 [解析映射表](#解析映射表-resolution-block)。**

---

## 解析映射表 (Resolution Block)

下表将 Tier 2 各占位符解析为当前项目的具体实现值。当项目技术栈变更时，仅需更新此映射表及对应的 `context/code_standards/frontend-coding-standard.md` 实现文档，Tier 1 通用规则无需修改。

| 规则号 | 占位符                           | 当前项目解析值                                                                                                                                                                                                          | 配置来源                                                         |
| :----: | :------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
|   8    | `{frontend.css_strategy}`        | **Tailwind CSS v4 First** — 优先使用 Tailwind 工具类完成布局/间距/颜色/字体；SCSS 仅用于 Tailwind 无法覆盖的场景（复杂动画、伪元素）；组件私有样式使用 BEM 命名                                                         | `project.config.json` → `frontend.css`；实现文档 §5              |
|   9    | `{frontend.state_pattern}`       | **NgRx SignalStore** — 页面组件注入 Store 并订阅 `vm` Signal；分子/原子组件通过 `@Input()` 接收数据；每个功能领域拥有独立 Store（`signalStore()` + `withState()` + `withComputed()` + `withMethods()`）                 | `project.config.json` → `frontend.state_management`；实现文档 §6 |
|   10   | `{frontend.component_hierarchy}` | **原子设计 (Atomic Design)** — `Atoms → Molecules → Organisms → Layouts → Pages`（原 "Templates" 层重命名为 "Layouts"）；Pages 禁止直接依赖 Molecules/Atoms                                                             | `context/code_standards/frontend-coding-standard.md` §1.2        |
|   11   | `{frontend.lazy_loading}`        | **Angular 路由懒加载 + `@defer` 延迟视图** — 根路由通过 `loadChildren` 懒加载 feature 模块；feature 内通过 `loadComponent` 懒加载页面组件；非首屏内容使用 `@defer (on viewport)`                                        | `context/code_standards/frontend-coding-standard.md` §8          |
|   12   | `{frontend.api_pattern}`         | **Service 层封装 + DTO 严格对齐** — 组件禁止直接使用 `HttpClient`；所有 HTTP 请求封装在 `*Service` 类中（`@Injectable({ providedIn: 'root' })`）；DTO 文件独立于 `features/*/dto/`；接口名与后端 API 响应字段名完全一致 | `context/code_standards/frontend-coding-standard.md` §7          |

### 变更管理规则

1. **Tier 1 规则修改**（规则 1–7）：必须同步更新 `coding-standard-common.md` 作为权威来源，并在此处更新引用。
2. **Tier 2 解析值变更**：当项目技术栈变更时，更新上方解析映射表的 "当前项目解析值" 列，并同步更新 `context/code_standards/frontend-coding-standard.md` 中对应的实现章节。
3. **新增 Tier 2 规则**：在 Tier 2 区域新增带 `{frontend.*}` 占位符的规则条目，并在解析映射表中追加对应行。

---

## 完整实现文档

完整规范及框架特定的代码示例请参阅：[前端代码规范文档（Angular）](../context/code_standards/frontend-coding-standard.md)
