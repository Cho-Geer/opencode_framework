# GitHub Issue↔PR Auto-Linking Solution for OpenCode Multi-Agent Framework

> **Target Path**: `docs/review/gh-workflow/issue-pr-auto-link-solution.md`
> **Original Author**: @Coder-FE
> **Audited**: 2026-06-21 @Super-Admin (verified against live framework: workflows, `safe_shell`, `writeLog`, `opencode.json`, P1-B sub-state, dispatch/UC7KS subsystems)
> **Date**: 2026-06-21
> **Status**: Reviewed — corrected against live framework code. Tier 1 partially adopted (`doc-decompose.yml`); `auto-pr.yml` gap identified. Tier 2.4 (GitHub Projects) already wired via `auto-project.yml` + `state-sync.yml`. Tier 2 tool (`link_issue_pr`) not yet implemented.

## 1. Overview

GitHub Issues and Pull Requests (PRs) are the primary work-tracking and code-review primitives in the OpenCode multi-agent framework's CI/CD pipeline. Establishing automatic, bidirectional links between Issues and PRs is essential for:

- **Traceability**: Every code change is linked to its originating requirement or bug report
- **Automation**: CI/CD workflows can query linked Issues to determine build/test scope
- **Project Management**: GitHub Projects board automation relies on Issue↔PR relationships
- **Audit Trail**: Multi-agent task execution evidence (TDD phases, review approvals) is anchored to Issues/PRs

This document analyzes the available linking mechanisms and recommends an approach for the OpenCode multi-agent framework.

---

## 2. Available Approaches

### 2.1 PR Description Keywords (Simplest)

GitHub natively supports auto-linking via keywords in PR descriptions:

| Keyword | Behavior |
|---------|----------|
| `Closes #N` | Closes linked Issue when PR is merged |
| `Fixes #N` | Closes linked Issue when PR is merged |
| `Resolves #N` | Closes linked Issue when PR is merged |
| `Ref #N` | Links without closing |

**Pros**:
- Zero automation overhead — works natively
- No API/CLI calls needed
- Human-readable in PR description

**Cons**:
- One-directional (PR → Issue only at creation time)
- Requires manual editing of PR body
- Cannot dynamically add links after PR creation
- No programmatic control over the link

### 2.2 GitHub CLI (`gh`) Sub-Issue Commands

The `gh` CLI supports parent-child Issue relationships:

```bash
# Create a sub-issue
gh issue create --title "Sub-task" --body "..." --parent 100

# Edit sub-issue links
gh issue edit 100 --add-sub-issue 123,124
gh issue edit 100 --remove-sub-issue 123
gh issue edit 23 --parent 100
gh issue edit 23 --remove-parent
```

**Pros**:
- Works in CI/CD (gh CLI is GitHub Actions pre-installed)
- Bidirectional parent-child relationship
- Programmatic control (scriptable via `safe_shell` allowlist or `gh api` wrapper)
- Can be called from OpenCode custom tools

**Cons**:
- Sub-issues are Issue→Issue only (not Issue↔PR directly)
- Requires `gh auth login` (token management via `GITHUB_TOKEN` or PAT)
- Sub-issue hierarchy limited to parent-child (no deep nesting)
- Available since gh CLI v2.42+ (2024)

**Framework adoption status (2026-06-21 audit)**: **Not used**. The current framework prefers PR-keyword closure (`Closes #N` in PR body) for Issue↔PR links (see §4.4 — `doc-decompose.yml`), and `gh issue create` without `--parent` for standalone issues. Sub-issue commands are available but have no integration point in any workflow under `.github/workflows/`.

### 2.3 GraphQL API (Most Flexible)

GitHub's GraphQL API provides full control over Issue↔PR relationships:

