# 框架类型检查与 TDD 豁免可行性分析

> **日期**: 2026-06-26  
> **范围**: Bun tsc 执行、Write-time 检查覆盖、Full scan tsc 输出消费、框架文件 TDD 豁免  
> **性质**: 可行性分析，不含代码实现

---

## §1 问题陈述

四个独立但关联的问题：

| # | 问题 | 简称 |
| --- | --- | --- |
| Q1 | 能否让 Bun 执行时跑 tsc？ | Bun+tsc |
| Q2 | 能否让 Write-time 检查包含框架文件？ | Write-time 覆盖 |
| Q3 | 能否让 Full scan 的 tsc 输出不被忽略？ | Full scan 消费 |
| Q4 | 能否让框架文件跳过 TDD？ | TDD 豁免 |

---

## §2 Q1 — 能否让 Bun 执行时跑 tsc？

### 2.1 现状

**Bun 本身不做类型检查。** 框架自带文档明确说明：

> `docs/official_docs/bun/bun-typescript-support.md:35`:
> "Bun does not perform type-checking. For type safety, use `tsc --noEmit` as a separate step"

> `docs/official_docs/bun/bun-typescript-support.md:88-92`:
> Bun 忽略 `tsconfig.json` 中的 `strict`、`noImplicitAny` 等"所有类型检查标志"

Bun 的 TypeScript 处理流程：解析 → **类型擦除**（parse-time，无类型检查）→ 转译 → 执行。`.opencode/` 下的所有 `.ts` 文件都通过 `bun <file>.ts` 直接执行（opencode.json:925/934/940），类型错误在运行时**不会**被捕获。

### 2.2 现有的 tsc 调用

框架中唯一的 tsc 实现在 `code-quality-lib.ts`：

```
code-quality-lib.ts:483  execSync("npx tsc --noEmit --incremental --pretty false", { cwd })
code-quality-lib.ts:855  execSync("npx tsc --noEmit --pretty false", { cwd })
```

但有两层限制：

**限制 A — tsc 只跑业务代码**：
```ts
// code-quality-lib.ts:470-477
if (!isBackend && !isFrontend) {
  return makeResult(true, [], "Not in backend or frontend src — tsc skipped", "");
}
```
任何 `.opencode/` 下的 `.ts` 文件直接返回 pass/skip。

**限制 B — 结果不持久化**：`runTscCheck()` 和 `runFullScan()` 只 `return` JSON 给 MCP 调用者，**不写 `type_check_state`**，gate 不读取。

### 2.3 可行性分析

**能否让 Bun 执行时跑 tsc？** 可以，但不是"Bun 内置"的方式，而是通过 `execSync` 子进程调用。

| 方案 | 描述 | 可行性 | 性能影响 |
| --- | --- | --- | --- |
| A. MCP 工具调用 | 已有 `code_quality_check.run_tsc_check`，移除 `isBackend/isFrontend` guard 即可覆盖 `.opencode/` | ✅ 直接改 | 单文件 ~3-5s（incremental cache） |
| B. 框架启动时跑 | 在 `opencode-start.sh` 中添加 `npx tsc --noEmit -p tsconfig.json` | ✅ 新增一行 | 首次 ~10-30s，incremental 后 ~3-5s |
| C. 插件钩子触发 | 在 `scope-after.ts` 的 `tool.execute.after` 中对 `.opencode/*.ts` 文件触发增量 tsc | ⚠️ 需新建逻辑 | 每次写后 ~3-5s |
| D. Bun 插件/loader | Bun 无内置 tsc 插件机制；`bun x tsc` 本质等同方案 A | ✅ 等同 A | 同 A |

**推荐方案 B**（启动时全量 tsc），理由：
- 根 `tsconfig.json` 已配置 `include: [".opencode/lib/**/*.ts", ".opencode/tools/**/*.ts", ".opencode/plugins/**/*.ts", ".opencode/scripts/**/*.ts"]`，可直接使用
- `--incremental` + `tsconfig.tsbuildinfo` 缓存使后续运行只需 ~3-5s
- `opencode-start.sh` 已有 `BUN-CACHE-VERSION` bump 逻辑（L5-11），在同一位置添加 tsc 检查是自然的扩展
- 不影响运行时性能（检查在启动时完成，不阻塞 agent 对话）

**注意**：当前 `strict: false`（tsconfig.json:9, lib/tsconfig.json:8）。如果要捕获更多类型错误，需将 `strict` 改为 `true`。但这可能产生大量现有错误，需要分阶段收紧。

