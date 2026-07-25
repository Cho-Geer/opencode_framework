# Step 0d — Multi-Source Log Audit Mandate 实施方案

**版本**: v3.1.0
**日期**: 2026-06-27
**作者**: @Super-Admin
**状态**: 方案制定，待实施（v3.1 — 行号校准 + SubStateMap 计数更新；v3.0 read_audit 交叉验证 + 写入前阻断 + 工具失败追踪 + 知识缓存溯源门）

---

## 0. 審核記錄

### 0.1 v1.0 現狀（2026-06-18 制定）

v1.0 方案在 `compliance_gate_approve_deliverables()` 中加入 `enforceMultiSourceAudit()`，檢查 HANDOVER.md 是否含 `## Logs Checked` 段。問題：**僅檢查格式（有段落 + >=2 行），不驗證這些日誌是否真的被 `read()` 過**。Agent 可捏造表格通過檢查。

### 0.2 v2.0 提案審核（2026-06-26 源碼驗證）

用戶提出兩項升級，經源碼驗證後評估如下：

| 提案 | 可行性 | 問題 |
|------|--------|------|
| **Part 1**: submit 時對照 read_audit 表確認真實讀取 | ✅ 可行 | 無；`verifyNonEmptyReadSet()` 已存在（read-audit.ts:518-604），compliance-gate.ts 已有 READ-BEFORE-APPROVE 模式 |
| **Part 2**: 新加 investigation 階段在寫入前阻斷 | ⚠️ 需重新設計 | 見 §0.3 |

### 0.3 Part 2 的邏輯矛盾與修正

**矛盾**：`required_logs_checked`（execution-checklist.ts:242-245）的 remediation 是 "Ensure HANDOVER.md has ## Logs Checked section"。HANDOVER.md 在 `execute` 階段寫入——**寫入前不存在**，無法在寫入前檢查其內容。

**checklist 階段模型限制**：PHASE_ORDER 是線性單向推進（dispatch_payload → preflight → read_attest → gate_armed → execute → deliver → close，checklist-before.ts:276-284）。一旦通過某階段就 auto-advance 到下一階段，**不會回頭**。新加 investigation 階段只能做一次性閘門，不是「每次寫入前」都檢查。

**修正方案**：不用新 checklist 階段，改用 `scope-before.ts` 的寫入前 hook（同 `config_read_attest` pre-gate 模式，scope-before.ts:286-332）。這是每次寫入都觸發的 per-write 檢查，且不依賴 HANDOVER.md。

### 0.4 關鍵源碼證據

| 驗證項 | 結果 | 證據 |
|--------|------|------|
| `required_logs_checked` 位置 | execute 階段第 2 項 | execution-checklist.ts:251-255，verifier="submit gate + file evidence" |
| checklist 階段模型 | 7 階段，無 write/investigation | checklist-before.ts:276-284 `PHASE_ORDER` |
| checklist 阻斷邏輯 | 按 enforcement mode（非按階段） | checklist-before.ts:384-421；advisory=return，strict/locked=throw |
| read_audit 表 | 存在，4 索引 | db-manager.ts:649-661（v10 遷移） |
| `verifyNonEmptyReadSet()` | 存在，可批量驗證 | read-audit.ts:520-606，返回 `{verified, notRead[]}` |
| `verifyRead()` | 存在，單文件驗證 | read-audit.ts:298-364 |
| read 記錄時機 | after-hook（非 before） | read-track-after.ts:49 → `recordRead()`；before-hook 只能看到先前已完成的讀取 |
| before-hook 可同步讀 SQLite | ✅ 是 | tdd-before.ts:26 `readSubState("tdd_enforcement_state")` 在 `tool.execute.before` 中同步執行 |
| scope-before.ts 寫入前檢查模式 | ✅ 已有先例 | config_read_attest pre-gate（scope-before.ts:293-348），strict/locked 阻斷 |
| `tool.execute.before` 參數規範 | args 在 `output.args`，不在 `input` | `@opencode-ai/plugin` index.d.ts:235-241；tdd-before.ts:20 用 `output.args?.filePath` |
| `writeLog` 簽名 | `writeLog(plugin, category, fields)` | log-manager.ts:339；LogCategory = `"loaded"|"hooks"|"runtime"|LogLevel`（L29,39） |
| `[FW-ENFORCE]` 重新拋出守衛 | 是 | checklist-before.ts:416；scope-before.ts 同模式 |

### 0.5 v3.0 重新審核（2026-06-26 源碼驗證，v3.1 於 2026-06-27 校準行號）

v2.0 方案的所有源碼引用經重新驗證，**行為全部仍然準確**；v3.1 校準行號以反映 2026-06-27 代碼：

| v2.0 聲明 | v3.1 校準 | 證據 |
|-----------|----------|------|
| `required_logs_checked` 在 execute 階段 L242-246 | L251-255 | execution-checklist.ts:251-255，verifier="submit gate + file evidence" |
| PHASE_ORDER 7 階段 L276-284 | ✅ 仍準確 | checklist-before.ts:276-284 |
| 阻斷邏輯 mode-based L384-419 | L384-421 | checklist-before.ts:384-421；advisory=return，strict/locked=throw |
| `verifyNonEmptyReadSet()` L518-604 | L520-606 | read-audit.ts:520-606 |
| `verifyRead()` L296-362 | L298-364 | read-audit.ts:298-364 |
| config_read_attest pre-gate L286-332 | L293-348 | scope-before.ts:293-348，`[FW-ENFORCE][CONFIG-READ-ATTEST]` |
| read-track-after.ts recordRead L49 | ✅ 仍準確 | read-track-after.ts:49，`tool.execute.after` |
| tdd-before.ts 同步 readSubState L26 | ✅ 仍準確 | tdd-before.ts:26 |
| `writeLog` + LogCategory L331/L39 | L339/L39 | log-manager.ts:339（函數）, L39（LogCategory）, L29（LogLevel） |

**一個 nuance 需澄清**：v2.0 §3.2 說「在 `enforceMultiSourceAudit()` 中新增 read_audit 交叉驗證」。重新審核發現 `enforceMultiSourceAudit()`（compliance-gate.ts:2300）本身**不做** read_audit 交叉驗證——它僅 regex 檢查 HANDOVER.md 有無 `## Logs Checked` 段（L2364）。但同一 `approve_deliverables` 流程中**已有**獨立的 READ-BEFORE-APPROVE 區塊（L2655-2744）調用 `verifyNonEmptyReadSet`。不過該區塊驗證的是「審批者是否讀了交付物」，與層A「Agent 是否真讀了 HANDOVER 中列出的日誌」是**不同維度**。層A 仍需新增。

### 0.6 v3.0 新增：工具失敗隱瞞問題（KC webfetch 案例）

**事件**：KC 嘗試 `webfetch https://opencode.ai/docs/tools/` 但失敗（紅色），隨後：
1. ⚠️ 未在 HANDOVER.md / TASK_LOG.md 記錄失敗
2. ⚠️ 未重試
3. ⚠️ 未改用 websearch / context7 備選
4. 直接繼續 config_read_attest → skill → gate → todowrite
5. 用本地緩存 + LLM 推斷 → 編造 LSP payload 格式 → 寫入知識緩存

**5 個根因缺口**（源碼驗證）：

