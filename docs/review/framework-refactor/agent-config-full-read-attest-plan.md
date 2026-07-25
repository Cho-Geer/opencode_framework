# Agent Config 全量閱讀強制（config_read_attest 增強）— 實施方案

**日期**: 2026-06-27
**版本**: v1.0.0
**作者**: @Super-Admin
**狀態**: 方案制定，待實施
**影響範圍**: `config_read_attest.ts` / `scope-before.ts` / `read-track-after.ts` / `read-audit.ts` / `db-manager.ts` / `substate-types.ts` / `execution-checklist.ts`

---

## 0. 執行摘要

`config_read_attest` 現狀要求 Agent 讀取 3 個文件（`.opencode/agents/{Agent}.md` + `opencode.json` + `.opencode/project.config.json`），但只驗證「是否發生過 read 事件」，**不驗證是否全量讀完**。實務上 Agent 常只 `read` 前 50 行就聲稱 attested，跳過 YAML frontmatter 之後最關鍵的 `skills`、`mcp_tools`、`permission`、`Core Responsibilities`、`Anti-Goals` 段落，導致後續行為與配置不符。

本方案引入 **「Agent config 全量閱讀強制」**：

| 文件 | 全量閱讀要求 |
|------|--------------|
| `.opencode/agents/{Agent}.md` | ✅ **強制**：`verifyFullRead()` 驗證 bytes_read ≥ file_size |
| `opencode.json` | ❌ **豁免**：保留 `verifyRead()`（發生過即可） |
| `.opencode/project.config.json` | ❌ **豁免**：保留 `verifyRead()`（發生過即可） |

核心機制：在 `read_audit` SQLite 表新增 `bytes_read` 列（schema 遷移 v11），`read-track-after.ts` 用 `fs.statSync().size` 寫入本次讀取的字節數；`config_read_attest.ts` 加總 session 內對 agent config 的所有 reads，若累計 ≥ 文件大小則標記 `agent_config_fully_read: true`；`scope-before.ts` 在 strict/locked 模式下硬性阻斷未全量讀取的寫入。

---

## 1. 問題背景

### 1.1 現狀缺陷

**`config_read_attest.ts:39-61`**：
```ts
const MANDATORY_CONFIG_FILES = [
  "opencode.json",
  ".opencode/project.config.json",
];
// + resolveAgentConfigPath(agent, worktree) 動態解析

function resolveConfigPaths(agent, worktree) {
  return [
    resolveAgentConfigPath(agent, worktree),
    path.join(worktree, MANDATORY_CONFIG_FILES[0]),
    path.join(worktree, MANDATORY_CONFIG_FILES[1]),
  ];
}
```

**`verifyRead()` 行為**（`read-audit.ts:298-364`）：查 `read_audit` 是否有 `(agent, file_path)` 匹配事件，**不檢查讀取範圍或字節數**。

**後果**：
- Agent 對 `.opencode/agents/Coder-BE.md`（9539 bytes）只 `read` 前 2000 bytes → 仍通過 `verifyRead()`。
- Agent 跳過 `skills` / `mcp_tools` / `permission` / `Anti-Goals` / `Testing Requirements` 段落 → 後續行為違反配置。
- 當前 `MANDATORY_CONFIG_FILES` 把 `opencode.json`（框架全局）與 agent config 同等對待，但用戶要求前者豁免。

### 1.2 日誌證據（2026-06-27 工作區抽樣）

```bash
$ sqlite3 .opencode/state/framework-state.db \
  "SELECT agent, file_path, COUNT(*), created_at FROM read_audit
   WHERE file_path LIKE '%agents/%.md'
   GROUP BY agent, file_path
   ORDER BY created_at DESC LIMIT 5"
```

顯示大量 agent config reads 但**無法判斷**是否全量。需要新增 `bytes_read` 列才能回答。

---

## 2. 解決方案架構

### 2.1 多層強制模型

```
╔══════════════════════════════════════════════════════════════╗
║ Layer 1: read-track-after.ts (after-hook)                    ║
║   tool.execute.after on 'read' → recordRead({...,           ║
║     bytes_read: fs.statSync(filePath).size})                 ║
║   DB schema v11 新增 read_audit.bytes_read 列               ║
╠══════════════════════════════════════════════════════════════╣
║ Layer 2: config_read_attest.ts (MCP tool)                    ║
║   區分 FULL_READ_REQUIRED_FILES vs EXEMPT_FILES             ║
║   全量驗證：sum(bytes_read) over session ≥ file_size        ║
║   寫入 ConfigReadSessionEntry.agent_config_fully_read       ║
╠══════════════════════════════════════════════════════════════╣
║ Layer 3: scope-before.ts (write pre-gate)                    ║
║   strict/locked 下硬性阻斷 agent_config_fully_read=false    ║
║   [FW-ENFORCE][AGENT-CONFIG-FULL-READ]                      ║
╠══════════════════════════════════════════════════════════════╣
║ Layer 4: checklist-before.ts (preflight phase)               ║
║   agent_config_fully_read_attested item（新增）             ║
║   remediation 明確指出需讀完 agent config                   ║
╚══════════════════════════════════════════════════════════════╝
```

