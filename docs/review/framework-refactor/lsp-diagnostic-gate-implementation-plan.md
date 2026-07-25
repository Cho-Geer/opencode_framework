# TypeScript 診斷閘門實施方案

**制定時間**: 2026-06-26
**最後審核**: 2026-06-26（v2.2 — 官方文檔網絡搜索驗證 + SDK v1.15.11 源碼二進制驗證 + 修正「v2 已移除」事實錯誤）
**制定者**: @Super-Admin
**狀態**: 計劃（待實施）

---

## 0. 審核記錄

### 0.1 v2.0 重大修正（2026-06-26 SDK 類型 + 運行時驗證）

v1.x 方案基於 `lsp.client.diagnostics` hook 事件。經 SDK 類型分析和運行時驗證，該事件 **不可用於獲取診斷數據**：

| 驗證項 | 結果 | 證據 |
|--------|------|------|
| SDK v1 類型 `EventLspClientDiagnostics` | **存在但 payload 無診斷數據** | `@opencode-ai/sdk` dist/gen/types.gen.d.ts:19-25，payload 僅 `{serverID: string, path: string}` |
| SDK v2 是否保留 `EventLspClientDiagnostics` | **保留，但 payload 同樣無診斷數據** | `@opencode-ai/sdk` v1.15.11 dist/v2/gen/types.gen.d.ts:2052-2058 仍含此事件（`properties: {serverID, path}`），且在 Event 聯合類型中（line 4）。v1 與 v2 payload 一致，均無診斷內容 |
| Plugin SDK 導入的 SDK 版本 | **v2** | `@opencode-ai/plugin` v1.15.11 dist/tui.d.ts:1 `import ... from "@opencode-ai/sdk/v2"` |
| `lsp.client.diagnostics` 是否為直接插件 hook | **否** | `@opencode-ai/plugin` dist/index.d.ts:173-317 `Hooks` 接口無此 key；僅能通過泛型 `event?: (input: {event: Event}) => Promise<void>` hook 間接接收（index.d.ts:175-177） |
| `lsp.updated` payload | **opaque** | `{[key: string]: unknown}`，不含結構化診斷 |
| `client.lsp.diagnostics()` 方法 | **不存在** | SDK `Lsp` 類別僅有 `status()` 方法（返回 `{id, name, root, status}`） |
| `client.tool.execute()` 方法 | **不存在** | 無法從插件內調用 `lsp` 內建工具 |
| `withPluginLifecycle` 是否傳遞 `client` | **不傳遞** | `_ctx` 被忽略（hook-lifecycle.ts:17）；即使 `event` hook 可註冊，也無法調用 `client` API |
| `write-audit-lib.ts` 的 `executeWriteAuditCheck` | **死代碼**（無調用者） | 全工作區 grep 零結果 |
| `type_check_state` 運行時寫入者 | **僅 reset 腳本** | `write-audit-lib.ts` 從未被調用 |

**結論**：即使 `lsp.client.diagnostics` 事件在運行時觸發，其 payload 僅包含 `{serverID, path}`，**不含任何診斷數據**（無錯誤碼、行號、消息）。且 SDK 無 API 可查詢實際診斷內容，`withPluginLifecycle` 丟棄 `client` 上下文。LSP 推送式診斷不可用。方案改為 **`tool.execute.after` 觸發 `tsc --noEmit --incremental`**（拉取式），類似 `format-after.ts` 運行 prettier 的模式。

### 0.2 v2.1 代碼規範修正（2026-06-26 SDK + 框架模式驗證）

v2.0 的插件代碼存在導入路徑和架構模式錯誤，經框架代碼驗證修正：

| # | 問題 | 正確值 | 證據 |
|---|------|--------|------|
| 1 | `getEnforcementMode` 導入路徑 | `from "../lib/gate-core"` | `gate-core.ts:333` 導出；`enforcement-mode.ts` 不存在 |
| 2 | `atomicWriteSubState` 導入路徑 | `from "../lib/state-utils"` | `state-utils.ts:287` 導出；`substate-manager.ts` 僅導出 `readSubState`/`writeSubState` |
| 3 | 插件不應直接使用 `execSync` | 改用 `require()` 庫函數模式 | `format-after.ts:17` 通過 `require("../scripts/mcp-tools/code-quality-lib")` 調用 `runPrettierCheck`，不直接使用 `execSync` |
| 4 | `resolveAgent` 導入但未使用 | 移除或用於日誌 | `agent-resolver.ts:99` 導出，但 v2.0 代碼未調用 |
| 5 | 日誌 category 大小寫 | `LogCategory = "loaded"\|"hooks"\|"runtime"\|LogLevel`，LogLevel 為大寫 | `log-manager.ts:29,39`；v2.0 使用 `"runtime"` 和 `"ERROR"` 正確 |

### 0.3 v1.x 其他修正（保留）

| # | 問題 | 修正 |
|---|------|------|
| 1 | `diagnostic_state` 子狀態未註冊 | §3.5 兩文件註冊 |
| 2 | Layer 1 未過濾 `isModifyTool()` | §3.2 修正 |
| 3 | 未考慮 enforcement mode | §3.6 |
| 4 | 缺少 `writeLog()` 整合 | §6 |
| 5 | `submitDeliverables` 直接修改 session | §3.3 用 `saveGateStore()` |
| 6 | 文件變更清單不完整 | §3.1 補全 |

### 0.4 v2.0 新增：code_quality_check 清理 + type_check_state 遷移

| 清理項 | 動作 | 理由 |
|--------|------|------|
| `run_tsc_check` MCP 工具 | **移除** | tsc 檢查由新插件自動執行 |
| `runTscCheck()` 函數 | **重構為 `runTscDiagnostic()`** | 內部庫函數，被新插件 `require()` 調用（同 `runPrettierCheck` 模式） |
| `runFullScan` 中的 tsc 部分 | **移除** | 保留 depcruise + prettier |
| `run_depcruise_check` | **保留** | LSP 不做架構邊界檢查 |
| `type_check_state` 子狀態 | **遷移至 `diagnostic_state`** | 合併為單一診斷狀態源 |

### 0.5 v2.2 網絡搜索驗證（2026-06-26 官方文檔 + SDK 源碼二進制驗證）

