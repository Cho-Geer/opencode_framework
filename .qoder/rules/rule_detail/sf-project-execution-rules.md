---
type: model_decision
description: When executing SF project tasks
---

# Universal Project Execution Rules Framework v2.0

## 📖 Document Overview

This framework provides a layered, extensible project execution rules system applicable to various tech stack projects. Core design philosophy:
- **Universality Principle**: Base rules apply to all project types
- **Technical Adaptability**: Supports specific tech stack best practices through extensions
- **Enforcement Mechanism**: Critical checkpoints ensure compliance and quality
- **Transparent Traceability**: Complete recording of execution process and decision rationale

## 🎯 Core Principles

### 1. Latest Information First Principle
> Before technical analysis, you must obtain the latest best practices and official guidance for that domain

### 2. Verification-Driven Principle  
> All technical decisions must have reliable basis, including official documentation, industry standards, or expert systems

### 3. Transparent Traceability Principle
> Execution process must have complete records; decision rationale must be traceable to specific information sources

### 4. Quality Assurance Principle
> Each critical step has verification checkpoints to ensure output quality

## 📋 Universal Checklist Framework

### Usage Instructions
1. **Project Initialization**: Enable corresponding extensions based on project type and tech stack
2. **Execution Check**: Complete each check in checklist order
3. **Status Marking**: Mark items as completed; critical items are blocking checks
4. **Documentation**: Save checklist status as project documentation

### Base Checklist Template
```markdown
# Project: [Project Name]
# Type: [Project Type]
# Tech Stack: [Primary Technologies]

## ✅ Pre-Checks
- [ ] Confirm project type and tech stack
- [ ] Identify domains requiring latest information
- [ ] Determine information channels (documentation, APIs, MCP tools, etc.)

## 🔄 Information Gathering
- [ ] Collect latest official documentation for relevant technologies
- [ ] Obtain industry best practice guidance
- [ ] Call relevant MCP/expert systems for professional guidance
- [ ] Understand known security risks and limitations

## 📊 Technical Analysis
- [ ] Analyze existing implementation based on latest information
- [ ] Identify gaps from best practices
- [ ] Formulate solutions conforming to latest standards
- [ ] Assess technical debt and refactoring needs

## 🎯 Decision Verification
- [ ] Confirm solution meets latest technical standards
- [ ] Record decision rationale and reference materials
- [ ] Assess solution maintainability and extensibility
- [ ] Formulate testing and verification strategy

## 📝 Execution Record
- [ ] Save checklist completion status
- [ ] Record key decisions and rationale
- [ ] Archive relevant technical reference materials
```

## 🔧 Technology-Specific Extensions

### Salesforce Project Extension

#### A. MCP Call Mandatory Checks (Must execute for Salesforce projects)
```markdown
### 🚨 MCP Call Mandatory Checks (Blocking Checks)

#### Base MCP Calls
- [ ] Call `mcp_Salesforce_DX_get_username` to confirm org authentication configuration
- [ ] Call `mcp_Salesforce_DX_list_all_orgs` to verify org configuration status
- [ ] Call other Salesforce DX MCP tools based on project needs

#### Development Technical Guidance
- [ ] Call `mcp_Salesforce_DX_get_mobile_lwc_offline_guidance` for LWC mobile compatibility guidance
- [ ] Call `mcp_Salesforce_DX_guide_utam_generation` for UI test automation guidance

#### Migration-Specific MCP Checks (Must execute for migration projects)
- [ ] Call `mcp_Salesforce_DX_deploy_metadata` to understand metadata deployment best practices
- [ ] Call `mcp_Salesforce_DX_retrieve_metadata` to understand metadata retrieval strategies
- [ ] Call `mcp_Salesforce_DX_create_org_snapshot` to understand environment snapshot management
- [ ] Call `mcp_Salesforce_DX_run_soql_query` to verify data migration feasibility
```

