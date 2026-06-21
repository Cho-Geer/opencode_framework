# UC7-001 读后写约束加固方案 —— Read-Before-Write

**版本**: v1.2.0  
**日期**: 2026-06-21  
**作者**: @Orchestrator / Codex Audit  
**状态**: implemented + post-E2E remediation required  
**关联**: UC7-001, UC7-001c, UC7-009, read-before-approve-plan.md, read-audit.ts, read-track-after.ts  
**审核结论**: 方向正确，但 v1.0.0 对 OpenCode 工具注册、shell 写路径解析、legacy 迁移、合规门/自测/提示文档同步和日志来源定义不充分；本版补齐后才可作为实施方案。

---

## §0 背景

### §0.1 问题发现

在 READ-BEFORE-APPROVE 约束的实施过程中，发现 @Super-Admin 在按 `read-before-approve-plan.md` 实施修复时，**未实际读取知识缓存内容**就通过了 UC7KS 写前门禁，完成了框架文件修改。

调查发现这是一个**系统性问题**——UC7-001c HARDEN 的三个证据字段（`reason`、`files_read`、`content_summary`）由 `knowledge_cache_search` 工具**自动生成**，不从 `read` 工具调用获取，导致：

- `files_read` = index.json 中的缓存文件路径列表（"这些文件存在"），不是 agent 通过 `read` 工具实际打开的文件列表（"这些文件我看过"）
- `reason` = 工具自动生成的 `"Found X matching cache entries..."`，不是 agent 自己写的需求理由
- `content_summary` = 工具自动生成的统计摘要，不是 agent 自己写的阅读摘要

### §0.2 核心矛盾

```
UC7KS Step 0 (太早):
  agent 还不知道需要什么
  → knowledge_cache_search 只做"发现"——"缓存里有这些"
  → 此时要求 agent 提供"读了什么、为什么读"不合理

写操作时 (正确时机):
  agent 已经分析完代码，知道需要什么
  → 此时可证明"为了写这个，我读了缓存中的X、Y、Z"
  → 但当前系统未要求此证明
```

唯一能证明 agent 实际阅读了缓存文件的是 `read` 工具调用记录（`read_audit.jsonl`，由 `read-track-after.ts` 记录），但 UC7KS 写前验证链**完全不引用这个数据源**。

### §0.3 三个 GAP

| GAP | 描述 | 严重性 |
|:---:|------|:------:|
| **GAP #1** | safe_shell 写操作全覆盖缺口：`sed -i` 等修改命令不被 `scope-before.ts` 的 `applyPathScope` 拦截 | 🔴 |
| **GAP #2** | 证据数据源错误：`knowledge_cache_search` 自动填充三字段，不引用 `read_audit.jsonl` | 🔴 |
| **GAP #3** | 缺少"已读"状态：`cache_sufficiency.status` 只有 `sufficient/insufficient`，无法区分"缓存充足"和"已阅读证明" | 🔴 |

### §0.4 2026-06-18 审核结论

本方案的核心判断属实：当前框架确实存在“搜索缓存即获得写前通行证”的问题。`knowledge_cache_search.ts` 会从 `index.json` 自动生成 `cache_sufficiency.files_read/reason/content_summary`，`checkUC7KSWrite()` 只检查 `cache_sufficiency.status === "sufficient"`，`uc7ks-after.ts` 还会在读取 `docs/official_docs/` 后直接把域状态写成 `sufficient`。这些行为都不能证明 agent 实际阅读并理解了缓存内容。

但 v1.0.0 不能直接执行，必须修正以下点：

1. **官方 OpenCode 规范**：自定义工具不需要在 `opencode.json` 注册工具列表；工具由 `.opencode/tools/<name>.ts` 自动发现。`opencode.json` 只需要更新 agent permission（以及必要的 agent prompt/mcp_tools 指令）。
2. **全子系统同步**：除了 `knowledge_cache_search` 和 `checkUC7KSWrite`，还必须同步 `uc7ks-schema.ts`、`uc7ks-before.ts`、`uc7ks-after.ts`、`compliance-gate.ts`、`framework-self-test.ts`、`.opencode/commands/search-knowledge.md`、`.opencode/subagent-preamble.md`、agent 配置和 schema。
3. **日志系统**：插件和工具不得依赖 `console.log`。新增工具、插件和库函数必须走 `writeLog()`，且事件来源要和当前日志系统一致。
4. **safe_shell 解析**：原方案给出的“提取最后一个 `\S+\.\w+`”过于脆弱，不能覆盖多个写目标、重定向、`tee`、`dd of=`、`sed -i` 变体、`sh -c`/`node -e`/`bun -e` 等实际写入路径。严格模式下不可解析的写命令应阻断或要求使用 `safe_edit`。
5. **legacy 迁移**：旧 `cache_sufficiency.status=sufficient` 不能在 strict/locked 下视作隐式 attested，否则会保留原漏洞。可在 advisory 中告警过渡，但写前强约束必须以显式 `attestation.status="attested"` 为准。

---

## §1 当前架构详析

### §1.1 写前拦截链

```
scope-before.ts (tool.execute.before plugin)
  │
  ├─ 1. isModifyTool(input.tool)
  │     → write / edit / safe_edit / safe_mkdir / safe_delete / safe_shell 触发
  │     → 其他工具直接 return (pass)
  │
  ├─ 2. getModifyPath(output.args) → 取 filePath/dirPath/command
  │
  ├─ 3. getEffectivePathScopeFilePath(tool, args)
  │     → safe_shell: 调用 isModifyShell(args) 判断
  │       → 当前正则已覆盖 cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash
  │       → 但返回值仍是完整 command 字符串，而不是写入目标路径
  │       → 下游 isSourceFile(scopePath) 对完整命令无法可靠命中文件路径
  │     → 非 safe_shell: 直接返回 getModifyPath 的结果
  │
  ├─ 4. if (applyPathScope === false) → 跳过所有路径检查 (包括 UC7-001 write check)
  │
  └─ 5. if (applyPathScope && isSourceFile(scopePath)) → checkUC7KSWrite()
        isSourceFile: /\.(ts|tsx|js|jsx|html|scss|prisma)$/
        → 不匹配 .json, .yaml, .md, opencode.json
```

### §1.2 checkUC7KSWrite() 当前逻辑

```
checkUC7KSWrite(agent, mode, sessionId?, taskId?, domainId?)
  │
  ├─ advisory mode → return null (pass)
  ├─ @Knowledge-Curator → return null (exempt)
  ├─ SA + cache unhealthy → return null (UC7-009 emergency bypass)
  │
  ├─ Path A: taskId + domainId + per-domain data exists
  │     └─ cache_sufficiency.status === "sufficient" → return null (PASS)
  │     └─ cache_sufficiency.status === "insufficient" → BLOCK
  │
  ├─ Path B: taskId + domainId + per-domain data missing
  │     └─ BLOCK → "must call knowledge_cache_search first"
  │
  └─ Path C: no taskId/domainId → global uc7_001_compliant flag
        └─ flag set → PASS
        └─ flag not set → BLOCK
```

### §1.3 knowledge_cache_search 自动填充证据

工具 `tools/knowledge_cache_search.ts` L145-172：从 index.json 提取 `cached_files` 路径自动填充 `files_read`，agent 未用 `read` 工具读过这些文件。

Schema 定义（`knowledge-cache-state.schema.json` L167）写的是 "Cache file paths that were read"，但实现填的是 "Cache file paths that COULD be read (from index.json)"。

### §1.4 现有审计基础设施（可复用）

read-track-after.ts + read_audit.jsonl 已提供：
- 每个 `read` 调用 → `recordRead({timestamp, agent, filePath, sessionId, taskId, callId})`
- 追加行 JSONL 格式
- `verifyRead(agent, filePath)` 可查询
- 已用于 compliance-gate.ts 的 READ-BEFORE-APPROVE 检查

此外，当前 `uc7ks-after.ts` 会在 `read` 工具读取 `docs/official_docs/` 后直接写入 `domainEntry.cache_sufficiency.status = "sufficient"`，并设置 `uc7_001_compliant = true`。本方案实施时必须同步改造该插件：它只能记录 read 事实和基础 metadata，不能再把“读过某个 docs 文件”自动升级成“该 domain 已充分且可写”。


## §2 方案设计

### §2.1 核心思路：分离"发现"与"阅读证据"

当前 `cache_sufficiency` 单一状态承担了两个职责。修复后分为 `discovery` 和 `attestation` 两段：

| 职责 | 当前 | 修复后 |
|------|------|--------|
| 缓存覆盖发现 | status: "sufficient" | discovery.status: "sufficient" |
| 阅读证据证明 | 不存在 | attestation.status: "attested" |

### §2.2 数据结构变更

```typescript
interface CacheSufficiency {
  // 发现阶段（由 knowledge_cache_search 工具自动填充）
  discovery: {
    status: "sufficient" | "insufficient" | "undeclared";
    missing_topics: string[];
    discovered_files: string[];   // 原 files_read —— 改名为明确语义
    discovered_at: string;
  };

  // 阅读见证阶段（由 agent 通过 knowledge_cache_attest 主动提交）
  attestation: {
    status: "attested" | "pending" | "skipped";
    reason: string;               // agent 填写：为什么需要读这些缓存
    files_read: string[];         // 实际 read 过的文件子集（与 read_audit.jsonl 交叉验证）
    content_summary: string;      // agent 填写：读到了什么
    attested_at: string;
  };
}
```

**实施约束**：
- 不要一次性删除 legacy `cache_sufficiency.status/missing_topics/reason/files_read/content_summary` 字段；当前 schema、合规门、自测和提示文档仍读取这些字段。
- 新代码必须通过 helper 读写：新增 `readCacheDiscovery()`、`readCacheAttestation()`、`isDomainKnowledgeAttested()` 等方法，避免各插件继续直接判断 `cache_sufficiency.status`。
- legacy `cache_sufficiency` 只能作为展示/兼容输出，不得在 strict/locked 的写前门禁中作为 attestation fallback。
- `knowledge_cache_search` 的返回可以继续提供兼容字段，但字段语义必须改名或标注为 `discovered_files`，不能再把自动匹配路径称为 `files_read`。

### §2.3 两阶段流程

#### Phase A — Step 0（发现阶段）

`knowledge_cache_search` 只写 `discovery`，不再触碰 `reason`/`files_read`/`content_summary`：

```
agent calls knowledge_cache_search(opencode_framework, task_id)
  → 工具搜索 index.json，返回匹配条目
  → 工具填写 discovery:
      discovery.status = hits > 0 ? "sufficient" : "insufficient"
      discovery.discovered_files = index.json 中匹配的文件路径
      discovery.discovered_at = now
  → 工具不再填写 reason / files_read / content_summary（旧字段废弃）
  → 工具不再设置全局 uc7_001_compliant
  → response.hit_entries 照常返回给 agent
```

