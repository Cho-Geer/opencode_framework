# Pre-Commit Hook Bypass - Root Cause Analysis & Fix Plan

**Version**: 1.1.0  
**Created**: 2026-06-21  
**Last reviewed**: 2026-06-21  
**Author**: @Super-Admin  
**Status**: Active - current-code audit completed; P0/P1 fixes pending

---

## Audit Verdict

The original conclusion is directionally correct: Git hook enforcement can be bypassed, and the highest-risk local bypass is still `git commit --no-verify` / `git commit -n`.

However, the previous report was partially stale:

1. `project.config.json` enforcement-mode downgrade is already blocked on the OpenCode write path by `.opencode/plugins/json-validate.ts`; the remaining mode downgrade gap is mainly the `ENFORCEMENT_MODE=advisory` environment override and raw Git paths.
2. `core.hooksPath` is not protected only by setup. It is checked by `install-hooks.ts`, `framework-self-test.ts` Check 21, `framework-doctor.ts` Check 7, `compliance-gate.ts` bootstrap logging, and `.github/workflows/framework-ci.yml` hook-path-check. These checks detect drift, but cannot run if a local user bypasses hooks and never runs CI.
3. The fail-open surface is broader than the old report stated: Layer 0 DB reads, Layer 1.8 gate lifecycle audit, Layer 1.9 state format validation, and Layer 2 Keystone missing/error/timeout paths can all skip instead of blocking in strict mode.
4. The critical-file list tracks the hook wrapper scripts but not the hook implementation files (`.opencode/hooks/lib/*.ts`) or the shared `critical-files.ts` control file itself.
5. CI exists, but it is not yet semantically equivalent to the pre-commit hook. It checks hook installation/self-test/infrastructure file drift, but does not fully close the `--no-verify` gap unless required branch protection and CI parity checks are enforced.

---

## Official OpenCode Constraint

OpenCode plugin hooks and Git hooks are different enforcement layers.

From `docs/official_docs/opencode/plugins/plugin-hook-reference.md`:

- Local plugins are TypeScript/JavaScript modules loaded through OpenCode plugin discovery/configuration.
- `tool.execute.before` receives mutable tool args and can block by throwing.
- `tool.execute.after` runs after execution and cannot prevent an already executed tool.

Therefore:

- Git's `pre-commit` / `commit-msg` hooks cannot defend against Git's own `--no-verify` bypass.
- OpenCode plugin enforcement can only block this when the commit is invoked through an OpenCode tool such as `safe_shell`.
- Remote/CI enforcement is required to catch commits that bypass local runtime and local Git hooks.

Any runtime fix must use the official OpenCode plugin pattern: `export default`, `tool.execute.before`, existing lifecycle wrapper where applicable, and Log Central `writeLog()` integration.

---

## Evidence Reviewed

| Source | Current finding |
| --- | --- |
| `.opencode/hooks/pre-commit` | Executable 2-line shim delegating to `bun .opencode/hooks/lib/hook-layers.ts`. |
| `.opencode/hooks/commit-msg` | Executable 2-line shim delegating to `bun .opencode/hooks/lib/hook-commit-msg.ts`. |
| `.opencode/hooks/lib/hook-layers.ts` | 351-line TypeScript hook. Runs strict mode, but has skip paths for DB/audit/state/Keystone failures. |
| `.opencode/hooks/lib/hook-commit-msg.ts` | 155-line TypeScript commit-message validator. TDD labels block in strict; critical-file `[INFRA]` marker only blocks in locked mode. |
| `.opencode/lib/gate-core.ts` | `ENFORCEMENT_MODE` env override can downgrade strict to advisory; locked config is protected from env downgrade. |
| `.opencode/plugins/json-validate.ts` | Blocks `template_resolution.develop_enforcement_mode` / `runtime_enforcement_mode` downgrades on OpenCode overwrite writes to `project.config.json`. |
| `.opencode/lib/critical-files.ts` | 22 critical files tracked. Missing `.opencode/hooks/lib/*.ts` and `.opencode/lib/critical-files.ts` from its own protected list. |
| `.opencode/scripts/framework-self-test.ts` | Check 21 validates `core.hooksPath`, `pre-commit`, and `commit-msg` exist and are executable. |
| `.opencode/scripts/framework-doctor.ts` | Check 7 validates hook installation and executable bits. |
| `.github/workflows/ci.yml` | Runs `framework-self-test.ts` after CI DB/bootstrap setup. |
| `.github/workflows/framework-ci.yml` | Has hook-path-check and static critical-file drift check, but uses the same incomplete critical-file list. |
| `.task_temp/_logs/hook-layers.log` | Recent hook executions run in strict mode and pass when hooks are invoked. |
| `.task_temp/_logs/*safe-bash*` / `*scope-before*` | Multiple successful `git commit --no-verify` tool invocations are logged; no runtime command guard currently blocks them. |

