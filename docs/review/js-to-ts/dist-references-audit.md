# Audit Report: `.opencode/lib/dist/` References

**Date**: 2026-06-13
**Scope**: `.opencode/lib/dist/` usage across framework scripts
**Status**: Active risk — stale compiled dist referenced by 6 scripts

---

## 1. Directory Status

| Property | Value |
|----------|-------|
| Path | `.opencode/lib/dist/` |
| Exists | Yes |
| Tracked by git | No (`git ls-files` returns empty) |
| Ignored by `.gitignore` | Yes — line 11 has `dist/` pattern |
| Maintenance | Not rebuilt automatically; all files stale |

### 1.1 Contents

The directory contains 5 pre-compiled `.js` + `.d.ts` pairs:

| Dist File | Source `.ts` Exists | Dist Age vs Source |
|-----------|---------------------|-------------------|
| `dag-version-manager.js` | ✅ Yes | **Stale** (dist older) |
| `gate-core.js` | ✅ Yes | **Stale** (dist much older — source edited today) |
| `log-rotator.js` | ✅ Yes | **Stale** (dist older) |
| `state-compactor.js` | ✅ Yes | **Stale** (dist older) |
| `state-manager.js` | ✅ Yes | **Stale** (dist older) |

> ⚠️ Because `gate-core.js` was last compiled before the FW-IMPL-LOG-UNIFY B1 fix, scripts loading it are running outdated logic that writes to a non-dated log directory.

---

## 2. Scripts That Reference `.opencode/lib/dist/`

| # | File | Reference | Load Pattern | Risk |
|---|------|-----------|--------------|------|
| 1 | `.opencode/scripts/archive-dag-tasks.ts` | `require('.opencode/lib/dist/dag-version-manager')` | Direct require, no fallback | **High** — no source fallback |
| 2 | `.opencode/scripts/nightly-compaction.ts` | `await import('../lib/state-compactor.ts')` then fallback to dist | Prefers source, falls back to dist | Low — source-first |
| 3 | `.opencode/scripts/nightly-compaction.ts` | `await import('../lib/dag-version-manager.ts')` then fallback to dist | Prefers source, falls back to dist | Low — source-first |
| 4 | `.opencode/scripts/framework-compliance-check.ts` | `require("../lib/dist/gate-core.js")` | Direct require | **High** — stale gate-core |
| 5 | `.opencode/scripts/mcp-tools/compliance-gate.ts` | `require("../../lib/dist/state-compactor")` | Direct require inside try/catch | **Medium** — compactor stale |
| 6 | `.opencode/scripts/gate-lifecycle-audit.ts` | `require("../lib/dist/gate-core.js")` | Direct require | **High** — stale gate-core |
| 7 | `.opencode/scripts/state-integrity-scan.ts` | `require("../lib/dist/gate-core.js")` | Direct require | **High** — stale gate-core |

### 2.1 Findings Summary

- **6 scripts** directly reference compiled `.js` from `.opencode/lib/dist/`
- **4 of those** reference `gate-core.js`, which is now stale after today’s B1 dated-directory fix
- **Only 1 script** (`nightly-compaction.ts`) uses the recommended source-first pattern
- **No build step** in `package.json` regenerates `dist/` from source

---

## 3. Evidence Commands

```bash
# 1. List dist directory
ls -la .opencode/lib/dist/

# 2. Check if dist is tracked by git
git ls-files .opencode/lib/dist/

# 3. Check .gitignore for dist pattern
grep -n "dist" .gitignore

# 4. Find all dist references outside node_modules and backups
grep -r "lib/dist/" .opencode \
  --include="*.ts" --include="*.js" --include="*.json" \
  --include="*.sh" --include="*.md" | \
  grep -v node_modules | grep -v "_plugins_backups"

# 5. Compare dist vs source timestamps
for f in .opencode/lib/dist/*.js; do
  base=$(basename "$f" .js)
  ts_file=".opencode/lib/${base}.ts"
  if [ -f "$ts_file" ]; then
    echo "$base: dist=$(stat -c %Y "$f") source=$(stat -c %Y "$ts_file")"
  else
    echo "$base: dist exists, NO source .ts"
  fi
done
```

---

## 4. Conclusion

`.opencode/lib/dist/` is **actively used but unmanaged**. It provides stale JavaScript builds of TypeScript source files that are now out of sync. Because the directory is gitignored, cloning the repo will not recreate it, yet several scripts assume it exists.

### 4.1 Risk Level

| Risk Area | Level | Reason |
|-----------|-------|--------|
| Correctness | **High** | Stale `gate-core.js` lacks recent fixes |
| Reproducibility | **High** | dist is not tracked; fresh clones lack it |
| Maintainability | **Medium** | Dual-source pattern only in one file |

### 4.2 Recommended Actions

**Option A — Remove dist dependency (preferred)**
Update the 6 scripts to import/require `.ts` source files directly. Bun can load TypeScript natively; Node fallback can use `tsx` or `--experimental-strip-types`.

**Option B — Add a build step**
Add a `build:lib` script to `package.json` that compiles `.opencode/lib/*.ts` → `.opencode/lib/dist/*.js` before runtime. Ensure CI runs it and the directory remains gitignored.

**Option C — Hybrid with runtime compilation**
Keep `nightly-compaction.ts` source-first pattern and apply it to all scripts: try `.ts` source import first, fall back to dist only when source is unavailable.

---

## 5. Related Files

- `.opencode/lib/gate-core.ts` — source for stale `gate-core.js`
- `.opencode/lib/log-manager.ts` — source for stale `log-rotator.js` (and related utilities)
- `.opencode/scripts/nightly-compaction.ts` — example of source-first loading
- `.gitignore` — line 11 ignores `dist/`
- `package.json` — no build script currently defined

---

*Report generated by @Super-Admin during FW-IMPL-LOG-UNIFY follow-up.*
