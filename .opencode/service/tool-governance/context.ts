import type { RepoOperation } from "../repo/types";
import type { VerifiedCommandPlan } from "../file-guard/shell-plan";

export interface ToolGovernanceContext {
  sessionID: string;
  callID?: string;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  command?: string;
  targetPaths: string[];
  repoOperation?: RepoOperation | null;
  verifiedCommandPlan?: VerifiedCommandPlan;
}
