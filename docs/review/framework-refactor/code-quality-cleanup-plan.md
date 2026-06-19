# code_quality_gate 死代码清理与功能整合实施方案

**制定时间**: 2026-06-19  
**制定者**: @Super-Admin (SA-PLAN-CODE-QUALITY-CLEANUP)  
**状态**: 计划（待实施）  

---

## 1. 背景与动机

### 1.1 当前状态

`code-quality-gate` (`.opencode/scripts/mcp-tools/code-quality-gate.ts`, 904 行) 是一个已废弃的 MCP 工具包装器，其原始职责是在每次 Write/Edit 后执行 5 项即时审计检查。

**核心问题**：
1. `opencode.json` 的 `mcp` 段中**没有注册** `code-quality-gate` → MCP 服务器从不启动 → Agent **无法实际调用**
2. 该文件仅作为"已废弃包装器"存在，所有审计逻辑已提取到 `code-quality-lib.ts`
3. Agent 配置 YAML frontmatter 的 `mcp_tools` 仍然列出 `code-quality-gate`（Coder-BE, Coder-FE, Guardian, Architect, Super-Admin, Knowledge-Curator 共 6 个 agent）
4. `opencode.json` agent permissions 中仍然授权 `"code_quality_gate": "allow"`
5. `framework-self-test.ts` Check 9 和 Check 15 仍然引用它
6. `mcp-tool-inventory.md` 有大量文档描述已不可用的函数
7. `code-quality-lib.ts` 中的 3 个非重叠函数（Prettier / depcruise / tsc）**没有运行时调用方**——处于孤儿状态

### 1.2 原始 5 项检查的当前归宿

| # | 检查项 | 原始位置 | 当前状态 | 新归宿 |
|---|--------|---------|---------|--------|
| 1 | Agent Write Scope | code-quality-lib.ts `runScopeCheck()` | ✅ 已覆盖 | `scope-before.ts` 插件（P2-D: 读取 opencode.json 权限） |
| 2 | Prettier 格式化 | code-quality-lib.ts `runPrettierCheck()` | ❌ 孤儿 | **无运行时调用方 — 需整合** |
| 3 | dependency-cruiser | code-quality-lib.ts `runDepCruiserCheck()` | ❌ 孤儿 | **无运行时调用方 — 需整合** |
| 4 | ESLint mock-audit | code-quality-lib.ts `runEslintAudit()` | ✅ 已覆盖 | `eslint_audit.run_audit()` MCP 工具 |
| 5 | tsc 类型检查 | code-quality-lib.ts `runTscCheck()` | ❌ 孤儿 | **无运行时调用方 — 需整合** |

## 2. 实施方案总览

本方案分为 **4 个阶段**，按顺序执行：

```
Phase 1: 孤儿功能整合 → Phase 2: 死代码删除 → Phase 3: 引用清理 → Phase 4: 验证
```

### 2.1 设计原则

1. **最小改动原则**：复用 `code-quality-lib.ts` 中的现有实现，仅创建新的调用入口
2. **分层分工原则**：写时检查归插件层，按需调用归 MCP 工具层
3. **一致性原则**：遵循现有框架模式（参考 `scope-before.ts` 插件模式和 `eslint-audit.ts` MCP 工具模式）

---

## 3. Phase 1: 孤儿功能整合

将 Prettier / depcruise / tsc 三个非重叠功能整合到当前框架的两个目标层：
- **插件层**（自动执行，无感）→ Prettier 格式化
- **MCP 工具层**（Agent 主动调用）→ depcruise 架构检查 + tsc 类型检查

### 3.1 Prettier → format-after.ts 插件（自动格式化）

**设计理念**：在 `tool.execute.after` 钩子中自动运行 Prettier 格式化，Agent 无需手动调用。

**文件**：`.opencode/plugins/format-after.ts` (新建)

**实现方案**：
```typescript
// format-after.ts — Auto-format on write
// 在 scope-after.ts 的钩子点注册 tool.execute.after
// 使用 code-quality-lib.ts 的 runPrettierCheck() 函数

import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { runPrettierCheck } from "../scripts/mcp-tools/code-quality-lib";

async function formatAfterHook(input, output) {
  // 仅处理 safe_edit / safe_shell 类型的写入
  if (!isModifyTool(input.tool)) return;
  
  const filePath = getModifyPath(input.args);
  if (!filePath) return;
  
  // 调用 code-quality-lib.ts 的 Prettier 检查（auto-fix enabled）
  const result = runPrettierCheck(filePath, process.cwd(), true);
  
  // 更新 machine.json.format_state
  if (result.auto_fixed) {
    updateFormatState(filePath);
  }
}

export default withPluginLifecycle("format-after", {
  "tool.execute.after": formatAfterHook,
});
```

