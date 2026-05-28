#!/usr/bin/env node
/**
 * safe-edit.ts — Atomic File Edit with TOCTOU Protection, Backup & Rollback
 * ==========================================================================
 *
 * TypeScript hardened version of safe-edit.js with:
 *   1) Symlink resolution BEFORE any stat operations (TOCTOU via symlink)
 *   2) Atomic rename for ALL write paths (backup, write, restore)
 *   3) Concurrent-write safety via mkdir-based file locking
 *   4) TypeScript interfaces for all types
 *   5) Full TOCTOU registry detection, backup, content verification, rollback, restore
 *
 * Exports:
 *   safeEdit(filePath, content, options?) -> SafeEditResult
 *   restore(backupPath, targetPath) -> SafeEditRestoreResult
 *   safeEdit.restore() — backward-compat alias
 *
 * Interfaces:
 *   SafeEditOptions, SafeEditResult, SafeEditRestoreResult
 *
 * Reference: .opencode/tools/safe-edit.js (original JS version)
 * Design:    HARDEN-CONSTRAINT-DESIGN/re-evaluation/final-synthesis.md B1
 */
export interface SafeEditOptions {
    /** Agent type identifier (e.g. '@Coder-BE') */
    agentType?: string;
    /** Task identifier (e.g. 'CI-STRENGTHEN-003') */
    taskId?: string;
}
export interface SafeEditResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Path to the backup file (only on success) */
    backupPath?: string;
    /** Error message (only on failure) */
    error?: string;
}
export interface SafeEditRestoreResult {
    /** Whether the restore succeeded */
    success: boolean;
    /** Error message (only on failure) */
    error?: string;
}
/**
 * Atomically edit a file with TOCTOU protection, backup, and rollback.
 *
 * HARDENING IMPROVEMENTS over safe-edit.js:
 *   - Symlink resolution at function entry (before any stat operations)
 *   - Concurrent-write safety via mkdir-based file locking
 *   - TypeScript types for all interfaces
 *   - Atomic rename verified for ALL write paths
 */
export declare function safeEdit(filePath: string, content: string, options?: SafeEditOptions): SafeEditResult;
export declare namespace safeEdit {
    var restore: typeof import("./safe-edit").restore;
}
/**
 * Restore a file from a backup created by safeEdit.
 * Uses atomic restore (copy to temp -> rename) for crash safety.
 */
export declare function restore(backupPath: string, targetPath: string): SafeEditRestoreResult;
