# OpenCode Framework Strict Binding, State, and Multi-Agent Review

**Date**: 2026-05-23  
**Scope**: `C:\Users\USER\Documents\Opencode_framework`  
**Review focus**: strongly binding enforcement, central state management, and multi-agent orchestration consistency.

## Executive Verdict

The framework is strong in intent, but **not strongly binding in the current local state**. Its governance model is split across documentation, agent prompts, `.opencode/state/*.json`, MCP scripts, and Git hooks. Several of those enforcement paths are currently advisory, stale, broken, or not physically connected to Git execution.

In practical terms, the framework currently behaves more like a **governance documentation and audit scaffold** than a hard enforcement system.

No source changes were made during the investigation that produced this report.

## Key Findings

### P0-1: Git Hook Enforcement Is Not Physically Installed

The repo tracks enforcement hooks under `.opencode/hooks/`, but local Git is not configured to use them.

Evidence:

- `git config --get core.hooksPath` returned unset.
- `.git/hooks` contains no active non-sample hooks.
- `.opencode/hooks/pre-commit` contains the intended multi-layer enforcement, but Git will not execute it unless `core.hooksPath` points to `.opencode/hooks` or hooks are installed into `.git/hooks`.

Impact:

Commits can bypass compliance gate checks, TDD ordering checks, keystone validation, and central state checks.

### P0-2: Enforcement Mode Is Advisory, Not Strict

`.opencode/project.config.json` sets:

```json
"enforcement_mode": "advisory"
```

The advisory config has:

```json
"block_on": []
```

`compliance-gate.js` then forces gate success in advisory mode:

```js
const passed = enforcementMode === "advisory" ? true : failed.length === 0;
```

Impact:

Rules may be reported as warnings, but they do not block execution. This conflicts with the framework's strong-language claims such as "mandatory", "blocking", and "physical enforcement".

### P0-3: `gate-state.json.active_sessions` Is Stale

`.opencode/state/gate-state.json` lists active sessions that are already completed and consumed.

Examples:

- `cg_ses_1779375439235` is listed in `active_sessions` but has `gate_status: "completed"` and a non-null `consumed_at`.
- `cg_ses_1779377873680` is also listed as active but is completed and consumed.

Impact:

`active_sessions` cannot currently be treated as an authoritative live gate state. This weakens pre-commit and orchestration checks that rely on active gate sessions.

### P0-4: Transaction Log Verification Fails

Running:

```powershell
node .opencode\scripts\state-transaction.js verify
```

reported invalid transaction state due to non-monotonic revisions.

Root cause:

The WAL writes the same `new_revision` in both `BEGIN` and `COMMIT` entries for a transaction. The verifier scans all entries with `new_revision`, so it sees duplicate revisions as non-monotonic.

Impact:

The transaction mechanism currently fails its own integrity verifier. This undermines confidence in the central state transaction envelope.

### P0-5: The Transaction Envelope Is Not Fully Atomic

For non-`machine.json` transactions, `state-transaction.js` updates `machine.json.meta.revision` before the target state transaction is fully committed. The code comments describe this as a non-transactional revision bump.

Impact:

A failure between the revision bump and the target commit can leave `machine.json` and `gate-state.json` inconsistent. This directly conflicts with the stated goal of unified atomic state mutation.

### P1-1: Reconciliation Script Is Broken in the Windows Checkout

Running:

```powershell
bash .opencode/scripts/reconciliation-check.sh
```

failed with CRLF-related Bash errors.

Git reports the relevant shell scripts as `w/crlf`, including:

- `.opencode/scripts/reconciliation-check.sh`
- `.opencode/scripts/pre-execution-hook.sh`
- `.opencode/hooks/pre-commit`
- `.opencode/hooks/commit-msg`

Impact:

The reconciliation daemon/check cannot run reliably in the current Windows working tree, and the framework self-test fails the reconciliation infrastructure check.

### P1-2: Rule Registry Integrity Is Stale

`.opencode/state/rule_registry.json` says:

```json
"status": "unverified",
"mismatch_count": 0
```

But recalculating digests showed **23 of 24 registered entries mismatch**.

Impact:

Semantic version/digest binding for rules, skills, and agent configs is not currently trustworthy. Advisory mode further weakens this because digest mismatches do not block execution.

### P1-3: Project Root and Business Repo Paths Are Inconsistent

`.opencode/project.config.json` has:

```json
"project_root": ".",
"backend_src": "booking-backend/src/",
"frontend_src": "booking-frontend/"
```

But `booking-backend/` and `booking-frontend/` do not exist at the framework root. They exist under:

```text
booking_system_refactor/
```

The root `contract.yaml` also says the canonical reference is:

```yaml
booking_system_refactor/contract.yaml
```

Impact:

Tools that resolve backend/frontend paths from `project.config.json` will target missing directories. This is especially risky for write scopes, type checks, dependency checks, and dispatch prompt generation.

### P1-4: Framework Self-Test Is Red

Running:

```powershell
node .opencode\scripts\framework-self-test.js
```

failed 3 of 20 checks:

- Check 18: invalid `template_resolution` values.
- Check 19: absolute path leakage in two skill docs.
- Check 20: reconciliation infrastructure failure.

One issue is in the self-test itself: it expects every `template_resolution` value to be a string, but `enforcement_config` is intentionally an object.

Impact:

The framework cannot currently assert its own baseline health.

### P1-5: Required MCP Dependencies Are Not Installed

Running keystone validation failed because Node could not resolve:

```text
@modelcontextprotocol/sdk/server/index.js
```

The dependency is declared in package lock files, but `node_modules` is absent.

Impact:

Core MCP scripts cannot run in a fresh checkout without an install/bootstrap step. That makes "strong binding" dependent on undocumented local setup.

### P2-1: DAG Traceability Is Incomplete

`Task.DAG.json` currently has:

- 52 total tasks.
- 23 completed tasks.
- 29 pending tasks.
- 19 tasks missing `requirement_source`.

Impact:

The DAG does not fully satisfy the Meta-Planner rule that every task must trace to a requirement source. This weakens DAG-as-contract and makes multi-agent scheduling less auditable.

## Remediation Priority

### Immediate P0

1. Install physical Git hook enforcement:
   ```powershell
   git config core.hooksPath .opencode/hooks
   ```

2. Decide whether this repo should actually run in `strict` mode. If yes, update `project.config.json`:
   ```json
   "enforcement_mode": "strict"
   ```

3. Fix `gate-state.json.active_sessions` so it contains only unconsumed armed sessions.

4. Fix transaction revision verification semantics. Either:
   - record `new_revision` only once per operation, preferably on `COMMIT`, or
   - update verifier logic to group by `operation_id`.

5. Make non-`machine.json` state mutations atomic with the machine revision update, or move revision updates into the same transaction boundary.

### Near-Term P1

1. Normalize shell scripts to LF and enforce LF via `.gitattributes`.

2. Regenerate `rule_registry.json` digests and set integrity status from actual verification.

3. Align `project_root` and path config with the nested `booking_system_refactor` repo, or move the business repo paths to match the current config.

4. Install the declared Node dependencies for `.opencode` and document the bootstrap command.

5. Fix `framework-self-test.js` Check 18 so object-valued config keys like `enforcement_config` are allowed.

### Follow-Up P2

1. Complete `requirement_source` coverage for all DAG tasks.

2. Add CI checks for:
   - hook path installed or hook scripts executable in CI,
   - LF line endings for shell scripts,
   - rule registry digest freshness,
   - transaction log validity,
   - `project.config.json` path existence.

3. Add a single canonical reconciliation command that is mandatory in strict and locked modes.

## Bottom Line

The architecture is advanced and directionally sound, but the current repo state has too many bypasses and broken enforcement links to be considered strongly binding. The highest-value fix is not another policy document; it is making the physical execution path match the policy: installed hooks, strict mode, valid state, valid transactions, fresh rule digests, and path config that points to real code.
