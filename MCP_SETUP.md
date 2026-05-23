# MCP Bootstrap & Setup Guide

> 本文档记录 `.opencode/` 目录下 MCP (Model Context Protocol) 工具的引导配置过程、已知问题及解决方案。  
> 最后更新: 2026-05-23

---

## 1. 概述

本项目在 `.opencode/scripts/mcp-tools/` 下使用 4 个 MCP 工具脚本，基于 `@modelcontextprotocol/sdk` (v1.29.0) 构建：

| MCP Tool Script | Purpose |
|-----------------|---------|
| `compliance-gate.js` | 合规门禁检查/确认/完成 |
| `code-quality-gate.js` | 代码质量门禁 (ESLint, tsc, depcruise, prettier) |
| `eslint-audit.js` | ESLint 模拟审计 |
| `keystone-validate.js` | Keystone 契约状态哈希校验 |

## 2. 安装依赖

```bash
cd .opencode
npm install
```

这将安装 `.opencode/package.json` 中声明的依赖：
- `@modelcontextprotocol/sdk@^1.8.0` → resolved to `1.29.0`

## 3. 已知问题：根级别 require() 失败

### 问题

`@modelcontextprotocol/sdk@1.29.0` 的 `require('@modelcontextprotocol/sdk')` (根级别导入) 会失败：

```
Error: Cannot find module '.../dist/cjs/index.js'
  code: 'MODULE_NOT_FOUND'
```

### 根因

上游 npm 包 `@modelcontextprotocol/sdk@1.29.0` 存在 **打包缺陷**：

- `package.json` 中 `exports` 字段指向 `dist/cjs/index.js` 和 `dist/esm/index.js`
- 但实际 `dist/` 目录中并没有 `index.js` 入口文件
- `dist/cjs/` 包含的是子目录 (`client/`, `server/`, `shared/` 等) 和独立文件 (`types.js`, `inMemory.js` 等)，没有根级别的 barrel 文件

这是 **上游 npm 注册表问题**，消费者无法在本地修复。  
详见：[WAIVE-RVW2-MCP-DEPS.md](.task_temp/_global/WAIVE-RVW2-MCP-DEPS.md)

### 解决方案：子路径导入

**所有 MCP 工具脚本必须使用子路径导入**，不能使用根级别 `require('@modelcontextprotocol/sdk')`。

#### ✅ 正确用法

```js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');
```

#### ❌ 错误用法

```js
// 以下写法会失败！
const { Server } = require('@modelcontextprotocol/sdk').server;      // MODULE_NOT_FOUND
const mcp = require('@modelcontextprotocol/sdk');                    // MODULE_NOT_FOUND
import { Server } from '@modelcontextprotocol/sdk/server/index.js'; // ESM 需额外验证
```

#### 验证命令

```bash
# 验证子路径导入可正常工作
node -e "require('@modelcontextprotocol/sdk/client')"   # 期望 EXIT: 0
node -e "require('@modelcontextprotocol/sdk/server')"   # 期望 EXIT: 0
node -e "require('@modelcontextprotocol/sdk/types.js')"  # 期望 EXIT: 0

# 确认根级别导入失败（预期行为，非 Bug）
node -e "require('@modelcontextprotocol/sdk')"           # 期望 EXIT: 1
```

## 4. 引导验证步骤

完成 `npm install` 后，按以下步骤验证 MCP 工具栈可用：

```bash
# 1. 确认依赖已安装
ls .opencode/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js

# 2. 确认 4 个 MCP 工具脚本语法正确（仅解析，不执行）
node --check .opencode/scripts/mcp-tools/compliance-gate.js
node --check .opencode/scripts/mcp-tools/code-quality-gate.js
node --check .opencode/scripts/mcp-tools/eslint-audit.js
node --check .opencode/scripts/mcp-tools/keystone-validate.js

# 3. 确认子路径导入可正确解析（仅 require，不执行 MCP 循环）
node -e "
  require('@modelcontextprotocol/sdk/server/index.js');
  require('@modelcontextprotocol/sdk/server/stdio.js');
  require('@modelcontextprotocol/sdk/types.js');
  console.log('All sub-path imports resolved successfully');
"
```

## 5. 未来修复计划

| 条件 | 动作 |
|------|------|
| 上游 `@modelcontextprotocol/sdk` 发布 v1.30+ 并修复 barrel 文件 | 升级版本 + 恢复根级别 `require()` + 更新本文档 |
| 2026-08-23 前上游未修复 | 评估本地 barrel shim 方案（`vendor/mcp-sdk-shim.js`）|

## 6. 技术债追踪

| Waiver ID | 批准日期 | 负责人 | 状态 |
|-----------|---------|--------|------|
| [WV-2026-006](.task_temp/_global/WAIVE-RVW2-MCP-DEPS.md) | 2026-05-23 | @Coder-BE / @CI-CD-Agent | **OPEN** |

---

**维护者**: @Arbiter / @CI-CD-Agent  
**签名**: `@Arbiter — 2026-05-23T06:38:00Z`
