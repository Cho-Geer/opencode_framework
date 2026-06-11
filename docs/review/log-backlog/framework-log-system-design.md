# 框架日志系统设计方案 v2.0

**日期**: 2026-06-10  
**用途**: 统一管理所有框架插件和工具的运行日志  
**关联**: `framework-enforcer-module-inventory.md`, `opencode-plugin-loading-bun-cache.md`, `TEMPLATE_VARIABLE_STANDARD.md`

---

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| 插件加载确认 | 每次 OpenCode 重启后确认所有插件是否加载成功 |
| 运行时追踪 | 记录 hook 触发、函数调用，关联 session/call/agent |
| 按日归档 | 按日期分目录，超 7 天自动归档 |
| 快速查询 | index.json 汇总所有插件状态 |
| 并发安全 | 多 Agent 同时写日志不损坏索引 |
| 非阻塞 | 日志写入不阻塞 hook 执行链 |
| 模板化 | 通过 `project.config.json` 参数化，跨项目复用 |

---

## 2. 目录结构

```
.task_temp/_logs/
├── index.json                          ← 全量索引（原子写）
├── _error.log                          ← log-manager 自身错误
├── 2026-06-10/                         ← 当日
│   ├── _index.json                     ← 当日索引
│   ├── plugin-session-loaded.log
│   ├── plugin-session-hooks.log
│   ├── plugin-session-runtime.log
│   ├── plugin-scope-before-loaded.log
│   └── ...
├── 2026-06-09/
│   └── ...
└── _archive/                           ← 超过 7 天
    └── 2026-06-01/
```

---

## 3. 日志格式

### 3.1 统一格式

一行一条，` | ` 分隔（可通过 `{logs.delimiter}` 配置）：

```
timestamp | sessionID | callID | agent | agentType | level | event | detail
```

### 3.2 字段说明

| # | 字段 | 心跳 | 运行时 | 来源 |
|---|------|:---:|:---:|------|
| 1 | timestamp | ✅ | ✅ | `new Date().toISOString()` |
| 2 | sessionID | `—` | ✅ | `input.sessionID` |
| 3 | callID | `—` | ✅ | `input.callID`（仅 tool hooks 有） |
| 4 | agent | `—` | ✅ | `input.agent` 或 `resolveAgent()` |
| 5 | agentType | `—` | ✅ | 用于多 Agent 日志过滤 |
| 6 | level | INFO | INFO/WARN/ERROR | 按 enforcement mode 动态调整 |
| 7 | event | PLUGIN-LOADED / HOOK-REGISTERED | CHAT-HOOK / TOOL-BEFORE / TOOL-AFTER | 固定枚举 |
| 8 | detail | 文件名 | 具体操作描述 | 自由文本 |

### 3.3 日志级别策略

| enforcement mode | 默认级别 | 行为 |
|-----------------|:------:|------|
| advisory | DEBUG | 记录所有检查项（含跳过的） |
| strict | INFO | 记录阻断和关键决策 |
| locked | WARN | 仅记录阻断事件和异常 |

### 3.4 示例

```
# 心跳日志（无运行时上下文）
2026-06-10T12:10:38Z | — | — | — | — | INFO | PLUGIN-LOADED | session.ts module loaded
2026-06-10T12:10:38Z | — | — | — | — | INFO | HOOK-REGISTERED | chat.message

# 运行时日志（有运行时上下文）
2026-06-10T12:15:30Z | ses_150de6ca7ffe | call_abc123 | Super-Admin | Super-Admin | INFO | CHAT-HOOK | enter
2026-06-10T12:15:30Z | ses_150de6ca7ffe | call_abc123 | Super-Admin | Super-Admin | INFO | CHAT-HOOK | exit (ok) map size=38
2026-06-10T12:16:00Z | ses_150de6ca7ffe | call_def456 | Coder-BE | Coder-BE | ERROR | TOOL-BEFORE | UC7KS blocked: cache not searched
```

---

## 4. 三类日志文件

