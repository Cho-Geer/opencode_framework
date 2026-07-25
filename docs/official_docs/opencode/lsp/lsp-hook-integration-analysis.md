# OpenCode LSP Hook 集成分析（修正版 v2）

**Domain**: opencode_framework
**Library**: opencode-framework / lsp / @opencode-ai/plugin
**Created**: 2026-06-26
**Revised**: 2026-06-26（修正 3 處事實錯誤 + 2 處缺失）
**Source**: 官方 SDK (`@opencode-ai/sdk`/`@opencode-ai/plugin` v1.15.11)、官方文檔 (opencode.ai/docs)
**Status**: active

---

## §0 修正記錄

### §0.1 原始版本錯誤摘要

v1.0 存在 3 處事實錯誤，來源於基於間接文檔推斷而非官方 SDK 代碼 ground truth：

| #   | 錯誤           | v1.0 聲稱                                              | 實際情況（官方 SDK）                                                                                                                            |
| :-- | :------------- | :----------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hook 註冊方式  | `"lsp.client.diagnostics"` 是直接 hook key             | Hooks 介面（`@opencode-ai/plugin/dist/index.d.ts:173-317`）無此 key。僅能透過泛型 `event?: (input: {event: Event}) => Promise<void>` 間接接收   |
| 2   | Payload 內容   | input 含 `uri`, `diagnostics[]`, `severity`, `message` | `EventLspClientDiagnostics` 實際 payload 僅 `{serverID: string, path: string}`（v1 `types.gen.d.ts:19-25`、v2 `types.gen.d.ts:2052-2058`）      |
| 3   | 即時診斷可用性 | "即時診斷可用 ✅"                                      | `Lsp` client 類僅有 `status()` 方法，返回 `LspStatus = {id, name, root, status: "connected"\|"error"}`（v2 L1267-1272），僅連接狀態，無診斷內容 |

### §0.2 缺失資訊

| #   | 缺失點                                                                                                    | 影響                         |
| :-- | :-------------------------------------------------------------------------------------------------------- | :--------------------------- |
| 4   | `withPluginLifecycle`（`hook-lifecycle.ts:17`）丟棄 `_ctx`，導致即使註冊 event hook 也無法調用 client API | 所有需要 client 的方案不可行 |
| 5   | 唯一可行路徑被忽略：`tool.execute.after` + `tsc --noEmit`                                                 | 整個 v1.0 的推薦方案失效     |

---

## 1. 結論：LSP 無法直接用於寫後診斷

### 1.1 官方 SDK 的真實能力

對照 `@opencode-ai/plugin` v1.15.11 的類型定義：

**Hooks 介面** (`dist/index.d.ts:173-317`)：

```typescript
interface Hooks {
  event?: (input: { event: Event }) => Promise<void>;  // 泛型事件接收器
  "tool.execute.before"?: ...;
  "tool.execute.after"?: ...;
  // 沒有 "lsp.client.diagnostics" 這個 key
}
```

**LSP 事件類型** (`types.gen.d.ts:2052-2058`)：

```typescript
interface EventLspClientDiagnostics {
  serverID: string; // LSP server ID, e.g. "typescript"
  path: string; // 文件路徑（僅此而已，無診斷內容）
}
```

**LSP client 類** (`v2 L531`)：

```typescript
class Lsp {
  status(): LspStatus; // 僅返回連接狀態，無診斷內容
}
```

### 1.2 事實總結

| 問題                                       |     答案      | 證據                                                             |
| :----------------------------------------- | :-----------: | :--------------------------------------------------------------- |
| OpenCode 支持 LSP？                        |     ✅ 是     | `opencode.json` `"lsp": true`                                    |
| `lsp.client.diagnostics` 是直接 hook key？ |  ❌ **不是**  | Hooks 介面無此 key；僅透過泛型 `event` hook 間接接收             |
| 事件 payload 含診斷內容？                  |  ❌ **不含**  | 僅 `{serverID, path}`，無 `uri`、無 `diagnostics`、無 `severity` |
| client 提供診斷 API？                      | ❌ **不提供** | 僅 `status()` 方法，返回連接狀態字串                             |
| withPluginLifecycle 支援 client API？      | ❌ **不支援** | `hook-lifecycle.ts:17` 丟棄 `_ctx`                               |

---

## 2. 唯一可行路徑

### 2.1 `tool.execute.after` + `tsc --noEmit`

由於 LSP 事件**不提供任何診斷數據**，獲取 TypeScript 類型錯誤的唯一方法是**在文件寫入後主動執行 `tsc`**：

```typescript
// 可行方案
export default withPluginLifecycle("tsc-after", {
  "tool.execute.after": async (input, output) => {
    if (!isModifyTool(input.tool)) return;
    const filePath = getModifyPath(input.args);
    if (!filePath) return;

    // 對修改的文件執行 tsc --noEmit
    const { execSync } = require("child_process");
    try {
      execSync(`npx tsc --noEmit --pretty false`, {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // 通過：清除該文件的 diagnostic_state
    } catch (e) {
      // 失敗：記錄 tsc 輸出中的錯誤到 diagnostic_state
      // 下一次 tool.execute.before 會阻斷
    }
  },
});
```

### 2.2 LSP 事件的唯一可用資訊

`event` hook 可以收到 `EventLspClientDiagnostics = {serverID, path}`。這唯一的作用是：

```typescript
// 可以用來知道 LSP server 對哪個文件產生了診斷（僅知道文件路徑）
// 但無法獲取診斷內容。診斷內容必須透過 tsc --noEmit 獲取
export default withPluginLifecycle("lsp-event-log", {
  event: async (input) => {
    const evt = input.event;
    // evt 可能為 EventLspClientDiagnostics = { serverID, path }
    // 僅記錄文件變更，診斷靠 tsc
  },
});
```

### 2.3 修正後的推薦架構

```
Agent Write/Edit
    │
    ├─ tool.execute.before
    │   └─ 檢查 diagnostic_state → 有錯？→ throw 阻斷
    │
    ├─ 文件寫入
    │
    └─ tool.execute.after
        └─ 跑 `tsc --noEmit` → 記錄失敗到 diagnostic_state
           └─ 下次 before 阻斷
```

**LSP 在本方案中的角色**：無。`tsc` 是唯一可靠的 TS 診斷來源。

---

## 3. 與現有 `code_quality_check` MCP 工具的關係

`code_quality_check.run_tsc_check()` 已經實現了「寫後 tsc 檢查」，問題是：

- 它需要 Agent **手動調用**
- 它**跳過框架文件**（`code-quality-lib.ts` L470-477）
- 它從子目錄 cwd 執行，tsconfig 不包含 `.opencode/`

修正後方案將其改造為：

- **自動觸發**（`tool.execute.after` hook）
- **包含框架文件**（以專案根目錄為 cwd，使用根 tsconfig）
- **強制阻斷**（`tool.execute.before` + `submitDeliverables` + `compliance_gate_complete` 三層閘門）

---

## References

- `@opencode-ai/plugin/dist/index.d.ts:173-317` — Hooks 介面
- `@opencode-ai/plugin/dist/types.gen.d.ts:2052-2058` — EventLspClientDiagnostics
- `@opencode-ai/plugin/dist/types.gen.d.ts:1267-1272` — LspStatus
- `opencode.json` L9 — `"lsp": true`
- GitHub issue #4410 — LSP plugin access limitations
- `docs/official_docs/opencode/plugins/plugin-hook-reference.md` — hook 系統
