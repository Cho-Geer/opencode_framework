# Dispatch 错误日志优化方案（审核修订版）

> **初审日期**: 2026-06-26
> **复审日期**: 2026-06-26（框架代码大更新后复核）
> **v2 校准日期**: 2026-06-27（再次依最新框架代码校准行号与 gap 状态）
> **复审结论**: 5 个黑洞**均未修复**，方案核心结论仍然成立。仅行号微偏移（-1）、G5 typo 范围扩大（1→6 处）、新增 G6/G7（脚本 category 陷阱 8 处 + 工具层 SRC 不一致 3 处）。详见各节"复审更新"标注。
> **v2 校准结论**: G1/G2/G3/G4/G6/G7 仍未修复；**G5 typo 部分已修复**（6 处 `agent, agent,` 重複键已被移除），但 G5 的 `level` 字段缺失与 rawError/dagTaskId 字段缺失仍未修复。行号进一步偏移（log-manager.ts ~+10、dispatch_subagent.ts ~+5、dispatch-subagent.ts 末段 ~-20）。
> **审核范围**: `writeLog(plugin, category, fields)` 体系下的 dispatch 错误日志覆盖

---

## 一、审核结论：原方案 vs 实际代码

### 1.1 原方案正确的部分

| 原则 | 评估 | 依据 |
| --- | --- | --- |
| 不新增 API，全部基于现有 `writeLog(plugin, category, fields)` | ✅ 正确 | `log-manager.ts:339` 签名不变（v2 校准：原 L330 → L339） |
| 错误日志必须包含 `rawError`（原始字符串） | ✅ 正确 | 现有 catch 多数只存 `e.message`，丢失 stack/stderr |
| `phase` 标识失败层级（parse / route / script / Task） | ✅ 正确 | 现有事件名无法区分哪一层失败 |
| 统一使用 `"runtime"` category | ✅ 正确 | `normalizeCategory()` (`log-manager.ts:125-129`，v2 校准原 L116) 将所有非 loaded/hooks 归入 runtime |
| 保留原始 stderr 全量写入，not just parsing a summary | ✅ 正确 | Call #2 (`dispatch_subagent.ts:855`，v2 校准原 L849) 当前仅用 `e.message`，丢弃 `e.stderr` |

### 1.2 原方案的事实性错误（必须修正）

#### ❌ 错误 1：预检失败不在 `tool.execute.before` 插件中

原方案称"在 `tool.execute.before` 插件中（参数解析、agent route、DAG 检查失败时），catch 处加 writeLog"。

**实际情况**:
- `dispatch-before.ts` 插件（Layer 1）**已经**在每次 enforcement throw 前调用 `writeLog`（共 21 处，如 `dispatch-before.ts:76,200,406` 等；v2 校准：原 L89 已偏移至 L76）。插件层**不是黑洞**。
- 真正的黑洞是 **工具层 `tools/dispatch_subagent.ts`（Layer 2）**。其 `execute()` 函数在 `283-519` 行的预检（DAG 检查、route 校验、SA repair-pattern）直接 `throw new Error("[FW-ENFORCE]...")` **且无 writeLog**（v2 校准：原范围 283-516，现为 283-519）。

**修正**: 日志补点应加在工具层 `execute()` 的 catch 处，而非插件层。

#### ❌ 错误 2：`task-before.ts` 没有 `tool.execute.after` 钩子

原方案称"task-before.ts 的 tool.execute.after 钩子中检查 result.error"。

**实际情况**:
- `task-before.ts` **只注册** `tool.execute.before`（`task-before.ts:30-32`），无 after 钩子。
- `tool.execute.after` 钩子注册在 **`task-after.ts`**（`task-after.ts:17-18`），该插件已在 `task-after.ts:34` 检查 `output?.error || output?.failed` 并判定 `FAILURE`。

**修正**: Task() 失败日志补强应改在 `task-after.ts`，而非 `task-before.ts`。

#### ❌ 错误 3：不存在名为 `"dispatch"` 的 plugin 标识

原方案所有示例使用 `writeLog("dispatch", "ERROR", {...})`。

**实际情况**: 代码库中无 `"dispatch"` 这个 SRC。dispatch 相关的 SRC 为：
- 工具层: `SRC = "tool-dispatch-subagent"`（`dispatch_subagent.ts:25`）
- 脚本: `"dispatch-subagent"`（`dispatch-subagent.ts` 内）
- 插件 Layer 1: `"dispatch-before"`
- 插件 after: `"task-after"`

