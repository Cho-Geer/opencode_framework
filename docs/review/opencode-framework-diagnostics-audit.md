# OpenCode Framework 诊断与治理工具体系 — 深度调查报告

**调查日期**: 2026-05-26
**调查范围**: 框架诊断工具、健康检查脚本、状态一致性扫描、状态修复工具、安装钩子工具、规则注册表验证、权限隔离层、safe-edit 工具、safe-test 验证、门禁生命周期审计、框架合规检查
**调查方式**: 只读，不操作

---

## 一、工具体系全景图

### 已发现的工具清单（对照11个调查方向）

| 方向 | 对应文件 | 行数 | 状态 |
|------|---------|------|------|
| 框架诊断工具 | `framework-self-test.js` (27项检查), `framework-doctor.js` (11项健康检查) | 1662 + 1270 | 已实现 |
| 健康检查脚本 | `framework-health-check.sh` (4步聚合) | 67 | 已实现 |
| 状态一致性扫描 | `state-integrity-scan.js`, `state-reconciliation.js` | 184 + 874 | 已实现 |
| 状态修复工具 | `state-reconciliation.js --fix`, `state-machine-reset.sh` | 874 + 296 | 已实现 |
| 安装钩子工具 | `install-hooks.js` | 165 | 已实现 |
| 规则注册表验证 | `rule-registry-verify.js` | 350 | 已实现 |
| 权限隔离层 | `opencode.json` + `framework-enforcer.js` | 217 + 910 | 已实现 |
| safe-edit 工具 | `tools/safe-edit.js` | 284 | 已实现 |
| safe-test 验证 | `safe-edit.test.js`, `safe-bash.test.js` | 246 + 154 | **safe-bash 未实现** |
| 门禁生命周期审计 | `gate-lifecycle-audit.js` | 181 | 已实现 |
| 框架合规检查 | `framework-compliance-check.js` | 182 | 已实现 |

### 完整的脚本清单（共46个文件）

```
.opencode/
├── scripts/
│   ├── framework-self-test.js        # 27项绑定力自检
│   ├── framework-doctor.js           # 11项健康诊断
│   ├── framework-health-check.sh     # 4步健康检查聚合
│   ├── state-integrity-scan.js       # JSON有效性/孤儿引用扫描
│   ├── state-reconciliation.js       # DAG↔Gate↔Machine一致性协调
│   ├── state-machine-reset.sh        # machine.json 重置恢复
│   ├── state-transaction.js          # 原子写引擎 (WAL + 两阶段提交)
│   ├── state-reset.js                # 状态重置
│   ├── state-canonicalize.js         # 状态规范化
│   ├── gate-lifecycle-audit.js       # 门禁生命周期审计
│   ├── framework-compliance-check.js # 框架合规检查 (6项)
│   ├── pre-execution-gate.js         # 执行前门禁 (5项检查)
│   ├── pre-execution-hook.sh         # 多阶段执行前检测
│   ├── rule-registry-verify.js       # 规则注册表摘要校验+修复
│   ├── install-hooks.js              # Git hooks 安装与验证
│   ├── enforcement-mode-check.sh     # 强制执行模式查询
│   ├── compliance-audit.sh           # 合规审计
│   ├── integrity-chain-bundle.sh     # 完整性链打包
│   ├── path-canonical-lint.sh        # 路径规范化检查
│   ├── reconciliation-check.sh       # 备用协调检查(Shell版)
│   ├── setup.sh                      # 框架初始化
│   ├── dispatch-subagent.js          # Agent调度/模板解析
│   ├── mcp-tools/
│   │   ├── compliance-gate.js        # 合规门禁
│   │   ├── code-quality-gate.js      # 代码质量门禁
│   │   ├── code-quality-lib.js       # 代码质量共享库
│   │   ├── eslint-audit.js           # ESLint mock-audit
│   │   ├── keystone-validate.js      # Keystone契约/证据校验
│   │   └── reconciliation-validate.js# 协调验证(备用)
│   └── __tests__/                    # 10个测试文件
├── tools/
│   ├── safe-edit.js                  # 原子编辑+TOCTOU保护
│   └── eslint-plugin-opencode-mock-audit/  # 11条ESLint规则
├── plugins/
│   ├── framework-enforcer/
│   │   ├── framework-enforcer.js     # 运行时治理插件
│   │   └── framework-enforcer.ts     # 插件源文件
│   └── lib/
│       └── framework-validation.cjs  # 共享验证库 (TS编译)
├── hooks/
│   ├── pre-commit                    # 提交前验证
│   └── commit-msg                    # 提交消息TDD验证
└── state/
    ├── machine.json                  # 状态机
    ├── gate-state.json               # 合规门禁会话
    ├── rule_registry.json            # 规则摘要注册表
    └── framework-authorities.json     # 框架权限定义
```

