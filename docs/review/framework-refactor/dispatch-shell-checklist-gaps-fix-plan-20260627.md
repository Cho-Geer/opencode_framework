# Dispatch / safe_shell / P0 Checklist Gaps — Audit and Fix Plan

**日期**: 2026-06-27  
**范围**: dispatch route mismatch, safe_shell read-only false positives, P0 checklist startup friction, report writing limitations, TypeScript baseline drift  
**结论**: gaps 大体属实，但需要按当前代码重新分类。`dispatch ROUTE-MISMATCH`、`safe_shell` 只读命令误伤、P0 checklist 主会话/无 dispatch context 摩擦仍是核心问题；`cat > file << EOF` 被拦截不是误伤，是 strict 模式下 backup-bypass 的预期阻断；原先的 `uc7ks-after.ts + scout-trigger.ts` TS 语法错误已不复现，当前 `tsc` 失败原因变为根 `tsconfig.json` 找不到 `bun-types`。

---

## 1. 审核限制与运行证据

### 1.1 合规入口不可用

尝试执行：

```bash
/compliance-gate "审核 dispatch route、safe_shell、P0 checklist gaps 并生成修复方案"
```

结果：

```text
/bin/bash: line 1: /compliance-gate: No such file or directory
```

本次因此是本地代码审核与命令验证，未能通过 `/compliance-gate` CLI 武装门禁。

### 1.2 当前验证命令

```bash
bun --check .opencode/lib/tool-scope.ts
bun --check .opencode/lib/route-validator.ts
```

结果：均通过，无输出。

```bash
bun .opencode/scripts/framework-self-test.ts
```

结果：

```text
❌ 1 of 70 CHECKS FAILED
[FAIL] 48 — 14 issue(s): ... STALE (>24h old, may indicate missing cleanup) ...
[PASS] 49 — Plugin Registration: all 24 plugins on disk match opencode.json registry
[PASS] 67 — hook-config-guard: FW-PLUGIN-PARTS-GUARD (output.parts mutation guard) intact
[PASS] 68 — p0-evidence-injector: correctly removed from disk and opencode.json
[PASS] 69 — plugin parts scan: no output.parts mutations detected in any plugin
```

```bash
npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile .opencode/state/.tsbuildinfo
```

当前结果：

```text
error TS2688: Cannot find type definition file for 'bun-types'.
```

---

## 2. 官方 OpenCode 规范约束

### 2.1 Plugin hook 参数位置

`docs/official_docs/opencode/plugins/plugin-hook-reference.md:254-262`：

```text
Args location | tool.execute.before: output.args | tool.execute.after: input.args
Throwing | before: BLOCKS tool execution | after: Cannot block
```

修复要求：
- 所有 before hook 读工具参数必须用 `output.args`。
- after hook 才用 `input.args`。
- 不能在 after hook 里假装阻断已执行的工具，只能记录和更新状态。

### 2.2 Plugin output.parts 禁改

`docs/official_docs/framework/plugin-programming-conventions.md:128-151`：

```text
所有插件禁止修改 output.parts。
合法替代方案: writeLog(), client.app.log(), output.context.push() only in compaction hooks.
```

修复要求：
- 不允许用插件向用户消息注入提醒。
- 所有审计和诊断必须走 `writeLog()` 或 DB event table。

### 2.3 Tool args 形状

`docs/official_docs/framework/mistake_precautions/plugin-debugging-precautions.md:504-519` 列出工具 args：

```text
safe_edit -> { filePath, mode, ... }
safe_shell -> { command, timeout?, dryRun? }
grep -> { pattern, path?, include? }
```

修复要求：
- shell 命令解析不能复用普通 filePath 逻辑。
- `safe_shell` 必须先判定“只读/写入/不可解析”，再进入 scope 和 backup policy。

### 2.4 MCP tool 代码规范

当前 MCP 工具示例 `.opencode/scripts/mcp-tools/code-quality-check.ts:15-22` 使用：

```text
Server
StdioServerTransport
CallToolRequestSchema
ListToolsRequestSchema
```

