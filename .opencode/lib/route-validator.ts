// lib/route-validator.ts — BRIDGE (Batch 6)
// Logic migrated to service/dispatch/route-validator-{config,l0-l2,l3-l4}.ts

export {
  type VerbRule, type ScopeRule, type PurposeRule, type RouteConfig, type AgentDomainMap,
  readRouteConfig, resetRouteConfigCache, readOpencodeConfig, readProjectPaths, resetProjectPathsCache,
  buildShortToLongPathMapping, normalizeTargetFilesForPermissionMatch, getAgentDomainMap,
} from "../service/dispatch/route-validator-config";

export {
  l1_verbCandidates, inferDispatchPurpose, l0_purposeFilter, l2_scopeFilter,
} from "../service/dispatch/route-validator-l0-l2";

export {
  l3_permissionFilter, extractScopePatterns, findScopeAgent, validateDagTaskAgentAssignment,
  l4_heuristicSelect, l4_dagCheck, isDispatchRouteExempt,
  isFrameworkInfraFile, isBusinessCodeFile, findRouteAgentForFile,
} from "../service/dispatch/route-validator-l3-l4";
