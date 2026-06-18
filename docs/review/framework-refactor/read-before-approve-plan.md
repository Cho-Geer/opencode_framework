# READ-BEFORE-APPROVE 物理约束实施方案

**版本**: v1.0.0  
**日期**: 2026-06-18  
**作者**: @Super-Admin  
**状态**: draft  
**关联**: DELIVERABLES-REVIEW-LOCK, DISPATCH-INTEGRITY, SUPER-ADMIN-HARDEN-01

---

## §0 背景与问题

### §0.1 当前约束

`compliance_gate_approve_deliverables` 要求审批人（@Orchestrator / @Super-Admin）必须提供 `handover_sha256` 参数——HANDOVER.md 内容的 SHA-256 哈希值。服务端验证此哈希与磁盘文件一致后方可审批。

```typescript
// compliance-gate.ts L1982-2002 (当前实现)
const actualHash = crypto.createHash("sha256").update(handoverContent).digest("hex");
if (actualHash !== handoverSha256.toLowerCase()) {
  return { status: "rejected", reason: "SHA-256 mismatch..." };
}
```

### §0.2 绕过漏洞

**攻击路径**：审批人可以从子 Agent 的 `task_result` 输出中直接获取 HANDOVER.md 的 sha256 哈希值，而无需实际调用 `read` 工具打开文件阅读内容。

```
┌──────────────┐    task_result     ┌──────────────┐
│  @Coder-BE   │ ────────────────→  │ @Orchestrator│
│  (子Agent)   │  HANDOVER.md 摘要  │  (审批人)     │
│              │  sha256: abc123... │              │
└──────────────┘                    └──────┬───────┘
                                          │
                          handover_sha256="abc123..."
                                          │
                                          ▼
                               ┌─────────────────────┐
                               │ compliance_gate     │
                               │ _approve_           │
                               │ deliverables        │
                               │ → approved ✅       │
                               └─────────────────────┘
```

**漏洞本质**：`handover_sha256` 只证明了**文件存在性与内容完整性**，不能证明审批人**实际阅读了文件内容**。这是一个 **proof-of-access ≠ proof-of-review** 问题。

### §0.3 解决方案核心思想

在审批流程中追加 `read` 工具调用追踪：审批人必须通过 OpenCode 的 `read` 工具实际打开并阅读 HANDOVER.md，该事件被插件层截获记录，`compliance_gate_approve_deliverables` 在审批前验证此记录存在。

---

## §1 技术选型论证

### §1.1 候选方案对比

| 维度 | **方案A: Plugin层** (read-track-after.ts) | **方案B: compliance-gate内** | **方案C: task-before.ts** |
|------|------------------------------------------|----------------------------|--------------------------|
| **追踪方式** | tool.execute.after 钩子截获 read 工具调用 | 在 approve 函数内扫描日志文件 | task() 调用前拦截审批动作 |
| **文件修改数** | 3 文件 (1 新 plugin + 1 新 lib + 1 修改) | 1 文件 (修改 compliance-gate.ts) | 2 文件 (1 修改 plugin + 1 修改 gate) |
| **侵入性** | ✅ 低 — 新增插件，零修改现有插件 | ⚠️ 中 — gate 内耦合读审计逻辑 | ❌ 高 — task-before 不感知审批动作 |
| **时间窗口** | ✅ 实时追踪，精确到秒 | ⚠️ 需扫描日志文件，有 I/O 开销 | ❌ task() 调用 ≠ approve 调用 |
| **绕过难度** | ✅ 无法绕过 — read 工具被框架物理拦截 | ❌ 可绕过 — cat/sha256sum 不经过 read | ❌ 无法精确定位审批时机 |
| **审计完整性** | ✅ 独立审计日志 read_audit.jsonl | ⚠️ 依赖 gate-state.json 字段 | ❌ 审计路径不清晰 |
| **性能影响** | ✅ 微秒级 (追加一行 JSONL) | ⚠️ 毫秒级 (扫描全量日志) | ✅ 无额外开销 |
| **回滚风险** | ✅ 低 — 禁用插件即可关闭 | ⚠️ 中 — 需回滚 gate 函数 | ⚠️ 中 — 影响 task() 调度 |

### §1.2 结论：方案A (Plugin层) 

**选用方案A**，理由：

1. **最小侵入性**：仅在 `compliance-gate.ts` 的 `runGateApproveDeliverables` 中追加 1 个检查块（~40 行），不重构任何现有逻辑
2. **完整的审计链**：`read` 工具调用 → `read-track-after.ts` → `read-audit.ts` → `read_audit.jsonl` → `compliance-gate.ts` 验证
3. **符合 Plugin 架构**：新增 plugin 完全遵循现有 18 插件架构（新增后 19，framework-enforcer-module-inventory.md）
4. **可独立启用/禁用**：通过 `opencode.json.plugin` 数组控制，出问题时一键关闭
5. **物理不可绕过**：`read` 工具是 OpenCode 内置工具，其 `tool.execute.after` 钩子**必然触发**——审批人无法阻止 hook 执行

---

## §2 架构设计

