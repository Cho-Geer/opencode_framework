# P2-D 权限源反转统一实施方案（v2.1 — 再审修订版）

**日期**: 2026-06-17
**版本**: v2.1（基于二次审核修订：补充 shell deny/ask veto、L3 实际文件输入、L2 route-scope 语义隔离）
**状态**: Implementation Plan (awaiting final review)
**前置文档**: execution-priority-analysis.md, framework-evaluation-report.md §1/§2
**预估工时**: 9h（含权限语义矩阵 + 7 消费者迁移 + 格式适配器 + glob/route-scope 语义隔离 + 日志集成 + 等价性测试 + 验证）
**审核变更摘要**: 修正 glob 匹配语义、safe_shell:allow 语义、ask/deny 处理、fail-closed 策略、route-validator 输入语义、测试覆盖、执行顺序

---

## 一、目标

关闭 3 个问题（§1 L-2 配置职责模糊 + §1 L-4 authority 声明矛盾 + §2 P-4 双配置源），一次性消除 `opencode.json` 与 `project.config.json` 的权限数据分裂。

**核心原则**: opencode.json 为所有 per-agent 权限数据的唯一权威源（上游 OpenCode 强制约束）。

**v2/v2.1 修正**: P2-D 必须仅改变权限**来源**，不得顺手改变权限**语义**（glob 匹配精度、allow 含义、ask/deny 处理、失败策略、route-scope 语义）。所有语义变更必须通过独立的等价性矩阵验证。

---

## 二、上游约束（不可违反）

1. `opencode.json` 必须保留完整权限数据 — 上游 OpenCode CLI 直接读取 `agent.*.permission` 块
2. `{env:VAR}` / `{file:path}` 仅做字符串替换，无法注入 JSON object/array
3. `project.config.json` 不在上游 8 个预设 config 位置中
4. 移除 `safe_edit`/`safe_shell` 等权限块会让上游回落到 permissive defaults（`'allow'`）

---

## 三、权威源划分（Post-P2-D 目标架构）

| 数据类型 | 权威源 | 位置 | 理由 |
|----------|--------|------|------|
| Per-agent 写入范围 (safe_edit/safe_delete/safe_mkdir) | **opencode.json** | `agent.*.permission.safe_*` | 上游直接读取 |
| Per-agent 命令权限 (safe_shell) | **opencode.json** | `agent.*.permission.safe_shell` | 上游直接读取 |
| Per-agent 测试权限 (safe_test) | **opencode.json** | `agent.*.permission.safe_test` | 上游直接读取 |
| 框架执法模式 | project.config.json | `template_resolution.enforcement_mode` | 非 agent 权限 |
| 调度路由规则 | project.config.json | `route_rules` | 非 agent 权限 |
| Shell 基础 allowlist | project.config.json | `safe_shell.default_allowlist` | 项目级基线 |
| Shell 危险命令模式 | project.config.json | `safe_shell.dangerous_patterns` | 执法引擎策略 |
| Shell 写入检测模式 | project.config.json | `safe_shell.write_patterns` | 执法引擎策略 |
| Shell 允许脚本路径 | project.config.json | `safe_shell.allowed_script_paths` | 执法引擎策略 |
| Shell agent 危险命令绕过 | project.config.json | `safe_shell.agent_dangerous_bypass` | 执法引擎覆写 |
| Shell agent 允许脚本 | project.config.json | `safe_shell.agent_allowed_scripts` | 执法引擎覆写 |

**删除**: project.config.json 中 `agent_write_scopes`（全部，L694-872，178行）和 `safe_shell.agent_allowlists`（子键，79条）

**保留**: project.config.json 中 `safe_shell` 的 6 个框架策略子键（非 per-agent 权限数据）

---

## 四、权限语义兼容矩阵（v2 新增 — 审核 Blocker/High 修正）

> **审核洞察**: "当前计划最大问题不是'源倒置'，而是会顺手改变 glob、allow、ask 和失败处理语义。" 本节定义源反转前后每条语义的精确等价性要求，任何不等价的语义变更必须拆分为独立修复步骤。

### 4.0.1 写入路径匹配语义矩阵

| 语义维度 | Before P2-D (gate-checks.ts) | After P2-D (permission-reader.ts) | 等价性要求 |
|----------|------|------|------|
| 匹配算法 | `matchGlob()` — `**` = `.*`(跨目录), `*` = `[^/]*`(单段), `\.`转义 | `pathMatchesGlob()` from gate-core.ts — **完全相同算法** | ✅ 必须等价 |
| 匹配顺序 | deny-first priority → allow → default deny | deny-first priority → allow → default deny | ✅ 必须等价 |
| 路径标准化 | `filePath.startsWith(root+"/") → relPath` | `filePath.startsWith(root+"/") → relPath` | ✅ 必须等价 |
| root 获取 | `process.env.OPENCODE_ROOT || process.cwd()`（惰性，每次调用） | `resolveFrameworkPaths().root` from gate-core.ts（支持 cwd walk-up） | ⚠️ 安全增强 |
| 无 scope 定义 | `scopes` 为 null → `return true` | `permBlock` 为 undefined → `return true` | ✅ 必须等价 |
| scopes 存在但无匹配 | `return false`（default deny） | `return false`（default deny） | ✅ 必须等价 |

**❌ v1 使用 `includes()` 子串匹配（Blocker 1）**: `scope.includes(pattern)` 对 glob patterns 如 `booking_system_refactor/booking-backend/src/**` 永远无法正确匹配实际文件路径。必须使用 `pathMatchesGlob()` 共享函数。

**关联修复**: `route-validator.ts` L3 (`l3_permissionFilter`) 当前也使用 `scope.includes(pattern)`（L170）— 这是**预存 bug**，不在 P2-D 范围内但应在同一 commit 中一并修复（详见 Step 0A）。

### 4.0.2 Shell 权限语义矩阵

| 语义维度 | Before P2-D (safe-bash-core.ts) | After P2-D (permission-reader.ts) | 等价性要求 |
|----------|------|------|------|
| `safe_shell: "allow"` 含义 | 不在 `agent_allowlists` 中 → 仅 default_allowlist | **"allow" = 工具允许，所有命令可运行** → 返回 `{allAllowed: true}` 标记 | ⚠️ 语义不等价（见下） |
| `safe_shell: "deny"` 含义 | 不在 `agent_allowlists` 中 → 仅 default_allowlist | **"deny" = 工具禁止** → 返回空 allowlist | ⚠️ 行为不等价（见下） |
| `"ask"` 命令条目 | 不存在（旧格式无 ask） | `"ask"` = 需用户确认，非自动允许 | ❌ 不应等同于 "allow"（High 1） |
| 无 shell 定义 | 仅 default_allowlist | 仅 default_allowlist | ✅ 必须等价 |
| default_allowlist 来源 | project.config.json `safe_shell.default_allowlist` | project.config.json（不变） | ✅ 必须等价 |

**❌ v1 误读 `safe_shell: "allow"` 语义（Blocker 2）**: v1 将 `"allow"` 解读为"仅 default 命令允许"，返回空 allowlist。但 OpenCode 语义中 `safe_shell: "allow"` 表示"此工具被允许"（permissive），等同于所有命令均可运行。对 @Meta-Planner 和 @CI-CD-Agent（opencode.json 中 `safe_shell: "allow"`），旧 `agent_allowlists` 也不限制它们（使用硬编码 fallback 中的广泛 allowlist），行为实际上是 permissive 的。正确处理：`"allow"` → 返回 `{allAllowed: true}` 标记，`getAllowlist()` 合并时若检测此标记则跳过 allowlist 检查。

**❌ v1 将 `"ask"` 等同 `"allow"`（High 1）**: opencode.json 中 `"ask"` 意为"需用户确认"。在非交互式框架上下文中（safe-bash-core.ts 自动执行），`"ask"` 命令无法触发确认提示。正确处理：`"ask"` 条目不纳入 allowlist，返回独立的 `needsConfirmation` 列表。在非交互上下文中 `"ask"` = default deny（安全降级）。交互上下文（OpenCode CLI）中 `"ask"` = 确认提示（由 CLI 处理，框架无需介入）。

