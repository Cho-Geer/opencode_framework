## CodeGraph 引入 OpenCode 框架可行性研究报告

**调查日期：** 2026-06-16
**调查范围：** CodeGraph 源码分析、UC7KS 现有知识系统对比、Obsidian 定位对比

---

### 一、引入 CodeGraph 的收益与复杂度评估

#### 1.1 CodeGraph 是什么

CodeGraph 是一个本地运行的代码知识图谱工具，通过 Tree-sitter 对源码做静态分析，提取符号（函数、类、接口、路由等）及其关系（调用、引用、继承、导入），存入本地 SQLite + FTS5 全文索引，然后通过 MCP 协议暴露 8 个只读工具供 AI Agent 查询。核心价值是让 AI 不再需要反复 glob/grep/read 文件来理解代码结构，而是直接查图谱获取精准的上下文。

#### 1.2 能带来的具体收益

**Token 消耗大幅下降。** CodeGraph 官方基准测试显示：跨 7 个真实仓库，平均 token 消耗降低 57%，工具调用次数降低 71%（大型仓库可达 94%~96%）。对 work-one 项目来说，这意味着 @Coder-BE 和 @Coder-FE 在理解 NestJS/Angular 代码结构时的探索开销会显著减少。

**直接替代 UC7KS 的 Scout 层（Layer 3）。** 当前 UC7KS 的 Scout 层通过派遣子 Agent 克隆依赖仓库、逐文件阅读来分析源码内部实现，token 消耗极高且从未被运行时测试过。CodeGraph 能以确定性静态分析覆盖这个场景——"谁调用了 `dispatch_subagent()`"、"修改 `safe-edit-core.ts` 会影响哪些模块"这类问题，一次 `codegraph_impact` 调用就能回答。

**消除 @Coder 的代码探索仪式。** 目前 Agent 理解代码结构的标准流程是：glob 找文件 → grep 搜符号 → read 逐文件阅读 → 脑中构建调用关系。CodeGraph 把这个流程压缩为一次 `codegraph_explore` 或 `codegraph_callers/callees` 调用。

**影响分析能力是全新的。** 当前框架没有任何工具能做"修改 X 会影响哪些模块"的分析。@Architect 和 @Guardian 只能靠人工判断。CodeGraph 的 `codegraph_impact` 提供了自动化的影响半径分析，对代码审查和变更风险评估非常有价值。

#### 1.3 与 UC7KS 的重叠和互补分析

| 维度 | UC7KS | CodeGraph | 关系 |
|------|-------|-----------|------|
| 知识类型 | 技术文档（NestJS 文档、Prisma 文档等） | 代码结构（符号、调用关系、路由映射） | **互补** |
| 数据来源 | Context7 MCP / webfetch / websearch | Tree-sitter 静态分析本地源码 | **互补** |
| 索引对象 | `docs/official_docs/` 下的 markdown/HTML 文档 | `.ts/.py/.java` 等源码文件的 AST | **无重叠** |
| 查询方式 | `module_scope_declare` → `knowledge_cache_search` 两步协议 | 8 个 MCP 工具直接查询 | **CodeGraph 更简洁** |
| 强制协议开销 | 每任务 2000~5000 token 的协议开销 + 每次工具调用 ~200 token 的 hook 检查 | 无强制协议，工具按需调用 | **CodeGraph 开销更低** |
| 跨项目知识 | 支持（index.json 可索引多库文档） | 支持（`projectPath` 参数可跨项目查询） | 持平 |
| 路由感知 | 无 | 17 种 Web 框架的 URL→handler 映射 | **CodeGraph 独有** |

**结论：两者在知识类型上完全互补，没有实质性重叠。** UC7KS 解决的是"这个库怎么用"（外部文档知识），CodeGraph 解决的是"这段代码是什么结构"（内部代码知识）。引入 CodeGraph 不会让 UC7KS 变得多余，但可以让 Scout 层（Layer 3）退役。

#### 1.4 复杂度会不会陡升

**不会陡升，但会有适度的集成成本。** 具体分析：

**低风险项：**

- CodeGraph 是纯本地运行的 MCP Server，不需要外部 API 密钥或云服务，与框架的"完全本地化"原则一致。
- 安装简单：`codegraph init` + `codegraph install`，配置只需在 `opencode.json` 的 `mcp` 块中加一条 MCP Server 声明。
- 8 个工具都是只读的，不会与 `safe_edit`/`safe_shell` 等写操作工具冲突。
- 不需要修改 UC7KS 的核心逻辑——CodeGraph 工具和 UC7KS 工具可以并行存在。

**中风险项：**

