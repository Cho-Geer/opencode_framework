// plugin-handlers/after/types.ts — After handler interface
// Shared type definitions for all after handlers.

export interface AfterContext {
  tool: string;
  sessionID: string;
  callID: string;
  args: Record<string, any>;
  output: any;
  agent: string;
}

/**
 * After handler return type.
 * All after handlers are fire-and-forget (no throw, no blocking).
 * Errors are caught by the dispatcher and logged.
 */
export type AfterHandler = (ctx: AfterContext) => Promise<void>;

export interface HandlerMeta {
  name: string;
  tools: string[];
}
