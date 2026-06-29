// uc7ks-utils.ts — Bridge → service/knowledge/cache-check + enforcement
// ═══════════════════════════════════════════════════════════════════════
// Phase 1f: Thin re-export bridge. Original 824L file split into:
//   - service/knowledge/cache-check.ts (cache index, checkUC7KS)
//   - service/knowledge/enforcement.ts (checkUC7KSWrite)
// ═══════════════════════════════════════════════════════════════════════

// ── Cache check (from cache-check.ts) ─────────────────────────────────
export {
  readCacheIndex,
  isLocalCacheAvailable,
  readCachedSessionAccess,
  buildUC7KSError,
  checkUC7KS,
} from "../service/knowledge/cache-check";

// ── Write enforcement (from enforcement.ts) ───────────────────────────
export { checkUC7KSWrite } from "../service/knowledge/enforcement";