修复要求：
- 如果新增验证工具或 harness MCP，必须保持 stdio transport。
- `ListTools` 只列公开工具；内部 helper 不暴露成 MCP tool。
- MCP stdout 只输出协议内容；日志用 stderr 或 `writeLog()`。

---

## 3. Gap A — dispatch ROUTE-MISMATCH

### 3.1 判定

**属实，但根因不只是 scope-to-agent 缺框架只读验证路由。** 当前代码存在三个叠加问题：

1. 错误消息拼接会制造 `@@Agent`。
2. route validation 把 Orchestrator 移出 exempt，导致主调度员执行审计派遣也走 L1-L4 强匹配。
3. `.opencode/` 只有“维护/修复”路由到 Super-Admin，没有“只读验证/审计”路由语义，Guardian/explore/general 这类验证场景容易被误判。

### 3.2 代码证据

`.opencode/plugins/dispatch-before.ts:154-158`：

```text
if (routeConfig?.enforcement?.dispatch === "block") {
  if (!isDispatchRouteExempt(caller, routeConfig) && !m14ApprovedKC) {
```

`.opencode/project.config.json:1052-1053`：

```text
"dispatch_exempt_agents": ["@Meta-Planner", "@Super-Admin"]
"@Orchestrator removed ... Orchestrator must now undergo route validation"
```

`.opencode/plugins/dispatch-before.ts:214-218`：

```text
dispatch_subagent to @${target} is incorrect.
Selected: @${finalAgent}.
```

如果 `target` 或 `finalAgent` 已经是 `@Coder-BE`，错误文本自然变成 `@@Coder-BE`。

`.opencode/project.config.json:1148-1152`：

```text
"scope": ".opencode/",
"agent": "@Super-Admin",
"desc": "Agent configs, rules, plugins, scripts, state"
```

当前 scope 只表达文件归属，不表达 read-only audit 与 write/repair 的不同目的。

### 3.3 修复方案

#### Step A1 — 修复显示层双 @

新增统一 display helper，禁止错误消息手拼 `@${agent}`：

```ts
function formatAgent(agent: string): string {
  const name = toDisplayName(agent);
  return name ? "@" + name : "";
}
```

替换 `dispatch-before.ts` 中 `@${target}`、`@${finalAgent}`。日志字段保留 normalized/display 两个值：

```ts
writeLog("dispatch-before", "runtime", {
  event: "ROUTE-MISMATCH",
  target_agent: formatAgent(target),
  expected_agent: formatAgent(finalAgent),
  ...
});
```

#### Step A2 — 增加 dispatch purpose 维度

在 `route-validator.ts` 增加 `inferDispatchPurpose(task_description, target_files)`：

```ts
type DispatchPurpose = "read_audit" | "write_repair" | "business_impl" | "ci_cd" | "unknown";
```

判定原则：
- 包含 `audit/review/验证/审查/调查/diagnose` 且没有 write verbs，且 target 是 `.opencode/**` / docs，则 `read_audit`。
- 包含 `fix/repair/修改/补丁/恢复` 且 target 是 `.opencode/**`，则 `write_repair`。
- 目标路径在 business root 且包含 implement/build/code，走 business impl。

#### Step A3 — 框架只读验证合法路由

在 `project.config.json.route_rules` 增加目的路由表，不要把它塞进 `scope_to_agent`：

```json
"purpose_to_agent": {
  "framework_read_audit": {
    "agents": ["@Guardian", "@Super-Admin"],
    "allowed_tools": ["read", "grep", "glob", "safe_hash", "checklist_status"],
    "deny_tools": ["safe_edit", "safe_delete", "safe_mkdir", "safe_shell"]
  },
  "framework_write_repair": {
    "agents": ["@Super-Admin"]
  }
}
```

在 L1 和 L2 之间插入 L1.5：

```ts
const purpose = inferDispatchPurpose(taskDesc, targetFiles);
const purposeCandidates = filterByPurpose(l1Candidates, purpose, routeConfig);
```

这样框架只读审计可派 Guardian/Super-Admin，框架写修复仍只允许 Super-Admin。

#### Step A4 — 保持安全性

