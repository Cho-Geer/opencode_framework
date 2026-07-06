// service/session/index.ts — SessionService 统一入口
// 所有 session 相关 DB 写入的唯一入口

// Session map 管理
export {
  upsertSessionMap,
  removeSessionMap,
  cleanOrphanSessionMaps,
  readSessionMapEntry,
  resolveAgentFromSessionMap,
  normalizeAgent,
} from "./session-map";

// 身份解析
export {
  resolveAgent,
  resolveTaskId,
  resolveTaskIdWithSource,
  resolveDomainId,
  resolveDomainIdWithSource,
  resolveLatestDispatchAgent,
  resolveCallerIdentity,
} from "./resolver";
export type { ResolvedWithSource } from "./resolver";

// Dispatch 上下文
export {
  sessionLastDispatched,
} from "./dispatch-context";

// 生命周期管理
export {
  runStartupCleanup,
  writeSessionMapWithConstraint,
  runPreflightAutoMark,
  handleSessionError,
  handleSessionCompacted,
  handleSessionIdle,
  updateMemorySessionMap,
  getMemorySessionMapSize,
} from "./lifecycle";

// 配置认证
export { resetConfigReadPerRound, attestConfigRead } from "./config-attest";
export { attestSkillRead } from "./skill-attest";
export type { AttestSkillReadInput, AttestSkillReadResult } from "./skill-attest";
export { attestRuleRead } from "./rule-attest";
export type { AttestRuleReadInput, AttestRuleReadResult } from "./rule-attest";
export type { AttestConfigReadInput, AttestConfigReadResult } from "./config-attest";

// Round summary
export { generateRoundSummary } from "./round-summary";

// Compliance audit (extracted from session.ts plugin, Batch 2)
export { runComplianceAudit } from "./compliance-audit";

// 只读查询
export * as query from "./query";

// Tool convenience wrappers
export { resolveDomainIdForTool } from "./resolver";
