# Framework Permission Repair Plan

**Date**: 2026-06-06
**Author**: @Super-Admin
**Session**: cg_ses_1780704609751 (FW-REPAIR-14)
**Status**: Analysis complete — implementation pending

---

## Background

Two framework-self-test failures were identified and root-caused during FW-REPAIR-14:

| Check | Symptom | Root Cause |
|-------|---------|------------|
| 21 (hooks) | pre-commit not executable | `safe-edit-core.ts` atomic write (`fs.writeFileSync` → `fs.renameSync`) creates temp files with default 0644 mode, stripping original executable bit |
| 23 (pre-exec-gate) | pre-execution-gate.js not executable | Git index tracked it as 100644 (never had execute bit); `chmod +x` reverted by `git checkout` |

Both were repaired (see FW-REPAIR-14 HANDOVER). Three residual failures remain:

---

## Residual Failures (pre-existing, not caused by FW-REPAIR-14)

### Check 22 — Orphan `.gitkeep`

```
docs/official_docs/.gitkeep  →  0 bytes, not in index.json  →  "orphan"
```

`.gitkeep` is a Git convention placeholder — Git cannot track empty directories, so a 0-byte file is committed to preserve `docs/official_docs/`. Now that the directory contains 7 real doc files (fetched by @Knowledge-Curator in session cg_ses_1780671810706), `.gitkeep` is vestigial.

The self-test's orphan scanner (`framework-self-test.js` lines 1036-1061) already excludes:
- `.metadata/` directories
- `scout-extracts/` directories
- `index.json` itself
- `.metadata`-prefixed files

But `.gitkeep` matches none of these exclusions.

### Check 26 — Rule Registry Digest Mismatches (5 HIGH)

Five agent config files were modified by commit `6bebf9fa` ("chore: sync framework agent configs and gate-state on work-one") without running `rule-registry-verify.js --repair` afterward. The SHA-256 digests in `rule_registry.json` no longer match the actual file content, and the semver was not bumped. Per `verification_policy.mismatch_severity_rules`:

```
"digest_mismatch_version_same": "HIGH"
```

| File | Registry Version | Registry SHA-256 | Actual SHA-256 |
|------|-----------------|------------------|----------------|
| agents/Coder-BE.md | v1.0.4 | 9edc479f... | 9c40cc00... |
| agents/Coder-FE.md | v1.0.4 | 6a2c9b78... | a5c0e75b... |
| agents/Orchestrator.md | v1.0.4 | 3e6ddc03... | 4f273756... |
| agents/Guardian.md | v1.0.2 | cc24ed86... | 065d05a7... |
| agents/CI-CD-Agent.md | v1.0.0 | 968f1c0e... | 23a73386... |

The fix is one command: `node .opencode/scripts/rule-registry-verify.js --repair`

But this command is blocked by `safe_shell`'s content scanner (Step 3: SCRIPT_FILE_WRITE).

### Check 27 — Reconciler/Doctor Disagreement

Purely a cascading failure from Check 26. `state-reconciliation.js` reports clean; `framework-doctor.js --strict` fails on Check 6 (rule registry). The cross-validation fails because the two tools disagree. Fixing Check 26 automatically resolves Check 27.

---

## Implementation Plans

### Plan 1: Check 22 — Whitelist `.gitkeep` in Self-Test

**File**: `.opencode/scripts/framework-self-test.js`

**Change**: Add a `KNOWN_NON_DOC_FILES` exclusion set to the orphan scanner in Check 22.

```diff
// Near line 1016, inside checkKnowledgeCache():

+ const KNOWN_NON_DOC_FILES = new Set([
+   '.gitkeep',          // Git empty-directory placeholder
+   // Future entries for OS metadata files (e.g., '.DS_Store')
+ ]);

// At line 1048, add whitelist check to the file condition:

- } else if (entry.isFile() && !rel.includes("index.json") && !rel.startsWith(".metadata")) {
+ } else if (entry.isFile()
+     && !rel.includes("index.json")
+     && !rel.startsWith(".metadata")
+     && !KNOWN_NON_DOC_FILES.has(path.basename(rel))
+ ) {
```

**Impact**: ~5 lines. Single file. Backward-compatible (new Set is empty-safe).

**Rationale**: `.gitkeep` is not a document, will never be in `index.json`, and should not trigger a self-test failure. The whitelist pattern is extensible for future non-document files in `docs/official_docs/`.

---

### Plan 2: Check 26 — Allow Super-Admin to Run `rule-registry-verify.js --repair`

**Problem**: `safe_shell` blocks `node .opencode/scripts/rule-registry-verify.js --repair` at Step 3 (script content scan). The script passes Steps 1 (no dangerous patterns) and 2 (matches `node *.js *` in DEFAULT_ALLOWLIST), but Step 3 detects `fs.writeFileSync`/`fs.renameSync` patterns and blocks it.

