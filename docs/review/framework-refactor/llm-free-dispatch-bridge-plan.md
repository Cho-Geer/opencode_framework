# LLM-Free Dispatch Bridge Plan

**版本**: v1.0.0 | **日期**: 2026-06-18 | **作者**: @Orchestrator | **状态**: 方案

---

## 一、问题

`dispatch_subagent` 生成包装 prompt → LLM 读取 → LLM 调用 `Task(prompt=...)` 。
但 `DISPATCH_TOKEN = SHA256(fullPrompt)`。LLM 中转无法保证字节级原样传递，hash 永远不匹配。

## 二、设计

Tool 层直接调 Task()，不经过 LLM：

dispatch_subagent() 调用
  │
  ├─► dispatch_subagent.ts (Tool) spawn CLI → 得到 fullPrompt + filePath
  │
  ├─► 写入 .auto-dispatch 标记文件 ← 新
  │
  └─► 返回 "✅ Dispatched: <agentType> (<taskId>)" 给 LLM
  下一个插件周期:
  dispatch-auto.ts (新插件, tool.execute.after)
    → 检测 .auto-dispatch 标记
    → 读 .pending.json 取 filePath → 读 fullPrompt
    → 调用 Task({ subagent_type, prompt: fullPrompt })
    → task-before.ts 校验 hash → ✅ 通过
    → 删除 .auto-dispatch 标记

## 三、11 系统分析

| 系统 | 影响 |
|------|------|
| Layout | 新增 `dispatch-auto.ts` 插件 |
| Permission | 无变更 |
| Concurrent | `.auto-dispatch` 按 sessionId 命名，无竞态 |
| Hardened | 保留 enforcement mode，advisory=log, strict/locked=throw |
| Harness | `withPluginLifecycle("dispatch-auto", {"tool.execute.after": fn})` |
| State | 更新 `machine.json.dispatch_history` |
| Multi-Agent | 所有 agent 类型适用 |
| Log | `writeLog("dispatch-auto","runtime",{event:"AUTO-DISPATCH"})` |
| DB | `.pending.json` 保持 JSON（FIFO 队列） |
| Template | `.auto-dispatch` 路径使用现有 OUTPUT_DIR 常量 |
| TS+Bun | TypeScript, node:fs, 无 CJS/ESM 问题 |

## 四、代码

### 4.1 `dispatch-auto.ts` (新插件 ~60行)

```typescript
// dispatch-auto.ts — "tool.execute.after" plugin: auto-invoke Task() 
import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";

const AUTO_MARKER = ".task_temp/_dispatch/.auto-dispatch";

interface AutoEntry {
  sessionId: string; agentType: string; taskId: string; filePath: string;
}

export default withPluginLifecycle("dispatch-auto", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, _output: any): Promise<void> {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const markerPath = path.join(root, AUTO_MARKER);
  
  if (!fs.existsSync(markerPath)) return;
  
  let entry: AutoEntry;
  try {
    entry = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch { return; }
  
  writeLog("dispatch-auto", "runtime", {
    sessionID: entry.sessionId,
    event: "AUTO-DISPATCH-START",
    detail: `agent=${entry.agentType} taskId=${entry.taskId} file=${entry.filePath}`,
  });
  
  // Read full prompt from dispatch file
  let fullPrompt: string;
  try {
    fullPrompt = fs.readFileSync(entry.filePath, "utf8");
  } catch (e: any) {
    writeLog("dispatch-auto", "runtime", {
      sessionID: entry.sessionId, level: "ERROR",
      event: "AUTO-DISPATCH-FAILED",
      detail: `Cannot read dispatch file: ${e.message}`,
    });
    fs.unlinkSync(markerPath);
    return;
  }
  
  // Invoke Task() with full prompt — hash will match
  // In OpenCode plugin context, Task tool is available via the tool registry
  try {
    // Call the Task tool programmatically
    const taskResult = await input.context.invokeTool("Task", {
      subagent_type: entry.agentType,
      description: `auto: ${entry.taskId}`,
      prompt: fullPrompt,
    });
    
    writeLog("dispatch-auto", "runtime", {
      sessionID: entry.sessionId,
      event: "AUTO-DISPATCH-COMPLETE",
      detail: `agent=${entry.agentType} taskId=${entry.taskId} result=${JSON.stringify(taskResult).substring(0, 200)}`,
    });
  } catch (e: any) {
    writeLog("dispatch-auto", "runtime", {
      sessionID: entry.sessionId, level: "ERROR",
      event: "AUTO-DISPATCH-FAILED",
      detail: `Task invocation failed: ${e.message}`,
    });
  }
  
  // Cleanup
  try { fs.unlinkSync(markerPath); } catch {}
}
4.2 dispatch_subagent.ts (Tool) 修改 ~5行
在返回 prompt 给 LLM 之前，写入 .auto-dispatch 并返回简洁确认：
// After CLI stdout is read (current line ~540):
const dispatchPrompt = fs.readFileSync(outputFilePath, "utf8");

// NEW: Write auto-dispatch marker
fs.writeFileSync(
  path.join(worktree, ".task_temp", "_dispatch", ".auto-dispatch"),
  JSON.stringify({
    sessionId: context.sessionID,
    agentType: args.agent_type,
    taskId: dagTaskId,
    filePath: outputFilePath,
  }),
  "utf8"
);

// Return confirmation instead of full prompt
return `✅ Dispatched: ${args.agent_type} (${dagTaskId || "no-task-id"}) — auto-invoking Task()`;
五、实施步骤
Step
1
2
3
4
六、日志事件
事件
AUTO-DISPATCH-START
AUTO-DISPATCH-COMPLETE
AUTO-DISPATCH-FAILED
七、回滚
删除 dispatch-auto.ts，恢复 dispatch_subagent.ts 返回完整 prompt。

---
