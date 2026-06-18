# UC7-001 写阻断根因分析

**文档版本**: v1.1.0  
**日期**: 2026-06-18  
**调查 Agent**: @Orchestrator  
**状态**: ✅ 已修复/已验证  
**场景**: @Super-Admin (CLEANUP-FW-TASKID-V2) 在执行 FRAMEWORK_TASK_ID 清理时，safe_edit 被 UC7-001 反复阻断，即使已 attest 多个 domain

---

## 背景

FLOW（按用户提示重启后恢复到本文中">

**问题**: @Super-Admin 派遣到 CLEANUP-FW-TASKID-V2 任务，执行 `safe_edit` 修改 `.opencode/scripts/command-tools/dispatch-subagent.ts` 时，UC7-001 写前检查持续阻断，错误信息 "Knowledge cache not searched for task ... domain opencode_framework"（Path B: per-domain data missing），即使 agent 已经:

1. 调用 `module_scope_declare(module="framework_tools")`
2. 调用 `knowledge_cache_search(domain="framework_tools")`
3. 调用 `knowledge_cache_attest(domain="opencode_framework")`
4. 调用 `knowledge_cache_attest(domain="infrastructure")`
5. 调用 `knowledge_cache_attest(domain="state_management")`

## 完整调用链追踪

### dispatch 阶段

```
Orchestrator 调 dispatch_subagent("Super-Admin", "CLEANUP-FW-TASKID-V2")
  │
  ├─ inferDomainId("Super-Admin")
  │    ↓
  │    project.config.json agent_domain_map: "Super-Admin" → "opencode_framework"
  │    ↓
  │    返回 "opencode_framework"
  │
  ├─ 写入 session_map DB:
  │    session_id = ses_1247bbb87ffeppeyP6jnUUUvkU
  │    agent = "Super-Admin"
  │    dag_task_id = "CLEANUP-FW-TASKID-V2"
  │    domain_id = "opencode_framework"    ← 这是 dispatch 时锁定的 domain
  │
  └─ Task() 启动 Super-Admin 子进程
```

### Super-Admin 执行阶段

```
Super-Admin 进程
  │
  ├─ module_scope_declare(module="framework_tools")
  │   ※ 声明了 framework_tools domain
  │   ※ 但不更新 session_map DB 的 domain_id
  │
  ├─ knowledge_cache_search(domain="framework_tools")
  │   ↓
  │   atomicWriteSubState("knowledge_cache_state", fn)
  │   └─ 写入 DB substate_kv.json["framework_tools"] ← 发现数据
  │   ※ 注意: 数据存在 "framework_tools" 键下
  │
  ├─ knowledge_cache_attest(domain="opencode_framework")
  │   ↓
  │   atomicWriteSubState("knowledge_cache_state", fn)
  │   └─ 写入 DB substate_kv: attest "opencode_framework"
  │   ※ 注意: attest 了正确的 domain，但没有对应的 search/discovery
  │   ※ checkUC7KSWrite 需要 sa.tasks[taskId].domains["opencode_framework"] 存在
  │     而该条目可能仅包含 attestation，不包含 discovery → 条件判断结果不确定
  │
  ├─ safe_edit(dispatch-subagent.ts)
  │   ↓ scope-before.ts 触发
  │   │
  │   ├─ resolveTaskId(input.sessionID)
  │   │   → session_map DB → "CLEANUP-FW-TASKID-V2" ✅
  │   │
  │   ├─ resolveDomainId(input.sessionID)
  │   │   → session_map DB → "opencode_framework"
  │   │
  │   └─ checkUC7KSWrite("@Super-Admin", "strict", sesId, "CLEANUP-FW-TASKID-V2", "opencode_framework")
  │       │
  │       ├─ taskId && domainId → true ✅ (两者都有值)
  │       │
  │       ├─ sa?.tasks?.["CLEANUP-FW-TASKID-V2"]?.domains?.["opencode_framework"] ?
  │       │   ← 此值为 **falsy**：数据写在了 "framework_tools" 下，"opencode_framework" 下无数据
  │       │   → 进入 **Path B** (L349-366): per-task per-domain data missing → ❌ BLOCK
  │       │
  │       └─ Path B 错误信息:
  │          "Knowledge cache not searched for task CLEANUP-FW-TASKID-V2 domain opencode_framework"
  │          ※ 不是 Path A1 ("Missing topics: unknown")。Path A1 需要 per-domain 数据存在才触发
  │
  ├─ knowledge_cache_attest(domain="infrastructure")
  ├─ knowledge_cache_attest(domain="state_management")
  ├─ safe_edit 再次尝试 → 仍被阻断?
  └─ ⛔ Task CANCELLED
```

