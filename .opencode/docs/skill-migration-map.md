# Skill Migration Map (Phase 1)

> **Created**: 2026-07-05
> **Phase**: 1 (Skill-First 能力层重构)
> **Base**: 19 Skills → 15 Skills (合并 4→2 + 废弃 2 + 补全 1)

---

## 迁移映射总表

| 处置 | Skill | 目标 | 理由 |
|------|-------|------|------|
| **保留** | preflight-lite | 不变 | 全 Agent 注册，功能核心 |
| **保留** | context7-first | 不变 | 全 Agent 注册 |
| **保留** | codegraph-first | 不变 | 全 Agent 注册 |
| **保留** | opencode-mcp-integration | +new-asset-integrator 内容 | 全 Agent 注册，吸收 new-asset |
| **保留** | brainstorming | 两级分层改造 | Architect + Meta-Planner 注册 |
| **保留** | multi-agent-orchestration | 不变 | Orchestrator 注册 |
| **保留** | auto-commit | 不变 | Coder-FE + Coder-BE 注册 |
| **保留** | spreadsheet-processor | 不变 | Knowledge-Curator 注册 |
| **保留** | sqlite-bloat-investigation | 不变 | Guardian 注册 |
| **保留** | learning-mode-executor | 不变 | Knowledge-Curator 注册 |
| **保留** | customize-opencode | 不变 | Super-Admin 注册 |
| **保留** | cross-directory-ci | 不变 | CI-CD-Agent 注册 |
| **保留** | cicd-database-seeding | 不变 | Coder-BE 注册 |
| **合并** | devops-ci-cd-guardrails | → ci-cd-guardrails | 三者覆盖域高度重合 |
| **合并** | fullstack-ci-cd-guardrails | → ci-cd-guardrails | 三者覆盖域高度重合 |
| **合并** | global-cicd-practices-enforcement | → ci-cd-guardrails | 三者覆盖域高度重合 |
| **合并** | new-asset-integrator | → opencode-mcp-integration | 功能域重合（MCP/Skill 集成） |
| **废弃** | preflight-lite | 功能并入 preflight-lite | 零注册，与 preflight-lite 重叠 |
| **废弃** | skill-creator | 删除 | description "待完善"，空壳 |

## 合并后最终 Skill 列表 (15 个)

| # | Skill | 注册 Agent | 变更 |
|---|-------|-----------|------|
| 1 | preflight-lite | ALL 10 | +preflight-lite 快速模式 |
| 2 | context7-first | ALL 10 | 不变 |
| 3 | codegraph-first | ALL 10 | 不变 |
| 4 | opencode-mcp-integration | ALL 10 | +new-asset-integrator 内容 |
| 5 | brainstorming | Architect, Meta-Planner | 两级分层 |
| 6 | multi-agent-orchestration | Orchestrator | 不变 |
| 7 | auto-commit | Coder-FE, Coder-BE | 不变 |
| 8 | spreadsheet-processor | Knowledge-Curator | 不变 |
| 9 | sqlite-bloat-investigation | Guardian | 不变 |
| 10 | learning-mode-executor | Knowledge-Curator | 不变 |
| 11 | customize-opencode | Super-Admin | 不变 |
| 12 | cross-directory-ci | CI-CD-Agent | 不变 |
| 13 | cicd-database-seeding | Coder-BE | 不变 |
| 14 | ci-cd-guardrails | CI-CD-Agent | **新建** (合并 3 个 CI/CD) |
| 15 | skill-creator | (待定) | **补全或确认废弃** |

## 废弃/合并的 Skill 目录处置

| 原目录 | 处置 |
|--------|------|
| skills/devops-ci-cd-guardrails/ | → .trash-phase1/ |
| skills/fullstack-ci-cd-guardrails/ | → .trash-phase1/ |
| skills/global-cicd-practices-enforcement/ | → .trash-phase1/ |
| skills/new-asset-integrator/ | → .trash-phase1/ |
| skills/preflight-lite/ | → .trash-phase1/ |
| skills/skill-creator/ | → .trash-phase1/ (如确认废弃) |

## Agent skills 注册变更矩阵

| Agent | Phase 0 (当前) | Phase 1 (目标) |
|-------|---------------|---------------|
| Orchestrator | 6: preflight, context7, codegraph, mcp-integ, new-asset, multi-agent | 5: preflight, context7, codegraph, mcp-integ, multi-agent |
| Super-Admin | 6: preflight, context7, codegraph, mcp-integ, customize, skill-creator | 5: preflight, context7, codegraph, mcp-integ, customize |
| Knowledge-Curator | 6: preflight, context7, codegraph, mcp-integ, spreadsheet, learning | 不变 |
| Coder-FE | 5: preflight, context7, codegraph, mcp-integ, auto-commit | 不变 |
| Coder-BE | 6: preflight, context7, codegraph, mcp-integ, cicd-seeding, auto-commit | 不变 |
| Guardian | 5: preflight, context7, codegraph, mcp-integ, sqlite-bloat | 不变 |
| Architect | 5: preflight, brainstorming, context7, codegraph, mcp-integ | 不变 |
| Meta-Planner | 5: brainstorming, preflight, context7, codegraph, mcp-integ | 不变 |
| Arbiter | 4: preflight, context7, codegraph, mcp-integ | 不变 |
| CI-CD-Agent | 8: preflight, devops-cicd, fullstack-cicd, global-cicd, cross-dir, context7, codegraph, mcp-integ | 5: preflight, ci-cd-guardrails, cross-dir, context7, codegraph, mcp-integ |

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始映射表创建 |