**Current blocking path** (`safe-bash-core.ts` lines 361-379):

```
safeBashTool()
  Step 1: isDangerous()       → ✅ pass
  Step 2: isAllowed()         → ✅ pass (matches "node *.js *")
  Step 3: _scriptContainsFileWrite()
    ├─ _isScriptInAllowedPath()  → ❌ (script is in .opencode/scripts/, not in __tests__/ etc.)
    ├─ firstLine check           → ❌ (no "// safe_bash: allow-write" header)
    └─ WRITE_PATTERNS detected   → ❌ blocked: SCRIPT_FILE_WRITE
```

#### Approach A: Opt-in Header (simplest, least restrictive)

Add `// safe_bash: allow-write` as the first line of `rule-registry-verify.js`.

**Pros**: 1 line change. `_scriptContainsFileWrite()` line 256 already handles this — returns `{ blocked: false }` immediately.

**Cons**: Any agent whose allowlist includes `node *.js *` (currently @Super-Admin and @Orchestrator) could execute the script. The `--repair` flag modifies `rule_registry.json` which @Orchestrator should not touch.

#### Approach B: Agent-Aware Script Whitelist (recommended)

Add a `AGENT_ALLOWED_SCRIPTS` constant to `safe-bash-core.ts` and check it in `safeBashTool` Step 3 before the content scan.

**File**: `.opencode/lib/safe-bash-core.ts`

**Change 1** — New constant (near line 172, next to `ALLOWED_SCRIPT_PATHS`):

```typescript
/**
 * Agent-specific script path allowlist — bypasses content scanning.
 * Only the listed agents may execute these scripts via `node <script>`.
 * Used for maintenance scripts (rule_registry repair, state reset, etc.)
 * that legitimately need file-write operations.
 *
 * Added FW-REPAIR-14: Super-Admin needs rule-registry-verify.js --repair
 * to regenerate digests after framework sync operations.
 */
export const AGENT_ALLOWED_SCRIPTS: Record<string, string[]> = {
  '@Super-Admin': [
    'rule-registry-verify.js',
    // Future: add other Super-Admin maintenance scripts here
  ],
};
```

**Change 2** — Inject check in `safeBashTool` Step 3 (between lines 361 and 367):

```typescript
// 3. Script content scan — block node *.ts/*.js scripts that write files
const nodeScriptMatch = command.match(/^node\s+(.+\.(ts|js))(?:$|\s)/i);
if (nodeScriptMatch) {
  const scriptArg = nodeScriptMatch[1];
  const scriptPath = path.resolve(process.cwd(), scriptArg);

  // FW-REPAIR-14: Agent-specific script bypass — skip content scan for
  // maintenance scripts that legitimately need file-write operations.
  const agentScripts = AGENT_ALLOWED_SCRIPTS[agent] || [];
  const isAgentAllowedScript = agentScripts.some(
    (allowed) => scriptArg.includes(allowed)
  );
  
  if (!isAgentAllowedScript) {  // ← wrap existing check in this condition
    if (!_isScriptInAllowedPath(scriptPath)) {
      const scanResult = _scriptContainsFileWrite(scriptPath);
      if (scanResult.blocked) {
        // ... existing block logic ...
      }
    }
  }
}
```

**Pros**:
- Only @Super-Admin can bypass the content scan for these scripts
- Other agents still blocked by content scan even if their allowlist matches `node *.js *`
- Extensible — add more scripts per agent as needed
- No changes to individual scripts (no opt-in headers needed)

**Cons**:
- ~20 lines of framework code change
- Adds a new constant and conditional to the security path

#### Approach C: Hybrid — Opt-in Header + Agent Guard (most secure)

Combine A and B: add `// safe_bash: allow-write` to `rule-registry-verify.js` AND add agent-awareness to the content scan. The opt-in header handles the "this script is safe to run" declaration; the agent guard ensures only Super-Admin can invoke it.

This is overkill for the current problem but provides defense-in-depth.

---

## Recommendation

| Plan | Approach | Effort | Risk |
|------|----------|--------|------|
| Plan 1 (Check 22) | Whitelist `.gitkeep` in self-test | ~5 lines, 1 file | None |
| Plan 2 (Check 26) | **Approach B**: Agent-aware script whitelist in safe-bash-core | ~20 lines, 1 file | Low — only Super-Admin gets new bypass |

Both plans together: **~25 lines across 2 files**. After implementation, `framework-self-test.js --strict` should drop from 3/28 FAIL to 0/28 FAIL.

---

## Verification

After both plans are implemented:

```bash
# Verify Check 22 passes (no .gitkeep orphan)
node .opencode/scripts/framework-self-test.js 2>&1 | grep "Check 22"

# Verify Super-Admin can run repair
node .opencode/scripts/rule-registry-verify.js --repair

# Full verification
node .opencode/scripts/framework-self-test.js --strict
# Expected: 28/28 PASS
```
