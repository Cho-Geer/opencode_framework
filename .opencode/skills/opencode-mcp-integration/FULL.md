---
name: opencode-mcp-integration
description: 将新的 MCP 工具（如 CodeGraph、Context7、Resend 等）集成到 OpenCode 多 Agent 框架的完整流程指南。覆盖 CLI 安装、索引初始化、opencode.json MCP Server 注册、Agent 权限矩阵更新、Agent .md 能力声明更新、Skill 注册（skills: 字段）、UC7KS 豁免配置、Agent prompt 使用指南编写、硬约束 Plugin Hook 拦截模式，以及 WSL 环境下 bun 脚本的 PATH 括号转义 workaround。当用户提到"集成 MCP"、"引入 MCP 工具"、"注册 MCP Server"、"添加新工具到框架"、"注册 Skill"、"硬约束 Plugin"等场景时触发。
version: 1.1.0
---

# OpenCode MCP 工具集成流程

本 Skill 记录了将一个外部 MCP 工具完整集成到 OpenCode 多 Agent 框架中的标准流程。整个过程分为 9 个步骤，前 6 步为必选，后 3 步视情况执行。

## 前置条件

在开始之前确认以下环境就绪：

- OpenCode 框架已部署，`opencode.json` 和 `.opencode/` 目录结构完整
- WSL 环境可用（Windows 宿主机通过 `wsl -d Ubuntu-24.04 bash -c "..."` 访问）
- `bun` 已安装（用于执行 TypeScript/JavaScript 脚本和操作 JSON 配置）
- 目标 MCP 工具的 CLI 或远程端点信息已准备好

## 两层配置模型

OpenCode 框架中 MCP 工具的可用性由两层独立但必须同步的配置决定：

**第一层：opencode.json（访问控制层）**
`opencode.json` 中每个 Agent 的 `permission` 字段决定该 Agent 能否调用某个 MCP 工具。格式为 `"<tool_name>": "allow"` 或 `"deny"`。这一层的权威是 `opencode.json` 文件本身。

**第二层：Agent .md（能力声明层）**
每个 Agent 的 `.opencode/agents/<AgentName>.md` 文件中有一个 `mcp_tools:` 列表，声明该 Agent 知道并使用哪些 MCP 工具。这一层的权威是各个 Agent .md 文件。

两层必须同步更新。只改 opencode.json 不改 .md，Agent 不知道自己有这个工具；只改 .md 不改 opencode.json，Agent 调用时会被权限系统拦截。

## Step 1: 安装 CLI / 确认服务可达

**目标：** 确保 MCP 工具的二进制或服务在 WSL 环境中可用。

对于本地 CLI 工具（如 CodeGraph）：
```bash
# 通过官方安装脚本安装
curl -fsSL https://raw.githubusercontent.com/<repo>/main/install.sh | bash
# 验证安装
which <tool-name> && <tool-name> --version
```

对于远程 MCP Server（如 Context7）：
```bash
# 确认 npx 可达
npx -y @<scope>/<package>@latest --help
```

记录安装路径和版本号，后续步骤可能需要。

## Step 2: 初始化索引（如适用）

**目标：** 如果 MCP 工具需要本地索引（如 CodeGraph 的 Tree-sitter 索引），在此步骤完成。

```bash
cd /home/zhaoge/workspace/opencode/work-one
<tool-name> init
# 验证索引健康状态
<tool-name> query "test"  # 应返回结果
```

记录索引统计数字（文件数、节点数、边数），作为基线。

如果目标 MCP 工具不需要本地索引（如纯 API 调用型），跳过此步。

## Step 3: 注册 MCP Server（opencode.json）

**目标：** 在 `opencode.json` 的 `"mcp"` 字段中添加新 server 条目。

由于 opencode.json 在 WSL 中且文件较大，使用 bun 脚本安全修改：

```javascript
// 复制到 /tmp 执行（WSL PATH workaround，见下方专节）
const fs = require('fs');
const configPath = '/home/zhaoge/workspace/opencode/work-one/opencode.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

config.mcp['<server-name>'] = {
  type: 'local',
  command: ['<runtime>', '<script-or-binary-path>'],
  environment: { /* 如需要 */ },
  timeout: 60000,
  enabled: true
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('MCP server registered. Total servers:', Object.keys(config.mcp).length);
```