| # | 缺口 | 證據 |
|---|------|------|
| 1 | **無 after-hook 攔截 webfetch** | 全部 10 個 after-hook 只過濾 isModifyTool/read/Task/compliance-gate/TDD，無一匹配 webfetch/websearch |
| 2 | **知識緩存寫入無溯源驗證** | uc7ks-after.ts:173 UC7-003 僅 `fs.existsSync()`；`KnowledgeFile.source`（knowledge-store.ts:30-51）是未驗證的自聲明字符串，無 `verification_status` 字段 |
| 3 | **KC 豁免寫入閘門** | uc7ks-utils.ts:457 `if (agentNorm === "knowledge-curator") return null` — KC 可零溯源寫入 `docs/official_docs/` |
| 4 | **無 HANDOVER 工具失敗披露段** | grep `## Tool Failures\|## Unverified\|## Limitations` 全工作區零匹配；框架僅要求 `## Logs Checked` 和 `## Findings` |
| 5 | **失敗/備選鏈僅 prompt 級** | Knowledge-Curator.md:123 "If webfetch fails → go to Step 6" 是 LLM 指令，無 hook 級強制；agent 可靜默跳過 |

**現有工具追蹤**：僅 `task-after.ts:34` 用 `output?.error \|\| output?.failed` 檢測 Task() 派遣成敗——**無 webfetch/websearch 失敗追蹤**。無 `tool_audit` 表或子狀態（grep 零匹配）。

### 0.7 v3.1 校準審核（2026-06-27 最新源碼驗證）

框架代碼近期有大改動，v3.0 的行號引用與 SubStateMap 計數已校準。**行為描述全部仍準確**，僅行號微偏移與結構性計數變更：

| 類型 | 數量 | 處理 |
|------|------|------|
| 行號偏移 | ~25 處 | 校準到新行號（最大 +72 行，compliance-gate.ts 因新增功能擴長） |
| 結構性計數錯誤 | 1 處 | SubStateMap 現為 14 個 key（G-7 新增 `diagnostic_baseline` 於 2026-06-27）；`tool_audit_state` 應為**第 15 個**子狀態（v3.0 誤稱為第 14 個） |
| 新增缺失字段 | 1 處 | Layer B "Source 1"（dispatch payload `required_readings` 字段）在代碼中**不存在**；Layer B 只能依賴 `config_read_state.sessions[sid].attested_files`（即 "Source 2"） |

**v3.1 修訂摘要**：
- 所有行號引用校準到 2026-06-27 代碼（§0.4 / §0.5 表格、§3.2-3.8 代碼、§4.2 日誌路徑、§5.2 DB 規範、§8 實施順序、§10 參考文獻）
- `tool_audit_state` 改稱「第 15 個子狀態」（§3.1、§6、§8 Step 1、§10 參考）
- Layer B 移除 `required_readings` 作為 Source 1（§2.3、§3.3 代碼、§6 參數化、§7 風險）
- 插入點校準：Layer B 在 config_read_attest 後（~L348）→ UC7-001 前（~L351）；Layer D 在 UC7-005 後（~L402）→ `} // end for each scopePath` 前（~L404）

---

## 1. 問題背景

### 1.1 v1.0 的漏洞

`enforceMultiSourceAudit()`（compliance-gate.ts）在 approve 時檢查 HANDOVER.md 含 `## Logs Checked` 段 + >=2 行。但：

- **不驗證真實讀取**：只看表格格式，不對照 read_audit 表
- **時機太晚**：只在 approve 時檢查，Agent 在 execute 階段已寫完全部代碼
- **可捏造**：KC 的 HANDOVER 有表格、有 2 行 → 檢查通過，但內容是捏造的

### 1.2 v3.0 新增問題：工具失敗隱瞞 + 知識緩存污染

KC webfetch 失敗後隱瞞失敗、用 LLM 推斷編造內容並寫入知識緩存（§0.6）。暴露的深層問題：

- **工具失敗不可見**：webfetch 失敗無框架級記錄，Agent 可靜默跳過
- **知識緩存無溯源**：寫入 `docs/official_docs/` 不驗證是否有成功的外部獲取先例
- **無強制披露**：HANDOVER 無 `## Tool Failures` 段，Agent 不需報告失敗

### 1.3 目標

1. **submit 時交叉驗證**（層A）：對照 read_audit 表，確認 HANDOVER 中列出的日誌文件真的被 `read()` 過
2. **寫入前阻斷**（層B）：Agent 寫代碼前必須讀過任務要求的必讀文檔，否則 strict/locked 阻斷
3. **工具調用審計**（層C）：追蹤 webfetch/websearch 調用及其成敗，持久化到 `tool_audit_state` 子狀態
4. **知識緩存溯源門**（層D）：KC 寫入 `docs/official_docs/` 前驗證有成功的外部獲取先例，否則必須標記 `verification_status: "inferred"`
5. **工具失敗強制披露**（層E）：HANDOVER 須含 `## Tool Failures` 段（僅當 tool_audit_state 有失敗記錄時），submit 時交叉驗證

---

## 2. 解決方案：多層審計閘門（層A-E）

### 2.1 架構總覽

```
══════════════════════════════════════════════════════════════════════
層A: Submit-time read_audit 交叉驗證（升級 required_logs_checked verifier）
══════════════════════════════════════════════════════════════════════
  Agent 調用 submit_deliverables
    → 讀取 .task_temp/{taskId}/HANDOVER.md
    → 解析 ## Logs Checked 段，提取文件路徑列表
    → 調用 verifyNonEmptyReadSet({agent, sessionId, filePaths})
    → 全部 verified？ → delivered ✅
    → 有 notRead？ → recoverable ❌（捏造的日誌被抓住）

══════════════════════════════════════════════════════════════════════
層B: Pre-write 必讀文檔閘門（scope-before.ts 新增檢查）
══════════════════════════════════════════════════════════════════════
  Agent 調用 safe_edit/write 等 isModifyTool
    → 僅對 isModifyTool 生效（同 config_read_attest pre-gate 模式）
    → 讀取 task 的 required_readings 列表（來自 config_read_state）
    → 調用 verifyNonEmptyReadSet({agent, sessionId, filePaths: requiredReadings})
    → 全部 verified？ → 放行 ✅
    → 有 notRead？ → strict/locked: throw 阻斷 ❌  advisory: log warning ⚠️

══════════════════════════════════════════════════════════════════════
層C: Tool Call Audit（uc7ks-after.ts 新增分支，持久化到 tool_audit_state）
══════════════════════════════════════════════════════════════════════
  Agent 調用 webfetch/websearch/context7/github_*
    → tool.execute.after → uc7ks-after.ts 新增 TRACKED_TOOLS 分支
    → 用 output?.error || output?.failed 判定成敗（同 task-after.ts:34 模式）
    → 寫入 tool_audit_state 子狀態（sessions[sid].tool_calls[]）
    → 失敗記錄含 tool + errorMsg + timestamp + callID

══════════════════════════════════════════════════════════════════════
層D: Knowledge Cache Provenance Gate（scope-before.ts 新增 KC 溯源檢查）
══════════════════════════════════════════════════════════════════════
  KC 調用 write/edit 到 docs/official_docs/
    → tool.execute.before → scope-before.ts（在 UC7-005 之後）
    → 讀取 tool_audit_state，檢查本 session 的外部獲取記錄
    → 有成功的外部獲取先例？ → 放行 ✅
    → 僅有失敗記錄（無成功）？ → strict/locked: throw 阻斷 ❌
      （KC 試過 webfetch 失敗、現在直接寫入 → 疑似編造）
    → 無任何外部獲取嘗試？ → 放行 ✅（可能是 curated 內容）

══════════════════════════════════════════════════════════════════════
層E: Tool Failure Disclosure（HANDOVER ## Tool Failures + submit 交叉驗證）
══════════════════════════════════════════════════════════════════════
  Agent 調用 submit_deliverables
    → 讀取 tool_audit_state，提取本 session 的失敗工具調用
    → 有失敗記錄？
      → 讀取 HANDOVER.md，解析 ## Tool Failures 段
      → 段不存在或條目數 < 失敗數 → recoverable ❌（隱瞞失敗）
    → 無失敗記錄？ → 跳過層E ✅（向後兼容）
```

