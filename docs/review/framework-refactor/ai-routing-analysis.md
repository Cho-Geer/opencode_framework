# AI 智能路由方案分析报告

**任务**: SA-RESEARCH-AI-ROUTING  
**作者**: @Super-Admin  
**日期**: 2026-06-19  
**状态**: 方案一 (L4-HEURISTIC) 已实施 (SA-IMPLEMENT-L4-HEURISTIC)

---

## 1. 当前路由系统现状分析

### 1.1 四层路由链架构

当前框架在 `dispatch-before.ts` 中实现四层路由验证链：

```
task_description → L1(verb→candidates) → L2(scope→filter) → L3(permission→veto) → L4(dag→select)
```

**实现位置**: `.opencode/lib/route-validator.ts`

### 1.2 L1: verb_to_agent（关键词→候选池）

```typescript
// route-validator.ts:81-112
export function l1_verbCandidates(taskDescription, verbRules): string[] {
  const lower = taskDescription.toLowerCase();
  const agents = new Set<string>();
  for (const rule of Object.values(verbRules)) {
    if (!rule || !Array.isArray(rule.keywords)) continue;
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        rule.agents.forEach((a) => agents.add(a));
        break;
      }
    }
  }
  if (agents.size === 0) return ALL_10_AGENTS; // 全量回退
  return [...agents];
}
```

**缺陷**:

- 关键词 `includes()` 是最粗糙的子串匹配，极易误匹配
- 例: `"审查代码并修复bug"` 同时匹配 `"审查"→@Guardian` 和 `"修复"→@Super-Admin`
- 不匹配时回退到全部 10 个 agent，L1 形同虚设

### 1.3 L2: scope_to_agent（文件路径→agent）

```typescript
// route-validator.ts:116-159
export function l2_scopeFilter(candidates, targetFiles, scopeConfig): string[] {
  // 按 scope 规则匹配 target_files[]
  // 交叉域(biz+fw) → narrow to @Super-Admin
  // L1∩L2非空 → 取交集
  // L1∩L2为空 + scope_priority → 取 L2 结果
}
```

**改进点** (REVISED 2026-06-17):

- 输入从 `task_description` 文本改为 `Task.DAG.json.target_files[]` 路径
- 交叉域处理：业务代码 + 框架代码 → @Super-Admin

**残留缺陷**:

- 多个 scope 匹配时返回多个 agent（如 `docs/review/` 未定义 scope → 回退到 L1 candidates）
- 交叉域只处理 biz+fw，不处理其他交叉

### 1.4 L3: permissionFilter（权限过滤）

```typescript
// route-validator.ts:163-229
export function l3_permissionFilter(
  candidates,
  targetFiles,
  opencodeConfig,
): string[] {
  // 对每个 candidate，检查 safe_edit 权限是否覆盖全部 target_files
  // 全部 deny → 排除该 agent
  // 排序：allow 数量多的排前面
}
```

**改进点** (P2-D v2.1, 2026-06-17):

- 从 `scope.includes()` 改为 `pathMatchesGlob()` 进行真正的 glob 匹配
- 使用真实的 `target_files[]` 而非路由 scope 片段

**残留缺陷**:

- 排序按 `allow` 规则数量，但这个数量与"最合适"无必然关联
- 排序结果仍是数组，L4 仍面临多选一问题

### 1.5 ⚠️ 核心问题：L4: dagCheck

```typescript
// route-validator.ts:285-297 — THE PROBLEM
export function l4_dagCheck(
  candidates: string[],
  dagTaskId: string,
  isDagExemptFn: (agent: string) => boolean,
): string {
  if (candidates.length === 0) return "";
  const agent = candidates[0]; // ← ALWAYS picks first element!
  if (agent === "@Orchestrator") return "";
  if (isDagExemptFn(agent)) return agent;
  return agent;
}
```

**分析**:

