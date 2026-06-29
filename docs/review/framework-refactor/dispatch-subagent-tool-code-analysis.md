# dispatch_subagent.ts 工具源代码深度分析

**日期**: 2026-06-26
**源文件**: `.opencode/tools/dispatch_subagent.ts` (865 行)
**分析人**: Super-Admin

---

## 一、文件整体结构 (5层)

```
dispatch_subagent.ts (865行)
├── [L1-22]  依赖导入 — @opencode-ai/plugin, dag-policy, db-state-manager 等 10 个模块
├── [L25]    常量 SRC = "tool-dispatch-subagent"
├── [L34-204] 辅助函数 ×5 (独立函数, 在 execute() 外)
└── [L206-865] 主入口 — tool({ args, execute })
    ├── args 定义 (6个参数)
    └── execute() — 5阶段执行逻辑
```

---

## 二、6个参数详解

| 参数 | 类型 | 必选 | 作用 |
|------|------|:---:|------|
| `agent_type` | string | ✅ | 目标 Agent 类型, 如 "CI-CD-Agent", "Architect", "Coder-BE" |
| `task_description` | string | ✅ | 任务描述, 会被包装进子 Agent 的 prompt |
| `dag_task_id` | string | ❌ | DAG 任务 ID, 用于 PLAN-FIRST 检查 |
| `session_namespace` | string | ❌ | 输出路径命名空间 `.task_temp/{ns}/`, 默认用 dag_task_id |
| `auto_plan` | boolean | ❌ | 自愈开关: DAG 缺条目时自动调用 Meta-Planner 规划 |
| `resume_session_id` | string | ❌ | 恢复之前 dispatch 的 session, 设置后启用 Task() 的 task_id 参数 |

---

## 三、5个辅助函数

### 3.1 loadUC7KSDispatchPatterns(worktree) → string[]  (L34-63)

**作用**: 加载 UC7KS 知识获取匹配模式列表。当 SA 调度 KC 时, task_description 必须包含至少一个模式。
**默认值**: ["knowledge", "cache", "docs", "official", "context7", "uc7ks", "fetch", "curator", "index", "explore", "source code", "repository", "github", "documentation", "library", "api reference"]
**配置源**: `project.config.json → template_resolution.super_admin_uc7ks_dispatch_patterns`

### 3.2 loadSARepairPatterns(worktree) → string[] (L69-99)

**作用**: 加载 Super-Admin 紧急修复匹配模式列表。Orchestrator 调度 SA 时, task_description 必须匹配至少一个模式。
**默认值**: ["repair", "fix", "restore", "corrupt", "broken", "emergency", "reset", "drain", "purge", "reconcile", "inconsistency", "state", "hook", "plugin", "integrity", "machine.json", "gate-state", "compliance"]
**配置源**: `project.config.json → template_resolution.super_admin_repair_patterns`

### 3.3 logOrchestratorSADispatch(opts) → void (L104-150)

**作用**: Orchestrator → SA 调度的审计日志。双写到 audit_log 和 machine.json compliance_records (最近100条)。
**参数**: { caller, target, task_description, dag_task_id, patterns_matched, mode }

### 3.4 logSuperAdminDispatchBypass(opts) → void (L155-175)

**作用**: SA → KC 调度绕过的审计日志。仅写到 audit_log, 不写 machine.json。

### 3.5 inferDomainId(agentType) → string|null (L183-204)

**作用**: 根据 agent 类型推断 domain_id (知识域 ID)。
**来源**: `project.config.json → agent_domain_map` (大小写不敏感匹配)

---

## 四、execute() 5阶段完整调用逻辑

### 阶段1: 前置验证 (L281-402)

```
L281: 设置 process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated"
      标记当前处于 orchestrated dispatch 上下文

L289-308: dag_task_id 缺失时自动生成跟踪 UUID
      写入 writeLog("tool-dispatch-subagent", "INFO", "DAGTASK-ID-AUTO-GENERATED")

L310-402: PLAN-FIRST Layer 2 检查
      ├─ isDagExempt(targetAgent)? → 跳过 (Meta-Planner/Orchestrator/SA/KC)
      ├─ !require_dag_entry? → 跳过 (dispatch_policy 未启用)
      ├─ findTaskInDag(dagTaskId).found === false:
      │   ├─ auto_plan=true && auto_plan_enabled=true → autoPlan()
      │   │   └─ 内部调用 execFileSync("bun", "dispatch-subagent.ts", "Meta-Planner", ...)
      │   │      等待轮询 findTaskInDag 直到条目出现 (最长 auto_plan_timeout_ms)
      │   ├─ auto_plan=true && auto_plan_enabled=false → throw Error (自愈被禁用)
      │   └─ auto_plan=false → throw Error (需手动规划)
      └─ status != "pending" && != "in_progress" → throw Error (状态不正确)
```

