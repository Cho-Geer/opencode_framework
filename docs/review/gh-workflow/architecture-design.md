# GitHub Workflow Architecture Design — Booking System

> **Author**: @Architect
> **Date**: 2026-06-19
> **Task**: T-GH-WF-DESIGN-001
> **Status**: Design (pending implementation by @CI-CD-Agent)

---

## 1. Overview

本设计文档定义了 booking-system 项目中 work-one 仓库的 4 个 GitHub Actions Workflows 的完整架构设计，包括 trigger 定义、job 分解、权限模型、Secrets 管理和数据流。

### 1.1 Repository Context

| Attribute            | Value                             |
| -------------------- | --------------------------------- |
| Repository           | `Cho-Geer/work-one`               |
| Branch (source)      | `work-one`                        |
| Branch (target)      | `develop`                         |
| Target Project       | `Opencode_framework` (Project #2) |
| Project Owner        | `Cho-Geer`                        |
| Deployment Directory | `.github/workflows/`              |

### 1.2 Workflow Summary

| Workflow            | Trigger                    | Purpose                                        |
| ------------------- | -------------------------- | ---------------------------------------------- |
| `auto-pr.yml`       | `push` to `work-one`       | Auto-create PR from work-one → develop         |
| `doc-decompose.yml` | `push` to `docs/review/**` | Auto-decompose design docs into Issues and PRs |
| `auto-project.yml`  | Issue/PR `opened`          | Auto-add new Issues/PRs to Project #2          |
| `state-sync.yml`    | `project_v2_item` events   | Bidirectional sync Project ↔ Repository state  |

---

## 2. Workflow 1: auto-pr.yml

### 2.1 Purpose

当本地 `work-one` 分支 push 到远程后，自动创建一个从 `work-one` → `develop` 的 Pull Request，避免手动创建 PR 的遗漏。

### 2.2 Trigger

```yaml
on:
  push:
    branches:
      - work-one
```

**注意**：仅在 push 到 `work-one` 分支时触发，其他分支 push 不触发。

### 2.3 Jobs

#### Job: create-pr

| Field     | Value                                 |
| --------- | ------------------------------------- |
| `runs-on` | `ubuntu-latest`                       |
| `if`      | `github.ref == 'refs/heads/work-one'` |

##### Steps

| Step | Name                | Action / Command                                                                                          |
| ---- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| 1    | Checkout            | `actions/checkout@v6`                                                                                     |
| 2    | Check existing PR   | `gh pr list --base develop --head work-one --json number`                                                 |
| 3    | Create PR (if none) | `gh pr create --base develop --head work-one --title "Auto PR: work-one → develop" --body "Automated PR"` |
| 4    | Skip (if PR exists) | Log message and exit 0                                                                                    |

### 2.4 Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

### 2.5 Required Secrets

| Secret     | Scope                         | Purpose                |
| ---------- | ----------------------------- | ---------------------- |
| `GH_TOKEN` | `repo`, `pull_requests:write` | PR creation via gh CLI |

### 2.6 Concurrency

```yaml
concurrency:
  group: auto-pr-work-one
  cancel-in-progress: false
```

### 2.7 Complete Workflow Definition

```yaml
name: Auto PR — work-one → develop
on:
  push:
    branches:
      - work-one

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: auto-pr-work-one
  cancel-in-progress: false

jobs:
  create-pr:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/work-one'
    steps:
      - uses: actions/checkout@v6

      - name: Check if PR already exists
        id: check-pr
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
        run: |
          existing=$(gh pr list \
            --base develop \
            --head work-one \
            --json number \
            --jq 'length')
          echo "existing=$existing" >> $GITHUB_OUTPUT

      - name: Create Pull Request
        if: steps.check-pr.outputs.existing == '0'
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
        run: |
          gh pr create \
            --base develop \
            --head work-one \
            --title "Auto PR: work-one → develop" \
            --body "Automated PR created by CI from work-one branch push."

      - name: Skip (PR already exists)
        if: steps.check-pr.outputs.existing != '0'
        run: echo "PR already exists, skipping creation."
```

---

## 3. Workflow 2: doc-decompose.yml

### 3.1 Purpose

当 `docs/review/` 目录下的设计文档（如 `docs/review/gh-workflow/architecture-design.md`）被 push 时，自动解析文档的 YAML frontmatter，将 Problem Background 部分拆解为 Issue，将 Solution/Verification 部分拆解为 Pull Request。

### 3.2 Trigger

```yaml
on:
  push:
    branches:
      - work-one
    paths:
      - "docs/review/**/*.md"
      - "docs/review/**/*.yaml"
      - "docs/review/**/*.yml"
```

### 3.3 YAML Frontmatter Template

所有 `docs/review/` 下的文档必须包含以下 YAML frontmatter：

```yaml
---
# ─── Required Fields ───
title: "string" # Document title (used as Issue/PR title prefix)
type:
  problem | solution | problem+solution
  # problem → create Issue only
  # solution → create PR only
  # problem+solution → create both Issue and linked PR
severity: critical | high | medium | low

# ─── Conditional Fields ───
timing: "string" # (Required when type includes "problem")
components: # Affected system components
  - component_name
labels: # GitHub labels to apply
  - label_name
assignees: # GitHub usernames
  - username

# ─── PR-Specific ───
pr_base_branch: "string" # (Optional, default: develop) Target branch for PR
---
```

### 3.4 Content Decomposition Rules

| Section in Document      | Destined For      | Rationale                                  |
| ------------------------ | ----------------- | ------------------------------------------ |
| `## Problem Background`  | Issue body        | Describes the problem context and timing   |
| `## Timing / Trigger`    | Issue body        | When the problem occurs                    |
| `## Root Cause Analysis` | PR body           | Technical analysis belongs in PR           |
| `## Solution Design`     | PR body           | Implementation approach                    |
| `## Verification`        | PR body           | Testing and validation results             |
| `## Implementation`      | PR body           | Code changes                               |
| Both sections present    | Issue + Linked PR | Cross-reference with `Closes #issue` in PR |

### 3.5 Job Definition

#### Job: decompose-doc

| Field     | Value           |
| --------- | --------------- |
| `runs-on` | `ubuntu-latest` |

##### Steps

| Step | Name              | Action / Command                                                                                    |
| ---- | ----------------- | --------------------------------------------------------------------------------------------------- |
| 1    | Checkout          | `actions/checkout@v6` with `fetch-depth: 0`                                                         |
| 2    | Get changed files | `git diff --name-only ${{ github.event.before }} ${{ github.event.after }}` (filter `docs/review/`) |
| 3    | Parse frontmatter | Extract YAML frontmatter from changed `.md` files using `yq` or custom script                       |
| 4    | Create Issue      | For `type: problem` docs: `gh issue create --title "..." --body "..." --label "..."`                |
| 5    | Create PR         | For `type: solution` docs: `gh pr create --title "..." --body "..." --base develop --head work-one` |
| 6    | Link Issue ↔ PR   | Add `Closes #issue_number` to PR body (when `type: problem+solution`)                               |

### 3.6 Document Parsing Script (Conceptual)

```bash
#!/bin/bash
# Parse YAML frontmatter from markdown files and create Issues/PRs

parse_frontmatter() {
  local file="$1"
  # Extract YAML between --- delimiters
  sed -n '/^---$/,/^---$/p' "$file" | sed '1d;$d' > /tmp/frontmatter.yaml

  # Read fields
  TITLE=$(yq '.title' /tmp/frontmatter.yaml)
  TYPE=$(yq '.type' /tmp/frontmatter.yaml)
  SEVERITY=$(yq '.severity' /tmp/frontmatter.yaml)
  TIMING=$(yq '.timing' /tmp/frontmatter.yaml)
  COMPONENTS=$(yq '.components | join(", ")' /tmp/frontmatter.yaml)
  LABELS=$(yq '.labels | join(",")' /tmp/frontmatter.yaml)

  # Extract content sections (after frontmatter)
  BODY=$(sed '1,/^---$/d' "$file" | sed '1,/^---$/d')

  # Determine Issue/PR creation
  case "$TYPE" in
    problem)
      create_issue "$TITLE" "$BODY" "$TIMING" "$LABELS"
      ;;
    solution)
      create_pr "$TITLE" "$BODY" "$LABELS"
      ;;
    problem+solution)
      ISSUE_NUM=$(create_issue "$TITLE" "$BODY" "$TIMING" "$LABELS")
      create_pr "$TITLE" "$BODY" "$LABELS" "$ISSUE_NUM"
      ;;
  esac
}
```

### 3.7 Permissions

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
```

### 3.8 Required Secrets

| Secret     | Scope                                         |
| ---------- | --------------------------------------------- |
| `GH_TOKEN` | `repo`, `issues:write`, `pull_requests:write` |

---

## 4. Workflow 3: auto-project.yml

### 4.1 Purpose

当新的 Issue 或 Pull Request 被创建时，自动将其添加到 `Opencode_framework` Project (Project #2)。

### 4.2 Trigger

```yaml
on:
  issues:
    types: [opened]
  pull_request:
    types: [opened, ready_for_review]
```

### 4.3 Job Definition

#### Job: add-to-project

| Field     | Value           |
| --------- | --------------- |
| `runs-on` | `ubuntu-latest` |

##### Steps

| Step | Name               | Action / Command                                                                                 |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------ |
| 1    | Generate token     | `actions/create-github-app-token@v3` (or use `ADD_TO_PROJECT_PAT` secret directly)               |
| 2    | Add to Project     | `gh api graphql` mutation `addProjectV2ItemById`                                                 |
| 3    | Set initial status | `gh api graphql` mutation `updateProjectV2ItemFieldValue` (set Status = "Todo" or "In Progress") |

### 4.4 GraphQL Details

#### ProjectV2 ID

Project #2 (`Opencode_framework`) belongs to user `Cho-Geer`. The Project ID can be obtained via:

```graphql
query {
  user(login: "Cho-Geer") {
    projectV2(number: 2) {
      id
      title
    }
  }
}
```

The resolved ID is stored as a **repository variable** (`vars.PROJECT_ID`) to avoid hardcoding.

#### Add Item Mutation

```graphql
mutation ($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(
    input: { projectId: $projectId, contentId: $contentId }
  ) {
    item {
      id
    }
  }
}
```

Where:

- `$projectId` = `vars.PROJECT_ID`
- `$contentId` = `github.event.issue.node_id` or `github.event.pull_request.node_id`

#### Set Status Field Mutation

```graphql
mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $valueId: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $valueId }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
```

### 4.5 Permissions

```yaml
permissions:
  contents: read