### 2.4 关键文件

| 文件 | 行号 | 作用 |
| --- | --- | --- |
| `tsconfig.json` | 14-18 | include 已覆盖 `.opencode/` 的 4 个子目录 |
| `tsconfig.json` | 9 | `strict: false` — 需收紧才能捕获更多错误 |
| `code-quality-lib.ts` | 470-477 | isBackend/isFrontend guard — 阻止框架文件被 tsc 检查 |
| `code-quality-lib.ts` | 483 | `execSync("npx tsc --noEmit --incremental")` |
| `opencode-start.sh` | 5-11 | BUN-CACHE-VERSION bump — 可在此添加 tsc 检查 |

---

## §3 Q2 — 能否让 Write-time 检查包含框架文件？

### 3.1 现状

**Write-time 检查分两层：pre-write（已覆盖框架文件）和 post-write（不覆盖）。**

#### Pre-write（`scope-before.ts`，`tool.execute.before`）— 已覆盖

`scope-before.ts` 对 `.opencode/` 文件执行以下检查：

| 检查 | 行号 | 对 `.opencode/` 生效? |
| --- | --- | --- |
| 工具权限 (`isToolAllowed`) | L82 | ✅ |
| 备份绕过防护 | L102-175 | ✅ |
| ROUTE-MISMATCH | L184-211 | ✅ |
| UC7-008 KC 范围 | L216-238 | ✅（KC 写 `.opencode/` 被阻） |
| WRITE-SCOPE (`isWriteAllowed`) | L260-275 | ✅（`.opencode/**: "deny"` for all except Super-Admin） |
| CONFIG-READ-ATTEST | L286-332 | ✅ |
| UC7-001 知识缓存写前检查 | L340-361 | ✅（`isUC7KSWriteTarget` 对 `.opencode/` 返回 true） |

权限保护机制：`opencode.json` 中 `@Super-Admin` 是唯一有 `.opencode/**: "allow"` 的 agent（L751），其他 agent 均为 `deny`。

#### Post-write（`tool.execute.after`）— 不覆盖框架文件

| 插件 | 行号 | 对 `.opencode/` 生效? | 原因 |
| --- | --- | --- | --- |
| `scope-after.ts` | — | ⚠️ 仅脏状态追踪 | 只记录 `eslint_state.dirty_modules`，不执行检查 |
| `format-after.ts` | — | ✅ Prettier 格式化 | 但非阻塞（仅日志） |
| `tdd-after.ts` | L136/L145/L155 | ❌ 不生效 | `isBusinessSourceFile()` 对 `.opencode/` 返回 false |
| `uc7ks-after.ts` | L147 | ❌ 不生效 | 仅 `docs/official_docs/` + KC agent |

**关键缺口：没有任何 post-write 钩子对 `.opencode/` 框架文件执行类型检查或 lint。**

### 3.2 可行性分析

**能否让 Write-time 检查包含框架文件？** 可以，需要在 post-write 层添加。

| 方案 | 描述 | 可行性 | 阻塞风险 |
| --- | --- | --- | --- |
| A. 扩展 `scope-after.ts` | 对 `.opencode/*.ts` 文件触发增量 tsc | ✅ | 可设为 advisory（非阻塞） |
| B. 新建 `typecheck-after.ts` 插件 | 专用的 post-write 类型检查插件 | ✅ | 可配置 strict/locked/advisory |
| C. 扩展 `tdd-after.ts` 的 diff 检查 | 将 `isBusinessSourceFile` 改为也包含 `.opencode/` | ⚠️ | 语义不当（TDD ≠ 类型检查） |
| D. 在 `scope-before.ts` pre-write 中加 tsc | 写前检查目标文件类型 | ❌ | 文件还没写，无法检查 |

**推荐方案 B**（新建 `typecheck-after.ts` 插件），理由：
- 与现有插件架构一致（`tool.execute.after` 钩子，与 `format-after.ts`/`scope-after.ts` 并列）
- 可以复用 `code-quality-lib.ts` 的 `runTscCheck()` 逻辑（移除 isBackend/isFrontend guard 后）
- 可以设为 advisory 模式（日志记录不阻塞），后续可升级为 strict
- 与 `type_check_state` 联动，将检查结果写入 `type-check-state.json`

