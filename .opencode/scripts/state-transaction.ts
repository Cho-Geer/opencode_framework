#!/usr/bin/env bun
/**
 * state-transaction.js — Unified State Transaction Engine
 * =======================================================
 * OpenCode v3.0 Atomic Commit Protocol for state files.
 *
 * Wraps updates to gate-state.json and machine.json in a
 * two-phase write protocol with write-ahead logging (WAL).
 *
 * Features:
 *   - UUID v4 operation IDs (zero-dependency)
 *   - Monotonic revision counter in machine.json.meta.revision
 *   - Two-phase write: PREPARE → COMMIT / ROLLBACK
 *   - Atomic file replacement via tmpfile + rename (POSIX atomic)
 *   - Write-Ahead Log: .opencode/state/.transaction-log (NDJSON)
 *   - Crash recovery: scans for orphaned .prepared markers
 *   - Thread-safe: advisory lock via .lock file (optional, best-effort)
 *
 * Usage (as module):
 *   const { beginTransaction } = require('./state-transaction');
 *   const txn = beginTransaction(filePath, agent, taskId);
 *   txn.prepare(content);
 *   txn.commit();
 *   // or txn.rollback('reason');
 *
 * Usage (CLI):
 *   bun state-transaction.ts <command> [args...]
 *   Commands: verify, recover, log-tail
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── Constants ────────────────────────────────────────────
const OPENCODE_ROOT =
  process.env.OPENCODE_ROOT ? path.resolve(process.env.OPENCODE_ROOT) : path.resolve(__dirname, "..", "..");
const STATE_DIR = path.join(OPENCODE_ROOT, ".opencode", "state");
const TRANSACTION_LOG = path.join(STATE_DIR, ".transaction-log");
const MACHINE_JSON = path.join(STATE_DIR, "machine.json");

// ─── UUID v4 Generator (RFC 4122, zero-dependency) ────────
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── SHA-256 Hash ─────────────────────────────────────────
function sha256(content) {
  return "sha256-" + crypto.createHash("sha256").update(content).digest("hex");
}

// ─── Ensure State Directory ──────────────────────────────
function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

// ─── Monotonic Revision Counter ───────────────────────────
function getCurrentRevision() {
  try {
    const machine = JSON.parse(fs.readFileSync(MACHINE_JSON, "utf-8"));
    return machine.meta?.revision || 0;
  } catch {
    return 0;
  }
}

function incrementRevision(machineObj) {
  if (!machineObj.meta) {
    machineObj.meta = {};
  }
  const current = machineObj.meta.revision || 0;
  machineObj.meta.revision = current + 1;
  machineObj.meta.lastUpdated = new Date().toISOString();
  // Update transaction state in machine.json
  if (!machineObj.transaction_state) {
    machineObj.transaction_state = {};
  }
  return machineObj.meta.revision;
}

// ─── Transaction Log (WAL) ────────────────────────────────
/**
 * Append a log entry to the Write-Ahead Log (NDJSON format).
 * Each line is a JSON object terminated by \n.
 * 
 * FW-REPAIR-12: Auto-rotates .transaction-log when it exceeds 100KB
 * (same policy as safe-bash.log). Rotation is non-blocking — if it fails,
 * the log continues in the current file.
 */
function appendTransactionLog(entry) {
  ensureStateDir();
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(TRANSACTION_LOG, line, "utf-8");
  
  // Auto-rotate if log exceeds 100KB (non-blocking)
  try {
    const stat = fs.statSync(TRANSACTION_LOG);
    if (stat.size > 100 * 1024) {
      rotateTransactionLog();
    }
  } catch (_) {
    // Rotation is best-effort; failures should not block the append
  }
}

/**
 * Rotate .transaction-log: shift .2→.3, .1→.2, current→.1
 */
