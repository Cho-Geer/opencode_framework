---
type: model_decision
description: When working with MCP tools
---

# MCP Tool Inventory & Call Strategy

**Created**: 2026-04-10  
**Last Updated**: 2026-05-14  
**Version**: v2.0.0 (Added code-quality-gate MCP tool §1.12, Write-Time Audit 5-item instant checks)

---

## 1. Available MCP Tool Inventory for Current Project

### 1.1 GitHub MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `mcp_GitHub_search_repositories` | Search GitHub repositories | Find reference projects, open-source libraries |
| `mcp_GitHub_get_file_contents` | Get repository file contents | View code, config files |
| `mcp_GitHub_create_issue` | Create Issue | Issue tracking, requirement recording |
| `mcp_GitHub_create_pull_request` | Create PR | Code change submission |
| `mcp_GitHub_list_commits` | List commits | View change history |
| `mcp_GitHub_list_issues` | List Issues | Project management |
| `mcp_GitHub_update_issue` | Update Issue | Status changes |
| `mcp_GitHub_add_issue_comment` | Add Issue comment | Discussion |
| `mcp_GitHub_search_code` | Search code | Code example lookup |
| `mcp_GitHub_search_issues` | Search Issues | Issue lookup |
| `mcp_GitHub_search_users` | Search users | Collaborator lookup |
| `mcp_GitHub_get_issue` | Get Issue details | Issue detail viewing |
| `mcp_GitHub_get_pull_request` | Get PR details | PR detail viewing |
| `mcp_GitHub_list_pull_requests` | List PRs | PR list viewing |
| `mcp_GitHub_create_pull_request_review` | Create PR review | Code review |
| `mcp_GitHub_merge_pull_request` | Merge PR | Code merging |
| `mcp_GitHub_get_pull_request_files` | Get PR changed files | Changed file viewing |
| `mcp_GitHub_get_pull_request_status` | Get PR status | PR status check |
| `mcp_GitHub_update_pull_request_branch` | Update PR branch | Branch sync |
| `mcp_GitHub_get_pull_request_comments` | Get PR comments | Review discussion viewing |
| `mcp_GitHub_get_pull_request_reviews` | Get PR reviews | Review result viewing |

### 1.2 Context7 MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `mcp_context7_resolve-library-id` | Resolve library ID | Get tech stack library info |
| `mcp_context7_query-docs` | Query documentation | Get latest technical docs |

### 1.3 Pandoc MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `mcp_Pandoc_convert-contents` | Convert document format | Markdown↔PDF↔DOCX, etc. |

### 1.4 Playwright MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| Playwright MCP Server | Browser automation, UI testing | Browser operations, UI test automation |

### 1.5 Salesforce DX MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| Salesforce DX MCP | Salesforce project development, Apex/LWC development | Salesforce projects, metadata deployment, SOQL queries |

### 1.6 Docker MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `mcp_docker_list_containers` | List containers | View running containers |
| `mcp_docker_create_container` | Create container | Create new container |
| `mcp_docker_run_container` | Run container | Start container |
| `mcp_docker_recreate_container` | Recreate container | Recreate container |
| `mcp_docker_start_container` | Start container | Start stopped container |
| `mcp_docker_fetch_container_logs` | Fetch container logs | View container logs |
| `mcp_docker_stop_container` | Stop container | Stop running container |
| `mcp_docker_remove_container` | Remove container | Delete container |
| `mcp_docker_list_images` | List images | View local images |
| `mcp_docker_pull_image` | Pull image | Pull image from registry |
| `mcp_docker_push_image` | Push image | Push image to registry |
| `mcp_docker_build_image` | Build image | Build Docker image |
| `mcp_docker_remove_image` | Remove image | Delete local image |
| `mcp_docker_list_networks` | List networks | View Docker networks |
| `mcp_docker_create_network` | Create network | Create Docker network |
| `mcp_docker_remove_network` | Remove network | Delete Docker network |
| `mcp_docker_list_volumes` | List volumes | View Docker volumes |
| `mcp_docker_create_volume` | Create volume | Create Docker volume |
| `mcp_docker_remove_volume` | Remove volume | Delete Docker volume |

### 1.7 PostgreSQL MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `mcp_PostgreSQL_query` | Execute SQL query | Database query, data analysis |