#### Phase B — 写前（阅读见证阶段）

新增工具 `knowledge_cache_attest(domain, task_id, reason, files_read[], content_summary)`：

1. 验证 `discovery.status === "sufficient"`
2. 验证 `files_read` 中每个文件在 `discovery.discovered_files` 中（不能声明读了不存在的缓存文件）
3. 验证 `files_read` 中每个文件在 `read_audit.jsonl` 中有本 session 的 read 记录（交叉验证）
4. 验证 `reason` 和 `content_summary` 非空且由 agent 自己撰写
5. 通过 → 写入 `attestation = {status:"attested", reason, files_read, content_summary, attested_at}`

#### §2.3.1 attest 工具 session 上下文获取

`read_audit.jsonl` 中的 `sessionId` 是 OpenCode session ID（如 `ses_126bd8762...`），attest 工具需要获取当前 session ID 才能匹配。官方 OpenCode 自定义工具约定为 `.opencode/tools/<name>.ts` 导出 `tool()`，`execute(args, context)` 中可读取 `context.agent`、`context.sessionID`、`context.messageID`、`context.directory`、`context.worktree`。

**方案 A（强制优先）**：使用官方自定义工具 `context.sessionID` 和 `context.agent`：
```typescript
const sessionId = context.sessionID;
const agent = context.agent || "unknown";
```
直接匹配 `read_audit.jsonl` 中的 `sessionId` 字段。

**方案 B（advisory fallback only）**：若 `context.sessionID` 不可用，只能在 advisory 模式下通过以下条件组合匹配，并记录 WARN：
- `taskId` 匹配（从 `args.task_id` 获取）
- `agent` 匹配（从 `context.agent` 获取）
- 时间窗口：attest 调用前 30 分钟内的 read 记录

strict/locked 模式下缺少 `context.sessionID` 时应拒绝 attest，避免把 compliance gate session id（`cg_ses_*`）误当作 OpenCode session id（`ses_*`）。

**路径归一化要求**：
- `index.json` 中的文件路径通常是相对 `docs/official_docs/` 的路径，如 `opencode/framework/plugins.md`。
- `read_audit.jsonl` 记录的可能是 repo 相对路径、绝对路径或用户传入路径，如 `docs/official_docs/opencode/framework/plugins.md`。
- attest 验证前必须统一归一化到 repo 相对路径，并同时支持 `discovered_files` 相对路径与完整 `docs/official_docs/<path>` 形式。

### §2.4 checkUC7KSWrite() 改后逻辑

```
checkUC7KSWrite(agent, mode, sessionId?, taskId?, domainId?)
  │
  ├─ advisory mode → return null (pass)
  ├─ @Knowledge-Curator → return null (exempt)
  ├─ SA + cache unhealthy → return null (UC7-009 emergency bypass)
  │
  ├─ Path A: taskId + domainId + per-domain data exists
  │     ├─ discovery.status !== "sufficient"
  │     │   └─ BLOCK → "缓存不足，需外部搜索或调 @Knowledge-Curator"
  │     │
  │     ├─ !attestation || attestation.status !== "attested"
  │     │   └─ BLOCK → "已搜索缓存但未证明阅读。调 knowledge_cache_attest"
  │     │   （attestation 字段缺失 === status=pending）
  │     │
  │     ├─ discovery.status === "sufficient" && attestation.status === "attested"
  │     │   → PASS
  │     │
  │     └─ 说明：两条阻塞独立。agent 先修 sufficient，再修 attested
  │
  ├─ Path B: taskId + domainId + per-domain data missing
  │     └─ BLOCK → "未搜索缓存。先调 knowledge_cache_search"
  │
  └─ Path C: no taskId/domainId → global check (向后兼容，逐步废弃)
```

#### §2.4.1 错误消息模板

三种阻塞场景的错误消息应包含：场景标识、当前状态、具体修复步骤。

**场景 1 — discovery insufficient（缓存不足）**：
```
╔══════════════════════════════════════════════════════════════╗
║  UC7-001: 知识缓存不足                                       ║
║  Agent: @Coder-BE                                            ║
║  Missing topics: [NestJS Guard pattern, Rate limiting]       ║
║  修复:                                                        ║
║  1. 调 knowledge_cache_search(domain, task_id) 换 domain    ║
║  2. 如仍不足 → 通知 @Orchestrator 派遣 @Knowledge-Curator   ║
╚══════════════════════════════════════════════════════════════╝
```

**场景 2 — attestation pending（未证明阅读）**：
```
╔══════════════════════════════════════════════════════════════╗
║  UC7-001: 缓存已搜索但未证明已读                               ║
║  Agent: @Coder-BE                                            ║
║  修复:                                                        ║
║  调 knowledge_cache_attest(                                 ║
║    domain="opencode_framework", task_id="T-042",             ║
║    reason="为了理解 NestJS Guard 实现模式",                    ║
║    files_read=["opencode/findings/05-central-state...", ...], ║
║    content_summary="从缓存文档中确认了 Guard 的继承结构"       ║
║  )                                                           ║
╚══════════════════════════════════════════════════════════════╝
```

**场景 3 — attestation failed（传入文件未被 read 工具打开）**：
```
╔══════════════════════════════════════════════════════════════╗
║  UC7-001: 阅读证明失败 — 以下文件未在 read_audit.jsonl 中    ║
║  Agent: @Coder-BE                                            ║
║  Not actually read: [opencode/findings/05-central-state...]  ║
║  修复: 用 read 工具打开这些文件后重新 attest                   ║
╚══════════════════════════════════════════════════════════════╝
```


### §2.5 覆盖范围修复

#### §2.5.1 GAP #1 修复：safe_shell 写路径解析

**问题定位**：当前 `isModifyShell` 正则已覆盖 `sed|node|bun|npx|python3` 等命令，真正瓶颈在 `getEffectivePathScopeFilePath` 只返回单个字符串，而且对 `safe_shell` 返回完整 command，不是实际写入目标路径。

```typescript
// 当前行为
export function getEffectivePathScopeFilePath(tool, args) {
  if (tool === "safe_shell")
    return isModifyShell(args) ? getModifyPath(args) : null;
  //   ↑ 对 sed -i 返回 "sed -i 's/x/y/' file.ts"（不是文件路径，是完整命令）
  return getModifyPath(args);
}
```

**修复要求**：

1. 新增多路径 API，不再用单字符串承载 shell 命令：
```typescript
type ScopePathResult =
  | { applies: false; paths: []; reason: "read_only_shell" }
  | { applies: true; paths: string[]; reason: "parsed" }
  | { applies: true; paths: []; reason: "unparseable_modify_shell" };

export function getEffectivePathScopePaths(tool: string, args: any): ScopePathResult {
  // non-shell write/edit tools return [filePath] or [dirPath]
  // safe_shell returns all concrete write targets that can be parsed
}
```

2. `scope-before.ts` 对 `paths[]` 逐个执行 route/scope/UC7KS 检查。只要任一目标不合规即阻断。
3. strict/locked 模式下，`unparseable_modify_shell` 必须阻断并提示改用 `safe_edit`/`safe_mkdir` 等结构化工具；advisory 模式记录 WARN。
4. `getEffectivePathScopeFilePath()` 可保留为兼容 wrapper，但新逻辑不得继续依赖它做 UC7KS 写前判断。

**至少覆盖的命令形态**：
| 命令 | 提取路径 | 示例 |
|------|---------|------|
| `sed -i 's/x/y/' file.ts` | `file.ts` | 修改源文件 |
| `sed -i.bak 's/x/y/' file.ts` | `file.ts` | macOS/GNU sed 变体 |
| `node script.ts` | 只读运行脚本，不默认视为写目标 | 脚本本身不是写入对象 |
| `node -e "fs.writeFileSync('x.ts','')"` | `x.ts` 或 unparseable 阻断 | inline 写入 |
| `bun -e "Bun.write('x.ts','')"` | `x.ts` 或 unparseable 阻断 | inline 写入 |
| `python3 migrate.py` | 无显式写目标则 `unparseable_modify_shell` | 迁移脚本可能有副作用 |
| `cp src dst` | `dst` | 复制文件 |
| `mv src dst` | `src`, `dst` | 移动/覆盖 |
| `tee file.ts` | `file.ts` | 写文件 |
| `dd if=a of=file.ts` | `file.ts` | 写文件 |

**不可接受的实现**：
- 仅用“最后一个 `\S+\.\w+`”推断目标文件。该规则会漏掉多个目标、重定向、quoted path、`dd of=`、`tee`、inline script，并可能把只读脚本误判为写目标。
- 对 `echo "x" >> file`、heredoc、`sh -c` 等无法解析的写命令直接放行。严格模式下必须阻断或要求使用结构化写工具。

#### §2.5.2 写前 UC7KS 受保护对象覆盖

`isSourceFile` 当前匹配 `.ts/.tsx/.js/.jsx/.html/.scss/.prisma`，不匹配 `.json/.yaml/.md`。

**修复**：在 `scope-before.ts` 中，不再把 UC7KS 写前检查绑定到 `isSourceFile()` 或少量 critical helper，而是新增显式受保护对象判定：

```typescript
function isUC7KSWriteTarget(filePath: string): boolean {
  const p = normalizeRepoRelativePath(filePath);
  if (isUC7KSExcludedPath(p)) return false;

  return isSourceFile(p)
    || p.startsWith(".opencode/")
    || p.startsWith("docs/review/")
    || p.startsWith("docs/design/")
    || p === "AGENTS.md"
    || p === "contract.yaml"
    || p === "opencode.json";
}
```

**必须排除的路径**：
- `.opencode/logs/`、`logs/`
- `node_modules/`（用户原文 `node_modles/` 按常规拼写归一为 `node_modules/`）
- `.task_temp/`、`task_temp/`

**必须纳入 UC7KS 写前检查的对象**：
- 业务代码文件：继续通过 `isSourceFile()` 覆盖。
- `.opencode/**` 下所有文件，排除 `.opencode/logs/**`。
- `docs/review/**`。
- `docs/design/**`。
- 根目录 `AGENTS.md`。
- 根目录 `contract.yaml`。
- 根目录 `opencode.json`。

**实现位置建议**：
- 在 `.opencode/lib/tool-scope.ts` 或 `.opencode/lib/state-utils.ts` 新增 `isUC7KSWriteTarget()` 和 `isUC7KSExcludedPath()`。
- `scope-before.ts` 只调用该 helper，避免多处散落路径规则。
- `isCriticalFrameworkFile()`、`isFrameworkInfraFile()` 可作为内部辅助，但不能作为唯一覆盖来源，因为它们当前不覆盖 `docs/review/**`、`docs/design/**` 和全部 `.opencode/**`。