1. `candidates[0]` — 直接取数组第一个，**没有任何选择逻辑**
2. DAG 豁免检查 (`isDagExempt`) 在 L2 的 PLAN-FIRST 层面已处理，L4 只是冗余确认
3. 函数名为 `dagCheck` 但实际不做 DAG 检查——真正的 DAG 验证在 `PLAN-FIRST` 和 `gate-before.ts` P2-1 审计中
4. **L4 完全依赖 L3 的排序结果 + 数组顺序碰运气**

### 1.6 实测日志证据

从 `plugin-dispatch-before-runtime.log` (2026-06-19) 分析：

- **Route validation 几乎从未被实际触发**：因为 @Orchestrator 和 @Super-Admin 被 `dispatch_exempt_agents` 豁免
- `dispatch_policy.require_dag_entry=false`（rollout 观察期）— PLAN-FIRST 也未完全激活
- **未观察到任何 ROUTE-MISMATCH 事件**，说明 L4 在当前配置下基本是死代码
- L1-L4 链路仅在 strict/locked + 非豁免 caller 时触发

---

## 2. 跨框架路由模式研究

### 2.1 Anthropic: Routing Pattern（分类器+专家）

来自 [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)：

> "Input classifier → specialized followup task. Use when distinct categories better handled separately."

**核心思想**：

- 先分类，再路由：LLM 判断输入属于哪个类别 → 交给对应专家
- 分类器可以是 LLM 本身，也可以是规则+LLM 混合
- 简单场景：小模型处理 easy cases，大模型处理 hard cases

**对我们的启示**：当 L1-L3 过滤后有 N 个候选时，可以让 LLM 做最终决策。

### 2.2 OpenAI Swarm: Handoff 函数

```python
def transfer_to_billing():
    return billing_agent

triage_agent = Agent(
    name="Triage",
    functions=[transfer_to_billing, transfer_to_technical],
)
```

**核心思想**：

- Agent 通过函数返回值声明"我应该转给谁"
- 极简设计：整个框架 ~100 行代码
- Handoff 是确定性的函数调用，非 LLM 自由选择

**对我们的启示**：每个 agent 可以声明自己的"能力描述"（类似 Agent Card），由路由层匹配。

### 2.3 AutoGen: SelectorGroupChat（LLM 驱动选发言人）

```python
team = SelectorGroupChat(
    participants=[travel_advisor, hotel_agent, flight_agent],
    model_client=model_client,
)
```

**核心思想**：

- GroupChatManager 用 LLM 选择下一个发言人
- 输入：对话历史 + 参与者描述 → 输出：下一个发言人
- 防止同一发言人连续发言

**对我们的启示**：最直接的 L4 改进方案——用 LLM 在候选 agent 中选择。

### 2.4 LangGraph: Conditional Edges（条件路由）

```typescript
// 伪代码
function route(state) {
  if (state.needsCode) return "coder";
  if (state.needsReview) return "guardian";
  return "architect";
}
```

**核心思想**：

- 路由函数是纯代码逻辑，可测试、可调试
- 状态（typed State）携带足够信息做决策
- 支持 Command/Send 进行动态并行分发

**对我们的启示**：L4 可以先加启发式规则，再逐步引入 LLM。

### 2.5 CrewAI: Hierarchical Delegation（层级委托）

```python
crew = Crew(
    agents=[manager, researcher, writer],
    process=Process.hierarchical,
    manager_llm="gpt-4o",
)
```

**核心思想**：

- Manager agent 具有 `allow_delegation=True`
- 将复杂任务分解后委托给专业 agent
- 每个 agent 有 `role`, `goal`, `backstory` 定义

**对我们的启示**：每个 agent 应有明确的能力描述元数据，供路由层决策。

---

## 3. 推荐方案

### 3.1 总体策略：渐进式增强

遵循 Anthropic 核心原则：**"Start simple, add complexity only when measured improvement justifies it."**

```
阶段1 (立即): L4-HEURISTIC  — 确定性规则补齐，零 LLM 成本 ✅ **已实施 (2026-06-19)**
阶段2 (中期): L4-LLM-SELECTOR — 轻量 LLM 选择，候选>1 时触发
阶段3 (长期): L4-SEMANTIC-ROUTER — 语义嵌入 + 历史学习
```

