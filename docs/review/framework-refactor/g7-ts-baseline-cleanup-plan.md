# G-7 TypeScript 基線清理 — 具體作業方案

**日期**: 2026-06-27
**狀態**: 待執行
**參考文檔**:
- `docs/review/framework-refactor/lsp-diagnostic-gate-e2e-acceptance-gaps.md` §G-7
- `docs/review/framework-refactor/lsp-diagnostic-gate-implementation-plan.md`
- `docs/review/framework-refactor/framework-tsc-tdd-feasibility-analysis-20260626.md`
- `.opencode/plugins/tsc-diag-track.ts`
- `.opencode/lib/tsc-diagnostic.ts`
- `.opencode/lib/substate-types.ts`

---

## 0. 執行摘要

LSP diagnostic gate 的 E2E 驗收在 `lsp-diagnostic-gate-e2e-acceptance-gaps.md` 的 G-7 揭示：`npx tsc --noEmit --pretty false` 目前輸出 **715 條** TS 錯誤，分佈在 `.opencode/` 下多個模組。若 LSP gate 每次寫入都以「全倉庫 tsc 必須為 0」為阻斷條件，gate 會被 baseline 噪聲污染、徹底喪失對新增錯誤的區分能力。

本方案實現 G-7 的四項具體作業：

| 作業項 | 目標 | 產物 |
|---|---|---|
| **J-1** | 捕獲當前 715 條 baseline 錯誤，存入 DB-canonical `diagnostic_baseline` substate | `.opencode/scripts/baseline-diagnostic.ts` + substate 註冊 |
| **J-2** | 改造 `tsc-diag-track.ts` LSP gate 為 baseline-diff 判定，只對 touched target 的新增 / 擴大錯誤阻斷 | `tsc-diag-track.ts`、`tsc-diagnostic.ts` 改造 |
| **J-3** | 清理 715 條 baseline 錯誤中的高價值目標（tests 頂層 const 衝突、rename export、過寬 any） | `.opencode/lib/__tests__/*.ts`、`scripts/*.ts` 等 |
| **J-4** | baseline refresh MCP 工具 + periodic auto-refresh + E2E 覆蓋 | `.opencode/scripts/mcp-tools/baseline-diagnostic.ts` + E2E |

---

## 1. 問題現況（量化證據）

### 1.1 全局錯誤分佈

執行 `npx tsc --noEmit --pretty false` 並按目錄桶計數：

| 目錄 | 錯誤數 | 佔比 |
|---|---:|---:|
| `scripts/` (不含 mcp-tools) | 417 | 58.3 % |
| `scripts/mcp-tools/` | 133 | 18.6 % |
| `lib/` (不含 __tests__) | 80 | 11.2 % |
| `plugins/` | 40 | 5.6 % |
| `tools/` | 25 | 3.5 % |
| `lib/__tests__/` | 20 | 2.8 % |
| **總計** | **715** | **100 %** |

### 1.2 錯誤碼分佈

| 錯誤碼 | 數量 | 含義 |
|---|---:|---|
| TS2339 | 291 | Property does not exist on type |
| TS2451 | 202 | Cannot redeclare block-scoped variable |
| TS2353 | 72 | Object literal may only specify known properties |
| TS2393 | 54 | Function declaration duplicates |
| TS2304 | 22 | Cannot find name |
| TS1117 | 19 | Object literal with duplicate property |
| TS2551 | 14 | Property does not exist, did you mean |
| TS2345 | 10 | Argument type mismatch |
| TS2552 | 7 | Cannot find name, did you mean |
| TS2554 / 2749 / 2561 / 2322 | 12 | 雜項 |

### 1.3 當前 gate 語義

`tsc-diag-track.ts:49-80` 的 `checkOneTarget()` 邏輯：

```ts
const diagState = readSubState("diagnostic_state");
const fileDiag = diagState?.files?.[absPath];
if (!fileDiag?.errors?.length) return;
// → 只要 touched file 有任何 error，即阻斷
```

`tsc-diagnostic.ts` 的 `runTscDiagnostic()` 提供三態（pass / target-errors / target_clean_project_dirty），但 **不區分 baseline 預存 vs 本次新增**。這導致：