#### B. Salesforce Migration-Specific Checks
```markdown
### 🚀 Salesforce Migration Technical & Implementation Key Points

#### Migration Planning Checks
- [ ] **Org Configuration Verification**: Confirm source and target orgs are correctly configured
- [ ] **Authentication Check**: Verify username/alias availability and permissions
- [ ] **Dependency Analysis**: Identify dependencies between metadata components
- [ ] **Compatibility Assessment**: Evaluate API version and feature availability differences

#### Metadata Migration Checks
- [ ] **Deployment Strategy Selection**: Determine incremental or full deployment strategy
- [ ] **Conflict Resolution Plan**: Formulate metadata conflict resolution process
- [ ] **Rollback Plan**: Prepare rollback plan for deployment failures
- [ ] **Deployment Order Optimization**: Determine deployment order based on dependencies

#### Data Migration Checks
- [ ] **Data Mapping Design**: Design source-to-target field mapping
- [ ] **Migration Tool Selection**: Determine use of Data Loader, SOQL, or ETL tools
- [ ] **Data Cleansing Strategy**: Formulate data cleansing and transformation rules
- [ ] **Migration Verification Plan**: Design data consistency and integrity verification

#### Testing Strategy Checks
- [ ] **Unit Test Coverage**: Ensure Apex test coverage meets threshold (≥75%)
- [ ] **Integration Test Design**: Design component integration test scenarios
- [ ] **UI Automation Testing**: Use UTAM for interface automation testing
- [ ] **Performance Test Planning**: Assess post-migration performance impact

#### Mobile Compatibility Checks (If involving LWC)
- [ ] **Conditional Rendering Compatibility**: Avoid using `lwc:if`, `lwc:elseif`, `lwc:else`
- [ ] **GraphQL Query Optimization**: Extract inline GraphQL queries to independent getter methods
- [ ] **Offline Feature Testing**: Verify feature availability in mobile offline scenarios
```

#### C. Apex Development Checks
```markdown
### ⚡ Apex Development Best Practice Checks

#### Security Checks
- [ ] **SOQL Injection Protection**: Use bind variables or `String.escapeSingleQuotes()`
- [ ] **CRUD/FLS Checks**: Verify object and field-level access controls
- [ ] **Sharing Rule Compliance**: Explicitly declare `with sharing`/`without sharing` context
- [ ] **Sensitive Information Protection**: Avoid exposing sensitive data in logs or exceptions

#### Performance Checks
- [ ] **Bulk Processing Optimization**: Follow bulk Apex best practices
- [ ] **Query Selectivity**: Ensure SOQL queries have sufficient selectivity
- [ ] **Loop Optimization**: Avoid executing SOQL/DML within loops
- [ ] **Resource Limit Monitoring**: Properly utilize Governor Limits

#### Code Quality Checks
- [ ] **Test Coverage**: Ensure Apex class test coverage ≥75%
- [ ] **Error Handling**: Implement comprehensive try-catch and error logging
- [ ] **Code Comments**: Critical logic has clear comments
- [ ] **Design Pattern Application**: Appropriately use design patterns to improve maintainability
```

### Other Tech Stack Extension Examples

#### React Project Extension
```markdown
### ⚛️ React Development Checks

#### Latest Practice Checks
- [ ] **Hook Usage Standards**: Follow React Hook best practices
- [ ] **Performance Optimization**: Implement memoization, code splitting, etc.
- [ ] **State Management**: Choose appropriate state management solution (Context/Redux, etc.)
- [ ] **Type Safety**: Use TypeScript or PropTypes to ensure type safety

#### Code Quality Checks
- [ ] **Component Design**: Follow single responsibility principle
- [ ] **Error Boundaries**: Implement error boundary handling
- [ ] **Test Strategy**: Unit and integration test coverage
- [ ] **Accessibility**: Ensure components comply with WCAG standards
```

#### Python Project Extension
```markdown
### 🐍 Python Development Checks

#### Code Quality Checks
- [ ] **Type Hints**: Use Type Hints to improve code readability
- [ ] **Static Analysis**: Check with mypy, pylint, etc.
- [ ] **Dependency Management**: Use requirements.txt or poetry for dependency management
- [ ] **Security Scanning**: Check for known security vulnerabilities (Bandit, etc.)

#### Performance Checks
- [ ] **Async Optimization**: Properly use async/await
- [ ] **Memory Management**: Avoid memory leaks and excessive usage
- [ ] **Algorithm Optimization**: Choose appropriate data structures and algorithms
```

## 🏗️ Project-Specific Customization Layer

### Customization Method
1. **Copy Base Template**: Start from the universal template
2. **Enable Tech Extensions**: Enable corresponding extensions based on tech stack
3. **Add Project-Specific Items**: Add customized check items based on project needs
4. **Adjust Priority**: Set blocking level for critical items