對照官方 OpenCode 文檔（opencode.ai/docs/zh-cn/lsp/、/plugins/、/sdk/）與已安裝 SDK 源碼（`@opencode-ai/sdk` + `@opencode-ai/plugin` **v1.15.11**），修正 v2.0/v2.1 中殘留的「SDK v2 已移除 `EventLspClientDiagnostics`」事實錯誤：

| 驗證項 | 結果 | 證據 |
|--------|------|------|
| `EventLspClientDiagnostics` 在 SDK v2 | **保留**（非移除） | `@opencode-ai/sdk` v1.15.11 dist/v2/gen/types.gen.d.ts:2052-2058 定義此類型；L4 Event 聯合類型包含它；payload `properties: {serverID: string, path: string}` 與 v1 一致 |
| `Lsp` client 類方法 | **僅 `status()`** | v1 sdk.gen.d.ts:306 `class Lsp { status() }`；v2 sdk.gen.d.ts:531 `class Lsp extends HeyApiClient { status() }`；無 `diagnostics()` 方法 |
| `LspStatus` 返回結構 | **連接狀態，無診斷** | v2 types.gen.d.ts:1267-1272 `{id, name, root, status: "connected"|"error"}` |
| Plugin `Hooks` 接口 | **無 `lsp.client.diagnostics` 直接 hook** | `@opencode-ai/plugin` v1.15.11 dist/index.d.ts:173-317；僅泛型 `event?: (input:{event: Event}) => Promise<void>`（L175-177）可接收 |
| GitHub issue #4410 | **確認插件缺乏 LSP 診斷訪問** | sst/opencode#4410 請求導出 LSP 功能到 `@opencode-ai/plugin`；維護者確認請求有效，PR #14228 解決；但 v1.15.11 的 `Lsp` 類仍僅有 `status()` |

**修正結論**：LSP 推送式診斷不可用的真正原因有三（均與「v2 移除」無關）：
1. `lsp.client.diagnostics` 事件 payload 僅 `{serverID, path}`，**不含診斷數據**（v1/v2 一致）
2. 該事件**非直接插件 hook**，僅能通過泛型 `event` hook 間接接收
3. `Lsp` client 類**僅有 `status()` 方法**，無 API 查詢實際診斷內容；且 `withPluginLifecycle` 丟棄 `client` 上下文

方案核心（`tool.execute.after` 觸發 `tsc --noEmit`）不受影響，維持不變。

---

## 1. 背景與問題

### 1.1 發現的框架代碼類型錯誤

`.opencode/` 框架代碼中存在 **6+ 處未檢測的 TypeScript 錯誤**：

| 位置                                  | 錯誤                            | TS 錯誤碼 |
| :------------------------------------ | :------------------------------ | :-------- |
| `route-validator.ts:594-597`          | `agent` 未定義                  | TS2304    |
| `gate-core.ts:1417`                   | `getDb()` 未引入                | TS2304    |
| `gate-core.ts:715,742,1824,1932,1942` | `gate_session_id` 不存在於類型  | TS2551    |
| `route-validator.ts:560,578`          | `candidates` 不存在於 LogFields | TS2353    |
| `gate-checks.ts:199`                  | `unknown` 不可展開              | TS2698    |

### 1.2 為什麼這些錯誤未被發現

| 防線               | 失效原因                                       | 證據                                            |
| :----------------- | :--------------------------------------------- | :---------------------------------------------- |
| **Bun 執行**       | Bun transpiler 只剝型別，不檢查                | `tsconfig.json` `"strict": false`               |
| **Write-time tsc** | `code-quality-lib.ts:470-477` 跳過非 business  | `isBackend`/`isFrontend` guard                  |
| **Full scan tsc**  | `runFullScan` cwd 是子目錄，不含 `.opencode/`  | `code-quality-lib.ts:483`                       |
| **type_check_state** | `write-audit-lib.ts:117-126` 是死代碼（從未被調用）| 全工作區 grep 零 import                         |
| **LSP 事件**       | `lsp.client.diagnostics` payload 僅 `{serverID, path}`，無診斷數據；SDK 無 API 查詢診斷      | SDK types.gen.d.ts:19-25；`Lsp` 類別僅有 `status()`      |

### 1.3 現有 code_quality_check MCP 工具的局限

| 工具 | 問題 |
|------|------|
| `run_tsc_check` | 手動調用（Agent 經常跳過）；跳過框架文件；不持久化結果 |
| `run_full_scan` | 手動調用；tsc 部分重複；不持久化到任何子狀態 |
| `run_depcruise_check` | 手動調用，但 LSP/tsc 不做架構邊界檢查，有獨立價值 |

---

## 2. 解決方案：三層 tsc 診斷閘門

### 2.1 核心思想

在 `tool.execute.after` hook 中，文件寫入後自動運行 `tsc --noEmit --incremental`（使用根 `tsconfig.json`，覆蓋 `.opencode/` + business code），將結果持久化到 `diagnostic_state` 子狀態，並在後續操作中通過三層閘門強制檢查。

**與舊方案（LSP）的對比**：

| 維度 | 舊方案（LSP hook） | 新方案（post-write tsc） |
|------|--------------------|-----------------------|
| 可執行性 | ❌ payload 僅 `{serverID, path}`，無診斷數據 | ✅ `tsc --noEmit` 可靠執行 |
| 觸發方式 | payload 僅 `{serverID, path}` 無診斷數據；非直接插件 hook（僅泛型 `event` hook 可接收） | `tool.execute.after` 同步觸發 |
| 框架覆蓋 | ✅ 根 tsconfig | ✅ 根 tsconfig |
| 重量 | 輕量（理論上） | 中量（增量 tsc，通常 <5s） |
| 持久化 | 無 | ✅ `diagnostic_state` |
| 阻斷 | before hook | before hook（相同） |

### 2.2 架構總覽