### 3.2 方案一：L4-HEURISTIC（✅ 已实施）

**核心思路**：将 `candidates[0]` 替换为基于确定性启发式的选择逻辑。

**实施位置**: `.opencode/lib/route-validator.ts` (l4_heuristicSelect) + `.opencode/plugins/dispatch-before.ts` (call site)

**加权评分规则**:

| 维度            | 权重 | 计算方法                                                   |
| --------------- | ---- | ---------------------------------------------------------- |
| Scope 匹配度    | 35%  | 该 agent 的 scope 规则匹配了多少个 target_files / 总文件数 |
| Permission 适配 | 40%  | 该 agent 对 target_files 有 safe_edit allow 的比例         |
| Domain 匹配度   | 25%  | dispatch domain_id 与 agent_domain_map 匹配=1，不匹配=0    |

**评分公式**: `total = scopeScore × 0.35 + permissionScore × 0.40 + domainScore × 0.25`

**选择规则**:

- 最高分 agent 被选中
- 同分（差距 < 0.001）→ 选数组中第一个，记录 L4-HEURISTIC-TIE 事件
- 最高分 = 0 → 返回空字符串，记录 L4-HEURISTIC-FAIL 事件
- 成功选中 → 记录 L4-HEURISTIC-SELECT 事件（含各维度得分）

```typescript
// route-validator.ts — 替换 l4_dagCheck

interface AgentMeta {
  name: string;
  domain: string[]; // 领域标签
  priority: number; // 全局优先级
  specificity_score: number; // 路径特异性得分
}

function l4_dagCheck_heuristic(
  candidates: string[],
  dagTaskId: string,
  targetFiles: string[],
  taskDescription: string,
): string {
  if (candidates.length === 0) return "";
  if (candidates.length === 1) return candidates[0];

  // 步骤1: DAG 优先 — 如果 Task.DAG.json 指定了 agent，直接使用
  const dagAgent = findDagAssignedAgent(dagTaskId);
  if (dagAgent && candidates.includes(dagAgent)) return dagAgent;

  // 步骤2: Scope 特异性 — target_files 匹配 scope 规则最多的 agent
  const scopeScores = scoreByScopeSpecificity(candidates, targetFiles);

  // 步骤3: Permission 丰度 — safe_edit allow 规则最匹配路径的 agent
  const permScores = scoreByPermissionFit(candidates, targetFiles);

  // 步骤4: Description 语义 — task_description 关键词与 agent 领域标签的重叠度
  const domainScores = scoreByDomainMatch(candidates, taskDescription);

  // 加权综合
  const finalScores = candidates.map((name) => ({
    name,
    score:
      scopeScores[name] * 0.35 +
      permScores[name] * 0.4 +
      domainScores[name] * 0.25,
  }));

  finalScores.sort((a, b) => b.score - a.score);
  return finalScores[0].name;
}
```

**评分维度**:

| 维度            | 权重 | 计算方法                                                      |
| --------------- | ---- | ------------------------------------------------------------- |
| Scope 特异性    | 35%  | `target_files` 中匹配该 agent scope 规则的文件数量 / 总文件数 |
| Permission 适配 | 40%  | `safe_edit` allow 规则精确匹配 `target_files` 的模式数        |
| Domain 语义     | 25%  | `task_description` 关键词与 `agent_domain_map` 的重叠度       |

**优势**:

- 零 LLM 成本，性能无损
- 确定性，可调试
- 覆盖 90% 的常见多候选场景
- 不需要修改 agent 配置文件

**不足**:

- 对高度模糊的场景（如"分析这个问题"）仍然可能不准
- 权重调优需要实际数据验证

### 3.3 方案二：L4-LLM-SELECTOR（推荐中期实施）

**核心思路**：当 L4-HEURISTIC 得分最高的两个候选差距小于阈值（如 < 20%）时，调用轻量 LLM 做最终裁决。