**验证：**
```bash
bun -e "const c=JSON.parse(require('fs').readFileSync('/home/zhaoge/workspace/opencode/work-one/opencode.json','utf8')); console.log('Valid JSON. MCP servers:', Object.keys(c.mcp).length); console.log('New entry:', JSON.stringify(c.mcp['<server-name>'], null, 2))"
```

## Step 4: 更新 Agent 权限矩阵（opencode.json）

**目标：** 为需要调用该 MCP 工具的每个 Agent 添加权限规则。

首先确定哪些 Agent 需要这个工具。通常是需要代码结构分析的 Agent（如 Architect、Coder-BE、Coder-FE、Guardian、Meta-Planner、Super-Admin、Knowledge-Curator），不需要调度的 Agent（如 Orchestrator、Arbiter、CI-CD-Agent）可以跳过。

```javascript
const fs = require('fs');
const configPath = '/home/zhaoge/workspace/opencode/work-one/opencode.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const agents = ['Architect', 'Coder-BE', 'Coder-FE', 'Guardian', 'Meta-Planner', 'Super-Admin', 'Knowledge-Curator'];
const toolNames = ['<tool1>', '<tool2>', /* ... */];

let ruleCount = 0;
for (const agent of agents) {
  if (!config.agent[agent]) continue;
  if (!config.agent[agent].permission) config.agent[agent].permission = {};
  for (const tool of toolNames) {
    config.agent[agent].permission[tool] = 'allow';
    ruleCount++;
  }
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`Added ${ruleCount} permission rules (${agents.length} agents x ${toolNames.length} tools)`);
```

**验证：**
```bash
bun -e "
const c=JSON.parse(require('fs').readFileSync('/home/zhaoge/workspace/opencode/work-one/opencode.json','utf8'));
const agents=['Architect','Coder-BE','Coder-FE','Guardian','Meta-Planner','Super-Admin','Knowledge-Curator'];
const tools=['<tool1>','<tool2>'];
let ok=0;
for(const a of agents){for(const t of tools){if(c.agent[a]?.permission?.[t]==='allow')ok++;else console.log('MISSING:',a,t)}}
console.log(ok+'/',agents.length*tools.length,'rules present');
"
```

## Step 5: 更新 Agent .md 能力声明

**目标：** 在每个相关 Agent 的 `.md` 文件的 `mcp_tools:` 列表中追加新工具名称。

```javascript
const fs = require('fs');
const path = require('path');
const agentsDir = '/home/zhaoge/workspace/opencode/work-one/.opencode/agents';
const agents = ['Architect', 'Coder-BE', 'Coder-FE', 'Guardian', 'Meta-Planner', 'Super-Admin', 'Knowledge-Curator'];
const newTools = ['<tool1>', '<tool2>'];

for (const agent of agents) {
  const filePath = path.join(agentsDir, agent + '.md');
  let content = fs.readFileSync(filePath, 'utf8');
  
  // 找到 mcp_tools: 列表的末尾，在最后一个工具后追加
  // 具体插入位置需要根据文件格式调整
  // 通常是在 mcp_tools: 段落的最后一个条目后、下一个字段前
  
  for (const tool of newTools) {
    if (!content.includes(tool)) {
      // 在 mcp_tools 段落的适当位置插入
      content = content.replace(
        /(mcp_tools:\n(?:\s*-\s*\S+\n)*?)(\s*\n\s*\S)/,
        `$1  - ${tool}\n$2`
      );
    }
  }
  
  fs.writeFileSync(filePath, content);
  console.log(`Updated: ${agent}.md`);
}
```

**验证：**
```bash
for agent in Architect Coder-BE Coder-FE Guardian Meta-Planner Super-Admin Knowledge-Curator; do
  echo -n "$agent: "
  grep -c '<tool1>' /home/zhaoge/workspace/opencode/work-one/.opencode/agents/$agent.md
done
```

