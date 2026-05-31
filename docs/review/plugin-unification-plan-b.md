# Plan B: Plugin Unification — Final Implementation Plan

## 1. 问题背景

Coder-BE 在执行 `safe_edit` 修文件时反复卡住，根因链：

```
Coder-BE 调 safe_edit → _fileRegistry 为空 → TOCTOU error "first call establishes baseline"
→ index.ts 直接抛异常(无重试) → Coder-BE 尝试诊断 → 读文件改变 mtime
→ 重试 → TOCTOU 又失败 → 死循环 → "maximum steps reached" 截断
```

5个根因：

| # | 根因 | 严重度 |
|:-:|------|:------:|
| 1 | `index.ts` safe_edit 无 TOCTOU 重试，第一次调用必然失败 | 🔴 P0 |
| 2 | `_fileRegistry` 是内存 Map，新 Session 即丢失 | 🔴 P0 |
| 3 | Coder-BE 在第一次失败后诊断读文件，改变了 mtime/ino | 🟡 P1 |
| 4 | 24 个备份文件堆积证实重复失败循环 | 🟡 P2 |
| 5 | 三套入口实现并存，只有一套有重试 | 🔴 P0 |

## 2. 当前架构分析

### 2.1 四套入口实现

| 文件 | 行数 | 角色 | 活跃？ | TOCTOU 重试？ | overwrite 模式？ |
|------|:---:|------|:------:|:-------------:|:----------------:|
| `index.ts` | 151 | 插件入口 | ✅ | ❌ | ❌ |
| `plugin-entry.ts` | 181 | 备选入口 | ❌ | ❌ | ❌ |
| `combined-plugin.ts` | 88 | 最简入口 | ❌ | ❌ | ❌ |
| `tool-definitions.ts` | 198 | 工厂函数 | ❌ | ✅ | ✅ |

### 2.2 核心库重复

- `lib/safe-edit-core.ts` vs `plugins/lib/safe-edit.ts` — 两份 safe_edit
- `lib/safe-bash-core.ts` vs `plugins/lib/safe-bash.ts` — 两份 safe_bash
- `lib/permission-isolation-core.ts` vs `plugins/lib/permission-isolation.ts` — 两份 PermissionIsolation
- `lib/gate-core.ts` vs `plugins/lib/gate-lifecycle.ts` — 两份 gate 逻辑

### 2.3 框架-enforcer 双重副本

- `plugins/framework-enforcer.ts`（根级，1144行） — 静态副本
- `plugins/framework-enforcer/framework-enforcer.ts`（目录内，1293行） — 实际加载版本

`STATE_PATHS.pluginSelf` 指向根级版本，但 `index.ts` 实际加载目录内版本。

## 3. 方案B完整变更清单

### 删除（11个）

```
1. plugins/framework-enforcer.ts              ← 根级副本
2. plugins/framework-enforcer/plugin-entry.ts  ← 废弃入口
3. plugins/framework-enforcer/combined-plugin.ts ← 废弃入口
4. plugins/lib/safe-edit.ts                   ← 与 lib/safe-edit-core 重复
5. plugins/lib/safe-bash.ts                   ← 与 lib/safe-bash-core 重复
6. plugins/lib/safe-test.ts                   ← 与 lib/safe-test-core 重复
7. plugins/lib/permission-isolation.ts        ← 与 lib/permission-isolation-core 重复
8. plugins/lib/tool-definitions.ts            ← 功能合并到 index.ts
9. plugins/lib/gate-lifecycle.ts              ← 与 lib/gate-core 重复
10. plugins/lib/framework-validation.ts       ← gate 辅助
11. plugins/framework-enforcer/.opencode_backups/ ← TOCTOU 失败残留
```

### 重写（1个）

`framework-enforcer/index.ts`（151→~190行）：
- safe_edit 增加 TOCTOU 重试：检测 `"first call establishes baseline"` 后自动重试一次
- safe_edit 增加 `overwrite` 模式：支持完整文件覆盖写入
- safe_bash 返回结构化对象：`{ output, metadata: { exitCode, stderr, agent } }`
- 导入源统一为 `../../lib/index` barrel export

### 修改（2个）

**`framework-enforcer/framework-enforcer.ts`** — 修正两处路径：
```diff
- ".opencode/plugins/framework-enforcer.ts",
+ ".opencode/plugins/framework-enforcer/framework-enforcer.ts",

- pluginSelf: () => resolveStatePath(".opencode/plugins/framework-enforcer.ts"),
+ pluginSelf: () => resolveStatePath(".opencode/plugins/framework-enforcer/framework-enforcer.ts"),
```

**`framework-enforcer/package.json`** — 新增 build script：
```diff
+ "scripts": { "build": "tsc" }
```

## 4. 统一后目录结构