**但需注意**：
- `runTscCheck()` 当前对 `.opencode/` 返回 skip（L470-477），必须移除此 guard
- tsc 增量检查需要 `--incremental` + `tsconfig.tsbuildinfo`，首次运行可能 ~10s
- 高频写操作（连续编辑多个文件）时，每次触发 tsc 会显著降低体验 → 需要 debounce 或批量检查

### 3.3 关键文件

| 文件 | 行号 | 作用 |
| --- | --- | --- |
| `scope-before.ts` | L49-387 | pre-write 检查（已覆盖 `.opencode/`） |
| `scope-after.ts` | — | post-write 脏状态追踪（仅记录不检查） |
| `tdd-after.ts` | L155 | `isBusinessSourceFile()` 排除 `.opencode/` |
| `state-utils.ts` | L156-166 | `isBusinessSourceFile()` 定义 — `.opencode/` 返回 false |
| `code-quality-lib.ts` | L470-477 | tsc guard — 跳过非业务代码 |
| `tool-scope.ts` | L455 | `isUC7KSWriteTarget()` — `.opencode/` 返回 true |
| `opencode.json` | L751 | Super-Admin `.opencode/**: "allow"` |

---

## §4 Q3 — 能否让 Full scan 的 tsc 输出不被忽略？

### 4.1 现状

**`compliance_gate_complete` 的 "full scan" 既不跑 tsc，也不读 `type_check_state`。** 它只读 `eslint_state`，而且在读之前**主动清空**了脏数据。

#### 4.1a Gate 的 "full scan" 实际逻辑

```
compliance-gate.ts:1717-1753  ← 主动清空 eslint_state.dirty_modules
compliance-gate.ts:1755-1809  ← 读取 eslint_state（刚被清空）→ 几乎不可能 fail
```

关键代码：
```ts
// L1742-1750: 清空 dirty_modules
if (preDirty.length > 0) {
  atomicWriteSubState("eslint_state", (eslint_state) => {
    eslint_state.aggregate.dirty_modules = [];      // ← 清空
    eslint_state.aggregate.total_violations = 0;     // ← 清空
  });
}

// L1762-1763: 读取 dirty_modules（刚被清空）
const eslintState = readSubState("eslint_state");
if (eslintState?.aggregate?.dirty_modules?.length > 0) {  // ← 永远 false
```

**P0-FIX-BUG-11 注释**（L1717-1728）解释了清空的原因：gate 自身的 `gate-state.json` 写入触发了 `tool.execute.after` 钩子，钩子重新将 `.opencode/` 文件标记为脏，形成自污染循环。清空是权宜之计。

#### 4.1b tsc 输出的三条忽略路径

| 忽略路径 | 位置 | 机制 |
| --- | --- | --- |
| 1. Gate 不调 tsc | compliance-gate.ts 全文 | `runGateComplete` 无 `tsc`/`runTscCheck`/`runFullScan` 调用 |
| 2. Gate 不读 type_check_state | compliance-gate.ts:1755-1809 | 只读 `eslint_state`，不读 `type_check_state` |
| 3. runFullScan 结果不持久化 | code-quality-lib.ts:848-917 | 只 `return` JSON，不调 `atomicWriteSubState` |

#### 4.1c 文档与实现的偏差

> `.opencode/rules/rule_detail/mcp-tool-inventory.md:145`:
> "`code_quality_check.run_full_scan()` 用于 `compliance_gate_complete` 内部"

这是**不准确的**。实际 `runGateComplete` 既不调用 `run_full_scan`，也不读取 8 维 sub-state。

### 4.2 可行性分析

**能否让 Full scan 的 tsc 输出不被忽略？** 可以，需要三步联动。

| 步骤 | 修改点 | 描述 |
| --- | --- | --- |
| 1. tsc 覆盖框架文件 | code-quality-lib.ts:470-477 | 移除 `isBackend && !isFrontend` guard，或添加 `.opencode/` 分支 |
| 2. 结果持久化 | code-quality-lib.ts:848-917 | `runFullScan` 添加 `atomicWriteSubState("type_check_state", ...)` |
| 3. Gate 消费 | compliance-gate.ts:1755 之后 | 添加 `type_check_state` 读取逻辑，dirty 时返回 fail |

**步骤 1 代码示例**（code-quality-lib.ts:470-477）：

