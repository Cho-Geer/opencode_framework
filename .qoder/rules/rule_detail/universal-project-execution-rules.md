---
type: always
description: Core execution framework
---
# Universal Project Execution Rules Framework v3.0 (MCP Enforcement Enhanced Edition)

## 📖 Document Overview

This framework provides a layered, extensible project execution rules system, **with special emphasis on the mandatory and non-optional nature of MCP tool calls**. Core design philosophy:

- **MCP Absolute Mandate**: All technical decisions must be based on the latest information obtained via MCP
- **Universality Principle**: Base rules apply to all project types; tech stacks are extensible
- **Verification-Driven Execution**: Checklist-driven; critical items are blocking checks
- **Transparent Traceability**: Complete recording of MCP calls and decision rationale

## 🎯 Core Principles (MCP Enhanced)

### 0. Compliance Gate Absolute Mandate (New — Highest Priority)

> **All** tasks must execute in sequence: `compliance_gate_check(task_description)` → Present plan and wait for user confirmation → `compliance_gate_confirm(plan_summary)`. Until the compliance gate is armed (gate not armed), entry into **any** analysis, design, or coding phase is **strictly prohibited**. This check is P0-level blocking and takes priority over all other MCP calls.

### 1. MCP Call Absolute Mandate

> **All** technical tasks must first call the appropriate MCP tools to obtain the latest technical guidance, version information, and best practices. Starting any design, coding, or configuration work **without** completing MCP information gathering is prohibited.

### 2. Information-First Verification Principle

> All technical decisions must have reliable basis, preferably obtained through MCP tools, secondarily using the latest official documentation. Making decisions based on outdated or assumed information is strictly prohibited.

### 3. Transparent Complete Traceability Principle

> The execution process must have complete records; MCP call outputs must be archived. Decision rationale must be traceable to specific MCP tool outputs or official documentation.

### 4. Quality Gate Assurance Principle

> Each critical step has verification checkpoints; MCP-validated quality standards must be strictly enforced. It is better to delay progress due to MCP calls than to lower quality standards.

## 📋 Universal Checklist Framework (MCP-First)

### Usage Instructions

1. **Project Initialization**: Enable corresponding extensions based on project type and tech stack
2. **MCP Call Preparation**: Determine the MCP tool list and parameters needed
3. **Blocking Execution**: Execute in checklist order; MCP call items are **blocking checks**
4. **Status Marking & Recording**: Mark items as completed; **completely record MCP outputs**
5. **Status Tracking Mandatory**: Must use task management tools (e.g., TodoWrite) to create tracking tasks for each MCP item; only when status is 'completed' and result is 'successful' or 'resolved via alternative' may you proceed to the next phase

### Base Checklist Template (MCP-Driven)

```markdown
<!-- Important: Create a TodoWrite tracking task for each MCP item; only proceed when status is completed and result is successful/resolved -->
# Project: [Project Name]
# Type: [Project Type]
# Tech Stack: [Primary Technologies]
# MCP Strategy: [MCP Tool List]

## 🚨 MCP Call Mandatory Checks (Blocking Checks)

### Environment Verification MCP
- [ ] Call environment verification tools: `node --version`, `npm --version`, `docker --version`
- [ ] Call dependency check tools: `npm outdated`, `npm audit`, `npx depcheck`
- [ ] Call documentation query tools: `context7` MCP tools to get latest official tech documentation

### Tech Stack Specific MCP
- [ ] Call framework CLI tools: Get version and compatibility information
- [ ] Call configuration verification tools: Verify project configuration meets best practices
- [ ] Call security scanning tools: Check for known security vulnerabilities

### Quality Tool MCP
- [ ] Call code quality tools: `eslint --version`, `prettier --version`
- [ ] Call test framework tools: `jest --version`, test coverage tools
- [ ] Call build verification tools: Build configuration and packaging tool checks

## ✅ Pre-Checks
- [ ] Confirm project type and tech stack
- [ ] Identify domains requiring latest information
- [ ] Determine MCP call list and execution order

## 🔄 MCP Information Gathering (Blocking)
- [ ] Execute environment verification MCP calls
- [ ] Execute tech stack specific MCP calls
- [ ] Execute quality tool MCP calls
- [ ] Collect key guidance and recommendations from MCP outputs

## 📊 MCP-Based Technical Analysis
- [ ] Analyze existing implementation gaps based on MCP information
- [ ] Identify differences from latest best practices
- [ ] Formulate solutions conforming to MCP guidance
- [ ] Assess technical debt and refactoring priorities

## 🎯 MCP-Verified Decisions
- [ ] Confirm solution meets MCP-guided technical standards
- [ ] Record decision rationale and MCP references
- [ ] Assess solution maintainability and extensibility
- [ ] Formulate MCP-based testing and verification strategy

## 📝 MCP Execution Records
- [ ] Save all MCP call commands and outputs
- [ ] Record key decisions and MCP basis
- [ ] Archive technical reference materials obtained via MCP
- [ ] Generate MCP call audit report
```

