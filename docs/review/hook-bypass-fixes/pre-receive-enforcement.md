# Server-Side Pre-Receive Enforcement — FIX-013

**Version**: 1.0.0  
**Created**: 2026-06-21  
**Author**: @Super-Admin  
**Status**: Optional enhancement — requires server-side Git hook configuration  
**Priority**: P2 (CI parity via FIX-012 is sufficient for most cases)  
**Reference**: `docs/review/framework-refactor/pre-commit-hook-bypass-root-cause.md` § FIX-013

---

## §1 Overview

This document describes optional server-side pre-receive hook enforcement for Git hosting platforms that support it (GitHub Enterprise Server, GitLab self-hosted, Bitbucket Server, Gitea, Gogs, etc.).

When configured, a pre-receive hook runs on the server **before** the push is accepted, providing the strongest enforcement layer — stronger than CI because it prevents the commit from entering the repository at all.

> **Note**: GitHub.com (cloud) does **not** support custom pre-receive hooks. For GitHub.com, use FIX-012 (branch protection + required CI checks) as the equivalent enforcement layer.

---

## §2 When to Use Pre-Receive

| Scenario                 | Recommendation                                          |
| ------------------------ | ------------------------------------------------------- |
| GitHub.com (cloud)       | ❌ Not available — use FIX-012 (branch protection + CI) |
| GitHub Enterprise Server | ✅ Supported — implement pre-receive hook               |
| GitLab self-hosted       | ✅ Supported — implement custom server hook             |
| Bitbucket Server         | ✅ Supported — implement pre-receive plugin             |
| Gitea / Gogs             | ✅ Supported — implement Git hook in repository         |

---

## §3 Pre-Receive Hook Specification

### §3.1 Policy

The pre-receive hook must enforce the same policy as the local pre-commit + commit-msg hooks, but in a **fail-closed** manner:

1. **Enforcement Mode**: Always `strict` or `locked` — no advisory bypass
2. **Critical File Detection**: Any push that modifies `.opencode/hooks/lib/*.ts`, `.opencode/lib/critical-files.ts`, `.opencode/lib/gate-core.ts`, or `.opencode/project.config.json` must include `[INFRA]` in every commit
3. **TDD Markers**: Every non-merge, non-`[INFRA]`-only commit touching `booking-backend/src/` or `booking-frontend/src/` must have `[Red]`, `[Green]`, or `[Refactor]`
4. **Enforcement Mode Downgrade**: Any commit that changes `develop_enforcement_mode` or `runtime_enforcement_mode` to a lower level must be rejected unless accompanied by a governed break-glass signature
5. **Keystone Hash**: Contract changes must include updated Keystone hash

### §3.2 Implementation Sketch

```bash
#!/bin/bash
# pre-receive hook — server-side enforcement
# Placed at: <repo>.git/hooks/pre-receive (bare repo) or
#            <repo>/.gitea/hooks/pre-receive (Gitea) or
#            configured via GitLab admin UI

set -euo pipefail

ENFORCEMENT_MODE="${ENFORCEMENT_MODE:-locked}"

while read oldrev newrev refname; do
  # Skip branch deletions
  if [ "$newrev" = "0000000000000000000000000000000000000000" ]; then
    continue
  fi

  # Get list of commits in the push
  commits=$(git rev-list "$oldrev..$newrev")
  if [ -z "$commits" ]; then
    # First push — check all commits on the branch
    commits=$(git rev-list "$newrev" --not --all)
  fi

  for commit in $commits; do
    commit_msg=$(git log --format=%B -n 1 "$commit")
    changed_files=$(git diff-tree --no-commit-id --name-only -r "$commit")

    # Check 1: TDD markers for business code commits
    business_files=$(echo "$changed_files" | grep -E '^(booking-backend/src/|booking-frontend/src/)' || true)
    if [ -n "$business_files" ]; then
      if ! echo "$commit_msg" | grep -qE '^\[(Red|Green|Refactor)\]'; then
        echo "❌ REJECTED: Commit $commit modifies business code without TDD marker"
        echo "   Files: $business_files"
        exit 1
      fi
    fi

    # Check 2: [INFRA] marker for critical files
    critical_files=$(echo "$changed_files" | grep -E '^(\.opencode/(hooks/lib/|lib/critical-files\.ts|lib/gate-core\.ts|project\.config\.json))' || true)
    if [ -n "$critical_files" ]; then
      if ! echo "$commit_msg" | grep -q '\[INFRA\]'; then
        echo "❌ REJECTED: Commit $commit modifies critical infrastructure without [INFRA] marker"
        echo "   Files: $critical_files"
        exit 1
      fi
    fi
  done
done

echo "✅ Pre-receive checks passed"
exit 0
```

---

## §4 Deployment Considerations

### §4.1 Performance

Pre-receive hooks run synchronously during `git push`. For repositories with large histories or many commits per push:

- Limit `git rev-list` range to a maximum number of commits (e.g., 500)
- Use `git log --format=%B` with `--no-merges` to skip merge commits
- Cache critical file list from `.opencode/lib/critical-files.ts` (or use a compiled JSON snapshot)

### §4.2 Emergency Bypass

For legitimate emergencies (framework repair, incident response), the pre-receive hook should accept a bypass token:

```bash
# Emergency bypass: commit message contains a valid break-glass signature
if echo "$commit_msg" | grep -q '^Break-Glass:'; then
  incident_id=$(echo "$commit_msg" | grep '^Break-Glass:' | head -1 | cut -d' ' -f2-)
  # Verify incident_id against approved list or signature
  echo "⚠️  Break-Glass bypass used: $incident_id"
  continue
fi
```

### §4.3 Logging

All rejections must be logged to a server-side audit log:

```
[/var/log/git-hooks/pre-receive.log]
[2026-06-21T12:00:00Z] REJECTED push by user@host: commit abc123 missing TDD marker
[2026-06-21T12:01:00Z] REJECTED push by user@host: commit def456 modifies critical files without [INFRA]
```

---

## §5 Acceptance Criteria

| Test                                                   | Expected Result                            |
| ------------------------------------------------------ | ------------------------------------------ |
| Push with `--no-verify` commit touching critical files | Pre-receive rejects                        |
| Push with non-TDD business code commit                 | Pre-receive rejects                        |
| Push with governed break-glass metadata                | Pre-receive accepts (if metadata is valid) |
| Push with valid TDD + [INFRA] markers                  | Pre-receive accepts                        |