```ts
// 修改前:
if (!isBackend && !isFrontend) {
  return makeResult(true, [], "Not in backend or frontend src — tsc skipped", "");
}

// 修改后:
if (!isBackend && !isFrontend) {
  // Framework .ts files: run tsc against root tsconfig.json
  const rootDir = process.env.OPENCODE_ROOT || ".";
  try {
    const out = execSync("npx tsc --noEmit --incremental --pretty false", {
      cwd: rootDir,
      encoding: "utf8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return makeResult(true, [], `tsc passed (framework)`, out.substring(0, 500));
  } catch (e) {
    return makeResult(false, [{ check: "tsc", severity: "BLOCKER", detail: ... }], ...);
  }
}
```

**步骤 2 代码示例**（code-quality-lib.ts:848-917 之后）：

```ts
// 持久化 tsc 结果到 type_check_state
try {
  atomicWriteSubState("type_check_state", (tc_state) => {
    tc_state.status = tscErrors > 0 ? "dirty" : "clean";
    tc_state.dirty_files = tscDirtyFiles;  // 从 tsc 输出解析
    tc_state.full_scan_error_count = tscErrors;
    tc_state.last_full_scan = new Date().toISOString();
  });
} catch {}
```

**步骤 3 代码示例**（compliance-gate.ts:1755 之后）：

```ts
// 新增: type_check_state 检查 (CAT3.8)
let tscFailed = false;
let tscDirtyFiles = [];
try {
  const tcState = readSubState("type_check_state");
  if (tcState?.status === "dirty" && tcState?.dirty_files?.length > 0) {
    tscFailed = true;
    tscDirtyFiles = tcState.dirty_files;
  }
} catch {}

if (tscFailed && enforcementMode !== "advisory") {
  return {
    status: "recoverable",
    reason: `CAT3.8: TypeScript type errors in ${tscDirtyFiles.length} file(s): ${tscDirtyFiles.slice(0, 5).join(", ")}. Run code_quality_check.run_full_scan() for details.`,
    missing_artifacts: [],
    retry_count: session.retry_count,
  };
}
```

**但需注意关键约束**：

1. **P0-FIX-BUG-11 自污染循环**：gate 自身的 `gate-state.json` 写入触发 `tool.execute.after`，将 `.opencode/` 标记为脏。如果 tsc 检查也在 gate complete 时触发，会形成**双重自污染**。解决方案：
   - 在 `write-audit-lib.ts` 中豁免 `gate-state.json` 和 `type-check-state.json` 本身（不将它们加入 `dirty_files`）
   - 或在 gate complete 的 tsc 检查之前，先 clear `type_check_state`（类似当前对 `eslint_state` 的做法），然后跑真实 tsc

2. **性能**：全量 tsc 首次 ~10-30s。`--incremental` + `tsconfig.tsbuildinfo` 可降至 ~3-5s。在 gate complete 时等待 5s 是可接受的（gate complete 本身是任务结束操作，不是高频操作）。

3. **advisory 模式**：默认 `enforcementMode = "advisory"`（gate-core.ts:451），tsc 检查在 advisory 模式下不阻塞。需确保 strict 模式下才阻塞。

### 4.3 关键文件

| 文件 | 行号 | 作用 |
| --- | --- | --- |
| `compliance-gate.ts` | L1717-1753 | eslint_state 清空逻辑（P0-FIX-BUG-11） |
| `compliance-gate.ts` | L1755-1809 | ESLint mock-audit 检查（无 tsc） |
| `code-quality-lib.ts` | L470-477 | tsc guard（跳过非业务代码） |
| `code-quality-lib.ts` | L848-917 | `runFullScan`（结果不持久化） |
| `write-audit-lib.ts` | L116-126 | 脏文件追踪（启发式，不跑 tsc） |
| `gate-checks.ts` | L232-252 | `checkMachineCleanliness` 读 `type_check_state`（但 gate complete 不调用） |
| `substate-manager.ts` | L24 | `type_check_state: "type-check-state.json"` |

---

## §5 Q4 — 能否让框架文件跳过 TDD？

### 5.1 现状

**框架文件已经跳过 TDD，这是架构设计的一部分。**

#### 5.1a TDD 铁律的作用域

> `AGENTS.md:203-209`:
> "无测试用例，禁止编写任何**业务**代码"

关键词是"业务"（business），不是"任何代码"。TDD 铁律的作用域是 `booking-backend/src/` 和 `booking-frontend/` 的业务代码。

#### 5.1b 三层豁免机制

