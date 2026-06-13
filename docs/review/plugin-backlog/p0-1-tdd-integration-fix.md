# P0-1: TDD Per-Write Enforcement — Integration Fix Plan

**Created**: 2026-06-12
**Author**: @Super-Admin
**Priority**: P0 (CRITICAL)
**Status**: Planned — awaiting execution
**Related**: `docs/review/plugin-backlog/priority.md` (P0-1 entry)

---

## §1 Problem Statement

`tdd-before.ts` (57 lines) was added after the original CONSTRAINT-AUDIT and implements TDD per-write enforcement for `@Coder-BE` / `@Coder-FE`. However, it has a **hardcoded enforcement mode** that bypasses the dual-mode system defined in `project.config.json` and resolved by `getEnforcementMode()` in `gate-core.ts`.

### Current Bug

```typescript
// tdd-before.ts L28 — WRONG: ignores project.config.json
const mode = 'strict';
```

This means:
- **Advisory mode is impossible** — even when `project.config.json` sets `develop_enforcement_mode: "advisory"`, TDD violations still throw errors
- **Locked mode is not distinguishable** — the plugin cannot differentiate strict vs locked for error message purposes
- **Environment override is ignored** — `ENFORCEMENT_MODE=advisory` has no effect on TDD enforcement

### Enforcement Mode Consistency Audit

| Plugin | Uses `getEnforcementMode()` | Mode Check Pattern | Consistent? |
|:--|:--:|:--|:--:|
| `scope-before.ts` | ✅ | `mode === "strict" \|\| mode === "locked"` | ✅ |
| `gate-before.ts` | ✅ | `mode === "strict" \|\| mode === "locked"` | ✅ |
| `uc7ks-before.ts` | ✅ | `mode === "strict" \|\| mode === "locked"` | ✅ |
| `dispatch-before.ts` | ✅ | `mode !== "advisory"` | ⚠️ ¹ |
| `json-validate.ts` | ❌ (no mode check — always throws) | N/A | ❌ ² |
| **`tdd-before.ts`** | **❌ hardcoded `'strict'`** | **`mode !== 'advisory'`** | **❌** |

¹ Functionally equivalent but stylistically inconsistent.
² `json-validate.ts` always throws on invalid JSON regardless of mode — arguably correct (broken JSON is always fatal).

### `project.config.json` Dual-Mode Status

```json
{
  "template_resolution": {
    "develop_enforcement_mode": "strict",   ← L68
    "runtime_enforcement_mode": "strict"     ← L69
  }
}
```

**Both keys are set to `"strict"` and consistent** ✅. The `getEnforcementMode()` function in `gate-core.ts` (L283-353) resolves them with this priority:

1. `ENFORCEMENT_MODE` env var (runtime override)
2. `develop_enforcement_mode` (primary — for agent execution)
3. `runtime_enforcement_mode` (fallback — for CI/production)
4. Default: `"advisory"`

Locked mode protection: if config resolves to `"locked"`, env var override is ignored.

---

## §2 Fix Specification

### §2.1 Changes to `tdd-before.ts` (3 edits, ~5 lines changed)

#### Edit 1: Add import (L3, after existing imports)

```typescript
// CURRENT (L1-8):
import * as fs from 'node:fs';
import {
  writeLog, updateIndex, ensureLogDir,
} from '../lib/log-manager';
import { resolveAgent } from '../lib/agent-resolver';
import { isSourceFile, isBusinessSourceFile } from '../lib/state-utils';

// ADD after L7:
import { getEnforcementMode } from '../lib/gate-core';
```

#### Edit 2: Replace hardcoded mode (L28)

```typescript
// CURRENT (L28):
const mode = 'strict';

// REPLACE WITH:
const mode = getEnforcementMode();
```

#### Edit 3: Standardize blocking pattern (L55)

```typescript
// CURRENT (L55):
if (mode !== 'advisory') throw new Error(msg);

// REPLACE WITH (consistent with scope-before.ts, gate-before.ts, uc7ks-before.ts):
if (mode === 'strict' || mode === 'locked') throw new Error(msg);
```

