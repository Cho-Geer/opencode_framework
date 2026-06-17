# Agent 派遣路由校验实施方案

**日期**: 2026-06-17
**作者**: @Super-Admin
**状态**: Proposal — 审核修订版 (含 CRITICAL/HIGH 缺陷修复 + console 违规治理)
**依赖**: project.config.json 新增 `route_rules` 块、dispatch-before.ts 扩展、gate-before.ts 扩展、route-validator.ts 新建、scope-before.ts 迁移、dispatch-subagent.ts console→writeLog、pre-execution-gate.ts gateLog 补全

---

## 一、背景与目标

### 问题

Orchestrator 持续将 `.opencode/` 框架基础设施任务错误派遣给 @Architect（应派 @Super-Admin）。根因是：路由决策受单一维度（动词"分析"→@Architect）主导，没有经过完整的四层筛选。

现有的 `scope-before.ts`（ROUTE-MISMATCH）在**写入时**拦截越权操作——但此时已经被错误 Agent 消耗了 token 和 context。

### 目标

在 dispatch 链路中实现**四层链式路由筛选**，在派遣前就选定正确 Agent：

| 层序 | 作用 | 输入 | 输出 |
|:----:|------|------|------|
| **L1 动词** | 构建候选池 | task_description 中的动词关键词 | 候选 Agent 列表 |
| **L2 作用域** | 过滤候选池 | **dag_task_id → Task.DAG.json → target_files[]** 精确路径 | 候选 Agent 列表（缩减后） |
| **L3 权限** | 否决权 | Agent 的 safe_edit deny 列表 vs 目标路径（从 **opencode.json.agent** 读取） | 合法 Agent 列表 |
| **L4 DAG** | 存在性校验 | 合法 Agent 的 DAG-exempt 状态 | 最终 Agent |

> **⚠️ 修订说明**：原方案 L2 基于 `task_description.includes(scope)` 子串匹配，实际不可靠。修订版改为从 `Task.DAG.json` 的 `target_files[]` 精确匹配。L3 原方案 opencode.json 路径三条全部失效，修订版修正为 `opencodeConfig.agent[agentName].permission.safe_edit`。

### 四层路由决策流程

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: 动词 (Verb) → L1_CANDIDATES                        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 分析/设计/拆解     → [Meta-Planner, Architect]          │ │
│ │ 编码/实现/修改     → [Coder-BE, Coder-FE]               │ │
│ │ 审查/合规验证      → [Guardian]                         │ │
│ │ 诊断/调查/根因     → [Architect, Super-Admin]           │ │
│ │ 修复/修改框架      → [Super-Admin]                      │ │
│ │ 裁决/豁免          → [Arbiter]                          │ │
│ │ 部署/提交/CI/CD    → [CI-CD-Agent]                      │ │
│ │ 获取知识/查文档    → [Knowledge-Curator]                │ │
│ │ 调度/状态追踪      → [Orchestrator]                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│ Layer 2: 作用域 (Scope) → L2_CANDIDATES = L1 ∩ SCOPE       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 数据源: Task.DAG.json tasks[].target_files[] 精确路径     │ │
│ │ .opencode/**/opencode.json/AGENTS.md  → [Super-Admin]   │ │
│ │ contract.yaml/docs/.opencode/context → [Architect]      │ │
│ │ booking-backend/src/test              → [Coder-BE]      │ │
│ │ booking-frontend                      → [Coder-FE]      │ │
│ │ .github/Dockerfile                    → [CI-CD-Agent]   │ │
│ │ .task_temp (验证产物)                 → [Guardian]      │ │
│ │ 无 target_files (纯分析/调查)         → L1候选池全保留   │ │
│ │ 跨域/混合                              → [Super-Admin]  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│ Layer 3: 权限 (Permission) → L3_CANDIDATES = L2 ∩ ALLOW    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 数据源: opencode.json.agent[agent].permission.safe_edit  │ │
│ │ 检查 deny 列表 vs 目标路径                                │ │
│ │ 全部 deny → 报错；单 allow → 选中；多 allow → 最窄优先   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│ Layer 4: DAG → FINAL_AGENT = L3 ∩ DAG_READY                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ DAG-exempt? → 直接调度                                   │ │
│ │ DAG 条目 pending? → 调度                                 │ │
│ │ 无 DAG 条目 → 先派 @Meta-Planner 规划                    │ │
│ │ 选中=Orchestrator → 直接执行，不派遣                      │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**验证示例**（修订版）：

```
任务: "分析 dispatch_subagent() 能否整合到 Task()"
  DAG条目: dag_task_id = "ANALYZE-DISPATCH-001"
    target_files: [".opencode/scripts/command-tools/dispatch-subagent.ts"]
  L1 动词: "分析" → [Meta-Planner, Architect]
  L2 作用域: target_files[0] → ".opencode/scripts/command-tools/dispatch-subagent.ts"
      → 匹配 scope ".opencode/" → [Super-Admin]
      → L1 ∩ SCOPE = [] (L1候选池无 Super-Admin)
      → 跨域检测: L1有 fwAgent(Super-Admin未在L1)? 不触发
      → 空交集 → L2返回 [Super-Admin] (scope 独占优先)
  L3 权限: opencodeConfig.agent.Super-Admin.permission.safe_edit[".opencode/**"] = "allow" ✅
  L4 DAG: Super-Admin is DAG-exempt → 直接调度 ✅
  → 最终: @Super-Admin ✅ 正确
```

> **修订版 L2 规则变更**：当 L1 候选池与 scope 匹配结果无交集时，scope 匹配的 agent **独占优先**（而非原方案的保留 L1 全部候选池）。因为 scope 匹配基于 DAG 精确路径，比 L1 动词更可靠。