### 4.0.3 失败处理语义矩阵

| 语义维度 | Before P2-D | After P2-D (permission-reader.ts) | 等价性要求 |
|----------|------|------|------|
| opencode.json 不可读 | 不读 opencode.json（读 project.config.json） | **fail-closed**（strict/locked） / **fail-open**（advisory） | ⚠️ 新增行为（High 2） |
| agent 无 permission block | 无 `agent_write_scopes` → `return true`（fail-open） | 无 `agent.*.permission` → enforcement_mode 决定 | ⚠️ 需区分模式 |
| root 路径解析 | `process.env.OPENCODE_ROOT || process.cwd()`（每次调用） | `resolveFrameworkPaths().root` from gate-core.ts（支持 cwd walk-up） | ⚠️ 安全增强 |

**❌ v1 始终 fail-open（High 2）**: 配置不可读时 `return true`（允许所有写入），在 strict/locked 模式下是安全漏洞。正确处理：引入 enforcement_mode 感知 — `readOpencodeConfig()` 失败时，strict/locked 模式下 `return false`（fail-closed），advisory 模式下 `return true`（fail-open，与旧行为等价）。`resolveFrameworkPaths().root` 替代 `const ROOT = process.env.OPENCODE_ROOT || process.cwd()`（模块加载时或从 `.opencode/` 启动时 `process.cwd()` 可能指向错误目录）。

---

## 五、格式差异与适配策略

### 5.1 写入权限格式差异

| 源 | 格式 | 示例 |
|----|------|------|
| project.config.json `agent_write_scopes` | `{allowed: string[], denied: string[]}` bifurcated | `{allowed: ["booking-backend/src/**"], denied: [".opencode/**"]}` |
| opencode.json `permission.safe_edit` | `{pathPattern: "allow"|"deny"|"ask"}` flat map | `{"booking-backend/src/**": "allow", ".opencode/**": "deny"}` |

**适配策略**: 创建 `lib/permission-reader.ts` 共享模块，提供 `permissionMapToBifurcated()` 转换器。消费者可选择：
- 方案 A：直接使用 flat map + `pathMatchesGlob()`（与 `gate-checks.ts` 现有 `matchGlob` 算法一致）
- 方案 B：通过转换器获取 bifurcated 格式（保持现有 `isWriteAllowed` 逻辑不变）

**选择方案 A** — 重写 `isWriteAllowed()` 直接使用 flat map，使用 `pathMatchesGlob()` 共享 glob 匹配函数（替代 v1 的 `includes()` 子串匹配）。与 `l3_permissionFilter` 实现一致。

### 5.2 Shell 命令权限格式差异

| 源 | 格式 | 示例 |
|----|------|------|
| project.config.json `safe_shell.agent_allowlists` | `Record<string, string[]>` per-agent string arrays | `{"@Coder-BE": ["npx jest *", "cat *"]}` |
| opencode.json `permission.safe_shell` | `{cmdPattern: "allow"|"deny"|"ask"}` flat map **或** `"allow"|"deny"` 简单字符串 | `{"npx jest *": "allow", "rm -rf *": "ask"}` 或 `"allow"` |

**v2.1 适配策略（修正 v1 Blocker 2 + High 1，补充 deny/ask veto）**:

```typescript
export interface ShellAllowlistResult {
  /** Commands explicitly allowed (action="allow") */
  allowed: string[];
  /** Commands explicitly denied (action="deny") — veto default_allowlist */
  denied: string[];
  /** Commands requiring confirmation (action="ask") — NOT auto-allowed */
  needsConfirmation: string[];
  /** "allow" string → all commands permitted, skip allowlist check */
  allAllowed: boolean;
  /** "deny" string → tool prohibited */
  toolDenied: boolean;
}
```

提取规则：
- `"allow"` 简单字符串 → `{allAllowed: true, allowed: [], denied: [], needsConfirmation: [], toolDenied: false}` — `getAllowlist()` 检测此标记后跳过 allowlist 检查
- `"deny"` 简单字符串 → `{allAllowed: false, allowed: [], denied: [], needsConfirmation: [], toolDenied: true}` — 工具本身禁止
- flat map 中 `"allow"` action → 纳入 `allowed` 列表
- flat map 中 `"deny"` action → 纳入 `denied` 列表，**deny-first veto default_allowlist**
- flat map 中 `"ask"` action → 纳入 `needsConfirmation` 列表，**不纳入 `allowed`**

**非交互式上下文处理** (`safe-bash-core.ts`):
- `toolDenied: true` → 完全禁止 shell 工具
- `denied` 条目 → agent 级显式 deny，优先于 `default_allowlist`，记录 `SHELL-CMD-DENIED-BY-PERMISSION`
- `needsConfirmation` 条目 → 在非交互上下文中视为 deny（安全降级），优先于 `default_allowlist`，记录 `ASK-CMD-BLOCKED-IN-AUTO-CTX`
- `allAllowed: true` → 跳过 allowlist 检查（仍检查 dangerous_patterns）

**v2.1 关键约束**: `default_allowlist` 是项目级基线，不得覆盖 `opencode.json agent.*.permission.safe_shell` 中的 per-agent `deny`/`ask`。执行顺序必须是 `toolDenied` → `deny/ask pattern veto` → `dangerous_patterns` → `allowlist/allAllowed`。

---

## 六、分步实施（v2.1 — 修订执行顺序）

> **审核建议**: "先定义权限语义兼容矩阵，再实现共享 permission matcher/reader，再迁移 consumers，最后删除 project.config.json 的冗余权限源。" v2.1 执行顺序遵循此建议。

### Step 0A: 修复 route-validator.ts L3 预存 bug（关联修复）

**文件**: `.opencode/lib/route-validator.ts`

**当前** (L168-176): `scope.includes(pattern)` 子串匹配 — 对 glob patterns 无效；更重要的是 dispatch-before.ts 当前传入的是 `extractScopePatterns()` 得到的 route-scope 片段（如 `booking-backend/src/`），不是实际 `target_files[]`。`safe_edit` glob 必须和真实 workspace-relative file path 比较。

```typescript
for (const [pattern, action] of Object.entries(agentPerms)) {
  if (action === "deny" && scope.includes(pattern)) {
    blocked = true;
    break;
  }
}
```

**改为**: L3 接收实际 target file paths，使用 `pathMatchesGlob()` 共享函数:

```typescript
import { pathMatchesGlob } from "./gate-core";

for (const file of targetFiles) {
  for (const [pattern, action] of Object.entries(agentPerms)) {
    if (action === "deny" && pathMatchesGlob(file, pattern)) {
      blocked = true;
      break;
    }
  }
  if (blocked) break;
}
```

**dispatch-before.ts 同步改动**: L3 不再使用 `extractScopePatterns()` 的输出作为权限检查输入。应改为:

```typescript
const l3InputFiles = targetFiles.length > 0 ? targetFiles : [];
const l3Candidates = l3InputFiles.length > 0
  ? l3_permissionFilter(l2Candidates, l3InputFiles, opencodeConfig)
  : l2Candidates; // no concrete files: skip L3 veto, rely on PLAN-FIRST/DAG
```

**不要改 L2 为 `pathMatchesGlob()`**: `route_rules.scope` 当前是路径片段/路由标签（如 `.opencode/`, `booking-backend/src/`, `/docs/`），不是 `safe_edit` glob。直接改成 `pathMatchesGlob(file, rule.scope)` 会让 `.opencode/lib/foo.ts` 无法匹配 `.opencode/`。L2/`findScopeAgent()`/`extractScopePatterns()` 应保留 route-scope 片段匹配，或单独引入 `pathMatchesRouteScope(file, scope)` 并明确其前缀/包含语义。

**性质**: 这是预存 bug 修复，不是 P2-D 语义变更。但 glob 匹配统一仅适用于 `safe_edit` 权限模式；route-scope 匹配是另一套语义，不能混用。

### Step 0: 创建 `lib/permission-reader.ts`（共享权限读取模块）