**Why change the pattern**: While `mode !== 'advisory'` is logically equivalent to `mode === 'strict' || mode === 'locked'` (since the only valid modes are advisory/strict/locked), using the explicit positive check is:
- **Safer**: if an unknown mode value somehow appears, it won't accidentally block
- **Consistent**: matches the pattern used by 3 of 4 other plugins
- **Auditable**: `grep` for `"strict" || mode === "locked"` finds all blocking enforcement points

### §2.2 Resulting File (57 → 58 lines)

```typescript
// tdd-before.ts — 'tool.execute.before' plugin: TDD per-write enforcement
// Ensures @Coder-BE/@Coder-FE write test files before implementation code
import * as fs from 'node:fs';
import {
  writeLog, updateIndex, ensureLogDir,
} from '../lib/log-manager';
import { resolveAgent } from '../lib/agent-resolver';
import { isSourceFile, isBusinessSourceFile } from '../lib/state-utils';
import { getEnforcementMode } from '../lib/gate-core';    // ← NEW
const P = 'tdd-before';
ensureLogDir();
writeLog(P, 'loaded', { event: 'PLUGIN-LOADED', detail: P + '.ts' });
updateIndex(P, 'PLUGIN-LOADED');
export default (async (_ctx: any) => {
  writeLog(P, 'hooks', { event: 'HOOK-REGISTERED', detail: 'tool.execute.before' });
  return { 'tool.execute.before': toolExecuteBefore };
}) as any;
async function toolExecuteBefore(input: any, output: any): Promise<void> {
  // Only enforce for Coder-BE and Coder-FE
  const agent = resolveAgent(input.sessionID);
  const isCoder = agent === '@Coder-BE' || agent === '@Coder-FE' || agent === 'Coder-BE' || agent === 'Coder-FE';
  if (!isCoder) return;
  // Only enforce on write/edit/safe_edit (not safe_mkdir/safe_delete/safe_shell)
  const TOOLS: Record<string, boolean> = { write: true, edit: true, safe_edit: true };
  if (!TOOLS[input.tool]) return;
  const filePath = (output.args?.filePath as string) || '';
  if (!filePath || !isBusinessSourceFile(filePath)) return;
  // Read machine.json tdd_enforcement_state
  const mode = getEnforcementMode();                     // ← FIXED (was: 'strict')
  let testWritten = false;
  try {
    const mp = (process.env.OPENCODE_ROOT || '.') + '/.opencode/state/machine.json';
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
      const tdd = m.tdd_enforcement_state;
      if (tdd && tdd.current_session && tdd.current_session.initialized) {
        testWritten = tdd.current_session.test_written === true;
      }
    }
  } catch {}
  if (testWritten) {
    writeLog(P, 'runtime', {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: 'TOOL-BEFORE',
      detail: 'exit (pass) test written, impl allowed: ' + filePath,
    });
    return;
  }
  // TDD violation - block
  const msg = '[FW-ENFORCE][TDD] TDD violation: writing to "' + filePath + '" without prior test changes. Write a .spec.ts/.test.ts file first.';
  writeLog(P, 'runtime', {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    level: 'ERROR', event: 'TOOL-BEFORE',
    detail: 'BLOCKED | ' + msg,
  });
  if (mode === 'strict' || mode === 'locked') throw new Error(msg);  // ← FIXED (was: mode !== 'advisory')
// end function
}
```

### §2.3 No Changes to `tdd-after.ts`

`tdd-after.ts` (340 lines) is a `tool.execute.after` plugin that records diff evidence and detects shallow-test circumvention. It does NOT block writes — it only logs warnings and updates `machine.json.tdd_enforcement_state`. Therefore, it does not need enforcement mode awareness.

However, for **audit consistency**, its log messages should include the resolved mode. This is a **P2 nice-to-have** (not in scope of this fix).

---

