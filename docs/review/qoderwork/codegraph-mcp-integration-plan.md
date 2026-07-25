## CodeGraph 作为 MCP 整合进 OpenCode 框架实施方案

**日期**: 2026-06-27
**前置文档**: codegraph-integration-analysis.md (2026-06-16)
**状态**: 待实施

---

### 一、CodeGraph MCP 工具清单

CodeGraph 通过 MCP 协议暴露 8 个只读工具，所有工具均支持 `projectPath` 参数跨项目查询。

| 工具名 | 用途 | 关键参数 | 返回内容 |
|--------|------|---------|---------|
| `codegraph_search` | 符号名称快速搜索 | `query`, `kind`(function/class/route...), `limit` | 匹配的符号列表（名称、文件、行号、类型） |
| `codegraph_explore` | 深度探索（主力工具） | `query`, `maxFiles` | 入口点 + 关联符号 + 代码片段 |
| `codegraph_callers` | 谁调用了这个符号 | `symbol`, `file`, `limit` | 调用者列表（函数名、文件、行号） |
| `codegraph_callees` | 这个符号调用了谁 | `symbol`, `file`, `limit` | 被调用者列表 |
| `codegraph_impact` | 修改影响半径分析 | `symbol`, `file`, `depth` | 影响范围内的所有符号和文件 |
| `codegraph_node` | 获取符号源码/读取文件 | `symbol`, `includeCode`, `file`, `offset`, `limit` | 符号定义源码 + 签名 + 导入信息 |
| `codegraph_status` | 索引健康检查 | `projectPath` | 索引状态（文件数、节点数、边数、最后索引时间） |
| `codegraph_files` | 已索引文件树 | `path`, `pattern`, `format`, `maxDepth` | 文件列表 |

**关键特征**: 全部只读、全部本地运行、零外部 API 依赖。

---

### 二、与框架现有体系的关系

#### 2.1 与 UC7KS 知识管线

| 维度 | UC7KS | CodeGraph | 关系 |
|------|-------|-----------|------|
| 知识类型 | 外部文档（NestJS 文档、Prisma 文档等） | 内部代码结构（符号、调用关系、路由映射） | 互补 |
| 数据来源 | Context7 MCP / webfetch / websearch | Tree-sitter 静态分析本地源码 | 无重叠 |
| 索引对象 | `docs/official_docs/` 下的文档 | `.ts/.js/.py` 等源码文件的 AST | 无重叠 |
| UC7KS 拦截 | `context7_*`, `webfetch`, `websearch` 被 uc7ks-before.ts 拦截 | `codegraph_*` 不在拦截列表中 | 无需改动 |

**结论**: CodeGraph 工具不受 UC7KS 管线约束，可直接使用。UC7KS 管"外部文档知识"，CodeGraph 管"内部代码知识"。

#### 2.2 与 Scout 层（UC7KS Layer 3）

Scout 层通过派遣子 Agent 克隆依赖仓库、逐文件阅读来分析源码内部实现。CodeGraph 的 `codegraph_impact` 和 `codegraph_callers/callees` 能以确定性静态分析覆盖大部分 Scout 场景。引入 CodeGraph 后 Scout 层可标记为 deprecated。

#### 2.3 与现有 MCP Server

CodeGraph 作为第 12 个 MCP Server 加入，与现有 11 个 Server 无冲突。所有 CodeGraph 工具均为只读，不会与 `safe_edit`/`safe_shell` 等写操作工具产生竞争。

---

### 三、分阶段实施方案

#### Phase 1: 基础引入（配置级，不改框架代码）

**3.1.1 安装 CodeGraph CLI**

```bash
# WSL Ubuntu-24.04
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | bash

# 验证安装
codegraph --version
```

**3.1.2 初始化项目索引**

```bash
cd /home/zhaoge/workspace/opencode/work-one
codegraph init

# 验证索引
codegraph status
```

索引数据存储在 `.codegraph/` 目录（SQLite），需加入 `.gitignore`：

```gitignore
# .gitignore 追加
.codegraph/
```

**3.1.3 注册 MCP Server**

在 `opencode.json` 的 `"mcp"` 块中添加：

```json
"codegraph": {
  "type": "local",
  "command": ["codegraph", "serve", "--mcp", "--path", "."],
  "timeout": 30000,
  "enabled": true
}
```

**3.1.4 权限矩阵更新（全 10 Agent 决策）**

在 `opencode.json` 各 Agent 的 `permission` 中按以下决策配置 CodeGraph 工具权限。

**允许访问（7 个 Agent）：**