**新文件**: `.opencode/lib/permission-reader.ts`

**职责**:
1. 读取 opencode.json（带缓存 + enforcement_mode 感知 fail-closed）
2. 提供类型化的 per-agent 权限查询 API
3. 使用 `pathMatchesGlob()` 共享 glob 匹配（替代 v1 的 `includes()`）
4. 提供 flat map → bifurcated 转换（可选，供旧逻辑过渡）
5. Shell allowlist 返回 `ShellAllowlistResult` 结构化类型（替代 v1 的扁平 string[]）
6. 所有查询操作通过 `writeLog()` 记录

```typescript
// lib/permission-reader.ts — Shared permission data reader (AUTHORITATIVE: opencode.json)
//
// P2-D v2.1: opencode.json is the sole authoritative source for per-agent permission
// decisions. Upstream constraint: OpenCode CLI reads agent.*.permission directly;
// {env}/{file} only supports string substitution; project.config.json not in
// 8 preset config locations.
//
// SEMANTIC PRESERVATION: This module MUST NOT change permission semantics —
// only the data source. Glob matching uses pathMatchesGlob() (identical to
// gate-checks.ts matchGlob). Shell "allow" means permissive (all commands).
// Shell "ask" requires confirmation (NOT auto-allowed). Config failure is
// fail-closed in strict/locked mode.

import * as fs from "node:fs";
import * as path from "node:path";
import { getEnforcementMode, pathMatchesGlob, resolveFrameworkPaths } from "./gate-core";
import { writeLog } from "./log-manager";

// ── Types ──

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionMap {
  [pattern: string]: PermissionAction;
}

export interface BifurcatedScopes {
  allowed: string[];
  denied: string[];
}

export interface AgentPermission {
  safe_edit?: PermissionMap | "allow" | "deny";
  safe_delete?: PermissionMap | "allow" | "deny";
  safe_mkdir?: PermissionMap | "allow" | "deny";
  safe_shell?: PermissionMap | "allow" | "deny";
  safe_test?: "allow" | "deny";
}

export interface ShellAllowlistResult {
  allowed: string[];
  denied: string[];
  needsConfirmation: string[];
  allAllowed: boolean;
  toolDenied: boolean;
}

function getFrameworkRoot(): string {
  return resolveFrameworkPaths().root;
}

function getPermissionEnforcementMode(): "advisory" | "strict" | "locked" {
  return getEnforcementMode(getFrameworkRoot());
}

// ── Config reader ──

let _opencodeConfig: any = null;

export function readOpencodeConfig(): any {
  if (_opencodeConfig) return _opencodeConfig;
  try {
    const cfgPath = path.join(getFrameworkRoot(), "opencode.json");
    _opencodeConfig = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    writeLog("permission-reader", "runtime", {
      level: "INFO",
      event: "CONFIG-LOADED",
      detail: "opencode.json loaded as authoritative permission source",
    });
  } catch (e: any) {
    writeLog("permission-reader", "ERROR", {
      level: "ERROR",
      event: "CONFIG-LOAD-FAILED",
      detail: `opencode.json unreadable: ${e.message} mode=${getPermissionEnforcementMode()}`,
    });
    // Fail-closed in strict/locked; fail-open in advisory
    const mode = getPermissionEnforcementMode();
    if (mode === "strict" || mode === "locked") {
      writeLog("permission-reader", "ERROR", {
        level: "ERROR",
        event: "FAIL-CLOSED",
        detail: `Config unreadable in ${mode} mode — all permissions denied`,
      });
    }
    _opencodeConfig = null;
  }
  return _opencodeConfig;
}

export function resetOpencodeConfigCache(): void {
  _opencodeConfig = null;
}

// ── Per-agent permission lookup ──

export function getAgentPermission(agentName: string): AgentPermission | null {
  const cfg = readOpencodeConfig();
  if (!cfg) {
    // Config unreadable: fail-closed in strict/locked, fail-open in advisory
    const mode = getPermissionEnforcementMode();
    if (mode === "strict" || mode === "locked") return { safe_edit: "deny", safe_delete: "deny", safe_mkdir: "deny", safe_shell: "deny", safe_test: "deny" };
    return null; // advisory: no permission block = no restrictions (fail-open)
  }
  const agentKey = agentName.replace(/^@/, "");
  const perms = cfg?.agent?.[agentKey]?.permission;
  if (!perms) {
    writeLog("permission-reader", "runtime", {
      level: "WARN",
      event: "AGENT-PERMS-MISSING",
      detail: `No permission block for agent "${agentName}" in opencode.json`,
    });
    return null;
  }
  return perms;
}

// ── Flat map → Bifurcated conversion (legacy compatibility) ──

export function permissionMapToBifurcated(map: PermissionMap): BifurcatedScopes {
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const [pattern, action] of Object.entries(map)) {
    if (action === "allow") {
      allowed.push(pattern);
    } else if (action === "deny") {
      denied.push(pattern);
    }
    // "ask" cannot be represented in legacy bifurcated scope checks.
    // Non-interactive framework audits must safely degrade to deny.
    else if (action === "ask") {
      denied.push(pattern);
    }
  }
  return { allowed, denied };
}

// ── Write scope check (replaces isWriteAllowed from gate-checks.ts) ──

export function isPathAllowedForAgent(
  agentName: string,
  filePath: string,
  tool: "safe_edit" | "safe_delete" | "safe_mkdir" = "safe_edit",
): boolean {
  const perms = getAgentPermission(agentName);
  if (!perms) {
    // null from advisory mode = no restrictions; deny-all from strict/locked
    const mode = getPermissionEnforcementMode();
    if (mode === "strict" || mode === "locked") return false;
    return true;
  }

  const permBlock = perms[tool];
  if (!permBlock) return true; // No scope definition = no restrictions

  // Simple string: "allow" → all allowed, "deny" → all denied
  if (typeof permBlock === "string") return permBlock === "allow";

  // Normalize filePath to relative path (same logic as gate-checks.ts)
  const root = getFrameworkRoot();
  const relPath = filePath.startsWith(root + "/")
    ? filePath.slice(root.length + 1)
    : filePath;

  // Flat map: deny-first priority, then allow (same as gate-checks.ts)
  // Uses pathMatchesGlob() — identical algorithm to gate-checks.ts matchGlob()
  const entries = Object.entries(permBlock);
  for (const [pattern, action] of entries) {
    if (action === "deny" && pathMatchesGlob(relPath, pattern)) {
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "DEBUG",
        event: "WRITE-DENIED",
        detail: `agent="${agentName}" path="${relPath}" denied_by="${pattern}" tool="${tool}"`,
      });
      return false;
    }
  }
  for (const [pattern, action] of entries) {
    if (action === "allow" && pathMatchesGlob(relPath, pattern)) {
      return true;
    }
  }

  // No match when scopes exist → default deny
  writeLog("permission-reader", "runtime", {
    agent: agentName,
    level: "WARN",
    event: "WRITE-NO-MATCH",
    detail: `agent="${agentName}" path="${relPath}" no_scope_match (default deny) tool="${tool}"`,
  });
  return false;
}

// ── Shell allowlist extraction (v2: structured result) ──

export function getAgentShellAllowlist(agentName: string): ShellAllowlistResult {
  const perms = getAgentPermission(agentName);

  // Config unreadable in strict/locked → tool denied
  if (perms && typeof perms.safe_shell === "string" && perms.safe_shell === "deny") {
    // Actually this means agent has explicit deny
  }

  // Default: no shell permissions defined
  const defaultResult: ShellAllowlistResult = {
    allowed: [],
    denied: [],
    needsConfirmation: [],
    allAllowed: false,
    toolDenied: false,
  };

  if (!perms) {
    // null from advisory = no additional permissions beyond default_allowlist
    // deny-all from strict/locked = tool denied
    const mode = getPermissionEnforcementMode();
    if (mode === "strict" || mode === "locked") {
      return { allowed: [], denied: [], needsConfirmation: [], allAllowed: false, toolDenied: true };
    }
    return defaultResult;
  }

  const shell = perms.safe_shell;
  if (!shell) return defaultResult;

  // "allow" string → OpenCode permissive semantics: tool is allowed, all commands permitted
  if (typeof shell === "string") {
    if (shell === "allow") {
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "INFO",
        event: "SHELL-ALL-ALLOWED",
        detail: `agent="${agentName}" safe_shell="allow" (permissive: all commands)`,
      });
      return { allowed: [], denied: [], needsConfirmation: [], allAllowed: true, toolDenied: false };
    }
    if (shell === "deny") {
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "INFO",
        event: "SHELL-TOOL-DENIED",
        detail: `agent="${agentName}" safe_shell="deny" (tool prohibited)`,
      });
      return { allowed: [], denied: [], needsConfirmation: [], allAllowed: false, toolDenied: true };
    }
  }

  // Map: "allow" → allowed list, "deny" → denied list, "ask" → needsConfirmation list (NOT auto-allowed)
  const allowedPatterns: string[] = [];
  const deniedPatterns: string[] = [];
  const askPatterns: string[] = [];
  for (const [pattern, action] of Object.entries(shell)) {
    if (action === "allow") {
      allowedPatterns.push(pattern);
    } else if (action === "deny") {
      deniedPatterns.push(pattern);
    } else if (action === "ask") {
      askPatterns.push(pattern);
      writeLog("permission-reader", "runtime", {
        agent: agentName,
        level: "INFO",
        event: "SHELL-ASK-CMD",
        detail: `agent="${agentName}" cmd="${pattern}" requires confirmation (not auto-allowed)`,
      });
    }
  }
  return {
    allowed: allowedPatterns,
    denied: deniedPatterns,
    needsConfirmation: askPatterns,
    allAllowed: false,
    toolDenied: false,
  };
}
```