```
層1: Write-time Blocking (tool.execute.before)
  Agent Write 前 → 僅對 isModifyTool 生效
    → 讀取 diagnostic_state.files[targetFile].errors
    → 有錯誤？ → strict/locked: throw 阻斷 ❌  advisory: log warning ⚠️
    → 無錯誤？ → 放行 ✅

層1.5: Post-write tsc Check (tool.execute.after)
  Agent Write 成功 → 僅對 isModifyTool + .ts/.tsx 文件
    → 運行 tsc --noEmit --incremental（根 tsconfig，30s 超時）
    → 解析輸出 → atomicWriteSubState("diagnostic_state") 寫入
    → 有錯誤 → 記錄到 diagnostic_state.files[file].errors
    → 無錯誤 → 清除 diagnostic_state.files[file]

層2: Gate-time Validation (submitDeliverables)
  Agent 調用 submit_deliverables
    → 讀取 write_audit_state.current_session.files_written
    → 交叉檢查 diagnostic_state 中對應文件的 errors
    → 全部 clean？ → delivered ✅
    → 有錯誤？ → recoverable ❌

層3: Gate Complete 兜底 (compliance_gate_complete)
  compliance_gate_complete
    → 讀取 diagnostic_state（全量）
    → 有 errors？ → failed
    → 無錯誤 → success
```

### 2.3 tsc 調用策略

```bash
# 在項目根目錄運行，使用根 tsconfig.json（覆蓋 .opencode/ + business code）
npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile .opencode/state/.tsbuildinfo
```

- `--noEmit`: 只檢查，不產出
- `--incremental`: 使用 `.tsbuildinfo` 快取，增量檢查（通常 <5s）
- `--pretty false`: 機器可讀輸出
- `--tsBuildInfoFile`: 指定快取路徑（避免污染源碼目錄）
- 30s 超時（同 `runTscCheck` 現有邏輯）
- cwd: 項目根目錄（`OPENCODE_ROOT` 或 `process.cwd()`）

---

## 3. 實施方案

### 3.1 文件變更清單

| 文件 | 操作 | 說明 |
|------|------|------|
| `.opencode/lib/substate-types.ts` | **修改** | 新增 `DiagnosticState` 接口 + `SubStateMap` 條目；移除 `TypeCheckState` + `type_check_state` 條目 |
| `.opencode/lib/substate-manager.ts` | **修改** | `SUBSTATE_FILES` 新增 `diagnostic_state`，移除 `type_check_state` |
| `.opencode/plugins/tsc-diag-track.ts` | **新建** | Post-write tsc 檢查 + before-hook 阻斷插件（通過 `require()` 調用庫函數，同 `format-after.ts` 模式） |
| `opencode.json` | **修改** | `plugin` 陣列註冊新插件（`format-after.ts` 之後） |
| `.opencode/lib/gate-core.ts` | **修改** | `submitDeliverables` 增加診斷檢查；`checkMachineCleanliness` 讀 `diagnostic_state` |
| `.opencode/lib/gate-checks.ts` | **修改** | `checkMachineCleanliness` 讀 `diagnostic_state`（替代 `type_check_state`） |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | **修改** | `compliance_gate_complete` 增加診斷檢查 |
| `.opencode/scripts/mcp-tools/code-quality-check.ts` | **修改** | 移除 `run_tsc_check` 工具註冊 |
| `.opencode/scripts/mcp-tools/code-quality-lib.ts` | **修改** | `runTscCheck()` 重構為 `runTscDiagnostic()`（內部函數，不導出為 MCP 工具）；`runFullScan` 移除 tsc 部分 |
| `.opencode/lib/write-audit-lib.ts` | **修改** | `type_check_state` 寫入改為 `diagnostic_state`（雖為死代碼，保持一致性） |
| `.opencode/scripts/state-canonicalize.ts` | **修改** | `type_check_state` 引用改為 `diagnostic_state` |
| `.opencode/scripts/state-integrity-scan.ts` | **修改** | `requiredSubStates` 中 `type_check_state` 改為 `diagnostic_state` |
| `.opencode/scripts/framework-compliance-check.ts` | **修改** | `type_check_state` 讀取改為 `diagnostic_state` |
| `.opencode/scripts/state-reset.ts` | **修改** | `type_check_state` reset 改為 `diagnostic_state` |
| `.opencode/scripts/state-machine-reset.sh` | **修改** | `type_check_state` jq 路徑改為 `diagnostic_state` |
| `.opencode/state/machine.schema.full.json` | **修改** | 移除 `type_check_state` schema，新增 `diagnostic_state` |
| `.opencode/agents/Guardian.md` | **修改** | `type_check_state.status` 檢查改為 `diagnostic_state` |
| `.opencode/agents/Super-Admin.md` | **修改** | `type_check_state` 引用改為 `diagnostic_state` |
| `.opencode/agents/Coder-BE.md` | **修改** | 移除 `run_tsc_check` 工作流指引 |
| `.opencode/agents/Coder-FE.md` | **修改** | 移除 `run_tsc_check` 工作流指引 |

**插件註冊順序**（`opencode.json` `plugin` 陣列）：

新插件置於 `format-after.ts` 之後、`read-track-after.ts` 之前：
1. `format-after.ts` 先執行 auto-format
2. `tsc-diag-track` 在 format 之後運行 tsc（格式化後的代碼更乾淨）
3. `read-track-after` 看到最新狀態

### 3.2 插件核心邏輯

**架構模式**：遵循 `format-after.ts` 的 `require()` 庫函數模式，插件本身不直接使用 `execSync`。tsc 執行和輸出解析邏輯封裝在 `code-quality-lib.ts` 的 `runTscDiagnostic()` 中。