### Example: zhaoge→chogeer Salesforce Migration Project
```markdown
# Project: zhaoge→chogeer Salesforce Migration
# Type: Salesforce metadata and data migration
# Tech Stack: Apex, Aura, LWC, SOQL

## 🎯 Project-Specific Check Items

### Environment Preparation Checks
- [ ] **Org Access Verification**: Confirm access to both zhaoge and chogeer orgs
- [ ] **Custom Field Creation**: Confirm missing fields (Contact.Level__c, Account.Heroku_Connect__c)
- [ ] **Feature Overlap Assessment**: Assess feature overlap with ShowcaseContact component

### Migration Strategy Checks
- [ ] **Component Priority Ordering**: Determine implementation order for "rewrite then migrate" components
- [ ] **Test Data Preparation**: Prepare data samples for migration testing
- [ ] **User Training Plan**: Formulate post-migration user training materials

### Quality Gate Checks
- [ ] **Test Coverage Target**: All Apex classes ≥85% test coverage
- [ ] **Deployment Success Rate Target**: ≥95% success rate per deployment
- [ ] **User Acceptance Criteria**: Define specific UAT pass criteria
```

## ⚙️ Implementation Mechanism Design

### 1. Dynamic Checklist Generation
```python
# Conceptual implementation
def generate_project_checklist(project_config):
    """Generate customized checklist based on project configuration"""
    
    checklist = load_base_template()
    
    # Add tech extensions
    for tech in project_config['tech_stack']:
        if tech in available_extensions:
            checklist.extend(load_extension(tech))
    
    # Add project-specific items
    checklist.extend(project_config['custom_items'])
    
    # Set blocking check items
    for critical_item in project_config['critical_items']:
        checklist.set_blocking(critical_item)
    
    return checklist
```

### 2. Execution Flow Control
```
Start execution
    ↓
Generate project checklist
    ↓
Execute pre-checks (blocking)
    ↓
Execute information gathering (includes MCP calls)
    ↓
Execute technical analysis
    ↓
Execute decision verification
    ↓
Generate execution report
    ↓
Project complete
```

### 3. Status Tracking and Reporting
```markdown
## Project Execution Report Template

### Project Basic Information
- Project Name: _________
- Execution Time: _________
- Tech Stack: _________

### Checklist Completion Status
- Total check items: ___ items
- Completed: ___ items (___%)
- In progress: ___ items
- Not started: ___ items
- **Critical item completion rate**: ___%

### MCP Call Records
| # | MCP Tool | Call Time | Key Information Obtained |
|------|---------|----------|----------------|
| 1 | mcp_Salesforce_DX_get_username | HH:mm:ss | Org authentication configuration status |
| 2 | mcp_Salesforce_DX_list_all_orgs | HH:mm:ss | Available org list |
| ... | ... | ... | ... |

### Technical Decision Traceability
| Decision Point | Decision Content | Basis Source | Basis Summary |
|--------|----------|----------|----------|
| 1 | SOQL injection protection approach | MCP security guidance | Use bind variables instead of string concatenation |
| 2 | LWC migration strategy | MCP mobile compatibility guidance | Avoid lwc:if directives |
| ... | ... | ... | ... |

### Discovered Issues and Risks
1. **High Risk Issue**: _________
   - Impact: _________
   - Recommendation: _________
2. **Medium Risk Issue**: _________
   - Impact: _________
   - Recommendation: _________

### Next Steps
1. Immediate Action: _________
2. Short-term Plan: _________
3. Long-term Recommendation: _________
```

## 📚 Appendix: MCP Tool Reference Guide

### Salesforce DX MCP Tool Matrix
| Tool Name | Primary Purpose | Applicable Scenario | Key Output |
|----------|----------|----------|----------|
| `mcp_Salesforce_DX_get_username` | Get org username/alias | Authentication configuration | Available username list |
| `mcp_Salesforce_DX_list_all_orgs` | List all configured orgs | Environment management | Org configuration status |
| `mcp_Salesforce_DX_deploy_metadata` | Deploy metadata to org | Code deployment | Deployment status and results |
| `mcp_Salesforce_DX_retrieve_metadata` | Retrieve metadata from org | Code sync | Retrieved metadata |
| `mcp_Salesforce_DX_create_scratch_org` | Create scratch org | Test environment | Org creation status |
| `mcp_Salesforce_DX_create_org_snapshot` | Create org snapshot | Environment backup | Snapshot information |
| `mcp_Salesforce_DX_run_soql_query` | Execute SOQL query | Data operations | Query results |
| `mcp_Salesforce_DX_get_mobile_lwc_offline_guidance` | Get LWC mobile compatibility guidance | Mobile development | Structured guidance |
| `mcp_Salesforce_DX_guide_utam_generation` | Get UTAM test guidance | Test automation | Generation workflow |