**v2.1 关键设计变更**:
1. **glob 匹配**: 使用 `pathMatchesGlob()` from `gate-core.ts`（替代 v1 `includes()`）。算法与 `gate-checks.ts` `matchGlob()` 完全相同 — `**` = `.*`（跨目录），`*` = `[^/]*`（单段），`\.` 转义。消除 glob 精度降级。
2. **路径解析**: 使用 `resolveFrameworkPaths().root` from `gate-core.ts`（替代 v1 `const ROOT = process.cwd()` 模块级绑定）。该 resolver 会从当前目录向上查找 `.opencode/`，避免模块加载时或从 `.opencode/` 启动时 `process.cwd()` 指向错误目录。
3. **safe_shell: "allow" 语义**: 返回 `{allAllowed: true}`，`safeBashTool()` 检测此标记后跳过 allowlist 检查（仍检查 `dangerous_patterns`）。与 OpenCode permissive 语义一致。
4. **"deny"/"ask" 处理**: 返回独立 `denied` / `needsConfirmation` 列表，不纳入 `allowed`。非交互上下文中 `"ask"` 命令 = default deny（安全降级）。两者都必须优先于 `default_allowlist`。
5. **fail-closed**: 配置不可读时 strict/locked → `return false`/`toolDenied: true`；advisory → `return true`/default allowlist（与旧行为等价）。
6. **所有查询通过 `writeLog()` 记录**，使用 `permission-reader` 作为 source identifier。

**日志集成规范**:
- 来源标识: `"permission-reader"`（符合 `log-manager.ts` 的 source-aware index tracking）
- 类别: `"runtime"`（运行时查询）或 `"ERROR"`（加载失败）
- 事件: `"CONFIG-LOADED"` / `"CONFIG-LOAD-FAILED"` / `"FAIL-CLOSED"` / `"WRITE-DENIED"` / `"WRITE-NO-MATCH"` / `"AGENT-PERMS-MISSING"` / `"SHELL-ALL-ALLOWED"` / `"SHELL-TOOL-DENIED"` / `"SHELL-ASK-CMD"`
- 字段: 遵循 `LogFields` interface (`event`, `detail`, `level`, 可选 `agent`)

### Step 1: 重写 `gate-checks.ts` `isWriteAllowed()`

**文件**: `.opencode/lib/gate-checks.ts`

**当前代码** (L156-176):
```typescript
export function isWriteAllowed(agentType: string, filePath: string): boolean {
  const config = readJsonFile<any>(STATE_PATHS.projectConfig());
  const scopes = config?.agent_write_scopes?.[agentType];
  // ... bifurcated {allowed, denied} logic with matchGlob()
}
```

**改为**:
```typescript
import { isPathAllowedForAgent } from "./permission-reader";

export function isWriteAllowed(agentType: string, filePath: string): boolean {
  return isPathAllowedForAgent(agentType, filePath, "safe_edit");
}
```

**删除**: 原 `isWriteAllowed` 的完整 bifurcated 实现 + `readJsonFile(STATE_PATHS.projectConfig())` 调用 + **私有 `matchGlob()` 函数**（L145-154）— 已被 `gate-core.ts` 公共 `pathMatchesGlob()` 替代，permission-reader.ts 直接引用后者。

**保留**: 函数签名不变（`agentType: string, filePath: string → boolean`），所有下游消费者（scope-before.ts, code-quality-gate.ts）无需修改调用方式。

**语义等价性验证**: `isPathAllowedForAgent()` 使用 `pathMatchesGlob()` — 算法与原 `matchGlob()` 完全相同。deny-first priority 和 default deny 行为不变。

**日志**: `isPathAllowedForAgent()` 内部已包含 `writeLog` 记录，无需额外日志。

### Step 2: 修改 `safe-bash-core.ts` Shell Allowlist 来源

**文件**: `.opencode/lib/safe-bash-core.ts`

**当前 `_loadSafeShellConfig()`** (L74-88): 仅读 `project.config.json`

**改为双读模式**:
```typescript
import { getAgentShellAllowlist, ShellAllowlistResult } from "./permission-reader";

// _loadSafeShellConfig() 仍读 project.config.json（框架策略：default_allowlist,
// dangerous_patterns, write_patterns, allowed_script_paths, agent_dangerous_bypass,
// agent_allowed_scripts）
// agent_allowlists 从 project.config.json 删除后，从 opencode.json 获取
```

**`getAllowlist()` 修改** (L400-408):

当前:
```typescript
function getAllowlist(agent: string): string[] {
  const defaultList = _getConfigList("default_allowlist", DEFAULT_ALLOWLIST);
  const agentList = _getConfigMap("agent_allowlists", AGENT_ALLOWLISTS);
  const specific = agentList[agent] || [];
  return [...defaultList, ...specific];
}
```

改为（仅负责构造有效 allowlist；`deny/ask/toolDenied` 在 `safeBashTool()` 中按命令判定）:
```typescript
function getAllowlist(agent: string): string[] | "ALL_ALLOWED" {
  const defaultList = _getConfigList("default_allowlist", DEFAULT_ALLOWLIST);
  // P2-D v2.1: per-agent command permissions from opencode.json (authoritative)
  const shellResult = getAgentShellAllowlist(agent);

  if (shellResult.toolDenied) return [];

  // Permissive "allow": all commands permitted beyond default
  if (shellResult.allAllowed) {
    writeLog("safe-bash", "runtime", {
      level: "INFO",
      event: "ALLOWLIST-SOURCE-SWITCH",
      detail: `agent="${agent}" source=opencode.json mode=all_allowed (permissive)`,
    });
    return "ALL_ALLOWED";
  }

  writeLog("safe-bash", "runtime", {
    level: "INFO",
    event: "ALLOWLIST-SOURCE-SWITCH",
    detail: `agent="${agent}" source=opencode.json entries=${shellResult.allowed.length}`,
  });
  return [...defaultList, ...shellResult.allowed];
}
```