```
.opencode/
├── lib/                                    ← 唯一核心库层
│   ├── index.ts                            ← barrel export（正式启用）
│   ├── safe-edit-core.ts                   ← safe_edit 单一来源
│   ├── safe-edit-core.js                   ← 编译产物
│   ├── safe-bash-core.ts                   ← safe_bash 单一来源
│   ├── safe-bash-core.js                   ← 编译产物
│   ├── safe-test-core.ts / .js
│   ├── permission-isolation-core.ts / .js
│   ├── gate-core.ts
│   └── __tests__/
│
├── plugins/
│   └── framework-enforcer/                 ← 唯一插件目录
│       ├── package.json
│       ├── framework-enforcer.ts           ← 14 hooks（路径已修正）
│       └── index.ts                        ← 统一入口（已重写）
```

## 5. 六个框架方面影响评估

| 方面 | 影响 | 说明 |
|------|:----:|------|
| **Design Architecture** | ✅ 增强 | 三套入口→一套，消除架构坏味道 |
| **Harness System** | ✅ 零影响 | FW-HARNESS-* 检查点在 framework-enforcer.ts 中，不改 |
| **Permission Matrix** | ✅ 零影响 | 权限在 opencode.json + framework-enforcer.ts，不改 |
| **Multi-Agent System** | ✅ 零影响 | 工具注册机制不变，所有 agent 共享同一套工具 |
| **Central State Management** | ✅ 零影响 | machine.json/gate-state.json 读写都在 framework-enforcer.ts |
| **Templatization** | ✅ 零影响 | 模板变量由 dispatch-subagent.js 处理，插件层不参与 |

## 6. 执行顺序（4阶段）

### Phase 1: 准备
```bash
git add -A && git commit -m "chore: snapshot before Plan B unification"
# 验证无隐藏引用
grep -r "plugin-entry\|combined-plugin\|plugins/lib/safe-edit\|plugins/lib/safe-bash" .opencode/ --include="*.ts" --include="*.js" --include="*.json" | grep -v node_modules | grep -v backup
# 确认 lib/index.ts barrel export 包含所有导出
```

### Phase 2: 重写入口
```bash
# 1. 重写 framework-enforcer/index.ts
# 2. 修正 framework-enforcer/framework-enforcer.ts 两处路径
# 3. 更新 package.json scripts
```

### Phase 3: 验证
```bash
# 确认所有功能正常
# 测试 safe_edit TOCTOU 重试
# 测试 safe_bash 结构化返回
# 测试 safe_test
```

### Phase 4: 清理
```bash
# 删除 11 个废弃文件
rm -f .opencode/plugins/framework-enforcer.ts
rm -f .opencode/plugins/framework-enforcer/plugin-entry.ts
rm -f .opencode/plugins/framework-enforcer/combined-plugin.ts
rm -f .opencode/plugins/lib/safe-edit.ts
rm -f .opencode/plugins/lib/safe-bash.ts
rm -f .opencode/plugins/lib/safe-test.ts
rm -f .opencode/plugins/lib/permission-isolation.ts
rm -f .opencode/plugins/lib/tool-definitions.ts
rm -f .opencode/plugins/lib/gate-lifecycle.ts
rm -f .opencode/plugins/lib/framework-validation.ts
rm -rf .opencode/plugins/framework-enforcer/.opencode_backups/
# 提交
git add -A && git commit -m "feat: unify plugin entry, delete redundant implementations"
```

## 7. 风险矩阵与回滚策略

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:---:|:---:|----------|
| `lib/index.ts` 导入链断裂 | 低 | 高 | 执行前验证所有导入路径存在 |
| 路径修正遗漏 | 低 | 中 | 逐一核对 CRITICAL_PATTERNS 和 STATE_PATHS |
| 删除文件有隐藏引用 | 低 | 中 | 先 grep 确认无引用 |
| TOCTOU 重试引入新 bug | 低 | 低 | 与已验证的 tool-definitions.ts 逻辑一致 |

回滚：
```bash
git checkout -- .opencode/plugins/framework-enforcer/index.ts
git checkout -- .opencode/plugins/lib/
git checkout -- .opencode/plugins/framework-enforcer/plugin-entry.ts
git checkout -- .opencode/plugins/framework-enforcer/combined-plugin.ts
git checkout -- .opencode/plugins/framework-enforcer.ts
```

## 8. 关键代码段

### TOCTOU 重试模式
```typescript
let result = safeEdit(absPath, newContent);
if (!result.success && result.error?.includes("first call establishes baseline")) {
    result = safeEdit(absPath, newContent);
}
if (!result.success) {
    throw new Error(`safe_edit failed: ${result.error}`);
}
```

### overwrite 模式
```typescript
if (mode === "overwrite") {
    if (!args.content) {
        throw new Error("safe_edit failed: content required for overwrite mode");
    }
    let result = safeEdit(absPath, args.content);
    if (!result.success && result.error?.includes("first call establishes baseline")) {
        result = safeEdit(absPath, args.content);
    }
    if (!result.success) {
        throw new Error(`safe_edit failed: ${result.error}`);
    }
    return `File overwritten successfully (backup: ${result.backupPath || "none"})`;
}
```

### safe_bash 结构化返回
```typescript
return JSON.stringify({
    output: result.stdout || "",
    metadata: {
        exitCode: result.exitCode,
        stderr: result.stderr,
        executed: result.executed,
        agent: result.agent,
    },
}, null, 2);
```