## Step 5.5: 注册 Skill 到 Agent .md 的 skills: 字段（如创建了 Skill）

**目标：** 如果集成过程中创建了新的 Skill（`.opencode/skills/<skill-name>/SKILL.md`），必须在每个相关 Agent .md 的 `skills:` 列表中显式注册。

**背景：** Skill 文件创建后不会自动被 Agent 发现。框架的 `dispatch-subagent.ts` 解析 Agent .md frontmatter 时提取 `skills[]` 数组，用于日志输出和 prompt 生成。如果遗漏此步骤，Agent 不知道自己有这个 Skill 可用。

**注意：** Skill 注册与 MCP 工具注册是不同的字段：
- `mcp_tools:` — 声明 Agent 可用的 MCP 工具（Step 5 处理）
- `skills:` — 声明 Agent 可用的 Skill（本步骤处理）
- `opencode.json` 中的 `permission` — 控制 Agent 能否调用 `skill` 工具本身（`"skill": "allow"`），不列举具体 Skill 名称

```javascript
const fs = require('fs');
const path = require('path');
const agentsDir = '/home/zhaoge/workspace/opencode/work-one/.opencode/agents';
const agents = ['Architect', 'Coder-BE', 'Coder-FE', 'Guardian', 'Meta-Planner', 'Super-Admin', 'Knowledge-Curator', 'Orchestrator', 'CI-CD-Agent', 'Arbiter'];
const skillName = '<skill-name>';  // 如 'codegraph-first'
const anchor = 'context7-first';    // 锚点 Skill，在其后插入

let updated = 0, skipped = 0;
for (const file of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
  const filePath = path.join(agentsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(`- ${skillName}`)) { skipped++; continue; }
  // 在锚点 Skill 后插入
  content = content.replace(
    new RegExp(`(  - ${anchor}\\n)`),
    `$1  - ${skillName}\n`
  );
  fs.writeFileSync(filePath, content);
  updated++;
  console.log(`Updated: ${file}`);
}
console.log(`\nDone. Updated: ${updated}, Skipped (already present): ${skipped}`);
```

**验证：**
```bash
for f in /home/zhaoge/workspace/opencode/work-one/.opencode/agents/*.md; do
  echo "$(basename $f): $(grep -c '<skill-name>' $f)"
done
# 所有目标 Agent 应返回 >= 1
```

## Step 6: UC7KS 豁免（如需要）

**目标：** 如果框架的 UC7KS 外部知识管线会拦截未知工具调用，需要为新工具添加豁免。

在 `.opencode/lib/uc7ks-utils.ts` 中添加豁免集合：

```typescript
/**
 * <ToolName> MCP tools — explicitly exempt from UC7KS pipeline.
 * These tools query local/authorized sources, not external knowledge.
 * Added <date> as part of <ToolName> MCP integration.
 */
const <TOOL>_TOOLS = new Set([
  '<tool1>',
  '<tool2>',
  // ...
]);
```

在 `checkUC7KS()` 函数开头添加早期返回：
```typescript
// Exempt <ToolName> tools from UC7KS blocking
for (const tool of <TOOL>_TOOLS) {
  if (toolName.includes(tool)) return null;
}
```

**验证：**
```bash
grep -c '<TOOL>_TOOLS' /home/zhaoge/workspace/opencode/work-one/.opencode/lib/uc7ks-utils.ts
# 应返回 >= 2（Set 定义 + check 调用）
```

## Step 7: Agent Prompt 使用指南

**目标：** 为每个角色编写专属的工具使用指南，追加到对应 Agent .md 文件末尾。

不同角色需要不同的使用指南：

- **Coder-BE / Coder-FE**：侧重"修改代码前先用工具评估影响"
- **Guardian**：侧重"审查变更时使用工具验证影响范围"
- **Meta-Planner**：侧重"规划 DAG 时参考工具提供的结构信息"
- **Super-Admin**：侧重"框架全景视图和工具索引健康管理"
- **Knowledge-Curator**：侧重"用工具替代旧有的手动分析流程"
- **Architect**：侧重"架构决策时查询依赖关系和调用链"