**修正**: 按各文件已有 SRC 常量写入，不臆造 `"dispatch"`。

### 1.3 致命约定陷阱：`"ERROR"` 作为 category 不等于 ERROR 级别

这是 `writeLog` 最隐蔽的陷阱（`log-manager.ts:39, 125-129`，v2 校准原 L31-39/104-120）:

```ts
export type LogCategory = "loaded" | "hooks" | "runtime" | LogLevel;
// LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export function normalizeCategory(cat: LogCategory) {
  if (cat === "loaded" || cat === "hooks" || cat === "runtime") return cat;
  return "runtime";  // ← LogLevel 字符串全部归入 runtime
}
```

`resolveLogLevel(fields.level)` 在 `fields.level` 缺省时返回 `config.logLevel`，后者默认 `"INFO"`（`log-manager.ts:138,158`，`resolveLogLevel()` 位于 L222-225；`project.config.json → logs.level` 可覆盖，但实际项目未配置，故默认 INFO）。

**后果**:
```ts
// ❌ 原方案写法 — 记录为 INFO 级别，不是 ERROR
writeLog("dispatch", "ERROR", { event: "PRE-FLIGHT-FAILED", reason });
//                                        ↑ 无 fields.level → level=INFO
```

`"ERROR"` 作为第 2 参数被 `normalizeCategory` 映射为 `"runtime"`（文件路由正确），但 **severity 列记录为 INFO**，会被 `shouldLog` 在 `WARN/INFO` 阈值过滤时与真 INFO 混淆。

**正确约定**（代码库主流插件已采用，如 `task-before.ts:255`、`dispatch-before.ts:89`）:
```ts
// ✅ 正确 — category="runtime"，level 在 fields 中显式声明
writeLog(SRC, "runtime", { level: "ERROR", event: "...", detail: "..." });
```

> **本方案所有 writeLog 调用统一采用 `category="runtime"` + `fields.level` 显式声明的约定。**

---

## 二、现有代码日志覆盖盘点

### 2.1 已有覆盖（非黑洞）

| 层级 | 文件 | 覆盖情况 |
| --- | --- | --- |
| 插件 Layer 1 | `dispatch-before.ts` | ✅ 每次 `[FW-ENFORCE]` throw 前均有 `writeLog(... level:"ERROR" ...)`，共 21 处 writeLog / 7 处 enforcement throw（如 L76, L200, L406；v2 校准：原 L89 已偏移至 L76） |
| 插件 before | `task-before.ts` | ✅ DISPATCH-INTEGRITY 校验失败有 `writeLog`（14 处） |
| 插件 before | `scope-before.ts` / `checklist-before.ts` | ✅ enforcement throw 前有 `writeLog` |
| 脚本 | `dispatch-subagent.ts` | ✅ 7 个 `process.exit(1)` 前**均有** `writeLog` + `console.error` |

### 2.2 识别出的真实黑洞（本方案修复目标）