### 阶段2: 安全权限检查 (L414-516)

```
L408-455: Agent 路由门
      ├─ isOrchestrator? → 通过 (Orchestrator 可调度任何人)
      ├─ isKCTarget? → 任何 Agent 可直接调度 KC (UC7KS 知识获取)
      ├─ isSuperAdmin && isKCTarget? → SA 可调 KC (需匹配 UC7KS 模式)
      ├─ isSuperAdmin && !isKCTarget? → 拒绝 (SA 只能调 KC)
      └─ 其他 → 拒绝 (只有 Orchestrator 能调)

L464-516: Super-Admin 目标的门控
      ├─ Locked 模式 → 拒绝 (SA 只能人工调用)
      ├─ Strict 模式 → 需匹配 repair patterns (loadSARepairPatterns)
      └─ Advisory 模式 → 自由调度
      └─ 写入审计日志 logOrchestratorSADispatch()
```

### 阶段3: 执行 CLI 脚本 (L518-601) ← 关键路径

```
L518-526: 准备参数
      scriptPath = ".opencode/scripts/command-tools/dispatch-subagent.ts"
      sessionNamespace = args.session_namespace || dagTaskId
      scriptArgs = [agent_type, sessionNamespace?, task_description]

L556-601: 通过子进程执行
      execFileSync("bun", ["--no-cache", scriptPath, ...scriptArgs], {
        encoding: "utf8",
        timeout: 60000,
        env: {
          OPENCODE_SESSION_ID,
          DISPATCH_TASK_DESC,
          DISPATCH_NAMESPACE,
          DISPATCH_DAG_TASK_ID,
          DISPATCH_RESUME_SESSION_ID,
        }
      })
      → 返回 stdout (输出文件路径)
      
      错误处理 (L595-601):
      throw new Error(
        `dispatch_subagent: dispatch-subagent.js failed (exit ${err.status}): ` +
        `${err.stderr?.toString() || err.message}`
      )
```

### 阶段4: 后处理 (L603-819)

```
L603: 读取 CLI 输出的 wrapped prompt
      wrappedPrompt = await readFile(outputFilePath, "utf8")

L616-709: LLM-FREE BRIDGE — 写 .auto-dispatch.json 标记
      追加到 FIFO 队列 (队列上限 50 条)
      atomicWriteJson(autoMarkerPath, queue)  ← 原子写入

L711-763: 写 per-dispatch ctx 文件
      ctx/{dagTaskId}.json 文件
      内容: { pipeline_id, dagTaskId, agentType, domainId, parentSessionId, createdAt }
      注意: 使用 writeFileSync (非原子!)

L765-819: 写 session_map DB 记录
      ├─ 父级记录: dbWriteSessionMap(parentSession, agent, dagTaskId, domainId)
      └─ 子级插槽: dbWriteSessionMap("dispatch:child:{dagTaskId}", agentType, dagTaskId, domainId)
```

### 阶段5: 返回结果 (L821-856)

```
L825-848: 正常路径 — 返回 wrapped prompt 给调用方
      execFileSync("bun", ...) 第二次执行 CLI 脚本
      → 返回生成的 prompt 字符串

L849-855: 退化路径 — CLI 失败时的回退消息
      返回人类可读的错误提示
```

---

## 五、autoPlan 自愈流程 (L324-376)

**触发条件**: PLAN-FIRST Layer 2 发现 DAG 缺失 + auto_plan=true + auto_plan_enabled=true

```
autoPlan({ dagTaskId, targetAgent, taskDescription, timeoutMs, callerSession, callerAgent })
  ├─ 1. 限流检查: 每会话最多 auto_plan_max_per_session 次 (默认5次)
  ├─ 2. 构造 planningPrompt: "Plan task '{taskDescription}' for {targetAgent} with dag_task_id '{dagTaskId}'"
  ├─ 3. execFileSync("bun", "dispatch-subagent.ts", "Meta-Planner", planningDagId, planningPrompt)
  │      注意: Meta-Planner 是 DAG-exempt agent, 不会触发递归 PLAN-FIRST 检查
  ├─ 4. 轮询 findTaskInDag(planningDagId), 间隔 1s, 超时 auto_plan_timeout_ms
  ├─ 5. 成功: 记录到 machine.json.auto_plan_history + writeLog
  └─ 6. 失败: throw Error
```

---

## 六、"agent is not defined" 错误定位

### 关键证据