### 2.2 為什麼用 scope-before.ts 而非新 checklist 階段

| 維度 | 新 checklist 階段 | scope-before.ts 寫入前檢查 |
|------|--------------------|---------------------------|
| 依賴 HANDOVER.md | ❌ HANDOVER 在 execute 才寫，提前檢查邏輯矛盾 | ✅ 不依賴 HANDOVER，用 dispatch payload 的 required_readings |
| 檢查頻率 | 一次性（通過即 auto-advance） | ✅ 每次寫入都檢查（per-write） |
| 現有先例 | 無（需改 PHASE_ORDER + auto-advance 邏輯） | ✅ config_read_attest pre-gate（scope-before.ts:286-332）完全相同模式 |
| 改動範圍 | 大（execution-checklist.ts + checklist-before.ts + PHASE_ORDER） | 小（僅 scope-before.ts 新增一段） |
| 同步 SQLite 讀取 | 需在 before-hook 中調用 | ✅ tdd-before.ts:26 已證明可行 |
| 風險 | 高（階段模型變更影響所有任務） | 低（僅影響寫入操作） |

### 2.3 必讀文檔來源

層B 需要知道「哪些文檔是必讀的」。來源（v3.1 修正：僅 config_read_state；dispatch payload 無 `required_readings` 字段）：

1. **config_read_state 中已 attested 的文檔列表**——Agent 在 read_attest 階段（config_read_attest.ts）已聲明讀過的配置，以 sessionID 為鍵隔離
2. **回退**：如果該 session 在 config_read_state 無記錄，跳過層B（向後兼容）

> **v3.1 註記**：v3.0 方案曾提出在 dispatch payload 新增 `required_readings` 字段（由 @Meta-Planner 在 Task.DAG.json 生成時聲明必讀文檔）。2026-06-27 源碼驗證發現 `DispatchQueueEntry` 接口（dispatch-db.ts:45）與 `validateDispatchPayload`（execution-checklist.ts:1140）均無此字段。本方案暫不引入此擴展，留待後續 Task.DAG 版本升級時再議。

### 2.4 層C：為什麼在 uc7ks-after.ts 而非新插件

| 維度 | 新建 tool-audit-after.ts | 擴展 uc7ks-after.ts |
|------|--------------------------|---------------------|
| Layout Architecture | ❌ 新增文件 + opencode.json 註冊 | ✅ 修改已有插件，不新增文件 |
| 職責內聚 | 工具審計是跨切面關注 | webfetch/websearch/context7 本身就是 UC7KS 知識獲取工具（uc7ks-utils.ts:237-248 `CORE_EXTERNAL_TOOLS`） |
| 現有先例 | 無 | uc7ks-after.ts 已有按 `input.tool` 分支處理的模式（L63 read、L142 WRITE_TOOLS） |
| 失敗檢測模式 | 需新引入 | ✅ 複用 task-after.ts:34 `output?.error \|\| output?.failed` 先例 |
| 改動範圍 | 大（新文件 + 註冊 + 測試） | 小（uc7ks-after.ts 新增一個分支） |

**結論**：擴展 uc7ks-after.ts。webfetch/websearch 是 `CORE_EXTERNAL_TOOLS` 成員（uc7ks-utils.ts:241-242），屬於 UC7KS 管道範疇，在 uc7ks-after.ts 中追蹤是職責內聚的。

### 2.5 層D：為什麼用「僅有失敗記錄→阻斷」而非「必須有成功獲取」

層D 的核心設計決策是三態判定而非簡單的「必須有成功 fetch」：

| tool_audit_state 狀態 | 層D 行為 | 理由 |
|------------------------|----------|------|
| 有 ≥1 次成功的外部獲取 | ✅ 放行 | KC 確實從外部獲取了內容，溯源鏈完整 |
| 僅有失敗記錄（無成功） | ❌ strict/locked 阻斷 | **KC 試過 webfetch 失敗、現在直接寫入 → 疑似用 LLM 推斷編造**（§0.6 場景） |
| 無任何外部獲取嘗試 | ✅ 放行 | 可能是 curated 內容（KnowledgeFile.source="curated"，knowledge-store.ts:34）或從已有緩存編譯，不強制要求 fetch |

**為何不要求「每次寫入都必須有成功 fetch」**：KC 的合法場景包括（1）從已有緩存編譯彙總文件、（2）寫入 curated 內容、（3）修復現有緩存文件。這些場景不需要外部 fetch，強制要求會產生 false positive。

**為何「僅有失敗→阻斷」就足夠**：§0.6 的 KC webfetch 隱瞞場景的特徵是「KC 調用了 webfetch 並失敗，然後直接寫入」。層C 會記錄失敗，層D 在寫入前檢測到「有失敗但無成功」→ 阻斷。這精準命中問題場景，不影響合法的 curated 場景。

### 2.6 層E：為什麼只在有失敗時才要求 ## Tool Failures

層E 的向後兼容設計：

- **無失敗記錄** → 不要求 `## Tool Failures` 段（現有 HANDOVER 格式不變）
- **有失敗記錄** → 必須在 HANDOVER.md 含 `## Tool Failures` 段，且條目數 ≥ tool_audit_state 中的失敗數

這確保：Agent 若有工具失敗就必須披露，無失敗則無額外負擔。submit 時交叉驗證 tool_audit_state 與 HANDOVER 內容，防止「有失敗但隱瞞」。

---

## 3. 實施方案

### 3.1 文件變更清單

| 文件 | 操作 | 說明 | 層 |
|------|------|------|----|
| `.opencode/lib/execution-checklist.ts` | **修改** | `required_logs_checked`（L251-255）的 verifier 改為 `"read_audit cross-check"`；新增 `tool_failures_disclosed` 項 | A, E |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | **修改** | `enforceMultiSourceAudit()`（L2300）中新增層A read_audit 交叉驗證 + 層E tool failure 交叉驗證 | A, E |
| `.opencode/plugins/scope-before.ts` | **修改** | config_read_attest（L348）後新增層B；UC7-005（L402）後新增層D KC 溯源檢查 | B, D |
| `.opencode/plugins/uc7ks-after.ts` | **修改** | 新增 TRACKED_TOOLS 分支，記錄 webfetch/websearch 成敗到 tool_audit_state | C |
| `.opencode/lib/substate-types.ts` | **修改** | 新增 `ToolAuditState` 接口 + `tool_audit_state` 鍵到 SubStateMap（第 15 個子狀態；G-7 新增 `diagnostic_baseline` 後計數為 14 → 15） | C |
| `.opencode/lib/knowledge-store.ts` | **修改** | `KnowledgeFile` 接口新增 `verification_status?: "verified" \| "inferred"` 字段 | D |
| `.opencode/lib/read-audit.ts` | **無需修改** | `verifyNonEmptyReadSet()` 已存在（L520-606），直接複用 | A, B |

### 3.2 層A：Submit-time read_audit 交叉驗證

在 `compliance-gate.ts` 的 `enforceMultiSourceAudit()`（或 `submitDeliverables` 中調用它之處）插入：

