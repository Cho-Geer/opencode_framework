---
type: model_decision
description: When orchestrating agents
---

# Skill Invocation Standardization Specification

## Overview

This document defines the standardized Skill invocation process for executing tasks in Trae IDE, ensuring that each task correctly and completely invokes relevant Skills, improving task execution quality and consistency.

**Created**: 2026-04-09  
**Last Updated**: 2026-05-21  
**Applicable Scope**: All tasks executed in Trae IDE  
**Version**: v2.1.5 (Deprecated nextjs-router-guardrails → fullstack-ci-cd-guardrails; prisma-seed-cicd renamed to cicd-database-seeding; registered new Skill cicd-database-seeding)

---

> **Governance Foundation**: This skill invocation standard operates within the three-layer eight-role (三层八角色) multi-agent governance architecture. All skill permissions and invocation constraints are derived from role-based access control defined by this architecture.

---

## 1. Core Principles of Skill Invocation

### 1.1 Mandatory Principles (Non-Negotiable)
- **Skill-First Priority**: Before starting any task, you must first plan and invoke relevant Skills
- **No Skipping, No Omission**: Ensure all applicable Skills are invoked
- **Plan First, Execute Second**: First list the planned Skill call list, obtain confirmation, then execute
- **Register New Skills**: When adding new Skills, this document must be updated

### 1.2 Quality Assurance Principles
- **Invoke in Priority Order**: Invoke foundational Skills first, then specialized Skills
- **Each Skill Has a Clear Purpose**: Know clearly what each Skill provides when invoking it
- **When in Doubt, Invoke More**: When uncertain whether a Skill is needed, prefer invoking over skipping

### 1.3 Extensibility Principles
- **Categorized Registration**: All Skills must be registered by category in this document
- **Complete Metadata**: Each Skill must provide complete metadata (see below)
- **Backward Compatible**: Adding new Skills must not affect existing Skill usage
- **Easy to Extend**: Provide clear addition guidelines and templates

---

## 2. Skill Classification System

### 2.1 Skill Category Definitions

Skills are classified by function into the following categories; new Skills must be categorized when added:

| Category | Category Description | Priority Range | Example Skills |
|------|---------|-----------|----------|
| **P0 - Foundation Check** | Pre-checks for all tasks, must invoke | P0 | execution-preflight-check |
| **P1 - Domain Professional** | Professional guidance for specific technical domains | P1 | devops-ci-cd-guardrails, cross-directory-ci, context7-first |
| **P1 - Analysis & Design** | Requirement analysis, solution design, root cause analysis | P1 | brainstorming |
| **P2 - Tech Stack** | Specialized support for specific tech stacks | P2 | ~~salesforce-dx-expert (❌deprecated)~~, ~~playwright-mcp-expert (❌deprecated)~~, ~~devops-architect (❌deprecated)~~, learning-mode-executor |
| **P2 - Tool Creation** | Support for creating new tools and Skills | P2 | skill-creator |

### 2.2 Skill Metadata Specification

Each Skill must provide the following metadata, registered in this document:

```yaml
skill_name: skill-id  # Skill's unique identifier, corresponding filename is {skill-id}.md or {skill-id}/SKILL.md
display_name: Display Name  # User-friendly display name
category: Category  # Choose from 2.1: P0-Foundation Check / P1-Domain Professional / P1-Analysis & Design / P2-Tech Stack / P2-Tool Creation
description: Brief description  # 1-2 sentences describing the Skill's purpose
trigger_keywords:  # Trigger keyword list
  - keyword1
  - keyword2
use_cases:  # Applicable scenario list
  - scenario1
  - scenario2
priority: P0/P1/P2  # Invocation priority
core_features:  # Core feature list
  - feature1
  - feature2
always_first: false  # Whether always invoked first (only execution-preflight-check is true)
status: active/deprecated  # Skill status
added_date: YYYY-MM-DD  # Date added
added_by: identifier  # Added by
```

---

## 3. Registered Skill Inventory

### 3.1 Skill Registration Table