---

## 二、可行性分析（修订版）

### 2.1 四层实现的可行性

| 层序 | 实现方式 | 复杂度 | 风险 | 修订说明 |
|:----:|------|:---:|:---:|------|
| **L1** | `project.config.json` `verb_to_agent` 关键字映射表 | 低 | 🟡 中 — 中文关键词子串匹配可能过宽/过窄 | 新增：动词+路径联合权重，降低子串误匹配 |
| **L2** | `Task.DAG.json` `target_files[]` 精确路径 → `scope_to_agent.rules` | 低 | 🟢 低 | **修订**：从 task_description 文本匹配改为 DAG 精确路径匹配 |
| **L3** | `opencode.json` `agent.{Agent}.permission.safe_edit` glob 映射 | 中 | 🟢 低 | **修订**：修正 opencode.json 访问路径为 `.agent[agentName].permission.safe_edit` |
| **L4** | 复用 `dag-policy.ts` `isDagExempt()` + PLAN-FIRST Layer 1-2 | 低 | 🟢 低 | **修订**：明确 L4 为选择步骤而非过滤步骤；实际 DAG 验证由现有 PLAN-FIRST 执行 |

### 2.2 现有基础（不变）

| 组件 | 已有拦截点 | 追加校验的侵入性 |
|------|-----------|:--:|
| `dispatch-before.ts:34` | 已拦截 `dispatch_subagent` 调用 | **零侵入**——在现有 PLAN-FIRST 块前追加 |
| `gate-before.ts` | 已 audit `Task.DAG.json` 修改 | **低侵入**——追加 DAG agent assignment 校验 |
| `scope-before.ts:65` | 已有 ROUTE-MISMATCH 写入时检查 | **修改**——迁移 P0-3/P0-4 到 route-validator.ts |

### 2.3 可行性结论

**可行（修订版）。** 改动：
- `project.config.json`：新增 ~60 行配置（verb 映射 + scope 映射）
- `dispatch-before.ts`：追加 ~80 行（四层路由校验，在现有 PLAN-FIRST 检查块之前）
- `gate-before.ts`：追加 ~40 行（DAG task agent ←→ target_files 校验）
- `lib/route-validator.ts`：~150 行（四层路由逻辑 + 共享校验函数 + scope-before 迁移逻辑）
- `scope-before.ts`：修改 P0-3/P0-4 块调用 route-validator.ts（迁移而非叠加）
- `scripts/command-tools/dispatch-subagent.ts`：console.error → writeLog
- `scripts/pre-execution-gate.ts`：gateLog 覆盖补全

总计约 350 行新代码 + 2 console 违规治理，3 处修改 + 1 新文件 + 2 违规修复。

---

## 三、详细设计（修订版）

### 3.1 `project.config.json` 路由配置

```json
{
  "route_rules": {
    "$description": "Agent dispatch route validation table — four-layer chain: Verb → Scope → Permission → DAG",
    "enforcement": { "dispatch": "block", "dag_write": "block" },
    "dispatch_exempt_agents": ["@Orchestrator", "@Meta-Planner", "@Super-Admin"],
    "$description_exempt": "These agents' dispatches are NOT subject to route validation — they have professional judgment authority per AGENTS.md P0",

    "verb_to_agent": {
      "$description": "Layer 1: Chinese/English keywords in task_description → candidate agent pool",
      "分析_设计_拆解": {
        "keywords": ["分析", "设计", "拆解", "规划", "contract", "architecture", "requirement"],
        "agents": ["@Meta-Planner", "@Architect"]
      },
      "编码_实现_修改": {
        "keywords": ["编码", "实现", "修改", "编写", "开发", "implement", "code", "build"],
        "agents": ["@Coder-BE", "@Coder-FE"]
      },
      "审查_合规_验证": {
        "keywords": ["审查", "合规", "验证", "review", "audit", "lint", "check", "质量"],
        "agents": ["@Guardian"]
      },
      "诊断_调查_根因": {
        "keywords": ["诊断", "调查", "根因", "排查", "investigate", "diagnose", "root-cause", "原因"],
        "agents": ["@Architect", "@Super-Admin"]
      },
      "修复_修改框架": {
        "keywords": ["修复", "fix", "repair", "恢复", "补丁", "patch"],
        "agents": ["@Super-Admin"]
      },
      "裁决_豁免": {
        "keywords": ["裁决", "豁免", "waiver", "waive", "arbitration", "技术债", "tech-debt"],
        "agents": ["@Arbiter"]
      },
      "部署_提交_CI_CD": {
        "keywords": ["部署", "commit", "CI", "CD", "pipeline", "deploy", "docker", "镜像"],
        "agents": ["@CI-CD-Agent"]
      },
      "获取知识_查文档": {
        "keywords": ["知识", "context7", "knowledge", "fetch", "acquire"],
        "agents": ["@Knowledge-Curator"]
      },
      "调度_状态追踪": {
        "keywords": ["调度", "dispatch", "schedule", "状态"],
        "agents": ["@Orchestrator"]
      }
    },

    "scope_to_agent": {
      "$description": "Layer 2: target file path patterns → agent mapping (filters L1 candidates)",
      "$description_revision": "REVISED: scope matching now uses Task.DAG.json target_files[] as input, not task_description text",
      "rules": [
        { "scope": ".opencode/",  "agent": "@Super-Admin",  "priority": 1, "desc": "Agent configs, rules, plugins, scripts, state" },
        { "scope": "opencode.json","agent": "@Super-Admin",  "priority": 1, "desc": "Runtime configuration" },
        { "scope": "AGENTS.md",   "agent": "@Super-Admin",  "priority": 1, "desc": "Agent collaboration spec" },
        { "scope": "booking-backend/src/",  "agent": "@Coder-BE",  "priority": 1, "desc": "Backend business code" },
        { "scope": "booking-backend/test/", "agent": "@Coder-BE",  "priority": 1, "desc": "Backend test code" },
        { "scope": "booking-frontend/",     "agent": "@Coder-FE",  "priority": 1, "desc": "Frontend business code" },
        { "scope": "contract.yaml",         "agent": "@Architect", "priority": 1, "desc": "Interface contract" },
        { "scope": "/docs/",                "agent": "@Architect", "priority": 2, "desc": "Architecture and design docs" },
        { "scope": ".opencode/context/",    "agent": "@Architect", "priority": 1, "desc": "Context code standards" },
        { "scope": ".github/",              "agent": "@CI-CD-Agent","priority": 1, "desc": "CI/CD pipeline" },
        { "scope": "Dockerfile",            "agent": "@CI-CD-Agent","priority": 1, "desc": "Container config" },
        { "scope": "Task.DAG.json",         "agent": "@Meta-Planner","priority": 1, "desc": "DAG file" },
        { "scope": "WAIVE.md",              "agent": "@Arbiter",   "priority": 1, "desc": "Waiver records" },
        { "scope": "TECH_DEBT_REGISTRY.md", "agent": "@Arbiter",   "priority": 1, "desc": "Tech debt registry" },
        { "scope": ".task_temp/",           "agent": "@Guardian",  "priority": 3, "desc": "Verification artifacts" }
      ],

      "cross_domain": {
        "agent": "@Super-Admin",
        "$description": "When scope matches both business-code and framework-code paths, narrow to Super-Admin"
      },

      "no_scope_match": {
        "behavior": "keep_l1_candidates",
        "$description": "When target_files[] has no scope pattern match, retain all L1 candidates for L3 filtering"
      },

      "scope_priority_over_l1": true,
      "$description_scope_priority": "REVISED: When L1 ∩ SCOPE = empty set, scope-matched agent takes priority over L1 candidates. Scope is more reliable than verb keywords."
    }
  }
}
```