| # | 黑洞 | 文件:行 | 现状 | 危害 |
| --- | --- | --- | --- | --- |
| **G1** | 工具层预检 throw 无日志 | `tools/dispatch_subagent.ts:316,374,384,392,401,433,448,453,496,503`（v2 校准：原 311,369,379,387,396,428,443,448,491,498 各 +5） | 10 处 `throw new Error("[FW-ENFORCE]...")` 无 writeLog | Layer 2 防御纵深失败无审计痕迹 |
| **G2** | 工具层脚本 Call #1 catch 无日志 | `tools/dispatch_subagent.ts:599-605`（v2 校准原 594-600） | catch 仅 re-throw，stderr 嵌入 message 但无 writeLog | 脚本崩溃不落盘 |
| **G3** | 工具层脚本 Call #2 catch 吞错误 | `tools/dispatch_subagent.ts:853-860`（v2 校准原 848-855） | catch 返回 `/// DISPATCH RESULT (fallback...)` 字符串，**不抛错、不日志** | 崩溃伪装为成功，LLM 无感知 |
| **G4** | 脚本未捕获异常无结构化输出 | `scripts/command-tools/dispatch-subagent.ts:1050,1276,1288`（v2 校准原 1067,1278,1294；实际 throw 前后位置有偏移，但 writeLog 均已存在，问题在 G6 的 category 陷阱） | 无顶层 try/catch；strict/locked 下 3 处 throw 产生 bun 默认崩溃输出 | 工具层无法结构化解析 |
| **G5** | task-after 失败日志级别错误 + typo 扩散 | `plugins/task-after.ts:36-42`（v2 校准原 36-43） | **v2 校准**: 6 处 `agent, agent,` typo 已修复；但 L36-42 主 writeLog 仍缺 `level` 字段 → FAILURE 记录为 INFO；仍缺 rawError/dagTaskId 独立字段 | 失败事件无法按 ERROR 级别过滤；agentType 字段始终缺失 |
| **G6** | 脚本现有 writeLog 使用 ERROR 作为 category | `scripts/command-tools/dispatch-subagent.ts:723,730,751,797,1043,1248,1269`（v2 校准原 724,731,752,798,1060,1272,1289） | 7 处 `writeLog("dispatch-subagent", "ERROR", {...})` 无 `fields.level` → severity 记录为 INFO | 关键错误（SESSION_MAP_WRITE_FAILED 等）无法按 ERROR 级别过滤 |
| **G7** | 工具层 writeLog SRC 不一致 | `tools/dispatch_subagent.ts:662,680,700`（v2 校准原 657,675,695） | 3 处使用字面量 `"dispatch_subagent"` 而非 `SRC` 常量 `"tool-dispatch-subagent"` | 日志分散到不同 SRC 文件，审计断裂 |

> **复审更新**: G1 行号全部 -1（复审确认）；G4 精确化 throw 行号（1067/1278/1294）；G5 扩展为 6 处 typo（原方案仅发现 1 处）；新增 G6（脚本 7 处 category 陷阱）和 G7（工具层 3 处 SRC 不一致）。
> **v2 校准更新**:
> - G1 全部 10 处 throw 行号 +5 偏移（pre-flight 范围扩展至 L283-519）。
> - G2 catch 从 L594-600 → L599-605；G3 catch 从 L848-855 → L853-860；G3 吞错误行为**仍未修复**。
> - G4 throw 行号微调：1067→1050、1278→1276、1294→1288；这 3 处 throw 之前**都有** writeLog 但其中 2 处使用了错误的 `"ERROR"` category（被 G6 同时覆盖），G4 的真正剩余问题是**缺顶层 try/catch 兜底未捕获异常**。
> - G5 typo 部分已修复（6 处 `agent, agent,` 重複键全部清理），但 L36-42 主 dispatch 结果 writeLog 仍缺 `level`/`rawError`/`dagTaskId` 字段。
> - G6 7 处行号微偏：724→723、731→730、752→751、798→797、1060→1043、1272→1248、1289→1269。
> - G7 3 处 SRC 字面量行号：657→662、675→680、695→700，仍是 `"dispatch_subagent"` 字面量。
> - v1 方案提及的 `dispatch-subagent.ts:1283` 使用 `"INFO"` 作为 category 的记录**已在代码演进中消失**（grep 0 匹配），不再作为 G6 清理项。

---

## 三、具体实施方案

### 变更 1：工具层预检 + 脚本崩溃统一 catch 日志（修复 G1/G2/G3）

**文件**: `.opencode/tools/dispatch_subagent.ts`
**SRC**: `tool-dispatch-subagent`（已有，`:25`）

#### 1A. 新增 phase 分类辅助函数

在 `execute()` 函数体内、预检逻辑之前（约 `:282`，v2 校准：pre-flight 注释现位于 L283），插入:

```ts
function classifyPhase(errMsg: string): string {
  if (/PLAN-FIRST|dag_task_id/i.test(errMsg)) return "dag";
  if (/restricted to @Orchestrator|Caller.*denied|may only target/i.test(errMsg)) return "route";
  if (/Super-Admin.*DENIED|repair.pattern/i.test(errMsg)) return "sa-repair";
  if (/dispatch-subagent.*failed|SCRIPT-CRASH/i.test(errMsg)) return "script";
  return "unknown";
}
```

#### 1B. 预检 throw 补日志（G1）