**`safeBashTool()` 修改**: 必须在 allowlist 检查前处理 agent 级 `deny/ask` veto:
```typescript
const shellResult = getAgentShellAllowlist(agent);
if (shellResult.toolDenied) {
  return blocked("SHELL_TOOL_DENIED: safe_shell denied by opencode.json permission");
}

if (shellResult.denied.some((pattern) => matchGlob(command, pattern))) {
  return blocked("SHELL_CMD_DENIED_BY_PERMISSION: command denied by opencode.json safe_shell");
}

if (shellResult.needsConfirmation.some((pattern) => matchGlob(command, pattern))) {
  writeLog("safe-bash", "runtime", {
    level: "WARN",
    event: "ASK-CMD-BLOCKED-IN-AUTO-CTX",
    detail: `agent="${agent}" command="${command}" blocked (ask requires confirmation)`,
  });
  return blocked("ASK_CMD_BLOCKED_IN_AUTO_CTX: command requires confirmation");
}

// Existing dangerous_patterns check remains after explicit permission veto.
// Then allowlist check:
const allowlist = getAllowlist(agent);
if (allowlist === "ALL_ALLOWED") {
  // Skip allowlist check, only apply dangerous_patterns
  // (matches OpenCode permissive semantics for safe_shell: "allow")
} else if (!isAllowed(command, allowlist)) {
  return blocked(`NOT_IN_ALLOWLIST: Command not in agent ${agent} allowlist`);
}
```

**为什么必须这样改**: `opencode.json` 里 @Orchestrator 明确 `"git *": "deny"`，而 `project.config.json.safe_shell.default_allowlist` 仍包含 `git status`/`git diff` 等默认命令。若不做 deny-first veto，默认 allowlist 会重新放行本应被 agent 级权限禁止的命令。同理，@Coder-BE 的 `"rm -rf *": "ask"` 必须覆盖默认 `rm -rf .task_temp/*`。

**删除**: `AGENT_ALLOWLISTS` 硬编码 fallback 常量（L193-380，仅在 `_getConfigMap` fallback 使用，迁移后不再需要）。

**不变**: `_loadSafeShellConfig()` 仍读 `project.config.json` 获取框架策略（`default_allowlist`, `dangerous_patterns`, `write_patterns`, `allowed_script_paths`, `agent_dangerous_bypass`, `agent_allowed_scripts`）。这些不是 per-agent 权限数据，保留在 `project.config.json`。

### Step 3: 修改 `code-quality-gate.ts` Scope 检查

**文件**: `.opencode/scripts/mcp-tools/code-quality-gate.ts`

**当前** (L614-617):
```typescript
const libOptions = {
  agentWriteScopes:
    config.agent_write_scopes && config.agent_write_scopes[agent_type]
      ? config.agent_write_scopes[agent_type]
      : null,
```

**改为**:
```typescript
const { getAgentPermission, permissionMapToBifurcated } = require("../../lib/permission-reader");

const agentPerm = getAgentPermission(agent_type);
const libOptions = {
  agentWriteScopes: agentPerm?.safe_edit
    ? (typeof agentPerm.safe_edit === "string"
      ? (agentPerm.safe_edit === "allow" ? { allowed: ["*"], denied: [] } : { allowed: [], denied: ["*"] })
      : permissionMapToBifurcated(agentPerm.safe_edit as any))
    : null,
```

**说明**: `code-quality-gate.ts` 当前使用 CommonJS/Bun `require()` 风格，示例必须保持同一模块风格。其内部的 scope violation 检查逻辑使用 bifurcated 格式。为避免改动 library 内部逻辑，使用 `permissionMapToBifurcated()` 转换器。这是唯一需要 bifurcated 转换的消费者。转换器对 `ask` 必须采用非交互安全降级（映射到 `denied`），不能映射到 `allowed`。

**同步更新**: `recordScopeViolation()` 的 `denyRule`/消息来源不再读取 `config.agent_write_scopes`，应改为 `opencode.json permission.safe_edit`，避免迁移后残留旧权威源表述。

**日志**: 新增 `writeLog` 记录:
```typescript
writeLog("code-quality-gate", "runtime", {
  level: "INFO",
  event: "SCOPE-SOURCE-SWITCH",
  detail: `agent="${agent_type}" source=opencode.json format=bifurcated-via-converter`,
});
```

### Step 4: 更新 `scope-before.ts` 执法消息

**文件**: `.opencode/plugins/scope-before.ts`

**当前** (L165):
```typescript
`blocked by agent_write_scopes in project.config.json.`
```

**改为**:
```typescript
`blocked by permission.safe_edit in opencode.json (P2-D: authoritative source).`
```

**仅字符串修改**，逻辑不变（仍调用 `isWriteAllowed()`，该函数已在 Step 1 改为读 opencode.json）。

### Step 5: 更新 `framework-self-test.ts` 验证检查

**文件**: `.opencode/scripts/framework-self-test.ts`

**当前** (L189-190):
```typescript
const hasAgentWriteScopes =
  !!cfg.agent_write_scopes && typeof cfg.agent_write_scopes === "object";
```

**改为**: 验证 opencode.json permission 结构:
```typescript
import { readOpencodeConfig } from "../lib/permission-reader";

const ocCfg = readOpencodeConfig();
const hasAgentPermissions = !!ocCfg?.agent && typeof ocCfg.agent === "object";
const agentCount = hasAgentPermissions ? Object.keys(ocCfg.agent).length : 0;

// Verify each agent has permission.safe_edit
const agentsWithSafeEdit = hasAgentPermissions
  ? Object.values(ocCfg.agent).filter((a: any) => !!a?.permission?.safe_edit).length
  : 0;

if (!hasAgentPermissions) {
  errorDetail += " missing opencode.json agent permissions";
} else {
  output.push(`  ✓ agent definitions=${agentCount} with safe_edit=${agentsWithSafeEdit}`);
}
```

**删除**: 原 `agent_write_scopes` 验证逻辑。

**日志**: `writeLog("framework-self-test", "runtime", { ... })` 记录验证结果。

### Step 5A: 更新测试文件（v2 新增 — Medium 1 修正）

#### 5A.1 `lib/__tests__/safe-bash-core.test.ts`

**当前**: 引用并断言 `AGENT_ALLOWLISTS` 常量（L7 import, L34-107 test cases）

**改为**:
```typescript
// Remove AGENT_ALLOWLISTS import and tests
// Add: import { getAgentShellAllowlist, ShellAllowlistResult } from "../permission-reader";
// Add: tests verifying ShellAllowlistResult structure for each agent
// @CI-CD-Agent: { allAllowed: true } (safe_shell: "allow" permissive)
// @Coder-BE: { allowed: [...], denied: [], needsConfirmation: ["rm -rf *"], allAllowed: false }
// @Orchestrator: denied contains "git *"; "git status" must be blocked despite default_allowlist
// @Coder-BE: "rm -rf .task_temp/foo" must be blocked by ask veto despite default_allowlist
```

#### 5A.2 `scripts/__tests__/framework-self-test.test.js`

**当前**: 断言 `agent_write_scopes completeness`（L178-183）

**改为**:
```javascript
// Replace: assert agent_write_scopes completeness
// With: assert opencode.json agent permissions completeness
// Verify: each agent has permission.safe_edit, safe_delete, safe_mkdir
```

#### 5A.3 `scripts/__tests__/framework-enforcer.test.js`

**当前**: 使用 `agent_write_scopes` 在 test fixtures（L124, L210, L2320, L2348, L2391, L2419）和 enforcement logic（L292, L380, L388-389）

**改为**:
```javascript
// Replace agent_write_scopes fixtures with opencode.json permission fixtures
// Replace: config?.agent_write_scopes?.[agent]
// With: getAgentPermission(agent) and flat map matching
// Replace enforcement messages referencing "agent_write_scopes"
// With: "permission.safe_edit in opencode.json"
```

### Step 6: 删除 project.config.json 冗余数据

**文件**: `.opencode/project.config.json`

**删除**:
1. `agent_write_scopes` 整段 (L694-872, 178行) — 全部由 opencode.json `permission.safe_edit/safe_delete/safe_mkdir` 替代
2. `safe_shell.agent_allowlists` 子键 (~79条) — 由 opencode.json `permission.safe_shell` 替代