```typescript
// .opencode/plugins/tsc-diag-track.ts
import * as path from "node:path";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";
import { readSubState } from "../lib/substate-manager";          // readSubState 在此
import { atomicWriteSubState } from "../lib/state-utils";        // atomicWriteSubState 在此
import { getEnforcementMode } from "../lib/gate-core";           // getEnforcementMode 在此

const PLUGIN_NAME = "tsc-diag-track";

export default withPluginLifecycle(PLUGIN_NAME, {
  "tool.execute.before": beforeWriteBlock,
  "tool.execute.after": afterWriteTscCheck,
});

// ── Layer 1: Write-time 阻斷 ──
async function beforeWriteBlock(input: any, _output: any): Promise<void> {
  if (!isModifyTool(input?.tool)) return;

  const filePath = getModifyPath(input?.args);
  if (!filePath) return;
  if (!/\.(ts|tsx)$/.test(filePath)) return;

  const mode = getEnforcementMode();
  if (mode === "advisory") {
    // advisory 模式：僅 log，不阻斷
    try {
      const diagState = readSubState("diagnostic_state");
      const absPath = path.resolve(filePath);
      const fileDiag = diagState?.files?.[absPath];
      if (fileDiag?.errors?.length > 0) {
        writeLog(PLUGIN_NAME, "WARN", {
          sessionID: input?.sessionID, callID: input?.callID,
          event: "TSC-DIAG-BLOCK-SKIPPED-ADVISORY",
          detail: `${absPath} has ${fileDiag.errors.length} error(s)`,
        });
      }
    } catch {}
    return;
  }

  // strict / locked 模式：阻斷
  try {
    const diagState = readSubState("diagnostic_state");
    const absPath = path.resolve(filePath);
    const fileDiag = diagState?.files?.[absPath];
    if (fileDiag?.errors?.length > 0) {
      const errorSummary = fileDiag.errors
        .slice(0, 3)
        .map((e: any) => `L${e.line}: ${e.message}`)
        .join("; ");
      writeLog(PLUGIN_NAME, "ERROR", {
        sessionID: input?.sessionID, callID: input?.callID,
        event: "TSC-DIAG-BLOCK",
        detail: `BLOCKED ${absPath}: ${errorSummary}`,
      });
      throw new Error(
        `[FW-ENFORCE][TSC-DIAG] TypeScript errors in ${absPath}: ${errorSummary}. Fix before writing.`
      );
    }
  } catch (err: any) {
    if (err.message?.startsWith("[FW-ENFORCE]")) throw err;
    writeLog(PLUGIN_NAME, "WARN", {
      event: "BEFORE-BLOCK-CHECK-FAILED",
      detail: err.message?.substring(0, 200),
    });
  }
}

// ── Layer 1.5: Post-write tsc 檢查 ──
async function afterWriteTscCheck(input: any, _output: any): Promise<void> {
  if (!isModifyTool(input?.tool)) return;

  const filePath = getModifyPath(input?.args);
  if (!filePath) return;
  if (!/\.(ts|tsx)$/.test(filePath)) return;

  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);

  writeLog(PLUGIN_NAME, "runtime", {
    sessionID: input?.sessionID, callID: input?.callID,
    event: "TSC-CHECK-START",
    detail: absPath,
  });

  // 通過 require() 調用庫函數（同 format-after.ts 調用 runPrettierCheck 模式）
  const { runTscDiagnostic } = require("../scripts/mcp-tools/code-quality-lib");
  const result = runTscDiagnostic(absPath, projectRoot);

  if (result.pass) {
    // tsc 通過 → 清除該文件診斷
    atomicWriteSubState("diagnostic_state", (state: any) => {
      state.files = state.files || {};
      delete state.files[absPath];
      state.last_updated = new Date().toISOString();
    });
    writeLog(PLUGIN_NAME, "runtime", {
      sessionID: input?.sessionID, callID: input?.callID,
      event: "TSC-CHECK-PASS",
      detail: `${absPath} (${result.elapsed}ms)`,
    });
  } else if (result.errors && result.errors.length > 0) {
    // tsc 失敗 → 持久化錯誤
    atomicWriteSubState("diagnostic_state", (state: any) => {
      state.files = state.files || {};
      state.files[absPath] = {
        errors: result.errors,
        updated_at: new Date().toISOString(),
      };
      state.last_updated = new Date().toISOString();
    });
    writeLog(PLUGIN_NAME, "ERROR", {
      sessionID: input?.sessionID, callID: input?.callID,
      event: "TSC-CHECK-FAIL",
      detail: `${absPath} | ${result.errors.length} error(s) | ${result.errors.slice(0, 3).map((e: any) => e.message).join("; ")}`,
    });
  } else {
    // 無法解析錯誤（可能是超時或 tsc 崩潰）→ 不阻塞
    writeLog(PLUGIN_NAME, "WARN", {
      sessionID: input?.sessionID, callID: input?.callID,
      event: "TSC-CHECK-UNPARSEABLE",
      detail: `${absPath} | ${result.detail?.substring(0, 200)}`,
    });
  }
}
```

**`runTscDiagnostic()` 庫函數**（在 `code-quality-lib.ts` 中，由 `runTscCheck()` 重構而來）：

```typescript
// .opencode/scripts/mcp-tools/code-quality-lib.ts（新增內部函數）

/**
 * Run tsc --noEmit --incremental for diagnostic gating.
 * Internal function — called by tsc-diag-track.ts plugin via require().
 * Not exposed as MCP tool.
 *
 * @param {string} absPath - absolute path to changed file
 * @param {string} projectRoot - project root for cwd
 * @returns {{ pass, errors?, elapsed, detail }}
 */
function runTscDiagnostic(absPath, projectRoot) {
  const TSC_TIMEOUT_MS = 30000;
  const TSC_BUILDINFO = ".opencode/state/.tsbuildinfo";

  try {
    const start = Date.now();
    execSync(
      `npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile ${TSC_BUILDINFO}`,
      { cwd: projectRoot, encoding: "utf8", timeout: TSC_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"] }
    );
    const elapsed = Date.now() - start;
    return { pass: true, elapsed, detail: `tsc passed (${elapsed}ms)` };
  } catch (e) {
    const elapsed = 0; // execSync 不提供開始時間
    const output = e.stdout || e.stderr || e.message || "";
    const errors = parseTscOutput(output, absPath);
    return {
      pass: false,
      errors,
      elapsed,
      detail: output.substring(0, 500),
    };
  }
}

// ── tsc 輸出解析 ──
// 格式: file.ts(line,col): error TSXXXX: message
function parseTscOutput(output, targetFile) {
  const errors = [];
  const targetAbs = path.resolve(targetFile);
  const lines = output.split("\n");

  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/);
    if (!match) continue;
    const [, filePath, lineNum, charNum, severity, code, message] = match;
    if (severity !== "error") continue;
    const absFilePath = path.resolve(filePath);
    if (absFilePath === targetAbs) {
      errors.push({
        message: message.trim(),
        line: parseInt(lineNum, 10),
        character: parseInt(charNum, 10),
        code: code,
      });
    }
  }
  return errors;
}
```

### 3.3 submitDeliverables 閘門（層2）