### §2.1 总体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    READ-BEFORE-APPROVE 架构                               │
│                                                                           │
│  ┌──────────────────┐                                                     │
│  │ @Orchestrator     │                                                    │
│  │ (审批人)          │                                                    │
│  └────────┬─────────┘                                                     │
│           │                                                               │
│     ① read HANDOVER.md                                                    │
│           │                                                               │
│           ▼                                                               │
│  ┌──────────────────────────────────────────────┐                        │
│  │ OpenCode 内置 read 工具                       │                       │
│  │ → tool.execute.after hook 触发               │                       │
│  └────────────────────┬─────────────────────────┘                        │
│                       │                                                  │
│                       ▼                                                  │
│  ┌──────────────────────────────────────────────┐                        │
│  │ .opencode/plugins/read-track-after.ts (NEW)  │                        │
│  │ → 截获 filePath + agent + timestamp          │                        │
│  │ → 调用 readAudit.recordRead()                │                        │
│  └────────────────────┬─────────────────────────┘                        │
│                       │                                                  │
│                       ▼                                                  │
│  ┌──────────────────────────────────────────────┐                        │
│  │ .opencode/lib/read-audit.ts (NEW)            │                        │
│  │ → recordRead(): 追加到 read_audit.jsonl      │                        │
│  │ → verifyRead(): 查询 agent 是否读过文件       │                        │
│  └────────────────────┬─────────────────────────┘                        │
│                       │                                                  │
│                       ▼                                                  │
│  ┌──────────────────────────────────────────────┐                        │
│  │ .opencode/state/read_audit.jsonl (NEW)       │                        │
│  │ → 追加行: {agent, filePath, timestamp, ...}  │                        │
│  └────────────────────┬─────────────────────────┘                        │
│                       │                                                  │
│     ② approve_deliverables(handover_sha256)                              │
│                       │                                                  │
│                       ▼                                                  │
│  ┌──────────────────────────────────────────────┐                        │
│  │ compliance-gate.ts                           │                        │
│  │ runGateApproveDeliverables()                 │                        │
│  │ → ③ 验证 handover_sha256 (现有)              │                        │
│  │ → ④ READ-BEFORE-APPROVE: 验证 read 记录 (NEW)│                        │
│  │ → ⑤ 通过 → approved/completed               │                        │
│  └──────────────────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### §2.2 数据流

```
read(HANDOVER.md) → read-track-after.ts → read-audit.ts → read_audit.jsonl
                                                                    │
approve_deliverables() ──→ 验证 sha256 ──→ 验证 read 记录 ──→ approved
                           (现有约束)       (新增约束)
```

### §2.3 状态机交互

当前 gate 状态机 (`gate-core.ts L83`)：
```
checked → armed → delivered → approved → completed
                              ↑
                         (本次修改点)
```

**修改**：`approved` 状态前追加 `read-verified` 子状态（逻辑态，不持久化到 gate_status 枚举）。

```
delivered → [READ-VERIFY: sha256 check + read audit check] → approved → completed
                              │
                         (任一检查失败 → rejected)
```

> **设计决策**：不新增 `read-verified` 到 `GateSession.gate_status` 枚举中，避免破坏消费者（gate-after.ts、state-compactor.ts、pre-commit hook 等）的状态匹配逻辑。READ-BEFORE-APPROVE 作为 `runGateApproveDeliverables` 内部的两个顺序检查（sha256 之后、status 转换之前）实现。

---

## §3 详细设计

### §3.1 文件改动清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `.opencode/lib/read-audit.ts` | **新增** | 读审计库：recordRead() / verifyRead() / cleanupOldRecords() |
| 2 | `.opencode/plugins/read-track-after.ts` | **新增** | tool.execute.after 插件：截获 read 工具事件 |
| 3 | `.opencode/scripts/mcp-tools/compliance-gate.ts` | **修改** | runGateApproveDeliverables() 追加 READ-BEFORE-APPROVE 检查 |
| 4 | `opencode.json` | **修改** | plugin 数组中注册 read-track-after.ts |
| 5 | `.opencode/state/schemas/read-audit.schema.json` | **新增** | read_audit.jsonl 行数据 JSON Schema |

### §3.2 新增文件: `.opencode/lib/read-audit.ts`

