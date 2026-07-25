// service/gate/stale.ts — Gate stale thresholds configuration
// Source: gate-stale.ts (exact copy, imports unchanged)

import * as fs from "node:fs";
import * as path from "node:path";

export interface GateStaleThresholds {
  delivered_hours: number;
  approved_hours: number;
  armed_hours: number;
  startup_cleanup_armed_hours: number;
  checked_hours: number;
}

const DEFAULTS: GateStaleThresholds = {
  delivered_hours: 4,
  approved_hours: 4,
  armed_hours: 24,
  startup_cleanup_armed_hours: 1,
  checked_hours: 48,
};

/**
 * Read gate stale thresholds from project.config.json.
 * Falls back to DEFAULTS if config is missing or malformed.
 */
export function readGateStaleThresholds(): GateStaleThresholds {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const cfgPath = path.join(root, ".opencode", "project.config.json");
    if (!fs.existsSync(cfgPath)) return { ...DEFAULTS };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const t = cfg?.template_resolution?.gate_stale_thresholds || {};
    return {
      delivered_hours: t.delivered_hours ?? DEFAULTS.delivered_hours,
      approved_hours: t.approved_hours ?? DEFAULTS.approved_hours,
      armed_hours: t.armed_hours ?? DEFAULTS.armed_hours,
      startup_cleanup_armed_hours:
        t.startup_cleanup_armed_hours ?? DEFAULTS.startup_cleanup_armed_hours,
      checked_hours: t.checked_hours ?? DEFAULTS.checked_hours,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Read a single key from gate_stale_thresholds.
 */
export function readGateStaleThreshold(key: keyof GateStaleThresholds): number {
  return readGateStaleThresholds()[key];
}
