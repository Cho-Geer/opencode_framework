// service/dispatch/query.ts — Read-only query interface
// Re-exports diagnostic/query functions from dispatch service modules.

export { readDispatchPolicy, readDispatchPolicy as getDispatchPolicy } from "./dag-policy";
export { dbGetDispatchQueue, dbGetPendingCount } from "./session-log";