在 `gate-core.ts` 的 `submitDeliverables` 中，HANDOVER.md 檢查 **之後**、`session.gate_status = "delivered"` **之前** 插入：

```typescript
// ── TypeScript Diagnostic Check (Layer 2) ──
const diagnosticState = readSubState("diagnostic_state");
const writeAuditState = readSubState("write_audit_state");
const taskFiles: string[] = writeAuditState?.current_session?.files_written || [];
const filesWithErrors: string[] = [];

for (const f of taskFiles) {
  const absPath = path.isAbsolute(f) ? f : path.join(getProjectRoot(), f);
  const diag = diagnosticState?.files?.[absPath];
  if (diag?.errors?.length > 0) {
    filesWithErrors.push(absPath);
  }
}

if (filesWithErrors.length > 0) {
  session.gate_status = "recoverable";
  session.fail_reason = `TypeScript errors in ${filesWithErrors.length} file(s): ${filesWithErrors.join(", ")}`;
  session.fail_history = session.fail_history || [];
  session.fail_history.push({
    retry: session.retry_count || 0,
    failed_at: now,
    reason: session.fail_reason,
  });
  store.last_updated = now;
  saveGateStore(store, root);
  writeLog("mcp-compliance-gate", "WARN", {
    event: "SUBMIT_DELIVERABLES_TSC_ERRORS",
    detail: `files=${filesWithErrors.join(",")}`,
  });
  return {
    status: "recoverable",
    session_id: gateSessionId,
    reason: `TypeScript errors in: ${filesWithErrors.join(", ")}. Fix errors and retry.`,
  };
}
```

### 3.4 compliance_gate_complete 兜底（層3）

在 `compliance-gate.ts` 的 `runGateComplete` 中，eslint mock-audit 檢查 **之後** 插入：

```typescript
// ── TypeScript Diagnostic Check (Layer 3) ──
let tscErrorCount = 0;
let tscErrorFiles: string[] = [];
try {
  const diagnosticState = readSubState("diagnostic_state");
  const allFiles = diagnosticState?.files || {};
  for (const [filePath, diag] of Object.entries(allFiles)) {
    const errors = (diag as any)?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      tscErrorCount += errors.length;
      tscErrorFiles.push(filePath);
    }
  }
} catch {
  // Non-blocking: readSubState returns {} on failure
}

if (tscErrorCount > 0) {
  writeLog("mcp-compliance-gate", "ERROR", {
    event: "GATE_COMPLETE_TSC_ERRORS",
    detail: `${tscErrorCount} error(s) in ${tscErrorFiles.length} file(s): ${tscErrorFiles.join(",")}`,
  });
  return {
    status: "failed",
    reason: `TypeScript errors detected in ${tscErrorCount} location(s) across ${tscErrorFiles.length} file(s). Fix all errors before completing.`,
  };
}
```

### 3.5 子狀態註冊 + type_check_state 遷移

#### 3.5.1 `substate-types.ts`

**移除** `TypeCheckState` 接口和 `SubStateMap` 中的 `type_check_state` 條目。

**新增**：

```typescript
/**
 * DiagnosticState — TypeScript 診斷狀態
 * 由 tsc-diag-track.ts 插件通過 tool.execute.after hook 寫入。
 * 記錄每個文件的 TypeScript 錯誤，供三層閘門消費。
 * 替代原 type_check_state（僅記錄 dirty_files 列表，無行級信息）。
 *
 * @since 2026-06-26 (tsc diagnostic gate v2.0)
 */
export interface DiagnosticFileEntry {
  errors?: Array<{
    message: string;
    line: number;
    character: number;
    code: string;
    received_at: string;
  }>;
  warnings?: Array<{
    message: string;
    line: number;
    received_at: string;
  }>;
  updated_at?: string;
  [key: string]: any;
}

export interface DiagnosticState {
  /** Per-file diagnostic entries, keyed by absolute file path */
  files?: Record<string, DiagnosticFileEntry>;
  /** ISO 8601 timestamp of last diagnostic update */
  last_updated?: string;
  [key: string]: any;
}
```

**`SubStateMap` 修改**：

```typescript
export interface SubStateMap {
  eslint_state: EslintState;
  // type_check_state: TypeCheckState;  ← 移除
  diagnostic_state: DiagnosticState;    // ← 新增
  dependency_state: DependencyState;
  format_state: FormatState;
  write_audit_state: WriteAuditState;
  compliance_records: ComplianceRecords;
  knowledge_cache_state: KnowledgeCacheState;
  knowledge_audit_state: KnowledgeAuditState;
  tdd_enforcement_state: TddEnforcementState;
  keystone_hashes: KeystoneHashes;
  transaction_state: TransactionState;
  knowledge_state: KnowledgeState;
  config_read_state: ConfigReadState;
}
```

#### 3.5.2 `substate-manager.ts`

```typescript
export const SUBSTATE_FILES: Record<SubStateKey, string> = {
  eslint_state: "eslint-state.json",
  // type_check_state: "type-check-state.json",  ← 移除
  diagnostic_state: "diagnostic-state.json",      // ← 新增
  dependency_state: "dependency-state.json",
  format_state: "format-state.json",
  write_audit_state: "write-audit-state.json",
  knowledge_cache_state: "knowledge-cache-state.json",
  compliance_records: "compliance-records.json",
  knowledge_audit_state: "knowledge-audit-state.json",
  tdd_enforcement_state: "tdd-enforcement-state.json",
  keystone_hashes: "keystone-hashes.json",
  transaction_state: "transaction-state.json",
  knowledge_state: "knowledge-state.json",
  config_read_state: "config-read-state.json",
};
```

#### 3.5.3 遷移影響（無 DB 遷移需要）

**關鍵發現**：`substate_kv` 是通用鍵值存儲（`key TEXT PRIMARY KEY, json TEXT, updated_at INTEGER`），**不需要 DB schema 遷移**。新增/移除子狀態鍵只需修改 TypeScript 類型註冊。v7 遷移已刪除所有 typed tables。

**必須修改的文件**（2 個主註冊表）：
1. `.opencode/lib/substate-types.ts` — `SubStateMap` + 接口定義
2. `.opencode/lib/substate-manager.ts` — `SUBSTATE_FILES` 映射