---

## 二、发现的 Bug

### Bug #1【严重】safe-edit 首次调用必然返回 TOCTOU 失败

**文件**: `.opencode/tools/safe-edit.js:125-139`

```js
if (!_fileRegistry.has(registryKey)) {
  _fileRegistry.set(registryKey, { ... });
  try { fs.rmSync(backupPath, { force: true }); } catch (_) {}
  return {
    success: false,
    error: 'TOCTOU race detected: no baseline audit in registry — first call establishes baseline, call safeEdit again to verify',
  };
}
```

**问题**: 第一次调用 safeEdit 时，`_fileRegistry` 是空的，代码建立基线后返回失败。第二次调用才会成功。设计意图是“两次调用协议”（先审计→再写入），但测试期望单次调用即可成功。这导致 `safe-edit.test.js` Test B（成功写入测试）在第一次执行时必然失败。

**影响**: safe-edit 对每个新文件都会产生一次无效的失败调用。在实际使用中（如框架 enforcer 的 Write Audit），需要连续调用两次才能成功写入。

---

### Bug #2【严重】framework-self-test 期望 10 个 Doctor 检查，实际 Doctor 有 11 个

**文件**: `framework-self-test.js:1453` vs `framework-doctor.js:1011-1023`

```js
// self-test Check 25:
if (parsed.checks.length !== 10) {
  return check(25, false, `Expected 10 checks but found ${parsed.checks.length}`);
}

// doctor.js CHECKS 数组实际有 11 个:
const CHECKS = [checkOpenCodeJson, checkDagValidation, checkGateDryRun,
  checkStateReconciliation, checkTransactionVerification, checkRuleRegistry,
  checkGitHooks, checkPathPortability, checkEncoding, checkRolePermissionSync,
  checkFrameworkCompliance];  // 共 11 个
```

**影响**: 框架自检 Check 25 必然失败。`framework-self-test.js` 通过时应当全部 27 项 PASS，但此项硬编码数组长度不同步使 tool 永远处于 FAIL 状态。

---

### Bug #3【严重】DAG 验证字段名与 Schema 标准冲突

**文件**: `framework-doctor.js:207` vs `dag-generation-standard.md`

```js
// doctor.js 期望 "title" 字段:
const requiredFields = ["id", "title", "status", "owner"];

// dag-generation-standard.md 定义的是 "name":
"tasks": [{ "id": "string", "name": "string", ... }]
```

**影响**: 如果 DAG 使用标准 Schema 的 `name` 字段，doctor 的 DAG 验证会误报缺少 `title` 字段。

---

### Bug #4【中等】门禁过期判断时间基准不一致

三个不同的过期检测实现使用不同的时间字段：

| 文件 | 方法 | 过期基准字段 | 阈值 |
|------|------|-------------|------|
| `state-reconciliation.js:219` | `checkOrphanedSessions` | `confirmed_at` | >24h |
| `gate-lifecycle-audit.js:88-128` | `main` | `created_at` | >24h armed, >48h checked/failed |
| `framework-compliance-check.js:80-83` | `main` | `created_at` | >24h 且未消费 |