- 若 baseline 已有 TS2451 在 `safe-bash-core.test.ts`，而本次改動完全不相關，gate 仍可能因 incremental tsc 重報相同錯誤而誤阻。
- 若 touched file 新增 1 條 TS2339 而原本就有 5 條 TS2339，gate 無法判斷錯誤數擴大。
- 若 touched file 乾淨但 project dirty，gate 雖不阻，但無法追蹤 baseline 是否漂移。

---

## 2. 解決方案架構

### 2.1 四層 baseline-diff 判定模型

| 層 | 判定條件 | 行為 |
|---|---|---|
| **L1** | touched target 新增 error（baseline 沒有、本次出現） | **block**（strict/locked 拋錯；advisory 僅 WARN） |
| **L2** | touched target 原有 error 數增加（同一 file，新增 > baseline 計數） | **block** |
| **L3** | touched target clean，但 project baseline 仍有舊 error | **不阻本次寫**，記 `target_clean_project_dirty` 到 `diagnostic_state.files[target]` 並把 dirty file count 寫入 baseline |
| **L4** | baseline hash 變化（`tsc --noEmit` 全量輸出 SHA-256 ≠ baseline hash）但 target clean | 記錄 `baseline_drift_detected`，建議人工 / CI 執行 baseline refresh；**不阻本次寫** |

### 2.2 DB-canonical 新增子狀態

新增 **`diagnostic_baseline`** 為第 14 個 substate（在 `substate-types.ts` 註冊，`SubStateMap` 追加）：

```ts
export interface DiagnosticBaselineEntry {
  file: string;                 // absolute path
  code: string;                 // "TS2451"
  message: string;              // 截斷至 200 chars
  line: number;
  character: number;
}

export interface DiagnosticBaseline {
  /** 全量 tsc 輸出的 SHA-256（pretty=false + sorted） */
  hash: string;
  /** 錯誤總數 */
  total_errors: number;
  /** 每桶（目錄）錯誤數 */
  bucket_counts: Record<string, number>;
  /** 完整 baseline 錯誤清單（已知預存） */
  errors: DiagnosticBaselineEntry[];
  /** baseline 產生時間 */
  captured_at: string;
  /** 產生 baseline 的 tsc 版本 */
  tsc_version: string;
  /** baseline 來源：manual / auto_refresh / task_id */
  source: string;
  [key: string]: any;
}
```

- 只存 SQLite `substate_kv`，**不寫 JSON 文件**（遵循 DB-only / DB-canonical）。
- `substate-manager.ts` 的 `SUBSTATE_FILES` 保留 legacy mapping：`diagnostic_baseline: "diagnostic-baseline.json"`（frozen snapshot 語義，只供人類參考）。

### 2.3 集成點

```
tsc-diag-track.ts (before + after hook)
       │
       ├── checkOneTarget()
       │      └── 調用 compareWithBaseline(targetErrors, baseline) → L1/L2 判定
       │
       └── afterWriteTscCheck()
              └── 調用 runTscDiagnostic() 三態 + recordProjectBaselineDrift()
                     └── 若 target clean 且 baseline hash 變化 → L4 記錄

baseline-diagnostic.ts (lib)
       └── captureBaseline() / compareWithBaseline() / recordBaselineDrift()

scripts/mcp-tools/baseline-diagnostic.ts (MCP tool)
       └── framework_capture_diagnostic_baseline(task_id, reason) → 寫 diagnostic_baseline
```

---

## 3. 檔案變動清單

