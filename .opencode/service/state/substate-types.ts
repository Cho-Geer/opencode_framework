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

/**
 * DiagnosticState — TypeScript diagnostic state for 3-layer tsc gating.
 * Written by tsc-diag-track.ts plugin via tool.execute.after hook.
 * Records per-file TypeScript errors for consumption by before-hook blocking
 * (Layer 1), submitDeliverables (Layer 2), and compliance_gate_complete (Layer 3).
 * Replaces the deprecated type_check_state (which only recorded dirty_files, no line-level info).
 *
 * @since 2026-06-26 (tsc diagnostic gate v2.0, per lsp-diagnostic-gate-implementation-plan.md)
 */
export interface DiagnosticFileEntry {
  errors?: Array<{
    message: string;
    line: number;
    character: number;
    code: string;
    received_at?: string;
  }>;
  warnings?: Array<{
    message: string;
    line: number;
    received_at?: string;
  }>;
  updated_at?: string;
  /** v2 (2026-06-27): Which phase recorded this — "before-write-gate" or "after-write-gate" */
  source?: string;
  /** v2 (2026-06-27): Which session recorded this */
  session_id?: string;
  [key: string]: any;
}

export interface DiagnosticState {
  /** Per-file diagnostic entries, keyed by absolute file path */
  files?: Record<string, DiagnosticFileEntry>;
  /** ISO 8601 timestamp of last diagnostic update */
  last_updated?: string;
  /** v2 (2026-06-27): Schema version for TSC Diagnostic Gate migration tracking */
  schema_version?: string;
  /** v2 (2026-06-27): Last tsc scan timestamp (ms) */
  last_scan?: number;
  /** v2 (2026-06-27): Whether diagnostic_state has dirty entries */
  dirty?: boolean;
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

/**
 * KnowledgeAuditState — Bounded aggregate audit rollup (KC-02, 2026-06-21)
 * Retained and activated as DB-managed audit state. Written by non-fatal
 * knowledge-audit.ts helper functions from multiple UC7KS pipeline writers.
 * All write failures are silently logged — never throw/block.
 */
export interface KnowledgeAuditState {
  /** Whether knowledge pipeline auditing is enabled */
  enabled?: boolean;
  /** ISO 8601 timestamp of last cache check */
  last_cache_check?: string;
  /** ISO 8601 timestamp of last external knowledge acquisition */
  last_knowledge_acquisition?: string;
  /** Bounded aggregate audit counters */
  aggregate?: KnowledgeAuditAggregate;
  /** Ring buffer of recent events (max 100, oldest evicted) */
  recent_events?: KnowledgeAuditEvent[];
  /** Legacy fields kept for backward compatibility */
  last_audit?: string;
  total_accesses?: number;
  coverage_score?: number;
  [key: string]: any;
}

/** Aggregate counters for knowledge pipeline activity rollup */
export interface KnowledgeAuditAggregate {
  total_cache_checks?: number;
  total_cache_hits?: number;
  total_cache_misses?: number;
  total_attestations?: number;
  total_attestation_failures?: number;
  total_curator_dispatches?: number;
  total_external_fetches?: number;
  reverse_orphan_count?: number;
  last_cleanup_removed_session_entries?: number;
  [key: string]: any;
}

/** Single audit event entry for the recent_events ring buffer */
export interface KnowledgeAuditEvent {
  event: string;
  agent?: string;
  timestamp: string;
  detail?: string;
  task_id?: string;
  domain?: string;
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

/**
 * G-7 (2026-06-27): Diagnostic baseline entry — one TS error in the baseline.
 * Used by baseline-diagnostic.ts and tsc-diag-track.ts for L1/L2 diff gating.
 */
export interface DiagnosticBaselineEntry {
  file: string;
  code: string;
  message: string;
  line: number;
  character: number;
}

/**
 * G-7 (2026-06-27): Diagnostic baseline — full snapshot of all pre-existing TS errors.
 * Stored in SQLite substate_kv (DB-canonical, no JSON dual-write).
 */
export interface DiagnosticBaseline {
  hash: string;
  total_errors: number;
  bucket_counts: Record<string, number>;
  errors: DiagnosticBaselineEntry[];
  captured_at: string;
  tsc_version: string;
  source: string;
  [key: string]: any;
}

/**
 * Layer C (step-0d-log-audit-mandate.md, v3.1): Tool Audit State
 * Tracks webfetch/websearch/context7/github_* tool calls and their
 * success/failure outcomes. Persisted by uc7ks-after.ts TRACKED_TOOLS branch.
 * This is the 15th sub-state (diagnostic_baseline is 14th, G-7).
 * Each session has its own tool_calls[] ring buffer (max 200 entries).
 */
export interface ToolAuditSessionEntry {
  agent: string;
  tool_calls: Array<{
    tool: string;
    outcome: "SUCCESS" | "FAILURE";
    timestamp: string;
    callID: string;
    error?: string;
  }>;
}

export interface ToolAuditState {
  /** Per-session tool call records, keyed by OpenCode session ID */
  sessions?: Record<string, ToolAuditSessionEntry>;
  [key: string]: any;
}

// ── Master Type Map ──
// Maps each substate key (string literal) to its interface type.
// Used by readSubState<K>() / writeSubState<K>() for compile-time key + value type checking.
export interface SubStateMap {
  eslint_state: EslintState;
  /** @deprecated type_check_state replaced by diagnostic_state (2026-06-26, tsc diagnostic gate) */
  // type_check_state: TypeCheckState;
  diagnostic_state: DiagnosticState;
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
  /** G-7 (2026-06-27): diagnostic baseline — pre-existing TS errors snapshot */
  diagnostic_baseline: DiagnosticBaseline;
  /** Layer C (2026-06-27): tool audit state — tracks webfetch/websearch/etc success/failure */
  tool_audit_state: ToolAuditState;
}

/** Union of all valid sub-state key names. */
export type SubStateKey = keyof SubStateMap;
