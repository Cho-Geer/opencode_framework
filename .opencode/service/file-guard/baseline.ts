// service/file-guard/baseline.ts — TOCTOU baseline (dual-layer: in-memory + DB)
// Source: safe-edit-core.ts baseline functions

import {
  dbReadFileBaseline,
  dbWriteFileBaseline,
  dbDeleteFileBaseline,
  type FileBaselineSnapshot,
} from "../../lib/db-state-manager";

export interface StatSnapshot {
  path: string;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  mode: number;
}

const _fileRegistry = new Map<string, Omit<StatSnapshot, "path">>();

export function clearRegistry(): void { _fileRegistry.clear(); }

function _pathHash(filePath: string): string {
  return Buffer.from(filePath).toString("hex");
}

function _statToBaseline(stat: Omit<StatSnapshot, "path">): FileBaselineSnapshot {
  return {
    inode: stat.ino, size: stat.size, mtime: stat.mtimeMs,
    ctime: stat.ctimeMs, dev: stat.dev, updated_at: Date.now(), process_id: process.pid,
  };
}

function _baselineToRegistry(snap: FileBaselineSnapshot): Omit<StatSnapshot, "path"> {
  return {
    ino: snap.inode, size: snap.size, mtimeMs: snap.mtime,
    ctimeMs: snap.ctime, dev: snap.dev, mode: 0,
  };
}

export function resolveBaseline(filePath: string): Omit<StatSnapshot, "path"> | null {
  const cached = _fileRegistry.get(filePath);
  if (cached) return cached;
  try {
    const dbSnap = dbReadFileBaseline(_pathHash(filePath));
    if (dbSnap) {
      const reg = _baselineToRegistry(dbSnap);
      _fileRegistry.set(filePath, reg);
      return reg;
    }
  } catch { /* DB unavailable */ }
  return null;
}

export function populateBaseline(filePath: string, stat: Omit<StatSnapshot, "path">): void {
  _fileRegistry.set(filePath, stat);
  try { dbWriteFileBaseline(_pathHash(filePath), _statToBaseline(stat)); } catch { /* graceful */ }
}

export function consumeBaseline(filePath: string): void {
  _fileRegistry.delete(filePath);
  try { dbDeleteFileBaseline(_pathHash(filePath)); } catch { /* graceful */ }
}

import * as fs from "fs";

export function captureStat(filePath: string): StatSnapshot {
  const resolvedPath = fs.realpathSync(filePath);
  const stat = fs.statSync(resolvedPath);
  return { path: resolvedPath, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, dev: stat.dev, mode: stat.mode };
}

export function statsEqual(a: StatSnapshot, b: StatSnapshot): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