| 檔案 | 層 | 變更類型 | 說明 |
|---|---|---|---|
| `.opencode/lib/substate-types.ts` | J-1 | 修改 | 新增 `DiagnosticBaseline` / `DiagnosticBaselineEntry` 介面；`SubStateMap` 追加 `diagnostic_baseline` key |
| `.opencode/lib/substate-manager.ts` | J-1 | 修改 | `SUBSTATE_FILES` 追加 `diagnostic_baseline: "diagnostic-baseline.json"`（frozen snapshot mapping） |
| `.opencode/lib/baseline-diagnostic.ts` | J-1 | **新增** | 提供 `captureBaseline()`、`compareWithBaseline()`、`recordBaselineDrift()`、`hashTscOutput()` |
| `.opencode/plugins/tsc-diag-track.ts` | J-2 | 修改 | `checkOneTarget()` 改用 baseline-diff 判定；`afterWriteTscCheck()` 加入 L3/L4 drift 記錄 |
| `.opencode/lib/tsc-diagnostic.ts` | J-2 | 修改 | `runTscDiagnostic()` 回傳增加 `allErrors` 陣列（用於 baseline drift 計算）與 `rawOutputHash` |
| `.opencode/scripts/mcp-tools/baseline-diagnostic.ts` | J-4 | **新增** | MCP 工具 `framework_capture_diagnostic_baseline(task_id, reason, mode)` |
| `.opencode/scripts/mcp-tools/code-quality-lib.ts` | J-4 | 修改 | `runAllChecks()` 在 baseline drift 時不再重複報 tsc 錯誤（已由 LSP gate 接管），只輸出 drift 狀態 |
| `.opencode/lib/__tests__/gate-core.test.ts` | J-3 | 修改 | 清理 20 條 missing-rename 錯誤（`generateSessionId` → `generateGateSessionId` 等） |
| `.opencode/lib/__tests__/safe-bash-core.test.ts` | J-3 | 修改 | 清理 block-scoped variable redeclare（DEFAULT_ALLOWLIST 頂層 const 衝突） |
| `.opencode/scripts/*.ts`（批量） | J-3 | 修改 | 按桶優先級清理（見 §5 清理優先級） |
| `.opencode/scripts/e2e/lsp-diagnostic-baseline-e2e.ts` | J-4 | **新增** | 獨立 DB harness E2E 驗證四層判定 |

> 遵循 Layout Architecture Subsystem：**只新增 2 個檔案**（baseline-diagnostic.ts lib + mcp-tool），其餘全部就地修改。

---

## 4. 子系統符合性矩陣

| 子系統 | 符合性 | 說明 |
|---|---:|---|
| Layout Architecture Subsystem | ✅ | 新增檔案數最小化（2 個），其餘就地修改 |
| DB-only and DB-canonical based | ✅ | `diagnostic_baseline` 寫 SQLite `substate_kv`，不寫 JSON |
| Permission Matrix Subsystem | ✅ | 不引入新權限，baseline refresh 只需 SA / Meta-Planner |
| Session / Task Concurrency Safe | ✅ | baseline 寫入用 `atomicWriteSubState`，session-isolated read 不影響 |
| Hardened Enforcement Subsystem | ✅ | L1/L2 遵循 advisory / strict / locked 三態；L3/L4 永不阻斷 |
| Framework Harness Subsystem | ✅ | 新增 E2E `lsp-diagnostic-baseline-e2e.ts` 使用 `withPluginLifecycle()` |
| Central State Management Subsystem | ✅ | 走 `readSubState` / `atomicWriteSubState` |
| Multi-Agent Subsystem | ✅ | baseline 為 project-wide，所有 agent 共用，無 agent 競爭 |
| Log Central Management Subsystem | ✅ | 新事件經 `writeLog("tsc-diag-track", "runtime"|"WARN"|"ERROR", ...)` |
| DB-canonical Management Subsystem | ✅ | 不引入 JSON dual-write |
| Templatization & Parameterization | ✅ | E2E 參數化 `FRAMEWORK_DB_PATH` / project root / task_id |
| TypeScript + Bun Based Runtime | ✅ | 所有程式碼為純 TypeScript，無 Bash / Python 外掛 |

---

## 5. 清理優先級（J-3 詳細作業）

按 **ROI（影響面 × 修復成本）** 排序，分三階段：

### Phase A — 高 ROI（預估消除 250 條，佔 35%）

| 類型 | 來源 | 預估數量 | 修復方式 |
|---|---|---:|---|
| TS2451 block-scoped redeclare | `lib/__tests__/*.test.ts` 頂層 const 衝突 | 202 | 每個 test 檔案包一層 `describe()` / IIFE，或改成 top-level `const _X = ...` 重命名 |
| TS2552 / TS2304 rename missing | `lib/__tests__/gate-core.test.ts` | 20 | 對齊 `gate-core.ts` 已重命名 API（`createSession` → `createGateSession`，`armSession` → `armedSessions.add`） |
| TS1117 duplicate property | `scripts/**/*.ts` object literal | 19 | 刪除重複 key |