---

## Updated Findings

| Severity | ID | Category | Current status | Required correction |
| --- | --- | --- | --- | --- |
| P0 | HVEC-001 | `git commit --no-verify` / `-n` | Confirmed. Local Git hooks have no control once this flag is used. OpenCode `safe_shell` logs show the command is currently allowed. | Add OpenCode `tool.execute.before` command guard for OpenCode-invoked commits, plus CI/branch protection parity for raw Git commits. |
| P0 | HVEC-002 | Env mode downgrade | Confirmed for strict mode: `ENFORCEMENT_MODE=advisory` wins over strict config. Locked config is protected. Config-file downgrade via OpenCode write is already blocked by `json-validate.ts`. | Add source-aware mode resolution and block env downgrades from config strict/locked in hooks, pre-execution gate, and command guard. |
| P1 | HVEC-003 | Hook replacement / hook implementation tamper | Wrapper scripts are tracked; implementation files are not fully protected. `critical-files.ts` also does not protect itself. | Expand shared critical-file list and CI list to cover hook implementation/control files; add checksum/content invariants in self-test/doctor. |
| P1 | HVEC-004 | `core.hooksPath` manipulation | Detection exists in install/self-test/doctor/CI/bootstrap log. Runtime hook startup cannot defend if hooks are disabled. | Block OpenCode-invoked `git config core.hooksPath`, `git -c core.hooksPath=... commit`, and `core.skipHooks` changes except through approved install/repair scripts. |
| P1 | HVEC-005 | Strict-mode fail-open paths | Confirmed and broader than prior report: DB read, gate lifecycle audit, state format validation, Keystone missing/error/timeout skip. | Fail closed in strict/locked for governance-critical layers; keep advisory non-blocking. |
| P1 | HVEC-006 | CI parity gap | CI exists, but it is not yet a full semantic replacement for pre-commit/commit-msg policy. | Extract shared policy or add CI validator that checks commit messages, critical infra changes, hook integrity, mode integrity, and Keystone/state invariants. |
| P2 | HVEC-007 | Log Central gap | Git hooks append to `.task_temp/_logs/hook-*.log`; high-severity hook skips/rejections are not consistently persisted through Log Central. | Keep file logs for Git UX, but also emit structured `writeLog()` events for reject/skip/downgrade/break-glass paths. |

---

## Root Cause Analysis

### Layer Model

The current enforcement system spans three layers:

| Layer | Scope | Strength | Gap |
| --- | --- | --- | --- |
| OpenCode plugin layer | `tool.execute.before/after` around OpenCode tool calls | Can block OpenCode-invoked shell/file operations before execution | Does not currently block `git commit --no-verify` command strings. Cannot see raw terminal Git commands. |
| Local Git hook layer | `.opencode/hooks/pre-commit` and `commit-msg` | Strong when invoked | Git intentionally allows `--no-verify`; disabled `hooksPath` prevents invocation. |
| CI/remote layer | GitHub workflows and branch protection | Only layer that can reject raw local bypasses after push/PR | Existing checks are not full pre-commit semantic parity, and branch-protection enforcement must be mandatory. |

### Root Causes

1. **Git hooks are advisory by design**  
   `--no-verify` is a Git feature. No local Git hook can intercept a commit that explicitly disables hooks.

2. **OpenCode runtime does not guard known Git bypass commands**  
   The official OpenCode-compatible interception point is `tool.execute.before`. Current logs show `safe_shell` accepted `git commit --no-verify`, so the framework misses the only local runtime layer that can block OpenCode-invoked bypass attempts.

3. **Mode resolution is not source-aware**  
   `getEnforcementMode()` returns the final mode, but hook callers do not know whether the value came from config or env. This makes strict-to-advisory env downgrade indistinguishable from intentional config advisory mode.

