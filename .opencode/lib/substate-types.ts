// substate-types.ts — Type-safe interfaces for all 12 sub-states
// ═══════════════════════════════════════════════════════════════════════
// P3/G12: Generated from actual DB data shapes (substate_kv table).
//
// Design principle: ALL properties are optional (`?`) to satisfy two constraints:
//   1. `readSubState()` returns `{}` on DB failure → empty object must satisfy type.
//   2. Existing callers all use `?.` optional chaining → no breaking change.
//
// This gives key-name type safety (compile-time error on typos) without
// forcing every caller to handle every possible property as required.
//
// @author @Super-Admin
// @version 1.0.0
// @since 2026-06-16
//
// @see docs/review/framework-refactor/p3-deep-optimization-plan.md §二
// ═══════════════════════════════════════════════════════════════════════

export interface EslintState {
  last_full_scan?: string;
  modules?: Record<
    string,
    {
      status?: string;
      violations?: Array<Record<string, any>>;
      last_check?: string;
      [key: string]: any;
    }
  >;
  aggregate?: {
    total_violations?: number;
    dirty_modules?: string[];
    waived_modules?: string[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface TypeCheckState {
  status?: string;
  dirty_files?: string[];
  last_checked?: string;
  errors?: Array<Record<string, any>>;
  [key: string]: any;
}

export interface DependencyState {
  status?: string;
  dirty_files?: string[];
  last_checked?: string;
  packages?: Record<string, any>;
  [key: string]: any;
}

export interface FormatState {
  status?: string;
  dirty_files?: string[];
  last_checked?: string;
  formatter?: string;
  [key: string]: any;
}

export interface WriteAuditState {
  sessions?: Record<string, Record<string, any>>;
  history?: Array<Record<string, any>>;
  [key: string]: any;
}

export interface ComplianceRecords {
  role_violations?: Array<Record<string, any>>;
  gate_violations?: Array<Record<string, any>>;
  tdd_violations?: Array<Record<string, any>>;
  super_admin_dispatch_bypasses?: Array<Record<string, any>>;
  orchestrator_sa_dispatches?: Array<Record<string, any>>;
  [key: string]: any;
}

export interface KnowledgeCacheState {
  cache_status?: string;
  total_entries?: number;
  last_index_check?: string;
  last_fetch_at?: string;
  compliance?: Record<string, any>;
  pipeline_integrity?: Record<string, any>;
  session_access?: Record<string, Record<string, any>>;
  total_docs_count?: number;
  total_size_bytes?: number;
  last_verified?: string;
  [key: string]: any;
}

export interface KnowledgeAuditState {
  last_audit?: string;
  total_accesses?: number;
  coverage_score?: number;
  [key: string]: any;
}

export interface TddEnforcementState {
  enabled?: boolean;
  current_session?: Record<string, any>;
  violations?: Array<Record<string, any>>;
  history?: Array<Record<string, any>>;
  [key: string]: any;
}

export interface KeystoneHashes {
  [filePath: string]: string;
}

export interface TransactionState {
  last_operation_id?: string;
  last_transaction_at?: string;
  pending_operations?: Array<Record<string, any>>;
  transaction_log_path?: string;
  [key: string]: any;
}

export interface KnowledgeState {
  domains_covered?: string[];
  last_updated?: string;
  coverage_score?: number;
  [key: string]: any;
}

/**
 * ConfigReadSessionEntry — Individual session attestation record.
 * Each session's config_read_attest() result is stored as one entry
 * in ConfigReadState.sessions. Used by dbAtomicWriteSubState for
 * atomic append within SQLite transaction (prevents cross-agent overwrites).
 * Follows the same pattern as KnowledgeCacheState.session_access.
 * @since 2026-06-19 (config-attest-race-fix-plan v1.1.0)
 */
export interface ConfigReadSessionEntry {
  session_id: string;
  agent?: string;
  attested_at: string;
  files: string[];
  verified: boolean;
  unread_files?: string[];
  [key: string]: any;
}

/**
 * ConfigReadState — 13th sub-state (SA-IMPLEMENT-CONFIG-ATTEST-001, 2026-06-19)
 * Tracks whether the agent completed config_read_attest() (Step 0e of P0 protocol).
 * Written by config_read_attest.ts MCP tool; read by scope-before.ts pre-gate check.
 *
 * ⚠️ RACE CONDITION FIX (2026-06-19): Uses nested sessions map instead of a single
 * per-key session. Each session's attestation is stored in the `sessions` map keyed
 * by sessionID. dbAtomicWriteSubState() provides atomic read-modify-write within a
 * SQLite transaction to prevent cross-agent overwrites. Follows the same pattern as
 * KnowledgeCacheState.session_access.
 */
export interface ConfigReadState {
  /** Per-session attestation records, keyed by OpenCode session ID */
  sessions?: Record<string, ConfigReadSessionEntry>;
  [key: string]: any;
}

// ── Master Type Map ──
// Maps each substate key (string literal) to its interface type.
// Used by readSubState<K>() / writeSubState<K>() for compile-time key + value type checking.
export interface SubStateMap {
  eslint_state: EslintState;
  type_check_state: TypeCheckState;
  dependency_state: DependencyState;
  format_state: FormatState;
  write_audit_state: WriteAuditState;
  compliance_records: ComplianceRecords;
  knowledge_cache_state: KnowledgeCacheState;
  knowledge_audit_state: KnowledgeAuditState;
  tdd_enforcement_state: TddEnforcementState;
  keystone_hashes: KeystoneHashes;
  transaction_state: TransactionState;
  knowledge_state: KnowledgeState;
  config_read_state: ConfigReadState;
}

/** Union of all valid sub-state key names. */
export type SubStateKey = keyof SubStateMap;
