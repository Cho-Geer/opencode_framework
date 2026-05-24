---
type: always
description: Universal project standards
---
# Core Universal Project Execution Rules (Highest Priority, Mandatory for All Agents)

## 1. Core Mandatory Principles
- **Skill-First Mandate**: Before starting any task, you must first consult `.qoder/rules/rule_detail/skill-invocation-standard.md` and execute accordingly.
- **MCP-First Mandate**: You must first consult `.qoder/rules/rule_detail/mcp-tool-inventory.md`; work is prohibited until information is gathered.
- **Single Main Process**: Consult `.qoder/rules/rule_detail/skill-invocation-standard.md` and `.qoder/rules/rule_detail/mcp-tool-inventory.md` → Generate checklist → MCP calls (blocking) → Technical analysis → Design implementation → TDD verification → Deployment verification. Skipping steps is strictly prohibited.
- **Confirmation**: Project type, tech stack, corresponding MCP toolchain.
- **Hard Blocking**: MCP not fully successful, test coverage <85%, unpatched security vulnerabilities — progression to the next phase is strictly prohibited; checklist-driven; all decisions must be recorded.
- **Compliance Gate Mandate**: All tasks must sequentially call `compliance_gate_check(task_description)` → Present plan and wait for user confirmation → `compliance_gate_confirm(plan_summary)`. Entry into design/coding phase is prohibited until the compliance gate is armed.
- **Failure Handling**: Retry 3 times → Use official documentation as alternative → Re-verify after MCP recovery
  - After any MCP call failure, all subsequent tasks must be immediately suspended. Continuation is only allowed after the current failed MCP item is resolved.
- **Status Gate**: All MCP call items must reach "successful" or "resolved via alternative" status before entering the analysis phase.
- **State Machine Mandatory Sync**: All task status changes must conform to the lifecycle transition rules defined in `.qoder/state/machine.json` and must provide all evidence files required for the transition. The Git Pre-commit Hook enforces this validation; commits violating these rules will be rejected.

## 2. Detailed Rule References (Equal Enforcement Authority as This Document)
All Agents must strictly follow the complete set of documents under `.qoder/rules/rule_detail/`:
- mcp-tool-inventory.md
- skill-invocation-standard.md
- dag-generation-standard.md (DAG generation standard, mandatory for @Meta-Planner)
- state-machine-standard.md (State machine definitions and transition rules)
All Agents must strictly follow all project documents under `.qoder/context/requirements/` (README.md, SAD, API specification, security specification, data specification, testing strategy, deployment documentation, etc.). Each project should place the corresponding requirement documents in `context/requirements/` according to its own tech stack and architecture.

## 3. Priority Statement
This rule > Detailed rules > Agent configuration > Default instructions. In case of any conflict, this rule takes precedence.
