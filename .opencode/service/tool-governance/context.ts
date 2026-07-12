import type { RepoOperation } from "../repo/types";

export interface ToolGovernanceContext {
  sessionID: string;
  callID?: string;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  command?: string;
  targetPaths: string[];
  repoOperation?: RepoOperation | null;
}