| Agent | 理由 | 核心使用场景 |
|-------|------|-------------|
| Architect | 架构设计需要全局代码结构视图 | 评估模块依赖、设计变更方案、审查架构合规性 |
| Coder-BE | 后端编码需要理解调用链和影响范围 | 修改前 codegraph_impact、理解调用关系 codegraph_callers/callees |
| Coder-FE | 前端编码同上 | 同 Coder-BE，面向前端代码 |
| Guardian | 代码审查需要自动化影响分析 | codegraph_impact 检查变更影响范围、高扇入符号审查 |
| Meta-Planner | DAG 规划需要基于调用图谱评估任务依赖和复杂度 | codegraph_impact 分析变更影响半径、codegraph_files 了解模块结构，据此生成更准确的 Task.DAG.json |
| Super-Admin | 维护更新框架需要框架全景图 | 框架级变更前用 codegraph_impact 评估影响范围、用 codegraph_explore 理解跨模块依赖关系、Plugin/Lib 重构时确认关联影响 |
| Knowledge-Curator | 管理知识管线，Scout 层（Layer 3）退役后由 CodeGraph 承接依赖库源码分析 | 用 codegraph_explore/codegraph_node 理解依赖库源码内部实现，替代原来派遣子 Agent 克隆仓库逐文件阅读的高消耗方式 |

权限配置示例（7 个 Agent 均相同）：

```jsonc
{
  "agent": {
    "Architect": {
      "permission": {
        "codegraph_search": "allow",
        "codegraph_explore": "allow",
        "codegraph_callers": "allow",
        "codegraph_callees": "allow",
        "codegraph_impact": "allow",
        "codegraph_node": "allow",
        "codegraph_status": "allow",
        "codegraph_files": "allow"
      }
    },
    "Coder-BE": { /* 同上 8 个工具 */ },
    "Coder-FE": { /* 同上 8 个工具 */ },
    "Guardian": { /* 同上 8 个工具 */ },
    "Meta-Planner": { /* 同上 8 个工具 */ },
    "Super-Admin": { /* 同上 8 个工具 */ },
    "Knowledge-Curator": { /* 同上 8 个工具 */ }
  }
}
```

**拒绝访问（3 个 Agent）：**

| Agent | 角色定位 | 拒绝理由 |
|-------|---------|---------|
| Orchestrator | 路由分发角色 | 仅负责任务调度和 Agent 分派，不应做代码分析；给它 CodeGraph 会诱导它越权做代码决策 |
| Arbiter | 冲突仲裁 | 仲裁的是 Agent 之间的意见分歧，依据是策略和规则，不需要代码结构查询 |
| CI-CD-Agent | DevOps 操作 | 消费的是 CI/CD 管线（构建、测试、部署），不消费代码图谱 |

**3.1.5 Agent 定义文件更新**

在 `Architect.md`、`Coder-BE.md`、`Coder-FE.md`、`Guardian.md`、`Meta-Planner.md`、`Super-Admin.md`、`Knowledge-Curator.md` 的 `mcp_tools:` 列表中添加：

```yaml
mcp_tools:
  # ... 现有工具 ...
  - codegraph_search
  - codegraph_explore
  - codegraph_callers
  - codegraph_callees
  - codegraph_impact
  - codegraph_node
```

---

#### Phase 2: 协议适配（修改框架代码）

**3.2.1 在 uc7ks-before.ts 中添加 CodeGraph 豁免**

虽然 CodeGraph 工具当前不在 UC7KS 拦截列表中，但应显式声明豁免，防止未来规则变更误拦：

```typescript
// uc7ks-utils.ts — 在 CORE_EXTERNAL_TOOLS 后添加
const CODEGRAPH_TOOLS = new Set([
  "codegraph_search",
  "codegraph_explore",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_status",
  "codegraph_files",
]);

// 在 checkUC7KS 函数开头添加豁免
if (CODEGRAPH_TOOLS.has(toolName)) {
  return null; // CodeGraph 工具不受 UC7KS 管线约束
}
```

**3.2.2 更新 Agent prompt 添加 CodeGraph 使用指南**

在 `Coder-BE.md`、`Coder-FE.md` 的 prompt 中追加：

```markdown
## CodeGraph 使用指南

在探索代码结构时，优先使用 CodeGraph MCP 工具而非 glob/grep/read 组合：

- **理解代码入口**: `codegraph_explore("模块名或功能关键词")`
- **查找符号定义**: `codegraph_search("函数名", kind="function")`
- **理解调用关系**: `codegraph_callers("目标函数")` / `codegraph_callees("当前函数")`
- **修改前评估影响**: `codegraph_impact("要修改的符号")` — 必须在 safe_edit 之前调用
- **获取符号源码**: `codegraph_node("符号名", includeCode=true)`

注意: CodeGraph 查询的是本地代码结构知识，与 UC7KS 的外部文档知识互补。
需要外部库文档时仍走 UC7KS 流程，需要理解代码结构时用 CodeGraph。
```