```graphql
# Link an Issue to a PR via ProjectV2
mutation {
  addProjectV2ItemById(input: {
    projectId: "PROJECT_ID"
    contentId: "ISSUE_OR_PR_ID"
  }) {
    item { id }
  }
}

# Query linked items
query {
  node(id: "PR_ID") {
    ... on PullRequest {
      closingIssuesReferences(first: 10) {
        nodes { number title state }
      }
    }
  }
}
```

**Pros**:
- Full programmatic control
- Bidirectional queries
- Supports all relationship types
- Can be integrated into OpenCode custom tools (`safe_shell` with `gh api`)

**Cons**:
- Requires GitHub PAT with appropriate scopes
- More complex than CLI approach
- Rate limiting considerations
- Need to handle pagination for large result sets

### 2.4 GitHub Projects Integration

GitHub Projects (v2) treats Issues and PRs as items with bidirectional sync:

| Feature | Description |
|---------|-------------|
| Item Types | Issue, Pull Request, Draft Issue |
| Sync | Bidirectional auto-sync between Project and Issue/PR |
| Multi-Project | One Issue/PR can belong to multiple Projects |
| API | `ProjectV2` GraphQL mutations for programmatic management |
| Limits | 50,000 items per Project; 50 fields per item |

**Pros**:
- Native GitHub integration
- Rich metadata (custom fields, status, priority)
- Board/Table/Roadmap views for human visibility
- Automation rules (e.g., auto-add to Project on label)

**Cons**:
- Adds Project management overhead
- ProjectV2 GraphQL API is verbose
- Not designed for pure programmatic Issue↔PR linking
- Best suited when a Project board is already in use

---

## 3. Comparison Matrix

| Criterion | PR Keywords (2.1) | `gh` CLI (2.2) | GraphQL API (2.3) | Projects (2.4) |
|-----------|:---:|:---:|:---:|:---:|
| Automation-ready | ❌ Manual | ✅ Scriptable | ✅ Full API | ✅ Rules + API |
| Bidirectional | ❌ PR→Issue only | ✅ Parent↔Child | ✅ Full query | ✅ Bidirectional |
| CI/CD Integration | ❌ | ✅ `gh` pre-installed | ✅ `gh api` or direct | ⚠️ Complex setup |
| Issue↔PR (direct) | ✅ | ❌ Issue↔Issue only | ✅ | ✅ |
| Learning Curve | ✅ Trivial | ⚠️ Medium | ❌ High | ⚠️ Medium |
| Rate Limit Impact | N/A | N/A | ⚠️ 5,000 pts/hr | ⚠️ Per mutation |

---

## 4. Recommended Approach for OpenCode Framework

### 4.1 Two-Tier Strategy

**Tier 1 — Immediate (PR Description Keywords)**
Use `Closes #N` / `Fixes #N` keywords in PR descriptions for the simple case: one PR resolves one Issue. This requires no automation and works immediately.

**Tier 2 — Advanced (GraphQL API + `gh` CLI hybrid)**

For multi-agent task orchestration where Issues and PRs have complex relationships:

1. **Issue Creation**: `gh issue create` with `--parent` for sub-task decomposition
2. **PR Linking**: GraphQL mutation to add `closingIssuesReferences` or update ProjectV2 items
3. **Status Query**: GraphQL query to check Issue closure status from CI/CD pipelines
4. **Tool Integration**: Wrap in OpenCode custom tools (`safe_shell` + `gh api graphql`)

### 4.2 Implementation Pattern (corrected)

The original draft used a fragile `grep -oP '#\K\d+'` extraction on PR body. The **existing `doc-decompose.yml` pattern** (line 253) is more reliable — it captures the issue number at creation time and splices the `Closes #N` keyword directly into the PR body:

```bash
#!/bin/bash
# Pattern from doc-decompose.yml:223-253 — authoritative for this framework.
# Run inside a GitHub Actions job with GITHUB_TOKEN pre-set.

# 1. Create the issue; capture the number immediately.
ISSUE_OUTPUT=$(retry gh issue create \
  --title "$ISSUE_TITLE" \
  --body "$ISSUE_BODY" \
  --label "$ISSUE_LABELS")
ISSUE_NUMBER=$(echo "$ISSUE_OUTPUT" | grep -oE '[0-9]+$')

# 2. Build PR body; append the Closes keyword only when the issue was created.
PR_BODY="## Document\n\n**File**: \`$file\`"
if [ -n "$ISSUE_NUMBER" ]; then
  PR_BODY="$PR_BODY\n\n---\n\nCloses #$ISSUE_NUMBER"
fi

# 3. Create PR (with retry for existing-PR check).
retry gh pr create --base "$PR_BASE" --head work-one \
  --title "$PR_TITLE" --body "$PR_BODY"
```

Why this is preferred over the previous §4.2 snippet:
- No regex on free-form PR body (eliminates false positives from `#123` in prose).
- Issue number comes from the same workflow run — no race with concurrent PRs.
- `retry` wrapper matches the `doc-decompose.yml:209` convention for transient `gh` failures.

### 4.3 OpenCode Custom Tool Integration

For the multi-agent framework, the proposed `link_issue_pr` tool must match the **actual OpenCode tool shape** used elsewhere in this repo (see `.opencode/tools/safe_shell.ts`, `resolve_domain_id.ts`, `knowledge_cache_attest.ts`). The previous draft used raw `zod` types — the framework uses `tool.schema.*`:

```typescript
// .opencode/tools/link_issue_pr.ts (proposed — not yet implemented)
import { tool } from "@opencode-ai/plugin";
import { writeLog } from "../lib/log-manager";

const SRC = "link-issue-pr";

export default tool({
  description:
    "Link a GitHub Issue to a Pull Request. Uses safe_shell-allowlisted " +
    "'gh' commands or 'gh api graphql' for ProjectV2 mutations. " +
    "Audit-logged via writeLog().",
  args: {
    issue_number: tool.schema.number().describe("Issue number to link"),
    pr_number: tool.schema.number().describe("Pull request number"),
    link_type: tool.schema
      .enum(["closes", "reference", "project-v2"])
      .describe(
        "closes: append 'Closes #N' to PR body; " +
          "reference: append 'Ref #N'; " +
          "project-v2: add both items to shared ProjectV2 via GraphQL",
      ),
    project_id: tool.schema
      .string()
      .optional()
      .describe("Required when link_type='project-v2'"),
  },
  async execute(args, context) {
    const agent = context.agent ?? "unknown";
    writeLog(SRC, "INFO", {
      event: "LINK-ISSUE-PR-REQUEST",
      agent,
      issue: args.issue_number,
      pr: args.pr_number,
      type: args.link_type,
    });
    // Delegate to safe_shell-allowlisted 'gh' invocation.
    // Returns { ok, detail, audit_event_id }.
    throw new Error("Not implemented — see §6 Next Steps");
  },
});
```

**Integration constraints** (must satisfy before merging):

| Constraint | Enforcement point | Requirement |
|-----------|------------------|-------------|
| Tool registration | `.opencode/config.json` (`mcp`/tools block) | Add `link_issue_pr` entry |
| Agent permissions | `.opencode/state/framework-authorities.json` + per-agent `agents/*.md` | Add to CI-CD-Agent and Orchestrator scope only |
| Shell allowlist | `.opencode/lib/safe-bash.ts` | Allowlist `gh pr edit`, `gh api graphql` patterns |
| Audit logging | `.opencode/lib/log-manager.ts` (`writeLog()`) | All mutations emit `LINK-ISSUE-PR-*` events to `.task_temp/_logs/{date}/plugin-{SRC}-{level}.log` |
| Compliance gate | `AGENTS.md` P0 rules | Any new tool triggers `/compliance-gate` before implementation |
| Framework self-test | `.opencode/scripts/framework-self-test.ts` | Add assertion that tool file and registration stay in sync |