**保留**: `safe_shell` 中的 6 个框架策略子键:
- `default_allowlist` (49条)
- `dangerous_patterns` (21条)
- `write_patterns` (8条)
- `allowed_script_paths` (3条)
- `agent_dangerous_bypass` (2 agents)
- `agent_allowed_scripts` (1 agent)

**添加注释**: `safe_shell` 段头部追加 `$description` 说明:
```json
"$description": "P2-D: agent_allowlists deleted (authority → opencode.json). Framework enforcement policies (default_allowlist, dangerous_patterns, write_patterns, allowed_script_paths, agent_dangerous_bypass, agent_allowed_scripts) remain here as they are NOT per-agent permission decisions."
```

### Step 7: 更新 `framework-authorities.json` 权威声明

**文件**: `.opencode/state/framework-authorities.json`

**当前**:
```json
"description": "This opencode.json is an ADAPTER — it reflects/mirrors existing framework authorities without overriding them."
```

**改为**:
```json
"description": "This opencode.json is AUTHORITATIVE for per-agent permission decisions (safe_edit, safe_delete, safe_mkdir, safe_shell, safe_test). Framework enforcement policies (enforcement_mode, route_rules, dangerous_patterns) remain in project.config.json. P2-D: authority inversion verified against OpenCode official docs (config.md:40-48, 633-662; permissions.md:100-103, 165-168)."
```

**新增**:
```json
"permission_authority": "opencode.json agent.*.permission (AUTHORITATIVE, P2-D)",
"framework_policy_authority": "project.config.json (enforcement, route_rules, safe_shell policies)"
```

### Step 8: 权限等价性矩阵测试（v2 新增 — Medium 2 修正）

**新文件**: `.opencode/lib/__tests__/permission-equivalence.test.ts`

**职责**: 验证 P2-D 迁移后每个权限决策与迁移前完全等价（或等价+安全增强）。

```typescript
import { isPathAllowedForAgent, getAgentShellAllowlist, pathMatchesGlob } from "../permission-reader";
// Also import legacy isWriteAllowed (pre-migration) for comparison

describe("P2-D Permission Equivalence Matrix", () => {
  // ── Write scope equivalence ──
  const writeTestCases: Array<{ agent: string, path: string, expected: boolean }> = [
    // @Coder-BE — should allow booking-backend/src, deny .opencode/
    { agent: "@Coder-BE", path: "booking_system_refactor/booking-backend/src/services/booking.service.ts", expected: true },
    { agent: "@Coder-BE", path: ".opencode/lib/gate-checks.ts", expected: false },
    { agent: "@Coder-BE", path: ".task_temp/TASK-001/HANDOVER.md", expected: true },
    // @Guardian — should allow .task_temp/, deny booking-backend/src/
    { agent: "@Guardian", path: ".task_temp/TASK-001/test_report.json", expected: true },
    // @Architect — should allow docs/, deny .opencode/state/
    { agent: "@Architect", path: "docs/review/some-doc.md", expected: true },
    // No scope match → default deny
    { agent: "@Coder-BE", path: "random-unmatched-path.txt", expected: false },
  ];

  for (const tc of writeTestCases) {
    test(`isPathAllowedForAgent("${tc.agent}", "${tc.path}") = ${tc.expected}`, () => {
      expect(isPathAllowedForAgent(tc.agent, tc.path)).toBe(tc.expected);
    });
  }

  // ── Shell allowlist equivalence ──
  test("@Coder-BE shell: 'npx jest *' should be in allowed, 'rm -rf *' in needsConfirmation", () => {
    const result = getAgentShellAllowlist("@Coder-BE");
    expect(result.allowed).toContain("npx jest *");
    expect(result.needsConfirmation).toContain("rm -rf *");
    expect(result.allAllowed).toBe(false);
  });

  test("@Orchestrator shell: explicit deny must veto default_allowlist", () => {
    const result = getAgentShellAllowlist("@Orchestrator");
    expect(result.denied).toContain("git *");
    // safeBashTool("git status", { agent: "@Orchestrator", dryRun: true }) should be blocked,
    // even though project.config.json safe_shell.default_allowlist contains "git status".
  });

  test("permissionMapToBifurcated maps ask to denied for non-interactive audits", () => {
    const scopes = permissionMapToBifurcated({ "some/path/**": "ask" });
    expect(scopes.allowed).not.toContain("some/path/**");
    expect(scopes.denied).toContain("some/path/**");
  });

  test("@Meta-Planner shell: allAllowed=true (permissive)", () => {
    const result = getAgentShellAllowlist("@Meta-Planner");
    expect(result.allAllowed).toBe(true);
    expect(result.toolDenied).toBe(false);
  });

  test("@CI-CD-Agent shell: allAllowed=true (permissive)", () => {
    const result = getAgentShellAllowlist("@CI-CD-Agent");
    expect(result.allAllowed).toBe(true);
  });

  // ── Glob matching equivalence ──
  test("pathMatchesGlob matches gate-checks.ts matchGlob semantics", () => {
    expect(pathMatchesGlob("booking_system_refactor/booking-backend/src/services/booking.service.ts", "booking_system_refactor/booking-backend/src/**")).toBe(true);
    expect(pathMatchesGlob(".opencode/lib/gate-checks.ts", ".opencode/**")).toBe(true);
    expect(pathMatchesGlob("booking_system_refactor/booking-backend/src/main.ts", "booking-backend/src/**")).toBe(false); // glob needs full path
  });

  test("route-validator L2 keeps route-scope fragment semantics", () => {
    // route_rules.scope entries are fragments, not safe_edit globs.
    // ".opencode/lib/gate-checks.ts" must still match route scope ".opencode/".
  });
});
```

### Step 9: 验证 + Commit

**验证清单**:

| 检查项 | 方法 |
|--------|------|
| TypeScript 无错误 | `npx tsc --noEmit` — 0 errors（排除预存 scout-trigger/rotate-logs） |
| framework-self-test | `bun .opencode/scripts/framework-self-test.ts` — 39/39 PASS |
| framework-doctor | `bun .opencode/scripts/framework-doctor.ts` — 12/12 PASS |
| permission-equivalence test | `bun test .opencode/lib/__tests__/permission-equivalence.test.ts` — ALL PASS |
| safe-bash-core test | `bun test .opencode/lib/__tests__/safe-bash-core.test.ts` — ALL PASS（AGENT_ALLOWLISTS 引用移除） |
| route-validator L3 | dispatch 模拟：L3 输入实际 `target_files[]`，使用 `pathMatchesGlob(file, safe_edit_pattern)`；L2 仍保留 route-scope 片段匹配 |
| 写入阻断 | scope-before.ts 调用 `isWriteAllowed()` → 从 opencode.json 读取 + `pathMatchesGlob()` |
| Shell allowlist | safe-bash-core.ts 调用 `getAgentShellAllowlist()` → `deny/ask` veto 优先于 default_allowlist，支持 "ALL_ALLOWED" |
| code-quality-gate | scope 检查从 opencode.json 读取，通过 bifurcated 转换器 |
| JSON 格式验证 | `node -e "JSON.parse(require('fs').readFileSync('.opencode/project.config.json','utf8'))"` — valid |
| fail-closed 验证 | 临时删除 opencode.json → strict 模式下所有权限返回 deny |
| cwd walk-up 验证 | 从 `.opencode/` 目录运行 permission-reader 测试，确认仍读取 workspace root `opencode.json` |
| "deny/ask" 验证 | @Orchestrator `git status` 被 `git *: deny` 阻断；@Coder-BE `rm -rf .task_temp/x` 被 `rm -rf *: ask` 阻断 |

**Commit 标记**: `[INFRA] P2-D: permission source inversion — opencode.json authoritative, delete agent_write_scopes + agent_allowlists from project.config.json`

---

## 七、影响范围与风险矩阵

### 消费者变更清单（v2.1 — 含测试文件）