每个指南的模板：
```markdown
## <ToolName> 使用指南

在 <具体场景> 时，优先使用 <ToolName> 工具而非 <旧方法>：

- **<场景1>**: `<tool_method>("<参数>")`
- **<场景2>**: `<tool_method>("<参数>")`
- **修改前评估**: `<tool_method>("<目标>")` — 查看影响范围
```

## Step 8: 硬约束 Plugin（如需要）

**目标：** 如果新 MCP 工具需要在特定操作前强制执行（如"修改代码前必须先做影响分析"），通过 `tool.execute.before` plugin hook 实现物理拦截。

**架构说明：** OpenCode 框架的运行时操作状态是 DB-only 和 DB-canonical 的（`framework-state.db`，SQLite，38 张表）。Plugin 的拦截逻辑在内存中运行（session 级状态追踪），审计记录写入 DB 的 `audit_log` 等表，不依赖文件存储。这与配置层（opencode.json 文件权威）是分离的。

**软引导 vs 硬约束：**
- **Skill（软引导）**：Agent 知道应该做，但可以选择跳过。Skill 内容不被框架代码加载，仅由 LLM 在运行时读取。
- **Plugin（硬约束）**：`tool.execute.before` hook 物理阻断工具调用，不满足前置条件时直接返回错误消息，Agent 无法绕过。

**Plugin 模板**（以 codegraph-enforce 为参考实现）：

```typescript
/**
 * <tool>-enforce.ts — "tool.execute.before" plugin
 * 硬约束：阻断代码修改工具调用，除非先执行了指定的 MCP 分析工具。
 */

// 需要拦截的工具集合
const INTERCEPTED_TOOLS = new Set([
  'safe_edit',
  'safe_delete',
  'safe_restore',
  'safe_shell',
]);

// Session 级状态追踪：记录已调用的 MCP 分析工具
const sessionState = new Set<string>();

// 按工具类型提取目标文件路径
function extractFilePath(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'safe_edit':
    case 'safe_delete':
    case 'safe_restore':
      return args.file_path || '';
    case 'safe_shell':
      // safe_shell 的参数是 command 字符串，用正则提取目标文件
      return extractShellTarget(args.command || '');
    default:
      return '';
  }
}

function extractShellTarget(cmd: string): string {
  // 匹配 cp/mv/sed/node/bun 等命令的目标文件模式
  const patterns = [
    /(?:cp|mv)\s+\S+\s+(\S+)/,
    /(?:sed|node|bun)\s+.*?(\S+\.\w+)/,
  ];
  for (const p of patterns) {
    const m = cmd.match(p);
    if (m) return m[1];
  }
  return cmd; // fallback: 用完整命令作为路径（不会被豁免路径匹配，保守阻断）
}

export default {
  hook: 'tool.execute.before',
  handler: async (ctx: any) => {
    const { toolName, args, agentName } = ctx;

    // 记录 MCP 分析工具的调用
    if (toolName.startsWith('<mcp_tool_prefix>_')) {
      sessionState.add(toolName);
      return; // 放行分析工具本身
    }

    // 非拦截目标，放行
    if (!INTERCEPTED_TOOLS.has(toolName)) return;

    // 检查是否已执行过分析
    const hasAnalysis = [...sessionState].some(t =>
      t.startsWith('<mcp_tool_prefix>_')
    );
    if (hasAnalysis) return;

    // 阻断：返回错误消息
    const filePath = extractFilePath(toolName, args);
    return {
      blocked: true,
      message: `[ENFORCE] ${toolName} on "${filePath}" blocked. ` +
        `Run <mcp_analysis_tool> first to assess impact.`,
    };
  },
};
```

**注册 Plugin：** 在 `opencode.json` 的 `"plugin"` 数组中添加路径：
```javascript
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.plugin.push('.opencode/plugins/<tool>-enforce.ts');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
```

**验证：**
```bash
# 确认 plugin 文件语法正确
bun build --no-bundle .opencode/plugins/<tool>-enforce.ts 2>&1 | head -5
# 确认 opencode.json 中已注册
grep -c '<tool>-enforce' /home/zhaoge/workspace/opencode/work-one/opencode.json
```