**注册位置**：`opencode.json` → `plugin` 数组追加 `"./.opencode/plugins/format-after.ts"`

**关键决策**：
- 放在 `after` 钩子而非 `before` 钩子，原因：(1) 格式化不应该阻止写入，(2) scope-before 的写前检查执行在先
- `autoFix=true` 默认行为：自动格式化，失败时仅记录警告不阻断

### 3.2 depcruise + tsc → code-quality-check.ts MCP 工具

**设计理念**：创建新的 MCP 工具供 Agent 在 `compliance_gate_complete` 之前或 Guardian 审查前主动调用。

**文件**：`.opencode/scripts/mcp-tools/code-quality-check.ts` (新建)

**导出工具**：
| 工具名 | 功能 | 对应 lib 函数 |
|--------|------|--------------|
| `code_quality_check.run_depcruise_check` | 单文件依赖架构检查 | `runDepCruiserCheck()` |
| `code_quality_check.run_tsc_check` | 单文件 TypeScript 检查 | `runTscCheck()` |
| `code_quality_check.run_full_scan` | 全量扫描（tsc + depcruise + prettier） | `runFullScan()` |

**MCP Server 注册**（`opencode.json`）：
```json
"code-quality-check": {
  "type": "local",
  "command": ["bun", "./.opencode/scripts/mcp-tools/code-quality-check.ts"],
  "timeout": 60000,
  "enabled": true
}
```

**为什么选择 MCP 工具而非插件？**
- depcruise 和 tsc 是**重量级操作**（需要数秒到数十秒），不适合在每次写入时自动运行
- 应与 `eslint-audit` 保持一致的模式：Agent 在提交前/审查前主动调用
- MCP 工具模式支持 per-agent 启用/禁用

### 3.3 agent 配置更新：write-time 检查流程修订

当前 agent 配置（Coder-BE.md, Coder-FE.md）仍在指导调用已废弃的 `code_quality_gate.run_write_check()`。修订后：

**旧流程**（删除）：
```
1. Call code_quality_gate.run_write_check(...) *(deprecated)*
```

**新流程**（替换为）：
```
Write-Time 检查流程（插件自动执行，无需 Agent 手动调用）：
1. scope-before.ts：写入前自动执行 Agent Scope + UC7KS + R4 检查
2. format-after.ts：写入后自动执行 Prettier 格式化
3. eslint_audit.run_audit({ changed_file })：写入后手动调用（建议但非阻塞）

Commit-Time 检查流程（Agent 在 compliance_gate_complete 前调用）：
1. code_quality_check.run_tsc_check({ changed_file })：类型检查
2. code_quality_check.run_depcruise_check({ changed_file })：架构依赖检查
3. code_quality_check.run_full_scan()：全量扫描（可选）
```

---

## 4. Phase 2: 死代码删除

### 4.1 删除文件清单

| 文件路径 | 操作 | 理由 |
|---------|------|------|
| `.opencode/scripts/mcp-tools/code-quality-gate.ts` | **删除** | 已废弃 MCP 包装器；功能已分散到 scope-before.ts + eslint-audit.ts + code-quality-check.ts |
| `.opencode/scripts/mcp-tools/code-quality-gate.test.js` | **删除** (如存在) | 对应源文件删除 |
| `.opencode/scripts/mcp-tools/code-quality-gate.test.ts` | **删除** (如存在) | 对应源文件删除 |

### 4.2 保留文件

| 文件路径 | 操作 | 理由 |
|---------|------|------|
| `.opencode/scripts/mcp-tools/code-quality-lib.ts` | **保留** | 包含被 format-after.ts 和 code-quality-check.ts 调用的纯函数实现 |

### 4.3 删除验证清单

- [ ] 确认 `code-quality-gate.ts` 的 `require.main === module` 块已无调用方
- [ ] 确认 `code-quality-gate.ts` 的 `module.exports` 中无其它文件引用
- [ ] 确认 `code-quality-lib.ts` 的导出在新调用方均可正常工作
- [ ] `grep -r "require.*code-quality-gate" .opencode/` 返回零结果