| Display Name | Skill ID | Category | Trigger Keywords | Priority | Status | Date Added |
|---------|----------|------|-----------|--------|------|---------|
| Execution Preflight Check | execution-preflight-check | P0-Foundation Check | all tasks, preflight check, rule compliance | P0 | ✅ Active | 2026-04-09 |
| DevOps CI/CD Protection | devops-ci-cd-guardrails | P1-Domain Professional | CI, CD, workflow, GitHub Actions, Docker, compose, deploy, E2E, image, deployment | P1 | ✅ Active | 2026-04-09 |
| Cross-Directory CI Guidance | cross-directory-ci | P1-Domain Professional | working-directory, path, CWD, subdirectory, monorepo, checkout multiple repos, path resolution | P1 | ✅ Active | 2026-04-09 |
| Global CI/CD Practices Enforcement | global-cicd-practices-enforcement | P1-Domain Professional | CI/CD, pipeline, best practices, enforcement, DORA, quality gate, secret management | P1 | ✅ Active | 2026-04-09 |
| Prisma Seed CI/CD Execution | prisma-seed-cicd | P1-Domain Professional | Prisma, seed, ts-node, Cannot find module, database seeding, CI/CD | P1 | ❌ Deprecated | 2026-04-09 |
| CI/CD Database Seeding | cicd-database-seeding | P1-Domain Professional | database, seeding, Prisma, SQL, seed, CI/CD, db seed, database seeding | P1 | ✅ Active | 2026-05-21 |
| Next.js Router Guards | nextjs-router-guardrails | P1-Domain Professional | ~~Next.js, router, middleware, authentication, guard, withAuth, withAdmin, routing~~ | P1 | ❌ Deprecated | 2026-04-09 |
| Fullstack CI/CD Standard | fullstack-ci-cd-guardrails | P1-Domain Professional | Docker, GitHub Actions, image build, deployment verification, fullstack project | P1 | ✅ Active | 2026-04-10 |
| Spreadsheet Processor | spreadsheet-processor | P1-Domain Professional | wps, table, excel, wps table, spreadsheet, spreadsheet | P1 | ✅ Active | 2026-04-10 |
| New Asset Integrator | new-asset-integrator | P1-Domain Professional | new MCP tool, new skill addition, new MCP tool, new skill addition | P1 | ✅ Active | 2026-04-10 |
| Brainstorming Analysis | brainstorming | P1-Analysis & Design | analysis, investigation, why, how, solution, design, root cause, ambiguous requirements | P1 | ✅ Active | 2026-04-09 |
| Multi-Agent Orchestration | multi-agent-orchestration | P1-Analysis & Design | multi-agent pattern, multi-agent, full lifecycle development | P1 | ✅ Active | 2026-04-15 |
| Context7 First | context7-first | P1-Domain Professional | development, code, implementation, tech stack, library, framework, debugging | P1 | ✅ Active | 2026-04-09 |
| DevOps Architect | devops-architect | P2-Tech Stack | pipeline, GitOps, Kubernetes, cloud, architecture, containerization, cloud infrastructure | P2 | ❌ Deprecated | 2026-04-09 |
| Salesforce DX Expert | salesforce-dx-expert | P2-Tech Stack | Salesforce, Apex, LWC, Flow, SOQL | P2 | ❌ Deprecated | 2026-04-09 |
| Playwright MCP Expert | playwright-mcp-expert | P2-Tech Stack | Playwright, browser, automation, UI test | P2 | ❌ Deprecated | 2026-04-09 |
| Skill Creator | skill-creator | P2-Tool Creation | create skill, new skill | P2 | ✅ Active | 2026-04-09 |
| Learning Mode Executor | learning-mode-executor | P2-Tech Stack | /learn, learning mode | P2 | ✅ Active | 2026-04-23 |
| Auto-Commit Assistant | auto-commit | P1-Domain Professional | Write, Edit, file modification, commit, commit, git commit, TDD commit, state transition | P1 | ✅ Active | 2026-04-21 |

---

## 4. Detailed Metadata for Each Skill

### 4.1 execution-preflight-check

```yaml
skill_name: execution-preflight-check
display_name: Execution Preflight Check
category: P0-Foundation Check
description: Mandatory preflight check for all tasks; validates rule compliance, MCP readiness, and Skill invocation requirements
trigger_keywords:
  - all tasks
  - preflight check
  - rule compliance
  - MCP readiness
use_cases:
  - Preflight check before any task starts
  - Rule compliance verification
  - MCP call plan formulation
priority: P0
core_features:
  - Rule compliance verification
  - MCP call strategy planning
  - Related Skill identification
  - TodoWrite tracking initialization
always_first: true
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.2 devops-ci-cd-guardrails

```yaml
skill_name: devops-ci-cd-guardrails
display_name: DevOps CI/CD Protection
category: P1-Domain Professional
description: Dedicated guardrails for DevOps/CI/CD tasks, ensuring deployment reliability, traceability, and contract consistency
trigger_keywords:
  - CI
  - CD
  - workflow
  - GitHub Actions
  - Docker
  - compose
  - deploy
  - E2E
  - image
  - deployment
  - migration
  - rollback
  - release
use_cases:
  - CI/CD pipeline configuration and optimization
  - Container image build and management
  - Deployment process design and execution
  - Cross-repository dependency management
  - Environment variable management and security
priority: P1
core_features:
  - Verify deployment contracts
  - Ensure migrations use correct images
  - Check cross-repo E2E version awareness
  - Review deploy as production code
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.3 cross-directory-ci