> **关键修订**：
> - `dispatch_exempt_agents`：Orchestrator/Meta-Planner/Super-Admin 派遣不受路由校验覆盖
> - `verb_to_agent` 关键词去重：删除 L1 与 L4 交叉的 "DAG"/"dag"（L4 独占），删除模糊的 "框架"
> - `scope_priority_over_l1`：scope 空交集时 scope agent 独占
> - L2 输入从 `task_description` 改为 `target_files[]`

### 3.2 共享校验库 `lib/route-validator.ts`（修订版）

```typescript
// ── lib/route-validator.ts ──
// Four-layer agent routing validation chain: Verb → Scope → Permission → DAG
// Used by: dispatch-before.ts (dispatch-time), gate-before.ts (DAG-write-time)
//          scope-before.ts P0-3/P0-4 (migrated from hardcoded checks)
//
// REVISION NOTES:
//   - L2 scope input: Task.DAG.json target_files[] (not task_description text)
//   - L3 opencode.json path: opencodeConfig.agent[agentName].permission.safe_edit
//   - L4 is selection step (not filtering); actual DAG validation by PLAN-FIRST
//   - Orchestrator/Meta-Planner/Super-Admin dispatches exempt from route validation

import * as fs from "node:fs";
import * as path from "node:path";

interface VerbRule {
  keywords: string[];
  agents: string[];
}
interface ScopeRule {
  scope: string;
  agent: string;
  priority: number;
  desc: string;
}
interface RouteConfig {
  enforcement: { dispatch: string; dag_write: string };
  dispatch_exempt_agents?: string[];
  verb_to_agent: Record<string, VerbRule>;
  scope_to_agent: {
    rules: ScopeRule[];
    cross_domain: { agent: string };
    no_scope_match: { behavior: string };
    scope_priority_over_l1?: boolean;
  };
}

// ── Config reader ──

const ROOT = process.env.OPENCODE_ROOT || process.cwd();
let _routeConfig: RouteConfig | null = null;

export function readRouteConfig(): RouteConfig | null {
  if (_routeConfig) return _routeConfig;
  try {
    const cfgPath = path.join(ROOT, ".opencode", "project.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    _routeConfig = cfg.route_rules || null;
  } catch {
    _routeConfig = null;
  }
  return _routeConfig;
}

export function resetRouteConfigCache(): void {
  _routeConfig = null;
}

// ── opencode.json reader ──

let _opencodeConfig: any = null;

export function readOpencodeConfig(): any {
  if (_opencodeConfig) return _opencodeConfig;
  try {
    const cfgPath = path.join(ROOT, "opencode.json");
    _opencodeConfig = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    _opencodeConfig = null;
  }
  return _opencodeConfig;
}

// ═══ Layer 1: Verb → Candidate Pool ═══

export function l1_verbCandidates(
  taskDescription: string,
  verbRules: Record<string, VerbRule>,
): string[] {
  const lower = taskDescription.toLowerCase();
  const agents = new Set<string>();

  for (const rule of Object.values(verbRules)) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        rule.agents.forEach((a) => agents.add(a));
        break;
      }
    }
  }

  if (agents.size === 0) {
    return [
      "@Meta-Planner", "@Orchestrator", "@Architect", "@Coder-BE", "@Coder-FE",
      "@Guardian", "@Arbiter", "@CI-CD-Agent", "@Super-Admin", "@Knowledge-Curator",
    ];
  }
  return [...agents];
}

// ═══ Layer 2: Scope → Filter (REVISED: target_files[] input) ═══

export function l2_scopeFilter(
  candidates: string[],
  targetFiles: string[],  // REVISED: from Task.DAG.json, not task_description
  scopeConfig: RouteConfig["scope_to_agent"],
): string[] {
  const sorted = [...scopeConfig.rules].sort((a, b) => a.priority - b.priority);

  // Find scope agents matching target files
  const matchedAgents = new Set<string>();
  const matchedScopes: string[] = [];
  for (const file of targetFiles) {
    for (const rule of sorted) {
      if (file.includes(rule.scope)) {
        matchedAgents.add(rule.agent);
        matchedScopes.push(rule.scope);
        break; // highest-priority match per file
      }
    }
  }

  // No scope match → retain all L1 candidates
  if (matchedAgents.size === 0) {
    return candidates;
  }

  // Cross-domain: target_files span both business and framework scopes
  const bizScopes = new Set(["booking-backend/src/", "booking-frontend/"]);
  const fwScopes = new Set([".opencode/", "opencode.json", "AGENTS.md"]);
  const hasBizScope = matchedScopes.some((s) => bizScopes.has(s));
  const hasFwScope = matchedScopes.some((s) => fwScopes.has(s));

  if (hasBizScope && hasFwScope) {
    return [scopeConfig.cross_domain.agent];
  }

  // REVISED: scope_priority_over_l1
  // When L1 ∩ SCOPE = empty set, scope-matched agent takes priority
  const intersection = candidates.filter((a) => matchedAgents.has(a));

  if (intersection.length > 0) {
    return intersection;
  }

  if (scopeConfig.scope_priority_over_l1) {
    return [...matchedAgents]; // scope wins over verb
  }

  return candidates; // fallback: keep L1 (legacy behavior)
}

// ═══ Layer 3: Permission → Veto (REVISED: correct opencode.json path) ═══

export function l3_permissionFilter(
  candidates: string[],
  targetScopes: string[],
  opencodeConfig: any,
): string[] {
  if (candidates.length === 0) return [];

  const allowed: string[] = [];

  for (const agent of candidates) {
    // REVISED: correct path is opencodeConfig.agent[agentName].permission.safe_edit
    const agentKey = agent.replace(/^@/, "");
    const agentPerms = opencodeConfig?.agent?.[agentKey]?.permission?.safe_edit;

    if (!agentPerms) {
      allowed.push(agent);
      continue; // no safe_edit config → conservative allow
    }

    let blocked = false;
    for (const scope of targetScopes) {
      for (const [pattern, action] of Object.entries(agentPerms)) {
        if (action === "deny" && scope.includes(pattern)) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }

    if (!blocked) allowed.push(agent);
  }

  if (allowed.length === 0 && candidates.length > 0) {
    throw new Error(
      `[FW-ENFORCE][ROUTE-MISMATCH] No authorized agent found. ` +
      `Candidates ${candidates.join(",")} all have safe_edit deny for ` +
      `scopes: ${targetScopes.join(", ")}`,
    );
  }

  // Minimum-privilege: prefer agent with narrowest allow scope
  if (allowed.length > 1) {
    allowed.sort((a, b) => {
      const aKey = a.replace(/^@/, "");
      const bKey = b.replace(/^@/, "");
      const aPerms = opencodeConfig?.agent?.[aKey]?.permission?.safe_edit || {};
      const bPerms = opencodeConfig?.agent?.[bKey]?.permission?.safe_edit || {};
      const aCount = Object.keys(aPerms).filter((k) => aPerms[k] === "allow").length;
      const bCount = Object.keys(bPerms).filter((k) => bPerms[k] === "allow").length;
      return aCount - bCount;
    });
  }

  return allowed;
}

// ═══ Extract scopes from target_files[] ═══

export function extractScopePatterns(
  targetFiles: string[],
  rules: ScopeRule[],
): string[] {
  const scopes: string[] = [];
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const file of targetFiles) {
    for (const rule of sorted) {
      if (file.includes(rule.scope)) {
        scopes.push(rule.scope);
        break;
      }
    }
  }
  return scopes;
}

// ═══ DAG-Validation (L2 Scope + L3 Permission only) ═══

export function findScopeAgent(
  file: string,
  rules: ScopeRule[],
): string | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (file.includes(rule.scope)) return rule.agent;
  }
  return null;
}

export function validateDagTaskAgentAssignment(
  task: { id: string; agent: string; target_files: string[] },
  scopeRules: ScopeRule[],
  opencodeConfig: any,
): { valid: boolean; violations: Array<{ file: string; assigned: string; expected: string }> } {
  const violations: Array<{ file: string; assigned: string; expected: string }> = [];

  for (const file of task.target_files) {
    const expected = findScopeAgent(file, scopeRules);
    if (!expected) continue;
    if (expected === task.agent) continue;

    const l3 = l3_permissionFilter([expected], [file], opencodeConfig);
    if (l3.length === 0) continue;

    violations.push({ file, assigned: task.agent, expected: l3[0] });
  }
  return { valid: violations.length === 0, violations };
}

// ═══ Layer 4: DAG → Existence Check (selection step) ═══

export function l4_dagCheck(
  candidates: string[],
  dagTaskId: string,
  isDagExemptFn: (agent: string) => boolean,
): string {
  if (candidates.length === 0) return "";

  const agent = candidates[0]; // already sorted by minimum privilege from L3

  if (agent === "@Orchestrator") return ""; // self-dispatch
  if (isDagExemptFn(agent)) return agent;   // exempt
  return agent; // dispatch proceeds; PLAN-FIRST handles actual DAG validation
}

// ═══ Dispatch exemption check ═══

export function isDispatchRouteExempt(
  caller: string,
  config: RouteConfig | null,
): boolean {
  if (!config?.dispatch_exempt_agents) return false;
  const callerNorm = caller.replace(/^@/, "").toLowerCase();
  return config.dispatch_exempt_agents.some((e) =>
    e.replace(/^@/, "").toLowerCase() === callerNorm
  );
}

// ═══ scope-before.ts P0-3/P0-4 migration helpers ═══

export function isFrameworkInfraFile(filePath: string): boolean {
  const norm = filePath.toLowerCase();
  return norm.includes(".opencode/")
    || norm === "opencode.json"
    || norm.endsWith("agents.md")
    || norm.endsWith("project.config.json")
    || norm.endsWith("project_reference.md");
}

export function isBusinessCodeFile(filePath: string): boolean {
  const norm = filePath.toLowerCase();
  return norm.includes("booking-backend/src/")
    || norm.includes("booking-frontend/src/")
    || norm.includes("schema.prisma");
}

export function findRouteAgentForFile(
  filePath: string,
  scopeRules: ScopeRule[],
): string | null {
  return findScopeAgent(filePath, scopeRules);
}
```

