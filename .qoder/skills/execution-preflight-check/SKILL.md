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
6. **DAG readiness is confirmed** (Meta-Planner has analyzed the task)

## Pre-Flight Checklist (MUST COMPLETE BEFORE PROCEEDING)

### ✅ Step 0: Recall Governance Invariants from Memory

Before proceeding with any checks, recall the framework governance rules:

- [ ] Call `search_memory(depth='shallow', query='framework governance invariants', category='expert_experience,project_introduction')`
- [ ] Review returned memories for P0 protocol rules, TDD iron law, and compliance gate requirements
- [ ] Use recalled context to guide all subsequent steps

### ✅ Step 1: Rule Compliance Verification

Before doing anything else, read and acknowledge:

- [ ] `.qoder/rules/common-project.md` - Core project rules
- [ ] `.qoder/rules/mcp-compliance-guide.md` - MCP execution guide
- [ ] `.qoder/rules/rule_detail/universal-project-execution-rules.md` - Full execution framework
- [ ] `.qoder/rules/rule_detail/skill-invocation-standard.md` - Skill invocation standard

**Key Rules to Acknowledge:**

- "MCP Absolutely Mandatory" - MCP is absolutely mandatory
- "No Analysis Without MCP" - No analysis without MCP
- "No Progression Until All MCP Succeed" - No progression without MCP completion
- "Structured Flow: MCP→Analysis→Design→Testing→Implementation→Verification" - Structured flow

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

### ✅ Step 2.5: Meta-Planner DAG Readiness Check 🚨

**BEFORE any analysis or coding**, check whether the current task has been analyzed by @Meta-Planner:

- [ ] Check project root for `Task.DAG.json` existence
- [ ] If NOT exists → **STOP. Must dispatch @Meta-Planner first** to generate DAG
- [ ] If exists → check if it contains an entry for the current task
- [ ] If NO matching entry → **STOP. Must dispatch @Meta-Planner** to append new task
- [ ] If entry exists → verify task `status` is `pending`
- [ ] If status is not `pending` → confirm whether re-execution is needed

**DAG Decision Matrix:**

| DAG State                        | Action Required                          |
|----------------------------------|------------------------------------------|
| No `Task.DAG.json` exists        | 🛑 Dispatch @Meta-Planner to generate    |
| DAG exists, no current task      | 🛑 Dispatch @Meta-Planner to append      |
| DAG exists, task is `pending`    | ✅ Proceed with scheduling per DAG        |
| DAG exists, task is `in_progress`| ⚠️ Resume previous session or verify     |
| DAG exists, task is `completed`  | ✅ Skip (task already done)               |

**Rule of thumb:** Any work item requiring code changes → must have DAG coverage. If unsure, dispatch @Meta-Planner.

### ✅ Step 2.7: Verify Git Hooks Path

Ensure the project's git hooks are properly configured:

- [ ] Call `run_in_terminal("git config core.hooksPath")` to verify hooks path points to `.qoder/hooks`
- [ ] If not set or incorrect, flag for manual correction

### ✅ Step 2.8: State Machine Sync Check

Verify the framework state machine is synchronized:

- [ ] Call `run_in_terminal("node .qoder/scripts/framework-self-test.js")` to run self-test
  - Note: On Windows without Git Bash, prefer the Node.js variant over bash scripts
  - Alternative (Git Bash available): `run_in_terminal("bash .qoder/scripts/pre-execution-hook.sh")`
- [ ] If self-test fails, report discrepancies before proceeding

### ✅ Step 3: MCP Invocation Planning

Create a concrete MCP invocation plan:

- [ ] List all MCP tools needed for this task
- [ ] Mark blocking vs. non-blocking calls
- [ ] Define failure handling strategy
- [ ] Plan `todo_write` tracking for each MCP call

**Blocking MCP Calls (Must Succeed First):**

- Environment verification
- Dependency checks
- Technology stack validation
- Security scans

### ✅ Step 4: todo_write Initialization

Initialize `todo_write` with these mandatory sections:

1. Rule compliance verification
2. MCP invocation checklist
3. Skill invocation tracking
4. Task execution phases
5. Skill execution integrity tracking

## Current Project MCP Tool Inventory

### Available MCP Tools

- **GitHub MCP** - search_repositories, get_file_contents, create_issue, create_pull_request, etc.
- **Context7 MCP** - resolve-library-id, query-docs (for tech stack documentation)
- **Pandoc MCP** - convert-contents (document format conversion)
- **PostgreSQL MCP** - query (database queries)
- **Qoder Platform Tools** - read_file, search_file, grep_code, search_codebase, search_symbol, list_dir, create_file, search_replace, run_in_terminal, todo_write, search_memory, update_memory, TaskGet, TaskUpdate, TaskList, SendMessage, Skill

### MCP Tool Selection Guide

- **Tech stack questions**: Use Context7 MCP first
- **GitHub operations**: Use GitHub MCP tools
- **Code search**: Use `search_codebase` or `grep_code` or `search_symbol`
- **File discovery**: Use `search_file` or `list_dir`
- **Memory recall**: Use `search_memory` for project knowledge and past experiences
- **Task management**: Use `TaskGet` / `TaskUpdate` / `TaskList`
- **Agent dispatch**: Use `SendMessage` to communicate with Leader for sub-agent orchestration

## Execution Flow Enforcement

### 🚨 ABSOLUTE PROHIBITIONS

**NEVER do any of these:**

- ❌ Skip rule reading
- ❌ Start analysis without MCP
- ❌ Make code changes before MCP completion
- ❌ Ignore TodoWrite tracking
- ❌ Proceed after MCP failure without proper handling
- ❌ **Analyze requirements without first checking DAG readiness** (Step 2.5)

### ✅ MANDATORY EXECUTION PATTERN

```
1. Invoke THIS skill (execution-preflight-check)
2. Call search_memory for governance invariants (Step 0)
3. Invoke ALL relevant skills
4. Initialize todo_write with MCP checklist
5. ✅ Check DAG Readiness (Step 2.5) ← dispatch @Meta-Planner if needed
6. Verify git hooks path (Step 2.7)
7. Run framework state machine sync (Step 2.8)
8. Execute BLOCKING MCP calls FIRST
9. Verify ALL MCP succeeded (or handled)
10. Call compliance_gate_check(task_description)  ← BLOCKING
11. Show plan to user and wait for confirmation  ← BLOCKING (user must respond)
12. Call compliance_gate_confirm(plan_summary)   ← arms the gate
13. ONLY THEN proceed to analysis/implementation
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
2. Re-initialize `todo_write`
3. Backtrack to the last compliant state

## Consequences of Non-Compliance

Non-compliant execution will result in:

- Immediate task suspension
- Requirement to restart from pre-flight check
- Full audit of the execution path

## High Extensibility Design

### Adding New Skills

1. Create Skill file in `.qoder/skills/{skill-id}/SKILL.md`

2. Add metadata to `.qoder/rules/rule_detail/skill-invocation-standard.md`

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