预检 throw 分两段：
- **DAG 检查** (`:309-401`，v2 校准现为 L314-406) 在 `try { ... } finally {}` 块**之外**
- **route/SA 检查** (`:406-504`，v2 校准现为 L411-519) 在 `try` 块**之内**

**方案**: 将 `:282` 起的预检段整体纳入一个外层 try/catch。在现有 `try {` (`:405`，v2 校准现为 L410) 之前补一个 try，在 `finally` (`:856`，v2 校准现为 L861) 后补 catch:

```ts
// :282 处改为:
try {
  // ── FW-PLAN-FIRST LAYER 2: Pre-flight DAG check ──
  // (原 :282-401 DAG 检查逻辑不变，throw 仍保留；v2 校准：现为 L283-406)
  // ── 以下为原 :405 的 try { ... } finally { ... }（v2 校准：现为 L410 try、L861 finally）──
  try {
    // (原 :406-855 route/SA/script 逻辑不变；v2 校准：现为 L411-860)
  } finally {
    // (原 :856-861 no-op finally 不变；v2 校准：现为 L861-866)
  }
} catch (e: any) {
  const phase = classifyPhase(e.message || "");
  writeLog(SRC, "runtime", {
    sessionID: context.sessionID,
    callID: context.callID,
    agent: context.agent || "",
    agentType: args.agent_type || "",
    level: "ERROR",
    event: "DISPATCH-PRE-FLIGHT-FAILED",
    detail: `phase=${phase} | dagTaskId=${effectiveDagTaskId || "(none)}` +
            ` | target=${args.agent_type || "?"} | rawError=${(e.message || "").slice(0, 400)}`,
  });
  throw e;  // re-throw，保留原有错误传播行为
}
```

> **设计说明**: 不在每个 throw 前散布 writeLog（10 处），而是在 catch 统一记录。phase 由错误消息分类推断。re-throw 保留原有 `[FW-ENFORCE]` 错误传播至插件运行时的行为不变。

#### 1C. 脚本 Call #1 catch 补日志（G2）

**文件**: `dispatch_subagent.ts:599-605`（v2 校准原 594-600）
**现状**:
```ts
} catch (error) {
  const err = error as any;
  throw new Error(
    `dispatch_subagent: dispatch-subagent.js failed (exit ${err.status || 1}): ` +
      `${err.stderr?.toString() || err.message}`,
  );
}
```

**修订为**:
```ts
} catch (error) {
  const err = error as any;
  const rawStderr = (err.stderr?.toString() || "").trim();
  writeLog(SRC, "runtime", {
    sessionID: context.sessionID,
    callID: context.callID,
    agent: context.agent || "",
    agentType: args.agent_type || "",
    level: "ERROR",
    event: "DISPATCH-SCRIPT-CRASH",
    detail: `phase=script | call=1 | exit=${err.status || 1} | dagTaskId=${effectiveDagTaskId || "(none)"}` +
            ` | rawStderr=${rawStderr.slice(0, 800)}`,
  });
  throw new Error(
    `dispatch_subagent: dispatch-subagent.js failed (exit ${err.status || 1}): ` +
      `${rawStderr || err.message}`,
  );
}
```

#### 1D. 脚本 Call #2 catch 补日志 + 不再吞错误（G3）

**文件**: `dispatch_subagent.ts:853-860`（v2 校准原 848-855）
**现状**（最严重黑洞 — 崩溃伪装为成功）:
```ts
} catch (e: any) {
  return [
    `/// DISPATCH RESULT (fallback — CLI failed: ${e?.message || e})`,
    `/// agent_type: ${args.agent_type}`,
    `/// dag_task_id: ${effectiveDagTaskId || "(none)"}`,
    `///    Retry with dispatch_subagent() manually.`,
  ].join("\n");
}
```

**修订为**:
```ts
} catch (e: any) {
  const rawStderr = (e.stderr?.toString() || "").trim();
  const rawStdout = (e.stdout?.toString() || "").trim();
  writeLog(SRC, "runtime", {
    sessionID: context.sessionID,
    callID: context.callID,
    agent: context.agent || "",
    agentType: args.agent_type || "",
    level: "ERROR",
    event: "DISPATCH-SCRIPT-CRASH",
    detail: `phase=script | call=2 | exit=${e.status || 1} | dagTaskId=${effectiveDagTaskId || "(none)"}` +
            ` | rawStderr=${rawStderr.slice(0, 800)}` +
            ` | rawStdout=${rawStdout.slice(0, 400)}`,
  });
  // 不再吞错误为假成功 — 抛出让 LLM 感知失败
  throw new Error(
    `dispatch_subagent: inline prompt generation failed (exit ${e.status || 1}): ` +
      `${rawStderr || e.message}. Retry with dispatch_subagent() manually.`,
  );
}
```

> **行为变更说明**: Call #2 原先返回 fallback 字符串（LLM 视为成功）。修订后改为 throw。这是**有意的行为修正**——崩溃不应伪装为成功。若需保留 fallback 行为（避免阻断 LLM 流），可改为 `return` fallback 字符串**但补 writeLog**；本方案推荐 throw 以对齐"错误必须可见"原则。需 @Arbiter 评估是否豁免。

---

### 变更 2：脚本顶层 try/catch 结构化错误输出（修复 G4）

**文件**: `.opencode/scripts/command-tools/dispatch-subagent.ts`

**现状**: 无顶层 try/catch，无 `main()` 函数。strict/locked 模式下以下 throw 产生 bun 默认崩溃（无 writeLog、无结构化输出）:
- `checklistWirePassed` 失败 throw（`:1050`，v2 校准原 1067；前一个 `writeLog` 在 `:1043`，但其 category 为 `"ERROR"` → severity 记为 INFO，被 G6 同时覆盖）
- `dbEnqueueDispatch` 失败 throw（`:1276` 和 `:1288`，v2 校准原 1278/1294；前后 `writeLog` 同样使用 `"ERROR"` 作为 category）

**方案**: 将脚本 main 逻辑（从 `:107` 参数解析起至 `:1325` `console.log(outputFile)` 止；v2 校准原 141/1303）包裹在顶层 try/catch 中:

```ts
async function main() {
  // 原 :107-1324 全部逻辑（含 7 个 process.exit 路径，保持不变）
  // ...
}

