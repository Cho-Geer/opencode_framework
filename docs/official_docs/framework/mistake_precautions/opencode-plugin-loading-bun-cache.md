# OpenCode 插件加载与 Bun 缓存运行机制

**日期**: 2026-06-10  
**来源**: 框架修复实战经验 + Context7 搜索 OpenCode/Bun 源码  
**关联文件**: `plugin-debugging-precautions.md`, `double-hook-trigger-prevention.md`

---

## 1. OpenCode 插件加载机制

### 1.1 发现方式

| 方式 | 路径 | 行为 |
|------|------|------|
| 自动发现 | `.opencode/plugins/*.ts`, `*.js` | 启动时扫描所有 `.ts`/`.js` 文件 |
| 显式配置 | `opencode.json` → `"plugin": [...]` | 支持 npm 包名、本地文件路径、目录路径 |
| 自动发现(备选) | `.opencode/plugin/*.ts` (单数) | 源码中同时存在单数和复数路径 |

### 1.2 加载流程

```
opencode 启动
  │
  ├─ 1. 扫描 .opencode/plugins/ 下所有 *.ts, *.js
  ├─ 2. 对每个文件执行 import → Bun 编译 TS → 生成字节码
  ├─ 3. 查找 export default 或 export const PluginType
  ├─ 4. 调用导出函数(ctx) → 获取 { "tool.execute.before": fn, ... } hooks 对象
  ├─ 5. 将 hooks 注册到全局 hooks 数组
  │
  └─ 运行时：事件触发 → triggerFor("*", eventName) → 遍历所有插件 hooks
```

### 1.3 关键约束（实战验证）

| 约束 | 说明 |
|------|------|
| **export default 与 export const 不同** | `export const` + 返回 hooks → 静默失败。必须用 `export default` |
| **hook 函数必须与 export default 在同一模块** | import 进来的函数引用放在 return 里 → 静默失败。hook 函数必须在同一文件定义 |
| **子目录不被自动发现** | 必须显式配置在 `opencode.json` 的 `plugin` 中，或用扁平文件结构 |
| **`.opencode_backups` 等隐藏目录** | `safe_edit` 会自动创建备份目录，可能被 OpenCode 扫描到，干扰加载 |

### 1.4 Hook 分派机制（源码）

```typescript
// packages/core/src/plugin.ts
triggerFor: Effect.fn("Plugin.triggerFor")(function* (id, name, input, output) {
  for (const item of hooks) {
    if (id !== ID.make("*") && item.id !== id) continue
    const match = item.hooks[name]
    if (!match) continue
    yield* match(event as any).pipe(...)
  }
})
```

所有匹配的插件 hooks **链式调用**，不同 ID 的插件都会触发。

---

## 2. Bun 编译与缓存机制

### 2.1 缓存策略

| 阶段 | 行为 |
|------|------|
| 首次加载 | Bun 编译 `.ts` → 字节码，按 `(文件路径, 内容哈希)` 缓存 |
| 再次加载 | 校验字节码哈希 vs 当前源文件哈希 |
| 哈希匹配 | 直接使用缓存的字节码，跳过编译 |
| 哈希不匹配 | 应重新编译，但**不总是触发**（见 2.2） |

### 2.2 缓存失效的不可靠性（关键！）

源码验证：Bun 文档说"validates bytecode hash matches source before deciding whether to use cached bytecode"。

但实战证明：**修改 `.ts` 文件内容不一定触发重新编译**。

| 操作 | 是否触发重编译 |
|------|:---:|
| 小改动（注释、变量名） | ❌ 经常不触发 |
| 大改动（新增函数、大量代码） | ✅ 通常会触发 |
| 修改 `// BUN-CACHE-VERSION` 注释 | ❌ 不一定—注释可能不影响缓存键 |
| 重命名文件 | ✅ **100% 触发** |
| `rm -rf ~/.cache/bun` | ✅ **100% 触发** |

### 2.3 100% 可靠的缓存刷新方法

```bash
# 方法1：清除 Bun 全局缓存
rm -rf ~/.cache/bun

# 方法2：重命名文件（新文件名=新缓存键）
mv framework-enforcer.ts framework-enforcer-v2.ts
```

### 2.4 启动脚本刷新方案（推荐）

在 `~/.bashrc` 的 `opencode()` 函数中，启动前更新文件时间戳注释：

```bash
opencode() {
  # ... cd, .env 等 ...
  sed -i "s|^// BUN-CACHE-VERSION: .*|// BUN-CACHE-VERSION: $(date +%Y-%m-%d-%H:%M:%S)|" \
    .opencode/plugins/framework-enforcer.ts
  /home/zhaoge/.opencode/bin/opencode
}
```

**注意**：单纯改注释不一定触发 Bun 重编译。最可靠是在 sed 后加 `rm -rf ~/.cache/bun`。

---

## 3. 插件加载失败的排查清单

| # | 检查项 | 验证方法 |
|---|--------|----------|
| 1 | 插件文件在正确路径 | `ls .opencode/plugins/` — 只有 `.ts` 文件，无隐藏目录 |
| 2 | `opencode.json` 配置正确 | `"plugin"` 数组包含正确路径或设为 `[]` 靠自动发现 |
| 3 | 使用 `export default` | 检查文件末尾 |
| 4 | hook 函数与 export default 同文件 | 不要 import 外部函数放入 return |
| 5 | 无隐藏目录干扰 | `ls -la .opencode/plugins/` — 确保无 `.opencode_backups` |
| 6 | Bun 缓存已刷新 | `rm -rf ~/.cache/bun` |
| 7 | `.bashrc` 已 source | `source ~/.bashrc` 后重启终端 |
| 8 | 心跳日志验证 | 在 `export default` 函数体内写 `/tmp/` 文件 |

---

## 4. 本项目最终方案

```
.opencode/plugins/
└── framework-enforcer.ts      ← 唯一插件，所有 hooks + export default 同文件

.opencode/lib/                  ← 共享依赖（不在插件扫描目录）
├── gate-core.ts
├── gate-checks.ts
├── audit-log.ts
└── state-utils.ts
```

**原则**：
- plugins/ 目录只放插件 `.ts` 文件，没有子目录，没有隐藏文件
- 所有共享代码放 `.opencode/lib/`
- 启动前必须 `rm -rf ~/.cache/bun` 或 `.bashrc` 自动清理
