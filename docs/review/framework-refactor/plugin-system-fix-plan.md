# Plugin System 重复代码修复方案

**日期：** 2026-06-15
**关联文档：** `framework-evaluation-report.md` §6
**优先级：** P3
**依据：** OpenCode 官方文档 plugins.md + 源码审计

---

## 一、现状问题总结

源码审计发现 9 类重复/不一致，按严重度排序：

| # | 重复类型 | 涉及文件 | 行数 | 严重度 |
|---|---------|---------|------|--------|
| A | `capFailedEntries` 函数 + 常量 | `task-after.ts:17-28`, `dispatch-after.ts:18-30` | 11×2 | 高 |
| B | TDD agent 集合 | `tdd-before.ts:21`(内联), `tdd-after.ts:33`(Set) | ~4 | 高 |
| C | TDD tool 集合 | `tdd-before.ts:24`(Record), `tdd-after.ts:36`(Set) | ~3 | 高 |
| D | `isBusinessSourceFile` 函数 | `state-utils.ts:88-103`, `tdd-after.ts:91-98` | ~10 | 中（**不同实现，同名**） |
| E | `safe_shell` path-scope 策略 | `scope-before.ts:57-65`, `audit-before.ts:25-29` | 5+1 | 中（**策略分歧**） |
| F | 插件生命周期样板代码 | **所有 16 个插件** | ~6×16 | 高 |
| G | machine.json 非原子写入 | 7 个插件文件 | 1×7 | 中（`atomicWriteMachine` 已存在但未使用） |
| H | 手写 `findLatestBackup` | `tdd-after.ts:113-132` | ~20 | 低 |
| I | 内联 machine.json 读取 | `tdd-before.ts`, `uc7ks-after.ts` 2 处 | 2 处 | 低 |

### 关键发现

**D 是潜在 bug：** `state-utils.ts` 和 `tdd-after.ts` 各有一个 `isBusinessSourceFile`，但实现不同——前者用 `includes()` 子串匹配，后者用正则 + 前缀列表。语义不一致可能导致文件分类结果不同。

**E 是策略分歧：** `scope-before.ts` 对 `safe_shell` 的 `cp/mv/rm` 放行路径检查，`audit-before.ts` 则排除所有 `safe_shell`。两处解决同一个问题但策略不同。

**G 是现成的修复：** `uc7ks-schema.ts:342` 已导出 `atomicWriteMachine()` 带 CAS-on-revision，但 7 个插件完全绕过它，使用裸 `fs.writeFileSync`。

**F 是最大的重复面：** 每个插件文件头部都有相同的 6 行样板代码（`ensureLogDir → writeLog loaded → updateIndex → export default → writeLog hooks → return`），16 个插件共 96 行纯重复。

---

## 二、修复方案

### 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `.opencode/lib/state-utils.ts` | **修改** | 追加 TDD 常量 + 统一 `isBusinessSourceFile` |
| `.opencode/lib/tool-scope.ts` | **修改** | 追加 `getEffectivePathScopeFilePath()` |
| `.opencode/lib/hook-lifecycle.ts` | **新增** | 插件生命周期 HOF |
| `.opencode/lib/safe-edit-core.ts` | **修改** | 导出 `findLatestBackup()` |
| `.opencode/lib/index.ts` | **修改** | 追加新模块导出 |
| `.opencode/plugins/task-after.ts` | **修改** | 删除 `capFailedEntries`，import from lib |
| `.opencode/plugins/dispatch-after.ts` | **修改** | 删除 `capFailedEntries`，import from lib |
| `.opencode/plugins/tdd-before.ts` | **修改** | 删除内联常量，import from lib |
| `.opencode/plugins/tdd-after.ts` | **修改** | 删除本地常量/函数，import from lib |
| `.opencode/plugins/scope-before.ts` | **修改** | 使用 `getEffectivePathScopeFilePath()` |
| `.opencode/plugins/audit-before.ts` | **修改** | 使用 `getEffectivePathScopeFilePath()` |
| `.opencode/plugins/audit-after.ts` | **修改** | `fs.writeFileSync` → `atomicWriteMachine()` |
| `.opencode/plugins/cache-after.ts` | **修改** | 同上 |
| `.opencode/plugins/scope-after.ts` | **修改** | 同上 |
| `.opencode/plugins/session.ts` | **修改** | 需新建 `atomicWriteJson()` helper（路径非 machine.json） |
| `.opencode/plugins/tdd-after.ts` | **修改** | 同上 + `findLatestBackup` from lib |
| `.opencode/plugins/uc7ks-after.ts` | **修改** | 同上 |
| **所有 16 个插件** | **修改** | 头部替换为 `withPluginLifecycle()` 调用 |

