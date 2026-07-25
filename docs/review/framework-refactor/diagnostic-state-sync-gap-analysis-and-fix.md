# diagnostic_state 不同步根因分析与修复方案

> **日期**: 2026-06-27
> **根因来源**: `unparseable_write` → `getTypeScriptWriteTargets` → `diagnostic_state` 调用链断裂
> **结论**: 根因诊断**方向正确**（gap 真实存在），但**细节有误**（`applies` 实际为 `true`，非 `false`）。影响范围比描述更广——不限于 `node -e`，涵盖所有 `unparseable_modify_shell` 命令。

---

## 一、根因诊断逐条核实

### 1.1 第一段：tool-scope.ts 检测 `node -e` 写操作

**诊断称**: `tool-scope.ts` 返回 `kind: "unparseable_write"`, `paths: []`

**核实结果**: **部分正确，但混淆了两个类型系统**

`tool-scope.ts` 中存在**两套独立的类型**（`tool-scope.ts:118-121` 和 `:256-259`）:

| 函数 | 返回类型 | `unparseable` 变体 | 有 `applies`？ | 有 `paths`？ |
| --- | --- | --- | --- | --- |
| `classifyShellCommand()` | `ShellClassification` | `{ kind: "unparseable_write", reason }` | ❌ 无 | ❌ 无 |
| `parseShellWriteTargets()` | `ScopePathResult` | `{ applies: true, paths: [], reason: "unparseable_modify_shell" }` | ✅ `true` | ✅ `[]` |

**关键差异**: 被 `tsc-diag-track.ts` 调用的是 `getEffectivePathScopePaths()`（`:519-545`），它内部调用 `parseShellWriteTargets()`（返回 `ScopePathResult`），**不是** `classifyShellCommand()`。

因此实际返回值是:
```ts
{ applies: true, paths: [], reason: "unparseable_modify_shell" }
```

**`applies` 是 `true`，不是 `false`。** 诊断原文称"applies 是 false"是错误的。

### 1.2 第二段：getTypeScriptWriteTargets 处理不了

**诊断称**: `scope.applies` 为 `false`，`paths` 为 `[]`，第一个 `if` 跳过

**核实结果**: **条件失败的原因不同**

实际代码（`tsc-diag-track.ts:64-77`）:
```ts
function getTypeScriptWriteTargets(tool: string, args: any): string[] {
  const scope = getEffectivePathScopePaths(tool, args || {});
  if (scope.applies && scope.paths.length > 0) {  // ← applies=true ✓, paths.length>0 ✗
    return scope.paths.filter(p => /\.(ts|tsx)$/.test(p));
  }
  const directPath = getModifyPath(args);  // safe_shell → args.command = 整条命令字符串
  if (directPath && /\.(ts|tsx)$/.test(directPath)) {  // 命令串不以 .ts 结尾 → false
    return [directPath];
  }
  return [];  // ← 最终返回空
}
```

条件 `scope.applies && scope.paths.length > 0` 中 `applies` 为 `true` 但 `paths.length > 0` 为 `false`。**条件因 `paths` 为空而失败**，非因 `applies` 为 `false`。

退路 `getModifyPath(args)` 对 `safe_shell` 返回 `args.command`（完整命令字符串，如 `"node -e \"fs.writeFileSync('file.ts', ...)\""`），不以 `.ts`/`.tsx` 结尾，所以退路也失败。

**结论**: 返回 `[]` 的结果正确，但原因描述有误。

### 1.3 第三段：TSC Gate 跳过

**诊断称**: `beforeWriteBlock` 看到空数组，直接 `return`

**核实结果**: **完全正确**

实际代码（`tsc-diag-track.ts:84-87`）:
```ts
const targets = getTypeScriptWriteTargets(input.tool, args);
if (targets.length === 0) return;  // ← 确实直接跳过
```

### 1.4 diagnostic_state 未更新

**核实结果**: **完全正确**

`beforeWriteBlock` 和 `afterWriteTscCheck` 均在 `targets.length === 0` 时提前返回，不调用 `atomicWriteSubState("diagnostic_state", ...)`。diagnostic_state 永远不知道文件已被修改。

### 1.5 影响范围评估

