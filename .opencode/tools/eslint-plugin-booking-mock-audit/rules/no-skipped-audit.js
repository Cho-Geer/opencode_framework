'use strict';

/**
 * Rule: no-skipped-audit
 * CAT1.0: Detects eslint-disable comments that bypass no-tier1-mock without a valid @Arbiter waiver ID.
 * 
 * Valid waiver format: // eslint-disable-next-line ... -- waiver: WAIVE-YYYY-NNN
 * The waiver ID must be recorded in TECH_DEBT_REGISTRY.md.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'CAT1.0: eslint-disable bypass of TIER1 mock audit must reference a valid waiver ID',
    },
    messages: {
      missingWaiver: 'CAT1.0: eslint-disable of booking/no-tier1-mock but no waiver ID found. Format: -- waiver: WAIVE-2026-001',
      invalidWaiverFormat: 'CAT1.0: Invalid waiver ID format. Expected WAIVE-YYYY-NNN (e.g. WAIVE-2026-001)',
    },
  },
  create(context) {
    // Only check spec/test files
    const filename = context.getFilename();
    if (!filename.endsWith('.spec.ts') && !filename.endsWith('.test.ts')) {
      return {};
    }

    return {
      Program(node) {
        const comments = context.getSourceCode().getAllComments();

        for (const comment of comments) {
          const text = comment.value;

          // Look for eslint-disable comments targeting no-tier1-mock
          const disablesTier1Mock =
            text.includes('no-tier1-mock') &&
            (text.includes('eslint-disable') || text.includes('eslint-disable-next-line'));

          if (!disablesTier1Mock) continue;

          // Check for waiver reference
          const waiverMatch = text.match(/waiver:\s*(WAIVE-\d{4}-\d{3})/i);
          if (!waiverMatch) {
            context.report({
              loc: comment.loc,
              messageId: 'missingWaiver',
            });
          } else {
            const waiverId = waiverMatch[1];
            const validFormat = /^WAIVE-\d{4}-\d{3}$/i.test(waiverId);
            if (!validFormat) {
              context.report({
                loc: comment.loc,
                messageId: 'invalidWaiverFormat',
              });
            }
            // Note: Actual existence check in TECH_DEBT_REGISTRY.md is done
            // by @Guardian at review time, not by ESLint.
          }
        }
      },
    };
  },
};