---

### Fix A: `capFailedEntries` 提取到 `state-utils.ts`

```typescript
// 追加到 .opencode/lib/state-utils.ts

/** SA-FIX-PARALLEL-DISPATCH-20260611: TTL cap for .pending.json.failed */
const FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_MAX_ENTRIES = 100;

export function capFailedEntries(entries: any[]): any[] {
  const cutoff = Date.now() - FAILED_TTL_MS;
  const capped = entries.filter((e) => {
    const ts = e.failedAt || e.timestamp;
    return ts && new Date(ts).getTime() > cutoff;
  });
  return capped.length > FAILED_MAX_ENTRIES
    ? capped.slice(-FAILED_MAX_ENTRIES) : capped;
}
```

插件侧变更：

```typescript
// task-after.ts — 删除本地 capFailedEntries，改为：
import { capFailedEntries } from "../lib/state-utils";

// dispatch-after.ts — 同上
```

---

### Fix B+C: TDD 常量统一到 `state-utils.ts`

```typescript
// 追加到 .opencode/lib/state-utils.ts

/** TDD enforcement targets: only Coder-BE / Coder-FE */
export const TDD_AGENTS = new Set([
  "@Coder-BE", "@Coder-FE", "Coder-BE", "Coder-FE"
]);

/** Tool scope: only the 3 content-writing tools */
export const TDD_MODIFY_TOOLS = new Set(["write", "edit", "safe_edit"]);

/** Check if agent is subject to TDD enforcement */
export function isTddAgent(agent: string): boolean {
  return TDD_AGENTS.has(agent);
}

/** Check if tool is subject to TDD enforcement */
export function isTddTool(tool: string): boolean {
  return TDD_MODIFY_TOOLS.has(tool);
}
```

插件侧变更：

```typescript
// tdd-before.ts — 删除内联 isCoder + TOOLS，改为：
import { isTddAgent, isTddTool } from "../lib/state-utils";
const agent = resolveAgent(input.sessionID);
if (!isTddAgent(agent)) return;
if (!isTddTool(input.tool)) return;

// tdd-after.ts — 删除 TDD_AGENTS + TDD_MODIFY_TOOLS，改为：
import { isTddAgent, isTddTool, TDD_AGENTS, TDD_MODIFY_TOOLS } from "../lib/state-utils";
```

---

### Fix D: 统一 `isBusinessSourceFile`

**决策：采用 `tdd-after.ts` 的正则实现**（更精确），替换 `state-utils.ts` 的 `includes()` 实现。

原因：`state-utils.ts` 的 `isBusinessSourceFile` 使用 `includes()` 子串匹配，容易产生误判（如路径中恰好包含 `.opencode` 子串的非框架文件）。`tdd-after.ts` 的正则 + 前缀列表 + 排除模式更精确。