## WSL 环境 Workaround

在 WSL 环境中，PATH 变量可能包含括号（如 `/mnt/c/Program Files/...`），导致 bun 脚本执行失败。标准解决方案是将脚本复制到 `/tmp` 再执行：

```bash
# 错误方式（PATH 括号导致 shell 解析失败）
wsl -d Ubuntu-24.04 bash -c "/home/zhaoge/.bun/bin/bun /mnt/c/Users/USER/.qoderworkcn/workspace/xxx/script.js"

# 正确方式（复制到 /tmp 执行）
wsl -d Ubuntu-24.04 bash -c "cp /mnt/c/Users/USER/.qoderworkcn/workspace/xxx/script.js /tmp/script.js && /home/zhaoge/.bun/bin/bun /tmp/script.js"
```

这个 workaround 适用于所有通过 QoderWork 在 WSL 中执行 bun 脚本的场景，不仅限于 MCP 集成。

## 验证清单

完成所有步骤后，执行以下全面验证：

1. **JSON 格式校验**: `bun -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8')); console.log('VALID')"`
2. **MCP Server 条目**: 确认新 server 出现在 `config.mcp` 中
3. **权限计数**: 总规则数 = Agent 数 x 工具数，逐一核对无遗漏
4. **Agent .md mcp_tools 声明**: 每个相关 Agent 的 `mcp_tools:` 列表包含新工具
5. **Agent .md skills 注册**: 如创建了 Skill，确认每个相关 Agent 的 `skills:` 列表包含该 Skill 名称
6. **UC7KS 豁免**: 新工具名称出现在豁免集合中
7. **索引健康**: 如适用，确认索引统计数字正常
8. **硬约束 Plugin**: 如创建了 enforce plugin，确认 `bun build` 语法通过、`opencode.json` 的 `plugin` 数组已注册
9. **端到端测试**: 在 OpenCode 中让某个 Agent 实际调用新工具，确认不被拦截

## 实际案例：CodeGraph 集成

以 CodeGraph MCP 集成为例的完整执行记录：

- **Step 1**: 安装 CodeGraph CLI v1.1.1 到 `/home/zhaoge/.local/bin/codegraph`
- **Step 2**: `codegraph init` 生成索引：203 文件、2,955 节点、9,733 边，索引数据库 10.86 MB。`.codegraph/` 加入 `.gitignore`
- **Step 3**: 在 `opencode.json` 的 `mcp` 中添加 `codegraph` 条目（第 12 个 MCP Server）
- **Step 4**: 7 个 Agent 各添加 8 条 `codegraph_*: "allow"` 权限规则，共 56 条
- **Step 5**: 7 个 Agent .md 的 `mcp_tools:` 列表追加 8 个 codegraph 工具名
- **Step 5.5**: 创建 `codegraph-first` Skill（v1.1.0），注册到全部 10 个 Agent 的 `skills:` 列表（以 `context7-first` 为锚点插入）。注意：初次创建时遗漏了此步骤，后续发现后补齐
- **Step 6**: `uc7ks-utils.ts` 添加 `CODEGRAPH_TOOLS` 豁免集合（8 个工具），在 `checkUC7KS()` 中早期返回
- **Step 7**: 6 个 Agent prompt 追加专属 CodeGraph 使用指南（Coder-BE/FE 通用、Guardian 变更审查、Meta-Planner DAG 规划、Super-Admin 全景、Knowledge-Curator Scout 替代）
- **Step 8**: `codegraph-enforce.ts` plugin 实现硬约束——拦截 safe_edit/safe_delete/safe_restore/safe_shell 4 个工具，要求先执行 `codegraph_explore` 分析。`INTERCEPTED_TOOLS` Set + session 级状态追踪 + `extractFilePath()` 按工具类型提取目标路径。Plugin 注册到 `opencode.json` 的 `plugin` 数组
- **附加**: Scout 层退役（`scout-trigger.ts` 和 `scout-extractor.ts` 标记 `@deprecated`）
- **验证**: `codegraph impact 'dbSaveGateStore'` 返回 21 个受影响符号，跨 4 个文件

