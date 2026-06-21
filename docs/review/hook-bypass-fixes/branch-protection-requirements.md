# Branch Protection Requirements — FIX-012

**Version**: 1.0.0  
**Created**: 2026-06-21  
**Author**: @Super-Admin  
**Status**: Implementation plan — requires CI-CD-Agent action  
**Reference**: `docs/review/framework-refactor/pre-commit-hook-bypass-root-cause.md` § FIX-012

---

## §1 Problem Statement

Local Git hooks cannot defend against `git commit --no-verify` / `git commit -n` when the commit is performed directly in a terminal (not through OpenCode's `safe_shell`). The only layer that can catch these bypasses is **remote CI/branch protection**.

Current CI workflows (`framework-ci.yml`, `ci.yml`) check hook installation and framework self-test, but they are not yet a **full semantic replacement** for pre-commit/commit-msg policy enforcement. This means a local `--no-verify` commit can be pushed without being rejected.

---

## §2 Required Branch Protection Rules

The following branch protection rules must be enforced on the repository's primary branch(es) (`main`, `master`, or `develop`):

### §2.1 Required Status Checks

The following CI jobs **must pass** before a pull request can be merged:

| Check                              | What It Validates                                                                                                     | Failure Consequence |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `framework-self-test` (all checks) | Hook integrity, critical file integrity, mode consistency, Keystone validation                                        | PR blocked          |
| `framework-doctor --strict`        | Hook installation, executable bits, critical file checksums                                                           | PR blocked          |
| `semantic-validator` (new)         | Commit range policy: TDD markers, [INFRA] for critical files, enforcement mode consistency, Keystone/state invariants | PR blocked          |

### §2.2 Protected Branch Configuration

```
Branch: main (and any release/* branches)
Settings:
  ✅ Require a pull request before merging
  ✅ Require approvals: 1
  ✅ Require status checks to pass before merging
     ☑ framework-self-test
     ☑ framework-doctor
     ☑ semantic-validator
  ✅ Require branches to be up to date before merging
  ✅ Require conversation resolution before merging
  ☐ Do not allow bypassing the above settings
     (Administrators included — governance critical)
```

### §2.3 Enforcement Mode in CI

The `ENFORCEMENT_MODE` for CI workflows must be set to `strict` at minimum:

```yaml
env:
  ENFORCEMENT_MODE: strict
```

For production/release branches, consider `locked`.

---

## §3 Semantic Validator Specification

The new `semantic-validator` CI job (`.github/workflows/semantic-validator.yml` or equivalent) must:

### §3.1 Commit Range Validation

For each commit in the PR's range:

1. **TDD Marker Check**: Every non-merge, non-`[INFRA]`-only commit must have `[Red]`, `[Green]`, or `[Refactor]` marker
2. **[INFRA] Marker Check**: Commits touching critical infrastructure files (from `.opencode/lib/critical-files.ts`) must include `[INFRA]`
3. **Phase Ordering**: `[Green]` must have a preceding `[Red]`; `[Refactor]` must have a preceding `[Green]`
4. **Enforcement Mode Consistency**: `project.config.json` enforcement mode cannot be downgraded without governed break-glass metadata

### §3.2 Critical File Drift Detection

Compare the PR's `.opencode/lib/critical-files.ts` against the base branch. If the critical files list itself was changed, the commit must include `[INFRA]` and the reviewer must verify the change is intentional.

### §3.3 Break-Glass Metadata Validation

If a commit bypasses a governance rule (e.g., `[INFRA]` with `--no-verify` equivalent in CI), it must include:

```
Break-Glass: <incident_id>
Approved-By: <@Arbiter or @Super-Admin>
Reason: <explanation>
```

The semantic validator must verify:

- `incident_id` is non-empty and unique
- `Approved-By` references a valid governance agent
- The bypass is recorded in the commit message body

---

## §4 Implementation Steps

1. **@CI-CD-Agent**: Create `.github/workflows/semantic-validator.yml`
2. **@CI-CD-Agent**: Add required status checks to branch protection settings
3. **@Super-Admin**: Verify `framework-ci.yml` imports `.opencode/lib/critical-files.ts` (FIX-007)
4. **Repository admin**: Enable branch protection rules via GitHub UI or API

---

## §5 Acceptance Criteria

| Test                                                 | Expected Result                                   |
| ---------------------------------------------------- | ------------------------------------------------- |
| PR with `--no-verify` commit touching critical files | CI semantic validator fails                       |
| PR with non-TDD business code commit                 | CI semantic validator fails                       |
| PR with enforcement mode downgrade                   | CI semantic validator fails                       |
| PR with governed break-glass metadata                | CI semantic validator passes if metadata is valid |
| Branch protection bypass attempt                     | GitHub blocks merge (required checks not met)     |
