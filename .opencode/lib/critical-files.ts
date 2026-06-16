/**
 * critical-files.ts — Critical infrastructure file detection (git diff)
 * ================================================================
 *
 * Replaces the old SHA-256 digest system (rule_registry.json + rule-registry-verify.ts)
 * with git-diff-based change detection. Two functions cover the two trigger points:
 *
 *   getStagedCriticalFiles()  → commit-time  (git diff --cached)
 *   getModifiedCriticalFiles() → dispatch-time (git diff HEAD)
 *
 * @author @Super-Admin
 * @since 2026-06-15
 */

import { execSync } from 'node:child_process';

/** Files whose modification should trigger the [INFRA] commit marker. */
export const CRITICAL_FILES = [
  '.opencode/rules/common-project.md',
  '.opencode/rules/mcp-compliance-guide.md',
  '.opencode/rules/skill-compliance-guide.md',
  '.opencode/agents/Meta-Planner.md',
  '.opencode/agents/Orchestrator.md',
  '.opencode/agents/Coder-BE.md',
  '.opencode/agents/Coder-FE.md',
  '.opencode/agents/Guardian.md',
  '.opencode/agents/Arbiter.md',
  '.opencode/agents/CI-CD-Agent.md',
  '.opencode/agents/Super-Admin.md',
  '.opencode/agents/Knowledge-Curator.md',
  '.opencode/agents/Architect.md',
  '.opencode/project.config.json',
  '.opencode/lib/gate-core.ts',
  '.opencode/lib/dag-policy.ts',
  '.opencode/lib/permission-isolation-core.ts',
  '.opencode/tools/dispatch_subagent.ts',
  '.opencode/hooks/pre-commit',
  '.opencode/hooks/commit-msg',
  'opencode.json',
  'AGENTS.md',
];

/**
 * Return critical files that are staged for commit.
 * Uses `git diff --cached --name-only` (commit-time check).
 */
export function getStagedCriticalFiles(): string[] {
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  return staged.filter((f) => CRITICAL_FILES.includes(f));
}

/**
 * Return critical files that have been modified since HEAD.
 * Uses `git diff HEAD --name-only` (dispatch-time check).
 * Catches uncommitted changes including multi-day accumulation.
 */
export function getModifiedCriticalFiles(): string[] {
  try {
    const modified = execSync('git diff HEAD --name-only', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    return modified.filter((f) => CRITICAL_FILES.includes(f));
  } catch {
    return [];
  }
}
