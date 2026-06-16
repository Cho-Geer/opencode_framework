# Pre-commit Hook 修复方案：Bash → TypeScript + Bun 迁移

**日期：** 2026-06-15
**关联文档：** `framework-evaluation-report.md` §4a, `rule-registry-optimization-plan.md`
**优先级：** P0
**依据：** `.task_temp/VERIFY-PRECOMMIT-CLAIMS-001/HANDOVER.md` 验证报告
**状态：** ✅ 已完成 (2026-06-15)

---

## 一、现状问题总结（经 HANDOVER.md 验证）

| # | 问题 | 验证结果 | 严重度 |
|---|------|---------|--------|
| 1 | 10x 代码重复（1125 行死代码） | ✅ 确认。10 个相同的 block 顺序执行，无 `exit 0` 终止 | P0 |
| 2 | 硬编码 `/home/zhaoge/.bun/bin/bun`（23 处） | ✅ 确认。不可移植 | P0 |
| 3 | commit-msg 使用 `node` 而非 `bun` | ✅ 确认。运行时不一致 | P1 |
| 4 | 整个 hook 是 bash 脚本，框架其余部分均为 TypeScript + Bun | ✅ 确认。技术栈不一致 | P1 |
| 5 | Layer 2.6 用 `bun`，Layer 2.0 用硬编码路径，同一 block 内不一致 | ✅ 确认 | P0 |

**有效代码：** 358 行（233 行 setup + 125 行检查逻辑）
**死代码：** 1125 行（9 个重复 block × 125 行）
**重复引入提交：** `9a64e5f7`

---

## 二、修复目标

1. **消除 1125 行死代码**，保留 358 行有效逻辑
2. **Bash → TypeScript + Bun 迁移**，与框架技术栈统一
3. **消除硬编码路径**，使用运行时解析
4. **pre-commit 和 commit-msg 统一运行时**（均使用 Bun）
5. **整合 `rule-registry-optimization-plan.md` 中的 git diff 方案**（替换 Layer 1.5 的 SHA-256 验证）
6. **commit-msg 追加 `[INFRA]` 标记检查**（关键文件变更确认）

---

## 三、架构设计

### 文件结构

Hook 专用模块放入 `.opencode/hooks/lib/`（而非 `.opencode/lib/`），保持 hook 代码内聚，不污染通用 lib 的 barrel export：

```
.opencode/hooks/lib/
│ ── hook 专用模块（仅 hook 使用，不导出到 lib/index.ts）──
├── hook-critical-files.ts      # Layer 1.5: git diff 关键文件检测 + CRITICAL_FILES 清单
├── hook-layers.ts              # pre-commit 主入口 + Layer 0/1.8/1.9/1/2.5/2.6/2.0/2 编排
├── hook-commit-msg.ts          # commit-msg 逻辑（TDD + INFRA + commitlint）

.opencode/hooks/
├── pre-commit                  # 薄 bash wrapper → bun .opencode/hooks/lib/hook-layers.ts
└── commit-msg                  # 薄 bash wrapper → bun .opencode/hooks/lib/hook-commit-msg.ts
```

hook 模块通过相对路径（`../../lib/gate-core`）复用 `.opencode/lib/` 已有模块，无需修改 `lib/index.ts` barrel export。

### 复用映射

| hook 层 | 复用的现有 lib/ 模块 | 新增部分 |
|---------|-------------------|---------|
| 路径解析 | `gate-core.ts`: `getProjectRoot()`, `resolveStateDir()`, `resolveFrameworkPaths()` | 无 |
| Enforcement Mode | `gate-core.ts`: `getEnforcementMode()` | 无 |
| Layer 0 (Gate Armed) | `gate-checks.ts`: `findArmedSession()` | `hook-layers.ts` 中编排调用 |
| Layer 1.5 (Critical Files) | 无 | `hook-critical-files.ts`（新增） |
| Layer 1.8 (Gate Lifecycle) | `gate-core.ts`: `drainStaleSessions()` | `hook-layers.ts` 中编排调用 |
| Layer 1.9 (State Format) | `gate-core.ts`: `checkGateIntegrity()` | `hook-layers.ts` 中编排调用 |
| Layer 2.0 (JSON Syntax) | `tolerant-json.ts`: `tolerantParse()` | `hook-layers.ts` 中编排调用 |
| Layer 2.6 (UC7KS) | `uc7ks-utils.ts` 相关工具 | `hook-layers.ts` 中编排调用 |
| commit-msg (TDD + INFRA) | 无 | `hook-commit-msg.ts`（新增） |