### Phase B — 中 ROI（預估消除 200 條，佔 28%）

| 類型 | 來源 | 預估數量 | 修復方式 |
|---|---|---:|---|
| TS2339 missing property | `scripts/mcp-tools/*.ts` | ~80 | 補介面 / 用 `as` 收窄 / 引入 `unknown` 邊界 |
| TS2353 unknown property | `scripts/mcp-tools/*.ts` object literal | 72 | 補全欄位 / 用 `Partial<T>` |
| TS2393 function duplicates | `scripts/*.ts` | 54 | 刪除重複定義或重命名 |

### Phase C — 長尾（預估消除 265 條，佔 37%）

| 類型 | 來源 | 預估數量 | 修復方式 |
|---|---|---:|---|
| TS2339 / TS2345 / TS2551 | `lib/`、`plugins/`、`tools/` | 145 | 逐文件補 type / rename / import 修正 |
| TS2554 / 2749 / 2561 / 2322 | 全域 | 12 | 逐文件 |
| 剩餘 TS2339 / 雜項 | 全域 | 108 | 逐文件 |

### Phase D — 基線捕獲與持續監控

每階段結束時：

1. 執行 `framework_capture_diagnostic_baseline(task_id, "phase-N-complete", "manual")`。
2. 比較新舊 baseline，確認 total_errors 遞減。
3. 若遞減失敗，rollback 本階段改動。

---

## 6. 具體實作程式碼

### 6.1 `substate-types.ts` 擴充

```ts
// .opencode/lib/substate-types.ts（追加）

export interface DiagnosticBaselineEntry {
  file: string;
  code: string;
  message: string;
  line: number;
  character: number;
}

export interface DiagnosticBaseline {
  hash: string;
  total_errors: number;
  bucket_counts: Record<string, number>;
  errors: DiagnosticBaselineEntry[];
  captured_at: string;
  tsc_version: string;
  source: string;
  [key: string]: any;
}

// SubStateMap 追加：
export interface SubStateMap {
  // ... 既有 13 個 key ...
  diagnostic_baseline: DiagnosticBaseline;
}
```

### 6.2 `substate-manager.ts` 擴充

```ts
// SUBSTATE_FILES 追加：
export const SUBSTATE_FILES: Record<SubStateKey, string> = {
  // ... 既有 13 個 ...
  diagnostic_baseline: "diagnostic-baseline.json",
};
```

### 6.3 `lib/baseline-diagnostic.ts` 核心