```typescript
/**
 * read-audit.ts — Read event audit trail for READ-BEFORE-APPROVE enforcement
 * ═══════════════════════════════════════════════════════════════════════
 * Records every `read` tool invocation (via read-track-after.ts plugin) to
 * an append-only JSONL file. Provides verifyRead() for compliance-gate.ts
 * to check whether an approver actually read HANDOVER.md before approving.
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-18
 *
 * Design review: docs/review/framework-refactor/read-before-approve-plan.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "./log-manager";
import { STATE_PATHS } from "./state-utils";

// ── Types ──────────────────────────────────────────────────────

export interface ReadAuditEntry {
  /** ISO 8601 timestamp of the read event */
  timestamp: string;
  /** Agent identity (e.g. "Orchestrator", "@Super-Admin") */
  agent: string;
  /** Absolute or relative file path that was read */
  filePath: string;
  /** Session ID of the gate session being approved */
  sessionId?: string;
  /** DAG task ID for context */
  taskId?: string;
  /** Read tool invocation ID (from OpenCode callID) */
  callId?: string;
}

export interface ReadVerifyResult {
  verified: boolean;
  reason: string;
  matchedEntry?: ReadAuditEntry;
}

// ── Configuration ──────────────────────────────────────────────

/** Maximum age of a read event to be considered valid for approval (5 min) */
const READ_MAX_AGE_MS = 5 * 60 * 1000;

/** Maximum records to keep in the audit file (oldest pruned first) */
const MAX_RECORDS = 10000;

/** 
 * File path for read audit log.
 * Uses STATE_PATHS pattern from state-utils.ts for centralized path management.
 * Requires adding `readAudit: () => resolveStatePath(".opencode/state/read_audit.jsonl")`
 * to the STATE_PATHS constant in lib/state-utils.ts.
 */
function getReadAuditPath(): string {
  return STATE_PATHS.readAudit();
}

// ── Core Functions ─────────────────────────────────────────────

/**
 * Record a read event to the audit log.
 * Called by read-track-after.ts plugin on every `read` tool invocation.
 *
 * @param entry - Read audit entry to record
 */
export function recordRead(entry: ReadAuditEntry): void {
  try {
    const auditPath = getReadAuditPath();
    const dir = path.dirname(auditPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Append single line JSON (JSONL format)
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(auditPath, line, "utf8");

    // Periodic cleanup: keep only last MAX_RECORDS
    cleanupOldRecords();

    writeLog("lib-read-audit", "INFO", {
      event: "READ_RECORDED",
      agent: entry.agent,
      filePath: entry.filePath,
      sessionId: entry.sessionId || "—",
    });
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "RECORD_READ_FAILED",
      error: err.message,
    });
  }
}

/**
 * Verify that an agent has read a specific file within the valid time window.
 * Called by compliance-gate.ts runGateApproveDeliverables before approval.
 *
 * @param agent - Agent identity to check (e.g. "Orchestrator")
 * @param filePath - File path that must have been read
 * @param sessionId - Optional session ID for cross-reference
 * @returns Verification result with matched entry if found
 */
export function verifyRead(
  agent: string,
  filePath: string,
  sessionId?: string,
): ReadVerifyResult {
  try {
    const auditPath = getReadAuditPath();
    if (!fs.existsSync(auditPath)) {
      return {
        verified: false,
        reason: `Read audit log not found at ${auditPath}. No read events recorded.`,
      };
    }

    const content = fs.readFileSync(auditPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const now = Date.now();
    const cutoff = now - READ_MAX_AGE_MS;

    // Normalize agent name (strip @ prefix for comparison)
    const normalizedAgent = agent.replace(/^@/, "").toLowerCase();

    // Scan from newest to oldest for efficiency
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry: ReadAuditEntry = JSON.parse(lines[i]);

        // Check time window
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime < cutoff) {
          // Past cutoff — no newer entries will match either
          // (since we're scanning newest→oldest)
          break;
        }

        // Check agent match (case-insensitive, @-prefix agnostic)
        const entryAgent = (entry.agent || "").replace(/^@/, "").toLowerCase();
        if (entryAgent !== normalizedAgent) continue;

        // Check file path match (normalize for .task_temp/{taskId}/HANDOVER.md patterns)
        if (pathsMatch(entry.filePath, filePath)) {
          // For session-scoped checks: if sessionId provided, prefer exact session match
          if (sessionId && entry.sessionId && entry.sessionId !== sessionId) {
            continue; // Different session — keep searching
          }

          return {
            verified: true,
            reason: `Agent "${entry.agent}" read "${entry.filePath}" at ${entry.timestamp}`,
            matchedEntry: entry,
          };
        }
      } catch {
        // Corrupted line — skip
        continue;
      }
    }

    // No match found
    const absPath = path.resolve(process.env.OPENCODE_ROOT || ".", filePath);
    return {
      verified: false,
      reason:
        `Agent "@${normalizedAgent}" has NOT read "${filePath}" via the \`read\` tool ` +
        `within the last ${READ_MAX_AGE_MS / 60000} minutes. ` +
        `You MUST use the \`read\` tool to open and review HANDOVER.md before approving. ` +
        `Compute hash manually: sha256sum ${absPath}`,
    };
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "VERIFY_READ_FAILED",
      error: err.message,
    });
    return {
      verified: false,
      reason: `Read audit verification failed: ${err.message}`,
    };
  }
}

/**
 * Normalize two file paths for comparison.
 * Handles relative vs absolute, .task_temp/{taskId}/HANDOVER.md patterns,
 * and trailing slashes.
 */
function pathsMatch(p1: string, p2: string): boolean {
  const root = process.env.OPENCODE_ROOT || ".";

  const normalize = (p: string): string => {
    // Resolve relative to OPENCODE_ROOT
    const resolved = p.startsWith("/") ? p : path.resolve(root, p);
    // Normalize separators and remove trailing slash
    return path.normalize(resolved).replace(/\/+$/, "").toLowerCase();
  };

  try {
    return normalize(p1) === normalize(p2);
  } catch {
    return p1.toLowerCase() === p2.toLowerCase();
  }
}