## 🔧 Technology-Specific Extensions (MCP Integrated)

### Salesforce Project Extension (Example)

#### A. Salesforce MCP Call Mandatory Checks

```markdown
### 🚨 Salesforce MCP Call Mandatory Checks (Absolute Blocking)

#### Base Authentication MCP
- [ ] Call `mcp_Salesforce_DX_get_username` to confirm org authentication configuration
- [ ] Call `mcp_Salesforce_DX_list_all_orgs` to verify org configuration status

#### Development Technical Guidance MCP
- [ ] Call `mcp_Salesforce_DX_get_mobile_lwc_offline_guidance` for LWC mobile compatibility guidance
- [ ] Call `mcp_Salesforce_DX_guide_utam_generation` for UI test automation guidance

#### Migration-Specific MCP Checks
- [ ] Call `mcp_Salesforce_DX_deploy_metadata` to understand metadata deployment best practices
- [ ] Call `mcp_Salesforce_DX_retrieve_metadata` to understand metadata retrieval strategies
- [ ] Call `mcp_Salesforce_DX_create_org_snapshot` to understand environment snapshot management
- [ ] Call `mcp_Salesforce_DX_run_soql_query` to verify data migration feasibility
```

#### B. Salesforce Migration MCP Verification Points

```markdown
### 🚀 Salesforce Migration MCP Verification Checks

#### MCP-Verified Migration Planning
- [ ] **Org Configuration MCP Verification**: Confirm source and target org configuration via MCP
- [ ] **Authentication MCP Check**: Verify username/alias availability and permissions via MCP
- [ ] **Dependency MCP Analysis**: Use MCP to identify metadata component dependencies
- [ ] **Compatibility MCP Assessment**: Evaluate API version and feature availability differences via MCP

#### MCP-Guided Metadata Migration
- [ ] **MCP-Recommended Deployment Strategy**: Choose incremental or full deployment based on MCP
- [ ] **MCP Conflict Resolution Plan**: Formulate conflict resolution process based on MCP guidance
- [ ] **MCP Rollback Plan**: Prepare rollback plan based on MCP best practices
- [ ] **MCP Deployment Order**: Determine order based on MCP-analyzed dependencies
```

### React/Next.js Project Extension

#### A. React Project MCP Checks

```markdown
### ⚛️ React Development MCP Checks

#### React Tech Stack MCP Verification
- [ ] **React Version MCP Check**: Verify React version and compatibility
- [ ] **Next.js Configuration MCP Verification**: Check Next.js configuration best practices
- [ ] **State Management MCP Guidance**: Get latest state management solution recommendations
- [ ] **Performance Optimization MCP Analysis**: Get latest performance optimization strategies

#### Code Quality MCP Checks
- [ ] **ESLint Rules MCP Verification**: Confirm ESLint rules meet latest standards
- [ ] **TypeScript Configuration MCP Check**: Verify TypeScript configuration optimization
- [ ] **Test Strategy MCP Guidance**: Get testing best practices and tool recommendations
- [ ] **Bundle Analysis MCP Tools**: Use bundle analysis tools for packaging optimization
```

### Node.js/NestJS Project Extension

#### A. Node.js Project MCP Checks

```markdown
### 🟢 Node.js Backend MCP Checks

#### Runtime MCP Verification
- [ ] **Node.js Version MCP Check**: Verify Node.js version and LTS status
- [ ] **npm/yarn Configuration MCP Verification**: Check package manager configuration best practices
- [ ] **Dependency Security MCP Scan**: Scan dependencies for security vulnerabilities
- [ ] **Performance Monitoring MCP Tools**: Verify performance monitoring tool configuration

#### NestJS-Specific MCP Checks
- [ ] **NestJS CLI MCP Verification**: Check NestJS CLI tool version and features
- [ ] **Module Structure MCP Analysis**: Verify module partitioning meets best practices
- [ ] **Dependency Injection MCP Check**: Confirm dependency injection configuration correctness
- [ ] **Middleware Pipeline MCP Verification**: Check middleware pipeline configuration optimization
```