`confirmed_at` 只在 `compliance_gate_confirm` 时设置，`created_at` 在 `compliance_gate_check` 时设置。同一个过期 session 在不同工具中可能被判定为“已过期”或“未过期”，导致行为不一致。特别是如果 compliance_gate_check 和 confirm 之间间隔数小时，`gate-lifecycle-audit` 可能过早判定为过期。

---

### Bug #5【中等】framework-enforcer.js Hook 完整性检查阈值过于宽松

**文件**: `framework-enforcer.js:117,126`

```js
_pluginHooksCount = 14;

// ...
if (_pluginHooksCount < 2) {  // 仅检查是否少于2个
  return { valid: false, detail: `Only ${_pluginHooksCount} hooks registered` };
}
```

10 个实际导出的 hook handler 对应 14 个声明计数。但阈值 `< 2` 意味着只剩 1 个 hook 注册也通过检测。这无法检测到实际的 hook 注册损失。

---

## 三、发现的矛盾与冲突

### 矛盾 #1【严重】4 套独立的重叠过期检测逻辑，drained_sessions 数据类型不一致

| 实现 | 位置 | 行为 |
|------|------|------|
| `fixDrainOrphanedSessions` | state-reconciliation.js:364 | 移动 session 到 drained_sessions，修改 `gate_status="drained"` |
| `--auto-drain` | gate-lifecycle-audit.js:137 | 移动 session 到 `drained_sessions`，**删除**原 sessions 条目 |
| `autoDrainStaleSessions` | framework-enforcer.js:251 | 推入 `drained_sessions` 数组（不是对象），删除原条目 |
| `checkStaleSessions` | 同上:240 | 仅计数，不操作 |

**核心冲突**: `gate-state.json` 的 `drained_sessions` 字段在不同工具中被当作**对象**（state-reconciliation.js: `gateState.drained_sessions[sid] = {...}`）和**数组**（framework-enforcer.js: `gate.drained_sessions.push({...})`）处理。前者期望 `{ sid: {...} }`，后者期望 `[{...}, {...}]`。两者同时运行时必然互相破坏数据结构。

---

### 矛盾 #2【严重】framework-compliance-check.js 的 machine.json clean check 不完整

`framework-compliance-check.js:116-143` 仅检查 4 个 sub-state 的清洁度：`eslint_state`, `type_check_state`, `format_state`, `dependency_state`。

但 `machine.json` 包含 **10 个 sub-state**：
- `eslint_state` ✅ 已检查
- `type_check_state` ✅ 已检查
- `dependency_state` ✅ 已检查
- `format_state` ✅ 已检查
- `write_audit_state` ❌ 未检查（越权写入检测）
- `compliance_records` ❌ 未检查（角色违规记录）
- `tdd_enforcement_state` ❌ 未检查
- `contracts` ❌ 未检查
- `keystone_hashes` ❌ 未检查
- `meta` ❌ 未检查

---

### 矛盾 #3【中等】pre-execution-hook.sh 的阶段标号与实现不符

`pre-execution-hook.sh` 头部注释列出 Stage 1→2→3，但实际脚本在第 198 行插入了一个未被文档化的 Stage 2.5（State Reconciliation）。新增开发者查看头注释时会认为只运行了 3 个阶段。

---

### 矛盾 #4【中等】Health Check 聚合遗漏关键组件

`framework-health-check.sh` 执行 4 个步骤：
1. `framework-doctor.js --strict`
2. `framework-self-test.js`
3. `state-reconciliation.js --strict`
4. `rule-registry-verify.js --strict`

但遗漏了：
- `state-integrity-scan.js`（JSON 有效性扫描）
- `framework-compliance-check.js`（合规性检查）
- `gate-lifecycle-audit.js`（门禁生命周期审计）

这意味着 HEALTHY 状态并**不能保证**门禁会话没有过期或 JSON 文件完整。

---

## 四、遗漏分析

### 遗漏 #1: safe-bash 工具仅有 RED 阶段测试（功能未实现）

