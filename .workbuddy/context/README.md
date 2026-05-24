# .workbuddy/context/ — Project Domain Knowledge

This directory stores **project-specific domain knowledge** that the framework's governance layer references but does not define.

## Structure

```
context/
├── code_standards/        # Coding conventions per layer (beyond generic enforcement rules)
│   ├── backend-coding-standard.md
│   ├── frontend-coding-standard.md
│   └── testing-coding-standard.md
├── detailed_design/        # Page/UI specifications and design documents
│   ├── page-panorama.md   # Master page inventory
│   └── pages/             # Individual page design specs
│       ├── 01-login.md
│       ├── ...
│       └── NN-page-name.md
├── requirements/           # Architecture decisions, ADRs, security designs, API specs
│   ├── eslint-audit-architecture.md
│   ├── pii-encryption-strategy.md
│   ├── requirements-modification-scope.md
│   ├── requirements-guardian-report.md
│   ├── system-timezone-architecture.md
│   ├── multi-instance-deployment.md
│   ├── security-architecture.md
│   ├── api-interface-specification.md
│   ├── data-architecture.md
│   ├── test-strategy-and-plan.md
│   ├── system-architecture-design.md
│   └── operations-and-deployment-design.md
└── README.md              # This file
```

## Relationship to Framework Layers

| Framework Layer | What It Provides | How Context Complements It |
|---|---|---|
| `.codebuddy/rules/` | Generic enforcement (5-class verification per layer) | Project-specific coding conventions, naming rules, pattern examples |
| `.workbuddy/skills/` | Process workflows (TDD, gates, verification) | Detailed standards (mock governance, coverage matrices, CI pipelines) |
| `.workbuddy/agents/` | Role definitions (architect, coder, guardian, etc.) | Domain knowledge agents reference (API contracts, security models, data schemas) |
| `.workbuddy/mcp/` | Tool servers (compliance gate, quality gate, etc.) | The data the tools validate against (contract schemas, lint policies) |

## How It's Used

1. **context7-first skill**: Searches this directory before external documentation
2. **Agents**: Reference these files for project-specific conventions
3. **Hooks**: Validation rules may reference code standards for enforcement
4. **MCP tools**: Use requirements/ for contract validation and compliance checks

## Migration from Original Framework

This directory replaces `.opencode/context/` from the original Opencode Framework.
All files have been migrated and translated to English where needed.

| Original Path | New Path | Changes |
|---|---|---|
| `.opencode/context/code_standards/` | `.workbuddy/context/code_standards/` | Unchanged |
| `.opencode/context/detailed_design/系统页面全景图.md` | `.workbuddy/context/detailed_design/page-panorama.md` | Translated filename |
| `.opencode/context/detailed_design/pages/` | `.workbuddy/context/detailed_design/pages/` | Unchanged |
| `.opencode/context/requirements/多实例部署需求文档.md` | `.workbuddy/context/requirements/multi-instance-deployment.md` | Translated filename + content |
| `.opencode/context/requirements/安全架构设计文档.md` | `.workbuddy/context/requirements/security-architecture.md` | Translated filename + content |
| `.opencode/context/requirements/接口设计规范文档.md` | `.workbuddy/context/requirements/api-interface-specification.md` | Translated filename + content |
| `.opencode/context/requirements/数据架构设计文档.md` | `.workbuddy/context/requirements/data-architecture.md` | Translated filename + content |
| `.opencode/context/requirements/测试策略与计划.md` | `.workbuddy/context/requirements/test-strategy-and-plan.md` | Translated filename + content |
| `.opencode/context/requirements/系统架构设计文档（SAD）.md` | `.workbuddy/context/requirements/system-architecture-design.md` | Translated filename + content |
| `.opencode/context/requirements/运维与部署设计文档.md` | `.workbuddy/context/requirements/operations-and-deployment-design.md` | Translated filename + content |
