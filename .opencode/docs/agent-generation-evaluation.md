# Agent File Generation Evaluation (Phase 5)

> **Created**: 2026-07-05
> **Phase**: 5
> **Status**: Evaluation — not yet implemented

---

## Concept

Since Agent .md files are now alias manifests (<50 lines each), they could be generated from configuration rather than hand-written.

### Data Sources
1. `agent-alias-map.md` — alias → native executor mapping
2. `project.config.json` — agent_tool_scopes, enforcement_exemptions
3. Skill bundle configs — which skills each agent type needs

### Generation Script (Optional)
`.opencode/scripts/generate-agent-manifests.ts`

Could generate all 10 Agent .md files from:
- Alias mapping table
- Skill bundle definitions
- Permission matrix config
- MCP tool grants

### Assessment
- **Feasibility**: High — manifests are simple and formulaic
- **Value**: Medium — saves initial setup, but manifests rarely change
- **Risk**: Low — generated files can be reviewed before commit
- **Priority**: Low — manual manifests work fine at current scale (10 agents)

### Recommendation
Defer implementation. Current manual manifests are sufficient.
Re-evaluate if agent count grows beyond 15.

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始评估 |