### Database Project Extension

#### A. Database MCP Checks

```markdown
### 🗄️ Database Development MCP Checks

#### Database Client MCP Verification
- [ ] **Prisma/TypeORM Version Check**: Verify ORM tool version compatibility
- [ ] **Database Driver MCP Verification**: Check database driver version
- [ ] **Connection Pool MCP Configuration**: Verify connection pool configuration best practices
- [ ] **Migration Tool MCP Check**: Check database migration tool status

#### Query Performance MCP Analysis
- [ ] **Query Plan MCP Analysis**: Use EXPLAIN for query performance analysis
- [ ] **Index Optimization MCP Guidance**: Get index creation and optimization recommendations
- [ ] **Transaction Management MCP Check**: Verify transaction handling conforms to ACID
- [ ] **Backup Strategy MCP Verification**: Check backup and recovery strategy
```

## 🏗️ Project-Specific Customization Layer (MCP Integrated)

### Customization Method (MCP-First)

1. **Copy Base Template**: Start from the universal MCP-driven template
2. **Enable Tech Extensions**: Enable corresponding MCP extensions based on tech stack
3. **Add Project MCP Items**: Add customized MCP check items based on project needs
4. **Set MCP Blocking Levels**: Set blocking level for critical MCP items

### Example: Modern Web Fullstack Project Customization

```markdown
# Project: Modern Web Fullstack Application
# Type: React + Node.js fullstack application
# Tech Stack: TypeScript, React, Next.js, NestJS, Prisma, PostgreSQL
# MCP Strategy: Full-stack tech chain verification

## 🎯 Project-Specific MCP Check Items

### Fullstack Environment MCP Verification
- [ ] **Frontend-Backend Version Compatibility MCP Check**: Verify React and Node.js version compatibility
- [ ] **API Contract MCP Verification**: Verify OpenAPI/Swagger specification consistency
- [ ] **Development Environment MCP Configuration**: Verify Docker Compose dev environment configuration
- [ ] **CI/CD Pipeline MCP Check**: Verify GitHub Actions/GitLab CI configuration

### Data Flow MCP Verification
- [ ] **Frontend-Backend Data Type MCP Consistency**: Verify TypeScript type definition consistency
- [ ] **API Response Format MCP Standardization**: Verify API response format standardization
- [ ] **Error Handling MCP Uniformity**: Verify frontend-backend error handling mechanism consistency
- [ ] **State Sync MCP Mechanism**: Verify client state and server synchronization mechanism

### Quality Gate MCP Checks
- [ ] **End-to-End Test MCP Coverage**: Ensure E2E test coverage ≥80%
- [ ] **Performance Baseline MCP Testing**: Establish performance baseline with periodic MCP verification
- [ ] **Security Scan MCP Automation**: Automated security vulnerability MCP scanning
- [ ] **Accessibility MCP Compliance**: Ensure WCAG accessibility standard MCP verification
```

## ⚙️ MCP Implementation Mechanism Design

### 1. Dynamic MCP Checklist Generation

```python
# Conceptual implementation - MCP-driven checklist generation
def generate_mcp_checklist(project_config):
    """Generate MCP-driven checklist based on project configuration"""
    
    checklist = load_mcp_base_template()
    
    # Add tech stack MCP extensions
    for tech in project_config['tech_stack']:
        if tech in mcp_extensions:
            checklist.extend(load_mcp_extension(tech))
    
    # Add project-specific MCP items
    checklist.extend(project_config['custom_mcp_items'])
    
    # Set MCP blocking check items
    for mcp_critical_item in project_config['mcp_critical_items']:
        checklist.set_blocking(mcp_critical_item, reason="MCP call mandatory")
    
    return checklist
```

### 2. MCP-Driven Execution Flow Control