## Pitfalls

- **两层配置不同步**是最常见的遗漏。opencode.json 和 Agent .md 必须同时更新。
- **WSL PATH 括号问题**会导致 bun 脚本执行失败，错误信息不明显。始终使用 `/tmp` 复制方案。
- **Agent .md 插入位置错误**：新工具名可能被插入到文档中间而非 `mcp_tools:` 列表末尾。修改后务必 grep 验证位置。
- **不需要工具的 Agent 也加了权限**：Orchestrator（专职调度）、Arbiter（技术委员会）、CI-CD-Agent（DevOps）通常不需要代码结构工具，跳过它们。
- **UC7KS 豁免遗漏**：新工具如果不加豁免，会被 UC7KS 管线当作"未知外部工具"拦截，Agent 调用时会卡住。
- **Skill 创建后忘记注册到 `skills:` 字段**：Skill 文件（`.opencode/skills/<name>/SKILL.md`）创建后不会自动被 Agent 发现。框架的 `dispatch-subagent.ts` 解析 Agent .md frontmatter 提取 `skills[]` 数组，但 SKILL.md 内容本身不被框架代码加载——它由 LLM 在运行时读取。如果遗漏 `skills:` 注册，Agent 根本不知道有这个 Skill 可用。注意 `skills:` 和 `mcp_tools:` 是不同的字段，不要混淆。
- **软引导与硬约束混淆**：Skill 是软引导（Agent 知道应该做但可以选择跳过），Plugin hook 是硬约束（物理阻断执行，不满足前置条件时直接返回错误）。如果需要强制遵守某个流程（如"修改代码前必须先做影响分析"），仅靠 Skill 不够，必须配合 `tool.execute.before` Plugin 实现物理拦截。


---

## Appendix: New Asset Integration (merged from new-asset-integrator)

> Content merged from new-asset-integrator skill (Phase 1, 2026-07-05)


# 新资产集成器 (New Asset Integrator)

## 概述

本技能用于标准化地处理新MCP工具和新Skill的追加流程，确保所有操作符合项目规范和技术标准。当用户明确提及"新的MCP工具"或"新的skill追加"相关内容时，自动触发本技能的执行流程。


## 触发条件

### 关键词触发

当用户会话中包含以下关键词时自动触发：
- `新的MCP工具`
- `新的skill追加`
- `新MCP工具`
- `新skill追加`
- `添加MCP工具`
- `添加新skill`
- `new MCP tool`
- `new skill`


## 功能分析阶段

### 1. 全面收集并分析

在开始任何更新操作前，必须完成以下收集和分析：

#### 官方文档收集
- [ ] 收集新MCP工具的官方文档
- [ ] 收集新Skill的技术规格说明
- [ ] 收集使用案例和示例代码
- [ ] 收集版本信息和变更日志

#### 技术规格分析
- [ ] 明确新工具/skill的核心功能
- [ ] 明确适用场景
- [ ] 明确输入输出参数
- [ ] 明确调用方式
- [ ] 明确依赖关系

#### 兼容性评估
- [ ] 评估与现有系统的兼容性
- [ ] 评估潜在影响范围
- [ ] 评估安全影响
- [ ] 评估性能影响


## MCP工具更新流程

### 2. 更新 mcp-tool-inventory.md

当确认需要添加新的MCP工具时，按照以下步骤执行：

#### 步骤1：准备MCP工具元数据

使用以下模板准备新MCP工具的元数据：

```yaml
工具名称: mcp_tool_name
功能描述: 简短描述工具功能
适用场景: 列出适用的场景
版本信息: v1.0.0
调用示例: |
  示例代码或命令
合规要求: 列出合规要求
```

#### 步骤2：更新 mcp-tool-inventory.md

1. 在"一、当前项目可用MCP工具清单"中添加对应表格
2. 更新"二、MCP工具调用策略"中的映射关系
3. 添加调用示例和最佳实践

