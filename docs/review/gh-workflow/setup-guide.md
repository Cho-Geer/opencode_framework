# GitHub Workflow Setup Guide — Secrets & Token Configuration

> **Author**: @CI-CD-Agent
> **Date**: 2026-06-19
> **Task**: T-GH-WF-CFG-006
> **Design Reference**: `docs/review/gh-workflow/architecture-design.md`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Required GitHub Secrets](#2-required-github-secrets)
3. [Required Repository Variables](#3-required-repository-variables)
4. [Complete Workflow Configuration Checklist](#4-complete-workflow-configuration-checklist)
5. [Step-by-Step Setup Guide](#5-step-by-step-setup-guide)
6. [Verification Steps](#6-verification-steps)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Overview

本项目（`Cho-Geer/work-one`）包含 4 个 GitHub Actions Workflows，需要以下凭证和配置：

| Resource             | Type                                      | Count | Used By                          |
| -------------------- | ----------------------------------------- | ----- | -------------------------------- |
| `ADD_TO_PROJECT_PAT` | Secret (Fine-grained PAT)                 | 1     | auto-project.yml, state-sync.yml |
| `GH_TOKEN`           | Secret (Fine-grained PAT or GITHUB_TOKEN) | 1     | All 4 workflows                  |
| `PROJECT_ID`         | Variable                                  | 1     | auto-project.yml, state-sync.yml |

**Repository**: `Cho-Geer/work-one`
**Target Project**: `Opencode_framework` (Project #2, owned by `Cho-Geer`)
**Branch**: `work-one` → `develop`

---

## 2. Required GitHub Secrets

### 2.1 `ADD_TO_PROJECT_PAT` — Project Access Token

**Type**: Fine-grained Personal Access Token  
**Purpose**: GraphQL mutations on `Opencode_framework` Project #2  
**Used by**: `auto-project.yml`, `state-sync.yml`

#### Required Permissions

| Category | Permission     | Level                     | Reason                                                            |
| -------- | -------------- | ------------------------- | ----------------------------------------------------------------- |
| Projects | Read and write | Organization (`Cho-Geer`) | `addProjectV2ItemById`, `updateProjectV2ItemFieldValue` mutations |
| Metadata | Read           | Repository                | Required for project membership                                   |

#### How to Create

> **Navigation**: GitHub.com → Settings → Developer Settings → Personal access tokens → Fine-grained tokens → [Generate new token]

1. **Token name**: `ADD_TO_PROJECT_PAT` (or any descriptive name like `work-one-project-token`)

2. **Expiration**: Choose an appropriate expiration (recommended: 90 days, or "No expiration" for CI automation)

3. **Resource owner**: `Cho-Geer`

4. **Repository access**: Only select repositories → select `Cho-Geer/work-one`

5. **Permissions**:
   - **Projects** → **Read and write** (Required for `addProjectV2ItemById` mutation)
   - **Metadata** → **Read** (automatically included when any repository permission is granted)

6. **Generate token** and copy the token value immediately (it will not be shown again).

7. **Save to repository secrets**:
   - Navigate to: `Cho-Geer/work-one` → Settings → Secrets and variables → Actions
   - Click **New repository secret**
   - **Name**: `ADD_TO_PROJECT_PAT`
   - **Secret**: Paste the token value
   - Click **Add secret**

> ⚠️ **Security note**: This PAT must be a **fine-grained PAT** scoped only to the `Opencode_framework` project, not a classic PAT with broad repo access. Fine-grained PATs limit blast radius if leaked.

> ⚠️ **No graceful degradation**: If this token expires or is misconfigured, `auto-project.yml` and `state-sync.yml` will fail. Set a calendar reminder to rotate the token before expiration.

---

### 2.2 `GH_TOKEN` — General GitHub Access Token

**Type**: Fine-grained Personal Access Token (or `GITHUB_TOKEN` if sufficient)  
**Purpose**: `gh` CLI authentication for PR creation, issue management, and API calls  
**Used by**: All 4 workflows (auto-pr.yml, doc-decompose.yml, auto-project.yml, state-sync.yml)

#### Required Permissions

| Scope                | auto-pr.yml | doc-decompose.yml | auto-project.yml | state-sync.yml |
| -------------------- | :---------: | :---------------: | :--------------: | :------------: |
| Contents: read       |     ✅      |        ✅         |        ✅        |       ✅       |
| Pull requests: write |     ✅      |        ✅         |        —         |       ✅       |
| Issues: write        |      —      |        ✅         |        —         |       ✅       |
| Metadata: read       |     ✅      |        ✅         |        ✅        |       ✅       |

#### Consolidated Permission Set

The minimum required scope across all workflows:

| Scope           | Value   | Reason                                                                                    |
| --------------- | ------- | ----------------------------------------------------------------------------------------- |
| `contents`      | `read`  | Repository checkout, git operations                                                       |
| `pull_requests` | `write` | PR creation (auto-pr.yml), PR body updates (state-sync.yml)                               |
| `issues`        | `write` | Issue creation from doc decomposition (doc-decompose.yml), Issue updates (state-sync.yml) |
| `metadata`      | `read`  | Read repository metadata (included when any scope is granted)                             |

#### Using `GITHUB_TOKEN` vs Custom PAT

Two options are available:

| Aspect           | `GITHUB_TOKEN`                                | Custom PAT                                      |
| ---------------- | --------------------------------------------- | ----------------------------------------------- |
| **Availability** | Automatically available in every workflow run | Must be manually created and stored as Secret   |
| **Scope**        | Limited to the current repository             | Can access other repositories and organizations |
| **Cross-repo**   | ❌ Not supported                              | ✅ Required for cross-repo operations           |
| **Projects API** | ❌ Does NOT support project GraphQL mutations | ✅ Required for `ADD_TO_PROJECT_PAT` features   |
| **Expiration**   | Per-workflow run (no rotation needed)         | Set expiration (needs rotation)                 |

**Recommendation**: Use `GITHUB_TOKEN` for `auto-pr.yml` and `doc-decompose.yml` if they only need single-repo access. For `auto-project.yml` and `state-sync.yml`, the `ADD_TO_PROJECT_PAT` handles project operations while `GITHUB_TOKEN` handles repo operations.

If a custom `GH_TOKEN` is required, create a Fine-grained PAT with the permissions listed above and save it as a repository secret.

#### How to Create (if custom PAT is needed)

1. **Navigation**: GitHub.com → Settings → Developer Settings → Personal access tokens → Fine-grained tokens → [Generate new token]

2. **Token name**: `GH_TOKEN_WORKFLOW`

3. **Expiration**: 90 days (recommended)

4. **Resource owner**: `Cho-Geer`

5. **Repository access**: Only select repositories → `Cho-Geer/work-one`

6. **Permissions**:
   - **Contents** → **Read-only**
   - **Pull requests** → **Read and write**
   - **Issues** → **Read and write**
   - **Metadata** → **Read-only** (automatic)

7. Generate, copy, and save as repository secret `GH_TOKEN`.

---

## 3. Required Repository Variables

### 3.1 `PROJECT_ID` — Opencode_framework Project #2 ID

**Type**: Repository Variable  
**Purpose**: GraphQL Node ID for the `Opencode_framework` Project V2  
**Used by**: `auto-project.yml`, `state-sync.yml`

#### How to Obtain

Run the following GraphQL query to retrieve the ProjectV2 ID:

```bash
gh api graphql -f query='
  query($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        id
        title
      }
    }
  }
' -f login="Cho-Geer" -F number=2
```

**Expected output**:

```json
{
  "data": {
    "user": {
      "projectV2": {
        "id": "PVT_kwDOA...",
        "title": "Opencode_framework"
      }
    }
  }
}
```

The `id` field (e.g., `PVT_kwDOA...`) is the `PROJECT_ID`.

#### How to Set

```bash
# Set the repository variable
gh variable set PROJECT_ID \
  --body "PVT_kwDOA..." \
  --repo Cho-Geer/work-one
```

Or via GitHub UI:

1. Navigate to: `Cho-Geer/work-one` → Settings → Secrets and variables → Actions → Variables
2. Click **New repository variable**
3. **Name**: `PROJECT_ID`
4. **Value**: Paste the GraphQL ID (e.g., `PVT_kwDOA...`)
5. Click **Add variable**

#### Additional GraphQL Queries for Custom Fields

If you need to set custom field values (Status, Priority, etc.) in the state-sync workflow, you also need the field IDs:

```bash
# Get field IDs for the Status single-select field
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
  }
' -f projectId="PVT_kwDOA..."
```

This returns field IDs and option IDs needed for status mutations:

```json
{
  "data": {
    "node": {
      "fields": {
        "nodes": [
          {
            "id": "FIELD_ID_1",
            "name": "Status",
            "options": [
              { "id": "OPTION_1", "name": "Todo" },
              { "id": "OPTION_2", "name": "In Progress" },
              { "id": "OPTION_3", "name": "Done" }
            ]
          }
        ]
      }
    }
  }
}
```

---

## 4. Complete Workflow Configuration Checklist

### 4.1 Configuration Matrix

| Workflow            | Trigger                            | Secrets Needed                   | Variables Needed | Permissions Required                                      |
| ------------------- | ---------------------------------- | -------------------------------- | ---------------- | --------------------------------------------------------- |
| `auto-pr.yml`       | Push to `work-one`                 | `GH_TOKEN`                       | None             | `contents: read`, `pull-requests: write`                  |
| `doc-decompose.yml` | Push to `docs/review/**`           | `GH_TOKEN`                       | None             | `contents: read`, `issues: write`, `pull-requests: write` |
| `auto-project.yml`  | Issue/PR `opened`                  | `ADD_TO_PROJECT_PAT`, `GH_TOKEN` | `PROJECT_ID`     | `contents: read`                                          |
| `state-sync.yml`    | `project_v2_item`, Issue/PR events | `ADD_TO_PROJECT_PAT`, `GH_TOKEN` | `PROJECT_ID`     | `contents: read`, `issues: write`, `pull-requests: write` |

### 4.2 Visual Dependency

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│    Secrets       │     │    Variables       │     │   Workflows      │
├─────────────────┤     ├───────────────────┤     ├──────────────────┤
│ ADD_TO_PROJECT_ │────>│ PROJECT_ID        │────>│ auto-project.yml  │
│ _PAT            │     │                   │     │ state-sync.yml    │
├─────────────────┤     └───────────────────┘     ├──────────────────┤
│ GH_TOKEN        │──────────────────────────────>│ ALL workflows     │
└─────────────────┘                                └──────────────────┘
```

---

## 5. Step-by-Step Setup Guide

### Phase 1: Create the Fine-grained PAT

> **Estimated time**: 10 minutes  
> **Navigation**: https://github.com/settings/tokens?type=beta

| Step | Action                          | Details                                                                                      |
| ---- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| 1.1  | Navigate to Fine-grained tokens | Settings → Developer settings → Personal access tokens → Fine-grained tokens                 |
| 1.2  | Click "Generate new token"      |                                                                                              |
| 1.3  | Set token name                  | `ADD_TO_PROJECT_PAT`                                                                         |
| 1.4  | Set expiration                  | `90 days` (set calendar reminder for renewal)                                                |
| 1.5  | Select resource owner           | `Cho-Geer`                                                                                   |
| 1.6  | Repository access               | `Only select repositories` → choose `Cho-Geer/work-one`                                      |
| 1.7  | Set permissions                 | **Projects**: `Read and write`                                                               |
| 1.8  | Click "Generate token"          |                                                                                              |
| 1.9  | **Copy token value**            | ⚠️ This is the only time you can see it!                                                     |
| 1.10 | Save to secrets                 | `Cho-Geer/work-one` → Settings → Secrets → Actions → New secret → Name: `ADD_TO_PROJECT_PAT` |

### Phase 2: Obtain and Set PROJECT_ID

> **Estimated time**: 5 minutes  
> **Requirement**: `gh` CLI authenticated with access to both the repository and project

| Step | Action                  | Command                                                                                                                    |
| ---- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Verify `gh` CLI auth    | `gh auth status`                                                                                                           |
| 2.2  | Query ProjectV2 ID      | `gh api graphql -f query='query($l:String!,$n:Int!){user(login:$l){projectV2(number:$n){id title}}}' -f l=Cho-Geer -f n=2` |
| 2.3  | Set repository variable | `gh variable set PROJECT_ID --body "PVT_kwDOA..." --repo Cho-Geer/work-one`                                                |
| 2.4  | Verify variable         | `gh variable list --repo Cho-Geer/work-one`                                                                                |

### Phase 3: Configure GH_TOKEN

> **Estimated time**: 5 minutes  
> **If using `GITHUB_TOKEN`**: No action needed — it's automatically available.

If a custom PAT is required (see Section 2.2 for decision guidance):

| Step | Action                  | Details                                                                          |
| ---- | ----------------------- | -------------------------------------------------------------------------------- |
| 3.1  | Create Fine-grained PAT | Same process as Phase 1, but with different permissions                          |
| 3.2  | Set permissions         | Contents: `Read-only`, Pull requests: `Read and write`, Issues: `Read and write` |
| 3.3  | Save as `GH_TOKEN`      | Repository secret: name=`GH_TOKEN`                                               |

### Phase 4: Verify All Configuration

> **Estimated time**: 5 minutes

| Step | Check             | How                                                                                                                         |
| ---- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | Secret exists     | `gh secret list --repo Cho-Geer/work-one` — verify `ADD_TO_PROJECT_PAT` and `GH_TOKEN` are listed                           |
| 4.2  | Variable exists   | `gh variable list --repo Cho-Geer/work-one` — verify `PROJECT_ID` is listed                                                 |
| 4.3  | PAT scope correct | `gh api user --jq .login` — token is authenticated                                                                          |
| 4.4  | PAT permissions   | Test via `gh api graphql -f query='query{user(login:"Cho-Geer"){projectV2(number:2){title}}}'` — should return project data |

---

## 6. Verification Steps

### 6.1 Workflow-Specific Verification

#### `auto-pr.yml`

| #   | Test                      | Expected Result                    | How to Test                                |
| --- | ------------------------- | ---------------------------------- | ------------------------------------------ |
| 1   | Push to `work-one` branch | Workflow triggers                  | `git push origin work-one`                 |
| 2   | Check PR already exists   | "Skip (PR already exists)" message | Push again without changes                 |
| 3   | PR created                | New PR from `work-one` → `develop` | Check Pull Requests tab                    |
| 4   | GH_TOKEN authenticated    | PR creation succeeds               | Check workflow run logs for `gh pr create` |

#### `doc-decompose.yml`

| #   | Test                        | Expected Result                  | How to Test                                                  |
| --- | --------------------------- | -------------------------------- | ------------------------------------------------------------ |
| 1   | Push a doc with frontmatter | Workflow triggers                | Push a new doc to `docs/review/` with valid YAML frontmatter |
| 2   | `type: problem`             | New Issue created                | Check Issues tab                                             |
| 3   | `type: solution`            | New PR created                   | Check Pull Requests tab                                      |
| 4   | `type: problem+solution`    | Both Issue and linked PR created | Check both tabs with cross-reference                         |
| 5   | Missing frontmatter         | Skip file with warning log       | Push doc without frontmatter                                 |

#### `auto-project.yml`

| #   | Test                 | Expected Result             | How to Test                                    |
| --- | -------------------- | --------------------------- | ---------------------------------------------- |
| 1   | Create new Issue     | Issue appears in Project #2 | Create a test Issue in the repo                |
| 2   | Create new PR        | PR appears in Project #2    | Create a test PR                               |
| 3   | `PROJECT_ID` invalid | Job fails with clear error  | Temporarily invalidate variable (then restore) |
| 4   | PAT expired          | Job fails                   | Check after token expiration date              |
| 5   | Duplicate add        | GraphQL errors gracefully   | Re-run for already-added item                  |

#### `state-sync.yml`

| #   | Test                     | Expected Result              | How to Test                                            |
| --- | ------------------------ | ---------------------------- | ------------------------------------------------------ |
| 1   | Edit Issue title in repo | Project Item title updates   | Edit Issue title → check Project                       |
| 2   | Change Status in Project | Issue/PR state updates       | Change "Status" field in Project → check Issue         |
| 3   | Add label to Issue       | Project custom field updates | Add label to Issue → check Project                     |
| 4   | Close Issue              | Project Status → "Done"      | Close Issue → check Project                            |
| 5   | Loop prevention          | No circular updates          | Check SYNC_SOURCE logic and `github-actions[bot]` skip |

### 6.2 Quick Health Check

After configuration, run this comprehensive check:

```bash
#!/bin/bash
# GitHub Workflow Configuration Health Check
REPO="Cho-Geer/opencode_framework"

echo "=== GitHub Workflow Configuration Health Check ==="
echo ""

# Check Secrets
echo "--- Secrets ---"
gh secret list --repo "$REPO"
echo ""

# Check Variables
echo "--- Variables ---"
gh variable list --repo "$REPO"
echo ""

# Check PROJECT_ID validity
echo "--- PROJECT_ID Test ---"
PROJECT_ID=$(gh variable get PROJECT_ID --repo "$REPO")
if [ -n "$PROJECT_ID" ]; then
  echo "PROJECT_ID is set: ${PROJECT_ID:0:20}..."
  gh api graphql -f query="query{node(id:\"$PROJECT_ID\"){...on ProjectV2{title}}}" --jq '.data.node.title' && echo "✅ Project accessible" || echo "❌ Project not accessible"
else
  echo "❌ PROJECT_ID is empty"
fi
echo ""

echo "=== Health Check Complete ==="
```

### 6.3 End-to-End Integration Test

After all workflows are deployed, verify the complete pipeline:

1. **Push to `work-one`** → triggers `auto-pr.yml` → creates PR to `develop`
2. **PR creation** → triggers `auto-project.yml` → adds PR to Project #2
3. **Modify PR title** → triggers `state-sync.yml` → updates Project Item title
4. **Push a doc** → triggers `doc-decompose.yml` → creates Issue/PR
5. **Issue creation** → triggers `auto-project.yml` → adds Issue to Project #2
6. **Close Issue** → triggers `state-sync.yml` → updates Project Status → "Done"

---

## 7. Troubleshooting

### 7.1 Common Issues

| Symptom                                                            | Likely Cause                                   | Solution                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `gh pr create` fails with "Resource not accessible by integration" | `GH_TOKEN` missing or insufficient permissions | Verify `GH_TOKEN` is set and has `pull-requests: write` scope            |
| `addProjectV2ItemById` mutation fails with "401"                   | `ADD_TO_PROJECT_PAT` expired or invalid        | Regenerate token and update the secret                                   |
| `addProjectV2ItemById` mutation fails with "403"                   | PAT lacks `project: write` permission          | Update PAT permissions → add "Projects: Read and write"                  |
| `updateProjectV2ItemFieldValue` fails with "Field not found"       | `PROJECT_ID` is wrong, or field IDs are wrong  | Re-query the field IDs using the GraphQL query in Section 3.1            |
| Workflow not triggering                                            | Branch/event condition not met                 | Check `on:` triggers in the workflow file vs actual event                |
| `Variable PROJECT_ID is not set`                                   | `PROJECT_ID` not configured                    | Set via `gh variable set` or GitHub UI                                   |
| Item already in Project                                            | Duplicate addition attempt                     | Graceful — GraphQL returns error but job continues                       |
| Infinite sync loop                                                 | `state-sync.yml` updates causing re-trigger    | Check `github.actor == 'github-actions[bot]'` skip logic in the workflow |
| Action not found (e.g., `actions/checkout@v6`)                     | Action version doesn't exist                   | Check available versions at `https://github.com/marketplace`             |

### 7.2 PAT Expiration FAQ

**Q: What happens when `ADD_TO_PROJECT_PAT` expires?**

The `auto-project.yml` and `state-sync.yml` workflows will fail with authentication errors. New Issues/PRs will not be added to the Project automatically.

**Q: How to rotate the token?**

1. Create a new Fine-grained PAT (same permissions as Section 2.1)
2. Update the `ADD_TO_PROJECT_PAT` repository secret with the new value
3. The old token continues working for in-progress workflow runs; new runs use the new token immediately

**Q: Can I set "No expiration"?**

Yes, but this is not recommended for security best practices. If you must, ensure:

- The token is used only from GitHub Actions (never from local machines)
- Access is periodically audited

### 7.3 Debug Commands

```bash
# Verify token authentication
gh auth status

# Check which repositories a token can access
gh api user/repos --jq '.[].full_name'

# List all secrets (verify names)
gh secret list --repo Cho-Geer/work-one

# Get a specific secret's last update time
gh secret list --repo Cho-Geer/work-one --json name,updated_at

# Test project access
gh api graphql -f query='
  query {
    user(login: "Cho-Geer") {
      projectV2(number: 2) {
        id
        title
        items(first: 5) {
          totalCount
        }
      }
    }
  }
'

# Dry-run workflow dispatch (requires workflow_dispatch trigger)
gh workflow run auto-pr.yml --ref work-one --dry-run
```

### 7.4 Support Escalation

If configuration issues persist after following this guide:

1. **Check workflow run logs**: GitHub → Actions → Select workflow run → View raw logs
2. **Verify secret scopes**: GitHub → Settings → Developer settings → Fine-grained tokens → Inspect token permissions
3. **GitHub API status**: Check [GitHub Status](https://www.githubstatus.com/) for ongoing incidents
4. **Contact**: Repository administrator (`Cho-Geer`) for PAT creation and project access permissions

---

## Appendix A: Secret Names vs Variable Names

| Category | Name                 | Type                         | Example Value                             |
| -------- | -------------------- | ---------------------------- | ----------------------------------------- |
| Secret   | `ADD_TO_PROJECT_PAT` | `secrets.ADD_TO_PROJECT_PAT` | `github_pat_...`                          |
| Secret   | `GH_TOKEN`           | `secrets.GH_TOKEN`           | `github_pat_...` or `${{ github.token }}` |
| Variable | `PROJECT_ID`         | `vars.PROJECT_ID`            | `PVT_kwDOA...`                            |

## Appendix B: Workflow Permission Comparison

```
                    ┌──────────────────────────────────────┐
                    │        Organization Level             │
                    │  ADD_TO_PROJECT_PAT: Project R+W      │
                    └──────────┬───────────────────────────┘
                               │
                    ┌──────────▼───────────────────────────┐
                    │        Repository Level               │
                    │  GH_TOKEN: repo, issues, PRs          │
                    │  GITHUB_TOKEN: auto (repo-scoped)     │
                    └──────────┬───────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  auto-pr.yml     │ │  doc-decompose   │ │  auto-project    │
│  Uses: GH_TOKEN  │ │  Uses: GH_TOKEN  │ │  + state-sync    │
│                  │ │                  │ │  Uses: BOTH      │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

## Appendix C: Security Best Practices

1. **Least privilege**: Use fine-grained PATs with the minimum required scopes
2. **Ephemeral tokens**: Prefer `GITHUB_TOKEN` where possible (auto-generated, per-run)
3. **Token rotation**: Set expiration ≤ 90 days with calendar reminders
4. **Audit logging**: GitHub Audit Log tracks PAT usage — periodically review
5. **No hardcoding**: Never embed tokens in workflow files, code, or documentation
6. **Environment isolation**: Use GitHub Environments for environment-specific secrets

---

> **Note**: This guide was generated as part of the GitHub Workflow implementation task T-GH-WF-CFG-006. The final document was moved to `docs/review/gh-workflow/setup-guide.md` by the Architect agent (MOVE-SETUP-GUIDE-001).
