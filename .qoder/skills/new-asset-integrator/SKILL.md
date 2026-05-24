---
name: "new-asset-integrator"
description: "Handles new MCP tool and skill integration workflows. Invoke when user mentions 'new MCP tool' or 'new skill addition'."
---

# New Asset Integrator

## Overview

This skill standardises the workflow for adding new MCP tools and new Skills, ensuring all operations comply with project standards and technical specifications. When the user explicitly mentions "new MCP tool" or "new skill addition" in conversation, this skill's execution flow is automatically triggered.

---

## Trigger Conditions

### Keyword Triggers

Automatically triggered when user conversation contains any of the following keywords:
- `new MCP tool`
- `new skill addition`
- `add MCP tool`
- `add new skill`

---

## Analysis Phase

### 1. Comprehensive Collection and Analysis

Before starting any update operations, the following collection and analysis must be completed:

#### Official Documentation Collection
- [ ] Collect official documentation for the new MCP tool
- [ ] Collect technical specifications for the new Skill
- [ ] Collect use cases and example code
- [ ] Collect version information and change logs

#### Technical Specification Analysis
- [ ] Clarify the core functionality of the new tool/skill
- [ ] Clarify applicable scenarios
- [ ] Clarify input and output parameters
- [ ] Clarify invocation method
- [ ] Clarify dependencies

#### Compatibility Assessment
- [ ] Assess compatibility with existing systems
- [ ] Assess potential impact scope
- [ ] Assess security impact
- [ ] Assess performance impact

---

## MCP Tool Update Workflow

### 2. Update mcp-tool-inventory.md

When confirmed that a new MCP tool needs to be added, follow these steps:

#### Step 1: Prepare MCP Tool Metadata

Use the following template to prepare metadata for the new MCP tool:

```yaml
tool_name: mcp_tool_name
description: Brief description of tool functionality
applicable_scenarios: List applicable scenarios
version: v1.0.0
invocation_example: |
  Example code or command
compliance_requirements: List compliance requirements
```

#### Step 2: Update mcp-tool-inventory.md

1. Add the corresponding table entry under "Section 1: Available MCP Tool Inventory"
2. Update the mapping relationships under "Section 2: MCP Tool Invocation Strategy"
3. Add invocation examples and best practices
4. Reference `MCP_SETUP.md` at project root for MCP server configuration details

#### Step 3: Verify MCP Tool Update

- [ ] Metadata format is correct
- [ ] Consistent with existing entries
- [ ] Tool name, description, and version information are complete
- [ ] Invocation examples are clear
- [ ] Compliance requirements are explicit

#### Step 4: Update keystone hash (if file is keystone-protected)

If the new MCP tool's configuration file is listed in `machine.json` keystone hashes, update the hash:

```
run_in_terminal("node .qoder/scripts/mcp-tools/keystone-validate.js --hash <file>")
```

This ensures the keystone integrity check passes on the next compliance gate.

---

## Skill Update Workflow

### 3. Update skill-invocation-standard.md

When confirmed that a new Skill needs to be added, follow these steps:

#### Step 1: Prepare Skill Metadata

Use the following template to prepare metadata for the new Skill:

```yaml
skill_name: skill-id
display_name: Display Name
category: Category  # P0-Basic Check / P1-Domain Expert / P1-Analysis & Design / P2-Tech Stack / P2-Tool Creation
description: Brief description, 1-2 sentences
trigger_keywords:
  - keyword1
  - keyword2
use_cases:
  - use case 1
  - use case 2
priority: P0/P1/P2
core_features:
  - core feature 1
  - core feature 2
always_first: false
status: active
added_date: YYYY-MM-DD
added_by: Author identifier
```

#### Step 2: Create Skill File and Register

1. Create the Skill file at `.qoder/skills/{skill-id}/SKILL.md` using `create_file`
2. Verify the skill is discoverable by invoking `Skill("{skill-id}")` via Qoder's Skill tool
3. Add a row to the "Skill Registry Table" under "Section 3: Registered Skills"
4. Add the complete metadata YAML block under "Section 4: Detailed Skill Metadata"
5. Update the task classification table in execution-preflight-check/SKILL.md
6. Update the "Adding New Skills" steps in execution-preflight-check/SKILL.md
7. Optionally add relevant combinations under "Section 6: Recommended Skill Combinations for Common Tasks" (if applicable)
8. Optionally add case studies under "Section 8: Case Studies" (if applicable)

#### Step 3: Verify Skill Update

- [ ] Metadata format is correct
- [ ] Consistent with existing entries
- [ ] Category selection is appropriate
- [ ] Trigger keywords are clear
- [ ] Display name is user-friendly
- [ ] Date format is correct (YYYY-MM-DD)
- [ ] skill-invocation-standard.md version number has been updated

---

## Verification Requirements

### 4. Functional Verification Testing

After completing updates, functional verification testing must be performed:

#### Verification Checklist

- [ ] Newly added content can be correctly recognised by the system
- [ ] Newly added content can be correctly invoked
- [ ] Keyword triggers work correctly
- [ ] Metadata is parsed correctly

### 5. Documentation Completeness and Consistency Check

#### mcp-tool-inventory.md Check

- [ ] Format is consistent with existing entries
- [ ] Tool name and description are complete
- [ ] Version information, invocation examples, and compliance requirements are complete
- [ ] Content consistency verification passes

#### skill-invocation-standard.md Check

- [ ] Format is consistent with existing entries
- [ ] Tool name, description, and version information are complete
- [ ] Invocation examples and compliance requirements are complete
- [ ] Content consistency verification passes

#### execution-preflight-check/SKILL.md Check

- [ ] Task classification table has been updated
- [ ] "Adding New Skills" steps have been updated
- [ ] Content is consistent with skill-invocation-standard.md

### 6. Security Standards and Compliance Requirements Confirmation

- [ ] All updates comply with project security standards
- [ ] All updates comply with project compliance requirements
- [ ] No security vulnerabilities introduced
- [ ] No compliance issues introduced

---

## Standard Operating Procedure Summary

### Complete Workflow

```
User mentions "new MCP tool" or "new skill addition"
    ↓
Trigger new-asset-integrator Skill (via Qoder `Skill` tool)
    ↓
Analysis Phase
    ↓
Determine whether it is an MCP tool or a Skill
    ↓
    ├─ MCP Tool → Update mcp-tool-inventory.md + MCP_SETUP.md
    │                ↓
    │     Update keystone hash: run_in_terminal("node .qoder/scripts/mcp-tools/keystone-validate.js --hash <file>")
    │
    └─ Skill → Create `.qoder/skills/{skill-id}/SKILL.md` via `create_file`
              ↓
              Verify via Qoder `Skill("{skill-id}")` tool
              ↓
              Update skill-invocation-standard.md
              ↓
              Update execution-preflight-check/SKILL.md
    ↓
Verification Requirements
    ↓
Complete
```

---

## Related Resources

- [mcp-tool-inventory.md](.qoder/rules/rule_detail/mcp-tool-inventory.md) - MCP Tool Inventory
- [skill-invocation-standard.md](.qoder/rules/rule_detail/skill-invocation-standard.md) - Skill Invocation Standard
- [execution-preflight-check/SKILL.md](.qoder/skills/execution-preflight-check/SKILL.md) - Execution Preflight Check Skill
- [MCP_SETUP.md](MCP_SETUP.md) - MCP server configuration and setup guide

---

**Last Updated**: 2026-04-10
**Maintainer**: DevOps Team
**Version**: v1.0.0