```yaml
skill_name: cross-directory-ci
display_name: Cross-Directory CI Guidance
category: P1-Domain Professional
description: Cross-directory CI script execution guidance; avoids and debugs CI/CD failures caused by incorrect CWD
trigger_keywords:
  - working-directory
  - path
  - CWD
  - subdirectory
  - monorepo
  - checkout multiple repos
  - path resolution
  - Cannot find module
  - No such file or directory
use_cases:
  - Multi-repository CI/CD configuration
  - Monorepo project CI
  - Path-related error debugging
  - CI step CWD configuration
priority: P1
core_features:
  - Explicit working directory check
  - Shell context isolation
  - Tool's own working directory logic
  - Environment file loading
  - Binary/executable resolution
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.4 global-cicd-practices-enforcement

```yaml
skill_name: global-cicd-practices-enforcement
display_name: Global CI/CD Practices Enforcement
category: P1-Domain Professional
description: Enforces global best practices in CI/CD pipeline design, defining strict, non-negotiable rules

trigger_keywords:
  - CI/CD
  - pipeline
  - best practices
  - enforcement
  - DORA
  - quality gate
  - secret management
  - pipeline bloat
  - environment drift
  - toolchain consolidation

use_cases:
  - CI/CD pipeline design and review
  - CI/CD configuration generation and validation
  - Pipeline quality assessment and optimization
  - Security compliance checks

priority: P1

core_features:
  - Clear CI/CD boundary definitions
  - Mandatory pre-merge quality gates
  - Toolchain consolidation requirements
  - Environment drift prevention
  - Secret management zero-tolerance
  - Observability metric export
  - Pipeline bloat prevention

always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.5 prisma-seed-cicd

```yaml
skill_name: prisma-seed-cicd
display_name: Prisma Seed CI/CD Execution
category: P1-Domain Professional
description: Correctly execute Prisma seed scripts in CI/CD environments, preventing 'Cannot find module' errors

trigger_keywords:
  - Prisma
  - seed
  - ts-node
  - Cannot find module
  - database seeding
  - CI/CD
  - db seed
  - prisma:seed

use_cases:
  - Database initialization in CI/CD pipelines
  - Seed script execution for frontend-backend separated projects
  - TypeScript seed file execution
  - Resolving ts-node path resolution issues

priority: P1

core_features:
  - Use Prisma built-in seed command
  - Explicitly specify tsconfig.json path
  - Avoid incorrect working directory configuration
  - Debugging checklist
  - Best practice execution

always_first: false
status: deprecated
deprecated_date: 2026-05-21
deprecated_reason: Renamed to cicd-database-seeding for improved generality; original Skill expanded into a generic CI/CD database seeding framework, Prisma is only Section 2 specialized content (@Architect UNIV-P4-H)
replaced_by: cicd-database-seeding
added_date: 2026-04-09
added_by: system
```

---

### 4.5b cicd-database-seeding

```yaml
skill_name: cicd-database-seeding
display_name: CI/CD Database Seeding
category: P1-Domain Professional
description: Generic CI/CD database seeding framework supporting multiple ORMs and database connection seed script execution and troubleshooting
trigger_keywords:
  - database
  - seeding
  - Prisma
  - SQL
  - seed
  - CI/CD
  - db seed
  - database seeding
  - migration seed
use_cases:
  - Database initialization and seeding in CI/CD pipelines
  - Seed script execution for multiple ORMs (Prisma, TypeORM, Sequelize)
  - Database connection and path resolution troubleshooting
  - Seed script execution for frontend-backend separated projects
priority: P1
core_features:
  - Generic CI/CD seeding architecture (Section 2)
  - Prisma specialized seeding execution (Section 1)
  - Multi-ORM support framework
  - Database connection verification
  - Debugging checklist
always_first: false
status: active
added_date: 2026-05-21
added_by: system
```

---

### 4.6 nextjs-router-guardrails

```yaml
skill_name: nextjs-router-guardrails
display_name: Next.js Router Guards
category: P1-Domain Professional
description: Enforces Next.js router guards and authentication best practices, ensuring secure route protection (⚠️ Deprecated; generic route security principles extracted to fullstack-ci-cd-guardrails)
trigger_keywords:
  - Next.js
  - nextjs
  - next.js
  - Nextjs
  - router
  - middleware
  - authentication
  - guard
  - withAuth
  - withAdmin
  - routing
  - evaluation
  - analysis
  - investigation
  - design
  - troubleshooting
  - issue investigation
use_cases:
  - Next.js route protection implementation
  - Authentication guard configuration
  - Middleware security header setup
  - Route permission management
  - Next.js code evaluation
  - Next.js project analysis
  - Next.js routing issue investigation
  - Next.js routing design
  - Next.js routing troubleshooting
priority: P1
core_features:
  - Three-layer protection strategy (Edge layer, Page layer, API layer)
  - Middleware implementation standards
  - Higher-Order Component (HOC) standards
  - Security header configuration
  - Special scenario handling (CSRF, role changes, account disabling)
always_first: false
status: deprecated
deprecated_date: 2026-05-21
deprecated_reason: Next.js-specific router guards deprecated; generic route security principles extracted to fullstack-ci-cd-guardrails, Next.js framework-specific code retained as reference appendix (@Architect UNIV-P4-I)
replaced_by: fullstack-ci-cd-guardrails
added_date: 2026-04-09
added_by: system
```