`dispatch_subagent.ts` (865行) 中 **没有任何代码** 直接产生 "agent is not defined"。
所有 `throw new Error(...)` 都以 `[FW-ENFORCE]` 前缀开头。

### 真正来源: OpenCode 框架层 (execute() 调用之前)

```
OpenCode 框架层
  ├─ 解析 tool("dispatch_subagent") 的 Zod schema
  ├─ 将用户传入的参数匹配到 args 字段
  ├─ 通过 agent_type 查找 Agent 定义文件 (.opencode/agents/{Type}.md)
  └─ ❌ 查找失败 → "agent is not defined"  ← 框架层的通用错误, 不是本文件抛出的
```

### 长参数失败 vs 短参数成功的原因

**假设**: OpenCode 框架的 tool schema 解析器在处理长 `task_description` (多段, 多换行符) 时, 内部字符串解析可能触发截断。当描述过长时, 框架可能将 `agent_type` 字段的值截断或丢失, 导致 agent 查找失败。

### 证据矩阵

| 特征 | 说明 |
|------|------|
| 无 `[FW-ENFORCE]` 前缀 | 不是 execute() 内部的任何 throw |
| 无堆栈, 无行号 | 不是 bun 运行时崩溃 (bun 会输出完整堆栈) |
| 长参数失败, 短参数成功 | 参数解析层问题, 非执行逻辑问题 |
| 首次尝试即失败 | 与 getEnforcementMode 无关 (那时还没修) |

---

## 七、已知风险点

### R1: L744 ctx 文件非原子写入
`writeFileSync(ctxPerDispatchPath, JSON.stringify({...}), "utf8")` — 与其他 4 处原子化修复不一致。

### R2: L821-856 重复 CLI 调用
execute() 内有两个 execFileSync("bun", ...) 调用 (L569 + L833)。第二次调用可能与第一次的参数不同, 导致两次不同的 dispatch 写入。

### R3: L597 错误包装的诊断缺口
`err.stderr?.toString() || err.message` — 当子进程无 stderr 输出时, 退化为 `err.message`, 通常就是 "agent is not defined" 这样的无诊断价值字符串。缺少结构化上下文 (哪个 agent, 哪个 task_id)。

### R4: L272 日志黑盒
工具层验证失败 → execute() 未被调用 → writeLog 未触发 → 日志黑盒。框架层到工具层的边界缺乏可观测性樗。

---

## 八、完整调用链

```
LLM Agent
  │ 调用 dispatch_subagent(agent_type="CI-CD-Agent", task_description="...", dag_task_id="...")
  ▼
【框架层】OpenCode tool schema 解析 + agent 查找
  │ ⚠️ 此层失败 → "agent is not defined" (无日志, 无堆栈)
  ▼
【工具层】dispatch_subagent.ts: execute(args, context)
  │ ├─ 阶段1: PLAN-FIRST Layer 2 检查 (DAG 验证 + auto_plan)
  │ ├─ 阶段2: 安全权限检查 (Orchestrator/SA/KC 门控)
  │ └─ 阶段3: execFileSync("bun", "dispatch-subagent.ts", ...)
  ▼
【脚本层】scripts/command-tools/dispatch-subagent.ts
  │ ├─ 读取 agent config (.opencode/agents/{Type}.md)
  │ ├─ 生成 wrapped prompt (P0 protocol + DISPATCH_TOKEN)
  │ ├─ atomicWriteText(outputFile, tokenizedPrompt)          ← 原子写入
  │ ├─ dbEnqueueDispatch(agentType, dagTaskId, ...)          ← DB 事务写入
  │ └─ 输出文件路径到 stdout
  ▼
【工具层】返回
  │ ├─ 写入 .auto-dispatch.json 标记
  │ ├─ 写入 ctx/{dagTaskId}.json 上下文
  │ ├─ 写入 session_map DB 记录
  │ └─ return wrappedPrompt → Task()
  ▼
【OpenCode】Task(prompt) → 子 Agent 被启动
```

---

## 九、改进建议

| 优先级 | 建议 |
|:---:|------|
| P0 | 在 execute() L272 入口加 `writeLog("DISPATCH-ATTEMPT")` — 即使框架失败也有迹可查 |
| P1 | 在 execFileSync catch (L595) 加 `writeLog("CLI-EXEC-FAILED", { stderr, stdout, args, agent })` |
| P2 | 将 ctx 文件写入改为 atomicWriteJson (与其余4处原子化一致) |
| P2 | 消除 L821-856 的重复 CLI 执行 (或文档化两次调用分别的作用) |
| P3 | 向 OpenCode 框架团队提 issue: tool schema 长参数不可靠 |