**條件修改的文件**（存儲文件路徑需要 canonicalization）：
3. `.opencode/scripts/state-canonicalize.ts` — `type_check_state` 引用改為 `diagnostic_state`（含路徑 canonicalization 邏輯）
4. `.opencode/scripts/state-integrity-scan.ts` — `requiredSubStates` 中替換
5. `.opencode/scripts/framework-compliance-check.ts` — `readSubState("type_check_state")` 改為 `readSubState("diagnostic_state")`

### 3.6 Enforcement Mode 整合

| 層 | advisory 模式 | strict 模式 | locked 模式 |
|----|---------------|-------------|-------------|
| 層1 (before hook) | 僅 log warning | throw 阻斷 | throw 阻斷 |
| 層1.5 (after tsc) | 執行但不阻斷 | 執行並記錄 | 執行並記錄 |
| 層2 (submit) | 僅 log warning | recoverable | recoverable |
| 層3 (complete) | 僅 log warning | failed | failed |

---

## 4. code_quality_check 清理

### 4.1 移除 `run_tsc_check` MCP 工具

**`code-quality-check.ts`**：

```typescript
// 移除 ListToolsRequestSchema 中的工具註冊
// 移除 CallToolRequestSchema 中的 case "code_quality_check.run_tsc_check"
// require 解構中不再導入 runTscCheck（但 runTscDiagnostic 保留在 code-quality-lib.ts 中）

const {
  runDepCruiserCheck,
  // runTscCheck,  ← 移除（MCP 工具已刪除）
  runFullScan,
} = require("./code-quality-lib");
```

工具列表從 3 個減為 2 個：
- `code_quality_check.run_depcruise_check`（保留）
- `code_quality_check.run_full_scan`（保留，移除 tsc 部分）
- ~~`code_quality_check.run_tsc_check`~~（移除）

### 4.2 重構 `runTscCheck()` → `runTscDiagnostic()`

**`code-quality-lib.ts`**：

- `runTscCheck()` (L451-509) 重構為 `runTscDiagnostic()`：
  - 參數從 `(filePath, projectRoot, backendDir, frontendDir)` 改為 `(absPath, projectRoot)`
  - 移除 `isBackend`/`isFrontend` guard（新函數在根 tsconfig 下運行，覆蓋 `.opencode/` + business code）
  - 返回值從 `{ pass, violations, detail, execution_evidence }` 改為 `{ pass, errors?, elapsed, detail }`
  - `execSync` cwd 改為 `projectRoot`（根目錄），使用 `--tsBuildInfoFile`
  - 保留 `parseTscOutput()` 作為內部函數
  - 不導出為 MCP 工具，僅被 `tsc-diag-track.ts` 插件通過 `require()` 調用
- 刪除 `runAllChecks` 中的 tsc 分支（L793-807，`runAllChecks` 本身是死代碼但保持一致性）

### 4.3 修改 `runFullScan`

**`code-quality-lib.ts`** `runFullScan` (L848-917)：

- 移除 tsc 循環（L851-871）
- 移除 `tscErrors` 字段（L849, L862）
- 保留 depcruise（L874-897）+ prettier（L900-914）
- 返回值從 `{ overall, violations, tscErrors }` 改為 `{ overall, violations }`
- 工具描述從 "tsc + dependency-cruiser + prettier" 改為 "dependency-cruiser + prettier"

### 4.4 遷移安全性分析

| 調用者 | 影響 | 安全性 |
|--------|------|--------|
| `run_tsc_check` MCP 工具 | 移除 | ✅ 僅 LLM Agent 手動調用，無代碼依賴 |
| `runTscCheck()` → `runTscDiagnostic()` | 重構（參數+返回值變化） | ✅ 僅被 `tsc-diag-track.ts` 插件 `require()` 調用 |
| `runFullScan` MCP 工具 | 返回值少了 `tscErrors` | ✅ 僅 LLM Agent 讀取 JSON |
| `format-after.ts` | 無影響 | ✅ 僅調用 `runPrettierCheck` |
| `compliance_gate_complete` | 無影響 | ✅ 從不調用 code-quality-lib |
| `write-audit-lib.ts` | 無影響 | ✅ 死代碼，從不調用 tsc |
| pre-commit hook | 無影響 | ✅ 從不調用 code-quality-lib |

---

## 5. type_check_state → diagnostic_state 遷移

### 5.1 遷移範圍

| 層 | 文件 | 修改 |
|----|------|------|
| **類型系統** | `substate-types.ts` | 移除 `TypeCheckState`，新增 `DiagnosticState` |
| **子狀態註冊** | `substate-manager.ts` | `SUBSTATE_FILES` 替換鍵名 |
| **JSON Schema** | `machine.schema.full.json` | 移除 `type_check_state` schema，新增 `diagnostic_state` |
| **Gate 讀取者** | `gate-core.ts:1983` | `readSubState("type_check_state")` → `readSubState("diagnostic_state")` |
| **Gate 讀取者** | `gate-checks.ts:247` | 同上 |
| **合規檢查** | `framework-compliance-check.ts:209` | 同上 |
| **路徑規範化** | `state-canonicalize.ts:622,661` | 替換鍵名 + 路徑 canonicalization 邏輯 |
| **寫入者** | `write-audit-lib.ts:117` | `atomicWriteSubState("type_check_state", ...)` → `atomicWriteSubState("diagnostic_state", ...)` |
| **重置腳本** | `state-reset.ts:51` | 鍵名替換 |
| **重置腳本** | `state-machine-reset.sh:81,148,179,226` | jq 路徑替換 |
| **完整性掃描** | `state-integrity-scan.ts:134` | `requiredSubStates` 替換 |
| **Agent 文檔** | `Guardian.md:94` | `type_check_state.status` → `diagnostic_state` 檢查 |
| **Agent 文檔** | `Super-Admin.md:129` | 引用替換 |
| **測試** | `framework-enforcer.test.js:1401,2127` | 鍵名替換 |
| **測試** | `state-integrity-scan.test.js:35` | 鍵名替換 |
| **測試** | `framework-self-test.test.js:84` | 鍵名替換 |

### 5.2 遷移安全性