/**
 * Clean up old read audit records beyond MAX_RECORDS.
 * Keeps only the most recent MAX_RECORDS entries.
 */
function cleanupOldRecords(): void {
  try {
    const auditPath = getReadAuditPath();
    if (!fs.existsSync(auditPath)) return;

    const content = fs.readFileSync(auditPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    if (lines.length <= MAX_RECORDS) return;

    // Keep only last MAX_RECORDS entries
    const kept = lines.slice(-MAX_RECORDS);
    fs.writeFileSync(auditPath, kept.join("\n") + "\n", "utf8");

    writeLog("lib-read-audit", "INFO", {
      event: "READ_AUDIT_CLEANUP",
      pruned: lines.length - kept.length,
      remaining: kept.length,
    });
  } catch {
    // Non-critical — audit file continues to grow
  }
}

// Re-export for convenience
export { READ_MAX_AGE_MS, MAX_RECORDS };
```

### §3.3 新增文件: `.opencode/plugins/read-track-after.ts`

```typescript
/**
 * read-track-after.ts — READ-BEFORE-APPROVE plugin
 * ═══════════════════════════════════════════════════════════
 * Hooks into `tool.execute.after` for the `read` tool.
 * Records every read event to read_audit.jsonl via lib/read-audit.ts.
 *
 * This plugin is the physical enforcement layer for READ-BEFORE-APPROVE:
 * without it, compliance-gate.ts cannot verify that an approver actually
 * read HANDOVER.md before calling approve_deliverables.
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-18
 *
 * Design review: docs/review/framework-refactor/read-before-approve-plan.md
 */

import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { recordRead } from "../lib/read-audit";

const PLUGIN_ID = "read-track-after";

/**
 * Resolve agent identity from tool execution context.
 * Delegates to agent-resolver.resolveAgent() for unified logic.
 */
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";

function resolveAgentFromContext(input: any): string {
  // Use session ID from input context if available, otherwise resolve from env
  const sessionId = input?.context?.sessionId || input?.sessionID || input?.sessionId;
  return resolveAgent(sessionId);
}

/**
 * Resolve task ID from tool execution context.
 */
function resolveTaskIdFromContext(input: any): string {
  return resolveTaskId(input?.sessionID || input?.sessionId || "");
}

// ── Plugin export (withPluginLifecycle pattern) ────────────────
async function toolExecuteAfter(input: any, output: any) {
  try {
    // Only intercept `read` tool invocations
    const tool = input?.tool || input?.args?.tool || "";
    if (tool !== "read" && tool !== "Read") return;

    // Extract file path from read tool args
    // `read` tool: args = { filePath: "/path/to/file", ... }
    const args = input?.args || {};
    const filePath = args.filePath || args.file_path || "";
    if (!filePath) return;

    // Resolve caller identity via agent-resolver
    const agent = resolveAgentFromContext(input);
    const taskId = resolveTaskIdFromContext(input);
    const callId = input?.callID || input?.callId || undefined;
    const sessionId = input?.sessionID || input?.sessionId || undefined;

    // Record the read event
    recordRead({
      timestamp: new Date().toISOString(),
      agent,
      filePath,
      sessionId,
      taskId,
      callId,
    });

    writeLog(PLUGIN_ID, "runtime", {
      event: "READ_TRACKED",
      agent,
      filePath,
      sessionId: sessionId || "—",
    });
  } catch (err: any) {
    writeLog(PLUGIN_ID, "ERROR", {
      event: "READ_TRACK_FAILED",
      error: err.message,
    });
  }
}

export default withPluginLifecycle(PLUGIN_ID, {
  "tool.execute.after": toolExecuteAfter,
});
```

### §3.4 修改文件: `.opencode/scripts/mcp-tools/compliance-gate.ts`

在 `runGateApproveDeliverables` 函数中，**在 DELIVERABLES-REVIEW-LOCK sha256 验证之后、status 转换之前**，追加 READ-BEFORE-APPROVE 检查。

**修改位置**: 第 2002 行之后（sha256 验证通过，approval_note 长度检查之后）

**新增代码块**:

```typescript
// ── READ-BEFORE-APPROVE: Verify approver actually read HANDOVER.md ──
// (insert after line 2002 in runGateApproveDeliverables)
//
// The handover_sha256 check above proves the approver has access to the
// file hash but NOT that they actually read the content. An approver can
// obtain the hash from the sub-agent's task_result output without ever
// opening HANDOVER.md. This check closes that gap by verifying the
// approver called the `read` tool on the HANDOVER.md file within the
// valid time window.
//
// Read events are tracked by read-track-after.ts plugin → read-audit.ts
// → read_audit.jsonl. The verifyRead() function scans the audit log for
// a matching entry (agent + filePath + timestamp within 5 min window).
{
  try {
    const { verifyRead } = require("../../lib/read-audit");
    const resolvedHandoverPath = path.resolve(
      OPENCODE_ROOT,
      `.task_temp/${taskId}/HANDOVER.md`,
    );
    const readResult = verifyRead(
      resolvedAgent,
      resolvedHandoverPath,
      sessionId,
    );

    if (!readResult.verified) {
      writeLog("mcp-compliance-gate", "ERROR", {
        sessionID: sessionId,
        agent: resolvedAgent,
        level: "ERROR",
        event: "READ_BEFORE_APPROVE_FAILED",
        detail: readResult.reason,
      });
      return {
        status: "rejected",
        reason:
          `[READ-BEFORE-APPROVE] ${readResult.reason}\n\n` +
          `Required actions:\n` +
          `1. Use the \`read\` tool to open and review the HANDOVER.md content\n` +
          `2. Compute the SHA-256 hash: sha256sum .task_temp/${taskId}/HANDOVER.md\n` +
          `3. Re-call compliance_gate_approve_deliverables with both:\n` +
          `   - handover_sha256: <computed hash>\n` +
          `   - approval_note: <your review findings (min 10 chars)>\n\n` +
          `This ensures you have actually READ the deliverables, not just obtained the hash.`,
      };
    }

    writeLog("mcp-compliance-gate", "INFO", {
      sessionID: sessionId,
      agent: resolvedAgent,
      event: "READ_BEFORE_APPROVE_PASSED",
      detail: readResult.reason,
    });
  } catch (readAuditErr: any) {
    // read-audit.ts unavailable — fall back to sha256-only check
    // Graceful degradation: log warning, allow approval to proceed
    writeLog("mcp-compliance-gate", "WARN", {
      sessionID: sessionId,
      agent: resolvedAgent,
      event: "READ_BEFORE_APPROVE_UNAVAILABLE",
      detail: `lib/read-audit.ts load failed: ${readAuditErr.message}. Fallback to sha256-only verification.`,
    });
  }
}
```

**修改后完整逻辑流**（`runGateApproveDeliverables` 内 `approvalDecision === "approve"` 分支）：

```
① enforceMultiSourceAudit() — 调查类任务日志证据检查 (现有)
② HANDOVER.md 存在性检查 (现有)
③ handover_sha256 提供性检查 (现有)
④ handover_sha256 一致性检查 (现有)         ← DELIVERABLES-REVIEW-LOCK
⑤ approval_note 长度检查 (现有)
⑥ verifyRead() 读事件检查 (新增)            ← READ-BEFORE-APPROVE
⑦ session.deliverables_approved_by 赋值 (现有)
⑧ gate_status → "approved" (现有)
⑨ auto-complete if execution_summary (现有)
```

### §3.5 配置文件修改: `opencode.json`

在 `plugin` 数组中注册新插件：

```json
{
  "plugin": [
    // ... 现有插件 ...
    "./.opencode/plugins/read-track-after.ts"
  ]
}
```

> **注意**：`plugin` 数组的顺序决定了 hook 注册顺序。`read-track-after.ts` 可放在任意位置，因为它只注册 `tool.execute.after` hook，不依赖其他插件。

### §3.6 JSON Schema: `.opencode/state/schemas/read-audit.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "read-audit-entry.schema.json",
  "title": "Read Audit Entry",
  "description": "Single read event recorded by read-track-after.ts plugin",
  "type": "object",
  "properties": {
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of the read event"
    },
    "agent": {
      "type": "string",
      "minLength": 1,
      "description": "Agent identity (e.g. 'Orchestrator', '@Super-Admin')"
    },
    "filePath": {
      "type": "string",
      "minLength": 1,
      "description": "Absolute or relative file path that was read"
    },
    "sessionId": {
      "type": "string",
      "description": "Optional gate session ID"
    },
    "taskId": {
      "type": "string",
      "description": "Optional DAG task ID"
    },
    "callId": {
      "type": "string",
      "description": "Optional read tool invocation ID"
    }
  },
  "required": ["timestamp", "agent", "filePath"]
}
```

---

## §4 11 子系统兼容性审查

### §4.1 Layout 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 新文件位置符合 `.opencode/` 目录结构 | ✅ | `lib/read-audit.ts` + `plugins/read-track-after.ts` 符合现有布局 |
| 状态文件位置 (`read_audit.jsonl`) | ✅ | 放在 `.opencode/state/` 与其他状态文件一致 |
| JSON Schema 位置 | ✅ | `.opencode/state/schemas/read-audit.schema.json` 遵循 P1-B 拆分规范 |
| Dispatch 配置 | ✅ | `opencode.json` plugin 数组追加，无需 `project.config.json` 修改 |

### §4.2 Permission 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 审批人权限不变 | ✅ | 仍限于 @Orchestrator / @Super-Admin（现有 SA-FIX-APPROVE-PERMISSION） |
| 不要额外权限 | ✅ | `read` 是 OpenCode 内置工具，所有 agent 都有 read 权限 |
| 不创建新工具 | ✅ | `read-track-after.ts` 是 hook，不暴露新 MCP 工具 |

### §4.3 Concurrent 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| read_audit.jsonl 并发写安全 | ✅ | 使用 `fs.appendFileSync` — POSIX O_APPEND 保证原子追加 |
| 多个审批人并发审批不同 session | ✅ | 每次 verifyRead 独立扫描，无共享可变状态 |
| 与现有 gate session 互斥兼容 | ✅ | 不修改 session 生命周期，仅追加检查 |

### §4.4 Hardened 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 物理不可绕过 | ✅ | `tool.execute.after` hook 由框架强制执行，agent 无法跳过 |
| 降级容错 | ✅ | read-audit.ts 不可用时 → WARN 日志 + 回退到 sha256-only |
| 不破坏现有 HARDEN 约束 | ✅ | SUPER-ADMIN-HARDEN-01 (HANDOVER.md 存在)、DISPATCH-INTEGRITY (task_id 不变)、DELIVERABLES-REVIEW-LOCK (sha256) 全部保留 |

### §4.5 Harness (Plugin) 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 符合插件编程约定 | ✅ | `export default (async (ctx) => { return hooks })` 模式 |
| 符合 Bun/TS 原生编译 | ✅ | TypeScript 语法，`require()` 兼容 CJS |
| 日志系统集成 | ✅ | writeLog + updateIndex + ensureLogDir 标准模板 |
| 不引入重复 hook | ✅ | 独立注册 `tool.execute.after`，不与现有插件冲突 |
| before/after hook 参数位置 | ✅ | 使用 `input.args` 读取（after-hook 的正确参数位置） |

### §4.6 State 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| gate-state.json 字段不变 | ✅ | 不修改 GateSession 类型定义 |
| 新状态文件 read_audit.jsonl | ✅ | JSONL 格式，追加写入，定期清理 |
| 不创建新 gate_status 枚举值 | ✅ | READ-VERIFY 是逻辑态，不持久化 |

### §4.7 Multi-Agent 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| @Orchestrator / @Super-Admin 审批流不变 | ✅ | 审批流程仅追加检查，不改变调用方协议 |
| 子 Agent 不受影响 | ✅ | 子 Agent 的 submit_deliverables → armed → delivered 流程不变 |
| Agent 身份解析一致 | ✅ | 复用现有 resolveDispatchTargetAgentDirect() 逻辑 |

### §4.8 Log 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| writeLog 标准接入 | ✅ | read-track-after.ts 和 read-audit.ts 均使用 writeLog |
| 日志文件隔离 | ✅ | `plugin-read-track-after-runtime.log` + `lib-read-audit-runtime.log` |
| 审计可追溯 | ✅ | READ_RECORDED / READ_TRACKED / READ_BEFORE_APPROVE_PASSED / READ_BEFORE_APPROVE_FAILED 事件 |

### §4.9 DB 子系统 (SQLite)

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 不涉及 DB schema 变更 | ✅ | read_audit.jsonl 是 JSONL 文件，不写入 SQLite |
| 不依赖 db-state-manager | ✅ | 直接文件 I/O |

### §4.10 Template 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| 不使用 template variable | ✅ | HANDOVER.md 路径使用 `task_id` 参数计算，无需模板解析 |
| 不修改 dispatch-subagent.ts | ✅ | 审批流不属于 dispatch 范围 |

### §4.11 TS+Bun 子系统

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| TypeScript 原生编译 | ✅ | `import`/`export` 语法，Bun 原生支持 |
| CJS 兼容 (require) | ✅ | compliance-gate.ts 使用 `require()` 动态加载 read-audit.ts |
| 不使用 ESM-only 特性 | ✅ | 无 top-level await，无 import.meta |
| 类型安全 | ✅ | ReadAuditEntry / ReadVerifyResult 接口定义 |

---

## §5 风险点与回滚方案

### §5.1 风险矩阵

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|------|:----:|:----:|----------|
| R1 | read-track-after.ts 插件加载失败 | 低 | 中 | compliance-gate.ts 有 try-catch 降级，sha256-only 回退 |
| R2 | read_audit.jsonl 文件过大 | 中 | 低 | cleanupOldRecords() 保留最新 10000 条 |
| R3 | 审批人在不同 session 中读文件 | 低 | 中 | verifyRead 支持 sessionId 可选匹配 |
| R4 | 审批人读文件后超过 5 分钟才审批 | 中 | 低 | READ_MAX_AGE_MS 可配置；用户看到明确错误提示后可重读 |
| R5 | before-hook 异常阻断 after-hook 链执行 | 低 | 高 | **分析**：若同一工具调用链中某个 `tool.execute.before` 插件抛出未捕获异常（如 uc7ks-before.ts 阻断外部查询），OpenCode 框架可能跳过后续 `tool.execute.after` 钩子（包括 read-track-after.ts），导致 read 事件缺失。**缓解**：(1) read-track-after.ts 作为独立插件，`withPluginLifecycle` 注册错误处理日志；(2) before-hook 异常不影响 `read` 工具本身——`read` 是框架内置工具，其 `after` hook 链独立于业务 `before` hook；(3) 降级容错：若 read 事件缺失，approve 回退到 sha256-only 验证。 |
| R6 | CI 环境无 read 插件 | 低 | 中 | CI 中 approve 通常自动执行；降级到 sha256-only 可接受 |
| R7 | `read` 工具重命名或重构导致钩子不匹配 | 低 | 高 | **分析**：read-track-after.ts 通过 `tool !== "read" && tool !== "Read"` 字符串匹配识别 `read` 工具调用。若 OpenCode 未来版本将 `read` 工具重命名（如 `file_read`）或重构为不同触发方式，钩子将静默失效，所有 read 事件丢失。**缓解**：(1) 在 `framework-self-test.ts` 中增加插件自检：启动时发送 mock `read` 事件，验证 read_audit.jsonl 是否有新记录写入；(2) 记录 `UNKNOWN_TOOL` 事件：当 hook 触发但 tool 名不匹配任何已知工具时，写 WARN 日志；(3) 框架自检 Check 36 监控 read-track-after.ts 加载状态。 |

### §5.2 回滚方案

**立即回滚（< 1 分钟）**：
```bash
# 1. 从 opencode.json plugin 数组移除 read-track-after.ts
# 2. 重启 OpenCode
```

**代码级回滚**：
```bash
git revert <commit-hash>  # 回滚 compliance-gate.ts 修改
```

**降级运行**（read-audit.ts 不可用时）：
- compliance-gate.ts 内置 try-catch 降级：捕获 require 异常 → 写 WARN 日志 → 回退到 sha256-only 验证
- Gate 操作**不阻断** — 保证审批流程可用性优先

### §5.3 灰度发布建议

```
Phase 1 (advisory): 启用 read-track-after.ts，verifyRead 返回 WARNING 不阻断审批
                    → 验证插件正常加载，read 事件正常记录
                    → 观察 24h，确认无副作用

