/**
 * hook-critical-files.ts — Re-export from shared lib/critical-files
 * ================================================================
 *
 * Hook-specific re-export layer. The actual CRITICAL_FILES array and
 * git diff utilities live in .opencode/lib/critical-files.ts so they
 * can be shared with gate-core, compliance-gate, and other modules.
 *
 * @author @Super-Admin
 * @since 2026-06-15
 */

export { CRITICAL_FILES, getStagedCriticalFiles } from '../../lib/critical-files';