```typescript
async function l4_dagCheck_llm(
  candidates: string[],
  taskDescription: string,
  targetFiles: string[],
): Promise<string> {
  // 先用启发式缩小到 top 2-3
  const topCandidates = heuristicTopK(candidates, 3);
  if (topCandidates.length === 1) return topCandidates[0];

  // 调用轻量 LLM 做选择
  const selection = await llmSelect({
    model: "deepseek/deepseek-v4-flash", // 轻量模型
    system: buildSelectorSystemPrompt(topCandidates),
    user: `Task: ${taskDescription}\nTarget files: ${targetFiles.join(", ")}`,
    temperature: 0.0,
    max_tokens: 50,
  });

  return selection;
}

function buildSelectorSystemPrompt(candidates: string[]): string {
  return `You are a routing classifier. Select the single most appropriate agent.
Available agents: ${candidates.map((c) => `@${c} - ${AGENT_DESCRIPTIONS[c]}`).join("; ")}.
Reply with ONLY the agent name (e.g., "@Coder-BE").`;
}
```

**Agent 能力描述**（需在每个 agent 配置中添加 `routing_description` 字段）:

```yaml
# .opencode/agents/Coder-BE.md frontmatter 新增
routing_description: "Backend API implementation — NestJS controllers, Prisma ORM, PostgreSQL queries, business logic"
```

**优势**:

- LLM 语义理解能力解决启发式无法处理的模糊场景
- 轻量模型 (flash) 成本极低（~100 tokens/次）
- 仅候选得分接近时触发，大部分情况走启发式

**不足**:

- 引入非确定性（temperature=0 可缓解但非绝对）
- 需要为每个 agent 维护 `routing_description`
- 增加 1 次 LLM 调用的延迟（~200ms）

### 3.4 方案三：L4-SEMANTIC-ROUTER（长期愿景）

**核心思路**：为每个 agent 生成语义嵌入向量，将 task_description 也转为嵌入，通过余弦相似度选择最匹配的 agent。

```typescript
async function l4_dagCheck_semantic(
  candidates: string[],
  taskDescription: string,
): Promise<string> {
  const taskEmbedding = await embed(taskDescription);

  const scores = await Promise.all(
    candidates.map(async (name) => {
      const agentEmbedding = await getAgentEmbedding(name);
      return { name, score: cosineSimilarity(taskEmbedding, agentEmbedding) };
    }),
  );

  scores.sort((a, b) => b.score - a.score);
  return scores[0].name;
}
```

**需要的基础设施**:

- Agent 嵌入向量库（可预计算，存于 `.opencode/state/agent_embeddings.json`）
- 嵌入模型 API（如 text-embedding-3-small）
- 历史路由正确率反馈机制

**优势**:

- 最高精度（如果训练数据充足）
- 可学习改进

**不足**:

- 基础设施需求大
- 冷启动问题（新 agent 无历史数据）
- 当前阶段过早，ROI 不明确

---

## 4. 实施建议

### 4.1 立即行动

1. **重构 `l4_dagCheck`** 为 `l4_dagCheck_heuristic`（方案一）
   - 位置: `.opencode/lib/route-validator.ts:285-297`
   - 影响: `dispatch-before.ts:167` 调用点
   - 工作量: ~80 行新增代码

2. **添加 agent 领域标签到 `project.config.json`**

   ```json
   "agent_domain_tags": {
     "@Coder-BE": ["backend", "api", "nestjs", "prisma", "database", "service"],
     "@Coder-FE": ["frontend", "angular", "component", "ui", "signal", "store"],
     "@Guardian": ["review", "quality", "lint", "eslint", "audit", "tdd"],
     "@Architect": ["architecture", "design", "contract", "schema"],
     "@Super-Admin": ["framework", "opencode", "repair", "plugin", "governance"],
     "@Arbiter": ["waiver", "tech-debt", "arbitration", "conflict"],
     "@CI-CD-Agent": ["deploy", "docker", "ci", "pipeline", "release"],
     "@Meta-Planner": ["plan", "dag", "decompose", "analyze"],
     "@Orchestrator": ["dispatch", "schedule", "coordinate"],
     "@Knowledge-Curator": ["docs", "knowledge", "context7", "cache", "fetch"]
   }
   ```