## 最终 DB 状态（事后验证）

任务取消后，DB 中 CLEANUP-FW-TASKID-V2 的最终状态:

| Domain | discovery 状态 | attestation 状态 | missing_topics |
|--------|:-------------:|:----------------:|:--------------:|
| framework_tools | sufficient ✅ | attested ✅ | [] |
| opencode_framework | sufficient ✅ | attested ✅ | [] |
| infrastructure | sufficient ✅ | attested ✅ | [] |
| state_management | sufficient ✅ | attested ✅ | [] |

所有数据最终正确，说明知识管道本身功能正常。

## 根因

### 根因 1 (主要): domain 不一致 — dispatch domain_id vs agent 声明的 module

```
dispatch 时写入 session_map DB:
  domain_id = "opencode_framework"    ← 来自 agent_domain_map (inferDomainId)

agent 运行时调用:
  module_scope_declare(module="framework_tools")     ← 声明了不同的 domain
  knowledge_cache_search(domain="framework_tools")   ← 数据写入 "framework_tools"

checkUC7KSWrite 检查时:
  resolveDomainId() → "opencode_framework"  ← 读 session_map DB
  check 的是: sa?.tasks?.[taskId]?.domains?.["opencode_framework"]
  但数据存在于: domains["framework_tools"]
                                ↑ 两者不匹配 → Path B → BLOCK
```

**agent_domain_map 配置 `"Super-Admin": "opencode_framework"`，但 agent 自行声明的 module 是 `framework_tools`。checkUC7KSWrite 以 session_map DB 中的 domain_id 为准。"opencode_framework" 下无任何数据 → 直接进入 Path B（per-domain data missing）阻断。**

注意：`"framework_tools"` 和 `"opencode_framework"` 在 `VALID_MODULES` 列表中是两个**独立的** domain（module_scope_declare.ts L14-27）。它们不是别名关系。

### 根因 2 (行为层面): Agent 未查询 session_map 获取 dispatch 分配的 domain_id

Agent 在调用 `module_scope_declare` 和 `knowledge_cache_search` 时，应**先查询 session_map DB 获取 dispatch 时锁定的 domain_id**，然后使用该 domain 进行知识管道操作。当前流程中 agent 自行选择 domain（"framework_tools"），与 dispatch 分配的 domain（"opencode_framework"）脱节。

`resolveDomainId()` (agent-resolver.ts L139-161) 已经提供了查询接口，但 agent 工具链（module_scope_declare, knowledge_cache_search）没有在入口处自动读取 dispatch domain 并提示 agent 使用正确的 domain。

### 根因 3 (次要): ~~时序窗口~~ → **不成立**

原文声称 WAL 模式下读写时序可能导致阻断。**经核实此根因不成立**：
- `atomicWriteSubState` 和 `checkUC7KSWrite` 都通过 `getDb()` 单例获取同一 DB 连接
- SQLite 同一连接内 WAL 模式下写入立即可见（无需等待 checkpoint）
- 实际阻断原因是 domain 不匹配（根因 1），不是时序问题

### ~~根因 4 (代码细节): readCacheDiscovery 的嵌套路径~~ → **不成立**

原文声称 legacy fallback 的 `missing_topics` 可能为 undefined 导致 "unknown"。**经核实此根因不成立**：
- uc7ks-schema.ts L445: `missing_topics: legacy.missing_topics || []` — 代码已用 `|| []` 确保始终为数组
- 实际阻断发生在 Path B（per-domain data missing），根本不经过 `readCacheDiscovery()`
- Path B 在 Path A 之前判断（`if (sa?.tasks?.[taskId]?.domains?.[domainId])` 为 falsy 直接进 else 分支）

## 待修复建议