---

### 4.7 fullstack-ci-cd-guardrails

```yaml
skill_name: fullstack-ci-cd-guardrails
display_name: Fullstack CI/CD Standard
category: P1-Domain Professional
description: Enforces fullstack project CI/CD standards and issue defense guidelines, targeting Docker and GitHub Actions workflows
trigger_keywords:
  - Docker
  - docker
  - GitHub Actions
  - github actions
  - workflow
  - workflows
  - image build
  - image build
  - deployment verification
  - deployment verify
  - fullstack project
  - fullstack
  - fullstack
  - next.js
  - Next.js
  - nestjs
  - NestJS
  - prisma
  - Prisma
use_cases:
  - Fullstack project CI/CD pipeline design
  - Docker image build and push
  - GitHub Actions workflow configuration
  - Deployment verification workflow implementation
  - Next.js + NestJS + Docker projects
priority: P1
core_features:
  - Unified variable management standards
  - Tag immutability-first strategy
  - Environment isolation best practices
  - Test authenticity requirements
  - Workflow robustness assurance
  - Image build workflow standards
  - Deployment verification workflow standards
  - Frontend-specific standards (Next.js)
  - Backend-specific standards (NestJS + Prisma)
always_first: false
status: active
added_date: 2026-04-10
added_by: system
```

---

### 4.8 spreadsheet-processor

```yaml
skill_name: spreadsheet-processor
display_name: Spreadsheet Processor
category: P1-Domain Professional
description: Parse and process various spreadsheet file formats including Excel, WPS, CSV, OpenDocument, etc.
trigger_keywords:
  - wps
  - table
  - excel
  - wps table
  - spreadsheet
  - spreadsheet
  - xls
  - xlsx
  - xlsm
  - xlsb
  - csv
  - ods
  - et
  - dbf
  - accdb
  - mdb
  - prn
  - tsv
  - numbers
use_cases:
  - Spreadsheet file reading and parsing
  - Excel/WPS file processing
  - CSV data import/export
  - Table data transformation
  - Spreadsheet format conversion
priority: P1
core_features:
  - File format identification
  - Data reading and parsing
  - Data operations (filter, sort, transform, aggregate)
  - File writing and export
  - Excel MCP tool integration
always_first: false
status: active
added_date: 2026-04-10
added_by: system
```

---

### 4.9 new-asset-integrator

```yaml
skill_name: new-asset-integrator
display_name: New Asset Integrator
category: P1-Domain Professional
description: Standardized processing of new MCP tool and Skill addition workflows, ensuring all operations comply with project standards and technical specifications
trigger_keywords:
  - new MCP tool
  - new skill addition
  - new MCP tool
  - new skill addition
  - add MCP tool
  - add new skill
  - new MCP tool
  - new skill
use_cases:
  - New MCP tool integration
  - New Skill addition
  - Asset integration process management
  - Documentation update management
priority: P1
core_features:
  - Functional analysis phase management
  - MCP tool update process
  - Skill update process
  - Verification requirements management
  - Documentation completeness check
always_first: false
status: active
added_date: 2026-04-10
added_by: system
```

---

### 4.10 brainstorming

```yaml
skill_name: brainstorming
display_name: Brainstorming Analysis
category: P1-Analysis & Design
description: Transform ambiguous ideas into clear, actionable designs
trigger_keywords:
  - analysis
  - investigation
  - why
  - how
  - solution
  - design
  - root cause
  - ambiguous requirements
  - architecture discussion
use_cases:
  - Requirement analysis and clarification
  - Solution design and evaluation
  - Problem root cause analysis
  - Architecture discussion and decision-making
priority: P1
core_features:
  - Input pattern understanding
  - Context gathering
  - Asking clarification questions
  - Proposing approaches
  - Recommending methods
  - Creating design documents
  - Question content comprehension and summarization
  - Structured output summarization
  - Confirmation feedback processing mechanism
  - Task flow control
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.10b multi-agent-orchestration

```yaml
skill_name: multi-agent-orchestration
display_name: Multi-Agent Orchestration
category: P1-Analysis & Design
description: Triggers and orchestrates the three-layer eight-role multi-agent system for complex full-lifecycle development tasks. Auto-verifies AGENTS.md alignment, checks 8 Agent configurations, and starts the standard multi-agent workflow.
trigger_keywords:
  - multi-agent pattern
  - multi-agent
  - full lifecycle development
  - multi-role collaboration
  - TDD flow
  - contract-driven development