### MCP Call Best Practices
1. **Call Timing**: Call immediately before technical analysis begins
2. **Parameter Preparation**: Prepare necessary directory, username, and other parameters
3. **Result Parsing**: Carefully parse returned structured guidance
4. **Information Application**: Directly apply obtained information to technical decisions
5. **Record Preservation**: Completely record call time, parameters, and results

## 🔄 Framework Usage Workflow

### Step 1: Project Initialization
1. Determine project type and tech stack
2. Copy base checklist template
3. Enable corresponding tech extensions
4. Add project-specific check items

### Step 2: Execution Preparation
1. Configure necessary environment variables
2. Prepare parameters needed for MCP calls
3. Determine blocking level for critical check items
4. Set up report template and save location

### Step 3: Execution Monitoring
1. Execute in checklist order
2. Mark status of each check item
3. Record key decisions and rationale
4. Periodically generate progress reports

### Step 4: Completion Verification
1. Confirm all check items completed
2. Verify quality standards for critical items
3. Generate final execution report
4. Archive project documentation

## ⚠️ MCP Enforcement Considerations (Salesforce-Specific)

### MCP Call Absolute Prohibitions (Salesforce Projects)
1. **Do not skip Salesforce DX MCP**: All Salesforce technical tasks must first call the corresponding MCP tools for guidance.
2. **Do not use outdated Salesforce information**: Salesforce technical decisions must not be based on memory or outdated documentation.
3. **Do not omit MCP call records**: All Salesforce DX MCP calls must have complete records.
4. **Do not ignore MCP warnings**: Salesforce-related issues found by MCP must be addressed or rationale recorded.
5. **Do not continue tasks before failed MCP is resolved**: After any Salesforce DX MCP call failure, no subsequent technical tasks may start until the failure handling process is complete.

### Salesforce MCP Quality Gate Standards
1. **MCP Call Completion Rate**: Must 100% complete planned Salesforce DX MCP calls.
2. **MCP Issue Resolution Rate**: High-risk issues found by MCP must be 100% resolved.
3. **MCP Decision Traceability Rate**: All Salesforce technical decisions must be 100% traceable to MCP basis.
4. **MCP Report Completeness**: Salesforce MCP execution reports must contain all necessary information.

### Salesforce MCP Exception Handling Process
1. **Salesforce DX MCP Tool Failure**:
   - Record failure details and timestamp
   - **Immediately suspend all subsequent Salesforce-related tasks**
   - Attempt retry (max 3 times), retry interval ≥30 seconds
   - If retry fails, initiate Salesforce official documentation alternative assessment
   - **Only resume task execution after current failed Salesforce MCP item is resolved**

2. **Salesforce MCP Information Missing**:
   - Use latest Salesforce official documentation as alternative; must record alternative rationale and risk assessment
   - Mark that Salesforce MCP item as "resolved via alternative"

3. **Salesforce MCP Guidance Conflict**: When multiple Salesforce MCP sources conflict, defer to the latest official Salesforce DX MCP

4. **Salesforce MCP Execution Timeout**: Set timeout limit (recommended 5 minutes); after timeout, record reason and enter exception handling process

---

## 📅 Version History
- **v2.0** (2026-04-04): Complete restructure as universal framework, enhanced Salesforce migration specifics, strengthened MCP call mechanisms
- **v1.0** (2026-04-04): Initial version, base checklist framework

## 📄 License
This framework adopts open sharing principles and may be freely adapted and used according to specific project needs.

---

**Usage Tip**: Save this framework as a project standard document and customize it at project launch based on actual requirements. For Salesforce projects, ensure all items in the "MCP Call Mandatory Checks" section are executed to ensure decisions are based on the latest best practices.