`docs/official_docs/**` 不在本次新增目标中；该目录属于知识缓存本体，仍应由 @Knowledge-Curator/缓存治理规则控制。若未来要把官方缓存文档写入也纳入同一门禁，需要单独评估 KC 豁免和 UC7-009 旁路。

#### §2.5.3 audit/write 策略模板化到 project.config.json

当前 `audit-before.ts`、`audit-after.ts` 和 `write-audit-lib.ts` 仍存在若干项目相关硬编码：

- `audit-before.ts` / `audit-after.ts` 只用 `isSourceFile()` 判断是否进入 write audit。
- `write-audit-lib.ts` 用硬编码扩展名正则 `\.(ts|tsx|js|jsx|html|scss|prisma)$` 决定审计对象。
- `write-audit-lib.ts` 只硬编码排除 `.task_temp/`。
- `audit-after.ts` 将 `write_audit_state.history` 上限硬编码为 `200`。
- `write-audit-lib.ts` 用 `modules/([^/]+)` 作为 module 名提取规则。
- `write-audit-lib.ts` 固定写入 `eslint_state`、`type_check_state`、`format_state`、`dependency_state` 四类 dirty state。

这些属于项目策略，适合模板化放入 `.opencode/project.config.json`。但 agent 写权限矩阵不应迁回 `project.config.json`：P2-D 后 `opencode.json` 是权限权威源，`permission-reader.ts` 已明确以 `opencode.json` 为 authoritative。`project.config.json.write_audit` 只能定义审计目标、排除路径、状态更新策略和保留上限，不能覆盖 `safe_edit/safe_shell` allow/deny。

建议新增配置：

```json
{
  "write_audit": {
    "$description": "Write-audit target classification and state update policy. Does not define agent permissions; opencode.json remains authoritative.",
    "target": {
      "include_paths": [
        "booking_system_refactor/booking-backend/src/**",
        "booking_system_refactor/booking-backend/test/**",
        "booking_system_refactor/booking-backend/prisma/**",
        "booking_system_refactor/booking-frontend/**",
        ".opencode/**",
        "docs/review/**",
        "docs/design/**",
        "AGENTS.md",
        "contract.yaml",
        "opencode.json"
      ],
      "exclude_paths": [
        ".opencode/logs/**",
        "logs/**",
        "node_modules/**",
        ".task_temp/**",
        "task_temp/**"
      ],
      "file_extensions": ["ts", "tsx", "js", "jsx", "html", "scss", "prisma", "json", "jsonc", "yaml", "yml", "md", "sh"]
    },
    "safe_shell": {
      "modify_commands": ["cp", "mv", "rm", "python3", "node", "bun", "npx", "tee", "cat", "sed", "dd", "sh", "bash"],
      "unparseable_modify_shell_policy": "block_in_strict"
    },
    "history": {
      "max_entries": 200
    },
    "module_detection": {
      "patterns": [
        { "regex": "modules/([^/]+)", "group": 1 },
        { "regex": "booking_system_refactor/booking-backend/src/([^/]+)", "group": 1 },
        { "regex": "booking_system_refactor/booking-frontend/src/app/([^/]+)", "group": 1 }
      ],
      "fallback": "path_slug"
    },
    "dirty_state_targets": ["eslint_state", "type_check_state", "format_state", "dependency_state"]
  }
}
```

实现要求：
- 新增 `readWriteAuditPolicy()` helper，读取 `.opencode/project.config.json.write_audit`，缺失时回退当前硬编码默认值，避免配置缺失直接破坏审计。
- `audit-before.ts`、`audit-after.ts`、`scope-after.ts`、`write-audit-lib.ts` 统一使用同一套 target/include/exclude/file extension 判断，避免 UC7KS 写前目标和 write audit 目标分裂。
- `safe_shell.modify_commands` 可作为 `tool-scope.ts isModifyShell()` 的配置来源；如果配置缺失，保留当前命令列表 fallback。
- `dirty_state_targets` 只控制哪些 sub-state 被标 dirty，不允许关闭 `write_audit_state` 本身。
- 更新 `.opencode/state/project.config.schema.json`，否则新增配置无法被 JSON schema/自测识别。

### §2.6 UC7-009 Super-Admin 紧急旁路规则

保留当前规则：缓存不可用时 SA 可绕过所有 UC7KS 检查。缓存健康时 SA 必须走完整 attest 流程。

**补充：次级旁路**：当 `cacheHealthy=true` 但 SA 需修复个别缓存文件时：
- SA 可调用 `knowledge_cache_attest` 声明已读缓存，走正常 attest 流程
- `reason` 中注明 `"Emergency framework repair — fixing corrupted cache entry X"`
- 不走 emergency bypass，而是通过正常 attest 流程

**审计增强**：所有 SA bypass 事件记录到 `machine.json.compliance_records.uc7ks_emergency_bypasses[]`：
```json
{
  "timestamp": "2026-06-18T...",
  "agent": "@Super-Admin",
  "reason": "Cache index.json corrupt — repair dispatch",
  "bypassed_checks": ["discovery", "attestation"]
}
```

同时写入统一日志：
- source: `lib-uc7ks-utils`
- event: `UC7KS-SA-EMERGENCY-BYPASS`
- level: `WARN`
- fields: `agent`, `sessionID`, `taskId`, `domainId`, `detail`

### §2.7 向后兼容策略

分离 `discovery`/`attestation` 是 breaking change。现有 `cache_sufficiency` 字段消失，影响 `checkUC7KS`、`checkUC7KSWrite`、agent 端响应解析。

**迁移策略**：
1. **读取时兼容**：`knowledge_cache_search` 响应中同时保留 `cache_sufficiency` (legacy 展示) 和 `discovery` (new)。
2. **写入时隔离**：`knowledge_cache_search` 写 `discovery`；legacy `cache_sufficiency` 可以保留 `status/missing_topics` 供旧展示读取，但 `reason/files_read/content_summary` 必须为空或明确标记为 deprecated/discovered，不得作为 read evidence。
3. **门禁读取优先级**：`checkUC7KSWrite` strict/locked 只接受 `discovery.status === "sufficient" && attestation.status === "attested"`。legacy `cache_sufficiency.status` 仅可用于 advisory warning 或外部查询 gate 的兼容提示。
4. **legacy 数据迁移**：已有 `cache_sufficiency.status === "sufficient"` 且无 `attestation` 的条目迁移为 `attestation.status = "pending"` 或 `legacy_discovered_only`，不得隐式通过写前门禁。advisory 模式可提示重新 `read` + `knowledge_cache_attest`；strict/locked 必须阻断。
5. **开关控制**：如需灰度，新增配置 `uc7ks_attestation_required: "advisory" | "strict"`，默认在开发期为 advisory，进入正式修复后切 strict。locked 模式无论配置如何都必须要求 attestation。
6. **状态回填脚本**：如需要迁移已有 state，只能回填 `discovery`，不能伪造 `attestation.files_read`。


## §3 涉及文件

| # | 文件 | 操作 | 说明 |
|:-:|------|:----:|------|
| 1 | `.opencode/lib/uc7ks-schema.ts` | 修改 | 新增 `discovery`/`attestation` 类型、默认值和 helper；所有读写方通过 helper 访问 |
| 2 | `.opencode/lib/uc7ks-utils.ts` | 修改 | `checkUC7KS()`/`checkUC7KSWrite()` 使用 `discovery + attestation`，保留 UC7-009 SA cache-unhealthy bypass |
| 3 | `.opencode/tools/knowledge_cache_search.ts` | 修改 | 只写 `discovery`；legacy 字段仅兼容展示，不再生成伪 read evidence |
| 4 | `.opencode/tools/knowledge_cache_attest.ts` | 新增 | 官方 OpenCode custom tool：`export default tool({...})`，`execute(args, context)` 验证 read audit 后写入 attestation，使用 `withInterruptGuard` |
| 5 | `.opencode/lib/read-audit.ts` | 修改 | 新增按 `agent/sessionID/taskId/path` 查询 read 事件的 helper；支持路径归一化和明确时间窗口 |
| 6 | `.opencode/plugins/read-track-after.ts` | 复核/小改 | 确保 `read` 后记录的 `agent/sessionID/taskId/filePath/callID` 足够支持 attest |
| 7 | `.opencode/plugins/uc7ks-after.ts` | 修改 | 停止在 read docs 后自动写 `cache_sufficiency.status=sufficient` 和通行证；只记录 read metadata |
| 8 | `.opencode/plugins/uc7ks-before.ts` | 修改 | 外部查询前检查同步到新 helper，避免只看 legacy `cache_sufficiency` |
| 9 | `.opencode/lib/tool-scope.ts` | 修改 | 新增 `getEffectivePathScopePaths()`、`isUC7KSWriteTarget()`、`isUC7KSExcludedPath()`；解析多写入目标，不可解析写命令 strict/locked 阻断 |
| 10 | `.opencode/plugins/scope-before.ts` | 修改 | 对每个写目标执行 route/scope/UC7KS；触发范围扩展至 source、`.opencode/**`、`docs/review/**`、`docs/design/**` 和指定根文件 |
| 11 | `.opencode/plugins/scope-after.ts` | 修改 | 若使用多路径 API，同步记录所有实际写目标，避免 dirty_modules 漏记 |
| 12 | `.opencode/scripts/mcp-tools/compliance-gate.ts` | 修改 | pipeline 完成和证据检查使用 `discovery/attestation`，不再只看三个 legacy evidence 字段 |
| 13 | `.opencode/scripts/framework-self-test.ts` | 修改 | Check 29 加入新工具；Check 35 改为检测 legacy pseudo evidence / missing attestation |
| 14 | `.opencode/state/schemas/knowledge-cache-state.schema.json` | 修改 | 新增双段结构，保留 legacy 字段兼容；标明 legacy 不可作为 attestation |
| 15 | `opencode.json` | 修改 | 不注册工具列表；只为需要写入的 agent 增加 `knowledge_cache_attest` permission |
| 16 | `.opencode/project.config.json` | 修改 | 新增 `write_audit` 策略配置；若 dispatch prompt/mcp_tools allowlist 依赖此处，补充 `knowledge_cache_attest`；不要影响 non-modify tool scope |
| 17 | `.opencode/agents/*.md` | 修改 | 需要执行写操作的 agent 补充 `knowledge_cache_attest` 调用说明/工具清单 |
| 18 | `.opencode/subagent-preamble.md` | 修改 | Step 0 从“search 即证据完整”改为“search -> read docs -> attest” |
| 19 | `.opencode/commands/search-knowledge.md` | 修改 | 将 `files_read` 文案改为 `discovered_files`，新增 attest 步骤 |
| 20 | `.opencode/lib/__tests__/uc7ks-domain.test.ts` / `uc7ks-utils.test.ts` | 修改/新增 | 覆盖双状态写前门禁和 legacy 阻断 |
| 21 | `.opencode/tools/__tests__/knowledge_cache_attest.test.ts` | 新增 | attest 工具验证测试 |
| 22 | `.opencode/lib/__tests__/tool-scope.test.ts` | 修改/新增 | safe_shell 多路径和不可解析写命令测试 |
| 23 | `.opencode/lib/__tests__/uc7ks-write-target.test.ts` | 新增 | 验证受保护对象与排除目录：`.opencode/logs/**`、`node_modules/**`、`.task_temp/**` 不触发，目标集合必须触发 |
| 24 | `.opencode/lib/write-audit-policy.ts` | 新增 | 读取 `project.config.json.write_audit`，提供 include/exclude/extensions/history/module/dirty-state 策略 fallback |
| 25 | `.opencode/plugins/audit-before.ts` | 修改 | 使用 write-audit policy 判断审计目标，不再直接绑定 `isSourceFile()` |
| 26 | `.opencode/plugins/audit-after.ts` | 修改 | 使用 write-audit policy 判断审计目标和 history 上限 |
| 27 | `.opencode/lib/write-audit-lib.ts` | 修改 | 使用 write-audit policy 的扩展名、排除路径、module detection、dirty state targets |
| 28 | `.opencode/state/project.config.schema.json` | 修改 | 为 `write_audit` 新增 schema，防止配置被 schema/self-test 判为未知结构 |