use_cases:
  - User triggers "multi-agent pattern"
  - Complex full-lifecycle development tasks
  - Large features requiring multi-role collaboration
  - Standard development flow following TDD + contract-driven development
priority: P1
core_features:
  - AGENTS.md existence and content verification
  - 9 Agent configuration file completeness check
  - AGENTS.md alignment with actual Agent files verification
  - Standard multi-agent workflow launch
  - TDD mandatory discipline enforcement
  - Quality gates and closed-loop feedback
always_first: false
status: active
added_date: 2026-04-15
added_by: system
```

---

### 4.11 context7-first

```yaml
skill_name: context7-first
display_name: Context7 First
category: P1-Domain Professional
description: Before any investigation, design, coding, debugging, or architecture task, first invoke Context7 MCP tools to get the latest tech stack documentation and context
trigger_keywords:
  - development
  - code
  - implementation
  - tech stack
  - library
  - framework
  - debugging
  - dependency management
use_cases:
  - Code development tasks
  - Tech stack usage consultation
  - Debug issue analysis
  - Dependency management
priority: P1
core_features:
  - Get latest tech stack documentation
  - Provide codebase context
  - Analyze tech stack usage
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.11 devops-architect

```yaml
skill_name: devops-architect
display_name: DevOps Architect
category: P2-Tech Stack
description: CI/CD pipeline design, GitOps workflows, containerized applications, cloud-native infrastructure architecture design
trigger_keywords:
  - pipeline
  - GitOps
  - Kubernetes
  - cloud
  - architecture
  - containerization
  - cloud infrastructure
use_cases:
  - CI/CD pipeline design
  - GitOps workflow implementation
  - Kubernetes deployment architecture
  - Cloud-native infrastructure design
priority: P2
core_features:
  - CI/CD pipeline architecture design
  - GitOps workflow configuration
  - Containerization best practices
  - Cloud infrastructure architecture
always_first: false
status: deprecated
deprecated_date: 2026-05-18
deprecated_reason: Draft stub (19 lines of boilerplate), never actually developed; functionality fully replaced by active devops-ci-cd-guardrails (P1) (@Arbiter UNIV-013 audit TD-2026-007-DEPR)
replaced_by: devops-ci-cd-guardrails
added_date: 2026-04-09
added_by: system
```

---

### 4.12 salesforce-dx-expert

```yaml
skill_name: salesforce-dx-expert
display_name: Salesforce DX Expert
category: P2-Tech Stack
description: Salesforce DX project architecture design, Apex/LWC development, CI/CD pipeline setup, deployment troubleshooting
trigger_keywords:
  - Salesforce
  - Apex
  - LWC
  - Flow
  - SOQL
use_cases:
  - Salesforce project development
  - Apex/LWC component development
  - Salesforce deployment
  - Salesforce CI/CD configuration
priority: P2
core_features:
  - Salesforce DX project guidance
  - Apex/LWC development best practices
  - Deployment troubleshooting
  - CI/CD pipeline setup
always_first: false
status: deprecated
deprecated_date: 2026-05-18
deprecated_reason: Draft stub (19 lines of boilerplate), never actually developed since creation on 2026-04-23; no agent references, not in available_skills (@Arbiter UNIV-013 audit TD-2026-005-DEPR)
replaced_by: No direct replacement Skill available; create a new dedicated Skill if Salesforce functionality is needed
added_date: 2026-04-09
added_by: system
```

---

### 4.13 playwright-mcp-expert

```yaml
skill_name: playwright-mcp-expert
display_name: Playwright MCP Expert
category: P2-Tech Stack
description: Playwright MCP Server configuration, LLM browser automation, connection troubleshooting, element locator strategy optimization
trigger_keywords:
  - Playwright
  - browser
  - automation
  - UI test
use_cases:
  - Playwright browser automation
  - UI test configuration
  - Browser automation debugging
priority: P2
core_features:
  - Playwright MCP Server configuration
  - LLM browser automation guidance
  - Connection troubleshooting
  - Element locator strategy optimization
always_first: false
status: deprecated
deprecated_date: 2026-05-18
deprecated_reason: Draft stub (19 lines of boilerplate), never actually developed; system has built-in native Playwright MCP tools (playwright_browser_* series), this Skill is completely redundant (@Arbiter UNIV-013 audit TD-2026-006-DEPR)
replaced_by: Native Playwright MCP tools (playwright_browser_navigate, etc.)
added_date: 2026-04-09
added_by: system
```

---

### 4.14 skill-creator

```yaml
skill_name: skill-creator
display_name: Skill Creator
category: P2-Tool Creation
description: Mandatory tool for creating new Skills; used to add new Skills to the system
trigger_keywords:
  - create skill
  - new skill
  - add skill
use_cases:
  - Create new Skills
  - Extend Skill library
priority: P2
core_features:
  - Skill creation guidance
  - Skill template generation
  - Skill documentation standardization
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.15b learning-mode-executor

```yaml
skill_name: learning-mode-executor
display_name: Learning Mode Executor
category: P2-Tech Stack
description: Transforms single Q&A into structured learning cases with planning, logging, and knowledge base integration. Invoke when user enters /learn command.
trigger_keywords:
  - /learn
  - learning mode
