# DAG 任务权限校验缺口分析报告

**日期**: 2026-06-17
**状态**: 调查完成，修复方案已制定
**相关 Agent**: @Meta-Planner, @Orchestrator, @Architect, @Coder-BE
**Session 证据**: ses_129c7739effeAIFmVGiPdCppjp

## 一、问题发现

P2-D 完成后，@Meta-Planner 为 Phase 0 生成了 7 个 DAG 任务。其中 3 个存在权限缺口——目标文件超出 Agent 的 safe_edit 授权。

| Task ID | 分配 Agent | target_file | 权限限制 | 结果 |
|---------|-----------|-------------|----------|:----:|
| PHASE0-S1 | @Architect | `.opencode/state/baseline-metrics.json` | `.opencode/state/**`: deny | ❌ |
| PHASE0-S2-RED | @Coder-BE | `.opencode/scripts/__tests__/framework-baseline-metrics.test.ts` | `.opencode/**`: deny | ❌ |
| PHASE0-S2-GREEN | @Coder-BE | `.opencode/scripts/framework-baseline-metrics.ts` | `.opencode/**`: deny | ❌ |
| PHASE0-S3 | @Orchestrator | `.opencode/state/baseline-metrics.json` | `.opencode/**`: deny | ❌ |
| PHASE0-S4 | @Architect | `docs/review/framework-refactor/...` | `docs/**`: allow | ✅ |

## 二、根因分析

### 2.1 完整链路

```
@Orchestrator dispatch @Meta-Planner (DAG-exempt → L1-L4 routing skipped)
  │
  ├─ Meta-Planner 用 safe_edit (patch mode) 写 Task.DAG.json x6 次
  │
  ├─ [gate-before.ts L187] dagContent = output.args.content || output.args.new_content
  │     → patch 模式下两者都不存在 → dagContent = ""
  │
  ├─ [gate-before.ts L191] if (dagContent) → FALSE → 校验块跳过
  │
  └─ exit (pass) — 6 次写入全部静默放行
```

### 2.2 两个盲区

1. **参数名不匹配**: patch 模式参数是 `newString`/`oldString`，gate-before 只查 `content`/`new_content`
2. **无回退路径**: 当 dagContent 为空时，没有"读原文件 + 应用 patch → 完整 JSON"的回退逻辑

### 2.3 日志证据

| 时间(UTC) | 工具 | 文件 | 结果 |
|-----------|------|------|:----:|
| 15:37:31 | safe_edit | Task.DAG.json | exit(ok) |
| 15:37:38 | safe_edit | Task.DAG.json | exit(ok) |
| 15:37:45 | safe_edit | Task.DAG.json | exit(ok) |
| 15:37:56 | safe_edit | Task.DAG.json | exit(ok) |
| 15:38:02 | safe_edit | Task.DAG.json | exit(ok) |
| 15:38:19 | safe_edit | Task.DAG.json | exit(ok) |

## 三、修复方案：safe_diff 预计算

### 3.1 核心思路

gate-before.ts 在 patch 模式下：
1. 读 `output.args.newString` / `oldString`
2. `fs.readFileSync("Task.DAG.json")` 获取当前内容
3. `preContent.replace(oldString, newString)` 计算预期写入后内容
4. `JSON.parse(...)` 得到完整 DAG
5. 提取新增 task → `validateDagTaskAgentAssignment()`
6. 校验失败 → throw → 写入被阻止

### 3.2 代码改动 (gate-before.ts, ~25行)

在 L187 之后增加 patch 模式回退路径：

```typescript
const patchNewStr = output?.args?.newString || "";
const patchOldStr = output?.args?.oldString || "";
const isPatchMode = !!(patchNewStr || patchOldStr);

let dag = null;
if (dagContent) {
  try { dag = JSON.parse(dagContent); } catch {}
}

if (!dag && isPatchMode) {
  try {
    const pre = fs.readFileSync("Task.DAG.json", "utf8");
    const post = patchOldStr ? pre.replace(patchOldStr, patchNewStr) : pre + patchNewStr;
    dag = JSON.parse(post);
  } catch {
    writeLog(..., "DAG patch pre-compute failed");
  }
}
```

### 3.3 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 阻断时机 | tool.execute.before | write 不发生 |
| 失败策略 | WARN 日志 + 放行 | 防止误杀 |

## 四、影响范围

- gate-before.ts: +25 行
- 仅 patch 模式 DAG 写入触发
- overwrite 模式行为不变

## 五、验证

1. 正向: 权限合规 task → 写入成功
2. 负向: 权限违规 task → gate-before throw [FW-ENFORCE][ROUTE-MISMATCH]
3. 回归: overwrite 模式行为不变

## 附录

**相关文件**: gate-before.ts(L182-228), route-validator.ts, permission-reader.ts  
**日志查询**: `grep 'ses_129c7739effeAIFmVGiPdCppjp' .task_temp/_logs/2026-06-17/plugin-gate-before-runtime.log`