```typescript
// ── Layer A: read_audit Cross-Check (v2.0) ──
// 從 HANDOVER.md 解析 ## Logs Checked 段，提取文件路徑
const handoverPath = path.join(taskTempDir, "HANDOVER.md");
const handoverContent = fs.readFileSync(handoverPath, "utf8");

// 解析 ## Logs Checked 段中的文件路徑（每行一個路徑或 markdown 連結）
const logsSection = handoverContent.match(
  /##\s+Logs\s+Checked[\s\S]*?(?=\n##\s|$)/i
);
if (!logsSection) {
  return { status: "failed", reason: "HANDOVER.md missing ## Logs Checked section" };
}

// 提取文件路徑（支持 `- path` 或 `[text](path)` 格式）
const loggedPaths: string[] = [];
for (const line of logsSection[0].split("\n")) {
  const mdLink = line.match(/\[.+?\]\((.+?)\)/);
  const plainPath = line.match(/^\s*[-*]\s+(.+)/);
  const extracted = mdLink?.[1] || plainPath?.[1];
  if (extracted && extracted.trim()) loggedPaths.push(extracted.trim());
}

if (loggedPaths.length < 2) {
  return { status: "failed", reason: "## Logs Checked needs >=2 entries" };
}

// 交叉驗證：這些文件是否真的被 read() 過
const { verifyNonEmptyReadSet } = require("../lib/read-audit");
const readResult = verifyNonEmptyReadSet({
  agent: agentName,
  sessionId: sessionId,
  filePaths: loggedPaths,
});

if (!readResult.verified) {
  writeLog("mcp-compliance-gate", "ERROR", {
    sessionID: sessionId,
    agent: agentName,
    event: "LOG-AUDIT-CROSSCHECK-FAILED",
    detail: `HANDOVER lists ${loggedPaths.length} logs but ${readResult.notRead.length} not read: ${readResult.notRead.slice(0, 5).join(", ")}`,
  });
  return {
    status: "recoverable",
    reason: `Log audit cross-check failed. Agent claimed to have read ${loggedPaths.length} log(s) in HANDOVER.md but ${readResult.notRead.length} were never actually read(): ${readResult.notRead.slice(0, 5).join(", ")}. Read the listed logs and retry.`,
  };
}

writeLog("mcp-compliance-gate", "INFO", {
  sessionID: sessionId,
  agent: agentName,
  event: "LOG-AUDIT-CROSSCHECK-PASS",
  detail: `All ${loggedPaths.length} listed logs verified in read_audit`,
});
```

### 3.3 層B：Pre-write 必讀文檔閘門

在 `scope-before.ts` 的 config_read_attest pre-gate（L348）之後、UC7-001（L351）之前插入：

```typescript
// ═══════════════════════════════════════════════════════════════
// Layer B: Required Readings Pre-Write Gate (v2.0, v3.1 修正)
// Verifies that the agent has actually read() the task's required
// readings before allowing any write operation.
// Pattern: same as config_read_attest pre-gate above (L293-348).
// Uses verifyNonEmptyReadSet() from read-audit.ts (synchronous SQLite).
// read_audit is written by read-track-after.ts (after-hook), so this
// before-hook only sees previously completed reads — which is correct
// (we verify past reads, not the in-flight one).
// v3.1: 僅依賴 config_read_state.sessions[sid].files（即 attested_files）；
// dispatch payload 無 required_readings 字段，故移除此來源。
// ═══════════════════════════════════════════════════════════════
try {
  const { verifyNonEmptyReadSet } = require("../lib/read-audit");

  // 從 config_read_state 提取已 attested 的文件列表作為必讀驗證集
  const configReadState = readSubState("config_read_state");
  const mySession = configReadState?.sessions?.[input.sessionID];
  const requiredReadings: string[] = mySession?.files || [];

  if (requiredReadings.length > 0) {
    const readResult = verifyNonEmptyReadSet({
      agent: agent,
      sessionId: input.sessionID,
      filePaths: requiredReadings,
    });

    if (!readResult.verified) {
      if (mode === "strict" || mode === "locked") {
        const msg =
          `[FW-ENFORCE][REQUIRED-READINGS] Agent has not read ` +
          `${readResult.notRead.length} required document(s): ` +
          `${readResult.notRead.slice(0, 3).join(", ")}. ` +
          `Read them using the 'read' tool BEFORE writing code.`;
        writeLog("scope-before", "ERROR", {
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
          event: "REQUIRED-READINGS-BLOCK",
          detail: `BLOCKED | notRead=${readResult.notRead.slice(0, 3).join(",")}`,
        });
        throw new Error(msg);
      }
      // advisory: warn only
      writeLog("scope-before", "WARN", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent,
        agentType: agent,
        event: "REQUIRED-READINGS-SKIPPED-ADVISORY",
        detail: `notRead=${readResult.notRead.slice(0, 3).join(",")} — advisory mode, allowing writes`,
      });
    }
  }
} catch (e: any) {
  if (e.message?.startsWith("[FW-ENFORCE]")) throw e;
  writeLog("scope-before", "ERROR", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    event: "REQUIRED-READINGS-CHECK-ERROR",
    detail: e.message?.substring(0, 200),
  });
}
```

### 3.4 execution-checklist.ts 修改

```typescript
// L242-245 修改前:
{
  key: "required_logs_checked",
  verifier: "submit gate + file evidence",
  remediation:
    "Ensure HANDOVER.md has ## Logs Checked section with at least 2 entries.",
},

// 修改後:
{
  key: "required_logs_checked",
  verifier: "read_audit cross-check",
  remediation:
    "Ensure HANDOVER.md has ## Logs Checked section with at least 2 entries. " +
    "Each listed log file MUST have been actually read() by the agent — " +
    "verified against the read_audit SQLite table at submit time.",
},
```

### 3.5 Enforcement Mode 整合

| 層 | advisory 模式 | strict 模式 | locked 模式 |
|----|---------------|-------------|-------------|
| 層A (submit cross-check) | 僅 log warning | recoverable | recoverable |
| 層B (pre-write readings) | 僅 log warning | throw 阻斷 | throw 阻斷 |
| 層C (tool call audit) | 記錄到 tool_audit_state（總是執行） | 同左 | 同左 |
| 層D (KC provenance gate) | 僅 log warning | throw 阻斷 | throw 阻斷 |
| 層E (tool failure disclosure) | 僅 log warning | recoverable | recoverable |

### 3.6 層C：Tool Call Audit（uc7ks-after.ts 新增分支）

在 `uc7ks-after.ts` 的 `toolExecuteAfter()` 函數開頭（L57 之後、L62 read 分支之前）新增：

