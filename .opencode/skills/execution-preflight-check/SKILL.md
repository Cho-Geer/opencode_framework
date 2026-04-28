---
name: "execution-preflight-check"
description: "MANDATORY pre-flight check that MUST be invoked BEFORE ANY task execution. Verifies rule compliance, MCP readiness, and skill invocation requirements. This skill ensures strict adherence to the project's execution framework."
---

# execution-preflight-check Skill

## ⚠️ ABSOLUTELY MANDATORY - READ THIS FIRST

**THIS SKILL MUST BE INVOKED BEFORE ANY OTHER ACTION IN EVERY CONVERSATION.**

No exceptions. No shortcuts. This is the first line of defense against non-compliant execution.

## Core Purpose

This skill enforces the project's strict execution framework by verifying:

1. Rule compliance has been acknowledged
2. MCP invocation strategy is planned
3. Relevant skills have been identified
4. TodoWrite tracking is initialized
5. **Compliance gate is armed** (via `compliance_gate_check` + `compliance_gate_confirm`)

## Pre-Flight Checklist (MUST COMPLETE BEFORE PROCEEDING)

### ✅ Step 1: Rule Compliance Verification

Before doing anything else, read and acknowledge:

- [ ] `.opencode/rules/common-project.md` - Core project rules
- [ ] `.opencode/rules/mcp-compliance-guide.md` - MCP execution guide
- [ ] `.opencode/rules/rule_detail/通用项目执行规则框架.md` - Full execution framework
- [ ] `.opencode/rules/rule_detail/skill-invocation-standard.md` - Skill invocation standard

**Key Rules to Acknowledge:**

- "MCP绝对强制" - MCP is absolutely mandatory
- "无MCP不分析" - No analysis without MCP
- "MCP未全员成功严禁进入下一阶段" - No progression without MCP completion
- "结构化流程: MCP→分析→设计→测试→实现→验证" - Structured flow

### ✅ Step 2: Task Classification & Skill Identification

Classify the user's task and identify required skills:

| Task Type                    | Required Skills                                                |
| ---------------------------- | -------------------------------------------------------------- |
| **DevOps/CI/CD**             | `fullstack-ci-cd-guardrails`, `devops-ci-cd-guardrails`, `global-cicd-practices-enforcement` |
| **Spreadsheet/Excel**        | `spreadsheet-processor`                                        |
| **Code Development**         | `context7-first`                                               |
| **Requirements/Design**      | `brainstorming`                                                |
| **Salesforce**               | Salesforce DX MCP tools                                        |
| **Documentation**            | (as needed)                                                    |
| **Cross-directory/Monorepo** | `cross-directory-ci`                                           |
| **Next.js Routing**          | `nextjs-router-guardrails`                                     |
| **Prisma Seed**              | `prisma-seed-cicd`                                             |

**Action:** Immediately invoke ALL relevant skills before proceeding.

### ✅ Step 3: MCP Invocation Planning

Create a concrete MCP invocation plan:

- [ ] List all MCP tools needed for this task
- [ ] Mark blocking vs. non-blocking calls
- [ ] Define failure handling strategy
- [ ] Plan TodoWrite tracking for each MCP call

**Blocking MCP Calls (Must Succeed First):**

- Environment verification
- Dependency checks
- Technology stack validation
- Security scans

### ✅ Step 4: TodoWrite Initialization

Initialize TodoWrite with these mandatory sections:

1. Rule compliance verification
2. MCP invocation checklist
3. Skill invocation tracking
4. Task execution phases
5. Skill execution integrity tracking

## Current Project MCP Tool Inventory

### Available MCP Tools

- **GitHub MCP** - search\_repositories, get\_file\_contents, create\_issue, create\_pull\_request, etc.
- **Context7 MCP** - resolve-library-id, query-docs (for tech stack documentation)
- **Pandoc MCP** - convert-contents (document format conversion)
- **PostgreSQL MCP** - query (database queries)
- **Task Agent** - search, salesforce-dx-expert, devops-architect, playwright-mcp-expert

### MCP Tool Selection Guide

- **Tech stack questions**: Use Context7 MCP first
- **GitHub operations**: Use GitHub MCP tools
- **Code search**: Use SearchCodebase or Task(search)
- **Salesforce tasks**: Use salesforce-dx-expert agent
- **DevOps/CI/CD**: Use devops-architect agent
- **Playwright/UI testing**: Use playwright-mcp-expert agent

## Execution Flow Enforcement

### 🚨 ABSOLUTE PROHIBITIONS

**NEVER do any of these:**

- ❌ Skip rule reading
- ❌ Start analysis without MCP
- ❌ Make code changes before MCP completion
- ❌ Ignore TodoWrite tracking
- ❌ Proceed after MCP failure without proper handling

### ✅ MANDATORY EXECUTION PATTERN

```
1. Invoke THIS skill (execution-preflight-check)
2. Invoke ALL relevant skills
3. Initialize TodoWrite with MCP checklist
4. Execute BLOCKING MCP calls FIRST
5. Verify ALL MCP succeeded (or handled)
6. Call compliance_gate_check(task_description)  ← BLOCKING
7. Show plan to user and wait for confirmation  ← BLOCKING (user must respond)
8. Call compliance_gate_confirm(plan_summary)   ← arms the gate
9. ONLY THEN proceed to analysis/implementation
```

## Task Type Boundaries

### Full MCP/Skill Flow Required

- Code development, modification, refactoring
- CI/CD configuration changes
- Architecture design, solution implementation
- Debugging, issue remediation

### Simplified but Rule-Compliant

- Code evaluation, audit, review
- Technical solution analysis, comparison
- Pure research, investigation tasks
  → **Requirement:** At least read rule documents, use Context7 for tech stack docs (if applicable)

### Direct Answer Allowed

- Questions about the rules themselves
- Simple factual questions
- Clarification of previous conversations

## Reminder Mechanism

If at any point you forget these steps, STOP and:

1. Re-invoke this skill
2. Re-initialize TodoWrite
3. Backtrack to the last compliant state

## Consequences of Non-Compliance

Non-compliant execution will result in:

- Immediate task suspension
- Requirement to restart from pre-flight check
- Full audit of the execution path

## High Extensibility Design

### Adding New Skills

1. Create Skill file in `.opencode/skills/{skill-id}/SKILL.md`

2. Add metadata to `.opencode/rules/rule_detail/skill-invocation-standard.md`

3. Update the "Task Classification & Skill Identification" table above

4. Update the "Current Project MCP Tool Inventory" section if adding new MCP tools

5. Update the "MCP Tool Selection Guide" with usage scenarios for new tools

6. Update Skill invocation examples in relevant sections

### Adding New MCP Tools

1. Add to "Current Project MCP Tool Inventory" section
2. Update "MCP Tool Selection Guide" with usage scenarios
3. Add to MCP invocation planning checklist examples

***

**LAST REMINDER:** You just invoked this skill. Now complete the checklist above BEFORE doing anything else.