```typescript
// 替换 .opencode/lib/state-utils.ts 中的 isBusinessSourceFile

const FRAMEWORK_PATH_PREFIXES = [
  ".opencode/", "docs/", ".task_temp/", "node_modules/",
];

const FRAMEWORK_ROOT_FILES = new Set([
  "opencode.json", "AGENTS.md", "contract.yaml",
  "Task.DAG.json", "TECH_DEBT_REGISTRY.md", "WAIVE.md",
  "PROJECT_REFERENCE.md", "Project.graph",
]);

const TDD_EXCLUDE_PATTERNS = [
  /\.spec\./, /\.test\./, /\/test\//, /\.config\./, /__tests__\//,
];

export function isBusinessSourceFile(fp: string): boolean {
  if (!fp || !isSourceFile(fp)) return false;
  // Framework path check
  for (const prefix of FRAMEWORK_PATH_PREFIXES) {
    if (fp.startsWith(prefix)) return false;
  }
  if (FRAMEWORK_ROOT_FILES.has(fp)) return false;
  // Test/config exclusion check
  for (const pat of TDD_EXCLUDE_PATTERNS) {
    if (pat.test(fp)) return false;
  }
  return true;
}
```

插件侧变更：

```typescript
// tdd-after.ts — 删除本地 isBusinessSourceFile + 相关常量，改为：
import { isBusinessSourceFile } from "../lib/state-utils";
// 删除: FRAMEWORK_PATH_PREFIXES, FRAMEWORK_ROOT_FILES, EXCLUDE_PATTERNS,
//        isFrameworkPath, 本地 isBusinessSourceFile
```

---

### Fix E: 统一 `safe_shell` path-scope 策略到 `tool-scope.ts`

```typescript
// 追加到 .opencode/lib/tool-scope.ts

/**
 * Returns the effective file path for path-scope checks.
 * For safe_shell: only cp/mv/rm commands carry file paths — other
 * shell command strings produce false positives when fed to path matchers.
 * For other tools: returns the standard modify path.
 *
 * @returns file path for scope checking, or null if path-scope should be skipped
 */
export function getEffectivePathScopeFilePath(
  tool: string,
  args: Record<string, any>
): string | null {
  if (tool === "safe_shell") {
    return isModifyShell(args) ? getModifyPath(args) : null;
  }
  return getModifyPath(args);
}
```

插件侧变更：

```typescript
// scope-before.ts — 替换 lines 57-65：
import { getEffectivePathScopeFilePath } from "../lib/tool-scope";
const scopePath = getEffectivePathScopeFilePath(input.tool, output.args || {});
if (scopePath === null) return; // safe_shell non-modify command
// ... 后续用 scopePath 替代 getModifyPath(output.args)

// audit-before.ts — 替换 lines 25-29：
import { getEffectivePathScopeFilePath } from "../lib/tool-scope";
const scopePath = getEffectivePathScopeFilePath(input.tool, output.args || {});
if (scopePath === null) return;
```

**策略统一决策：** 采用 `scope-before.ts` 的策略（对 `cp/mv/rm` 放行）。理由：`cp file.ts /tmp/` 确实涉及文件路径，应该接受路径检查。`audit-before.ts` 的全排除策略过于保守。

---

### Fix F: 插件生命周期 HOF — `hook-lifecycle.ts`

```typescript
// 新增 .opencode/lib/hook-lifecycle.ts
import { writeLog, updateIndex, ensureLogDir } from "./log-manager";

interface PluginHooks {
  [event: string]: (...args: any[]) => any;
}

/**
 * Eliminates the 6-line boilerplate shared by all 16 plugins:
 *   ensureLogDir → writeLog loaded → updateIndex → export default → writeLog hooks → return
 */
export function withPluginLifecycle(name: string, hooks: PluginHooks) {
  ensureLogDir();
  writeLog(name, "loaded", { event: "PLUGIN-LOADED", detail: `${name}.ts` });
  updateIndex(name, "PLUGIN-LOADED");

  return (async (_ctx: any) => {
    writeLog(name, "hooks", {
      event: "HOOK-REGISTERED",
      detail: Object.keys(hooks).join(","),
    });
    return hooks;
  }) as any;
}
```

