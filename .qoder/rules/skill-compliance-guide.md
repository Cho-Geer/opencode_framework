---
type: model_decision
description: Only relevant during skill invocation
---

# Skill Call Compliance Guide

## Skill Call Self-Check Checklist
- [ ] Reviewed the "Registered Skill Inventory" in `.qoder/rules/rule_detail/skill-invocation-standard.md`
- [ ] Identified task type and keywords, matched trigger keywords
- [ ] Created "Planned Skill Call List" and presented to user for confirmation
- [ ] Called Skills in priority order (P0→P1→P2)

## Skill Call Runtime Checks
- Before starting any task: First plan and present the Skill call plan
- When calling Skills: Verify compliance with the process requirements in `.qoder/rules/rule_detail/skill-invocation-standard.md`
- When adding new Skills: Must use the skill-creator Skill and update `.qoder/rules/rule_detail/skill-invocation-standard.md`

## Skill Call Violation Prevention Patterns
1. Plan before execute: Before starting any task, you must first present the Skill call plan
2. Consult `.qoder/rules/rule_detail/skill-invocation-standard.md` first: This is the first step for all tasks
3. Skills must be registered: All Skills must be registered in `.qoder/rules/rule_detail/skill-invocation-standard.md`
4. Transparent supervision: Present the plan before the task, allowing the user to supervise