```typescript
// ═══════════════════════════════════════════════════════════════
// Layer C: Tool Call Audit (v3.0)
// Tracks webfetch/websearch/context7/github_* calls and their
// success/failure outcome. Persists to tool_audit_state substate.
// Failure detection reuses task-after.ts:34 pattern:
//   output?.error || output?.failed
// Note: SDK index.d.ts:249-258 after-hook output type declares
// {title, output, metadata} but runtime also provides error/failed
// (proven by task-after.ts:34 accessing output?.error successfully).
// ═══════════════════════════════════════════════════════════════
const TRACKED_TOOLS = new Set([
  "webfetch", "websearch",
  "context7", "context7_resolve-library-id", "context7_query-docs",
  "github_get_file_contents", "github_search_code",
  "github_search_repositories", "github_search_issues",
]);

if (TRACKED_TOOLS.has(input.tool)) {
  const rawAgent = resolveAgent(input.sessionID);
  const agent = normalizeAgentKey(rawAgent);
  const outcome = output?.error || output?.failed ? "FAILURE" : "SUCCESS";
  const errorMsg = (output?.error || output?.failed || "").toString().substring(0, 300);

  writeLog("uc7ks-after", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    event: "TOOL-AUDIT-RECORDED",
    level: outcome === "FAILURE" ? "WARN" : "INFO",
    detail: `tool=${input.tool} | outcome=${outcome} | agent=${agent}` +
      (outcome === "FAILURE" ? ` | error=${errorMsg}` : ""),
  });

  if (outcome === "FAILURE") {
    writeLog("uc7ks-after", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      level: "ERROR",
      event: "TOOL-AUDIT-FAILURE",
      detail: `tool=${input.tool} | error=${errorMsg} | agent=${agent}`,
    });
  }

  // Persist to tool_audit_state substate
  try {
    atomicWriteSubState("tool_audit_state", (state) => {
      state.sessions = state.sessions || {};
      state.sessions[input.sessionID] = state.sessions[input.sessionID] || {
        agent: agent,
        tool_calls: [],
      };
      state.sessions[input.sessionID].tool_calls.push({
        tool: input.tool,
        outcome: outcome,
        timestamp: new Date().toISOString(),
        callID: input.callID,
        error: outcome === "FAILURE" ? errorMsg : undefined,
      });
      // Cap at 200 entries per session to prevent unbounded growth
      if (state.sessions[input.sessionID].tool_calls.length > 200) {
        state.sessions[input.sessionID].tool_calls =
          state.sessions[input.sessionID].tool_calls.slice(-200);
      }
    });
  } catch (err: any) {
    writeLog("uc7ks-after", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      level: "ERROR",
      event: "TOOL-AUDIT-STATE-FAIL",
      detail: `tool_audit_state write failed: ${err.message}`,
    });
  }
}
```

### 3.7 層D：Knowledge Cache Provenance Gate（scope-before.ts 新增檢查）

在 `scope-before.ts` 的 UC7-005 size cap（L402）之後、`} // end for each scopePath`（L404）之前新增：

```typescript
// ═══════════════════════════════════════════════════════════════
// Layer D: Knowledge Cache Provenance Gate (v3.0)
// When KC writes to docs/official_docs/, verify that there is at
// least one successful external fetch in tool_audit_state for this
// session. If only failures exist (no success), block — KC likely
// fabricated content via LLM inference after fetch failure (§0.6).
// Three-state logic: success→allow, only-failures→block, no-attempts→allow
// ═══════════════════════════════════════════════════════════════
if (scopePath.includes("docs/official_docs/")) {
  const agentNorm = (agent || "").toLowerCase().replace(/^@/, "");
  if (agentNorm === "knowledge-curator") {
    try {
      const toolAuditState = readSubState("tool_audit_state");
      const mySession = toolAuditState?.sessions?.[input.sessionID];
      const calls = mySession?.tool_calls || [];

      const hasSuccess = calls.some((c: any) => c.outcome === "SUCCESS");
      const hasFailure = calls.some((c: any) => c.outcome === "FAILURE");

      // Only-failures (no success) → suspected fabrication
      if (hasFailure && !hasSuccess) {
        const failedTools = calls
          .filter((c: any) => c.outcome === "FAILURE")
          .map((c: any) => c.tool)
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
        const msg =
          `[FW-ENFORCE][PROVENANCE-GATE] KC is writing to ` +
          `docs/official_docs/ but all external fetch attempts failed ` +
          `(${failedTools.join(", ")}). Content likely fabricated via ` +
          `LLM inference. Retry the fetch, use websearch/context7 as ` +
          `fallback, or explicitly mark source as "curated" in the ` +
          `file metadata.`;
        writeLog("scope-before", "runtime", {
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
          level: "ERROR",
          event: "PROVENANCE-BLOCK",
          detail: `BLOCKED | only-failures | tools=[${failedTools.join(",")}] | file=${scopePath}`,
        });
        if (mode === "strict" || mode === "locked") throw new Error(msg);
        // advisory: warn only
      }
    } catch (e: any) {
      if (e.message?.startsWith("[FW-ENFORCE]")) throw e;
      writeLog("scope-before", "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent,
        event: "PROVENANCE-CHECK-ERROR",
        detail: e.message?.substring(0, 200),
      });
    }
  }
}
```

### 3.8 層E：Tool Failure Disclosure（execution-checklist.ts + compliance-gate.ts）

**3.8.1 execution-checklist.ts 新增 checklist 項**（execute 階段，`required_logs_checked` 之後）：

```typescript
{
  key: "tool_failures_disclosed",
  verifier: "tool_audit cross-check",
  remediation:
    "If any tool call failed during this session (webfetch/websearch/etc), " +
    "HANDOVER.md must have ## Tool Failures section disclosing each failure. " +
    "Verified against tool_audit_state substate at submit time.",
},
```

**3.8.2 compliance-gate.ts 層E 交叉驗證**（在層A 交叉驗證之後）：

