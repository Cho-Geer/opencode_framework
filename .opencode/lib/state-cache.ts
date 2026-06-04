/**
 * StateCache — In-Memory File Cache with mtime Invalidation
 *
 * Eliminates redundant disk reads within the same agent session by caching
 * parsed JSON files with mtime-based invalidation. When a file is modified
 * on disk, the cache automatically invalidates and reloads.
 *
 * USAGE:
 *   const cache = new StateCache();
 *   const data = cache.get<GateStateHot>(hotFilePath);
 *   // ... later, after file is written:
 *   cache.invalidate(hotFilePath);  // force reload
 *
 * MEMORY FOOTPRINT:
 *   ~50KB for cached hot files (gate-state.json + Task.DAG.json)
 *   Zero dependencies — standard JavaScript Map
 *
 * WHEN TO USE:
 *   After profiling shows repeated reads of the same hot file within a session.
 *   Optional — the file-based architecture is already 2-5ms per parse.
 *
 * @since Wave 4.2 (R6)
 * @author @Super-Admin
 */
import { statSync, existsSync } from 'node:fs';

interface CacheEntry<T = unknown> {
  data: T;
  mtime: number;
  cachedAt: number;
}

export class StateCache {
  private cache = new Map<string, CacheEntry>();

  /** Get cached data for a file path. Returns null on cache miss. */
  get<T = unknown>(filePath: string): T | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;

    if (!existsSync(filePath)) {
      this.cache.delete(filePath);
      return null;
    }

    const currentMtime = statSync(filePath).mtimeMs;
    if (currentMtime !== entry.mtime) {
      this.cache.delete(filePath);
      return null;
    }

    return entry.data as T;
  }

  /** Cache data with file's current mtime as the invalidation key. */
  set(filePath: string, data: unknown): void {
    const mtime = existsSync(filePath) ? statSync(filePath).mtimeMs : Date.now();
    this.cache.set(filePath, {
      data,
      mtime,
      cachedAt: Date.now(),
    });
  }

  /** Invalidate a specific file or clear the entire cache if no path given. */
  invalidate(filePath?: string): void {
    if (filePath) {
      this.cache.delete(filePath);
    } else {
      this.cache.clear();
    }
  }

  /** Number of entries currently cached. */
  get size(): number {
    return this.cache.size;
  }

  /** Total estimated memory footprint in bytes (rough). */
  get estimatedFootprint(): number {
    let bytes = 0;
    for (const entry of this.cache.values()) {
      bytes += JSON.stringify(entry.data).length;
    }
    return bytes;
  }
}

/** Singleton instance for framework-wide use. */
export const frameworkCache = new StateCache();