main().catch((e: any) => {
  // 顶层未捕获异常兜底
  try {
    writeLog("dispatch-subagent", "runtime", {
      level: "ERROR",
      event: "SCRIPT-UNCAUGHT-CRASH",
      detail: `phase=script-top | reason=${(e.message || "").slice(0, 300)}` +
              ` | stack=${(e.stack || "").slice(0, 500)}`,
    });
  } catch {}
  // 结构化最后一行 stderr，供工具层解析
  console.error(JSON.stringify({
    error: "UNCAUGHT",
    reason: (e.message || "").slice(0, 300),
    stack: (e.stack || "").slice(0, 500),
  }));
  process.exit(1);
});
```

> **设计说明**:
> - 7 个已有 `process.exit(1)` 路径**不动**——它们已有 writeLog，在 `main()` 内正常退出，不触发顶层 catch。
> - 顶层 catch 仅捕获**未预期的 throw**（strict/locked 下的 checklist/DB 崩溃）。
> - 结构化 JSON 输出到 **stderr**（`console.error`），不污染 stdout 成功路径契约（stdout 仅输出 outputFile 路径）。
> - 工具层 Call #1/Call #2 的 catch 已在变更 1C/1D 中捕获 `e.stderr` 全量，可从中解析末行 JSON，但**始终写入完整 rawStderr**，不依赖解析成功。

---

### 变更 3：task-after 失败日志补强（修复 G5）

**文件**: `.opencode/plugins/task-after.ts:36-42`（v2 校准原 36-43）
**SRC**: `task-after`（已有）

**现状（v2 校准更新）**:
```ts
const outcome = output?.error || output?.failed ? "FAILURE" : "SUCCESS";

writeLog("task-after", "runtime", {
  sessionID: input.sessionID,
  callID: input.callID,
  agent,
  event: "TOOL-AFTER",
  detail: `dispatch-outcome | status=${outcome} | taskId=${taskId} | agentType=${input.args?.subagent_type || "?"}`,
  // ← 无 level 字段 → FAILURE 记录为 INFO（G5 剩余问题）
  // ← 无 rawError
  // ← 无 dagTaskId 独立字段
});
```

> **v2 校准注**: 6 处 `agent, agent,` 重复键 typo 已在代码演进中全部清理（L39-40, 61-62, 217-218, 263-264, 273-274, 282-283 现为单 `agent,`）。因此变更 3B（typo 修复）已完成，仅变更 3A（level/rawError/agentType/dagTaskId 字段补强）仍需实施。

**3A 修订为**:
```ts
const rawError = (output?.error || output?.failed || "").toString();
const isFailure = outcome === "FAILURE";

