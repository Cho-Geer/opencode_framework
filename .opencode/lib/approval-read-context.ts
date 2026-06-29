// approval-read-context.ts — BRIDGE → service/gate/approval-context.ts
// Phase 1b migration: all logic moved to service/gate/approval-context.ts

export {
  buildApprovalArgsHashInput,
  computeApprovalArgsHash,
  recordApprovalContext,
  getApprovalContext,
  markApprovalContextConsumed,
  SRC,
} from "../service/gate/approval-context";

export type { ApprovalReadContext } from "../service/gate/approval-context";