```

Project access is controlled by the PAT scope, not workflow permissions.

### 4.6 Required Secrets

| Secret               | Scope                             | Purpose                         |
| -------------------- | --------------------------------- | ------------------------------- |
| `ADD_TO_PROJECT_PAT` | `project` (read+write, org-level) | GraphQL mutations on ProjectV2  |
| `GH_TOKEN`           | `repo`                            | `gh api graphql` authentication |

### 4.7 Complete Workflow Definition

```yaml
name: Auto-Add to Project
on:
  issues:
    types: [opened]
  pull_request:
    types: [opened, ready_for_review]

permissions:
  contents: read

jobs:
  add-to-project:
    runs-on: ubuntu-latest
    steps:
      - name: Add Issue/PR to Project
        env:
          GH_TOKEN: ${{ secrets.ADD_TO_PROJECT_PAT }}
          PROJECT_ID: ${{ vars.PROJECT_ID }}
          CONTENT_ID: ${{ github.event.issue.node_id || github.event.pull_request.node_id }}
          ITEM_TYPE: ${{ github.event.issue && 'issue' || 'pr' }}
        run: |
          # Add to Project
          item_id=$(gh api graphql -f query='
            mutation($project:ID!, $content:ID!) {
              addProjectV2ItemById(input: {projectId: $project, contentId: $content}) {
                item { id }
              }
            }' -f project="$PROJECT_ID" -f content="$CONTENT_ID" \
            --jq '.data.addProjectV2ItemById.item.id')

          echo "Added $ITEM_TYPE to Project. Item ID: $item_id"
```

---

## 5. Workflow 4: state-sync.yml

### 5.1 Purpose

实现 `Opencode_framework` Project 中的 Item 与对应 Repository Issue/PR 之间的**双向状态同步**：

- **Project → Repository**: 当 Project 中 Item 的 title, description, status 变更时，同步到 Repository 中的 Issue/PR
- **Repository → Project**: 当 Issue/PR 的 labels, assignees 变更时，同步到 Project Item 的自定义字段

### 5.2 Trigger

```yaml
on:
  project_v2_item:
    types:
      - edited
      - converted
      - reordered
  issues:
    types: [edited, labeled, unlabeled, assigned, unassigned, closed, reopened]
  pull_request:
    types: [edited, labeled, unlabeled, assigned, unassigned, closed, reopened]
```

### 5.3 Field Mapping Table

#### Project → Repository Sync

| Project Field        | Repository Field       | Direction | Method                                                           |
| -------------------- | ---------------------- | --------- | ---------------------------------------------------------------- |
| `Title`              | Issue/PR `title`       | P → R     | REST: `PATCH /repos/{owner}/{repo}/issues/{n}`                   |
| `Body` (Description) | Issue/PR `body`        | P → R     | REST: `PATCH /repos/{owner}/{repo}/issues/{n}`                   |
| `Status` (→ Todo)    | Reopen Issue           | P → R     | REST: `PATCH /repos/{owner}/{repo}/issues/{n}` → `state: open`   |
| `Status` (→ Done)    | Close Issue / Merge PR | P → R     | REST: `PATCH /repos/{owner}/{repo}/issues/{n}` → `state: closed` |

#### Repository → Project Sync

| Repository Field | Project Field           | Direction | Method                                                |
| ---------------- | ----------------------- | --------- | ----------------------------------------------------- |
| `labels`         | Custom Field: Labels    | R → P     | GraphQL: `updateProjectV2ItemFieldValue` (text field) |
| `assignees`      | Built-in: Assignees     | R → P     | REST: `addAssigneesToAssignable` (⚠️ needs REST)      |
| `milestone`      | Custom Field: Milestone | R → P     | GraphQL: `updateProjectV2ItemFieldValue` (text field) |
| `state` (closed) | Status → Done           | R → P     | GraphQL: `updateProjectV2ItemFieldValue`              |

### 5.4 ⚠️ Field Exception Handling

根据 GitHub Projects API 约束，以下字段**不能**通过 `updateProjectV2ItemFieldValue` 修改，必须使用专用 Mutations：

| Field        | Restriction                    | Workaround                                    |
| ------------ | ------------------------------ | --------------------------------------------- |
| `Assignees`  | 不能用 ProjectV2 mutation 修改 | 使用 `addAssigneesToAssignable` REST mutation |
| `Labels`     | 不能用 ProjectV2 mutation 修改 | 使用 `addLabelsToLabelable` REST mutation     |
| `Milestone`  | 不能用 ProjectV2 mutation 修改 | 使用 `updateIssue` REST mutation              |
| `Repository` | 不能修改                       | N/A — Item 的仓库不可变                       |

### 5.5 Job Definitions

#### Job: sync-project-to-repo

| Trigger   | `project_v2_item` events |
| --------- | ------------------------ |
| `runs-on` | `ubuntu-latest`          |

Steps:

1. Extract Item changes from `github.event.changes`
2. Query Item `content` to get Issue/PR node_id
3. Map Project field changes to REST API calls
4. Update Issue/PR via REST API

#### Job: sync-repo-to-project

| Trigger   | Issue/PR `edited`, `labeled`, `assigned`, `closed` |
| --------- | -------------------------------------------------- |
| `runs-on` | `ubuntu-latest`                                    |

Steps:

1. Extract Issue/PR changes from `github.event`
2. Query `gh api graphql` to find Project Item by content_id
3. Map repository field changes to ProjectV2 field mutations
4. Update Project Item via GraphQL

### 5.6 Loop Prevention

To prevent infinite sync loops:

```yaml
env:
  SYNC_SOURCE: ${{ github.event_name == 'project_v2_item' && 'project' || 'repository' }}
```

Both jobs check `SYNC_SOURCE` and skip updates that would cause circular updates.

### 5.7 Permissions

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
```

### 5.8 Required Secrets

| Secret               | Scope                                         |
| -------------------- | --------------------------------------------- |
| `ADD_TO_PROJECT_PAT` | `project` (read+write)                        |
| `GH_TOKEN`           | `repo`, `issues:write`, `pull_requests:write` |

---

## 6. Secrets & Token Configuration

### 6.1 Required GitHub Secrets

| Secret Name          | Type                                   | Required Scopes                                                            | Used By                          |
| -------------------- | -------------------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| `ADD_TO_PROJECT_PAT` | Fine-grained PAT                       | `project` (read+write, organization `Cho-Geer`)                            | auto-project.yml, state-sync.yml |
| `GH_TOKEN`           | Fine-grained PAT or use `GITHUB_TOKEN` | `repo` (contents:read, issues:write, pull_requests:write, workflows:write) | auto-pr.yml, doc-decompose.yml   |

### 6.2 Repository Variables

| Variable Name | Value                                 | Description                      |
| ------------- | ------------------------------------- | -------------------------------- |
| `PROJECT_ID`  | `PVT_kwDOA...` (ProjectV2 GraphQL ID) | Opencode_framework Project #2 ID |

### 6.3 Token Scope Justification

| Scope                 | Reason                                               |
| --------------------- | ---------------------------------------------------- |
| `contents:read`       | Checkout repository for parsing docs                 |
| `issues:write`        | Create Issues from doc decomposition                 |
| `pull_requests:write` | Create PRs from doc decomposition + auto-pr          |
| `workflows:write`     | Allow workflow to dispatch other workflows if needed |
| `project` (org-level) | GraphQL mutations on Opencode_framework Project #2   |

---

## 7. Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          work-one Repository                          │
│                                                                       │
│  ┌─────────────────┐                                                 │
│  │ docs/review/**  │──── push ────┐                                  │
│  │ (YAML frontmatter│              │                                  │
│  │  + markdown)     │              ▼                                  │
│  └─────────────────┘    ┌──────────────────┐                         │
│                          │ doc-decompose.yml │                        │
│  ┌─────────────────┐    │  Parse frontmatter│                        │
│  │ work-one branch  │    │  Create Issue / PR│                       │
│  │     push         │    └───────┬──────────┘                         │
│  └────────┬────────┘            │                                    │
│           │                      │ Issue/PR created (opened event)     │
│           ▼                      ▼                                    │
│  ┌──────────────────┐  ┌──────────────────┐                          │
│  │  auto-pr.yml      │  │ auto-project.yml │                          │
│  │  Create PR:       │  │  Add to          │                          │
│  │  work-one→develop │  │  Project #2      │                          │
│  └──────────────────┘  └───────┬──────────┘                          │
│                                 │                                     │
│                                 ▼                                     │
│                        ┌──────────────────┐                          │
│                        │  state-sync.yml   │                          │
│                        │  Bidirectional    │                          │
│                        │  P ←→ R sync      │                          │
│                        └──────────────────┘                          │
│                                 │                                     │
└─────────────────────────────────┼─────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Opencode_framework Project #2                     │
│                        (Cho-Geer / organization)                      │
│                                                                       │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐                         │
│  │  Issue   │  │    PR    │  │   Draft    │                          │
│  │  Item    │  │   Item   │  │   Issue    │                          │
│  └──────────┘  └──────────┘  └────────────┘                         │
│                                                                       │
│  Fields: Status, Priority, Labels (custom), Assignees, Milestone     │
│  Views: Table / Board / Roadmap                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. Error Handling & Edge Cases

### 8.1 auto-pr.yml

| Scenario                   | Handling                                            |
| -------------------------- | --------------------------------------------------- |
| PR already exists          | Skip creation, log info, exit 0                     |
| No diff between branches   | PR created but empty (acceptable — reviewer closes) |
| `gh` CLI not authenticated | Job fails with clear error message                  |
| work-one branch deleted    | N/A — push trigger won't fire                       |

### 8.2 doc-decompose.yml

| Scenario                  | Handling                                               |
| ------------------------- | ------------------------------------------------------ |
| No YAML frontmatter       | Skip file with warning log                             |
| Invalid `type` value      | Skip file with error log                               |
| Missing `title`           | Skip file with error log                               |
| `type: problem+solution`  | Create Issue first, then PR with `Closes #N` reference |
| Issue creation fails      | Log error, do not block PR creation                    |
| Multiple docs in one push | Process sequentially, log per-file status              |

### 8.3 auto-project.yml

| Scenario                      | Handling                                          |
| ----------------------------- | ------------------------------------------------- |
| Item already in Project       | GraphQL errors gracefully (check before add)      |
| `PROJECT_ID` variable missing | Job fails with clear error                        |
| PAT expired                   | Job fails — admin must rotate secret              |
| Issue created with label      | auto-project.yml fires first; labels synced later |

### 8.4 state-sync.yml

| Scenario                        | Handling                                                  |
| ------------------------------- | --------------------------------------------------------- |
| Infinite loop (P↔R↔P↔R...)      | Skip updates when `github.actor == 'github-actions[bot]'` |
| Project Item not linked to repo | Skip sync (Draft Issue — no repo content)                 |
| Field update conflict           | Last-write-wins (acceptable for non-critical fields)      |
| Permission denied               | Log error with required scope                             |

---

## 9. Implementation Order & Dependencies

```
Phase 1 (Infrastructure):
  1. auto-pr.yml          ← No dependencies, simplest workflow
  2. auto-project.yml     ← Needs PROJECT_ID variable + ADD_TO_PROJECT_PAT

Phase 2 (Documentation Pipeline):
  3. doc-decompose.yml    ← Depends on GH_TOKEN with issues/PR scopes
                            Depends on YAML frontmatter standard being adopted

Phase 3 (Sync):
  4. state-sync.yml       ← Depends on auto-project.yml being operational
                            Most complex — implement with loop guard
```

---

## 10. Guardrails & Constraints

### 10.1 Security

- `ADD_TO_PROJECT_PAT` must be a **fine-grained PAT** scoped to only the `Opencode_framework` project, not a classic PAT with broad repo access
- `GITHUB_TOKEN` permissions are scoped per-job (principle of least privilege)
- Never log token values — use `--jq` instead of raw output where possible

### 10.2 Reliability

- All workflows use `ubuntu-latest` runner (GitHub-hosted, no maintenance)
- `gh` CLI is pre-installed on GitHub runners — no setup needed
- GraphQL queries use `--jq` for structured output parsing
- Concurrency groups prevent duplicate runs

### 10.3 Maintainability

- Each workflow is a single-responsibility `.yml` file
- Shared GraphQL queries can be extracted to a `.github/scripts/` helper
- YAML frontmatter standard is documented in this architecture design (Section 3.3)

---

## Appendix A: Project ID Resolution

To obtain the `PROJECT_ID` for `Opencode_framework` Project #2:

```bash
# 1. Find the ProjectV2 node ID
gh api graphql -f query='
  query($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        id
        title
      }
    }
  }' -f login="Cho-Geer" -f number=2

# 2. Store in repository variable
gh variable set PROJECT_ID --body "PVT_kwDOA..." --repo Cho-Geer/work-one
```

## Appendix B: Status Field ID Resolution

To obtain custom field IDs for `updateProjectV2ItemFieldValue`:

```bash
gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options {
                id
                name
              }
            }
            ... on ProjectV2Field {
              id
              name
            }
          }
        }
      }
    }
  }' -f projectId="$PROJECT_ID"
```

## Appendix C: Reference Documents

| Document                 | Path                                                                 | Key Insights                                                                                                                |
| ------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GitHub Projects Overview | `docs/official_docs/devops/github/github-projects-overview.md`       | ProjectV2 Items (Issue/PR/DraftIssue), GraphQL mutations, bidirectional sync, field exceptions (Assignees/Labels/Milestone) |
| GitHub Actions Syntax    | `docs/official_docs/devops/docker/github-actions-workflow-syntax.md` | Event triggers, path filters, permissions, concurrency, service containers                                                  |