Phase 2 (strict):   verifyRead 返回 ERROR 阻断审批
                    → 全量启用 READ-BEFORE-APPROVE
                    → 监控 read_audit.jsonl 增长率

Phase 3 (locked):   与 strict 相同
```

> **注意**：当前 enforcement_mode 为 `strict`，需将 Phase 1 的 advisory 过渡期通过环境变量 `ENFORCEMENT_MODE=advisory` 实现。

---

## §6 接口签名变更

### §6.1 `compliance_gate_approve_deliverables` — 无变更

**对外接口不变**。调用方（@Orchestrator / @Super-Admin）无需修改任何代码：

```typescript
// 参数签名 (不变)
{
  session_id: string;        // Gate session ID
  approval_decision: string; // "approve" | "reject"
  approval_note?: string;
  execution_summary?: string;
  agent_id?: string;
  handover_sha256: string;   // ← 仍然是必需的
}
```

### §6.2 新增内部函数 — `verifyRead()`

```typescript
// lib/read-audit.ts
export function verifyRead(
  agent: string,
  filePath: string,
  sessionId?: string,
): ReadVerifyResult;

export interface ReadVerifyResult {
  verified: boolean;
  reason: string;
  matchedEntry?: ReadAuditEntry;
}
```

### §6.3 新增内部函数 — `recordRead()`

```typescript
// lib/read-audit.ts
export function recordRead(entry: ReadAuditEntry): void;