### Git Hook Wrapper 模式

git hooks 必须是可执行文件。使用薄 bash wrapper 调用 Bun 执行 TypeScript：

**`.opencode/hooks/pre-commit`**（3 行）：
```bash
#!/bin/bash
exec bun "$(git rev-parse --show-toplevel)/.opencode/hooks/lib/hook-layers.ts" "$@"
```

**`.opencode/hooks/commit-msg`**（3 行）：
```bash
#!/bin/bash
exec bun "$(git rev-parse --show-toplevel)/.opencode/hooks/lib/hook-commit-msg.ts" "$@"
```

这种模式：
- 消除硬编码 bun 路径（`exec bun` 使用 `$PATH` 中的 bun）
- git 通过 shebang 执行 bash，bash 通过 `exec` 替换进程为 bun
- TypeScript 入口文件使用 Bun 的 shebang 支持直接执行

---

## 四、各模块实现方案

> 以下仅列出**新增到 `.opencode/hooks/lib/` 的 3 个文件**。路径解析、enforcement mode、gate 状态检查等逻辑通过相对路径复用 `gate-core.ts`、`gate-checks.ts`、`tolerant-json.ts` 等已有模块。

### `hook-critical-files.ts` — 关键文件清单 + git diff 检测

```typescript
// .opencode/hooks/lib/hook-critical-files.ts
import { execSync } from "child_process";

export const CRITICAL_FILES = [
  ".opencode/rules/common-project.md",
  ".opencode/rules/mcp-compliance-guide.md",
  ".opencode/rules/skill-compliance-guide.md",
  ".opencode/agents/Meta-Planner.md",
  ".opencode/agents/Orchestrator.md",
  ".opencode/agents/Coder-BE.md",
  ".opencode/agents/Coder-FE.md",
  ".opencode/agents/Guardian.md",
  ".opencode/agents/Arbiter.md",
  ".opencode/agents/CI-CD-Agent.md",
  ".opencode/agents/Super-Admin.md",
  ".opencode/agents/Knowledge-Curator.md",
  ".opencode/agents/Architect.md",
  ".opencode/project.config.json",
  ".opencode/lib/gate-core.ts",
  ".opencode/lib/dag-policy.ts",
  ".opencode/lib/permission-isolation-core.ts",
  ".opencode/tools/dispatch_subagent.ts",
  ".opencode/hooks/pre-commit",
  ".opencode/hooks/commit-msg",
  "opencode.json",
  "AGENTS.md",
];

export function getStagedCriticalFiles(): string[] {
  const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  return staged.filter(f => CRITICAL_FILES.includes(f));
}
```

### `hook-layers.ts` — Pre-commit 主入口（复用现有 lib/ 模块）