| 类型 | 文件命名 | 触发时机 | 上下文 |
|------|---------|---------|:---:|
| 加载确认 | `plugin-{name}-loaded.log` | 模块 import 时 | 无 |
| 注册确认 | `plugin-{name}-hooks.log` | `export default` 调用时 | 无 |
| 运行时追踪 | `plugin-{name}-runtime.log` | hook 触发 / 函数调用时 | 有 |

---

## 5. 核心实现：`lib/log-manager.ts`

```typescript
// log-manager.ts — Framework log system v2.0
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getEnforcementMode } from "./gate-core";

// ── 配置（可通过 project.config.json 覆盖） ──
const LOG_ROOT = ".task_temp/_logs";
const RETENTION_DAYS = 7;
const DELIMITER = " | ";
const BUFFER_SIZE = 20;       // 缓冲 N 条后 flush
const FLUSH_INTERVAL_MS = 5000; // 或每 5 秒 flush

// ── 内存缓冲（避免每次同步写磁盘阻塞 hook 链） ──
const buffer: Map<string, string[]> = new Map();

function getBufferKey(plugin: string, category: string): string {
  return `${plugin}:${category}`;
}

function getLogDir(): string {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(process.env.OPENCODE_ROOT || ".", LOG_ROOT, today);
}

export function ensureLogDir(): void {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── 核心写日志（异步 + 缓冲） ──
export function writeLog(
  plugin: string,
  category: "loaded" | "hooks" | "runtime",
  fields: {
    sessionID?: string;
    callID?: string;
    agent?: string;
    agentType?: string;
    level?: string;
    event: string;
    detail: string;
  },
): void {
  try {
    // 日志级别按 enforcement mode 调整
    const mode = getEnforcementMode();
    const level = fields.level || (mode === "locked" ? "WARN" : mode === "strict" ? "INFO" : "DEBUG");
    
    const line = [
      new Date().toISOString(),
      fields.sessionID || "—",
      fields.callID || "—",
      fields.agent || "—",
      fields.agentType || "—",
      level,
      fields.event,
      fields.detail,
    ].join(DELIMITER) + "\n";

    // 加入缓冲
    const key = getBufferKey(plugin, category);
    if (!buffer.has(key)) buffer.set(key, []);
    buffer.get(key)!.push(line);

    // 缓冲满 → flush
    if (buffer.get(key)!.length >= BUFFER_SIZE) {
      flushBuffer(plugin, category);
    }
  } catch (err: any) {
    // log-manager 自身错误写 _error.log
    logSelfError(`writeLog failed: ${err.message}`);
  }
}

// ── 刷新缓冲到磁盘 ──
export function flushBuffer(plugin: string, category: string): void {
  const key = getBufferKey(plugin, category);
  const lines = buffer.get(key);
  if (!lines || lines.length === 0) return;
  
  try {
    ensureLogDir();
    const file = path.join(getLogDir(), `plugin-${plugin}-${category}.log`);
    fs.appendFileSync(file, lines.join(""), "utf8");
    buffer.set(key, []);
  } catch (err: any) {
    logSelfError(`flushBuffer failed: ${err.message}`);
  }
}

// ── 刷新全部缓冲 ──
export function flushAll(): void {
  for (const key of buffer.keys()) {
    const [plugin, category] = key.split(":");
    flushBuffer(plugin, category as any);
  }
}

// ── 定时刷新（5 秒间隔） ──
setInterval(() => flushAll(), FLUSH_INTERVAL_MS).unref();

// ── index.json 原子写（P0：防止多 Agent 并发损坏） ──
export function updateIndex(plugin: string, event: string): void {
  try {
    const root = path.join(process.env.OPENCODE_ROOT || ".", LOG_ROOT);
    const idxPath = path.join(root, "index.json");
    let idx: any = { version: "2.0", last_updated: "", plugins: {}, dates: {} };
    
    if (fs.existsSync(idxPath)) {
      try { idx = JSON.parse(fs.readFileSync(idxPath, "utf8")); } catch {}
    }
    
    idx.last_updated = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);
    
    if (!idx.plugins[plugin]) {
      idx.plugins[plugin] = {
        first_loaded: new Date().toISOString(),
        last_loaded: "",
        total_loads: 0,
        status: "active",
      };
    }
    idx.plugins[plugin].last_loaded = new Date().toISOString();
    idx.plugins[plugin].total_loads++;
    
    // 统计当天加载的插件
    const logDir = getLogDir();
    const loadedPlugins = new Set<string>();
    if (fs.existsSync(logDir)) {
      for (const f of fs.readdirSync(logDir)) {
        const m = f.match(/^plugin-(.+)-loaded\.log$/);
        if (m) loadedPlugins.add(m[1]);
      }
    }
    idx.dates[today] = { plugins_loaded: loadedPlugins.size, active: true };
    
    // 原子写：先写 tmp，再 rename（POSIX 原子操作）
    if (!fs.existsSync(path.dirname(idxPath))) {
      fs.mkdirSync(path.dirname(idxPath), { recursive: true });
    }
    const tmpPath = idxPath + ".tmp." + crypto.randomBytes(4).toString("hex");
    fs.writeFileSync(tmpPath, JSON.stringify(idx, null, 2), "utf8");
    fs.renameSync(tmpPath, idxPath);
  } catch (err: any) {
    logSelfError(`updateIndex failed: ${err.message}`);
  }
}

// ── 归档检查 ──
export function archiveCheck(): void {
  try {
    const root = path.join(process.env.OPENCODE_ROOT || ".", LOG_ROOT);
    const archive = path.join(root, "_archive");
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root)) {
      if (entry === "_archive" || entry === "index.json") continue;
      const d = path.join(root, entry);
      if (!fs.statSync(d).isDirectory()) continue;
      if (new Date(entry + "T00:00:00Z").getTime() < cutoff) {
        if (!fs.existsSync(archive)) fs.mkdirSync(archive, { recursive: true });
        fs.renameSync(d, path.join(archive, entry));
      }
    }
  } catch (err: any) {
    logSelfError(`archiveCheck failed: ${err.message}`);
  }
}

// ── 自身错误日志 ──
function logSelfError(message: string): void {
  try {
    const root = path.join(process.env.OPENCODE_ROOT || ".", LOG_ROOT);
    const errFile = path.join(root, "_error.log");
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(errFile, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch { /* 自身错误也无法记录，静默放弃 */ }
}

// ── 进程退出时 flush 残留缓冲 ──
process.on("exit", () => flushAll());
process.on("SIGINT", () => { flushAll(); process.exit(); });
process.on("SIGTERM", () => { flushAll(); process.exit(); });
```

