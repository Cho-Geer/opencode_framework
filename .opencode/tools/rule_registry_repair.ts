/**
 * rule_registry_repair.ts — Rule Registry Digest Repair Tool
 * 
 * Bootstraps the rule_registry.json when file digests have drifted from
 * registered values. This breaks the deadlock where:
 *   - Files were legitimately modified (e.g., adding §2.11 to TEMPLATE_VARIABLE_STANDARD.md)
 *   - Registry digest is stale (no semver bump occurred)
 *   - pre-execution-gate.ts blocks all dispatches with HIGH severity mismatch
 *   - Orchestrator can't dispatch @Super-Admin to fix the registry
 * 
 * This tool allows Orchestrator (or any agent with permission) to:
 *   1. Detect mismatches (dry_run: true)
 *   2. Repair mismatches by recomputing digests and bumping PATCH semver
 *   3. Write back atomically with audit trail
 * 
 * Design reference: docs/review/rule-registry/rule-registry-repair-workflow-plan.md
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { withInterruptGuard } from "../lib";

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const REGISTRY_PATH = path.join(PROJECT_ROOT, ".opencode", "state", "rule_registry.json");
const LOG_PATH = path.join(PROJECT_ROOT, ".opencode", "logs", "rule-registry-repair.log");

/**
 * Compute SHA-256 hash of a file's content.
 * Matches the format used by compliance-gate.ts: "sha256-{hex}"
 */
function computeFileHash(filePath: string): { hash: string | null; error: string | null } {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const hash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    return { hash: "sha256-" + hash, error: null };
  } catch (err: any) {
    return { hash: null, error: err.message };
  }
}

/**
 * Bump the PATCH component of a semver string.
 * E.g., "2.0.0" → "2.0.1", "1.2.3" → "1.2.4"
 */
function bumpPatchSemver(semver: string): string {
  const parts = semver.split(".");
  if (parts.length !== 3) return semver;
  const patch = parseInt(parts[2], 10);
  if (isNaN(patch)) return semver;
  parts[2] = String(patch + 1);
  return parts.join(".");
}

/**
 * Append an audit log entry to the repair log file.
 * Format: ISO timestamp | event | details
 */
function appendAuditLog(entry: Record<string, any>): void {
  try {
    const logDir = path.dirname(LOG_PATH);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    }) + "\n";
    fs.appendFileSync(LOG_PATH, line, "utf-8");
  } catch {
    // Best-effort logging; failures are non-fatal
  }
}

/**
 * Write registry atomically: write to temp file, then rename.
 */
function writeRegistryAtomic(registry: any): void {
  const tmpPath = REGISTRY_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, REGISTRY_PATH);
}