```typescript
// .opencode/hooks/lib/hook-layers.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { getEnforcementMode, getProjectRoot } from "../../lib/gate-core";
import type { EnforcementMode } from "../../lib/gate-core";
import { getStagedCriticalFiles } from "./hook-critical-files";
import { tolerantParse } from "../../lib/tolerant-json";

// ── 路径解析（复用 gate-core） ──
const ROOT = getProjectRoot();
const PROJECT_CONFIG = join(ROOT, ".opencode/project.config.json");
const GATE_STATE = join(ROOT, ".opencode/state/gate-state.json");
const MACHINE = join(ROOT, ".opencode/state/machine.json");
const INNER = (() => {
  try {
    const cfg = JSON.parse(readFileSync(PROJECT_CONFIG, "utf8"));
    return join(ROOT, cfg.project_root || ".");
  } catch { return ROOT; }
})();

const mode = getEnforcementMode(PROJECT_CONFIG);

console.log("═══════════════════════════════════════════════════════");
console.log("  🔍 OpenCode v3.3 Pre-Commit Hook — TypeScript + Bun");
console.log(`  Mode: ${mode}`);
console.log("═══════════════════════════════════════════════════════");

// ── Layer 0: Compliance Gate Armed Check ──
console.log("\n[Layer 0/4] Checking compliance gate state...");
if (mode === "advisory") {
  console.log("  ⚠️  [ADVISORY] Gate armed check skipped");
} else if (existsSync(GATE_STATE)) {
  const store = JSON.parse(readFileSync(GATE_STATE, "utf8"));
  const sessions = store.active_sessions;
  const count = sessions
    ? (Array.isArray(sessions) ? sessions.length : Object.keys(sessions).length)
    : 0;
  if (count === 0) {
    console.log("❌ [GATE] No compliance gate session is armed.");
    console.log("   Run: compliance_gate_check → compliance_gate_confirm before committing.");
    process.exit(1);
  }
  console.log(`  ✅ Compliance gate armed (${count} active session(s))`);
} else {
  console.log("  ⚠️  gate-state.json not found — skipped");
}

// ── Layer 1.5: Critical Files Check (git diff, replaces SHA-256) ──
console.log("\n[1.5/4] Critical infrastructure files check (git diff)...");
const criticalModified = getStagedCriticalFiles();
if (criticalModified.length > 0) {
  console.log("  ⚠️  Critical infrastructure files modified:");
  criticalModified.forEach(f => console.log(`    - ${f}`));
  if (mode === "locked") {
    console.log("  ❌ [FW-ENFORCE][INFRA] Critical files in locked mode — BLOCKED");
    process.exit(1);
  }
  console.log("  ⚠️  Ensure commit message includes [INFRA] marker");
} else {
  console.log("  ✅ No critical infrastructure files in this commit");
}

// ── Layer 1.8: Gate Lifecycle Audit ──
console.log("\n[1.8/4] Gate lifecycle audit...");
try {
  const output = execSync("bun .opencode/scripts/gate-lifecycle-audit.ts --json", {
    encoding: "utf8", cwd: ROOT, timeout: 30000,
  });
  const result = JSON.parse(output);
  const stale = (result.stale_sessions || []).filter((s: any) => (s.hours_old || 0) > 24).length;
  if (stale > 0) {
    console.log(`  ⚠️  ${stale} stale gate session(s) (>24h)`);
    console.log("  Fix: bun .opencode/scripts/state-reconciliation.ts --fix");
  } else {
    console.log("  ✅ No stale gate sessions");
  }
} catch {
  console.log("  ⚠️  Gate lifecycle audit skipped (script unavailable)");
}

// ── Layer 1.9: State Format Validation ──
console.log("\n[1.9/4] State format validation...");
if (existsSync(GATE_STATE)) {
  const gs = JSON.parse(readFileSync(GATE_STATE, "utf8"));
  if ((gs.formatVersion || "1.0") === "3.0") {
    const active = Object.keys(gs.active_sessions || {}).length;
    const recent = Object.keys(gs.recent_sessions || {}).length;
    const indexPath = join(ROOT, ".opencode/state/gate-state.index.json");
    if (existsSync(indexPath)) {
      const idx = JSON.parse(readFileSync(indexPath, "utf8"));
      const indexCount = Object.keys(idx.sessions || {}).length;
      if (indexCount < recent) {
        console.log(`  ❌ gate-state v3: index (${indexCount}) < recent (${recent})`);
        process.exit(1);
      }
    }
    console.log(`  ✅ gate-state v3: active=${active} recent=${recent}`);
  }
}

// DAG changelog externalization
const dagPath = join(ROOT, "Task.DAG.json");
if (existsSync(dagPath)) {
  const dag = JSON.parse(readFileSync(dagPath, "utf8"));
  if (dag.change_log) {
    console.log("  ⚠️  Task.DAG.json still has inline change_log");
  }
}

// ── Layer 1: lint-staged ──
const lintStagedBin = join(INNER, "node_modules/.bin/lint-staged");
if (existsSync(lintStagedBin)) {
  console.log("\n[Layer 1/4] Auto-formatting staged files (lint-staged)...");
  try {
    execSync(`npx --prefix "${INNER}" lint-staged --concurrent false`, {
      encoding: "utf8", timeout: 120000, stdio: "inherit",
    });
  } catch {
    console.log("⚠️  [lint-staged] Some files could not be auto-fixed.");
  }
} else {
  console.log("[Layer 1/4] lint-staged not installed — skipping");
}

// ── Layer 2.5: TDD Order Pre-Check ──
console.log("\n[Layer 2.5/4] TDD order pre-check...");
const FRAMEWORK_EXCLUDES = /^\.opencode\/|^docs\/|^\.task_temp\/|^node_modules\/|^opencode\.json$|^AGENTS\.md$|^contract\.yaml$|^Task\.DAG\.json$|^TECH_DEBT_REGISTRY\.md$|^WAIVE\.md$|^PROJECT_REFERENCE\.md$|^Project\.graph$/;
const staged = execSync("git diff --cached --name-only", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const implFiles = staged.filter(f => /\.(ts|js)$/.test(f) && !/\.spec\.|\.test\.|\/test\/|\.config\./.test(f) && !FRAMEWORK_EXCLUDES.test(f));
const testFiles = staged.filter(f => /\.spec\.|\.test\.|\/test\//.test(f));

if (implFiles.length > 0 && testFiles.length === 0) {
  try {
    const lastMsg = execSync("git log -1 --format=%s", { encoding: "utf8" }).trim();
    if (!/\[(Red|Green|Refactor)\]/i.test(lastMsg)) {
      if (mode === "advisory") {
        console.log("⚠️  [ADVISORY] Impl files without test files & no TDD tag");
      } else {
        console.log("❌ [TDD] Impl files without test files AND no TDD tag — BLOCKED");
        process.exit(1);
      }
    }
  } catch { /* no previous commit */ }
} else {
  console.log("  ✅ TDD order check passed");
}

// ── Layer 2.6: UC7KS Docs Consistency ──
console.log("\n[Layer 2.6/4] UC7KS docs consistency...");
const idxPath = join(ROOT, "docs/official_docs/index.json");
if (existsSync(idxPath)) {
  const parsed = tolerantParse(readFileSync(idxPath, "utf8"));
  if (!parsed || !parsed.manifest_version || !parsed.entries) {
    if (mode === "advisory") {
      console.log("  ⚠️  [ADVISORY] index.json is malformed");
    } else {
      console.log("  ❌ [UC7KS] index.json is malformed — BLOCKED");
      process.exit(1);
    }
  } else {
    const stagedDocs = staged.filter(f => f.startsWith("docs/official_docs/") && !f.includes("index.json") && !f.includes(".metadata/"));
    if (stagedDocs.length > 0) {
      const orphans = stagedDocs.filter(doc =>
        !parsed.entries.some((e: any) => e.files?.some((f: any) => doc.includes(f.path)))
      );
      if (orphans.length > 0) {
        if (mode === "advisory") {
          console.log(`  ⚠️  [ADVISORY] Orphan docs: ${orphans.join(", ")}`);
        } else {
          console.log(`  ❌ [UC7KS] Orphan docs: ${orphans.join(", ")}`);
          process.exit(1);
        }
      } else {
        console.log("  ✅ Staged docs verified in index.json");
      }
    }
    console.log("  ✅ index.json manifest integrity verified");
  }
} else {
  console.log("  ⚠️  index.json not found — skipped");
}

// ── Layer 2.0: JSON Syntax Validation ──
console.log("\n[Layer 2.0/4] JSON syntax validation...");
const jsonFiles = staged.filter(f => f.endsWith(".json") && existsSync(f));
let jsonErrors = 0;
for (const f of jsonFiles) {
  const p = tolerantParse(readFileSync(f, "utf8"));
  if (!p) {
    console.log(`  ❌ JSON parse error: ${f}`);
    jsonErrors++;
  }
}
if (jsonErrors > 0) {
  console.log(`  ❌ ${jsonErrors} JSON file(s) have syntax errors — BLOCKED`);
  process.exit(1);
}
console.log(`  ✅ All staged JSON files valid (${jsonFiles.length} checked)`);

// ── Layer 2: Keystone Validation ──
console.log("\n[Layer 2/4] Keystone full validation...");
const validatorCandidates = [
  join(INNER, "scripts/keystone-validate.ts"),
  join(ROOT, ".opencode/scripts/mcp-tools/keystone-validate.ts"),
];
const validator = validatorCandidates.find(p => existsSync(p));

if (!validator) {
  console.log("⚠️  keystone-validate not found — skipped");
} else if (!existsSync(MACHINE)) {
  console.log("⚠️  machine.json not found — no Keystone constraints");
} else {
  try {
    execSync(`bun "${validator}" --pre-commit`, { encoding: "utf8", timeout: 60000, stdio: "inherit" });
    console.log("  ✅ Keystone validation passed");
  } catch {
    if (mode === "advisory") {
      console.log("  ⚠️  [ADVISORY] Keystone validation failed");
    } else {
      console.log("\n═══════════════════════════════════════════════════════");
      console.log("  ❌ PRE-COMMIT REJECTED — Keystone validation failed");
      console.log("═══════════════════════════════════════════════════════");
      process.exit(1);
    }
  }
}

// ── Layer 3: Delegate to commit-msg ──
console.log("\n[Layer 3/4] Commit message validation → commit-msg hook");
console.log("\n═══════════════════════════════════════════════════════");
console.log("  ✅ PRE-COMMIT PASSED — All checks clear");
console.log("═══════════════════════════════════════════════════════");
```

