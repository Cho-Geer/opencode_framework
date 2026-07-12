export type RepoProvider = "git" | "gh" | "github_mcp" | "none";

export type RepoOperationKind =
  | "read"
  | "local_write"
  | "remote_write"
  | "destructive"
  | "hook_bypass"
  | "unknown";

export type RepoDecision =
  | "allow"
  | "block"
  | "grant_required"
  | "human_confirmation_required";

export interface RepoOperation {
  provider: RepoProvider;
  command: string;
  argv: string[];
  subcommand: string;
  kind: RepoOperationKind;
  decision: RepoDecision;
  paths: string[];
  remotes: string[];
  requiresGrant: boolean;
  requiresHumanConfirmation: boolean;
  reason: string;
}

export interface RepoClassificationInput {
  provider?: RepoProvider;
  command?: string;
  argv?: string[];
  toolName?: string;
  args?: Record<string, unknown>;
}