## §3 Dual Enforcement Mode Consistency Verification

### §3.1 Current State

| Source | Key | Value | Status |
|:--|:--|:--|:--:|
| `project.config.json` L68 | `develop_enforcement_mode` | `"strict"` | ✅ |
| `project.config.json` L69 | `runtime_enforcement_mode` | `"strict"` | ✅ |
| `gate-core.ts` L283-353 | `getEnforcementMode()` | Resolves dual keys correctly | ✅ |
| `ENFORCEMENT_MODE` env var | Override | Not set (default) | ✅ |

### §3.2 Consistency Rules

The dual-mode system (`develop_enforcement_mode` / `runtime_enforcement_mode`) was introduced in **FW-HARNESS-P6** to separate local development enforcement from CI/production enforcement. Consistency rules:

1. **Both keys MUST exist** in `project.config.json` → `template_resolution`
2. **Both keys MUST be valid** (`"advisory"` | `"strict"` | `"locked"`)
3. **`develop_enforcement_mode` ≤ `runtime_enforcement_mode`** in severity (advisory < strict < locked) — i.e., CI should never be more permissive than local development
4. **All plugins MUST use `getEnforcementMode()`** — never read the keys directly or hardcode a mode

### §3.3 Verification Commands

```bash
# 1. Verify dual keys exist and are consistent
bun -e "
  const cfg = JSON.parse(require('fs').readFileSync('.opencode/project.config.json', 'utf8'));
  const tr = cfg.template_resolution;
  const dev = tr?.develop_enforcement_mode;
  const run = tr?.runtime_enforcement_mode;
  console.log('develop_enforcement_mode:', dev);
  console.log('runtime_enforcement_mode:', run);
  console.log('consistent:', dev === run ? 'YES' : 'MISMATCH');
  console.log('valid:', ['advisory','strict','locked'].includes(dev) && ['advisory','strict','locked'].includes(run));
"

# 2. Verify getEnforcementMode() resolves correctly
bun -e "
  const { getEnforcementMode } = await import('./.opencode/lib/gate-core');
  console.log('Resolved mode:', getEnforcementMode());
"

# 3. Verify no plugins hardcode mode
grep -rn "const mode = 'strict'" .opencode/plugins/ --include='*.ts'
# Expected: 0 matches (after fix)

# 4. Verify all blocking plugins use getEnforcementMode()
grep -rn "getEnforcementMode" .opencode/plugins/ --include='*.ts' | grep -v '.bak'
# Expected: 5 matches (scope-before, gate-before, uc7ks-before, dispatch-before, tdd-before)
```

---

## §4 Implementation Steps

### Step 1: Edit `tdd-before.ts` (3 safe_edit calls)

```
Edit 1: Add import after L7
  oldString: "import { isSourceFile, isBusinessSourceFile } from '../lib/state-utils';"
  newString: "import { isSourceFile, isBusinessSourceFile } from '../lib/state-utils';\nimport { getEnforcementMode } from '../lib/gate-core';"

Edit 2: Replace hardcoded mode at L28
  oldString: "const mode = 'strict';"
  newString: "const mode = getEnforcementMode();"

Edit 3: Standardize blocking pattern at L55
  oldString: "if (mode !== 'advisory') throw new Error(msg);"
  newString: "if (mode === 'strict' || mode === 'locked') throw new Error(msg);"
```

### Step 2: Verify Plugin Loads

```bash
bun run -e "import('./.opencode/plugins/tdd-before.ts')" 2>&1 | head -5
```

### Step 3: Verify Enforcement Mode Resolution

```bash
# Should print "strict" (matching project.config.json)
bun -e "
  const { getEnforcementMode } = await import('./.opencode/lib/gate-core');
  console.log('TDD mode:', getEnforcementMode());
"
```

### Step 4: Advisory Mode Test