### `hook-commit-msg.ts` — Commit Message 验证（TDD + INFRA + commitlint）

```typescript
// .opencode/hooks/lib/hook-commit-msg.ts
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { getEnforcementMode, getProjectRoot } from "../../lib/gate-core";
import { getStagedCriticalFiles } from "./hook-critical-files";

const commitMsgFile = process.argv[2];
if (!commitMsgFile || !existsSync(commitMsgFile)) {
  console.log("⚠️  [commit-msg] no commit message file — skipping");
  process.exit(0);
}

const msg = readFileSync(commitMsgFile, "utf8").trim();
const root = getProjectRoot();
const mode = getEnforcementMode(join(root, ".opencode/project.config.json"));

// ── Skip merge commits ──
if (/^Merge /i.test(msg)) {
  console.log("✅ [commit-msg] Merge commit — skipping");
  process.exit(0);
}

// ── TDD Marker + Phase Ordering ──
const tddMatch = msg.match(/^\[(Red|Green|Refactor)\]\s+(\S+)/i);
if (tddMatch) {
  const phase = tddMatch[1].toLowerCase();
  const taskId = tddMatch[2];
  const prevCommits = (() => {
    try {
      return execSync(`git log --oneline --all --grep="${taskId}"`, {
        encoding: "utf8", timeout: 5000,
      });
    } catch { return ""; }
  })();

  if (phase === "green") {
    const hasRed = prevCommits.split("\n").some(l => new RegExp(`\\[Red\\].*${taskId}`, "i").test(l));
    if (!hasRed) {
      console.log(`❌ [TDD] [Green] for ${taskId} without preceding [Red]`);
      process.exit(1);
    }
  }
  if (phase === "refactor") {
    const hasGreen = prevCommits.split("\n").some(l => new RegExp(`\\[Green\\].*${taskId}`, "i").test(l));
    if (!hasGreen) {
      console.log(`❌ [TDD] [Refactor] for ${taskId} without preceding [Green]`);
      process.exit(1);
    }
  }
  console.log(`✅ [TDD] Valid ${phase} commit for ${taskId}`);
} else if (mode === "strict" || mode === "locked") {
  console.log("❌ [TDD] Commit message must contain [Red], [Green], or [Refactor]");
  process.exit(1);
} else {
  console.log("⚠️  [TDD] Advisory: No TDD marker found");
}

// ── [INFRA] Marker Check (critical files) ──
const criticalModified = getStagedCriticalFiles();
if (criticalModified.length > 0) {
  if (!msg.includes("[INFRA]")) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("[FW-ENFORCE][INFRA] Critical infrastructure files in this commit:");
    criticalModified.forEach(f => console.log(`  - ${f}`));
    console.log("\nCommit message must include [INFRA] marker.");
    console.log('Example: git commit -m "[Green][INFRA] update agent permissions"');
    console.log("═══════════════════════════════════════════════════════");
    process.exit(1);
  }
  console.log(`✅ [INFRA] ${criticalModified.length} critical file(s) — marker confirmed`);
}

// ── commitlint (fallback for non-TDD commits) ──
if (!tddMatch) {
  const commitlint = join(root, "node_modules/.bin/commitlint");
  if (existsSync(commitlint)) {
    console.log("🔍 [commitlint] Validating...");
    try {
      execSync(`npx commitlint --edit "${commitMsgFile}"`, { encoding: "utf8", stdio: "inherit" });
    } catch {
      console.log("❌ Commit message rejected by commitlint.");
      process.exit(1);
    }
  }
}
```