### 4.4 Current Framework Adoption Matrix (2026-06-21 audit)

| Workflow file | Tier | Status | Linking mechanism |
|--------------|------|--------|-------------------|
| `.github/workflows/doc-decompose.yml` | Tier 1 | **Adopted** | `Closes #$ISSUE_NUMBER` in PR body (line 253) |
| `.github/workflows/auto-pr.yml` | Tier 1 | **Gap** | Generic body, no Issue linking — candidate for §6 fix |
| `.github/workflows/auto-project.yml` | Tier 2.4 | **Adopted** | `actions/add-to-project@v2` for new issues/PRs |
| `.github/workflows/state-sync.yml` | Tier 2.4 | **Adopted** | ProjectV2 GraphQL via `ADD_TO_PROJECT_PAT` (line 195-196) |
| `.github/workflows/ci.yml` | — | N/A | Runs framework-self-test; no PR creation |
| `.github/workflows/framework-ci.yml` | — | N/A | Infra checks; no PR creation |
| `.github/workflows/nightly-compaction.yml` | — | N/A | Maintenance; no PR creation |

### 4.5 Secret Inventory (corrected)

| Secret | Used by | Scope | Notes |
|--------|---------|-------|-------|
| `GITHUB_TOKEN` (built-in) | `auto-pr.yml`, `doc-decompose.yml` | `issues:write`, `pull_requests:write` | Sufficient for Tier 1 keyword-based linking |
| `ADD_TO_PROJECT_PAT` (user-managed) | `auto-project.yml`, `state-sync.yml` | `project:read+write` (org-level) | Required for Tier 2.4 ProjectV2 mutations |
| `GH_PAT` | **Not used in this repo** | — | Referenced in earlier draft only; do not introduce |

---

## 5. Security & Token Considerations

| Concern | Mitigation |
|---------|-----------|
| GitHub PAT Scope | Use fine-grained PAT with `issues:write`, `pull_requests:write`, `project:read+write` only (see `docs/official_docs/devops/github/github-fine-grained-pat-permissions-deep.md`) |
| Token Storage | GitHub Actions secrets: `GITHUB_TOKEN` (built-in, Tier 1) + `ADD_TO_PROJECT_PAT` (user-managed, Tier 2.4). Do **not** introduce a new `GH_PAT` secret. |
| Token Rotation | Rotate `ADD_TO_PROJECT_PAT` every 90 days; audit via sub-state file audit trail (see `.opencode/lib/db-state-manager.ts`, P1-B split architecture) |
| Rate Limiting | Batch GraphQL queries; cache ProjectV2 item IDs for 60s in `.task_temp/_cache/` |
| Audit Trail | All linking mutations logged via `writeLog(SRC, level, {...})` → `.task_temp/_logs/{date}/plugin-link-issue-pr-{level}.log`. Read-only queries are not logged (matches `knowledge_cache_search.ts` convention). |

---

## 6. Next Steps

Prioritized by impact and blast radius. All implementation must follow the `AGENTS.md` P0 compliance gate and `/compliance-gate` protocol.

| # | Priority | Item | Owner | Notes |
|---|----------|------|-------|-------|
| 1 | **P1 — Immediate** | Close Tier-1 gap in `.github/workflows/auto-pr.yml`: extract issue number from branch name (`feature/<issue>-<slug>`) or first conventional-commit trailer (`Refs: #N`) and append `Closes #N` to the PR body (line 48). Pattern must mirror `doc-decompose.yml:223-253`. | @CI-CD-Agent via `dispatch_subagent` | Smallest change, largest traceability gain. |
| 2 | P2 — Short-term | Add `retry` helper to `auto-pr.yml` (match `doc-decompose.yml:209`) for transient `gh pr create` failures. | @CI-CD-Agent | Low risk. |
| 3 | P3 — Medium-term | Implement `.opencode/tools/link_issue_pr.ts` per §4.3 shape. Register in `.opencode/config.json`; add to CI-CD-Agent + Orchestrator scope in `framework-authorities.json`; add self-test assertion in `framework-self-test.ts`. | @Super-Admin (framework file edits) + @Coder-BE (tool impl) | Requires `/compliance-gate`. |
| 4 | P4 — Long-term | Evaluate whether Tier 2.4 (ProjectV2) should replace Tier-1 `Closes` keyword for the framework's own issues — current split (Tier 1 for code, Tier 2.4 for visibility) is adequate; revisit only if Projects board becomes source of truth. | @Orchestrator | No code change required today. |

