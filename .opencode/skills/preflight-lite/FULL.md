---
name: "preflight-lite"
description: "Comprehensive reference for the preflight-lite lightweight execution protocol. Contains task classification, skill selection guide, knowledge freshness policy, Scout escalation criteria, and TodoWrite working memory protocol. This is a REFERENCE document — the active entry point is SKILL.md."
version: "3.0.0"
---

# preflight-lite — Full Reference

> **⚠️ 版本说明 (v3.0.0, 2026-07-06)**
>
> 此文件是 **reference document**，不是 active policy。Active entry point 是 `SKILL.md`（14 步 lightweight workflow）。
>
> **与旧版的关键区别**：
> - 不再要求 DAG entry（`require_dag_entry=false`）
> - 不再要求 compliance gate（`compliance_gate_check`/`confirm` 已从 active path 移除）
> - 不再要求 MCP 全成功才能继续（MCP 失败按 fallback 策略处理）
> - 不再要求每次会话先读 4 个规则文件（Skill 和 Hook 已承载关键规则）
> - TodoWrite 是工作记忆，不是 compliance gate
> - 普通小任务可以跳过完整 preflight，直接执行

---

## 1. Task Classification & Skill Selection

### Risk Classification

| Risk Level | Criteria | TodoWrite | Preflight Depth |
|-----------|----------|-----------|-----------------|
| **trivial** | 单步操作、事实查询、简单读取 | 不需要 | 跳过 |
| **standard** | 明确目标的代码修改、bug fix、配置变更 | 3-5 todos | SKILL.md 14 步 |
| **high-risk** | 框架核心修改、DB migration、权限变更、多文件重构 | 5-8 todos | SKILL.md + 本文件 §4-6 |
| **blocked** | 信息不足、目标不清、依赖外部决策 | 1 blocked todo + `question` | 先求助再执行 |

### Skill Selection Matrix

| Task Type | Primary Skill | Supporting Skills |
|-----------|--------------|-------------------|
| 需求含糊 / 设计 / 方案 | `brainstorming` | — |
| 源码编辑 / 重构 / debug | `codegraph-first` | — |
| 框架 / plugin / hook / agent | `customize-opencode` | `codegraph-first` |
| dispatch / subagent / handoff | `dispatch-protocol` | — |
| 交付物 / review / approval | `deliverable-contract` | — |
| CI / deploy / container | `ci-cd-guardrails` | `cross-directory-ci` |
| DB schema / seed / migration | `cicd-database-seeding` | — |
| 外部 API / framework / library | `context7-first` | local authoritative docs |
| 复杂调研 / 冲突证据 / stuck | Scout (via native Task) | `investigation-evidence` |
| Spreadsheet / Excel | `spreadsheet-processor` | — |
| SQLite 膨胀 / 性能 | `sqlite-bloat-investigation` | — |

> Skill 由 `skill-summary` system hook 按关键词自动匹配注入。上表作为手动确认和补充参考。

---

## 2. MCP Usage Guide

MCP 是工具，不是门禁。按任务需要使用，不需要"全成功才能继续"。

### Available MCP Servers (12 enabled)

| MCP Server | Use Case |
|-----------|----------|
| **Context7** | 外部 framework/API/library 文档查询 |
| **CodeGraph** | 本地代码影响分析、符号搜索、调用链 |
| **GitHub** | PR/Issue/Repo 操作 |
| **compliance-gate** | 高风险任务合规检查（仅 high-risk 显式请求时） |
| **notify-server** | QoderWork 通知 |

### MCP Failure Handling

| Scenario | Strategy |
|----------|----------|
| MCP server 不可用 | 用本地替代方案（CodeGraph CLI、grep/glob）继续，记录在 output |
| MCP 返回不完整结果 | 补充其他证据源，不阻断 |
| MCP 超时 | 设合理超时，超时后 fallback 到本地 |

---

## 3. Task Type Boundaries

### Full Preflight (SKILL.md + this reference)

- 框架核心修改（plugin / hook / agent / permission / DB schema）
- 多文件重构
- 跨 session 长任务
- 高风险写入（删除文件、修改权限配置、DB migration）

### Standard Preflight (SKILL.md only)

- 代码修改、bug fix、feature 实现
- CI/CD 配置变更
- 调试和问题修复

### Simplified (SKILL.md 可跳过)

- 代码评审、审计、分析
- 技术方案对比
- 纯调研任务
- 文档读取和理解

### Direct Answer (不需要 preflight)

- 事实性问题
- 简单配置查询
- 澄清前一轮对话

---

## 4. Knowledge Freshness (Context7)

Before planning or editing code that depends on external frameworks, APIs, or libraries:

1. **Ask**: Does this task depend on external knowledge that may have changed since training?
   - External framework behavior (React, Next.js, Prisma, etc.)
   - API endpoints, SDK versions, CLI flags
   - Dependency version semantics
   - Configuration format changes
   - Current best practices

2. **If yes**: Gather Context7 or local authoritative evidence BEFORE planning or editing.
   - Use `context7-first` Skill for external documentation lookup.
   - Check local `docs/official_docs/` for cached authoritative sources.
   - Record evidence in your output.

3. **If no**: Skip Context7. Pure local business logic, simple doc/comment changes, or patterns you can copy from existing code do not need external verification.

**Decision logging**: Record `knowledge_freshness: needed/skipped + reason` in your preflight output.

---

## 5. Scout Escalation

For complex, uncertain tasks where the current agent is stuck or evidence conflicts:

**Trigger conditions** (escalate to Scout via native Task):
- Complex bug with unclear root cause after multiple failed attempts
- Need multi-source official documentation or third-party repository investigation
- Technology selection, migration planning, framework upgrade design
- Weak model cannot form a reliable plan and brainstorming is insufficient

**NOT a trigger**: Simple tasks, straightforward edits, or tasks where local evidence is sufficient.

**Scout output contract**: When dispatching Scout, expect:
- `question`: What Scout was asked to investigate
- `sources_checked`: Documents, repositories, files examined
- `evidence_summary`: Key findings relevant to the conclusion
- `options`: Possible approaches with trade-offs
- `recommendation`: Suggested next step
- `risks_open_questions`: Remaining risks

---

## 6. TodoWrite as External Working Memory

TodoWrite is the weak model's short-term execution state machine, NOT a user-facing progress bar.

**Task grading**:
- **trivial**: Direct answer or single read. No TodoWrite needed.
- **standard**: Create 3-5 actionable todos covering evidence, implementation, validation, report.
- **high-risk**: Create 5-8 todos, MUST include evidence, risk/rollback, validation, handover.
- **blocked**: Create one blocked todo explaining what's missing, then call `question`.

**Execution discipline**:
- Exactly one `in_progress` todo at a time.
- Every write/validation/Scout action must map to the current `in_progress` todo.
- On tool failure: update the todo with recovery intent BEFORE retrying.
- Before final answer: all incomplete todos must be `completed`, `canceled`, or explained.

**Prohibited**:
- Do NOT sync TodoWrite to DB checklists or DAGs.
- Do NOT use TodoWrite as a compliance gate.
- Do NOT split every micro-action into a todo (creates noise).

---

## 7. High-Risk Task Extended Protocol

For high-risk tasks (framework core changes, DB migration, permission changes, multi-file refactoring):

### Pre-Execution

1. **Backup**: Ensure target files are backed up or recoverable via git.
2. **Impact analysis**: Run CodeGraph impact before any source edit.
3. **Evidence collection**: Gather authoritative docs (Context7 / local docs) for external dependencies.
4. **Assumptions**: List assumptions explicitly; if critical, ask via `question` before proceeding.

### During Execution

5. **Incremental**: Make changes in small, verifiable steps.
6. **Audit trail**: Each significant change should produce an audit event.
7. **QoderWork bridge**: If stuck or uncertain, use `question` — don't guess on irreversible decisions.

### Post-Execution

8. **Self-check**: Verify changes against the original goal.
9. **Evidence**: Collect test results, log output, or CodeGraph verification.
10. **Handover**: If task is incomplete, document state and blockers clearly.

---

## 8. Brainstorming Integration

### Micro Card (default, ~100-300 tokens)

Before acting on any non-trivial task, answer internally:
1. Goal clear?
2. Scope/files clear?
3. Success criteria clear?
4. Risk level: low / normal / high?
5. Need to ask QoderWork?
If not asking, state assumptions briefly.

### Full Brainstorming (trigger conditions)

Invoke complete `brainstorming` Skill when:
1. User requirement is ambiguous or goal is incomplete.
2. Architecture, refactoring, design, migration, permission, DB, or framework core changes.
3. Multi-file, multi-module, multi-agent, or cross-session long tasks.
4. Model has failed repeatedly or produced low-quality fixes.
5. QoderWork ACP observes model skipping key clarifications.

### Question Budget

| Task Type | Default Behavior | Question Budget |
|-----------|-----------------|-----------------|
| Small fix / clear problem | Micro card, proceed | 0-1 questions |
| Medium complexity | List assumptions + open questions | 1-3 questions |
| High-risk | Full brainstorming + QoderWork confirmation or explicit assumptions | Until key decisions are clear |
| User requests speed | Don't block, state assumptions and proceed | 0-1 questions |

---

## Appendix A: Historical Changes (v1.0 → v3.0.0)

| Version | Date | Key Changes |
|---------|------|-------------|
| v1.0 | pre-2026-07 | Mandatory DAG + compliance gate + MCP全成功 + 4 rule files + TodoWrite 5 mandatory sections |
| v2.0 | 2026-07-05 | Added Quick Preflight Mode, Knowledge Freshness, Scout, TodoWrite working memory |
| v3.0.0 | 2026-07-06 | Removed DAG/compliance gate/MCP硬门禁; aligned with `require_dag_entry=false`, `checklist=optional`, single-policy enforcement; restructured as reference document |

## Appendix B: Deprecated Constructs (DO NOT USE)

以下构造已从 active policy 移除。如果在其他文档/规则中看到，应视为 legacy reference：

| Construct | Status | Replacement |
|-----------|--------|-------------|
| `compliance_gate_check()` / `compliance_gate_confirm()` | 不在 active path | 高风险任务使用 §7 Extended Protocol |
| `Task.DAG.json` 作为 dispatch 硬前置 | `require_dag_entry=false` | DAG 仅用于大型任务规划 artifact |
| @Meta-Planner dispatch 作为必要步骤 | Meta-Planner 已退役为 legacy profile | 使用 `plan` 原生 agent + brainstorming Skill |
| "MCP絶対強制" / "无MCP不分析" | 已移除 | MCP 按任务需要使用，失败有 fallback |
| TodoWrite 5 mandatory sections | 已简化 | TodoWrite 按风险级别分级（§6）|
| 每次会话先读 4 个规则文件 | 已移除 | 关键规则已内化到 Skill 和 Hook |