**OpenCode 官方约束**：`.opencode/tools/knowledge_cache_attest.ts` 文件名就是工具名 `knowledge_cache_attest`，无需也不应在 `opencode.json` 中创建“tool registry”。必须更新的是 agent permissions；否则工具即使被发现，也可能因权限矩阵无法调用。

## §4 验证策略

### §4.1 日志事件规范

新工具 `knowledge_cache_attest` 使用统一日志系统，不使用 `console.log`。日志写法应符合当前 `log-manager.ts`：

```typescript
writeLog("knowledge-cache-attest", "runtime", {
  sessionID: context.sessionID,
  callID: context.toolCallID || context.callID,
  agent,
  agentType: agent,
  level: "INFO",
  event: "UC7KS-ATTEST-PASS",
  detail: `taskId=${taskId} domainId=${domainId} files=${filesRead.length}`,
});
```

事件来源约定：
- custom tool 本身：`knowledge-cache-attest`
- UC7KS library helper：`lib-uc7ks-utils` 或新增 `lib-uc7ks-attest`
- write-time plugin：沿用 `scope-before`
- read tracking：沿用 `read-track-after` / `read-audit`

新增/更新事件：

| 事件名 | 用途 | 级别 |
|--------|------|:----:|
| `UC7KS-ATTEST-PASS` | 所有验证通过，attestation 写入成功 | INFO |
| `UC7KS-ATTEST-FAIL-DISCOVERY` | discovery 不充足 | ERROR |
| `UC7KS-ATTEST-FAIL-FILES` | files_read 不在 discovered_files 中 | ERROR |
| `UC7KS-ATTEST-FAIL-AUDIT` | read_audit.jsonl 交叉验证失败 | ERROR |
| `UC7KS-ATTEST-FAIL-EMPTY` | reason/content_summary 为空 | ERROR |
| `UC7KS-ATTEST-FAIL-SESSION` | strict/locked 下缺少 OpenCode `context.sessionID` | ERROR |
| `UC7KS-ATTEST-LEGACY-PENDING` | legacy sufficient 被降级为 pending | WARN |

`checkUC7KSWrite` 新增以下事件：

| 事件名 | 用途 | 级别 |
|--------|------|:----:|
| `UC7KS-WRITE-PASS-ATTESTED` | Path A: discovery.sufficient + attestation.attested → PASS | INFO |
| `UC7KS-WRITE-BLOCK-ATTEST` | Path A: attestation pending/missing → BLOCK | ERROR |
| `UC7KS-WRITE-BLOCK-DISCOVERY` | discovery missing/insufficient → BLOCK | ERROR |
| `UC7KS-WRITE-BLOCK-LEGACY` | strict/locked 中只存在 legacy sufficient → BLOCK | ERROR |
| `UC7KS-WRITE-BLOCK-UNPARSEABLE-SHELL` | safe_shell 写命令无法解析目标路径 → BLOCK | ERROR |
| `UC7KS-SA-EMERGENCY-BYPASS` | SA 紧急旁路触发 | WARN |

所有日志必须包含可追踪字段：`sessionID`、`callID`（如可得）、`agent`、`taskId`、`domainId`、`detail`。插件 hook 中 `tool.execute.before/after` 参数按官方约定区分：before 使用 `output.args`，after 使用 `input.args`，不要混用。

### §4.2 单元测试

| 测试场景 | 预期 |
|---------|------|
| `knowledge_cache_attest` + 合法参数 + 有 read 记录 | `status: "attested"` |
| `knowledge_cache_attest` + `files_read` 含未读文件 | rejected，指明哪些文件未读 |
| `knowledge_cache_attest` + `files_read` 不在 `discovered_files` 中 | rejected |
| `knowledge_cache_attest` + `reason` 或 `content_summary` 为空 | rejected |
| `knowledge_cache_attest` + `context.sessionID` 缺失 + strict/locked | rejected |
| `knowledge_cache_attest` + index 相对路径 vs read repo 相对路径 | 归一化后通过 |
| `checkUC7KSWrite` + sufficient + attested | PASS |
| `checkUC7KSWrite` + sufficient + pending (含 undefined) | BLOCK: attestation |
| `checkUC7KSWrite` + insufficient + attested | BLOCK: insufficient |
| safe_shell `sed -i` 触发 checkUC7KSWrite | BLOCK/PASS 取决于 UC7KS |
| safe_shell `echo x >> file.ts` 或 heredoc 写文件 | strict/locked BLOCK: unparseable shell |
| `isUC7KSWriteTarget` + `.opencode/plugins/x.ts` | true |
| `isUC7KSWriteTarget` + `.opencode/logs/x.log` | false |
| `isUC7KSWriteTarget` + `docs/review/a.md` / `docs/design/a.md` | true |
| `isUC7KSWriteTarget` + `AGENTS.md` / `contract.yaml` / `opencode.json` | true |
| `isUC7KSWriteTarget` + `node_modules/pkg/a.js` / `.task_temp/T/HANDOVER.md` | false |
| `readWriteAuditPolicy` + 缺失配置 | 使用当前硬编码等价 fallback |
| `write_audit.target.include_paths` + `docs/review/a.md` | audit-before 进入 write audit |
| `write_audit.target.exclude_paths` + `.opencode/logs/x.log` | audit-before/audit-after 均跳过 |
| `write_audit.history.max_entries=50` | audit-after history 只保留 50 条 |
| `write_audit.module_detection.patterns` 命中 | dirty module 使用配置提取名 |
| `write_audit.dirty_state_targets=["eslint_state"]` | 只标记指定 dirty state，仍保留 `write_audit_state` |
| legacy 数据迁移：旧 cache_sufficiency + 无 attestation | strict/locked BLOCK，advisory WARN |
| `uc7ks-after.ts` read docs 后 | 不再自动写 `sufficient`/`attested` |
| `compliance-gate.ts` pipeline 检查 | discovery sufficient 但无 attestation 时返回失败/警告 |
| `framework-self-test.ts` Check 29/35 | 新工具存在，legacy pseudo evidence 可被发现 |

**测试文件位置**：
- `.opencode/lib/__tests__/uc7ks-utils.test.ts` — checkUC7KSWrite 双状态
- `.opencode/tools/__tests__/knowledge_cache_attest.test.ts` — attest 验证
- `.opencode/lib/__tests__/tool-scope.test.ts` — shell 写路径解析
- `.opencode/lib/__tests__/uc7ks-write-target.test.ts` — 写前 UC7KS 受保护目标集合
- `.opencode/lib/__tests__/write-audit-policy.test.ts` — project.config write_audit 策略读取与 fallback
- `.opencode/plugins/__tests__/audit-policy-integration.test.ts` — audit-before/audit-after 使用配置目标集合
- `.opencode/scripts/__tests__/framework-self-test.test.ts` 或现有等效测试 — Check 29/35 行为

### §4.3 集成测试

| 测试 | 步骤 |
|------|------|
| 正路 | `declare` → `search` → `read` 缓存 → `attest` → `safe_edit` → PASS |
| 未 attest | `declare` → `search` → (不 read, 不 attest) → `safe_edit` → BLOCK |
| 读了但不 attest | `declare` → `search` → `read` 缓存 → (不 attest) → `safe_edit` → BLOCK |
| insufficient 缓存 | `search` 返回 insufficient → 即使 attest 也无法写 → 需外部搜索 |
| SA 紧急旁路 | 删除 index.json → SA `safe_edit` → 通过（旁路日志记录） |
| 框架文件写入 | `search` 但不 attest → 修改 `.opencode/project.config.json` → BLOCK |
| review/design 文档写入 | `search` 但不 attest → 修改 `docs/review/a.md` 或 `docs/design/a.md` → BLOCK |
| 根配置写入 | `search` 但不 attest → 修改 `AGENTS.md` / `contract.yaml` / `opencode.json` → BLOCK |
| 排除目录写入 | 修改 `.opencode/logs/x.log` / `.task_temp/x` / `node_modules/x` → 不触发 UC7KS 写前检查 |
| write_audit 配置目标 | `write_audit.target.include_paths` 增加 `docs/design/**` → audit-before/audit-after 同步审计该路径 |
| write_audit 配置排除 | `write_audit.target.exclude_paths` 包含 `.opencode/logs/**` → UC7KS 和 write audit 均跳过日志目录 |
| safe_shell 写入 | `sed -i` 修改 `.opencode/*.ts` → 进入同一 UC7KS 门禁 |
| 外部查询 | 未完成 discovery/attestation 前调用 Context7/Web/GitHub 外部工具 → 按新 helper 阻断或告警 |

## §5 风险与降级

| # | 风险 | 缓解 |
|:-:|------|------|
| R1 | `knowledge_cache_attest` 被 agent 跳过导致阻塞 | 错误消息明确指导下一步；可快速提交 pull |
| R2 | `read_audit.jsonl` sessionId 匹配 | strict/locked 使用 OpenCode `context.sessionID`；fallback 仅 advisory；路径归一化并记录失败细节 |
| R3 | shell 命令误解析或漏解析 | 多路径解析 + 不可解析写命令 strict/locked 阻断；提示改用结构化工具 |
| R4 | legacy 数据兼容 | legacy sufficient 迁移为 pending，不伪造 attestation；灰度期 advisory warning |
| R5 | 框架文件 UC7KS 写前阻塞 SA 修复 | UC7-009 旁路仅缓存不可用时生效。缓存健康时 SA 走正常 attest |
| R6 | 权限矩阵遗漏新工具导致 agent 无法 attest | 更新 `opencode.json` 每个需写 agent 的 permission，并用 framework self-test 检查 |
| R7 | `uc7ks-after.ts` 继续自动设 sufficient | 把该插件改为只记录 read metadata，并增加回归测试 |
| R8 | 合规门/自测仍读旧字段 | `compliance-gate.ts` 和 `framework-self-test.ts` 必须与 schema helper 同步改造 |