### 3.3 派遣时校验（dispatch-before.ts）修订版

在 line 34 `if (input.tool !== "dispatch_subagent") return;` 之后、现有 PLAN-FIRST 检查之前插入四层路由：

```typescript
// ── ROUTE VALIDATION: four-layer chain (L1 Verb → L2 Scope → L3 Permission → L4 DAG) ──
const routeConfig = readRouteConfig();
if (routeConfig?.enforcement?.dispatch === "block") {

  // REVISED: Orchestrator/Meta-Planner/Super-Admin exempt — professional judgment authority
  if (isDispatchRouteExempt(caller, routeConfig)) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      agent: caller, agentType: caller,
      event: "DISPATCH-BEFORE",
      detail: `ROUTE-EXEMPT | caller @${caller} exempt from route validation`,
    });
    // fall through to existing PLAN-FIRST checks
  } else {
    const taskDesc = output?.args?.task_description || "";

    // L1: Verb → Candidate Pool
    const l1Candidates = l1_verbCandidates(taskDesc, routeConfig.verb_to_agent);
    if (l1Candidates.length === 0) {
      // no verb → skip route check, proceed to PLAN-FIRST
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent: caller, agentType: caller,
        level: "WARN", event: "DISPATCH-BEFORE",
        detail: `ROUTE-SKIP | no verb match in task "${taskDesc.substring(0, 80)}"`,
      });
    } else {
      // REVISED: L2 uses Task.DAG.json target_files[] when dag_task_id available
      let targetFiles: string[] = [];
      if (dagTaskId) {
        const tc = findTaskInDag(dagTaskId);
        if (tc.found && tc.task?.target_files) {
          targetFiles = tc.task.target_files;
        }
      }

      const l2Candidates = l2_scopeFilter(l1Candidates, targetFiles, routeConfig.scope_to_agent);

      // L3: Permission → Veto
      const scopes = extractScopePatterns(
        targetFiles.length > 0 ? targetFiles : [taskDesc],
        routeConfig.scope_to_agent.rules,
      );
      const opencodeConfig = readOpencodeConfig();
      const l3Candidates = l3_permissionFilter(l2Candidates, scopes, opencodeConfig);

      // L4: DAG (selection step)
      const finalAgent = l4_dagCheck(l3Candidates, dagTaskId, isDagExempt);

      if (finalAgent && target !== finalAgent) {
        writeLog("dispatch-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID,
          agent: caller, agentType: caller,
          level: "ERROR",
          event: "DISPATCH-BEFORE",
          detail:
            `ROUTE-MISMATCH | task="${taskDesc.substring(0, 120)}" | ` +
            `dispatched_to=${target} | expected=${finalAgent} | ` +
            `L1=[${l1Candidates.join(",")}] L2=[${l2Candidates.join(",")}] ` +
            `L3=[${l3Candidates.join(",")}]`,
        });
        throw new Error(
          `[FW-ENFORCE][ROUTE-MISMATCH] dispatch_subagent to @${target} is incorrect. ` +
          `Four-layer route: L1(verb) [${l1Candidates.join(",")}] → ` +
          `L2(scope) [${l2Candidates.join(",")}] → ` +
          `L3(permission) [${l3Candidates.join(",")}] → ` +
          `Selected: @${finalAgent}. ` +
          `Task: "${taskDesc.substring(0, 100)}..."`,
        );
      }
    }
  }
}
```