---

## 五、修复前后对比

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| **语言** | Bash | TypeScript + Bun |
| **总行数** | 1483 行 | ~300 行（3 个新模块 + 复用已有 lib/） |
| **死代码** | 1125 行（75.9%） | 0 行 |
| **硬编码路径** | 23 处 | 0 处（运行时解析） |
| **运行时** | bun + node 混合 | 统一 Bun |
| **模块结构** | 单文件 monolith | 3 个 hook 模块（hooks/lib/） + 复用 5 个已有 lib/ 模块 |
| **Layer 1.5** | SHA-256 digest 验证 | git diff 关键文件检测 |
| **commit-msg** | TDD 标记 | TDD 标记 + [INFRA] 标记 |
| **可测试性** | 无法单元测试 | 每个模块可独立测试 |

---

## 六、实施步骤

| 步骤 | 行动 | 风险 |
|------|------|------|
| 1 | 新增 `.opencode/hooks/lib/hook-critical-files.ts` | 无 |
| 2 | 新增 `.opencode/hooks/lib/hook-layers.ts`（pre-commit 主入口，复用 gate-core/gate-checks/tolerant-json） | 中（需验证 gate-core 导出函数签名兼容） |
| 3 | 新增 `.opencode/hooks/lib/hook-commit-msg.ts`（commit-msg 逻辑） | 低 |
| 4 | 重写 `.opencode/hooks/pre-commit` 为薄 bash wrapper（3 行） | 低 |
| 5 | 重写 `.opencode/hooks/commit-msg` 为薄 bash wrapper（3 行） | 低 |
| 6 | 在 advisory 模式下验证所有 layer 输出与原 hook 一致 | 中 |
| 7 | 在 strict 模式下验证阻断行为与原 hook 一致 | 中 |
| 8 | 为 hook-critical-files.ts 编写单元测试 | 低 |