```ts
// baseline-diagnostic.ts — TS baseline capture + diff engine
// ═══════════════════════════════════════════════════════════════
// Part of G-7 TypeScript baseline cleanup.
// Provides:
//   - captureBaseline(): run tsc, store to diagnostic_baseline substate
//   - compareWithBaseline(): L1/L2 target diff
//   - recordBaselineDrift(): L3/L4 project drift observability
//
// @author @Super-Admin (G-7, 2026-06-27)
// ═══════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { readSubState } from "./substate-manager";
import { atomicWriteSubState } from "./state-utils";
import { writeLog } from "./log-manager";
import type { DiagnosticBaselineEntry } from "./substate-types";

const SRC = "lib-baseline-diagnostic";

/**
 * Capture current tsc baseline into diagnostic_baseline substate.
 * @returns true on success
 */
export function captureBaseline(opts: {
  projectRoot: string;
  source: string;
  taskId?: string;
}): boolean {
  const { projectRoot, source, taskId } = opts;
  const TSC_TIMEOUT_MS = 120_000;

  let stdout = "";
  let exitOk = true;
  try {
    stdout = execSync(
      "npx tsc --noEmit --pretty false --incremental false",
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: TSC_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (e: any) {
    stdout = e.stdout || e.stderr || "";
    exitOk = false;
  }

  const errors = parseTscBaseline(stdout, projectRoot);
  const bucketCounts: Record<string, number> = {};
  for (const e of errors) {
    const rel = path.relative(projectRoot, e.file).replace(/^\.opencode\//, "");
    const seg = rel.split("/");
    const bucket =
      seg[0] === "lib" && seg[1] === "__tests__" ? "lib/__tests__" :
      seg[0] === "scripts" && seg[1] === "mcp-tools" ? "scripts/mcp-tools" :
      seg[0] === "scripts" && seg[1] === "command-tools" ? "scripts/command-tools" :
      seg[0];
    bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
  }

  const hash = hashTscOutput(stdout);
  const tscVersion = readTscVersion(projectRoot);

  const ok = atomicWriteSubState("diagnostic_baseline", (state: any) => {
    state.hash = hash;
    state.total_errors = errors.length;
    state.bucket_counts = bucketCounts;
    state.errors = errors;
    state.captured_at = new Date().toISOString();
    state.tsc_version = tscVersion;
    state.source = source;
    state.task_id = taskId;
  });

  writeLog(SRC, "INFO", {
    event: "BASELINE-CAPTURED",
    detail: `source=${source} total=${errors.length} hash=${hash.slice(0, 12)} taskId=${taskId || "n/a"}`,
  });
  return ok;
}

/**
 * Parse baseline tsc output into structured entries.
 */
export function parseTscBaseline(
  output: string,
  projectRoot: string,
): DiagnosticBaselineEntry[] {
  const entries: DiagnosticBaselineEntry[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(
      /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/,
    );
    if (!m) continue;
    const [, rawFile, ln, ch, code, msg] = m;
    const abs = path.resolve(projectRoot, rawFile);
    entries.push({
      file: abs,
      code,
      message: msg.trim().slice(0, 200),
      line: parseInt(ln, 10),
      character: parseInt(ch, 10),
    });
  }
  return entries;
}

export function hashTscOutput(output: string): string {
  const normalized = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort()
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

function readTscVersion(projectRoot: string): string {
  try {
    return execSync("npx tsc --version", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Compare target's current errors against baseline.
 * Returns one of:
 *   - "clean"                     (no current, no baseline)
 *   - "new_error"                 (current has, baseline empty for this file)   → L1
 *   - "error_count_increased"     (same file, more errors now)                  → L2
 *   - "error_count_decreased"     (same file, fewer errors now)
 *   - "unchanged"                 (identical error set)
 */
export function compareWithBaseline(
  targetAbsPath: string,
  currentErrors: DiagnosticBaselineEntry[],
): {
  verdict: "clean" | "new_error" | "error_count_increased" |
           "error_count_decreased" | "unchanged";
  baselineCount: number;
  currentCount: number;
  newErrors: DiagnosticBaselineEntry[];
} {
  const baseline = readSubState("diagnostic_baseline") as any;
  const baselineErrors = ((baseline?.errors || []) as DiagnosticBaselineEntry[])
    .filter((e) => e.file === targetAbsPath);
  const baselineCount = baselineErrors.length;
  const currentCount = currentErrors.length;

  if (currentCount === 0 && baselineCount === 0) {
    return { verdict: "clean", baselineCount: 0, currentCount: 0, newErrors: [] };
  }
  if (currentCount > 0 && baselineCount === 0) {
    return {
      verdict: "new_error",
      baselineCount: 0,
      currentCount,
      newErrors: currentErrors,
    };
  }
  if (currentCount > baselineCount) {
    // naive new-error detection: by (line, code, message)
    const baseSet = new Set(
      baselineErrors.map((e) => `${e.line}|${e.code}|${e.message}`),
    );
    const newErrors = currentErrors.filter(
      (e) => !baseSet.has(`${e.line}|${e.code}|${e.message}`),
    );
    return {
      verdict: "error_count_increased",
      baselineCount,
      currentCount,
      newErrors,
    };
  }
  if (currentCount < baselineCount) {
    return {
      verdict: "error_count_decreased",
      baselineCount,
      currentCount,
      newErrors: [],
    };
  }
  return {
    verdict: "unchanged",
    baselineCount,
    currentCount,
    newErrors: [],
  };
}

/**
 * Record project-wide baseline drift (L4) when target is clean but baseline
 * hash no longer matches. Advisory observability only.
 */
export function recordBaselineDrift(opts: {
  sessionID: string;
  callID?: string;
  currentHash: string;
  targetAbsPath: string;
}): void {
  const baseline = readSubState("diagnostic_baseline") as any;
  if (!baseline?.hash) return;
  if (baseline.hash === opts.currentHash) return;

  writeLog(SRC, "WARN", {
    sessionID: opts.sessionID,
    callID: opts.callID,
    event: "BASELINE-DRIFT",
    detail:
      `target=${opts.targetAbsPath} ` +
      `baseline_hash=${baseline.hash.slice(0, 12)} ` +
      `current_hash=${opts.currentHash.slice(0, 12)} ` +
      `baseline_total=${baseline.total_errors}`,
  });
}
```