### 2.2 為什麼用 `bytes_read ≥ file_size` 而非行號範圍

| 維度 | 行號範圍追蹤 | bytes_read 累計 |
|------|--------------|------------------|
| 實現複雜度 | 高（需解析 Read 工具的 offset/limit 參數，合併重疊區間） | 低（fs.statSync().size + 累加） |
| Read 工具兼容性 | 需精確知道每次調用的 offset/limit（OpenCode runtime 不總是暴露） | 只需讀取後的 file size |
| 誤判率 | 低（精確） | 中（可能重疊讀同一區段，但 ≥ file_size 仍具高信心） |
| 性能影響 | 中（每 read 需解析 args + 維護 range list） | 低（一次 statSync） |

**決策**：先用 `bytes_read` 累計 + `sum ≥ file_size` 判定；若未來需要更精確，可升級到 range-based 而不破壞接口。

### 2.3 為什麼豁免 `opencode.json` / `project.config.json`

- `opencode.json`：全局框架配置（MCP servers、plugins、hooks），所有 agent 共用，變更頻率低，agent 只需知道引用位置。
- `project.config.json`：項目級參數（dispatch_policy、gate_stale_thresholds），同上。
- `.opencode/agents/{Agent}.md`：**Agent 自己的行為契約**，定義 skills、mcp_tools、permission、Core Responsibilities、Anti-Goals；未全量讀會直接導致行為偏差。

---

## 3. 文件變更清單

| 文件 | 操作 | 說明 | 層 |
|------|------|------|----|
| `.opencode/lib/db-manager.ts` | **修改** | schema v11 遷移：`ALTER TABLE read_audit ADD COLUMN bytes_read INTEGER NOT NULL DEFAULT 0` | 1 |
| `.opencode/lib/read-audit.ts` | **修改** | `ReadAuditEntry` 新增 `bytes_read` 字段；`recordRead` 寫入該列；新增 `sumBytesRead(agent, filePath, sessionId, sinceMs)` helper | 1 |
| `.opencode/plugins/read-track-after.ts` | **修改** | `toolExecuteAfter` 調用 `fs.statSync(filePath).size` 寫入 `bytes_read`；處理文件不存在場景 | 1 |
| `.opencode/tools/config_read_attest.ts` | **修改** | 引入 `FULL_READ_REQUIRED_FILES`（agent config）/ `EXEMPT_FILES`（opencode.json、project.config.json）；用 `sumBytesRead()` 替代 `verifyRead()` 做 agent config 驗證；修正 `@` prefix stripping bug；寫入 `agent_config_fully_read` | 2 |
| `.opencode/lib/substate-types.ts` | **修改** | `ConfigReadSessionEntry` 新增 `agent_config_fully_read?: boolean`、`bytes_read_total?: number`、`file_size_total?: number` | 2 |
| `.opencode/plugins/scope-before.ts` | **修改** | config_read_attest pre-gate（L299-354）新增 `agent_config_fully_read` 硬性檢查 | 3 |
| `.opencode/lib/execution-checklist.ts` | **修改** | `preflight` phase 新增 `agent_config_fully_read_attested` item | 4 |
| `.opencode/project.config.json` | **修改** | 新增 `agent_full_read.exempt_files[]` 與 `agent_full_read.window_hours`（可選） | — |

> 遵循 Layout Architecture Subsystem：**不新增文件**，全部就地修改。

---

## 4. 子系統合規矩陣