## §6 实施步骤

```
Phase 0: 开关与模型（不改变阻断行为）
  1. 在 schema/helper 中加入 discovery/attestation，保留 legacy 字段。
  2. 新增 `uc7ks_attestation_required` 灰度配置，默认 advisory。
  3. 新增 read-audit 查询/路径归一化 helper。
  4. 在 `project.config.json`/schema 中新增 `write_audit` 策略配置与 fallback 默认值。

Phase 1: 工具与权限
  5. 创建 `.opencode/tools/knowledge_cache_attest.ts`（官方 `tool()` + `withInterruptGuard` + `writeLog`）。
  6. 更新 `opencode.json` agent permissions；不要添加不存在的 tool registry。
  7. 更新 agent 配置、`.opencode/subagent-preamble.md`、`.opencode/commands/search-knowledge.md`。
  8. 更新 `framework-self-test.ts` Check 29，确保新工具和权限可发现。

Phase 2: discovery/attestation 数据流
  9. 修改 `knowledge_cache_search.ts`：只写 discovery；legacy evidence 清空或标 deprecated。
  10. 修改 `uc7ks-after.ts`：read docs 只记 metadata，不自动 sufficient/attested。
  11. 修改 `uc7ks-schema.ts`/`uc7ks-utils.ts`：所有判断走 helper。
  12. 修改 `compliance-gate.ts` 和 `uc7ks-before.ts`：同步新 helper。

Phase 3: 写路径覆盖
  13. 修改 `tool-scope.ts`：新增 `getEffectivePathScopePaths()`。
  14. 新增 `isUC7KSWriteTarget()` / `isUC7KSExcludedPath()`：
      - include: source、`.opencode/**`、`docs/review/**`、`docs/design/**`、`AGENTS.md`、`contract.yaml`、`opencode.json`
      - exclude: `.opencode/logs/**`、`logs/**`、`node_modules/**`、`.task_temp/**`、`task_temp/**`
  15. 修改 `scope-before.ts`：对所有写目标执行 route/scope/UC7KS；仅 `isUC7KSWriteTarget(path) === true` 时触发 UC7KS。
  16. 修改 `scope-after.ts`：多路径 dirty tracking。

Phase 3.5: audit/write 模板化
  17. 新增 `write-audit-policy.ts`，从 `project.config.json.write_audit` 读取 target/include/exclude/extensions/history/module/dirty-state 策略。
  18. 修改 `audit-before.ts`、`audit-after.ts`、`write-audit-lib.ts` 使用该策略。
  19. 确保 `opencode.json` 仍是 agent permission 唯一权威源，`write_audit` 不参与 allow/deny 权限判定。

Phase 4: 严格化与验证
  20. 单元测试：attest、uc7ks-utils、tool-scope、uc7ks-write-target、write-audit-policy、legacy migration。
  21. 集成测试：正路/负路/框架文件/review-design 文档/root 配置/write-audit 配置/safe_shell/SA bypass。
  22. 更新 `framework-self-test.ts` Check 35，检测 legacy pseudo evidence 和 missing attestation。
  23. advisory 运行一轮无误后，将 `uc7ks_attestation_required` 提升到 strict。
```

## §7 最小验收标准

实施完成必须同时满足：

1. `knowledge_cache_search` 不再自动生成可被门禁采信的 `reason/files_read/content_summary`。
2. 未调用 `read` + `knowledge_cache_attest` 时，strict/locked 下写任一 UC7KS 受保护目标必定阻断。
3. `uc7ks-after.ts` 读取官方文档后不会自动写 `sufficient` 或 `attested`。
4. 修改业务源码、`.opencode/**`（排除 `.opencode/logs/**`）、`docs/review/**`、`docs/design/**`、`AGENTS.md`、`contract.yaml`、`opencode.json` 时均进入 UC7KS 写前链。
5. 修改 `.opencode/logs/**`、`logs/**`、`node_modules/**`、`.task_temp/**`、`task_temp/**` 时不触发 UC7KS 写前检查。
6. `safe_shell` 可解析写目标时逐路径检查；不可解析写命令 strict/locked 阻断。
7. `project.config.json.write_audit` 可控制 audit target include/exclude、文件扩展名、history 上限、module detection 和 dirty state targets。
8. `opencode.json` 仍是 agent 写权限唯一权威源；`write_audit` 配置不得改变任何 agent allow/deny 权限。
9. 新工具符合官方 OpenCode custom tool 规范：`.opencode/tools/knowledge_cache_attest.ts`、`export default tool()`、`execute(args, context)`、Zod schema、无 `console.log`。
10. 所有新增诊断进入 `writeLog()`，日志含 `sessionID/agent/taskId/domainId/detail`。
11. `compliance-gate.ts`、`framework-self-test.ts`、agent preamble、`/search-knowledge` 文档均同步到 discovery → read → attest 流程。

---

## §8 实施验证结果

**版本**: v1.1.0 → v1.2.0  
**状态更新**: reviewed-revision → implemented  
**实施日期**: 2026-06-18  
**验证日期**: 2026-06-18  
**最终自测**: 41/41 PASS

### §8.1 实施总结

| Phase | 内容 | 状态 |
|:-----:|------|:----:|
| Phase 0 | 数据模型：discovery/attestation 双段结构、schema、checkUC7KSWrite 双状态 | ✅ 完成 |
| Phase 1 | knowledge_cache_attest 工具（5 步验证）、read_audit.jsonl 交叉验证 | ✅ 完成 |
| Phase 2 | 受保护对象扩展（isUC7KSWriteTarget）、safe_shell 多路径解析 | ✅ 完成 |
| Phase 3 | 验证：正路/负路/排除目录/safe_shell/self-test | ✅ 完成 |

### §8.2 Bug 修复清单

| Bug | 描述 | 文件 | 状态 |
|:---:|------|------|:----:|
| BUG-001 | isSourceFile import 缺失 | tool-scope.ts | ✅ 修复 |
| BUG-002 | tee 解析器捕获重定向符 | tool-scope.ts | ✅ 修复 |
| BUG-003 | touch 不在 isModifyShell | tool-scope.ts | ✅ 修复 |
| BUG-004 | cp 只提取 dst（设计正确） | tool-scope.ts | ✅ 无需修复 |
| BUG-005 | OPENCODE_ROOT 为空 | 环境变量 | ✅ 重启后修复 |
| BUG-006 | python3 -c 绕过门禁 | tool-scope.ts | ✅ 修复 |
| BUG-007 | Bun 缓存阻止热修复 | 框架 | ✅ 重启后修复 |

### §8.3 集成测试结果

| 测试 | 描述 | 结果 |
|:----:|------|:----:|
| T1 | 正路：declare→search→read→attest→edit | ✅ PASS |
| T2 | 负路：不 read 不 attest → edit BLOCK | ✅ BLOCK(Path B) |
| T3 | 负路：read 但不 attest → edit BLOCK | ✅ BLOCK(Sub-path A2) |
| T4 | 排除目录 .opencode/logs/ | ✅ 不触发 |
| T5 | safe_shell sed -i 触发 UC7KS | ✅ 触发 |
| T6 | 排除目录 .task_temp/ | ✅ 不触发 |
| T7 | read_audit.jsonl 记录 | ✅ 正确记录 |
| T8 | attest 5 步验证 | ✅ 返回值正确 |

### §8.4 涉及文件改动统计

| # | 文件 | 行数 | 类型 |
|:-:|------|:----:|:----:|
| 1 | `.opencode/lib/uc7ks-utils.ts` | 412 | 修改 — checkUC7KSWrite 双状态 |
| 2 | `.opencode/lib/uc7ks-schema.ts` | +198 | 修改 — 6 个新 type/helper |
| 3 | `.opencode/lib/tool-scope.ts` | 337 | 修改 — 多路径解析 + 受保护对象 |
| 4 | `.opencode/lib/read-audit.ts` | +1 | 修改 — getReadEventsForSession |
| 5 | `.opencode/tools/knowledge_cache_search.ts` | 300 | 修改 — discovery 只写 |
| 6 | `.opencode/tools/knowledge_cache_attest.ts` | 344 | 新增 — 5 步验证工具 |
| 7 | `.opencode/plugins/scope-before.ts` | 229 | 修改 — isUC7KSWriteTarget |
| 8 | `.opencode/plugins/uc7ks-after.ts` | ~110 | 修改 — 不再自动 sufficient |
| 9 | `.opencode/state/schemas/knowledge-cache-state.schema.json` | 200 | 修改 — 双段结构 |
| 10 | `.opencode/state/machine.json` | — | — (状态更新) |

---

## §9 Post-E2E Findings: 空 read 证据与并行 domain 解析

**来源**: E2E-READ-WRITE-v2 S3, PARALLEL-TEST-A  
**结论**: 两个问题均属实，且都不是 MCP/插件注册问题；应在现有 custom tool、dispatch context library、self-test/E2E 层修复。

### §9.1 Finding 1: `knowledge_cache_attest` 接受空 `files_read`

| 字段 | 内容 |
| --- | --- |
| 严重度 | ⚠️ validation_gap |
| 来源 | E2E-READ-WRITE-v2 S3 |
| 影响 | agent 可以在 discovery sufficient 后提交空 `files_read: []`，绕过“至少读过一个缓存文件”的实质要求 |

#### 根因

当前 `.opencode/tools/knowledge_cache_attest.ts` 已经按官方 OpenCode custom tool 规范实现为 `.opencode/tools/*.ts` + `export default tool()`，但输入验证仍缺一条最小基数约束：

1. `args.files_read` 使用 `tool.schema.array(tool.schema.string())`，没有 `.min(1)` 或运行时等价检查。
2. Step 2 的 `files_read ⊆ discovered_files` 检查在空数组上 vacuously true。
3. Step 3 的 read-audit 交叉验证只遍历 `filesRead`，空数组不会产生 `notRead`。
4. Step 5 写入 attestation 时允许 `files_read=[]`，DB `knowledge_attestation.evidence_file_count` 会被写成 `0`，但状态仍可能是 `attested`。

这违反了本方案 §2.3 的语义：`files_read` 必须是 agent 实际通过 OpenCode `read` 工具打开过的缓存文件子集，而不是可为空的装饰字段。

#### 修复方案

修改 `.opencode/tools/knowledge_cache_attest.ts`，在 discovery sufficient 后、Step 2 子集验证前加入 fail-closed 运行时校验：

```typescript
const normalizedFilesRead = (args.files_read || [])
  .map((f) => String(f || "").trim())
  .filter(Boolean);

if (normalizedFilesRead.length === 0) {
  writeLog(SRC, "ERROR", {
    sessionID: sessionId,
    agent,
    taskId,
    domainId: domain,
    event: "UC7KS-ATTEST-FAIL-EMPTY-FILES",
    detail: "files_read must contain at least one actually read cache file",
  });
  try { incrementAuditCounter("total_attestation_failures"); } catch {}
  return JSON.stringify({
    attested: false,
    step: 2,
    error:
      "files_read must contain at least one cache file that you actually opened with the read tool.",
    discovered_files: discovery.discovered_files,
    next_step:
      "Use the read tool on one or more discovered_files, then call knowledge_cache_attest again.",
  });
}

filesRead = Array.from(new Set(normalizedFilesRead));
```

Implementation notes:

- 保留 tool schema 的兼容性；不要依赖新版 Zod `.min(1)` 是否被 OpenCode runtime 正确缓存。
- 运行时校验必须走 `writeLog()`，事件名固定为 `UC7KS-ATTEST-FAIL-EMPTY-FILES`。
- `knowledge_attestation.evidence_file_count` 必须大于 0 才允许 `status='attested'`。
- `reason` 与 `content_summary` 的非空校验保留，但不能替代 `files_read.length > 0`。

#### 验收

| 场景 | 预期 |
| --- | --- |
| `knowledge_cache_attest(files_read=[])` | rejected，event=`UC7KS-ATTEST-FAIL-EMPTY-FILES` |
| `knowledge_cache_attest(files_read=[""])` | rejected，同上 |
| `knowledge_cache_attest(files_read=["valid.md"])` 且 read-audit 有记录 | attested |
| `knowledge_attestation.evidence_file_count=0` 且 `status='attested'` | self-test fail |

新增测试：

- `.opencode/tools/__tests__/knowledge_cache_attest.test.ts`: 空数组/空字符串数组应失败。
- `.opencode/scripts/framework-self-test.ts`: 静态检查 `UC7KS-ATTEST-FAIL-EMPTY-FILES` 和 `evidence_file_count > 0` 约束。

### §9.2 Finding 2: 并行派遣时 `resolve_domain_id()` 返回错误 domain

| 字段 | 内容 |
| --- | --- |
| 严重度 | ⚠️ domain_mismatch |
| 来源 | PARALLEL-TEST-A |
| 现象 | 并行派遣 Coder-FE/Coder-BE 时，`resolve_domain_id()` 可能返回与 `ctx/{dagTaskId}.json` 不一致的 domain，例如 `frontend_ui` vs `backend_api` |

#### 根因

当前实现混用了 three sources：

1. `session_map` DB: `resolveDomainId(sessionId)` 的首选。
2. `.task_temp/_dispatch/ctx/{dagTaskId}.json`: per-dispatch 文件，理论上 race-free。
3. `.task_temp/_dispatch/.dispatch_ctx`: legacy singleton，天然会被并发覆盖。

问题出在 fallback 选择规则和 session 归属：

- `.opencode/tools/resolve_domain_id.ts` 只接收 `sessionId`，不接收 `dag_task_id`，因此无法读取精确的 `ctx/{dagTaskId}.json`。
- `.opencode/lib/agent-resolver.ts::resolveDomainId(sessionId)` 在 DB 读不到时会扫描整个 `ctx/` 目录；当有多个 ctx 文件时，它选择 `createdAt` 最新的那个。这在并行派遣下会读取“另一个 dispatch”的 domain。
- `.opencode/tools/dispatch_subagent.ts` 在派遣时把 `dagTaskId/domainId` 写入父 `context.sessionID` 的 `session_map`，而不是尚未创建的子 agent session。子 agent 调用 `resolve_domain_id(context.sessionID)` 时，DB 往往没有自己的 session row，进而落入危险的 `ctx/ newest` fallback。
- `.opencode/plugins/session.ts` 的 `chat.message` hook 会调用 `resolveTaskId(sid)` / `resolveDomainId(sid)` 后写 `session_map`。如果这一步使用了 `ctx/ newest`，错误 domain 会被固化到 DB。
- `resolve_domain_id.ts` 返回的 `resolved_from` 目前只按 `domainId ? "session_map" : "none"` 填写，无法区分 DB、exact ctx、newest ctx、legacy ctx，掩盖了误解析。

#### 修复方案

新增一个明确的 dispatch context 解析契约，禁止安全路径使用 ambient newest fallback。

**A. `agent-resolver.ts`**

新增 typed helper：

```typescript
export interface DispatchContextResolution {
  domainId: string | null;
  dagTaskId: string | null;
  agentType: string | null;
  resolvedFrom:
    | "session_map"
    | "dispatch_context"
    | "ctx_exact"
    | "ctx_single"
    | "legacy_dispatch_ctx"
    | "none"
    | "ambiguous";
  confidence: "exact" | "single-fallback" | "legacy" | "none" | "ambiguous";
  candidates?: string[];
  detail: string;
}

export function resolveDispatchContext(input: {
  sessionId?: string;
  dagTaskId?: string;
}): DispatchContextResolution;
```

Resolution order:

1. `session_map` by exact `sessionId`; if `dagTaskId` is provided, require DB row `dag_task_id` to match or report mismatch.
2. `dispatch_context` by exact `(sessionId)` or exact `(dagTaskId)` if available.
3. `ctx/{dagTaskId}.json` exact match when `dagTaskId` is provided.
4. `ctx/` single-file fallback only when there is exactly one context file.
5. legacy `.dispatch_ctx` only when no `ctx/*.json` exists or when it matches the provided `dagTaskId`.
6. If multiple `ctx/*.json` exist and no exact `dagTaskId` is available, return `resolvedFrom="ambiguous"` and `domainId=null`; do not choose newest.

Required log events:

| Source | Event | Level |
| --- | --- | --- |
| `agent-resolver` | `DOMAIN-RESOLVED` | INFO |
| `agent-resolver` | `DOMAIN-RESOLVE-MISMATCH` | ERROR |
| `agent-resolver` | `DOMAIN-RESOLVE-AMBIGUOUS` | WARN |
| `agent-resolver` | `DISPATCH-CTX-READ-ERROR` | ERROR |

**B. `resolve_domain_id.ts`**

Keep official custom tool shape; do not add MCP server. Update args:

```typescript
args: {
  sessionId: tool.schema.string().optional(),
  dag_task_id: tool.schema.string().optional(),
}
```

Call `resolveDispatchContext({ sessionId, dagTaskId: args.dag_task_id })` and return:

```json
{
  "domain_id": "backend_api",
  "dag_task_id": "PARALLEL-BE",
  "agent_type": "Coder-BE",
  "resolved_from": "ctx_exact",
  "confidence": "exact",
  "ambiguous": false
}
```

If ambiguous, return no domain and an actionable error:

```json
{
  "domain_id": null,
  "resolved_from": "ambiguous",
  "confidence": "ambiguous",
  "error": "Multiple dispatch contexts exist. Re-run resolve_domain_id with dag_task_id.",
  "candidates": ["PARALLEL-BE", "PARALLEL-FE"]
}
```

**C. `.opencode/subagent-preamble.md` and `/search-knowledge`**

Update Step 0a so agents pass the exact dispatch-assigned task id:

```text
resolve_domain_id(sessionId=context.sessionID, dag_task_id="<dispatch-assigned task_id>")
module_scope_declare(module=<returned domain_id>, task_id="<same task_id>")
```

**D. `session.ts`**

The session hook must not write `session_map` with a domain resolved from `ambiguous`, `ctx_newest`, or legacy fallback. It may:

- write only agent identity when no exact task/domain context exists;
- preserve an existing exact `dag_task_id/domain_id`;
- log `SESSION-MAP-DOMAIN-SKIPPED` when context is ambiguous.

**E. `task-after.ts`**

After Task returns and `subSessionId` is known, write canonical child mapping:

```typescript
dbWriteSessionMap(subSessionId, subAgentType, dagTaskId, domainId);
dbInsertDispatchContext(..., subSessionId, dagTaskId, subAgentType, domainId);
```

This write should happen even when no matching `dispatch_queue` running entry is found; in that case insert `dispatch_context` with nullable `dispatch_id` or add a separate helper that records context without queue linkage. If schema keeps `dispatch_id INTEGER REFERENCES dispatch_queue(id)` nullable, use `null`.

**F. `dispatch_subagent.ts`**

Stop treating the parent `context.sessionID` as the canonical child dispatch context. Parent session may record last dispatch for diagnostics, but UC7KS domain enforcement must use child session + exact `dag_task_id` or `dispatch_context`.

#### 验收

| 场景 | 预期 |
| --- | --- |
| 并行 Coder-BE + Coder-FE，均调用 `resolve_domain_id(dag_task_id=...)` | BE=`backend_api`，FE=`frontend_ui` |
| 多个 `ctx/*.json` 存在，调用 `resolve_domain_id()` 不带 `dag_task_id` | 返回 ambiguous，不返回错误 domain |
| `session_map.domain_id` 与 `ctx/{dagTaskId}.json.domainId` 不一致 | 返回 mismatch，strict/locked 下阻断 Step 0a |
| `task-after.ts` 完成后查询 child `session_map` | child session row 包含正确 agent/task/domain |
| self-test | 新增 PARALLEL-DOMAIN-CONTEXT 检查通过 |

新增测试：

- `.opencode/lib/__tests__/agent-resolver.test.ts`: 多 ctx 无 dagTaskId 返回 ambiguous；精确 dagTaskId 返回 exact ctx。
- `.opencode/tools/__tests__/resolve_domain_id.test.ts`: 工具 JSON 输出包含 `resolved_from/confidence`。
- E2E `PARALLEL-TEST-A`: 并行派遣 BE/FE，验证 `resolve_domain_id` 与 ctx 文件一致。

### §9.2.1 实施策略：C+A 混合（env 作 bootstrap + session hook 持久化）

> **决策日期**：2026-06-21
> **决策依据**：在 §9.2 的参数化方案（"B 路径"）基础上叠加 env 传输（"A 路径"最小范围复活）与子 session 启动时写库（"C 路径"），解决参数化方案在 plugin 层断裂的问题（`scope-before.ts` / `uc7ks-after.ts` / `session.ts` 的 `input` 中没有 `dag_task_id`，无法参数化传入）。

#### 核心思路

1. **env 仅作 bootstrap 通道**：`dispatch_subagent.ts` 给子 agent 进程注入 `process.env.OPENCODE_DAG_TASK_ID`（不复用历史 `FRAMEWORK_TASK_ID` 名，避免与 `FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18)` 决策冲突，也避免 gate-before P2-1 误读旧名触发 stale task ID 阻断）。
2. **子 session 启动时一次性写库**：`plugins/session.ts` 的 `session.created` hook 读取该 env，调 `dbWriteSessionMap(childSessionId, agentType, dagTaskId, domainIdFromCtx)` 把子 agent 自己的 session 行建好，然后 `delete process.env.OPENCODE_DAG_TASK_ID` 防止嵌套 dispatch 污染。
3. **`resolveDomainId` 签名不变**：子 agent 调它时 P1（session_map）命中自己的行，不再 fall into 危险的 P2 `ctx/ newest`。
4. **P2 兜底按 §9.2 改为 `ambiguous`**：若多文件且无 dagTaskId 命中，返回 `{ resolvedFrom: "ambiguous", domainId: null }`，不再取 newest。
5. **保留 §9.2 的 `dagTaskId` 可选参数**：tool 调用路径（`resolve_domain_id.ts` / `module_scope_declare` / `/search-knowledge`）继续使用显式参数化，作为精确匹配的辅助通道。

#### 数据流（并行 Coder-BE + Coder-FE）

```
parent (Orchestrator)
  │
  ├── dispatch_subagent(Coder-BE, dag_task_id="PARALLEL-BE")
  │     ├─ write ctx/PARALLEL-BE.json  {dagTaskId, domainId="backend_api", agentType}
  │     ├─ dbWriteSessionMap(parentSid, "Coder-BE", "PARALLEL-BE", "backend_api")   ← 父行（保留诊断用）
  │     └─ spawn child process env={..., OPENCODE_DAG_TASK_ID="PARALLEL-BE"}
  │
  ├── dispatch_subagent(Coder-FE, dag_task_id="PARALLEL-FE")
  │     ├─ write ctx/PARALLEL-FE.json  {dagTaskId, domainId="frontend_ui", agentType}
  │     ├─ dbWriteSessionMap(parentSid, "Coder-FE", "PARALLEL-FE", "frontend_ui")   ← 父行（被覆盖，仅诊断用）
  │     └─ spawn child process env={..., OPENCODE_DAG_TASK_ID="PARALLEL-FE"}
  │
  ▼

child Coder-BE (new session ses_be)
  │
  ├── session.created hook (plugins/session.ts)
  │     ├─ read process.env.OPENCODE_DAG_TASK_ID = "PARALLEL-BE"
  │     ├─ read ctx/PARALLEL-BE.json → domainId="backend_api", agentType="Coder-BE"
  │     ├─ dbWriteSessionMap(ses_be, "Coder-BE", "PARALLEL-BE", "backend_api")     ← ✅ 子行建好
  │     ├─ writeLog("session", "INFO", { event: "CHILD-SESSION-BOOTSTRAP", ... })
  │     └─ delete process.env.OPENCODE_DAG_TASK_ID                                ← ✅ 一次性使用
  │
  └── 任意后续调用 resolveDomainId(ses_be)
        └─ P1 session_map → {domain_id:"backend_api", dag_task_id:"PARALLEL-BE"}  ✅ 命中

child Coder-FE (new session ses_fe)
  └── 同上 → dbWriteSessionMap(ses_fe, "Coder-FE", "PARALLEL-FE", "frontend_ui")
              resolveDomainId(ses_fe) → frontend_ui  ✅ 命中
```

#### 改动矩阵（6 个文件 + 2 个测试）

| # | 文件 | 改动 | 优先级 |
|---|------|------|--------|
| 1 | `.opencode/tools/dispatch_subagent.ts` | 子进程 env 注入 `OPENCODE_DAG_TASK_ID=dagTaskId`（L535-545 env 块）；保持父 session_map 写入作为诊断数据 | P0 |
| 2 | `.opencode/plugins/session.ts` | `session.created` hook 增加 bootstrap 逻辑：读 env → 读 ctx → `dbWriteSessionMap` → 清 env | P0 |
| 3 | `.opencode/lib/agent-resolver.ts` | `resolveDomainId()` P2 多文件分支返回 `{resolvedFrom:"ambiguous", domainId:null}`；函数签名保持，返回值类型扩展为 `string \| null \| {domainId, dagTaskId, resolvedFrom}`（向后兼容：string 路径仍返回 string） | P0 |
| 4 | `.opencode/tools/resolve_domain_id.ts` | args 增加 `dag_task_id` optional；按 §9.2 返回 `{domain_id, dag_task_id, agent_type, resolved_from, confidence}` JSON | P1 |
| 5 | `.opencode/subagent-preamble.md` | Step 0a 显式传 `dag_task_id` 给 `resolve_domain_id`；增加 bootstrap 校验注释 | P1 |
| 6 | `.opencode/commands/search-knowledge.md` | Step 3 调用 `module_scope_declare` 时显式传 `task_id`（与 preamble 保持一致） | P2 |
| 7 | `.opencode/lib/__tests__/agent-resolver.test.ts` | 新增：多 ctx 无 dagTaskId → ambiguous；精确 dagTaskId → exact ctx；session_map 命中 → 优先于 ctx | P0 |
| 8 | `.opencode/tools/__tests__/resolve_domain_id.test.ts` | 新增：工具 JSON 输出包含 `resolved_from/confidence`；ambiguous 时返回错误 | P1 |

#### 1. `dispatch_subagent.ts` — env 注入

```typescript
// .opencode/tools/dispatch_subagent.ts (L535 env block)
env: {
  ...process.env,
  DISPATCH_TASK_DESC: args.task_description,
  // C+A hybrid: bootstrap child session with its own dag_task_id.
  // Named OPENCODE_DAG_TASK_ID to avoid collision with the historical
  // FRAMEWORK_TASK_ID (removed in FW-CLEANUP-FRAMEWORK-TASK-ID 2026-06-18)
  // and to keep gate-before P2-1 from misreading it as a stale task ID.
  OPENCODE_DAG_TASK_ID: dagTaskId || "",
  OPENCODE_DISPATCH_AGENT_TYPE: args.agent_type || "",
  ...(args.resume_session_id
    ? { DISPATCH_RESUME_SESSION_ID: args.resume_session_id }
    : {}),
},
```

**约束**：

- 不恢复 `FRAMEWORK_TASK_ID` 名（与清理决策冲突）。
- 父 session 的 `dbWriteSessionMap(context.sessionID, …)` 调用**保留**（L735），作为"最后一次 dispatch 诊断"数据；但 UC7KS 强制路径不再依赖它。
- 写入 `ctx/{dagTaskId}.json` 的逻辑保持不变（L695-723）。

**日志**：

```typescript
writeLog("dispatch_subagent", "INFO", {
  event: "DISPATCH-ENV-BOOTSTRAP",
  sessionID: context.sessionID,
  dagTaskId,
  agentType: args.agent_type,
  detail: `OPENCODE_DAG_TASK_ID injected into child env for bootstrap`,
});
```

#### 2. `session.ts` — session.created hook 持久化

```typescript
// .opencode/plugins/session.ts — session.created hook
import { dbWriteSessionMap, dbReadSessionMap } from "../lib/db-state-manager";
import { writeLog } from "../lib/log-manager";
import * as fs from "node:fs";
import * as path from "node:path";

async function onSessionCreated(input: { sessionID: string }): Promise<void> {
  const sid = input.sessionID;
  const dagTaskId = process.env.OPENCODE_DAG_TASK_ID;
  const agentType = process.env.OPENCODE_DISPATCH_AGENT_TYPE;

  // Bootstrap path: only when env vars are present (child of a dispatch)
  if (!dagTaskId || !agentType) {
    writeLog("session", "DEBUG", {
      event: "SESSION-CREATED-NO-BOOTSTRAP",
      sessionID: sid,
      detail: "no OPENCODE_DAG_TASK_ID in env — not a dispatched child",
    });
    return;
  }

  try {
    // Read ctx file for canonical domainId (source of truth)
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    const ctxPath = path.join(ctxDir, dagTaskId + ".json");
    let domainId: string | null = null;
    if (fs.existsSync(ctxPath)) {
      try {
        const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
        if (ctx?.domainId) domainId = ctx.domainId;
      } catch {
        /* non-fatal */
      }
    }

    // Write child's own session_map row (immune to parallel dispatch race)
    dbWriteSessionMap(sid, agentType, dagTaskId, domainId || undefined);

    writeLog("session", "INFO", {
      event: "CHILD-SESSION-BOOTSTRAP",
      sessionID: sid,
      dagTaskId,
      agentType,
      domainId,
      detail: `child session_map row created via env bootstrap`,
    });

    // One-shot: clear env to prevent nested dispatch pollution
    delete process.env.OPENCODE_DAG_TASK_ID;
    delete process.env.OPENCODE_DISPATCH_AGENT_TYPE;
  } catch (e: any) {
    writeLog("session", "ERROR", {
      event: "CHILD-SESSION-BOOTSTRAP-FAILED",
      sessionID: sid,
      dagTaskId,
      detail: e.message || String(e),
    });
  }
}
```

**约束**：

- 只在 `dagTaskId` 存在时触发 bootstrap；原生会话（人开的 TUI）不走这条路径。
- `ctx/{dagTaskId}.json` 是 domainId 的唯一来源，不从 env 拿 domainId（避免 dispatch 时推断错误的 domainId 被固化）。
- env 清理必须在 bootstrap 完成后执行；异常时保留 env 以便 task-before.ts 等其他 hook 仍可使用。

**chat.message hook 约束（§9.2.D 落地）**：

```typescript
// plugins/session.ts chat.message hook — refuse to write ambiguous domain
const resolution = resolveDispatchContext({ sessionId: sid });
if (
  resolution.resolvedFrom === "ambiguous" ||
  resolution.resolvedFrom === "legacy_dispatch_ctx"
) {
  writeLog("session", "WARN", {
    event: "SESSION-MAP-DOMAIN-SKIPPED",
    sessionID: sid,
    resolvedFrom: resolution.resolvedFrom,
    detail: `refusing to write session_map with non-exact domain`,
  });
  // write agent only, omit dag_task_id and domain_id
  dbWriteSessionMap(sid, agent, undefined, undefined);
} else {
  dbWriteSessionMap(
    sid,
    agent,
    resolution.dagTaskId || undefined,
    resolution.domainId || undefined,
  );
}
```

#### 3. `agent-resolver.ts` — P2 改为 ambiguous

```typescript
// .opencode/lib/agent-resolver.ts (resolveDomainId L387-406 替换)
export interface DomainResolution {
  domainId: string | null;
  dagTaskId: string | null;
  resolvedFrom:
    | "session_map"
    | "ctx_exact"
    | "ctx_single"
    | "legacy_dispatch_ctx"
    | "ambiguous"
    | "none";
  confidence: "exact" | "single-fallback" | "legacy" | "ambiguous" | "none";
  detail: string;
}

