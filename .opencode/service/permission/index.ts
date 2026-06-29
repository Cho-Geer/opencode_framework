/**
 * service/permission/index.ts — Barrel export for permission service module
 * Re-exports from reader.ts (permission data) and isolation.ts (permission isolation logic).
 */
export * from "./b6-permission-reader";
export * from "./b6-permission-isolation";
export { default as PermissionIsolationDefault } from "./b6-permission-isolation";