| 场景 | scope-before (strict/locked) | safe-bash-core eval scan | tsc-diag-track gap | 实际影响 |
| --- | --- | --- | --- | --- |
| `node -e "writeFileSync('x.ts', ...)"` | **阻断** | **阻断** | 跳过 | **被上层防御覆盖，gap 不触发** |
| `bun run script.ts`（脚本内写 .ts） | **阻断** | 不检查脚本内容 | 跳过 | **被 scope-before 覆盖** |
| `python3 -c "open('x.ts','w')..."` | **阻断** | 不检查 python | 跳过 | **被 scope-before 覆盖** |
| advisory 模式下的上述命令 | 放行 | 可能放行 | **跳过** | **⚠️ gap 触发！.ts 文件被修改但 diagnostic_state 未更新** |
| 自定义命令修改 .ts（非标准写 API） | 可能放行 | 可能放行 | **跳过** | **⚠️ gap 触发** |

**结论**: 在 strict/locked 模式下，gap 被 scope-before.ts 和 safe-bash-core.ts 的防御层覆盖。在 advisory 模式下，gap 真实触发，diagnostic_state 变为陈旧。

---

## 二、Gap 的完整影响链

```
safe_shell("node -e \"fs.writeFileSync('x.ts', ...)\"")
    │
    ├── [scope-before] classifyShellCommand → unparseable_write
    │   ├── strict/locked → BLOCKED ✅ (gap 不触发)
    │   └── advisory → 放行
    │
    ├── [safe-bash-core] eval content scan → WRITE_PATTERNS match
    │   ├── non-Orchestrator → BLOCKED ✅
    │   └── Orchestrator + .task_temp/ → 放行
    │
    ├── [tsc-diag-track before] getTypeScriptWriteTargets → []
    │   └── return (跳过 TSC 检查) ← GAP
    │
    ├── [tool execute] 命令执行，x.ts 被修改
    │
    └── [tsc-diag-track after] getTypeScriptWriteTargets → []
        └── return (跳过诊断更新) ← GAP
            │
            └── diagnostic_state.files["/abs/x.ts"] 未更新
                │
                └── gate-core.submitDeliverables 检查陈旧状态 → 可能误判
```

---

## 三、修复方案

### 3.1 设计原则

遵循 12 个子系统约束：

| 子系统 | 约束 | 本方案合规方式 |
| --- | --- | --- |
| Layout Architecture | 修改限于 `plugins/tsc-diag-track.ts` + `lib/tool-scope.ts` | ✅ 不触及工具层或其他插件 |
| DB-only & DB-canonical | diagnostic_state 存储于 SQLite `substate_kv` | ✅ 使用 `atomicWriteSubState` |
| Permission Matrix | 区分 advisory/strict/locked | ✅ advisory 下记录警告，strict/locked 下阻断 |
| Session/Concurrency Safe | TSC mutex + file lock | ✅ 复用现有 mutex 机制 |
| Hardened Enforcement | 与 `[FW-ENFORCE]` 集成 | ✅ advisory 模式不阻断，仅记录 |
| Framework Harness | 使用 `withPluginLifecycle` hook | ✅ 在现有 before/after hook 内修改 |
| Central State Management | `atomicWriteSubState` 事务 | ✅ 原子读写 |
| Multi-Agent | 所有 agent 一致处理 | ✅ 不区分 agent 类型 |
| Log Central Management | `writeLog(SRC, "runtime", { level, event, detail })` | ✅ 严格遵循 category+level 约定 |
| DB-canonical Management | SQLite 为唯一真源 | ✅ 不写 JSON 文件 |
| Templatization | 配置驱动 | ✅ 新增 `config.unparseable_write_tsc_scan` 开关 |
| TypeScript + Bun Runtime | 兼容 bun 执行模型 | ✅ 无 Node.js 特有 API |

### 3.2 修改 1：`getTypeScriptWriteTargets` 识别 unparseable_modify_shell

**文件**: `.opencode/plugins/tsc-diag-track.ts:64-77`

**现状**:
```ts
function getTypeScriptWriteTargets(tool: string, args: any): string[] {
  const scope = getEffectivePathScopePaths(tool, args || {});
  if (scope.applies && scope.paths.length > 0) {
    return scope.paths.filter(p => /\.(ts|tsx)$/.test(p));
  }
  const directPath = getModifyPath(args);
  if (directPath && /\.(ts|tsx)$/.test(directPath)) {
    return [directPath];
  }
  return [];
}
```