### 3.4 DAG 制定时校验（gate-before.ts）修订版

DAG 校验只跑 **L2 + L3**，不跑 L1 和 L4。

```typescript
// ── ROUTE VALIDATION: DAG task agent ←→ target_files (L2 Scope + L3 Permission) ──
const dagRouteConfig = readRouteConfig();
if (dagRouteConfig?.enforcement?.dag_write === "block" &&
    filePath === "Task.DAG.json") {

  const dag = JSON.parse(contentAfter || contentBefore);
  const scopeRules = dagRouteConfig.scope_to_agent.rules;
  const opencodeConfig = readOpencodeConfig();

  for (const task of dag.tasks || []) {
    if (task.status === "completed" || task.status === "skipped") continue;
    if (!task.agent || !task.target_files?.length) continue;

    // REVISED: skip validation for DAG-exempt agents' own tasks
    // Meta-Planner has professional judgment for agent assignment per AGENTS.md P0
    const taskAgentNorm = (task.agent || "").replace(/^@/, "").toLowerCase();
    const exemptAgents = dagRouteConfig.dispatch_exempt_agents || [];
    const isExempt = exemptAgents.some((e) =>
      e.replace(/^@/, "").toLowerCase() === taskAgentNorm
    );
    if (isExempt) continue; // exempt agents' assignments not subject to scope validation

    const result = validateDagTaskAgentAssignment(task, scopeRules, opencodeConfig);
    if (!result.valid) {
      const v = result.violations[0];
      writeLog("gate-before", "runtime", {
        sessionID, callID, level: "ERROR", event: "GATE-BEFORE",
        detail:
          `ROUTE-MISMATCH | DAG task "${task.id}" | ` +
          `assigned=${v.assigned} | file=${v.file} | expected=${v.expected}`,
      });
      throw new Error(
        `[FW-ENFORCE][ROUTE-MISMATCH] Task "${task.id}" assigns ` +
        `@${v.assigned} but target_file "${v.file}" → should be @${v.expected}. ` +
        `Fix the DAG entry before committing.`,
      );
    }
  }
}
```