use_cases:
  - Transform single Q&A into structured learning cases
  - Systematic research on Agent Harness Engineering
priority: P2
core_features:
  - Planning and materialization
  - Execution and log injection
  - Summarization and closure
always_first: false
status: active
added_date: 2026-04-23
added_by: system
```

---
### 4.15 auto-commit

```yaml
skill_name: auto-commit
display_name: Auto-Commit Assistant
category: P1-Domain Professional
description: After each Write/Edit operation, proactively asks the user whether to immediately commit, and auto-generates TDD-compliant commit messages based on machine.json state and pre-commit hook constraints
trigger_keywords:
  - Write
  - Edit
  - file modification
  - commit
  - commit
  - git commit
  - TDD commit
  - state transition
use_cases:
  - Interactive commit after file modification
  - TDD state-aware commit message generation
  - Evidence chain pre-validation (simulates pre-commit hook)
  - Illegal commit interception (non-test files in Red phase, missing evidence files, etc.)
priority: P1
core_features:
  - File modification detection and prompting
  - TDD state-aware commit message generation
  - Evidence chain pre-validation (machine.json + pre-commit hook rules)
  - Interactive commit confirmation
  - Negative test interception (illegal state transitions, missing evidence files, etc.)
always_first: false
status: active
added_date: 2026-04-21
added_by: system
```

---

## 5. Standardized Execution Process

### 5.1 Pre-Task Planning Phase (Mandatory)

```
Step 1: Understand user request
   ↓
Step 2: Consult this document's "Registered Skill Inventory"
   ↓
Step 3: Identify task type and keywords, match trigger keywords
   ↓
Step 4: Create "Planned Skill Call List" (use 5.2 template)
   ↓
Step 5: Present list to user and obtain confirmation
   ↓
Step 6: Invoke Skills in priority order (P0 → P1 → P2)
```

### 5.2 Planned Skill Call List Template

After the user submits a task, first output the following:

```markdown
## 📋 Planned Skill Call List

Based on task analysis and the Skill registration inventory, I plan to invoke the following Skills:

| # | Skill Name | Skill ID | Invocation Purpose |
|------|----------|----------|---------|
| 1 | Skill1 | skill-id-1 | Purpose 1 |
| 2 | Skill2 | skill-id-2 | Purpose 2 |