```
Start execution
    ↓
【P0】Call compliance_gate_check(task_description) (blocking)
    ↓
Present task plan to user, wait for confirmation (blocking)
    ↓
【P0】Call compliance_gate_confirm(plan_summary) — arm compliance gate (blocking)
    ↓
Generate MCP checklist
    ↓
Execute environment verification MCP (blocking)
    ↓
Execute tech stack MCP calls (blocking)
    ↓
↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
【New】MCP Status Verification Gate
    ├─→ All MCP successful/resolved? → Yes → Proceed to next phase
    └─→ Any MCP failed? → Yes → Enter failure handling process (global suspend)
↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
MCP information-based technical analysis
    ↓
MCP-verified design decisions
    ↓
MCP-based testing strategy
    ↓
Generate MCP execution report
    ↓
Project complete (MCP verification passed)
```

### 3. MCP Status Tracking and Reporting

```markdown
## MCP Project Execution Report Template

### Project MCP Basic Information
- Project Name: _________
- Execution Time: _________
- Tech Stack: _________
- MCP Strategy Version: _________

### MCP Checklist Completion Status
- Total MCP check items: ___ items
- MCP completed: ___ items (___%)
- MCP in progress: ___ items
- MCP not started: ___ items
- **MCP blocking item completion rate**: ___%

### MCP Call Detailed Records
| # | MCP Tool Category | Specific MCP Tool | Call Time | Key MCP Output Summary | MCP Guidance Application |
|------|-------------|-------------|----------|-----------------|-------------|
| 1 | Environment Verification | node --version | HH:mm:ss | Node.js v20.15.0 | Confirmed LTS version |
| 2 | Tech Stack Verification | tsc --version | HH:mm:ss | TypeScript 5.5.4 | Confirmed type safety |
| 3 | Security Scan | npm audit | HH:mm:ss | 0 vulnerabilities | Security verification passed |
| ... | ... | ... | ... | ... | ... |

### MCP Technical Decision Traceability
| Decision Point | Decision Content | MCP Basis Source | MCP Basis Summary | Decision Verification Status |
|--------|----------|-------------|-------------|--------------|
| 1 | Use React Hook form | React official MCP | Hook form better performance | MCP verified |
| 2 | Choose Prisma ORM | Database MCP guidance | Type safety and migration support | MCP verified |
| 3 | Enable CSRF protection | Security MCP scan | Prevent cross-site request forgery | MCP verified |
| ... | ... | ... | ... | ... |

### MCP Discovered Issues and Risks
1. **MCP High-Risk Finding**: _________
   - MCP Source: _________
   - Impact Analysis: _________
   - MCP Recommended Solution: _________
2. **MCP Medium-Risk Finding**: _________
   - MCP Source: _________
   - Impact Analysis: _________
   - MCP Recommended Solution: _________

### MCP Next Steps
1. **MCP Immediate Action Items**: _________
2. **MCP Short-term Optimization Items**: _________
3. **MCP Long-term Improvement Items**: _________
```

## 📚 Appendix: MCP Tool Reference Guide

### Universal MCP Tool Matrix

| MCP Tool Category  | Specific Tool Examples                                   | Primary Purpose    | Key MCP Output    |
| -------- | ---------------------------------------- | ------- | ---------- |
| **Environment Verification** | `node --version`, `npm --version`        | Verify runtime environment | Version info, compatibility status |
| **Dependency Management** | `npm outdated`, `npm audit`              | Check dependency status  | Update suggestions, security vulnerabilities  |
| **Code Quality** | `eslint --version`, `prettier --version` | Verify code tools  | Ruleset status, configuration verification |
| **Test Framework** | `jest --version`, test coverage tools                | Verify test environment  | Test tool status, coverage |
| **Build Tools** | Build configuration verification tools                                 | Verify build process  | Build configuration, optimization suggestions  |
| **Security Scanning** | Security vulnerability scanning tools                                 | Security checks    | Vulnerability reports, fix suggestions  |

### Tech Stack Specific MCP Tools

| Tech Stack            | MCP Tool Examples                           | Verification Focus       | Output Type      |
| -------------- | --------------------------------- | ---------- | --------- |
| **TypeScript** | `tsc --version`, `tsc --noEmit`   | Type check, configuration verification  | Compilation status, type errors |
| **React**      | `react --version`, React DevTools | Version compatibility, performance analysis  | Version info, performance metrics |
| **Next.js**    | `next --version`, `next build`    | Build optimization, configuration verification  | Build output, optimization suggestions |
| **Node.js**    | `node --version`, performance monitoring tools          | Runtime performance, memory usage | Performance metrics, memory analysis |
| **Database**        | `prisma --version`, query analysis tools        | ORM status, query performance | Migration status, query plans |