### 6.4 `tsc-diag-track.ts` 改造

```ts
// .opencode/plugins/tsc-diag-track.ts — 修改 checkOneTarget()
import { compareWithBaseline, recordBaselineDrift } from "../lib/baseline-diagnostic";
import type { DiagnosticBaselineEntry } from "../lib/substate-types";

function checkOneTarget(
  absPath: string,
  mode: string,
  sessionID?: string,
  callID?: string,
  currentErrors?: Array<{ message: string; line: number; character: number; code: string }>,
): void {
  const entries: DiagnosticBaselineEntry[] = (currentErrors || []).map((e) => ({
    file: absPath,
    code: e.code,
    message: e.message,
    line: e.line,
    character: e.character,
  }));
  const diff = compareWithBaseline(absPath, entries);

  // L1/L2: only block on NEW errors or INCREASED count
  const shouldAct =
    diff.verdict === "new_error" || diff.verdict === "error_count_increased";

  if (!shouldAct) {
    // L3: target clean (or decreased) — record only
    if (diff.verdict === "clean" || diff.verdict === "error_count_decreased") {
      writeLog(PLUGIN_NAME, "runtime", {
        sessionID, callID,
        event: "TSC-TARGET-BASELINE",
        detail: `file=${absPath} verdict=${diff.verdict} baseline=${diff.baselineCount} current=${diff.currentCount}`,
      });
    }
    return;
  }

  const newSummary = diff.newErrors
    .slice(0, 3)
    .map((e) => `${e.code} L${e.line}: ${e.message.slice(0, 80)}`)
    .join("; ");

  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const frameworkDir = path.join(projectRoot, ".opencode");
  const isFrameworkFile =
    absPath.startsWith(frameworkDir + path.sep) || absPath === frameworkDir;
  const shouldBlock = mode !== "advisory" || isFrameworkFile;

  const msg =
    `[FW-ENFORCE][TSC-BASELINE-DIFF] ${diff.verdict} on ${absPath}\n` +
    `Baseline count: ${diff.baselineCount}, current: ${diff.currentCount}\n` +
    `New errors:\n  ${newSummary}`;

  writeLog(PLUGIN_NAME, "runtime", {
    sessionID, callID,
    level: shouldBlock ? "ERROR" : "WARN",
    event: "TSC-BASELINE-DIFF",
    detail:
      `${diff.verdict} | baseline=${diff.baselineCount} current=${diff.currentCount} ` +
      `new=${diff.newErrors.length} file=${absPath}`,
  });

  if (shouldBlock) throw new Error(msg);
}
```

`afterWriteTscCheck()` 加入 L3/L4 drift 記錄（示意）：

```ts
const result = runTscDiagnostic(absTargets[0], projectRoot);
if (result.diagnostic_status === "target_clean_project_dirty" && result.rawOutputHash) {
  recordBaselineDrift({
    sessionID: input.sessionID,
    callID: input.callID,
    currentHash: result.rawOutputHash,
    targetAbsPath: absTargets[0],
  });
}
```

### 6.5 `tsc-diagnostic.ts` 小幅擴充

```ts
// 在 TscDiagnosticResult 增加：
export interface TscDiagnosticResult {
  // ... 既有欄位 ...
  /** SHA-256 of sorted tsc output (for L4 drift) */
  rawOutputHash?: string;
  /** All parsed errors (for baseline capture) */
  allErrors?: TscDiagnosticError[] & { file: string }[];
}
```