### 3.5 scope-before.ts P0-3/P0-4 迁移

原 scope-before.ts P0-3 (64-89行) 和 P0-4 (91-122行) 的硬编码 ROUTE-MISMATCH 检查迁移为调用 `route-validator.ts`：

```typescript
// P0-3: Architect/Orchestrator → framework files (MIGRATED to route-validator.ts)
const routeConfig = readRouteConfig();
const scopeRules = routeConfig?.scope_to_agent?.rules;
if (scopeRules && isFrameworkInfraFile(scopePath)) {
  const expectedAgent = findRouteAgentForFile(scopePath, scopeRules);
  if (expectedAgent && agentNorm !== expectedAgent.replace(/^@/, "").toLowerCase()) {
    writeLog("scope-before", "runtime", { ... }); // same log pattern
    throw new Error(`[FW-ENFORCE][ROUTE-MISMATCH] ...`);
  }
}

// P0-4: Super-Admin → business code (MIGRATED to route-validator.ts)
if (scopeRules && isBusinessCodeFile(scopePath)) {
  const expectedAgent = findRouteAgentForFile(scopePath, scopeRules);
  if (expectedAgent && agentNorm !== expectedAgent.replace(/^@/, "").toLowerCase()) {
    writeLog("scope-before", "runtime", { ... }); // same log pattern
    throw new Error(`[FW-ENFORCE][ROUTE-MISMATCH] ...`);
  }
}
```

> **迁移原则**：删除 scope-before.ts 中硬编码的 agent 名称比较和路径列表，改为读取 `route_rules.scope_to_agent.rules` 配置。配置变更时只需修改 project.config.json，无需改代码。

---

## 四、与现有 ROUTE-MISMATCH 的关系（修订版）

### 迁移，不叠加

| 校验层 | 实现 | 检查时机 | 变更 |
|--------|------|---------|------|
| `dispatch-before.ts` L1-L4（新） | 四层链式筛选 | `dispatch_subagent` 调用前 | **新增** |
| `gate-before.ts` L2+L3（新） | 精确匹配 target_files | 写 `Task.DAG.json` 时 | **新增** |
| `scope-before.ts` P0-3/P0-4（迁移） | 原硬编码 → route-validator.ts | `safe_edit`/`write` 时 | **迁移** |

### 统一配置源

三层使用同一份 `route_rules`（verb_to_agent + scope_to_agent），修改一处全局生效。scope-before.ts 不再维护独立的硬编码路径列表。

---

## 五、边界情况（修订版）

| 场景 | 处理方式 |
|------|---------|
| `project.config.json` 缺少 `route_rules` | 跳过校验（向后兼容），writeLog WARN |
| L1 无动词匹配 | 候选池 = 全部 10 个 Agent，由 L2 过滤 |
| L2 无 target_files（dag_task_id 为空） | 保留 L1 全部候选池，进入 L3 |
| L2 target_files 无 scope 匹配 | 保留 L1 全部候选池 |
| L1 ∩ SCOPE 空交集 + scope_priority_over_l1=true | scope agent 独占优先 |
| L3 全部候选 Agent 被 deny | `throw Error` |
| L3 多个 Agent 通过 | 最小权限原则选最窄 allow |
| 跨域 target_files（含 biz + fw scope） | L2 → Super-Admin |
| @Orchestrator 派遣 | ROUTE-EXEMPT — 跳过路由校验 |
| @Meta-Planner 派遣 | ROUTE-EXEMPT — 跳过路由校验 |
| @Super-Admin 派遣 | ROUTE-EXEMPT — 跳过路由校验 |
| `route_rules.enforcement.dispatch = "warn"` | 不 throw，仅 writeLog |

---

## 六、审核发现的缺陷与修正

### 6.1 CRITICAL 缺陷

| # | 缺陷 | 根因 | 修正 |
|---|------|------|------|
| C1 | L3 opencode.json 三条访问路径全部失效 | `opencodeConfig.agents` (复数) 不存在 → undefined；`opencodeConfig["@Agent"]` (@前缀) 不匹配；缺 `.permission` 层 | 修正为 `opencodeConfig.agent[agentName].permission.safe_edit`；新增 `readOpencodeConfig()` + 缓存 |
| C2 | L2 scope 匹配基于 task_description 文本，不可靠 | `taskDescription.includes(".opencode/")` 对自由文本返回 false | 改为 `Task.DAG.json` 的 `target_files[]` 精确路径匹配；无 DAG 条目时 fallback 到 task_description |
| C3 | Orchestrator/Meta-Planner 专业判断被覆盖 | 四层链 BLOCK 不匹配派遣，但 L1-L2 不可靠 | 新增 `dispatch_exempt_agents`：Orchestrator/Meta-Planner/Super-Admin 派遣不受路由校验覆盖 |

### 6.2 HIGH 缺陷