// P2 多文件分支（替换原 "取 newest" 逻辑）
if (files.length > 1) {
  writeLog(SRC, "WARN", {
    event: "DOMAIN-RESOLVE-AMBIGUOUS",
    sessionID: sessionId,
    detail: `multiple ctx/ files exist (${files.length}) without dagTaskId — refusing newest fallback`,
  });
  return {
    domainId: null,
    dagTaskId: null,
    resolvedFrom: "ambiguous",
    confidence: "ambiguous",
    detail: `multiple ctx files: ${files.join(", ")}`,
  } as any; // 调用方需兼容 DomainResolution 类型
}
```

**向后兼容**：

- 调用方（`module_scope_declare.ts:211` / `scope-before.ts:122` / `uc7ks-after.ts:67`）目前按 `string | null` 消费返回值。
- 修改：`resolveDomainId` 返回值保持 `string | null` 形态；新增 `resolveDomainIdWithMeta()` 返回 `DomainResolution`，便于 `resolve_domain_id.ts` 工具使用。旧函数在多文件场景返回 `null`（不再返回错误 domain）。

```typescript
// 推荐：双 API
export function resolveDomainId(sessionId?: string): string | null {
  const r = resolveDomainIdWithMeta(sessionId);
  return r.domainId;
}

export function resolveDomainIdWithMeta(
  sessionId?: string,
  dagTaskId?: string,
): DomainResolution { /* 实现 §9.2.A 的完整 resolution order */ }
```

#### 4. `resolve_domain_id.ts` — 工具 args 增加 `dag_task_id`

```typescript
// .opencode/tools/resolve_domain_id.ts
args: {
  sessionId: tool.schema.string().optional(),
  dag_task_id: tool.schema.string().optional(),
},
async execute(args, context) {
  const sid = args.sessionId || (context && (context as any).sessionID) || "";
  const resolution = resolveDomainIdWithMeta(sid, args.dag_task_id);
  return JSON.stringify({
    domain_id: resolution.domainId,
    dag_task_id: resolution.dagTaskId,
    agent_type: (context && (context as any).agent) || null,
    resolved_from: resolution.resolvedFrom,
    confidence: resolution.confidence,
    ambiguous: resolution.resolvedFrom === "ambiguous",
    detail: resolution.detail,
    ...(resolution.resolvedFrom === "ambiguous"
      ? {
          error:
            "Multiple dispatch contexts exist. Re-run resolve_domain_id with dag_task_id.",
          candidates: resolution.candidates || [],
        }
      : {}),
  });
}
```

**官方 OpenCode 合规**：

- 使用 `export default tool({ args, execute })` 形状，不引入 MCP server（符合 §9.3 第 1 条）。
- `dag_task_id` 是 optional 参数，不破坏已有调用方。
- `opencode.json` 不需要新增 tool 名，权限不变。

#### 5. `subagent-preamble.md` — Step 0a 显式传 dag_task_id

```text
Step 0a (dispatch context resolution):
  resolve_domain_id(sessionId=context.sessionID, dag_task_id="<dispatch-assigned task_id>")
  module_scope_declare(module=<returned domain_id>, task_id="<same task_id>")

