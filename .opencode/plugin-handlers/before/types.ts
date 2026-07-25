// plugin-handlers/before/types.ts — Before handler interface
// Shared type definitions for all before handlers.

export interface BeforeContext {
  tool: string;
  sessionID: string;
  callID: string;
  args: Record<string, any>;
  /** Mutable — handlers can modify args before tool execution */
  outputArgs: Record<string, any>;
  agent: string;
}

/**
 * Before handler return type.
 * - void/undefined = pass (tool proceeds)
 * - throw Error = block (tool execution stopped, early termination)
 */
export type BeforeHandler = (ctx: BeforeContext) => Promise<void>;

/**
 * Handler metadata — used by dispatcher for tool filtering.
 */
export interface HandlerMeta {
  name: string;
  /** Tools this handler intercepts. ["*"] = all tools. */
  tools: string[];
}