| 子系統 | 合規 | 說明 |
|--------|------|------|
| **Layout Architecture** | ✅ | 不新增文件；所有改動在現有 8 個文件內 |
| **DB-only / DB-canonical** | ✅ | `bytes_read` 在 SQLite `read_audit` 表；`agent_config_fully_read` 在 `config_read_state` substate（SQLite substate_kv）；無 JSON dual-write |
| **Permission Matrix** | ✅ | 不引入新權限；`verifyRead()` / `readSubState()` 沿用現有權限 |
| **Session/Concurrency Safe** | ✅ | `bytes_read` 累計按 `(agent, file_path, opencode_session_id)` 隔離；`sumBytesRead()` 查 session-bound 事件；`dbAtomicWriteSubState` 原子寫 config_read_state |
| **Hardened Enforcement** | ✅ | 三態 enforcement（advisory=warn，strict/locked=throw）；`[FW-ENFORCE][AGENT-CONFIG-FULL-READ]` 前綴；catch 守衛正確重新拋出 |
| **Framework Harness** | ✅ | read-track-after 沿用 `withPluginLifecycle`；scope-before 沿用 `tool.execute.before`；checklist-before 沿用 `PHASE_ORDER` |
| **Central State Management** | ✅ | config_read_state 通過 `readSubState()` / `dbAtomicWriteSubState()` 訪問（substate-manager.ts） |
| **Multi-Agent** | ✅ | `bytes_read` 累計按 agent + session 隔離；agent config 路徑由 `resolveAgent()` 解析；不同 agent 的驗證互不影響 |
| **Log Central Management** | ✅ | 使用 `writeLog(plugin, "runtime", {level, event, ...})`；新增事件：`AGENT-CONFIG-FULL-READ-VERIFIED`、`AGENT-CONFIG-PARTIAL-READ-BLOCK`、`AGENT-CONFIG-FULL-READ-EXEMPT` |
| **DB-canonical Management** | ✅ | 無 JSON fallback；read_audit 與 config_read_state 均為 SQLite |
| **Templatization & Parameterization** | ✅ | 豁免文件列表從 `project.config.json.agent_full_read.exempt_files[]` 讀取（默認 `["opencode.json", ".opencode/project.config.json"]`）；enforcement mode 統一 `getEnforcementMode()` |
| **TypeScript + Bun Runtime** | ✅ | 純 TypeScript；`fs.statSync` Bun 原生；`readSubState` 同步 SQLite |

---

## 5. 日誌系統整合

### 5.1 日誌事件清單

| 事件 | 級別 | 來源插件 | 觸發條件 |
|------|------|----------|----------|
| `READ_TRACKED_WITH_BYTES` | INFO | read-track-after | 每次 read 工具執行後，記錄 bytes_read |
| `READ_BYTES_STAT_FAILED` | WARN | read-track-after | `fs.statSync` 失敗（文件不存在或權限問題） |
| `AGENT-CONFIG-FULL-READ-VERIFIED` | INFO | mcp-config-read-attest | agent config 累計 bytes_read ≥ file_size |
| `AGENT-CONFIG-PARTIAL-READ` | WARN | mcp-config-read-attest | agent config 累計 bytes_read < file_size |
| `AGENT-CONFIG-FULL-READ-BLOCK` | ERROR | scope-before | strict/locked 下 agent config 未全量讀，阻斷寫入 |
| `AGENT-CONFIG-FULL-READ-ADVISORY` | WARN | scope-before | advisory 模式下跳過阻斷 |
| `AGENT-CONFIG-EXEMPT-SKIP` | INFO | mcp-config-read-attest | 豁免文件（opencode.json、project.config.json）跳過全量驗證 |

### 5.2 日誌規範

- 使用 `writeLog(plugin, "runtime", fields)` 約定（`log-manager.ts:339`）
- `level` 在 `fields.level` 中顯式聲明（避免 INFO 級別陷阱）
- `fields` 必含 `sessionID`、`callID`、`agent`、`event`、`detail`
- 輸出到 `.task_temp/_logs/{date}/plugin-{SRC}-runtime.log`
- 遵循日誌輪轉策略（100KB 輪轉，保留 3 個，3 天後 gzip，30 天後歸檔）

---

## 6. 官方 OpenCode 規範合規

### 6.1 Plugin Hook 規範

| 規範 | 合規 | 證據 |
|------|------|------|
| `tool.execute.after` 簽名 | ✅ | `@opencode-ai/plugin` index.d.ts:249-258：`(input: {tool, sessionID, callID, args}, output: {title, output, metadata})` |
| args 讀取位置（after） | ✅ 用 `input.args` | 官方 spec：after-hook 的 args 在 input；read-track-after.ts:37 `input?.args` 先例 |
| `withPluginLifecycle` 模式 | ✅ | read-track-after.ts:72 已使用 |
| `[FW-ENFORCE]` 拋出守衛 | ✅ | scope-before.ts 同模式 |

### 6.2 MCP Tool 規範

| 規範 | 合規 | 說明 |
|------|------|------|
| Tool schema | ✅ | `{name, description, parameters}` 標準結構 |
| Handler 簽名 | ✅ | `async function handler(args, ctx)` 返回結構化結果 |
| 錯誤返回 | ✅ | `{status: "rejected", reason: ...}` 而非拋異常 |