writeLog("task-after", "runtime", {
  sessionID: input.sessionID,
  callID: input.callID,
  agent,
  agentType: input.args?.subagent_type || "?",
  level: isFailure ? "ERROR" : "INFO",
  event: isFailure ? "DISPATCH-TASK-FAILED" : "DISPATCH-TASK-SUCCESS",
  detail: `phase=task | outcome=${outcome} | dagTaskId=${taskId || "(none)"}` +
          ` | agentTarget=${input.args?.subagent_type || "?"}` +
          ` | rawError=${rawError.slice(0, 500)}`,
});
```

> **修复点**:
> 1. `level` 按 outcome 动态设置——FAILURE 真正记录为 ERROR 级别（可被 `shouldLog` 正确过滤）
> 2. `agent, agent` 重复键 typo 已修复（v2 校准），新增 `agentType` 独立字段
> 3. 失败用独立事件 `DISPATCH-TASK-FAILED`，与成功区分（原 `TOOL-AFTER` 混用）
> 4. `rawError` 写入 detail（截断 500 字符，防止超长）
> 5. `dagTaskId` + `agentTarget` 显式包含，对齐关键原则
> 6. DB 记录逻辑（`:46-68`）不变——已有 `dbAppendDispatchFailed` 写入 errorMsg

#### 3B. 修复全部 6 处 `agent, agent,` typo（v2 校准：已修复）

> **v2 校准状态**: 经 2026-06-27 复查，6 处 `agent, agent,` typo 已在代码演进中被清理，无需再实施。以下行号仅供归档参考：

| 原行号 | 当前行号 | 事件 | 当前状态 |
| --- | --- | --- | --- |
| `:39-40` | L39 | `TOOL-AFTER` | ✅ 已修复（单 `agent,`） |
| `:62-63` | L61-62 | `TOOL-AFTER`（catch block） | ✅ 已修复 + 新增 `level: "ERROR"` |
| `:219-220` | L217-218 | `SESSION-LOG-APPENDED` | ✅ 已修复 |
| `:266-267` | L263-264 | `DISPATCH-QUEUE-CONSUME` | ✅ 已修复 |
| `:278-279` | L273-274 | `DISPATCH-QUEUE-CONSUME-NO-MATCH` | ✅ 已修复 |
| `:287-288` | L282-283 | `DISPATCH-DB-CONSUME-FAILED` | ✅ 已修复 + 新增 `level: "WARN"` |

> 3B 修复完成，3A 仍需实施。

---

### 变更 4：清理现有 category 陷阱 + SRC 不一致（修复 G6/G7）（复审新增）

#### 4A. 脚本 7 处 `"ERROR"` category 修正（G6）

**文件**: `.opencode/scripts/command-tools/dispatch-subagent.ts`

以下 7 处 `writeLog` 使用 `"ERROR"` 作为 category 参数但无 `fields.level`，导致 severity 记录为 INFO（v2 校准行号）：

| 原行号 | 当前行号 | 事件 | 当前写法 | 修正为 |
| --- | --- | --- | --- | --- |
| `:724` | L723 | `SESSION_MAP_WRITE_FAILED` | `writeLog("dispatch-subagent", "ERROR", { event, detail })` | `writeLog("dispatch-subagent", "runtime", { level: "ERROR", event, detail })` |
| `:731` | L730 | `SESSION_MAP_WRITE_ERROR` | 同上 | 同上 |
| `:752` | L751 | `DISPATCH_CTX_WRITE_ERROR` | 同上 | 同上 |
| `:798` | L797 | `CHILD-SESSION-MAP-WRITE-FAILED` | 同上 | 同上 |
| `:1060` | L1043 | `CHECKLIST-MARKING-FATAL` | 同上 | 同上 |
| `:1272` | L1248 | `PENDING-WRITE-FATAL`（v1 称为 DB-ENQUEUE-FAILED-NO-FALLBACK） | 同上 | 同上 |
| `:1289` | L1269 | `PENDING-VERIFY-FATAL`（v1 称为 DISPATCH-DB-ENQUEUE-FAILED） | 同上 | 同上 |

> **注意**: v1 方案提及的 `:1283` 使用 `writeLog("dispatch-subagent", "INFO", {...})` 的记录在 2026-06-27 代码中已不存在（grep 0 匹配），不再作为清理项。

#### 4B. 工具层 3 处 SRC 字面量修正（G7）

**文件**: `.opencode/tools/dispatch_subagent.ts`

| 原行号 | 当前行号 | 当前 | 修正为 |
| --- | --- | --- | --- |
| `:657` | L662 | `writeLog("dispatch_subagent", "INFO", { event: "AUTO-DISPATCH-LEGACY-MIGRATED" ...})` | `writeLog(SRC, "runtime", { level: "INFO", event: "AUTO-DISPATCH-LEGACY-MIGRATED" ...})` |
| `:675` | L680 | `writeLog("dispatch_subagent", "WARN", { event: "AUTO-DISPATCH-QUEUE-APPEND" ...})` | `writeLog(SRC, "runtime", { level: "WARN", event: "AUTO-DISPATCH-QUEUE-APPEND" ...})` |
| `:695` | L700 | `writeLog("dispatch_subagent", "WARN", { event: "AUTO-DISPATCH-QUEUE-TRUNCATED" ...})` | `writeLog(SRC, "runtime", { level: "WARN", event: "AUTO-DISPATCH-QUEUE-TRUNCATED" ...})` |

> **v2 校准注**: 三处当前已使用 `"runtime"` 作为 category（非原 v1 方案说的 `"INFO"` / `"WARN"`），但 SRC 仍是字面量 `"dispatch_subagent"`（下划线），应改为 `SRC` 常量 `"tool-dispatch-subagent"`（连字符）。

---

## 四、关键原则（修订后）

| 原则 | 修订说明 |
| --- | --- |
| **rawError 必须包含** | 所有 ERROR 日志的 detail 中含 `rawError=` 或 `rawStderr=` 原始字符串（截断防爆） |
| **phase 标识层级** | 取值: `dag` / `route` / `sa-repair` / `script` / `script-top` / `task`。由 `classifyPhase()` 或硬编码标注 |
| **agent_target 必须包含** | 写入 `agentType` 字段（`args.agent_type` 或 `input.args.subagent_type`） |
| **category 统一 `"runtime"`** | ❌ 禁止 `writeLog(SRC, "ERROR", ...)`；✅ 必须 `writeLog(SRC, "runtime", { level: "ERROR", ... })` |
| **level 显式声明** | severity 在 `fields.level` 中，不在 category 参数中（避免 INFO 级别陷阱） |
| **stderr 全量保留** | 工具层 catch 写入完整 `rawStderr`（截断 800），不依赖 JSON 解析成功 |
| **SRC 沿用各文件常量** | 工具=`tool-dispatch-subagent`，脚本=`dispatch-subagent`，after=`task-after`。不臆造 `"dispatch"` |

---

## 五、事件命名汇总

| 事件 | 文件 | phase | 触发条件 |
| --- | --- | --- | --- |
| `DISPATCH-PRE-FLIGHT-FAILED` | `tools/dispatch_subagent.ts` | dag/route/sa-repair | Layer 2 预检 throw |
| `DISPATCH-SCRIPT-CRASH` | `tools/dispatch_subagent.ts` | script | 脚本 Call #1/#2 非零退出 |
| `SCRIPT-UNCAUGHT-CRASH` | `scripts/.../dispatch-subagent.ts` | script-top | 脚本顶层未捕获异常 |
| `DISPATCH-TASK-FAILED` | `plugins/task-after.ts` | task | Task() 返回 error/failed |
| `DISPATCH-TASK-SUCCESS` | `plugins/task-after.ts` | task | Task() 成功（INFO 级别） |

---

## 六、日志落盘路径（参考）

所有 `runtime` category 日志写入:
```
.task_temp/_logs/YYYY-MM-DD/plugin-{SRC}-runtime.log
```
示例:
- `.task_temp/_logs/2026-06-26/plugin-tool-dispatch-subagent-runtime.log`
- `.task_temp/_logs/2026-06-26/plugin-dispatch-subagent-runtime.log`
- `.task_temp/_logs/2026-06-26/plugin-task-after-runtime.log`

日志行格式（`log-manager.ts:365-374`，v2 校准原 355-364）:
```
ISO_TIMESTAMP | sessionID | callID | agent | agentType | LEVEL | event | detail
```

---

## 七、验证清单

- [ ] **V1**: 工具层预检失败（无 dag_task_id）→ `plugin-tool-dispatch-subagent-runtime.log` 出现 `DISPATCH-PRE-FLIGHT-FAILED` + `level=ERROR` + `phase=dag`
- [ ] **V2**: 脚本非零退出 → `plugin-tool-dispatch-subagent-runtime.log` 出现 `DISPATCH-SCRIPT-CRASH` + `rawStderr=` 非空
- [ ] **V3**: 脚本未捕获异常 → `plugin-dispatch-subagent-runtime.log` 出现 `SCRIPT-UNCAUGHT-CRASH` + stderr 末行为 JSON
- [ ] **V4**: Task() 返回 error → `plugin-task-after-runtime.log` 出现 `DISPATCH-TASK-FAILED` + `level=ERROR`（非 INFO）+ `rawError=` 非空
- [ ] **V5**: 所有 ERROR 日志的 severity 列为 `ERROR`（用 `grep '| ERROR |'` 验证，非 `| INFO |`）
- [ ] **V6**: Call #2 崩溃不再返回 `/// DISPATCH RESULT (fallback...)` 假成功（或若保留 fallback 则验证 writeLog 已落盘）
- [ ] **V7**: `grep -r 'writeLog.*"ERROR"' .opencode/tools/ .opencode/scripts/command-tools/` 无新增违反约定（category 应为 `"runtime"`）
- [ ] **V8**: 脚本 7 处 category 陷阱修正后，`grep -n 'writeLog.*"dispatch-subagent".*"ERROR"' .opencode/scripts/command-tools/dispatch-subagent.ts` 返回 0 结果（复审新增）
- [ ] **V9**: 工具层 3 处 SRC 不一致修正后，`grep -n 'writeLog("dispatch_subagent"' .opencode/tools/dispatch_subagent.ts` 返回 0 结果（复审新增）
- [ ] **V10**（v2 新增）: `agent, agent,` typo 已在 6 处清理（变更 3B 已完成）。回归保护：`grep -n 'agent,\s*$' .opencode/plugins/task-after.ts` 不得出现连续两行 agent 键。