---

## 5. Phase 3: 引用清理

### 5.1 agent 前端 YAML frontmatter — `mcp_tools` 清理

需要从 `mcp_tools` 列表中**移除** `code-quality-gate`，**添加** `code-quality-check` 的 agent：

| Agent 配置 | 当前 mcp_tools | 变更 |
|-----------|---------------|------|
| `Coder-BE.md` L22 | `- code-quality-gate` | 删除此行，添加 `- code-quality-check` |
| `Coder-FE.md` L20 | `- code-quality-gate` | 删除此行，添加 `- code-quality-check` |
| `Guardian.md` L20 | `- code-quality-gate` | 删除此行，添加 `- code-quality-check` |
| `Architect.md` L19 | `- code-quality-gate` | 删除此行（Architect 只读，无需 code-quality-check） |
| `Super-Admin.md` L19 | `- code-quality-gate` | 删除此行（Super-Admin 已有 safe_shell/safe_edit） |
| `Knowledge-Curator.md` | 未在 frontmatter 列出，但在正文引用 | 仅清理正文引用，无需 mcp_tools 变更 |

### 5.2 agent 前端正文 — 指令清理

| Agent 配置 | 行号 | 当前内容 | 变更 |
|-----------|------|---------|------|
| `Coder-BE.md` | L65-66 | `enforced physically by code-quality-gate.ts Check 6` | 改为 `enforced by scope-before.ts plugin` |
| `Coder-BE.md` | L96 | `Call code_quality_gate.run_write_check(...)` | 替换为新的 Write-Time 检查流程（§3.3） |
| `Coder-FE.md` | L63 | `enforced physically by code-quality-gate.ts Check 6` | 改为 `enforced by scope-before.ts plugin` |
| `Coder-FE.md` | L94 | `Call code_quality_gate.run_write_check(...)` | 替换为新的 Write-Time 检查流程（§3.3） |
| `Guardian.md` | L88 | `code_quality_gate.get_audit_status()` | 改为 `读取 machine.json.write_audit_state 子状态` |
| `Knowledge-Curator.md` | L212 | `enforced by code-quality-gate and framework-enforcer.ts` | 改为 `enforced by framework-enforcer.ts` |

### 5.3 opencode.json — 权限清理

| Agent | 当前条目 | 操作 |
|-------|---------|------|
| Coder-BE | `"code_quality_gate": "allow"` (L345) | 删除此行 |
| Coder-FE | `"code_quality_gate": "allow"` (L428) | 删除此行 |
| Guardian | `"code_quality_gate": "allow"` (L473) | 删除此行 |
| Architect | `"code_quality_gate": "allow"` (L196) | 删除此行 |
| Super-Admin | `"code_quality_gate": "allow"` (L696) | 删除此行 |

**新增权限**（针对使用 code-quality-check 的 agent）：
| Agent | 新增条目 |
|-------|---------|
| Coder-BE | `"code_quality_check": "allow"` |
| Coder-FE | `"code_quality_check": "allow"` |
| Guardian | `"code_quality_check": "allow"` |

### 5.4 framework-self-test.ts — 检查项更新

| 检查项 | 行号 | 当前行为 | 变更 |
|--------|------|---------|------|
| Check 9 | L468-487 | 验证 Architect 的 mcp_tools 包含 `code-quality-gate` | **删除此检查** — Architect 不再需要 code-quality-gate |
| Check 15 | L621-633 | 验证 `code-quality-gate.ts` 文件存在 | **重写**为验证 `code-quality-check.ts` 和 `format-after.ts` 存在 |

**Check 15 新实现**：
```typescript
// Check 15: code-quality-check.ts + format-after.ts bootstrap
const cqcPath = path.join(scriptsDir, "mcp-tools", "code-quality-check.ts");
const cqcExists = fs.existsSync(cqcPath);
const fmtPath = path.join(pluginsDir, "format-after.ts");
const fmtExists = fs.existsSync(fmtPath);
checks.push(check(15, cqcExists && fmtExists,
  cqcExists && fmtExists
    ? "code-quality-check.ts and format-after.ts both exist"
    : `MISSING: ${!cqcExists ? "code-quality-check.ts" : ""} ${!fmtExists ? "format-after.ts" : ""}`));
```

### 5.5 mcp-tool-inventory.md — 文档更新

**第 1.12 节 Code Quality Gate** (L116-136) 需要完全重写：

