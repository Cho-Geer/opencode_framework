'use strict';

/**
 * Rule: no-any-in-spec — CAT3.6
 * ==============================
 * Detects `any` type usage in test/spec files.
 *
 * Spec files should use concrete types to ensure type safety.
 * AI agents often use `any` as a lazy escape hatch, which defeats
 * type checking and can hide real type mismatches.
 *
 * Violation example:
 *   let result: any = await service.create(data);
 *   const mockStore: any = { ... };
 *   const fn: any = () => {};
 *
 * Allowed example:
 *   let result: CreateAppointmentResult = await service.create(data);
 *   const mockStore: Partial<Store> = { ... };
 *
 * Severity: error
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'CAT3.6: Forbids `any` type in spec/test files. Use concrete types.',
    },
    messages: {
      anyFound: 'CAT3.6: "any" type found in test file. Use concrete types instead of "any".',
    },
  },
  create(context) {
    // Only run on spec/test files
    const filename = context.filename || context.getFilename();
    if (!filename.includes('.spec.') && !filename.includes('.test.') && !filename.includes('/test/')) {
      return {};
    }

    return {
      TSTypeAnnotation(node) {
        if (node.typeAnnotation?.type === 'TSAnyKeyword') {
          context.report({ node, messageId: 'anyFound' });
        }
      },
      TSTypeReference(node) {
        if (node.typeName?.type === 'Identifier' && node.typeName.name === 'any') {
          context.report({ node, messageId: 'anyFound' });
        }
      },
    };
  },
};