**修改为**:
```ts
const UNPARSEABLE_TS_SENTINEL = "__UNPARSEABLE_MODIFY_SHELL__";

function getTypeScriptWriteTargets(tool: string, args: any): string[] {
  const scope = getEffectivePathScopePaths(tool, args || {});
  if (scope.applies && scope.paths.length > 0) {
    return scope.paths.filter(p => /\.(ts|tsx)$/.test(p));
  }
  // 新增：unparseable_modify_shell 时返回哨兵值，触发全量 TSC 扫描
  if (scope.applies && scope.paths.length === 0 &&
      "reason" in scope && scope.reason === "unparseable_modify_shell") {
    return [UNPARSEABLE_TS_SENTINEL];
  }
  const directPath = getModifyPath(args);
  if (directPath && /\.(ts|tsx)$/.test(directPath)) {
    return [directPath];
  }
  return [];
}
```

### 3.3 修改 2：`beforeWriteBlock` 处理哨兵值

**文件**: `.opencode/plugins/tsc-diag-track.ts:86-87` 附近

**现状**:
```ts
const targets = getTypeScriptWriteTargets(input.tool, args);
if (targets.length === 0) return;
```

**修改为**:
```ts
const targets = getTypeScriptWriteTargets(input.tool, args);
if (targets.length === 0) return;

const isUnparseableShell = targets.includes(UNPARSEABLE_TS_SENTINEL);

if (isUnparseableShell) {
  // unparseable_modify_shell: 在 advisory 模式下记录警告，不做阻断
  const mode = getEnforcementMode();
  writeLog(PLUGIN_NAME, "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent: resolveAgent(input.sessionID) || "unknown",
    agentType: resolveAgent(input.sessionID) || "unknown",
    level: "WARN",
    event: "TSC-UNPARSEABLE-WRITE-SKIPPED",
    detail: `phase=before-write | tool=${input.tool}` +
            ` | command=${(args?.command || "").slice(0, 200)}` +
            ` | reason=unparseable_modify_shell targets cannot be determined` +
            ` | action=${mode === "advisory" ? "advisory-warn" : "will-run-fullscan"}`,
  });
  // advisory 模式：仅记录，不阻断，不运行全量 tsc（性能代价太高）
  if (mode === "advisory") return;
  // strict/locked 模式：scope-before.ts 已阻断，此分支理论上不可达
  // 作为防御纵深，记录但不阻断（避免 double-block）
  return;
}
```

### 3.4 修改 3：`afterWriteTscCheck` 处理哨兵值——执行全量 TSC 并更新 diagnostic_state

**文件**: `.opencode/plugins/tsc-diag-track.ts:319-331` 附近

**现状**:
```ts
const targets = getTypeScriptWriteTargets(input.tool, args);
if (targets.length === 0) return;
// ... 对每个 target 执行 tsc 并更新 diagnostic_state
```