Bootstrap note:
  If the child session was spawned via dispatch_subagent, plugins/session.ts
  has already created the child's session_map row via OPENCODE_DAG_TASK_ID env
  bootstrap. resolve_domain_id() should hit Priority 1 (session_map) directly.
  The explicit dag_task_id parameter is a secondary precision channel.
```

#### 6. `search-knowledge.md` — Step 3 显式 task_id

保持与更新后的 `/search-knowledge` 命令一致（已在 OPTIMIZE-CI-WORKFLOWS-v1 同步）：

```text
Step 3 第 1 步:
  module_scope_declare(module: "<domain>", task_id: "<unique-id>")
  // use the same task_id across all calls so that downstream compliance
  // checks correlate; in dispatch context, this is the dispatch-assigned
  // dag_task_id.
```

#### 日志事件规范（汇总）

| Source | Event | Level | 触发条件 |
| --- | --- | --- | --- |
| `dispatch_subagent` | `DISPATCH-ENV-BOOTSTRAP` | INFO | 子进程 env 注入完成 |
| `session` | `SESSION-CREATED-NO-BOOTSTRAP` | DEBUG | 原生会话（非 dispatch 子）跳过 bootstrap |
| `session` | `CHILD-SESSION-BOOTSTRAP` | INFO | 子 session 启动时成功写库 |
| `session` | `CHILD-SESSION-BOOTSTRAP-FAILED` | ERROR | 子 session bootstrap 异常 |
| `session` | `SESSION-MAP-DOMAIN-SKIPPED` | WARN | chat.message hook 拒绝写 ambiguous domain |
| `agent-resolver` | `DOMAIN-RESOLVED` | INFO | P1 命中 session_map |
| `agent-resolver` | `DOMAIN-RESOLVE-MISMATCH` | ERROR | session_map dag_task_id 与 ctx 文件不一致 |
| `agent-resolver` | `DOMAIN-RESOLVE-AMBIGUOUS` | WARN | 多 ctx 文件且无 dagTaskId 命中 |
| `agent-resolver` | `DISPATCH-CTX-READ-ERROR` | ERROR | ctx 目录扫描失败 |

所有事件通过 `writeLog(source, level, {...})` 写入 `.task_temp/_logs/{date}/plugin-{source}-{level}.log`（按 `log-manager.ts` 现有路由）。

#### 测试策略

**单元测试** `.opencode/lib/__tests__/agent-resolver.test.ts`：

| 场景 | 预期 |
| --- | --- |
| session_map 有子 session 行 | `resolveDomainId(childSid) === domainId`（P1 命中） |
| session_map 无行 + 多 ctx 文件 + 无 dagTaskId | `resolveDomainId() === null`（不再取 newest） |
| session_map 无行 + 多 ctx 文件 + 有 dagTaskId | `resolveDomainIdWithMeta(_, dagTaskId).resolvedFrom === "ctx_exact"` |
| session_map 无行 + 单 ctx 文件 | `resolvedFrom === "ctx_single"`（保留此兜底） |
| 全部失败 | `resolvedFrom === "none"` |

**E2E** `PARALLEL-TEST-A`（framework-self-test.ts 新增检查）：

1. 同时 dispatch `Coder-BE (PARALLEL-BE, backend_api)` + `Coder-FE (PARALLEL-FE, frontend_ui)`。
2. 等待两子 session 创建。
3. 分别查询 `session_map` 子行：BE 行 `domain_id="backend_api"`，FE 行 `domain_id="frontend_ui"`。
4. 分别在两子 agent 上下文内调用 `resolve_domain_id()`：BE 返回 `backend_api`，FE 返回 `frontend_ui`。
5. 失败时记入 `framework-self-test.ts` 的 FAIL 计数并阻断 CI。

#### 验收标准

| 场景 | 预期 |
| --- | --- |
| 并行 Coder-BE + Coder-FE dispatch | 各自子 session_map 行 domain_id 正确；resolve_domain_id() 返回各自正确 domain |
| 子 session 启动后 `process.env.OPENCODE_DAG_TASK_ID` 状态 | 已清理（`delete` 执行） |
| 嵌套 dispatch（子 agent 内再 dispatch） | 不会因 env 残留污染孙 session 的 domain_id |
| 原生 TUI 会话（非 dispatch） | session.created hook 走 NO-BOOTSTRAP 分支，session_map 行 dag_task_id 为 NULL |
| 父 session session_map 被并发覆盖 | 不影响子 session 的 domain 解析（子用自己的 sessionId 查） |
| self-test 新增 PARALLEL-DOMAIN-BOOTSTRAP 检查 | PASS |
| framework-doctor 新增 child-session-bootstrap 健康检查 | PASS（抽查最近 N 个 dispatch 子 session 是否都有 session_map 行） |

#### 与已有决策的兼容性

| 已有决策 | 本方案兼容性 |
| --- | --- |
| `FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18)` 移除子 env 的 `FRAMEWORK_TASK_ID` | ✅ 兼容 — 使用新名 `OPENCODE_DAG_TASK_ID`，仅作一次性 bootstrap 通道，运行时不依赖 env |
| `FW-DISPATCH-TASKID-IMMUTABLE` session_map DB 作为首选 | ✅ 强化 — 子 session 启动时主动写库，使 P1 命中率从"父 session 行"扩展到"子 session 行" |
| `FW-UC7KS-DOMAIN-001` per-dispatch ctx 文件隔离 | ✅ 兼容 — ctx 文件仍是 domainId 唯一来源，env 只携带 dagTaskId 用作 ctx 索引键 |
| `FW-PLAN-FIRST` dispatch_policy 约束 | ✅ 不影响 — bootstrap 发生在 dispatch 完成后、子 session 启动时 |
| `IMPLEMENT-DISPATCH-CTX-FIX (2026-06-19)` GAP-1 | ✅ 闭环 — 子 session 不再依赖 ctx/newest fallback |

#### 风险与降级

| 风险 | 缓解 |
| --- | --- |
| env 注入失败（极少，spawn 内部错误） | dispatch_subagent catch 后记 `DISPATCH-ENV-BOOTSTRAP-FAILED` WARN；子 session 走 P2 ambiguous 兜底，agent 看到 ambiguous 后人工重试 |
| session.created hook 异常 | catch 后记 `CHILD-SESSION-BOOTSTRAP-FAILED` ERROR；不阻断 session 创建；后续调用 resolveDomainId 仍可用 P2 single-file 兜底 |
| 老版本 agent 未升级 preamble，不传 dag_task_id 参数 | P1 session_map 行已通过 bootstrap 建好，参数化通道缺失不影响主路径 |
| `OPENCODE_DAG_TASK_ID` 名与未来官方 OpenCode 命名冲突 | 保留 `OPENCODE_` 前缀作为项目命名空间；若冲突可改名为 `FRAMEWORK_DISPATCH_DAG_TASK_ID` |

### §9.3 官方 OpenCode 合规与日志要求

1. `knowledge_cache_attest.ts` 和 `resolve_domain_id.ts` 继续作为 `.opencode/tools/*.ts` custom tools，使用 `export default tool()`；不新增 MCP server。
2. 不通过**新增 plugin** 修复这两个问题；已有 `read-track-after.ts`、`session.ts`、`task-after.ts` 只做事件记录和 session 映射。§9.2.1 的 C+A 混合方案对 `session.ts` 新增 `session.created` 事件绑定（与已存在的 `chat.message` 并列），职责仍限于"子 session 启动时写一次 session_map"——属于既有 plugin 的扩展，不是新 plugin。
3. 所有新增拒绝、mismatch、ambiguous 事件必须通过 `writeLog()` 进入集中日志。
4. `opencode.json` 只在新增/改名 custom tool 时更新 agent permissions；本修复不需要新增工具名。
5. `framework-self-test.ts` 必须覆盖空 `files_read` 拒绝和并行 domain exact resolution，防止回归。