**Proceeding after confirmation.**
```

### 5.3 Quick Check List

When planning Skills, quickly cross-reference the following checklist:

```
📋 Pre-Task Quick Check:
[ ] Have you consulted the "Registered Skill Inventory"?
[ ] Is this a DevOps/CI/CD task? → devops-ci-cd-guardrails
[ ] Involves multiple directories/repos? → cross-directory-ci
[ ] Need to analyze root cause? → brainstorming
[ ] Need to write code? → context7-first
[ ] ~~Is it a Salesforce project? → salesforce-dx-expert (❌ Deprecated)~~
[ ] ~~Involves Playwright? → playwright-mcp-expert (❌ Deprecated, use native playwright_browser_* tools)~~
[ ] Involves DevOps architecture? → Use devops-ci-cd-guardrails (❌ devops-architect deprecated)
[ ] Involves Next.js routing? → Use fullstack-ci-cd-guardrails (❌ nextjs-router-guardrails deprecated)
[ ] Need database seeding? → cicd-database-seeding (❌ prisma-seed-cicd deprecated)
[ ] Any other matching Skills? (consult table 3.1)
```

---

## 6. Common Task Skill Combination Recommendations

### 6.1 CI/CD Issue Analysis

```
1. Consult .qoder/rules/rule_detail/skill-invocation-standard.md (mandatory)
2. fullstack-ci-cd-guardrails (P1) - Enforce fullstack CI/CD standards
3. global-cicd-practices-enforcement (P1) - Enforce global best practices
4. devops-ci-cd-guardrails (P1)
5. cross-directory-ci (P1) - If involving multiple directories/repos
6. brainstorming (P1)
```

### 6.2 Code Development Task

```
1. Consult .qoder/rules/rule_detail/skill-invocation-standard.md (mandatory)
2. context7-first (P1)
3. brainstorming (P1) - If design is needed
```

### 6.5 Code Evaluation Task

```
1. Consult .qoder/rules/rule_detail/skill-invocation-standard.md (mandatory)
2. context7-first (P1)
3. brainstorming (P1) - Analyze code structure and issues
4. nextjs-router-guardrails (P1) - If it's a Next.js project, analyze routing and auth implementation
```

### 6.3 Requirement Analysis & Solution Design

```
1. Consult .qoder/rules/rule_detail/skill-invocation-standard.md (mandatory)
2. brainstorming (P1)
3. Other related Skills (consult table 3.1 by specific domain)
```

### 6.4 Cross-Repository E2E Issues

```
1. Consult .qoder/rules/rule_detail/skill-invocation-standard.md (mandatory)
2. devops-ci-cd-guardrails (P1)
3. cross-directory-ci (P1)
4. brainstorming (P1)
```

### 6.6 Post-File-Modification Commit

```
1. Consult .qoder/rules/rule_detail/skill-invocation-standard.md (mandatory)
2. auto-commit (P1) - Interactive commit and evidence chain validation
3. execution-preflight-check (P0) - Preflight rule check (if applicable)
```

---

## 7. Skill Execution Completeness Specification

### 7.1 Core Principles
- **Completeness Principle**: After invoking any Skill, its documented core workflow must be fully executed
- **User Interaction Respect**: For Skills containing user confirmation or feedback loops, you must wait for user response before continuing
- **Core Feature Check**: Must verify whether the Skill's core features have been executed

### 7.2 Skill Execution Checklist
After each Skill invocation, the following must be verified:

| Check Item | Description | Example |
|--------|------|------|
| [ ] Core workflow execution | Were the core workflow steps defined in the Skill document executed? | brainstorming's "content analysis → structured output → wait for confirmation" |
| [ ] User interaction complete | Is user confirmation/feedback needed? Has it been obtained? | brainstorming's key point confirmation |
| [ ] Core feature verification | Was the Skill's primary purpose achieved? | brainstorming's "ambiguous requirement clarification" |
| [ ] Output quality check | Does the Skill output meet expected format and quality? | brainstorming's structured summary |

### 7.3 TodoWrite Tracking Requirements
TodoWrite must create dedicated task items for each Skill invocation, including:
- Skill execution status tracking (start → core steps → user interaction → complete)
- Core workflow step checklist
- User confirmation wait status (if applicable)

### 7.4 Violation Handling
- **Partial execution**: Considered a violation; must rollback to pre-Skill state and re-execute
- **Skipped user interaction**: Forced pause; complete user confirmation flow before continuing
- **Missing core features**: Mark task as "Skill execution incomplete"; re-plan execution

### 7.5 Updated Execution Process (Modifying existing 5.1)
```
Step 6: Invoke Skills in priority order (P0 → P1 → P2)
   ↓
Step 7: Execute Skill core workflow, wait for necessary user interaction
   ↓
Step 8: Verify Skill execution completeness (use 7.2 checklist)
   ↓
Step 9: Mark Skill execution status as "complete" or "incomplete"
   ↓
Step 10: Only proceed with subsequent tasks when all Skills are marked "complete"
```

### 7.6 Universal Requirements for All Skills
This specification applies to all registered Skills, especially:
- **brainstorming**: Must execute key point summarization → structured output → wait for confirmation
- **context7-first**: Must complete Context7 query and apply results
- **devops-ci-cd-guardrails**: Must execute complete CI/CD rule check
- **All other Skills**: Must execute their documented core features

### 7.7 Implementation Suggestions
1. Immediately add this specification to `skill-invocation-standard.md`
2. Update the task classification table in `execution-preflight-check/SKILL.md`
3. Before the next task, present the updated Skill invocation plan explicitly including "execution completeness check"

---

## 8. Adding New Skills Guide

### 8.1 Prerequisites

Before adding a new Skill, the following must be met:

- [ ] New Skill created in the `.qoder/skills/` directory
- [ ] Skill file naming convention: `{skill-id}.md` or `{skill-id}/SKILL.md`
- [ ] Skill has a clear description and trigger conditions
- [ ] Skill has been tested and is functional

### 8.2 Addition Steps

#### Step 1: Prepare Skill Metadata

Use the following template to prepare the new Skill's metadata:

```yaml
skill_name: your-new-skill-id
display_name: New Skill Display Name
category: Choose category  # P0-Foundation Check / P1-Domain Professional / P1-Analysis & Design / P2-Tech Stack / P2-Tool Creation
description: Brief description, 1-2 sentences
trigger_keywords:
  - keyword1
  - keyword2
  - keyword3
use_cases:
  - Applicable scenario 1
  - Applicable scenario 2
priority: P0/P1/P2
core_features:
  - Core feature 1
  - Core feature 2