| # | 缺陷 | 根因 | 修正 |
|---|------|------|------|
| H1 | L1 动词关键词子串匹配过宽 | `"分析"` 可匹配名词用法 | 删除模糊关键词 "DAG"/"框架"（由 L4/scope 分别负责）；保留其他关键词 |
| H2 | project.config.json vs opencode.json 混淆 | L3 读 opencode.json，配置放 project.config.json，未说明关系 | 明确声明：project.config.json 定义路由映射（派遣决策），opencode.json 定义权限矩阵（否决权） |
| H3 | 缺少 `readProjectConfig()` 和 opencode.json 读取函数 | 方案引用不存在的基础设施 | 新增 `readRouteConfig()` + `readOpencodeConfig()` + 缓存 |
| H4 | scope-before.ts P0-3/P0-4 硬编码冗余 | 新增路由层但保留旧硬编码 → 双执法点可分裂 | 迁移 scope-before.ts 硬编码到 route-validator.ts，删除重复 |

### 6.3 MEDIUM 缺陷

| # | 缺陷 | 修正 |
|---|------|------|
| M1 | L4 是选择步骤而非过滤步骤 | 文档明确 L4 为 "selection step"，实际 DAG 验证由 PLAN-FIRST 执行 |
| M2 | agent_write_scopes 与 scope_to_agent 功能重叠 | scope_to_agent 管派遣路由（before dispatch），agent_write_scopes 管写入作用域（during write），职责正交 |
| M3 | 跨域检测基于 L1 候选池而非实际 scope | 改为基于 target_files[] 的 scope 匹配结果（biz + fw scope 同时出现 → cross_domain） |

### 6.4 日志系统集成

| 文件 | 方案使用 | 正确性 |
|------|---------|:------:|
| `lib/route-validator.ts` | 无日志调用 (纯数据+throw) | ✅ 共享库不应做日志 |
| `dispatch-before.ts` 扩展 | `writeLog("dispatch-before", "runtime", ...)` | ✅ 与现有模式一致 |
| `gate-before.ts` 扩展 | `writeLog("gate-before", "runtime", ...)` | ✅ 与现有模式一致 |
| `scope-before.ts` 迁移 | 保留现有 writeLog 模式 | ✅ 仅迁移逻辑，不改日志 |

**方案不引入 console.log/error/warn 违规。**

---

## 七、Console 违规治理（新增）

### 7.1 dispatch-subagent.ts console.error → writeLog 迁移

**现状**：25+ console.error 调用，0 writeLog 调用。文件有自己的 `logInfo/logWarn` 本地日志函数（`fs.appendFileSync`），缺乏 writeLog 的缓冲、级别过滤和索引追踪能力。

**迁移策略**：

| 类别 | console 调用 | 处理方式 |
|------|-------------|---------|
| CLI 入口参数验证 (L118-140) | 7 console.error + process.exit(1) | 替换为 writeLog("dispatch-subagent", "ERROR", {...})；保留 1 条 console.error 用于 stderr 可见性 |
| Pre-execution gate try/catch (L179-195) | 5 console.error | 替换为 writeLog("dispatch-subagent", "ERROR/WARN", {...})；保留 1 条 console.error 用于 stderr 可见性 |
| Gate script missing (L199-204) | 2 console.error | 替换为 writeLog("dispatch-subagent", "WARN", {...}) |
| Agent config not found (L287) | 1 console.error | 替换为 writeLog("dispatch-subagent", "ERROR", {...}) |
| readRuntimePermissions try/catch (L409) | 1 console.error | 替换为 writeLog("dispatch-subagent", "WARN", {...}) |
| DAG_TASK_ID reuse fatal (L883/908/913) | 3 console.error(fatalMsg) | 替换为 writeLog("dispatch-subagent", "ERROR", {...})；保留 1 条 console.error 用于 stderr |
| .pending.json write retry (L955-963) | 3 console.error | 替换为 writeLog("dispatch-subagent", "ERROR", {...}) |
| .pending.json read-back (L979-993) | 4 console.error | 替换为 writeLog("dispatch-subagent", "ERROR", {...}) |
| stdout output (L1001) | 1 console.log(outputFile) | **保留** — 这是脚本主输出，调用方依赖此输出 |
| logInfo/logWarn 本地函数 (L65-74) | fs.appendFileSync | 替换为 writeLog("dispatch-subagent", "runtime/INFO/WARN", {...}) |

**新增 import**：`const { writeLog } = require("../../lib/log-manager");`

**迁移原则**：
- 所有 `console.error` 替换为 `writeLog()`
- `process.exit(1)` 前保留 1 条 `console.error` 用于 stderr 显示（CLI 入口可见性）
- `console.log(outputFile)` (L1001) 保留 — 脚本主输出契约
- `logInfo/logWarn` 本地函数迁移为 writeLog 调用

### 7.2 pre-execution-gate.ts gateLog 覆盖补全

**现状**：33 console.error + 1 console.log。已有 `gateLog()` 惰性加载封装（L5-25）和 10 处 gateLog 调用。但 **3 处 console 调用缺少 gateLog 持久化**。

**补全策略**：

| 缺失 gateLog 的位置 | 行号 | console 调用 | 补全 |
|---------------------|------|-------------|------|
| DAG creator bypass | 791 | `console.log(...)` | 新增 `gateLog("dag_creator_bypass", "INFO", { agent })` |
| UC7KS bypass warning | 726 | `console.error(...)` | 新增 `gateLog("uc7ks_bypass_warn", "WARN", { agent, agentCount, bypassAttempts })` |
| Runtime guard | 942 | `console.error(...)` | 新增 `gateLog("runtime_error", "ERROR", { reason: "non_node_runtime" })` |

