/**
 * read-audit.ts — Read event audit trail for READ-BEFORE-APPROVE enforcement
 * ═══════════════════════════════════════════════════════════════════════
 * Records every `read` tool invocation (via read-track-after.ts plugin) to
 * an append-only JSONL file. Provides verifyRead() for compliance-gate.ts
 * to check whether an approver actually read HANDOVER.md before approving.
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-18
 *
 * Design review: docs/review/framework-refactor/read-before-approve-plan.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "./log-manager";

// ── Types ──────────────────────────────────────────────────────

export interface ReadAuditEntry {
  /** ISO 8601 timestamp of the read event */
  timestamp: string;
  /** Agent identity (e.g. "Orchestrator", "@Super-Admin") */
  agent: string;
  /** Absolute or relative file path that was read */
  filePath: string;
  /** Session ID of the gate session being approved */
  sessionId?: string;
  /** DAG task ID for context */
  taskId?: string;
  /** Read tool invocation ID (from OpenCode callID) */
  callId?: string;
}

export interface ReadVerifyResult {
  verified: boolean;
  reason: string;
  matchedEntry?: ReadAuditEntry;
}

// ── Configuration ──────────────────────────────────────────────

/** Maximum age of a read event to be considered valid for approval (5 min) */
const READ_MAX_AGE_MS = 5 * 60 * 1000;

/** Maximum records to keep in the audit file (oldest pruned first) */
const MAX_RECORDS = 10000;

/**
 * File path for read audit log.
 * Resolved relative to OPENCODE_ROOT for consistency with the rest of the
 * state management system (same pattern as state-utils.ts STATE_PATHS).
 */
function getReadAuditPath(): string {
  const root = process.env.OPENCODE_ROOT || ".";
  return path.resolve(root, ".opencode", "state", "read_audit.jsonl");
}

// ── Core Functions ─────────────────────────────────────────────

/**
 * Record a read event to the audit log.
 * Called by read-track-after.ts plugin on every `read` tool invocation.
 *
 * @param entry - Read audit entry to record
 */
export function recordRead(entry: ReadAuditEntry): void {
  try {
    const auditPath = getReadAuditPath();
    const dir = path.dirname(auditPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Append single line JSON (JSONL format) — POSIX O_APPEND safe
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(auditPath, line, "utf8");

    // Periodic cleanup: keep only last MAX_RECORDS
    cleanupOldRecords();

    writeLog("lib-read-audit", "INFO", {
      event: "READ_RECORDED",
      agent: entry.agent,
      filePath: entry.filePath,
      sessionId: entry.sessionId || "—",
    });
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "RECORD_READ_FAILED",
      error: err.message,
    });
  }
}

/**
 * Verify that an agent has read a specific file within the valid time window.
 * Called by compliance-gate.ts runGateApproveDeliverables before approval.
 *
 * @param agent - Agent identity to check (e.g. "Orchestrator")
 * @param filePath - File path that must have been read
 * @param sessionId - Optional session ID for cross-reference
 * @returns Verification result with matched entry if found
 */
export function verifyRead(
  agent: string,
  filePath: string,
  sessionId?: string,
): ReadVerifyResult {
  try {
    const auditPath = getReadAuditPath();
    if (!fs.existsSync(auditPath)) {
      return {
        verified: false,
        reason: `Read audit log not found at ${auditPath}. No read events recorded.`,
      };
    }

    const content = fs.readFileSync(auditPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const now = Date.now();
    const cutoff = now - READ_MAX_AGE_MS;

    // Normalize agent name (strip @ prefix for comparison)
    const normalizedAgent = agent.replace(/^@/, "").toLowerCase();

    // Scan from newest to oldest for efficiency
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry: ReadAuditEntry = JSON.parse(lines[i]);

        // Check time window
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime < cutoff) {
          // Past cutoff — no newer entries will match either
          // (since we're scanning newest→oldest)
          break;
        }

        // Check agent match (case-insensitive, @-prefix agnostic)
        const entryAgent = (entry.agent || "").replace(/^@/, "").toLowerCase();
        if (entryAgent !== normalizedAgent) continue;

        // Check file path match (normalize for .task_temp/{taskId}/HANDOVER.md patterns)
        if (pathsMatch(entry.filePath, filePath)) {
          // For session-scoped checks: if sessionId provided, prefer exact session match
          if (sessionId && entry.sessionId && entry.sessionId !== sessionId) {
            continue; // Different session — keep searching
          }

          return {
            verified: true,
            reason: `Agent "${entry.agent}" read "${entry.filePath}" at ${entry.timestamp}`,
            matchedEntry: entry,
          };
        }
      } catch {
        // Corrupted line — skip
        continue;
      }
    }

    // No match found
    const absPath = path.resolve(process.env.OPENCODE_ROOT || ".", filePath);
    return {
      verified: false,
      reason:
        `Agent "@${normalizedAgent}" has NOT read "${filePath}" via the \`read\` tool ` +
        `within the last ${READ_MAX_AGE_MS / 60000} minutes. ` +
        `You MUST use the \`read\` tool to open and review HANDOVER.md before approving. ` +
        `Compute hash manually: sha256sum ${absPath}`,
    };
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "VERIFY_READ_FAILED",
      error: err.message,
    });
    return {
      verified: false,
      reason: `Read audit verification failed: ${err.message}`,
    };
  }
}

/**
 * Normalize two file paths for comparison.
 * Handles relative vs absolute, .task_temp/{taskId}/HANDOVER.md patterns,
 * and trailing slashes.
 */
function pathsMatch(p1: string, p2: string): boolean {
  const root = process.env.OPENCODE_ROOT || ".";

  const normalize = (p: string): string => {
    // Resolve relative to OPENCODE_ROOT
    const resolved = p.startsWith("/") ? p : path.resolve(root, p);
    // Normalize separators and remove trailing slash
    return path.normalize(resolved).replace(/\/+$/, "").toLowerCase();
  };

  try {
    return normalize(p1) === normalize(p2);
  } catch {
    return p1.toLowerCase() === p2.toLowerCase();
  }
}

/**
 * Clean up old read audit records beyond MAX_RECORDS.
 * Keeps only the most recent MAX_RECORDS entries.
 */
function cleanupOldRecords(): void {
  try {
    const auditPath = getReadAuditPath();
    if (!fs.existsSync(auditPath)) return;

    const content = fs.readFileSync(auditPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    if (lines.length <= MAX_RECORDS) return;

    // Keep only last MAX_RECORDS entries
    const kept = lines.slice(-MAX_RECORDS);
    fs.writeFileSync(auditPath, kept.join("\n") + "\n", "utf8");

    writeLog("lib-read-audit", "INFO", {
      event: "READ_AUDIT_CLEANUP",
      pruned: lines.length - kept.length,
      remaining: kept.length,
    });
  } catch {
    // Non-critical — audit file continues to grow
  }
}

// Re-export constants for external use
export { READ_MAX_AGE_MS, MAX_RECORDS };