export interface ReadAuditEntry {
  timestamp: string;
  agent: string;
  filePath: string;
  sessionId?: string;
  taskId?: string;
  callId?: string;
}
```

---

## §7 与现有 Gate 状态机的交互

### §7.1 状态转换总览

```
┌─────────┐  check    ┌───────┐  confirm   ┌───────┐  submit    ┌───────────┐
│ checked │ ────────→ │ armed │ ─────────→ │ armed │ ─────────→ │ delivered │
└─────────┘           └───────┘            └───────┘            └─────┬─────┘
                                                                       │
                                                              approve │ (含 READ-VERIFY)
                                                                       │
                                                               ┌───────▼──────┐
                                                               │   approved   │
                                                               └───────┬──────┘
                                                                       │
                                                          auto-complete │
                                                                       │
                                                               ┌───────▼──────┐
                                                               │  completed   │
                                                               └──────────────┘
```

### §7.2 READ-BEFORE-APPROVE 在 approve 阶段的内部流程

```
runGateApproveDeliverables(sessionId, "approve", note, summary, agentId, sha256)
│
├─ ① 权限检查: agent 必须是 @Orchestrator / @Super-Admin
├─ ② 状态检查: session.gate_status === "delivered"
├─ ③ enforceMultiSourceAudit(): 调查类任务日志证据 (Step 0d)
│
├─ ④ DELIVERABLES-REVIEW-LOCK: HANDOVER.md 存在性检查
├─ ⑤ DELIVERABLES-REVIEW-LOCK: handover_sha256 提供性检查
├─ ⑥ DELIVERABLES-REVIEW-LOCK: handover_sha256 一致性检查  ← 现有约束
├─ ⑦ approval_note 长度检查 (≥10 chars)
│
├─ ⑧ READ-BEFORE-APPROVE: verifyRead() 读事件检查           ← 新增约束
│   ├─ 通过 → 继续
│   └─ 失败 → return { status: "rejected", reason: "..." }
│
├─ ⑨ session.deliverables_approved_by = "Orchestrator"
├─ ⑩ session.gate_status = "approved"
├─ ⑪ (optional) auto-complete if execution_summary
└─ ⑫ saveStore() + writeLog()
```

### §7.3 不修改的状态枚举

`GateSession.gate_status` 保留现有值：

```typescript
type GateStatus = 'checked' | 'armed' | 'delivered' | 'approved' | 'completed' | 'failed' | 'recoverable' | 'drained';
```

**不新增** `'read-verified'` 状态。READ-VERIFY 是 `runGateApproveDeliverables` 函数内部的逻辑检查，不体现为独立状态转换。这确保了：
- `gate-after.ts` 的 stale session drain 逻辑不变
- `state-compactor.ts` 的归档逻辑不变
- `pre-commit` hook 的 gate armed check 不变
- 所有现有 `gate_status` 消费者零改动

---

## §8 测试策略

### §8.1 单元测试 (`read-audit.test.ts`)

| 测试场景 | 预期结果 |
|---------|---------|
| recordRead + verifyRead (同一文件) | verified=true |
| verifyRead (agent 未读) | verified=false |
| verifyRead (已读但超过 5 分钟) | verified=false |
| verifyRead (文件路径不匹配) | verified=false |
| verifyRead (空审计日志) | verified=false |
| cleanupOldRecords (超过 10000 条) | 保留最新 10000 条 |
| pathsMatch (相对路径 vs 绝对路径) | true |
| pathsMatch (.task_temp/xxx/HANDOVER.md) | true |

### §8.2 集成测试

| 测试场景 | 步骤 |
|---------|------|
| 正常审批流 | read HANDOVER.md → approve → 验证通过 |
| 未读审批 | approve (仅 sha256) → READ-BEFORE-APPROVE 拒绝 |
| sha256 绕过 | 从 task_result 获取 sha256 → approve → READ-BEFORE-APPROVE 拒绝 |
| 降级容错 | 禁用 read-track-after.ts → approve → sha256-only 通过 (WARN 日志) |
| 并发 read | 两个审批人并发 read 同一 HANDOVER.md → verifyRead 各自通过 |

### §8.3 回归测试

确保以下现有功能不被破坏：

- [ ] DISPATCH-INTEGRITY: task_id 不变性检查
- [ ] DELIVERABLES-REVIEW-LOCK: sha256 一致性检查
- [ ] SUPER-ADMIN-HARDEN-01: HANDOVER.md 存在性检查
- [ ] SA-FIX-APPROVE-PERMISSION: 审批人权限检查
- [ ] F5 Auto-purge: 过期 session 自动清理
- [ ] 18 个现有插件正常加载 (plugins_loaded 保持 18, 新增后 19)

---

## §9 实施步骤

```
Phase 0: 代码实现
  1. 创建 .opencode/lib/read-audit.ts
  2. 创建 .opencode/plugins/read-track-after.ts
  3. 创建 .opencode/state/schemas/read-audit.schema.json
  4. 修改 .opencode/scripts/mcp-tools/compliance-gate.ts
  5. 修改 opencode.json (注册 read-track-after.ts)