- **Plugin hook 适配：** `uc7ks-before.ts` 目前拦截 `webfetch`/`websearch`/`context7_*` 等外部查询工具，强制先查缓存。CodeGraph 的工具不在拦截列表中，不需要改动。但如果想让 Agent 在使用 CodeGraph 前先查文档缓存，需要在 hook 中加一条路由逻辑。
- **权限矩阵更新：** `opencode.json` 和 `project.config.json` 中需要为各 Agent 添加 CodeGraph 工具的权限配置（8 个新工具 × 10 个 Agent）。建议用模板继承简化。
- **`dispatch_subagent.ts` 的复杂度：** 这个 550 行的工具已经承担 4 层验证，加入 CodeGraph 不影响它，但如果 Agent 在 dispatch 前需要额外的 CodeGraph 查询来做影响分析，会增加调用链长度。
- **Bun 缓存问题：** CodeGraph 的 MCP Server 通过 `codegraph serve --mcp` 启动，是独立进程，不受项目 Bun 缓存影响。

**总体评估：** 引入 CodeGraph 的复杂度增量约为"配置级"（添加 MCP Server + 权限矩阵更新），不涉及框架核心逻辑的重构。与框架已有的 9 个 MCP Server 相比，多 1 个 MCP Server 的运维负担可忽略。

---

### 二、具体实施方案

#### 2.1 Phase 1：最小化引入（1~2 天）

**目标：** 在不修改任何框架代码的前提下，让所有 Agent 能使用 CodeGraph。

**步骤：**

1. **安装 CodeGraph CLI：**
   ```bash
   # WSL Ubuntu-24.04
   curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | bash
   ```

2. **初始化项目索引：**
   ```bash
   cd /home/zhaoge/workspace/opencode/work-one
   codegraph init
   ```
   这会在项目根目录创建 `.codegraph/` 目录，包含 SQLite 数据库。将其加入 `.gitignore`。

3. **注册 MCP Server：** 在 `opencode.json` 的 `mcp` 块中添加：
   ```json
   "codegraph": {
     "command": "codegraph",
     "args": ["serve", "--mcp", "--path", "/home/zhaoge/workspace/opencode/work-one"]
   }
   ```

4. **权限矩阵更新：** 在 `project.config.json` 的 `agent_tools_whitelist` 中，为所有需要代码探索能力的 Agent 添加 CodeGraph 工具：
   ```json
   "codegraph_search": true,
   "codegraph_explore": true,
   "codegraph_callers": true,
   "codegraph_callees": true,
   "codegraph_impact": true,
   "codegraph_node": true,
   "codegraph_status": true,
   "codegraph_files": true
   ```
   建议至少给 @Architect、@Coder-BE、@Coder-FE、@Guardian、@Meta-Planner 开放权限。@Orchestrator 不需要（它不应该做代码分析）。

5. **验证：** 派遣 @Coder-BE 做一个简单的代码探索任务，对比使用 CodeGraph 前后的工具调用次数和 token 消耗。

#### 2.2 Phase 2：协议优化（3~5 天）

**目标：** 让 CodeGraph 与 UC7KS 协同工作，消除不必要的仪式。

**步骤：**

1. **简化 UC7KS 的 Scout 层：** 将 `scout-trigger.ts` 和 `scout-extractor.ts` 标记为 deprecated。当 Agent 需要理解源码内部实现时，直接使用 CodeGraph 而非派遣 Scout 子 Agent。保留 `docs/official_docs/*/source-analysis/` 目录中已有的 Scout 产出作为历史知识。

2. **在 `uc7ks-before.ts` 中添加 CodeGraph 感知：** 当 Agent 查询代码结构相关问题时（通过工具名称和参数判断），跳过文档缓存检查，直接放行 CodeGraph 工具调用。代码结构问题不需要查文档缓存。

3. **更新 Agent prompt 文件：** 在 @Coder-BE、@Coder-FE、@Architect 的 `.opencode/agents/*.md` 中添加 CodeGraph 使用指南：
   - 探索代码结构时优先使用 `codegraph_explore`
   - 修改代码前使用 `codegraph_impact` 评估影响范围
   - 查找符号定义时使用 `codegraph_search`
   - 理解调用链时使用 `codegraph_callers` / `codegraph_callees`

4. **更新 @Meta-Planner 的 DAG 规划流程：** 在生成 Task.DAG.json 时，使用 `codegraph_impact` 分析变更影响范围，更准确地估计任务依赖和复杂度。

#### 2.3 Phase 3：深度集成（1~2 周，可选）

**目标：** 将 CodeGraph 数据融入框架的状态管理和质量门禁。

**步骤：**

1. **@Guardian 审查增强：** 在代码审查流程中，使用 `codegraph_impact` 自动检测 PR 是否遗漏了受影响的关联模块（比如改了 service 层但没更新对应的测试）。

2. **Pre-commit hook 增强：** 在 `hook-layers.ts` 中添加一个轻量级检查——当 staged files 包含高扇入符号（被大量调用的函数）的修改时，要求 commit message 包含 `[HIGH-IMPACT]` 标记。

