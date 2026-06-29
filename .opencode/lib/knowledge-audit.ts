// knowledge-audit.ts — Bridge → service/knowledge/audit
// ═══════════════════════════════════════════════════════════════════════
// Phase 1f: Thin re-export bridge. Original 259L file moved to service layer.
// ═══════════════════════════════════════════════════════════════════════

export type { AggregateKey } from "../service/knowledge/audit";

export {
  AGGREGATE_KEYS,
  getDefaultAuditState,
  readAuditState,
  writeAuditState,
  atomicUpdateKnowledgeAudit,
  incrementAuditCounter,
  pushAuditEvent,
  touchCacheCheck,
  touchKnowledgeAcquisition,
} from "../service/knowledge/audit";