### 1.9 Compliance-Gate MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `compliance_gate_check` | Pre-task compliance gate check; validates rule compliance, MCP readiness, Skill call requirements; auto-generates per-session session_id | Mandatory call before all task execution (P0 blocking) |
| `compliance_gate_confirm` | Locks compliance gate state after user confirmation; marks task plan as approved; requires session_id | Called after user confirms task plan; unlocks task execution |
| `compliance_gate_complete` | Closes compliance gate session after task execution; outputs audit summary; requires session_id | Mandatory call after task execution completion (P0 blocking); produces audit record |

### 1.10 Keystone Validate MCP Tools
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `keystone_validate` | Executes full Keystone validation: contract hash, task lifecycle evidence, TDD compliance, compliance gate status. Reads `.qoder/state/machine.json` as single data source, returns structured PASS/FAIL report | Any Agent in the multi-Agent system calls during commit or completion phase; replaces pre-commit hook in CI pipeline |
| CLI: `npm run keystone:validate` | Same as above; supports `--pre-commit`/`--audit`/`--ci` three modes | Developers manually check before commit; CI scripts call |

### 1.11 ESLint Audit MCP Tools (Added in v2.2.0)
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `eslint_audit.run_audit` | Executes ESLint mock-audit compliance scan: (1) Auto-generates `tier-rules.json` from `contract.yaml` `x-eslint-policy`; (2) Scans spec/test files with `opencode-mock-audit` plugin; (3) Updates `machine.json.eslint_state`. Detects CAT1.1(TIER1 mock), CAT1.0(audit bypass), CAT1.3(TIER3 parameter validation) | @Coder-BE/@Coder-FE detect violations early after write/edit (Layer A); `compliance_gate_complete` internal full scan (Layer B); @Guardian reads machine.json for compliance determination during review |

**Call Method**:
```
eslint_audit.run_audit({ changed_file: "src/modules/time-slots/time-slots.service.spec.ts" })
→ Layer A: Single-file quick scan

eslint_audit.run_audit({ full_scan: true })
→ Layer B: compliance_gate_complete internal full scan
```

### 1.12 Code Quality Gate MCP Tools (Added in v3.0.0 — Write-Time Audit)
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `code_quality_gate.run_write_check({ changed_file, agent_type })` | **Write-Time Audit** — Executes 5 checks immediately after each Write/Edit: ① Agent Write Scope (path boundary interception, BLOCKER) ② Prettier formatting (auto-fix) ③ dependency-cruiser architecture boundary ④ ESLint mock-audit (TIER1 Mock BLOCKER) ⑤ tsc incremental type check (BLOCKER). Results written to `machine.json.{type_check_state,dependency_state,format_state,write_audit_state}` | @Coder-BE/@Coder-FE **must call after every Write/Edit** (P0 mandatory, cannot skip); violations block immediately |
| `code_quality_gate.run_full_scan()` | **Commit-Time Full Scan** — Executes tsc full type check + depcruise full dependency scan + prettier full format check. Used inside `compliance_gate_complete` and pre-commit hook | Called inside `compliance_gate_complete`; called before Guardian review |
| `code_quality_gate.get_audit_status({ task_id })` | **Audit Status Read** — Reads `machine.json.write_audit_state`, returns Write-Time check records for a task. Used by Guardian to verify whether Agent executed Write-Time Audit | Called by @Guardian during review |

**Call Method**:
```
# Layer A — Write-Time (execute immediately after each modification)
code_quality_gate.run_write_check({
  changed_file: "booking-backend/src/modules/xxx/xxx.service.ts",
  agent_type: "@Coder-BE",
  task_id: "T-014"
})
→ 5 checks executed synchronously, returns in <5s, violations block immediately

# Layer B — Full Scan (compliance_gate_complete/pre-commit)
code_quality_gate.run_full_scan()
→ Full tsc + depcruise + prettier

# Guardian audit query
code_quality_gate.get_audit_status({ task_id: "T-014" })
→ Returns write_audit_state, verifies checks_run >= files_changed
```

### 1.8 Task Agent Tools (Tech Stack Experts)
| Tool Name | Description | Use Case |
|---------|---------|---------|
| `Task(search)` | Search agent | Codebase search, documentation lookup |
| `Task(salesforce-dx-expert)` | Salesforce DX expert | Salesforce project development, Apex/LWC development, CI/CD configuration, deployment troubleshooting |
| `Task(devops-architect)` | DevOps architect | CI/CD pipeline design, GitOps workflows, containerized applications, cloud-native infrastructure architecture design |
| `Task(playwright-mcp-expert)` | Playwright MCP expert | Playwright MCP Server configuration, LLM browser automation, connection troubleshooting, element locator strategy optimization |