---

## 八、实施顺序与依赖

```
变更 4 (category/SRC 清理) ── 无依赖，纯替换，可最先实施（复审新增）
变更 3 (task-after)         ── 无依赖，可独立实施
变更 2 (脚本顶层 catch)     ── 无依赖，可独立实施
变更 1 (工具层 catch)       ── 变更 2 完成后验证更充分（脚本结构化输出可被工具层解析）
```

建议按 4 → 3 → 2 → 1 顺序实施，每步 TDD-RED（验证黑洞存在）→ TDD-GREEN（实施修复）→ 回归。

> **复审更新**: 新增变更 4 为最优先项——纯替换、无逻辑变更、风险最低，可消除现有 7+3=10 处约定违反。

---

## 九、附：原方案逐条对应

| 原方案条目 | 对应变更 | 状态 |
| --- | --- | --- |
| dispatch_subagent.ts 工具层加 pre-execution fail 日志 | 变更 1B | ✅ 修正：加在工具层 execute() catch，非插件层 |
| dispatch-subagent.ts 脚本加结构性错误返回 | 变更 2 | ✅ 修正：顶层 catch 兜底未捕获异常，非改写已有 7 个 process.exit |
| task-before.ts 在 Task() 调用失败时补 catch + 日志 | 变更 3A | ✅ 修正：改在 task-after.ts（持有 after 钩子的插件）；仍需实施 |
| 关键原则：rawError / phase / agent_target / runtime category | 第四章 + 变更 4 | ✅ 修正：level 必须在 fields 显式声明；变更 4 清理现有违反（复审新增） |
| `agent, agent,` typo 扩散（复审发现） | 变更 3B | ✅ **已在代码演进中全部修复**（v2 校准：6 处重复键已清理） |
| 脚本 7 处 category 陷阱 + 工具层 3 处 SRC 不一致（复审发现） | 变更 4A/4B | 待实施（行号 v2 校准完毕） |