- 不恢复 Orchestrator 全量 exempt。
- 不允许 Coder-BE/Coder-FE 读取或写 `.opencode/**` 作为默认路由。
- 只读验证代理必须由 permission matrix 限制为 read/grep/glob/safe_hash 等 read-only 工具。
- 所有 route 决策写 `writeLog("route-validator", ...)`，并记录 `purpose`, `l1`, `l1_5`, `l2`, `l3`, `selected`。

---

## 4. Gap B — safe_shell 误伤只读命令

### 4.1 判定

**部分属实。**

属实的误伤：
- `grep ... 2>/dev/null`
- `ls ... 2>&1`
- `npx tsc --noEmit ...`
- `bun --check file.ts`
- `node -e` / `bun -e` 中只读 require/readFileSync 场景

不是误伤：
- `cat > file << EOF` 是明确写入；strict 模式阻断符合 backup-bypass 策略。

### 4.2 代码证据

`.opencode/lib/tool-scope.ts:84-93`：

```text
if (/>>|>\s*[^\s&|]/.test(cmd)) return true;
const modifyRe = /^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch|mkdir)\b/;
```

该正则会把 `2>/dev/null`、`2>&1` 中的 `>` 当作写重定向。

`.opencode/lib/tool-scope.ts:345-360`：

```text
node -e / bun -e ... → unparseable_modify_shell
node/bun/python3/npx script execution → unparseable_modify_shell
```

因此 `npx tsc --noEmit` 和 `bun --check` 会被归类为不可解析写操作，随后进入 backup-bypass。

`.opencode/plugins/scope-before.ts:101-137`：

```text
if (applyPathScope && scopeResult.reason === "unparseable_modify_shell") {
  ...
  throw new Error("[FW-ENFORCE][BACKUP-BYPASS] ...")
}
```

### 4.3 修复方案

#### Step B1 — shell lexer 增加 stderr 重定向识别

在 `tool-scope.ts` 增加 `isBenignFdRedirect()`：

```ts
function stripBenignFdRedirects(command: string): string {
  return command
    .replace(/\s+\d?>\s*\/dev\/null\b/g, "")
    .replace(/\s+\d?>&\d\b/g, "");
}
```

`isModifyShell()` 和 `parseShellWriteTargets()` 先对命令做该规范化。保留对 `> file`、`>> file`、`cat > file`、`tee file` 的写入识别。

#### Step B2 — 只读命令 allow profile

增加 `classifyShellCommand()`：

```ts
type ShellClassification =
  | { kind: "read_only"; reason: string }
  | { kind: "write"; paths: string[] }
  | { kind: "unparseable_write"; reason: string };
```

只读白名单：
- `npx tsc --noEmit *`
- `bun --check *.ts`
- `node -e` / `bun -e` 仅当源码不包含写 API：`writeFile`, `appendFile`, `rm`, `unlink`, `rename`, `mkdir`, `cp`, `createWriteStream`, `exec`, `spawn`, `child_process`
- `grep/rg/ls/cat` + benign stderr redirects

#### Step B3 — safe-bash 与 scope-before 共用同一分类器

当前 `safe-bash-core` 和 `scope-before` 是两套判断。修复后：
- `safe-bash-core` 负责 permission/dangerous/allowlist 和实际执行。
- `scope-before` 调用同一个 `classifyShellCommand()`，只对 `write` / `unparseable_write` 做 backup-bypass。
- 分类结果写日志：

```ts
writeLog("tool-scope", "DEBUG", {
  event: "SHELL-CLASSIFIED",
  detail: `kind=${kind} reason=${reason}`,
});
```

#### Step B4 — 保持 strict 安全

- `cat > file << EOF`、`tee file`、`sed -i file`、`node -e writeFileSync(...)` 继续阻断。
- `node -e require('./.opencode/lib/...')` 只读可放行，但必须禁止 `child_process` 和 FS 写 API。
- 不通过扩大 `safe_shell: allow` 解决，否则会破坏 Permission Matrix。

---

## 5. Gap C — P0 Checklist 启动障碍

### 5.1 判定

**部分属实。** 当前代码已经为主会话做了部分自愈，但无 dispatch context / 无 session_map domain 的情况下仍会产生启动摩擦。

### 5.2 代码证据

