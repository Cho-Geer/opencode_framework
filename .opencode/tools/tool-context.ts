import type { ToolContext } from "@opencode-ai/plugin";

export type FrameworkToolContext = ToolContext & {
  callID?: string;
};