| 消费者 | 变更类型 | 变更量 | 风险 |
|--------|---------|--------|------|
| `lib/permission-reader.ts` (新) | 新增 | ~180 行 | 低 — 纯读取 + 转换 + 结构化类型 |
| `lib/route-validator.ts` (Step 0A) | 修复 L3 使用实际 target files + `pathMatchesGlob()`；L2 保留 route-scope 片段匹配 | ~15 行 | 中 — bug 修复 + 路由核心 |
| `lib/gate-checks.ts` | 重写 `isWriteAllowed` + 删除 `matchGlob` | ~20 行 | 中 — 核心执法函数 |
| `lib/safe-bash-core.ts` | 修改 `getAllowlist`/`safeBashTool` + 删除 `AGENT_ALLOWLISTS` | ~45 行 | 中 — Shell 执法入口 |
| `scripts/mcp-tools/code-quality-gate.ts` | 修改 scope 检查 | ~15 行 | 低 — MCP 工具 |
| `plugins/scope-before.ts` | 消息文本修改 | 1 行 | 极低 |
| `scripts/framework-self-test.ts` | 验证检查更新 | ~20 行 | 低 — 自验证 |
| `lib/__tests__/safe-bash-core.test.ts` | `AGENT_ALLOWLISTS` → `ShellAllowlistResult` 测试 | ~50 行 | 低 — 测试重构 |
| `scripts/__tests__/framework-self-test.test.js` | `agent_write_scopes` → permissions 验证 | ~15 行 | 低 — 测试重构 |
| `scripts/__tests__/framework-enforcer.test.js` | fixture + enforcement message 更新 | ~30 行 | 低 — 测试重构 |
| `lib/__tests__/permission-equivalence.test.ts` (新) | 等价性矩阵测试 | ~60 行 | 低 — 新增测试 |
| `project.config.json` | 删除 2 段 | -178 行 + -79 条 | 中 — 配置变更 |
| `state/framework-authorities.json` | 声明更新 | ~3 行 | 极低 |

### Rollback 方案

每个 Step 独立可回滚:
- Step 0A: 恢复 `route-validator.ts` L3 旧输入/旧 `includes()` 实现（回退到预存 bug 状态）
- Step 0: 删除 `permission-reader.ts`，恢复原有 import
- Step 1: 恢复 `isWriteAllowed()` 读 `project.config.json` 的 bifurcated 实现 + 恢复 `matchGlob()`
- Step 2: 恢复 `getAllowlist()`/`safeBashTool()` 读 `project.config.json.agent_allowlists`
- Step 3: 恢复 `code-quality-gate.ts` 读 `project.config.json.agent_write_scopes`
- Step 4: 恢复消息文本
- Step 5: 恢复 self-test 验证 `agent_write_scopes`
- Step 5A: 恢复测试文件中的 `AGENT_ALLOWLISTS` 和 `agent_write_scopes` 引用
- Step 6: 恢复 `project.config.json` 被删除段落（git revert）
- Step 7: 恢复 `framework-authorities.json` 声明
- Step 8: 删除 `permission-equivalence.test.ts`

### 安全边界验证（v2.1 — 语义等价性保证）

P2-D v2.1 **仅改变权限来源**，**不改变权限语义**（除安全增强项）:

| 场景 | Before P2-D | After P2-D | 等价性 |
|------|------------|------------|--------|
| @Coder-BE 写入 `booking_system_refactor/booking-backend/src/` | `agent_write_scopes.allowed` glob 匹配 → pass | opencode.json `safe_edit` glob 匹配 (`pathMatchesGlob`) → pass | ✅ 等价 |
| @Coder-BE 写入 `.opencode/` | `agent_write_scopes.denied` glob 匹配 → block | opencode.json `safe_edit` glob 匹配 (`pathMatchesGlob`) → block | ✅ 等价 |
| @Guardian 写入 `.task_temp/` | `agent_write_scopes.allowed` glob 匹配 → pass | opencode.json `safe_edit` glob 匹配 → pass | ✅ 等价 |
| 无 scope 定义的路径 | 默认 deny（scopes 存在时） | 默认 deny（flat map 存在时） | ✅ 等价 |
| Shell: @Coder-BE 运行 `npx jest *` | `agent_allowlists` 匹配 → pass | opencode.json `safe_shell` `"allow"` 匹配 → pass | ✅ 等价 |
| Shell: @Meta-Planner 运行任意命令 | `agent_allowlists` fallback（广泛 allowlist） → pass | `allAllowed: true`（permissive） → pass | ✅ 等价（语义对齐） |
| Shell: @Coder-BE 运行 `rm -rf *` | `agent_allowlists` 不包含 → blocked | `needsConfirmation` → 非交互上下文 blocked | ✅ 等价+安全增强 |
| Shell: @Orchestrator 运行 `git status` | default_allowlist 含 `git status`，但 opencode.json 明确 `git *: deny` | agent 级 deny-first veto → blocked | ⚠️ 安全增强，防止默认基线覆盖 per-agent deny |
| Shell: 危险命令检测 | project.config.json `dangerous_patterns` | project.config.json `dangerous_patterns`（不变） | ✅ 等价 |
| Config 不可读（advisory） | 读 project.config.json 失败 → fail-open | 读 opencode.json 失败 → fail-open | ✅ 等价 |
| Config 不可读（strict/locked） | 读 project.config.json 失败 → 依赖 `readJsonFile` 行为 | 读 opencode.json 失败 → **fail-closed** | ⚠️ 安全增强（非等价，但更安全） |

---

## 八、子系统兼容性确认

| 子系统 | P2-D 影响 | 兼容性 | 说明 |
|--------|---------|--------|------|
| Permission Matrix | **核心变更** | ✅ | 权限数据来源从 project.config.json → opencode.json |
| Safe Tools (safe_edit/safe_delete/safe_mkdir) | 间接影响 | ✅ | scope-before.ts 执法消息更新，逻辑通过 isWriteAllowed() 不变 |
| Safe Shell (safe_bash) | 双读模式 + 结构化结果 | ✅ | default_allowlist (project.config.json) + ShellAllowlistResult (opencode.json)，deny/ask 优先 |
| Compliance Gate | 无直接影响 | ✅ | gate-core.ts 不读 agent_write_scopes |
| Route Validator (L3) | **bug 修复** (Step 0A) | ✅ | L3 使用实际 target files + `pathMatchesGlob()`；L2 保留 route-scope 片段匹配 |
| Dispatch Before (L1-L4) | L3 输入修正 | ✅ | L3 不再传 `extractScopePatterns()` 结果，改传 `target_files[]` |
| Gate Before (P2-1) | 无变更 | ✅ | 已从 opencode.json 读取 (gate-before.ts) |
| TDD Enforcement | 无变更 | ✅ | tdd-before/after 不涉及权限配置 |
| UC7KS Pipeline | 无变更 | ✅ | scope-before.ts 仅调用 isWriteAllowed() |
| Plugin Lifecycle | 无变更 | ✅ | withPluginLifecycle 不涉及权限配置 |
| Framework Self-Test | 验证更新 | ✅ | 从 agent_write_scopes → opencode.json permissions |
| Framework Doctor | 无变更 | ✅ | 不验证权限配置 |
| Database (SQLite) | 无变更 | ✅ | DB 状态不涉及配置权限 |
| Pre-commit Hook | 无变更 | ✅ | hook-layers.ts 不读 agent_write_scopes |
| Git Hooks | 无变更 | ✅ | commit-msg hook 不涉及权限配置 |

---

## 九、日志系统集成规范

### 日志调用点（v2.1 — 含新增事件）

| Step | 文件 | 事件 | 类别 | 级别 |
|------|------|------|------|------|
| Step 0 | permission-reader.ts | `CONFIG-LOADED` | runtime | INFO |
| Step 0 | permission-reader.ts | `CONFIG-LOAD-FAILED` | ERROR | ERROR |
| Step 0 | permission-reader.ts | `FAIL-CLOSED` | ERROR | ERROR |
| Step 0 | permission-reader.ts | `WRITE-DENIED` | runtime | DEBUG |
| Step 0 | permission-reader.ts | `WRITE-NO-MATCH` | runtime | WARN |
| Step 0 | permission-reader.ts | `AGENT-PERMS-MISSING` | runtime | WARN |
| Step 0 | permission-reader.ts | `SHELL-ALL-ALLOWED` | runtime | INFO |
| Step 0 | permission-reader.ts | `SHELL-TOOL-DENIED` | runtime | INFO |
| Step 0 | permission-reader.ts | `SHELL-ASK-CMD` | runtime | INFO |
| Step 2 | safe-bash-core.ts | `ALLOWLIST-SOURCE-SWITCH` | runtime | INFO |
| Step 2 | safe-bash-core.ts | `ASK-CMD-BLOCKED-IN-AUTO-CTX` | runtime | WARN |
| Step 3 | code-quality-gate.ts | `SCOPE-SOURCE-SWITCH` | runtime | INFO |
| Step 5 | framework-self-test.ts | `PERMS-VALIDATION` | runtime | INFO |