`.opencode/lib/execution-checklist.ts:157-181` preflight 阶段要求：

```text
dag_entry_verified
agent_scope_resolved
domain_resolved
module_scope_declared
```

`.opencode/plugins/session.ts:563-624` 已尝试自动标记 DAG-exempt 主会话：

```text
agent_scope_resolved: session_map now has the agent record
domain_resolved: DAG-exempt agents have a fixed domain
module_scope_declared: same domain is used as module scope
```

`.opencode/tools/resolve_domain_id.ts:84-107` 只从 `session_map` 或 dispatch ctx 解析 domain：

```text
Priority 1: session_map DB
Priority 2: resolveDomainId() checks ctx files
```

如果当前会话没有 session_map/dispatch ctx，`resolve_domain_id()` 会返回 null。

`knowledge_cache_attest.ts:137-159` 明确拒绝空 `files_read`：

```text
files_read is empty. Agent must read at least one cache file via 'read' tool before attesting.
```

`knowledge_cache_attest.ts:412-495` 在 strict/locked 下强制 mandatory knowledge：

```text
Missing mandatory knowledge files ... Read the files via 'read' tool and re-attest
```

`.opencode/project.config.json:1015-1024` 配置了 `opencode_framework` 的 3 个 mandatory files：

```text
plugin-debugging-precautions.md
double-hook-trigger-prevention.md
opencode-plugin-loading-bun-cache.md
```

用户观察到“额外要求 2 份错题集”可能是因为第一次已读了其中 1 份，剩余 2 份仍缺失。

### 5.3 修复方案

#### Step C1 — 主会话 domain fallback

在 `resolve_domain_id.ts` 加一个明确、低风险 fallback：

```ts
if (!domainId) {
  const agentKey = toDisplayName((context as any)?.agent || "");
  const domain = projectConfig.agent_domain_map?.[agentKey] ||
    projectConfig.agent_domain_map?.["@" + agentKey] ||
    projectConfig.agent_domain_map?.[normalize(agentKey)];
  if (domain) {
    domainId = domain;
    resolvedFrom = "agent_domain_map";
    confidence = "medium";
  }
}
```

限制：
- 只对 DAG-exempt 主会话或没有 `parent_session_id` 的主会话启用。
- 如果 session_map 已有 domain，以 session_map 为准，避免不同 agent/task 并发串线。

#### Step C2 — checklist policy 化

新增 `.opencode/project.config.json.p0_checklist_policy.main_session_auto_pass`：

```json
{
  "agents": ["@Orchestrator", "@Super-Admin"],
  "items": ["dag_entry_verified", "agent_scope_resolved", "domain_resolved", "module_scope_declared"],
  "source": "session_map + agent_domain_map"
}
```

`session.ts` 不应硬编码这些规则，而应读 policy。自动通过必须写入 `execution_checklist_events`，actor 为 `session.ts:chatMessageHook`。

#### Step C3 — mandatory knowledge 明确提示

`knowledge_cache_attest` 返回中加入：

```json
{
  "mandatory_total": 3,
  "mandatory_read": 1,
  "mandatory_missing": [...]
}
```

避免用户误以为“额外多出 2 份”，实际是 mandatory set 的剩余项。

#### Step C4 — 保持 read evidence 安全

不建议取消 `files_read` 真实 read 校验。正确优化是：
- `knowledge_cache_search` 返回 mandatory files 的完整列表。
- `knowledge_cache_attest` 用 read-audit DB 校验 `files_read` 确实来自当前 session 的 `read` tool。
- checklist_status 在 blocker remediation 中直接列出缺失文件。

---

## 6. Gap D — strict 模式无法用 safe_shell 写报告

### 6.1 判定

**属实，但这是安全策略的正确阻断，不应放宽。**

`cat > file << EOF` 是明确写操作。strict 模式下 shell 写文件没有 safe_edit 的备份与审计语义，因此应继续阻断。

### 6.2 代码证据

`.opencode/lib/tool-scope.ts:320-324`：

```text
cat file > dst or cat file >> dst → unparseable_modify_shell
```

`.opencode/plugins/scope-before.ts:141-163`：

```text
safe_shell/bash have NO backup mechanism
Use safe_edit or safe_delete instead
```