**關鍵發現**：`write-audit-lib.ts` 的 `executeWriteAuditCheck` 是 **死代碼**（無調用者），因此 `type_check_state` 在運行時實際上從未被寫入（僅 reset 腳本設為 clean）。遷移風險極低。

**`checkMachineCleanliness` 遷移**：

`gate-core.ts:1983` 原邏輯：
```typescript
const tcs = readSubState("type_check_state");
if (tcs?.status && tcs.status !== "clean") {
  dirty.push(`type_check_state: status=${tcs.status}, ...`);
}
```

遷移後：
```typescript
const ds = readSubState("diagnostic_state");
const errorFiles = Object.entries(ds?.files || {}).filter(
  ([_, d]) => Array.isArray((d as any)?.errors) && (d as any).errors.length > 0
);
if (errorFiles.length > 0) {
  dirty.push(`diagnostic_state: ${errorFiles.length} file(s) with errors`);
}
```

`gate-checks.ts:247` 原邏輯：
```typescript
const typeCheckState = readSubState("type_check_state");
dirty.push(...(typeCheckState?.dirty_files || []).map((f) => "tsc:" + f));
```

遷移後：
```typescript
const diagState = readSubState("diagnostic_state");
const errorFiles = Object.entries(diagState?.files || {})
  .filter(([_, d]) => Array.isArray((d as any)?.errors) && (d as any).errors.length > 0)
  .map(([f]) => "tsc:" + f);
dirty.push(...errorFiles);
```

---

## 6. 日誌系統整合

### 6.1 日誌規範

所有日誌通過 `writeLog(PLUGIN_NAME, category, fields)` 輸出，遵循框架統一日誌格式。

| 事件 | 級別 | 說明 |
|------|------|------|
| `TSC-CHECK-START` | DEBUG | tsc 檢查開始 |
| `TSC-CHECK-PASS` | INFO | tsc 通過（含耗時） |
| `TSC-CHECK-FAIL` | ERROR | tsc 失敗（含錯誤摘要） |
| `TSC-CHECK-UNPARSEABLE` | WARN | tsc 輸出無法解析 |
| `TSC-DIAG-BLOCK` | ERROR | before hook 阻斷寫入 |
| `TSC-DIAG-BLOCK-SKIPPED-ADVISORY` | WARN | advisory 模式跳過阻斷 |
| `BEFORE-BLOCK-CHECK-FAILED` | WARN | before hook 檢查異常 |
| `SUBMIT_DELIVERABLES_TSC_ERRORS` | WARN | submit 時發現錯誤 |
| `GATE_COMPLETE_TSC_ERRORS` | ERROR | complete 時發現錯誤 |

### 6.2 日誌文件

輸出到 `.task_temp/_logs/{date}/plugin-tsc-diag-track-runtime.log`，遵循日誌輪轉策略（100KB 輪轉，保留 7 天，gzip 3 天後壓縮，30 天後歸檔）。

---

## 7. 子系統合規矩陣

| 子系統 | 合規 | 說明 |
|--------|------|------|
| **Layout Architecture** | ✅ | 新插件 + gate 邏輯修改，不改變整體架構 |
| **DB-only / DB-canonical** | ✅ | `diagnostic_state` 通過 `atomicWriteSubState` 寫入 `substate_kv` 表；無 JSON 雙寫 |
| **Permission Matrix** | ✅ | 不引入新權限；插件通過 `require()` 調用 `runTscDiagnostic()` 庫函數（同 `format-after.ts` 調用 `runPrettierCheck` 模式），`execSync` 封裝在庫函數內 |
| **Session/Concurrency Safe** | ✅ | `atomicWriteSubState` SQLite 事務 + 樂觀併發控制；文件路徑為 key |
| **Hardened Enforcement** | ✅ | 三層閘門遵循 advisory/strict/locked 模式 |
| **Framework Harness** | ✅ | 使用 `withPluginLifecycle` 標準插件模式（同 `format-after.ts`）；`tool.execute.before` + `tool.execute.after` 雙 hook |
| **Central State Management** | ✅ | `readSubState` from `substate-manager.ts` + `atomicWriteSubState` from `state-utils.ts`（框架標準 split API） |
| **Multi-Agent** | ✅ | 文件路徑為 key，不同 Agent 寫不同文件不衝突 |
| **Log Central Management** | ✅ | 使用 `writeLog` 統一日誌系統，含 sessionID/callID/agent |
| **DB-canonical Management** | ✅ | 子狀態存儲在 `substate_kv` SQLite 表，無 DB 遷移 |
| **Templatization & Parameterization** | ✅ | enforcement mode 通過 `getEnforcementMode()` 統一獲取 |
| **TypeScript + Bun Runtime** | ✅ | 純 TypeScript，`execSync` 調用 `npx tsc`，Bun 原生支持 |

---

## 8. 自污染防護

### 8.1 P0-FIX-BUG-11 模式分析

**風險**：`tool.execute.after` hook 運行 tsc 並寫入 `diagnostic_state`（通過 `atomicWriteSubState`），是否會觸發 `toolExecuteAfter` plugin hook 的狀態調和，重新標記文件為 dirty？

**分析**：
- `atomicWriteSubState` 操作的是 SQLite `substate_kv` 表，不觸發文件系統寫入
- `toolExecuteAfter` hook 在 `tool.execute` 完成後觸發（即當前 hook 鏈完成後）
- `tsc-diag-track` 的 `afterWriteTscCheck` 是當前 hook 鏈的一部分
- `atomicWriteSubState` 不觸發新的 tool 執行，因此不會遞歸觸發 `toolExecuteAfter`
- **不存在自污染循環**

### 8.2 eslint_state 的 self-dirtying 啟示

`compliance-gate.ts:1717-1753` 的 P0-FIX-BUG-11 修復是針對 `compliance_gate_complete` 內部寫 `gate-state.json` 觸發 `toolExecuteAfter` 的場景。`tsc-diag-track` 不寫入 `gate-state.json` 或 `machine.json`，僅寫入 `substate_kv`，因此不受此問題影響。

---

## 9. 風險與緩解