**文件**: `safe-bash.test.js`, `code-quality-lib.js`

`safe-bash.test.js` 的注释明确指出这只是 RED 阶段测试。`safeBash` 和 `DEFAULT_ALLOWLIST` 尝试从 `code-quality-lib.js` 导入，但这部分功能**根本没有实现**。基于 allowlist 的安全 Bash 执行保护完全不存在。所有 tool=Bash 的调用只能依赖 `framework-enforcer.js` 中对危险命令的正则匹配（`rm.*\.opencode` 等）——它只能拦截少量模式，不是真正的 allowlist。

---

### 遗漏 #2: 无统一测试运行器

10 个测试文件（`__tests__/*.test.js`）分散在各处，但没有统一的 `npm test` 或 CI 集成来运行框架自身的全套测试。`framework-self-test.js` 验证结构完整性，但不运行单元测试。

---

### 遗漏 #3: write_audit_state 验证完全缺失

`write_audit_state` 记录每个 Agent 的越权写入历史，这是权限隔离的核心证据，但**没有任何工具验证 `write_audit_state.history` 中的记录与实际文件修改的一致性**。`framework-compliance-check.js` 和 `state-integrity-scan.js` 都跳过了此字段。Agent 可以写入 `agent_write_scopes` 范围之外的文件而不被事后审计检测到。

---

### 遗漏 #4: DAG 循环依赖检测缺失

`framework-doctor.js` 的 DAG 验证（Check 2）检查依赖是否存在（`const depExists = dag.tasks.some((t) => t.id === dep)`），但**不检测循环引用**（A→B→C→A）。这可能导致 @Orchestrator 调度进入死锁。

---

### 遗漏 #5: agent_write_scopes 完整性未验证

`project.config.json` 中定义了每个 Agent 的写权限范围，但没有工具验证：
- 是否所有 8 个 Agent 都有对应的 scope 定义
- scope 路径模式是否有效
- 是否存在权限过大的 Agent（如允许写入 `**`）

---

### 遗漏 #6: Safe-edit 与框架编辑通道完全未集成

`safe-edit.js` 是一个独立模块，提供 TOCTOU 保护、原子备份和回滚。但 `framework-enforcer.js` 的 `toolExecuteBefore` hook 中检测到 `tool === "edit"` 时**并未调用 safe-edit**。框架在工具层的 Permissions（`opencode.json` 的 `permission.edit`）和 safe-edit 的 TOCTOU 保护之间没有任何连接。两者是完全独立的安全层。

---

### 遗漏 #7: state-integrity-scan 对缺失文件的处理不够稳健

`state-integrity-scan.js:23-26` 期望扫描 5 个文件，包括 `rule_registry.json`。如果该文件不存在（新项目），脚本会给出一条 HIGH 级违规，但这实际上不是错误——规则注册表在项目初始化时可能还不存在。

---

### 遗漏 #8: 健康检查结果未写入 CI-reportable 格式

`framework-health-check.sh` 和 `framework-doctor --json` 输出到 stdout/stderr，但没有将健康报告写入 JUnit XML 或类似格式供 CI 系统消费。CI pipeline 无法以标准方式从检查结果中判断构建是否应继续。

---

## 五、架构设计问题

### 1. 重复代码模式严重

4 个文件各自实现了 staleness 检测、JSON 读取、SHA-256 计算。虽然 `framework-validation.cjs` 试图提取公共逻辑，但只有 3 个脚本实际使用了它（`state-integrity-scan.js`, `gate-lifecycle-audit.js`, `framework-compliance-check.js`），而 `state-reconciliation.js`, `pre-execution-gate.js`, `framework-doctor.js` 仍各自实现相同的 readFile/readJSON 等 helper。

### 2. TypeScript ESM → CJS 编译产物混用

`framework-validation.cjs` 是 `.ts` 编译产物（带有 `__importStar` 等 TypeScript helper 函数，共约517行），但被 `.js` 脚本通过 `require('../plugins/lib/framework-validation.cjs')` 引入。这依赖于 TypeScript 编译器的输出设置，如果目标改为 ESM 或输出不同命名，所有引用都会断裂。