### 6.3 修复方案

- 不允许 `safe_shell cat >` 写报告。
- 报告生成统一走 `safe_edit` / OpenCode native edit/write tool。
- 如需批量生成长文档，新增 framework tool `safe_write_report`，内部调用 `safe_edit` 同级的 backup/lock/audit 组件，而不是 shell redirect。
- `safe_write_report` 必须：
  - 写入前创建 backup。
  - 记录 write_audit_state / DB event。
  - 受 Permission Matrix 约束，只允许 `docs/review/**`。
  - 在 strict/locked 下仍要求 P0 checklist 与 knowledge attest。

---

## 7. Gap E — TypeScript baseline drift

### 7.1 判定

**原描述已过期。** 当前不再复现 `uc7ks-after.ts + scout-trigger.ts` 语法错误；当前错误是 Bun 类型依赖解析不一致。

### 7.2 代码证据

根 `tsconfig.json:12`：

```json
"types": ["node", "bun-types", "jest"]
```

根 `package.json:2-7` 未声明 `bun-types`：

```json
"devDependencies": {
  "@opencode-ai/plugin": "*",
  "@types/jest": "^30.0.0",
  "ts-jest": "^29.4.11",
  "typescript": "^6.0.3"
}
```

`.opencode/package.json:8-10` 声明了 `bun-types`：

```json
"devDependencies": {
  "@types/node": "^25.9.1",
  "bun-types": "^1.3.14"
}
```

实际依赖存在于 `.opencode/node_modules/bun-types`，根 `node_modules` 不存在 `bun-types`。

### 7.3 修复方案

推荐二选一：

#### 方案 E1 — 根 package 统一依赖

在根 `package.json.devDependencies` 增加：

```json
"bun-types": "^1.3.14"
```

然后用同一个根 `bun.lock` 管理依赖。优点是根 `npx tsc` 与 `runTscDiagnostic()` 当前命令保持一致。

#### 方案 E2 — framework 专用 tsconfig

新增 `tsconfig.framework.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "typeRoots": ["./node_modules/@types", "./.opencode/node_modules"]
  }
}
```

并把 `runTscDiagnostic()` 的命令改为：

```bash
npx tsc -p tsconfig.framework.json --noEmit --incremental --pretty false --tsBuildInfoFile .opencode/state/.tsbuildinfo
```

推荐 E1。E2 会增加配置分支，后续维护成本更高。

---

## 8. 子系统符合性矩阵

| 子系统 | 修复要求 |
|---|---|
| Layout Architecture Subsystem | 保持 plugin -> lib -> tool/MCP -> DB manager 分层；route purpose 分类放 `route-validator.ts`，shell 分类放 `tool-scope.ts`，不要在插件里堆复杂解析 |
| DB-only and DB-canonical based | checklist、session_map、read-audit、write-audit 继续以 SQLite 为 source of truth；禁止恢复 JSON dual-write |
| Permission Matrix Subsystem | 只读框架审计用 purpose + allowed_tools 限权；safe_shell 只放行经分类器证明只读的命令 |
| Session/Same-Agent/Different-Agent/Task Concurrency Safe | domain fallback 只对主会话生效；有 session_map 时永远优先 session_map，避免并发 task 串线 |
| Hardened Enforcement Subsystem | `cat >`、`tee`、`sed -i`、FS 写 API 继续阻断；修复只读误伤而不是放宽 shell |
| Framework Harness Subsystem | 增加 route-purpose、shell-classifier、main-session checklist、tsc baseline 的 self-test/E2E |
| Central State Management Subsystem | 自动标记 checklist item 必须写 execution_checklist_events；read evidence 继续走 read_audit |
| Multi-Agent Subsystem | Orchestrator 不恢复全 exempt；只读审计可派 Guardian/Super-Admin，写修复仍只派 Super-Admin |
| Log Central Management Subsystem | 新增 `ROUTE-PURPOSE-SELECTED`、`SHELL-CLASSIFIED`、`CHECKLIST-MAIN-SESSION-AUTO-PASS`、`MANDATORY-KNOWLEDGE-MISSING` 结构化日志 |
| DB-canonical Management Subsystem | route/checklist/knowledge 修复不得读取 frozen JSON state；只读配置可读 project.config/opencode.json |
| Templatization & Parameterization Universality Subsystem | 新增 route purpose 和 shell classifier policy 均放 project.config，可跨项目覆盖 |
| TypeScript + Bun Based Runtime Subsystem | 修复 `bun-types` 根依赖或 tsc project 配置；`bun --check` 与 `npx tsc` 都必须纳入验收 |

