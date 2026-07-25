export interface ToolGovernanceDecision {
  outcome: "allow" | "deny" | "ask" | "audit_only";
  ruleId: string;
  layer:
    | "static-permission"
    | "path-protection"
    | "repo-policy"
    | "impact-evidence"
    | "grant"
    | "tool-final-guard";
  severity: "info" | "warn" | "error";
  message: string;
  details: Record<string, unknown>;
}