**3.2.3 在 Guardian 审查流程中集成影响分析**

在 `Guardian.md` 的审查清单中追加：

```markdown
### 变更影响审查（CodeGraph 增强）
- [ ] 使用 `codegraph_impact` 检查已修改符号的影响范围
- [ ] 确认影响范围内的关联模块已被同步更新或显式排除
- [ ] 高扇入符号（被 10+ 调用者引用的函数）的修改需要额外审查理由
```

**3.2.4 Meta-Planner DAG 规划增强**

在 `Meta-Planner.md` 的 prompt 中追加：

```markdown
## CodeGraph 辅助 DAG 规划

在生成 Task.DAG.json 时，使用 CodeGraph 提升依赖分析和复杂度估算的准确度：

- **任务依赖分析**: 使用 `codegraph_impact` 分析变更涉及的模块范围，据此推断任务间的真实依赖关系，而非仅凭文件路径猜测
- **复杂度估算**: 使用 `codegraph_callers` 查看目标符号的扇入（调用者数量），扇入越高修改风险越大，任务应分配更多时间预算
- **模块边界识别**: 使用 `codegraph_files` 了解目录结构，识别模块边界，避免将跨模块的强耦合操作拆分到不同并行任务中
```

**3.2.5 Super-Admin 框架全景增强**

在 `Super-Admin.md` 的 prompt 中追加：

```markdown
## CodeGraph 框架全景

维护更新框架时，使用 CodeGraph 获取框架代码全景：

- **框架级影响分析**: 修改 Plugin/Lib/Hook 前，用 `codegraph_impact` 确认所有受影响的模块和 Agent
- **跨模块依赖理解**: 用 `codegraph_callers`/`codegraph_callees` 理解 lib 模块间的调用关系，避免破坏隐式依赖
- **重构安全网**: 重命名或移动模块前，用 `codegraph_search` 定位所有引用点，确保无遗漏
```

**3.2.6 Knowledge-Curator Scout 替代**

在 `Knowledge-Curator.md` 的 prompt 中追加：

```markdown
## CodeGraph 替代 Scout 层

原 Scout 层（UC7KS Layer 3）通过派遣子 Agent 克隆仓库、逐文件阅读来分析依赖库源码。现在由 CodeGraph 承接：

- **依赖库源码分析**: 对已索引的依赖项目，用 `codegraph_explore` 理解模块结构和入口点
- **符号级实现理解**: 用 `codegraph_node` 获取特定函数/类的源码实现，替代逐文件 grep + read
- **调用链追踪**: 用 `codegraph_callers`/`codegraph_callees` 理解依赖库内部的调用关系

注意: CodeGraph 需要目标项目已索引。如果依赖库尚未被 CodeGraph 索引，需先执行 `codegraph init`。
```

**3.2.7 Scout 层退役**

将 `.opencode/scripts/scout-trigger.ts` 和 `.opencode/scripts/scout-extractor.ts` 标记为 deprecated：

```typescript
// scout-trigger.ts 顶部添加
/**
 * @deprecated CodeGraph MCP 已替代 Scout 层的代码结构分析功能。
 * 保留此脚本仅用于历史兼容。新任务应使用 codegraph_impact / codegraph_callers。
 * 退役日期: 2026-06-27
 */
```

保留 `docs/official_docs/*/source-analysis/` 目录中已有的 Scout 产出作为历史知识。

---

#### Phase 3: 深度集成（可选，1-2 周）

**3.3.1 新建 codegraph-first Skill**

创建 `.opencode/skills/codegraph-first/SKILL.md`：

```yaml
---
name: "codegraph-first"
description: "在修改代码前强制使用 CodeGraph 进行影响分析。适用于所有涉及代码修改的任务——编码、调试、重构、架构变更。触发关键词：修改、编辑、重构、修复、实现、添加函数。"
---
```

```markdown
# codegraph-first Skill

## 触发条件
任何涉及代码文件修改的任务。

## 执行流程

### 1. 修改前：影响分析（必须）
在调用 safe_edit 之前：
1. 使用 `codegraph_search` 定位目标符号
2. 使用 `codegraph_impact` 评估修改影响范围
3. 如果影响范围超过 3 个文件，向用户确认后再继续

### 2. 修改中：上下文获取
需要理解调用关系时：
1. 使用 `codegraph_callers` 查看谁调用了目标函数
2. 使用 `codegraph_callees` 查看目标函数调用了什么
3. 使用 `codegraph_node` 获取相关符号的源码

### 3. 修改后：验证
修改完成后：
1. 再次使用 `codegraph_impact` 确认影响范围未超出预期
2. 检查是否有遗漏的关联更新

## 与 UC7KS 的关系
- 需要外部库文档 → 走 UC7KS 流程
- 需要理解代码结构 → 用 CodeGraph
- 两者互补，不冲突
```