| 层次 | 文件:行号 | 机制 |
| --- | --- | --- |
| 插件层 | `tdd-before.ts:21` / `tdd-after.ts:155` | `isBusinessSourceFile(filePath)` 对 `.opencode/` 返回 false → 插件短路返回 |
| Agent 层 | `state-utils.ts:242-244` | `TDD_AGENTS = {"@Coder-BE", "@Coder-FE"}` → Super-Admin/Orchestrator 等不在集合中 |
| Commit 层 | `critical-files.ts:470-486` | `INFRA-ONLY-TDD-SKIP`：全 infra 文件的 commit 用 `[INFRA]` 标记，不需要 `[Red]/[Green]/[Refactor]` |

#### 5.1c `isBusinessSourceFile()` 的排除逻辑

```ts
// state-utils.ts:156-166
export function isBusinessSourceFile(fp: string): boolean {
  if (!fp || !isSourceFile(fp)) return false;
  for (const prefix of getFrameworkPathPrefixes()) {
    if (fp.startsWith(prefix)) return false;  // ← .opencode/ 在此排除
  }
  // ...
}

// Framework path prefixes:
const CORE_FRAMEWORK_PATH_PREFIXES = [".opencode/", "docs/", ".task_temp/", "node_modules/"];
```

#### 5.1d Super-Admin 的工作流（非 TDD）

`Super-Admin.md:172-177` 明确列出了 TDD 豁免：

> "TDD order enforcement | Skipped for Super-Admin in framework-enforcer | Framework files have no test suite"

Super-Admin 的验证流程是：
1. 状态快照（记录 `machine.json`/`gate-state.json` 哈希）
2. 修改框架文件
3. 运行 `bun .opencode/scripts/framework-self-test.ts`（37+ 完整性检查）
4. 运行 `bun .opencode/scripts/state-reconciliation.ts --fix`
5. 产出 `HANDOVER.md` 审计文件

#### 5.1e 框架自身的测试

框架有独立的测试套件，但不走 TDD RED/GREEN/REFACTOR 流程：

| 测试类型 | 位置 | 运行方式 |
| --- | --- | --- |
| Jest 单元测试 | `.opencode/lib/__tests__/*.test.ts`（16 个文件） | `jest`（`jest.config.js` testMatch: `**/__tests__/**/*.test.ts`） |
| 框架自检 | `.opencode/scripts/framework-self-test.ts` | `bun .opencode/scripts/framework-self-test.ts` |
| 状态协调 | `.opencode/scripts/state-reconciliation.ts` | `bun ... --fix` |

### 5.2 可行性分析

**能否让框架文件跳过 TDD？** 已经跳过，无需修改。

但用户可能真正想问的是：**能否让框架文件有替代的质量保证机制？** 答案是可以的，且部分已存在：

| 质量保证 | 当前状态 | 可改进点 |
| --- | --- | --- |
| Jest 单元测试 | ✅ 已有 16 个 test 文件 | 可增加覆盖率要求 |
| framework-self-test | ✅ 37+ 检查 | 可增加 tsc 类型检查项 |
| 状态协调 | ✅ state-reconciliation | — |
| tsc 类型检查 | ❌ 不存在 | **Q1/Q3 的改进可补上** |
| ESLint | ⚠️ 脏状态追踪但不执行 | 可在 self-test 中触发 |
| Prettier | ✅ 非阻塞格式化 | — |
| HANDOVER.md 审计 | ✅ Super-Admin 强制 | — |

**推荐**：在 `framework-self-test.ts` 中添加一个 `checkTypeScriptTypes()` 检查项，调用 `npx tsc --noEmit -p tsconfig.json`，将 tsc 纳入框架自检体系。这样：
- 框架文件不走 TDD（保持现状）
- 但有类型检查（通过 self-test）
- 与 Super-Admin 的工作流一致（修改后跑 self-test）

### 5.3 关键文件

| 文件 | 行号 | 作用 |
| --- | --- | --- |
| `state-utils.ts` | L156-166 | `isBusinessSourceFile()` — 排除 `.opencode/` |
| `state-utils.ts` | L242-244 | `TDD_AGENTS` — 仅 Coder-BE/FE |
| `tdd-before.ts` | L17/19/21 | 三重短路：agent + tool + file |
| `tdd-after.ts` | L136/145/155 | 同上 |
| `critical-files.ts` | L470-486 | `INFRA-ONLY-TDD-SKIP` |
| `hook-commit-msg.ts` | L99-153 | infra-only commit 用 `[INFRA]` 而非 `[Red]/[Green]` |
| `hook-layers.ts` | L337-392 | pre-commit TDD order 检查（infra-only 跳过） |
| `Super-Admin.md` | L172-177 | TDD 豁免声明 |
| `framework-self-test.ts` | L1-11 | 37+ 完整性检查（可扩展 tsc） |