**修改为**:
```ts
const targets = getTypeScriptWriteTargets(input.tool, args);
if (targets.length === 0) return;

const isUnparseableShell = targets.includes(UNPARSEABLE_TS_SENTINEL);

if (isUnparseableShell) {
  // 全量 TSC 扫描 + 更新 diagnostic_state 全量文件条目
  const mode = getEnforcementMode();
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();

  writeLog(PLUGIN_NAME, "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent: resolveAgent(input.sessionID) || "unknown",
    agentType: resolveAgent(input.sessionID) || "unknown",
    level: "INFO",
    event: "TSC-FULLSCAN-TRIGGERED",
    detail: `phase=after-write | tool=${input.tool}` +
            ` | reason=unparseable_modify_shell` +
            ` | command=${(args?.command || "").slice(0, 200)}`,
  });

  try {
    // 获取 TSC mutex（与常规 tsc 检查共享互斥）
    const mutexAcquired = acquireTscMutex(config.timeout_ms);
    if (!mutexAcquired) {
      writeLog(PLUGIN_NAME, "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent: resolveAgent(input.sessionID) || "unknown",
        agentType: resolveAgent(input.sessionID) || "unknown",
        level: "WARN",
        event: "TSC-FULLSCAN-MUTEX-TIMEOUT",
        detail: `phase=after-write | could not acquire TSC mutex within ${config.timeout_ms}ms`,
      });
      return;
    }

    try {
      // 运行全量 TSC（runTscDiagnostic 不传 targetFile 时返回全部错误）
      const result = runTscDiagnostic(null, projectRoot);

      // 更新 diagnostic_state：清除已修复文件，添加/更新有错误的文件
      atomicWriteSubState("diagnostic_state", (state: any) => {
        state.files = state.files || {};

        if (result.pass && !result.allErrors?.length) {
          // 全量 TSC 通过：清除所有文件条目
          state.files = {};
        } else if (result.allErrors && result.allErrors.length > 0) {
          // 按文件分组更新
          const errorsByFile = groupErrorsByFile(result.allErrors);
          // 先清除所有旧条目（因为全量扫描覆盖所有文件）
          state.files = {};
          for (const [filePath, errors] of Object.entries(errorsByFile)) {
            state.files[filePath] = {
              errors,
              updated_at: new Date().toISOString(),
              source: "after-write-fullscan",
              session_id: input.sessionID,
            };
          }
        }
        state.last_updated = new Date().toISOString();
        state.schema_version = "2.0";
      });

      writeLog(PLUGIN_NAME, "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent: resolveAgent(input.sessionID) || "unknown",
        agentType: resolveAgent(input.sessionID) || "unknown",
        level: result.pass ? "INFO" : "WARN",
        event: "TSC-FULLSCAN-COMPLETE",
        detail: `phase=after-write | pass=${result.pass}` +
                ` | errorFiles=${Object.keys(result.allErrors || {}).length}` +
                ` | totalErrors=${(result.allErrors || []).length}`,
      });
    } finally {
      releaseTscMutex();
    }
  } catch (e: any) {
    writeLog(PLUGIN_NAME, "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: resolveAgent(input.sessionID) || "unknown",
      agentType: resolveAgent(input.sessionID) || "unknown",
      level: "ERROR",
      event: "TSC-FULLSCAN-FAILED",
      detail: `phase=after-write | rawError=${(e.message || "").slice(0, 500)}`,
    });
  }
  return;
}

// ... 原有的 per-target TSC 检查逻辑不变 ...
```

### 3.5 辅助函数：`groupErrorsByFile`

**新增于** `tsc-diag-track.ts` 顶部（辅助函数区域）:

```ts
function groupErrorsByFile(errors: Array<{ file: string; message: string; line: number; character: number; code: string }>): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};
  for (const err of errors) {
    if (!err.file) continue;
    if (!grouped[err.file]) grouped[err.file] = [];
    grouped[err.file].push({
      message: err.message,
      line: err.line,
      character: err.character,
      code: err.code,
      received_at: new Date().toISOString(),
    });
  }
  return grouped;
}
```

### 3.6 修改 4：`runTscDiagnostic` 支持全量模式

**文件**: `.opencode/lib/tsc-diagnostic.ts`

当前 `runTscDiagnostic(targetFile, projectRoot)` 始终运行全量 `tsc --noEmit`，但仅返回与 `targetFile` 匹配的错误。需要增加一个"返回所有错误"的模式。

**方案**: 当 `targetFile` 为 `null` 时，返回全部错误:

```ts
// 现有函数签名不变
export function runTscDiagnostic(
  targetFile: string | null,  // ← 原为 string，改为 string | null
  projectRoot: string,
): TscResult {
  // ... 运行 tsc --noEmit --incremental ...
  const output = execSync(`npx tsc --noEmit ...`, { cwd: projectRoot, ... });

  if (targetFile === null) {
    // 全量模式：返回所有错误
    const allErrors = parseAllTscOutput(output);  // 已有函数
    return {
      pass: allErrors.length === 0,
      allErrors,  // 新增字段
      diagnostic_status: allErrors.length > 0 ? "project_dirty" : undefined,
    };
  }

  // 原有单文件模式不变
  const targetErrors = parseTscOutput(output, targetFile);
  // ...
}
```

在 `TscResult` 接口中新增 `allErrors?` 字段:
```ts
interface TscResult {
  pass: boolean;
  errors?: TscError[];        // 单文件模式
  allErrors?: TscError[];     // 全量模式（新增）
  diagnostic_status?: string;
}
```

---

## 四、日志集成验证

所有新增 `writeLog` 调用遵循 Log Central Management Subsystem 约定：