#### 步骤3：验证MCP工具更新

- [ ] 元数据格式正确
- [ ] 与现有条目保持一致
- [ ] 工具名称、功能描述、版本信息完整
- [ ] 调用示例清晰
- [ ] 合规要求明确


## Skill更新流程

### 3. 更新 skill-invocation-standard.md

当确认需要添加新的Skill时，按照以下步骤执行：

#### 步骤1：准备Skill元数据

使用以下模板准备新Skill的元数据：

```yaml
skill_name: skill-id
display_name: 显示名称
category: 类别  # P0-基础检查类 / P1-领域专业类 / P1-分析设计类 / P2-技术栈类 / P2-工具创建类
description: 简短描述，1-2句话
trigger_keywords:
  - 关键词1
  - 关键词2
use_cases:
  - 适用场景1
  - 适用场景2
priority: P0/P1/P2
core_features:
  - 核心功能1
  - 核心功能2
always_first: false
status: active
added_date: YYYY-MM-DD
added_by: 添加者标识
```

#### 步骤2：更新 skill-invocation-standard.md

1. 在"三、已注册Skill清单"的"3.1 Skill注册表格"中添加一行
2. 在"四、各Skill详细元数据"中添加完整的元数据YAML块
3. 更新 preflight-lite/SKILL.md 中的任务分类表格
4. 更新 preflight-lite/SKILL.md 中的添加新技能步骤
5. 在"六、常见任务的Skill组合推荐"中酌情添加相关组合（如适用）
6. 在"八、实际案例分析"中酌情添加案例（如适用）

#### 步骤3：验证Skill更新

- [ ] 元数据格式正确
- [ ] 与现有条目保持一致
- [ ] 分类选择合理
- [ ] 触发关键词清晰
- [ ] 显示名称友好
- [ ] 日期格式正确（YYYY-MM-DD）
- [ ] skill-invocation-standard.md 版本号已更新


## 验证要求

### 4. 功能验证测试

完成更新后，必须进行功能验证测试：

#### 验证清单

- [ ] 新添加的内容能够被系统正确识别
- [ ] 新添加的内容能够被正确调用
- [ ] 关键词触发正常工作
- [ ] 元数据解析正确

### 5. 文档完整性和一致性检查

#### mcp-tool-inventory.md 检查

- [ ] 格式与现有条目保持一致
- [ ] 工具名称、功能描述完整
- [ ] 版本信息、调用示例、合规要求完整
- [ ] 内容一致性验证通过

#### skill-invocation-standard.md 检查

- [ ] 格式与现有条目保持一致
- [ ] 工具名称、功能描述、版本信息完整
- [ ] 调用示例、合规要求完整
- [ ] 内容一致性验证通过

#### preflight-lite/SKILL.md 检查

- [ ] 任务分类表格已更新
- [ ] 添加新技能步骤已更新
- [ ] 与 skill-invocation-standard.md 内容一致

### 6. 安全标准和合规要求确认

- [ ] 所有更新符合项目安全标准
- [ ] 所有更新符合项目合规要求
- [ ] 无安全漏洞引入
- [ ] 无合规问题引入


## 标准操作流程总结

### 完整流程

```
用户提及"新的MCP工具"或"新的skill追加"
    ↓
触发 new-asset-integrator Skill
    ↓
功能分析阶段
    ↓
判断是MCP工具还是Skill
    ↓
    ├─ MCP工具 → 更新 mcp-tool-inventory.md
    │
    └─ Skill → 更新 skill-invocation-standard.md
              ↓
              更新 preflight-lite/SKILL.md
    ↓
验证要求
    ↓
完成
```


## 相关资源

- [mcp-tool-inventory.md](../rules/rule_detail/mcp-tool-inventory.md) - MCP工具清单
- [skill-invocation-standard.md](../rules/rule_detail/skill-invocation-standard.md) - Skill调用标准化规范
- [preflight-lite/SKILL.md](../skills/preflight-lite/SKILL.md) - 执行前置检查Skill


**最后更新**: 2026-04-10
**维护者**: DevOps Team
**版本**: v1.0.0