```typescript
// ── Layer E: Tool Failure Disclosure Cross-Check (v3.0) ──
const { readSubState } = require("../lib/substate-manager");
const toolAuditState = readSubState("tool_audit_state");
const mySession = toolAuditState?.sessions?.[sessionId];
const failedCalls = (mySession?.tool_calls || [])
  .filter((c: any) => c.outcome === "FAILURE");

if (failedCalls.length > 0) {
  // Parse ## Tool Failures section from HANDOVER.md
  const failuresSection = handoverContent.match(
    /##\s+Tool\s+Failures[\s\S]*?(?=\n##\s|$)/i
  );

  if (!failuresSection) {
    return {
      status: "recoverable",
      reason:
        `Tool failure disclosure missing. ${failedCalls.length} tool ` +
        `failure(s) recorded in tool_audit_state but HANDOVER.md has ` +
        `no ## Tool Failures section. Disclose each failure and retry.`,
    };
  }

  // Count disclosed entries (lines starting with - or *)
  const disclosedCount = failuresSection[0]
    .split("\n")
    .filter((l: string) => /^\s*[-*]\s+/.test(l)).length;

  if (disclosedCount < failedCalls.length) {
    return {
      status: "recoverable",
      reason:
        `Tool failure disclosure incomplete. ${failedCalls.length} ` +
        `failure(s) in tool_audit_state but only ${disclosedCount} ` +
        `disclosed in ## Tool Failures. Disclose all failures and retry.`,
    };
  }

  writeLog("mcp-compliance-gate", "INFO", {
    sessionID: sessionId,
    agent: agentName,
    event: "TOOL-FAILURE-DISCLOSURE-PASS",
    detail: `${failedCalls.length} tool failure(s) all disclosed in HANDOVER`,
  });
}
```

---

## 4. 日誌系統整合

### 4.1 日誌事件

| 事件 | 級別 | 來源插件 | 說明 | 層 |
|------|------|----------|------|----|
| `LOG-AUDIT-CROSSCHECK-PASS` | INFO | mcp-compliance-gate | submit 時所有列出的日誌均通過 read_audit 驗證 | A |
| `LOG-AUDIT-CROSSCHECK-FAILED` | ERROR | mcp-compliance-gate | submit 時發現捏造的日誌條目 | A |
| `REQUIRED-READINGS-BLOCK` | ERROR | scope-before | 寫入前必讀文檔未讀，阻斷 | B |
| `REQUIRED-READINGS-SKIPPED-ADVISORY` | WARN | scope-before | advisory 模式跳過阻斷 | B |
| `REQUIRED-READINGS-CHECK-ERROR` | ERROR | scope-before | 檢查過程異常 | B |
| `TOOL-AUDIT-RECORDED` | INFO/WARN | uc7ks-after | 外部工具調用已記錄（SUCCESS=INFO，FAILURE=WARN） | C |
| `TOOL-AUDIT-FAILURE` | ERROR | uc7ks-after | 外部工具調用失敗（webfetch/websearch 等） | C |
| `TOOL-AUDIT-STATE-FAIL` | ERROR | uc7ks-after | tool_audit_state 子狀態寫入失敗 | C |
| `PROVENANCE-BLOCK` | ERROR | scope-before | KC 寫入知識緩存但僅有失敗的外部獲取記錄，阻斷 | D |
| `PROVENANCE-CHECK-ERROR` | ERROR | scope-before | 溯源檢查過程異常 | D |
| `TOOL-FAILURE-DISCLOSURE-PASS` | INFO | mcp-compliance-gate | submit 時所有工具失敗均已披露 | E |
| `TOOL-FAILURE-DISCLOSURE-MISSING` | ERROR | mcp-compliance-gate | submit 時發現隱瞞的工具失敗 | E |

### 4.2 日誌規範

- 使用 `writeLog(plugin, category, fields)`（log-manager.ts:331）
- category 用 `"runtime"` 或大寫 LogLevel（`"ERROR"`/`"INFO"`/`"WARN"`），**不用小寫**（log-manager.ts:29,39；`format-after.ts` 的小寫 `"warn"` 是反模式，應遵循 `read-track-after.ts:58` 的 `"runtime"` + `level` 模式）
- fields 包含 `sessionID`、`callID`、`agent`、`event`、`detail`
- 輸出到 `.task_temp/_logs/{date}/plugin-scope-before-runtime.log`（層B/D）、`plugin-mcp-compliance-gate-runtime.log`（層A/E）、`plugin-uc7ks-after-runtime.log`（層C）
- 遵循日誌輪轉策略（100KB 輪轉，保留 3 個，3 天後 gzip，30 天後歸檔；log-rotator.ts:61-72）

---

## 5. 官方 OpenCode 規範合規

### 5.1 Plugin Hook 規範

| 規範 | 合規 | 證據 |
|------|------|------|
| `tool.execute.before` 簽名 | ✅ | `@opencode-ai/plugin` index.d.ts:235-241：`(input: {tool, sessionID, callID}, output: {args})` |
| args 讀取位置（before） | ✅ 用 `output.args` | 官方 spec：before-hook 的 args 在 output；tdd-before.ts:20 `output.args?.filePath` 先例 |
| `tool.execute.after` 簽名 | ✅ | `@opencode-ai/plugin` index.d.ts:249-258：`(input: {tool, sessionID, callID, args}, output: {title, output, metadata})` |
| args 讀取位置（after） | ✅ 用 `input.args` | 官方 spec：after-hook 的 args 在 input；uc7ks-after.ts:59 `getModifyPath(input.args || {})` 先例 |
| after-hook 成敗檢測 | ✅ `output?.error \|\| output?.failed` | SDK 類型聲明 output 僅含 `{title, output, metadata}`，但運行時提供 `error`/`failed`（task-after.ts:34 已驗證可訪問） |
| `withPluginLifecycle` 模式 | ✅ | scope-before.ts、uc7ks-after.ts 已使用；hook-lifecycle.ts:13 |
| `export default` | ✅ | scope-before.ts、uc7ks-after.ts 已使用 |
| `[FW-ENFORCE]` 拋出守衛 | ✅ | checklist-before.ts:422 重新拋出 `[FW-ENFORCE]` 前綴錯誤；scope-before.ts 同模式 |

### 5.2 DB 規範

| 規範 | 合規 | 證據 |
|------|------|------|
| read_audit 在 SQLite | ✅ | db-manager.ts:649-661（substate_kv / read_audit 表） |
| 同步 DB 讀取 | ✅ | getDb() 同步（db-manager.ts:90）；tdd-before.ts:26 先例 |
| 無 JSON 雙寫 | ✅ | read_audit 自 Phase 2 起僅 SQLite（read-audit.ts:9-11） |
| WAL 模式 | ✅ | db-manager.ts:114 `journal_mode=WAL` |

### 5.3 read_audit 時序分析

```
Agent 調用 read(tool) → tool.execute.after → read-track-after.ts:49 recordRead() → read_audit 表
                                                                          ↓
Agent 調用 safe_edit(tool) → tool.execute.before → scope-before.ts → verifyNonEmptyReadSet()
                                                      ↑
                                          只能看到先前已完成的 read 記錄（正確行為）
