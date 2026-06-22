/**
 * hook-critical-files.ts — Re-export from shared lib/critical-files
 * ================================================================
 *
 * Hook-specific re-export layer. The actual CRITICAL_FILES array,
 * git diff utilities, and infrastructure detection functions live
 * in .opencode/lib/critical-files.ts so they can be shared with
 * gate-core, compliance-gate, and other modules.
 *
 * INFRA-POLICY-WIDER-SCOPE (2026-06-22): Added re-exports for
 * BUSINESS_CODE_PREFIX, isInfrastructureFile, and getStagedInfraFiles.
 *
 * @author @Super-Admin
 * @since 2026-06-15
 */

export {
  CRITICAL_FILES,
  getStagedCriticalFiles,
  BUSINESS_CODE_PREFIX,
  isInfrastructureFile,
  getStagedInfraFiles,
} from "../../lib/critical-files";