4. **Fail-open behavior remains in strict governance paths**  
   Several strict-mode checks log "skipped" when their dependency is missing or broken. For governance checks, dependency failure should be treated as policy failure in strict/locked.

5. **Critical-file coverage is incomplete**  
   The protected list covers hook wrappers but not the TypeScript implementation files that wrappers execute. A staged change to `hook-layers.ts` is therefore less visible than a change to `.opencode/hooks/pre-commit`.

6. **CI and local hooks do not share one policy core**  
   The workflows have useful checks, but static duplicated lists and staged-file assumptions make policy drift likely.

---

## Fix Plan

### Phase 0: P0 Runtime Guard and Fail-Closed Hardening

| Fix ID | Change | Implementation requirement |
| --- | --- | --- |
| FIX-001 | Block OpenCode-invoked Git hook bypass commands | Add a `tool.execute.before` guard for `safe_shell`/shell-capable tools. Reject `git commit --no-verify`, `git commit -n`, `--no-commit-msg-verify`, `git -c core.hooksPath=... commit`, `core.skipHooks`, and unauthorized `git config core.hooksPath` changes. Use existing plugin lifecycle style and `writeLog()`. |
| FIX-002 | Add governed break-glass path | If an emergency bypass is required for framework repair, require @Super-Admin scope, `[INFRA]` marker, explicit incident id/trailer, and Log Central event. The bypass must still be caught by CI unless the incident marker is valid. |
| FIX-003 | Make mode resolution source-aware | Add `getEnforcementModeWithSource()` or equivalent in `.opencode/lib/gate-core.ts`, returning config mode, env mode, final mode, and downgrade reason. Do not duplicate mode precedence logic in plugins/hooks. |
| FIX-004 | Block env downgrades in strict/locked | In `hook-layers.ts`, `hook-commit-msg.ts`, and pre-execution gate paths, fail if env mode is weaker than config mode. Preserve existing locked protection and log `ENFORCEMENT-MODE-DOWNGRADE-BLOCKED`. |
| FIX-005 | Fail closed for critical strict checks | In strict/locked, DB read failure, gate lifecycle audit failure, state validation failure, Keystone validator missing/error/timeout, and missing machine constraints must exit non-zero. Advisory mode can continue to log-only. |

### Phase 1: P1 Coverage and CI Parity

| Fix ID | Change | Implementation requirement |
| --- | --- | --- |
| FIX-006 | Expand critical-file coverage | Add `.opencode/hooks/lib/hook-layers.ts`, `.opencode/hooks/lib/hook-commit-msg.ts`, `.opencode/hooks/lib/hook-critical-files.ts`, `.opencode/lib/critical-files.ts`, `.opencode/scripts/install-hooks.ts`, `.opencode/scripts/framework-self-test.ts`, `.opencode/scripts/framework-doctor.ts`, and governance workflows to the shared critical-file list or generated governance-domain list. |
| FIX-007 | Remove duplicated CI critical-file lists | Make `.github/workflows/framework-ci.yml` call a framework script that imports `.opencode/lib/critical-files.ts` instead of maintaining a second static shell array. |
| FIX-008 | Add CI semantic validator | Add a Bun/TypeScript CI script that validates commit range policy independent of staged files: critical infra commits need `[INFRA]` or governed break-glass metadata, enforcement mode cannot downgrade, hook implementation invariants hold, Keystone/state checks pass. |
| FIX-009 | Add hook integrity checks | Extend `framework-self-test.ts` and `framework-doctor.ts` to assert wrapper delegation targets, implementation files exist, executable bits are correct, and forbidden skip strings are absent in strict paths. |
| FIX-010 | Protect hook config mutation | Extend the OpenCode command guard to block `git config core.hooksPath`, `git config core.skipHooks`, and `git update-index --skip-worktree` against governance files except through approved scripts. |

### Phase 2: P2 Observability and Remote Controls