---

## 6. machine.json 集成

在 `machine.json` 增加 `plugin_state` 段，与 `index.json` 双向同步：

```json
{
  "plugin_state": {
    "last_reconciliation": "2026-06-10T12:00:00Z",
    "plugins": {
      "session": { "loaded": true, "hooks_registered": true, "last_seen": "2026-06-10T12:10:38Z" },
      "scope-before": { "loaded": true, "hooks_registered": true, "last_seen": "2026-06-10T12:10:39Z" }
    }
  }
}
```

由 `state-reconcile.ts`（post-exec-audit 拆分后的插件）读取 `index.json` 与 `machine.json.plugin_state` 比对，发现不一致时标记 `dirty`。

---

## 7. 模板变量

通过 `project.config.json.template_resolution` 参数化，默认值在 `log-manager.ts` 内：

| 变量 | 默认值 | 配置路径 |
|------|--------|---------|
| `{logs.dir}` | `.task_temp/_logs` | `template_resolution.logs.dir` |
| `{logs.retention_days}` | `7` | `template_resolution.logs.retention_days` |
| `{logs.delimiter}` | ` \| ` | `template_resolution.logs.delimiter` |
| `{logs.level}` | 按模式动态 | `template_resolution.logs.level` |
| `{logs.buffer_size}` | `20` | `template_resolution.logs.buffer_size` |
| `{logs.flush_interval_ms}` | `5000` | `template_resolution.logs.flush_interval_ms` |

---

## 8. 插件代码模板

每个插件文件固定包含以下模板：