always_first: false  # Only execution-preflight-check is true
status: active
added_date: YYYY-MM-DD
added_by: identifier
```

#### Step 2: Update Related Documents

Update documents in the following order:

1. **Add a row in Section 3.1 "Skill Registration Table"**
2. **Add complete metadata YAML block in Section 4 "Detailed Metadata for Each Skill"**
3. **Update the task classification table in execution-preflight-check/SKILL.md**
4. **Update the new skill addition steps in execution-preflight-check/SKILL.md**
5. **Optionally add relevant combinations in Section 6 "Common Task Skill Combination Recommendations" (if applicable)**
6. **Optionally add cases in Section 9 "Case Studies" (if applicable)**

#### Step 3: Verify Updates

- [ ] Metadata format correct
- [ ] Category selection reasonable
- [ ] Trigger keywords clear
- [ ] Display name user-friendly
- [ ] Date format correct (YYYY-MM-DD)

### 8.3 Skill Deprecation Guide

To deprecate a Skill:

1. Change "Status" in the Section 3.1 table to `❌ Deprecated`
2. Set `status: deprecated` in Section 4 metadata
3. Add `deprecated_date: YYYY-MM-DD` and `deprecated_reason: deprecation reason`
4. Add replacement Skill suggestion in metadata (if available)
5. **Do not delete** the Skill's metadata record; preserve historical records

---

## 9. Case Studies

### Case: Frontend CI Prisma Seed Failure Analysis

**User Request**:
&gt; Analyze the error reported by booking-frontend during Github Action CI execution... investigate the cause, don't modify code.

**Correct Skill Invocation Order**:

1. Consult skill-invocation-standard.md (mandatory)
2. devops-ci-cd-guardrails (P1)
3. cross-directory-ci (P1)
4. brainstorming (P1)

| # | Skill Name | Skill ID | Invocation Reason |
|------|----------|----------|---------|
| 1 | DevOps CI/CD Protection | devops-ci-cd-guardrails | Involves GitHub Actions, CI/CD, cross-repo E2E |
| 2 | Cross-Directory CI Guidance | cross-directory-ci | Involves checkout of multiple repos, path resolution |
| 3 | Brainstorming Analysis | brainstorming | Need to analyze problem root cause |

**Omission Analysis**:
- Actually omitted `cross-directory-ci`
- Although the branch merge issue was ultimately analyzed, cross-directory-ci could have provided a more systematic diagnostic process

---

## 10. Quality Assurance & Continuous Improvement

### 10.1 Post-Execution Review

After each task completion, conduct the following review:

```
📋 Post-Execution Review:
[ ] Were all Skills that should have been invoked actually invoked?
[ ] Was the Skill invocation order reasonable (P0→P1→P2)?
[ ] Does this document need updating (new Skills, new trigger keywords, etc.)?
[ ] Can Skill planning be improved for next time?
[ ] Record lessons learned in this document
```

### 10.2 Documentation Update Triggers

Related documents must be updated in the following situations:

- [ ] When adding new Skills (must use skill-creator Skill)
  - Must update `skill-invocation-standard.md` (registration table, metadata)
  - Must update `execution-preflight-check/SKILL.md` (task classification table, new skill addition steps)
- [ ] When Skill trigger keywords need updating
  - Must update `skill-invocation-standard.md`
  - Must update the task classification table in `execution-preflight-check/SKILL.md`
- [ ] When new Skill combination patterns are discovered
- [ ] When Skill status changes (active → deprecated)
- [ ] When case studies need additions

### 10.3 Document Version Management

- This document uses semantic versioning (vMAJOR.MINOR.PATCH)
- MAJOR: Major framework changes
- MINOR: New Skill categories, major process changes
- PATCH: Adding new Skills, updating metadata, minor fixes
- Each update is recorded with version number and update date in the "Overview" section

---

## 11. Summary

The core objectives of this document are:

1. **Standardization**: Establish a unified Skill invocation process
2. **Transparency**: Present plans before tasks, allowing user supervision
3. **Quality**: Ensure all relevant Skills are invoked
4. **High Extensibility**: Easily add new Skills through the classification system and registration mechanism
5. **High Universality**: Not dependent on specific Skills; applies to all future Skills
6. **High Constraint**: Mandatory registration, complete metadata, standardized process

**Remember**:
- First consult `.qoder/rules/rule_detail/skill-invocation-standard.md` — this is the first step for all tasks
- Plan first, execute second
- When in doubt, invoke more Skills rather than fewer
- When adding new Skills, must use skill-creator Skill and update this document
- All Skills must be registered in this document

### Skill Call Violation Prevention Patterns
1. **Plan before execute**: Before starting any task, you must first present the Skill call plan
2. **Consult .qoder/rules/rule_detail/skill-invocation-standard.md first**: This is the first step for all tasks, no exceptions
3. **Skills must be registered**: All Skills must be registered in `.qoder/rules/rule_detail/skill-invocation-standard.md`
4. **Transparent supervision**: Present plans before tasks, allowing user supervision

---

## Appendix A: Skill File Locations

All Skill files are located at:
- `.qoder/skills/{skill-id}.md` - Single-file Skills
- `.qoder/skills/{skill-id}/SKILL.md` - Directory-based Skills

---

*This document will be continuously updated and refined based on actual usage experience.*