新内容：
```markdown
### 1.12 Code Quality Check MCP 工具（v4.0.0 — 替代已废弃的 code-quality-gate）

| 工具名称 | 功能描述 | 适用场景 |
|---------|---------|---------|
| `code_quality_check.run_tsc_check({ changed_file })` | 对单个文件运行 tsc --noEmit --incremental 类型检查 | @Coder-BE/@Coder-FE 写入后验证类型安全 |
| `code_quality_check.run_depcruise_check({ changed_file })` | 对单个文件运行 dependency-cruiser 架构边界检查 | 提价前验证导入依赖合规 |
| `code_quality_check.run_full_scan()` | 全量扫描：tsc + depcruise + prettier | compliance_gate_complete 内部调用；Pre-commit hook |
```

同时在**第 2.2 节阻塞性 MCP 调用清单**中更新：
- 删除 `code_quality_gate.*` 条目
- 添加 `code_quality_check.*` 条目在 Commit-Time 层

### 5.6 其他文档引用清理

| 文件 | 引用位置 | 操作 |
|------|---------|------|
| `.opencode/rules/rule_detail/state-machine-standard.md` | 可能有引用 | 搜索并清理 |
| `.opencode/rules/rule_detail/universal-compatibility-profile.md` | 可能有引用 | 搜索并清理 |
| `docs/review/**` 中的其他文档 | 可能有引用 | 搜索并清理 |

---

## 6. Phase 4: 验证

### 6.1 自检脚本

```bash
# 1. 确认 dead code 已删除
test ! -f .opencode/scripts/mcp-tools/code-quality-gate.ts && echo "PASS: code-quality-gate.ts removed"

# 2. 确认新文件已创建
test -f .opencode/scripts/mcp-tools/code-quality-check.ts && echo "PASS: code-quality-check.ts created"
test -f .opencode/plugins/format-after.ts && echo "PASS: format-after.ts created"

# 3. 确认旧引用已清除（应在 .opencode/ 中无残留）
grep -r "code.quality.gate" .opencode/agents/ --include="*.md" -l | grep -v ".opencode_backups" && echo "FAIL: stale code-quality-gate refs in agents" || echo "PASS: agent refs cleaned"
grep "code.quality.gate" opencode.json && echo "FAIL: stale ref in opencode.json" || echo "PASS: opencode.json cleaned"

# 4. 运行框架自检
bun .opencode/scripts/framework-self-test.ts

# 5. 验证 code-quality-lib.ts 导出完整性
bun -e "const lib = require('./.opencode/scripts/mcp-tools/code-quality-lib.ts'); console.log(Object.keys(lib))"

# 6. 验证新 MCP 工具可加载
bun .opencode/scripts/mcp-tools/code-quality-check.ts --dry-run 2>&1 | head -5
```

### 6.2 回归测试检查点

- [ ] @Coder-BE 能正常写入后端代码（scope-before 放行）
- [ ] @Coder-FE 能正常写入前端代码（scope-before 放行）
- [ ] eslint-audit MCP 工具仍可正常工作
- [ ] compliance_gate_complete 仍可正常执行
- [ ] framework-self-test.ts 所有检查通过
- [ ] pre-commit hook 正常工作

---

## 7. 文件变更清单总览

### 新增文件
| 文件 | 行数估计 |
|------|---------|
| `.opencode/plugins/format-after.ts` | ~50 行 |
| `.opencode/scripts/mcp-tools/code-quality-check.ts` | ~150 行 |

### 删除文件
| 文件 | 
|------|
| `.opencode/scripts/mcp-tools/code-quality-gate.ts` (904 行) |
| `.opencode/scripts/mcp-tools/code-quality-gate.test.js` (如存在) |
| `.opencode/scripts/mcp-tools/code-quality-gate.test.ts` (如存在) |