```

- read 記錄在 **after-hook**（read-track-after.ts:49），不是 before-hook
- before-hook 中的 `verifyNonEmptyReadSet()` 只能驗證**先前已完成**的讀取
- 這正是所需行為：驗證「Agent 在寫代碼前是否已讀過必讀文檔」

---

## 6. 子系統合規矩陣

| 子系統 | 合規 | 說明 |
|--------|------|------|
| **Layout Architecture** | ✅ | 層A/E 修改 compliance-gate.ts（已有邏輯）；層B/D 修改 scope-before.ts（已有插件）；層C 擴展 uc7ks-after.ts（已有插件）；層C 新增 tool_audit_state 到 substate-types.ts（已有文件）；層D 新增 verification_status 到 knowledge-store.ts（已有文件）。**不新增文件**——所有變更都在已有文件中 |
| **DB-only / DB-canonical** | ✅ | read_audit 在 SQLite 表（db-manager.ts:649）；tool_audit_state 在 substate_kv SQLite 表（substate-manager.ts 統一管理）；無 JSON 雙寫；verifyNonEmptyReadSet 直接查 SQLite |
| **Permission Matrix** | ✅ | 不引入新權限；層A/B 複用 `verifyNonEmptyReadSet()`（read-audit.ts:520）；層C 複用 `atomicWriteSubState()`（state-utils.ts:287）；層D 複用 `readSubState()`（substate-manager.ts:45）；讀取操作無權限變更 |
| **Session/Concurrency Safe** | ✅ | read_audit 查詢按 agent+sessionId+timestamp（read-audit.ts:314-330）；tool_audit_state 按 sessions[sessionID] 隔離（同 config_read_state/KnowledgeCacheState 模式）；atomicWriteSubState 提供 SQLite 事務級原子寫；SQLite WAL + busy_timeout=5000（db-manager.ts:116-118）；不同 Agent 不同 session 不衝突 |
| **Hardened Enforcement** | ✅ | 五層閘門遵循 advisory/strict/locked 模式（同 config_read_attest pre-gate 模式）；層B/D 用 `[FW-ENFORCE][REQUIRED-READINGS]`/`[FW-ENFORCE][PROVENANCE-GATE]` 前綴；層A/E 返回 recoverable；`[FW-ENFORCE]` 前綴保證 catch 守衛正確重新拋出 |
| **Framework Harness** | ✅ | 層B/D 在 scope-before.ts 的 `tool.execute.before` hook 中（同 tdd-before.ts 模式）；層C 在 uc7ks-after.ts 的 `tool.execute.after` hook 中（同 task-after.ts 模式）；用 `withPluginLifecycle` 標準模式；同步 SQLite/substate 讀取已驗證可行 |
| **Central State Management** | ✅ | 層B 用 `readSubState("config_read_state")`（substate-manager.ts:45）；層C/D 用 `readSubState("tool_audit_state")` + `atomicWriteSubState("tool_audit_state", fn)`；層A 用 `verifyNonEmptyReadSet()`（read-audit.ts:520）；tool_audit_state 是第 15 個子狀態（substate-types.ts SubStateMap，因 G-7 新增 `diagnostic_baseline`） |
| **Multi-Agent** | ✅ | read_audit 按 agent 隔離（read-audit.ts:314-330 `WHERE agent = ?`）；tool_audit_state 按 sessions[sessionID] 隔離（同 KnowledgeCacheState.session_access 模式）；層D 僅對 agentNorm === "knowledge-curator" 生效，不影響其他 Agent 的寫入 |
| **Log Central Management** | ✅ | 使用 `writeLog()` 統一日誌系統（log-manager.ts:339）；含 sessionID/callID/agent/event/level；12 個日誌事件覆蓋層A-E（§4.1）；遵循日誌輪轉策略 |
| **DB-canonical Management** | ✅ | read_audit 是 SQLite 表，無 JSON fallback 讀取路徑（read-audit.ts:9-11 Phase 2 後 JSONL 僅讀）；tool_audit_state 由 substate-manager 統一管理（substate_kv SQLite 表），無獨立 JSON 文件 |
| **Templatization & Parameterization** | ✅ | 必讀文檔列表來自 config_read_state（可配置）；TRACKED_TOOLS 可從 project.config.json 的 uc7ks_external_tools 擴展（uc7ks-utils.ts:254-269）；enforcement mode 通過 `getEnforcementMode()` 統一獲取；tool_audit_state 條目上限 200 可配置 |
| **TypeScript + Bun Runtime** | ✅ | 純 TypeScript；同步 SQLite（better-sqlite3 風格）；Bun 原生支持 `require()` 和 `readSubState`/`atomicWriteSubState`；KnowledgeFile.verification_status 是可選字段（向後兼容） |

---

## 7. 風險與緩解

| 風險 | 緩解 |
|------|------|
| 層B 在無 required_readings 時跳過 | 向後兼容：`config_read_state.sessions[sid].files`（`ConfigReadSessionEntry.files`）為空 → 跳過層B |
| read_audit 時間窗口（默認 5 分鐘） | `verifyRead` 默認 windowMs=300000（read-audit.ts:298）；長任務可配置；submit 時窗口可放寬 |
| 路徑不匹配（相對 vs 絕對） | HANDOVER 中可能用相對路徑，read_audit 存絕對路徑；需在層A 做路徑規範化（`path.resolve`） |
| read_audit 表容量上限 | MAX_RECORDS=10000（read-audit.ts:65），有 `DELETE` 清理；不影響驗證（近期記錄保留） |
| 層B/D 性能（每次寫入都查 SQLite/substate） | `verifyNonEmptyReadSet` 是索引查詢（idx_read_audit_lookup: agent, file_path, timestamp）；通常 <1ms；`readSubState` 是 substate_kv 單行查詢；且只在 isModifyTool 時觸發 |
| scope-before.ts 已有 5+ 檢查 | 層B 置於 config_read_attest 之後、UC7-001 之前；層D 置於 UC7-005 之後；不影響現有檢查順序 |
| tool_audit_state 容量增長 | 每 session 上限 200 條（§3.6 代碼 slice(-200)）；同 KnowledgeAuditState.recent_events 100 條模式；substate_kv 單行存儲 |
| 層D false negative：curated 內容被誤阻 | 三態判定設計（§2.5）：無外部獲取嘗試 → 放行；僅有失敗 → 阻斷。curated 場景無 webfetch 調用 → 放行。不影響 curated |
| 層D false positive：websearch 成功但 webfetch 失敗 | 三態判定：有 ≥1 次成功 → 放行。websearch 成功即可證明 KC 有真實外部獲取，webfetch 失敗不觸發阻斷 |
| after-hook output 類型聲明不完整 | SDK index.d.ts:249-258 僅聲明 `{title, output, metadata}`，但 `error`/`failed` 運行時存在（task-after.ts:34 先例）。用 `output?.error` 可選鏈 + `?.failed` 防禦性訪問，undefined 時視為 SUCCESS |
| KC 豁免寫入閘門（uc7ks-utils.ts:457） | 層D 不改動 KC 豁免本身，而是在 scope-before.ts 的 `docs/official_docs/` 寫入路徑中新增獨立溯源檢查。KC 仍可寫入，但必須有成功的外部獲取先例（或無任何失敗嘗試） |
| 層E HANDOVER 格式不統一 | 僅在有失敗記錄時才要求 `## Tool Failures` 段（§2.6）；無失敗 → 不要求；向後兼容現有 HANDOVER 格式 |

---

## 8. 實施順序

1. **Step 1**: 修改 `substate-types.ts` — 新增 `ToolAuditState` 接口 + `tool_audit_state` 鍵到 SubStateMap（第 15 個子狀態；第 14 個 `diagnostic_baseline` 已由 G-7 於 2026-06-27 加入）；同步更新 `substate-manager.ts` 的 `SUBSTATE_FILES`
2. **Step 2**: 修改 `knowledge-store.ts` — `KnowledgeFile` 接口新增 `verification_status?: "verified" | "inferred"` 字段
3. **Step 3**: 修改 `execution-checklist.ts:251-255` — 更新 `required_logs_checked` 的 verifier；新增 `tool_failures_disclosed` 項
4. **Step 4**: 修改 `uc7ks-after.ts` — 新增 TRACKED_TOOLS 分支（層C），記錄 webfetch/websearch 成敗到 tool_audit_state
5. **Step 5**: 修改 `scope-before.ts` — config_read_attest（L348）後新增層B；UC7-005（L402）後新增層D KC 溯源檢查
6. **Step 6**: 修改 `compliance-gate.ts` — enforceMultiSourceAudit（L2300）中新增層A read_audit 交叉驗證 + 層E tool failure 交叉驗證
7. **Step 7**: 驗證層A — 故意在 HANDOVER 捏造日誌條目 → submit 返回 recoverable
8. **Step 8**: 驗證層B — 不讀必讀文檔就 safe_edit → strict 模式被阻斷
9. **Step 9**: 驗證層C — 調用 webfetch 並使其失敗 → tool_audit_state 有 FAILURE 記錄
10. **Step 10**: 驗證層D — KC webfetch 失敗後直接寫 docs/official_docs/ → strict 模式被阻斷（PROVENANCE-BLOCK）
11. **Step 11**: 驗證層D 三態 — KC 無 webfetch 調用直接寫 curated 內容 → 放行（不誤阻）
12. **Step 12**: 驗證層E — 有工具失敗但 HANDOVER 無 `## Tool Failures` 段 → submit 返回 recoverable
13. **Step 13**: 回歸驗證 — config_read_attest 流程不受影響；UC7-001 流程不受影響；UC7-003 流程不受影響

---

## 9. 驗證計劃

### 9.1 層A 驗證

- [ ] HANDOVER 有 `## Logs Checked` + 2 行，且文件確實被 read() 過 → submit 通過
- [ ] HANDOVER 有 `## Logs Checked` + 2 行，但文件未被 read() → submit 返回 recoverable
- [ ] HANDOVER 無 `## Logs Checked` 段 → submit 返回 failed
- [ ] HANDOVER 有段但 <2 行 → submit 返回 failed
- [ ] 路徑規範化：HANDOVER 用相對路徑，read_audit 存絕對路徑 → 正確匹配

### 9.2 層B 驗證