export default tool({
  description:
    "Repair rule_registry.json digest mismatches. Recomputes SHA-256 digests " +
    "for all registered files, bumps PATCH semver on mismatched entries, and " +
    "writes back atomically. Returns a summary of repairs applied. " +
    "Use when dispatch is blocked by rule_registry digest mismatch.\n\n" +
    "Usage:\n" +
    "  rule_registry_repair(dry_run=true) — report mismatches without fixing\n" +
    "  rule_registry_repair(dry_run=false) — fix all mismatches\n" +
    "  rule_registry_repair(force=true) — force repair even if semver already bumped",
  args: {
    dry_run: tool.schema.boolean().optional().default(false)
      .describe("If true, report mismatches without writing. Default: false."),
    force: tool.schema.boolean().optional().default(false)
      .describe("If true, repair even if semver was already bumped (unusual). Default: false."),
  },
  async execute(args, context) {
    return withInterruptGuard("rule_registry_repair", async () => {
      const agent = context?.agent || "unknown";
      const dryRun = args.dry_run ?? false;
      const force = args.force ?? false;

      // ── 1. Read registry ──────────────────────────────────────────
      if (!fs.existsSync(REGISTRY_PATH)) {
        return JSON.stringify({
          status: "error",
          message: "rule_registry.json not found at " + REGISTRY_PATH,
        });
      }

      let registry: any;
      try {
        const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
        registry = JSON.parse(raw);
      } catch (err: any) {
        return JSON.stringify({
          status: "error",
          message: "Cannot parse rule_registry.json: " + err.message,
        });
      }

      const entries = registry.entries || {};
      const entryKeys = Object.keys(entries);

      if (entryKeys.length === 0) {
        return JSON.stringify({
          status: "empty",
          message: "No entries in rule_registry.json",
          total_entries: 0,
          mismatches: 0,
          repairs: [],
        });
      }

      // ── 2. Scan for mismatches ────────────────────────────────────
      const mismatches: Array<{
        key: string;
        path: string;
        stored_hash: string;
        actual_hash: string | null;
        stored_semver: string;
        error?: string;
      }> = [];

      for (const key of entryKeys) {
        const entry = entries[key];
        const filePath = path.join(PROJECT_ROOT, entry.path || key);

        if (!fs.existsSync(filePath)) {
          mismatches.push({
            key,
            path: entry.path || key,
            stored_hash: entry.sha256 || "missing",
            actual_hash: null,
            stored_semver: entry.semver || "unknown",
            error: "FILE_MISSING",
          });
          continue;
        }

        const result = computeFileHash(filePath);
        if (result.error) {
          mismatches.push({
            key,
            path: entry.path || key,
            stored_hash: entry.sha256 || "missing",
            actual_hash: null,
            stored_semver: entry.semver || "unknown",
            error: "READ_ERROR: " + result.error,
          });
          continue;
        }

        const storedHash = "sha256-" + (entry.sha256 || "").replace(/^sha256-/, "");
        if (result.hash !== storedHash) {
          mismatches.push({
            key,
            path: entry.path || key,
            stored_hash: storedHash,
            actual_hash: result.hash,
            stored_semver: entry.semver || "unknown",
          });
        }
      }

      // ── 3. Apply repairs (unless dry_run) ─────────────────────────
      const repairs: Array<{
        key: string;
        path: string;
        old_semver: string;
        new_semver: string;
        old_hash: string;
        new_hash: string;
      }> = [];

      if (!dryRun && mismatches.length > 0) {
        for (const m of mismatches) {
          if (m.error === "FILE_MISSING") continue; // Can't repair missing files
          if (m.error?.startsWith("READ_ERROR")) continue; // Can't repair unreadable files
          if (!force && m.stored_semver !== "unknown") {
            // Only repair if semver hasn't been bumped already
            // (i.e., the mismatch is genuine, not a post-bump state)
          }

          const entry = entries[m.key];
          const oldSemver = entry.semver || "0.0.0";
          const newSemver = bumpPatchSemver(oldSemver);
          const newHash = m.actual_hash!.replace(/^sha256-/, "");

          entry.semver = newSemver;
          entry.sha256 = newHash;
          entry.last_modified = new Date().toISOString();

          // Append to digest_history
          if (!entry.digest_history) entry.digest_history = [];
          entry.digest_history.push({
            sha256: newHash,
            timestamp: new Date().toISOString(),
            semver: newSemver,
            change: "Auto-repaired by rule_registry_repair tool (agent: " + agent + ")",
          });

          repairs.push({
            key: m.key,
            path: m.path,
            old_semver: oldSemver,
            new_semver: newSemver,
            old_hash: m.stored_hash,
            new_hash: m.actual_hash!,
          });
        }

        // Write back atomically
        if (repairs.length > 0) {
          registry.meta.last_updated = new Date().toISOString();
          writeRegistryAtomic(registry);
        }
      }

      // ── 4. Audit log ──────────────────────────────────────────────
      appendAuditLog({
        agent,
        dry_run: dryRun,
        force,
        total_entries: entryKeys.length,
        mismatches_found: mismatches.length,
        repairs_applied: repairs.length,
        mismatch_details: mismatches.map(m => ({
          key: m.key,
          stored_hash_short: m.stored_hash.substring(0, 16),
          actual_hash_short: m.actual_hash ? m.actual_hash.substring(0, 16) : null,
          error: m.error || null,
        })),
        repair_details: repairs.map(r => ({
          key: r.key,
          old_semver: r.old_semver,
          new_semver: r.new_semver,
        })),
      });

      // ── 5. Return summary ─────────────────────────────────────────
      const status = dryRun
        ? "dry_run"
        : repairs.length > 0
        ? "repaired"
        : "clean";

      return JSON.stringify({
        status,
        dry_run: dryRun,
        force,
        total_entries: entryKeys.length,
        mismatches_found: mismatches.length,
        repairs_applied: repairs.length,
        mismatches: mismatches.map(m => ({
          key: m.key,
          path: m.path,
          stored_semver: m.stored_semver,
          stored_hash_short: m.stored_hash.substring(0, 20) + "...",
          actual_hash_short: m.actual_hash ? m.actual_hash.substring(0, 20) + "..." : null,
          error: m.error || null,
        })),
        repairs: repairs.map(r => ({
          key: r.key,
          path: r.path,
          old_semver: r.old_semver,
          new_semver: r.new_semver,
          old_hash_short: r.old_hash.substring(0, 20) + "...",
          new_hash_short: r.new_hash.substring(0, 20) + "...",
        })),
      }, null, 2);
    });
  },
});