### 3. state-machine-reset.sh 依赖 jq 但未在 install-hooks 中验证

`install-hooks.js` 只验证 git hooks 的安装，不验证 `jq` 是否已安装。而 `state-machine-reset.sh` 在 Line 48-52 会因 `jq` 缺失而崩溃。用户执行 hooks 安装后以为一切就绪，但状态重置会失败。

### 4. 多个工具输出混合 stderr/stdout

`pre-execution-gate.js` 将结构化报告写到 **stderr**，将关键消息也写到 stderr。`state-reconciliation.js` 将 human-readable 输出写 stdout 但 `--json` 也写 stdout，且 stderr 也有信息输出。`framework-doctor.js --json` 写 stdout 但非 `--json` 时也写 stdout。集成到 CI pipeline 时解析这些混合输出非常困难。

### 5. 单文件中有两个完整的过期检测实现

`framework-enforcer.js` 中的 `checkStaleSessions()`（只读计数）和 `autoDrainStaleSessions()`（自动清理）是可以合并为一个函数的，后者可以简单地返回计数而不执行清理。

---

## 六、与 OpenCode 官方文档的对比

查阅 [opencode.ai/docs](https://opencode.ai/docs)，官方 OpenCode 框架的核心概念是 `AGENTS.md`、`/init`、`/connect`、配置权限等用户级能力。本文档中分析的整套 `.opencode/scripts/` 诊断与治理体系**完全是社区/项目自定义的扩展层**，并非 OpenCode 原生功能。

这意味着：
- 这些工具的维护完全依赖本项目自身
- 升级 OpenCode 核心版本时，`opencode.json` 的 hooks/plugins 接口可能变化
- `framework-enforcer.ts` 依赖的 `plugin` 导出接口（如 `tool.execute.before`）需要与 OpenCode 版本保持兼容
- 官方文档中 `Plugins` 和 `Custom Tools` 章节对这些扩展机制有描述，但本项目使用的特定 hook 名称（如 `session.idle`, `permission.asked`）需要验证是否与当前 OpenCode 版本支持的事件名完全匹配

---

## 七、修复优先级建议

| 优先级 | 项目 | 简述 |
|--------|------|------|
| P0 | Bug #1 | safe-edit 首次调用失败——需添加基线建立后自动重试逻辑 |
| P0 | Bug #2 | self-test Check 25 硬编码 10 → 改为动态检查或更新为 11 |
| P0 | 矛盾 #1 | drained_sessions 对象/数组类型统一——选择一种表示并全局一致 |
| P1 | Bug #3 | DAG 验证字段名 title → name |
| P1 | Bug #4 | 过期检测时间基准统一为 confirmed_at |
| P1 | 矛盾 #2 | framework-compliance-check 扩展为检查全部 10 个 sub-state |
| P1 | 遗漏 #1 | 实现 safe-bash allowlist 保护（完成 GREEN 阶段） |
| P2 | 遗漏 #3 | 添加 write_audit_state 验证到 state-reconciliation |
| P2 | 遗漏 #4 | 添加 DAG 循环依赖检测 |
| P2 | 遗漏 #6 | 集成 safe-edit 到 framework-enforcer edit path |
| P3 | 遗漏 #2 | 添加统一测试运行器 |
| P3 | 架构 #3 | 在 install-hooks 中添加 jq 依赖检查 |

---

## 八、调查方法说明

本调查采用以下方法：
1. 读取 `.opencode/scripts/` 等全部 46 个相关文件的源代码
2. 交叉对照不同工具对同一状态数据的读写方式
3. 对照 `AGENTS.md`、`dag-generation-standard.md`、`state-machine-standard.md` 等规范文件验证实现一致性
4. 查阅 opencode.ai 官方文档验证功能属于原生还是社区扩展
5. 未做任何写操作或修改

---
