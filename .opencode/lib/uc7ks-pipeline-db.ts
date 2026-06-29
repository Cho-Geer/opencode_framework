// uc7ks-pipeline-db.ts — Bridge → service/knowledge/pipeline-db
// ═══════════════════════════════════════════════════════════════════════
// Phase 1f: Thin re-export bridge. Original 464L file moved to service layer.
// ═══════════════════════════════════════════════════════════════════════

export type {
  CacheDiscovery,
  CacheAttestation,
  PipelineStateRow,
  PipelineDomainSummary,
} from "../service/knowledge/pipeline-db";

export {
  resolvePipelineId,
  atomicUpsertDiscovery,
  readDiscoveryForAttest,
  atomicUpsertAttestation,
  queryAttestationForWriteGate,
  readPipelineState,
  queryAllAgentPipelineDomains,
} from "../service/knowledge/pipeline-db";