插件侧变更（以 `audit-before.ts` 为例）：

```typescript
// 修改前（6 行样板 + handler）：
import { writeLog, updateIndex, ensureLogDir } from "../lib/log-manager";
ensureLogDir();
writeLog("audit-before", "loaded", { event: "PLUGIN-LOADED", detail: "audit-before.ts" });
updateIndex("audit-before", "PLUGIN-LOADED");
export default (async (_ctx: any) => {
  writeLog("audit-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

// 修改后（1 行）：
import { withPluginLifecycle } from "../lib/hook-lifecycle";
export default withPluginLifecycle("audit-before", {
  "tool.execute.before": toolExecuteBefore,
});
```

---

### Fix G: 非原子写入 → `atomicWriteMachine()`

`uc7ks-schema.ts:342` 已导出 `atomicWriteMachine()` 带 CAS-on-revision。实际 API 签名为**回调式 CAS**：

```typescript
// 实际签名（uc7ks-schema.ts）：
export function atomicWriteMachine(
  modifyFn: (machine: any) => void,
  maxRetries?: number
): boolean;
```

调用者传入一个回调函数，回调内直接修改 `machine` 对象，函数内部处理 read → modify → compare-revision → write 的 CAS 循环。

6 个写 machine.json 的插件需将 `read → mutate → writeFileSync` 改为 `atomicWriteMachine` 回调：

```typescript
import { atomicWriteMachine } from "../lib/uc7ks-schema";

// 修改前：
const m = JSON.parse(fs.readFileSync(mp, "utf8"));
m.some_field = newValue;
fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");

// 修改后：
atomicWriteMachine((m) => {
  m.some_field = newValue;
});
```

受影响文件：

| 文件 | 行号 | 写入目标 | 备注 |
|------|------|---------|------|
| `audit-after.ts` | 54 | machine.json | 直接替换 |
| `cache-after.ts` | 52 | machine.json | 直接替换 |
| `scope-after.ts` | 47 | machine.json | 直接替换 |
| `tdd-after.ts` | 204 | machine.json | 直接替换 |
| `uc7ks-after.ts` | 52 | machine.json | 需先修复硬编码路径（见 Fix I） |
| `session.ts` | 108 | session map JSON | **不可用** — 路径不同，需通用 `atomicWriteJson(path, data)` helper |
| `session.ts` | 214-218 | interrupt sentinel | **不可用** — 同上 |

> **限制：** `atomicWriteMachine` 的目标路径硬编码为 `getMachinePath()`（machine.json），不支持自定义路径。`session.ts` 写入的是 session map 文件和 interrupt sentinel，需新建通用的 `atomicWriteJson(path, data)` helper 或为 session map 使用独立 CAS 逻辑。

---

### Fix H: `findLatestBackup` 导出到 `safe-edit-core.ts`

```typescript
// 追加到 .opencode/lib/safe-edit-core.ts

/**
 * Find the latest .safe_backup file for a given target path.
 * Backup naming: {basename}.{ts}.{pid}.{agent}.{task}.safe_backup
 */
export function findLatestBackup(targetPath: string): string | null {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const backupDir = path.join(dir, ".opencode_backups");
  if (!fs.existsSync(backupDir)) return null;

  const candidates = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(base) && f.endsWith(".safe_backup"))
    .sort(); // Lexical sort by timestamp embedded in filename

  return candidates.length > 0
    ? path.join(backupDir, candidates[candidates.length - 1])
    : null;
}
```

插件侧变更：

```typescript
// tdd-after.ts — 删除本地 findLatestBackup（lines 113-132），改为：
import { findLatestBackup } from "../lib/safe-edit-core";
```

---

### Fix I: machine.json 读取集中化

