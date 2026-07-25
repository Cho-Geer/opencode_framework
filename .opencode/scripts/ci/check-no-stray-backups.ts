#!/usr/bin/env bun
/**
 * check-no-stray-backups.ts
 *
 * Standalone stray-backup scanner for the OpenCode "work-one" repo.
 * Self-contained TypeScript, runnable with `bun` (no extra deps; uses only
 * the built-in node:child_process to shell out to `git`).
 *
 * ---------------------------------------------------------------------------
 * Policy (from blueprint F5/F6 "Allowed Backup Locations"):
 *
 *   Only these locations may keep backup-style artifacts:
 *     - .opencode/.trash-*   (any .trash-* directory, any depth under it)
 *     - .opencode/state/.backups/   (any depth under state/.backups/)
 *     - .opencode/state/framework-state.db*   (the db file and its siblings)
 *
 * A path is a "backup artifact" if its basename matches any of:
 *     - *.bak
 *     - *.bak-*
 *     - *.bak-pre-*
 *     - *.bak-phase*
 *
 * Any backup artifact OUTSIDE the allowed locations is a violation.
 * ---------------------------------------------------------------------------
 *
 * Data sources (both are scanned and merged, de-duplicated):
 *   1. `git ls-files`                                     (tracked files)
 *   2. `git ls-files --others --ignored --exclude-standard` (untracked + ignored)
 *
 * Output: sorted violation list on stdout.
 * Exit code: 1 if any violation is found, 0 otherwise.
 *
 * Usage:  bun .opencode/scripts/ci/check-no-stray-backups.ts   (run from repo root)
 */

import { execSync } from "node:child_process";

// Backup-artifact grep pattern (basename match). Covers:
//   *.bak | *.bak-* | *.bak-pre-* | *.bak-phase*
// We pre-filter the (potentially enormous, node_modules-heavy) `git` output
// through this pattern so the scanner stays fast and never blows the
// child_process stdout buffer. The JS-side allowlist exclusion still runs
// afterwards for exact policy enforcement.
const BACKUP_GREP = "\\.bak$|\\.bak-";

/** True if the basename looks like a backup artifact. */
function isBackupArtifact(basename: string): boolean {
  // Covers *.bak, *.bak-*, *.bak-pre-*, *.bak-phase* in one check.
  return basename.endsWith(".bak") || basename.includes(".bak-");
}

/** True if the path lives inside an approved backup location. */
function isAllowedLocation(path: string): boolean {
  // .opencode/.trash-*/**  -> any .trash-* directory, any depth
  if (path.startsWith(".opencode/.trash-")) return true;
  // .opencode/state/.backups/**
  if (path.startsWith(".opencode/state/.backups/")) return true;
  // .opencode/state/framework-state.db*
  if (path.startsWith(".opencode/state/framework-state.db")) return true;
  return false;
}

/**
 * Run a git command, pre-filtered to backup-artifact candidate lines, and
 * return its non-empty output lines. The `|| true` keeps the pipeline exit 0
 * even when grep finds no matches (otherwise execSync would throw).
 */
function runGit(args: string): string[] {
  const cmd = `git ${args} | grep -E '${BACKUP_GREP}' || true`;
  let out = "";
  try {
    out = execSync(cmd, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 256, // 256 MiB safety cap
    }).toString();
  } catch (err) {
    console.error(
      `[check-no-stray-backups] git/grep command failed: ${cmd}`
    );
    throw err;
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function main(): number {
  // 1. scan tracked files
  const tracked = runGit("ls-files");
  // 2. scan untracked + ignored files (catches backups hidden by .gitignore)
  const othersIgnored = runGit("ls-files --others --ignored --exclude-standard");

  // 3. merge / de-duplicate
  const all = new Set<string>();
  for (const p of tracked) all.add(p);
  for (const p of othersIgnored) all.add(p);

  // 4. compare against allowlist -> collect violations
  const violations: string[] = [];
  for (const path of all) {
    const base = path.split("/").pop() ?? path;
    if (!isBackupArtifact(base)) continue; // not a backup artifact
    if (isAllowedLocation(path)) continue; // allowed location -> ok
    violations.push(path);
  }

  // 5. sort for deterministic output
  violations.sort();

  // 6. print + exit code
  if (violations.length === 0) {
    console.log(
      "[check-no-stray-backups] OK: no stray backup artifacts outside approved locations."
    );
    return 0;
  }
  console.log(
    `[check-no-stray-backups] FOUND ${violations.length} stray backup artifact(s) outside approved locations:`
  );
  for (const v of violations) {
    console.log(`  VIOLATION: ${v}`);
  }
  return 1;
}

process.exit(main());
