# Documents 索引

> 本文件由 QoderWork Session Startup 自动扫描。新增文档时请同步更新此索引。
>
> **最近更新**: 2026-07-04 — 行数校准 + opencode-cognitive-map.md 更新同步：
> - **更新**: opencode-cognitive-map.md — 文档在 07-03 17:34 再次修改（INDEX 之后），行数/摘要同步
> - **校准**: opencode-db-canonical-design.md 行数 ~760 → 797
> - **校准**: acp-bridge-test-suite.md 行数 ~780 → 873
> - **校准**: 工具调用失败链与返回方式.md 行数 ~900 → 837
>
> **历史更新**: 2026-07-03 — 文档一致性审计：
> - 全部文档与代码交叉验证，修正过时数量（Plugin 25→29、Tool 20→23、Lib 49→50、MCP 11→12、DB 表 36→42（Phase 0 基线修正））
> - 新增到索引: opencode-sse-events.md、opencode-db-canonical-design.md
> - 删除: framework-deep-reference.md、opencode-framework-comprehensive-understanding.md、opencode-framework-quick-reference.md
> - 整合: opencode-tool-return-format.md → 工具调用失败链与返回方式.md（v2.0.0）

| 文件 | 主题 | 摘要 | 行数 |
|------|------|------|------|
| **opencode-cognitive-map.md** | **框架认知地图（全景架构）** | **四层架构总览（元认知→编排执行→验证→运维）、29 Plugin / 50+ Tool / 50 Lib / 12 MCP Server 全景、Agent 角色定义、数据流图、故障排查手册。是理解 work-one 整体设计的第一入口。** | **~694** |
| opencode-db-canonical-design.md | DB-only & DB-Canonical 设计 | DB-only 和 DB-canonical 设计理念、42 个数据表全景架构（Phase 0 基线修正）、9 大类数据模型详解、实体关系图、表关系与业务关联、DB-canonical 设计证据、数据库迁移机制（v1-v32）、关键代码索引。 | ~797 |
| opencode-cli-acp-integration.md | CLI 命令 & ACP 协议集成 | OpenCode CLI 全命令参考（run/serve/web/acp）、ACP 协议 stdio JSON-RPC 2.0 交互流程、session 生命周期管理、QoderWork↔OpenCode 双向通道设计。面向 ACP 桥接开发调试。 | ~270 |
| opencode-enforcement-exemption-matrix.md | Enforcement & 豁免机制完整矩阵 | advisory/strict/locked 三模式完整矩阵：23 个工具 Before/After Hook 链、豁免机制（Agent/路径/工具类别）、阻断/警告行为、Agent 权限级别、Guidance Gate 两阶段协议。面向 enforcement 调试和权限排查。 | ~659 |
| opencode-sse-events.md | SSE 事件完整参考 | OpenCode SSE 事件全景：59 个事件跨 10 大类（Session V1/Next/Status/Server/Workspace/MCP/LSP/VCS/Worktree/Legacy），3 个 SSE 端点（/event、/global/event、/api/event）。面向 ACP 桥接和事件驱动开发。 | ~347 |
| opencode-subsystems-report.md | 11 子系统深度分析报告 | 从源码级深度分析 11 个核心子系统：MVC 架构、DB-canonical 设计、Permission Matrix、并发安全、Hardened Enforcement、Framework Harness、Multi-Agent、Log Central、DB 管理、Templatization、TS+Bun Runtime。面向框架深度理解和二次开发。 | ~873 |
| opencode-tool-reference.md | Tool 详细参考（50+ 工具） | 三大类工具完整清单：11 个内置工具、23 个自定义工具（safe_* 系列 + Read Attestation）、25+ MCP 工具。每个工具的权限配置、拦截 Hook、框架用途。 | ~629 |
| **工具调用失败链与返回方式.md** | **工具调用失败链与返回格式（完整版）** | **三层阻断链路、返回格式标准体系（MCP/Custom/Built-in）、23 个自定义工具返回格式详解、25+ MCP 工具返回格式、detectFailure/detectSoftRejection 逻辑、4 种计数器与阈值、7 种失败类型矩阵、返回格式设计模式。** | **~837** |
| session-concepts-complete.md | Session 概念完整体系 | 五种 ID 辨析（Session/Gate/DAG/Agent/Namespace）、Session 生命周期、session_map 三层存储、状态机、与 SDK session 表的关系。面向 Session 相关 Bug 排查和架构理解。 | ~356 |
| **acp-bridge-test-suite.md** | **ACP Bridge v0.9.2 完整测试用例** | **96 个测试 case，22 个模块。v0.9.3 MCP 修复：4 个 bun-based server 改绝对路径后全部连上(9/12 connected)。v0.9.2 模块 4-6 实测完成。累计 27 case：20 PASS(74%), 4 FAIL, 3 SKIP。** | **~873** |

## 按场景推荐阅读

- **初次了解框架** → opencode-cognitive-map.md → opencode-subsystems-report.md
- **理解 DB-only & DB-Canonical 设计** → opencode-db-canonical-design.md
- **理解数据模型与表关系** → opencode-db-canonical-design.md（§3-4）
- **调试 ACP 桥接** → opencode-cli-acp-integration.md
- **ACP Bridge 测试验证** → acp-bridge-test-suite.md
- **排查 Session/Dispatch 问题** → session-concepts-complete.md
- **查某个 Tool 的权限和 Hook** → opencode-tool-reference.md
- **排查工具调用失败** → 工具调用失败链与返回方式.md
- **理解 Enforcement & 豁免机制** → opencode-enforcement-exemption-matrix.md
- **了解 Vanilla OpenCode 平台机制** → opencode-cognitive-map.md（§2）
- **查 SSE 事件类型** → opencode-sse-events.md
- **深度理解 11 子系统** → opencode-subsystems-report.md