- [ ] config_read_state 有 files，Agent 未讀 → strict/locked 阻斷 safe_edit
- [ ] config_read_state 有 files，Agent 已讀 → safe_edit 放行
- [ ] config_read_state 無 files → 跳過層B，safe_edit 放行（向後兼容）
- [ ] advisory 模式 → 僅 log warning，不阻斷
- [ ] 不同 Agent / 不同 session 的 files 互不影響

### 9.3 回歸驗證

- [ ] config_read_attest pre-gate 仍正常工作
- [ ] UC7-001 knowledge-cache-before-write 仍正常工作
- [ ] UC7-003 post-write verification 仍正常工作
- [ ] UC7-005 size cap 仍正常工作
- [ ] checklist-before.ts 階段阻斷不受影響
- [ ] read-track-after.ts 記錄不受影響

### 9.4 層C 驗證

- [ ] Agent 調用 webfetch 成功 → tool_audit_state 有 SUCCESS 記錄
- [ ] Agent 調用 webfetch 失敗 → tool_audit_state 有 FAILURE 記錄，含 errorMsg
- [ ] Agent 調用 websearch → tool_audit_state 有記錄（TRACKED_TOOLS 命中）
- [ ] Agent 調用 read/safe_edit（非 TRACKED_TOOLS）→ tool_audit_state 不新增記錄
- [ ] 不同 session 的 tool_calls 互不影響（sessions 按 sessionID 隔離）
- [ ] tool_audit_state 條目超過 200 → 自動 slice(-200) 保留最近 200 條

### 9.5 層D 驗證

- [ ] KC webfetch 成功後寫 docs/official_docs/ → 放行（有 SUCCESS 先例）
- [ ] KC webfetch 失敗後寫 docs/official_docs/ → strict/locked 阻斷（PROVENANCE-BLOCK）
- [ ] KC 無任何 webfetch 調用直接寫 curated 內容 → 放行（三態：無嘗試 → 放行）
- [ ] KC webfetch 失敗 + websearch 成功後寫 docs/official_docs/ → 放行（有 ≥1 SUCCESS）
- [ ] 非 KC Agent 寫 docs/official_docs/ → 層D 不觸發（agentNorm !== "knowledge-curator"）
- [ ] advisory 模式 → 僅 log warning，不阻斷

### 9.6 層E 驗證

- [ ] tool_audit_state 有 2 條 FAILURE，HANDOVER 有 `## Tool Failures` + 2 行 → submit 通過
- [ ] tool_audit_state 有 2 條 FAILURE，HANDOVER 無 `## Tool Failures` 段 → submit 返回 recoverable
- [ ] tool_audit_state 有 2 條 FAILURE，HANDOVER 有段但僅 1 行 → submit 返回 recoverable（披露不完整）
- [ ] tool_audit_state 無 FAILURE 記錄 → 跳過層E，submit 不受影響（向後兼容）
- [ ] advisory 模式 → 僅 log warning，不阻斷 submit

---

## 10. 版本對比

| 維度 | v1.0 | v2.0 | v3.0 | v3.1（2026-06-27 校準） |
|------|------|------|------|--------------------------|
| 層A 檢查時機 | approve 時 | submit 時（更早） | submit 時（同 v2.0） | 同 v3.0 |
| 層A 驗證方式 | HANDOVER 有表格就行 | 對照 read_audit 表確認真實讀取 | 同 v2.0 | 同 v3.0 |
| 層B 寫入前阻斷 | 無 | scope-before.ts per-write 檢查 | 同 v2.0 | 同 v3.0；來源僅 `config_read_state.files` |
| 層B 機制 | 無 | verifyNonEmptyReadSet()（同 READ-BEFORE-APPROVE 模式） | 同 v2.0 | 移除 dispatch payload `required_readings`（代碼中不存在） |
| 捏造防護 | ❌ 無 | ✅ read_audit 交叉驗證 | ✅ 同 v2.0 | 同 v3.0 |
| 層C 工具調用審計 | 無 | 無 | ✅ uc7ks-after.ts 追蹤 webfetch/websearch 成敗到 tool_audit_state | 同 v3.0；tool_audit_state 為第 15 個 substate |
| 層D 知識緩存溯源門 | 無 | 無 | ✅ scope-before.ts 三態判定：僅有失敗→阻斷 | 同 v3.0；插入點 L402-404 |
| 層E 工具失敗披露 | 無 | 無 | ✅ HANDOVER `## Tool Failures` 段 + submit 時交叉驗證 tool_audit_state | 同 v3.0 |
| KC webfetch 隱瞞防護 | ❌ 無 | ❌ 無 | ✅ 層C 記錄失敗 + 層D 阻斷編造寫入 + 層E 強制披露 | 同 v3.0 |
| SubStateMap 計數 | 12 | 13（+config_read_state） | 14（計畫新增 tool_audit_state） | 15（+diagnostic_baseline 已於 G-7 加入；tool_audit_state 為第 15 個） |

---

_參考_:

- `.opencode/lib/execution-checklist.ts`（PHASE_ITEMS, required_logs_checked L251-255, tool_failures_disclosed 待新增）
- `.opencode/plugins/checklist-before.ts`（PHASE_ORDER L276-284, 阻斷邏輯 L384-421, [FW-ENFORCE] re-throw L416）
- `.opencode/plugins/scope-before.ts`（config_read_attest pre-gate L293-348, UC7-001 L351, UC7-005 L383-402, Layer B 插入點 L348 之後, Layer D 插入點 L402-404）
- `.opencode/plugins/tdd-before.ts`（before-hook 同步 SQLite 先例 L26）
- `.opencode/plugins/read-track-after.ts`（read_audit 寫入 L49）
- `.opencode/plugins/task-after.ts`（after-hook 成敗檢測先例 L34 `output?.error || output?.failed`）
- `.opencode/plugins/uc7ks-after.ts`（UC7-003 post-write verification L172, 層C TRACKED_TOOLS 分支建議插入點 L57-63）
- `.opencode/lib/read-audit.ts`（verifyRead L298-364, verifyNonEmptyReadSet L520-606）
- `.opencode/lib/log-manager.ts`（writeLog L339, LogCategory L39, LogLevel L29, normalizeCategory L125-129）
- `.opencode/lib/hook-lifecycle.ts`（withPluginLifecycle L13）
- `.opencode/lib/db-manager.ts`（read_audit 表 schema L649-661, getDb, WAL mode L114, busy_timeout L117）
- `.opencode/lib/state-utils.ts`（atomicWriteSubState L287）
- `.opencode/lib/uc7ks-utils.ts`（CORE_EXTERNAL_TOOLS L237-248, KC 寫入豁免 L457, getExternalTools L254-269）
- `.opencode/lib/knowledge-store.ts`（KnowledgeFile 接口 L30-51, verification_status 待新增）
- `.opencode/lib/substate-types.ts`（SubStateMap L259-277 含 14 個現有子狀態；ToolAuditState 待新增為第 15 個；ConfigReadSessionEntry.files 為 Layer B 必讀集來源）
- `.opencode/lib/substate-manager.ts`（readSubState L45, SUBSTATE_FILES）
- `.opencode/scripts/mcp-tools/compliance-gate.ts`（enforceMultiSourceAudit L2300, ## Logs Checked regex L2364, READ-BEFORE-APPROVE L2655-2744）
- `@opencode-ai/plugin` SDK `index.d.ts`（Hooks 接口 L173-317, tool.execute.before L235-241, tool.execute.after L249-258；注意 after-hook output 類型未聲明 error/failed 但運行時提供）