### 日志格式规范

遵循 `log-manager.ts` v3.0 规范:
- Source identifier: `"permission-reader"` / `"safe-bash"` / `"code-quality-gate"` / `"framework-self-test"`
- Category: `"runtime"` 或 `"ERROR"`（符合 `LogCategory` enum: `"loaded" | "hooks" | "runtime" | LogLevel`)
- Fields: 遵循 `LogFields` interface (`event` 必填, `detail` 必填, `level` 可选, `agent` 可选)

### 禁止事项

- ❌ `console.log/error/warn` — 必须使用 `writeLog()`
- ❌ `appendFileSync` 直接写日志文件 — 必须通过 `writeLog()`
- ❌ 省略 `event` 或 `detail` 字段 — LogFields 必填字段

---

## 十、实施顺序与时间估算（v2.1 — 修订执行顺序）

> **v2 执行原则**: 先定义权限语义兼容矩阵 → 再实现共享 permission matcher/reader → 再迁移 consumers → 最后删除 project.config.json 冗余权限源。

| Step | 内容 | 预估 | 前置 |
|------|------|:----:|------|
| Step 0A | 修复 route-validator.ts L3 输入实际 target files + `pathMatchesGlob()`；保留 L2 route-scope 片段匹配 | 0.75h | 无（预存 bug） |
| Step 0 | 创建 permission-reader.ts（含 pathMatchesGlob + ShellAllowlistResult + fail-closed） | 2h | Step 0A（glob 统一前置） |
| Step 1 | 重写 isWriteAllowed() + 删除 matchGlob() | 0.5h | Step 0 |
| Step 2 | 修改 safe-bash-core.ts（ShellAllowlistResult + ALL_ALLOWED） | 1.5h | Step 0 |
| Step 3 | 修改 code-quality-gate.ts | 0.5h | Step 0 |
| Step 4 | 更新 scope-before.ts 消息 | 0.1h | Step 1 |
| Step 5 | 更新 framework-self-test.ts | 0.5h | Step 0 |
| Step 5A | 更新 __tests__ 测试文件（3 文件） | 1h | Step 0-5 |
| Step 6 | 删除 project.config.json 冗余 | 0.5h | Step 1-5A 全完成 |
| Step 7 | 更新 framework-authorities.json | 0.1h | Step 6 |
| Step 8 | 创建 permission-equivalence.test.ts | 1h | Step 0-6 |
| Step 9 | 验证 + Commit | 1h | Step 6-8 |

**总估算**: ~8h 实施时间 + 1h 验证/调试 = **9h**

**推荐执行顺序**: Step 0A → Step 0 → Step 1 → Step 4 → Step 2 → Step 3 → Step 5 → Step 5A → Step 6 → Step 7 → Step 8 → Step 9

Steps 1-5 可在 Step 0 完成后并行推进（独立消费者），但 Step 5A 必须在 Step 1-5 完成后执行，Step 6 必须在所有消费者迁移完成后才执行（删除旧数据源），Step 8 在 Step 0-6 完成后执行（需要实际权限数据对比）。

---

## 十一、Open Questions 决策记录（v2 新增）

### OQ-1: route-validator.ts L3 预存 bug 是否纳入 P2-D scope？

**审核建议**: "l3 的 `includes()` 已经是 bug，修复它属于'顺便'而非'顺手'，可以一并修复但需要单独说明。"

**决策**: 纳入 P2-D 同一 commit，但作为独立 Step 0A（预存 bug 修复），不混入 Step 0（新模块创建）。验证清单中单独标注。理由：glob 匹配统一是 P2-D 正确实施的必要前置——如果 L3 继续用 `includes()`，而 permission-reader.ts 用 `pathMatchesGlob()`，两层匹配语义不一致会导致路由决策与写入阻断不一致。v2.1 补充约束：L3 必须接收实际 `target_files[]`；L2 的 `route_rules.scope` 是路由片段，不参与 safe_edit glob 统一。

### OQ-2: `safe_shell: "allow"` 对 @Meta-Planner/@CI-CD-Agent 的行为等价性

**审核质疑**: 旧 `agent_allowlists` 中 @Meta-Planner/@CI-CD-Agent 有广泛 allowlist fallback（硬编码 `AGENT_ALLOWLISTS`），而 `safe_shell: "allow"` 在 v1 被解读为"仅 default 命令"，这是语义降级。

**决策**: v2.1 修正为 permissive 语义。`"allow"` → `{allAllowed: true}`，`getAllowlist()` 返回 `"ALL_ALLOWED"`，`safeBashTool()` 跳过 allowlist 检查但仍应用 `dangerous_patterns`。行为等价性：旧 `AGENT_ALLOWLISTS["@Meta-Planner"]` 包含几乎所有常用命令（echo, cat, ls, grep, find, cd, wc, node, npx, bun, npm, git, docker 等），`dangerous_patterns` 检查后实际与 `allAllowed` 效果相同。@CI-CD-Agent 的 `AGENT_ALLOWLISTS` 包含大量 docker 命令，在 `dangerous_patterns` 检查后同样等价于 `allAllowed`。v2.1 补充约束：当 safe_shell 是 flat map 时，`deny`/`ask` 必须先于 default_allowlist 生效，防止项目级默认命令覆盖 per-agent 权限。

---

## 十二、解锁下游

P2-D 完成后解锁:

| 下游项 | 依赖关系 | 预估 |
|--------|---------|------|
| P3-E (权限模板化) | 强依赖 P2-D | 6h |
| Phase A3 (Coder 参数化) | 强依赖 P3-E | 6h + A/B |
| Phase A4 (KC scope 简化) | 依赖 P2-D | 含在 Phase A4 |
| Phase C2 (UC7KS 精简) | 弱依赖 P2-D | 6h |

---

## 附录 A: Glob 匹配实现对照

| 文件 | 函数名 | 可见性 | `**` 处理 | `*` 处理 | `.` 处理 | 用途 |
|------|--------|--------|-----------|-----------|-----------|------|
| gate-core.ts | `pathMatchesGlob` | **public** | `.*` (跨目录) | `[^/]*` (单段) | `\.` 转义 | 路径匹配（P2-D 共享函数） |
| gate-checks.ts | `matchGlob` | **private** | `.*` (跨目录) | `[^/]*` (单段) | `\.` 转义 | 路径匹配（P2-D 后删除） |
| safe-bash-core.ts | `matchGlob` | **private** | N/A | `.*` (无段边界) | `\.` 转义 | 命令匹配（语义不同，保留） |
| route-validator.ts L3 | `scope.includes()` | N/A | ❌ 无 glob 处理 | ❌ 子串匹配 | ❌ 无转义 | safe_edit 权限 veto（P2-D Step 0A 改为实际 file + pathMatchesGlob） |
| route-validator.ts L2 | route-scope 片段匹配 | N/A | N/A | N/A | N/A | 路由规则匹配（保留片段/前缀语义，不与 safe_edit glob 混用） |

**P2-D glob 统一策略**: 所有 **safe_edit/write-scope** 路径 glob 匹配统一使用 `pathMatchesGlob()`（gate-core.ts 公共函数）。`route_rules.scope` 是路由片段匹配，保持独立语义。命令 glob 匹配保留 safe-bash-core.ts 的 `matchGlob()`（语义不同：命令中 `*` = `.*` 无段边界，因为命令参数不含 `/`）。
