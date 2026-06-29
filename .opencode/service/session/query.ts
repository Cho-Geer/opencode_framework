// service/session/query.ts — Read-only query interface
// Only SELECT operations,供 Plugin (Middleware) 读取判断
// 禁止任何 INSERT/UPDATE/DELETE

import { readSessionMapEntry, resolveAgentFromSessionMap } from "./session-map";
import {
  resolveAgent,
  resolveTaskId,
  resolveTaskIdWithSource,
  resolveDomainId,
  resolveDomainIdWithSource,
  resolveLatestDispatchAgent,
  resolveCallerIdentity,
} from "./resolver";
import type { ResolvedWithSource } from "./resolver";

export {
  resolveAgent,
  resolveTaskId,
  resolveTaskIdWithSource,
  resolveDomainId,
  resolveDomainIdWithSource,
  resolveLatestDispatchAgent,
  resolveCallerIdentity,
  resolveAgentFromSessionMap,
  readSessionMapEntry as getSessionMap,
};

export type { ResolvedWithSource };
