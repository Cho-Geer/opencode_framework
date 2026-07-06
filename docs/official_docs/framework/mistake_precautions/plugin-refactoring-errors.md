## Plugin 重构（27→5 dispatcher）踩坑记录

### 错误 1：WSL bash 变量展开与 PATH 括号

**现象**：通过 `wsl.exe -d Ubuntu-24.04 -- bash -lc "..."` 执行复杂多步命令时，Windows PATH 中的 `Program Files (x86)` 等括号路径导致 bash 解析失败（syntax error near unexpected token）。

**根因**：Windows PATH 括号在嵌套 shell 层（wsl.exe → bash -lc → 内层命令）中被错误展开，bash 将括号解释为子 shell 语法。

**应对**：将复杂逻辑写入 .ts/.sh 脚本文件，cp 到 WSL /tmp 后通过 bun run 或 bash 执行。避免在 wsl.exe -c 中内联复杂多步命令。参见 wsl-bun-script-pattern skill。

### 错误 2：Heredoc 变量被外层 shell 展开

**现象**：清理脚本中的 `$BASE` 变量为空，导致 mv 命令目标路径错误。

**根因**：heredoc 内的变量被外层 shell 提前展开。在多层 shell 嵌套（Windows cmd → wsl.exe → bash -lc）中，变量作用域不可控。

**应对**：使用硬编码绝对路径替代变量引用。或将脚本写入文件后执行，避免 heredoc 跨层传递。

### 错误 3：迁移后旧文件未清理

**现象**：创建了 5 个新 dispatcher 文件，但 plugins/ 目录下原来的 27 个 plugin 文件仍然存在。框架同时加载新旧文件导致冲突。

**根因**：迁移实施时只关注了新文件的创建，遗漏了旧文件的移除步骤。

**应对**：文件迁移完成后，必须显式清理旧文件。建议模式：先创建 .deprecated-pre-xxx/ 目录，将旧文件全部移入，验证新架构正常后再彻底删除。

### 错误 4：清理脚本部分失败

**现象**：批量清理命令中部分 mv 命令失败，目标路径为空。

**根因**：清理脚本使用 `$BASE` 变量，但在 WSL 嵌套 shell 中变量未被正确传递（与错误 2 同源）。

**应对**：WSL 批量操作脚本中使用硬编码绝对路径，不依赖变量传递。或先 cp 脚本到 /tmp 再执行。

### 错误 5：备份文件命名不规范导致 glob 遗漏

**现象**：`rm *.bak` 未匹配 `session.ts.bak-1c` 文件，残留备份文件。

**根因**：备份文件命名时附加了额外后缀（如 `-1c`），超出了 `*.bak` glob 的匹配范围。

**应对**：清理备份时使用更宽泛的匹配模式（如 `*.bak*`），或先用 `ls *.bak*` 确认所有备份文件再显式清理。

---

**总结**：本次重构的 5 个错误中，3 个（错误 1/2/4）源于 WSL 嵌套 shell 的变量展开/转义问题，1 个（错误 3）源于迁移流程不完整，1 个（错误 5）源于备份命名不规范。核心教训：WSL 环境下优先使用脚本文件模式而非 inline 命令；迁移任务必须包含清理步骤的显式验证。