| 优先级 | 修复 | 文件 | 说明 |
|--------|------|------|------|
| **P0** | `module_scope_declare` 执行时自动查询 session_map DB 的 domain_id，若与 `args.module` 不一致则发出警告或自动修正 | `module_scope_declare.ts` | Agent 声明的 module 必须与 dispatch 分配的 domain 一致 |
| **P0** | `knowledge_cache_search` 入口自动注入 session_map domain_id 作为默认 domain 参数 | `knowledge_cache_search.ts` | 避免 agent 手动传入错误 domain |
| **P1** | `checkUC7KSWrite` Path B 阻断消息增加诊断信息：列出 agent 已搜索过的所有 domain 名称 | `uc7ks-utils.ts` L360-365 | 帮助 agent 快速发现 domain 不匹配问题 |
| **P1** | `project.config.json` 中 `agent_domain_map` 与 `knowledge_semantic_map.domains` 交叉校验：确保映射的 domain_id 存在于 VALID_MODULES | `framework-enforcer.ts` 或启动时校验 | 防止 "opencode_framework" vs "framework_tools" 这类配置歧义 |
| P2 | ~~`readCacheDiscovery` 的 legacy fallback 确保 `missing_topics` 始终为数组~~ | ~~`uc7ks-schema.ts`~~ | 已核实：代码 L445 已用 `\|\| []` 保证始终为数组，无需修复 |
| P2 | ~~strict 模式下 UC7-001 阻断应带出自愈提示~~ | ~~`uc7ks-utils.ts`~~ | Path B 的阻断消息（L360-365）已包含具体修复步骤，无需额外添加 |

### 短期 workaround（无需改代码）

Agent 在调用 `module_scope_declare` 前，先使用 `resolveDomainId(sessionID)` 获取 dispatch 分配的 domain_id，然后使用该 domain_id 作为 module 参数：

```
// Agent 正确流程:
1. domainId = resolveDomainId(sessionID)  // → "opencode_framework"
2. module_scope_declare(module=domainId)  // 使用 dispatch 分配的 domain
3. knowledge_cache_search(domain=domainId, task_id=taskId)
4. knowledge_cache_attest(domain=domainId, task_id=taskId, ...)
5. safe_edit(...)  // ✅ PASS
```

## 相关文件索引

| 文件 | 角色 |
|------|------|
| `.opencode/plugins/scope-before.ts` L99-102, L189-200 | UC7-001 写阻断触发点 |
| `.opencode/lib/uc7ks-utils.ts` L199-412 | `checkUC7KSWrite()` 实现（3-path 设计: A=per-domain, B=missing, C=global fallback） |
| `.opencode/lib/uc7ks-schema.ts` L424-452 | `readCacheDiscovery()` 实现 |
| `.opencode/lib/agent-resolver.ts` L139-161 | `resolveDomainId()` 实现 |
| `.opencode/tools/dispatch_subagent.ts` L175-196 | `inferDomainId()` 实现 |
| `.opencode/tools/module_scope_declare.ts` | 不更新 session_map DB domain_id；VALID_MODULES 列表 (L14-27) |
| `.opencode/state/framework-state.db` | substate_kv 表（知识缓存状态） |


---

## 修复实施记录

| 项 | 内容 |
|---|------|
| **实施日期** | 2026-06-18 |
| **实施 Agent** | @Super-Admin (FIX-UC7KS-DOMAIN-MISMATCH-V3) |
| **验收 Agent** | @Orchestrator (VFY-DOMAIN-SELFCHECK-FULL) |
| **文档版本** | v1.1.0 |

### 实施变更

| 修复 | 优先级 | 文件 | 改动 |
|:----:|:------:|------|------|
| Fix 1 | P0 | `module_scope_declare.ts` | 检测不一致(detect) → 写 WARN 日志(warn) → 更新 session_map DB(update) |
| Fix 2 | P0 | `uc7ks-utils.ts` | Path B 降级 Path C：`sa?.uc7_001_compliant=true` 时不再直接阻断 |
| Fix 3 | P1 | `uc7ks-schema.ts` | 已验证 L445 已有 `\|\| []`，无需改动 |
| Fix 4 | P1 | `uc7ks-utils.ts` | Path B 阻断消息追加自愈提示 |
| 工具 | P0 | `resolve_domain_id.ts` | 新建 MCP 查询工具，agent 可自查 domain |
| 文档 | P1 | `subagent-preamble.md` | Step 0a 追加 domain 自查指令；Step 0d 日志表格路径修正 |

### 验收结果

| 场景 | 结果 |
|------|:----:|
| A: domain 一致（正常流程） | ✅ PASS |
| B: domain 不一致（核心修复） | ✅ PASS — 不阻断，日志 DOMAIN-OVERRIDE 已持久化 |
| C: 正常写入流程 | ✅ PASS — UC7-001 通过 |
| full self-test | ✅ 43/45 PASS（2 预存失败无关） |