**3.3.2 Pre-commit hook 增强**

在 `hook-layers.ts` 中添加轻量级高影响符号检测：

```typescript
// 当 staged files 包含高扇入符号的修改时，
// 要求 commit message 包含 [HIGH-IMPACT] 标记
// 通过 codegraph_status 获取索引数据，
// 检查 staged 文件中的符号是否被 10+ 调用者引用
```

**3.3.3 db-health plugin 扩展**

在 `db-health.ts` plugin 中监控 CodeGraph 索引健康：

```typescript
// 在 session.idle hook 中添加
// 定期调用 codegraph_status 检查索引状态
// 如果索引过期（最后索引时间 > 1 小时前），记录告警
```

---

### 四、实施检查清单

#### Phase 1 检查清单（基础引入）

- [ ] 安装 CodeGraph CLI (`codegraph --version` 验证)
- [ ] 初始化项目索引 (`codegraph init` + `codegraph status` 验证)
- [ ] `.codegraph/` 加入 `.gitignore`
- [ ] `opencode.json` 添加 codegraph MCP Server 配置
- [ ] `opencode.json` 为 7 个 Agent 添加 CodeGraph 权限（Architect, Coder-BE, Coder-FE, Guardian, Meta-Planner, Super-Admin, Knowledge-Curator — 共 56 条 permission 规则）
- [ ] 确认其余 3 个 Agent（Orchestrator, Arbiter, CI-CD-Agent）未配置 CodeGraph 权限
- [ ] 7 个 Agent `.md` 文件添加 `mcp_tools:` 列表项
- [ ] 验证: 启动 OpenCode，在 Coder-BE 中执行 `codegraph_search("resolveAgent")` 确认工具可用

#### Phase 2 检查清单（协议适配）

- [ ] `uc7ks-utils.ts` 添加 CODEGRAPH_TOOLS 豁免集合
- [ ] 7 个 Agent `.md` 文件追加 CodeGraph 使用指南段落（含 Super-Admin 框架全景、Knowledge-Curator Scout 替代）
- [ ] Guardian `.md` 追加变更影响审查清单
- [ ] Meta-Planner `.md` 追加 CodeGraph 辅助 DAG 规划指南
- [ ] Scout 脚本标记 `@deprecated`
- [ ] 验证: uc7ks-before.ts 日志中确认 codegraph_* 工具不被拦截

#### Phase 3 检查清单（深度集成）

- [ ] 创建 `codegraph-first` Skill
- [ ] `hook-layers.ts` 添加高影响符号检测
- [ ] `db-health.ts` 扩展 CodeGraph 索引健康监控
- [ ] 验证: 修改一个高扇入函数，确认 Skill 触发影响分析流程

---

### 五、预期收益量化

基于 CodeGraph 官方基准和框架特征估算：

| 指标 | 当前 | 引入后 | 改善 |
|------|------|--------|------|
| Coder-BE/FE 代码探索 token | 高（反复 glob/grep/read） | 低（一次 codegraph_explore） | -50%~70% |
| 代码探索工具调用次数 | 5~15 次/任务 | 1~3 次/任务 | -70%~80% |
| Guardian 影响分析 | 人工判断 | 自动化 codegraph_impact | 新增能力 |
| Meta-Planner DAG 规划 | 基于文件列表估依赖（粗粒度） | codegraph_impact 分析调用图谱依赖 + codegraph_callers 评估扇入复杂度 | 依赖准确度显著提升，复杂度估算有据可依 |
| Scout 层 token 消耗 | 极高（克隆+逐文件阅读） | 零（CodeGraph 替代） | -100% |

---

### 六、风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| CodeGraph 索引过期 | 低 | 内置文件监听自动重索引；db-health plugin 监控索引状态 |
| `.codegraph/` 目录占用磁盘 | 低 | 加入 .gitignore；定期清理（db-health plugin 可扩展覆盖） |
| Agent 过度依赖 CodeGraph 忽略文档 | 低 | UC7KS 仍强制外部文档查询；codegraph-first Skill 明确边界 |
| CodeGraph CLI 版本升级不兼容 | 低 | 锁定版本；opencode.json 中 command 使用完整路径 |
| 大型项目索引时间长 | 中 | codegraph init 首次索引可能较慢；后续增量索引很快 |