---

## 7. 詳細實施

### 7.1 Layer 1：read_audit 表 + read-track-after 改造

**7.1.1 Schema 遷移**: `db-manager.ts` 的 `migrate()` 函數（在 v10 遷移之後）新增：

```ts
// db-manager.ts migrate() 新增 v11
const currentVersion = db.query(`PRAGMA user_version`).get().user_version;
if (currentVersion < 11) {
  try {
    db.run(`ALTER TABLE read_audit ADD COLUMN bytes_read INTEGER NOT NULL DEFAULT 0`);
    writeLog("lib-db-manager", "INFO", {
      event: "SCHEMA-MIGRATE-V11",
      detail: "Added bytes_read column to read_audit for agent config full-read tracking",
    });
  } catch (e: any) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
  db.run(`PRAGMA user_version = 11`);
}
```

**7.1.2 `ReadAuditEntry` 類型擴充**: `read-audit.ts`:

```ts
export interface ReadAuditEntry {
  // ... 既有欄位 ...
  /** Number of bytes read in this call (fs.statSync.size at event time) */
  bytes_read?: number;
}
```

**7.1.3 `recordRead` 寫入 bytes_read**: `read-audit.ts:200-229` 修改 INSERT 與 bindings：

```ts
export function recordRead(entry: ReadAuditEntry): void {
  try {
    const db = getDb();
    db.transaction(() => {
      db.run(
        `INSERT OR IGNORE INTO read_audit
         (event_key, timestamp, agent, file_path, opencode_session_id,
          task_id, call_id, raw_agent, raw_file_path, created_at, bytes_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...toDbBindings(entry), entry.bytes_read || 0],
      );
      // Capacity control（保留）
      db.run(
        `DELETE FROM read_audit WHERE id NOT IN
         (SELECT id FROM read_audit ORDER BY id DESC LIMIT ?)`,
        [MAX_RECORDS],
      );
    })();
    writeLog("lib-read-audit", "INFO", {
      event: "READ_RECORDED",
      agent: entry.agent,
      filePath: entry.filePath,
      bytesRead: entry.bytes_read,
      db: true,
    });
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "READ_AUDIT_DB_WRITE_FAILED",
      detail: err.message,
    });
  }
}
```

**7.1.4 新增 `sumBytesRead` helper**: `read-audit.ts` 新增：

```ts
/**
 * Sum all bytes_read values for (agent, filePath, sessionId) since `sinceMs`.
 * Used by config_read_attest to verify full-read of agent config files.
 * Agent is normalized (lowercase, @ stripped); path is normalized (absolute).
 */
export function sumBytesRead(
  agent: string,
  filePath: string,
  sessionId: string | undefined,
  sinceMs: number,
): number {
  const db = getDb();
  const normAgent = normalizeAgent(agent);
  const normPath = normalizeReadAuditPath(filePath);
  const sinceIso = new Date(sinceMs).toISOString();

  let row: any;
  if (sessionId) {
    row = db.query(`
      SELECT COALESCE(SUM(bytes_read), 0) AS total
      FROM read_audit
      WHERE agent = ? AND file_path = ? AND opencode_session_id = ?
        AND timestamp >= ?
    `).get(normAgent, normPath, sessionId, sinceIso);
  } else {
    row = db.query(`
      SELECT COALESCE(SUM(bytes_read), 0) AS total
      FROM read_audit
      WHERE agent = ? AND file_path = ? AND timestamp >= ?
    `).get(normAgent, normPath, sinceIso);
  }
  return row?.total || 0;
}
```

**7.1.5 `read-track-after.ts` 改造**：

```ts
import * as fs from "node:fs";