---

## §6 四个问题的联动关系

四个问题不是孤立的，它们形成一个完整的类型安全体系：

```
Q4 (TDD 豁免) ────── 框架文件不走 TDD
    │
    │ 替代方案
    ▼
Q1 (Bun+tsc) ─────── tsc 作为框架文件的类型检查手段
    │
    │ 触发时机
    ├─ Q2 (Write-time) ── 写后增量 tsc (advisory)
    └─ Q3 (Full scan) ─── gate complete 时全量 tsc (strict 可阻塞)
```

**完整方案**：

1. **Q4 保持现状**：框架文件跳过 TDD（已有三层豁免机制）
2. **Q1 方案 B**：`opencode-start.sh` 中添加 `npx tsc --noEmit -p tsconfig.json`（启动时检查）
3. **Q2 方案 B**：新建 `typecheck-after.ts` 插件，对 `.opencode/*.ts` 写操作触发增量 tsc（advisory 模式）
4. **Q3 三步联动**：移除 tsc guard + 持久化结果 + gate 消费 `type_check_state`
5. **补充**：`framework-self-test.ts` 添加 `checkTypeScriptTypes()` 检查项

### 实现优先级

| 阶段 | 内容 | 优先级 | 依赖 |
| --- | --- | --- | --- |
| Phase 1 | Q4 确认现状（无代码修改） | — | — |
| Phase 2 | Q1 方案 B：启动时 tsc | P1 | 无 |
| Phase 2 | Q3 步骤 1：移除 tsc guard | P1 | 无 |
| Phase 3 | Q3 步骤 2：结果持久化 | P1 | Q3 步骤 1 |
| Phase 3 | Q3 步骤 3：gate 消费 | P2 | Q3 步骤 2 |
| Phase 3 | 补充：self-test tsc 检查项 | P2 | Q1 |
| Phase 4 | Q2 方案 B：post-write 插件 | P2 | Q3 步骤 1 |

### 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `strict: false` 遗漏类型错误 | tsc 不报已知的隐式 any 等 | 分阶段收紧：先 `strict: true` + `// @ts-expect-error` 标注现有问题 |
| P0-FIX-BUG-11 自污染循环 | gate 写 `type-check-state.json` → 触发 after 钩子 → 标脏 → gate fail | 在 `write-audit-lib.ts` 中豁免 `type-check-state.json` |
| tsc 性能（全量 ~30s） | gate complete 延迟 | `--incremental` + `tsbuildinfo` 缓存 → ~3-5s |
| advisory 模式不阻塞 | tsc 错误被忽略 | 后续升级为 strict；先 advisory 收集数据 |
| `tsconfig.json` include 范围 | 可能遗漏 hooks/ 目录 | 检查并扩展 include 范围 |

---

## §7 结论

| 问题 | 答案 | 关键约束 |
| --- | --- | --- |
| Q1: Bun 执行时跑 tsc | ✅ 可以，通过 `execSync("npx tsc --noEmit")` 子进程 | Bun 本身不做类型检查；需在启动时或 MCP 工具中调用 |
| Q2: Write-time 包含框架文件 | ✅ 可以，pre-write 已覆盖，需补 post-write | 需新建插件或扩展 `scope-after.ts`；注意 debounce |
| Q3: Full scan tsc 不被忽略 | ✅ 可以，需三步联动 | 需解决 P0-FIX-BUG-11 自污染循环；注意 advisory/strict 模式 |
| Q4: 框架文件跳过 TDD | ✅ 已跳过，无需修改 | 三层豁免机制 + INFRA-ONLY-TDD-SKIP 已覆盖；替代方案是 self-test + tsc |

**核心洞察**：框架文件的类型安全应该通过 **tsc（启动时 + self-test + gate full scan）** 来保证，而不是通过 TDD。TDD 适用于业务代码（有明确的 spec → impl → test 生命周期），而框架文件的质量保证更适合通过静态分析（tsc + ESLint + self-test）来覆盖。四个问题联合实现后，框架文件将拥有：TDD 豁免（保持开发效率）+ tsc 类型检查（保证类型安全）+ gate 消费（保证发布前检查）。

---

_本文档基于 `.opencode/` 下 20+ 个源文件的代码审计，所有行号均已在 2026-06-26 验证。_
