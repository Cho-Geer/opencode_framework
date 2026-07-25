// plugin-handlers/shared/config-loader.ts — project.config.json loader with caching
// Used by dispatchers to read plugin_execution_order.

import { readFileSync, statSync } from "fs";
import { resolve } from "path";

interface PluginExecutionOrder {
  before?: string[];
  after?: string[];
  system?: string[];
}

interface ProjectConfig {
  plugin_execution_order?: PluginExecutionOrder;
  [key: string]: any;
}

let _cached: ProjectConfig | null = null;
let _cachedMtime = 0;

/**
 * Read project.config.json with mtime-based caching.
 * Returns null if file not found or parse error.
 */
export function readProjectConfig(): ProjectConfig | null {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const configPath = resolve(projectRoot, ".opencode/project.config.json");

  try {
    const stat = statSync(configPath);
    if (stat.mtimeMs === _cachedMtime && _cached) {
      return _cached;
    }
    const raw = readFileSync(configPath, "utf-8");
    _cached = JSON.parse(raw);
    _cachedMtime = stat.mtimeMs;
    return _cached;
  } catch {
    return _cached; // Return stale cache on error
  }
}

/**
 * Get the execution order for a specific hook phase.
 * Falls back to the provided default order if not configured.
 */
export function getExecutionOrder(phase: "before" | "after" | "system", defaultOrder: string[]): string[] {
  const config = readProjectConfig();
  return config?.plugin_execution_order?.[phase] ?? defaultOrder;
}