---

## 9. 实施顺序

1. **Route display hotfix**: 修复 `@@Agent` 文案，增加 self-test 覆盖。
2. **Route purpose layer**: 增加 `inferDispatchPurpose()` 与 `purpose_to_agent` 配置，先只覆盖 `framework_read_audit`。
3. **Shell classifier**: 在 `tool-scope.ts` 增加 benign fd redirect strip 与 `classifyShellCommand()`。
4. **Scope-before integration**: `scope-before.ts` 改用 classifier；只对 write/unparseable_write 触发 backup-bypass。
5. **Checklist main-session policy**: 将 `session.ts` 主会话 auto-pass 配置化；`resolve_domain_id` 增加 agent_domain_map fallback。
6. **Knowledge attest UX**: 返回 mandatory total/read/missing，remediation 列完整文件。
7. **TS baseline**: 根 package 增加 `bun-types` 或引入 `tsconfig.framework.json`。
8. **Harness**: 增加以下测试：
   - route: `.opencode/**` read audit -> Guardian/Super-Admin read-only allowed；write repair -> Super-Admin only。
   - route: error text 不出现 `@@`。
   - shell: `grep ... 2>/dev/null`, `ls ... 2>&1`, `npx tsc --noEmit`, `bun --check` classified read-only。
   - shell: `cat >`, `tee`, `sed -i`, `node -e writeFileSync` blocked。
   - checklist: Orchestrator main session can auto-pass preflight from session_map + agent_domain_map。
   - knowledge: mandatory files missing response includes counts and file list。
   - tsc: root command succeeds or fails only on real TS diagnostics, not missing `bun-types`。

---

## 10. 验收命令

```bash
bun --check .opencode/lib/route-validator.ts
bun --check .opencode/lib/tool-scope.ts
bun --check .opencode/plugins/scope-before.ts
bun --check .opencode/plugins/dispatch-before.ts
npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile .opencode/state/.tsbuildinfo
bun .opencode/scripts/framework-self-test.ts
```

新增 E2E 建议使用隔离 DB：

```bash
FRAMEWORK_DB_PATH=/tmp/framework-gap-fix-e2e.db bun .opencode/scripts/e2e/dispatch-shell-checklist-e2e.ts
```

---

## 11. 不建议的修复

- 不要把 Orchestrator 恢复成全量 route exempt；这会绕过 dispatch governance。
- 不要把 `safe_shell` 设为全 allow；这会破坏 Permission Matrix 和 backup-bypass。
- 不要允许 `cat > file` 在 strict 模式写报告；报告应走 safe_edit/native edit。
- 不要取消 mandatory knowledge 或 `files_read` 校验；应优化提示和自动列出缺失项。
- 不要用 plugin 修改 `output.parts` 注入提醒；官方规范和自测均禁止。

---

## 12. 当前 gap 状态摘要

| Gap | 当前判定 | 修复优先级 |
|---|---|---:|
| A dispatch ROUTE-MISMATCH | 属实，且 `@@` 是显示 bug + route purpose 缺失 | P0 |
| B safe_shell 误伤只读命令 | 部分属实；stderr redirect/tsc/bun check 属实，`cat >` 不是误伤 | P0 |
| C P0 checklist 启动障碍 | 部分属实；已有主会话 auto-pass，但无 dispatch context/domain fallback 仍有摩擦 | P1 |
| D 报告写入受限 | 属实但预期；应改用 safe_edit/report tool，不应放宽 shell | P1 |
| E 预存 TS 语法错误 | 当前不属实；新问题是 `bun-types` 根依赖解析 | P1 |

*本方案按当前代码与本地验证输出生成，后续实现需以隔离 DB E2E 验收为准。*
