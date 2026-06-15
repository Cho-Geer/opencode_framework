/**
 * hook-critical-files.ts — Critical infrastructure file detector
 * ================================================================
 *
 * Layer 1.5 replacement for the old SHA-256 digest check. Instead of
 * maintaining hashes of critical framework files, this module asks git
 * which of the known critical files are staged in the current commit.
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
 * Return the list of staged files that intersect with CRITICAL_FILES.
 * Uses `git diff --cached --name-only`, so it reflects the commit currently
 * being prepared.
 */
export function getStagedCriticalFiles(): string[] {
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  return staged.filter((f) => CRITICAL_FILES.includes(f));
}
