/**
 * tsc-gate-config.ts — TSC Diagnostic Gate v2 configuration
 * ════════════════════════════════════════════════════════════
 * Reads tsc_gate_* configuration from project.config.json
 * template_resolution section.
 *
 * Design: TEMPLATIZATION & PARAMETERIZATION UNIVERSALITY SUBSYSTEM
 * All configurable parameters are in project.config.json so the
 * framework can be adapted per project without code changes.
 *
 * @author @Super-Admin
 * @since 2026-06-27 (TSC Diagnostic Gate v2)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SRC = "tsc-gate-config";

export interface TscGateConfig {
  /** Gate mode: "zero-tolerance" (v2) or "baseline-diff" (v1 compat) */
  mode: string;
  /** tsc --noEmit timeout (ms) */
  timeout_ms: number;
  /** File lock timeout (ms) — auto-release if agent crashes */
  lock_timeout_ms: number;
  /** Whether to block on ALL errors (true) or only target file errors */
  block_on_all_errors: boolean;
  /** Max errors to show in error messages */
  max_errors_shown: number;
}

const DEFAULT_CONFIG: TscGateConfig = {
  mode: "zero-tolerance",
  timeout_ms: 30000,
  lock_timeout_ms: 60000,
  block_on_all_errors: true,
  max_errors_shown: 5,
};

/**
 * Read TSC gate configuration from project.config.json.
 * Falls back to defaults if config is missing or unreadable.
 * No caching — always re-reads for live updates.
 */
export function getTscGateConfig(): TscGateConfig {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const raw = fs.readFileSync(
      path.join(root, ".opencode", "project.config.json"),
      "utf8",
    );
    const cfg = JSON.parse(raw);
    const tr = cfg?.template_resolution || {};
    return {
      mode: (tr.tsc_gate_mode as string) || DEFAULT_CONFIG.mode,
      timeout_ms:
        (tr.tsc_gate_timeout_ms as number) || DEFAULT_CONFIG.timeout_ms,
      lock_timeout_ms:
        (tr.tsc_gate_lock_timeout_ms as number) ||
        DEFAULT_CONFIG.lock_timeout_ms,
      block_on_all_errors:
        (tr.tsc_gate_block_on_all_errors as boolean) ??
        DEFAULT_CONFIG.block_on_all_errors,
      max_errors_shown:
        (tr.tsc_gate_max_errors_shown as number) ||
        DEFAULT_CONFIG.max_errors_shown,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