```typescript
import { writeLog, updateIndex, ensureLogDir } from "../lib/log-manager";

// ═══════════════════════════════════════════════════════════════
// [PLUGIN-LOADED] 模块顶层 — import 时触发
// ═══════════════════════════════════════════════════════════════
ensureLogDir();
writeLog("session", "loaded", { event: "PLUGIN-LOADED", detail: "session.ts" });
updateIndex("session", "PLUGIN-LOADED");

// ═══════════════════════════════════════════════════════════════
// [HOOK-REGISTERED] export default 函数体内
// ═══════════════════════════════════════════════════════════════
export default (async (_ctx: any) => {
  writeLog("session", "hooks", { event: "HOOK-REGISTERED", detail: "chat.message" });
  return { "chat.message": chatMessageHook };
}) as any;

// ═══════════════════════════════════════════════════════════════
// [RUNTIME] hook 函数体内 — 事件触发时
// ═══════════════════════════════════════════════════════════════
async function chatMessageHook(input, _output) {
  writeLog("session", "runtime", {
    sessionID: input.sessionID,
    agent: input.agent,
    agentType: input.agent,
    event: "CHAT-HOOK",
    detail: "enter",
  });
  // ... 业务逻辑 ...
  writeLog("session", "runtime", {
    sessionID: input.sessionID,
    agent: input.agent,
    agentType: input.agent,
    event: "CHAT-HOOK",
    detail: `exit (ok) map size=${keys.length}`,
  });
}
```

---

## 9. 一键验证

```bash
# 当天全部插件加载状态
cat .task_temp/_logs/$(date +%Y-%m-%d)/_index.json

# 全局索引
cat .task_temp/_logs/index.json | python3 -m json.tool

# 今天加载了哪些插件
ls .task_temp/_logs/$(date +%Y-%m-%d)/plugin-*-loaded.log | sed 's/.*plugin-//;s/-loaded.log//'

# 今天运行时日志
cat .task_temp/_logs/$(date +%Y-%m-%d)/plugin-session-runtime.log

# log-manager 自身错误
cat .task_temp/_logs/_error.log

# 严格模式验证：所有 9 插件 loaded + hooks
[ $(ls .task_temp/_logs/$(date +%Y-%m-%d)/plugin-*-loaded.log | wc -l) -eq 9 ] && echo "ALL PLUGINS LOADED"
[ $(ls .task_temp/_logs/$(date +%Y-%m-%d)/plugin-*-hooks.log | wc -l) -eq 9 ] && echo "ALL HOOKS REGISTERED"
```

---

## 10. 归档机制

```
触发时机：每次 writeLog() 调用时顺带检查（非阻塞）
逻辑：当日目录创建日期 > RETENTION_DAYS → 移入 _archive/
实现：archiveCheck() 函数，每次 writeLog 末尾调用
```

```typescript
// writeLog 末尾追加：
if (category === "runtime") {
  setImmediate(() => archiveCheck()); // 延迟执行，不阻塞当前 hook
}
```

---

## 11. 构建顺序

| 步骤 | 文件 | 依赖 | 说明 |
|:---:|------|------|------|
| 1 | `lib/log-manager.ts` | gate-core（getEnforcementMode） | 核心日志库，先建 |
| 2 | 更新 `session.ts` | log-manager | 接入新日志系统 |
| 3 | 在 `machine.schema.json` 加 `plugin_state` | — | 状态集成 |
| 4 | `scope-before.ts` | log-manager, tool-scope | 新插件 |
| 5 | `uc7ks-before.ts` | log-manager, uc7ks-utils | 新插件 |
| 6 | `dispatch-before.ts` | log-manager, agent-resolver | 新插件 |
| 7 | `gate-before.ts` | log-manager, gate-checks | 新插件 |
| 8 | `audit-before.ts` | log-manager | 新插件 |
| 9-14 | 6 个 after 插件 | log-manager | 依次构建 |

---

## 12. 日志文件统计

| 类型 | 数量 | 说明 |
|------|:---:|------|
| loaded | 9 | 每个插件 1 个 |
| hooks | 9 | 每个插件 1 个 |
| runtime | ≤9 | 按需 |
| index | 2 | index.json + _index.json |
| error | 1 | _error.log |
| **合计** | **≤30/日** | |