| 事件 | category | level | phase | 触发条件 |
| --- | --- | --- | --- | --- |
| `TSC-UNPARSEABLE-WRITE-SKIPPED` | `"runtime"` | `"WARN"` | before-write | unparseable_modify_shell 在 before hook 中被识别 |
| `TSC-FULLSCAN-TRIGGERED` | `"runtime"` | `"INFO"` | after-write | after hook 触发全量 TSC |
| `TSC-FULLSCAN-MUTEX-TIMEOUT` | `"runtime"` | `"WARN"` | after-write | TSC mutex 获取超时 |
| `TSC-FULLSCAN-COMPLETE` | `"runtime"` | `"INFO"` / `"WARN"` | after-write | 全量扫描完成 |
| `TSC-FULLSCAN-FAILED` | `"runtime"` | `"ERROR"` | after-write | 全量扫描异常 |

所有调用格式: `writeLog(PLUGIN_NAME, "runtime", { level, event, detail, sessionID, callID, agent, agentType })`。

---

## 五、性能影响评估

| 场景 | 原有行为 | 修复后行为 | 性能影响 |
| --- | --- | --- | --- |
| safe_edit/write/edit 写 .ts | 单文件 TSC（~2-5s） | 不变 | 无 |
| safe_shell 可解析写目标 .ts | 单文件 TSC | 不变 | 无 |
| safe_shell unparseable_modify_shell（advisory） | 跳过 TSC | 跳过 + 记录 WARN | 极低（仅 writeLog） |
| safe_shell unparseable_modify_shell（strict/locked） | 不可达（scope-before 已阻断） | 不可达 | 无 |

**关键设计决策**: 全量 TSC 仅在 `afterWriteTscCheck`（写操作完成后）执行，**不在 `beforeWriteBlock`（写操作前）执行**。原因：
1. before hook 中运行全量 TSC 会阻塞写操作 2-10 秒
2. unparseable_modify_shell 在 strict/locked 模式下已被 scope-before 阻断
3. advisory 模式下仅需记录警告，不需阻断

---

## 六、验证清单

- [ ] **V1**: advisory 模式下 `safe_shell("node -e \"fs.writeFileSync('x.ts', ...)\"" )` 执行后，`diagnostic_state.files` 包含 `x.ts` 的错误条目（或 `x.ts` 被清除如果已修复）
- [ ] **V2**: 日志 `plugin-tsc-diag-track-runtime.log` 中出现 `TSC-UNPARSEABLE-WRITE-SKIPPED` + `level=WARN`
- [ ] **V3**: 日志中出现 `TSC-FULLSCAN-TRIGGERED` + `TSC-FULLSCAN-COMPLETE`
- [ ] **V4**: strict/locked 模式下相同命令仍被 scope-before 阻断，不触发全量 TSC
- [ ] **V5**: 常规 `safe_edit` 写 `.ts` 文件的 TSC 检查不受影响（单文件模式）
- [ ] **V6**: `gate-core.submitDeliverables` 读取到的 `diagnostic_state` 反映最新 TSC 结果

---

## 七、实施顺序

```
Step 1: lib/tsc-diagnostic.ts — runTscDiagnostic 支持 null targetFile（全量模式）
Step 2: plugins/tsc-diag-track.ts — getTypeScriptWriteTargets 返回哨兵值
Step 3: plugins/tsc-diag-track.ts — beforeWriteBlock 处理哨兵（advisory 警告）
Step 4: plugins/tsc-diag-track.ts — afterWriteTscCheck 处理哨兵（全量 TSC + 状态更新）
Step 5: plugins/tsc-diag-track.ts — 新增 groupErrorsByFile 辅助函数
```

每步 TDD-RED → TDD-GREEN → 回归。

---

## 八、与原诊断的差异总结

| 原诊断 | 实际代码 | 差异 |
| --- | --- | --- |
| `applies` 是 `false` | `applies` 是 `true`（`unparseable_modify_shell` 变体） | 条件因 `paths.length === 0` 失败，非因 `applies` |
| `kind: "unparseable_write"` | 这是 `ShellClassification` 类型，被 `scope-before.ts` 使用；`tsc-diag-track.ts` 使用的是 `ScopePathResult` 类型 | 两套类型系统被混淆 |
| "应当兜底：unparseable_write 时做全量 tsc 扫描" | 方向正确，但应在 `afterWriteTscCheck` 而非 `beforeWriteBlock` 执行 | 避免 before hook 中阻塞 2-10 秒 |
| 影响范围仅限 `node -e` | 涵盖所有 `unparseable_modify_shell` 命令（bun、python3、sh -c、npx 等） | gap 比描述更广 |
| 未提及 enforcement mode 影响 | strict/locked 下 gap 被 scope-before 覆盖，仅 advisory 下触发 | 实际风险低于直觉预期 |