| 風險 | 緩解 |
|------|------|
| tsc 增量檢查耗時 | `--incremental` + `.tsbuildinfo` 快取；30s 超時；僅 .ts/.tsx 文件 |
| tsc 輸出解析失敗 | `parseTscOutput` 僅匹配標準格式；無法解析時 WARN 不阻塞 |
| 跨文件錯誤 | tsc 項目級檢查天然覆蓋跨文件類型推導 |
| 舊 session 遺留 | 層2 僅檢查 `write_audit_state.current_session.files_written` |
| stale 診斷 | tsc 每次運行都覆蓋；文件修正後下次 tsc 通過會清除記錄 |
| `diagnostic_state` 為空 | 三層均跳過檢查（`readSubState` 返回 `{}`） |

---

## 10. 實施順序

1. **Step 1**: 註冊 `diagnostic_state` + 移除 `type_check_state`（`substate-types.ts` + `substate-manager.ts`）
2. **Step 2**: 遷移所有 `type_check_state` 消費者（gate-core, gate-checks, canonicalize, compliance-check, integrity-scan, reset scripts, tests, agent docs）
3. **Step 3**: 在 `code-quality-lib.ts` 中將 `runTscCheck()` 重構為 `runTscDiagnostic()`（內部函數，移除 isBackend/isFrontend guard，改用根 tsconfig）
4. **Step 4**: 創建 `tsc-diag-track.ts` 插件（僅 `tool.execute.after` tsc 檢查，通過 `require()` 調用 `runTscDiagnostic`）
5. **Step 5**: 驗證 tsc 能正確寫入 `diagnostic_state`（觀察日誌）
6. **Step 6**: 添加 `tool.execute.before` 阻斷邏輯
7. **Step 7**: 修改 `submitDeliverables` 增加層2 檢查
8. **Step 8**: 修改 `compliance_gate_complete` 增加層3 檢查
9. **Step 9**: 移除 `run_tsc_check` MCP 工具註冊（`code-quality-check.ts`）
10. **Step 10**: 修改 `runFullScan` 移除 tsc 部分
11. **Step 11**: 更新 Agent 文檔（Coder-BE, Coder-FE, Guardian, Super-Admin）
12. **Step 12**: 註冊插件到 `opencode.json`
13. **Step 13**: 端到端測試

---

## 11. 驗證計劃

### 11.1 單元驗證

- [ ] `diagnostic_state` 子狀態可正確讀寫
- [ ] `parseTscOutput` 正確解析標準 tsc 輸出
- [ ] `beforeWriteBlock` 僅對 `isModifyTool` + `.ts/.tsx` 生效
- [ ] enforcement mode 正確影響阻斷行為
- [ ] `type_check_state` 完全移除，無殘留引用

### 11.2 集成驗證

- [ ] 故意在 `gate-core.ts` 引入 TS 錯誤 → 寫入後 tsc 診斷記錄到 `diagnostic_state`
- [ ] 下一次 Write 操作被層1 阻斷（strict 模式）
- [ ] `submitDeliverables` 返回 recoverable
- [ ] `compliance_gate_complete` 返回 failed
- [ ] 修正錯誤後 tsc 通過 → 三層全部通過

### 11.3 回歸驗證

- [ ] `checkMachineCleanliness` 正確讀取 `diagnostic_state`
- [ ] `eslint_state` 流程不受影響
- [ ] `format_state` 流程不受影響
- [ ] `run_depcruise_check` 仍正常工作
- [ ] `runFullScan` 返回正確的 depcruise + prettier 結果（無 tscErrors）
- [ ] TDD 檢查不受框架文件影響

---

## 12. 知識快取修正

以下文檔包含錯誤的 LSP hook 信息，需要修正：

| 文檔 | 錯誤 | 修正 |
|------|------|------|
| `docs/official_docs/opencode/lsp/lsp-hook-integration-analysis.md` | 稱 `lsp.client.diagnostics` payload 包含 `uri`、`diagnostics`、`severity`、`message` | payload 實際僅 `{serverID, path}`（SDK v1.15.11 v1 types.gen.d.ts:19-25、v2 types.gen.d.ts:2052-2058 一致）；事件在 v1/v2 均保留，但無診斷數據 |
| `docs/official_docs/opencode/lsp/lsp-hook-integration-analysis.md` | 稱可通過 `client.app.log()` 在 LSP hook 中記錄日誌 | `withPluginLifecycle` 丟棄 `_ctx`（含 `client`），插件無法訪問 `client` API（hook-lifecycle.ts:17） |
| `docs/official_docs/opencode/lsp/lsp-hook-integration-analysis.md` | 稱 `lsp.client.diagnostics` 為直接插件 hook key | 非 `@opencode-ai/plugin` `Hooks` 接口成員（index.d.ts:173-317）；僅能通過泛型 `event` hook 間接接收 |
| `docs/official_docs/opencode/plugins/plugin-hook-reference.md:204` | 列出 `lsp.client.diagnostics` 為可用插件 hook 事件 | 標註為「SDK 事件類型，非 `@opencode-ai/plugin` `Hooks` 接口直接成員；payload 僅 `{serverID, path}` 無診斷數據；僅能通過泛型 `event` hook 接收」 |
| `docs/official_docs/opencode/plugins/official-plugins-docs.md:62` | 同上 | 同上 |
| `docs/official_docs/opencode/findings/02-harness-system.md:131` | 同上 | 同上 |

---

_參考_:

- `docs/review/framework-refactor/code-quality-cleanup-plan.md`
- `docs/review/framework-refactor/framework-tsc-tdd-feasibility-analysis-20260626.md`
- `docs/review/framework-refactor/three-lock-deadlock-root-cause-diagnosis-20260626.md`
- `.opencode/lib/substate-types.ts`
- `.opencode/lib/substate-manager.ts`
- `.opencode/lib/gate-core.ts`
- `.opencode/lib/gate-checks.ts`
- `.opencode/lib/write-audit-lib.ts`
- `.opencode/lib/hook-lifecycle.ts`
- `.opencode/scripts/mcp-tools/compliance-gate.ts`
- `.opencode/scripts/mcp-tools/code-quality-check.ts`
- `.opencode/scripts/mcp-tools/code-quality-lib.ts`
- `@opencode-ai/plugin` SDK `index.d.ts` (Hooks interface)
- `@opencode-ai/sdk` SDK `types.gen.d.ts` (Event types)
- OpenCode runtime binary (`~/.opencode/bin/opencode`)