### 6.1 Subsystem compliance checklist (for any future implementation)

- [ ] **Plugin subsystem**: `export default tool({...})` from `@opencode-ai/plugin`; no MCP server (matches `safe_shell.ts`, `resolve_domain_id.ts`).
- [ ] **Tool subsystem**: args via `tool.schema.*` (not raw `zod`); description string ≥ 50 chars.
- [ ] **Lib subsystem**: `writeLog()` for all mutations; no `console.log` in tool body.
- [ ] **Dispatch subsystem**: tool callable by CI-CD-Agent; not in Coder scope (avoid accidental PR mutations from feature branches).
- [ ] **Log subsystem**: log events follow `LINK-ISSUE-PR-{REQUEST,OK,FAIL,SKIP}` convention; structured JSON payloads.
- [ ] **DB subsystem**: no new tables required (link state lives on GitHub side).
- [ ] **`opencode.json`/`config.json`**: tool name added to agent permission allowlist.
- [ ] **Tests**: `framework-self-test.ts` assertion that the tool file exists iff its registration entry exists.

---

## 7. References

**GitHub official**:
- [GitHub — Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)
- [GitHub CLI Manual — `gh issue`](https://cli.github.com/manual/gh_issue)
- [GitHub GraphQL API — PullRequest object](https://docs.github.com/en/graphql/reference/objects#pullrequest)
- [GitHub Projects — About Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)

**Cached docs (verified present on 2026-06-21)**:
- `docs/official_docs/devops/github/github-projects-overview.md`
- `docs/official_docs/devops/github/gh-sub-issue-commands.md`
- `docs/official_docs/devops/github/github-fine-grained-pat-permissions-deep.md`

**Framework files verified during this audit**:
- `.github/workflows/auto-pr.yml` — Tier 1 gap (generic PR body, no issue linking)
- `.github/workflows/doc-decompose.yml:223-253` — authoritative Tier 1 pattern
- `.github/workflows/auto-project.yml` — Tier 2.4 Projects wiring
- `.github/workflows/state-sync.yml:195-196` — Tier 2.4 ProjectV2 mutations
- `.opencode/tools/safe_shell.ts` — tool shape reference for §4.3
- `.opencode/tools/resolve_domain_id.ts` — tool shape + `writeLog()` reference
- `.opencode/lib/log-manager.ts` — `writeLog()` sink for §4.3 audit events
- `.opencode/state/framework-authorities.json` — agent scope authority for new tool registration
- `AGENTS.md` — P0 compliance gate and agent routing rules


## 8. Post-Implementation Finding: Project Status Sync Gap

**发现日期**: 2026-06-21
**严重度**: ⚠️ medium
**描述**: PR merge 后 Issue 自动关闭（Closes #N），但 GitHub Project #2 的 Status 栏位不同步，仍然显示 "In Progress"。

### 根因

- auto-project.yml 仅监听 issues: [opened] 和 pull_request: [opened, ready_for_review]
- 没有监听 issues: [closed] 事件来更新 Project Status 为 "Done"

### 修复方案

在 .github/workflows/state-sync.yml 或新建 workflow，监听 issues: [closed] 事件，通过 GraphQL mutation updateProjectV2ItemFieldValue 将 Status 更新为 "Done"（optionId: 98236657）。

### 当前状态

Issue #126 已手动修复（Status: In Progress → Done）。