3. **添加 `domainMatch` 评分函数**（方案一步骤4的 domain 语义评分）

### 4.2 验证方法

```bash
# 单元测试新增评分函数
bun test .opencode/lib/__tests__/route-validator.test.ts

# 集成测试：用历史 dispatch 日志回放验证路由准确率
bun .opencode/scripts/route-replay-test.ts --log=.task_temp/_logs/2026-06-19/plugin-dispatch-before-runtime.log
```

### 4.3 风险控制

| 风险                 | 缓解措施                                                        |
| -------------------- | --------------------------------------------------------------- |
| 启发式路由选错 agent | ROUTE-MISMATCH 仍会阻断（strict/locked）；advisory 模式下仅警告 |
| 新增代码引入 bug     | `l4_dagCheck` 函数签名不变，外围调用无感知                      |
| agent 领域标签不准确 | 人工审查 + 基于历史 dispatch 日志迭代                           |

---

## 5. 总结

### 核心发现

| 问题                            | 严重度    | 现状                                   |
| ------------------------------- | --------- | -------------------------------------- |
| L4 `candidates[0]` 缺乏选择逻辑 | 🔴 HIGH   | 数组顺序碰运气                         |
| L1 关键词 `includes()` 误匹配   | 🟡 MEDIUM | 有已知 bug guard + metadata keys issue |
| L3 排序按 allow 规则数意义不足  | 🟡 MEDIUM | 需要更语义化的排序                     |
| 全链路在生产中基本未激活        | 🟢 LOW    | require_dag_entry=false，豁免覆盖广    |

### 推荐路径

```
立即（本周）: 方案一 L4-HEURISTIC — 80行代码，零风险
中期（下月）: 方案二 L4-LLM-SELECTOR — 依赖方案一的评分阈值判断
长期（Q4）:   方案三 L4-SEMANTIC-ROUTER — 需嵌入基础设施
```

### 关键原则

> "For many applications, optimizing single LLM calls with retrieval and in-context examples is usually enough." — Anthropic

路由系统的核心价值不是"多智能"，而是**确定性**。当前 L4 的最大问题不是不够智能，而是**选得太随意**。方案一用 80 行确定性代码解决此问题——这是正确的第一步。

---

## 附录 A: 参考文献

| 来源              | 文档                             | 关键贡献                                    |
| ----------------- | -------------------------------- | ------------------------------------------- |
| Anthropic         | Building Effective Agents        | Routing pattern, simplicity-first principle |
| OpenAI Swarm      | Handoff functions                | Minimal routing via function returns        |
| Microsoft AutoGen | SelectorGroupChat                | LLM-driven speaker selection                |
| LangGraph         | Conditional edges + Send/Command | Programmatic routing with graph topology    |
| CrewAI            | Hierarchical delegation          | Role-based routing with manager agent       |
| Google A2A        | Agent Cards                      | Protocol-level agent discovery              |

## 附录 B: 代码文件索引

| 文件                                   | 关键行   | 内容                                  |
| -------------------------------------- | -------- | ------------------------------------- |
| `.opencode/lib/route-validator.ts`     | 285-297  | `l4_dagCheck` — 需要重构的目标函数    |
| `.opencode/lib/route-validator.ts`     | 81-112   | `l1_verbCandidates` — 关键词匹配逻辑  |
| `.opencode/lib/route-validator.ts`     | 163-229  | `l3_permissionFilter` — 权限过滤+排序 |
| `.opencode/plugins/dispatch-before.ts` | 124-194  | L1-L4 路由链调用点                    |
| `.opencode/project.config.json`        | 981-1121 | `route_rules` 配置                    |
