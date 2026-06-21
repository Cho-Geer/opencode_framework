# GitHub CLI (gh) Sub-Issue / Parent Relationship Commands

> **Source**: webfetch (cli.github.com/manual)
> **Fetched**: 2026-06-21
> **Domain**: devops_ci — GitHub CLI
> **URLs**:
>
> - https://cli.github.com/manual/gh_issue_create
> - https://cli.github.com/manual/gh_issue_edit
> - https://cli.github.com/manual/gh_issue_view
>   **TTL**: 30 days
>   **Version**: gh CLI latest (manual as of 2026-06-21)

## Overview

GitHub CLI (`gh`) supports sub-issue/parent relationships through three commands: `gh issue create`, `gh issue edit`, and `gh issue view`. These commands allow managing the parent-child relationship between issues directly from the command line.

---

## 1. `gh issue create --parent`

Create a new issue as a **sub-issue** of an existing parent issue.

### Syntax

```bash
gh issue create [flags]
```

### Relevant Flag

| Flag                | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `--parent <number>` | Add the new issue as a sub-issue of the specified parent number or URL |

### Examples

```bash
# Create a sub-issue under parent issue #100 (by number)
$ gh issue create --title "Sub-task" --body "Details" --parent 100

# Create a sub-issue under a parent by URL
$ gh issue create --title "Sub-task" --parent https://github.com/cli/go-gh/issues/42
```

### Combined with Other Flags

```bash
# Create with labels, assignee, and parent
$ gh issue create --label "bug,help wanted" --assignee "@me" --parent 100

# Create with project, milestone, and parent
$ gh issue create --title "Issue title" --body "Issue body" --parent 100 --project "Roadmap"
```

### Notes

- The `--parent` flag accepts issue numbers within the same repository or full issue URLs.
- You can combine `--parent` with other flags like `--title`, `--body`, `--label`, `--assignee`, `--project`, `--milestone`, `--template`, `--type`.

---

## 2. `gh issue edit` — Sub-Issue & Parent Management

Edit one or more issues to manage sub-issue and parent relationships.

### Syntax

```bash
gh issue edit {<numbers> | <urls>} [flags]
```

### Relevant Flags

| Flag                          | Description                           |
| ----------------------------- | ------------------------------------- |
| `--add-sub-issue <number>`    | Add sub-issues by number or URL       |
| `--remove-sub-issue <number>` | Remove sub-issues by number or URL    |
| `--parent <number>`           | Set the parent issue by number or URL |
| `--remove-parent`             | Remove the parent issue               |

### Examples

```bash
# Add sub-issues #123 and #124 to issue #100
$ gh issue edit 100 --add-sub-issue 123,124

# Remove sub-issue #123 from issue #100
$ gh issue edit 100 --remove-sub-issue 123

# Set issue #23's parent to issue #100
$ gh issue edit 23 --parent 100

# Remove parent from issue #23
$ gh issue edit 23 --remove-parent
```

### Combined with Other Edits

```bash
# Set parent AND add sub-issues in a single command
$ gh issue edit 23 --parent 100 --add-sub-issue 200,201

# Full example: edit title, add labels, and manage relationships
$ gh issue edit 23 --title "Updated title" --add-label "bug,help wanted" --parent 100
```

---

## 3. `gh issue view --json parent,subIssues`

View issue details including parent and sub-issue information in JSON format.

### Syntax

```bash
gh issue view {<number> | <url>} [flags]
```

### Relevant Flags

| Flag                        | Description                              |
| --------------------------- | ---------------------------------------- |
| `--json <fields>`           | Output JSON with the specified fields    |
| `-q`, `--jq <expression>`   | Filter JSON output using a jq expression |
| `-t`, `--template <string>` | Format JSON output using a Go template   |

### Available JSON Fields Related to Sub-Issues/Parent

| Field              | Description                                                                  |
| ------------------ | ---------------------------------------------------------------------------- |
| `parent`           | Parent issue information (object with id, number, title, url, etc., or null) |
| `subIssues`        | Array of sub-issue objects                                                   |
| `subIssuesSummary` | Summary of sub-issues (counts by state)                                      |

### Full List of Available JSON Fields

```
assignees, author, blockedBy, blocking, body, closed, closedAt,
closedByPullRequestsReferences, comments, createdAt, id, isPinned,
issueType, labels, milestone, number, parent, projectCards,
projectItems, reactionGroups, state, stateReason, subIssues,
subIssuesSummary, title, updatedAt, url
```

### Examples

```bash
# View issue #23 with parent and sub-issues as JSON
$ gh issue view 23 --json parent,subIssues,subIssuesSummary

# Filter with jq to get parent info
$ gh issue view 23 --json parent --jq '.parent'

# Get sub-issue titles and numbers
$ gh issue view 23 --json subIssues --jq '.subIssues[] | {number, title}'

# Get full parent and sub-issue details
$ gh issue view 23 --json parent,subIssues,subIssuesSummary,number,title,state
```

### Example JSON Output

```json
{
  "number": 23,
  "title": "Main feature",
  "state": "OPEN",
  "parent": {
    "id": "I_kwDO...",
    "number": 10,
    "title": "Epic",
    "url": "https://github.com/owner/repo/issues/10"
  },
  "subIssues": [
    {
      "id": "I_kwDO...",
      "number": 24,
      "title": "Sub-task 1",
      "url": "https://github.com/owner/repo/issues/24",
      "state": "OPEN"
    },
    {
      "id": "I_kwDO...",
      "number": 25,
      "title": "Sub-task 2",
      "url": "https://github.com/owner/repo/issues/25",
      "state": "CLOSED"
    }
  ],
  "subIssuesSummary": {
    "total": 2,
    "completed": 1,
    "percentCompleted": 50
  }
}
```

---

## Summary Table

| Command           | Flag                          | Action                                  |
| ----------------- | ----------------------------- | --------------------------------------- |
| `gh issue create` | `--parent <number>`           | Create new issue as sub-issue of parent |
| `gh issue edit`   | `--add-sub-issue <number>`    | Add existing issue(s) as sub-issue(s)   |
| `gh issue edit`   | `--remove-sub-issue <number>` | Remove sub-issue relationship           |
| `gh issue edit`   | `--parent <number>`           | Set/change parent issue                 |
| `gh issue edit`   | `--remove-parent`             | Remove parent relationship              |
| `gh issue view`   | `--json parent,subIssues`     | View parent/sub-issue relationship data |
