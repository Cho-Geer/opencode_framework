---
type: always
description: MCP tool usage compliance for all agents
---

# MCP Call Compliance Self-Check Guide

## MCP Call Self-Check Checklist
- [ ] Reviewed the "Registered MCP Tool Inventory" in `.qoder/rules/rule_detail/mcp-tool-inventory.md`
- [ ] Identified task type and keywords, matched trigger keywords
- [ ] Created "Planned MCP Tool Call List" and presented to user for confirmation
- [ ] Called tools in priority order (P0→P1→P2)
- [ ] Called `compliance_gate_check(task_description)` to execute compliance gate check (P0 blocking)
- [ ] Presented plan to user and obtained confirmation
- [ ] Called `compliance_gate_confirm(plan_summary)` to arm the compliance gate

## MCP Call Runtime Checks
- Before starting any task: First plan and present the MCP tool call plan
- When calling tools: Verify compliance with the process requirements in `.qoder/rules/rule_detail/mcp-tool-inventory.md`

## MCP Call Violation Prevention Patterns
1. Plan before execute: Before starting any task, you must first present the MCP tool call plan
2. Consult `.qoder/rules/rule_detail/mcp-tool-inventory.md` first: This is the first step for all tasks
3. Tools must be registered: All MCP tools must be registered in `.qoder/rules/rule_detail/mcp-tool-inventory.md`
4. Transparent supervision: Present the plan before the task, allowing the user to supervise the tool call process