### 修改文件（共 8 个 agent/rule 配置 + 2 个基础设施文件）
| 文件 | 变更类型 | 
|------|---------|
| `.opencode/agents/Coder-BE.md` | frontmatter: 删除 code-quality-gate, 添加 code-quality-check; 正文: 更新引用 |
| `.opencode/agents/Coder-FE.md` | frontmatter: 删除 code-quality-gate, 添加 code-quality-check; 正文: 更新引用 |
| `.opencode/agents/Guardian.md` | frontmatter: 删除 code-quality-gate, 添加 code-quality-check; 正文: 更新引用 |
| `.opencode/agents/Architect.md` | frontmatter: 删除 code-quality-gate |
| `.opencode/agents/Super-Admin.md` | frontmatter: 删除 code-quality-gate |
| `.opencode/agents/Knowledge-Curator.md` | 正文: 删除 code-quality-gate 引用 |
| `opencode.json` | mcp: 注册 code-quality-check; plugin: 注册 format-after; 删除各 agent 的 code_quality_gate 权限; 添加 code_quality_check 权限 |
| `.opencode/scripts/framework-self-test.ts` | 删除 Check 9, 重写 Check 15 |
| `.opencode/rules/rule_detail/mcp-tool-inventory.md` | 重写 §1.12; 更新 §2.2 |
| `docs/review/framework-refactor/code-quality-cleanup-plan.md` | 本文档（实施完成后归档为记录） |

### 不受影响/保留的文件
| 文件 | 理由 |
|------|------|
| `.opencode/scripts/mcp-tools/code-quality-lib.ts` | 保留作为共享审计库，被 format-after.ts 和 code-quality-check.ts 调用 |

---

## 8. 风险与回滚

### 8.1 风险矩阵

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|-------|---------|
| format-after.ts 与 scope-after.ts 钩子冲突 | 写入后双钩子触发异常 | 低 | 在不同钩子点（after），不冲突 |
| code-quality-check.ts 中依赖 code-quality-lib.ts 的 `require()` 路径错误 | MCP 工具启动失败 | 中 | 遵循现有 `eslint-audit.ts` 的 require 路径模式 |
| 删除 code-quality-gate.ts 后其它脚本仍引用 | 脚本运行时报错 | 低 | Phase 4 的 grep 验证覆盖 |
| opencode.json 格式错误 | OpenCode 启动失败 | 中 | 使用 `OPENCODE_DISABLE_PROJECT_CONFIG=1` 回退修复 |

### 8.2 回滚方案

若整合后出现问题：
1. 恢复 `code-quality-gate.ts`：`git checkout -- .opencode/scripts/mcp-tools/code-quality-gate.ts`
2. 恢复 `opencode.json`：`git checkout -- opencode.json`
3. 恢复 agent 配置：`git checkout -- .opencode/agents/`
4. 删除新增文件：`rm .opencode/plugins/format-after.ts .opencode/scripts/mcp-tools/code-quality-check.ts`
5. 若 OpenCode 无法启动：设置 `OPENCODE_DISABLE_PROJECT_CONFIG=1`，修复后移除

---

## 9. 附录

### A. 架构对照：清理前 vs 清理后

```
清理前:
  code-quality-gate.ts (MCP wrapper, 904行, 未注册/不可用)
    ├── require code-quality-lib.ts → 6个检查函数
    ├── MCP server (未启动)
    └── 5项检查中只有 2项有实际调用方

  code-quality-lib.ts (共享库, 1045行)
    ├── runScopeCheck() → scope-before.ts ✅
    ├── runPrettierCheck() → ❌ 孤儿
    ├── runDepCruiserCheck() → ❌ 孤儿
    ├── runEslintAudit() → eslint-audit.ts ✅
    └── runTscCheck() → ❌ 孤儿

清理后:
  format-after.ts (插件, ~50行, 自动注册)
    └── require code-quality-lib.ts → runPrettierCheck() ✅

  code-quality-check.ts (MCP tool, ~150行, opencode.json 注册)
    ├── require code-quality-lib.ts → runDepCruiserCheck() ✅
    ├── require code-quality-lib.ts → runTscCheck() ✅
    └── require code-quality-lib.ts → runFullScan() ✅

  code-quality-lib.ts (共享库, 1045行, 保留不变)
    └── 全部 6 个函数现在都有运行时调用方 ✅
```

### B. 参考资料

- `scope-before.ts` 插件架构文档: `docs/official_docs/opencode/plugins/scope-before-write-blocking.md`
- OpenCode 插件开发文档: `docs/official_docs/opencode/framework/plugins.md`
- OpenCode MCP Server 文档: `docs/official_docs/opencode/framework/mcp-servers.md`
- OpenCode 自定义工具文档: `docs/official_docs/opencode/framework/custom-tools.md`
- `eslint-audit.ts` 实现参考: `.opencode/scripts/mcp-tools/eslint-audit.ts`
- `withPluginLifecycle` 用法: `.opencode/lib/hook-lifecycle.ts`