在 `runTscDiagnostic()` 的 catch 分支計算 `rawOutputHash = hashTscOutput(output)` 並附帶 `allErrors`。

### 6.6 MCP 工具 `framework_capture_diagnostic_baseline`

```ts
// .opencode/scripts/mcp-tools/baseline-diagnostic.ts
import { captureBaseline } from "../../lib/baseline-diagnostic";

export const tool = {
  name: "framework_capture_diagnostic_baseline",
  description:
    "Capture the current `npx tsc --noEmit` error set as the project baseline. " +
    "Stored in SQLite substate_kv as `diagnostic_baseline`. Used by the LSP " +
    "diagnostic gate to differentiate NEW errors from pre-existing baseline.",
  parameters: {
    task_id: { type: "string", description: "DAG task id driving the refresh" },
    reason:  { type: "string", description: "Why: phase-A-complete / manual / drift-recovery" },
    mode:    { type: "string", enum: ["manual", "auto_refresh"], default: "manual" },
  },
};

export async function handler(args: any, ctx: any) {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const ok = captureBaseline({
    projectRoot,
    source: args.mode || "manual",
    taskId: args.task_id,
  });
  return ok
    ? { status: "ok", reason: args.reason, task_id: args.task_id }
    : { status: "failed", reason: "atomicWriteSubState returned false" };
}
```

---

## 7. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| baseline 捕獲時 project 處在中間態（部分修復已合入、部分未） | baseline 會過快過期 | 每 Phase A/B/C 完成後立即 refresh；CI 上以 commit hash 標記 source |
| `compareWithBaseline` 的 (line,code,message) 相等性比對在行號漂移時誤判 | 誤放新增錯誤 | L1 用嚴格比對（行號 + 訊息），L2 用計數兜底；行號漂移即視為 `new_error`（fail-closed） |
| baseline 存 SQLite 後 size 過大（715 條 × ~300B ≈ 215KB） | substate_kv json 列仍可承載（TEXT） | 設 errors 上限 2000 條，超過則只保留 bucket_counts + hash |
| 715 條中隱藏真 bug（不是純型別問題） | 清理時引入回歸 | Phase A 只改測試 / const 衝突，不碰業務邏輯；Phase B/C 每 PR ≤ 50 條清理 |
| tsc 版本升級導致全量 hash 變化 | L4 誤報 drift | baseline 記錄 tsc_version，若 version 變化則自動 refresh |
| advisory mode 下 business code 新錯不阻 | 長期累積 | 框架碼（`.opencode/**`）仍強制阻斷（沿用既有 `FW-HARDEN-TSC-FRAMEWORK`） |

---

## 8. 實施步驟

1. 執行 `/compliance-gate "G-7 TS baseline cleanup"` 武裝合規門。
2. `@Meta-Planner` 產生 DAG：`analyze → baseline-capture → J-1 → J-2 → J-3-PhaseA → J-3-PhaseB → J-3-PhaseC → J-4 → verify → close`。
3. **J-1**: 新增 `substate-types.ts` / `substate-manager.ts` 的 baseline 註冊；新增 `lib/baseline-diagnostic.ts`。
4. 首次 baseline 捕獲：`bun .opencode/scripts/baseline-diagnostic.ts --source=initial --task-id=<DAG id>`，確認 `diagnostic_baseline.total_errors = 715`。
5. **J-2**: 改造 `tsc-diag-track.ts` 與 `tsc-diagnostic.ts`。
6. 跑 E2E `lsp-diagnostic-baseline-e2e.ts`（isolated DB harness），驗證 L1/L2/L3/L4 四層。
7. **J-3 Phase A**: 清理 `lib/__tests__` TS2451 / TS2552 / TS1117，預估消除 250 條。
8. Refresh baseline，確認 `total_errors ≈ 465`。
9. **J-3 Phase B**: 清理 `scripts/mcp-tools/` TS2339 / TS2353 / TS2393。
10. Refresh baseline，確認 `total_errors ≈ 265`。
11. **J-3 Phase C**: 長尾逐文件清理。
12. Refresh baseline，確認 `total_errors ≤ 30`（殘留為真正待修 bug 或 over-wide any）。
13. **J-4**: 上線 MCP 工具 `framework_capture_diagnostic_baseline`，串入 `framework-self-test.ts` + CI。
14. `compliance_gate_complete` 關閉合規門。