async function toolExecuteAfter(input: any, _output: any) {
  try {
    const tool = input?.tool || "";
    if (tool !== "read" && tool !== "Read") return;

    const args = input?.args || {};
    const filePath = args.filePath || args.file_path || "";
    if (!filePath) return;

    const sessionId = input?.sessionID || input?.sessionId || undefined;
    const agent = resolveAgent(sessionId);
    const taskId = resolveTaskId(sessionId || "");
    const callId = input?.callID || input?.callId || undefined;

    // Compute bytes_read from file size at read time
    let bytesRead = 0;
    try {
      const stat = fs.statSync(filePath);
      bytesRead = stat.size;
    } catch (e: any) {
      writeLog(PLUGIN_ID, "WARN", {
        event: "READ_BYTES_STAT_FAILED",
        filePath,
        detail: e.message?.substring(0, 200),
      });
    }

    recordRead({
      timestamp: new Date().toISOString(),
      agent,
      filePath,
      sessionId,
      taskId,
      callId,
      bytes_read: bytesRead,
    });

    writeLog(PLUGIN_ID, "runtime", {
      level: "INFO",
      event: "READ_TRACKED_WITH_BYTES",
      agent,
      filePath,
      sessionId: sessionId || "—",
      bytesRead,
    });
  } catch (err: any) {
    writeLog(PLUGIN_ID, "ERROR", {
      level: "ERROR",
      event: "READ_TRACK_FAILED",
      error: err.message,
    });
  }
}
```

### 7.2 Layer 2：`config_read_attest.ts` 改造

**7.2.1 分類常量**：

```ts
// Files that MUST be fully read (bytes_read ≥ file_size)
// Agent config is added dynamically by resolveAgentConfigPath()
const FULL_READ_REQUIRED_PATTERNS: RegExp[] = [
  /\.opencode\/agents\/[^/]+\.md$/,  // 所有 agent config
];

// Files that only need verifyRead() (occurrence check)
const EXEMPT_FILES = [
  "opencode.json",
  ".opencode/project.config.json",
];

function isFullReadRequired(filePath: string, exemptOverride: string[]): boolean {
  if (exemptOverride.some((p) => filePath.endsWith(p))) return false;
  return FULL_READ_REQUIRED_PATTERNS.some((re) => re.test(filePath));
}
```

> `project.config.json.agent_full_read.exempt_files[]` 可動態擴展 EXEMPT_FILES（Templatization & Parameterization）。

**7.2.2 Agent identity → path mapping 修正**（修正 v1 方案发现的 `@` prefix bug）：

```ts
import { toDisplayName } from "../lib/agent-identity";

function resolveAgentConfigPath(agent: string, worktree: string): string {
  // Strip @ prefix + normalize to PascalCase file name
  const normalized = agent.replace(/^@/, "");
  const display = toDisplayName(normalized);  // "coder-be" → "Coder-BE"
  return path.join(worktree, ".opencode", "agents", `${display}.md`);
}
```

**7.2.3 Handler 改造**（核心邏輯）：

```ts
export async function handler(args: any, ctx: any) {
  const agent = ctx.agent || process.env.FRAMEWORK_AGENT || "";
  const sessionID = ctx.sessionID || args.session_id || "";
  const worktree = process.env.OPENCODE_ROOT || process.cwd();

  if (!agent) {
    return { status: "rejected", reason: "Agent identity unresolved" };
  }

  // Read exempt list from project config (Templatization)
  const exemptOverride = readExemptList(worktree);

  const agentConfigPath = resolveAgentConfigPath(agent, worktree);
  const allRequired = [
    agentConfigPath,
    path.join(worktree, "opencode.json"),
    path.join(worktree, ".opencode", "project.config.json"),
  ];

  // Default verify window: 5 minutes (matching verifyRead default)
  const sinceMs = Date.now() - 5 * 60 * 1000;
  const results: Array<{file: string; verified: boolean; fullRead?: boolean;
                        bytesRead?: number; fileSize?: number}> = [];

  for (const file of allRequired) {
    const basic = verifyRead(agent, file, sessionID);
    if (!basic.verified) {
      results.push({ file, verified: false });
      continue;
    }

    if (isFullReadRequired(file, exemptOverride)) {
      // Full-read verification
      let fileSize = 0;
      try { fileSize = fs.statSync(file).size; } catch {}
      const bytesRead = sumBytesRead(agent, file, sessionID, sinceMs);
      const fullRead = fileSize > 0 && bytesRead >= fileSize;

      results.push({ file, verified: true, fullRead, bytesRead, fileSize });

      writeLog("mcp-config-read-attest", "runtime", {
        level: fullRead ? "INFO" : "WARN",
        sessionID, agent,
        event: fullRead ? "AGENT-CONFIG-FULL-READ-VERIFIED" : "AGENT-CONFIG-PARTIAL-READ",
        detail: `file=${file} | bytesRead=${bytesRead}/${fileSize} | fullRead=${fullRead}`,
      });
    } else {
      // Exempt file: occurrence-only
      results.push({ file, verified: true, fullRead: undefined });
      writeLog("mcp-config-read-attest", "runtime", {
        level: "INFO",
        sessionID, agent,
        event: "AGENT-CONFIG-EXEMPT-SKIP",
        detail: `file=${file} exempt from full-read requirement`,
      });
    }
  }

  const allVerified = results.every((r) => r.verified);
  const allFullRead = results
    .filter((r) => r.fullRead !== undefined)
    .every((r) => r.fullRead);

  if (!allVerified || !allFullRead) {
    const unread = results.filter((r) => !r.verified).map((r) => r.file);
    const partial = results.filter((r) => r.fullRead === false).map((r) =>
      `${r.file} (read ${r.bytesRead}/${r.fileSize} bytes)`);
    return {
      status: "rejected",
      reason:
        `Config read attestation failed.\n` +
        (unread.length ? `Unread files:\n  - ${unread.join("\n  - ")}\n` : "") +
        (partial.length ? `Partially read files (must read full content):\n  - ${partial.join("\n  - ")}\n` : "") +
        `\nRemediation:\n` +
        `1. Use the 'read' tool on each file listed above.\n` +
        `2. Agent config files MUST be read in full — do not use offset/limit.\n` +
        `3. opencode.json and project.config.json only need to be read once.\n` +
        `4. Re-call config_read_attest(task_id) after reading.`,
    };
  }

  // All pass: persist to config_read_state
  const agentConfigResult = results.find((r) => r.file === agentConfigPath);
  const ok = dbAtomicWriteSubState("config_read_state", (state: any) => {
    state.sessions = state.sessions || {};
    state.sessions[sessionID] = {
      session_id: sessionID,
      agent,
      attested_at: new Date().toISOString(),
      files: results.map((r) => r.file),
      verified: true,
      agent_config_fully_read: true,
      bytes_read_total: agentConfigResult?.bytesRead || 0,
      file_size_total: agentConfigResult?.fileSize || 0,
    };
  });

  if (!ok) {
    return {
      status: "rejected",
      reason: "Failed to persist config_read_state to SQLite",
    };
  }

  // Wire checklist
  checklistWirePassed(
    sessionID, agent, args.task_id || null,
    "config_read_attested",
    JSON.stringify(results),
  );
  checklistWirePassed(
    sessionID, agent, args.task_id || null,
    "agent_config_fully_read_attested",
    `bytes=${agentConfigResult?.bytesRead}/${agentConfigResult?.fileSize}`,
  );

  return {
    status: "attested",
    agent,
    session_id: sessionID,
    files: results,
    agent_config_fully_read: true,
  };
}