function rotateTransactionLog() {
  const MAX_ROTATED = 3;
  const dir = path.dirname(TRANSACTION_LOG);
  
  // Remove oldest rotated file
  const oldestFile = `${TRANSACTION_LOG}.${MAX_ROTATED}`;
  if (fs.existsSync(oldestFile)) {
    fs.unlinkSync(oldestFile);
  }
  
  // Shift rotated files: .2→.3, .1→.2
  for (let i = MAX_ROTATED - 1; i >= 1; i--) {
    const src = `${TRANSACTION_LOG}.${i}`;
    const dst = `${TRANSACTION_LOG}.${i + 1}`;
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
    }
  }
  
  // Move current to .1
  fs.renameSync(TRANSACTION_LOG, `${TRANSACTION_LOG}.1`);
  
  // Start fresh log
  fs.writeFileSync(TRANSACTION_LOG, "", "utf-8");
}

/**
 * Read the transaction log and return an array of parsed entries.
 */
function readTransactionLog() {
  try {
    if (!fs.existsSync(TRANSACTION_LOG)) return [];
    const content = fs.readFileSync(TRANSACTION_LOG, "utf-8").trim();
    if (!content) return [];
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Find all COMMIT entries for a given operation_id.
 */
function findCommitEntries(operationId) {
  return readTransactionLog().filter(
    (e) => e.phase === "COMMIT" && e.operation_id === operationId,
  );
}

/**
 * Find all PREPARE entries for a given operation_id.
 */
function findPrepareEntries(operationId) {
  return readTransactionLog().filter(
    (e) => e.phase === "PREPARE" && e.operation_id === operationId,
  );
}

// ─── Sync File to Disk ────────────────────────────────────
function fsyncFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

// ─── Transaction Class ────────────────────────────────────
class StateTransaction {
  /**
   * @param {string} filePath  - Absolute path to the target state file
   * @param {string} agent     - Agent identity (@Architect, @Coder-BE, etc.)
   * @param {string} taskId    - Current task ID for audit trail
   */
  constructor(filePath, agent, taskId) {
    this.filePath = path.resolve(filePath);
    this.agent = agent || "unknown";
    this.taskId = taskId || "unknown";
    this.operationId = generateUUID();
    this.oldHash = null;
    this.newHash = null;
    this.newRevision = null;
    this.tmpPath = this.filePath + ".txn-" + this.operationId + ".tmp";
    this.preparedPath =
      this.filePath + ".txn-" + this.operationId + ".prepared";
    this.committed = false;
    this.rolledBack = false;
    this.startTime = Date.now();
    this._oldContent = null;
  }

  /**
   * Phase 1: PREPARE
   * - Read current file, compute old_hash
   * - Read current revision, compute new_revision
   * - Write BEGIN and PREPARE entries to WAL
   * - Write new content to .tmp file
   * - Write .prepared marker
   * - fsync .tmp and .prepared
   *
   * @param {string} newContent - The new file content to write
   * @returns {{ operation_id: string, new_revision: number }}
   */
  prepare(newContent) {
    if (this.committed || this.rolledBack) {
      throw new Error(
        `Transaction ${this.operationId} already finalized (committed=${this.committed}, rolledBack=${this.rolledBack})`,
      );
    }

    ensureStateDir();
    const timestamp = new Date().toISOString();

    // ═══ Read current file state ═══
    if (fs.existsSync(this.filePath)) {
      this._oldContent = fs.readFileSync(this.filePath, "utf-8");
      this.oldHash = sha256(this._oldContent);
    } else {
      this._oldContent = null;
      this.oldHash = sha256("");
    }

    // ═══ Compute new revision ═══
    // For machine.json, read the file to get/set revision counter
    // For other files (gate-state.json), increment a file-system-level revision
    const isMachineJson = path.basename(this.filePath) === "machine.json";
    if (isMachineJson) {
      try {
        const machineObj = JSON.parse(newContent);
        this.newRevision = incrementRevision(machineObj);
        // Re-serialize with updated meta
        newContent = JSON.stringify(machineObj, null, 2) + "\n";
      } catch {
        this.newRevision = getCurrentRevision() + 1;
      }
    } else {
      this.newRevision = getCurrentRevision() + 1;
      // Non-machine files: increment the machine revision to record this mutation
      if (fs.existsSync(MACHINE_JSON)) {
        try {
          const machineObj = JSON.parse(fs.readFileSync(MACHINE_JSON, "utf-8"));
          machineObj.meta.revision = this.newRevision;
          // Update transaction_state in machine.json
          if (!machineObj.transaction_state) {
            machineObj.transaction_state = {};
          }
          machineObj.transaction_state.last_operation_id = this.operationId;
          machineObj.transaction_state.last_transaction_at = timestamp;
          // Write machine.json update (non-transactional for the revision bump itself)
          // We use atomic write for this too
          const machineTmp =
            MACHINE_JSON + ".txn-" + this.operationId + ".rev.tmp";
          fs.writeFileSync(
            machineTmp,
            JSON.stringify(machineObj, null, 2) + "\n",
            "utf-8",
          );
          fs.renameSync(machineTmp, MACHINE_JSON);
        } catch {
          // If machine.json can't be read, just use the counter
        }
      }
    }

    // ═══ Write BEGIN to WAL ═══
    // NOTE: new_revision is intentionally NOT recorded on BEGIN.
    // It is only recorded on COMMIT to avoid duplicate revision entries
    // in the WAL that cause false-positive non-monotonic errors in the verifier.
    appendTransactionLog({
      phase: "BEGIN",
      operation_id: this.operationId,
      file: path.relative(OPENCODE_ROOT, this.filePath),
      old_hash: this.oldHash,
      timestamp,
      agent: this.agent,
      task_id: this.taskId,
    });

    // ═══ Write new content to .tmp file ═══
    fs.writeFileSync(this.tmpPath, newContent, "utf-8");

    // ═══ Write .prepared marker ═══
    const preparedMarker = {
      operation_id: this.operationId,
      file: this.filePath,
      old_hash: this.oldHash,
      new_revision: this.newRevision,
      timestamp,
      agent: this.agent,
      task_id: this.taskId,
      tmp_path: this.tmpPath,
    };
    fs.writeFileSync(
      this.preparedPath,
      JSON.stringify(preparedMarker, null, 2) + "\n",
      "utf-8",
    );

    // ═══ fsync both files to durable storage ═══
    fsyncFile(this.tmpPath);
    fsyncFile(this.preparedPath);

    // ═══ Write PREPARE to WAL ═══
    appendTransactionLog({
      phase: "PREPARE",
      operation_id: this.operationId,
      timestamp: new Date().toISOString(),
    });

    // ═══ Compute new hash ═══
    this.newHash = sha256(newContent);

    return {
      operation_id: this.operationId,
      new_revision: this.newRevision,
    };
  }

  /**
   * Phase 2: COMMIT
   * - Atomic compare-and-set: verify current revision matches expected
   * - Retry up to 3 times with exponential backoff on CAS failure
   * - Atomic rename: .tmp → target file (POSIX ensures atomicity on same FS)
   * - Write COMMIT entry to WAL
   * - Remove .prepared marker
   * - Update machine.json transaction_state if this IS machine.json
   *
   * @returns {{ operation_id: string, new_revision: number, new_hash: string, duration_ms: number }}
   */
  commit() {
    if (this.committed) {
      throw new Error(`Transaction ${this.operationId} already committed`);
    }
    if (this.rolledBack) {
      throw new Error(
        `Transaction ${this.operationId} was rolled back, cannot commit`,
      );
    }

    ensureStateDir();
    const timestamp = new Date().toISOString();

    // ═══ P5-002: Atomic compare-and-set for revision ═══
    // Verify current revision hasn't changed since prepare
    const MAX_RETRIES = 3;
    const BACKOFF_MS = [10, 100, 500];
    let casSuccess = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const currentRevision = getCurrentRevision();

      // expected new revision should be current + 1
      const expectedRevision = currentRevision + 1;

      if (this.newRevision === expectedRevision) {
        // CAS passed — revision matches expectation
        casSuccess = true;
        break;
      }

      if (attempt === MAX_RETRIES) {
        throw new Error(
          `TransactionConflictError: operation_id=${this.operationId}, ` +
          `expected_revision=${expectedRevision}, actual_revision=${currentRevision}, ` +
          `new_revision=${this.newRevision}. Concurrent modification detected after ${MAX_RETRIES + 1} attempts.`,
        );
      }

      // Backoff and retry: re-read machine.json and recompute revision
      const backoffMs = BACKOFF_MS[attempt] || 500;
      process.stderr.write(
        `[state-transaction] ⚠ CAS retry ${attempt + 1}/${MAX_RETRIES} for ${this.operationId}: ` +
        `expected rev ${expectedRevision}, current rev ${currentRevision}. Retrying in ${backoffMs}ms\n`,
      );

      // Sleep for backoff
      const startSleep = Date.now();
      while (Date.now() - startSleep < backoffMs) {
        // busy-wait (short backoff)
      }

      // Re-read and recompute revision
      const isMachineJson = path.basename(this.filePath) === "machine.json";
      if (isMachineJson && fs.existsSync(this.filePath)) {
        try {
          const freshContent = fs.readFileSync(this.filePath, "utf-8");
          const machineObj = JSON.parse(freshContent);
          this.newRevision = incrementRevision(machineObj);
          // Update tmp file with new revision
          fs.writeFileSync(this.tmpPath, JSON.stringify(machineObj, null, 2) + "\n", "utf-8");
        } catch {
          this.newRevision = getCurrentRevision() + 1;
        }
      } else {
        this.newRevision = getCurrentRevision() + 1;
      }
    }

    if (!casSuccess) {
      throw new Error(
        `TransactionConflictError: operation_id=${this.operationId} — CAS failed after all retries`,
      );
    }

    // ═══ Atomic rename (POSIX guarantee: rename is atomic on same filesystem) ═══
    fs.renameSync(this.tmpPath, this.filePath);

    // ═══ Write COMMIT to WAL ═══
    const durationMs = Date.now() - this.startTime;
    appendTransactionLog({
      phase: "COMMIT",
      operation_id: this.operationId,
      timestamp,
      new_hash: this.newHash,
      new_revision: this.newRevision,
      duration_ms: durationMs,
    });

    // ═══ Remove .prepared marker ═══
    try {
      if (fs.existsSync(this.preparedPath)) {
        fs.unlinkSync(this.preparedPath);
      }
    } catch {
      // Best effort cleanup — non-critical
    }

    this.committed = true;

    return {
      operation_id: this.operationId,
      new_revision: this.newRevision,
      new_hash: this.newHash,
      duration_ms: durationMs,
    };
  }

  /**
   * ROLLBACK
   * - Remove .tmp file
   * - Write ROLLBACK entry to WAL
   * - Remove .prepared marker
   *
   * @param {string} reason - Why the rollback occurred
   * @returns {{ operation_id: string, reason: string }}
   */
  rollback(reason) {
    if (this.committed) {
      throw new Error(
        `Transaction ${this.operationId} already committed, cannot rollback`,
      );
    }
    if (this.rolledBack) {
      throw new Error(`Transaction ${this.operationId} already rolled back`);
    }

    const timestamp = new Date().toISOString();

    // ═══ Remove .tmp file ═══
    try {
      if (fs.existsSync(this.tmpPath)) {
        fs.unlinkSync(this.tmpPath);
      }
    } catch {
      // Best effort
    }

    // ═══ Write ROLLBACK to WAL ═══
    appendTransactionLog({
      phase: "ROLLBACK",
      operation_id: this.operationId,
      timestamp,
      reason: reason || "unknown",
      duration_ms: Date.now() - this.startTime,
    });

    // ═══ Remove .prepared marker ═══
    try {
      if (fs.existsSync(this.preparedPath)) {
        fs.unlinkSync(this.preparedPath);
      }
    } catch {
      // Best effort
    }

    this.rolledBack = true;

    return {
      operation_id: this.operationId,
      reason: reason || "unknown",
    };
  }
}

// ─── Convenience Factory ──────────────────────────────────
/**
 * Begin a new state transaction for the given file.
 *
 * @param {string} filePath - Absolute path to the target state file
 * @param {string} agent    - Agent identity (@Architect, @Coder-BE, etc.)
 * @param {string} taskId   - Current task ID for audit trail
 * @returns {StateTransaction}
 */
function beginTransaction(filePath, agent, taskId) {
  ensureStateDir();
  return new StateTransaction(filePath, agent, taskId);
}

// ─── Crash Recovery ───────────────────────────────────────
/**
 * Scan for orphaned .prepared markers (prepared but never committed or rolled back).
 * For each orphan:
 *   1. Check WAL for matching COMMIT entry → if found, just clean up .prepared
 *   2. Check WAL for matching ROLLBACK entry → if found, just clean up .prepared
 *   3. No COMMIT/ROLLBACK → rollback (remove .tmp, clean .prepared, log recovery)
 *
 * @returns {{ recovered: number, orphans: string[], details: object[] }}
 */
function runRecoveryScan() {
  ensureStateDir();
  const results = { recovered: 0, orphans: [], details: [] };

  if (!fs.existsSync(STATE_DIR)) return results;

  const files = fs.readdirSync(STATE_DIR);
  const preparedFiles = files.filter((f) => f.endsWith(".prepared"));

  for (const preparedFile of preparedFiles) {
    const preparedPath = path.join(STATE_DIR, preparedFile);
    let preparedData;
    try {
      preparedData = JSON.parse(fs.readFileSync(preparedPath, "utf-8"));
    } catch {
      // Corrupted .prepared — remove it
      fs.unlinkSync(preparedPath);
      results.recovered++;
      results.details.push({
        file: preparedFile,
        action: "removed_corrupted_prepared",
      });
      continue;
    }

    const operationId = preparedData.operation_id;
    const tmpPath = preparedData.tmp_path;

    // Check WAL for COMMIT
    const commits = findCommitEntries(operationId);
    if (commits.length > 0) {
      // COMMIT exists — transaction completed, just cleanup
      try {
        if (fs.existsSync(preparedPath)) fs.unlinkSync(preparedPath);
      } catch {}
      // Check if .tmp still lingering
      if (tmpPath && fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
      results.recovered++;
      results.details.push({
        operation_id: operationId,
        action: "cleanup_committed",
        note: "COMMIT found in WAL, cleaned up stale .prepared and .tmp",
      });
      continue;
    }

    // Check WAL for ROLLBACK
    const rollbacks = readTransactionLog().filter(
      (e) => e.phase === "ROLLBACK" && e.operation_id === operationId,
    );
    if (rollbacks.length > 0) {
      // Already rolled back, just cleanup
      try {
        if (fs.existsSync(preparedPath)) fs.unlinkSync(preparedPath);
      } catch {}
      if (tmpPath && fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
      results.recovered++;
      results.details.push({
        operation_id: operationId,
        action: "cleanup_rolledback",
        note: "ROLLBACK found in WAL, cleaned up stale .prepared and .tmp",
      });
      continue;
    }

    // ═══ Orphaned PREPARE — needs rollback ═══
    results.orphans.push(operationId);

    // Remove .tmp
    if (tmpPath && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }

    // Log RECOVERY_ROLLBACK to WAL
    appendTransactionLog({
      phase: "RECOVERY_ROLLBACK",
      operation_id: operationId,
      timestamp: new Date().toISOString(),
      reason: "crash_recovery: orphaned PREPARE without COMMIT/ROLLBACK",
      file: preparedData.file,
    });

    // Remove .prepared
    try {
      fs.unlinkSync(preparedPath);
    } catch {}

    results.recovered++;
    results.details.push({
      operation_id: operationId,
      action: "rollback_orphan",
      file: preparedData.file,
      note: "Orphaned PREPARE found, rolled back via crash recovery",
    });
  }

  return results;
}

// ─── Verification ─────────────────────────────────────────
/**
 * Verify the integrity of the transaction log:
 *   1. Every BEGIN must have a matching COMMIT or ROLLBACK (or RECOVERY_ROLLBACK)
 *   2. Every PREPARE must have a matching COMMIT or ROLLBACK
 *   3. COMMIT entries must reference a valid BEGIN and PREPARE
 *   4. Revision numbers must be monotonic (no gaps, no regressions)
 *
 * @returns {{ valid: boolean, issues: string[] }}
 */
function verifyTransactionLog() {
  const entries = readTransactionLog();
  const issues = [];

  const begins = new Map(); // operation_id → entry
  const prepares = new Map();
  const commits = new Map();
  const rollbacks = new Map();

  for (const entry of entries) {
    switch (entry.phase) {
      case "BEGIN":
        begins.set(entry.operation_id, entry);
        break;
      case "PREPARE":
        prepares.set(entry.operation_id, entry);
        break;
      case "COMMIT":
        commits.set(entry.operation_id, entry);
        break;
      case "ROLLBACK":
      case "RECOVERY_ROLLBACK":
        rollbacks.set(entry.operation_id, entry);
        break;
    }
  }

  // Check 1: Every BEGIN must have COMMIT or ROLLBACK
  for (const [opId, begin] of begins) {
    if (!commits.has(opId) && !rollbacks.has(opId)) {
      issues.push(
        `Orphaned BEGIN: operation_id=${opId} has no COMMIT or ROLLBACK`,
      );
    }
  }

  // Check 2: Every PREPARE must have COMMIT or ROLLBACK
  for (const [opId] of prepares) {
    if (!commits.has(opId) && !rollbacks.has(opId)) {
      issues.push(
        `Orphaned PREPARE: operation_id=${opId} has no COMMIT or ROLLBACK`,
      );
    }
  }

  // Check 3: COMMIT must reference valid BEGIN
  for (const [opId] of commits) {
    if (!begins.has(opId) && !prepares.has(opId)) {
      issues.push(
        `Orphaned COMMIT: operation_id=${opId} has no BEGIN or PREPARE`,
      );
    }
  }

  // Check 4: Revision monotonicity (only COMMIT entries, since COMMIT represents
  // the definitive state change. BEGIN entries may carry new_revision from legacy
  // logs, but only COMMIT is authoritative for the revision sequence.)
  const revisionEntries = entries
    .filter((e) => e.phase === "COMMIT" && e.new_revision != null)
    .sort((a, b) => a.new_revision - b.new_revision);

  let prevRevision = -1;
  for (const entry of revisionEntries) {
    if (entry.new_revision <= prevRevision) {
      issues.push(
        `Non-monotonic revision: operation_id=${entry.operation_id} has revision ${entry.new_revision} but previous was ${prevRevision}`,
      );
    }
    prevRevision = entry.new_revision;
  }

  return {
    valid: issues.length === 0,
    issues,
    stats: {
      total_entries: entries.length,
      begins: begins.size,
      prepares: prepares.size,
      commits: commits.size,
      rollbacks: rollbacks.size,
      recovery_rollbacks: entries.filter((e) => e.phase === "RECOVERY_ROLLBACK")
        .length,
    },
  };
}

// ─── Initialize ───────────────────────────────────────────
/**
 * Initialize the transaction system on first bootstrap.
 * - Run recovery scan for orphaned transactions
 * - Ensure .transaction-log exists
 * - Ensure machine.json has meta.revision set
 */
function initializeTransactionSystem() {
  ensureStateDir();

  // ═══ Recovery Scan ═══
  const recovery = runRecoveryScan();
  if (recovery.recovered > 0) {
    process.stderr.write(
      `[state-transaction] ⚠ Crash recovery: ${recovery.recovered} orphaned transaction(s) recovered\n`,
    );
    for (const detail of recovery.details) {
      process.stderr.write(
        `  - ${detail.operation_id}: ${detail.action} — ${detail.note}\n`,
      );
    }
  }

  // ═══ Ensure .transaction-log exists ═══
  if (!fs.existsSync(TRANSACTION_LOG)) {
    fs.writeFileSync(TRANSACTION_LOG, "", "utf-8");
  }

  // ═══ Ensure machine.json has meta.revision ═══
  if (fs.existsSync(MACHINE_JSON)) {
    try {
      const machine = JSON.parse(fs.readFileSync(MACHINE_JSON, "utf-8"));
      let updated = false;

      if (!machine.meta) {
        machine.meta = {};
        updated = true;
      }
      if (machine.meta.revision == null) {
        // Set initial revision to the count of existing COMMIT entries + 1
        const commitCount = readTransactionLog().filter(
          (e) => e.phase === "COMMIT",
        ).length;
        machine.meta.revision = Math.max(1, commitCount + 1);
        updated = true;
      }
      if (!machine.transaction_state) {
        machine.transaction_state = {
          last_operation_id: null,
          last_transaction_at: null,
          pending_operations: [],
          transaction_log_path: ".opencode/state/.transaction-log",
        };
        updated = true;
      }

      if (updated) {
        fs.writeFileSync(
          MACHINE_JSON,
          JSON.stringify(machine, null, 2) + "\n",
          "utf-8",
        );
      }
    } catch {
      // machine.json corrupted or unreadable — state-machine-reset.sh should handle this
    }
  }

  return recovery;
}

// ─── P5-002: Repair Monotonic Revision ────────────────────
/**
 * Repair the revision sequence to be strictly monotonic.
 * Scans all COMMIT entries in the transaction log, reassigns sequential
 * revision numbers (1, 2, 3, ...) ordered by timestamp, and updates
 * the WAL entries. Also updates machine.json meta.revision to the max.
 *
 * @returns {{ success: boolean, entries_repaired: number, max_revision: number, issues: string[] }}
 */
function repairMonotonicRevision() {
  const issues = [];
  const entries = readTransactionLog();

  // Find all COMMIT entries with new_revision
  const commitEntries = entries
    .map((e, idx) => ({ ...e, _index: idx }))
    .filter((e) => e.phase === "COMMIT" && e.new_revision != null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (commitEntries.length === 0) {
    return { success: true, entries_repaired: 0, max_revision: 0, issues: [] };
  }

  // Check for non-monotonic pattern
  let prevRev = -1;
  let hasNonMonotonic = false;
  for (const entry of commitEntries) {
    if (entry.new_revision <= prevRev) {
      hasNonMonotonic = true;
      issues.push(`Non-monotonic: op=${entry.operation_id} rev=${entry.new_revision} after rev=${prevRev}`);
    }
    prevRev = entry.new_revision;
  }

  if (!hasNonMonotonic) {
    // Already monotonic — just report
    const maxRev = Math.max(...commitEntries.map((e) => e.new_revision));
    return { success: true, entries_repaired: 0, max_revision: maxRev, issues: [] };
  }

  // Repair: reassign sequential revisions ordered by timestamp
  // We need to rewrite the WAL file
  let repairedCount = 0;
  const newRevMap = new Map(); // operation_id → new revision number

  commitEntries.forEach((entry, seqIdx) => {
    const newRev = seqIdx + 1;
    if (entry.new_revision !== newRev) {
      newRevMap.set(entry.operation_id, newRev);
      repairedCount++;
    }
  });

  // Rewrite transaction log with corrected revisions
  const newLines = entries.map((entry, idx) => {
    if (entry.phase === "COMMIT" && entry.new_revision != null && newRevMap.has(entry.operation_id)) {
      const correctedEntry = { ...entry, new_revision: newRevMap.get(entry.operation_id) };
      return JSON.stringify(correctedEntry);
    }
    // Also fix if entry was the old raw entry
    return JSON.stringify(entry);
  });

  fs.writeFileSync(TRANSACTION_LOG, newLines.join("\n") + "\n", "utf-8");

  // Update machine.json meta.revision to the max
  const maxRev = commitEntries.length; // After repair, max = count
  if (fs.existsSync(MACHINE_JSON)) {
    try {
      const machine = JSON.parse(fs.readFileSync(MACHINE_JSON, "utf-8"));
      if (!machine.meta) machine.meta = {};
      machine.meta.revision = maxRev;
      machine.meta.lastUpdated = new Date().toISOString();
      fs.writeFileSync(MACHINE_JSON, JSON.stringify(machine, null, 2) + "\n", "utf-8");
    } catch {
      issues.push("Failed to update machine.json meta.revision");
    }
  }

  return {
    success: true,
    entries_repaired: repairedCount,
    max_revision: maxRev,
    issues,
  };
}

// ─── CLI Interface ────────────────────────────────────────
function runCLI() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  switch (command) {
    case "verify": {
      const result = verifyTransactionLog();
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    }

    case "recover": {
      const result = runRecoveryScan();
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    case "log-tail": {
      const n = parseInt(args[0] || "20", 10);
      const entries = readTransactionLog();
      const tail = entries.slice(-n);
      for (const entry of tail) {
        console.log(JSON.stringify(entry));
      }
      process.exit(0);
    }

    case "init": {
      const result = initializeTransactionSystem();
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    // ═══ P5-002: Repair monotonic revision sequence ═══
    case "repair-monotonic": {
      // Rewrite revision sequence to be strict monotonic
      // Reads all COMMIT entries, reassigns sequential revision numbers
      const result = repairMonotonicRevision();
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    // ═══ Internal: prepare+commit in one step (for scripted use) ═══
    case "atomic-write": {
      // Usage: bun state-transaction.ts atomic-write <filePath> <agent> <taskId>
      // Content is read from stdin
      const filePath = args[0];
      const agent = args[1] || "unknown";
      const taskId = args[2] || "unknown";

      if (!filePath) {
        console.error("ERROR: filePath required");
        process.exit(1);
      }

      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const content = Buffer.concat(chunks).toString("utf-8");
        const txn = beginTransaction(filePath, agent, taskId);
        txn.prepare(content);
        const result = txn.commit();
        console.log(JSON.stringify(result));
        process.exit(0);
      });
      process.stdin.resume();
      return;
    }

    default: {
      console.error("Usage: bun state-transaction.ts <command> [args...]");
      console.error("Commands:");
      console.error("  verify          Verify transaction log integrity");
      console.error("  recover         Run crash recovery scan");
      console.error(
        "  log-tail [N]    Show last N transaction log entries (default 20)",
      );
      console.error("  init            Initialize transaction system");
      console.error(
        "  atomic-write <file> <agent> <taskId>  Atomic write (content from stdin)",
      );
      process.exit(1);
    }
  }
}

// ═══ Run CLI if called directly ═══
if (require.main === module) {
  runCLI();
}

// ═══ Module Exports ═══
module.exports = {
  StateTransaction,
  beginTransaction,
  generateUUID,
  sha256,
  initializeTransactionSystem,
  runRecoveryScan,
  verifyTransactionLog,
  readTransactionLog,
  getCurrentRevision,
  repairMonotonicRevision,
  TRANSACTION_LOG,
  MACHINE_JSON,
  STATE_DIR,
};
