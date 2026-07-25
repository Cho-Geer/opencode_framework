// agent-resolver.ts — RE-EXPORT BRIDGE
// All logic moved to service/session/. This file preserves backward
// compatibility for 20+ existing import paths across the framework.
//
// Phase 1c migration: lib/ → service/session/
// Do NOT add business logic here — only re-exports.

export {
  resolveAgent,
  resolveTaskId,
  resolveTaskIdWithSource,
  resolveDomainId,
  resolveDomainIdWithSource,
  resolveLatestDispatchAgent,
  resolveCallerIdentity,
  resolveAgentFromSessionMap,
  readSessionMapEntry as getSessionMapEntry,
  sessionLastDispatched,
} from "../service/session";

export type { ResolvedWithSource } from "../service/session";