**不替换的 console 调用**（保留，属于 CLI UX 层）：
- `printUsage()` (L300-320) — CLI 用法文本
- `emitError()` (L267/270) — UI 输出 + 已有 gateLog (L262)
- Check 1-6 进度指示器 (L883-910) — CLI 进度显示
- 最终结果摘要 (L926/931) — 已有 gateLog (L919)

**原则**：pre-execution-gate.ts 是 CLI 脚本，console.error 用于 stderr 显示给调用进程，gateLog 用于持久化审计。两者互补，不互斥。

---

## 八、实施步骤（修订版）

### Phase 0: Console 违规治理（前置）

| Step | 内容 | 文件 | 行数 |
|:----:|------|------|:----:|
| P0-1 | dispatch-subagent.ts: console.error → writeLog 迁移 + logInfo/logWarn → writeLog | `.opencode/scripts/command-tools/dispatch-subagent.ts` | ~50 |
| P0-2 | pre-execution-gate.ts: 3 处 gateLog 补全 | `.opencode/scripts/pre-execution-gate.ts` | +6 |
| P0-3 | 运行 `framework-self-test.ts` 验证无回归 | 验证 | — |

### Phase 1: 类型与基础设施

| Step | 内容 | 文件 | 行数 |
|:----:|------|------|:----:|
| S1 | 创建 `lib/route-validator.ts`（四层链式路由 + 共享校验 + config 读取 + scope-before 迁移辅助） | 新文件 | ~150 |
| S2 | 在 `project.config.json` 添加 `route_rules`（verb + scope 映射 + exempt_agents） | 修改 | +70 |

### Phase 2: 派遣与 DAG 校验

| Step | 内容 | 文件 | 行数 |
|:----:|------|------|:----:|
| S3 | 扩展 `dispatch-before.ts`（L1-L4 派遣时路由校验 + exempt 检查） | 修改 | +80 |
| S4 | 扩展 `gate-before.ts`（L2+L3 DAG 制定时路由校验 + exempt 检查） | 修改 | +40 |

### Phase 3: scope-before.ts 迁移

| Step | 内容 | 文件 | 行数 |
|:----:|------|------|:----:|
| S5 | 迁移 `scope-before.ts` P0-3/P0-4 硬编码 → route-validator.ts 函数调用 | 修改 | ~-30/+20 |

### Phase 4: 验证

| Step | 内容 |
|:----:|------|
| S6 | `bun .opencode/scripts/framework-self-test.ts` — 无回归 |
| S7 | TypeScript 类型检查 |
| S8 | 手动测试：派遣 Architect 处理 .opencode/ 应被阻断 |
| S9 | 验证 exempt agent 派遣不受阻断 |

总代码量：~370 行。预计耗时：~90 分钟（含 console 违规治理）。

---

## 九、九子系统影响矩阵（修订版）

| Agent | 原流程 | 新流程 | 变更 |
|-------|--------|--------|------|
| @Orchestrator | check→confirm→complete | **ROUTE-EXEMPT** → check→confirm→complete | **零变更** |
| @Meta-Planner | check→confirm→work→complete | **ROUTE-EXEMPT** → check→confirm→work→complete | **零变更** |
| @Super-Admin | check→confirm→complete | **ROUTE-EXEMPT** → check→confirm→complete | **零变更** |
| @Architect | check→confirm→work→complete | check→confirm→work→**scope-before 迁移**→complete | scope-before 检查源从硬编码改为配置 |
| @Coder-BE | check→confirm→work→complete | check→confirm→work→**scope-before 迁移**→complete | 同上 |
| @Coder-FE | check→confirm→work→complete | 同上 | 同上 |
| @Guardian | check→confirm→work→complete | 同上 | 同上 |
| @Arbiter | check→confirm→work→complete | 同上 | 同上 |
| @CI-CD-Agent | check→confirm→work→complete | 同上 | 同上 |
| @Knowledge-Curator | check→confirm→work→complete | 同上 | 同上 |

**3 个 exempt agent (Orchestrator/Meta-Planner/Super-Admin) 流程完全不变。7 个非 exempt agent 仅 scope-before.ts 检查源从硬编码改为配置读取，行为逻辑不变。**

---

## 十、配置源职责分离声明

| 配置文件 | 职责 | 被谁读取 |
|----------|------|---------|
| `project.config.json` `route_rules` | 派遣路由决策（动词→候选池、路径→agent 映射、exempt 列表） | dispatch-before.ts, gate-before.ts, scope-before.ts |
| `project.config.json` `agent_write_scopes` | 写入作用域执法（allow/deny glob per agent） | scope-before.ts `isWriteAllowed()` |
| `opencode.json` `agent.{Agent}.permission.safe_edit` | MCP 工具级权限否决（glob→allow/deny map） | route-validator.ts L3, `safe_edit` tool |

**职责正交**：
- `route_rules` 决定"谁应该做这个任务"（before dispatch）
- `agent_write_scopes` 决定"谁可以写哪些文件"（during write）
- `safe_edit` 决定"MCP 工具是否允许此操作"（tool execution）

三层互补，不重叠。

---

## 十一、参考资料

- `AGENTS.md` — P0 Agent 职责边界与路由规则
- `scope-before.ts:64-122` — 现有 ROUTE-MISMATCH P0-3/P0-4 硬编码检查（待迁移）
- `dispatch-before.ts:34` — 已有 dispatch_subagent 拦截点
- `gate-before.ts:112-172` — 已有 P2-1 DAG task audit
- `dag-policy.ts:53-58` — DAG_EXEMPT_AGENTS 规范列表
- `opencode.json` — Agent 权限矩阵（L3 否决权数据源，结构: `agent.{Agent}.permission.safe_edit`）
- `project.config.json` `agent_write_scopes` — 写入作用域配置（681-859行）