| Fix ID | Change | Implementation requirement |
| --- | --- | --- |
| FIX-011 | Integrate Git hooks with Log Central | Keep `.task_temp/_logs/hook-layers.log` and `hook-commit-msg.log`, but also write structured high-severity events through `.opencode/lib/log-manager.ts`: reject, skipped-critical-check, env-downgrade, break-glass, hook-integrity-fail. |
| FIX-012 | Require branch protection | Make CI status summary and the new semantic validator required checks on protected branches. This is the practical remote-side answer to raw `--no-verify`. |
| FIX-013 | Optional server-side pre-receive | If the remote host permits it, add pre-receive enforcement. Otherwise keep the same policy in required CI. |
| FIX-014 | Signed enforcement mode | Consider signed config or Arbiter-approved unlock workflow for strict-to-advisory changes. This is lower priority after command guard and CI parity. |

---

## Implementation Notes

1. **Use official OpenCode plugin conventions**  
   Runtime command blocking belongs in a `tool.execute.before` plugin, not in `tool.execute.after`. The plugin must follow the existing local style: `export default`, lifecycle wrapper when used, `resolveAgent()`, shared path/tool helpers where available, and `writeLog()`.

2. **Do not fork governance policy into shell arrays**  
   Critical files should have one canonical TypeScript source. Git hooks, doctor, self-test, and CI should import or invoke that source.

3. **Keep DB-only state discipline**  
   Do not introduce new JSON state for bypass approvals. If break-glass approvals need persistence, store them in the existing DB/log subsystem or as signed commit metadata validated by CI.

4. **Preserve advisory mode semantics**  
   Advisory mode may warn and continue. Strict and locked must fail closed for governance infrastructure failures.

5. **Treat `--no-verify` as a controlled emergency, not a normal workflow**  
   Current logs show repeated successful bypasses for framework maintenance. The fix should provide an auditable repair path instead of leaving a silent universal bypass.

---

## Acceptance Criteria

| Test | Expected result |
| --- | --- |
| OpenCode `safe_shell` runs `git commit --no-verify` in strict mode | Blocked before execution; Log Central records bypass attempt. |
| OpenCode `safe_shell` runs `git commit -n` in strict mode | Blocked before execution; equivalent to `--no-verify`. |
| `ENFORCEMENT_MODE=advisory git commit ...` while config is strict | Hook/pre-execution layer fails with env downgrade error. |
| `project.config.json` strict-to-advisory overwrite through OpenCode write path | Still blocked by `json-validate.ts`; test remains green. |
| DB gate store unavailable during strict pre-commit | Commit fails closed instead of logging "skipped". |
| Keystone validator missing or times out in strict pre-commit | Commit fails closed. |
| Staged edit to `.opencode/hooks/lib/hook-layers.ts` | Critical-file policy flags it and requires `[INFRA]`/governed path. |
| Raw terminal `git commit --no-verify` is pushed to PR | Required CI semantic validator fails unless governed break-glass metadata is valid. |
| `framework-doctor.ts --strict` after hook tamper | Fails hook integrity check. |
| Hook rejection or bypass attempt | Appears in both hook file log and Log Central structured logs. |

---

## Revised Priority Matrix

| Priority | Fixes | Why |
| --- | --- | --- |
| P0 | FIX-001 to FIX-005 | Blocks OpenCode-invoked bypasses, closes env downgrade, and makes strict-mode governance checks fail closed. |
| P1 | FIX-006 to FIX-010 | Removes critical-file blind spots and gives CI semantic parity for raw local bypasses. |
| P2 | FIX-011 to FIX-014 | Improves observability and remote governance maturity. |

---

## Remediation Summary

The hook system is effective when hooks run, but it is not a complete governance boundary. The next implementation should not rely on one mechanism. Use a three-layer defense:

1. OpenCode plugin `tool.execute.before` blocks known bypass commands before local execution.
2. Git hooks fail closed in strict/locked when governance dependencies are unavailable.
3. Required CI/remote policy catches raw Git bypasses that no local hook can see.

This preserves official OpenCode plugin semantics, keeps DB-only state discipline, integrates with Log Central, and aligns pre-commit enforcement with the broader hardened enforcement system.

---

## Appendix: Prior Invocation Summary

| Category | Details |
| --- | --- |
| Original source | `.task_temp/HOOK-BYPASS-ROOT-CAUSE/HANDOVER.md` |
| Original session | `cg_ses_1782032310311` |
| Original generated date | 2026-06-21 |
| Current audit scope | Official OpenCode plugin docs, hook source, mode source, critical-file list, self-test/doctor, CI workflows, and local logs. |