`tdd-before.ts` 和 `uc7ks-after.ts` 仍使用硬编码 machine.json 路径，`tdd-after.ts` 已迁移到 `STATE_PATHS.machine()`。统一使用已有的 `state-utils.ts` 中 `STATE_PATHS.machine`：

```typescript
// state-utils.ts 已导出：
export const STATE_PATHS = {
  machine: path.join(getOpenCodeRoot(), ".opencode/state/machine.json"),
  // ...
};

// 插件侧：
import { STATE_PATHS } from "../lib/state-utils";
const machine = JSON.parse(fs.readFileSync(STATE_PATHS.machine, "utf8"));
```

受影响文件：

| 文件 | 行号 | 当前路径写法 |
|------|------|-------------|
| `tdd-before.ts` | 32 | `(process.env.OPENCODE_ROOT || '.') + '/.opencode/state/machine.json'` |
| `uc7ks-after.ts` | 41 | `".opencode/state/machine.json"` |

无需新增代码，仅需将上述两处硬编码路径替换为 `STATE_PATHS.machine()`。

---

## 三、实施顺序

| 步骤 | 行动 | 依赖 | 风险 |
|------|------|------|------|
| 1 | Fix A: `capFailedEntries` → `state-utils.ts` | 无 | 低 |
| 2 | Fix B+C: TDD 常量 → `state-utils.ts` | 无 | 低 |
| 3 | Fix D: 统一 `isBusinessSourceFile` | 无 | **中**（需验证替换后行为一致） |
| 4 | Fix E: `getEffectivePathScopeFilePath` → `tool-scope.ts` | 无 | 中（策略统一需确认） |
| 5 | Fix F: 新增 `hook-lifecycle.ts` + 16 个插件迁移 | 无 | 低 |
| 6 | Fix G: 7 个插件 → `atomicWriteMachine()` | 需确认 API 兼容性 | 中 |
| 7 | Fix H: `findLatestBackup` → `safe-edit-core.ts` | 无 | 低 |
| 8 | Fix I: machine.json 读取路径统一 | 无 | 低 |
| 9 | 更新 `lib/index.ts` barrel export | 步骤 1-8 完成后 | 低 |

### 验证方法

```bash
# 1. 确保所有插件仍可加载（无 import 错误）
bun .opencode/scripts/framework-self-test.ts

# 2. 验证 isBusinessSourceFile 行为一致
# 对以下文件路径，新旧实现应返回相同结果：
#   booking-backend/src/main.ts          → true
#   .opencode/lib/gate-core.ts           → false
#   src/app.spec.ts                      → false
#   booking-frontend/src/app.ts          → true

# 3. 验证 atomicWriteMachine 替换后 machine.json 完整性
git diff .opencode/state/machine.json  # 应无差异

# 4. 验证 safe_shell 策略统一
# scope-before 和 audit-before 对以下命令应行为一致：
#   "cp file.ts /tmp/"                   → 接受路径检查
#   "bun .opencode/scripts/test.ts"      → 跳过路径检查
#   "cat .opencode/state/machine.json"   → 跳过路径检查
```

---

## 四、修复前后对比

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| **重复类别** | 9 类 | 0 类 |
| **`capFailedEntries`** | 2 份（22 行） | 1 份（state-utils.ts） |
| **TDD 常量** | 2 份（不同形状） | 1 份 + 2 个 helper |
| **`isBusinessSourceFile`** | 2 份（不同实现） | 1 份（正则版，更精确） |
| **safe_shell 策略** | 2 份（策略分歧） | 1 份（tool-scope.ts） |
| **插件样板代码** | 6 行 × 16 = 96 行 | 1 行 × 16 = 16 行 |
| **machine.json 写入** | 7 处非原子 | 7 处 atomicWriteMachine |
| **findLatestBackup** | 内联 20 行 | lib 导出 |
| **新增文件** | — | 1 个（hook-lifecycle.ts） |
| **修改文件** | — | 15 个 |