---

## 9. 驗收準則

### 9.1 功能驗收

```bash
# Step 1: 首次 baseline
FRAMEWORK_DB_PATH=/tmp/g7-e2e.db bun .opencode/scripts/baseline-diagnostic.ts \
  --source=initial --task-id=test-g7
# → substate_kv.diagnostic_baseline.total_errors == 715

# Step 2: 觸發 touched target 新增錯誤
echo "// @ts-ignore" >> .opencode/lib/substate-types.ts  # 故意引入
FRAMEWORK_DB_PATH=/tmp/g7-e2e.db bun .opencode/scripts/e2e/lsp-diagnostic-baseline-e2e.ts
# → L1 BLOCKED（strict mode）

# Step 3: 觸發 project drift（改 baseline 外的檔案）
# → L4 BASELINE-DRIFT 記錄到 .task_temp/_logs/2026-06-27/plugin-tsc-diag-track-runtime.log

# Step 4: 清理後重捕
FRAMEWORK_DB_PATH=/tmp/g7-e2e.db bun .opencode/scripts/baseline-diagnostic.ts \
  --source=phase-A-complete --task-id=test-g7
# → total_errors 遞減
```

### 9.2 日誌事件清單

| event | level | 層 |
|---|---|---|
| `BASELINE-CAPTURED` | INFO | J-1 |
| `TSC-TARGET-BASELINE` | INFO | L3 |
| `TSC-BASELINE-DIFF` | ERROR/WARN | L1/L2 |
| `BASELINE-DRIFT` | WARN | L4 |
| `TSC-DIAG-DB-WRITE-FAILED` | ERROR | 既有 |

### 9.3 E2E 案例

| 案例 | 預期 |
|---|---|
| Case 1: baseline 不存在 + touched target 無錯 | pass，無 log |
| Case 2: baseline 無此檔案錯誤 + touched target 新增 TS2339 | L1 block（strict） / warn（advisory） |
| Case 3: baseline 5 條 + touched target 現在 7 條 | L2 block |
| Case 4: baseline 5 條 + touched target 現在 3 條 | pass，記錄 `error_count_decreased` |
| Case 5: touched target clean + project hash 漂移 | pass + L4 WARN |
| Case 6: framework 檔案 + advisory mode + L1 | 仍 block（`FW-HARDEN-TSC-FRAMEWORK`） |

### 9.4 驗收命令

```bash
bun --check .opencode/lib/baseline-diagnostic.ts
bun --check .opencode/plugins/tsc-diag-track.ts
bun --check .opencode/scripts/mcp-tools/baseline-diagnostic.ts
npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile .opencode/state/.tsbuildinfo
FRAMEWORK_DB_PATH=/tmp/g7-e2e.db bun .opencode/scripts/e2e/lsp-diagnostic-baseline-e2e.ts
bun .opencode/scripts/framework-self-test.ts
```

---

## 10. 與既有文檔一致性

| 參考文檔 | 一致性 |
|---|---|
| `lsp-diagnostic-gate-e2e-acceptance-gaps.md` §G-7 | 實現其「baseline DB-canonical + 差分阻斷」全部四項要求 |
| `lsp-diagnostic-gate-implementation-plan.md` | 不衝突；該文檔已廢除 `type_check_state`，本方案新增 `diagnostic_baseline` 是另一維度 |
| `database-migration-plan.md` | DB-only，substate_kv TEXT JSON blob，無 schema 遷移 |
| `dispatch-shell-checklist-gaps-fix-plan-20260627.md` | 不衝突，均維持 SQLite source of truth |
| `framework-tsc-tdd-feasibility-analysis-20260626.md` | 承接其「全量 tsc 715 條不可能一次清零」結論，改以 baseline 長期消債 |

---

*本文件為 G-7 TS 基線清理的具體作業方案。待 `/compliance-gate` 武裝後由 @Meta-Planner 產生 DAG、@Super-Admin 主導 J-1/J-2/J-4 框架改動、@Coder-BE / @Coder-FE 參與 J-3 長尾清理。*