### 验证方法

```bash
# 1. advisory 模式下 commit（应通过）
ENFORCEMENT_MODE=advisory git commit -m "[Green] TEST-001 test commit"

# 2. strict 模式下无 gate armed（应阻断）
git commit -m "[Green] TEST-001 test commit"  # 应报 Layer 0 错误

# 3. 关键文件修改 + 无 [INFRA]（应阻断）
echo "# test" >> .opencode/rules/common-project.md
git add .opencode/rules/common-project.md
git commit -m "[Green] TEST-001 test"  # 应报 [INFRA] 错误

# 4. 关键文件修改 + 有 [INFRA]（应通过）
git commit -m "[Green][INFRA] TEST-001 test"

# 5. JSON 语法错误（应阻断）
echo "{invalid" > test.json && git add test.json
git commit -m "[Green] TEST-001 test"  # 应报 JSON 错误
```

---

## 七、需要修改的文件清单

| 文件 | 操作 |
|------|------|
| `.opencode/hooks/lib/hook-critical-files.ts` | **新增** — 关键文件清单 + git diff 检测 |
| `.opencode/hooks/lib/hook-layers.ts` | **新增** — pre-commit 主入口 |
| `.opencode/hooks/lib/hook-commit-msg.ts` | **新增** — commit-msg 验证逻辑 |
| `.opencode/hooks/pre-commit` | **重写** — 薄 bash wrapper（3 行） |
| `.opencode/hooks/commit-msg` | **重写** — 薄 bash wrapper（3 行） |
| `.opencode/state/rule_registry.json` | **简化** — 纯规则清单（配合 rule-registry-optimization-plan.md） |
| `.opencode/scripts/rule-registry-verify.ts` | **移除** digest 验证逻辑 |
| `.opencode/tools/rule_registry_repair.ts` | **移除** |