Phase 1: 验证
  6. 运行 framework-self-test.ts → 确认 22+1 插件加载
  7. 手动测试: read HANDOVER.md → approve → 验证通过
  8. 手动测试: approve without read → 预期拒绝
  9. 运行现有测试套件 → 确认回归通过

Phase 2: 灰度
  10. advisory 模式运行 24h → 观察 read_audit.jsonl 增长
  11. strict 模式全量启用
```

---

## §10 附录

### §A. 关键设计决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 不新增 gate_status 枚举值 | 避免破坏 6+ 个消费者（gate-after, state-compactor, pre-commit, etc.） |
| D2 | 使用 JSONL 而非 SQLite | 简单性优先：追加一行 JSON vs 创建表+索引 |
| D3 | 5 分钟时间窗口 | 审批人读文件 → 审批操作之间的合理时间；可配置 |
| D4 | 降级容错（read-audit.ts 不可用时回退到 sha256-only） | 审批流可用性 > 约束严格性；graceful degradation |
| D5 | Plugin 层而非 compliance-gate.ts 内 | 关注点分离：追踪逻辑在插件，验证逻辑在 gate |

### §B. 与兄弟约束的关系

| 约束 | 关系 | 说明 |
|------|------|------|
| DELIVERABLES-REVIEW-LOCK | **互补** | sha256 证明文件一致性，READ-BEFORE-APPROVE 证明阅读行为 |
| DISPATCH-INTEGRITY | **无关** | 不修改 task_id 或 dispatch 流程 |
| SUPER-ADMIN-HARDEN-01 | **增强** | 审批人也必须通过 read 工具阅读 HANDOVER.md |
| Step 0d (multi-source audit) | **平行** | Step 0d 检查 HANDOVER.md 内容，READ-BEFORE-APPROVE 检查 read 工具调用 |

---

*本文档将在实施后根据实际效果更新。*