function readExemptList(worktree: string): string[] {
  try {
    const cfgPath = path.join(worktree, ".opencode", "project.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return cfg?.agent_full_read?.exempt_files || [];
  } catch {
    return [];
  }
}
```

### 7.3 Layer 3：`scope-before.ts` 硬性檢查

在現有 config_read_attest pre-gate（L299-354）內插入 `agent_config_fully_read` 檢查：

```ts
// scope-before.ts 修改：config_read_attest pre-gate 增強
const configReadState = readSubState("config_read_state");
const sessions = configReadState?.sessions || {};
const myAttestation = sessions[input.sessionID];

if (myAttestation && myAttestation.session_id === input.sessionID) {
  // Session-specific attestation found — check full-read flag
  if (myAttestation.agent_config_fully_read !== true) {
    // Attestation exists but agent config was NOT fully read
    const msg =
      `[FW-ENFORCE][AGENT-CONFIG-FULL-READ] Agent config was NOT fully read. ` +
      `bytes_read=${myAttestation.bytes_read_total || 0}/` +
      `${myAttestation.file_size_total || "?"}. ` +
      `Re-read the FULL agent config file (.opencode/agents/{Agent}.md) ` +
      `without offset/limit, then re-call config_read_attest(task_id).`;

    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      level: "ERROR",
      event: "AGENT-CONFIG-FULL-READ-BLOCK",
      detail: `BLOCKED | bytes=${myAttestation.bytes_read_total || 0}/${myAttestation.file_size_total || "?"}`,
    });

    if (mode === "strict" || mode === "locked") throw new Error(msg);

    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      level: "WARN",
      event: "AGENT-CONFIG-FULL-READ-ADVISORY",
      detail: `advisory mode — partial read allowed`,
    });
  } else {
    // Full attestation + full read — pass
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      event: "CONFIG-READ-ATTEST-VERIFIED",
      detail: `config_read_state verified + agent config fully read`,
    });
  }
} else {
  // 原有邏輯（無 attestation）保持不變
  /* ... 原 L323-354 ... */
}
```

### 7.4 Layer 4：`execution-checklist.ts` 新增 checklist item

```ts
// execution-checklist.ts preflight 階段新增（放在 config_read_attested 之後）
{
  key: "agent_config_fully_read_attested",
  verifier: "config_read_attest (full-read mode)",
  remediation:
    "Your agent config file (.opencode/agents/<Agent>.md) was not fully read. " +
    "Use the 'read' tool WITHOUT offset/limit on the entire file, then " +
    "re-call config_read_attest(task_id). opencode.json and project.config.json " +
    "only need a single read (no full-read requirement).",
},
```

### 7.5 `substate-types.ts` 擴展

```ts
// ConfigReadSessionEntry 新增字段
export interface ConfigReadSessionEntry {
  session_id: string;
  agent?: string;
  attested_at: string;
  files: string[];
  verified: boolean;
  unread_files?: string[];
  /** Whether the agent config file was fully read (bytes_read ≥ file_size) */
  agent_config_fully_read?: boolean;
  /** Total bytes_read across all read events for agent config */
  bytes_read_total?: number;
  /** Total file size of agent config at attestation time */
  file_size_total?: number;
  [key: string]: any;
}
```

### 7.6 `project.config.json` 擴展

```json
{
  "agent_full_read": {
    "exempt_files": [
      "opencode.json",
      ".opencode/project.config.json"
    ],
    "window_hours": 4
  }
}
```

- `exempt_files[]`：豁免全量驗證的文件（默認 opencode.json、project.config.json）
- `window_hours`：bytes_read 累計的時間窗口（默認 4 小時；匹配 gate_stale_thresholds）

---

## 8. 實施順序

1. **Step 1**: 修改 `db-manager.ts` — 新增 v11 遷移（`bytes_read` 列）
2. **Step 2**: 修改 `read-audit.ts` — `ReadAuditEntry` 新增 `bytes_read`；`recordRead` 寫入；新增 `sumBytesRead` helper
3. **Step 3**: 修改 `substate-types.ts` — `ConfigReadSessionEntry` 新增 3 個可選字段
4. **Step 4**: 修改 `read-track-after.ts` — 調用 `fs.statSync().size` 寫入 `bytes_read`
5. **Step 5**: 修改 `config_read_attest.ts` — 分類常量、`@` prefix fix、`sumBytesRead` 驗證、`agent_config_fully_read` 持久化
6. **Step 6**: 修改 `scope-before.ts` — `agent_config_fully_read` 硬性檢查
7. **Step 7**: 修改 `execution-checklist.ts` — 新增 `agent_config_fully_read_attested` item
8. **Step 8**: 修改 `project.config.json` — 新增 `agent_full_read` 配置塊
9. **Step 9**: 驗證 Layer 1 — read 工具執行後，`read_audit.bytes_read` 有值
10. **Step 10**: 驗證 Layer 2 — 故意只讀 agent config 一半 → `config_read_attest` 返回 rejected
11. **Step 11**: 驗證 Layer 3 — attested 但 `agent_config_fully_read=false` → strict/locked 阻斷寫入
12. **Step 12**: 驗證豁免 — opencode.json 只 `read` 一次 → attestation 通過
13. **Step 13**: 回歸驗證 — 現有 `config_read_attested` 流程不受影響

---

## 9. 風險與緩解

| 風險 | 緩解 |
|------|------|
| `bytes_read` 累計可能因重疊 read 而虛高 | 採用 `≥` 而非 `==`；若未來需要精確，可升級到 range-based 而不破壞接口 |
| `fs.statSync` 在 read 時文件尚未落盤（race） | 用 try/catch + `READ_BYTES_STAT_FAILED` WARN 日誌；`bytes_read` 寫 0 不影響後續 |
| Agent config 文件更新後舊 bytes_read 累計過期 | `sumBytesRead()` 按 `sinceMs` 時間窗口（默认 4 小时）过滤；per-round reset 機制也清理舊 attestation |
| `@` prefix 修正影響現有 attestation | `toDisplayName()` 統一產出 PascalCase；`normalizeAgent()` 統一查詢；向後兼容 |
| advisory 模式下部分 Agent 仍跳過 agent config | `AGENT-CONFIG-FULL-READ-ADVISORY` WARN 日誌持久化，便於審計 |
| 新增 checklist item 影響既有 DAG-exempt bypass | `agent_config_fully_read_attested` 加入 `CORE_PASSTHROUGH_TOOLS` 豁免列表；DAG-exempt agent 可調用 `config_read_attest` 本身 |
| SQLite schema 遷移在已存在表上失敗 | `try/catch` + `duplicate column` 檢測；冪等遷移 |

---

## 10. 驗證清單

### 10.1 全量讀場景

- [ ] Agent `read` 完整 `.opencode/agents/Coder-BE.md`（9539 bytes）→ `sumBytesRead() ≥ 9539` → `config_read_attest` 返回 `attested`
- [ ] `config_read_state.sessions[sid].agent_config_fully_read === true`
- [ ] `scope-before` 允許後續寫入
- [ ] 日誌：`AGENT-CONFIG-FULL-READ-VERIFIED` (INFO)

### 10.2 部分讀場景

- [ ] Agent 只 `read` `.opencode/agents/Coder-BE.md` 前 2000 bytes → `sumBytesRead() < 9539`
- [ ] `config_read_attest` 返回 `rejected` + `partial` 列表 + remediation
- [ ] 日誌：`AGENT-CONFIG-PARTIAL-READ` (WARN)
- [ ] strict/locked 模式下 `scope-before` 阻斷寫入：`AGENT-CONFIG-FULL-READ-BLOCK` (ERROR)

### 10.3 豁免文件場景

- [ ] Agent 只 `read` `opencode.json` 一次（1000 bytes，文件大小 15000）→ attestation 仍通過
- [ ] 日誌：`AGENT-CONFIG-EXEMPT-SKIP` (INFO)

### 10.4 多次 read 累計

- [ ] Agent 調用 `read` 3 次（每次 3500 bytes）→ `sumBytesRead() = 10500 ≥ 9539` → attestation 通過
- [ ] 日誌：3 次 `READ_TRACKED_WITH_BYTES` (INFO)

### 10.5 回歸驗證

- [ ] 現有 `config_read_attested` checklist item 仍正常通過
- [ ] `read-track-after` 對非 agent config 文件仍記錄 `bytes_read`（不影響）
- [ ] 不同 agent 的 `bytes_read` 累計互不影響（session+agent 隔離）
- [ ] schema 遷移在 fresh DB 與已存在 DB 上都成功

### 10.6 驗收命令

```bash
bun --check .opencode/lib/db-manager.ts
bun --check .opencode/lib/read-audit.ts
bun --check .opencode/lib/substate-types.ts
bun --check .opencode/plugins/read-track-after.ts
bun --check .opencode/tools/config_read_attest.ts
bun --check .opencode/plugins/scope-before.ts
bun --check .opencode/lib/execution-checklist.ts
FRAMEWORK_DB_PATH=/tmp/cra-e2e.db bun .opencode/scripts/framework-self-test.ts
```

---

## 11. 與既有文檔一致性

| 文檔 | 一致性 |
|------|--------|
| `read-before-approve-plan.md` | ✅ 不衝突；本方案擴展 `read_audit` 而非修改 `verifyRead()` 既有行為 |
| `read-audit-db-migration-plan.md` | ✅ 本方案新增 v11 遷移，沿用 v10 遷移模式 |
| `read-audit-db-migration-audit-report.md` | ✅ 不衝突 |
| `config-attest-pipeline.md` | ✅ 本方案增強 `config_read_attest`，與 pipeline 設計一致 |
| `config-attest-race-fix-plan.md` | ✅ 本方案使用 `dbAtomicWriteSubState` 原子寫，避免競態 |
| `step-0d-log-audit-mandate.md` §0.5 | ✅ 本方案的 Layer B（required readings）可與 agent config full-read 協同 |

---

## 12. 參考

- `.opencode/lib/db-manager.ts`（L654-671 read_audit schema, L1807 file_size 列先例）
- `.opencode/lib/read-audit.ts`（L189-229 recordRead, L298-364 verifyRead, 新增 sumBytesRead）
- `.opencode/lib/substate-types.ts`（L212-237 ConfigReadState/ConfigReadSessionEntry）
- `.opencode/plugins/read-track-after.ts`（L29-70 toolExecuteAfter）
- `.opencode/tools/config_read_attest.ts`（L39-61 MANDATORY_CONFIG_FILES, L48-61 resolve functions）
- `.opencode/plugins/scope-before.ts`（L299-354 CONFIG-READ-ATTEST pre-gate）
- `.opencode/lib/execution-checklist.ts`（L192-198 config_read_attested item）
- `.opencode/lib/agent-identity.ts`（L31-63 AGENTS / DISPLAY_NAMES maps, toDisplayName）
- `.opencode/lib/agent-resolver.ts`（L99-156 resolveAgent）
- `.opencode/project.config.json`（gate_stale_thresholds 配置模式）
- `@opencode-ai/plugin` SDK `index.d.ts`（L249-258 after-hook 簽名）

---

_本文件為 Agent config 全量閱讀強制（config_read_attest 增強）的完整實施方案。待 `/compliance-gate` 武裝後由 @Meta-Planner 產生 DAG、@Super-Admin 主導 Layer 1-4 改造、@Orchestrator 驗證上線。_
