// service/gate/store-types.ts — Gate store type definitions (pure types, no runtime code)
// Split from: store.ts

// ════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════

export interface DeliverableEntry {
  name: string;
  description: string;
  artifact_path?: string;
  required: boolean;
}

export interface DeliverableEvidence {
  name: string;
  artifact_path?: string;
  content_summary?: string;
  submitted_at?: string;
}

export interface GateSession {
  session_id: string;
  created_at: string;
  task_description?: string;
  enforcement_mode?: string;
  gate_status:
    | "checked"
    | "armed"
    | "delivered"
    | "approved"
    | "completed"
    | "failed"
    | "recoverable"
    | "drained";
  last_check_passed?: boolean;
  last_check_failed_items?: GateCheckItem[];
  plan_summary?: string | null;
  confirmed_at?: string | null;
  consumed_at?: string | null;
  expires_at?: string | null;
  task_id?: string | null;
  agent?: string;
  worktree?: string;
  audit?: GateAudit | null;
  fail_reason?: string;
  missing_artifacts?: string[];
  fail_history?: GateFailHistoryEntry[];
  retry_count?: number;
  declared_deliverables?: DeliverableEntry[];
  submitted_deliverables?: DeliverableEvidence[];
  deliverables_approved_by?: string;
  deliverables_approved_at?: string;
  deliverables_approval_note?: string;
  approval_required?: boolean;
}

export interface GateFailHistoryEntry {
  retry: number;
  failed_at: string;
  reason: string;
}

export interface GateCheckItem {
  id: string;
  desc: string;
  severity: "HIGH" | "WARNING" | "INFO";
}

export interface GateStore {
  formatVersion: string;
  active_sessions: string[];
  sessions: Record<string, GateSession>;
  audit_history?: GateAuditEntry[];
  last_updated?: string;
}

export interface GateAuditEntry {
  session_id: string;
  task_description?: string;
  plan_summary?: string | null;
  agent?: string;
  task_id?: string | null;
  confirmed_at?: string | null;
  consumed_at?: string;
  execution_summary?: string;
  gate_status?: string;
}

export interface GateAudit {
  execution_summary: string;
  completed_at: string;
}

export interface GateCheckResult {
  passed: boolean;
  session_id: string;
  enforcement_mode: string;
  failed_items: GateCheckItem[];
  rule_status: Record<string, string>;
}

export interface GateConfirmResult {
  status: "armed" | "rejected";
  reason?: string;
  session_id?: string;
  confirmed_at?: string;
  expires_at?: string;
  plan_summary?: string;
}

export interface GateCompleteResult {
  status: "completed" | "failed" | "rejected";
  reason?: string;
  audit?: {
    session_id: string;
    task_description?: string;
    plan_summary?: string | null;
    confirmed_at?: string | null;
    consumed_at?: string;
    execution_summary?: string;
    audit_history_count?: number;
  };
  dirty_modules?: string[];
  missing_artifacts?: string[];
}

export type EnforcementMode = "advisory" | "strict" | "locked";

export interface EnforcementModeWithSource {
  configMode: EnforcementMode;
  envMode: EnforcementMode | null;
  finalMode: EnforcementMode;
  downgraded: boolean;
  downgradeReason: string | null;
}

export interface FrameworkPaths {
  root: string;
  dag: string;
  gateState: string;
  machine: string;
  projectConfig: string;
  ruleRegistry: string;
  ruleRegistryFallback: string;
  pluginsDir: string;
  hooksDir: string;
  stateDir: string;
  scriptsDir: string;
  agentsDir: string;
  rulesDir: string;
}

export interface DagExistsResult {
  found: boolean;
  taskCount: number;
}

export interface TaskInDagResult {
  found: boolean;
  status: string;
  owner: string;
}

export interface DagProgressResult {
  total: number;
  completed: number;
  pending: number;
  progressPercent: number;
}

export interface ArmedSessionResult {
  found: boolean;
  gateSessionId: string | null;
}

export interface StaleSessionInfo {
  id: string;
  age: number;
}

export interface StaleSessionsResult {
  stale: StaleSessionInfo[];
  count: number;
}

export interface GateIntegrityResult {
  valid: boolean;
  issues: string[];
}

export interface MachineCleanlinessResult {
  clean: boolean;
  dirty: string[];
}

export interface RegistryMismatch {
  file: string;
  severity: "HIGH" | "WARNING";
}

export interface RuleRegistryResult {
  valid: boolean;
  mismatches: RegistryMismatch[];
}

export interface WriteScope {
  allowed: string[];
  denied: string[];
}