```bash
# Temporarily override to advisory — TDD violations should log but NOT throw
ENFORCEMENT_MODE=advisory bun run -e "
  const { getEnforcementMode } = await import('./.opencode/lib/gate-core');
  const mode = getEnforcementMode();
  console.log('Mode:', mode);
  console.log('Would block:', mode === 'strict' || mode === 'locked');
"
# Expected: Mode: advisory, Would block: false
```

### Step 5: Run Framework Self-Test

```bash
node .opencode/scripts/framework-self-test.ts 2>&1 | tail -20
```

### Step 6: Update `priority.md` P0-1 Status

After fix is applied, update `docs/review/plugin-backlog/priority.md`:
- P0-1 status: ⚠️ → ✅
- P0-1 description: Update to "Fixed — uses getEnforcementMode() from gate-core"

---

## §5 Risk Assessment

| Risk | Severity | Mitigation |
|:--|:--:|:--|
| Import creates Bun cache coupling between `tdd-before.ts` and `gate-core.ts` | Low | `gate-core.ts` is already imported by 4 other plugins; one more consumer is negligible |
| `getEnforcementMode()` reads `project.config.json` on every hook call | Low | Same pattern used by 4 other plugins; file read is fast (<1ms for small JSON) |
| Mode change from hardcoded `'strict'` to dynamic could allow TDD bypass in advisory | Expected | Advisory mode is DESIGNED to be permissive — this is correct behavior |
| `tdd-after.ts` still doesn't use enforcement mode | Low | `tdd-after.ts` doesn't block — only logs and records state. P2 enhancement. |

---

## §6 Consistency Matrix (Post-Fix)

After this fix, all blocking plugins will use the same enforcement mode resolution:

| Plugin | Import | Mode Resolution | Block Condition | Consistent? |
|:--|:--|:--|:--|:--:|
| `scope-before.ts` | `gate-core` | `getEnforcementMode()` | `mode === "strict" \|\| mode === "locked"` | ✅ |
| `gate-before.ts` | `gate-core` | `getEnforcementMode()` | `mode === "strict" \|\| mode === "locked"` | ✅ |
| `uc7ks-before.ts` | `gate-core` | `getEnforcementMode()` | `mode === "strict" \|\| mode === "locked"` | ✅ |
| `dispatch-before.ts` | `gate-core` | `getEnforcementMode()` | `mode !== "advisory"` | ⚠️ ¹ |
| **`tdd-before.ts`** | **`gate-core`** | **`getEnforcementMode()`** | **`mode === "strict" \|\| mode === "locked"`** | **✅** |

¹ `dispatch-before.ts` uses `mode !== "advisory"` which is functionally equivalent. A future P2 cleanup could standardize it, but it's not a bug.

---

## §7 Related Documents

| Document | Relationship |
|:--|:--|
| `docs/review/plugin-backlog/priority.md` | P0-1 entry — this fix plan resolves it |
| `.opencode/rules/rule_detail/enforcement-modes-standard.md` | Defines advisory/strict/locked behavior matrix |
| `.opencode/lib/gate-core.ts` L283-353 | `getEnforcementMode()` — single source of truth for mode resolution |
| `.opencode/project.config.json` L68-69 | Dual enforcement mode keys |
| `.opencode/plugins/tdd-before.ts` | Target file for this fix |
| `.opencode/plugins/tdd-after.ts` | Companion plugin (no changes needed) |

---

## §8 Execution Checklist

- [ ] Edit 1: Add `import { getEnforcementMode }` to `tdd-before.ts`
- [ ] Edit 2: Replace `const mode = 'strict'` with `const mode = getEnforcementMode()`
- [ ] Edit 3: Standardize block condition to `mode === 'strict' || mode === 'locked'`
- [ ] Verify plugin loads without error
- [ ] Verify mode resolves to `"strict"` (matching `project.config.json`)
- [ ] Verify advisory override works (`ENFORCEMENT_MODE=advisory`)
- [ ] Run `framework-self-test.ts`
- [ ] Update `priority.md` P0-1 status to ✅

**Estimated effort**: ~5 minutes (3 line edits + verification)