---

## 2. MCP Tool Call Strategy

### 2.1 MCP Tool Selection by Task Type

| Task Type | Primary MCP Tools | Secondary MCP Tools |
|---------|------------|------------|
| **Tech Stack Consultation** | Context7 MCP | GitHub Search |
| **Code Development** | Context7 MCP, Task(search) | GitHub MCP |
| **Write-Time Audit** | **code-quality-gate** (P0 mandatory) | eslint-audit |
| **Commit-Time Verification** | **code-quality-gate**, keystone-validate | eslint-audit |
| **CI/CD Configuration** | Task(devops-architect) | GitHub MCP |
| **GitHub Operations** | GitHub MCP | - |
| **Docker/Containerization** | Docker MCP | Task(devops-architect) |
| **Database Queries** | PostgreSQL MCP | - |
| **Document Conversion** | Pandoc MCP | - |
| **Salesforce Development** | Salesforce DX MCP | GitHub MCP |
| **DevOps/CI/CD** | Task(devops-architect) | Docker MCP, GitHub MCP |
| **UI Testing/Browser Automation** | Playwright MCP | - |

### 2.2 Blocking MCP Call Checklist

The following MCP calls are blocking; they must complete successfully before proceeding to the next phase:

| Task Phase | Blocking MCP Call | Failure Handling |
|---------|-------------|---------|
| **Environment Verification** | Dependency check, version verification | Retry 3 times → Official documentation alternative |
| **Tech Stack Confirmation** | Context7 query latest docs | Retry 3 times → Use known best practices |
| **Security Scan** | Dependency vulnerability scan | Retry 3 times → Record risk and continue |
| **Compliance Gate (Pre)** | `compliance_gate_check` + `compliance_gate_confirm` | Blocking; no task execution permitted until passed |
| **Compliance Gate (Post)** | `compliance_gate_complete` + `code_quality_gate.run_full_scan()` | Blocking; task cannot be marked complete. Reads all 8 state dimensions from machine.json; any dirty → failed |
| **Write-Time Audit (P0 Mandatory)** | `code_quality_gate.run_write_check({ changed_file, agent_type })` | **P0 blocking, cannot skip**. Must execute after every Write/Edit. 5 checks: scope/format/deps/eslint/tsc. Violations block immediately. Skip → CAT5.1 violation |
| **After Test Write/Modification** | `eslint_audit.run_audit({ changed_file })` | Advisory, non-blocking. Early detection of TIER1 mock violations |
| **Before Guardian Review** | `code_quality_gate.get_audit_status({ task_id })` | Blocking. Verifies write_audit_log completeness |

---

## 3. MCP Call Best Practices

### 3.1 Pre-Call Checks
- [ ] Confirm MCP tool availability
- [ ] Prepare necessary parameters
- [ ] Plan failure handling strategy
- [ ] Use TodoWrite for status tracking

### 3.2 During Execution
- [ ] Call in priority order
- [ ] Execute blocking calls first
- [ ] Fully record call outputs
- [ ] Update TodoWrite status in real-time

### 3.3 Post-Call Processing
- [ ] Parse key information from MCP output
- [ ] Apply MCP guidance to decisions
- [ ] Record decision rationale
- [ ] Archive MCP call records

---

## 4. MCP Tool Extension Guide

### 4.1 Adding New MCP Tools
1. Add the corresponding table entry in "1. Available MCP Tool Inventory for Current Project" above
2. Update mapping relationships in "2. MCP Tool Call Strategy"
3. Add call examples and best practices

### 4.2 Updating Existing MCP Tools
1. Update tool description
2. Adjust use cases
3. Update call strategy

---

## 5. Failure Handling Process

```
MCP call failure
    ↓
Record failure details and timestamp
    ↓
Immediately suspend all subsequent tasks
    ↓
Attempt retry (max 3 times, interval ≥30 seconds each)
    ↓
Retry successful? → Yes → Continue execution
    ↓ No
Initiate official documentation alternative assessment
    ↓
Record alternative rationale and risk assessment
    ↓
Mark MCP item as "resolved via alternative"
    ↓
Resume task execution
```

---

*This document will be continuously updated as MCP tools evolve.*