3. **`knowledge_gap_report` 增强：** 将 CodeGraph 的索引覆盖率（`codegraph_status` 返回的文件数/节点数/边数）纳入知识覆盖率报告，区分"文档知识覆盖"和"代码结构覆盖"。

---

### 三、CodeGraph vs Obsidian 对比分析

#### 3.1 定位本质差异

这两者解决的是完全不同的问题，**不存在功能重叠**：

| 维度 | CodeGraph | Obsidian |
|------|-----------|----------|
| **本质** | AI 面向的代码结构图谱 | 人类面向的个人知识管理 |
| **数据源** | 源码文件（自动静态分析） | 人类手写的 Markdown 笔记 |
| **图谱含义** | 函数调用关系、类继承、导入依赖 | 笔记之间的 `[[双向链接]]` |
| **消费者** | AI Agent（通过 MCP 协议） | 人类用户（通过 GUI） |
| **更新方式** | 自动（文件监听 + 防抖重索引） | 手动（人工编写和维护笔记） |
| **代码理解** | 完整（符号提取、调用图、路由映射） | 无（代码只是文本） |
| **存储** | SQLite 数据库 | Markdown 文件 |
| **可视化** | 无（数据层，不是可视化工具） | 精美交互式图谱视图 |

#### 3.2 Obsidian 能做什么 CodeGraph 做不到的

Obsidian 擅长的是**人类策划的长期知识**——架构决策记录（ADR）、设计理由、调试经验总结、API 设计思考、团队约定等。这些是"为什么这样做"的知识，无法从源码自动提取。

Obsidian 也有社区 MCP Server 插件，可以让 AI Agent 读写 Obsidian vault 中的笔记。但这种集成只是把笔记当文本文件处理，AI 仍然需要完整阅读笔记内容才能找到相关信息，不像 CodeGraph 那样提供结构化的精确查询。

#### 3.3 同时引入会不会功能重复、收益下降

**不会。** 原因如下：

1. **知识维度正交：** CodeGraph 覆盖"代码是什么结构"，Obsidian 覆盖"为什么这样设计"。一个问 `codegraph_impact("processPayment")` 就能告诉你改这个函数会影响谁；另一个在笔记里记录着"processPayment 为什么用两阶段提交而不是直接写入"。这两种知识不重叠。

2. **消费者不同：** CodeGraph 主要给 AI Agent 用（MCP 工具调用），Obsidian 主要给人用（开发者自己查阅架构文档）。即使 AI 也通过 MCP 读 Obsidian 笔记，笔记的内容类型（设计理由、经验总结）和 CodeGraph 返回的内容类型（符号关系、调用链）完全不同。

3. **维护成本独立：** CodeGraph 零维护（自动索引），Obsidian 需要人工写笔记但这是正常的文档工作。两者不互相增加维护负担。

4. **唯一需要注意的边界：** 如果团队在 Obsidian 中手动维护了"代码结构文档"（比如手画的模块依赖图、手写的 API 清单），这确实会和 CodeGraph 自动生成的图谱产生信息冗余，而且 Obsidian 中的版本会更快过时。建议：代码结构相关的知识交给 CodeGraph 自动生成，Obsidian 只存放设计理由、决策记录、经验总结等非结构化知识。

#### 3.4 推荐策略

对于 work-one 项目：

- **CodeGraph：强烈建议引入。** 直接收益明确（token 降低 50%+、工具调用降低 70%+），集成成本低，与现有 UC7KS 互补而非重叠。
- **Obsidian：当前阶段不建议引入。** 项目已有 `docs/official_docs/` + `index.json` 作为文档知识管理系统（UC7KS 的载体），功能上已覆盖 Obsidian 能提供的 AI 消费场景。引入 Obsidian 会多一层"笔记 → MCP → AI"的管道，增加复杂度但收益有限。如果未来团队规模扩大，需要一个人类友好的知识协作平台时再考虑。

---

### 附录：CodeGraph MCP 工具速查表

| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `codegraph_search` | 符号名称快速搜索 | `query`, `kind`(function/class/route...), `limit` |
| `codegraph_explore` | 深度探索（主力工具） | `query`, `maxFiles` |
| `codegraph_callers` | 谁调用了这个符号 | `symbol`, `file`, `limit` |
| `codegraph_callees` | 这个符号调用了谁 | `symbol`, `file`, `limit` |
| `codegraph_impact` | 修改影响半径分析 | `symbol`, `file`, `depth` |
| `codegraph_node` | 获取符号源码/读取文件 | `symbol`, `includeCode`, `file`, `offset`, `limit` |
| `codegraph_status` | 索引健康检查 | `projectPath` |
| `codegraph_files` | 已索引文件树 | `path`, `pattern`, `format`, `maxDepth` |

所有工具均支持 `projectPath` 参数进行跨项目查询。