### MCP Call Best Practices

1. **MCP Call Timing**: Call **immediately** before technical analysis begins; do not delay
2. **MCP Parameter Preparation**: Prepare necessary environment variables, directory paths, and other parameters
3. **MCP Result Parsing**: Carefully parse returned structured guidance and extract key information
4. **MCP Information Application**: **Directly apply** obtained MCP information to technical decisions
5. **MCP Record Preservation**: Completely record MCP call time, parameters, output, and decision application
6. **MCP Failure Handling**: Follow the process when MCP is unavailable; rationale must be recorded

## 🔄 Framework Usage Workflow (MCP-Driven)

### Step 1: MCP Project Initialization

1. Determine project type and tech stack
2. Identify required MCP tool categories and specific tools
3. Copy MCP base checklist template
4. Enable corresponding tech MCP extensions
5. Add project-specific MCP check items

### Step 2: MCP Execution Preparation

1. Configure environment variables needed for MCP calls
2. Prepare MCP tool parameters and configuration
3. Determine blocking level for MCP critical items
4. Set up MCP report template and save location
5. Verify MCP tool availability and permissions

### Step 3: MCP Execution Monitoring

1. Execute in MCP checklist order
2. Mark status of each MCP check item
3. Record MCP call outputs and key findings
4. Make technical decisions based on MCP output
5. Periodically generate MCP progress reports

### Step 4: MCP Completion Verification

1. Confirm all MCP check items completed
2. Verify MCP critical item quality standards
3. Generate final MCP execution report
4. Archive MCP project documentation and outputs
5. Summarize MCP lessons learned and improvement points

## ⚠️ MCP Enforcement Considerations

### MCP Call Absolute Prohibitions

1. **Do not skip MCP**: No reason justifies skipping MCP call steps
2. **Do not use outdated information**: Decisions must not be based on memory or outdated documentation
3. **Do not omit MCP records**: All MCP calls must have complete records
4. **Do not ignore MCP warnings**: Issues found by MCP must be addressed or rationale recorded
5. **Do not continue tasks before failed MCP is resolved**: After any MCP call failure, no subsequent technical tasks (including other MCP calls) may start until the failure handling process (retry/alternative) is complete

### MCP Quality Gate Standards

1. **MCP Call Completion Rate**: Must 100% complete planned MCP calls
2. **MCP Issue Resolution Rate**: High-risk issues found by MCP must be 100% resolved
3. **MCP Decision Traceability Rate**: All technical decisions must be 100% traceable to MCP basis
4. **MCP Report Completeness**: MCP execution reports must contain all necessary information

### MCP Exception Handling Process

1. **MCP Tool Failure**:
   - Record failure details and timestamp
   - **Immediately suspend all subsequent tasks**
   - Attempt retry (max 3 times), retry interval ≥30 seconds
   - If retry fails, initiate official documentation alternative assessment
   - **Only resume task execution after current failed MCP item is resolved**
2. **MCP Information Missing**:
   - Use latest official documentation as alternative; must record alternative rationale and risk assessment
   - Mark that MCP item as "resolved via alternative"
3. **MCP Guidance Conflict**: When multiple MCP sources conflict, defer to the latest official MCP
4. **MCP Execution Timeout**: Set timeout limit (recommended 5 minutes); after timeout, record reason and enter exception handling process

***

## 📅 Version History

- **v3.0** (2026-04-04): MCP enforcement enhanced edition, comprehensive MCP call mechanism integration, emphasizing absolute mandatory nature
- **v2.0** (2026-04-04): Universal framework version, providing base checklist and tech extensions
- **v1.0** (2026-04-04): Initial Salesforce-specific version

## 📄 Related Documents

- **Core Rule Summary**: `.qoder/rules/common-project.md` (concise version under 1000 characters)
- **Salesforce-Specific Rules**: `.qoder/rules/salesforce-project.md` (Salesforce project specific)

***

**Usage Tip**: Save this framework as a project standard document and customize it at project launch based on actual requirements. **Ensure all MCP call mandatory check items are executed** to make technical decisions based on the latest best practices. MCP calls are the cornerstone of modern software engineering quality and must not be compromised or skipped.
